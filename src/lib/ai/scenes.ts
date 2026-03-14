import type { NarrativeState, Scene, Arc, CubeCornerKey, WorldBuildCommit, StorySettings } from '@/types/narrative';
import { resolveEntry, NARRATIVE_CUBE, THREAD_TERMINAL_STATUSES, DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { nextId, nextIds } from '@/lib/narrative-utils';
import { callGenerate, callGenerateStream, SYSTEM_PROMPT } from './api';
import { WRITING_MODEL, ANALYSIS_MODEL, GENERATE_MODEL } from '@/lib/constants';
import { parseJson } from './json';
import { branchContext, sceneContext, deriveLogicRules, sceneScale, THREAD_LIFECYCLE_DOC } from './context';

export async function generateScenes(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  count: number,
  direction: string,
  existingArc?: Arc,
  cubeGoal?: CubeCornerKey,
  rejectSiblings?: { name: string; summary: string }[],
  worldBuildFocus?: WorldBuildCommit,
  onToken?: (token: string) => void,
): Promise<{ scenes: Scene[]; arc: Arc }> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);
  const arcId = existingArc?.id ?? nextId('ARC', Object.keys(narrative.arcs));
  const storySettings: StorySettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };
  const targetLen = storySettings.targetArcLength;
  const sceneCountInstruction = count > 0
    ? `exactly ${count} scenes`
    : `${Math.max(2, targetLen - 1)}-${targetLen + 1} scenes (choose the count that best fits the arc's natural length)`;
  const arcInstruction = existingArc
    ? `CONTINUE the existing arc "${existingArc.name}" (${arcId}) which already has ${existingArc.sceneIds.length} scenes. Add ${sceneCountInstruction} that naturally extend this arc.`
    : `Generate a NEW ARC with ${sceneCountInstruction}. Give the arc a short, evocative name (2-4 words) that reads like a chapter title — specific to the story, not generic.`;
  const prompt = `${ctx}

${arcInstruction}
DIRECTION (this takes priority over any patterns in the scene history below):
${direction}
${worldBuildFocus ? (() => {
  const wb = worldBuildFocus;
  const chars = wb.expansionManifest.characterIds
    .map((id) => { const c = narrative.characters[id]; return c ? `${c.name} (${c.role})` : null; })
    .filter(Boolean);
  const locs = wb.expansionManifest.locationIds
    .map((id) => narrative.locations[id]?.name)
    .filter(Boolean);
  const threads = wb.expansionManifest.threadIds
    .map((id) => { const t = narrative.threads[id]; return t ? `${t.description} [${t.status}]` : null; })
    .filter(Boolean);
  const lines: string[] = [`WORLD BUILD FOCUS (${wb.id} — "${wb.summary}"): The entities below were recently introduced and have not yet had a presence in the story. This arc should bring them in — use these characters in scenes, set at least one scene in these locations, and begin activating these dormant threads:`];
  if (chars.length) lines.push(`  Characters: ${chars.join(', ')}`);
  if (locs.length) lines.push(`  Locations: ${locs.join(', ')}`);
  if (threads.length) lines.push(`  Threads to activate: ${threads.join('; ')}`);
  return '\n' + lines.join('\n') + '\n';
})() : ''}
The scenes must continue from the current point in the story (after scene index ${currentIndex + 1}).

${cubeGoal ? (() => {
  const cube = NARRATIVE_CUBE[cubeGoal];
  const p = cube.forces.payoff > 0;
  const c = cube.forces.change > 0;
  const k = cube.forces.knowledge > 0;
  // Per-corner narrative instructions — each combination gets a distinct creative brief
  const CORNER_INSTRUCTIONS: Record<CubeCornerKey, string> = {
    HHH: `This is an EPOCH arc — everything converges. Threads should reach critical turning points or resolve. Characters undergo meaningful transformation. The world's rules expand — introduce new concepts that connect to existing knowledge and reshape understanding. This is the narrative crescendo — stakes are real, consequences are permanent, and the world's structure deepens. Maintain POV streaks (2-4 scenes per perspective).`,
    HHL: `This is a CLIMAX arc — the established cast faces their reckoning within known world rules. Drive threads to critical/terminal statuses with the core characters the reader knows well. Characters change profoundly through intense interactions. No new world concepts needed — this is about payoff for what's already been built. Anchor on one POV for most of the arc.`,
    HLH: `This is a REVELATION arc — threads pay off through world-building. The world's rules explain why things happened — new concepts and connections unlock resolution. Characters witness rather than transform — they're processing revelations about how the world works. Think: a hidden system is exposed, a rule of magic is understood, a political structure is laid bare. Keep POV changes purposeful.`,
    HLL: `This is a CLOSURE arc — tying up loose ends within established world rules. Threads reach resolution quietly — not with a bang but with acceptance. No new world concepts, no character transformation. Conversations that needed to happen finally do. Stay with one POV and familiar settings.`,
    LHH: `This is a DISCOVERY arc — characters grow rapidly through encountering new world systems. No threads need to resolve — this is about exploration and world-building. Introduce new concepts, rules, and connections that expand the knowledge graph. Characters are learning, adapting, being changed by encountering how the world works. Think: discovering a magic system, entering a new culture, uncovering ancient history. Maintain POV streaks.`,
    LHL: `This is a GROWTH arc — the familiar cast evolves through internal development within established world rules. No plot payoffs needed — threads stay active but don't resolve. No new world concepts. Characters train, bond, argue, process, and change through interaction. Think: training montages, heart-to-heart conversations, mentorship. Anchor on one POV.`,
    LLH: `This is a LORE arc — pure world-building without resolution or personal transformation. Establish new rules, systems, cultures, and connections in the world knowledge graph. Threads simmer without advancing. Think: a sage explains the magic system, a journey through lands with distinct customs, the narrator establishes world context through action and observation. Use one POV throughout.`,
    LLL: `This is a REST arc — recovery and seed-planting. Nothing resolves, no one transforms, no new world concepts. Quiet character beats, domestic scenes with undercurrents. Subtle foreshadowing through small details. Stay with one POV and one location.`,
  };
  return `
NARRATIVE CUBE GOAL — "${cube.name}" (${cubeGoal}: Payoff ${p ? 'High' : 'Low'}, Change ${c ? 'High' : 'Low'}, Knowledge ${k ? 'High' : 'Low'}):
${CORNER_INSTRUCTIONS[cubeGoal]}

This goal OVERRIDES any momentum from previous scenes. Write scenes that genuinely embody this corner's energy — don't default to generic action or generic rest.`;
})() : ''}
${rejectSiblings && rejectSiblings.length > 0 ? `
ALREADY GENERATED AT THIS BRANCH POINT (${rejectSiblings.length} alternatives exist):
${rejectSiblings.filter((s) => s.summary).map((s) => `- "${s.name}": ${s.summary}`).join('\n')}
${rejectSiblings.filter((s) => !s.summary).length > 0 ? `Also being generated in parallel: ${rejectSiblings.filter((s) => !s.summary).map((s) => s.name).join(', ')}` : ''}

CRITICAL: Your arc MUST be substantially different from ALL of the above. Do NOT use similar arc names (avoid "Echoes of…", "Seeds of…", "Whispers of…" if those patterns appear above). Do NOT cover the same plot beats or involve the same character groupings. Find a completely different angle — a different subplot, different characters in focus, a different emotional register, or a different narrative question entirely.` : ''}

