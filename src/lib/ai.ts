import type { NarrativeState, Scene, Arc, Character, Location, Thread, RelationshipEdge } from '@/types/narrative';
import { resolveEntry } from '@/types/narrative';

export type WorldExpansion = {
  characters: Character[];
  locations: Location[];
  threads: Thread[];
  relationships: RelationshipEdge[];
};

async function callGenerate(prompt: string, systemPrompt: string): Promise<string> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, systemPrompt }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Generation failed');
  }
  const data = await res.json();
  return data.content;
}

/**
 * Build full context from all scenes up to (and including) the current scene index.
 * This gives the AI the complete branch history, not just the last 5 scenes.
 */
function branchContext(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  const characters = Object.values(n.characters)
    .map((c) => `- ${c.id}: ${c.name} (${c.role})`)
    .join('\n');
  const locations = Object.values(n.locations)
    .map((l) => `- ${l.id}: ${l.name}${l.parentId ? ` (inside ${n.locations[l.parentId]?.name ?? l.parentId})` : ''}`)
    .join('\n');
  const threads = Object.values(n.threads)
    .map((t) => `- ${t.id}: ${t.description} [${t.status}]`)
    .join('\n');
  const relationships = n.relationships
    .map((r) => {
      const fromName = n.characters[r.from]?.name ?? r.from;
      const toName = n.characters[r.to]?.name ?? r.to;
      return `- ${fromName} -> ${toName}: ${r.type} (valence: ${r.valence})`;
    })
    .join('\n');

  // Full scene history up to current index
  const keysUpToCurrent = resolvedKeys.slice(0, currentIndex + 1);
  const sceneHistory = keysUpToCurrent.map((k, i) => {
    const s = resolveEntry(n, k);
    if (!s) return '';
    if (s.kind === 'world_build') {
      return `[${i + 1}] ${s.id} [WORLD BUILD]\n   ${s.summary}`;
    }
    const loc = n.locations[s.locationId]?.name ?? s.locationId;
    const participants = s.participantIds.map((pid) => n.characters[pid]?.name ?? pid).join(', ');
    const threadChanges = s.threadMutations.map((tm) => `${tm.threadId}: ${tm.from}->${tm.to}`).join('; ');
    return `[${i + 1}] ${s.id} @ ${loc} | ${participants}${threadChanges ? ` | Threads: ${threadChanges}` : ''}
   ${s.summary}`;
  }).filter(Boolean).join('\n');

  // Arcs context
  const arcs = Object.values(n.arcs)
    .map((a) => `- ${a.id}: "${a.name}" (${a.sceneIds.length} scenes, develops: ${a.develops.join(', ')})`)
    .join('\n');

  return `NARRATIVE: "${n.title}"
WORLD: ${n.worldSummary}

CHARACTERS:
${characters}

LOCATIONS:
${locations}

THREADS:
${threads}

RELATIONSHIPS:
${relationships}

ARCS:
${arcs}

FULL SCENE HISTORY (${keysUpToCurrent.length} scenes on current branch):
${sceneHistory}`;
}

const SYSTEM_PROMPT = `You are a narrative simulation engine that generates structured scene data for interactive storytelling.
You must ALWAYS respond with valid JSON only — no markdown, no explanation, no code fences.
Follow the exact schema requested in each prompt.`;

