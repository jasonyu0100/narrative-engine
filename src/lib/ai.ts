import type { NarrativeState, Scene, Arc, Character, Location, Thread, RelationshipEdge, CubeCornerKey } from '@/types/narrative';
import { resolveEntry, NARRATIVE_CUBE, THREAD_ACTIVE_STATUSES, THREAD_TERMINAL_STATUSES, THREAD_STATUS_LABELS } from '@/types/narrative';

// Build thread lifecycle documentation from canonical status lists
const THREAD_LIFECYCLE_DOC = (() => {
  const activeList = THREAD_ACTIVE_STATUSES.map((s) => `"${s}"`).join(', ');
  const terminalList = THREAD_TERMINAL_STATUSES.map(
    (s) => `"${s}" (${THREAD_STATUS_LABELS[s]})`,
  ).join(', ');
  return `Active statuses: ${activeList}. Terminal/closed statuses: ${terminalList}.`;
})();
import { nextId, nextIds, computeForceSnapshots, computeBalanceMagnitudes, detectCubeCorner, movingAverage, FORCE_WINDOW_SIZE } from '@/lib/narrative-utils';
import { apiHeaders } from '@/lib/api-headers';

export type WorldExpansion = {
  characters: Character[];
  locations: Location[];
  threads: Thread[];
  relationships: RelationshipEdge[];
};

async function callGenerate(prompt: string, systemPrompt: string, maxTokens?: number, caller = 'callGenerate'): Promise<string> {
  const { logApiCall, updateApiLog } = await import('@/lib/api-logger');
  const logId = logApiCall(caller, prompt.length + (systemPrompt?.length ?? 0), prompt);
  const start = performance.now();

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ prompt, systemPrompt, ...(maxTokens ? { maxTokens } : {}) }),
    });
    if (!res.ok) {
      const err = await res.json();
      const message = err.error || 'Generation failed';
      updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
      throw new Error(message);
    }
    const data = await res.json();
    const content = data.content;
    updateApiLog(logId, {
      status: 'success',
      durationMs: Math.round(performance.now() - start),
      responseLength: content.length,
      responsePreview: content,
    });
    return content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
    throw err;
  }
}

/**
 * Build full context from all scenes up to (and including) the current scene index.
 * This gives the AI the complete branch history, not just the last 5 scenes.
 */
