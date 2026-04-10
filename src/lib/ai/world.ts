import type { NarrativeState, Scene, Character, Location, Thread, RelationshipEdge, WorldKnowledgeNode, WorldKnowledgeEdge, WorldKnowledgeMutation, WorldKnowledgeNodeType, Artifact, ReasoningLevel, OwnershipMutation, TieMutation, ContinuityMutation, RelationshipMutation } from '@/types/narrative';
import { THREAD_ACTIVE_STATUSES, resolveEntry, isScene, REASONING_BUDGETS, DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { nextId, nextIds } from '@/lib/narrative-utils';
import { callGenerate, callGenerateStream, SYSTEM_PROMPT } from './api';
import { MAX_TOKENS_LARGE, GENERATE_MODEL } from '@/lib/constants';
import { parseJson } from './json';
import { narrativeContext } from './context';
import { PROMPT_FORCE_STANDARDS, PROMPT_STRUCTURAL_RULES, PROMPT_MUTATIONS, PROMPT_POV, PROMPT_CONTINUITY, PROMPT_SUMMARY_REQUIREMENT, PROMPT_ENTITY_INTEGRATION } from './prompts';
import { buildSequencePrompt, buildIntroductionSequence } from '@/lib/pacing-profile';
import { logInfo } from '@/lib/system-logger';

export type ExpansionEntityFilter = {
  characters: boolean;
  locations: boolean;
  threads: boolean;
  artifacts: boolean;
  relationships: boolean;
  worldKnowledge: boolean;
  ownershipMutations: boolean;
  tieMutations: boolean;
  continuityMutations: boolean;
  relationshipMutations: boolean;
};

export const DEFAULT_EXPANSION_FILTER: ExpansionEntityFilter = {
  characters: true, locations: true, threads: true,
  artifacts: true, relationships: true, worldKnowledge: true,
  ownershipMutations: true, tieMutations: true,
  continuityMutations: true, relationshipMutations: true,
};

export type WorldExpansion = {
  characters: Character[];
  locations: Location[];
  threads: Thread[];
  relationships: RelationshipEdge[];
  worldKnowledgeMutations?: WorldKnowledgeMutation;
  artifacts?: Artifact[];
  ownershipMutations?: OwnershipMutation[];
  tieMutations?: TieMutation[];
  continuityMutations?: ContinuityMutation[];
  relationshipMutations?: RelationshipMutation[];
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
    ? Object.values(narrative.characters).reduce((sum, c) => sum + Object.keys(c.continuity?.nodes ?? {}).length, 0) / totalCharacters
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
- Focus world knowledge on the mechanics, economics, and power dynamics of the CURRENT setting
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

export async function expandWorld(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  directive: string,
  size: WorldExpansionSize = 'medium',
  strategy: WorldExpansionStrategy = 'dynamic',
  /** Verbatim plan document section — guides entity creation with specific character/location/system details */
  sourceText?: string,
  onReasoning?: (token: string) => void,
  /** Filter which entity types to create — disabled types are excluded from prompt and stripped from output */
  entityFilter?: ExpansionEntityFilter,
): Promise<WorldExpansion> {
  logInfo('Starting world expansion', {
    source: 'world-expansion',
    operation: 'expand-world',
    details: {
      narrativeId: narrative.id,
      size,
      strategy,
      hasDirective: !!directive,
      hasSourceText: !!sourceText,
    },
  });

  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  // Compute next sequential IDs for the AI to use
  const nextCharId = nextId('C', Object.keys(narrative.characters));
  const nextLocId = nextId('L', Object.keys(narrative.locations));
  const nextThreadId = nextId('T', Object.keys(narrative.threads));
  const nextArtifactId = nextId('A', Object.keys(narrative.artifacts ?? {}));
  const existingKIds = [
    ...Object.values(narrative.characters).flatMap((c) => Object.keys(c.continuity?.nodes ?? {})),
    ...Object.values(narrative.locations).flatMap((l) => Object.keys(l.continuity?.nodes ?? {})),
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

  const prompt = `${ctx}

${directive.trim() ? `EXPAND the world based on this directive: ${directive}` : 'EXPAND the world — analyze the current narrative state and add characters, locations, and threads that would create the most interesting new possibilities based on existing tensions and unexplored areas.'}
${sourceText ? `\nSOURCE MATERIAL (verbatim from plan document — use this as the authoritative guide for what characters, locations, systems, and entities to create. If the source names specific characters, places, or objects, create them with those exact names and roles. The source material takes priority over generic expansion.):\n${sourceText}` : ''}

${strategyBlock}

${(() => {
  const f = entityFilter ?? DEFAULT_EXPANSION_FILTER;
  const disabled = Object.entries(f).filter(([, v]) => !v).map(([k]) => k);
  if (disabled.length === 0) return '';
  const labels: Record<string, string> = { characters: 'characters', locations: 'locations', threads: 'threads', artifacts: 'artifacts', relationships: 'relationships', worldKnowledge: 'world knowledge mutations', ownershipMutations: 'ownership mutations (artifact transfers)', tieMutations: 'tie mutations (character-location bonds)', continuityMutations: 'continuity mutations (changes to existing entities)', relationshipMutations: 'relationship mutations (valence shifts on existing relationships)' };
  return `ENTITY FILTER — DO NOT create the following types (return empty arrays for them):\n${disabled.map(k => `- NO ${labels[k]}`).join('\n')}\n`;
})()}
${size === 'exact' ? `This is an EXACT expansion — create ONLY what the directive explicitly describes. Do not add extra characters, locations, threads, or artifacts beyond what is specified. No embellishments, no "while we're at it" additions. If the directive says "add a blacksmith named Torin", create exactly that character and nothing else. Every entity in your response must trace directly to something stated in the directive.` : `This is ${EXPANSION_SIZE_CONFIG[size].label} (${EXPANSION_SIZE_CONFIG[size].total} total new entities). Generate:
- ${EXPANSION_SIZE_CONFIG[size].characters} new characters
- ${EXPANSION_SIZE_CONFIG[size].locations} new locations
- ${EXPANSION_SIZE_CONFIG[size].threads} new threads`}
- Relationships connecting new characters to EXISTING characters (this is critical)
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
      "name": "string",
      "role": "anchor|recurring|transient",
      "threadIds": [],
      "imagePrompt": "1-2 sentence LITERAL physical description: concrete traits like hair colour, build, clothing style. Never use metaphors, similes, or figurative language — image generators interpret them literally.",
      "continuity": {
        "nodes": [{"id": "${nextKId}", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "string"}]
      }
    }
  ],
  "locations": [
    {
      "id": "${nextLocId}",
      "name": "string",
      "parentId": "REQUIRED: existing location ID (e.g. L-01) to nest under, or null ONLY for top-level regions",
      "tiedCharacterIds": ["character IDs with a significant tie to this location — residents, employees, faction members, students. Ties represent gravity and belonging, not just presence"],
      "threadIds": [],
      "imagePrompt": "1-2 sentence LITERAL visual description: architecture, landscape, lighting, weather. Use concrete physical details only — no metaphors, similes, or figurative language. Image generators interpret them literally.",
      "continuity": {
        "nodes": [{"id": "K-next", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "string"}]
      }
    }
  ],
  "threads": [
    {
      "id": "${nextThreadId}",
      "participants": [{"id": "character or location ID", "type": "character|location"}],
      "description": "string",
      "status": "latent",
      "openedAt": "new",
      "dependents": ["T-XX (existing thread IDs this thread connects to, accelerates, or converges with — see THREAD CONVERGENCE below)"]
    }
  ],
  "relationships": [
    {"from": "character ID", "to": "character ID", "type": "description", "valence": 0.0}
  ],
  "artifacts": [
    {
      "id": "${nextArtifactId}",
      "name": "string",
      "significance": "key|notable|minor",
      "parentId": "owner — a character or location ID, or null for world-owned (communally available to all)",
      "continuity": {"nodes": [{"id": "K-next", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "what it is, what it does, its history, its powers, its limitations — everything about this artifact lives in its continuity"}]},
      "imagePrompt": "1-2 sentence LITERAL visual description — concrete physical details only, no metaphors or figurative language"
    }
  ],
  "worldKnowledgeMutations": {
    "addedNodes": [{"id": "WK-GEN-001", "concept": "foundational world concept", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}],
    "addedEdges": [{"from": "WK-GEN-001", "to": "existing-WK-ID", "relation": "relationship"}]
  },
  "ownershipMutations": [{"artifactId": "A-XX", "fromId": "C-XX or L-XX", "toId": "C-YY or L-YY"}],
  "tieMutations": [{"locationId": "L-XX", "characterId": "C-XX", "action": "add|remove"}],
  "continuityMutations": [{"entityId": "existing C-XX, L-XX, or A-XX", "addedNodes": [{"id": "K-next", "content": "what changed", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}], "addedEdges": []}],
  "relationshipMutations": [{"from": "C-XX", "to": "C-YY", "type": "description", "valenceDelta": 0.1}]
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
- Generate at MINIMUM ${EXPANSION_SIZE_CONFIG[size].characters === '1-2' ? '2' : EXPANSION_SIZE_CONFIG[size].characters === '3-5' ? '5' : '12'} relationships total. Most should connect new→existing. Include varied valences (allies, rivals, mentors, kin). At least one with tension.
- Key artifacts should have 3-4 continuity nodes (what it does, its origin, its limitation). Only create artifacts when they meaningfully alter what characters can do.

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
- Generate the exact counts specified above (${EXPANSION_SIZE_CONFIG[size].characters} characters, ${EXPANSION_SIZE_CONFIG[size].locations} locations, ${EXPANSION_SIZE_CONFIG[size].threads} threads)

THREAD CONVERGENCE (critical for long-form narrative):
- The "dependents" field lists EXISTING thread IDs that this new thread connects to, accelerates, or converges with. This is how storylines collide.
- A convergent thread is one whose activation or resolution forces multiple existing threads into new trajectories. Example: a resource thread (T-new) that depends on [T-03, T-07] means when this resource thread activates, it creates pressure on both T-03 and T-07 simultaneously.
- At least ONE new thread should have 2+ dependents — this is a convergent bridge thread that forces collision between existing storylines.
- Dependents should reference threads that are currently in different storylines or involve different characters — the whole point is to CREATE connections between threads that were previously parallel.
- Think: shared resources both factions need, events that affect multiple storylines, secrets that connect separated characters, external forces that compress multiple conflicts.
- Empty dependents [] is acceptable for truly independent new threads, but at least one thread per expansion MUST bridge existing threads.

WORLD KNOWLEDGE MUTATIONS:
worldKnowledgeMutations define the FOUNDATIONAL abstractions this expansion establishes — the rules, systems, concepts, and tensions that the new characters, locations, and threads operate within. These are intentional world-building, not incidental discovery.
- Use "principle" for fundamental truths, "system" for mechanisms/institutions, "concept" for abstract ideas, "tension" for contradictions, "event" for world-level occurrences, "structure" for organizations/factions, "environment" for geography/climate, "convention" for customs/norms, "constraint" for scarcities/limitations.
- Node IDs should be WK-GEN-001, WK-GEN-002, etc. (they will be re-mapped to real IDs).
- Edges can reference both new WK-GEN-* IDs and existing world knowledge IDs already in the narrative.
- Generate 3-6 world knowledge nodes depending on expansion size, with edges connecting related concepts. Each must be a genuine structural rule or system that the new entities operate within.
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

  // Process worldKnowledgeMutations: assign real WK-XX IDs
  let worldKnowledgeMutations: WorldKnowledgeMutation | undefined;
  const rawWKM = parsed.worldKnowledgeMutations;
  if (rawWKM && Array.isArray(rawWKM.addedNodes) && rawWKM.addedNodes.length > 0) {
    // Collect existing WK IDs from the narrative's world knowledge graph
    const existingWkIds = Object.keys(narrative.worldKnowledge?.nodes ?? {});
    const realIds = nextIds('WK', existingWkIds, rawWKM.addedNodes.length);
    const wkIdMap: Record<string, string> = {};

    const addedNodes = rawWKM.addedNodes.map((node: { id: string; concept: string; type: string }, i: number) => {
      const realId = realIds[i];
      wkIdMap[node.id] = realId;
      return { id: realId, concept: node.concept, type: (node.type || 'concept') as WorldKnowledgeNodeType };
    });

    // Remap edge references — edges can point to new WK-GEN-* IDs or existing WK-XX IDs
    const validWKIds = new Set([...existingWkIds, ...realIds]);
    const addedEdges = (rawWKM.addedEdges ?? [])
      .map((edge: { from: string; to: string; relation: string }) => ({
        from: wkIdMap[edge.from] ?? edge.from,
        to: wkIdMap[edge.to] ?? edge.to,
        relation: edge.relation,
      }))
      .filter((edge: { from: string; to: string }) => validWKIds.has(edge.from) && validWKIds.has(edge.to));

    worldKnowledgeMutations = { addedNodes, addedEdges };
  }

  // Apply entity filter — strip types the user disabled
  const f = entityFilter ?? DEFAULT_EXPANSION_FILTER;
  const result = {
    characters: f.characters ? (parsed.characters ?? []) : [],
    locations: f.locations ? (parsed.locations ?? []) : [],
    threads: f.threads ? threads : [],
    relationships: f.relationships ? (parsed.relationships ?? []) : [],
    worldKnowledgeMutations: f.worldKnowledge ? worldKnowledgeMutations : undefined,
    artifacts: f.artifacts ? (parsed.artifacts ?? []) : [],
    ownershipMutations: f.ownershipMutations ? (parsed.ownershipMutations ?? []) : [],
    tieMutations: f.tieMutations ? (parsed.tieMutations ?? []) : [],
    continuityMutations: f.continuityMutations ? (parsed.continuityMutations ?? []) : [],
    relationshipMutations: f.relationshipMutations ? (parsed.relationshipMutations ?? []) : [],
  };

  logInfo('Completed world expansion', {
    source: 'world-expansion',
    operation: 'expand-world-complete',
    details: {
      narrativeId: narrative.id,
      charactersAdded: result.characters.length,
      locationsAdded: result.locations.length,
      threadsAdded: result.threads.length,
      relationshipsAdded: result.relationships.length,
      artifactsAdded: result.artifacts?.length ?? 0,
      worldKnowledgeNodes: result.worldKnowledgeMutations?.addedNodes.length ?? 0,
    },
  });

  return result;
}

export async function generateNarrative(
  title: string,
  premise: string,
  rules: string[] = [],
  systemSketches: { name: string; description: string; principles: string[]; constraints: string[]; interactions: string[] }[] = [],
  onToken?: (token: string) => void,
  onReasoning?: (token: string) => void,
  reasoningLevel?: ReasoningLevel,
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
      hasRules: rules.length > 0,
      hasSystemSketches: systemSketches.length > 0,
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
    {"id": "C-01", "name": "string", "role": "anchor|recurring|transient", "threadIds": ["T-01"], "imagePrompt": "1-2 sentence LITERAL physical description — concrete traits (hair colour, build, clothing). No metaphors or figurative language; image generators interpret literally.", "continuity": {"nodes": [{"id": "K-01", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "string"}]}}
  ],
  "locations": [
    {"id": "L-01", "name": "string", "prominence": "domain|place|margin", "parentId": null, "threadIds": [], "imagePrompt": "1-2 sentence LITERAL visual description — concrete architecture, landscape, lighting. No metaphors or figurative language; image generators interpret literally.", "continuity": {"nodes": [{"id": "LK-01", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "string"}]}}
  ],
  "threads": [
    {"id": "T-01", "participants": [{"id": "C-01", "type": "character|location|artifact"}], "description": "string", "status": "latent", "openedAt": "S-001", "dependents": []}
  ],
  "relationships": [
    {"from": "C-01", "to": "C-02", "type": "description", "valence": 0.5}
  ],
  "artifacts": [
    {"id": "A-01", "name": "string", "significance": "key|notable|minor", "threadIds": [], "parentId": "character or location ID, or null for world-owned", "continuity": {"nodes": [{"id": "AK-01", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "what it is, what it does, its history, its powers, its limitations"}]}, "imagePrompt": "1-2 sentence LITERAL visual description — concrete physical details only, no metaphors or figurative language"}
  ],${worldOnly ? `
  "worldKnowledge": {"addedNodes": [{"id": "WK-01", "concept": "name of a world concept, rule, system, or structure", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"from": "WK-01", "to": "WK-02", "relation": "typed relationship: enables, requires, governs, opposes, created_by, extends, etc."}]},` : `
  "scenes": [
    {
      "id": "S-001",
      "arcId": "ARC-01",
      "locationId": "L-01",
      "povId": "C-01",
      "participantIds": ["C-01"],
      "artifactUsages": [{"artifactId": "A-XX", "characterId": "C-XX or null for unattributed usage", "usage": "what the artifact did — how it delivered utility"}],
      "events": ["event_tag"],
      "threadMutations": [{"threadId": "T-01", "from": "latent", "to": "active"}],
      "continuityMutations": [{"entityId": "C-XX", "addedNodes": [{"id": "K-GEN-001", "content": "complete sentence: what they experienced or became", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}], "addedEdges": [{"from": "K-GEN-001", "to": "K-XX", "relation": "follows|causes|contradicts|enables"}]}],
      "relationshipMutations": [],
      "worldKnowledgeMutations": {"addedNodes": [{"id": "WK-GEN-001", "concept": "name of a world concept, rule, system, or structure", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"from": "WK-GEN-001", "to": "WK-GEN-002", "relation": "typed relationship: enables, requires, governs, opposes, created_by, extends, etc."}]},
      "summary": "REQUIRED: Rich prose sentences using character NAMES and location NAMES (never raw IDs). Include specifics: actions, consequences, dialogue snippets. Include any context that shapes how the scene is written (time span, technique, tone). No sentences ending in emotions or realizations."
    }
  ],
  "arcs": [
    {"id": "ARC-01", "name": "string", "sceneIds": ["S-001"], "develops": ["T-01"], "locationIds": ["L-01"], "activeCharacterIds": ["C-01"], "initialCharacterLocations": {"C-01": "L-01"}}
  ],`}
  "rules": ["World rule 1", "World rule 2"],
  "worldSystems": [
    {"id": "WS-01", "name": "System Name", "description": "One-line summary of what this system is", "principles": ["How it works"], "constraints": ["Hard limits and costs"], "interactions": ["How it connects to other systems"]}
  ],
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
  "planGuidance": "2-4 sentences of specific guidance for scene beat plans. What mechanisms should dominate? How should exposition be handled? What should plans avoid? EXAMPLE: 'Prioritise action and dialogue beats over narration. System mechanics revealed through usage, never expository narration beats. Internal monologue should be tactical and clipped. Plans should never include a beat whose purpose is to explain a concept that was already demonstrated in a prior beat.'"
}

PILOT EPISODE — establish a tight, focused world. These are minimums; exceed when the premise warrants it:
- AT LEAST 8 characters: 2+ anchors, 3+ recurring, 3+ transient
- AT LEAST 6 locations with parent/child hierarchy (at least 2 nesting levels)
- AT LEAST 4 threads — 1+ short-term, 1+ medium-term, 2+ long-term. Threads force entities into action. At least 2 must share participants.
- AT LEAST 8 relationships (at least 1 hostile)
- AT LEAST 1 artifact when the premise involves tools or objects of power
- AT LEAST 5 world knowledge nodes with 3 edges — the systems and rules the world runs on${worldOnly ? '' : `
- AT LEAST 8 scenes in 1 arc`}

ENTITY DEFINITIONS:
- Characters are conscious beings with agency — people, named animals, sentient AI (AGI). Non-sentient AI systems are artifacts.
- Locations are spatial areas or regions — physical places you can be IN.
- Artifacts are anything that delivers utility — active tools, not passive concepts. Concepts belong in world knowledge.
- Threads are narrative tensions that drive action.

CHARACTER DEPTH BY ROLE — minimums; go deeper for complex characters:
- Anchors: 4-5 continuity nodes each — a defining trait, a goal, a belief, a weakness or secret, and a capability. Connect with edges.
- Recurring: 2-3 continuity nodes each — their role, relationship to an anchor, one hidden dimension.
- Transient: 1 continuity node each — their function.

SEED DATA vs. BARE PREMISE:
The premise may include user-provided characters, locations, threads, rules, and systems. Handle both cases:
- IF seeded: Use the provided entities as anchors and starting points. Expand the world around them — add supporting cast, sub-locations, connecting threads. Honour the user's descriptions and relationships but deepen them with secrets, contradictions, and hidden connections. The user's input is the skeleton; you build the muscle and skin.
- IF bare premise (just a concept/genre/theme with no entities): Interpret the premise ambitiously. Extrapolate a full world with factions, geography, history, and power structures. A one-line prompt like "kung fu monks in space" should produce a world as rich and specific as one seeded with 20 entities. Do not produce a thin world just because the input was thin.

NAMING — CRITICAL:
The premise may contain placeholder or generic names (e.g. "The Reincarnator", "The Elder Council", "Shadow Realm"). Replace ALL placeholder names with original, specific names. Naming is the single biggest quality signal.

Name like a human novelist, not a fantasy name generator:
- FIRST: detect the cultural origin implied by the premise — eastern, western, Middle Eastern, African, South Asian, multicultural, secondary world with specific influences, etc. This determines your entire naming palette.
- Source character names from real census records, historical obscurities, regional naming traditions, or deliberate etymological construction rooted in SPECIFIC cultures matching the world's origin. A world inspired by Song Dynasty China should have names sourced from Chinese historical records. A world inspired by Ottoman history from Turkish/Arabic/Persian roots. A Slavic-inspired world from Slavic roots. Never default to generic pan-Celtic/Greek.
- For multicultural worlds: each faction, region, or cultural group gets its own distinct naming palette reflecting its origin. Names should signal which part of the world a character comes from.
- Pick a consistent cultural palette for each faction or region and stay within it. Internal consistency is more important than variety.
- Prefer rough, blunt, asymmetric names. Names with hard consonant clusters, unexpected syllable stress, or occupational origins feel human. Smooth melodic names with open vowels feel generated.
- Surnames from occupations, geography, or patronymics — never compound noun+noun fantasy construction.
- Location names: derive from terrain, founders, or linguistic corruption of older words. They should sound like they've been mispronounced for centuries.
- Thread/system names: concrete and specific. "The Tithe of Ash" not "The Power System". "The Lazar Compact" not "The Ancient Alliance".
- Test: if a name could appear in 10 different fantasy novels interchangeably, it's too generic. If it could only belong to THIS world, it's right.

LOCATION HIERARCHY & AGENCY:
- Build spatial nesting: Region → Settlement → District → Specific Place
- A city with 5 sub-locations feels more real than 5 unconnected cities
- Include contrasting environments: if the story starts safe, the world needs a dangerous frontier
- A location is BOTH a place AND its people. The Shire is rolling hills AND hobbits. A city is infrastructure AND culture AND collective will. A kingdom is territory AND governance AND identity. Locations think, feel, and act through their inhabitants.
- Prominence: "domain" locations are centers of power with deep inner worlds, "place" locations are recurring settings, "margin" locations are transitional.
- Domain locations: 4-6 continuity nodes (history, traits, capabilities, weaknesses, goals, beliefs). They impose rules on characters and have collective agency — a kingdom demands fealty, a city mourns its dead, an organization pursues its agenda.
- Place locations: 2-3 continuity nodes (history, state, trait).
- Margin locations: 1 continuity node (trait or state).

RELATIONSHIPS:
- Connect anchors to MANY characters (6+ relationships per anchor)
- Asymmetric descriptions: "A admires B" while "B suspects A"
- At least 2 hidden relationships (known to reader, not to characters)

ARTIFACTS & TOOLS:
- Artifacts are things that by themselves can provide utility. They extend what's possible — a magical weapon changes how someone fights, AI technology changes the scale of thought, a cursed ring slowly consumes its bearer. Artifacts modify their wielder's capabilities and constrain their choices.
- Key artifact (1): a capability-altering entity. 5-7 continuity nodes (traits, capabilities, history, weaknesses, secrets, goals). Must connect to at least 2 threads. Its inner world should rival a recurring character's. Define HOW it changes what its wielder can do.
- Notable artifact (1): a tool that grants a specific capability. 3-4 continuity nodes (capability, history, relation, weakness). Owned by a character who uses it — the character's capabilities should reflect the tool.
- Minor artifact (1): a small object with narrative potential. 1-2 continuity nodes. Can be at a location.
- Artifacts must feel integral to the world. Key artifacts should have continuity edges (capability motivated_by history, weakness caused_by trait).

${worldOnly ? '' : `Every anchor must appear in at least 3 scenes. Use at least 6 different locations across the 8 scenes.

${buildSequencePrompt(buildIntroductionSequence())}

${PROMPT_POV}
${PROMPT_FORCE_STANDARDS}
${PROMPT_STRUCTURAL_RULES}
${PROMPT_MUTATIONS}
${PROMPT_CONTINUITY}
${PROMPT_SUMMARY_REQUIREMENT}`}

WORLD RULES: Generate 4-6 world rules — absolute constraints that every scene must obey. These define the physics, magic system limits, social rules, or thematic laws of the world.${rules.length > 0 ? ` The user has already provided these rules — include them as-is and add more if appropriate:\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : ''}

WORLD SYSTEMS: Generate 3-6 world systems that define how this world uniquely works. A system is any distinct mechanic, institution, force, or structure that shapes how the world operates. There are no fixed categories — define whatever systems make this world feel real and internally consistent.${systemSketches.length > 0 ? `\nThe user has already provided these systems — include them as-is and flesh them out with additional principles/constraints/interactions if appropriate:\n${systemSketches.map(s => {
  const parts = [`- ${s.name}: ${s.description}`];
  if (s.principles.length) parts.push(`  Principles: ${s.principles.join('; ')}`);
  if (s.constraints.length) parts.push(`  Constraints: ${s.constraints.join('; ')}`);
  if (s.interactions.length) parts.push(`  Interactions: ${s.interactions.join('; ')}`);
  return parts.join('\n');
}).join('\n')}` : ''}

For each system, provide:
- name: A clear label
- description: One-line summary of what this system is
- principles (2-4): HOW it works — the core mechanics
- constraints (1-3): HARD LIMITS — costs, scarcity, failure modes
- interactions (1-2): CROSS-SYSTEM connections — how this system amplifies, suppresses, or feeds into other systems

The goal is to make the world feel like a coherent machine where systems interlock. Great worlds have systems that create emergent behavior — institutions that arise from mechanics, conflicts that emerge from scarcity, power that requires trade-offs.`;

  const reasoningBudget = REASONING_BUDGETS[reasoningLevel ?? 'medium'] || undefined;
  const useStream = !!(onToken || onReasoning);
  const raw = useStream
    ? await callGenerateStream(prompt, SYSTEM_PROMPT, onToken ?? (() => {}), MAX_TOKENS_LARGE, 'generateNarrative', GENERATE_MODEL, reasoningBudget, onReasoning)
    : await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_LARGE, 'generateNarrative', GENERATE_MODEL, reasoningBudget);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJson(raw, 'generateNarrative') as any;

  const now = Date.now();
  const id = `N-${now}`;

  const characters: NarrativeState['characters'] = {};
  for (const c of parsed.characters) characters[c.id] = c;

  const locations: NarrativeState['locations'] = {};
  for (const l of parsed.locations) locations[l.id] = l;

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

  const branchId = `B-${now}`;
  const branches: NarrativeState['branches'] = {
    [branchId]: {
      id: branchId,
      name: 'Main',
      parentBranchId: null,
      forkEntryId: null,
      entryIds: Object.keys(scenes),
      createdAt: now,
    },
  };

  // Sanitize and re-ID world knowledge mutations, then build cumulative graph
  const sceneList = Object.values(scenes);

  // Collect all WK mutations — from scenes normally, or from top-level worldKnowledge in worldOnly mode
  const allWKMutations: WorldKnowledgeMutation[] = [];
  if (worldOnly && parsed.worldKnowledge) {
    allWKMutations.push({
      addedNodes: parsed.worldKnowledge.addedNodes ?? [],
      addedEdges: parsed.worldKnowledge.addedEdges ?? [],
    });
  }
  for (const scene of sceneList) {
    if (!scene.worldKnowledgeMutations) {
      scene.worldKnowledgeMutations = { addedNodes: [], addedEdges: [] };
      continue;
    }
    scene.worldKnowledgeMutations.addedNodes = scene.worldKnowledgeMutations.addedNodes ?? [];
    scene.worldKnowledgeMutations.addedEdges = scene.worldKnowledgeMutations.addedEdges ?? [];
    allWKMutations.push(scene.worldKnowledgeMutations);
  }

  const totalWKNodes = allWKMutations.reduce((sum, m) => sum + m.addedNodes.length, 0);
  const wkIds = nextIds('WK', [], totalWKNodes);
  let wkIdx = 0;
  const wkIdMap: Record<string, string> = {};
  const worldKnowledgeNodes: Record<string, WorldKnowledgeNode> = {};
  const worldKnowledgeEdges: WorldKnowledgeEdge[] = [];

  for (const mutation of allWKMutations) {
    // Assign real IDs to new nodes
    for (const node of mutation.addedNodes) {
      const oldId = node.id;
      node.id = wkIds[wkIdx++];
      wkIdMap[oldId] = node.id;
      worldKnowledgeNodes[node.id] = { id: node.id, concept: node.concept, type: node.type };
    }

    // Remap edge references and accumulate
    const validWKIds = new Set(Object.keys(worldKnowledgeNodes));
    mutation.addedEdges = mutation.addedEdges
      .map((edge) => ({
        from: wkIdMap[edge.from] ?? edge.from,
        to: wkIdMap[edge.to] ?? edge.to,
        relation: edge.relation,
      }))
      .filter((edge) => validWKIds.has(edge.from) && validWKIds.has(edge.to));

    for (const edge of mutation.addedEdges) {
      if (!worldKnowledgeEdges.some((e) => e.from === edge.from && e.to === edge.to && e.relation === edge.relation)) {
        worldKnowledgeEdges.push({ from: edge.from, to: edge.to, relation: edge.relation });
      }
    }
  }

  // Generate embeddings for scene summaries
  if (sceneList.length > 0) {
    try {
      const { generateEmbeddingsBatch } = await import('@/lib/embeddings');
      const { assetManager } = await import('@/lib/asset-manager');
      const summaries = sceneList.map(s => s.summary);
      const embeddings = await generateEmbeddingsBatch(summaries, id);
      for (let i = 0; i < sceneList.length; i++) {
        const embeddingId = await assetManager.storeEmbedding(embeddings[i], 'text-embedding-3-small');
        sceneList[i].summaryEmbedding = embeddingId;
      }
    } catch {
      // Don't fail world generation if embedding fails
    }
  }

  // Build thread log graphs from initial scene mutations
  let threadNodeCounter = 0;
  const lastThreadNodeId: Record<string, string> = {};
  for (const scene of sceneList) {
    for (const tm of scene.threadMutations ?? []) {
      const thread = threads[tm.threadId];
      if (!thread) continue;
      const nodeId = `TK-${String(++threadNodeCounter).padStart(3, '0')}`;
      const nodeType = tm.from === tm.to ? 'pulse' as const : 'transition' as const;
      const content = tm.from === tm.to
        ? `Pulse: ${scene.summary?.slice(0, 100) ?? 'thread touched'}`
        : `${tm.from}→${tm.to}: ${scene.summary?.slice(0, 100) ?? 'transition'}`;
      thread.threadLog.nodes[nodeId] = { id: nodeId, content, type: nodeType };
      const prevId = lastThreadNodeId[tm.threadId];
      if (prevId) {
        thread.threadLog.edges.push({ from: prevId, to: nodeId, relation: tm.from === tm.to ? 'continues' : 'causes' });
      }
      lastThreadNodeId[tm.threadId] = nodeId;
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
      worldKnowledgeNodes: Object.keys(worldKnowledgeNodes).length,
    },
  });

  return {
    id,
    title,
    description: premise,
    characters,
    locations,
    threads,
    artifacts: Object.fromEntries((parsed.artifacts ?? []).map((a: Artifact) => [a.id, a])),
    arcs,
    scenes,
    worldBuilds: {},
    branches,
    relationships: parsed.relationships ?? [],
    worldKnowledge: { nodes: worldKnowledgeNodes, edges: worldKnowledgeEdges },
    worldSummary: parsed.worldSummary ?? premise,
    imageStyle: typeof parsed.imageStyle === 'string' ? parsed.imageStyle : undefined,
    rules: Array.isArray(parsed.rules) ? parsed.rules.filter((r: unknown) => typeof r === 'string') : rules,
    worldSystems: Array.isArray(parsed.worldSystems) ? parsed.worldSystems.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => s && typeof s.name === 'string'
    ).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => ({
        id: s.id ?? `WS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: s.name,
        description: typeof s.description === 'string' ? s.description : '',
        principles: Array.isArray(s.principles) ? s.principles.filter((p: unknown) => typeof p === 'string') : [],
        constraints: Array.isArray(s.constraints) ? s.constraints.filter((c: unknown) => typeof c === 'string') : [],
        interactions: Array.isArray(s.interactions) ? s.interactions.filter((x: unknown) => typeof x === 'string') : [],
      })
    ) : [],
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
    storySettings: typeof parsed.planGuidance === 'string' && parsed.planGuidance.trim()
      ? { ...DEFAULT_STORY_SETTINGS, planGuidance: parsed.planGuidance.trim() }
      : undefined,
    createdAt: now,
    updatedAt: now,
  };
}
