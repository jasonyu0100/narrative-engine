import type { NarrativeState, WorldBuild } from "@/types/narrative";
import { REASONING_BUDGETS, resolveEntry } from "@/types/narrative";
import { callGenerate, callGenerateStream, SYSTEM_PROMPT } from "./api";
import { narrativeContext, getStateAtIndex } from "./context";
import { parseJson } from "./json";
import { buildCumulativeSystemGraph, resolveEntityName } from "@/lib/narrative-utils";
import { applyDerivedForceModes } from "@/lib/auto-engine";
import { logError } from "@/lib/system-logger";

// ── Plan Node Scaling ─────────────────────────────────────────────────────────
// Coordination plans scale node counts based on arc budget to ensure proper
// reasoning depth. The structural spine is peaks + valleys + moments; every
// arc has exactly one peak OR one valley as its anchor (carrying arcIndex,
// sceneCount, forceMode), and moments are supporting beats.

/**
 * Calculate expected node counts for a coordination plan based on arc budget.
 * Returns guidance for minimum nodes per category.
 * Emphasizes DEPTH (chains of reasoning) not just BREADTH (many disconnected nodes).
 */
function getPlanNodeGuidance(
  arcTarget: number,
  threadCount: number,
  scale: number = 1,
): {
  minSpineNodes: number;
  minReasoningNodes: number;
  minPatterns: number;
  minWarnings: number;
  minChaos: number;
  minCharacterNodes: number;
  minLocationNodes: number;
  minArtifactNodes: number;
  minSystemNodes: number;
  minChainDepth: number;
  minEdges: number;
  totalMin: number;
} {
  const s = (n: number) => Math.max(1, Math.round(n * scale));

  // A coordination plan orchestrates the whole story — it needs wide AND
  // deep reasoning. Per-arc plans can be tighter; plans cannot.

  // Spine nodes (peaks + valleys + moments). Every arc contributes one
  // anchor (peak or valley) PLUS supporting moments. Threads each need
  // multiple spine nodes to show progression (seeded → escalating → peak).
  const minSpineNodes = s(
    Math.max(
      arcTarget * 2 + threadCount,          // 2 spine nodes per arc + 1 per thread
      Math.floor(arcTarget * 2.5) + threadCount,
    ),
  );

  // Reasoning backbone — branched, not chained. Each arc needs 3-4
  // reasoning nodes, plus 2 per thread for causal cross-arc chains.
  const minReasoningNodes = s(
    Math.max(
      8,
      Math.floor(arcTarget * 3) + Math.floor(threadCount * 1.5),
    ),
  );

  // Patterns and warnings — creative agents
  const minPatterns = s(Math.max(2, Math.floor(arcTarget / 2)));
  const minWarnings = s(Math.max(2, Math.floor(arcTarget / 2)));

  // Chaos — baseline 1-2 per plan even when balanced; more under chaos preference
  // (the preference block bumps this further in the prompt itself).
  const minChaos = s(Math.max(1, Math.floor(arcTarget / 4)));

  // Entity grounding — MUST appear (plans without entities are abstract)
  const minCharacterNodes = s(Math.max(3, Math.floor(threadCount * 0.75)));
  const minLocationNodes = s(Math.max(2, Math.floor(arcTarget / 3)));
  const minArtifactNodes = s(Math.max(1, Math.floor(arcTarget / 4)));
  const minSystemNodes = s(Math.max(2, Math.floor(arcTarget / 2)));

  // Chain depth — minimum reasoning steps between spine nodes (through
  // converging reasoning, not a single chain)
  const minChainDepth = s(Math.max(3, Math.floor(arcTarget / 2)));

  const totalMin =
    minSpineNodes +
    minReasoningNodes +
    minPatterns +
    minWarnings +
    minChaos +
    minCharacterNodes +
    minLocationNodes +
    minArtifactNodes +
    minSystemNodes;

  // Enforce edge density — a branched graph has ~1.6× more edges than nodes
  const minEdges = Math.round(totalMin * 1.6);

  return {
    minSpineNodes,
    minReasoningNodes,
    minPatterns,
    minWarnings,
    minChaos,
    minCharacterNodes,
    minLocationNodes,
    minArtifactNodes,
    minSystemNodes,
    minChainDepth,
    minEdges,
    totalMin,
  };
}

// Valid node and edge types for validation
// Threads as fate: can influence events anywhere in the reasoning chain
const VALID_NODE_TYPES = new Set([
  "fate",        // Thread's gravitational pull — influences events toward resolution or unexpected turns
  "character",   // Active agent that fulfills requirements
  "location",    // Setting that enables/constrains action
  "artifact",    // Object with narrative significance
  "system",      // World rule or principle
  "reasoning",   // A step in the logical chain
  "pattern",     // Positive pattern to reinforce (cooperative)
  "warning",     // Anti-pattern risk to avoid (adversarial)
  "chaos",       // Creative agent — spawns new characters/locations/artifacts/threads
]);
const VALID_EDGE_TYPES = new Set(["enables", "constrains", "risks", "requires", "causes", "reveals", "develops", "resolves"]);

// ── Node Types ───────────────────────────────────────────────────────────────

export type ReasoningNodeType =
  | "fate"         // Thread's gravitational pull — influences events toward resolution or unexpected turns
  | "character"    // Active agent that fulfills requirements
  | "location"     // Setting that enables/constrains action
  | "artifact"     // Object with narrative significance
  | "system"       // World rule or principle
  | "reasoning"    // A step in the logical chain
  | "pattern"      // Positive pattern to reinforce (cooperative)
  | "warning"      // Anti-pattern risk to avoid (adversarial)
  | "chaos";       // Creative agent — authorises spawning new characters/locations/artifacts/threads

export type ReasoningEdgeType =
  | "enables"      // A enables B
  | "constrains"   // A limits/blocks B
  | "risks"        // A creates risk for B
  | "requires"     // A needs B
  | "causes"       // A leads to B
  | "reveals"      // A exposes B
  | "develops"     // A deepens B (thread/character)
  | "resolves";    // A concludes B

export interface ReasoningNode {
  id: string;
  index: number;           // Sequential index for stepping through
  type: ReasoningNodeType;
  label: string;           // Short label (3-8 words)
  detail?: string;         // Expanded explanation
  entityId?: string;       // Reference to actual entity (character/location/artifact ID)
  threadId?: string;       // For outcome nodes - which thread is affected
}

export interface ReasoningEdge {
  id: string;
  from: string;            // Node ID
  to: string;              // Node ID
  type: ReasoningEdgeType;
  label?: string;          // Optional edge label
}

export interface ReasoningGraph {
  nodes: ReasoningNode[];
  edges: ReasoningEdge[];
  arcName: string;
  sceneCount: number;
  summary: string;         // High-level summary of the reasoning
}

// ── Sequential Path Builder ──────────────────────────────────────────────────

/** Minimal node shape for building sequential paths */
export type ReasoningNodeBase = {
  id: string;
  index: number;
  type: string;
  label: string;
  detail?: string;
  entityId?: string;
  threadId?: string;
};

/** Minimal graph shape for building sequential paths — works with ReasoningGraph, ExpansionReasoningGraph, and CoordinationPlan */
export type ReasoningGraphBase = {
  nodes: ReasoningNodeBase[];
  edges: ReasoningEdge[];
};

/**
 * Build a sequential reasoning path from the graph for LLM consumption.
 * Nodes are ordered by index, with connection IDs inline.
 */
export function buildSequentialPath(graph: ReasoningGraphBase): string {
  const sortedNodes = [...graph.nodes].sort((a, b) => a.index - b.index);
  const edgeMap = new Map<string, ReasoningEdge[]>();

  // Build outgoing edge map
  for (const edge of graph.edges) {
    if (!edgeMap.has(edge.from)) edgeMap.set(edge.from, []);
    edgeMap.get(edge.from)!.push(edge);
  }

  const lines: string[] = [];

  for (const node of sortedNodes) {
    const outgoing = edgeMap.get(node.id) ?? [];
    const connections = outgoing
      .map(e => `${e.type}→${e.to}`)
      .join(", ");

    const connectStr = connections ? ` [${connections}]` : "";
    const entityRef = node.entityId ? ` @${node.entityId}` : "";
    const threadRef = node.threadId ? ` #${node.threadId}` : "";

    lines.push(
      `[${node.index}] ${node.type.toUpperCase()}: ${node.label}${entityRef}${threadRef}${connectStr}`
    );

    if (node.detail) {
      lines.push(`    → ${node.detail}`);
    }
  }

  return lines.join("\n");
}

// ── Generation ───────────────────────────────────────────────────────────────

// Import the shared CoordinationPlanContext type from scenes
import type { CoordinationPlanContext } from './scenes';

export type ArcReasoningOptions = {
  /**
   * Which force category to bias this arc toward. Default "balanced".
   * When "chaos", chaos becomes the arc's primary creative engine.
   */
  forcePreference?: ForcePreference;
  /**
   * Reasoning effort for this generation. Overrides the narrative's
   * storySettings.reasoningLevel. "small" | "medium" | "large" map to
   * low / medium / high REASONING_BUDGETS.
   */
  reasoningLevel?: "small" | "medium" | "large";
};

/** Default reasoning-token budget tied to narrative settings. */
function defaultReasoningBudget(narrative: NarrativeState): number | undefined {
  return (
    REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? "low"] ||
    undefined
  );
}

/**
 * Multiplier applied to graph node-count targets based on the reasoning
 * slider. Small compresses the graph, medium is default, large expands.
 * Used to scale density of reasoning graphs and coordination plans.
 */
export function reasoningScale(
  size: "small" | "medium" | "large" | undefined,
): number {
  if (size === "small") return 0.6;
  if (size === "large") return 1.6;
  return 1; // medium / undefined
}

/**
 * Build a force-preference guidance block for the prompt. Returns "" for
 * balanced (default, no bias) or an undefined preference.
 *
 * The block is written from the perspective of either a per-arc reasoning
 * graph ("arc") or the multi-arc coordination plan ("plan"), since the
 * same preferences mean slightly different things at each level.
 */
