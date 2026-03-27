import type { NarrativeState, Scene, Arc, WorldBuild, StorySettings } from '@/types/narrative';
import { resolveEntry, DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { nextId, nextIds } from '@/lib/narrative-utils';
import { callGenerate, callGenerateStream, SYSTEM_PROMPT } from './api';
import { WRITING_MODEL, ANALYSIS_MODEL, GENERATE_MODEL, MAX_TOKENS_LARGE, PLAN_PROSE_LOOKBACK } from '@/lib/constants';
import { parseJson } from './json';
import { branchContext, sceneContext, deriveLogicRules, sceneScale } from './context';
import { PROMPT_FORCE_STANDARDS, PROMPT_PACING, PROMPT_MUTATIONS, PROMPT_ARTIFACTS, PROMPT_POV, PROMPT_CONTINUITY, PROMPT_SUMMARY_REQUIREMENT, PROMPT_CHARACTER_ARCS, PROMPT_THREAD_COLLISION, promptThreadLifecycle, buildThreadHealthPrompt, buildCompletedBeatsPrompt } from './prompts';
import { samplePacingSequence, buildSequencePrompt, detectCurrentMode, MATRIX_PRESETS, DEFAULT_TRANSITION_MATRIX, type PacingSequence } from '@/lib/markov';

export type GenerateScenesOptions = {
  existingArc?: Arc;
  /** Pre-sampled pacing sequence. When omitted, one is auto-sampled from the story's transition matrix. */
  pacingSequence?: PacingSequence;
  worldBuildFocus?: WorldBuild;
  onToken?: (token: string) => void;
};

export async function generateScenes(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  count: number,
  direction: string,
  options: GenerateScenesOptions = {},
): Promise<{ scenes: Scene[]; arc: Arc }> {
  const { existingArc, pacingSequence, worldBuildFocus, onToken } = options;
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
  // Unique seed to ensure divergent narrative directions across parallel generations
  const seed = Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);

  // ── Pacing sequence: always on — auto-sample if not provided ──
  // Floor at 3 scenes — arcs shorter than 3 lack enough structure for pacing
  const sceneCount = count > 0 ? Math.max(3, count) : targetLen;
  let sequence: PacingSequence;
  if (pacingSequence) {
    sequence = pacingSequence;
  } else {
    const currentMode = detectCurrentMode(narrative, resolvedKeys);
    const matrix = MATRIX_PRESETS.find((p) => p.key === storySettings.rhythmPreset)?.matrix
      ?? DEFAULT_TRANSITION_MATRIX;
    sequence = samplePacingSequence(currentMode, sceneCount, matrix);
  }
  const sequencePrompt = buildSequencePrompt(sequence);

  const prompt = `${ctx}

NARRATIVE SEED: ${seed}
Use this seed to differentiate your choices from other generations at this branch point. Each seed should produce a distinct narrative direction — different character focus, different thread priorities, different locations, different emotional register. Avoid converging on the same "obvious" next step.

${arcInstruction}
${direction.trim() ? `DIRECTION (this takes priority over any patterns in the scene history below):\n${direction}` : 'DIRECTION: Use your own judgment — analyze the branch context above and choose the most compelling next development based on unresolved threads, character tensions, and narrative momentum.'}
${worldBuildFocus ? (() => {
  const wb = worldBuildFocus;
  const chars = wb.expansionManifest.characters.map((c) => `${c.name} (${c.role})`);
  const locs = wb.expansionManifest.locations.map((l) => l.name);
  const threads = wb.expansionManifest.threads.map((t) => {
    const live = narrative.threads[t.id];
    return `${t.description} [${live?.status ?? t.status}]`;
  });
  const lines: string[] = [`WORLD BUILD FOCUS (${wb.id} — "${wb.summary}"): The entities below were recently introduced and have not yet had a presence in the story. This arc should bring them in — use these characters in scenes, set at least one scene in these locations, and begin activating these dormant threads:`];
  if (chars.length) lines.push(`  Characters: ${chars.join(', ')}`);
  if (locs.length) lines.push(`  Locations: ${locs.join(', ')}`);
  if (threads.length) lines.push(`  Threads to activate: ${threads.join('; ')}`);
  return '\n' + lines.join('\n') + '\n';
})() : ''}
The scenes must continue from the current point in the story (after scene index ${currentIndex + 1}).

${sequencePrompt}

Return JSON with this exact structure:
{
  "arcName": "A short, evocative arc name (2-4 words) like a chapter title. Must be UNIQUE — not a variation of any existing arc name. Bad: 'Continuation', 'New Beginnings', 'Echoes of X', 'Seeds of Y'. Good: 'The Siege of Ashenmoor', 'Fractured Oaths', 'Blackwater Gambit'.",
  "directionVector": "A single concise sentence (10-15 words max) using character NAMES capturing the narrative thrust — what changes, who drives it, and what's at stake. Examples: 'Kael discovers the seal is failing and must choose between duty and survival', 'Political alliances fracture as the harvest festival exposes hidden rivalries'.",
  "scenes": [
    {
      "id": "S-GEN-001",
      "arcId": "${arcId}",
      "locationId": "existing location ID from the narrative",
      "povId": "character ID whose perspective this scene is told from (must be a participant)${storySettings.povMode !== 'free' && storySettings.povCharacterIds.length > 0 ? ` — RESTRICTED to: ${storySettings.povCharacterIds.join(', ')}` : ''}",
      "participantIds": ["existing character IDs"],
      "characterMovements": {"C-XX": {"locationId": "L-YY", "transition": "Descriptive transition narrating HOW they moved, e.g. 'Rode horseback through the night', 'Slipped through the back gate at dawn', 'Got on a bus to the school'"}},
      "events": ["event_tag_1", "event_tag_2"],
      "threadMutations": [{"threadId": "T-XX", "from": "current_status", "to": "new_status"}],
      "continuityMutations": [{"characterId": "C-XX", "nodeId": "K-GEN-001", "action": "added", "content": "what they learned", "nodeType": "a descriptive type for this knowledge"}],
      "relationshipMutations": [{"from": "C-XX", "to": "C-YY", "type": "description", "valenceDelta": 0.1}],
      "worldKnowledgeMutations": {"addedNodes": [{"id": "WK-GEN-001", "concept": "name of a world concept, rule, system, or structure", "type": "law|system|concept|tension"}], "addedEdges": [{"from": "WK-GEN-001", "to": "WK-XX", "relation": "typed relationship: enables, requires, governs, located_in, opposes, created_by, extends, etc."}]},
      "ownershipMutations": [{"artifactId": "A-XX", "fromId": "C-XX or L-XX", "toId": "C-YY or L-YY"}],
      "summary": "REQUIRED: 3-5 sentence detailed narrative summary. Use character NAMES and location NAMES — never raw IDs. Describe the key action, the consequence, and the tension it creates for what comes next. Example: 'Michael Corleone sits across from Sollozzo and McCluskey at the small Italian restaurant in the Bronx, listening to terms he has no intention of accepting. He excuses himself to the bathroom where a pistol has been planted behind the toilet tank. He returns to the table and shoots both men. The gun clatters to the floor as Michael walks out in a daze to a waiting car. The killing severs him permanently from his civilian life and sets in motion a gang war that will consume every family in New York.'"
    }
  ]
}

Rules:
- Use ONLY existing character IDs and location IDs from the narrative context above
- Scene IDs must be unique: S-GEN-001, S-GEN-002, etc.
- Knowledge node IDs must be unique: K-GEN-001, K-GEN-002, etc.
- World knowledge node IDs for NEW concepts must be unique: WK-GEN-001, WK-GEN-002, etc. Reused nodes should keep their original ID.
${PROMPT_SUMMARY_REQUIREMENT}
${PROMPT_FORCE_STANDARDS}
${PROMPT_PACING}
${PROMPT_MUTATIONS}
${Object.keys(narrative.artifacts ?? {}).length > 0 ? PROMPT_ARTIFACTS : ''}
${PROMPT_POV}
${PROMPT_CONTINUITY}
${PROMPT_CHARACTER_ARCS}
${PROMPT_THREAD_COLLISION}
${promptThreadLifecycle()}
${buildThreadHealthPrompt(narrative, resolvedKeys, currentIndex, storySettings.threadResolutionSpeed ?? 'moderate')}
${buildCompletedBeatsPrompt(narrative, resolvedKeys, currentIndex)}
CRITICAL ID CONSTRAINT (re-stated for emphasis):
You MUST use ONLY these exact IDs. Do NOT invent new character, location, or thread IDs.
  Characters: ${Object.entries(narrative.characters).map(([id, c]) => `${c.name} (${id})`).join(', ')}
  Locations: ${Object.entries(narrative.locations).map(([id, l]) => `${l.name} (${id})`).join(', ')}
  Threads: ${Object.entries(narrative.threads).map(([id, t]) => `${t.description.slice(0, 40)} (${id})`).join(', ')}${Object.keys(narrative.artifacts ?? {}).length > 0 ? `\n  Artifacts: ${Object.entries(narrative.artifacts).map(([id, a]) => `${a.name} (${id})`).join(', ')}` : ''}`;

  // Retry on JSON parse failures (truncation, malformed output)
  const MAX_RETRIES = 2;
  let parsed: { arcName?: string; directionVector?: string; scenes: Scene[] };
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = onToken
        ? await callGenerateStream(prompt, SYSTEM_PROMPT, onToken, MAX_TOKENS_LARGE, 'generateScenes', GENERATE_MODEL)
        : await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_LARGE, 'generateScenes', GENERATE_MODEL);
      parsed = parseJson(raw, 'generateScenes') as { arcName?: string; directionVector?: string; scenes: Scene[] };
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        console.warn(`[generateScenes] Attempt ${attempt + 1} failed, retrying...`, err instanceof Error ? err.message : err);
      }
    }
  }
  if (!parsed!) throw lastErr;
  const arcName = existingArc?.name ?? parsed.arcName ?? 'Untitled Arc';
  const directionVector = parsed.directionVector;

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

  const fallbackCharId = Object.keys(narrative.characters)[0];

  for (const scene of scenes) {
    // Fix invalid locationId — fall back to first valid location
    if (!validLocIds.has(scene.locationId)) {
      stripped.push(`locationId "${scene.locationId}" in scene ${scene.id}`);
      scene.locationId = Object.keys(narrative.locations)[0];
    }
    // Fix invalid povId — must be a valid character
    if (!scene.povId || !validCharIds.has(scene.povId)) {
      if (scene.povId) stripped.push(`povId "${scene.povId}" in scene ${scene.id} (invalid)`);
      scene.povId = scene.participantIds.find((pid) => validCharIds.has(pid)) ?? fallbackCharId;
    }
    // Remove invalid participantIds
    const validParticipants = scene.participantIds.filter((pid) => {
      if (validCharIds.has(pid)) return true;
      stripped.push(`participantId "${pid}" in scene ${scene.id}`);
      return false;
    });
    scene.participantIds = validParticipants.length > 0
      ? validParticipants
      : [fallbackCharId];
    // Ensure povId is a participant
    if (!scene.participantIds.includes(scene.povId)) {
      scene.povId = scene.participantIds[0] ?? fallbackCharId;
    }
    // Ensure mutation arrays are actually arrays (LLM may return objects)
    if (!Array.isArray(scene.threadMutations)) scene.threadMutations = [];
    if (!Array.isArray(scene.continuityMutations)) scene.continuityMutations = [];
    if (!Array.isArray(scene.relationshipMutations)) scene.relationshipMutations = [];
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
    // Remove invalid ownershipMutations
    const validArtifactIds = new Set(Object.keys(narrative.artifacts ?? {}));
    const allEntityIds = new Set([...validCharIds, ...validLocIds]);
    scene.ownershipMutations = (scene.ownershipMutations ?? []).filter((om) => {
      const validArtifact = validArtifactIds.has(om.artifactId);
      const validFrom = allEntityIds.has(om.fromId);
      const validTo = allEntityIds.has(om.toId);
      if (validArtifact && validFrom && validTo) return true;
      stripped.push(`ownershipMutation "${om.artifactId}" in scene ${scene.id}`);
      return false;
    });
    if (scene.ownershipMutations.length === 0) delete scene.ownershipMutations;
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
        directionVector,
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

  // Recent scene prose for continuity — the planner needs to know what was actually written
  const recentProseBlocks: string[] = [];
  for (let i = 1; i <= PLAN_PROSE_LOOKBACK; i++) {
    const pIdx = sceneIdx - i;
    if (pIdx < 0) break;
    const pKey = resolvedKeys[pIdx];
    const pScene = pKey ? narrative.scenes[pKey] : null;
    if (!pScene?.prose) continue;
    const pov = narrative.characters[pScene.povId]?.name ?? pScene.povId;
    const loc = narrative.locations[pScene.locationId]?.name ?? pScene.locationId;
    recentProseBlocks.unshift(`--- SCENE ${pIdx + 1} (POV: ${pov}, @${loc}) ---\n${pScene.summary}\n\n${pScene.prose}`);
  }
  const recentProseBlock = recentProseBlocks.length > 0
    ? `RECENT PROSE (${recentProseBlocks.length} scene${recentProseBlocks.length > 1 ? 's' : ''} before this one — read carefully for character state, injuries, emotional beats, spatial positions, and unresolved tension that your plan must carry forward):\n\n${recentProseBlocks.join('\n\n')}`
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

  const systemPrompt = `You are a dramaturg and scene architect for "${narrative.title}". Your job is to expand structural deliveries into a detailed staging plan that a prose writer can follow. Do NOT write prose — write a blueprint.

Output format (free-form text — length should match the scene's complexity; a simple scene needs a short plan, a dense multi-thread convergence needs a thorough one):

OPENING STATE
2-3 sentences: where characters are physically, what they know, emotional temperature entering the scene. If characters are arriving from elsewhere, describe HOW they arrived — the mode of travel, the journey's toll, what they saw along the way. Ground the reader in the spatial reality before the scene's action begins.

DELIVERIES
Numbered list (4-8 deliveries). Each delivery specifies:
- Trigger: what initiates this moment
- Action: what happens physically and emotionally
- Shift: what mutation (thread/knowledge/relationship) this dramatises, and HOW it occurs mechanically

Every structural mutation in the scene data MUST map to at least one delivery with a concrete mechanism:
- Thread transitions need a trigger (not "the thread becomes active" but "the letter falls from the coat pocket, she reads it aloud")
- Knowledge discoveries need a device (overheard, found object, deduction, confession, demonstration, letter, physical evidence)
- Relationship shifts need a catalytic moment (a specific line, gesture, betrayal, sacrifice, shared danger)
- Character movements need a SPATIAL TRANSITION delivery: describe the journey itself — what they see/experience in transit, how the landscape changes, what it costs them physically or emotionally. Transitions are narrative moments, not teleportation. Include sensory detail about the route (terrain, weather, crowds, vehicles) and the character's internal state during travel.
- World knowledge reveals need a discovery mechanism: a character explains a rule, demonstrates a technique, references a historical event, or the narrator establishes world context through action. Each new world concept should feel earned, not lectured. The mechanism must be specific — not 'they learn about X' but 'the old woman draws the rune pattern in ash and explains its binding properties'.
- Do NOT reuse the same discovery device across multiple deliveries

DIALOGUE SEEDS
2-4 key exchanges. For each: who speaks, the surface topic, and the subtext underneath. Not full dialogue — just the tension map.

CLOSING STATE
2-3 sentences: where everyone ends up physically and emotionally. If characters have moved to a new location, confirm their arrival and describe the new environment as they encounter it. What has irrevocably changed.

THE THREE PILLARS OF NARRATIVE LOGIC:

1. CONTINUITY LOGIC (what characters know):
- The scene is told from the POV character's perspective. They can only perceive what their senses and existing knowledge allow.
- In the OPENING STATE, specify exactly what the POV character knows and does NOT know. This sets the information boundary for the entire scene.
- When planning deliveries where NON-POV characters act on private knowledge, describe only their observable behaviour — the POV character must interpret from the outside (and may misread the situation).
- When the POV character discovers new knowledge (continuity mutation), the delivery must specify the exact mechanism: what they see, hear, read, or deduce. No omniscient revelation.
- If another character conceals something from the POV character, note what the POV character sees on the surface vs. what is actually happening underneath. The plan should mark which layer the prose can access.

2. THREAD LOGIC (how plot advances):
- Each thread mutation must have a concrete narrative trigger — not "the thread escalates" but "the scout's report changes everything."
- Thread transitions are MOMENTS — they happen at a specific delivery, not diffusely across the scene. Identify the exact delivery where the status changes.
- Threads that pulse (same status → same status) still need a delivery showing active delivery with the thread's tension.
- If multiple threads shift in one scene, stagger the moments — don't cluster all transitions in a single delivery.

3. KNOWLEDGE LOGIC (what the world reveals):
- World knowledge nodes added in this scene have NOT been established yet at scene start. They must be REVEALED through the narrative — a character explains, demonstrates, discovers, or the narrator establishes through action.
- The OPENING STATE should note which world rules ARE already established (can be referenced freely) vs which will be revealed during the scene.
- World knowledge edges (connections between concepts) should be dramatised: if concept A "enables" concept B, show that enabling relationship through action, not exposition.
- Revelation mechanisms must be specific and earned — not "they learn about the magic system" but "the old woman lights the candle without a match, and when asked, explains that fire-calling is the first skill any practitioner masters."
- Existing world concepts from the knowledge graph can be REFERENCED in the plan as established facts. Only NEW concepts require revelation deliveries.

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
${recentProseBlock ? `\n${recentProseBlock}\n` : ''}
${adjacentBlock ? `${adjacentBlock}\n\n` : ''}${sceneBlock}
${logicBlock}
Create a detailed staging plan for this scene. Every structural mutation must have a concrete mechanism. Be specific about HOW things happen, not just WHAT happens.${recentProseBlock ? ' Your OPENING STATE must directly continue from the physical, emotional, and spatial reality established in the recent prose above — characters carry their wounds, knowledge, and positions forward.' : ''}`;

  if (onToken) {
    return await callGenerateStream(prompt, systemPrompt, onToken, Math.ceil(scale.proseTokens * 0.6), 'generateScenePlan', WRITING_MODEL);
  }
  return await callGenerate(prompt, systemPrompt, Math.ceil(scale.proseTokens * 0.6), 'generateScenePlan', WRITING_MODEL);
}