/** Clean common LLM JSON quirks: code fences, trailing commas, single-quoted keys */
function cleanJson(raw: string): string {
  let s = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

/**
 * Suggest a direction for the next arc based on the full branch context.
 * Returns a short text suggestion the user can edit before generating.
 */
export type DirectionSuggestion = {
  text: string;
  arcName: string;
  suggestedSceneCount: number;
};

export async function suggestDirection(
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
- What would create the most dramatic escalation?
- How many scenes this arc needs to land properly (don't rush — quiet arcs need fewer, epic arcs need more)

Return JSON with this exact structure:
{
  "arcName": "suggested arc name",
  "direction": "2-3 sentence description of what the next arc should focus on and why",
  "sceneSuggestion": "brief outline of what kind of scenes would work",
  "suggestedSceneCount": 3
}

suggestedSceneCount must be between 1 and 8.`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT);
  const parsed = JSON.parse(cleanJson(raw));
  const sceneCount = Math.max(1, Math.min(8, parsed.suggestedSceneCount ?? 3));
  return {
    text: `${parsed.arcName}: ${parsed.direction}${parsed.sceneSuggestion ? '\n\n' + parsed.sceneSuggestion : ''}`,
    arcName: parsed.arcName ?? '',
    suggestedSceneCount: sceneCount,
  };
}

export async function generateScenes(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  count: number,
  arcName: string,
  direction: string,
  existingArc?: Arc,
): Promise<{ scenes: Scene[]; arc: Arc }> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);
  const lastSceneKey = resolvedKeys[currentIndex];
  const lastEntry = lastSceneKey ? resolveEntry(narrative, lastSceneKey) : null;
  const lastForce = (lastEntry?.kind === 'scene' ? lastEntry.forceSnapshot : null) ?? { pressure: 0.5, momentum: 0.5, flux: 0.5 };

  const arcId = existingArc?.id ?? `ARC-${Date.now()}`;
  const arcInstruction = existingArc
    ? `CONTINUE the existing arc "${existingArc.name}" (${arcId}) which already has ${existingArc.sceneIds.length} scenes. Add exactly ${count} new scenes that naturally extend this arc.`
    : `Generate a NEW ARC called "${arcName}" with exactly ${count} scenes.`;
  const prompt = `${ctx}

${arcInstruction}
The arc should follow this direction: ${direction}

The scenes must continue from the current point in the story (after scene index ${currentIndex + 1}).

NARRATIVE FORCES (current values from last scene):
- pressure: ${lastForce.pressure} — external threats, stakes, urgency bearing down on characters
- momentum: ${lastForce.momentum} — pace of events, how fast things are moving and changing
- flux: ${lastForce.flux} — instability, uncertainty, how much the situation could shift unpredictably

Force dynamics guidance:
- Forces should respond to WHAT HAPPENS in each scene, not follow a preset curve
- A revelation scene might spike flux (uncertainty) while dropping momentum (everyone freezes)
- A confrontation spikes pressure and momentum but may resolve flux
- A quiet aftermath scene can drop all three — but dormant pressure often rises subtly
- Forces MUST stay between 0 and 1. Changes between consecutive scenes should usually be 0.05-0.2 unless something dramatic happens
- The arc's overall trajectory should reflect its direction: an escalation arc trends upward, a resolution arc trends downward, a mystery arc oscillates flux

Return JSON with this exact structure:
{
  "scenes": [
    {
      "id": "S-GEN-001",
      "arcId": "${arcId}",
      "locationId": "existing location ID from the narrative",
      "participantIds": ["existing character IDs"],
      "events": ["event_tag_1", "event_tag_2"],
      "threadMutations": [{"threadId": "T-XX", "from": "current_status", "to": "new_status"}],
      "knowledgeMutations": [{"characterId": "C-XX", "nodeId": "K-GEN-001", "action": "added", "content": "what they learned", "nodeType": "a descriptive type for this knowledge"}],
      "relationshipMutations": [{"from": "C-XX", "to": "C-YY", "type": "description", "valenceDelta": 0.1}],
      "forceSnapshot": {"pressure": 0.5, "momentum": 0.5, "flux": 0.5},
      "prose": "",
      "summary": "2-4 sentence narrative summary written in vivid, character-driven prose"
    }
  ]
}

Rules:
- Use ONLY existing character IDs and location IDs from the narrative context above
- Thread statuses should be descriptive strings that capture the thread's current state (e.g. "dormant", "surfacing", "escalating", "fractured", "converging", "critical")
- Force values must reflect the narrative reality of each scene — see force dynamics guidance above
- Scene IDs must be unique: S-GEN-001, S-GEN-002, etc.
- Knowledge node IDs must be unique: K-GEN-001, K-GEN-002, etc.
- knowledgeMutations.nodeType should be a specific, contextual label for what kind of knowledge this is — NOT limited to a fixed set. Examples: "tactical_insight", "betrayal_discovered", "forbidden_technique", "political_leverage", "hidden_lineage", "oath_sworn". Choose the type that best describes the specific knowledge gained.
- Thread mutations should reflect the direction — escalate relevant threads, surface dormant ones

PACING:
- Not every scene should be a major plot event. Include quieter scenes: character moments, travel, reflection, relationship building, exploring the world.
- Only 1 in 3 scenes should be a significant plot beat. Others should build atmosphere, deepen character, or set up future payoffs.
- Vary the scene rhythm: a tense scene should be followed by a breather, not another tense scene.
- Threads should evolve gradually — don't rush thread mutations. A dormant thread surfaces slowly, not in one jump to escalating.`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT);

  const parsed = JSON.parse(cleanJson(raw));

  const scenes: Scene[] = parsed.scenes.map((s: Scene, i: number) => ({
    ...s,
    kind: 'scene' as const,
    id: `S-GEN-${Date.now()}-${i + 1}`,
    arcId,
  }));

  // Fix knowledge mutation IDs to be unique
  let kCounter = 1;
  for (const scene of scenes) {
    for (const km of scene.knowledgeMutations) {
      km.nodeId = `K-GEN-${Date.now()}-${kCounter++}`;
    }
  }

  const newSceneIds = scenes.map((s) => s.id);
  const newDevelops = [...new Set(scenes.flatMap((s) => s.threadMutations.map((tm) => tm.threadId)))];
  const newLocationIds = [...new Set(scenes.map((s) => s.locationId))];
  const newCharacterIds = [...new Set(scenes.flatMap((s) => s.participantIds))];

  const arc: Arc = existingArc
    ? {
        ...existingArc,
        sceneIds: [...existingArc.sceneIds, ...newSceneIds],
        develops: [...new Set([...existingArc.develops, ...newDevelops])],
        locationIds: [...new Set([...existingArc.locationIds, ...newLocationIds])],
        activeCharacterIds: [...new Set([...existingArc.activeCharacterIds, ...newCharacterIds])],
      }
    : {
        id: arcId,
        name: arcName,
        sceneIds: newSceneIds,
        develops: newDevelops,
        locationIds: newLocationIds,
        activeCharacterIds: newCharacterIds,
        initialCharacterLocations: {},
      };

  if (!existingArc && scenes.length > 0) {
    for (const cid of arc.activeCharacterIds) {
      const firstScene = scenes.find((s) => s.participantIds.includes(cid));
      if (firstScene) {
        arc.initialCharacterLocations[cid] = firstScene.locationId;
      }
    }
  }

  return { scenes, arc };
}

/**
 * Suggest world expansion based on full branch context.
 */
export async function suggestWorldExpansion(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): Promise<string> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

  const prompt = `${ctx}

Based on the full narrative context above, suggest what NEW elements the world needs.
Consider:
- Are there locations referenced in scenes that don't exist yet?
- Are there implied characters who should be introduced?
- Are there narrative threads that need new anchors?
- What would deepen the world and create new story possibilities?

Return JSON with this exact structure:
{
  "suggestion": "2-4 sentence description of what should be added to the world and why"
}`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT);
  const parsed = JSON.parse(cleanJson(raw));
  return parsed.suggestion;
}