export function branchContext(
  n: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  const characters = Object.values(n.characters)
    .map((c) => {
      const knowledgeLines = c.knowledge.nodes.map((kn) => `    [${kn.id}] (${kn.type}) ${kn.content}`);
      const edgeLines = c.knowledge.edges.map((e) => `    ${e.from} --(${e.type})--> ${e.to}`);
      const knowledgeBlock = knowledgeLines.length > 0
        ? `\n  Knowledge:\n${knowledgeLines.join('\n')}${edgeLines.length > 0 ? '\n  Edges:\n' + edgeLines.join('\n') : ''}`
        : '';
      return `- ${c.id}: ${c.name} (${c.role})${knowledgeBlock}`;
    })
    .join('\n');
  const locations = Object.values(n.locations)
    .map((l) => {
      const knowledgeLines = l.knowledge.nodes.map((kn) => `    [${kn.id}] (${kn.type}) ${kn.content}`);
      const edgeLines = l.knowledge.edges.map((e) => `    ${e.from} --(${e.type})--> ${e.to}`);
      const knowledgeBlock = knowledgeLines.length > 0
        ? `\n  Knowledge:\n${knowledgeLines.join('\n')}${edgeLines.length > 0 ? '\n  Edges:\n' + edgeLines.join('\n') : ''}`
        : '';
      return `- ${l.id}: ${l.name}${l.parentId ? ` (inside ${n.locations[l.parentId]?.name ?? l.parentId})` : ''}${knowledgeBlock}`;
    })
    .join('\n');
  // Build thread age context from scene history
  const keysForThreadAge = resolvedKeys.slice(0, currentIndex + 1);
  const threadFirstMutation: Record<string, number> = {};
  const threadMutationCount: Record<string, number> = {};
  keysForThreadAge.forEach((k, idx) => {
    const scene = n.scenes[k];
    if (!scene) return;
    for (const tm of scene.threadMutations) {
      threadMutationCount[tm.threadId] = (threadMutationCount[tm.threadId] ?? 0) + 1;
      if (threadFirstMutation[tm.threadId] === undefined) threadFirstMutation[tm.threadId] = idx;
    }
  });
  const totalScenes = keysForThreadAge.length;

  const threads = Object.values(n.threads)
    .map((t) => {
      const firstMut = threadFirstMutation[t.id];
      const age = firstMut !== undefined ? totalScenes - firstMut : 0;
      const mutations = threadMutationCount[t.id] ?? 0;
      const ageLabel = age > 0 ? `, active ${age} scenes, ${mutations} mutations` : '';
      return `- ${t.id}: ${t.description} [${t.status}${ageLabel}]`;
    })
    .join('\n');
  const relationships = n.relationships
    .map((r) => {
      const fromName = n.characters[r.from]?.name ?? r.from;
      const toName = n.characters[r.to]?.name ?? r.to;
      return `- ${r.from} (${fromName}) -> ${r.to} (${toName}): ${r.type} (valence: ${r.valence})`;
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
    const loc = `${s.locationId} (${n.locations[s.locationId]?.name ?? 'unknown'})`;
    const participants = s.participantIds.map((pid) => `${pid} (${n.characters[pid]?.name ?? 'unknown'})`).join(', ');
    const threadChanges = s.threadMutations.map((tm) => `${tm.threadId}: ${tm.from}->${tm.to}`).join('; ');
    const knowledgeChanges = s.knowledgeMutations.map((km) => `${km.characterId} learned [${km.nodeType}]: ${km.content}`).join('; ');
    const relChanges = s.relationshipMutations.map((rm) => {
      const fromName = n.characters[rm.from]?.name ?? rm.from;
      const toName = n.characters[rm.to]?.name ?? rm.to;
      return `${fromName}->${toName}: ${rm.type} (${rm.valenceDelta >= 0 ? '+' : ''}${rm.valenceDelta})`;
    }).join('; ');
    return `[${i + 1}] ${s.id} @ ${loc} | ${participants}${threadChanges ? ` | Threads: ${threadChanges}` : ''}${knowledgeChanges ? ` | Knowledge: ${knowledgeChanges}` : ''}${relChanges ? ` | Relationships: ${relChanges}` : ''}
   ${s.summary}`;
  }).filter(Boolean).join('\n');

  // Arcs context
  const arcs = Object.values(n.arcs)
    .map((a) => `- ${a.id}: "${a.name}" (${a.sceneIds.length} scenes, develops: ${a.develops.join(', ')})`)
    .join('\n');

  // Force trajectory — compact time series showing change rhythm and balance
  const allScenes = keysUpToCurrent
    .map((k) => resolveEntry(n, k))
    .filter((e): e is Scene => e?.kind === 'scene');
  const forceMap = computeForceSnapshots(allScenes);
  const forceSnapshots = allScenes.map((s) => forceMap[s.id] ?? { payoff: 0, change: 0, variety: 0 });
  const balances = computeBalanceMagnitudes(forceSnapshots);
  const payoffMA = movingAverage(forceSnapshots.map(f => f.payoff), FORCE_WINDOW_SIZE);
  const changeMA = movingAverage(forceSnapshots.map(f => f.change), FORCE_WINDOW_SIZE);
  const varietyMA = movingAverage(forceSnapshots.map(f => f.variety), FORCE_WINDOW_SIZE);
  const balanceMA = movingAverage(balances, FORCE_WINDOW_SIZE);
  const forceTrajectory = allScenes.map((s, i) => {
    const f = forceMap[s.id];
    if (!f) return null;
    const corner = detectCubeCorner(f);
    return `[${i + 1}] P:${f.payoff >= 0 ? '+' : ''}${f.payoff.toFixed(1)} C:${f.change >= 0 ? '+' : ''}${f.change.toFixed(1)} V:${f.variety >= 0 ? '+' : ''}${f.variety.toFixed(1)} Bl:${balances[i].toFixed(1)} MA(P:${payoffMA[i].toFixed(1)} C:${changeMA[i].toFixed(1)} V:${varietyMA[i].toFixed(1)} Bl:${balanceMA[i].toFixed(1)}) (${corner.name})`;
  }).filter(Boolean).join('\n');

  // Compact ID lookup — placed last so it's closest to the generation prompt
  const charIdList = Object.values(n.characters).map((c) => c.id).join(', ');
  const locIdList = Object.values(n.locations).map((l) => l.id).join(', ');
  const threadIdList = Object.values(n.threads).map((t) => t.id).join(', ');

  const rulesBlock = n.rules && n.rules.length > 0
    ? `\nWORLD RULES (these are absolute — every scene MUST obey them):\n${n.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n`
    : '';

  return `NARRATIVE: "${n.title}"
WORLD: ${n.worldSummary}
${rulesBlock}
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
${sceneHistory}

FORCE TRAJECTORY (computed from scene structure — shows pacing rhythm):
${forceTrajectory || '(no scenes yet)'}

VALID IDs (you MUST use ONLY these exact IDs — do NOT invent new ones):
  Character IDs: ${charIdList}
  Location IDs: ${locIdList}
  Thread IDs: ${threadIdList}`;
}

const SYSTEM_PROMPT = `You are a narrative simulation engine that generates structured scene data for interactive storytelling.
You must ALWAYS respond with valid JSON only — no markdown, no explanation, no code fences.

CORE PRINCIPLES:
1. FORCE TARGETS and DIRECTION override scene history. Do NOT continue patterns just because previous scenes established them. If the directive says calm, write calm.
2. High balance is the north star of compelling narrative. Consecutive scenes should feel dynamically different — alternate intensity with quiet, action with reflection, familiar with surprising.
3. Threads evolve gradually. Most scenes advance 0-1 threads. A dormant thread surfaces slowly over many scenes, not in one jump.
4. Use ONLY the character, location, and thread IDs provided. Never invent new ones.

WRITING LIKE A NOVELIST — every scene should leave a mark:
- Characters are always learning. In every scene, someone notices something, overhears a detail, forms an impression, recalls a memory, or pieces together a clue. Track these as knowledgeMutations — they are the fabric of dramatic irony and character interiority.
- Relationships shift constantly. When characters interact, their dynamics evolve — trust deepens, suspicion grows, respect is earned or lost. Even a shared glance or an awkward silence shifts something. Track these as relationshipMutations with appropriate valenceDelta.
- Events ground scenes in concrete happenings. Tag what actually occurs: "ambush", "confession", "storm_arrival", "treaty_signed", "duel", "feast", "betrayal_revealed". These make scenes feel like real narrative moments, not abstract summaries.
- Threads evolve when the story demands it — not every scene, but regularly enough that the narrative feels alive. A scene with no mutations at all is a missed opportunity.`;

