import type { NarrativeState, Scene, Character, Location, Thread, RelationshipEdge, WorldKnowledgeNode, WorldKnowledgeEdge, WorldKnowledgeMutation, Artifact } from '@/types/narrative';
import { THREAD_ACTIVE_STATUSES, resolveEntry, isScene } from '@/types/narrative';
import { nextId, nextIds } from '@/lib/narrative-utils';
import { callGenerate, callGenerateStream, SYSTEM_PROMPT } from './api';
import { MAX_TOKENS_LARGE, GENERATE_MODEL } from '@/lib/constants';
import { parseJson } from './json';
import { branchContext } from './context';
import { PROMPT_FORCE_STANDARDS, PROMPT_PACING, PROMPT_MUTATIONS, PROMPT_POV, PROMPT_CONTINUITY, PROMPT_SUMMARY_REQUIREMENT } from './prompts';
import { buildSequencePrompt, buildIntroductionSequence } from '@/lib/markov';

export type WorldExpansion = {
  characters: Character[];
  locations: Location[];
  threads: Thread[];
  relationships: RelationshipEdge[];
  worldKnowledgeMutations?: WorldKnowledgeMutation;
  artifacts?: Artifact[];
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
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

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

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'suggestDirection');
  const parsed = parseJson(raw, 'suggestDirection') as {
    arcName?: string; direction?: string; sceneSuggestion?: string; suggestedSceneCount?: number;
  };
  const sceneCount = Math.max(1, Math.min(8, parsed.suggestedSceneCount ?? 3));
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
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

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

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'suggestStoryDirection');
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
    ? Object.values(narrative.characters).reduce((sum, c) => sum + (c.continuity?.nodes?.length ?? 0), 0) / totalCharacters
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
  if (depthSignals.length > breadthSignals.length + 1) {
    recommendation = 'depth';
    reasoning = `Depth recommended: ${depthSignals.join('; ')}`;
  } else if (breadthSignals.length > depthSignals.length + 1) {
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

export type WorldExpansionSize = 'small' | 'medium' | 'large';
export type WorldExpansionStrategy = 'breadth' | 'depth' | 'dynamic';

const EXPANSION_SIZE_CONFIG: Record<WorldExpansionSize, { total: string; characters: string; locations: string; threads: string; label: string }> = {
  small:  { total: '3-6',   characters: '1-2',   locations: '1-2',   threads: '1-2',   label: 'a focused expansion (~5 total entities)' },
  medium: { total: '10-15', characters: '3-5',   locations: '3-4',   threads: '3-5',   label: 'a moderate expansion (~12 total entities)' },
  large:  { total: '20-35', characters: '8-15',  locations: '6-10',  threads: '8-12',  label: 'a large-scale expansion (~30 total entities)' },
};

const EXPANSION_STRATEGY_PROMPTS: Record<WorldExpansionStrategy, string> = {
  breadth: `STRATEGY: BREADTH — widen the world. Introduce new regions, factions, and characters that open up unexplored areas of the map. Focus on geographic and social variety. New locations should be INDEPENDENT zones (new settlements, distant regions, rival territories) rather than sub-locations of existing places. New characters should come from different backgrounds than existing ones. New threads should introduce entirely new conflicts, not deepen existing ones.`,

  depth: `STRATEGY: DEPTH — deepen the existing world. Do NOT add new top-level regions or distant factions. Instead:
- Add sub-locations WITHIN existing locations (rooms inside buildings, districts inside cities, hidden areas within known places)
- Add characters who are ALREADY embedded in existing social structures (subordinates, rivals, mentors, family members of existing characters)
- Add threads that complicate EXISTING tensions rather than introducing new ones
- Add more knowledge nodes per entity (5-8 per character, 4-6 per location) — secrets, history, hidden agendas, resource details
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
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

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

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'suggestWorldExpansion');
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
): Promise<WorldExpansion> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

  // Compute next sequential IDs for the AI to use
  const nextCharId = nextId('C', Object.keys(narrative.characters));
  const nextLocId = nextId('L', Object.keys(narrative.locations));
  const nextThreadId = nextId('T', Object.keys(narrative.threads));
  const nextArtifactId = nextId('A', Object.keys(narrative.artifacts ?? {}));
  const existingKIds = [
    ...Object.values(narrative.characters).flatMap((c) => (c.continuity?.nodes ?? []).map((n) => n.id)),
    ...Object.values(narrative.locations).flatMap((l) => (l.continuity?.nodes ?? []).map((n) => n.id)),
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

${strategyBlock}

This is ${EXPANSION_SIZE_CONFIG[size].label} (${EXPANSION_SIZE_CONFIG[size].total} total new entities). Generate:
- ${EXPANSION_SIZE_CONFIG[size].characters} new characters
- ${EXPANSION_SIZE_CONFIG[size].locations} new locations
- ${EXPANSION_SIZE_CONFIG[size].threads} new threads
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
      "imagePrompt": "1-2 sentence visual description: physical appearance, clothing, distinguishing features. Used for portrait generation.",
      "continuity": {
        "nodes": [{"id": "${nextKId}", "type": "contextual_type", "content": "string"}]
      }
    }
  ],
  "locations": [
    {
      "id": "${nextLocId}",
      "name": "string",
      "parentId": "REQUIRED: existing location ID (e.g. L-01) to nest under, or null ONLY for top-level regions",
      "threadIds": [],
      "imagePrompt": "1-2 sentence visual description: architecture, landscape, atmosphere, lighting. Used for establishing shot generation.",
      "continuity": {
        "nodes": [{"id": "K-next", "type": "contextual_type", "content": "string"}]
      }
    }
  ],
  "threads": [
    {
      "id": "${nextThreadId}",
      "participants": [{"id": "character or location ID", "type": "character|location"}],
      "description": "string",
      "status": "dormant",
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
      "parentId": "owner — a character or location ID",
      "continuity": {"nodes": [{"id": "K-next", "type": "contextual_type", "content": "what it is, what it does, its history, its powers, its limitations — everything about this artifact lives in its continuity"}]},
      "imagePrompt": "1-2 sentence visual description"
    }
  ],
  "worldKnowledgeMutations": {
    "addedNodes": [{"id": "WK-GEN-001", "concept": "foundational world concept", "type": "law|system|concept|tension"}],
    "addedEdges": [{"from": "WK-GEN-001", "to": "existing-WK-ID", "relation": "relationship"}]
  }
}

ID RULES:
- Character IDs: continue sequentially from ${nextCharId} (e.g., ${nextCharId}, C-${String(parseInt(nextCharId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- Location IDs: continue sequentially from ${nextLocId} (e.g., ${nextLocId}, L-${String(parseInt(nextLocId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- Thread IDs: continue sequentially from ${nextThreadId} (e.g., ${nextThreadId}, T-${String(parseInt(nextThreadId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- Artifact IDs: continue sequentially from ${nextArtifactId} (e.g., ${nextArtifactId}, A-${String(parseInt(nextArtifactId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- Knowledge node IDs: continue sequentially from ${nextKId} (e.g., ${nextKId}, K-${String(parseInt(nextKId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- ALL knowledge nodes (in both characters and locations) use the K- prefix and share one sequence

INTEGRATION RULES (most important):
- EVERY new character MUST have at least one relationship to an EXISTING character. No orphans. Think: who in the existing world would know this person? Who are they allied with, opposed to, related to, or hiding from?
- Generate at MINIMUM ${EXPANSION_SIZE_CONFIG[size].characters === '1-2' ? '2' : EXPANSION_SIZE_CONFIG[size].characters === '3-5' ? '5' : '12'} relationships total. Most should connect new→existing characters. A few can connect new→new.
- Include varied relationship valences: allies, rivals, mentors, debtors, enemies, kin. At least one relationship should have tension (negative or ambivalent valence).
- EVERY new location SHOULD have a parentId referencing an existing location — build a deeper hierarchy. Only use null for truly independent top-level regions. If the world has cities, nest new locations inside them. If it has regions, place new settlements within them.
- Thread participants MUST include at least one existing character or location — threads that only reference new entities won't integrate.
- Artifacts MUST have a parentId referencing a character or location. A character can possess an artifact from the start (a king's crown, a warrior's blade). Artifacts at locations are discoverable — visiting that place can trigger acquisition. Transferring an artifact to a DIFFERENT character must happen in a scene via ownershipMutation — that's the earned moment. Key artifacts should have 3-5 continuity nodes (what it is, what it does, its history, its limitations). Only create artifacts when they would meaningfully alter what characters can do. Not every expansion needs artifacts.

CONTENT RULES:
- Characters should have meaningful knowledge (3-5 nodes). Give each character SECRETS or unique knowledge that only they possess — knowledge asymmetries drive narrative tension. Include at least one hidden or dangerous piece of knowledge per character.
- Knowledge node types should be SPECIFIC and CONTEXTUAL — not generic labels. Examples: "cultivation_technique", "blood_pact", "hidden_treasury", "ancient_prophecy", "political_alliance", "forbidden_memory", "territorial_claim", "ancestral_grudge". Pick types that fit the narrative world.
- New locations should CONTRAST with existing ones — if the story has been set in cities, add wilderness; if in palaces, add slums or ruins. Environmental variety drives scene variety.
- Location knowledge should describe lore, dangers, secrets, or resources specific to that place (3-4 nodes per location)
- Threads should introduce DIFFERENT types of open questions than existing ones — if current threads are about conflict, add threads about mystery, loyalty, or forbidden knowledge.
- ALL new threads MUST have status "dormant" — they are seeds for future arcs, not active storylines yet
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
- Use "law" for governing truths and hard constraints, "system" for institutions/processes, "concept" for named ideas/phenomena, "tension" for contradictions or unresolved forces.
- Node IDs should be WK-GEN-001, WK-GEN-002, etc. (they will be re-mapped to real IDs).
- Edges can reference both new WK-GEN-* IDs and existing world knowledge IDs already in the narrative.
- Generate 3-8 world knowledge nodes depending on expansion size, with edges connecting related concepts.
- Focus on the structural WHY behind the expansion — what abstract rules, power structures, or tensions make these new entities meaningful?`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'expandWorld');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJson(raw, 'expandWorld') as any;

  // Force all world-build threads to dormant — they're seeds, not active storylines
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
      return { id: realId, concept: node.concept, type: node.type as 'law' | 'system' | 'concept' | 'tension' };
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

  return {
    characters: parsed.characters ?? [],
    locations: parsed.locations ?? [],
    threads,
    relationships: parsed.relationships ?? [],
    worldKnowledgeMutations,
    artifacts: parsed.artifacts ?? [],
  };
}