Return JSON with this exact structure:
{
  "arcName": "A short, evocative arc name (2-4 words) like a chapter title. Must be UNIQUE — not a variation of any existing arc name. Bad: 'Continuation', 'New Beginnings', 'Echoes of X', 'Seeds of Y'. Good: 'The Siege of Ashenmoor', 'Fractured Oaths', 'Blackwater Gambit'.",
  "scenes": [
    {
      "id": "S-GEN-001",
      "arcId": "${arcId}",
      "locationId": "existing location ID from the narrative",
      "povId": "character ID whose perspective this scene is told from (MUST be an anchor-role character who is also a participant)${storySettings.povMode !== 'free' && storySettings.povCharacterIds.length > 0 ? ` — RESTRICTED to: ${storySettings.povCharacterIds.join(', ')}` : ''}",
      "participantIds": ["existing character IDs"],
      "characterMovements": {"C-XX": {"locationId": "L-YY", "transition": "Descriptive transition narrating HOW they moved, e.g. 'Rode horseback through the night', 'Slipped through the back gate at dawn', 'Got on a bus to the school'"}},
      "events": ["event_tag_1", "event_tag_2"],
      "threadMutations": [{"threadId": "T-XX", "from": "current_status", "to": "new_status"}],
      "continuityMutations": [{"characterId": "C-XX", "nodeId": "K-GEN-001", "action": "added", "content": "what they learned", "nodeType": "a descriptive type for this knowledge"}],
      "relationshipMutations": [{"from": "C-XX", "to": "C-YY", "type": "description", "valenceDelta": 0.1}],
      "worldKnowledgeMutations": {"addedNodes": [{"id": "WK-GEN-001", "concept": "name of a world concept, rule, system, or structure", "type": "law|system|concept|tension"}], "addedEdges": [{"from": "WK-GEN-001", "to": "WK-XX", "relation": "typed relationship: enables, requires, governs, located_in, opposes, created_by, extends, etc."}]},
      "summary": "REQUIRED: 2-4 sentence narrative summary written in vivid, character-driven prose. Describe what happens, who is involved, and the emotional stakes."
    }
  ]
}

