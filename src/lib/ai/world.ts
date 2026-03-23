import type { NarrativeState, Character, Location, Thread, RelationshipEdge, WorldKnowledgeNode, WorldKnowledgeEdge, WorldKnowledgeMutation } from '@/types/narrative';
import { THREAD_ACTIVE_STATUSES } from '@/types/narrative';
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

suggestedSceneCount must be between 1 and 8.`;

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

Return JSON: { "direction": "2-4 sentences describing the big-picture story direction" }`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'suggestStoryDirection');
  const parsed = parseJson(raw, 'suggestStoryDirection') as { direction?: string };
  return parsed.direction ?? '';
}


export type WorldExpansionSize = 'small' | 'medium' | 'large';

const EXPANSION_SIZE_CONFIG: Record<WorldExpansionSize, { total: string; characters: string; locations: string; threads: string; label: string }> = {
  small:  { total: '3-6',   characters: '1-2',   locations: '1-2',   threads: '1-2',   label: 'a focused expansion (~5 total entities)' },
  medium: { total: '10-15', characters: '3-5',   locations: '3-4',   threads: '3-5',   label: 'a moderate expansion (~12 total entities)' },
  large:  { total: '20-35', characters: '8-15',  locations: '6-10',  threads: '8-12',  label: 'a large-scale expansion (~30 total entities)' },
};