/**
 * Rewrite a scene plan guided by user-provided analysis/critique.
 * Preserves the plan structure (OPENING STATE, DELIVERIES, DIALOGUE SEEDS,
 * CLOSING STATE) but revises content based on the feedback.
 */
export async function rewriteScenePlan(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  currentPlan: string,
  analysis: string,
  onToken?: (token: string) => void,
): Promise<string> {
  const sceneBlock = sceneContext(narrative, scene);
  const scale = sceneScale(scene);

  // Adjacent plans for continuity
  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const prevScene = sceneIdx > 0 ? narrative.scenes[resolvedKeys[sceneIdx - 1]] : null;
  const nextScene = sceneIdx < resolvedKeys.length - 1 ? narrative.scenes[resolvedKeys[sceneIdx + 1]] : null;

  const adjacentBlock = [
    prevScene?.plan ? `PREVIOUS SCENE PLAN (your opening must flow from this):\n${prevScene.plan}` : '',
    nextScene?.plan ? `NEXT SCENE PLAN (your closing must hand off to this):\n${nextScene.plan}` : '',
  ].filter(Boolean).join('\n\n');

  const systemPrompt = `You are a dramaturg revising a scene plan for "${narrative.title}". You receive the current plan and editorial feedback. Rewrite the plan to address the feedback while preserving the plan structure (OPENING STATE, DELIVERIES, DIALOGUE SEEDS, CLOSING STATE). Every structural mutation in the scene data must still be covered. Output ONLY the revised plan text — no commentary, no markdown fences.`;

  const prompt = `${sceneBlock}

${adjacentBlock ? `${adjacentBlock}\n\n` : ''}CURRENT PLAN:
${currentPlan}

EDITORIAL FEEDBACK (address all points in your revision):
${analysis}

Rewrite the plan to address the feedback. Preserve the structure and ensure all scene mutations are still covered. If the feedback conflicts with scene data, prioritise scene data for structural accuracy but incorporate the feedback's creative direction.`;

  if (onToken) {
    return await callGenerateStream(prompt, systemPrompt, onToken, Math.ceil(scale.proseTokens * 0.6), 'rewriteScenePlan', WRITING_MODEL);
  }
  return await callGenerate(prompt, systemPrompt, Math.ceil(scale.proseTokens * 0.6), 'rewriteScenePlan', WRITING_MODEL);
}

