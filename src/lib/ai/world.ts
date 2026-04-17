import type { NarrativeState, Scene, Character, Location, Thread, ThreadDelta, RelationshipEdge, SystemNode, SystemDelta, SystemNodeType, Artifact, OwnershipDelta, TieDelta, WorldDelta, RelationshipDelta, WorldBuild, ReasoningGraphSnapshot } from '@/types/narrative';
import { THREAD_ACTIVE_STATUSES, THREAD_TERMINAL_STATUSES, resolveEntry, isScene, REASONING_BUDGETS, DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { nextId, nextIds } from '@/lib/narrative-utils';
import type { ThreadLogNodeType } from '@/types/narrative';
import { applyThreadDelta } from '@/lib/thread-log';
import { applyWorldDelta } from '@/lib/world-graph';
import { sanitizeSystemDelta, systemEdgeKey, makeSystemIdAllocator, resolveSystemConceptIds } from '@/lib/system-graph';
import { callGenerate, callGenerateStream, SYSTEM_PROMPT } from './api';
import { MAX_TOKENS_LARGE, GENERATE_MODEL } from '@/lib/constants';
import { parseJson } from './json';
import { narrativeContext } from './context';
import { PROMPT_STRUCTURAL_RULES, PROMPT_DELTAS, PROMPT_POV, PROMPT_WORLD, PROMPT_SUMMARY_REQUIREMENT, PROMPT_ENTITY_INTEGRATION, PROMPT_FORCE_STANDARDS } from './prompts';
import { logInfo } from '@/lib/system-logger';
import { generateExpansionReasoningGraph, buildSequentialPath, type ExpansionReasoningGraph } from './reasoning-graph';

/**
 * Normalize LLM-emitted entity world into the World graph shape
 * (nodes keyed by id, edges chained via co_occurs). The schema requests a
 * Record but the LLM reliably returns an array with no edges. Route the
 * initial nodes through applyWorldDelta so nodes become a Record
 * keyed by id and get chained sequentially — matching how scene
 * worldDeltas build up entity graphs across the rest of the pipeline.
 */
function normalizeInitialWorld(
  entityId: string,
  raw: unknown,
): { nodes: Record<string, { id: string; type: WorldDelta['addedNodes'][number]['type']; content: string }>; edges: { from: string; to: string; relation: string }[] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawObj = raw as any;
  const rawNodes: unknown[] = Array.isArray(rawObj?.nodes)
    ? rawObj.nodes
    : (rawObj?.nodes && typeof rawObj.nodes === 'object' ? Object.values(rawObj.nodes) : []);
  const addedNodes = rawNodes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((n: any) => n && typeof n.content === 'string' && n.content.trim())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((n: any, i: number) => ({
      id: n.id || `K-${entityId}-${String(i + 1).padStart(3, '0')}`,
      content: n.content,
      type: (n.type || 'trait') as WorldDelta['addedNodes'][number]['type'],
    }));
  return applyWorldDelta(
    { nodes: {}, edges: [] },
    { entityId, addedNodes },
  );
}

/** 1:1 with WorldExpansion fields — each toggle controls one field. */
export type ExpansionEntityFilter = {
  characters: boolean;
  locations: boolean;
  artifacts: boolean;
  threads: boolean;
  threadDeltas: boolean;
  worldDeltas: boolean;
  systemDeltas: boolean;
  relationshipDeltas: boolean;
  ownershipDeltas: boolean;
  tieDeltas: boolean;
};

export const DEFAULT_EXPANSION_FILTER: ExpansionEntityFilter = {
  characters: true, locations: true, artifacts: true,
  threads: true, threadDeltas: true, worldDeltas: true,
  systemDeltas: true, relationshipDeltas: true,
  ownershipDeltas: true, tieDeltas: true,
};

/**
 * WorldExpansionResponse — mirrors WorldExpansion 1:1 plus reasoning graph.
 * Field names match WorldExpansion so the store can spread directly.
 */
export type WorldExpansionResponse = {
  characters: Character[];
  locations: Location[];
  artifacts: Artifact[];
  threads: Thread[];
  threadDeltas?: ThreadDelta[];
  worldDeltas?: WorldDelta[];
  systemDeltas?: SystemDelta;
  relationshipDeltas?: RelationshipDelta[];
  ownershipDeltas?: OwnershipDelta[];
  tieDeltas?: TieDelta[];
  /** Reasoning graph used to plan this expansion — stored for canvas viewing */
  reasoningGraph?: ReasoningGraphSnapshot;
};

export type DirectionSuggestion = {
  text: string;
  arcName: string;
  suggestedSceneCount: number;
};

export async function suggestArcDirection(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): Promise<DirectionSuggestion> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  const prompt = `${ctx}

Based on the full scene history above, suggest the most compelling direction for the NEXT arc.
Consider:
- Unresolved threads and their current statuses
- Character tensions and relationship dynamics
- Narrative momentum (what has been building?)
- What would create the most significant development?
- How many scenes this arc needs to land properly (don't rush — quiet arcs need fewer, epic arcs need more)

Return JSON with this exact structure:
{
  "arcName": "suggested arc name",
  "direction": "2-3 sentence description of what the next arc should focus on and why",
  "sceneSuggestion": "brief outline of what kind of scenes would work",
  "suggestedSceneCount": 3
}

suggestedSceneCount must be between 1 and 8.
IMPORTANT: Use character NAMES, location NAMES, and thread DESCRIPTIONS in the direction and suggestion — never raw IDs.`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'suggestDirection', undefined, reasoningBudget);
  const parsed = parseJson(raw, 'suggestDirection') as {
    arcName?: string; direction?: string; sceneSuggestion?: string; suggestedSceneCount?: number;
  };
  const sceneCount = Math.max(1, Math.min(8, parsed.suggestedSceneCount ?? 4));
  return {
    text: `${parsed.arcName}: ${parsed.direction}${parsed.sceneSuggestion ? '\n\n' + parsed.sceneSuggestion : ''}`,
    arcName: parsed.arcName ?? '',
    suggestedSceneCount: sceneCount,
  };
}


export async function suggestAutoDirection(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): Promise<string> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  const prompt = `${ctx}

You are a showrunner planning the long-term trajectory of this story. Analyze the full narrative state — characters, threads, knowledge graphs, relationships, and scene history — and suggest a high-level STORY DIRECTION that should guide the next several arcs.

Think big picture:
- What is the central open question the story is building toward?
- Which character arcs have the most untapped potential?
- What thematic tensions could be deepened or brought into conflict?
- Where should alliances shift, secrets surface, or power dynamics change?
- What is the most satisfying macro-trajectory from where the story stands now?

Do NOT suggest a single scene or arc. Instead, describe the overarching direction the story should move in — the kind of guidance a showrunner gives a writers' room for the next season.

Use character NAMES, location NAMES, and thread DESCRIPTIONS — never raw IDs.

Return JSON: { "direction": "2-4 sentences describing the big-picture story direction" }`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'suggestStoryDirection', undefined, reasoningBudget);
  const parsed = parseJson(raw, 'suggestStoryDirection') as { direction?: string };
  return parsed.direction ?? '';
}


// ── World Metrics ────────────────────────────────────────────────────────────

export type WorldMetrics = {
  totalScenes: number;
  /** Characters */
  totalCharacters: number;
  usedCharacters: number;
  avgScenesPerCharacter: number;
  /** Characters not seen in >30% of recent scenes */
  staleCharacters: number;
  /** % of scenes the most-used character appears in */
  castConcentration: number;
  /** Average knowledge nodes per character */
  avgKnowledgePerCharacter: number;
  /** Locations */
  totalLocations: number;
  usedLocations: number;
  /** % of scenes in the most-used location */
  locationConcentration: number;
  staleLocations: number;
  /** Max depth of location nesting */
  locationDepth: number;
  /** Avg sub-locations per used location */
  avgChildrenPerLocation: number;
  /** Relationships */
  relationshipsPerCharacter: number;
  orphanedCharacters: number;
  /** Recommendation */
  recommendation: 'depth' | 'breadth' | 'balanced';
  reasoning: string;
};

/**
 * Compute measurable world metrics from the narrative state to inform expansion strategy.
 * Returns concrete numbers + a recommendation (depth/breadth/balanced) with reasoning.
 */