/**
 * Generate new world elements (characters, locations, threads, relationships)
 * that get merged into the existing narrative.
 */
export async function expandWorld(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  directive: string,
): Promise<WorldExpansion> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

  const now = Date.now();
  const prompt = `${ctx}

EXPAND the world based on this directive: ${directive}

Generate NEW characters, locations, threads, and relationships that fit the existing narrative.
Use IDs that won't collide with existing ones (use the timestamp ${now} in IDs).

Return JSON with this exact structure:
{
  "characters": [
    {
      "id": "C-${now}-1",
      "name": "string",
      "role": "anchor|recurring|transient",
      "threadIds": [],
      "knowledge": {
        "nodes": [{"id": "K-${now}-1", "type": "contextual_type", "content": "string"}],
        "edges": [{"from": "K-${now}-1", "to": "K-${now}-2", "type": "contextual_edge_type"}]
      }
    }
  ],
  "locations": [
    {
      "id": "L-${now}-1",
      "name": "string",
      "parentId": null or "existing location ID for nesting",
      "threadIds": [],
      "knowledge": {
        "nodes": [{"id": "LK-${now}-1", "type": "contextual_type", "content": "string"}],
        "edges": []
      }
    }
  ],
  "threads": [
    {
      "id": "T-${now}-1",
      "anchors": [{"id": "character or location ID", "type": "character|location"}],
      "description": "string",
      "status": "dormant",
      "openedAt": "new",
      "dependents": []
    }
  ],
  "relationships": [
    {"from": "character ID", "to": "character ID", "type": "description", "valence": 0.0}
  ]
}

Rules:
- Generate elements that serve the directive
- Characters should have meaningful knowledge graphs (2-4 nodes, 1-3 edges)
- Knowledge node types should be SPECIFIC and CONTEXTUAL — not generic labels. Choose types that describe exactly what kind of knowledge or lore this is. Examples: "cultivation_technique", "blood_pact", "hidden_treasury", "ancient_prophecy", "political_alliance", "forbidden_memory", "territorial_claim", "ancestral_grudge". Pick types that fit the narrative world.
- Knowledge edge types should also be contextual: "enables", "contradicts", "unlocks", "corrupts", "conceals", "depends_on", "mirrors", etc.
- Locations should fit the world hierarchy (use existing parentIds where appropriate)
- Location knowledge should describe lore, dangers, secrets, or resources specific to that place
- Threads should connect to existing or new characters/locations via anchors
- Relationships can reference both existing and new character IDs
- Anchors in threads can reference existing characters/locations
- Generate at least 1 of each type, but only as many as the directive demands`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT);
  const parsed = JSON.parse(cleanJson(raw));

  return {
    characters: parsed.characters ?? [],
    locations: parsed.locations ?? [],
    threads: parsed.threads ?? [],
    relationships: parsed.relationships ?? [],
  };
}