/** Clean common LLM JSON quirks: code fences, trailing commas, single-quoted keys */
function cleanJson(raw: string): string {
  let s = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

/** Parse JSON with detailed error context for debugging truncated LLM responses */
function parseJson(raw: string, context: string): unknown {
  if (!raw || !raw.trim()) {
    throw new Error(`[${context}] Empty response from LLM — received no content`);
  }
  const cleaned = cleanJson(raw);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const preview = cleaned.length > 300
      ? `${cleaned.slice(0, 150)}…[${cleaned.length} chars total]…${cleaned.slice(-150)}`
      : cleaned;
    const truncated = cleaned.endsWith('}') || cleaned.endsWith(']') ? '' : ' (likely truncated — response hit max_tokens limit)';
    throw new Error(
      `[${context}] Failed to parse JSON${truncated}\n` +
      `Original error: ${err instanceof Error ? err.message : String(err)}\n` +
      `Response preview: ${preview}`
    );
  }
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


export async function suggestStoryDirection(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): Promise<string> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

  const prompt = `${ctx}

You are a showrunner planning the long-term trajectory of this story. Analyze the full narrative state — characters, threads, knowledge graphs, relationships, and scene history — and suggest a high-level STORY DIRECTION that should guide the next several arcs.

Think big picture:
- What is the central dramatic question the story is building toward?
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


export async function generateScenes(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  count: number,
  direction: string,
  existingArc?: Arc,
  cubeGoal?: CubeCornerKey,
): Promise<{ scenes: Scene[]; arc: Arc }> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);
  const arcId = existingArc?.id ?? nextId('ARC', Object.keys(narrative.arcs));
  const arcInstruction = existingArc
    ? `CONTINUE the existing arc "${existingArc.name}" (${arcId}) which already has ${existingArc.sceneIds.length} scenes. Add exactly ${count} new scenes that naturally extend this arc.`
    : `Generate a NEW ARC with exactly ${count} scenes. Give the arc a short, evocative name (2-4 words) that reads like a chapter title — specific to the story, not generic.`;
  const prompt = `${ctx}

${arcInstruction}
DIRECTION (this takes priority over any patterns in the scene history below):
${direction}

The scenes must continue from the current point in the story (after scene index ${currentIndex + 1}).

${cubeGoal ? `
NARRATIVE CUBE GOAL — steer this arc toward the "${NARRATIVE_CUBE[cubeGoal].name}" state:
${NARRATIVE_CUBE[cubeGoal].description}

FORCE TARGETS for this arc (these override any patterns you see in the scene history):
- Payoff: ${NARRATIVE_CUBE[cubeGoal].forces.payoff > 0 ? 'HIGH — drive threads toward critical/threatened/terminal statuses. Betrayals, confrontations, and fractures should have real consequences. Advance thread statuses meaningfully and let relationship shifts reflect the weight of what happens.' : 'LOW — keep threads in dormant/surfacing statuses, build positive or neutral relationships. No existential danger, no thread escalation. Characters explore, bond, recover, train. Relationship shifts should be gentle, knowledge gains should be personal observations or quiet discoveries.'}
- Change: ${NARRATIVE_CUBE[cubeGoal].forces.change > 0 ? 'FAST — pack scenes with discoveries, shifting alliances, and cascading consequences. Characters should be learning rapidly, relationships should be tested by intense interactions, and events should pile up. Rapid developments.' : 'SLOW — contemplative, dialogue-heavy scenes where characters process and reflect. Let scenes breathe. Knowledge comes from internal reflection and subtle observation, relationships shift gently. Fewer events, more interiority.'}
- Variety: ${NARRATIVE_CUBE[cubeGoal].forces.variety > 0 ? 'HIGH — use new/rarely-seen locations, characters, and POV perspectives. Bring in fresh faces, unexplored settings, and shift to underused viewpoints. If world building has added new elements, USE THEM.' : 'LOW — familiar settings, established cast, recurring POV characters, deepening existing dynamics. Routine and grounding.'}

DO NOT continue the momentum of previous scenes. If the story has been intense for many scenes and this goal says LOW payoff, you MUST write genuinely calm scenes — keep threads dormant, build friendships, explore without danger. Break the pattern.` : ''}

Return JSON with this exact structure:
{
  "arcName": "A short, evocative arc name (2-4 words) like a chapter title. Bad: 'Continuation', 'New Beginnings'. Good: 'The Siege of Ashenmoor', 'Fractured Oaths'.",
  "scenes": [
    {
      "id": "S-GEN-001",
      "arcId": "${arcId}",
      "locationId": "existing location ID from the narrative",
      "povId": "character ID whose perspective this scene is told from (must be one of the participantIds)",
      "participantIds": ["existing character IDs"],
      "events": ["event_tag_1", "event_tag_2"],
      "threadMutations": [{"threadId": "T-XX", "from": "current_status", "to": "new_status"}],
      "knowledgeMutations": [{"characterId": "C-XX", "nodeId": "K-GEN-001", "action": "added", "content": "what they learned", "nodeType": "a descriptive type for this knowledge"}],
      "relationshipMutations": [{"from": "C-XX", "to": "C-YY", "type": "description", "valenceDelta": 0.1}],
      "summary": "REQUIRED: 2-4 sentence narrative summary written in vivid, character-driven prose. Describe what happens, who is involved, and the emotional stakes."
    }
  ]
}

Rules:
- EVERY scene MUST have a non-empty "summary" field. This is critical — scenes without summaries are broken. Write 2-4 vivid sentences describing the scene's events, characters, and emotional stakes.
- Use ONLY existing character IDs and location IDs from the narrative context above
- Thread statuses follow a lifecycle. ${THREAD_LIFECYCLE_DOC}
- Threads that have reached their narrative conclusion MUST be transitioned to a terminal status. Do not leave threads stuck in active states when their story is over. When a mystery is solved, a conflict is won/lost, a goal is achieved or failed — close the thread.
- Scene IDs must be unique: S-GEN-001, S-GEN-002, etc.
- Knowledge node IDs must be unique: K-GEN-001, K-GEN-002, etc.
- knowledgeMutations.nodeType should be a specific, contextual label for what kind of knowledge this is — NOT limited to a fixed set. Examples: "tactical_insight", "betrayal_discovered", "forbidden_technique", "political_leverage", "hidden_lineage", "oath_sworn". Choose the type that best describes the specific knowledge gained.
- Thread mutations should reflect the direction — escalate relevant threads, surface dormant ones
- relationshipMutations track how character dynamics shift. Include them when interactions change — trust gained, betrayal discovered, alliance forming, rivalry deepening. valenceDelta ranges from -0.5 (major damage) to +0.5 (major bonding). Most interactions are ±0.1 to ±0.2.
- knowledgeMutations track what characters learn. Include them when a character gains or loses information — secrets revealed, lies uncovered, skills observed, intel gathered.
- events capture concrete narrative happenings. Use specific, descriptive tags: "ambush_at_dawn", "secret_pact_formed", "duel_of_wits", "storm_breaks", "letter_intercepted". Aim for 2-4 events per scene. Events contribute to the Change force — more events = higher narrative momentum.

NARRATIVE RICHNESS (what separates good scenes from flat ones):
- Think like a novelist: every scene changes SOMETHING about how characters understand their world and relate to each other. A scene where nothing shifts — no knowledge gained, no relationship moved, no events tagged — reads as filler.
- Quiet/reflective scenes still have internal life: a character notices someone's hesitation, recalls a painful memory, warms slightly to a companion, or overhears something unsettling.
- Intense/climactic scenes should be dense with consequence: threads advance, characters learn things that change their calculus, relationships crack or forge under pressure, and multiple concrete events unfold.
- Events are the skeleton of what happens — tag them generously. They help readers (and the system) understand the scene's narrative weight.

PACING:
- Not every scene should be a major plot event. Include quieter scenes: character moments, travel, reflection, relationship building.
- Only 1 in 3 scenes should be a significant plot beat. Others build atmosphere, deepen character, or plant seeds.
- Even quiet scenes MUST have mutations — a character noticing tension, recalling a memory, warming to an ally, or growing suspicious all count.
- Threads evolve gradually — a dormant thread surfaces slowly over many scenes, not in one jump.
- When a thread's storyline has concluded (conflict resolved, mystery answered, goal achieved or failed), transition it to a terminal status: ${THREAD_TERMINAL_STATUSES.map((s) => `"${s}"`).join(', ')}. Choose the terminal status that best fits HOW the thread ended.

CRITICAL ID CONSTRAINT (re-stated for emphasis):
You MUST use ONLY these exact IDs. Do NOT invent new character, location, or thread IDs.
  Character IDs: ${Object.keys(narrative.characters).join(', ')}
  Location IDs: ${Object.keys(narrative.locations).join(', ')}
  Thread IDs: ${Object.keys(narrative.threads).join(', ')}`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'generateScenes');

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

  for (const scene of scenes) {
    // Fix invalid locationId — fall back to first valid location
    if (!validLocIds.has(scene.locationId)) {
      stripped.push(`locationId "${scene.locationId}" in scene ${scene.id}`);
      scene.locationId = Object.keys(narrative.locations)[0];
    }
    // Fix invalid povId — fall back to first participant
    if (!scene.povId || !validCharIds.has(scene.povId)) {
      if (scene.povId) stripped.push(`povId "${scene.povId}" in scene ${scene.id}`);
      scene.povId = scene.participantIds.find((pid) => validCharIds.has(pid)) ?? Object.keys(narrative.characters)[0];
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
    // Ensure povId is a valid participant
    if (!scene.participantIds.includes(scene.povId)) {
      scene.povId = scene.participantIds[0];
    }
    // Remove invalid threadMutations
    scene.threadMutations = scene.threadMutations.filter((tm) => {
      if (validThreadIds.has(tm.threadId)) return true;
      stripped.push(`threadId "${tm.threadId}" in scene ${scene.id}`);
      return false;
    });
    // Remove invalid knowledgeMutations
    scene.knowledgeMutations = scene.knowledgeMutations.filter((km) => {
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
  }

  if (stripped.length > 0) {
    console.warn(
      `[generateScenes] Stripped ${stripped.length} hallucinated ID(s):\n` +
      stripped.map((h) => `  - ${h}`).join('\n')
    );
  }

  // Fix knowledge mutation IDs to be unique and sequential
  const existingKIds = [
    ...Object.values(narrative.characters).flatMap((c) => c.knowledge.nodes.map((n) => n.id)),
    ...Object.values(narrative.locations).flatMap((l) => l.knowledge.nodes.map((n) => n.id)),
  ];
  const totalKMutations = scenes.reduce((sum, s) => sum + s.knowledgeMutations.length, 0);
  const kIds = nextIds('K', existingKIds, totalKMutations);
  let kIdx = 0;
  for (const scene of scenes) {
    for (const km of scene.knowledgeMutations) {
      km.nodeId = kIds[kIdx++];
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
World expansion is critical for narrative VARIETY — it introduces fresh characters, unexplored locations, and dormant threads that prevent the story from becoming repetitive.

Consider:
- Are there locations referenced in scenes that don't exist yet?
- Are there implied characters who should be introduced?
- Are there narrative threads that need new anchors?
- What would deepen the world and create new story possibilities?
- Which parts of the world feel underexplored or geographically narrow?
- Are there factions, organizations, or communities implied but not yet represented by characters?
- Could contrasting environments (urban vs wild, sacred vs profane, safe vs dangerous) create richer scene variety?
- Are there secondary characters who could become POV-worthy with more depth?

Aim for breadth: suggest 2-3 new characters from different walks of life, 2-3 locations that contrast with existing ones, and 2-3 threads that introduce new dramatic questions.

Return JSON with this exact structure:
{
  "suggestion": "2-4 sentence description of what should be added to the world and why"
}`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'suggestWorldExpansion');
  const parsed = parseJson(raw, 'suggestWorldExpansion') as { suggestion: string };
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

  // Compute next sequential IDs for the AI to use
  const nextCharId = nextId('C', Object.keys(narrative.characters));
  const nextLocId = nextId('L', Object.keys(narrative.locations));
  const nextThreadId = nextId('T', Object.keys(narrative.threads));
  const existingKIds = [
    ...Object.values(narrative.characters).flatMap((c) => c.knowledge.nodes.map((n) => n.id)),
    ...Object.values(narrative.locations).flatMap((l) => l.knowledge.nodes.map((n) => n.id)),
  ];
  const nextKId = nextId('K', existingKIds);

  const prompt = `${ctx}

EXPAND the world based on this directive: ${directive}

Generate NEW characters, locations, threads, and relationships that fit the existing narrative.
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
      "knowledge": {
        "nodes": [{"id": "${nextKId}", "type": "contextual_type", "content": "string"}],
        "edges": [{"from": "${nextKId}", "to": "K-next", "type": "contextual_edge_type"}]
      }
    }
  ],
  "locations": [
    {
      "id": "${nextLocId}",
      "name": "string",
      "parentId": null or "existing location ID for nesting",
      "threadIds": [],
      "imagePrompt": "1-2 sentence visual description: architecture, landscape, atmosphere, lighting. Used for establishing shot generation.",
      "knowledge": {
        "nodes": [{"id": "K-next", "type": "contextual_type", "content": "string"}],
        "edges": []
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
  ]
}

ID RULES:
- Character IDs: continue sequentially from ${nextCharId} (e.g., ${nextCharId}, C-${String(parseInt(nextCharId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- Location IDs: continue sequentially from ${nextLocId} (e.g., ${nextLocId}, L-${String(parseInt(nextLocId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- Thread IDs: continue sequentially from ${nextThreadId} (e.g., ${nextThreadId}, T-${String(parseInt(nextThreadId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- Knowledge node IDs: continue sequentially from ${nextKId} (e.g., ${nextKId}, K-${String(parseInt(nextKId.split('-').pop()!) + 1).padStart(2, '0')}, ...)
- ALL knowledge nodes (in both characters and locations) use the K- prefix and share one sequence

Rules:
- Generate elements that serve the directive AND boost narrative VARIETY — fresh faces, new settings, and untapped dramatic questions
- Characters should have meaningful knowledge graphs (3-5 nodes, 2-4 edges). Give each character SECRETS or unique knowledge that only they possess — this creates knowledge asymmetries that drive dramatic tension when revealed later. Include at least one hidden or dangerous piece of knowledge per character.
- Knowledge node types should be SPECIFIC and CONTEXTUAL — not generic labels. Choose types that describe exactly what kind of knowledge or lore this is. Examples: "cultivation_technique", "blood_pact", "hidden_treasury", "ancient_prophecy", "political_alliance", "forbidden_memory", "territorial_claim", "ancestral_grudge". Pick types that fit the narrative world.
- Knowledge edge types should also be contextual: "enables", "contradicts", "unlocks", "corrupts", "conceals", "depends_on", "mirrors", etc.
- Locations should fit the world hierarchy (use existing parentIds where appropriate). Make new locations CONTRAST with existing ones — if the story has been set in cities, add wilderness; if in palaces, add slums or ruins. Environmental variety drives scene variety.
- Location knowledge should describe lore, dangers, secrets, or resources specific to that place (3-4 nodes per location)
- Threads should connect to existing or new characters/locations via anchors. New threads should introduce DIFFERENT types of dramatic questions than existing ones — if current threads are about conflict, add threads about mystery, loyalty, or forbidden knowledge.
- ALL new threads MUST have status "dormant" — they are seeds for future arcs, not active storylines yet
- Relationships should connect new characters to EXISTING ones (not just to each other) — this ensures new characters integrate into the story rather than remaining isolated. Include at least one relationship with valence tension (slight negative or ambivalent).
- Anchors in threads can reference existing characters/locations
- Generate at least 2 of each type to provide meaningful variety injection`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, undefined, 'expandWorld');
  const parsed = parseJson(raw, 'expandWorld') as WorldExpansion;

  // Force all world-build threads to dormant — they're seeds, not active storylines
  const threads = (parsed.threads ?? []).map((t: Thread) => ({ ...t, status: THREAD_ACTIVE_STATUSES[0] }));

  return {
    characters: parsed.characters ?? [],
    locations: parsed.locations ?? [],
    threads,
    relationships: parsed.relationships ?? [],
  };
}