export function computeWorldMetrics(
  narrative: NarrativeState,
  resolvedKeys: string[],
): WorldMetrics {
  const allScenes: Scene[] = resolvedKeys
    .map((k) => resolveEntry(narrative, k))
    .filter((e): e is Scene => e !== null && isScene(e));

  const totalScenes = allScenes.length;
  const totalCharacters = Object.keys(narrative.characters).length;
  const totalLocations = Object.keys(narrative.locations).length;

  // ── Cast metrics ──────────────────────────────────────────────────
  const charScenes = new Map<string, { count: number; last: number }>();
  const locScenes = new Map<string, { count: number; last: number }>();

  for (const [i, scene] of allScenes.entries()) {
    for (const pid of scene.participantIds) {
      const ex = charScenes.get(pid);
      if (ex) { ex.count++; ex.last = i; }
      else charScenes.set(pid, { count: 1, last: i });
    }
    const ex = locScenes.get(scene.locationId);
    if (ex) { ex.count++; ex.last = i; }
    else locScenes.set(scene.locationId, { count: 1, last: i });
  }

  const usedCharacters = charScenes.size;
  const usedLocations = locScenes.size;

  const charCounts = Array.from(charScenes.values()).map((c) => c.count);
  const avgScenesPerCharacter = charCounts.length > 0 ? charCounts.reduce((a, b) => a + b, 0) / charCounts.length : 0;
  const maxCharScenes = charCounts.length > 0 ? Math.max(...charCounts) : 0;
  const castConcentration = totalScenes > 0 ? maxCharScenes / totalScenes : 0;

  const staleThreshold = Math.max(5, totalScenes * 0.3);
  const staleCharacters = Array.from(charScenes.values()).filter((c) => (totalScenes - 1 - c.last) > staleThreshold).length;

  const avgKnowledgePerCharacter = totalCharacters > 0
    ? Object.values(narrative.characters).reduce((sum, c) => sum + Object.keys(c.world?.nodes ?? {}).length, 0) / totalCharacters
    : 0;

  // ── Location metrics ──────────────────────────────────────────────
  const locCounts = Array.from(locScenes.values()).map((l) => l.count);
  const maxLocScenes = locCounts.length > 0 ? Math.max(...locCounts) : 0;
  const locationConcentration = totalScenes > 0 ? maxLocScenes / totalScenes : 0;
  const staleLocations = Array.from(locScenes.values()).filter((l) => (totalScenes - 1 - l.last) > staleThreshold).length;

  // Location depth: max nesting level
  function locDepth(locId: string, visited = new Set<string>()): number {
    if (visited.has(locId)) return 0;
    visited.add(locId);
    const children = Object.values(narrative.locations).filter((l) => l.parentId === locId);
    if (children.length === 0) return 1;
    return 1 + Math.max(...children.map((c) => locDepth(c.id, visited)));
  }
  const rootLocs = Object.values(narrative.locations).filter((l) => !l.parentId);
  const locationDepth = rootLocs.length > 0 ? Math.max(...rootLocs.map((l) => locDepth(l.id))) : 0;

  const childCounts = Object.values(narrative.locations).map((l) =>
    Object.values(narrative.locations).filter((c) => c.parentId === l.id).length
  );
  const avgChildrenPerLocation = childCounts.length > 0 ? childCounts.reduce((a, b) => a + b, 0) / childCounts.length : 0;

  // ── Relationship metrics ──────────────────────────────────────────
  const relCount = narrative.relationships.length;
  const relationshipsPerCharacter = totalCharacters > 0 ? (relCount * 2) / totalCharacters : 0;
  const connectedChars = new Set(narrative.relationships.flatMap((r) => [r.from, r.to]));
  const orphanedCharacters = Object.keys(narrative.characters).filter((id) => !connectedChars.has(id)).length;

  // ── Recommendation ────────────────────────────────────────────────
  const depthSignals: string[] = [];
  const breadthSignals: string[] = [];

  // Low knowledge density = depth needed
  if (avgKnowledgePerCharacter < 3) depthSignals.push(`low knowledge density (${avgKnowledgePerCharacter.toFixed(1)} nodes/char)`);
  // Shallow location hierarchy = depth needed
  if (locationDepth <= 2 && totalLocations > 3) depthSignals.push(`shallow location hierarchy (max depth ${locationDepth})`);
  // High cast concentration = depth needed (same few characters overused)
  if (castConcentration > 0.6) depthSignals.push(`cast concentration high (top char in ${(castConcentration * 100).toFixed(0)}% of scenes)`);
  // Low relationships = depth needed
  if (relationshipsPerCharacter < 2) depthSignals.push(`sparse relationships (${relationshipsPerCharacter.toFixed(1)}/char)`);
  // Orphaned characters = depth needed
  if (orphanedCharacters > 2) depthSignals.push(`${orphanedCharacters} orphaned characters`);

  // High location concentration = breadth needed (stuck in one place)
  if (locationConcentration > 0.5) breadthSignals.push(`scene concentration high (top location: ${(locationConcentration * 100).toFixed(0)}%)`);
  // Many stale characters = breadth needed (cast exhausted)
  if (staleCharacters > totalCharacters * 0.4) breadthSignals.push(`${staleCharacters}/${totalCharacters} characters are stale`);
  // Many stale locations = breadth needed
  if (staleLocations > totalLocations * 0.4) breadthSignals.push(`${staleLocations}/${totalLocations} locations are stale`);
  // Few locations relative to cast = breadth needed
  if (totalLocations < totalCharacters * 0.3) breadthSignals.push(`location count low relative to cast (${totalLocations} locs / ${totalCharacters} chars)`);

  let recommendation: 'depth' | 'breadth' | 'balanced';
  let reasoning: string;
  // Simple majority — any imbalance triggers a recommendation
  if (depthSignals.length > breadthSignals.length) {
    recommendation = 'depth';
    reasoning = `Depth recommended: ${depthSignals.join('; ')}`;
  } else if (breadthSignals.length > depthSignals.length) {
    recommendation = 'breadth';
    reasoning = `Breadth recommended: ${breadthSignals.join('; ')}`;
  } else {
    recommendation = 'balanced';
    reasoning = depthSignals.length + breadthSignals.length > 0
      ? `Balanced: depth signals (${depthSignals.join('; ') || 'none'}), breadth signals (${breadthSignals.join('; ') || 'none'})`
      : 'World is balanced — no strong signals in either direction';
  }

  return {
    totalScenes, totalCharacters, usedCharacters, avgScenesPerCharacter,
    staleCharacters, castConcentration, avgKnowledgePerCharacter,
    totalLocations, usedLocations, locationConcentration, staleLocations,
    locationDepth, avgChildrenPerLocation,
    relationshipsPerCharacter, orphanedCharacters,
    recommendation, reasoning,
  };
}

export type WorldExpansionSize = 'small' | 'medium' | 'large' | 'exact';
export type WorldExpansionStrategy = 'breadth' | 'depth' | 'dynamic';

const EXPANSION_SIZE_CONFIG: Record<WorldExpansionSize, { total: string; characters: string; locations: string; threads: string; label: string }> = {
  small:  { total: '3-6',   characters: '1-2',   locations: '1-2',   threads: '1-2',   label: 'a focused expansion (~5 total entities)' },
  medium: { total: '10-15', characters: '3-5',   locations: '3-4',   threads: '3-5',   label: 'a moderate expansion (~12 total entities)' },
  large:  { total: '20-35', characters: '8-15',  locations: '6-10',  threads: '8-12',  label: 'a large-scale expansion (~30 total entities)' },
  exact:  { total: 'as specified', characters: 'as specified', locations: 'as specified', threads: 'as specified', label: 'exactly what is described in the directive — nothing more, nothing less' },
};

const EXPANSION_STRATEGY_PROMPTS: Record<WorldExpansionStrategy, string> = {
  breadth: `STRATEGY: BREADTH — widen the world. Introduce new regions, factions, and characters that open up unexplored areas of the map. Focus on geographic and social variety. New locations should be INDEPENDENT zones (new settlements, distant regions, rival territories) rather than sub-locations of existing places. New characters should come from different backgrounds than existing ones. New threads should introduce entirely new conflicts, not deepen existing ones.`,

  depth: `STRATEGY: DEPTH — deepen the existing world. Do NOT add new top-level regions or distant factions. Instead:
- Add sub-locations WITHIN existing locations (rooms inside buildings, districts inside cities, hidden areas within known places)
- Add characters who are ALREADY embedded in existing social structures (subordinates, rivals, mentors, family members of existing characters)
- Add threads that complicate EXISTING tensions rather than introducing new ones
- Add rich knowledge per entity (3-4 per character, 2-3 per location) — secrets, hidden agendas, structural weaknesses, unexploited resources
- Add artifacts that are locally relevant — tools, keys, resources that matter in the current sandbox
- Focus system knowledge on the mechanics, economics, and power dynamics of the CURRENT setting
The goal is to make the existing world feel richer, not bigger. One constrained sandbox with more detail beats a sprawling map.`,

  dynamic: `STRATEGY: DYNAMIC — analyse the current world state and choose the right balance. If the world is broad but shallow (many locations, few details), go deep. If the world is deep but narrow (rich detail in one area, nothing beyond), go broad. If balanced, lean toward deepening the active area where scenes are happening while seeding one or two distant elements for future arcs. State your reasoning in a brief comment before generating.`,
};

export async function suggestWorldExpansion(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  size: WorldExpansionSize = 'medium',
  strategy: WorldExpansionStrategy = 'dynamic',
): Promise<string> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  // Build structural summary for analysis
  const charCount = Object.keys(narrative.characters).length;
  const locCount = Object.keys(narrative.locations).length;
  const threadCount = Object.keys(narrative.threads).length;
  const relCount = narrative.relationships.length;
  const orphanChars = Object.values(narrative.characters).filter(c =>
    !narrative.relationships.some(r => r.from === c.id || r.to === c.id)
  ).map(c => c.name);
  const rootLocs = Object.values(narrative.locations).filter(l => !l.parentId).map(l => l.name);
  const leafLocs = Object.values(narrative.locations).filter(l =>
    !Object.values(narrative.locations).some(other => other.parentId === l.id)
  ).map(l => l.name);

  const prompt = `${ctx}

WORLD STRUCTURE ANALYSIS:
- ${charCount} characters, ${locCount} locations, ${threadCount} threads, ${relCount} relationships
- Characters with NO relationships (orphaned): ${orphanChars.length > 0 ? orphanChars.join(', ') : 'none'}
- Top-level locations (no parent): ${rootLocs.join(', ')}
- Leaf locations (no children): ${leafLocs.join(', ')}
- Average relationships per character: ${charCount > 0 ? (relCount * 2 / charCount).toFixed(1) : 0}

The user is planning ${EXPANSION_SIZE_CONFIG[size].label} (${EXPANSION_SIZE_CONFIG[size].total} total new entities: ${EXPANSION_SIZE_CONFIG[size].characters} characters, ${EXPANSION_SIZE_CONFIG[size].locations} locations, ${EXPANSION_SIZE_CONFIG[size].threads} threads).

Based on the full narrative context and structural analysis above, suggest what NEW elements the world needs to become richer, more interconnected, and more alive. Tailor your suggestion to the expansion size — ${size === 'small' ? 'focus on the single highest-impact addition that fills the biggest gap' : size === 'medium' ? 'suggest a balanced mix that deepens existing structures and introduces new dynamics' : 'think broadly about new factions, regions, and power structures that transform the world'}.

World expansion EXTENDS the existing world — new entities must be deeply woven into the existing fabric through relationships, location hierarchies, and shared threads. Think of it as adding fuel to the fire: every new element should make the existing world burn brighter.

Consider:
- Which existing characters lack connections? Who needs rivals, allies, mentors, or kin?
- Where is the location hierarchy too flat? Which locations need sub-locations (districts, rooms, landmarks)?
- Are there implied characters, factions, or organizations referenced in scenes but never created?
- What contrasting environments would create richer scene variety (urban vs wild, sacred vs profane)?
- Which threads need new participants to develop? What new open questions would deepen the story?
- Are there power structures, social hierarchies, or institutional relationships missing?
- Could adding characters from different social strata or factions create productive tension?

Your suggestion should emphasize HOW new elements connect to existing ones — not just what to add, but who they relate to and where they fit in the hierarchy. Use character NAMES and location NAMES — never raw IDs.

Return JSON with this exact structure:
{
  "suggestion": "2-4 sentence description of what should be added to the world and WHY, with specific references to existing characters/locations that new elements should connect to"
}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'suggestWorldExpansion', undefined, reasoningBudget);
  const parsed = parseJson(raw, 'suggestWorldExpansion') as { suggestion: string };
  return parsed.suggestion;
}

export type ExpandWorldOptions = {
  /** Verbatim plan document section — guides entity creation with specific character/location/system details */
  sourceText?: string;
  /** Callback for streaming reasoning/thinking tokens */
  onReasoning?: (token: string) => void;
  /** Filter which entity types to create — disabled types are excluded from prompt and stripped from output */
  entityFilter?: ExpansionEntityFilter;
  /** When true without reasoningGraph, generates a new reasoning graph. When false, skips reasoning. */
  useReasoning?: boolean;
  /** Pre-generated reasoning graph — if provided, uses this instead of generating a new one */
  reasoningGraph?: ExpansionReasoningGraph;
};

export async function expandWorld(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  directive: string,
  size: WorldExpansionSize = 'medium',
  strategy: WorldExpansionStrategy = 'dynamic',
  /** @deprecated Use options object instead */
  sourceTextOrOptions?: string | ExpandWorldOptions,
  /** @deprecated Use options object instead */
  onReasoningLegacy?: (token: string) => void,
  /** @deprecated Use options object instead */
  entityFilterLegacy?: ExpansionEntityFilter,
): Promise<WorldExpansionResponse> {
  // Support both legacy positional args and new options object
  const options: ExpandWorldOptions = typeof sourceTextOrOptions === 'object' && sourceTextOrOptions !== null
    ? sourceTextOrOptions
    : {
        sourceText: sourceTextOrOptions,
        onReasoning: onReasoningLegacy,
        entityFilter: entityFilterLegacy,
      };
  const { sourceText, onReasoning, entityFilter, useReasoning, reasoningGraph: preGeneratedGraph } = options;

  logInfo('Starting world expansion', {
    source: 'world-expansion',
    operation: 'expand-world',
    details: {
      narrativeId: narrative.id,
      size,
      strategy,
      hasDirective: !!directive,
      hasSourceText: !!sourceText,
      useReasoning: !!useReasoning,
      hasPreGeneratedGraph: !!preGeneratedGraph,
    },
  });

  // Use pre-generated reasoning graph if provided, otherwise generate if requested
  let reasoningGraph: ExpansionReasoningGraph | undefined = preGeneratedGraph;
  if (!reasoningGraph && useReasoning) {
    reasoningGraph = await generateExpansionReasoningGraph(
      narrative,
      resolvedKeys,
      currentIndex,
      directive,
      size,
      strategy,
      onReasoning,
    );
  }

  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  // Compute next sequential IDs for the AI to use
  const nextCharId = nextId('C', Object.keys(narrative.characters));
  const nextLocId = nextId('L', Object.keys(narrative.locations));
  const nextThreadId = nextId('T', Object.keys(narrative.threads));
  const nextArtifactId = nextId('A', Object.keys(narrative.artifacts ?? {}));
  const existingKIds = [
    ...Object.values(narrative.characters).flatMap((c) => Object.keys(c.world?.nodes ?? {})),
    ...Object.values(narrative.locations).flatMap((l) => Object.keys(l.world?.nodes ?? {})),
  ];
  const nextKId = nextId('K', existingKIds);

  // Build existing entity summary for integration context
  const existingCharList = Object.values(narrative.characters).map(c => `${c.name} [${c.id}, ${c.role}]`).join(', ');
  const existingLocList = Object.values(narrative.locations).map(l => `${l.name} [${l.id}]${l.parentId ? ` (inside ${narrative.locations[l.parentId]?.name ?? l.parentId})` : ''}`).join(', ');
  const existingRelList = narrative.relationships.map(r => {
    const fromName = narrative.characters[r.from]?.name ?? r.from;
    const toName = narrative.characters[r.to]?.name ?? r.to;
    return `${fromName}→${toName}: ${r.type}`;
  }).join(', ');

  // Build strategy prompt — for dynamic, compute metrics and inject data-driven guidance
  let strategyBlock: string;
  if (strategy === 'dynamic') {
    const m = computeWorldMetrics(narrative, resolvedKeys.slice(0, currentIndex + 1));
    strategyBlock = `STRATEGY: DYNAMIC (data-driven)