Rules:
- EVERY scene MUST have a non-empty "summary" field. This is critical — scenes without summaries are broken. Write 2-4 vivid sentences describing the scene's events, characters, and emotional stakes.
- Use ONLY existing character IDs and location IDs from the narrative context above
- Thread statuses follow a lifecycle. ${THREAD_LIFECYCLE_DOC}
- Threads that have reached their narrative conclusion MUST be transitioned to a terminal status. Do not leave threads stuck in active states when their story is over. When a mystery is solved, a conflict is won/lost, a goal is achieved or failed — close the thread.
- Each thread must be DISTINCT — if two threads describe the same underlying tension, they should be merged. Only mutate threads whose status actually changes in this scene.
- Scene IDs must be unique: S-GEN-001, S-GEN-002, etc.
- Knowledge node IDs must be unique: K-GEN-001, K-GEN-002, etc.
- continuityMutations.nodeType should be a specific, contextual label for what kind of knowledge this is — NOT limited to a fixed set. Examples: "tactical_insight", "betrayal_discovered", "forbidden_technique", "political_leverage", "hidden_lineage", "oath_sworn". Choose the type that best describes the specific knowledge gained.
- Thread mutations should reflect the direction — escalate relevant threads, surface dormant ones when appropriate
- relationshipMutations track how character dynamics shift. Include them when interactions change — trust gained, betrayal discovered, alliance forming, rivalry deepening. valenceDelta ranges from -0.5 (major damage) to +0.5 (major bonding). Most interactions are ±0.1 to ±0.2.
- continuityMutations track what characters learn. Include them when a character gains or loses information — secrets revealed, lies uncovered, skills observed, intel gathered.
- events capture concrete narrative happenings. Use specific, descriptive tags: "ambush_at_dawn", "secret_pact_formed", "duel_of_wits", "storm_breaks", "letter_intercepted". Aim for 2-4 events per scene.
- worldKnowledgeMutations track the world's abstract structure — rules, systems, ideas, and tensions that define the world characters inhabit. NOT character knowledge (that's continuityMutations). World knowledge exists in every genre: fantasy has magic systems, literary fiction has class structures and social norms, historical fiction has period customs, crime has institutional hierarchies. Four node types: "law" (governing truths), "system" (institutions, processes), "concept" (named ideas, symbolic motifs, places-as-concepts), "tension" (contradictions, unresolved forces). Add nodes when a scene reveals, reinforces, or tests a world concept. Add edges when it connects concepts — edges can reference existing world knowledge node IDs from the context above OR newly created WK-GEN-XXX IDs. Most scenes touch the world in some way — a conversation reveals social norms, a fight tests power hierarchies, a journey exposes geography or customs. Aim for at least 1 world knowledge node per scene; world-building scenes may have 3-5 with edges.
- World knowledge node IDs must be unique: WK-GEN-001, WK-GEN-002, etc.
- characterMovements track when characters physically relocate to a different location during the scene. Only include characters whose location CHANGES — omit characters who stay put. The "transition" field should be a vivid, specific description of HOW they traveled (e.g. "Fled through the sewers beneath the city", "Sailed upriver on a merchant barge"). The "locationId" MUST be a valid location ID from the narrative. Do NOT include movements where the destination is the same as the scene's locationId.

HOW YOUR CHOICES ARE MEASURED — every mutation feeds into three narrative forces that grade the story:

PAYOFF (thread resolution + relationship shifts):
- Each threadMutation contributes to Payoff based on the magnitude of the status transition. A jump from "dormant" to "escalating" scores higher than "active" to "active" (a pulse).
- Each relationshipMutation contributes its valenceDelta to Payoff. Bigger shifts (±0.3) matter more than subtle ones (±0.1).
- Terminal thread transitions (to resolved/subverted/abandoned) are the highest-value Payoff moments.
- A scene with no thread mutations and no relationship shifts scores zero on Payoff.

CHANGE (mutation depth across characters):
- Change measures how many characters are affected and how deeply. It sums log₂(1 + mutations) per character — diminishing returns per character, rewards breadth.
- continuityMutations and threadMutations count 1 each per character. relationshipMutations are weighted by |valenceDelta| — a big relationship shift (0.8) counts far more than a subtle one (0.1).
- A scene where 5 characters each have 1 mutation scores higher on Change than a scene where 1 character has 5 mutations.

KNOWLEDGE (world complexity delta):
- Each worldKnowledgeMutation node added contributes 1 to Knowledge. Each edge added contributes ½. New concepts are valued higher than new links between existing ones.
- Scenes that connect new concepts to EXISTING world knowledge (via edges to existing WK node IDs) build a denser, more valuable knowledge graph.
- Most scenes reveal something about the world — social dynamics, power structures, environmental details, cultural norms. Look for what each scene teaches the reader about how this world works.

MUTATION DENSITY GUIDELINES — scale mutations to match the scene's weight:
- A scene with many participants naturally involves more relationships shifting, more characters learning things, and more threads being touched. Let the cast size guide mutation count.
- Scenes with high narrative stakes (confrontations, revelations, betrayals) tend to produce denser mutations — threads jump phases, relationships crack or form, and characters gain critical knowledge.
- Quieter scenes (reflection, travel, rest) still have internal life — a character notices something (continuity), a relationship subtly shifts, a thread pulses — but fewer mutations is natural.
- Every scene exists in a world — even quiet character moments reveal social norms, power dynamics, or environmental truths. Look for the world knowledge each scene implicitly or explicitly conveys and capture it as worldKnowledgeMutations.
- The best narratives vary their force profiles across scenes — not every scene maxes all three forces. Rhythm matters.

POV DISCIPLINE:
- POV should come in STREAKS, not rapid alternation. Stay with one POV character for 2-4 consecutive scenes before switching. An ABABA pattern is disorienting — prefer AAABBA or AAABBCCC.
- When switching POV, the transition must be motivated: the new POV character has just learned something, arrived somewhere, or faces an urgent situation that demands the reader's attention.
- A POV switch is a cost — it breaks immersion. Only switch when the new perspective offers something the current POV cannot: a different location, access to hidden information, or an emotional angle the current character lacks.
- Within an arc, prefer to anchor on one or two POV characters rather than cycling through many. Save POV breadth for later arcs.

SPATIAL CONTINUITY:
- Location changes should be purposeful, not decorative. Characters move because the plot demands it.
- Consecutive scenes in the SAME location are often stronger than constant switching. Let scenes breathe in a space.
- When a location change IS needed, ground it with a characterMovement that describes the journey.
- Prefer to revisit established locations over introducing new ones. Familiar spaces accumulate meaning.

