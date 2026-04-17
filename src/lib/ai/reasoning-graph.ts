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
  // 2.5 × arcTarget + threadCount dominates the simpler 2 × arcTarget
  // at every arc count; keep only the winner.
  const minSpineNodes = s(Math.floor(arcTarget * 2.5) + threadCount);

  // Reasoning backbone — branched, not chained. Each arc needs 3 reasoning
  // nodes, plus 2 per thread for causal cross-arc chains. Floor of 10 so
  // tiny plans still carry a real reasoning backbone.
  const minReasoningNodes = s(
    Math.max(10, arcTarget * 3 + Math.floor(threadCount * 2)),
  );

  // Patterns and warnings — creative agents
  const minPatterns = s(Math.max(2, Math.floor(arcTarget / 2)));
  const minWarnings = s(Math.max(2, Math.floor(arcTarget / 2)));

  // Chaos — baseline 1-2 per plan even when balanced; more under chaos preference
  // (the preference block bumps this further in the prompt itself).
  const minChaos = s(Math.max(1, Math.floor(arcTarget / 4)));

  // Entity grounding — MUST appear (plans without entities are abstract).
  // Character count leans generous so secondary characters get their own
  // causal reasoning, not just protagonist-adjacent appearances.
  const minCharacterNodes = s(Math.max(4, threadCount));
  // Locations scale with arc count — an 8-arc plan with 2 locations is a
  // claustrophobic world. ceil(arcTarget/2) gives 3 for small plans and
  // scales cleanly upward.
  const minLocationNodes = s(Math.max(3, Math.ceil(arcTarget / 2)));
  const minArtifactNodes = s(Math.max(1, Math.floor(arcTarget / 3)));
  // Systems anchor the world's rules. Minimum of 3 so even short plans
  // surface core mechanics; scales with arc count for longer stories.
  const minSystemNodes = s(Math.max(3, Math.floor(arcTarget / 2)));

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
  /** Presentation order — causal/chronological position used for display and downstream consumption. Nodes are sorted and stepped through by this field. */
  index: number;
  /**
   * Generation order — the order in which the reasoner thought of this
   * node (the JSON array position at parse time). Bookkeeping only;
   * `index` is what's used by callers. Differs from `index` in backward
   * modes (abduction/induction) where thinking runs opposite to display.
   */
  generationOrder?: number;
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
  /**
   * Node count the LLM committed to BEFORE generating any nodes. Forces
   * planning — since LLMs emit tokens sequentially, placing this field
   * before `nodes` in the output schema means the LLM must decide how
   * many nodes to think through before it starts thinking. Transient;
   * not persisted to snapshots. Informational — may differ from the
   * final `nodes.length` if the LLM revised mid-generation.
   */
  plannedNodeCount?: number;
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
 * Extract pattern + warning directives from a reasoning graph as
 * actionable guidance for downstream consumers (arc-scene generation,
 * plan-to-arc propagation). Patterns become novel-shape instructions;
 * warnings become repetition-avoidance instructions. Returns empty
 * string when no pattern/warning nodes exist.
 */
export function extractPatternWarningDirectives(
  graph: ReasoningGraphBase,
): string {
  const patterns = graph.nodes.filter((n) => n.type === "pattern");
  const warnings = graph.nodes.filter((n) => n.type === "warning");
  if (patterns.length === 0 && warnings.length === 0) return "";

  const sections: string[] = [];

  if (warnings.length > 0) {
    const warningLines = warnings
      .map((w) => {
        const detail = w.detail ? ` — ${w.detail}` : "";
        return `- ${w.label}${detail}`;
      })
      .join("\n");
    sections.push(
      `REPETITION WARNINGS — the reasoning graph flagged these shapes as already-seen patterns. Do NOT drift toward them in your output. Route around each explicitly:\n${warningLines}`,
    );
  }

  if (patterns.length > 0) {
    const patternLines = patterns
      .map((p) => {
        const detail = p.detail ? ` — ${p.detail}` : "";
        return `- ${p.label}${detail}`;
      })
      .join("\n");
    sections.push(
      `NOVEL PATTERNS — the reasoning graph proposes these shapes as fresh to this narrative. Your output MUST actively introduce them (not merely mention them):\n${patternLines}`,
    );
  }

  sections.push(
    `These are course-corrections, not suggestions. If your output recreates a warned pattern or fails to introduce a proposed pattern, the reasoning graph has been ignored.`,
  );

  return sections.join("\n\n");
}

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

/**
 * Mode of thinking for reasoning-graph generation.
 *
 * - **divergent** (default): "what else could be true from here?" Branches
 *   outward from the current state, expanding the solution space. Forward
 *   and exploratory. Risk: never terminates without external selection.
 * - **deduction**: "if this premise is true, what must follow?" Forward-
 *   simulates necessary consequences from a committed premise. Forward and
 *   deterministic. Risk: only as good as the premise.
 * - **abduction**: "what prior configuration best explains this outcome?"
 *   Reasons backward from a committed terminal state (a fate node) to the
 *   specific prior setup that makes it feel inevitable. Backward and
 *   specific. Risk: post-hoc rationalisation of what the plot needed.
 * - **induction**: "what general pattern explains these observations?"
 *   Reasons backward from multiple observed states to the shared principle
 *   underlying them. Backward and general. Risk: locks onto the first
 *   coherent pattern and stops exploring alternatives.
 */
export type ReasoningMode =
  | "divergent"
  | "deduction"
  | "abduction"
  | "induction";