/**
 * Analyze the force trajectory of a narrative using AI.
 * Builds a compact context with force data per scene/arc and cube corner definitions,
 * then asks the LLM for a literary meta-analysis of the narrative's dynamic shape.
 */
export async function analyzeForceTrajectory(
  narrative: NarrativeState,
  forceData: { sceneId: string; arcId: string; arcName: string; forces: { payoff: number; change: number; variety: number }; balance: number; corner: string; cornerKey: CubeCornerKey }[],
): Promise<string> {
  // Build compact narrative context (lighter than full branchContext)
  const threadSummary = Object.values(narrative.threads)
    .map((t) => `- "${t.description}" [${t.status}]`)
    .join('\n');

  const arcSummary = Object.values(narrative.arcs)
    .map((a) => `- ${a.id}: "${a.name}" (${a.sceneIds.length} scenes, develops: ${a.develops.map(d => narrative.threads[d]?.description ?? d).join(', ')})`)
    .join('\n');

  const relationshipSummary = narrative.relationships
    .map((r) => `- ${narrative.characters[r.from]?.name ?? r.from} → ${narrative.characters[r.to]?.name ?? r.to}: ${r.type} (${r.valence >= 0 ? '+' : ''}${r.valence.toFixed(1)})`)
    .join('\n');

  // Build per-scene force trajectory with moving averages
  const balanceValues = forceData.map(d => d.balance);
  const pMA = movingAverage(forceData.map(d => d.forces.payoff), FORCE_WINDOW_SIZE);
  const cMA = movingAverage(forceData.map(d => d.forces.change), FORCE_WINDOW_SIZE);
  const vMA = movingAverage(forceData.map(d => d.forces.variety), FORCE_WINDOW_SIZE);
  const blMA = movingAverage(balanceValues, FORCE_WINDOW_SIZE);

  const trajectoryLines = forceData.map((d, i) => {
    const scene = narrative.scenes[d.sceneId];
    const loc = scene ? (narrative.locations[scene.locationId]?.name ?? scene.locationId) : '?';
    const participants = scene ? scene.participantIds.map(pid => narrative.characters[pid]?.name ?? pid).join(', ') : '?';
    const threadChanges = scene?.threadMutations.map(tm => `${narrative.threads[tm.threadId]?.description?.slice(0, 40) ?? tm.threadId}: ${tm.from}→${tm.to}`).join('; ') || '';
    return `[${i + 1}] ${d.arcName} | ${d.corner} (${d.cornerKey}) | P:${d.forces.payoff >= 0 ? '+' : ''}${d.forces.payoff.toFixed(2)} C:${d.forces.change >= 0 ? '+' : ''}${d.forces.change.toFixed(2)} V:${d.forces.variety >= 0 ? '+' : ''}${d.forces.variety.toFixed(2)} Bl:${d.balance.toFixed(2)} MA(P:${pMA[i].toFixed(2)} C:${cMA[i].toFixed(2)} V:${vMA[i].toFixed(2)} Bl:${blMA[i].toFixed(2)}) | @${loc} | ${participants}${threadChanges ? ` | ${threadChanges}` : ''}`;
  }).join('\n');

  // Build per-arc force summary
  const arcGroups: Record<string, typeof forceData> = {};
  const arcOrder: string[] = [];
  for (const d of forceData) {
    if (!arcGroups[d.arcId]) { arcGroups[d.arcId] = []; arcOrder.push(d.arcId); }
    arcGroups[d.arcId].push(d);
  }

  const arcForceLines = arcOrder.map(arcId => {
    const group = arcGroups[arcId];
    const avgP = group.reduce((s, e) => s + e.forces.payoff, 0) / group.length;
    const avgC = group.reduce((s, e) => s + e.forces.change, 0) / group.length;
    const avgV = group.reduce((s, e) => s + e.forces.variety, 0) / group.length;
    const avgBl = group.reduce((s, e) => s + e.balance, 0) / group.length;
    const corners = group.map(e => e.corner);
    const uniqueCorners = [...new Set(corners)];
    return `${group[0].arcName} (${group.length} scenes): avg P:${avgP.toFixed(2)} C:${avgC.toFixed(2)} V:${avgV.toFixed(2)} Bl:${avgBl.toFixed(2)} | corners: ${uniqueCorners.join(' → ')}`;
  }).join('\n');

  // Cube corner definitions for reference
  const cornerDefs = Object.values(NARRATIVE_CUBE)
    .map(c => `${c.name} (${c.key}): ${c.description}`)
    .join('\n');

  const systemPrompt = `You are a narrative analyst producing professional, insightful commentary on story structure. You write in a precise, literary-analytical voice — like a skilled editor reviewing a manuscript's pacing and dramatic architecture. Your analysis should feel like reading professional story notes, not a technical report. Be specific, reference actual arc names, character dynamics, and scene moments. Use the force data to support observations about rhythm, tension, and compositional choices.`;

  const prompt = `Analyze the force trajectory of this narrative.

NARRATIVE: "${narrative.title}"
WORLD: ${narrative.worldSummary}
CHARACTERS: ${Object.values(narrative.characters).length} (anchors: ${Object.values(narrative.characters).filter(c => c.role === 'anchor').map(c => c.name).join(', ')})

THREADS:
${threadSummary}

ARCS:
${arcSummary}

KEY RELATIONSHIPS:
${relationshipSummary}

CUBE CORNER DEFINITIONS (Payoff · Change · Variety mapped to [-1,+1]):
${cornerDefs}

ARC-LEVEL FORCE AVERAGES:
${arcForceLines}

SCENE-BY-SCENE FORCE TRAJECTORY (${forceData.length} scenes):
${trajectoryLines}

Write a meta-analysis of this narrative's force trajectory. Structure your response with these sections:

**Trajectory Overview** — The overall shape and character of the story's path through force-space. What kind of narrative is this? Where does it begin and end dynamically?

**Arc-by-Arc Dynamics** — How each arc contributes to the overall rhythm. What is its dominant mode? How does it transition into the next arc? Note any sharp shifts or sustained states.

**Tension Architecture** — How payoff is managed across the narrative. Where are the peaks and valleys? Is the escalation earned or rushed? How does the story use restraint?

**Change Rhythm** — The mutation density pattern. Where does the story accelerate and decelerate? Are there effective breathing rooms between intense sequences?

**Balance Dynamics** — Analyze the balance magnitude pattern (Bl values — Euclidean distance between consecutive 3D force positions) and its moving average (MA Bl — ${FORCE_WINDOW_SIZE}-point window). High balance indicates the story is constantly shifting between slow and fast moments, creating a vibrant, dynamic reading experience. Low balance means the story is settling into a groove. Compare raw balance to its moving average to identify whether shifts are sustained trends or isolated spikes. Where are the biggest shifts? Are there sustained high-balance sequences that create excitement, or does the story plateau?

**Compositional Observations** — What makes this trajectory distinctive? What corners are over/under-visited? Where does the narrative surprise or follow convention? Any structural strengths or weaknesses?

Write 3-5 sentences per section. Be specific — reference arc names, character names, and scene moments. Use the force values to ground your observations. Do not use bullet points — write in flowing prose paragraphs. Do not include the section headers with ** markers, just use the section names as plain headers followed by a newline.`;

  return await callGenerate(prompt, systemPrompt, 4000, 'analyzeForceTrajectory');
}