export async function generateNarrative(
  title: string,
  premise: string,
  rules: string[] = [],
  systemSketches: { name: string; description: string; principles: string[]; constraints: string[]; interactions: string[] }[] = [],
  onToken?: (token: string) => void,
): Promise<NarrativeState> {
  const prompt = `Create a complete narrative world for:
Title: "${title}"
Premise: ${premise}

Return JSON with this exact structure:
{
  "worldSummary": "2-3 sentence world description",
  "characters": [
    {"id": "C-01", "name": "string", "role": "anchor|recurring|transient", "threadIds": ["T-01"], "imagePrompt": "1-2 sentence visual description of physical appearance, clothing, distinguishing features for portrait generation", "continuity": {"nodes": [{"id": "K-01", "type": "specific_contextual_type", "content": "string"}]}}
  ],
  "locations": [
    {"id": "L-01", "name": "string", "parentId": null, "threadIds": [], "imagePrompt": "1-2 sentence visual description of architecture, landscape, atmosphere for establishing shot generation", "continuity": {"nodes": [{"id": "LK-01", "type": "specific_contextual_type", "content": "string"}]}}
  ],
  "threads": [
    {"id": "T-01", "participants": [{"id": "C-01", "type": "character"}], "description": "string", "status": "dormant", "openedAt": "S-001", "dependents": []}
  ],
  "relationships": [
    {"from": "C-01", "to": "C-02", "type": "description", "valence": 0.5}
  ],
  "artifacts": [
    {"id": "A-01", "name": "string", "significance": "key|notable|minor", "parentId": "character or location ID", "continuity": {"nodes": [{"id": "AK-01", "type": "specific_type", "content": "what it is, what it does, its history, its powers, its limitations"}]}, "imagePrompt": "1-2 sentence visual description"}
  ],
  "scenes": [
    {
      "id": "S-001",
      "arcId": "ARC-01",
      "locationId": "L-01",
      "povId": "C-01",
      "participantIds": ["C-01"],
      "events": ["event_tag"],
      "threadMutations": [{"threadId": "T-01", "from": "dormant", "to": "active"}],
      "continuityMutations": [{"characterId": "C-XX", "nodeId": "K-GEN-001", "action": "added", "content": "what they learned", "nodeType": "a descriptive type for this knowledge"}],
      "relationshipMutations": [],
      "worldKnowledgeMutations": {"addedNodes": [{"id": "WK-GEN-001", "concept": "name of a world concept, rule, system, or structure", "type": "law|system|concept|tension"}], "addedEdges": [{"from": "WK-GEN-001", "to": "WK-GEN-002", "relation": "typed relationship: enables, requires, governs, opposes, created_by, extends, etc."}]},
      "summary": "REQUIRED: 3-5 sentence detailed narrative summary. Name characters and locations. Describe the key action, the consequence, and the tension it creates for what comes next. Example: 'Michael Corleone sits across from Sollozzo and McCluskey at the small Italian restaurant in the Bronx, listening to terms he has no intention of accepting. He excuses himself to the bathroom where a pistol has been planted behind the toilet tank. He returns to the table and shoots both men. The gun clatters to the floor as Michael walks out in a daze to a waiting car. The killing severs him permanently from his civilian life and sets in motion a gang war that will consume every family in New York.'"
    }
  ],
  "arcs": [
    {"id": "ARC-01", "name": "string", "sceneIds": ["S-001"], "develops": ["T-01"], "locationIds": ["L-01"], "activeCharacterIds": ["C-01"], "initialCharacterLocations": {"C-01": "L-01"}}
  ],
  "rules": ["World rule 1", "World rule 2"],
  "worldSystems": [
    {"id": "WS-01", "name": "System Name", "description": "One-line summary of what this system is", "principles": ["How it works"], "constraints": ["Hard limits and costs"], "interactions": ["How it connects to other systems"]}
  ]
}

HARD MINIMUMS — the world MUST contain at least these counts. Generating fewer is a failure:
- EXACTLY 18 characters: 3 anchors + 5 recurring + 10 transient
- EXACTLY 20 locations with parent/child hierarchy (at least 3 nesting levels)
- EXACTLY 6 threads (interlocking — at least 3 must share participants)
- EXACTLY 20 relationships (asymmetric, at least 3 hostile)
- EXACTLY 3 artifacts (at least 1 key, 1 notable, 1 minor)
- EXACTLY 10 world knowledge nodes with 6 edges
- EXACTLY 8 scenes in 1 arc

CHARACTER DEPTH BY ROLE:
- Anchors (3): 6-8 knowledge nodes each — secrets, goals, fears, contradictions
- Recurring (5): 3-5 knowledge nodes each — a clear role, a relationship to an anchor, at least one hidden agenda
- Transient (10): 1-2 knowledge nodes each — shopkeepers, guards, neighbours, lackeys, bystanders. These populate the world. Not every character needs to matter — some just need to exist.

LOCATION HIERARCHY:
- Build spatial nesting: Region → Settlement → District → Specific Place
- A city with 5 sub-locations feels more real than 5 unconnected cities
- Include contrasting environments: if the story starts safe, the world needs a dangerous frontier
- Each location: 2-4 knowledge nodes (lore, dangers, who controls it)

RELATIONSHIPS:
- Connect anchors to MANY characters (6+ relationships per anchor)
- Asymmetric descriptions: "A admires B" while "B suspects A"
- At least 2 hidden relationships (known to reader, not to characters)

ARTIFACTS:
- Key artifact (1): a plot-altering object that characters will scheme to acquire, protect, or destroy. 4-5 continuity nodes covering what it is, what it does, its history, and its limitations. Must be owned by a character or placed at a location where it can be discovered.
- Notable artifact (1): a tool that grants a specific capability — a weapon, a key, a document. 2-3 continuity nodes. Owned by a character who uses it.
- Minor artifact (1): a small object with narrative potential — a token, a letter, a trinket. 1-2 continuity nodes. Can be at a location.
- Artifacts must feel integral to the world — not bolted on. The key artifact should connect to at least one thread.

Every anchor must appear in at least 3 scenes. Use at least 6 different locations across the 8 scenes.

${buildSequencePrompt(buildIntroductionSequence())}

${PROMPT_POV}
${PROMPT_FORCE_STANDARDS}
${PROMPT_PACING}
${PROMPT_MUTATIONS}
${PROMPT_CONTINUITY}
${PROMPT_SUMMARY_REQUIREMENT}

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

  const raw = onToken
    ? await callGenerateStream(prompt, SYSTEM_PROMPT, onToken, MAX_TOKENS_LARGE, 'generateNarrative', GENERATE_MODEL)
    : await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_LARGE, 'generateNarrative', GENERATE_MODEL);
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
    threads[t.id] = { ...rest, participants: rest.participants ?? anchors ?? [] };
  }

  const scenes: NarrativeState['scenes'] = {};
  for (const s of parsed.scenes) scenes[s.id] = { ...s, kind: 'scene', summary: s.summary || `Scene ${s.id}` };

  const arcs: NarrativeState['arcs'] = {};
  for (const a of parsed.arcs) arcs[a.id] = a;

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
  const totalWKNodes = sceneList.reduce((sum, s) => sum + (s.worldKnowledgeMutations?.addedNodes?.length ?? 0), 0);
  const wkIds = nextIds('WK', [], totalWKNodes);
  let wkIdx = 0;
  const wkIdMap: Record<string, string> = {};
  const worldKnowledgeNodes: Record<string, WorldKnowledgeNode> = {};
  const worldKnowledgeEdges: WorldKnowledgeEdge[] = [];

  for (const scene of sceneList) {
    if (!scene.worldKnowledgeMutations) {
      scene.worldKnowledgeMutations = { addedNodes: [], addedEdges: [] };
      continue;
    }
    scene.worldKnowledgeMutations.addedNodes = scene.worldKnowledgeMutations.addedNodes ?? [];
    scene.worldKnowledgeMutations.addedEdges = scene.worldKnowledgeMutations.addedEdges ?? [];

    // Assign real IDs to new nodes
    for (const node of scene.worldKnowledgeMutations.addedNodes) {
      const oldId = node.id;
      node.id = wkIds[wkIdx++];
      wkIdMap[oldId] = node.id;
      worldKnowledgeNodes[node.id] = { id: node.id, concept: node.concept, type: node.type };
    }

    // Remap edge references and accumulate
    const validWKIds = new Set(Object.keys(worldKnowledgeNodes));
    scene.worldKnowledgeMutations.addedEdges = scene.worldKnowledgeMutations.addedEdges
      .map((edge) => ({
        from: wkIdMap[edge.from] ?? edge.from,
        to: wkIdMap[edge.to] ?? edge.to,
        relation: edge.relation,
      }))
      .filter((edge) => validWKIds.has(edge.from) && validWKIds.has(edge.to));

    for (const edge of scene.worldKnowledgeMutations.addedEdges) {
      if (!worldKnowledgeEdges.some((e) => e.from === edge.from && e.to === edge.to && e.relation === edge.relation)) {
        worldKnowledgeEdges.push({ from: edge.from, to: edge.to, relation: edge.relation });
      }
    }
  }

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
    createdAt: now,
    updatedAt: now,
  };
}