function forcePreferenceBlock(
  scope: "arc" | "plan",
  pref: "balanced" | "fate" | "world" | "system" | "chaos" | undefined,
): string {
  if (!pref || pref === "balanced") return "";

  const scopeNoun = scope === "plan" ? "PLAN" : "ARC";
  const unit = scope === "plan" ? "plan's arcs" : "arc's scenes";

  if (pref === "fate") {
    return `
## FORCE PREFERENCE: FATE-DOMINANT ${scopeNoun}

Drive the ${scopeNoun.toLowerCase()} through **the threads of fate** — the existing tensions pulling the story toward resolution. Plot moves because threads demand it: they escalate, converge, resolve, or subvert. Favour fate nodes and peak/valley anchors that carry thread progressions (threadId + targetStatus). The ${unit} should feel like inevitability unfolding — every beat answers to an existing thread. Avoid leaning on new entities or deep world mechanics; this is a plot driven by what's already been set in motion.
`;
  }
  if (pref === "world") {
    return `
## FORCE PREFERENCE: WORLD-DOMINANT ${scopeNoun}

Drive the ${scopeNoun.toLowerCase()} through **character and relationship development** — inner change, shifting bonds, locations accruing meaning, artifacts gaining history. Plot moves because people (and places, and objects) change: someone learns something, a rivalry deepens, a trust breaks. Favour character/location/artifact nodes and let their interactions generate momentum. The ${unit} should deepen who and what already exists rather than resolve threads or teach the reader new rules — character is the engine here.
`;
  }
  if (pref === "system") {
    return `
## FORCE PREFERENCE: SYSTEM-DOMINANT ${scopeNoun}

Drive the ${scopeNoun.toLowerCase()} through **world mechanics and lore** — rules, constraints, principles, tensions in how the world works. Plot moves because the world's physics push back: a magic system has limits the cast discovers, an economy rewards certain behaviour, a hierarchy forces compromises. Favour system nodes and reasoning that turns on HOW the world works. The ${unit} should surface, test, or exploit the mechanics of the setting — the reader learns the world as the cast does.
`;
  }
  if (pref === "chaos") {
    return `
## FORCE PREFERENCE: CHAOS-DOMINANT ${scopeNoun}

Drive the ${scopeNoun.toLowerCase()} through **chaos — the outside-force creative engine**. Chaos operates OUTSIDE the existing fabric of fate, world, and system: it brings new problems, new solutions, new characters, new locations, new artifacts, and — crucially — **new fates** (new threads) that didn't exist before. Chaos is how a plot stays unpredictable, how a world expands, how a story surprises. It is not randomness; each chaos injection must CAUSE something the existing world could not have produced on its own.

**What chaos does in this mode**:
- Injects problems the cast cannot anticipate (a troll in the dungeon, an ambush from elsewhere, a plague arriving).
- Injects solutions the cast did not build (a stranger with answers, a dormant artefact waking, a forgotten ally surfacing).
- **Seeds new fate** — opens threads that didn't exist. Chaos sits outside fate, but it SHAPES fate by creating fresh strands that later arcs develop and resolve.

**Behaviour in this ${scopeNoun.toLowerCase()}**:
${scope === "plan"
  ? "- Expect several chaos-dominant arcs across the plan (HP's troll arc, HP's Norbert arc). Roughly 25-40% of arcs should be anchored on chaos.\n- Seed 5-10 chaos nodes across the plan.\n- Let chaos open new threads that become part of the plan's trajectory — a new fate strand introduced in arc 2 might resolve in arc 5."
  : "- Build the arc around 3-5 chaos nodes rather than the default 1-2.\n- The arc's peak or valley may itself be chaos-anchored (its prime mover is outside the current world).\n- A chaos node can inject a new thread that becomes part of this arc's causal chain and carries into future arcs."}
- Mix chaos with the existing cast — chaos CREATES room for character/system/fate development; it doesn't replace them. The troll-in-the-dungeon arc matters because it forges Harry, Ron, and Hermione's friendship: the chaos event opens character development the fate threads couldn't reach on their own.
`;
  }
  return "";
}