/**
 * Generate literary prose for a single scene, suitable for a book-style reading experience.
 */
export async function generateSceneProse(
  narrative: NarrativeState,
  scene: Scene,
  sceneIndex: number,
  resolvedKeys: string[],
): Promise<string> {
  const arc = Object.values(narrative.arcs).find((a) => a.sceneIds.includes(scene.id));
  const location = narrative.locations[scene.locationId];
  const pov = narrative.characters[scene.povId];
  const participants = scene.participantIds.map((pid) => narrative.characters[pid]).filter(Boolean);

  // Full branch context — all scenes, characters, threads, arcs, relationships, force trajectory
  const fullContext = branchContext(narrative, resolvedKeys, resolvedKeys.length - 1);

  const systemPrompt = `You are a literary prose writer crafting scenes for a novel set in the world of "${narrative.title}". Write vivid, immersive prose in third-person limited perspective from the POV character's viewpoint. Your writing should be evocative and grounded in sensory detail — show, don't tell. Match the tone and genre of the world: ${narrative.worldSummary.slice(0, 200)}. Do not include scene titles or chapter headers. Write only the prose itself.`;

  const prompt = `You have full knowledge of the entire narrative branch. Use this to write prose that foreshadows future events through subtle imagery, offhand remarks, environmental details, and character intuitions — never telegraph what's coming, but plant seeds the reader will recognize in hindsight.

FULL BRANCH CONTEXT:
${fullContext}

---

NOW WRITE SCENE ${sceneIndex + 1}${arc ? ` — Arc: "${arc.name}"` : ''}
LOCATION: ${location?.name ?? 'Unknown'}
POV CHARACTER: ${pov?.name ?? 'Unknown'} (${pov?.role ?? 'unknown role'})
PARTICIPANTS: ${participants.map((p) => `${p.name} (${p.role})`).join(', ')}

EVENTS:
${scene.events.map((e) => `- ${e}`).join('\n')}

SUMMARY: ${scene.summary}

Write 400-600 words of immersive prose for this scene. Ground the reader in the setting, convey character interiority through the POV character, and dramatize the events with dialogue and action. End the scene with a moment that creates forward momentum.`;

  return await callGenerate(prompt, systemPrompt, 2000, 'generateSceneProse');
}