PACING:
- Not every scene should be a major plot event. Include quieter scenes: character moments, travel, reflection, relationship building.
- Only 1 in 3 scenes should be a significant plot beat. Others build atmosphere, deepen character, or plant seeds.
- Even quiet scenes benefit from small mutations — a character noticing tension, recalling a memory, warming to an ally, or growing suspicious all count.
- Threads evolve gradually — a dormant thread surfaces over several scenes, not in one jump. But don't be afraid to escalate when the story demands it.
- When a thread's storyline has concluded (conflict resolved, mystery answered, goal achieved or failed), transition it to a terminal status: ${THREAD_TERMINAL_STATUSES.map((s) => `"${s}"`).join(', ')}. Choose the terminal status that best fits HOW the thread ended.
- Threads can move BACKWARDS (e.g. "escalating" → "active" when tension temporarily eases, or "critical" → "escalating" after a partial resolution). Use regression when the story calls for it — not every scene ratchets tension upward.
- Include "pulse" mutations where a thread's status stays the same (e.g. "active" → "active") when the scene meaningfully engages with that thread without shifting its phase. A conversation that deepens a mystery without escalating it, or a scene that sustains tension at its current level, should still be tracked.
- Most scenes should touch 2-4 threads. Threads left unmentioned for many consecutive scenes feel abandoned — keep them pulsing even when they're not the focus.