WORLD METRICS:
- Cast: ${m.usedCharacters}/${m.totalCharacters} characters used, ${m.avgScenesPerCharacter.toFixed(1)} avg scenes/char, ${m.staleCharacters} stale, concentration ${(m.castConcentration * 100).toFixed(0)}%
- Knowledge: ${m.avgKnowledgePerCharacter.toFixed(1)} avg nodes/char
- Locations: ${m.usedLocations}/${m.totalLocations} used, concentration ${(m.locationConcentration * 100).toFixed(0)}%, depth ${m.locationDepth}, ${m.staleLocations} stale
- Relationships: ${m.relationshipsPerCharacter.toFixed(1)}/char, ${m.orphanedCharacters} orphaned

ANALYSIS: ${m.reasoning}
RECOMMENDATION: ${m.recommendation.toUpperCase()}

${m.recommendation === 'depth' ? EXPANSION_STRATEGY_PROMPTS.depth : m.recommendation === 'breadth' ? EXPANSION_STRATEGY_PROMPTS.breadth : `Follow the balanced approach: deepen the active sandbox (more sub-locations, embedded characters, knowledge density) while introducing 1-2 new external elements to prevent stagnation.`}`;
  } else {
    strategyBlock = EXPANSION_STRATEGY_PROMPTS[strategy];
  }

  // Build reasoning graph section if available
  const reasoningSection = reasoningGraph ? `REASONING GRAPH — THIS IS YOUR PRIMARY BRIEF. The graph below captures the strategic logic driving this expansion. Each node represents a piece of reasoning — gaps, entities, constraints, causal steps, and outcomes. Your expansion must execute this reasoning path exactly.

Expansion Summary: ${reasoningGraph.summary}

REASONING PATH (step through in order — each node shows its connections):
${buildSequentialPath(reasoningGraph)}

Read through every node. The reasoning nodes (REASONING:) are the core logic you must execute. Gap/system nodes show what's MISSING. Entity nodes (CHARACTER/LOCATION/ARTIFACT:) show what should be ADDED and how it connects. Outcome nodes (OUTCOME:) show thread effects you must deliver. Pattern nodes (PATTERN:) are opportunities to embrace. Warning nodes (WARNING:) are risks to avoid.

Edge types tell you HOW nodes relate:
- enables: A makes B possible
- constrains: A limits/blocks B
- risks: A creates danger for B
- requires: A needs B
- causes: A leads to B
- reveals: A exposes information in B
- develops: A deepens B
- resolves: A concludes B

` : '';

  const prompt = `${ctx}

${directive.trim() ? `EXPAND the world based on this directive: ${directive}` : 'EXPAND the world — analyze the current narrative state and add characters, locations, and threads that would create the most interesting new possibilities based on existing tensions and unexplored areas.'}
${sourceText ? `\nSOURCE MATERIAL (verbatim from plan document — use this as the authoritative guide for what characters, locations, systems, and entities to create. If the source names specific characters, places, or objects, create them with those exact names and roles. The source material takes priority over generic expansion.):\n${sourceText}` : ''}

${reasoningSection}${strategyBlock}

${(() => {
  const f = entityFilter ?? DEFAULT_EXPANSION_FILTER;
  const disabled = Object.entries(f).filter(([, v]) => !v).map(([k]) => k);
  if (disabled.length === 0) return '';
  const labels: Record<string, string> = { characters: 'characters', locations: 'locations', artifacts: 'artifacts', threads: 'threads', threadDeltas: 'thread deltas (status transitions on existing threads)', worldDeltas: 'world deltas (changes to existing entities)', systemDeltas: 'system deltas', relationshipDeltas: 'relationship deltas (new and shifted relationships)', ownershipDeltas: 'ownership deltas (artifact transfers)', tieDeltas: 'tie deltas (character-location bonds)' };
  return `ENTITY FILTER — DO NOT create the following types (return empty arrays for them):\n${disabled.map(k => `- NO ${labels[k]}`).join('\n')}\n`;
})()}
${size === 'exact' ? `This is an EXACT expansion — create ONLY what the directive explicitly describes. Do not add extra characters, locations, threads, or artifacts beyond what is specified. No embellishments, no "while we're at it" additions. If the directive says "add a blacksmith named Torin", create exactly that character and nothing else. Every entity in your response must trace directly to something stated in the directive.` : `This is ${EXPANSION_SIZE_CONFIG[size].label} (${EXPANSION_SIZE_CONFIG[size].total} total new entities). Generate:
- ${EXPANSION_SIZE_CONFIG[size].characters} new characters
- ${EXPANSION_SIZE_CONFIG[size].locations} new locations
- ${EXPANSION_SIZE_CONFIG[size].threads} new threads`}
- relationshipDeltas connecting new characters to EXISTING characters (this is critical — use valenceDelta as initial valence for new pairs)
- Artifacts if the directive or narrative calls for them — objects that grant characters capabilities and drive acquisition, conflict, or discovery. Not every expansion needs artifacts, but consider whether the new world elements would benefit from tangible tools, relics, or items that characters can use and fight over.

EXISTING ENTITIES (you MUST reference these to integrate new content):
Characters: ${existingCharList}
Locations: ${existingLocList}
Existing relationships: ${existingRelList || 'none yet'}

World expansion EXTENDS the existing world — new entities must be woven into the existing fabric through relationships, location hierarchies, and shared threads. Orphaned, disconnected entities are useless.

Use sequential IDs continuing from the existing ones.