export type ChartAnnotation = {
  sceneIndex: number;
  force: 'payoff' | 'change' | 'variety';
  label: string;
};

/**
 * Generate chart annotations for the force tracker.
 * The LLM analyzes the trajectory and returns specific scene-level annotations
 * that should appear on the charts at notable peaks, valleys, and inflection points.
 */
export async function generateChartAnnotations(
  narrative: NarrativeState,
  forceData: { sceneIndex: number; sceneId: string; arcName: string; forces: { payoff: number; change: number; variety: number }; corner: string; summary: string; threadChanges: string[]; location: string; participants: string[] }[],
): Promise<ChartAnnotation[]> {
  const trajectoryLines = forceData.map((d) => {
    const tc = d.threadChanges.length > 0 ? ` | ${d.threadChanges.join('; ')}` : '';
    return `[${d.sceneIndex + 1}] ${d.arcName} | ${d.corner} | P:${d.forces.payoff.toFixed(2)} C:${d.forces.change.toFixed(2)} V:${d.forces.variety.toFixed(2)} | @${d.location} | ${d.participants.join(', ')} | "${d.summary.slice(0, 80)}"${tc}`;
  }).join('\n');

  const systemPrompt = `You are a narrative analyst annotating force trajectory charts. Return ONLY valid JSON — no markdown, no code fences, no commentary.`;

  const prompt = `Analyze this narrative's force trajectory and generate annotations for notable moments.

NARRATIVE: "${narrative.title}" (${forceData.length} scenes)

SCENE-BY-SCENE DATA:
${trajectoryLines}

Annotate ONLY the peaks (local maxima) and troughs (local minima) of each force line. Look at the P/C/V values — find where each force hits its highest and lowest points, then label those.

Rules:
- ONLY peaks and troughs — nothing in between. If the value is rising or falling but hasn't reached an extremum, skip it.
- Include annotations for ALL THREE forces — payoff, change, AND variety
- ~4-6 annotations per force (the clearest peaks and troughs only)
- Labels: 2-5 words, specific to the story. Use character names, places, events.
- Never use generic labels like "high tension" or "calm period"
- Payoff peaks: danger, threats, betrayals. Troughs: safety, calm
- Change peaks: action bursts, dense reveals. Troughs: breathing room, reflection
- Variety peaks: new locations or characters (check @location and participants for first appearances). Troughs: same familiar cast/setting recurring

Return a JSON array:
[{"sceneIndex": 0, "force": "payoff", "label": "short annotation"}, ...]

sceneIndex is 0-based. force is one of: "payoff", "change", "variety".`;

  const raw = await callGenerate(prompt, systemPrompt, 4000, 'generateChartAnnotations');

  // Parse JSON from response, handling potential markdown fences
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (a: unknown): a is ChartAnnotation =>
      typeof a === 'object' && a !== null &&
      'sceneIndex' in a && 'force' in a && 'label' in a &&
      typeof (a as ChartAnnotation).sceneIndex === 'number' &&
      ['payoff', 'change', 'variety'].includes((a as ChartAnnotation).force) &&
      typeof (a as ChartAnnotation).label === 'string'
  );
}