CRITICAL ID CONSTRAINT (re-stated for emphasis):
You MUST use ONLY these exact IDs. Do NOT invent new character, location, or thread IDs.
  Character IDs: ${Object.keys(narrative.characters).join(', ')}
  Location IDs: ${Object.keys(narrative.locations).join(', ')}
  Thread IDs: ${Object.keys(narrative.threads).join(', ')}`;

  const raw = onToken
    ? await callGenerateStream(prompt, SYSTEM_PROMPT, onToken, undefined, 'generateScenes', GENERATE_MODEL)
    : await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'generateScenes', GENERATE_MODEL);

  const parsed = parseJson(raw, 'generateScenes') as { arcName?: string; scenes: Scene[] };
  const arcName = existingArc?.name ?? parsed.arcName ?? 'Untitled Arc';

  const sceneIds = nextIds('S', Object.keys(narrative.scenes), parsed.scenes.length, 3);
  const scenes: Scene[] = parsed.scenes.map((s: Scene, i: number) => ({
    ...s,
    kind: 'scene' as const,
    id: sceneIds[i],
    arcId,
    summary: s.summary || `Scene ${i + 1} of arc "${arcName}"`,
  }));

  // Sanitize hallucinated IDs — filter out invalid references instead of crashing
  const validCharIds = new Set(Object.keys(narrative.characters));
  const validLocIds = new Set(Object.keys(narrative.locations));
  const validThreadIds = new Set(Object.keys(narrative.threads));
  const stripped: string[] = [];

  // Determine anchor characters and find the most-used anchor by POV count for fallback
  const anchorIds = new Set(Object.entries(narrative.characters).filter(([, c]) => c.role === 'anchor').map(([id]) => id));
  const povCounts = new Map<string, number>();
  for (const s of Object.values(narrative.scenes)) {
    if (s.povId && anchorIds.has(s.povId)) {
      povCounts.set(s.povId, (povCounts.get(s.povId) ?? 0) + 1);
    }
  }
  const mostUsedAnchor = [...anchorIds].sort((a, b) => (povCounts.get(b) ?? 0) - (povCounts.get(a) ?? 0))[0]
    ?? Object.keys(narrative.characters)[0];

  for (const scene of scenes) {
    // Fix invalid locationId — fall back to first valid location
    if (!validLocIds.has(scene.locationId)) {
      stripped.push(`locationId "${scene.locationId}" in scene ${scene.id}`);
      scene.locationId = Object.keys(narrative.locations)[0];
    }
    // Fix invalid povId — must be a valid anchor character, fallback to most-used anchor
    if (!scene.povId || !validCharIds.has(scene.povId) || !anchorIds.has(scene.povId)) {
      if (scene.povId) stripped.push(`povId "${scene.povId}" in scene ${scene.id} (non-anchor or invalid)`);
      scene.povId = scene.participantIds.find((pid) => anchorIds.has(pid)) ?? mostUsedAnchor;
    }
    // Remove invalid participantIds
    const validParticipants = scene.participantIds.filter((pid) => {
      if (validCharIds.has(pid)) return true;
      stripped.push(`participantId "${pid}" in scene ${scene.id}`);
      return false;
    });
    scene.participantIds = validParticipants.length > 0
      ? validParticipants
      : [Object.keys(narrative.characters)[0]]; // ensure at least one participant
    // Ensure povId is a valid anchor participant
    if (!scene.participantIds.includes(scene.povId) || !anchorIds.has(scene.povId)) {
      scene.povId = scene.participantIds.find((pid) => anchorIds.has(pid)) ?? mostUsedAnchor;
    }
    // Remove invalid threadMutations
    scene.threadMutations = scene.threadMutations.filter((tm) => {
      if (validThreadIds.has(tm.threadId)) return true;
      stripped.push(`threadId "${tm.threadId}" in scene ${scene.id}`);
      return false;
    });
    // Remove invalid continuityMutations
    scene.continuityMutations = scene.continuityMutations.filter((km) => {
      if (!km.characterId || validCharIds.has(km.characterId)) return true;
      stripped.push(`knowledgeMutation characterId "${km.characterId}" in scene ${scene.id}`);
      return false;
    });
    // Remove invalid relationshipMutations
    scene.relationshipMutations = scene.relationshipMutations.filter((rm) => {
      if (validCharIds.has(rm.from) && validCharIds.has(rm.to)) return true;
      stripped.push(`relationshipMutation "${rm.from}" -> "${rm.to}" in scene ${scene.id}`);
      return false;
    });
    // Sanitize characterMovements — remove invalid charId/locationId entries
    if (scene.characterMovements) {
      const sanitized: Record<string, { locationId: string; transition: string }> = {};
      for (const [charId, mv] of Object.entries(scene.characterMovements)) {
        // Handle legacy string format (charId → locationId) from older LLM responses
        const movement = typeof mv === 'string' ? { locationId: mv, transition: '' } : mv;
        if (!validCharIds.has(charId)) {
          stripped.push(`characterMovement charId "${charId}" in scene ${scene.id}`);
          continue;
        }
        if (!validLocIds.has(movement.locationId)) {
          stripped.push(`characterMovement locationId "${movement.locationId}" in scene ${scene.id}`);
          continue;
        }
        sanitized[charId] = movement;
      }
      scene.characterMovements = Object.keys(sanitized).length > 0 ? sanitized : undefined;
    }
  }

  if (stripped.length > 0) {
    console.warn(
      `[generateScenes] Stripped ${stripped.length} hallucinated ID(s):\n` +
      stripped.map((h) => `  - ${h}`).join('\n')
    );
  }

  // Fix knowledge mutation IDs to be unique and sequential
  const existingKIds = [
    ...Object.values(narrative.characters).flatMap((c) => c.continuity.nodes.map((n) => n.id)),
    ...Object.values(narrative.locations).flatMap((l) => l.continuity.nodes.map((n) => n.id)),
  ];
  const totalKMutations = scenes.reduce((sum, s) => sum + s.continuityMutations.length, 0);
  const kIds = nextIds('K', existingKIds, totalKMutations);
  let kIdx = 0;
  for (const scene of scenes) {
    for (const km of scene.continuityMutations) {
      km.nodeId = kIds[kIdx++];
    }
  }

  // Sanitize and re-ID world knowledge mutations
  const existingWKIds = Object.keys(narrative.worldKnowledge?.nodes ?? {});
  const totalWKNodes = scenes.reduce((sum, s) => sum + (s.worldKnowledgeMutations?.addedNodes?.length ?? 0), 0);
  const wkIds = nextIds('WK', existingWKIds, totalWKNodes);
  let wkIdx = 0;
  const wkIdMap: Record<string, string> = {}; // maps GEN ids to real ids
  for (const scene of scenes) {
    if (!scene.worldKnowledgeMutations) {
      scene.worldKnowledgeMutations = { addedNodes: [], addedEdges: [] };
    }
    scene.worldKnowledgeMutations.addedNodes = scene.worldKnowledgeMutations.addedNodes ?? [];
    scene.worldKnowledgeMutations.addedEdges = scene.worldKnowledgeMutations.addedEdges ?? [];
    // Assign real IDs to new nodes
    for (const node of scene.worldKnowledgeMutations.addedNodes) {
      const oldId = node.id;
      node.id = wkIds[wkIdx++];
      wkIdMap[oldId] = node.id;
    }
    // Remap edge references (new GEN ids → real ids, existing ids pass through)
    const validWKIds = new Set([...existingWKIds, ...Object.values(wkIdMap)]);
    scene.worldKnowledgeMutations.addedEdges = scene.worldKnowledgeMutations.addedEdges
      .map((edge) => ({
        from: wkIdMap[edge.from] ?? edge.from,
        to: wkIdMap[edge.to] ?? edge.to,
        relation: edge.relation,
      }))
      .filter((edge) => validWKIds.has(edge.from) && validWKIds.has(edge.to));
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

export async function generateScenePlan(
  narrative: NarrativeState,
  scene: Scene,
  _sceneIndex: number,
  resolvedKeys: string[],
  onToken?: (token: string) => void,
): Promise<string> {
  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const fullContext = branchContext(narrative, resolvedKeys, contextIndex);
  const sceneBlock = sceneContext(narrative, scene);
  const logicRules = deriveLogicRules(narrative, scene);
  const logicBlock = logicRules.length > 0
    ? `\nLOGICAL CONSTRAINTS (the plan must satisfy all of these):\n${logicRules.map((r) => `  - ${r}`).join('\n')}\n`
    : '';

  // Adjacent scene plans for flow continuity
  const prevSceneKey = sceneIdx > 0 ? resolvedKeys[sceneIdx - 1] : null;
  const prevScene = prevSceneKey ? narrative.scenes[prevSceneKey] : null;
  const prevPlan = prevScene?.plan;

  const nextSceneKey = sceneIdx < resolvedKeys.length - 1 ? resolvedKeys[sceneIdx + 1] : null;
  const nextScene = nextSceneKey ? narrative.scenes[nextSceneKey] : null;
  const nextPlan = nextScene?.plan;

  const adjacentBlock = [
    prevPlan ? `PREVIOUS SCENE PLAN (your opening state must flow from this scene's closing state):\n${prevPlan}` : '',
    nextPlan ? `NEXT SCENE PLAN (your closing state must hand off naturally to this scene's opening):\n${nextPlan}` : '',
  ].filter(Boolean).join('\n\n');

  const scale = sceneScale(scene);

  const systemPrompt = `You are a dramaturg and scene architect for "${narrative.title}". Your job is to expand structural beats into a detailed staging plan that a prose writer can follow. Do NOT write prose — write a blueprint.

Output format (free-form text — length should match the scene's complexity; a simple scene needs a short plan, a dense multi-thread convergence needs a thorough one):

OPENING STATE
2-3 sentences: where characters are physically, what they know, emotional temperature entering the scene. If characters are arriving from elsewhere, describe HOW they arrived — the mode of travel, the journey's toll, what they saw along the way. Ground the reader in the spatial reality before the scene's action begins.

BEATS
Numbered list (4-8 beats). Each beat specifies:
- Trigger: what initiates this moment
- Action: what happens physically and emotionally
- Shift: what mutation (thread/knowledge/relationship) this dramatises, and HOW it occurs mechanically

Every structural mutation in the scene data MUST map to at least one beat with a concrete mechanism:
- Thread transitions need a trigger (not "the thread becomes active" but "the letter falls from the coat pocket, she reads it aloud")
- Knowledge discoveries need a device (overheard, found object, deduction, confession, demonstration, letter, physical evidence)
- Relationship shifts need a catalytic moment (a specific line, gesture, betrayal, sacrifice, shared danger)
- Character movements need a SPATIAL TRANSITION beat: describe the journey itself — what they see/experience in transit, how the landscape changes, what it costs them physically or emotionally. Transitions are narrative moments, not teleportation. Include sensory detail about the route (terrain, weather, crowds, vehicles) and the character's internal state during travel.
- World knowledge reveals need a discovery mechanism: a character explains a rule, demonstrates a technique, references a historical event, or the narrator establishes world context through action. Each new world concept should feel earned, not lectured. The mechanism must be specific — not 'they learn about X' but 'the old woman draws the rune pattern in ash and explains its binding properties'.
- Do NOT reuse the same discovery device across multiple beats

DIALOGUE SEEDS
2-4 key exchanges. For each: who speaks, the surface topic, and the subtext underneath. Not full dialogue — just the tension map.

CLOSING STATE
2-3 sentences: where everyone ends up physically and emotionally. If characters have moved to a new location, confirm their arrival and describe the new environment as they encounter it. What has irrevocably changed.

THE THREE PILLARS OF NARRATIVE LOGIC:

1. CONTINUITY LOGIC (what characters know):
- The scene is told from the POV character's perspective. They can only perceive what their senses and existing knowledge allow.
- In the OPENING STATE, specify exactly what the POV character knows and does NOT know. This sets the information boundary for the entire scene.
- When planning beats where NON-POV characters act on private knowledge, describe only their observable behaviour — the POV character must interpret from the outside (and may misread the situation).
- When the POV character discovers new knowledge (continuity mutation), the beat must specify the exact mechanism: what they see, hear, read, or deduce. No omniscient revelation.
- If another character conceals something from the POV character, note what the POV character sees on the surface vs. what is actually happening underneath. The plan should mark which layer the prose can access.

2. THREAD LOGIC (how plot advances):
- Each thread mutation must have a concrete narrative trigger — not "the thread escalates" but "the scout's report changes everything."
- Thread transitions are MOMENTS — they happen at a specific beat, not diffusely across the scene. Identify the exact beat where the status changes.
- Threads that pulse (same status → same status) still need a beat showing active engagement with the thread's tension.
- If multiple threads shift in one scene, stagger the moments — don't cluster all transitions in a single beat.

3. KNOWLEDGE LOGIC (what the world reveals):
- World knowledge nodes added in this scene have NOT been established yet at scene start. They must be REVEALED through the narrative — a character explains, demonstrates, discovers, or the narrator establishes through action.
- The OPENING STATE should note which world rules ARE already established (can be referenced freely) vs which will be revealed during the scene.
- World knowledge edges (connections between concepts) should be dramatised: if concept A "enables" concept B, show that enabling relationship through action, not exposition.
- Revelation mechanisms must be specific and earned — not "they learn about the magic system" but "the old woman lights the candle without a match, and when asked, explains that fire-calling is the first skill any practitioner masters."
- Existing world concepts from the knowledge graph can be REFERENCED in the plan as established facts. Only NEW concepts require revelation beats.

Rules:
- Be specific and concrete. "A tense exchange" is useless. "She asks about the missing shipment; he deflects by mentioning the festival" is useful.
- Include spatial blocking: who is where, who moves, sightlines, physical proximity.
- The plan must cover ALL events, thread mutations, continuity mutations, relationship mutations, character movements, and world knowledge reveals listed in the scene data. Missing any is a failure.
- Output ONLY the plan text. No JSON, no markdown fences, no commentary.`
  + (narrative.storySettings?.planGuidance?.trim()
    ? `\n\nPLAN GUIDANCE (follow these instructions when structuring your plan):\n${narrative.storySettings.planGuidance.trim()}`
    : '');

  const prompt = `BRANCH CONTEXT (for continuity — do not repeat):
${fullContext}

${adjacentBlock ? `${adjacentBlock}\n\n` : ''}${sceneBlock}
${logicBlock}
Create a detailed staging plan for this scene. Every structural mutation must have a concrete mechanism. Be specific about HOW things happen, not just WHAT happens.`;

  if (onToken) {
    return await callGenerateStream(prompt, systemPrompt, onToken, Math.ceil(scale.proseTokens * 0.6), 'generateScenePlan', WRITING_MODEL);
  }
  return await callGenerate(prompt, systemPrompt, Math.ceil(scale.proseTokens * 0.6), 'generateScenePlan', WRITING_MODEL);
}