Return JSON with this exact structure:
{
  "characters": [
    {
      "id": "${nextCharId}",
      "name": "Full name matching the cultural palette of the world — rough, asymmetric, lived-in",
      "role": "anchor|recurring|transient",
      "threadIds": [],
      "imagePrompt": "1-2 sentence LITERAL physical description: concrete traits like hair colour, build, clothing style. Never use metaphors, similes, or figurative language — image generators interpret them literally.",
      "world": {
        "nodes": [{"id": "${nextKId}", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "15-25 words, PRESENT tense: a stable fact about this character — trait, belief, capability, state, secret, goal, or weakness"}]
      }
    }
  ],
  "locations": [
    {
      "id": "${nextLocId}",
      "name": "Location name from geography, founders, or corrupted older words — concrete and specific",
      "parentId": "REQUIRED: existing location ID (e.g. L-01) to nest under, or null ONLY for top-level regions",
      "tiedCharacterIds": ["character IDs with a significant tie to this location — residents, employees, faction members, students. Ties represent gravity and belonging, not just presence"],
      "threadIds": [],
      "imagePrompt": "1-2 sentence LITERAL visual description: architecture, landscape, lighting, weather. Use concrete physical details only — no metaphors, similes, or figurative language. Image generators interpret them literally.",
      "world": {
        "nodes": [{"id": "K-next", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "15-25 words, PRESENT tense: a stable fact about this location — history, rules, dangers, atmosphere, or properties"}]
      }
    }
  ],
  "threads": [
    {
      "id": "${nextThreadId}",
      "participants": [{"id": "character or location ID", "type": "character|location", "stake": "3-8 words: what this participant wants from resolution"}],
      "description": "Frame as a QUESTION: 'Will X succeed?' 'Can Y be trusted?' 'What is the truth behind Z?' — 15-30 words, specific conflict",
      "status": "latent",
      "openedAt": "new",
      "dependents": ["T-XX (existing thread IDs this thread connects to, accelerates, or converges with)"],
      "payoffMatrices": [{"playerA": "C-XX", "playerB": "C-YY",
        "actionA": "2-5 words: A's cooperative action", "defectA": "2-5 words: A's defect action",
        "actionB": "2-5 words: B's cooperative action", "defectB": "2-5 words: B's defect action",
        "cc": {"outcome": "5-15 words", "payoffA": 3, "payoffB": 3},
        "cd": {"outcome": "5-15 words", "payoffA": 1, "payoffB": 4},
        "dc": {"outcome": "5-15 words", "payoffA": 4, "payoffB": 1},
        "dd": {"outcome": "5-15 words", "payoffA": 2, "payoffB": 2}
      }]
    }
  ],
  "artifacts": [
    {
      "id": "${nextArtifactId}",
      "name": "Artifact name — concrete and specific to its function or origin",
      "significance": "key|notable|minor",
      "parentId": "owner — a character or location ID, or null for world-owned (communally available to all)",
      "world": {"nodes": [{"id": "K-next", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "15-25 words, PRESENT tense: what this artifact is, what it does, its history, powers, or limitations"}]},
      "imagePrompt": "1-2 sentence LITERAL visual description — concrete physical details only, no metaphors or figurative language"
    }
  ],
  "systemDeltas": {
    "addedNodes": [{"id": "SYS-GEN-001", "concept": "15-25 words, PRESENT tense: a general rule or structural fact about how the world works — no specific characters or events", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}],
    "addedEdges": [{"from": "SYS-GEN-001", "to": "existing-SYS-ID", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]
  },
  "threadDeltas": [{"threadId": "T-XX", "from": "latent", "to": "seeded", "addedNodes": [{"id": "TL-GEN-001", "matrixCell": "cc|cd|dc|dd", "actorId": "C-XX", "targetId": "C-YY or null", "stance": "cooperative|competitive|neutral", "type": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall", "content": "10-20 words: what happened to this thread"}]}],
  "worldDeltas": [{"entityId": "existing C-XX, L-XX, or A-XX", "addedNodes": [{"id": "K-next", "content": "15-25 words, PRESENT tense: a stable fact about the entity — what they experienced, became, or now possess", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}],
  "relationshipDeltas": [{"from": "C-XX", "to": "C-YY", "type": "description", "valenceDelta": 0.1}],
  "ownershipDeltas": [{"artifactId": "A-XX", "fromId": "C-XX or L-XX", "toId": "C-YY or L-YY"}],
  "tieDeltas": [{"locationId": "L-XX", "characterId": "C-XX", "action": "add|remove"}]
}

ID RULES:
- Character IDs: continue sequentially from ${nextCharId} (e.g., ${nextCharId}, C-${String(parseInt(nextCharId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- Location IDs: continue sequentially from ${nextLocId} (e.g., ${nextLocId}, L-${String(parseInt(nextLocId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- Thread IDs: continue sequentially from ${nextThreadId} (e.g., ${nextThreadId}, T-${String(parseInt(nextThreadId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- Artifact IDs: continue sequentially from ${nextArtifactId} (e.g., ${nextArtifactId}, A-${String(parseInt(nextArtifactId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- Knowledge node IDs: continue sequentially from ${nextKId} (e.g., ${nextKId}, K-${String(parseInt(nextKId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- ALL knowledge nodes (in both characters and locations) use the K- prefix and share one sequence

${PROMPT_ENTITY_INTEGRATION}

EXPANSION-SPECIFIC RULES:
- Generate at MINIMUM ${EXPANSION_SIZE_CONFIG[size].characters === '1-2' ? '2' : EXPANSION_SIZE_CONFIG[size].characters === '3-5' ? '5' : '12'} relationshipDeltas total. Most should connect new→existing characters. Use valenceDelta as initial valence for new pairs. Include varied valences (allies, rivals, mentors, kin). At least one with tension.
- Key artifacts should have 3-4 world nodes (what it does, its origin, its limitation). Only create artifacts when they meaningfully alter what characters can do.

NAMING:
- All new names must match the cultural palette and naming conventions already established in the world. Study the existing character and location names and produce names from the same linguistic roots.
- Source from real census records, historical obscurities, occupational surnames, or regional dialects. Names should feel rough, asymmetric, and lived-in — never smooth or melodic in a generic way.
- Location names from geography, founders, or corrupted older words. Thread names concrete and specific.

CONTENT RULES:
- Characters should have meaningful knowledge (3-5 nodes). Give each character SECRETS or unique knowledge that only they possess — knowledge asymmetries drive narrative tension. Include at least one hidden or dangerous piece of knowledge per character.
- Knowledge node types should be SPECIFIC and CONTEXTUAL — not generic labels. Examples: "cultivation_technique", "blood_pact", "hidden_treasury", "ancient_prophecy", "political_alliance", "forbidden_memory", "territorial_claim", "ancestral_grudge". Pick types that fit the narrative world.
- New locations should CONTRAST with existing ones — if the story has been set in cities, add wilderness; if in palaces, add slums or ruins. Environmental variety drives scene variety.
- Location knowledge should establish what makes each place narratively distinct (2-3 nodes per location — its defining atmosphere, a constraint or danger, and a resource or opportunity it offers)
- Threads should introduce DIFFERENT types of open questions than existing ones — if current threads are about conflict, add threads about mystery, loyalty, or forbidden knowledge.
- ALL new threads MUST have status "latent" — they are seeds for future arcs, not active storylines yet
- ALL new threads with 2+ participants MUST have payoffMatrices — one 2×2 matrix per participant pair. Cooperate = advance the thread; Defect = block/exploit. Payoffs are 1-4 (4=best). Think about what each participant wants and how outcomes differ when they cooperate vs defect against each other.
- Generate the exact counts specified above (${EXPANSION_SIZE_CONFIG[size].characters} characters, ${EXPANSION_SIZE_CONFIG[size].locations} locations, ${EXPANSION_SIZE_CONFIG[size].threads} threads)

THREAD CONVERGENCE (critical for long-form narrative):
- The "dependents" field lists EXISTING thread IDs that this new thread connects to, accelerates, or converges with. This is how storylines collide.
- A convergent thread is one whose activation or resolution forces multiple existing threads into new trajectories. Example: a resource thread (T-new) that depends on [T-03, T-07] means when this resource thread activates, it creates pressure on both T-03 and T-07 simultaneously.
- At least ONE new thread should have 2+ dependents — this is a convergent bridge thread that forces collision between existing storylines.
- Dependents should reference threads that are currently in different storylines or involve different characters — the whole point is to CREATE connections between threads that were previously parallel.
- Think: shared resources both factions need, events that affect multiple storylines, secrets that connect separated characters, external forces that compress multiple conflicts.
- Empty dependents [] is acceptable for truly independent new threads, but at least one thread per expansion MUST bridge existing threads.

SYSTEM KNOWLEDGE DELTAS:
systemDeltas define the FOUNDATIONAL abstractions this expansion establishes — the rules, systems, concepts, and tensions that the new characters, locations, and threads operate within. These are intentional world-building, not incidental discovery.
- Use "principle" for fundamental truths, "system" for mechanisms/institutions, "concept" for abstract ideas, "tension" for contradictions, "event" for world-level occurrences, "structure" for organizations/factions, "environment" for geography/climate, "convention" for customs/norms, "constraint" for scarcities/limitations.
- Node IDs should be SYS-GEN-001, SYS-GEN-002, etc. (they will be re-mapped to real IDs).
- Edges can reference both new SYS-GEN-* IDs and existing system knowledge IDs already in the narrative.
- Generate ${size === 'small' ? '4-6' : size === 'medium' ? '8-12' : size === 'exact' ? 'as many as the directive calls for' : '15-25'} system knowledge nodes with a comparable number of edges. Each must be a genuine structural rule or system that the new entities operate within. EDGES ARE CRITICAL — an isolated node contributes 1 to system, but an edge connecting it to existing WK adds √1 more AND wires the expansion into the existing graph.
- At least HALF of your edges should cross the new/existing boundary — use existing WK IDs from the narrative context, not just SYS-GEN-* → SYS-GEN-*. This is how expansions deepen the foundation instead of floating free.
- Focus on the structural WHY behind the expansion — what abstract rules, power structures, or tensions make these new entities meaningful?`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = onReasoning
    ? await callGenerateStream(prompt, SYSTEM_PROMPT, () => {}, undefined, 'expandWorld', undefined, reasoningBudget, onReasoning)
    : await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'expandWorld', undefined, reasoningBudget);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJson(raw, 'expandWorld') as any;

  // Force all world-build threads to latent — they're seeds, not active storylines
  // Normalize: LLM may still output "anchors" (legacy field name) — remap to "participants"
  // Validate dependents — only keep IDs that reference real existing or new threads
  const newThreadIds = new Set((parsed.threads ?? []).map((t: { id: string }) => t.id));
  const existingThreadIds = new Set(Object.keys(narrative.threads));
  const validThreadIds = new Set([...newThreadIds, ...existingThreadIds]);

  const threads = (parsed.threads ?? []).map((t: Thread & { anchors?: Thread['participants'] }) => {
    const { anchors, ...rest } = t;
    // Filter dependents to only valid thread IDs (not example text the LLM might echo)
    const dependents = (rest.dependents ?? []).filter((id: string) => validThreadIds.has(id) && id !== rest.id);
    return { ...rest, participants: rest.participants ?? anchors ?? [], dependents, status: THREAD_ACTIVE_STATUSES[0] };
  });

  // Process systemDeltas: concept-based resolution collapses
  // re-mentioned concepts to their existing id, then sanitize filters self-
  // loops, orphans, and edges that duplicate ones already in the graph.
  let systemDeltas: SystemDelta | undefined;
  const rawWKM = parsed.systemDeltas;
  if (rawWKM && Array.isArray(rawWKM.addedNodes) && rawWKM.addedNodes.length > 0) {
    const existingWkNodes = narrative.systemGraph?.nodes ?? {};

    // Normalize raw nodes so they satisfy the resolver's input shape —
    // every node must have an id placeholder, a concept, and a type.
    const rawNormalized = rawWKM.addedNodes.map(
      (node: { id: string; concept: string; type: string }, i: number) => ({
        id: node.id || `SYS-GEN-${i}`,
        concept: node.concept,
        type: (node.type || 'concept') as SystemNodeType,
      }),
    );
    const allocateFreshWkId = makeSystemIdAllocator(Object.keys(existingWkNodes));
    const resolved = resolveSystemConceptIds(rawNormalized, existingWkNodes, allocateFreshWkId);

    const validWKIds = new Set<string>([
      ...Object.keys(existingWkNodes),
      ...resolved.newNodes.map((n) => n.id),
    ]);
    const remappedEdges = (rawWKM.addedEdges ?? []).map(
      (edge: { from: string; to: string; relation: string }) => ({
        from: resolved.idMap[edge.from] ?? edge.from,
        to: resolved.idMap[edge.to] ?? edge.to,
        relation: edge.relation,
      }),
    );

    const seenEdgeKeys = new Set<string>();
    for (const e of narrative.systemGraph?.edges ?? []) seenEdgeKeys.add(systemEdgeKey(e));

    systemDeltas = { addedNodes: resolved.newNodes, addedEdges: remappedEdges };
    sanitizeSystemDelta(systemDeltas, validWKIds, seenEdgeKeys);
  }

  // Apply entity filter — strip types the user disabled. Freshly-created
  // entities have their LLM-emitted world normalized (array → Record)
  // and chained via co_occurs through applyWorldDelta.
  // Fallback: accept legacy "continuity" field name if "world" is absent.
  const f = entityFilter ?? DEFAULT_EXPANSION_FILTER;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalizedCharacters = (parsed.characters ?? []).map((c: any) => ({
    ...c,
    threadIds: c.threadIds ?? [],
    world: normalizeInitialWorld(c.id, c.world ?? c.continuity),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalizedLocations = (parsed.locations ?? []).map((l: any) => ({
    ...l,
    threadIds: l.threadIds ?? [],
    tiedCharacterIds: l.tiedCharacterIds ?? [],
    world: normalizeInitialWorld(l.id, l.world ?? l.continuity),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalizedArtifacts = (parsed.artifacts ?? []).map((a: any) => ({
    ...a,
    threadIds: a.threadIds ?? [],
    world: normalizeInitialWorld(a.id, a.world ?? a.continuity),
  }));
  // Convert expansion reasoning graph to snapshot format for storage
  const reasoningGraphSnapshot: ReasoningGraphSnapshot | undefined = reasoningGraph
    ? {
        nodes: reasoningGraph.nodes,
        edges: reasoningGraph.edges,
        arcName: reasoningGraph.expansionName,
        sceneCount: 0, // World expansions don't have scenes
        summary: reasoningGraph.summary,
      }
    : undefined;

  // Merge legacy "relationships" array (valence → valenceDelta) into relationshipDeltas
  const mergedRelDeltas: RelationshipDelta[] = [
    ...(parsed.relationships ?? []).map((r: RelationshipEdge) => ({
      from: r.from, to: r.to, type: r.type, valenceDelta: r.valence,
    })),
    ...(parsed.relationshipDeltas ?? []),
  ];

  const result: WorldExpansionResponse = {
    characters: f.characters ? normalizedCharacters : [],
    locations: f.locations ? normalizedLocations : [],
    artifacts: f.artifacts ? normalizedArtifacts : [],
    threads: f.threads ? threads : [],
    threadDeltas: f.threadDeltas ? (parsed.threadDeltas ?? []) : [],
    worldDeltas: f.worldDeltas ? (parsed.worldDeltas ?? []) : [],
    systemDeltas: f.systemDeltas ? systemDeltas : undefined,
    relationshipDeltas: f.relationshipDeltas ? mergedRelDeltas : [],
    ownershipDeltas: f.ownershipDeltas ? (parsed.ownershipDeltas ?? []) : [],
    tieDeltas: f.tieDeltas ? (parsed.tieDeltas ?? []) : [],
    reasoningGraph: reasoningGraphSnapshot,
  };

  logInfo('Completed world expansion', {
    source: 'world-expansion',
    operation: 'expand-world-complete',
    details: {
      narrativeId: narrative.id,
      charactersAdded: result.characters.length,
      locationsAdded: result.locations.length,
      threadsAdded: result.threads.length,
      artifactsAdded: result.artifacts.length,
      relationshipDeltaCount: result.relationshipDeltas?.length ?? 0,
      systemNodeCount: result.systemDeltas?.addedNodes.length ?? 0,
    },
  });

  return result;
}

export async function generateNarrative(
  title: string,
  premise: string,
  onReasoning?: (token: string) => void,
  /** When true: generate world entities only — no introduction arc or scenes.
   *  The premise is treated as a full story plan / world bible to seed from. */
  worldOnly = false,
): Promise<NarrativeState> {
  logInfo('Starting narrative generation', {
    source: 'manual-generation',
    operation: 'generate-narrative',
    details: {
      title,
      worldOnly,
    },
  });

  const prompt = `${worldOnly
    ? 'Extract and build a complete narrative world from the following story plan. Do NOT generate scenes or arcs — output world entities only (characters, locations, threads, relationships, artifacts, rules, systems, prose profile).'
    : 'Create a complete narrative world for:'}
Title: "${title}"
${worldOnly ? 'Story plan' : 'Premise'}: ${premise}

Return JSON with this exact structure:
{
  "worldSummary": "2-3 sentence world description",
  "imageStyle": "A concise visual style directive for all generated images (e.g. 'watercolour style with soft lighting'). Should capture the tone, medium, palette, and aesthetic that best fits this world.",
  "characters": [
    {"id": "C-01", "name": "Full name matching the cultural palette of the world — rough, asymmetric, lived-in", "role": "anchor|recurring|transient", "threadIds": ["T-01"], "imagePrompt": "1-2 sentence LITERAL physical description — concrete traits (hair colour, build, clothing). No metaphors or figurative language; image generators interpret literally.", "world": {"nodes": [{"id": "K-01", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "15-25 words, PRESENT tense: a stable fact about this character — trait, belief, capability, state, secret, goal, or weakness"}]}}
  ],
  "locations": [
    {"id": "L-01", "name": "Location name from geography, founders, or corrupted older words — concrete and specific", "prominence": "domain|place|margin", "parentId": null, "threadIds": [], "imagePrompt": "1-2 sentence LITERAL visual description — concrete architecture, landscape, lighting. No metaphors or figurative language; image generators interpret literally.", "world": {"nodes": [{"id": "LK-01", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "15-25 words, PRESENT tense: a stable fact about this location — history, rules, dangers, atmosphere, or properties"}]}}
  ],
  "threads": [
    {"id": "T-01", "participants": [{"id": "C-01", "type": "character|location|artifact", "stake": "3-8 words: what they want"}], "description": "Frame as a QUESTION — 15-30 words, specific", "status": "latent", "openedAt": "S-001", "dependents": [], "payoffMatrices": [{"playerA": "C-01", "playerB": "C-02", "actionA": "A's cooperative action", "defectA": "A's defect action", "actionB": "B's cooperative action", "defectB": "B's defect action", "cc": {"outcome": "both cooperate", "payoffA": 3, "payoffB": 3}, "cd": {"outcome": "A cooperates B defects", "payoffA": 1, "payoffB": 4}, "dc": {"outcome": "A defects B cooperates", "payoffA": 4, "payoffB": 1}, "dd": {"outcome": "both defect", "payoffA": 2, "payoffB": 2}}]}
  ],
  "relationshipDeltas": [
    {"from": "C-01", "to": "C-02", "type": "description", "valenceDelta": 0.5}
  ],
  "artifacts": [
    {"id": "A-01", "name": "Artifact name — concrete and specific to its function or origin", "significance": "key|notable|minor", "threadIds": [], "parentId": "character or location ID, or null for world-owned", "world": {"nodes": [{"id": "AK-01", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "15-25 words, PRESENT tense: what this artifact is, what it does, its history, powers, or limitations"}]}, "imagePrompt": "1-2 sentence LITERAL visual description — concrete physical details only, no metaphors or figurative language"}
  ],${worldOnly ? `
  "systemDeltas": {"addedNodes": [{"id": "SYS-01", "concept": "15-25 words, PRESENT tense: a general rule or structural fact about how the world works — no specific characters or events", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"from": "SYS-01", "to": "SYS-02", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]},` : `
  "scenes": [
    {
      "id": "S-001",
      "arcId": "ARC-01",
      "locationId": "L-01",
      "povId": "C-01",
      "participantIds": ["C-01"],
      "summary": "REQUIRED — WRITE THIS FIRST. This is the spine of the scene; every delta below must trace back to something stated here. Rich prose sentences using character NAMES and location NAMES (never raw IDs). Include specifics: actions, consequences, dialogue snippets. Include any context that shapes how the scene is written (time span, technique, tone). No sentences ending in emotions or realizations.",
      "artifactUsages": [{"artifactId": "A-XX", "characterId": "C-XX", "usage": "what the artifact did — how it delivered utility"}],
      "events": ["event_tag"],
      "threadDeltas": [{"threadId": "T-01", "from": "...", "to": "...", "addedNodes": [{"id": "TK-GEN-001", "matrixCell": "cc|cd|dc|dd", "actorId": "C-XX", "targetId": "C-YY or null", "stance": "cooperative|competitive|neutral", "type": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall", "content": "what happened to this thread"}]}],
      "worldDeltas": [{"entityId": "C-XX", "addedNodes": [{"id": "K-GEN-001", "content": "15-25 words, PRESENT tense: a stable fact about the entity — what they experienced, became, or now possess", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}],
      "relationshipDeltas": [],
      "systemDeltas": {"addedNodes": [{"id": "SYS-GEN-001", "concept": "15-25 words, PRESENT tense: a general rule or structural fact about how the world works — no specific characters or events", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"from": "SYS-GEN-001", "to": "SYS-GEN-002", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]}
    }
  ],
  "arcs": [
    {"id": "ARC-01", "name": "Arc name — a short thematic label for this story segment", "sceneIds": ["S-001"], "develops": ["T-01"], "locationIds": ["L-01"], "activeCharacterIds": ["C-01"], "initialCharacterLocations": {"C-01": "L-01"}}
  ],`}
  "proseProfile": {
    "register": "the tonal register (conversational/literary/raw/clinical/sardonic/lyrical/mythic/journalistic or other)",
    "stance": "narrative stance (close_third/intimate_first_person/omniscient_ironic/detached_observer/unreliable_first or other)",
    "tense": "past or present",
    "sentenceRhythm": "terse/varied/flowing/staccato/periodic or other",
    "interiority": "surface/moderate/deep/embedded",
    "dialogueWeight": "sparse/moderate/heavy/almost_none",
    "devices": ["2-4 literary devices that suit this world's tone"],
    "rules": ["3-6 SPECIFIC prose rules as imperatives — these must be concrete enough to apply sentence-by-sentence. BAD: 'Write well'. GOOD: 'Show emotion through physical reaction, never name it' / 'No figurative language — just plain statements of fact' / 'Terse does not mean monotone — vary between clipped fragments and occasional longer compound sentences'"],
    "antiPatterns": ["3-5 SPECIFIC prose failures to avoid — concrete patterns that break this voice. BAD: 'Don't be boring'. GOOD: 'NEVER use \"This was a [Name]\" to introduce a mechanic — show what it does, not what it is called' / 'No strategic summaries in internal monologue (\"He calculated that...\") — show calculation through action' / 'Do not follow a system reveal with a sentence restating its significance' / 'Do not write narrator summaries of what the character already achieved on-page'"]
  },
  "planGuidance": "2-4 sentences of specific guidance for scene beat plans. What mechanisms should dominate? How should exposition be handled? What should plans avoid? EXAMPLE: 'Prioritise action and dialogue beats over narration. System mechanics revealed through usage, never expository narration beats. Internal monologue should be tactical and clipped. Plans should never include a beat whose purpose is to explain a concept that was already demonstrated in a prior beat.'",
  "patterns": ["3-5 positive thematic commandments derived from THIS story's GENRE. First identify the genre/subgenre (progression fantasy, space opera, cozy mystery, dark romance, LitRPG, etc), then extract patterns that make stories in this tradition succeed: genre-specific tropes to embrace (e.g. 'Power scaling follows satisfying tiers'), structural rhythms (e.g. 'Each arc ends with breakthrough and cost'), character dynamics typical of the genre (e.g. 'Rivals become reluctant allies'). EXAMPLES: 'Every cost paid must compound into later consequence', 'The underdog earns every advantage through sacrifice, never luck'"],
  "antiPatterns": ["3-5 negative story commandments — common pitfalls in THIS genre to avoid. Genre-specific tropes to subvert or skip (e.g. 'No harem dynamics'), common genre failures (e.g. 'No convenient power-ups without setup'), patterns that would break this work's tone. EXAMPLES: 'No deus ex machina rescues', 'Antagonists cannot be stupid just to let protagonists win', 'No info-dumps disguised as dialogue'"]
}

PILOT EPISODE — establish a tight, focused world. These are minimums; exceed when the premise warrants it:
- AT LEAST 8 characters: 2+ anchors, 3+ recurring, 3+ transient
- AT LEAST 6 locations with parent/child hierarchy (at least 2 nesting levels)
- AT LEAST 4 threads — 1+ short-term, 1+ medium-term, 2+ long-term. Threads force entities into action. At least 2 must share participants.
- AT LEAST 8 relationships (at least 1 hostile)
- AT LEAST 1 artifact when the premise involves tools or objects of power
- AT LEAST 12 system nodes with 8 edges — the systems, principles, tensions, and structures the world runs on. This is the foundational system graph every future scene draws from; a thin root means thin scenes forever. Each node MUST be 15-25 words describing a general rule or structural fact (how the world works). Include micro-rules (specific mechanics), mid-rules (institutional/economic), and macro-rules (cosmological/thematic). SHORT NAMES ARE FAILURES — "Aperture Grading" is wrong; "The sect grades disciples by aperture quality, with A-grade apertures receiving priority resource allocation and mentorship" is correct.${worldOnly ? '' : `
- AT LEAST 8 scenes in 1 arc, AVERAGING ~12 world nodes and ~3 system nodes per scene (these are the grading reference means). Some scenes quiet, some dense — but the MEAN across the arc must hit the reference or the whole pilot grades in the 60s. A typical scene touches 3-5 entities with 10-14 world nodes and reveals 2-4 system concepts; climactic scenes push to 16-20+ world and 5-8 system.`}

SEEDING FATE — a great world is pregnant with story. Every entity you create should carry the seeds of future conflict:
- Threads are fate's mechanism — each thread is a COMPELLING question (stakes + uncertainty + investment) the story MUST eventually answer
- Characters carry secrets that WILL come out, goals that WILL collide, relationships that WILL be tested
- Locations hold histories that WILL matter, resources that WILL be contested, rules that WILL constrain
- Artifacts have costs that WILL be paid, powers that WILL corrupt, origins that WILL be revealed
- Systems create pressures that WILL force action — scarcity breeds conflict, power demands trade-offs
- The reader should sense from page one that SOMETHING LARGER IS COMING. Every detail is a fuse; you're laying the powder trail
- Plant surprises: at least 2 characters should have secrets even the reader doesn't know yet (these go in world nodes of type "secret")
- Create asymmetries: what Character A believes about Character B should differ from reality in ways that will explode later
- Build pressure: threads should share participants so collision is INEVITABLE, not coincidental
- PAYOFF MATRICES: every thread with 2+ participants MUST include a payoffMatrices array — one 2×2 game per participant pair. Think: what does each player want? If both cooperate (advance the thread), what happens? If one defects (blocks/exploits), what happens? If both defect, what happens? Rank the four outcomes 1-4 for each player (4=best). This is how we capture the strategic structure of fate.

ENTITY DEFINITIONS:
- Characters are conscious beings with agency — people, named animals, sentient AI (AGI). Non-sentient AI systems are artifacts.
- Locations are spatial areas or regions — physical places you can be IN.
- Artifacts are anything that delivers utility — active tools, not passive concepts. Concepts belong in system knowledge.
- Threads are COMPELLING QUESTIONS that shape fate. A compelling question has stakes, uncertainty, and investment. Match the narrative's register. BAD: "Will X succeed?" GOOD (narrative): "Can Ayesha clear her grandfather's name before the tribunal ends?" GOOD (argument): "Does the proposed mechanism explain the anomalies the prior model cannot?" GOOD (inquiry): "What role did diaspora networks play in the movement before digital coordination?" Thread logs track incremental answers.

CHARACTER DEPTH BY ROLE — minimums; go deeper for complex characters. These initial world nodes become the first readings the grader sees, and anchor entities will be revisited for world deltas across every scene, so seed them richly. List each entity's nodes in the causal/temporal order they became true — adjacent nodes auto-chain into the entity's inner graph, no manual edges needed:
- Anchors: 6-8 world nodes each — defining trait, goal, belief, weakness, secret, capability, relation, history.
- Recurring: 3-4 world nodes each — role, relationship to an anchor, one hidden dimension, one capability or limitation.
- Transient: 1-2 world nodes each — their function and a distinguishing trait.

SEED DATA vs. BARE PREMISE:
The premise may include user-provided characters, locations, threads, rules, and systems. Handle both cases:
- IF seeded: Use the provided entities as anchors and starting points. Expand the world around them — add supporting cast, sub-locations, connecting threads. Honour the user's descriptions and relationships but deepen them with secrets, contradictions, and hidden connections. The user's input is the skeleton; you build the muscle and skin.
- IF bare premise (just a concept/genre/theme with no entities): Interpret the premise ambitiously. Extrapolate a full world with factions, geography, history, and power structures. A one-line prompt like "kung fu monks in space" should produce a world as rich and specific as one seeded with 20 entities. Do not produce a thin world just because the input was thin.

NAMING — CRITICAL:
The premise may contain placeholder or generic names (e.g. "The Reincarnator", "The Elder Council", "Shadow Realm"). Replace ALL placeholder names with original, specific names. Naming is the single biggest quality signal.

Name like a writer with cultural specificity, not a fantasy name generator:
- FIRST: detect the cultural origin implied by the premise. Never default to Anglo/Celtic/Greek. Palettes include (non-exhaustive):
    • East Asian — Han Chinese (classical / modern), Japanese (kun/on readings), Korean, Vietnamese, Mongolian
    • South Asian — Sanskrit, Tamil/Dravidian, Bengali, Punjabi, Sinhala, Pashto
    • Middle Eastern / West Asian — Arabic, Persian/Farsi, Turkish, Hebrew, Aramaic, Kurdish
    • African — Yoruba, Igbo, Akan, Amharic, Swahili, Zulu, Wolof, Hausa, Malagasy, Tamazight
    • Indigenous — Nahuatl, Quechua, Navajo, Cree, Māori, Hawaiian, Sami (use respectfully, avoid sacred/taboo names)
    • Slavic, Baltic, Nordic, Celtic, Greek, Latin — treat these as one palette among many, not the default
    • Latin American, Caribbean, Lusophone African, Filipino, Indonesian, Malay — use for regions inspired by colonial/post-colonial or maritime cultures
    • Diasporic & multicultural — names that mark hybridity (e.g. Chinese-Peruvian, Lebanese-Brazilian, British-Nigerian) where the premise calls for it
- Source names from real census records, historical obscurities, regional naming traditions, or deliberate etymological construction rooted in SPECIFIC cultures matching the world's origin. A world inspired by Song Dynasty China should have names sourced from Chinese historical records. A world inspired by Ottoman history from Turkish/Arabic/Persian roots. A West African-inspired world from Yoruba, Akan, or Wolof roots. A Sanskrit-inflected world from Vedic or Tamil sources.
- For multicultural worlds: each faction, region, or cultural group gets its own distinct naming palette reflecting its origin. Names should signal which part of the world a character comes from.
- Pick a consistent cultural palette for each faction or region and stay within it. Internal consistency is more important than variety.
- Prefer rough, blunt, asymmetric names where the source tradition allows it. Names with hard consonant clusters, unexpected syllable stress, tonal marks, or occupational origins feel lived-in. Smooth melodic names with open vowels feel generated — unless the palette is genuinely melodic (e.g. Hawaiian, Japanese), in which case lean into the tradition's own texture.
- Surnames from occupations, geography, patronymics/matronymics, or clan names — never compound noun+noun fantasy construction.
- Location names: derive from terrain, founders, or linguistic corruption of older words. They should sound like they've been mispronounced for centuries within their own language family.
- Thread/system names: concrete and specific. "The Tithe of Ash" not "The Power System". "The Lazar Compact" not "The Ancient Alliance". Match the cultural palette — a Mughal-inspired system might be "The Mansabdari Ledger", a West African one "The Ọba's Covenant".
- Test: if a name could appear in 10 different Anglo-fantasy novels interchangeably, it's too generic. If it could only belong to THIS world and this culture, it's right.
- Respect: when drawing from Indigenous or living religious traditions, avoid names with explicit sacred/taboo status. Use the tradition's everyday register, not its ceremonial one, unless the premise explicitly calls for the latter and handles it with weight.

LOCATION HIERARCHY & AGENCY:
- Build spatial nesting: Region → Settlement → District → Specific Place
- A city with 5 sub-locations feels more real than 5 unconnected cities
- Include contrasting environments: if the story starts safe, the world needs a dangerous frontier
- A location is BOTH a place AND its people. A delta village is its floodplain AND its fishers AND its song cycles. A city is infrastructure AND culture AND collective will. A kingdom is territory AND governance AND identity. A monastery is cells AND its order. A research institute is buildings AND its reviewers. Locations think, feel, and act through their inhabitants.
- Prominence: "domain" locations are centers of power with deep inner worlds, "place" locations are recurring settings, "margin" locations are transitional.
- Domain locations: 4-6 world nodes (history, traits, capabilities, weaknesses, goals, beliefs). They impose rules on characters and have collective agency — a kingdom demands fealty, a city mourns its dead, an organization pursues its agenda.
- Place locations: 2-3 world nodes (history, state, trait).
- Margin locations: 1 world node (trait or state).

RELATIONSHIPS:
- Connect anchors to MANY characters (6+ relationships per anchor)
- Asymmetric descriptions: "A admires B" while "B suspects A"
- At least 2 hidden relationships (known to reader, not to characters)

ARTIFACTS & TOOLS:
- Artifacts are things that by themselves can provide utility. They extend what's possible — a magical weapon changes how someone fights, AI technology changes the scale of thought, a cursed ring slowly consumes its bearer. Artifacts modify their wielder's capabilities and constrain their choices.
- Key artifact (1): a capability-altering entity. 5-7 world nodes (traits, capabilities, history, weaknesses, secrets, goals). Must connect to at least 2 threads. Its inner world should rival a recurring character's. Define HOW it changes what its wielder can do.
- Notable artifact (1): a tool that grants a specific capability. 3-4 world nodes (capability, history, relation, weakness). Owned by a character who uses it — the character's capabilities should reflect the tool.
- Minor artifact (1): a small object with narrative potential. 1-2 world nodes. Can be at a location.
- Artifacts must feel integral to the world. Key artifacts should have world edges (capability motivated_by history, weakness caused_by trait).

${worldOnly ? '' : `Every anchor must appear in at least 3 scenes. Use at least 6 different locations across the 8 scenes.

${PROMPT_POV}
${PROMPT_FORCE_STANDARDS}
${PROMPT_STRUCTURAL_RULES}
${PROMPT_DELTAS}
${PROMPT_WORLD}
${PROMPT_SUMMARY_REQUIREMENT}`}

`;

  const reasoningBudget = REASONING_BUDGETS['medium'] || undefined;
  const raw = onReasoning
    ? await callGenerateStream(prompt, SYSTEM_PROMPT, () => {}, MAX_TOKENS_LARGE, 'generateNarrative', GENERATE_MODEL, reasoningBudget, onReasoning)
    : await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_LARGE, 'generateNarrative', GENERATE_MODEL, reasoningBudget);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJson(raw, 'generateNarrative') as any;

  const now = Date.now();
  const id = `N-${now}`;

  // Normalize entities — accept legacy "continuity" field name if "world" is absent.
  const characters: NarrativeState['characters'] = {};
  for (const c of parsed.characters) {
    characters[c.id] = { ...c, threadIds: c.threadIds ?? [], world: normalizeInitialWorld(c.id, c.world ?? c.continuity) };
  }

  const locations: NarrativeState['locations'] = {};
  for (const l of parsed.locations) {
    locations[l.id] = { ...l, threadIds: l.threadIds ?? [], tiedCharacterIds: l.tiedCharacterIds ?? [], world: normalizeInitialWorld(l.id, l.world ?? l.continuity) };
  }

  const threads: NarrativeState['threads'] = {};
  // Normalize: LLM may still output "anchors" (legacy field name) — remap to "participants"
  for (const t of parsed.threads) {
    const { anchors, ...rest } = t as Thread & { anchors?: Thread['participants'] };
    threads[t.id] = { ...rest, participants: rest.participants ?? anchors ?? [], threadLog: { nodes: {}, edges: [] } };
  }

  const scenes: NarrativeState['scenes'] = {};
  if (!worldOnly) {
    for (const s of (parsed.scenes ?? [])) scenes[s.id] = { ...s, kind: 'scene', summary: s.summary || `Scene ${s.id}` };
  }

  const arcs: NarrativeState['arcs'] = {};
  if (!worldOnly) {
    for (const a of (parsed.arcs ?? [])) arcs[a.id] = a;
  }

  // Normalize artifacts — accept legacy "continuity" field name if "world" is absent.
  const artifacts: NarrativeState['artifacts'] = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (parsed.artifacts ?? []).map((a: any) => [
      a.id,
      { ...a, threadIds: a.threadIds ?? [], world: normalizeInitialWorld(a.id, a.world ?? a.continuity) },
    ]),
  );

  // Create initial WorldBuild with entities and empty systemDeltas
  // This mirrors the analysis pattern: entities are structural (in WorldBuild),
  // all knowledge (system + world deltas) flows through scenes
  const worldBuildId = `WB-${now}-INIT`;
  const initialWorldBuild: WorldBuild = {
    kind: 'world_build',
    id: worldBuildId,
    summary: `Initial world: ${Object.keys(characters).length} characters, ${Object.keys(locations).length} locations, ${Object.keys(threads).length} threads`,
    expansionManifest: {
      newCharacters: Object.values(characters),
      newLocations: Object.values(locations),
      newThreads: Object.values(threads),
      newArtifacts: Object.values(artifacts),
      systemDeltas: { addedNodes: [], addedEdges: [] },
      // Accept both legacy "relationships" (valence) and new "relationshipDeltas" (valenceDelta)
      relationshipDeltas: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(parsed.relationships ?? []).map((r: any) => ({
          from: r.from, to: r.to, type: r.type, valenceDelta: r.valence ?? r.valenceDelta ?? 0,
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(parsed.relationshipDeltas ?? []).map((r: any) => ({
          from: r.from, to: r.to, type: r.type, valenceDelta: r.valenceDelta ?? r.valence ?? 0,
        })),
      ],
    },
  };

  const branchId = `B-${now}`;
  const branches: NarrativeState['branches'] = {
    [branchId]: {
      id: branchId,
      name: 'Main',
      parentBranchId: null,
      forkEntryId: null,
      entryIds: [worldBuildId, ...Object.keys(scenes)],
      createdAt: now,
    },
  };

  // Sanitize and re-ID system knowledge deltas on scenes. The system graph
  // is derived on load by computeDerivedEntities replaying the timeline.
  const sceneList = Object.values(scenes);

  // For worldOnly mode, system deltas go in the WorldBuild (seeded knowledge)
  if (worldOnly && parsed.systemDeltas) {
    const seededDelta: SystemDelta = {
      addedNodes: parsed.systemDeltas.addedNodes ?? [],
      addedEdges: parsed.systemDeltas.addedEdges ?? [],
    };
    // Resolve IDs and sanitize
    const allocator = makeSystemIdAllocator([]);
    const resolved = resolveSystemConceptIds(seededDelta.addedNodes, {}, allocator);
    seededDelta.addedNodes = resolved.newNodes;
    const validIds = new Set(resolved.newNodes.map(n => n.id));
    seededDelta.addedEdges = seededDelta.addedEdges.map(edge => ({
      from: resolved.idMap[edge.from] ?? edge.from,
      to: resolved.idMap[edge.to] ?? edge.to,
      relation: edge.relation,
    }));
    sanitizeSystemDelta(seededDelta, validIds, new Set());
    initialWorldBuild.expansionManifest.systemDeltas = seededDelta;
  }

  // Normalize and resolve IDs for scene system deltas
  const allocateFreshWkId = makeSystemIdAllocator([]);
  const accumulatedNodes: Record<string, SystemNode> = {};
  const validWKIds = new Set<string>();
  const seenWkEdgeKeys = new Set<string>();

  for (const scene of sceneList) {
    if (!scene.systemDeltas) {
      scene.systemDeltas = { addedNodes: [], addedEdges: [] };
      continue;
    }
    scene.systemDeltas.addedNodes = scene.systemDeltas.addedNodes ?? [];
    scene.systemDeltas.addedEdges = scene.systemDeltas.addedEdges ?? [];

    // Concept-based resolution: re-mentioned concepts collapse to the same id
    const resolved = resolveSystemConceptIds(
      scene.systemDeltas.addedNodes,
      accumulatedNodes,
      allocateFreshWkId,
    );
    scene.systemDeltas.addedNodes = resolved.newNodes;
    for (const n of resolved.newNodes) {
      validWKIds.add(n.id);
      accumulatedNodes[n.id] = n;
    }

    // Remap edge references and sanitize
    scene.systemDeltas.addedEdges = scene.systemDeltas.addedEdges.map((edge) => ({
      from: resolved.idMap[edge.from] ?? edge.from,
      to: resolved.idMap[edge.to] ?? edge.to,
      relation: edge.relation,
    }));
    sanitizeSystemDelta(scene.systemDeltas, validWKIds, seenWkEdgeKeys);
  }

  // Generate embeddings for scene summaries
  if (sceneList.length > 0) {
    const { generateEmbeddingsBatch } = await import('@/lib/embeddings');
    const { assetManager } = await import('@/lib/asset-manager');
    const summaries = sceneList.map(s => s.summary);
    const embeddings = await generateEmbeddingsBatch(summaries, id);
    for (let i = 0; i < sceneList.length; i++) {
      const embeddingId = await assetManager.storeEmbedding(embeddings[i], 'text-embedding-3-small');
      sceneList[i].summaryEmbedding = embeddingId;
    }
  }

  // Sanitize thread log entries and assign globally-unique TK-* IDs. The LLM
  // emits TK-GEN-* placeholders (or nothing) — we normalize each node (fill
  // type from pulse/transition fallback, drop empty content), synthesize a
  // fallback log entry when the delta has none so every threadDelta
  // produces at least one log node, then remap to sequential TK-NNN IDs so
  // cross-scene collisions can't silently drop nodes in applyThreadDelta.
  // Also coerces invalid from/to statuses (e.g. the LLM emitting "pulse"
  // as a status when pulse is actually a log node type).
  const validStatuses = new Set<string>([...THREAD_ACTIVE_STATUSES, ...THREAD_TERMINAL_STATUSES, 'abandoned']);
  let totalTkNodes = 0;
  for (const scene of sceneList) {
    for (const tm of scene.threadDeltas ?? []) {
      const thread = threads[tm.threadId];
      const currentStatus = thread?.status ?? 'latent';
      if (!validStatuses.has(tm.from)) tm.from = currentStatus;
      if (!validStatuses.has(tm.to)) tm.to = tm.from;
      const fallbackType = tm.from === tm.to ? 'pulse' : 'transition';
      tm.addedNodes = (tm.addedNodes ?? [])
        .filter((n) => n && typeof n.content === 'string' && n.content.trim())
        .map((n) => ({
          id: n.id || 'TK-GEN',
          content: n.content,
          type: (n.type ?? fallbackType) as ThreadLogNodeType,
        }));
      if (tm.addedNodes.length === 0) {
        const desc = thread?.description ?? tm.threadId;
        tm.addedNodes = [{
          id: 'TK-GEN',
          content: tm.from === tm.to
            ? `Thread "${desc}" held ${tm.to} without transition`
            : `Thread "${desc}" advanced from ${tm.from} to ${tm.to}`,
          type: fallbackType as ThreadLogNodeType,
        }];
      }
      totalTkNodes += tm.addedNodes.length;
    }
  }
  const tkIds = nextIds('TK', [], totalTkNodes);
  let tkIdx = 0;
  for (const scene of sceneList) {
    for (const tm of scene.threadDeltas ?? []) {
      for (const node of tm.addedNodes ?? []) {
        node.id = tkIds[tkIdx++];
      }
    }
  }

  // Build thread log graphs from initial scene deltas. Each scene's
  // contribution is a self-contained cluster — no cross-scene edges.
  for (const scene of sceneList) {
    for (const tm of scene.threadDeltas ?? []) {
      const thread = threads[tm.threadId];
      if (!thread) continue;
      thread.threadLog = applyThreadDelta(thread.threadLog, tm);
    }
  }

  logInfo('Completed narrative generation', {
    source: 'manual-generation',
    operation: 'generate-narrative-complete',
    details: {
      narrativeId: id,
      title,
      worldOnly,
      charactersCreated: Object.keys(characters).length,
      locationsCreated: Object.keys(locations).length,
      threadsCreated: Object.keys(threads).length,
      scenesCreated: Object.keys(scenes).length,
      arcsCreated: Object.keys(arcs).length,
      artifactsCreated: Object.keys(artifacts).length,
    },
  });

  return {
    id,
    title,
    description: premise,
    characters,
    locations,
    threads,
    artifacts,
    arcs,
    scenes,
    worldBuilds: { [worldBuildId]: initialWorldBuild },
    branches,
    relationships: [], // Derived from WorldBuild.expansionManifest.relationshipDeltas by computeDerivedEntities
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: parsed.worldSummary ?? premise,
    imageStyle: typeof parsed.imageStyle === 'string' ? parsed.imageStyle : undefined,
    proseProfile: (() => {
      const pp = parsed.proseProfile;
      if (!pp || typeof pp !== 'object') return undefined;
      return {
        register:       typeof pp.register       === 'string' ? pp.register       : 'conversational',
        stance:         typeof pp.stance         === 'string' ? pp.stance         : 'close_third',
        tense:          typeof pp.tense          === 'string' ? pp.tense          : undefined,
        sentenceRhythm: typeof pp.sentenceRhythm === 'string' ? pp.sentenceRhythm : undefined,
        interiority:    typeof pp.interiority    === 'string' ? pp.interiority    : undefined,
        dialogueWeight: typeof pp.dialogueWeight === 'string' ? pp.dialogueWeight : undefined,
        devices:        Array.isArray(pp.devices) ? pp.devices.filter((d: unknown) => typeof d === 'string') : [],
        rules:          Array.isArray(pp.rules)   ? pp.rules.filter((r: unknown) => typeof r === 'string')   : [],
        antiPatterns:   Array.isArray(pp.antiPatterns) ? pp.antiPatterns.filter((a: unknown) => typeof a === 'string') : [],
      };
    })(),
    storySettings: {
      ...DEFAULT_STORY_SETTINGS,
      ...(typeof parsed.planGuidance === 'string' && parsed.planGuidance.trim() ? { planGuidance: parsed.planGuidance.trim() } : {}),
    },
    patterns: Array.isArray(parsed.patterns) ? parsed.patterns.filter((p: unknown) => typeof p === 'string') : [],
    antiPatterns: Array.isArray(parsed.antiPatterns) ? parsed.antiPatterns.filter((p: unknown) => typeof p === 'string') : [],
    createdAt: now,
    updatedAt: now,
  };
}

// ── Auto-Detect Patterns ─────────────────────────────────────────────────────

export type DetectedPatterns = {
  patterns: string[];
  antiPatterns: string[];
  detectedGenre: string;
  detectedSubgenre: string;
};

/**
 * Analyze an existing narrative and auto-detect patterns and anti-patterns
 * based on genre conventions, existing content, prose samples, and structural analysis.
 */
export async function detectPatterns(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  onToken?: (token: string) => void,
): Promise<DetectedPatterns> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  // Gather existing content signals
  const threads = Object.values(narrative.threads).slice(0, 10);
  const characters = Object.values(narrative.characters).slice(0, 10);
  const systemNodes = Object.values(narrative.systemGraph?.nodes ?? {}).slice(0, 15);

  const threadSummary = threads.map(t => `- ${t.description} (${t.status})`).join('\n');
  const characterSummary = characters.map(c => `- ${c.name}: ${c.role}`).join('\n');
  const systemSummary = systemNodes.map(n => `- ${n.concept} (${n.type})`).join('\n');

  // Gather prose samples from scenes (like prose profile detection)
  // Get the latest prose version from each scene
  const getLatestProse = (scene: Scene): string => {
    if (!scene.proseVersions || scene.proseVersions.length === 0) return '';
    // Sort by version descending and get latest
    const sorted = [...scene.proseVersions].sort((a, b) => {
      const aParts = a.version.split('.').map(Number);
      const bParts = b.version.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if ((bParts[i] || 0) !== (aParts[i] || 0)) return (bParts[i] || 0) - (aParts[i] || 0);
      }
      return 0;
    });
    return sorted[0]?.prose || '';
  };

  const scenesWithProse = Object.values(narrative.scenes)
    .map(s => ({ scene: s, prose: getLatestProse(s) }))
    .filter(({ prose }) => prose.length > 100)
    .slice(0, 10);

  const proseSamples = scenesWithProse.map(({ scene, prose }, i) => {
    const summary = scene.summary || 'No summary';
    // Take first ~800 chars of prose to keep prompt manageable
    const proseSnippet = prose.slice(0, 800);
    return `--- SCENE ${i + 1}: ${summary} ---\n${proseSnippet}${proseSnippet.length >= 800 ? '...' : ''}`;
  }).join('\n\n');

  // Get scene summaries for structure analysis
  const sceneSummaries = Object.values(narrative.scenes)
    .slice(0, 15)
    .map((s, i) => `${i + 1}. ${s.summary || 'Untitled scene'}`)
    .join('\n');

  const existingPatterns = narrative.patterns?.join('\n- ') || 'None';
  const existingAntiPatterns = narrative.antiPatterns?.join('\n- ') || 'None';

  const prompt = `${ctx}

## NARRATIVE SIGNALS

THREADS:
${threadSummary || 'None yet'}

KEY CHARACTERS:
${characterSummary || 'None yet'}

WORLD SYSTEMS:
${systemSummary || 'None yet'}

## SCENE STRUCTURE
${sceneSummaries || 'No scenes yet'}

## PROSE SAMPLES
${proseSamples || 'No prose available yet'}

## EXISTING PATTERNS
- ${existingPatterns}

## EXISTING ANTI-PATTERNS
- ${existingAntiPatterns}

## TASK

Analyze this narrative's PROSE STYLE, STRUCTURE, and CONTENT to detect its GENRE and derive patterns/anti-patterns.

These patterns serve TWO critical functions:
1. **COOPERATIVE AGENT**: Patterns encourage VARIETY and push the story toward fresh, interesting territory
2. **ADVERSARIAL AGENT**: Anti-patterns prevent STAGNATION and flag when the story becomes repetitive or predictable

1. DETECT GENRE: Based on the prose samples, world systems, and narrative structure, identify:
   - Primary genre (fantasy, sci-fi, thriller, romance, horror, mystery, literary, etc.)
   - Specific subgenre (progression fantasy, space opera, cozy mystery, dark romance, LitRPG, xianxia, cultivation, grimdark, etc.)

2. DERIVE PATTERNS (5-7): Positive commandments that encourage VARIETY and excellence:
   - What genre conventions unlock fresh storytelling opportunities?
   - What structural patterns create satisfying variety across arcs?
   - What character dynamics feel authentic AND allow for growth/change?
   - What techniques keep the prose engaging without becoming formulaic?
   - Include at least 1-2 patterns that specifically encourage novelty and surprise

3. DERIVE ANTI-PATTERNS (5-7): Negative commandments that prevent STAGNATION:
   - What patterns would make the story feel repetitive or predictable?
   - What genre tropes are overdone and signal lazy writing?
   - What character dynamics become stale if repeated too often?
   - What structural rhythms feel formulaic after a few arcs?
   - Include at least 1-2 anti-patterns that specifically flag staleness and repetition

CRITICAL: The goal is a LIVING story that evolves. Patterns should encourage the story to grow and surprise. Anti-patterns should prevent the story from settling into comfortable ruts.

Examples of variety-encouraging patterns:
- "Each arc must introduce at least one element (character, location, system) that recontextualizes something established"
- "Power dynamics must shift — no character should stay dominant for more than two arcs"
- "Every major character must make a choice that surprises even themselves"

Examples of stagnation-preventing anti-patterns:
- "NEVER repeat the same arc structure back-to-back (training → challenge → victory)"
- "No character should solve problems the same way twice in a row"
- "Avoid recycling tension patterns — if betrayal drove the last arc, it cannot drive this one"

Return JSON:
{
  "detectedGenre": "primary genre",
  "detectedSubgenre": "specific subgenre",
  "patterns": [
    "Pattern 1 — concrete, actionable, genre-specific",
    "Pattern 2",
    "..."
  ],
  "antiPatterns": [
    "Anti-pattern 1 — concrete, actionable, genre-specific",
    "Anti-pattern 2",
    "..."
  ]
}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;

  const raw = onToken
    ? await callGenerateStream(
        prompt,
        SYSTEM_PROMPT,
        () => {},
        undefined,
        'detectPatterns',
        undefined,
        reasoningBudget,
        onToken,
      )
    : await callGenerate(
        prompt,
        SYSTEM_PROMPT,
        undefined,
        'detectPatterns',
        undefined,
        reasoningBudget,
      );

  const parsed = parseJson(raw, 'detectPatterns') as {
    detectedGenre?: unknown;
    detectedSubgenre?: unknown;
    patterns?: unknown;
    antiPatterns?: unknown;
  };
  return {
    detectedGenre: typeof parsed.detectedGenre === 'string' ? parsed.detectedGenre : 'Unknown',
    detectedSubgenre: typeof parsed.detectedSubgenre === 'string' ? parsed.detectedSubgenre : 'Unknown',
    patterns: Array.isArray(parsed.patterns) ? parsed.patterns.filter((p: unknown) => typeof p === 'string') : [],
    antiPatterns: Array.isArray(parsed.antiPatterns) ? parsed.antiPatterns.filter((p: unknown) => typeof p === 'string') : [],
  };
}