export async function generateNarrative(
  title: string,
  premise: string,
): Promise<NarrativeState> {
  const prompt = `Create a complete narrative world for:
Title: "${title}"
Premise: ${premise}

Return JSON with this exact structure:
{
  "worldSummary": "2-3 sentence world description",
  "characters": [
    {"id": "C-01", "name": "string", "role": "anchor|recurring|transient", "threadIds": ["T-01"], "knowledge": {"nodes": [{"id": "K-01", "type": "specific_contextual_type", "content": "string"}], "edges": [{"from": "K-01", "to": "K-02", "type": "contextual_edge_type"}]}}
  ],
  "locations": [
    {"id": "L-01", "name": "string", "parentId": null, "threadIds": [], "knowledge": {"nodes": [{"id": "LK-01", "type": "specific_contextual_type", "content": "string"}], "edges": []}}
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
      "participantIds": ["C-01"],
      "events": ["event_tag"],
      "threadMutations": [{"threadId": "T-01", "from": "dormant", "to": "surfacing"}],
      "knowledgeMutations": [],
      "relationshipMutations": [],
      "forceSnapshot": {"pressure": 0.2, "momentum": 0.2, "flux": 0.1},
      "prose": "",
      "summary": "scene summary"
    }
  ],
  "arcs": [
    {"id": "ARC-01", "name": "string", "sceneIds": ["S-001"], "develops": ["T-01"], "locationIds": ["L-01"], "activeCharacterIds": ["C-01"], "initialCharacterLocations": {"C-01": "L-01"}}
  ]
}

Generate a world with enough CRITICAL MASS to sustain a long-running story:
- 6-10 characters: at least 3 anchors, 3-4 recurring, 1-2 transient. Each with 4-8 knowledge nodes and 3-6 edges. Characters should have secrets, goals, beliefs, and tactical knowledge — not just surface-level facts.
- 6-10 locations with hierarchy (parent/child nesting). Each with 2-4 knowledge nodes describing lore, dangers, secrets, or resources. Locations should feel lived-in.
- 5-8 threads representing major narrative tensions, mysteries, and conflicts. Threads should interlock — at least some threads should share dependents or anchors.
- 8-10 relationships between characters. Relationships should be asymmetric (A→B differs from B→A) with specific, character-voice descriptions. Use valence to show warmth vs hostility.
- 15-25 scenes across 2-3 arcs. Each arc should have 5-10 scenes.

PACING IS CRITICAL:
- Do NOT rush through major plot beats. A story needs breathing room.
- Not every scene should advance the main plot. Include quiet scenes: character conversations, world exploration, daily life, travel, reflection.
- Only 1 in 3-4 scenes should be a significant plot event. The rest should build atmosphere, deepen relationships, or reveal character.
- Threads should stay dormant or slowly surface over multiple scenes before escalating. A thread going from dormant to escalating in 2 scenes is too fast.
- Think of pacing like a novel: setup → slow build → complication → breathing room → escalation. Not: event → event → event → event.
- Early scenes should establish normalcy and stakes before disrupting them.

Knowledge types must be SPECIFIC and CONTEXTUAL to the world — not generic labels like "knows" or "secret". Use types that describe exactly what kind of knowledge or lore this is (e.g. "cultivation_technique", "blood_debt", "prophecy_fragment", "territorial_claim", "hidden_identity"). Knowledge edge types should also be contextual: "enables", "contradicts", "unlocks", "corrupts", "conceals", "depends_on", etc.

Force dynamics:
- pressure: external threats, stakes, urgency bearing down on characters (0-1)
- momentum: pace of events, how fast things are changing (0-1)
- flux: instability, uncertainty, unpredictability of the situation (0-1)
- Forces should reflect what actually happens in each scene — a tense confrontation has high pressure, a mystery scene has high flux, a quiet scene has low momentum
- Forces should evolve scene-to-scene based on events, not follow a mechanical curve`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT);
  const parsed = JSON.parse(cleanJson(raw));

  const now = Date.now();
  const id = `N-${now}`;

  const characters: NarrativeState['characters'] = {};
  for (const c of parsed.characters) characters[c.id] = c;

  const locations: NarrativeState['locations'] = {};
  for (const l of parsed.locations) locations[l.id] = l;

  const threads: NarrativeState['threads'] = {};
  for (const t of parsed.threads) threads[t.id] = t;

  const scenes: NarrativeState['scenes'] = {};
  for (const s of parsed.scenes) scenes[s.id] = { ...s, kind: 'scene' };

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

  const sceneList = Object.values(scenes);
  const commits = sceneList.map((scene, i) => ({
    id: `CM-${String(i + 1).padStart(3, '0')}`,
    parentId: i === 0 ? null : `CM-${String(i).padStart(3, '0')}`,
    sceneId: scene.id,
    arcId: scene.arcId,
    diffName: scene.events[0] ?? 'scene',
    threadMutations: scene.threadMutations,
    knowledgeMutations: scene.knowledgeMutations,
    relationshipMutations: scene.relationshipMutations,
    forceDeltas: {
      pressure: i === 0 ? 0 : +(scene.forceSnapshot.pressure - sceneList[i - 1].forceSnapshot.pressure).toFixed(2),
      momentum: i === 0 ? 0 : +(scene.forceSnapshot.momentum - sceneList[i - 1].forceSnapshot.momentum).toFixed(2),
      flux: i === 0 ? 0 : +(scene.forceSnapshot.flux - sceneList[i - 1].forceSnapshot.flux).toFixed(2),
    },
    authorOverride: null,
    createdAt: now - (sceneList.length - i) * 3600000,
  }));

  const lastScene = sceneList[sceneList.length - 1];

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
    worldSummary: parsed.worldSummary ?? premise,
    controlMode: 'auto',
    activeForces: lastScene?.forceSnapshot ?? { pressure: 0.5, momentum: 0.5, flux: 0.5 },
    createdAt: now,
    updatedAt: now,
  };
}