export type ArcReasoningOptions = {
  /**
   * Which force category to bias this arc toward. Default "freeform"
   * (no bias — LLM picks composition). "chaos" elevates chaos from
   * sparing deus-ex-machina to the arc's primary creative engine.
   */
  forcePreference?: ForcePreference;
  /**
   * Reasoning effort for this generation. Overrides the narrative's
   * storySettings.reasoningLevel. "small" | "medium" | "large" map to
   * low / medium / high REASONING_BUDGETS.
   */
  reasoningLevel?: "small" | "medium" | "large";
  /**
   * How the reasoner thinks. Defaults to "divergent" — branches outward
   * from the current state to expand the solution space. Alternatives:
   * "deduction" (premise → necessary consequence) and "induction"
   * (observation → inferred principle). See ReasoningMode for details.
   */
  reasoningMode?: ReasoningMode;
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
 * Divergent mode — "what else could be true from here?" Branches outward
 * from the current state, expanding the solution space rather than
 * finding one answer. Risk: never terminates without external selection.
 */
const DIVERGENT_MODE_BLOCK = `## MODE OF THINKING — DIVERGENT (branching, solution-space expansion)

Divergent reasoning asks: **what else could be true from here?**

It starts from the current state and branches OUTWARD — generating
multiple possible extensions without committing to any. The goal is
not to find the one correct answer; it is to EXPAND the solution
space so alternatives exist to choose between.

Failure mode to guard against: divergent reasoning can run forever.
Every node you write should either open a new branch or give a
downstream node a reason to exist. If you're not widening the space
or feeding something that will, you're filling whitespace.

HOW TO THINK ABOUT THE GRAPH:

Picture the graph as a delta — many channels spreading outward from
a shared source. A single node at the present often forks into two,
three, four possible consequences. Those consequences fork again.
Convergent arrows (two branches recombining into one) appear only
where the divergence genuinely meets — never to force coherence.

ARROW COMPOSITION (dominant, not exclusive):
- **Primary** — \`causes\`, \`enables\`, \`reveals\`, \`develops\`: forward
  arrows, used at HIGH branching factor. A single source node should
  often carry 2–4 outgoing forward arrows into distinct possibilities.
  The shape is not a chain; it is a tree.
- **Secondary** — \`requires\`, \`constrains\`: use sparingly and only
  when a branch genuinely surfaces a prerequisite. These arrows should
  feel like late discoveries, not the engine.
- **Situational** — \`risks\`, \`resolves\`: as the branches call for
  them.

NODE ORDER — generation and presentation ALIGN:
- PLAN FIRST: Decide the total node count (emit it as plannedNodeCount
  BEFORE the nodes array). This forces you to scope your branching up
  front.
- GENERATION: You start THINKING at the present state and branch
  outward, thinking forward to consequences.
- PRESENTATION (the \`index\` field — this is what downstream consumers
  use): Index 0 is the present-state source. Later indices are the
  consequences and branches flowing outward. Highest index is the
  furthest-downstream consequence.
- Here generation and presentation point the SAME direction. Nodes
  appear in the JSON in the order you thought of them, and each
  node's \`index\` matches its presentation position — they coincide.
- \`generationOrder\` (which the parser auto-assigns from JSON
  position) will match \`index\` in this mode — useful as a visible
  signature that divergent thinking was forward-aligned.

MINDSET:
- Treat the current state as a source, not a target spec. Your job is
  to reveal what it COULD generate, not to pick a winner.
- Prefer producing branches over elaborating one chain deeply.
- Contradictory branches are welcome — they are the point. Two
  incompatible consequences both following from the same premise is a
  wider solution space, not a flaw.
- If you find yourself committing to a single narrative through-line,
  you have drifted into deduction. Back off and branch again.

The graph is an EXPANSION, not a solution. A reader should see many
possible futures hanging off the current state, with the arc free to
select among them later.
`;

/**
 * Abduction mode — "what prior configuration best explains this
 * outcome?" Reasons backward from a committed terminal (fate node) to
 * the specific prior setup that makes it feel inevitable. Generates
 * competing hypotheses, scores them, selects the best. Backward and
 * specific. Risk: post-hoc rationalisation.
 */
const ABDUCTION_MODE_BLOCK = `## MODE OF THINKING — ABDUCTION (inference to best explanation)

Abductive reasoning asks: **what prior configuration best explains
this outcome?**

ANCHOR DISCIPLINE (READ BEFORE YOU DO ANYTHING ELSE — abductive
chains silently drift deductive mid-chain if you don't enforce this
from the first node you plan):

At every new node, your reference point is the FATE TERMINAL, not
the previously generated node. Ask "WHAT EXPLAINS THE FATE?" — NOT
"what follows from the last node I generated?"

The failure mode this prevents: you correctly generate node N-1 by
reasoning back from the terminal, but then you generate N-2 by
reasoning FORWARD from N-1. The chain starts abductive and silently
converts to deductive halfway through. The terminal stops anchoring
anything. The result looks like an explanation but is actually a
forward derivation dressed as one.

Every time you add a node, ask yourself: does this new node still
directly help explain the TERMINAL FATE, or has it become a
consequence of the last prior I wrote? If the latter, discard it
and reanchor to the fate.

With that discipline established, the rest of the mode follows:

You reason BACKWARD from terminal states (fate nodes) to prior
configurations. You do NOT simulate forward. You do NOT generate
consequences. You generate EXPLANATIONS. Every fate node is treated
as already TRUE — the only question is what prior setup makes it
feel inevitable given what currently exists.

Secondary failure mode (also guard against): abduction can
degenerate into post-hoc rationalisation ("it happened because it
was meant to"). Guard against this by generating COMPETING
hypotheses (at least 2–3 per fate node) and scoring them explicitly
before selecting one. An explanation that doesn't survive comparison
is not an explanation.

THE ABDUCTIVE PROCEDURE (apply to every fate node):

1. TREAT THE FATE AS COMMITTED. Do not question whether it occurs. It
   will. Your only question is what makes it feel inevitable.
2. GENERATE 2–3 COMPETING HYPOTHESES. Label them H1, H2, H3. Each is
   a candidate reasoning node or chain explaining the fate.
3. SCORE EACH ON FOUR AXES:
   - **Coherence**: does it contradict any existing node or edge?
   - **Sufficiency**: does it fully account for the fate without gaps?
   - **Minimality**: does it introduce the fewest new nodes?
   - **Retroactive inevitability**: would a reader, seeing the setup
     AFTER knowing the outcome, feel it was engineered rather than
     accidental?
4. SELECT the highest-scoring hypothesis; record WHY the others were
   rejected (cite specific axis failures, not generic reasons).
5. ANOMALIES FIRST. Chaos and warning nodes are the highest-priority
   evidence. Any hypothesis that fails to explain them is incomplete,
   regardless of other scores.
6. CHECK INFORMATION ASYMMETRY. Tag each node in the selected chain
   as VISIBLE (observable by any character) or HIDDEN (only by
   characters with specific knowledge or foreknowledge). A valid
   abductive chain must have at least one HIDDEN node — if every
   node is visible, any intelligent character could have predicted
   the outcome, which eliminates dramatic tension.

### THE RI TEST (apply after scoring)

After selecting your highest-scoring hypothesis, ask:

    "Could this setup have been deliberately arranged by someone
     who already knew the outcome?"

YES → valid. NO → revise or reject; it's accidental, not inevitable.

**Engineered inevitability is the target.** Logical coherence is
necessary but not sufficient — a hypothesis that passes the other
three axes but fails RI produces narrative that feels lucky rather
than fated.

HOW TO THINK ABOUT THE GRAPH:

Picture the graph as a detective's evidence board read in reverse.
You start with the outcome (the fate node) and trace backward to the
specific prior configuration that produced it. Unlike induction (which
generalises to a principle), abduction settles on ONE specific prior
— the particular setup, the particular character, the particular
artefact — that best explains this particular outcome.

ARROW COMPOSITION (dominant, not exclusive):
- **Primary** — \`requires\`, \`develops\`, \`causes\`: the abductive
  backward arrows. \`requires\` encodes "the fate depends on this
  prior"; \`develops\` encodes "this configuration matured into the
  fate"; \`causes\` encodes "this prior state produced the fate".
- **Avoid** \`enables\` as the terminal edge into a fate — it implies
  optionality, and abductive conclusions are not optional.
- **Secondary** — \`constrains\`, \`reveals\`: used where the selected
  hypothesis genuinely leans on a rule or information disclosure.
- **Situational** — \`risks\`, \`resolves\`: as the chain calls.

NODE ORDER — generation and presentation DIVERGE. Presentation must
be coherent, not scattered:

PLAN FIRST: Decide the total node count (emit it as plannedNodeCount
BEFORE the nodes array). This is load-bearing for abduction: you need
N so you can give the TERMINAL fate node index N-1 while generating it
first in the JSON.

GENERATION (the order you emit nodes in the JSON array, auto-captured
as \`generationOrder\`): You start THINKING at the terminal fate and
reason backward. Emit the terminal first, then the priors you
hypothesise, in discovery order.

PRESENTATION (the \`index\` field — what every downstream consumer uses
for display, scene generation, and reasoning walks): This must follow
a TOPOLOGICAL ORDER over the edges. Concretely:
  1. Read the causal direction of each edge you emit. \`A requires B\`
     means B is causally prior to A; \`A causes B\` means A is prior
     to B; \`S constrains E\` means S is prior to E.
  2. Assign index 0 to a node with NO causal predecessors under your
     chosen edges — the earliest-in-story-time prior.
  3. Assign each subsequent index to a node ALL of whose predecessors
     already have lower indices. Continue until the terminal fate
     node, which should be the LAST node (highest index, N-1),
     because every prior feeds into it.
  4. When two nodes are causally parallel (neither precedes the
     other), order them by which naturally introduces its shared
     downstream consequence first. Avoid scattering — a reader
     walking the graph by ascending index should feel a single
     coherent sweep from earliest prior to the terminal fate.

Generation runs backward (terminal first) while presentation runs
forward (terminal last). This inversion is the visible signature of
abductive thinking: \`generationOrder\` shows the detective's path
from outcome back to cause; \`index\` shows the chronology the graph
actually presents.

DO NOT SCATTER — if walking ascending indices requires jumping between
unrelated subgraphs, your presentation order is wrong. Re-sort so each
step flows naturally from the last.

Example: 4-node abductive chain. You emit in JSON order
[fate, prior-A, prior-B, prior-C]. If edges read
\`fate requires prior-A\`, \`prior-A requires prior-B\`,
\`prior-A requires prior-C\` — then B and C are both causally prior
to A, which is prior to fate. Valid presentation indices:
[fate=3, A=2, B=0, C=1] or [fate=3, A=2, B=1, C=0]. Walking 0→3
reads: earliest prior → the other parallel prior → A which they
both enable → the fate they together produce.

MINDSET:
- Fate is input, not output. You receive it; you explain it.
- Your primary output is new reasoning nodes that bridge existing
  nodes to fate nodes.
- Limit yourself to ~3 new nodes per fate node. An abductive chain
  that requires many new elements is failing the minimality axis.
- Two fate nodes that share an explanation should share a single
  reasoning node with edges to both — do not duplicate.

The graph is a DETECTIVE'S RECONSTRUCTION, not an exploration. A
reader should see fate nodes with backward chains leading to specific
prior configurations — each chain chosen over competitors and
annotated with what it explains.
`;

/**
 * Induction mode — "what general pattern explains these observations?"
 * Reasons backward from multiple observed states to the shared
 * principle underlying them. Backward and general. Risk: locks onto
 * the first coherent pattern and stops exploring.
 */
const INDUCTION_MODE_BLOCK = `## MODE OF THINKING — INDUCTION (pattern across observations)

Inductive reasoning asks: **what general pattern explains these
observations?**

ANCHOR DISCIPLINE (READ BEFORE YOU DO ANYTHING ELSE — inductive
chains silently drift deductive once a principle is sketched):

At every new node, your reference point is the OBSERVATION CLUSTER,
not the last principle you sketched. Ask "DOES THIS ACCOUNT FOR THE
OBSERVATIONS?" — NOT "what follows from the principle I just wrote?"

The failure mode this prevents: you correctly sketch a principle
that fits the first observations, then you start deriving new
principle nodes as logical consequences of the first. The chain
starts inductive and silently converts to deductive — you stop
generalising from evidence and start extending a theoretical frame.
Every principle node must earn its place by explaining observations,
not by extending another principle.

With that discipline established, the rest of the mode follows:

It starts from MULTIPLE observed states — several scenes, several
arcs, several character behaviours, several world events — and
reasons backward to the SHARED principle or structural pattern
underlying them. Abduction explains one outcome with a specific
prior; induction explains several outcomes with a general rule.

Secondary failure mode (also guard against): induction locks onto
the first coherent pattern and stops exploring. Once a principle
"fits" several observations, it becomes attractive to stop — but
the same evidence often supports multiple patterns. Hold at least
one alternative pattern in the graph as a minor branch, so the
induction isn't premature.

HOW TO THINK ABOUT THE GRAPH:

Picture the graph as many rivers traced back to their shared
watershed. Multiple observed nodes (events, behaviours, outcomes)
converge on a small number of principle nodes that explain them
collectively. The pattern is valuable precisely because it
generalises — it predicts similar outcomes in situations not yet
observed.

ARROW COMPOSITION (dominant, not exclusive):
- **Primary** — \`requires\`, \`constrains\`: the backward arrows that
  carry the induction. \`A requires B\` encodes "observed A is
  explained by the prior pattern B". \`constrains\` points from the
  general rule back onto the specific instances that obey it.
- **Secondary** — \`reveals\`, \`develops\`: used where the pattern
  itself has downstream implications worth naming.
- **Situational** — \`causes\`, \`enables\`, \`risks\`, \`resolves\`: as
  the pattern calls.

NODE ORDER — generation and presentation DIVERGE. Presentation must
be coherent, not scattered:

PLAN FIRST: Decide the total node count (emit it as plannedNodeCount
BEFORE the nodes array). You need N to place the inferred principle
at index 0 while emitting it last in the JSON.

GENERATION (auto-captured as \`generationOrder\`): You start THINKING
at the cluster of observations and reason backward to the pattern.
Emit observations first, principle last — the scientist's assembly
of the argument.

PRESENTATION (the \`index\` field — what every downstream consumer uses
for display and reasoning walks): This must follow a TOPOLOGICAL ORDER
over the edges. The principle is causally prior to the observations it
explains (\`principle constrains observation\` or \`observation requires
principle\`), so:
  1. Read the causal direction of each edge. A principle that
     \`constrains\` or is \`required by\` an observation is prior.
  2. Assign index 0 to the root principle — the node every
     observation ultimately traces back to.
  3. Assign each subsequent index so a node's predecessors all have
     lower indices. The observations come last, in whatever order
     best shows the pattern cascading into its manifestations.
  4. If you inferred multiple principles, order them root-first:
     most-general at the lowest index, sub-patterns after, then
     observations. Never scatter a principle between its cases.

Generation runs up from observations; presentation runs down from the
principle. \`generationOrder\` shows the scientist's path; \`index\`
shows the rule producing its cases in order.

DO NOT SCATTER — if walking ascending indices requires jumping between
the principle and unrelated observations, your presentation order is
wrong. Re-sort so the graph reads principle → manifestations
coherently.

Example: 4-node inductive chain with 3 observations generalised into
1 principle. Emit JSON order [obs-A, obs-B, obs-C, principle]. If
edges read \`obs-A requires principle\`, \`obs-B requires principle\`,
\`obs-C requires principle\` — the principle is prior to all three.
Presentation indices: principle=0, then obs-A, obs-B, obs-C at 1/2/3
in whatever order the pattern naturally cascades.

MINDSET:
- Observations are EVIDENCE, in plural. Induction needs multiple
  cases; a single observation is abduction, not induction.
- The goal is a PATTERN that generalises, not an explanation that
  fits one case. If your proposed principle only explains one
  observation, it isn't inductive.
- Resist the first fit. If you land a coherent pattern in the first
  few nodes, try to break it — what observation doesn't this pattern
  account for?
- When evidence points to multiple possible patterns, keep them both
  in the graph as competing generalisations rather than collapsing.

The graph is a GENERALISATION, not an explanation of a single event.
A reader should see many observed states at the leaves converging
on a small number of principle nodes that explain them all.
`;

/**
 * Deduction mode — "if this premise is true, what must follow?"
 * Starts from a committed premise and forward-simulates consequences
 * with logical necessity. Deterministic in direction. Risk: only as
 * good as the premise — wrong starting assumption, wrong everything.
 */
const DEDUCTION_MODE_BLOCK = `## MODE OF THINKING — DEDUCTION (premise → necessary consequence)

Deductive reasoning asks: **if this premise is true, what must follow?**

It starts from a committed assumption — an active thread, a
character's stated goal, a rule the world has established — and
forward-simulates its consequences with logical necessity. Given
input X, derive output Y. The chain is deterministic: each step
follows unavoidably from the previous one.

Failure mode to guard against: deduction is only as good as its
premise. Choose the wrong starting assumption and every consequence
downstream is wrong. Before building the chain, NAME the premise
explicitly as a fate/system/character node at the root. If the
premise itself is shaky, the whole graph is.

HOW TO THINK ABOUT THE GRAPH:

Picture the graph as a logical chain or narrow tree. Start with the
premise node. Each forward arrow must represent a NECESSARY step —
"given the premise, this must follow". High branching factor is a
red flag here (that is divergent, not deductive); low branching with
tight causal linkage is the signature shape.

ARROW COMPOSITION (dominant, not exclusive):
- **Primary** — \`causes\`, \`enables\`, \`requires\`, \`resolves\`: the
  tight logical arrows of deduction. Each arrow should feel
  necessary, not optional. A deductive \`requires\` still points from
  consequence to premise (the derived state depends on the premise)
  but here it tightens the chain rather than reversing it.
- **Secondary** — \`constrains\`, \`develops\`: used when the logical
  chain genuinely hits a rule or deepens a consequence, not as
  decoration.
- **Situational** — \`reveals\`, \`risks\`: as the derivation calls.

NODE ORDER — generation and presentation ALIGN:
- PLAN FIRST: Decide the total node count (emit it as plannedNodeCount
  BEFORE the nodes array). A deductive chain should have a specific
  length; commit to it.
- GENERATION: You start THINKING at the premise and derive forward,
  thinking through each necessary consequence in order.
- PRESENTATION (the \`index\` field): Index 0 is the premise. Later
  indices are the derived consequences, in the order they are
  necessarily entailed. Highest index is the final conclusion.
- Here generation and presentation ALIGN. \`generationOrder\` will
  match \`index\` — a visible signature that deductive thinking
  walked premise-to-conclusion.

MINDSET:
- The premise is load-bearing. Name it clearly. If you cannot state
  the premise in one sentence, the graph has no foundation.
- Each node should answer: "given the previous node, what MUST be
  true next?" If the answer is "something from a list of options",
  you are in divergent mode, not deductive.
- Logical necessity over narrative interestingness. If a consequence
  feels flat but follows necessarily, keep it — the flatness may be
  signalling that the premise isn't generative enough.
- When the chain produces an absurd or unworkable conclusion, that
  is useful: it's evidence the premise needs revision. Do not patch
  the consequence to avoid the absurdity.

The graph is a DERIVATION, not an exploration. A reader should be
able to read it top-to-bottom and feel each step lock into the next,
arriving at a conclusion the premise made inevitable.
`;

/**
 * Dispatch the reasoning-mode block. Defaults to divergent.
 */
function reasoningModeBlock(mode: ReasoningMode | undefined): string {
  switch (mode) {
    case "induction":
      return INDUCTION_MODE_BLOCK;
    case "abduction":
      return ABDUCTION_MODE_BLOCK;
    case "deduction":
      return DEDUCTION_MODE_BLOCK;
    case "divergent":
    default:
      return DIVERGENT_MODE_BLOCK;
  }
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
  pref: ForcePreference | undefined,
): string {
  const scopeNoun = scope === "plan" ? "PLAN" : "ARC";
  const scopeLower = scopeNoun.toLowerCase();
  const unit = scope === "plan" ? "plan's arcs" : "arc's scenes";

  const model = `
### MODEL

The reasoning graph is the AUTHOR's meta-reasoning about the work — the writer, analyst, or researcher thinking about what they're building. (This is why the framework works in fiction and non-fiction alike: in both, the reasoner is outside the system they're constructing.) The graph is a **cause-and-effect structure**: upstream nodes cause, downstream nodes are effect. Direction is the primary semantic signal — the same two nodes in opposite causal positions assert opposite claims.

Three structural forces run through the work:

- **FATE** — the work's current momentum, pushing its existing agenda toward what the threads demand. The default operating system: what's in motion continues, what's promised gets paid off.
- **WORLD** — character, location, artifact change. Entities deepen, bonds shift, things accrue history.
- **SYSTEM** — the rules and principles constraining fate and world.

**CHAOS is adversarial reasoning**, not a fourth structural peer. It is the red-team inside the graph: what could go wrong, what defies expectations, where the current agenda breaks, what the work is not accounting for. Chaos is crucial for research-type thinking — a graph that only pulls toward fate is a graph that never questions itself. Chaos is an EVENT (something that happens at a moment and couldn't be predicted from the rules alone); adversarial system nodes are RULES (a loophole that was always in the mechanics). Test: could it have been in the rulebook before this moment? If yes → system. If no → chaos.

### FIVE CAUSAL PATTERNS

Different patterns mean different things. Read the direction, then read what it's saying.

- **Default — reason→fate**: \`reasoning/system/character\` causes \`fate\`. Deliberation advances the agenda.
- **Chaos as cause**: \`chaos\` causes \`reasoning/character/system\`. A disruption forces adaptation; downstream is the reaction.
- **Chaos chain**: \`chaos → chaos → chaos\`. One disruption spawns the next (troll arrives → cast scatters → Hermione alone). Chaos develops its own internal causality.
- **Subversion — fate→chaos**: the agenda inadvertently produces its own disruption. Harry's pride drives him to confront Quirrell alone → the overreach creates the worst-case reveal. Fate authored the chaos it now has to face. This is one of the most productive patterns in research-type reasoning.
- **Adaptation — chaos→(reasoning/character)→fate**: the work absorbs a disruption into a new or subverted thread. Note the intermediate step: chaos doesn't directly service an existing thread; the adaptation does, and the downstream fate node usually reflects a subverted transition rather than the resolution fate had been pushing for.

Cross-direction edges are how subversions and adaptations work. Don't ban them; be deliberate — every cross-direction edge asserts one of these patterns.

### GAME-THEORETIC REASONING

The reasoning graph is an iterated game. Each node is a player; each edge is a move. The graph isn't just causal structure — it's strategic structure. When you build nodes and edges, think about WHO BENEFITS and WHO LOSES. This applies across registers: in fiction the players are characters and forces; in argument the players are claims, methods, and evidence; in inquiry the players are hypotheses and stakeholders.

**Cooperation and defection aren't fixed to edge types.** An \`enables\` edge can be a betrayal (enabling self-destruction; enabling a flawed method that will produce misleading results). A \`constrains\` edge can be protection (constraining a fatal mistake; a methodological guard-rail that prevents overreach). A \`risks\` edge can be the most cooperative move in the graph (a calculated risk for mutual benefit; a bold hypothesis that, if validated, strengthens the entire framework). The DIRECTION and CONTEXT determine the strategic meaning, not the edge label alone.

**Information asymmetry is the engine.** When one node holds knowledge another doesn't, the graph should encode that as strategic advantage. A \`reveals\` edge isn't just "information appears" — it's "the information landscape changes, and every player's optimal strategy shifts." In fiction: a secret exposed reshapes alliances. In argument: a decisive piece of evidence forces all competing claims to recalibrate. In inquiry: a newly discovered source reframes the entire investigation. The most powerful reasoning chains include moments where WHAT IS KNOWN changes WHO HAS LEVERAGE.

**Equilibrium and instability.** A subgraph where all nodes mutually reinforce each other is a stable equilibrium — a resolved state (a conclusion, a proven thesis, a settled question). A subgraph where nodes undermine each other through \`constrains\` and \`risks\` is unstable — it will change (an unresolved conflict, a contested claim, an open question). Good graphs have BOTH: stable structures the work is building toward, and unstable structures that threaten to break them. The tension between stability and instability IS the engine — in fiction as dramatic tension, in argument as intellectual tension, in inquiry as unresolved evidence.

**Coalition reasoning.** Nodes that share \`enables\`/\`develops\` edges form implicit coalitions (allied characters; converging evidence; complementary methods). When a coalition member connects to an outside node via \`risks\`/\`constrains\`, the coalition is under threat. When an inside node has \`enables\` edges to both coalition members AND their adversary, that node is a potential DEFECTOR — the most interesting structural position in any graph (a double agent; a piece of evidence that supports both sides; a method that validates one claim while undermining another).

**Payoff asymmetry across threads.** When two thread-fate nodes share participants, think about the CROSS-THREAD PAYOFF. Advancing one thread may cost another's participants. In fiction: a character who benefits from one thread resolving may lose from another resolving. In argument: evidence that strengthens one claim may weaken a claim the same author needs elsewhere. In inquiry: pursuing one line of investigation may foreclose another. The coordination (or conflict) between threads is where the deepest strategic reasoning lives. Don't reason about threads in isolation — reason about the game BETWEEN threads.

### WHAT DIFFERS BY MODE

A fate-dominant graph leans into the agenda; a chaos-dominant graph leans into adversarial reasoning; a world- or system-dominant graph leans into expanding those layers. **Every mode can create** — new characters, locations, artifacts, threads — but the flavor of creation serves the mode's master:

- **Fate** creates things that extend the agenda (destined figures, prophesied artifacts, hidden threads surfacing).
- **World** creates things that grow from existing entities (offspring, apprentices, a newly-discovered chamber, an artefact forged by a character).
- **System** creates things that extend the rules (new principles following from established ones, new institutions consistent with the world's logic).
- **Chaos** creates things that go against the grain (intruders, adversaries, disruptive artefacts, places defying the known map).

Creations are real — they become part of the work once the graph is executed. When the logic wants a new piece on the board, add it; match the creation to the mode.

### BAD GRAPH SIGNALS

A graph is failing when: reasoning nodes don't connect to anchors (disconnected components); the dominant force has fewer nodes than its complement combined; chaos nodes only have incoming \`requires\` edges (chaos being serviced, not driving); a "subversion" claims fate→chaos but the upstream fate is contrived rather than the real agenda; cross-direction edges only flow one way in balanced mode (no real tension); system nodes have no outgoing edges (lore dumps); new entities lack an edge rooting them into existing context (drop-ins). Bad graphs aren't less detailed — they're structurally misrepresenting what the reasoning is claiming.
`;

  // Freeform: narrative quality first. No force bias — the LLM picks
  // whatever node mix the story actually needs. This is the default.
  if (!pref || pref === "freeform") {
    return `
## FORCE PREFERENCE: FREEFORM ${scopeNoun}

**Master:** the narrative itself — quality of the ${scopeLower} is the only bias.
**Flavor of reasoning:** adaptive, situational, unopinionated. Picks whatever the story earns, beat by beat.
${model}
### NARRATIVE-QUALITY-FIRST

**Freeform has no master beyond the story itself.** There is no force bias here: not fate, not chaos, not any structural force. The only question is "what would make this ${scopeLower} best?" — and the answer comes from the prose, not from a preference. Pick the node mix that serves the narrative.

Full toolbox:

- **fate** — a thread advancing; references an existing threadId and its target status.
- **character / location / artifact** — an existing entity whose world graph grows this ${scopeLower}; references an entityId.
- **system** — a rule or principle; reuse existing SYS-XX ids where possible, or introduce a new rule that connects to one.
- **chaos** — a realtime disruption that warps fate; introduces new entities, new threads, or subverts existing ones. Use when the story earns a perturbation, not to hit a ratio.
- **reasoning** — an explicit logical step linking other nodes.
- **pattern / warning** — positive patterns to reinforce, anti-patterns to avoid.

**A good mixture matters for coherent reasoning.** A graph that's all one type reads as thin: all-fate lacks grounding, all-character lacks momentum, all-system lacks consequence, all-chaos lacks stakes. Aim for a reasoning chain where forces CAUSE each other — a system rule ENABLES a character choice that ADVANCES a fate thread; a chaos event REVEALS a character's hidden side that RECASTS a thread. The mix isn't a quota; it's what makes the graph tell a story rather than list facts.

What matters: every node earns its place via an edge, and the composition reflects what the ${scopeLower} genuinely is — not what any preference says it should be.
`;
  }

  if (pref === "balanced") {
    return `
## FORCE PREFERENCE: BALANCED ${scopeNoun}

**Master:** fate (lead), with world and system in support, and adversarial reasoning (chaos) as pushback.
**Flavor of reasoning:** fate-positive and structural, with a contained strand of devil's-advocate critique. The graph mostly pulls toward the current agenda; a minority of nodes ask "what could go wrong."
${model}
### FATE-POSITIVE WITH ADVERSARIAL PUSHBACK

Balanced does NOT mean "all four forces equal". Fate leads; world and system support the agenda; chaos supplies adversarial/critical reasoning as a minority of the graph.

- **fate** nodes lead the composition — reference existing threadIds and the statuses being pushed toward.
- **character/location/artifact** nodes serve fate by default in this mode: entities change in ways that advance the existing threads.
- **system** nodes provide the constraints fate has to navigate. Reuse existing SYS-XX ids or extend them.
- **chaos** nodes — a small cluster (2-4) of adversarial nodes asking what the agenda is missing, what would subvert it, what adversarial move the world could make. Their downstream stays among chaos/reasoning nodes; cross-direction edges (fate→chaos subversion, chaos→fate adaptation) are welcome where the reasoning genuinely earns them.

**Signals**: fate clearly leads; a recognisable strand of adversarial reasoning exists; omitting the chaos entirely would leave the ${scopeLower} over-determined.
`;
  }

  if (pref === "fate") {
    return `
## FORCE PREFERENCE: FATE-DOMINANT ${scopeNoun}

**Master:** fate, amplified. This mode **expands the fate layer** of the universe.
**Flavor of reasoning:** inevitability, momentum, gravitational pull. Beats feel like they had to happen. The reader senses the agenda closing in.
${model}
### WHAT FATE DOMINANCE MEANS HERE

The ${scopeLower} is where fate's momentum is amplified — threads escalate, promises resolve, hidden pieces surface to be answered. Chaos is minimal; the agenda pushes through.

**Fate should dominate — it makes up many of the nodes and clearly out-numbers every other force.** If character, system, or chaos counts approach fate's, the preference isn't being honoured. This is the mode for **expanding the fate layer of the universe** — tightening the web of threads, concentrating momentum, letting the current agenda carry the ${scopeLower}.

- Read the active thread list and each thread's recent log entries. Every fate node must reference an existing threadId and the exact targetStatus it advances toward.
- Favour threads already at \`escalating\` or \`critical\` — these have the strongest momentum to convert.
- **Fate is creative.** A destined arrival, a long-promised revelation, a prophesied figure, a hidden artefact surfacing — fate spawns new entities that extend its agenda. The new piece arrives TO advance what's already in motion; its existence rhymes with the momentum that was already there. Every fate-dominant ${scopeLower} should be willing to introduce new entities when the agenda calls for them.
- Peak and valley anchors should BE thread transitions: a peak is a critical→resolved moment on a load-bearing thread; a valley is an escalating pulse that refuses to break.

**Adversarial reasoning is minimal in this mode** — at most 1-2 chaos nodes that stress-test fate's agenda. Fate dominance doesn't mean chaos vanishes; it means chaos is a quiet minority voice next to the lead.

**Other structural forces in support**:
- character as thread-carriers serving fate — the people whose choices move the thread.
- system for the constraints that make the journey hard (and the resolution meaningful).
- reasoning/pattern/warning as the connective tissue.

The ${unit} should feel like inevitability unfolding — fate pushing its agenda through the ${scopeLower}.
`;
  }
  if (pref === "world") {
    return `
## FORCE PREFERENCE: WORLD-DOMINANT ${scopeNoun}

**Master:** world (character / location / artifact transformation). This mode **expands the world layer** of the universe.
**Flavor of reasoning:** intimate, transformative, grounded. Beats feel like people and places becoming something new — the reader grows closer to the cast.
${model}
### WHAT WORLD DOMINANCE MEANS HERE

The ${scopeLower} is focused on the world layer: existing entities transforming AND new entities emerging organically from the existing cast/map. Inner change, shifting bonds, places accruing meaning, objects gaining history, new life taking root where the old has made room for it. Fate still operates underneath (it's the OS), but the ${scopeLower}'s spotlight is on the world layer.

**World should dominate — character, location, and artifact nodes make up many of the nodes and clearly out-number every other force.** If fate, system, or chaos counts approach world's, the preference isn't being honoured.

- For each world node, either (a) reference an existing entityId and identify which of its existing world graph nodes this beat extends or contradicts, or (b) INTRODUCE a new entity that grows from what's there — a child or apprentice of an existing character, a newly-discovered chamber in a known stronghold, an artefact a character has forged, a location a journey has uncovered. New entities are welcome when the reasoning earns them; they should rhyme with the existing world rather than drop in from nowhere (that would be chaos).
- Favour entities with rich existing world graphs — more material to riff on for the deepening path. A thin-graph entity is best anchored when the beat is the one where its graph substantially grows.
- Relationship deltas, POV-character world deltas, and location-tied transformations are the core currency.

**Entity arcs usually serve fate's agenda** (the character changes in a way that advances an existing thread) — this is the default because fate is the OS. But SOME entity arcs in this ${scopeLower} can be chaos-touched: a character's growth goes against the grain, a location takes on a disruptive new meaning, an artifact reveals an unsettling property. That contrast keeps the ${scopeLower} from reading as programmatic.

**Other forces in support**:
- fate as consequence of character change — the thread moves BECAUSE someone changed.
- system for the constraints that force the change.
- chaos sparingly when an outside event is the catalyst for the entity's shift.
- reasoning/pattern/warning as the connective tissue.

The ${unit} should deepen what already exists AND grow new things organically from it — world is the layer being expanded.
`;
  }
  if (pref === "system") {
    return `
## FORCE PREFERENCE: SYSTEM-DOMINANT ${scopeNoun}

**Master:** system (rules, principles, mechanics). This mode **expands the system layer** of the universe.
**Flavor of reasoning:** lawful, consequential, testing. Beats feel like the world's rules asserting themselves — the reader learns how reality works as the cast does.
${model}
### WHAT SYSTEM DOMINANCE MEANS HERE

The ${scopeLower} is focused on rules, constraints, principles, mechanics — both surfacing existing rules AND extending them with new principles, institutions, or domains that follow from what's already established. Fate still operates underneath; system is the layer being expanded.

**System should dominate — it makes up many of the nodes and clearly out-numbers every other force.** If character, fate, or chaos counts approach system's, the preference isn't being honoured.

- Each system node does one of: (a) REUSES an existing system concept id (cite it by SYS-XX) and extends it with a new edge or implication; (b) introduces a genuinely new rule that connects to at least one existing concept; or (c) INTRODUCES a new institution, faction, or domain that extends the world's rule-layer (a legal structure, a craft, a governing body, a named principle). New rules and institutions are welcome when the reasoning earns them — system mode grows the rules layer, not just surfaces it. Free-floating lore dumps disconnected from the existing graph are a failure mode.
- Downstream nodes (fate, character, chaos, reasoning) should DEPEND on system nodes — the \`requires\` / \`enables\` / \`constrains\` edges should point from system to consequences. If a system node has no outgoing edge, it wasn't used.
- Read the existing cumulative system graph first; the ${scopeLower} should test, stress, or exploit principles already established as a foundation for any new ones.

**Rules primarily enable fate's agenda** (the system makes the existing threads' progression possible) — but a good system-dominant ${scopeLower} also shows **rules creating cracks chaos can slip through**: a loophole, an unintended consequence, a limit that cuts both ways. When rules only enable one side, the system layer reads as rigged.

**Other forces in support**:
- character as system-testers — the cast discovering what the rules mean.
- fate as system-driven consequence — the thread moves BECAUSE the rule said so.
- chaos as system-driven consequence — an event the rules permitted but didn't foresee.
- reasoning/pattern/warning as the connective tissue.

The ${unit} should surface, test, AND extend the mechanics — the reader learns the world's rules and watches new ones emerge as deductive growth.
`;
  }
  if (pref === "chaos") {
    return `
## FORCE PREFERENCE: CHAOS-DOMINANT ${scopeNoun}

**Master:** chaos — adversarial reasoning takes the lead. Fate is present but weakened.
**Flavor of reasoning:** red-team, devil's-advocate, stress-test. Beats ask "what could go wrong", "what defies expectations", "where does the current agenda break" — and follow those questions into consequences the existing story didn't plan for.
${model}
### WHAT CHAOS DOMINANCE MEANS HERE

This is the mode for adversarial and critical reasoning: stress-testing the agenda, exploring subversions, pursuing the counterfactuals the story has been ignoring.

**Chaos should dominate — it makes up many of the nodes and clearly out-numbers every other force.** If fate, character, or system counts approach chaos's, the preference isn't being honoured.

- Chaos is not randomness: each chaos node produces a consequence — adversarial, subversive, critical — that the existing agenda would not have reached on its own.
- Explore "what could go wrong?" from multiple angles: internal fractures in the cast, external threats the story isn't accounting for, rule edge-cases, arrivals the cast didn't prepare for.
- **Introduces new entities against the grain** — a hostile actor the cast hasn't anticipated, a place that defies expectations, an artefact whose utility is disruption.
- **Subverts existing threads** — chaos's signature move: escalating threads that won't resolve the way the story expects, critical threads that get forked or broken open.

**Chaos is the primary CAUSE in this mode** — most chaos nodes sit upstream, driving downstream adaptation. Chaos→chaos chaining is a core pattern.

**Fate appears in two ways**: (a) downstream as threads chaos is actively subverting or newly opening (subverted status, not the resolution fate had been pushing for); (b) **upstream as the subversion pattern** — the agenda causing its own disruption (Harry's pride → confronts Quirrell alone → worst-case reveal). The second is one of the most potent patterns in chaos mode: fate authoring the chaos it now has to face.

**Other nodes in support**:
- character nodes used adversarially — "what if they betrayed us?", "what breaks them?", "who is the cast not prepared to deal with?"
- system nodes as loopholes, violations, or edge-cases — rules fate relied on, weaponised the other way.
- reasoning/pattern/warning as connective tissue for the stress-test.

**Dominance check**: chaos is the majority; chaos nodes sit upstream driving the reasoning; fate nodes appear either as downstream effects of chaos or as upstream overreach causes that PROVOKED chaos — not as the beneficiary of chaos's output.

**Behaviour in this ${scopeLower}**:
${scope === "plan"
  ? "- Expect several chaos-dominant arcs across the plan (HP's troll arc, HP's Norbert arc). Roughly 25-40% of arcs should be anchored on chaos.\n- Seed 5-10 chaos nodes across the plan.\n- Chaos-dominant arcs should leave the plan's fate trajectory MORE uncertain, not less — they are where the reader should feel the story could go multiple ways."
  : "- Build the arc around 3-5 chaos nodes rather than the default 1-2.\n- The arc's peak or valley may itself be chaos-anchored (its prime mover is outside the current agenda).\n- A chaos node can subvert an existing thread or introduce an adversarial situation the cast must improvise around, reshaping the ${scopeLower}'s arc."}
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

Threads are FATE — they exert gravitational pull on events, but fate doesn't always go the expected direction. Threads can advance through twists, resistance, or subversion.
${forcePreferenceBlock("arc", options?.forcePreference)}
${reasoningModeBlock(options?.reasoningMode)}

## OUTPUT FORMAT

**CRITICAL FORMAT REQUIREMENTS**:
- **IDs**: Use SHORT, SIMPLE alphanumeric IDs: F1, F2, R1, R2, C1, L1, S1, PT1, WN1, etc. Do NOT use complex IDs like "FATE_THREAD_01" or "reasoning_step_3".
- **Labels**: Must be PROPER ENGLISH descriptions (3-10 words). Describe what happens in natural language. NOT technical identifiers or codes.
  - GOOD: "Fang Yuan exploits his future knowledge", "Alliance fractures over betrayal"
  - BAD: "Thread escalation node", "R2_REQUIRES_C1", "fate pressure mechanism"

Return a JSON object:

{
  "summary": "1-2 sentence high-level summary of the arc's reasoning",
  "plannedNodeCount": <-- commit first; locked once nodes begin. Sets the terminal's index (N-1) in backward modes.>,
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
- **character**: An active agent with their OWN goals — not just a reactive foil to the protagonist. Use entityId to reference actual character. Label = their position/goal. **Cast distribution matters**: a graph where every character node is the protagonist is a failure of agency. Include secondary characters as drivers — a rival plotting, an ally hedging, a mentor withholding — each with their own causal chain that interacts with the main arc rather than merely reacting to it. The arc's causal web should have at least 2–3 distinct characters acting as agents, not as scenery.
- **location**: A setting. Use entityId to reference actual location. Label = what it enables/constrains.
- **artifact**: An object. Use entityId to reference actual artifact. Label = its role in reasoning.
- **system**: A world rule/principle/constraint. Label = the rule as it applies here.
- **reasoning**: A logical step deriving what must happen. Label = the inference (3-8 words).
- **pattern**: NOVEL-PATTERN GENERATOR. Proposes a story shape this narrative HAS NOT used before — a fresh configuration, rhythm, or relational geometry that is absent from prior arcs and scenes. Not generic creativity: a specific structural move the story hasn't made. Every pattern node answers "what has this story never done that it could do here?" Example labels: "First arc resolved through a non-POV character's choice", "Two anchors separated across the arc — no shared scenes", "Fate subverts by succeeding too completely". Scan prior arcs before proposing; do not repeat a shape already used.
- **warning**: PATTERN-REPETITION DETECTOR. Scans prior arcs and scenes and FLAGS shapes the reader has already seen — resolution rhythms, conflict geometries, character dynamics, arc cadences — that this arc is drifting toward repeating. Humans are powerful pattern recognisers: once a shape repeats (same resolution twice, same beat three times, same dominant force four arcs running) the reader notices and the move loses weight. The warning's job is to name the repetition explicitly so the graph can route around it. Example labels: "Third arc ending with external rescue — reader will feel the pattern", "A and B have now used the tension-then-reconciliation beat three times", "Fourth consecutive fate-dominant arc — rhythm is becoming monotone".
- **chaos**: OUTSIDE FORCE — operates outside the existing fabric of fate, world, and system. Chaos has two everyday modes: as a **deus-ex-machina**, it brings problems the cast couldn't anticipate or solutions the cast couldn't build (a troll bursts into the dungeon, a stranger arrives with a fragmentary map, a dormant artefact wakes); as a **creative engine**, it seeds entirely new fates — new threads that didn't exist, which later arcs develop and resolve. Chaos sits OUTSIDE fate, but shapes fate by creating fresh strands. A well-used chaos node is balanced: it breaks a stalemate the existing forces couldn't, and it plants something the story can reuse. Use sparingly in balanced mode; use extensively under chaos-preference. Label = what arrives and its role. DO NOT set entityId or threadId — the entity/thread is spawned via world expansion.

## EDGE TYPES

- **enables**: A makes B possible (B could exist without A, but not here)
- **constrains**: A limits/blocks B
- **risks**: A creates danger for B
- **requires**: A depends on B (direction matters — A needs B, not B needs A; reversing this corrupts the graph silently)
- **causes**: A leads to B (B would not exist without A)
- **reveals**: A exposes information in B
- **develops**: A deepens B (use for character/thread arcs only, not generic logic steps)
- **resolves**: A concludes/answers B

## REQUIREMENTS

1. **Backward reasoning**: Start from FATE (what threads need) and derive what must happen. The graph flows from thread requirements → reasoning → entities that fulfill them.
2. **Causal complexity**: The arc is a causal reasoning diagram — capture the REAL complexity of how it unfolds. Threads pull on multiple things, entities influence multiple moments, rules constrain several choices. When you add a node, show all the places it matters.
3. **Fate throughout**: Fate nodes can appear ANYWHERE — they influence events at any point. A fate node can connect to characters, locations, reasoning, even other fate nodes. Fate is the gravitational force pulling the narrative.
4. **Unexpected directions**: Fate doesn't always pull toward obvious resolution. Include fate nodes that demand twists, resistance, or subversion. A thread at "escalating" might need a setback before payoff.
5. **Sequential indexing (TOPOLOGICAL, NOT SCATTERED)**: The \`index\` field is always CAUSAL — it must form a topological order over the edges you emit. Index 0 goes to a node with no causal predecessors; every later index goes to a node whose predecessors all have lower indices; the terminal or convergence point sits at the highest index. A reader walking ascending indices should feel a single coherent sweep through the graph, never a jump to an unrelated subgraph. The \`generationOrder\` field is auto-captured from JSON array position and records the order you THOUGHT of nodes — it may differ from \`index\` in backward modes (abduction, induction), which is the whole point. Emit \`plannedNodeCount\` before the nodes array to commit to a count first. See the active mode block for mode-specific ordering rules.
6. **Entity references**: character/location/artifact nodes MUST use entityId with actual IDs
7. **Thread references**: fate nodes MUST use threadId to reference which thread exerts the pull
8. **Single entity node per entity**: If the same character or system matters in multiple places, create ONE node with multiple edges — don't duplicate.
9. **Node count**: Target ${Math.round((8 + sceneCount * 4.5) * reasoningScale(options?.reasoningLevel))}-${Math.round((14 + sceneCount * 5.5) * reasoningScale(options?.reasoningLevel))} nodes across all types. The nudged bands leave room for secondary characters to get their own reasoning chains, not just appear as participants.
10. **Pattern nodes**: 1-2 nodes, each introducing a story shape the narrative has NOT used before. Scan prior arcs; name the new pattern; make sure the arc actually uses it.
11. **Warning nodes**: 1-2 nodes, each naming a specific repetition risk drawn from prior arcs/scenes — "we have ended the last two arcs this way", "this dynamic between A and B has already happened N times". Vague warnings are worthless; the warning must cite what is actually repeating.
12. **Chaos nodes (1-2 default, more under chaos preference)**: Inject at least one outside-force element — a new character arriving, a dormant artefact waking, a new fate appearing. Do NOT reference existing entityIds — chaos describes an entity that will be spawned. A chaos node signals the scene generator to invoke world expansion.
13. **Non-deterministic**: Each reasoning path should contain at least one SURPRISE — something that doesn't follow obviously from context
14. **Warning/pattern response (CRITICAL)**: Warnings and patterns are course-corrections, not ornaments. When a warning names a repetition, the rest of the graph MUST visibly route around it — a chaos node that breaks the pattern, a reasoning chain that subverts it, a fate node pulling a different direction, a character/entity node introducing an unused dynamic. When a pattern proposes a novel shape, the graph's actual nodes MUST use that shape — not merely mention it. Edges should connect warning/pattern nodes into the body of the graph so the course-correction is structural, not advisory. An orphaned warning or pattern (no outgoing edges, no downstream response) is dead weight — cut it or wire it in.
15. **Cast distribution (CRITICAL — enforce agency across the cast)**: Character nodes must represent AT LEAST 2 distinct entityIds — no arc should have a character subgraph that is 100% the protagonist. If the arc reasonably touches 3+ named characters, at least 3 distinct entityIds should appear as character nodes, each with their OWN incoming/outgoing reasoning edges. A secondary character that only appears as a target of the protagonist's action (no outgoing edges) has no agency — give them an outgoing causal edge showing a decision they made, intelligence they gathered, or a response they initiated. Rival/ally/mentor characters with one-way edges are props, not agents.

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

    // Ensure all nodes have required fields and valid types. The JSON
    // array position (i) becomes generationOrder — the order the LLM
    // emitted/thought of each node, distinct from its presentation index.
    const nodes: ReasoningNode[] = data.nodes.map((n: Partial<ReasoningNode>, i: number) => ({
      id: typeof n.id === "string" ? n.id : `N${i}`,
      index: typeof n.index === "number" ? n.index : i,
      generationOrder: i,
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
      plannedNodeCount: typeof data.plannedNodeCount === "number" ? data.plannedNodeCount : undefined,
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
  /** See ReasoningGraph.plannedNodeCount — forces the LLM to commit a
   *  node count before generating. Transient. */
  plannedNodeCount?: number;
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

Threads are FATE — they exert gravitational pull on world-building. New entities should serve thread requirements when threads pull, but under divergent mode new entities may also emerge from collisions the threads did not demand.
${forcePreferenceBlock("arc", options?.forcePreference)}
${reasoningModeBlock(options?.reasoningMode)}
## OUTPUT FORMAT

**CRITICAL FORMAT REQUIREMENTS**:
- **IDs**: Use SHORT, SIMPLE alphanumeric IDs: F1, F2, R1, R2, C1, L1, S1, PT1, WN1, etc. Do NOT use complex IDs like "EXPANSION_CHAR_01" or "new_location_thread".
- **Labels**: Must be PROPER ENGLISH descriptions (3-10 words). Describe what happens in natural language. NOT technical identifiers or codes.
  - GOOD: "New rival emerges from the northern clans", "Hidden faction controls the resource supply"
  - BAD: "New character node", "expansion_antagonist", "world gap identifier"

Return a JSON object:

{
  "summary": "1-2 sentence high-level summary of the expansion's reasoning",
  "plannedNodeCount": <-- commit first; locked once nodes begin. Sets the terminal's index (N-1) in backward modes.>,
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
- **character**: A new or existing character as an ACTIVE AGENT — not just a prop. Use entityId to reference existing character this connects to. Label = their role serving fate. When expansions introduce new characters, each should carry their own goal/agenda, not exist solely as a piece of the protagonist's puzzle.
- **location**: A new or existing location. Use entityId. Label = what it enables for threads.
- **artifact**: A new or existing artifact. Use entityId. Label = its role serving fate.
- **system**: A world gap, rule, or opportunity. Label = the gap or rule being established.
- **reasoning**: A logical step explaining WHY this entity serves fate. Label = the inference (3-8 words).
- **pattern**: NOVEL-PATTERN GENERATOR. Names the fresh direction this expansion introduces — a kind of entity, relationship geometry, or world-rule shape the narrative has NOT established yet. Not a vague "variety"; a concrete new pattern. Example labels: "First faction whose power comes from information asymmetry, not force", "A location that shifts allegiance between arcs — no other location has this property".
- **warning**: PATTERN-REPETITION DETECTOR. Flags where this expansion risks recreating a shape already present — the Nth rival faction, the Nth mentor figure, the Nth hidden-ruin location. Humans detect these quickly; once a category repeats, new instances lose weight. Label the repetition specifically: "Would be the third 'exiled heir' character", "Third artifact whose power is memory-related".
- **chaos**: OUTSIDE FORCE — operates outside the existing fabric. Injects entities or new fates that are FOREIGN to the current world. Two modes: deus-ex-machina (a sudden problem or solution) and creative seeding (a new thread the story can later develop). Use when the expansion brings something the existing world could not have produced — a stranger from elsewhere, a dormant artefact waking, a rumour arriving unprompted. Do NOT set entityId — chaos represents a net-new entity.

## EDGE TYPES

- **enables**: A makes B possible (B could exist without A, but not here)
- **constrains**: A limits/blocks B
- **risks**: A creates danger for B
- **requires**: A depends on B (direction matters — A needs B, not B needs A; reversing this corrupts the graph silently)
- **causes**: A leads to B (B would not exist without A)
- **reveals**: A exposes information in B
- **develops**: A deepens B (use for character/thread arcs only, not generic logic steps)
- **resolves**: A concludes/answers B

## REQUIREMENTS

1. **Backward reasoning from fate**: Start from FATE (what threads need) and derive what entities must exist
2. **Fate throughout**: Fate nodes can appear anywhere — they justify WHY entities are added
3. **Entity references**: character/location/artifact nodes connecting to existing entities MUST use entityId
4. **Thread references**: fate nodes MUST use threadId to reference which thread exerts the pull
5. **Causal complexity**: The graph is a causal reasoning diagram. Every new entity should show the full web of how it connects — who it serves, what it constrains, what it enables. Not a single line.
6. **Integration focus**: Every new entity should show HOW it serves existing threads via edges
7. **Node count**: Target ${nodeCountTarget}
8. **Pattern nodes**: 1-2 nodes, each naming a specific new direction the expansion opens — a category, relationship, or world-rule the narrative hasn't used.
9. **Warning nodes**: 1-2 nodes, each citing a specific repetition risk from prior entities — "would be the Nth X", "this dynamic already exists between A and B".
10. **Chaos nodes**: Include at least one chaos node. Expansion is ITSELF an outside-force event — something new is arriving. Chaos nodes represent the entities coming from beyond the current world that the expansion is bringing in.
11. **Warning/pattern response (CRITICAL)**: Warnings and patterns must change what the rest of the graph produces. When a warning flags a repetition risk (e.g., "would be the third X"), the new entities in this expansion MUST be shaped so they break that repetition — different category, different relationship geometry, different power source. When a pattern proposes a novel direction, the actual new entities MUST embody that direction. A warning/pattern with no edges into the rest of the graph is dead weight; wire them in.

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

    // Ensure all nodes have required fields and valid types. The JSON
    // array position (i) becomes generationOrder — the order the LLM
    // emitted/thought of each node, distinct from its presentation index.
    const nodes: ReasoningNode[] = data.nodes.map((n: Partial<ReasoningNode>, i: number) => ({
      id: typeof n.id === "string" ? n.id : `N${i}`,
      index: typeof n.index === "number" ? n.index : i,
      generationOrder: i,
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
      plannedNodeCount: typeof data.plannedNodeCount === "number" ? data.plannedNodeCount : undefined,
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
 * force category as the arc/plan's prime mover. Default is "freeform".
 *  - freeform: no bias — every node type is on the table and the LLM picks
 *              composition purely from what the prose needs (DEFAULT)
 *  - balanced: explicit ~1/3 fate, ~1/3 world, ~1/3 system, chaos as fallback
 *  - fate: favour thread-driven arcs (internal pressure, resolutions)
 *  - world: favour entity-driven arcs (character/location/artifact development)
 *  - system: favour mechanic-driven arcs (world rules, constraints, physics)
 *  - chaos: favour outside-force arcs (new entities / new fates via chaos)
 */
export type ForcePreference =
  | "freeform"
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
   * Which force category to bias the plan toward. Default "freeform"
   * (no bias — LLM picks composition). "chaos" elevates chaos from
   * sparing deus-ex-machina to a primary creative engine.
   */
  forcePreference?: ForcePreference;
  /**
   * Reasoning effort for this single generation. Overrides the narrative's
   * default storySettings.reasoningLevel when provided. "small" | "medium"
   * | "large" map to low / medium / high REASONING_BUDGETS.
   */
  reasoningLevel?: "small" | "medium" | "large";
  /**
   * How the reasoner thinks. Defaults to "divergent" — branches outward
   * from the current state to expand the solution space. Alternatives:
   * "deduction" (premise → necessary consequence) and "induction"
   * (observation → inferred principle). See ReasoningMode for details.
   */
  reasoningMode?: ReasoningMode;
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

${reasoningModeBlock(guidance.reasoningMode)}

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
  "plannedNodeCount": <-- commit first; locked once nodes begin. Sets the terminal's index (N-1) in backward modes.>,
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
- **character**: WHO drives this transition. MUST have entityId. Label: character + their key action/knowledge (e.g., "Fang Yuan exploits his memory of the future"). **Distribute agency across the cast** — a plan where only the protagonist appears as a character driver is under-representing the world. Secondary characters (rivals, allies, factions' leaders) should appear as agents with their own agendas across multiple arcs, not just as obstacles for the protagonist to overcome.
- **location**: WHERE things must happen. MUST have entityId. Label: location + what it enables (e.g., "The Glacier's isolation enables secret negotiation").
- **artifact**: WHAT item shapes outcomes. MUST have entityId. Label: artifact + its role (e.g., "Spring Autumn Cicada enables time reversal").
- **system**: HOW world rules constrain. Label: the rule stated plainly (e.g., "Gu worms require regular feeding to survive").

**REASONING NODES** (causal chains — THE BACKBONE, use extensively):
- **reasoning**: Logical step in backward induction. Has arcSlot. Label: the inference in plain English (e.g., "Resolution requires controlling the inheritance first"). Detail: explain WHY this follows.

**CREATIVE AGENT NODES** (inject novelty and subvert expectations):
- **pattern**: NOVEL-PATTERN GENERATOR. Proposes a structural shape this plan has NOT used in prior arcs — a fresh arc cadence, a new relational geometry between threads, an unusual anchor type, a rhythm variation. Not generic creativity: a specific pattern the plan hasn't produced yet. Label: the new pattern (e.g., "First valley-anchored arc where the pivot comes from a peripheral character", "Two threads converge without either resolving — a shape no prior arc uses"). Before proposing, scan the plan's existing arcs for shapes already present, then propose something genuinely absent.
- **warning**: PATTERN-REPETITION DETECTOR. Flags where the plan is drifting toward shapes it has already used — three peak-anchored arcs in a row, two consecutive fate-dominant arcs, resolutions that follow the same rhythm. Humans detect structural repetition powerfully; once the plan's rhythm becomes predictable, each subsequent arc lands softer. Name the repetition concretely: "Arcs 2, 4, and 5 would all resolve via external force — reader will feel it", "Three valley-anchored arcs stacked — rhythm is flatlining".
- **chaos**: OUTSIDE FORCE — operates outside the existing fabric of fate, world, and system. Chaos has two faces: **deus-ex-machina** (brings an unexpected problem the cast must solve, or an unexpected solution the cast couldn't build — a troll crashes into the dungeon, a stranger arrives with the missing clue, a dormant artefact wakes), and **creative engine** (seeds new fate — opens threads that didn't exist, which later arcs develop and resolve). Balance is the key: a plan with a couple of chaos moments is alive; a plan without any is inert; a plan of nothing but chaos has no spine to hold onto. An arc can be CHAOS-ANCHORED when its core movement comes from outside the established world (HP's troll-in-the-dungeon and Norbert arcs are chaos-anchored; the welcoming feast is world-driven; the Quirrell climax is fate-driven). Label: what arrives and its role. DO NOT set entityId or threadId — the entity/thread is spawned via world expansion. Remember: chaos sits outside fate, but it SHAPES fate by creating new strands.

## EDGE TYPES

- **requires**: A depends on B (direction matters — A needs B, not B needs A; reversing this corrupts the graph silently)
- **enables**: A makes B possible (B could exist without A, but not here)
- **constrains**: A limits B
- **causes**: A leads to B (B would not exist without A)
- **develops**: A deepens B (use for character/thread arcs only, not generic logic steps)
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
16. **CHARACTER AGENCY (distributed across the cast — enforce concretely)**: Distribute character driving across MULTIPLE entityIds. A plan where only the protagonist appears as a character node is a plan of scenery. Concrete rules: (a) character nodes must reference AT LEAST 3 distinct entityIds across the plan; (b) at least ONE arc must be driven primarily by a non-protagonist character (their character node has more outgoing causal edges than the protagonist's in that arc); (c) every named character node MUST have at least one OUTGOING edge — a character only acted upon has no agency and should either gain an outgoing edge showing their own decision, or be absorbed into a reasoning node. Rivals, allies, mentors, and faction leaders need independent goals and hidden agendas that appear in the reasoning chain, not just reactive stances.
17. **SYSTEM CONSTRAINTS**: Include system nodes that show HOW world rules shape outcomes
18. **Warning/pattern response (CRITICAL)**: Warnings and patterns are plan-level course-corrections. When a warning names a structural repetition across arcs ("three arcs in a row would resolve via external force", "rhythm is going flat — four consecutive fate-dominant arcs"), the spine anchors, arc sizing, and composition MUST change to break it — alternate peak/valley rhythms, vary arc lengths, shift force dominance, insert a chaos-anchored arc. When a pattern proposes a novel structural shape ("valley-anchored arc pivoting on a peripheral character", "two threads converge without either resolving"), at least one actual arc in the plan MUST adopt that shape. Wire warnings/patterns to the arcs they're correcting via edges. An orphaned warning/pattern with no structural consequence is dead weight.

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
- **Pattern nodes**: At least ${nodeGuidance.minPatterns} — each introducing a structural shape absent from prior arcs in this plan
- **Warning nodes**: At least ${nodeGuidance.minWarnings} — each naming a specific repetition risk (e.g., "arcs X, Y, Z would share rhythm Q") so the plan actively routes around it
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

    // Validate and sanitize nodes. The JSON array position (original
    // emission order) becomes generationOrder — the order the reasoner
    // thought of each node. Captured BEFORE reindexing so the signature
    // of backward thinking modes survives the causal reindex below.
    const nodes: CoordinationNode[] = (data.nodes ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((n: any, i: number) => ({ n, generationOrder: i }))
      .filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ n }: { n: any }) =>
          typeof n.id === "string" &&
          typeof n.index === "number" &&
          typeof n.type === "string" &&
          typeof n.label === "string",
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map(({ n, generationOrder }: { n: any; generationOrder: number }) => ({
        id: n.id.slice(0, 20),
        index: n.index, // Will be reindexed below
        generationOrder,
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