export async function generateSceneProse(
  narrative: NarrativeState,
  scene: Scene,
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
- Let scenes breathe. Don't rush through structural deliveries. A thread shift or relationship change is a turning point — build to it, let it land, show the aftermath ripple through the character's body and thoughts.
- Dialogue must do at least two things at once: reveal character, advance conflict, shift power, or expose subtext. No filler exchanges. Each character should sound distinct — vocabulary, rhythm, what they avoid saying.
- Interiority through the body, not narration. Show the POV character's emotional state through physical sensation, impulse, and micro-action — not by naming emotions.
- Subtext over exposition. What characters don't say, what they notice but look away from, what they almost do — these carry more weight than declarations.
- Sensory grounding in small, specific details. One precise image outweighs three generic ones. Anchor abstract tension in concrete objects, textures, sounds.

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
    ? `\nSCENE PLAN (follow this blueprint closely — it specifies delivery-by-delivery staging, discovery mechanisms, and dialogue seeds):\n${scene.plan}\n`
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
    ? `Follow the scene plan's delivery sequence — it specifies the concrete mechanisms for every mutation.

THREE PILLARS — the prose must honour all three:
1. CONTINUITY: POV character can only perceive what their senses and existing knowledge allow. New continuity mutations must be discovered through specific mechanisms — never referenced before their revelation moment.
2. THREADS: Every thread shift must land at a specific dramatic moment. Show the status change through action, not narration.
3. KNOWLEDGE: World concepts being revealed in this scene (marked in the logical requirements) must feel EARNED — discovered through demonstration, explanation, or consequence. Established world knowledge can be referenced freely. New knowledge cannot be treated as pre-existing.

Every thread shift, continuity change, relationship mutation, and world knowledge reveal must appear in the prose. You MUST satisfy every logical requirement. Fill around the planned deliveries with extended dialogue, internal monologue, physical action, and sensory detail. Let scenes breathe. Foreshadow future events through subtle imagery — never telegraph. Write as many words as the scene demands — a quiet scene with few deliveries may need only 800 words, a dense convergence scene may need 3000+. Err on the side of brevity for delivery; never pad.`
    : `THREE PILLARS — the prose must honour all three:
1. CONTINUITY: POV character can only perceive what their senses and existing knowledge allow. New continuity mutations must be discovered through specific mechanisms — never referenced before their revelation moment.
2. THREADS: Every thread shift must land at a specific dramatic moment. Show the status change through action, not narration.
3. KNOWLEDGE: World concepts being revealed in this scene (marked in the logical requirements) must feel EARNED — discovered through demonstration, explanation, or consequence. Established world knowledge can be referenced freely. New knowledge cannot be treated as pre-existing.

Every thread shift, continuity change, relationship mutation, and world knowledge reveal listed above must be dramatised — these are the structural deliveries of this scene. You MUST satisfy every logical requirement. Fill around them with extended dialogue exchanges, internal monologue, physical action, environmental detail, and character interaction. Let scenes breathe. Foreshadow future events through subtle imagery, offhand remarks, and environmental details — never telegraph. Write as many words as the scene demands — a quiet scene with few deliveries may need only 800 words, a dense convergence scene may need 3000+. Err on the side of brevity for delivery; never pad.`;

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