export async function suggestWorldExpansion(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  size: WorldExpansionSize = 'medium',
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
- Which threads need new anchors to develop? What new open questions would deepen the story?
- Are there power structures, social hierarchies, or institutional relationships missing?
- Could adding characters from different social strata or factions create productive tension?

Your suggestion should emphasize HOW new elements connect to existing ones — not just what to add, but who they relate to and where they fit in the hierarchy.

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
): Promise<WorldExpansion> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

  // Compute next sequential IDs for the AI to use
  const nextCharId = nextId('C', Object.keys(narrative.characters));
  const nextLocId = nextId('L', Object.keys(narrative.locations));
  const nextThreadId = nextId('T', Object.keys(narrative.threads));
  const existingKIds = [
    ...Object.values(narrative.characters).flatMap((c) => (c.continuity?.nodes ?? []).map((n) => n.id)),
    ...Object.values(narrative.locations).flatMap((l) => (l.continuity?.nodes ?? []).map((n) => n.id)),
  ];
  const nextKId = nextId('K', existingKIds);

  // Build existing entity summary for integration context
  const existingCharList = Object.values(narrative.characters).map(c => `${c.id}: ${c.name} (${c.role})`).join(', ');
  const existingLocList = Object.values(narrative.locations).map(l => `${l.id}: ${l.name}${l.parentId ? ` (child of ${l.parentId})` : ''}`).join(', ');
  const existingRelList = narrative.relationships.map(r => `${r.from}→${r.to}: ${r.type}`).join(', ');

  const prompt = `${ctx}

${directive.trim() ? `EXPAND the world based on this directive: ${directive}` : 'EXPAND the world — analyze the current narrative state and add characters, locations, and threads that would create the most interesting new possibilities based on existing tensions and unexplored areas.'}

This is ${EXPANSION_SIZE_CONFIG[size].label} (${EXPANSION_SIZE_CONFIG[size].total} total new entities). Generate:
- ${EXPANSION_SIZE_CONFIG[size].characters} new characters
- ${EXPANSION_SIZE_CONFIG[size].locations} new locations
- ${EXPANSION_SIZE_CONFIG[size].threads} new threads
- Relationships connecting new characters to EXISTING characters (this is critical)

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
      "anchors": [{"id": "character or location ID", "type": "character|location"}],
      "description": "string",
      "status": "dormant",
      "openedAt": "new",
      "dependents": []
    }
  ],
  "relationships": [
    {"from": "character ID", "to": "character ID", "type": "description", "valence": 0.0}
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
- Knowledge node IDs: continue sequentially from ${nextKId} (e.g., ${nextKId}, K-${String(parseInt(nextKId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- ALL knowledge nodes (in both characters and locations) use the K- prefix and share one sequence

INTEGRATION RULES (most important):
- EVERY new character MUST have at least one relationship to an EXISTING character. No orphans. Think: who in the existing world would know this person? Who are they allied with, opposed to, related to, or hiding from?
- Generate at MINIMUM ${EXPANSION_SIZE_CONFIG[size].characters === '1-2' ? '2' : EXPANSION_SIZE_CONFIG[size].characters === '3-5' ? '5' : '12'} relationships total. Most should connect new→existing characters. A few can connect new→new.
- Include varied relationship valences: allies, rivals, mentors, debtors, enemies, kin. At least one relationship should have tension (negative or ambivalent valence).
- EVERY new location SHOULD have a parentId referencing an existing location — build a deeper hierarchy. Only use null for truly independent top-level regions. If the world has cities, nest new locations inside them. If it has regions, place new settlements within them.
- Thread anchors MUST include at least one existing character or location — threads that only reference new entities won't integrate.

CONTENT RULES:
- Characters should have meaningful knowledge (3-5 nodes). Give each character SECRETS or unique knowledge that only they possess — knowledge asymmetries drive narrative tension. Include at least one hidden or dangerous piece of knowledge per character.
- Knowledge node types should be SPECIFIC and CONTEXTUAL — not generic labels. Examples: "cultivation_technique", "blood_pact", "hidden_treasury", "ancient_prophecy", "political_alliance", "forbidden_memory", "territorial_claim", "ancestral_grudge". Pick types that fit the narrative world.
- New locations should CONTRAST with existing ones — if the story has been set in cities, add wilderness; if in palaces, add slums or ruins. Environmental variety drives scene variety.
- Location knowledge should describe lore, dangers, secrets, or resources specific to that place (3-4 nodes per location)
- Threads should introduce DIFFERENT types of open questions than existing ones — if current threads are about conflict, add threads about mystery, loyalty, or forbidden knowledge.
- ALL new threads MUST have status "dormant" — they are seeds for future arcs, not active storylines yet
- Generate the exact counts specified above (${EXPANSION_SIZE_CONFIG[size].characters} characters, ${EXPANSION_SIZE_CONFIG[size].locations} locations, ${EXPANSION_SIZE_CONFIG[size].threads} threads)

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
  const threads = (parsed.threads ?? []).map((t: Thread) => ({ ...t, status: THREAD_ACTIVE_STATUSES[0] }));

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
  };
}

export async function generateNarrative(
  title: string,
  premise: string,
  rules: string[] = [],
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
    {"id": "T-01", "anchors": [{"id": "C-01", "type": "character"}], "description": "string", "status": "dormant", "openedAt": "S-001", "dependents": []}
  ],
  "relationships": [
    {"from": "C-01", "to": "C-02", "type": "description", "valence": 0.5}
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
  "rules": ["World rule 1", "World rule 2"]
}

Generate a world with enough CRITICAL MASS to sustain a long-running story:
- 6-10 characters: at least 3 anchors, 3-4 recurring, 1-2 transient. Each with 4-8 knowledge nodes. Characters should have secrets, goals, beliefs, and tactical knowledge — not just surface-level facts.
- 6-10 locations with hierarchy (parent/child nesting). Each with 2-4 knowledge nodes describing lore, dangers, secrets, or resources. Locations should feel lived-in.
- 5-8 threads representing major narrative tensions, mysteries, and conflicts. Threads should interlock — at least some threads should share dependents or anchors.
- 8-10 relationships between characters. Relationships should be asymmetric (A→B differs from B→A) with specific, character-voice descriptions. Use valence to show warmth vs hostility.
- Exactly 8 scenes in 1 arc, following the introduction pacing sequence below. Use varied locations — showcase the world's best settings across different scenes.

${buildSequencePrompt(buildIntroductionSequence())}

${PROMPT_POV}
${PROMPT_FORCE_STANDARDS}
${PROMPT_PACING}
${PROMPT_MUTATIONS}
${PROMPT_CONTINUITY}
${PROMPT_SUMMARY_REQUIREMENT}

WORLD RULES: Generate 4-6 world rules — absolute constraints that every scene must obey. These define the physics, magic system limits, social rules, or thematic laws of the world.${rules.length > 0 ? ` The user has already provided these rules — include them as-is and add more if appropriate:\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : ''}`;

  const raw = onToken
    ? await callGenerateStream(prompt, SYSTEM_PROMPT, onToken, MAX_TOKENS_LARGE, 'generateNarrative', GENERATE_MODEL)
    : await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_LARGE, 'generateNarrative', GENERATE_MODEL);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJson(raw, 'generateNarrative') as any;
  console.log('[generateNarrative] parsed keys:', Object.keys(parsed));
  console.log('[generateNarrative] relationships count:', parsed.relationships?.length ?? 0);
  console.log('[generateNarrative] scenes count:', parsed.scenes?.length ?? 0);

  const now = Date.now();
  const id = `N-${now}`;

  const characters: NarrativeState['characters'] = {};
  for (const c of parsed.characters) characters[c.id] = c;

  const locations: NarrativeState['locations'] = {};
  for (const l of parsed.locations) locations[l.id] = l;

  const threads: NarrativeState['threads'] = {};
  for (const t of parsed.threads) threads[t.id] = t;

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

  const commits = sceneList.map((scene, i) => ({
    id: `CM-${String(i + 1).padStart(3, '0')}`,
    parentId: i === 0 ? null : `CM-${String(i).padStart(3, '0')}`,
    sceneId: scene.id,
    arcId: scene.arcId,
    diffName: scene.events[0] ?? 'scene',
    threadMutations: scene.threadMutations,
    continuityMutations: scene.continuityMutations,
    relationshipMutations: scene.relationshipMutations,
    authorOverride: null,
    createdAt: now - (sceneList.length - i) * 3600000,
  }));

  return {
    id,
    title,
    description: premise,
    characters,
    locations,
    threads,
    arcs,
    scenes,
    worldBuilds: {},
    branches,
    commits,
    relationships: parsed.relationships ?? [],
    worldKnowledge: { nodes: worldKnowledgeNodes, edges: worldKnowledgeEdges },
    worldSummary: parsed.worldSummary ?? premise,
    rules: Array.isArray(parsed.rules) ? parsed.rules.filter((r: unknown) => typeof r === 'string') : rules,
    controlMode: 'auto',
    activeForces: { payoff: 0, change: 0, knowledge: 0 },
    createdAt: now,
    updatedAt: now,
  };
}