export async function generateNarrative(
  title: string,
  premise: string,
  rules: string[] = [],
): Promise<NarrativeState> {
  const prompt = `Create a complete narrative world for:
Title: "${title}"
Premise: ${premise}

Return JSON with this exact structure:
{
  "worldSummary": "2-3 sentence world description",
  "characters": [
    {"id": "C-01", "name": "string", "role": "anchor|recurring|transient", "threadIds": ["T-01"], "imagePrompt": "1-2 sentence visual description of physical appearance, clothing, distinguishing features for portrait generation", "knowledge": {"nodes": [{"id": "K-01", "type": "specific_contextual_type", "content": "string"}], "edges": [{"from": "K-01", "to": "K-02", "type": "contextual_edge_type"}]}}
  ],
  "locations": [
    {"id": "L-01", "name": "string", "parentId": null, "threadIds": [], "imagePrompt": "1-2 sentence visual description of architecture, landscape, atmosphere for establishing shot generation", "knowledge": {"nodes": [{"id": "LK-01", "type": "specific_contextual_type", "content": "string"}], "edges": []}}
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
      "threadMutations": [{"threadId": "T-01", "from": "dormant", "to": "surfacing"}],
      "knowledgeMutations": [{"characterId": "C-XX", "nodeId": "K-GEN-001", "action": "added", "content": "what they learned", "nodeType": "a descriptive type for this knowledge"}],
      "relationshipMutations": [],
      "summary": "REQUIRED: 2-4 sentence vivid narrative summary of the scene"
    }
  ],
  "arcs": [
    {"id": "ARC-01", "name": "string", "sceneIds": ["S-001"], "develops": ["T-01"], "locationIds": ["L-01"], "activeCharacterIds": ["C-01"], "initialCharacterLocations": {"C-01": "L-01"}}
  ],
  "rules": ["World rule 1", "World rule 2"]
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
- Thread statuses follow a lifecycle. ${THREAD_LIFECYCLE_DOC} When a thread's story reaches its conclusion, transition it to the appropriate terminal status.

Knowledge types must be SPECIFIC and CONTEXTUAL to the world — not generic labels like "knows" or "secret". Use types that describe exactly what kind of knowledge or lore this is (e.g. "cultivation_technique", "blood_debt", "prophecy_fragment", "territorial_claim", "hidden_identity"). Knowledge edge types should also be contextual: "enables", "contradicts", "unlocks", "corrupts", "conceals", "depends_on", etc.

Scene knowledgeMutations track what characters LEARN during a scene. Each mutation MUST have: characterId (who learned it), nodeId (unique ID like K-GEN-001), action ("added"), content (what they learned), nodeType (specific contextual type). The characterId must reference an existing character ID (C-XX).

WORLD RULES: Generate 4-6 world rules — absolute constraints that every scene must obey. These define the physics, magic system limits, social rules, or thematic laws of the world.${rules.length > 0 ? ` The user has already provided these rules — include them as-is and add more if appropriate:\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : ''}`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, 60000, 'generateNarrative');
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
    worldSummary: parsed.worldSummary ?? premise,
    rules: Array.isArray(parsed.rules) ? parsed.rules.filter((r: unknown) => typeof r === 'string') : rules,
    controlMode: 'auto',
    activeForces: { payoff: 0, change: 0, variety: 0 },
    createdAt: now,
    updatedAt: now,
  };
}