export async function generateReasoningGraph(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  sceneCount: number,
  direction: string,
  arcName: string,
  onReasoning?: (token: string) => void,
  /** When provided, the coordination plan context guides the reasoning graph generation */
  coordinationPlanContext?: CoordinationPlanContext,
  /** Arc-level options (chaos-driven, reasoning effort). */
  options?: ArcReasoningOptions,
): Promise<ReasoningGraph> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  // Get active threads
  const activeThreads = Object.values(narrative.threads)
    .filter((t) =>
      ["seeded", "active", "escalating", "critical"].includes(t.status),
    )
    .map((t) => `- [${t.id}] ${t.description} (${t.status})`)
    .join("\n");

  // Get key characters
  const characters = Object.values(narrative.characters)
    .filter((c) => c.role === "anchor" || c.role === "recurring")
    .slice(0, 8)
    .map((c) => `- [${c.id}] ${c.name} (${c.role})`)
    .join("\n");

  // Get key locations
  const locations = Object.values(narrative.locations)
    .filter((l) => l.prominence === "domain" || l.prominence === "place")
    .slice(0, 6)
    .map((l) => `- [${l.id}] ${l.name}`)
    .join("\n");

  // Get artifacts
  const artifacts = Object.values(narrative.artifacts ?? {})
    .filter((a) => a.significance === "key" || a.significance === "notable")
    .slice(0, 4)
    .map((a) => `- [${a.id}] ${a.name}`)
    .join("\n");

  // Get system knowledge
  const systemKnowledge = Object.values(narrative.systemGraph?.nodes ?? {})
    .filter((n) =>
      ["principle", "system", "constraint", "tension"].includes(n.type),
    )
    .slice(0, 8)
    .map((n) => `- ${n.concept} (${n.type})`)
    .join("\n");

  // Get story patterns and anti-patterns
  const patterns = narrative.patterns ?? [];
  const antiPatterns = narrative.antiPatterns ?? [];

  const patternsSection = patterns.length > 0
    ? `STORY PATTERNS (positive commandments to reinforce):\n${patterns.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
    : "";

  const antiPatternsSection = antiPatterns.length > 0
    ? `ANTI-PATTERNS (pitfalls to avoid):\n${antiPatterns.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
    : "";

  const prompt = `${ctx}

## AVAILABLE ENTITIES

ACTIVE THREADS (threads are QUESTIONS the story must answer):
${activeThreads || "None yet"}

KEY CHARACTERS:
${characters || "None yet"}

KEY LOCATIONS:
${locations || "None yet"}

KEY ARTIFACTS:
${artifacts || "None yet"}

SYSTEM KNOWLEDGE:
${systemKnowledge || "None yet"}

${patternsSection}

${antiPatternsSection}

## TASK

Build a REASONING GRAPH for "${arcName}" to guide ${sceneCount} scene(s).
${coordinationPlanContext ? `
═══════════════════════════════════════════════════════════════════════════════
COORDINATION PLAN — THIS IS YOUR PRIMARY BRIEF (Arc ${coordinationPlanContext.arcIndex}/${coordinationPlanContext.arcCount})
═══════════════════════════════════════════════════════════════════════════════

This arc is part of a multi-arc coordination plan derived from backward induction. The plan below defines the KEY PLOT POINTS and REASONING that this arc must execute. Your reasoning graph must serve as a bridge between the coordination plan and scene generation.

${coordinationPlanContext.forceMode ? `**Force Mode**: ${coordinationPlanContext.forceMode.toUpperCase()} — lean into this narrative force for this arc.\n` : ''}
**Plan Directive**:
${coordinationPlanContext.directive}

**Your job**: Build a reasoning graph that EXECUTES the coordination plan for this specific arc. The graph should:
1. Ground the plan's abstract plot points in SPECIFIC entities, locations, and mechanisms
2. Fill in the HOW — the plan says WHAT must happen, you determine the specific path
3. Maintain the plan's thread targets — if the plan says thread X should escalate, your graph must deliver that escalation
4. Respect the force mode — if world-dominant, lean into character development; if fate-dominant, lean into thread resolution
${direction.trim() ? `
**Additional Direction** (layer on top of the plan):
${direction}` : ''}
═══════════════════════════════════════════════════════════════════════════════
` : `Direction: ${direction}`}

Use BACKWARD REASONING: Start from what threads NEED, then derive what must happen.
Threads are FATE — they exert gravitational pull on events, but fate doesn't always go the expected direction. Threads can advance through twists, resistance, or subversion.
${forcePreferenceBlock("arc", options?.forcePreference)}
## CREATIVE MANDATE

**The context above is INSPIRATION, not a script.** Do NOT continue trajectories predictably.

**REQUIRED CREATIVE ELEMENTS** (include at least 2 in your reasoning):
1. **UNEXPECTED COLLISION**: Combine elements that have never interacted — what emerges?
2. **SUBVERT THE OBVIOUS**: What's the least expected path that still serves fate?
3. **HIDDEN COST**: What must be sacrificed or lost to achieve progress?
4. **EMERGENT PROPERTY**: When X meets Y, what new capability or dynamic appears?
5. **SECOND-ORDER EFFECT**: What does a recent event ACTUALLY mean that no one has realized?

**AVOID**: Continuing threads on obvious trajectories, using expected combinations, progress without setbacks.

## OUTPUT FORMAT

**CRITICAL FORMAT REQUIREMENTS**:
- **IDs**: Use SHORT, SIMPLE alphanumeric IDs: F1, F2, R1, R2, C1, L1, S1, PT1, WN1, etc. Do NOT use complex IDs like "FATE_THREAD_01" or "reasoning_step_3".
- **Labels**: Must be PROPER ENGLISH descriptions (3-10 words). Describe what happens in natural language. NOT technical identifiers or codes.
  - GOOD: "Fang Yuan exploits his future knowledge", "Alliance fractures over betrayal"
  - BAD: "Thread escalation node", "R2_REQUIRES_C1", "fate pressure mechanism"

Return a JSON object:

{
  "summary": "1-2 sentence high-level summary of the arc's reasoning",
  "nodes": [
    {
      "id": "F1",
      "index": 0,
      "type": "fate",
      "label": "Survival thread demands immediate sanctuary",
      "detail": "What this thread requires to progress — the gravitational pull",
      "threadId": "thread-id"
    },
    {
      "id": "R1",
      "index": 1,
      "type": "reasoning",
      "label": "Sanctuary requires alliance with rival faction",
      "detail": "Backward reasoning from thread requirement"
    },
    {
      "id": "C1",
      "index": 2,
      "type": "character",
      "label": "Fang Yuan knows the faction's secret weakness",
      "detail": "Who can fulfill this requirement",
      "entityId": "actual-character-id-from-narrative"
    },
    {
      "id": "S1",
      "index": 3,
      "type": "system",
      "label": "Clan hierarchy forbids direct negotiation",
      "detail": "What system/rule shapes the action"
    },
    {
      "id": "CH1",
      "index": 4,
      "type": "chaos",
      "label": "An exile from a rival clan arrives seeking asylum",
      "detail": "OUTSIDE FORCE — a NEW character arrives from beyond the current world, bringing either a problem (their pursuers) or a solution (their knowledge). The scene generator will spawn this character. No entityId."
    }
  ],
  "edges": [
    {"id": "e1", "from": "F1", "to": "R1", "type": "requires"},
    {"id": "e2", "from": "R1", "to": "C1", "type": "requires"},
    {"id": "e3", "from": "S1", "to": "C1", "type": "constrains"},
    {"id": "e4", "from": "CH1", "to": "R1", "type": "enables"}
  ]
}

## NODE TYPES

- **fate**: Thread's gravitational pull on events. Use threadId to reference the thread. Fate can appear ANYWHERE in the reasoning chain — it influences characters, locations, systems, and other reasoning. Fate doesn't always pull in expected directions: it can demand twists, resistance, or subversion. Label = what the thread needs or how it exerts pressure.
- **character**: An active agent. Use entityId to reference actual character. Label = their position/goal.
- **location**: A setting. Use entityId to reference actual location. Label = what it enables/constrains.
- **artifact**: An object. Use entityId to reference actual artifact. Label = its role in reasoning.
- **system**: A world rule/principle/constraint. Label = the rule as it applies here.
- **reasoning**: A logical step deriving what must happen. Label = the inference (3-8 words).
- **pattern**: EXPANSION AGENT — inject novelty. Unexpected collisions, emergent properties, hidden implications within the current sandbox. Label = the creative opportunity.
- **warning**: SUBVERSION AGENT — challenge predictability. Predictable trajectories, missing costs, assumptions to challenge. Label = what must be disrupted.
- **chaos**: OUTSIDE FORCE — operates outside the existing fabric of fate, world, and system. Chaos has two everyday modes: as a **deus-ex-machina**, it brings problems the cast couldn't anticipate or solutions the cast couldn't build (a troll bursts into the dungeon, a stranger arrives with a fragmentary map, a dormant artefact wakes); as a **creative engine**, it seeds entirely new fates — new threads that didn't exist, which later arcs develop and resolve. Chaos sits OUTSIDE fate, but shapes fate by creating fresh strands. A well-used chaos node is balanced: it breaks a stalemate the existing forces couldn't, and it plants something the story can reuse. Use sparingly in balanced mode; use extensively under chaos-preference. Label = what arrives and its role. DO NOT set entityId or threadId — the entity/thread is spawned via world expansion.

## EDGE TYPES

- **enables**: A makes B possible
- **constrains**: A limits/blocks B
- **risks**: A creates danger for B
- **requires**: A depends on B
- **causes**: A leads to B
- **reveals**: A exposes information in B
- **develops**: A deepens B (character arc or theme)
- **resolves**: A concludes/answers B

## REQUIREMENTS

1. **Backward reasoning**: Start from FATE (what threads need) and derive what must happen. The graph flows from thread requirements → reasoning → entities that fulfill them.
2. **Causal complexity**: The arc is a causal reasoning diagram — capture the REAL complexity of how it unfolds. Threads pull on multiple things, entities influence multiple moments, rules constrain several choices. When you add a node, show all the places it matters.
3. **Fate throughout**: Fate nodes can appear ANYWHERE — they influence events at any point. A fate node can connect to characters, locations, reasoning, even other fate nodes. Fate is the gravitational force pulling the narrative.
4. **Unexpected directions**: Fate doesn't always pull toward obvious resolution. Include fate nodes that demand twists, resistance, or subversion. A thread at "escalating" might need a setback before payoff.
5. **Sequential indexing**: Nodes are indexed 0, 1, 2... in logical reading order
6. **Entity references**: character/location/artifact nodes MUST use entityId with actual IDs
7. **Thread references**: fate nodes MUST use threadId to reference which thread exerts the pull
8. **Single entity node per entity**: If the same character or system matters in multiple places, create ONE node with multiple edges — don't duplicate.
9. **Node count**: Target ${Math.round((6 + sceneCount * 4) * reasoningScale(options?.reasoningLevel))}-${Math.round((12 + sceneCount * 5) * reasoningScale(options?.reasoningLevel))} nodes across all types.
10. **Pattern nodes**: 1-2 nodes with GENUINE creativity — unexpected collisions, emergent properties within the existing cast
11. **Warning nodes**: Flag predictable trajectories and missing costs — what assumption needs challenging?
12. **Chaos nodes (1-2 default, more under chaos preference)**: Inject at least one outside-force element — a new character arriving, a dormant artefact waking, a new fate appearing. Do NOT reference existing entityIds — chaos describes an entity that will be spawned. A chaos node signals the scene generator to invoke world expansion.
13. **Non-deterministic**: Each reasoning path should contain at least one SURPRISE — something that doesn't follow obviously from context

## SHAPE OF A GOOD ARC GRAPH

An arc reasoning graph is a causal diagram, not a chain of justifications. A good graph captures how the arc actually works: key characters connect to several reasoning nodes, rules constrain multiple choices, the arc's climax is the convergence of several setups rather than the end of a single line. When you finish, scan the graph — if it reads like a vertical list, the story's complexity is being under-represented.

The graph should reveal the strategic logic: what threads demand, and how events must unfold to serve fate.

Return ONLY the JSON object.`;

  const reasoningBudget = defaultReasoningBudget(narrative);

  const raw = onReasoning
    ? await callGenerateStream(
        prompt,
        SYSTEM_PROMPT,
        () => {}, // No token streaming for main output
        undefined,
        "generateReasoningGraph",
        undefined,
        reasoningBudget,
        onReasoning,
      )
    : await callGenerate(
        prompt,
        SYSTEM_PROMPT,
        undefined,
        "generateReasoningGraph",
        undefined,
        reasoningBudget,
      );

  // Parse JSON response
  try {
    let jsonStr = raw.trim();
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const data = JSON.parse(jsonStr);

    // Validate and normalize
    if (!data.nodes || !Array.isArray(data.nodes)) {
      throw new Error("Invalid graph structure: missing nodes");
    }
    if (!data.edges || !Array.isArray(data.edges)) {
      data.edges = [];
    }

    // Ensure all nodes have required fields and valid types
    const nodes: ReasoningNode[] = data.nodes.map((n: Partial<ReasoningNode>, i: number) => ({
      id: typeof n.id === "string" ? n.id : `N${i}`,
      index: typeof n.index === "number" ? n.index : i,
      type: (typeof n.type === "string" && VALID_NODE_TYPES.has(n.type)) ? n.type as ReasoningNodeType : "reasoning",
      label: typeof n.label === "string" ? n.label.slice(0, 200) : "Unlabeled node",
      detail: typeof n.detail === "string" ? n.detail.slice(0, 500) : undefined,
      entityId: typeof n.entityId === "string" ? n.entityId : undefined,
      threadId: typeof n.threadId === "string" ? n.threadId : undefined,
    }));

    // Ensure all edges have required fields, valid types, and reference existing nodes
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges: ReasoningEdge[] = data.edges
      .map((e: Partial<ReasoningEdge>, i: number) => ({
        id: typeof e.id === "string" ? e.id : `E${i}`,
        from: typeof e.from === "string" ? e.from : "",
        to: typeof e.to === "string" ? e.to : "",
        type: (typeof e.type === "string" && VALID_EDGE_TYPES.has(e.type)) ? e.type as ReasoningEdgeType : "causes",
        label: typeof e.label === "string" ? e.label.slice(0, 100) : undefined,
      }))
      .filter((e: ReasoningEdge) => e.from && e.to && nodeIds.has(e.from) && nodeIds.has(e.to));

    return {
      nodes,
      edges,
      arcName,
      sceneCount,
      summary: typeof data.summary === "string" ? data.summary.slice(0, 500) : `Reasoning graph for ${arcName}`,
    };
  } catch (err) {
    logError("Failed to parse reasoning graph", err, {
      source: "world-expansion",
      operation: "reasoning-graph-parse",
      details: { arcName, sceneCount },
    });
    // Return minimal fallback
    return {
      nodes: [
        {
          id: "R1",
          index: 0,
          type: "reasoning",
          label: `${arcName} - graph generation failed`,
          detail: String(err),
        },
      ],
      edges: [],
      arcName,
      sceneCount,
      summary: "Failed to generate reasoning graph",
    };
  }
}

// ── Expansion Reasoning Graph ─────────────────────────────────────────────────

export type ExpansionReasoningGraph = {
  nodes: ReasoningNode[];
  edges: ReasoningEdge[];
  expansionName: string;
  summary: string;
};

/**
 * Generate a reasoning graph for world expansion.
 * This captures the strategic logic driving WHY new entities should be added
 * and HOW they connect to the existing world.
 */