export type ReconcileRevision = { plan: string; reason: string };

export async function reconcileScenePlans(
  narrative: NarrativeState,
  plans: { sceneId: string; plan: string }[],
): Promise<Record<string, ReconcileRevision>> {
  if (plans.length < 2) return {};

  const sceneSummaries = plans.map((p, i) => {
    const scene = narrative.scenes[p.sceneId];
    if (!scene) return `[${i + 1}] ${p.sceneId}\n${p.plan}`;
    const pov = narrative.characters[scene.povId]?.name ?? scene.povId;
    const loc = narrative.locations[scene.locationId]?.name ?? scene.locationId;
    const threadShifts = scene.threadMutations.map((tm) => {
      const t = narrative.threads[tm.threadId];
      return `${t?.description ?? tm.threadId}: ${tm.from} → ${tm.to}`;
    }).join('; ');
    return `[${i + 1}] ${p.sceneId} | POV: ${pov} | Location: ${loc}${threadShifts ? ` | Threads: ${threadShifts}` : ''}
PLAN:
${p.plan}`;
  }).join('\n\n---\n\n');

  const systemPrompt = `You are a story editor reviewing scene plans for continuity, pacing, and mechanical variety. Return ONLY valid JSON — no markdown, no commentary.`;

  const prompt = `Review these ${plans.length} sequential scene plans from "${narrative.title}" for cross-scene coherence.

${sceneSummaries}

Check for:
1. THREAD ORDERING: If thread T transitions in scene 3, earlier scene plans should not treat it as already transitioned.
2. EMOTIONAL CONTINUITY: A character ending scene N in a particular emotional state should open scene N+1 consistently.
3. REPEATED MECHANISMS: If scene 1 uses "overheard conversation" as a discovery device, later scenes should use different devices.
4. PACING: Not all scenes should have the same intensity or number of beats.
5. SPATIAL HANDOFFS: Character positions at scene N's closing must match scene N+1's opening.

Return JSON:
{
  "revisions": [
    {
      "sceneId": "S-XXX",
      "revisedPlan": "the full revised plan text",
      "reason": "brief explanation of what was changed and why"
    }
  ]
}

Rules:
- Only include scenes that need changes. If all plans are coherent, return {"revisions": []}.
- Preserve the plan structure (OPENING STATE, BEATS, DIALOGUE SEEDS, CLOSING STATE).
- Do not change WHAT happens — only HOW it's staged, ordered, or mechanically delivered.
- Preserve each plan's length — don't compress or expand unless the change requires it.`;

  const raw = await callGenerate(prompt, systemPrompt, 8000, 'reconcileScenePlans', ANALYSIS_MODEL);
  const parsed = parseJson(raw, 'reconcileScenePlans') as {
    revisions: { sceneId: string; revisedPlan: string; reason: string }[];
  };

  const result: Record<string, ReconcileRevision> = {};
  for (const rev of parsed.revisions ?? []) {
    if (rev.sceneId && rev.revisedPlan) {
      result[rev.sceneId] = { plan: rev.revisedPlan, reason: rev.reason ?? '' };
    }
  }
  return result;
}