export async function generateExpansionReasoningGraph(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  directive: string,
  size: "small" | "medium" | "large" | "exact",
  strategy: "depth" | "breadth" | "dynamic",
  onReasoning?: (token: string) => void,
  /** Force preference + reasoning size (graph density). */
  options?: ArcReasoningOptions,
): Promise<ExpansionReasoningGraph> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  // Get active threads
  const activeThreads = Object.values(narrative.threads)
    .filter((t) =>
      ["seeded", "active", "escalating", "critical"].includes(t.status),
    )
    .map((t) => `- [${t.id}] ${t.description} (${t.status})`)
    .join("\n");

  // Get all characters with continuity depth
  const characters = Object.values(narrative.characters)
    .map((c) => {
      const depth = Object.keys(c.world?.nodes ?? {}).length;
      return `- [${c.id}] ${c.name} (${c.role}, ${depth} knowledge nodes)`;
    })
    .join("\n");

  // Get all locations with hierarchy
  const locations = Object.values(narrative.locations)
    .map((l) => {
      const parent = l.parentId ? narrative.locations[l.parentId]?.name : null;
      return `- [${l.id}] ${l.name}${parent ? ` (inside ${parent})` : ""} [${l.prominence}]`;
    })
    .join("\n");

  // Get artifacts
  const artifacts = Object.values(narrative.artifacts ?? {})
    .map((a) => `- [${a.id}] ${a.name} (${a.significance})`)
    .join("\n");

  // Get system knowledge
  const systemKnowledge = Object.values(narrative.systemGraph?.nodes ?? {})
    .slice(0, 12)
    .map((n) => `- ${n.concept} (${n.type})`)
    .join("\n");

  // Get relationships
  const relationships = narrative.relationships
    .slice(0, 15)
    .map((r) => {
      const fromName = narrative.characters[r.from]?.name ?? r.from;
      const toName = narrative.characters[r.to]?.name ?? r.to;
      return `- ${fromName} → ${toName}: ${r.type}`;
    })
    .join("\n");

  // Find gaps and opportunities
  const orphanedChars = Object.values(narrative.characters)
    .filter((c) => !narrative.relationships.some((r) => r.from === c.id || r.to === c.id))
    .map((c) => c.name);

  const shallowChars = Object.values(narrative.characters)
    .filter((c) => Object.keys(c.world?.nodes ?? {}).length < 3)
    .map((c) => c.name);

  const leafLocations = Object.values(narrative.locations)
    .filter((l) => !Object.values(narrative.locations).some((other) => other.parentId === l.id))
    .map((l) => l.name);

  // Get recent world expansions (last 3 world commits) to avoid duplication
  const recentWorldBuilds: WorldBuild[] = resolvedKeys
    .slice(-20) // Look at recent entries
    .map((k) => resolveEntry(narrative, k))
    .filter((e): e is WorldBuild => e?.kind === "world_build")
    .slice(-3); // Last 3 world commits

  const recentExpansionSection = recentWorldBuilds.length > 0
    ? `RECENT WORLD EXPANSIONS (DO NOT duplicate — build upon these instead):
${recentWorldBuilds.map((wb: WorldBuild) => {
  const chars = wb.expansionManifest.newCharacters.map((c: { name: string }) => c.name).join(", ");
  const locs = wb.expansionManifest.newLocations.map((l: { name: string }) => l.name).join(", ");
  const threads = wb.expansionManifest.newThreads.map((t: { description: string }) => t.description).slice(0, 3).join("; ");
  return `- ${wb.summary}${chars ? `\n  Characters added: ${chars}` : ""}${locs ? `\n  Locations added: ${locs}` : ""}${threads ? `\n  Threads seeded: ${threads}` : ""}`;
}).join("\n")}`
    : "";

  // Get story patterns and anti-patterns
  const patterns = narrative.patterns ?? [];
  const antiPatterns = narrative.antiPatterns ?? [];

  const patternsSection = patterns.length > 0
    ? `STORY PATTERNS (positive commandments):\n${patterns.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
    : "";

  const antiPatternsSection = antiPatterns.length > 0
    ? `ANTI-PATTERNS (pitfalls to avoid):\n${antiPatterns.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
    : "";

  const sizeLabel = {
    small: "3-6 entities",
    medium: "10-15 entities",
    large: "20-35 entities",
    exact: "as specified in directive",
  }[size];

  // Scale node count based on expansion size AND the reasoning slider
  // (graph density, not token budget).
  const densityScale = reasoningScale(options?.reasoningLevel);
  const scaleRange = (lo: number, hi: number) =>
    `${Math.max(1, Math.round(lo * densityScale))}-${Math.max(2, Math.round(hi * densityScale))}`;
  const nodeCountTarget = {
    small: `${scaleRange(5, 8)} nodes for focused reasoning`,
    medium: `${scaleRange(8, 15)} nodes for comprehensive reasoning`,
    large: `${scaleRange(15, 25)} nodes for complex multi-faceted reasoning`,
    exact: `${scaleRange(6, 12)} nodes scaled to directive scope`,
  }[size];

  const prompt = `${ctx}

## CURRENT WORLD STATE

ACTIVE THREADS (threads are QUESTIONS the story must answer):
${activeThreads || "None yet"}

CHARACTERS:
${characters || "None yet"}

LOCATIONS:
${locations || "None yet"}

ARTIFACTS:
${artifacts || "None yet"}

SYSTEM KNOWLEDGE:
${systemKnowledge || "None yet"}

RELATIONSHIPS:
${relationships || "None yet"}

## WORLD GAPS & OPPORTUNITIES

Orphaned characters (no relationships): ${orphanedChars.length > 0 ? orphanedChars.join(", ") : "None"}
Shallow characters (<3 knowledge nodes): ${shallowChars.length > 0 ? shallowChars.join(", ") : "None"}
Leaf locations (no sub-locations): ${leafLocations.length > 0 ? leafLocations.join(", ") : "None"}

${recentExpansionSection}

${patternsSection}

${antiPatternsSection}

## TASK

Build a REASONING GRAPH for world expansion.
Directive: ${directive || "Natural expansion based on current world state"}
Size: ${sizeLabel}
Strategy: ${strategy.toUpperCase()}

Use BACKWARD REASONING: Start from what threads NEED (fate), then derive what entities must exist.
Threads are FATE — they exert gravitational pull on world-building. New entities should serve thread requirements.
${forcePreferenceBlock("arc", options?.forcePreference)}
## OUTPUT FORMAT

**CRITICAL FORMAT REQUIREMENTS**:
- **IDs**: Use SHORT, SIMPLE alphanumeric IDs: F1, F2, R1, R2, C1, L1, S1, PT1, WN1, etc. Do NOT use complex IDs like "EXPANSION_CHAR_01" or "new_location_thread".
- **Labels**: Must be PROPER ENGLISH descriptions (3-10 words). Describe what happens in natural language. NOT technical identifiers or codes.
  - GOOD: "New rival emerges from the northern clans", "Hidden faction controls the resource supply"
  - BAD: "New character node", "expansion_antagonist", "world gap identifier"

Return a JSON object:

{
  "summary": "1-2 sentence high-level summary of the expansion's reasoning",
  "nodes": [
    {
      "id": "F1",
      "index": 0,
      "type": "fate",
      "label": "Power struggle thread needs external antagonist",
      "detail": "What this thread requires to progress",
      "threadId": "thread-id"
    },
    {
      "id": "R1",
      "index": 1,
      "type": "reasoning",
      "label": "External threat forces internal factions to unite",
      "detail": "Backward reasoning from thread requirement"
    },
    {
      "id": "C1",
      "index": 2,
      "type": "character",
      "label": "Warlord from the northern wastes seeks conquest",
      "detail": "How they serve the thread's needs",
      "entityId": "existing-character-id-to-connect-to"
    },
    {
      "id": "S1",
      "index": 3,
      "type": "system",
      "label": "Northern territory is lawless and unexplored",
      "detail": "What's missing that enables new entity"
    },
    {
      "id": "CH1",
      "index": 4,
      "type": "chaos",
      "label": "A foreign envoy arrives bearing a fragmentary map",
      "detail": "OUTSIDE FORCE — an entity that could not have been produced by the existing world. The envoy brings knowledge from beyond the current sandbox."
    }
  ],
  "edges": [
    {"id": "e1", "from": "F1", "to": "R1", "type": "requires"},
    {"id": "e2", "from": "R1", "to": "C1", "type": "requires"},
    {"id": "e3", "from": "S1", "to": "C1", "type": "enables"},
    {"id": "e4", "from": "CH1", "to": "R1", "type": "enables"}
  ]
}

## NODE TYPES FOR EXPANSION

- **fate**: Thread's gravitational pull demanding world expansion. Use threadId. Fate can appear ANYWHERE — it influences what entities get added and why. Label = what the thread needs from the world.
- **character**: A new or existing character. Use entityId to reference existing character this connects to. Label = their role serving fate.
- **location**: A new or existing location. Use entityId. Label = what it enables for threads.
- **artifact**: A new or existing artifact. Use entityId. Label = its role serving fate.
- **system**: A world gap, rule, or opportunity. Label = the gap or rule being established.
- **reasoning**: A logical step explaining WHY this entity serves fate. Label = the inference (3-8 words).
- **pattern**: COOPERATIVE AGENT — positive reinforcement. What variety does this expansion introduce? Label = the opportunity.
- **warning**: ADVERSARIAL AGENT — negative reinforcement. What staleness risks must be avoided? Label = the risk.
- **chaos**: OUTSIDE FORCE — operates outside the existing fabric. Injects entities or new fates that are FOREIGN to the current world. Two modes: deus-ex-machina (a sudden problem or solution) and creative seeding (a new thread the story can later develop). Use when the expansion brings something the existing world could not have produced — a stranger from elsewhere, a dormant artefact waking, a rumour arriving unprompted. Do NOT set entityId — chaos represents a net-new entity.

## EDGE TYPES

- **enables**: A makes B possible
- **constrains**: A limits/blocks B
- **risks**: A creates danger for B
- **requires**: A depends on B
- **causes**: A leads to B
- **reveals**: A exposes information in B
- **develops**: A deepens B (character arc or theme)
- **resolves**: A concludes/answers B

## REQUIREMENTS

1. **Backward reasoning from fate**: Start from FATE (what threads need) and derive what entities must exist
2. **Fate throughout**: Fate nodes can appear anywhere — they justify WHY entities are added
3. **Entity references**: character/location/artifact nodes connecting to existing entities MUST use entityId
4. **Thread references**: fate nodes MUST use threadId to reference which thread exerts the pull
5. **Causal complexity**: The graph is a causal reasoning diagram. Every new entity should show the full web of how it connects — who it serves, what it constrains, what it enables. Not a single line.
6. **Integration focus**: Every new entity should show HOW it serves existing threads via edges
7. **Node count**: Target ${nodeCountTarget}
8. **Pattern nodes**: 1-2 nodes highlighting fresh directions
9. **Warning nodes**: 1-2 nodes flagging staleness risks
10. **Chaos nodes**: Include at least one chaos node. Expansion is ITSELF an outside-force event — something new is arriving. Chaos nodes represent the entities coming from beyond the current world that the expansion is bringing in.

The graph should reveal: what threads demand from the world, what entities must exist to serve fate, and what outside-world additions (chaos) unblock what the existing cast cannot.

Return ONLY the JSON object.`;

  const reasoningBudget = defaultReasoningBudget(narrative);

  const raw = onReasoning
    ? await callGenerateStream(
        prompt,
        SYSTEM_PROMPT,
        () => {}, // No token streaming for main output
        undefined,
        "generateExpansionReasoningGraph",
        undefined,
        reasoningBudget,
        onReasoning,
      )
    : await callGenerate(
        prompt,
        SYSTEM_PROMPT,
        undefined,
        "generateExpansionReasoningGraph",
        undefined,
        reasoningBudget,
      );

  // Parse JSON response
  try {
    let jsonStr = raw.trim();
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const data = JSON.parse(jsonStr);

    // Validate and normalize
    if (!data.nodes || !Array.isArray(data.nodes)) {
      throw new Error("Invalid graph structure: missing nodes");
    }
    if (!data.edges || !Array.isArray(data.edges)) {
      data.edges = [];
    }

    // Ensure all nodes have required fields and valid types
    const nodes: ReasoningNode[] = data.nodes.map((n: Partial<ReasoningNode>, i: number) => ({
      id: typeof n.id === "string" ? n.id : `N${i}`,
      index: typeof n.index === "number" ? n.index : i,
      type: (typeof n.type === "string" && VALID_NODE_TYPES.has(n.type)) ? n.type as ReasoningNodeType : "reasoning",
      label: typeof n.label === "string" ? n.label.slice(0, 200) : "Unlabeled node",
      detail: typeof n.detail === "string" ? n.detail.slice(0, 500) : undefined,
      entityId: typeof n.entityId === "string" ? n.entityId : undefined,
      threadId: typeof n.threadId === "string" ? n.threadId : undefined,
    }));

    // Ensure all edges have required fields, valid types, and reference existing nodes
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges: ReasoningEdge[] = data.edges
      .map((e: Partial<ReasoningEdge>, i: number) => ({
        id: typeof e.id === "string" ? e.id : `E${i}`,
        from: typeof e.from === "string" ? e.from : "",
        to: typeof e.to === "string" ? e.to : "",
        type: (typeof e.type === "string" && VALID_EDGE_TYPES.has(e.type)) ? e.type as ReasoningEdgeType : "causes",
        label: typeof e.label === "string" ? e.label.slice(0, 100) : undefined,
      }))
      .filter((e: ReasoningEdge) => e.from && e.to && nodeIds.has(e.from) && nodeIds.has(e.to));

    return {
      nodes,
      edges,
      expansionName: directive ? directive.slice(0, 50) : "World Expansion",
      summary: typeof data.summary === "string" ? data.summary.slice(0, 500) : "Reasoning graph for world expansion",
    };
  } catch (err) {
    logError("Failed to parse expansion reasoning graph", err, {
      source: "world-expansion",
      operation: "expansion-reasoning-graph-parse",
      details: { directivePreview: directive ? directive.slice(0, 80) : null },
    });
    // Return minimal fallback
    return {
      nodes: [
        {
          id: "R1",
          index: 0,
          type: "reasoning",
          label: "Expansion reasoning failed",
          detail: String(err),
        },
      ],
      edges: [],
      expansionName: directive ? directive.slice(0, 50) : "World Expansion",
      summary: "Failed to generate expansion reasoning graph",
    };
  }
}

// ── Coordination Plan Generation ─────────────────────────────────────────────

import type {
  CoordinationPlan,
  CoordinationNode,
  CoordinationEdge,
  CoordinationNodeType,
  ThreadStatusTarget,
  ArcForceMode,
} from "@/types/narrative";

/**
 * Valid coordination node types. Must include every `CoordinationNodeType`
 * member — sanitization silently retypes unknown types to "reasoning", so a
 * missing entry here "disguises" nodes of that type in rendered plans.
 */
export const VALID_COORDINATION_NODE_TYPES = new Set<CoordinationNodeType>([
  "fate",
  "character",
  "location",
  "artifact",
  "system",
  "reasoning",
  "pattern",
  "warning",
  "chaos",      // Outside-force agent — spawns new entities / new fates
  "peak",       // Structural peak — forces converge, thread culminates; arc anchors here
  "valley",     // Structural valley — turning point, tension seeded; can anchor arcs
  "moment",     // Key beat in the plan that isn't a peak or valley
]);

/** Thread target with status and optional timing */
export type ThreadTarget = {
  threadId: string;
  /** Target status the thread should reach */
  targetStatus: "resolved" | "subverted" | "critical" | "escalating" | "active" | "unanswered";
  /** When in the plan this should happen */
  timing?: "early" | "mid" | "late" | "final";
};

/**
 * Force preference for a generation. Biases the LLM toward a particular
 * force category as the arc/plan's prime mover. Default is "balanced".
 *  - balanced: let the content decide — no bias
 *  - fate: favour thread-driven arcs (internal pressure, resolutions)
 *  - world: favour entity-driven arcs (character/location/artifact development)
 *  - system: favour mechanic-driven arcs (world rules, constraints, physics)
 *  - chaos: favour outside-force arcs (new entities / new fates via chaos)
 */
export type ForcePreference =
  | "balanced"
  | "fate"
  | "world"
  | "system"
  | "chaos";

/** Guidance for which threads should reach which states */
export type PlanGuidance = {
  /** Thread targets with status and timing */
  threadTargets?: ThreadTarget[];
  /** Arc target — exact number of arcs to plan */
  arcTarget?: number;
  /** Direction — coordinates end fate goals that should be achieved */
  direction?: string;
  /** Constraints — what must NOT happen, restrictions on the narrative */
  constraints?: string;
  /**
   * Which force category to bias the plan toward. Default "balanced".
   * When "chaos", chaos is elevated from sparingly-used deus-ex-machina
   * to a primary creative engine driving the story through novelty.
   */
  forcePreference?: ForcePreference;
  /**
   * Reasoning effort for this single generation. Overrides the narrative's
   * default storySettings.reasoningLevel when provided. "small" | "medium"
   * | "large" map to low / medium / high REASONING_BUDGETS.
   */
  reasoningLevel?: "small" | "medium" | "large";
};

/**
 * Generate a coordination plan for multiple arcs using backward induction.
 * The plan uses terminal states (thread endings) as anchors and works backwards
 * to derive waypoints and arc requirements.
 */