export async function generateSceneProse(
  narrative: NarrativeState,
  scene: Scene,
  _sceneIndex: number,
  resolvedKeys: string[],
  onToken?: (token: string) => void,
): Promise<string> {

  // Branch context up to this scene — history without future details leaking in
  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const fullContext = branchContext(narrative, resolvedKeys, contextIndex);

  // Adjacent scene prose for seamless transitions
  const prevSceneKey = sceneIdx > 0 ? resolvedKeys[sceneIdx - 1] : null;
  const prevScene = prevSceneKey ? narrative.scenes[prevSceneKey] : null;
  const prevProse = prevScene?.prose;
  const prevProseEnding = prevProse
    ? prevProse.split('\n').filter((l) => l.trim()).slice(-3).join('\n')
    : '';

  const nextSceneKey = sceneIdx < resolvedKeys.length - 1 ? resolvedKeys[sceneIdx + 1] : null;
  const nextScene = nextSceneKey ? narrative.scenes[nextSceneKey] : null;
  const nextProse = nextScene?.prose;
  const nextProseOpening = nextProse
    ? nextProse.split('\n').filter((l) => l.trim()).slice(0, 3).join('\n')
    : '';

  // Future scene summaries for foreshadowing (lightweight — summaries only, no prose)
  const futureKeys = resolvedKeys.slice(contextIndex + 1);
  const futureSummaries = futureKeys.length > 0
    ? futureKeys.map((k, i) => {
        const s = resolveEntry(narrative, k);
        if (!s || s.kind !== 'scene') return null;
        return `[+${i + 1}] ${s.summary}`;
      }).filter(Boolean).join('\n')
    : '';



  const systemPrompt = `You are a literary prose writer crafting a single scene for a novel set in "${narrative.title}".

Tone: ${narrative.worldSummary.slice(0, 200)}.

Voice & style:
- Third-person limited, locked to the POV character's senses and interiority. Their body, breath, and attention are the camera.
- Enter late, leave early. Start in the middle of something happening — never with setup or orientation.
- Let scenes breathe. Don't rush through structural beats. A thread shift or relationship change is a turning point — build to it, let it land, show the aftermath ripple through the character's body and thoughts.
- Dialogue must do at least two things at once: reveal character, advance conflict, shift power, or expose subtext. No filler exchanges. Each character should sound distinct — vocabulary, rhythm, what they avoid saying.
- Interiority through the body, not narration. Show the POV character's emotional state through physical sensation, impulse, and micro-action — not by naming emotions.
- Subtext over exposition. What characters don't say, what they notice but look away from, what they almost do — these carry more weight than declarations.
- Sensory grounding in small, specific details. One precise image beats three generic ones. Anchor abstract tension in concrete objects, textures, sounds.

Strict output rules:
- Output ONLY the prose. No scene titles, chapter headers, separators (---), or meta-commentary.
- Use straight quotes (" and '), never smart/curly quotes or other typographic substitutions.
- Do not begin with a character name as the first word.
- CRITICAL: Do NOT open with weather, atmosphere, air quality, scent, temperature, or environmental description. These are the most overused openings in fiction. Instead, choose from techniques like: mid-dialogue, a character's body in motion, a close-up on an object, an internal thought, a sound, a question, a tactile sensation, noticing someone's expression, or a punchy declarative sentence.
- Do NOT end with philosophical musings, rhetorical questions, or atmospheric fade-outs. Instead end with: a character leaving, a sharp line of dialogue, a decision made in silence, an interruption, a physical gesture, or a thought that reframes the scene.`
  + (narrative.storySettings?.proseVoice?.trim()
    ? `\n\nAUTHOR VOICE (mimic this style — it overrides the defaults above):\n${narrative.storySettings.proseVoice.trim()}`
    : '');

  const sceneBlock = sceneContext(narrative, scene);

  // Scene plan — when available, this is the primary creative direction
  const planBlock = scene.plan
    ? `\nSCENE PLAN (follow this blueprint closely — it specifies beat-by-beat staging, discovery mechanisms, and dialogue seeds):\n${scene.plan}\n`
    : '';

  // Derive logical constraints from the scene graph — these are hard rules the prose must obey
  const logicRules = deriveLogicRules(narrative, scene);
  const logicBlock = logicRules.length > 0
    ? `\nLOGICAL REQUIREMENTS (these are hard constraints derived from the scene graph — violating any is a failure):\n${logicRules.map((r) => `  - ${r}`).join('\n')}\n`
    : '';

  // Adjacent prose edges for transition continuity
  const adjacentProseBlock = [
    prevProseEnding ? `PREVIOUS SCENE ENDING (match tone, avoid repeating imagery or phrasing):\n"""${prevProseEnding}"""` : '',
    nextProseOpening ? `NEXT SCENE OPENING (your ending should flow naturally into this):\n"""${nextProseOpening}"""` : '',
  ].filter(Boolean).join('\n\n');

  const scale = sceneScale(scene);

  const instruction = scene.plan
    ? `Follow the scene plan's beat sequence — it specifies the concrete mechanisms for every mutation.

THREE PILLARS — the prose must honour all three:
1. CONTINUITY: POV character can only perceive what their senses and existing knowledge allow. New continuity mutations must be discovered through specific mechanisms — never referenced before their revelation moment.
2. THREADS: Every thread shift must land at a specific dramatic moment. Show the status change through action, not narration.
3. KNOWLEDGE: World concepts being revealed in this scene (marked in the logical requirements) must feel EARNED — discovered through demonstration, explanation, or consequence. Established world knowledge can be referenced freely. New knowledge cannot be treated as pre-existing.

Every thread shift, continuity change, relationship mutation, and world knowledge reveal must appear in the prose. You MUST satisfy every logical requirement. Fill around the planned beats with extended dialogue, internal monologue, physical action, and sensory detail. Let scenes breathe. Foreshadow future events through subtle imagery — never telegraph. Write as many words as the scene demands — a quiet scene with few beats may need only 800 words, a dense convergence scene may need 3000+. Err on the side of brevity for engagement; never pad.`
    : `THREE PILLARS — the prose must honour all three:
1. CONTINUITY: POV character can only perceive what their senses and existing knowledge allow. New continuity mutations must be discovered through specific mechanisms — never referenced before their revelation moment.
2. THREADS: Every thread shift must land at a specific dramatic moment. Show the status change through action, not narration.
3. KNOWLEDGE: World concepts being revealed in this scene (marked in the logical requirements) must feel EARNED — discovered through demonstration, explanation, or consequence. Established world knowledge can be referenced freely. New knowledge cannot be treated as pre-existing.

Every thread shift, continuity change, relationship mutation, and world knowledge reveal listed above must be dramatised — these are the structural beats of this scene. You MUST satisfy every logical requirement. Fill around them with extended dialogue exchanges, internal monologue, physical action, environmental detail, and character interaction. Let scenes breathe. Foreshadow future events through subtle imagery, offhand remarks, and environmental details — never telegraph. Write as many words as the scene demands — a quiet scene with few beats may need only 800 words, a dense convergence scene may need 3000+. Err on the side of brevity for engagement; never pad.`;

  const prompt = `BRANCH CONTEXT (for continuity — do not summarise or repeat this):
${fullContext}
${futureSummaries ? `\nFUTURE SCENES (for foreshadowing only — plant subtle seeds, never spoil or reference directly):\n${futureSummaries}\n` : ''}
${adjacentProseBlock ? `${adjacentProseBlock}\n\n` : ''}${planBlock}${sceneBlock}
${logicBlock}
${instruction}`;

  if (onToken) {
    return await callGenerateStream(prompt, systemPrompt, onToken, scale.proseTokens, 'generateSceneProse', WRITING_MODEL);
  }
  return await callGenerate(prompt, systemPrompt, scale.proseTokens, 'generateSceneProse', WRITING_MODEL);
}