export async function generateCoordinationPlan(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  guidance: PlanGuidance,
  onReasoning?: (token: string) => void,
): Promise<CoordinationPlan> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  // Get timeline-scoped state for accurate knowledge
  const timelineState = getStateAtIndex(narrative, resolvedKeys, currentIndex);

  // Analyze current thread states
  const threads = Object.values(narrative.threads);
  const threadSummary = threads
    .filter((t) => !["resolved", "subverted", "abandoned"].includes(t.status))
    .map((t) => {
      const participantNames = t.participants.map(p => {
        if (p.type === "character") return narrative.characters[p.id]?.name ?? p.id;
        if (p.type === "location") return narrative.locations[p.id]?.name ?? p.id;
        if (p.type === "artifact") return narrative.artifacts?.[p.id]?.name ?? p.id;
        return p.id;
      }).join(", ");
      // Include thread log momentum
      const logNodes = Object.values(t.threadLog?.nodes ?? {});
      const recentLog = logNodes.slice(-3).map(n => n.content).join(" → ");
      const momentum = recentLog ? ` | momentum: ${recentLog}` : "";
      return `- [${t.id}] "${t.description}" — status: ${t.status}, participants: ${participantNames}${momentum}`;
    })
    .join("\n");

  // Key characters with continuity knowledge
  const keyCharacters = Object.values(narrative.characters)
    .filter((c) => c.role === "anchor" || c.role === "recurring")
    .slice(0, 10);

  const characters = keyCharacters
    .map((c) => {
      // Get character's accumulated knowledge
      const knowledgeNodes = Object.values(c.world.nodes)
        .filter(kn => timelineState.liveNodeIds.has(kn.id))
        .slice(-5); // Last 5 knowledge items
      const knowledge = knowledgeNodes.map(kn => kn.content).join("; ");
      const knowledgeStr = knowledge ? `\n    Knowledge: ${knowledge}` : "";
      return `- [${c.id}] ${c.name} (${c.role})${knowledgeStr}`;
    })
    .join("\n");

  // Key locations with continuity
  const keyLocations = Object.values(narrative.locations)
    .filter((l) => l.prominence === "domain" || l.prominence === "place")
    .slice(0, 8);

  const locations = keyLocations
    .map((l) => {
      const knowledgeNodes = Object.values(l.world.nodes)
        .filter(kn => timelineState.liveNodeIds.has(kn.id))
        .slice(-3);
      const knowledge = knowledgeNodes.map(kn => kn.content).join("; ");
      const knowledgeStr = knowledge ? ` — ${knowledge}` : "";
      return `- [${l.id}] ${l.name}${knowledgeStr}`;
    })
    .join("\n");

  // Key relationships with valence
  const keyCharacterIds = new Set(keyCharacters.map(c => c.id));
  const relationships = timelineState.relationships
    .filter(r => keyCharacterIds.has(r.from) && keyCharacterIds.has(r.to))
    .slice(0, 15)
    .map(r => {
      const fromName = narrative.characters[r.from]?.name ?? r.from;
      const toName = narrative.characters[r.to]?.name ?? r.to;
      const valenceLabel = r.valence <= -0.5 ? "hostile"
        : r.valence <= -0.1 ? "tense"
        : r.valence >= 0.5 ? "allied"
        : r.valence >= 0.1 ? "friendly"
        : "neutral";
      return `- ${fromName} → ${toName}: ${r.type} (${valenceLabel})`;
    })
    .join("\n");

  // System knowledge graph — principles, systems, constraints, tensions
  const keysUpToCurrent = resolvedKeys.slice(0, currentIndex + 1);
  const systemGraph = buildCumulativeSystemGraph(
    narrative.scenes, keysUpToCurrent, keysUpToCurrent.length - 1, narrative.worldBuilds,
  );
  const systemNodes = Object.values(systemGraph.nodes);
  const principles = systemNodes.filter(n => n.type === "principle").slice(0, 5);
  const systems = systemNodes.filter(n => n.type === "system").slice(0, 5);
  const constraints = systemNodes.filter(n => n.type === "constraint").slice(0, 4);
  const tensions = systemNodes.filter(n => n.type === "tension").slice(0, 4);

  const systemKnowledgeLines: string[] = [];
  if (principles.length > 0) {
    systemKnowledgeLines.push(`  Principles: ${principles.map(n => n.concept).join("; ")}`);
  }
  if (systems.length > 0) {
    systemKnowledgeLines.push(`  Systems: ${systems.map(n => n.concept).join("; ")}`);
  }
  if (constraints.length > 0) {
    systemKnowledgeLines.push(`  Constraints: ${constraints.map(n => n.concept).join("; ")}`);
  }
  if (tensions.length > 0) {
    systemKnowledgeLines.push(`  Tensions: ${tensions.map(n => n.concept).join("; ")}`);
  }
  const systemKnowledge = systemKnowledgeLines.length > 0
    ? systemKnowledgeLines.join("\n")
    : "";

  // Key artifacts with capabilities
  const artifacts = Object.values(narrative.artifacts ?? {})
    .filter(a => a.significance === "key" || a.significance === "notable")
    .slice(0, 6)
    .map(a => {
      const owner = timelineState.artifactOwnership[a.id] ?? a.parentId;
      const ownerName = owner ? resolveEntityName(narrative, owner) : "world";
      const capabilityNodes = Object.values(a.world.nodes)
        .filter(kn => timelineState.liveNodeIds.has(kn.id))
        .slice(-3);
      const capabilities = capabilityNodes.map(kn => kn.content).join("; ");
      const capStr = capabilities ? ` — ${capabilities}` : "";
      return `- [${a.id}] ${a.name} (${a.significance}, held by ${ownerName})${capStr}`;
    })
    .join("\n");

  // Recent scene summaries (last 8 scenes for context)
  const recentScenes = keysUpToCurrent
    .slice(-8)
    .map(k => {
      const entry = resolveEntry(narrative, k);
      if (entry?.kind !== "scene") return null;
      const povName = narrative.characters[entry.povId]?.name ?? entry.povId;
      const locName = narrative.locations[entry.locationId]?.name ?? entry.locationId;
      return `- [${povName} @ ${locName}] ${entry.summary}`;
    })
    .filter(Boolean)
    .join("\n");

  // Build thread targets section with status and timing
  const threadTargetsSection = guidance.threadTargets?.length
    ? `THREAD TARGETS:\n${guidance.threadTargets.map(t => {
        const thread = narrative.threads[t.threadId];
        const desc = thread?.description ?? t.threadId;
        const timingLabel = t.timing === "early" ? " [early — arcs 1-2]"
          : t.timing === "mid" ? " [mid — middle arcs]"
          : t.timing === "late" ? " [late — near end]"
          : t.timing === "final" ? " [final arc]"
          : "";
        return `- [${t.threadId}] ${desc} → ${t.targetStatus.toUpperCase()}${timingLabel}`;
      }).join("\n")}`
    : "";

  // Arc target — exact number of arcs to plan (default 5)
  const arcTarget = guidance.arcTarget ?? 5;
  const activeThreadCount = threads.filter(t => !["resolved", "subverted", "abandoned"].includes(t.status)).length;
  const nodeGuidance = getPlanNodeGuidance(
    arcTarget,
    activeThreadCount,
    reasoningScale(guidance.reasoningLevel),
  );
  const userDirection = guidance.direction ? `\nDIRECTION (end fate goals to achieve):\n${guidance.direction}` : "";
  const userConstraints = guidance.constraints ? `\nCONSTRAINTS (what must NOT happen):\n${guidance.constraints}` : "";

  // Get patterns and anti-patterns
  const patterns = narrative.patterns ?? [];
  const antiPatterns = narrative.antiPatterns ?? [];

  const patternsSection = patterns.length > 0
    ? `STORY PATTERNS (positive commandments):\n${patterns.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
    : "";

  const antiPatternsSection = antiPatterns.length > 0
    ? `ANTI-PATTERNS (pitfalls to avoid):\n${antiPatterns.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
    : "";

  const prompt = `${ctx}

## NARRATIVE STATE

ACTIVE THREADS (compelling questions the story must answer):
${threadSummary || "No active threads"}

KEY CHARACTERS (with accumulated knowledge):
${characters || "None"}

KEY LOCATIONS:
${locations || "None"}

${relationships ? `KEY RELATIONSHIPS:\n${relationships}\n` : ""}
${systemKnowledge ? `SYSTEM KNOWLEDGE:\n${systemKnowledge}\n` : ""}
${artifacts ? `KEY ARTIFACTS:\n${artifacts}\n` : ""}
${recentScenes ? `RECENT STORY (what just happened):\n${recentScenes}\n` : ""}
${patternsSection}

${antiPatternsSection}

## PLAN REQUIREMENTS

${threadTargetsSection}
${userDirection}
${userConstraints}

ARC TARGET: ${arcTarget} arcs (plan exactly this many arcs)
${forcePreferenceBlock("plan", guidance.forcePreference)}
## TASK

Build a COORDINATION PLAN using BACKWARD INDUCTION, organised around the narrative's STRUCTURAL SPINE.

The spine is the sequence of **peaks** (where forces converge, threads culminate, the story commits) and **valleys** (turning points where tension is seeded and the arc pivots into the next movement). Peaks and valleys are complementary: peaks are where the story lands, valleys are where it launches. Both are load-bearing — a story of only peaks is exhausting; a story of only valleys is all setup and no payoff.

1. Identify the SPINE — one **peak** OR one **valley** per arc, whichever is the arc's structural anchor. That anchor carries arcIndex and sceneCount (3-12). Do NOT set forceMode — it is DERIVED from each arc's node composition after generation:
   - **fate-dominant** — fate nodes + thread-bearing spine nodes dominate (the arc is driven by internal thread pressure)
   - **world-dominant** — character/location/artifact nodes dominate (the arc is driven by existing entities)
   - **system-dominant** — system nodes dominate (the arc is driven by world rules or mechanics)
   - **chaos-dominant** — chaos nodes dominate (the arc is driven by outside forces — HP's troll arc, HP's Norbert arc)
   - **balanced** — no single category dominates
2. Add **moments** — any other beat worth calling out at plan level (thread escalations, setpieces, reveals) that isn't itself the arc's peak or valley.
3. Work BACKWARDS from end-state peaks to derive the valleys and moments needed to earn them.
4. Determine OPTIMAL ARC COUNT — may be fewer than budget if the spine is coherent sooner.
5. Assign every node to an ARC SLOT.
6. Seed **chaos** nodes where the plan genuinely needs new entities — a fresh character, location, artifact, or thread that doesn't yet exist. The scene generator will honour chaos nodes by invoking world expansion when their arc arrives.

The plan orchestrates multiple arcs WITHOUT micromanaging. Each arc gets its own reasoning graph later; this plan sets trajectory through the peak/valley rhythm.

**EFFICIENCY PRINCIPLE**: If the spine closes in fewer arcs than the budget, use fewer arcs. Don't pad to fill.

## CREATIVE MANDATE

**Real stories evolve non-deterministically.** Do NOT simply continue existing trajectories. The context above is INSPIRATION, not a script to follow.

**REQUIREMENTS FOR CREATIVITY**:
1. **UNEXPECTED COMBINATIONS**: What happens when two unrelated elements collide? Combine characters, locations, or systems that have never interacted.
2. **EMERGENT PROPERTIES**: When X meets Y, what NEW capability or dynamic emerges that neither had alone?
3. **SUBVERT EXPECTATIONS**: For each thread, consider: what's the LEAST obvious path to resolution? The most surprising twist that still feels inevitable in hindsight?
4. **HIDDEN CONNECTIONS**: What relationships or dependencies exist that haven't been made explicit? What's the second-order effect of recent events?
5. **WORLD EXPANSION**: What aspects of the world are implied but unexplored? What's beyond the current sandbox?
6. **COST AND SACRIFICE**: What must be LOST to achieve each goal? Every gain should have a price that creates new tensions.

**ANTI-PATTERNS TO AVOID**:
- Continuing threads on their "obvious" trajectory
- Resolving tensions through expected mechanisms
- Using the same character combinations repeatedly
- Keeping the world static while only threads change
- Making progress without setbacks or costs

## ARC SIZING GUIDE

Each arc should be sized based on what its peak or valley anchor needs:

- **3-4 scenes (short)**: Valley-anchored pivots, quick transitions, aftermath beats
- **5-6 scenes (standard)**: Most arcs — a single peak or valley with supporting moments
- **7-9 scenes (extended)**: Major peaks where multiple threads converge, climactic sequences
- **10-12 scenes (epic)**: Act finales, massive setpieces, resolution of multiple threads

Consider:
- Peak-anchored arcs (convergence, resolution) typically need more scenes to earn the peak
- Valley-anchored arcs (pivot, seeding) tend to be shorter — they launch, they don't land
- World-dominant arcs tend to be shorter; fate-dominant arcs need enough scenes for proper payoff
- The total scene count across all arcs should feel appropriate for the story scope

## OUTPUT FORMAT

Return a JSON object with RICH, DIVERSE nodes. Example showing all node types working together:

**CRITICAL FORMAT REQUIREMENTS**:
- **IDs**: Use SHORT, SIMPLE alphanumeric IDs: PK1, V1, M1, R1, C1, F1, L1, AR1, S1, WN1, etc. Do NOT use complex IDs like "PEAK_ARC2_T03" or "THREAD_RESOLVE_01".
- **Labels**: Must be PROPER ENGLISH descriptions (3-10 words). Describe what happens in natural language. NOT technical identifiers or codes.

{
  "summary": "1-2 sentence high-level plan summary grounded in specific world details",
  "arcCount": <number of arcs>,
  "nodes": [
    // ═══════════════════════════════════════════════════════════════
    // SPINE: peaks, valleys, and moments (one peak OR valley anchors each arc)
    // ═══════════════════════════════════════════════════════════════
    // PEAK that anchors an arc — carries arcIndex and sceneCount ONLY.
    // forceMode is DERIVED later from the arc's node mix. Don't set it.
    // The peak is the arc's structural commitment: forces converge, a thread culminates.
    {"id": "PK1", "index": 10, "type": "peak", "label": "The Glacier Confrontation", "detail": "WHY this arc needs N scenes — which forces converge and which thread culminates", "threadId": "thread-id", "targetStatus": "resolved", "arcIndex": 1, "sceneCount": 6, "arcSlot": 1},
    // VALLEY that anchors an arc — also carries arc metadata. A valley arc pivots rather than resolves: tension is seeded, a boundary is crossed.
    {"id": "V1", "index": 20, "type": "valley", "label": "Bai Ning Bing enters the inheritance", "detail": "WHY this pivot is necessary before the next peak — what new tension is seeded", "threadId": "thread-id", "targetStatus": "escalating", "arcIndex": 2, "sceneCount": 4, "arcSlot": 2},
    // MOMENTS — plan-level beats that matter but aren't the arc's anchor.
    // Thread escalation moment (not the arc's peak/valley, but worth flagging):
    {"id": "M1", "index": 1, "type": "moment", "label": "Fang Yuan uncovers the clan's betrayal", "detail": "WHY this intermediate beat matters for the next peak", "threadId": "thread-id", "targetStatus": "escalating", "arcSlot": 1},
    // Setpiece moment:
    {"id": "M2", "index": 2, "type": "moment", "label": "Gu master's tomb first glimpsed", "detail": "Plants information or raises stakes for a later peak", "arcSlot": 1},
    // CHAOS — outside-force injection (new character / location / artifact /
    // thread that didn't exist). Don't set entityId or threadId.
    {"id": "CH1", "index": 17, "type": "chaos", "label": "A rival scholar arrives from a hidden order", "detail": "Spawned via world expansion — introduces a new character whose knowledge unblocks the Glacier approach", "arcSlot": 3},

    // ═══════════════════════════════════════════════════════════════
    // FATE NODES: thread pressure throughout the plan
    // ═══════════════════════════════════════════════════════════════
    {"id": "F1", "index": 2, "type": "fate", "label": "Survival thread demands immediate action", "detail": "How this thread's momentum shapes Arc 1 — reference thread log momentum", "threadId": "thread-id", "arcSlot": 1},

    // ═══════════════════════════════════════════════════════════════
    // CHARACTER NODES: WHO drives the plan (reference specific knowledge)
    // ═══════════════════════════════════════════════════════════════
    {"id": "C1", "index": 3, "type": "character", "label": "Fang Yuan knows the Gu's location", "detail": "Reference their accumulated knowledge from context — 'knows X, therefore can Y'", "entityId": "char-id", "arcSlot": 1},
    {"id": "C2", "index": 4, "type": "character", "label": "Bai Ning Bing's ambition forces confrontation", "detail": "Their relationship with another character constrains options", "entityId": "char-id", "arcSlot": 2},

    // ═══════════════════════════════════════════════════════════════
    // LOCATION NODES: WHERE things must happen (reference continuity)
    // ═══════════════════════════════════════════════════════════════
    {"id": "L1", "index": 5, "type": "location", "label": "The Glacier's isolation enables secrecy", "detail": "Reference location's specific history or significance", "entityId": "loc-id", "arcSlot": 2},

    // ═══════════════════════════════════════════════════════════════
    // ARTIFACT NODES: items that shape outcomes (reference capabilities)
    // ═══════════════════════════════════════════════════════════════
    {"id": "AR1", "index": 6, "type": "artifact", "label": "Spring Autumn Cicada enables time manipulation", "detail": "Reference specific capabilities from context", "entityId": "artifact-id", "arcSlot": 3},

    // ═══════════════════════════════════════════════════════════════
    // SYSTEM NODES: world rules that constrain (reference principles/systems/constraints)
    // ═══════════════════════════════════════════════════════════════
    {"id": "S1", "index": 7, "type": "system", "label": "Gu feeding rules require specific resources", "detail": "Reference specific principle/system/constraint from WORLD KNOWLEDGE", "arcSlot": 1},
    {"id": "S2", "index": 8, "type": "system", "label": "Clan hierarchy prevents direct challenge", "detail": "Reference specific tension that can be exploited", "arcSlot": 3},

    // ═══════════════════════════════════════════════════════════════
    // REASONING NODES: causal chains (THE BACKBONE — use extensively)
    // ═══════════════════════════════════════════════════════════════
    {"id": "R1", "index": 9, "type": "reasoning", "label": "Resolution requires securing the inheritance first", "detail": "Backward induction step — reference specific system knowledge or relationships", "arcSlot": 2},
    {"id": "R2", "index": 11, "type": "reasoning", "label": "Inheritance access requires Fang Yuan's knowledge", "detail": "Connect plot point to character agency", "arcSlot": 1},
    {"id": "R3", "index": 12, "type": "reasoning", "label": "Gu feeding rules constrain the timing", "detail": "Connect character to system rule", "arcSlot": 1},
    {"id": "R4", "index": 13, "type": "reasoning", "label": "Glacier setting enables private confrontation", "detail": "Connect constraint to location", "arcSlot": 2},

    // ═══════════════════════════════════════════════════════════════
    // PATTERN NODES: creative expansion (inject novelty and emergence)
    // ═══════════════════════════════════════════════════════════════
    {"id": "PT1", "index": 14, "type": "pattern", "label": "Two rivals discover shared enemy", "detail": "What EMERGENT property arises when these unrelated elements interact?"},
    {"id": "PT2", "index": 15, "type": "pattern", "label": "Recent victory hides a hidden cost", "detail": "Second-order effect: what does X actually mean for Y that no one has realized?"},
    {"id": "PT3", "index": 16, "type": "pattern", "label": "Rumors of ancient Gu master's tomb", "detail": "What exists at the edge of the known world? New faction, location, or system implied but unexplored"},

    // ═══════════════════════════════════════════════════════════════
    // WARNING NODES: subvert predictability (challenge the obvious path)
    // ═══════════════════════════════════════════════════════════════
    {"id": "WN1", "index": 17, "type": "warning", "label": "Alliance is too convenient—needs betrayal", "detail": "What's the LEAST obvious resolution that still feels inevitable? Subvert this."},
    {"id": "WN2", "index": 18, "type": "warning", "label": "Protagonist winning too easily", "detail": "What assumption should be challenged? What cost hasn't been paid?"}
  ],
  "edges": [
    // Dense connections showing causal flow through the spine
    {"id": "e1", "from": "PK1", "to": "R1", "type": "requires"},
    {"id": "e2", "from": "R1", "to": "V1", "type": "requires"},
    {"id": "e3", "from": "V1", "to": "M1", "type": "develops"},
    {"id": "e4", "from": "M1", "to": "R2", "type": "requires"},
    {"id": "e5", "from": "R2", "to": "C1", "type": "requires"},
    {"id": "e6", "from": "S1", "to": "R3", "type": "constrains"},
    {"id": "e7", "from": "R3", "to": "C1", "type": "constrains"},
    {"id": "e8", "from": "R4", "to": "L1", "type": "enables"},
    {"id": "e9", "from": "F1", "to": "PK1", "type": "constrains"},
    {"id": "e10", "from": "AR1", "to": "R4", "type": "enables"},
    {"id": "e11", "from": "C2", "to": "V1", "type": "causes"},
    {"id": "e12", "from": "M2", "to": "PK1", "type": "develops"}
  ]
}

## NODE TYPES (all must be grounded in SPECIFIC context from above)

**FORMAT RULES (CRITICAL)**:
- **IDs**: Short alphanumeric codes only: PK1, V1, M1, R1, C1, F1, L1, AR1, S1, PT1, WN1, etc.
  - GOOD: "PK1", "V2", "M3", "R1", "C2", "PT1"
  - BAD: "PEAK_ARC2_T03", "THREAD_RESOLVE", "peak_resolution_1"
- **Labels**: Natural English phrases (3-10 words) describing WHAT happens.
  - GOOD: "Fang Yuan discovers the hidden tomb", "Alliance fractures over resource dispute"
  - BAD: "Peak node", "PK2_ESCALATE", "resolution mechanism"

**SPINE NODES** (structural skeleton — peaks, valleys, moments):
- **peak**: A scene where forces converge and a thread culminates — the story commits. Label: the concrete event (e.g., "The clan elder reveals the betrayal").
  - If this peak ANCHORS an arc: set arcIndex, sceneCount (3-12), and arcSlot = arcIndex. Detail: WHY N scenes and which forces converge.
  - May also carry threadId + targetStatus (resolved/subverted/critical) for the thread that culminates here.
- **valley**: A turning point where tension is seeded and the arc pivots — the story launches. Label: the pivot (e.g., "Bai Ning Bing crosses into the inheritance").
  - If this valley ANCHORS an arc: set arcIndex, sceneCount, and arcSlot. Detail: WHAT tension is seeded and WHICH boundary is crossed.
  - May carry threadId + targetStatus (typically escalating/active) for a thread the valley pivots.
- **moment**: A plan-level beat that isn't the arc's peak or valley but is worth flagging — thread escalation, setpiece, reveal, setup planted for a later payoff. Has arcSlot, may carry threadId + targetStatus. DOES NOT carry arcIndex or sceneCount.

**SPINE RULE (CRITICAL)**: Exactly ONE peak OR valley per arc carries the arc's arcIndex and sceneCount. Everything else worth mentioning at plan level is a moment. Do not mark two peaks for the same arc, and do not mark moments with arcIndex.

**FORCE MODE (DERIVED, NOT SET)**: Do NOT write forceMode in any node. It is computed from each arc's node mix:
- Fate + thread-bearing spine nodes dominant ⇒ **fate-dominant**
- Character + location + artifact dominant ⇒ **world-dominant**
- System dominant ⇒ **system-dominant**
- **Chaos dominant ⇒ chaos-dominant** — outside forces drive the arc
- No single category dominant ⇒ **balanced**

Shape an arc's force character through its node composition: a fate-dominant arc needs more fate nodes; a chaos-dominant arc (e.g., the troll-in-the-dungeon) needs a chaos node as its prime mover plus supporting reasoning about how the cast responds.

**FATE NODES** (thread pressure):
- **fate**: Thread pressure on specific arcs. Has threadId, arcSlot. Label: what the thread demands in plain English (e.g., "Survival thread demands sanctuary").

**ENTITY NODES** (grounding in specific system knowledge — USE ALL OF THESE):
- **character**: WHO drives this transition. MUST have entityId. Label: character + their key action/knowledge (e.g., "Fang Yuan exploits his memory of the future").
- **location**: WHERE things must happen. MUST have entityId. Label: location + what it enables (e.g., "The Glacier's isolation enables secret negotiation").
- **artifact**: WHAT item shapes outcomes. MUST have entityId. Label: artifact + its role (e.g., "Spring Autumn Cicada enables time reversal").
- **system**: HOW world rules constrain. Label: the rule stated plainly (e.g., "Gu worms require regular feeding to survive").

**REASONING NODES** (causal chains — THE BACKBONE, use extensively):
- **reasoning**: Logical step in backward induction. Has arcSlot. Label: the inference in plain English (e.g., "Resolution requires controlling the inheritance first"). Detail: explain WHY this follows.

**CREATIVE AGENT NODES** (inject novelty and subvert expectations):
- **pattern**: EXPANSION AGENT. Combine existing entities in unexpected ways. Label: the opportunity in plain English (e.g., "Two rivals discover a common enemy").
- **warning**: SUBVERSION AGENT. Flag predictable paths and unpaid costs. Label: the risk (e.g., "Victory is coming too easily—needs setback").
- **chaos**: OUTSIDE FORCE — operates outside the existing fabric of fate, world, and system. Chaos has two faces: **deus-ex-machina** (brings an unexpected problem the cast must solve, or an unexpected solution the cast couldn't build — a troll crashes into the dungeon, a stranger arrives with the missing clue, a dormant artefact wakes), and **creative engine** (seeds new fate — opens threads that didn't exist, which later arcs develop and resolve). Balance is the key: a plan with a couple of chaos moments is alive; a plan without any is inert; a plan of nothing but chaos has no spine to hold onto. An arc can be CHAOS-ANCHORED when its core movement comes from outside the established world (HP's troll-in-the-dungeon and Norbert arcs are chaos-anchored; the welcoming feast is world-driven; the Quirrell climax is fate-driven). Label: what arrives and its role. DO NOT set entityId or threadId — the entity/thread is spawned via world expansion. Remember: chaos sits outside fate, but it SHAPES fate by creating new strands.

## EDGE TYPES

- **requires**: A depends on B
- **enables**: A makes B possible
- **constrains**: A limits B
- **causes**: A leads to B
- **develops**: A deepens B
- **resolves**: A concludes B

## REQUIREMENTS

1. **Backward induction**: Start from the final peak and work backwards — which valleys seed it, which moments carry it, which earlier peak made it possible.
2. **Arc count**: Plan exactly ${arcTarget} arcs
3. **Arc slots**: Every node (except pattern/warning) needs arcSlot (1-N) indicating when it's relevant
4. **CHRONOLOGICAL INDEXING**: Node indexes MUST be chronological by arc — Arc 1 nodes get indexes 0-N, Arc 2 nodes get N+1 to M, etc. Within each arc, order by causal flow.
5. **Progressive revelation**: Nodes with arcSlot > currentArc are hidden from arc generation
6. **One spine anchor per arc**: Exactly ${arcTarget} anchor nodes total. Each is a peak OR a valley (not both for the same arc) with arcIndex and sceneCount. Peak-anchor vs valley-anchor depends on whether the arc commits or pivots.
7. **Deliberate arc sizing**: Each anchor MUST have sceneCount (3-12) with reasoning in detail explaining WHY that length.
8. **Force rhythm via composition**: Shape each arc's force character through node mix — more fate nodes for a fate-dominant arc, more entities for a world-dominant arc, more system nodes for a system-dominant arc. Don't write forceMode; vary node composition.
9. **Peak/valley rhythm**: A plan of all peaks is exhausting; a plan of all valleys is all setup. Aim for alternation — roughly ~60/40 mix, with the final arc typically peak-anchored.
10. **Thread trajectories**: Each thread needs spine nodes (peaks for resolutions/culminations, valleys for pivots, moments for intermediate escalations) showing its progression.
11. **Chaos present**: Include chaos nodes where the plan benefits from something the existing world cannot produce — a fresh character arriving, a hidden location surfacing, a dormant artifact waking, a new thread emerging. Chaos nodes have arcSlot but NO entityId/threadId.
12. **Causal complexity**: The graph must represent the REAL causal complexity of the plan. Story causation is a web — threads pull on many things at once, entities influence multiple reasoning lines, rules constrain several choices. Every time you add a node, consider what it connects TO and what connects INTO it. If a node only touches the story at one point, you're missing how it actually matters.
13. **Every entity, fully connected**: When a character, location, artifact, or system genuinely shapes the plan, show all the places it shapes. Capture the full role, not just one role.
14. **Pacing balance**: Mix arc sizes — not all arcs should be the same length
15. **GROUNDED REASONING**: Reference specific character knowledge, relationships, artifacts, or world rules in reasoning nodes
16. **CHARACTER AGENCY**: Include character nodes that show WHO drives each major transition
17. **SYSTEM CONSTRAINTS**: Include system nodes that show HOW world rules shape outcomes

## NODE COUNT TARGETS (MANDATORY MINIMUMS)

For this ${arcTarget}-arc plan with ${activeThreadCount} active threads, target **at least ${nodeGuidance.totalMin} nodes** across all types.

**Spine nodes** (peaks + valleys + moments):
- **Total spine nodes**: At least ${nodeGuidance.minSpineNodes} (one anchor per arc + thread progressions + supporting moments)
- **Arc anchors**: Exactly ${arcTarget} total — a mix of peaks and valleys, each with arcIndex and sceneCount
- **Moments**: Use freely — every thread needs 2-3 moment nodes showing its progression between peaks

**Reasoning backbone**:
- **Reasoning nodes**: At least ${nodeGuidance.minReasoningNodes}

**Entity grounding** (use all four types):
- **Character nodes**: At least ${nodeGuidance.minCharacterNodes}
- **Location nodes**: At least ${nodeGuidance.minLocationNodes}
- **Artifact nodes**: At least ${nodeGuidance.minArtifactNodes} (if artifacts exist in context)
- **System nodes**: At least ${nodeGuidance.minSystemNodes}

**Agent nodes**:
- **Pattern nodes**: At least ${nodeGuidance.minPatterns} — COOPERATIVE agent encouraging variety
- **Warning nodes**: At least ${nodeGuidance.minWarnings} — ADVERSARIAL agent preventing staleness
- **Chaos nodes**: At least ${nodeGuidance.minChaos} — outside-force injections spawning new entities or new fates (HP had troll, Norbert, mirror, Fluffy). DO NOT set entityId or threadId on chaos nodes.

## PER-ARC BALANCE (CRITICAL)

**Each arc must have meaningful reasoning.** Variation is natural, but avoid extreme disparities.

**Per-arc guidelines**:
- Early/mid arcs: 5-10 nodes each (setup, plot points, reasoning chains)
- Late arcs: 4-8 nodes each (convergence, escalation)
- Final arc: 3-6 nodes minimum (resolution plot points, final reasoning)

**Allowed variation**: Arc 1 having 8 nodes while Arc 3 has 6 is fine.
**Not allowed**: Arc 1 having 15 nodes while Arc 5 has 2 (extreme disparity).

**Bad (front-loaded)**:
- Arc 1: 15 nodes, Arc 2: 8 nodes, Arc 3: 4 nodes, Arc 4: 3 nodes, Arc 5: 2 nodes

**Good (balanced with natural variation)**:
- Arc 1: 8 nodes, Arc 2: 7 nodes, Arc 3: 6 nodes, Arc 4: 7 nodes, Arc 5: 5 nodes

## SHAPE OF A GOOD PLAN

A coordination plan is a **causal reasoning diagram**, not a proof outline. It represents how the story actually works: peaks don't just follow from one cause — they converge from several. Entities don't appear once — they matter in multiple places. Threads don't run straight — they pull on other threads and get pulled by systems and chaos.

A plan that looks like a vertical list of nodes each with a single cause and a single effect is failing to capture the story's complexity. A good plan has entities that are shared substrate across arcs, peaks that are the convergence of multiple setups, and threads that interact with rules, locations, and each other.

When you finish, scan the graph: do the key characters appear once and connect to several things? Does each peak feel like several pressures coming together? Or does every node live in isolation on a single line? If the latter, the plan is under-representing the story.

Return ONLY the JSON object.`;

  const reasoningBudget = defaultReasoningBudget(narrative);

  const raw = onReasoning
    ? await callGenerateStream(
        prompt,
        SYSTEM_PROMPT,
        () => {}, // No token streaming for main output
        undefined,
        "generateCoordinationPlan",
        undefined,
        reasoningBudget,
        onReasoning,
      )
    : await callGenerate(
        prompt,
        SYSTEM_PROMPT,
        undefined,
        "generateCoordinationPlan",
        undefined,
        reasoningBudget,
      );

  // Parse and validate (parseJson handles markdown fences)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = parseJson(raw, "generateCoordinationPlan") as any;

    const arcCount = typeof data.arcCount === "number" ? data.arcCount : arcTarget;

    // Validate and sanitize nodes
    const nodes: CoordinationNode[] = (data.nodes ?? [])
      .filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (n: any) =>
          typeof n.id === "string" &&
          typeof n.index === "number" &&
          typeof n.type === "string" &&
          typeof n.label === "string",
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((n: any) => ({
        id: n.id.slice(0, 20),
        index: n.index, // Will be reindexed below
        type: VALID_COORDINATION_NODE_TYPES.has(n.type) ? n.type : "reasoning",
        label: typeof n.label === "string" ? n.label.slice(0, 100) : "",
        detail: typeof n.detail === "string" ? n.detail.slice(0, 300) : undefined,
        entityId: typeof n.entityId === "string" ? n.entityId : undefined,
        threadId: typeof n.threadId === "string" ? n.threadId : undefined,
        targetStatus: typeof n.targetStatus === "string" ? n.targetStatus : undefined,
        arcIndex: typeof n.arcIndex === "number" ? n.arcIndex : undefined,
        sceneCount: typeof n.sceneCount === "number" ? n.sceneCount : undefined,
        forceMode: typeof n.forceMode === "string" ? n.forceMode : undefined,
        arcSlot: typeof n.arcSlot === "number" ? n.arcSlot : undefined,
      }));

    // Reindex nodes chronologically by arcSlot
    // Arc 1 nodes get indexes 0, 1, 2..., Arc 2 continues from there, etc.
    // Global nodes (pattern/warning without arcSlot) go at the end
    const nodesWithArcSlot = nodes.filter(n => n.arcSlot !== undefined);
    const globalNodes = nodes.filter(n => n.arcSlot === undefined);

    // Sort by arcSlot first, then by original index within each arc
    nodesWithArcSlot.sort((a, b) => {
      if (a.arcSlot !== b.arcSlot) return (a.arcSlot ?? 0) - (b.arcSlot ?? 0);
      return a.index - b.index;
    });

    // Reassign indexes chronologically
    let newIndex = 0;
    for (const node of nodesWithArcSlot) {
      node.index = newIndex++;
    }
    for (const node of globalNodes) {
      node.index = newIndex++;
    }

    // Rebuild nodes array in new order (reindexed chronologically by arc)
    const reindexedNodes: CoordinationNode[] = [...nodesWithArcSlot, ...globalNodes];

    // Validate edges
    const nodeIds = new Set(reindexedNodes.map((n) => n.id));
    const edges: CoordinationEdge[] = (data.edges ?? [])
      .filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) =>
          typeof e.id === "string" &&
          typeof e.from === "string" &&
          typeof e.to === "string" &&
          typeof e.type === "string" &&
          VALID_EDGE_TYPES.has(e.type),
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((e: any) => ({
        id: e.id.slice(0, 20),
        from: e.from,
        to: e.to,
        type: e.type as ReasoningEdgeType,
        label: typeof e.label === "string" ? e.label.slice(0, 100) : undefined,
      }))
      .filter((e: CoordinationEdge) => nodeIds.has(e.from) && nodeIds.has(e.to));

    // Build arc partitions — nodes grouped by arcSlot
    const arcPartitions: string[][] = [];
    for (let arc = 1; arc <= arcCount; arc++) {
      // Cumulative: all nodes with arcSlot <= arc
      const partition = reindexedNodes
        .filter((n) => n.arcSlot !== undefined && n.arcSlot <= arc)
        .map((n) => n.id);
      // Also include pattern/warning/chaos agent nodes without arcSlot
      // (creative agents can be global to the plan).
      const globalAgentNodes = reindexedNodes
        .filter(
          (n) =>
            n.arcSlot === undefined &&
            (n.type === "pattern" ||
              n.type === "warning" ||
              n.type === "chaos"),
        )
        .map((n) => n.id);
      arcPartitions.push([...new Set([...partition, ...globalAgentNodes])]);
    }

    const plan: CoordinationPlan = {
      id: `plan-${Date.now()}`,
      nodes: reindexedNodes,
      edges,
      arcCount,
      summary: typeof data.summary === "string" ? data.summary.slice(0, 500) : "Coordination plan",
      arcPartitions,
      currentArc: 0,
      completedArcs: [],
      createdAt: Date.now(),
    };
    // Derive forceMode for each arc anchor from node composition. We don't
    // trust the LLM to label this correctly — it falls out of what was planned.
    return applyDerivedForceModes(plan);
  } catch (err) {
    logError("Failed to parse coordination plan", err, {
      source: "world-expansion",
      operation: "coordination-plan-parse",
    });
    // Return minimal fallback
    return {
      id: `plan-${Date.now()}`,
      nodes: [
        {
          id: "ERR",
          index: 0,
          type: "reasoning",
          label: "Plan generation failed",
          detail: String(err),
        },
      ],
      edges: [],
      arcCount: 1,
      summary: "Failed to generate coordination plan",
      arcPartitions: [["ERR"]],
      currentArc: 0,
      completedArcs: [],
      createdAt: Date.now(),
    };
  }
}

/**
 * Build a sequential path for a specific arc from the coordination plan.
 * Only includes nodes visible to that arc (arcSlot <= arcIndex).
 */
export function buildPlanPathForArc(plan: CoordinationPlan, arcIndex: number): string {
  const visibleNodeIds = new Set(plan.arcPartitions[arcIndex - 1] ?? []);
  const visibleNodes = plan.nodes.filter((n) => visibleNodeIds.has(n.id));
  const visibleEdges = plan.edges.filter(
    (e) => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to),
  );

  // Use the same format as buildSequentialPath
  return buildSequentialPath({ nodes: visibleNodes, edges: visibleEdges });
}
