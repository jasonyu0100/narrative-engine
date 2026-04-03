import type { NarrativeState, Scene, Arc, WorldBuild, StorySettings, BeatPlan } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS, REASONING_BUDGETS, BEAT_FN_LIST, BEAT_MECHANISM_LIST, NARRATIVE_CUBE } from '@/types/narrative';
import { nextId, nextIds } from '@/lib/narrative-utils';
import { callGenerate, callGenerateStream, SYSTEM_PROMPT } from './api';
import { WRITING_MODEL, ANALYSIS_MODEL, GENERATE_MODEL, MAX_TOKENS_LARGE, MAX_TOKENS_DEFAULT, MAX_TOKENS_SMALL } from '@/lib/constants';
import { parseJson } from './json';
import { narrativeContext, sceneContext, deriveLogicRules, sceneScale } from './context';
import { PROMPT_FORCE_STANDARDS, PROMPT_STRUCTURAL_RULES, PROMPT_MUTATIONS, PROMPT_ARTIFACTS, PROMPT_POV, PROMPT_CONTINUITY, PROMPT_SUMMARY_REQUIREMENT, promptThreadLifecycle, buildThreadHealthPrompt, buildCompletedBeatsPrompt } from './prompts';
import { samplePacingSequence, buildSequencePrompt, buildSingleStepPrompt, detectCurrentMode, MATRIX_PRESETS, DEFAULT_TRANSITION_MATRIX, type PacingSequence, type ModeStep } from '@/lib/pacing-profile';

export type GenerateScenesOptions = {
  existingArc?: Arc;
  /** Pre-sampled pacing sequence. When omitted, one is auto-sampled from the story's transition matrix. */
  pacingSequence?: PacingSequence;
  worldBuildFocus?: WorldBuild;
  onToken?: (token: string) => void;
  /** Callback for streaming reasoning/thinking tokens */
  onReasoning?: (token: string) => void;
};

export async function generateScenes(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  count: number,
  direction: string,
  options: GenerateScenesOptions = {},
): Promise<{ scenes: Scene[]; arc: Arc }> {
  const { existingArc, pacingSequence, worldBuildFocus, onToken, onReasoning } = options;
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);
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

  // ── Pacing sequence: sample from Markov chain when enabled ──
  const sceneCount = count > 0 ? Math.max(3, count) : targetLen;
  let sequencePrompt = '';
  let sequence: PacingSequence | null = null;
  if (storySettings.usePacingChain !== false) {
    if (pacingSequence) {
      sequence = pacingSequence;
    } else {
      const currentMode = detectCurrentMode(narrative, resolvedKeys);
      const matrix = MATRIX_PRESETS.find((p) => p.key === storySettings.rhythmPreset)?.matrix
        ?? DEFAULT_TRANSITION_MATRIX;
      sequence = samplePacingSequence(currentMode, sceneCount, matrix);
    }
    sequencePrompt = buildSequencePrompt(sequence);
  }

  const prompt = `${ctx}

NARRATIVE SEED: ${seed}

${arcInstruction}
${direction.trim() ? `DIRECTION — THIS IS YOUR PRIMARY BRIEF. Every scene you generate must execute the beats described here. Do not invent scenes that ignore, skip, or contradict these instructions.

The direction may include prose-level guidance: how to write, not just what happens. Time compression, structural techniques, tone shifts, POV style, internal monologue approach, dialogue register, pacing rhythm — any of these can appear in the direction. When they do, they must flow through into your scene summaries. The summary is the last thing the prose writer sees — anything not in the summary is lost. If the direction says "montage of monthly vignettes," the summary must read as compressed monthly snapshots. If it says "black comedy through internal monologue," the summary must set up that register. If it says "formal, layered prose for the Central Plains," the summary must signal that shift.

${direction}` : 'DIRECTION: Use your own judgment — analyze the branch context above and choose the most compelling next development based on unresolved threads, character tensions, and narrative momentum.'}
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

Return JSON with this exact structure. IMPORTANT: Fill out "arcOutline" FIRST — plan the arc structure before writing any scenes. The outline commits you to a specific beat sequence and collision plan. Then write scenes that execute the outline exactly.
{
  "arcName": "Short, evocative arc name (2-4 words). Must be UNIQUE. Bad: 'Continuation', 'New Beginnings'. Good: 'The Siege of Ashenmoor', 'Fractured Oaths'.",
  "directionVector": "Single sentence (10-15 words) using character NAMES: what changes, who drives it, what's at stake.",
  "arcOutline": {
    "threadBeats": {
      "T-XX (thread description)": ["Scene N: status FROM → TO via [specific mechanism]"],
      "T-YY (thread description)": ["Scene N: status FROM → TO via [specific mechanism]"]
    },
    "collisionPlan": ["Scene N: T-XX and T-YY collide — [Character A] and [Character B] are at [Location] because [reason], their incompatible goals force [specific consequence]"],
    "totalScenes": "number — the MINIMUM needed to execute all beats above. If a beat can share a scene with another beat via collision, it SHOULD."
  },
  "scenes": [
    {
      "id": "S-GEN-001",
      "arcId": "${arcId}",
      "locationId": "existing location ID from the narrative",
      "povId": "character ID whose perspective this scene is told from (must be a participant)${storySettings.povMode !== 'free' && storySettings.povCharacterIds.length > 0 ? ` — RESTRICTED to: ${storySettings.povCharacterIds.join(', ')}` : storySettings.povMode === 'free' && storySettings.povCharacterIds.length > 0 ? ` — PREFER: ${storySettings.povCharacterIds.join(', ')} (but may use others)` : ''}",
      "participantIds": ["existing character IDs"],
      "characterMovements": {"C-XX": {"locationId": "L-YY", "transition": "Descriptive transition: 'Rode horseback through the night', 'Slipped through the back gate at dawn'"}},
      "events": ["event_tag_1", "event_tag_2"],
      "threadMutations": [{"threadId": "T-XX", "from": "current_status", "to": "new_status"}],
      "continuityMutations": [{"characterId": "C-XX", "nodeId": "K-GEN-001", "action": "added", "content": "what they learned", "nodeType": "a descriptive type for this knowledge"}],
      "relationshipMutations": [{"from": "C-XX", "to": "C-YY", "type": "description", "valenceDelta": 0.1}],
      "worldKnowledgeMutations": {"addedNodes": [{"id": "WK-GEN-001", "concept": "world concept name", "type": "law|system|concept|tension"}], "addedEdges": [{"from": "WK-GEN-001", "to": "WK-XX", "relation": "enables|requires|governs|opposes|extends|etc."}]},
      "ownershipMutations": [{"artifactId": "A-XX", "fromId": "C-XX or L-XX", "toId": "C-YY or L-YY"}],
      "summary": "REQUIRED: Rich prose sentences using character NAMES and location NAMES — never raw IDs (no C-01, T-XX, L-03, WK-GEN, A-01 etc). Write as if for a reader: 'Fang Yuan acquires the Liquor worm' not 'C-01 acquires A-05'. Include specifics: what object, what words, what breaks. NO thin generic summaries. NO sentences ending in emotions/realizations."
    }
  ]
}

Rules:
- Use ONLY existing character IDs and location IDs from the narrative context above
- Scene IDs must be unique: S-GEN-001, S-GEN-002, etc.
- Knowledge node IDs must be unique: K-GEN-001, K-GEN-002, etc.
- World knowledge node IDs for NEW concepts must be unique: WK-GEN-001, WK-GEN-002, etc. Reused nodes should keep their original ID.
${PROMPT_STRUCTURAL_RULES}
${PROMPT_SUMMARY_REQUIREMENT}
${PROMPT_FORCE_STANDARDS}
${PROMPT_MUTATIONS}
${Object.keys(narrative.artifacts ?? {}).length > 0 ? PROMPT_ARTIFACTS : ''}
${PROMPT_POV}
${PROMPT_CONTINUITY}
${promptThreadLifecycle()}
${buildThreadHealthPrompt(narrative, resolvedKeys, currentIndex, storySettings.threadResolutionSpeed ?? 'moderate')}
${buildCompletedBeatsPrompt(narrative, resolvedKeys, currentIndex)}`;

  // Retry on JSON parse failures (truncation, malformed output)
  const MAX_RETRIES = 2;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: { arcName?: string; directionVector?: string; arcOutline?: any; scenes: Scene[] };
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const reasoningBudget = REASONING_BUDGETS[storySettings.reasoningLevel] || undefined;
      const useStream = !!(onToken || onReasoning);
      const raw = useStream
        ? await callGenerateStream(prompt, SYSTEM_PROMPT, onToken ?? (() => {}), MAX_TOKENS_LARGE, 'generateScenes', GENERATE_MODEL, reasoningBudget, onReasoning)
        : await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_LARGE, 'generateScenes', GENERATE_MODEL, reasoningBudget);
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
  const scenes: Scene[] = parsed.scenes.map((s, i) => ({
    ...s,
    kind: 'scene' as const,
    id: sceneIds[i],
    arcId,
    summary: s.summary || `Scene ${i + 1} of arc "${arcName}"`,
  }));

  sanitizeScenes(scenes, narrative, 'generateScenes');

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
  onReasoning?: (token: string) => void,
  onMeta?: (meta: { targetBeats: number; estWords: number }) => void,
  /** Per-scene direction that supplements storySettings.planGuidance */
  guidance?: string,
): Promise<BeatPlan> {
  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const fullContext = narrativeContext(narrative, resolvedKeys, contextIndex);
  const sceneBlock = sceneContext(narrative, scene, resolvedKeys, contextIndex);
  const logicRules = deriveLogicRules(narrative, scene, resolvedKeys, contextIndex);
  const logicBlock = logicRules ? `\n${logicRules}\n` : '';

  // Previous scene's beat plan for flow continuity
  const prevSceneKey = sceneIdx > 0 ? resolvedKeys[sceneIdx - 1] : null;
  const prevScene = prevSceneKey ? narrative.scenes[prevSceneKey] : null;
  const prevPlan = prevScene?.plan;

  const adjacentBlock = prevPlan
    ? `PREVIOUS SCENE ends with: ${prevPlan.beats.slice(-3).map((b) => `[${b.fn}:${b.mechanism}] ${b.what}`).join(', ')}`
    : '';

  // Prose profile context + optional Markov beat sequence
  const { resolveProfile, resolveSampler, sampleBeatSequence } = await import('@/lib/beat-profiles');
  const profile = resolveProfile(narrative);
  const sampler = resolveSampler(narrative);
  const storySettings: StorySettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };
  const scale = sceneScale(scene);
  const estWords = scale.estWords;
  // Clamp beatsPerKWord to sane range — real works are 9-12
  const bpkw = Math.min(16, Math.max(6, sampler.beatsPerKWord ?? 12));
  const targetBeats = Math.max(8, Math.round(estWords * bpkw / 1000));
  onMeta?.({ targetBeats, estWords });

  // Sample a beat sequence from the Markov chain when enabled
  let beatSequenceHint = '';
  if (storySettings.useBeatChain !== false) {
    const sampledBeats = sampleBeatSequence(sampler, targetBeats, 'breathe');
    beatSequenceHint = `\nBEAT SEQUENCE (${targetBeats} beats — follow this fn and mechanism assignment exactly):
${sampledBeats.map((b, i) => `  ${i + 1}. ${b.fn}:${b.mechanism}`).join('\n')}\n`;
  }

  // Render profile fields directly for the plan — no hardcoded value interpretation
  const planProfileLines: string[] = [];
  if (profile.register)       planProfileLines.push(`Register: ${profile.register}`);
  if (profile.stance)         planProfileLines.push(`Stance: ${profile.stance}`);
  if (profile.tense)          planProfileLines.push(`Tense: ${profile.tense}`);
  if (profile.sentenceRhythm) planProfileLines.push(`Sentence rhythm: ${profile.sentenceRhythm}`);
  if (profile.interiority)    planProfileLines.push(`Interiority: ${profile.interiority}`);
  if (profile.dialogueWeight) planProfileLines.push(`Dialogue weight: ${profile.dialogueWeight}`);
  if (profile.devices?.length) planProfileLines.push(`Devices: ${profile.devices.join(', ')}`);
  if (profile.rules?.length)   planProfileLines.push(`Rules:\n${profile.rules.map((r) => `    • ${r}`).join('\n')}`);
  if (profile.antiPatterns?.length) planProfileLines.push(`Anti-patterns:\n${profile.antiPatterns.map((a) => `    ✗ ${a}`).join('\n')}`);

  const profileBlock = `\nPROSE PROFILE (use these settings when choosing mechanisms and structuring beats):
${planProfileLines.map((l) => `  ${l}`).join('\n')}
  Beat density: ~${sampler.beatsPerKWord} beats/kword → target ${targetBeats} beats for this scene${beatSequenceHint}\n`;

  const systemPrompt = `You are a scene architect. Given a scene's structural data (summary, mutations, events), produce a structured beat plan — a JSON blueprint that a prose writer can follow.

The scene context includes a PROSE PROFILE. Every beat you write must reflect it — mechanism choices, beat density, and anchor language must all be consistent with the profile settings. This is not optional.

Return ONLY valid JSON matching this schema:
{
  "beats": [
    {
      "fn": "${BEAT_FN_LIST.join('|')}",
      "mechanism": "${BEAT_MECHANISM_LIST.join('|')}",
      "what": "One sentence: the concrete action or event",
      "anchor": "The one sensory detail that makes this beat physical"
    }
  ],
  "anchors": ["0-5 iconic lines the prose writer MUST include verbatim — the sentences a reader would quote, highlight, or remember. Craft these as polished, publication-ready prose: a striking opening image, a character's defining utterance, a metaphor that crystallizes the scene's meaning, a line of dialogue that reverberates. Not every scene needs anchors — only include them when the moment earns a standout line."]
}

BEAT FUNCTIONS (10):
  breathe    — Pacing, atmosphere, sensory grounding, scene establishment.
  inform     — Knowledge delivery. Character or reader learns something NOW.
  advance    — Forward momentum. Plot moves, goals pursued, tension rises.
  bond       — Relationship shifts between characters.
  turn       — Scene pivots. Revelation, reversal, interruption.
  reveal     — Character nature exposed through action or choice.
  shift      — Power dynamic inverts.
  expand     — World-building. New rule, system, geography introduced.
  foreshadow — Plants information that pays off LATER.
  resolve    — Tension releases. Question answered, conflict settles.

MECHANISMS (8):
  dialogue    — Characters speaking.
  thought     — Internal monologue.
  action      — Physical movement, gesture.
  environment — Setting, weather, arrivals, sensory details.
  narration   — Narrator voice, commentary, rhetoric.
  memory      — Flashback triggered by association.
  document    — Embedded text: letter, newspaper, sign, poem.
  comic       — Humor, physical comedy, absurdity.

RULES:
- Open with 1-3 breathe beats to ground the scene physically.
- Produce AT LEAST ${targetBeats} beats. This is the minimum bar — you are free to add more beats if the scene's content warrants it. Do not produce fewer than ${targetBeats}.
- Every structural mutation (thread, continuity, relationship, world knowledge) must map to at least one beat.
- Thread transitions need a concrete trigger in the 'what' field.
- Knowledge gains need a discovery mechanism (overheard, read, deduced, confessed).
- Relationship shifts need a catalytic moment.
- Be specific: "She asks about the missing shipment; he deflects" not "A tense exchange."
- ANCHORS: Write 1-3 polished, publication-ready sentences that would define this scene if quoted. These are the lines a reader highlights — a striking image, a defining utterance, a metaphor that crystallizes meaning. The prose writer will include these VERBATIM. Quiet scenes may have 0 anchors. Climactic scenes may have 3. Write them as finished prose, not summaries.
- Return ONLY valid JSON.`
  + (() => {
    const parts = [narrative.storySettings?.planGuidance?.trim(), guidance?.trim()].filter(Boolean);
    return parts.length > 0 ? `\n\nPLAN GUIDANCE:\n${parts.join('\n')}` : '';
  })();

  const prompt = `${profileBlock}BRANCH CONTEXT:\n${fullContext}
${adjacentBlock ? `${adjacentBlock}\n\n` : ''}${sceneBlock}
${logicBlock}
Generate a structured beat plan for this scene.`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = onReasoning
    ? await callGenerateStream(prompt, systemPrompt, () => {}, MAX_TOKENS_SMALL, 'generateScenePlan', GENERATE_MODEL, reasoningBudget, onReasoning)
    : await callGenerate(prompt, systemPrompt, MAX_TOKENS_SMALL, 'generateScenePlan', GENERATE_MODEL, reasoningBudget);

  const parsed = parseJson(raw, 'generateScenePlan') as { beats?: unknown[]; anchors?: string[] };
  const beats = (parsed.beats ?? []).map((b: unknown) => {
    const beat = b as Record<string, unknown>;
    return {
      fn: ((BEAT_FN_LIST as readonly string[]).includes(String(beat.fn)) ? beat.fn : 'advance') as BeatPlan['beats'][0]['fn'],
      mechanism: ((BEAT_MECHANISM_LIST as readonly string[]).includes(String(beat.mechanism)) ? beat.mechanism : 'action') as BeatPlan['beats'][0]['mechanism'],
      what: String(beat.what ?? ''),
      anchor: String(beat.anchor ?? ''),
    };
  });

  return {
    beats,
    anchors: (parsed.anchors ?? []).filter((a): a is string => typeof a === 'string'),
  };
}

/**
 * Edit an existing beat plan to address specific issues from plan evaluation.
 * Unlike generateScenePlan, this receives the current plan + issues and returns
 * a surgically modified plan — only the beats with problems are changed.
 *
 * Lightweight: no full narrative context, no logic context — focused on fixing specific issues.
 */
export async function editScenePlan(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  issues: string[],
): Promise<BeatPlan> {
  const plan = scene.plan;
  if (!plan) throw new Error('Scene has no plan to edit');

  // Edit functions are lightweight — scene context only, no logic bias
  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const sceneBlock = sceneContext(narrative, scene, resolvedKeys, contextIndex);

  const currentPlanJson = JSON.stringify({
    beats: plan.beats.map((b, i) => ({ idx: i + 1, fn: b.fn, mechanism: b.mechanism, what: b.what, anchor: b.anchor })),
    anchors: plan.anchors,
  }, null, 2);

  const issueBlock = issues.map((iss, i) => `${i + 1}. ${iss}`).join('\n');

  const prompt = `${sceneBlock}

CURRENT BEAT PLAN:
${currentPlanJson}

ISSUES TO FIX:
${issueBlock}

Edit the beat plan to address every issue above. You may:
- Modify a beat's fn, mechanism, what, or anchor
- Add new beats (to fill gaps or add missing setups)
- Remove beats (if redundant or contradictory)
- Reorder beats (if sequencing is wrong)

Keep beats that have NO issues exactly as they are — do not rewrite beats that are working.
Return the COMPLETE plan (all beats, not just changed ones) as JSON:
{
  "beats": [
    { "fn": "${BEAT_FN_LIST.join('|')}", "mechanism": "${BEAT_MECHANISM_LIST.join('|')}", "what": "...", "anchor": "..." }
  ],
  "anchors": ["..."]
}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_SMALL, 'editScenePlan', GENERATE_MODEL, reasoningBudget);

  const parsed = parseJson(raw, 'editScenePlan') as { beats?: unknown[]; anchors?: string[] };
  const beats = (parsed.beats ?? []).map((b: unknown) => {
    const beat = b as Record<string, unknown>;
    return {
      fn: ((BEAT_FN_LIST as readonly string[]).includes(String(beat.fn)) ? beat.fn : 'advance') as BeatPlan['beats'][0]['fn'],
      mechanism: ((BEAT_MECHANISM_LIST as readonly string[]).includes(String(beat.mechanism)) ? beat.mechanism : 'action') as BeatPlan['beats'][0]['mechanism'],
      what: String(beat.what ?? ''),
      anchor: String(beat.anchor ?? ''),
    };
  });

  return {
    beats,
    anchors: (parsed.anchors ?? []).filter((a): a is string => typeof a === 'string'),
  };
}

/**
 * Reverse-engineer a beat plan from existing prose.
 * Lighter than generateScenePlan — no branch context or profile needed,
 * just reads the prose structure and maps it to the beat taxonomy.
 */
export async function reverseEngineerScenePlan(
  prose: string,
  summary: string,
  onToken?: (token: string, accumulated: string) => void,
): Promise<BeatPlan> {
  const systemPrompt = `You are a beat analyst. Given existing prose, identify its structural beat sequence — what each beat does, how it's delivered, and the key sensory anchor.

Return ONLY valid JSON matching this schema:
{
  "beats": [
    {
      "fn": "${BEAT_FN_LIST.join('|')}",
      "mechanism": "${BEAT_MECHANISM_LIST.join('|')}",
      "what": "One sentence: the concrete action or event",
      "anchor": "The one sensory detail that makes this beat physical"
    }
  ],
  "anchors": ["0-5 standout lines from the prose — verbatim or near-verbatim lines a reader would highlight or remember"]
}

Beat functions: ${BEAT_FN_LIST.join(', ')}
Mechanisms: ${BEAT_MECHANISM_LIST.join(', ')}

Rules:
- Identify one beat per meaningful unit of action, dialogue, or shift. Aim for 8-20 beats per scene.
- Every beat must map to a specific moment in the prose.
- anchors: Pick 0-5 lines that define the scene. Quote them exactly from the prose.
- Return ONLY valid JSON.`;

  const prompt = `SCENE SUMMARY: ${summary}

PROSE:
${prose}

Identify the beat structure of this scene.`;

  let accumulated = '';
  const raw = onToken
    ? await callGenerateStream(prompt, systemPrompt, (token) => { accumulated += token; onToken(token, accumulated); }, MAX_TOKENS_SMALL, 'reverseEngineerScenePlan', GENERATE_MODEL)
    : await callGenerate(prompt, systemPrompt, MAX_TOKENS_SMALL, 'reverseEngineerScenePlan', GENERATE_MODEL);
  const parsed = parseJson(raw, 'reverseEngineerScenePlan') as { beats?: unknown[]; anchors?: string[] };
  const beats = (parsed.beats ?? []).map((b: unknown) => {
    const beat = b as Record<string, unknown>;
    return {
      fn: ((BEAT_FN_LIST as readonly string[]).includes(String(beat.fn)) ? beat.fn : 'advance') as BeatPlan['beats'][0]['fn'],
      mechanism: ((BEAT_MECHANISM_LIST as readonly string[]).includes(String(beat.mechanism)) ? beat.mechanism : 'action') as BeatPlan['beats'][0]['mechanism'],
      what: String(beat.what ?? ''),
      anchor: String(beat.anchor ?? ''),
    };
  });

  return {
    beats,
    anchors: (parsed.anchors ?? []).filter((a): a is string => typeof a === 'string'),
  };
}

/**
 * Rewrite a scene plan guided by user-provided analysis/critique.
 * Preserves the plan structure but revises content based on the feedback.
 *
 * Lightweight: no full narrative context, no logic context — focused on feedback.
 */
export async function rewriteScenePlan(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  currentPlan: BeatPlan,
  analysis: string,
): Promise<BeatPlan> {
  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const sceneBlock = sceneContext(narrative, scene, resolvedKeys, contextIndex);

  const currentPlanText = currentPlan.beats.map((b, i) =>
    `${i + 1}. [${b.fn}:${b.mechanism}] ${b.what} | anchor: ${b.anchor}`
  ).join('\n');
  const currentAnchors = currentPlan.anchors.length > 0
    ? `\nAnchors: ${currentPlan.anchors.map((a) => `"${a}"`).join(', ')}`
    : '';

  const systemPrompt = `You are a dramaturg revising a scene plan for "${narrative.title}". You receive the current beat plan and editorial feedback. Return an improved beat plan as JSON.

Return ONLY valid JSON: { "beats": [{ "fn": "...", "mechanism": "...", "what": "...", "anchor": "..." }], "anchors": ["..."] }

Beat functions: ${BEAT_FN_LIST.join(', ')}
Mechanisms: ${BEAT_MECHANISM_LIST.join(', ')}`;

  const prompt = `${sceneBlock}

CURRENT PLAN:
${currentPlanText}${currentAnchors}

EDITORIAL FEEDBACK:
${analysis}

Revise the beat plan to address the feedback. Ensure all scene mutations are still covered.`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = await callGenerate(prompt, systemPrompt, MAX_TOKENS_SMALL, 'rewriteScenePlan', GENERATE_MODEL, reasoningBudget);
  const parsed = parseJson(raw, 'rewriteScenePlan') as { beats?: unknown[]; anchors?: string[] };

  const beats = (parsed.beats ?? []).map((b: unknown) => {
    const beat = b as Record<string, unknown>;
    return {
      fn: ((BEAT_FN_LIST as readonly string[]).includes(String(beat.fn)) ? beat.fn : 'advance') as BeatPlan['beats'][0]['fn'],
      mechanism: ((BEAT_MECHANISM_LIST as readonly string[]).includes(String(beat.mechanism)) ? beat.mechanism : 'action') as BeatPlan['beats'][0]['mechanism'],
      what: String(beat.what ?? ''),
      anchor: String(beat.anchor ?? ''),
    };
  });

  return {
    beats: beats.length > 0 ? beats : currentPlan.beats,
    anchors: (parsed.anchors ?? currentPlan.anchors).filter((a): a is string => typeof a === 'string'),
  };
}

export async function generateSceneProse(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  onToken?: (token: string) => void,
  /** Per-scene prose direction appended to the system prompt */
  guidance?: string,
): Promise<string> {

  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;

  // Previous scene prose ending for transition continuity
  const prevSceneKey = sceneIdx > 0 ? resolvedKeys[sceneIdx - 1] : null;
  const prevScene = prevSceneKey ? narrative.scenes[prevSceneKey] : null;
  const prevProse = prevScene?.prose;
  const prevProseEnding = prevProse
    ? prevProse.split('\n').filter((l) => l.trim()).slice(-3).join('\n')
    : '';

  const proseProfile = narrative.proseProfile;

  // Render profile fields directly — no hardcoded interpretation of specific values
  const profileLines: string[] = [];
  if (proseProfile?.register)       profileLines.push(`Register: ${proseProfile.register}`);
  if (proseProfile?.stance)         profileLines.push(`Stance: ${proseProfile.stance}`);
  if (proseProfile?.tense)          profileLines.push(`Tense: ${proseProfile.tense}`);
  if (proseProfile?.sentenceRhythm) profileLines.push(`Sentence rhythm: ${proseProfile.sentenceRhythm}`);
  if (proseProfile?.interiority)    profileLines.push(`Interiority: ${proseProfile.interiority}`);
  if (proseProfile?.dialogueWeight) profileLines.push(`Dialogue weight: ${proseProfile.dialogueWeight}`);
  if (proseProfile?.devices?.length) profileLines.push(`Devices: ${proseProfile.devices.join(', ')}`);

  const profileSection = profileLines.length > 0
    ? `\n\nPROSE PROFILE — every sentence must conform to these settings. Non-compliance is a failure:\n${profileLines.map((l) => `- ${l}`).join('\n')}${
        proseProfile?.rules?.length
          ? `\n- Rules:\n${proseProfile.rules.map((r) => `  • ${r}`).join('\n')}`
          : ''
      }${
        proseProfile?.antiPatterns?.length
          ? `\n- ANTI-PATTERNS (these are specific failures for this voice — avoid them):\n${proseProfile.antiPatterns.map((a) => `  ✗ ${a}`).join('\n')}`
          : ''
      }`
    : '';

  const hasVoiceOverride = !!narrative.storySettings?.proseVoice?.trim();

  const systemPrompt = `You are a literary prose writer crafting a single scene for a novel set in "${narrative.title}".

Tone: ${narrative.worldSummary.slice(0, 200)}.
${hasVoiceOverride
    ? `\nAUTHOR VOICE (this is the PRIMARY creative direction — all craft defaults below are subordinate to this voice):
${narrative.storySettings!.proseVoice!.trim()}
`
    : ''}
General craft${hasVoiceOverride ? ' (defer to AUTHOR VOICE when these conflict)' : ''}:
- Enter late, leave early. Start in the middle of something happening.
- Let scenes breathe. A thread shift or relationship change is a turning point — build to it, let it land.
- Dialogue must do at least two things at once: reveal character, advance conflict, shift power, or expose subtext.
- Sensory grounding in small, specific details. One precise image outweighs three generic ones.${!hasVoiceOverride ? '\n- Subtext over exposition. What characters don\'t say carries more weight than declarations.' : ''}

Compression & implication:
- SHOW, NEVER EXPLAIN. When a system, rule, or concept is revealed, dramatise it through action or consequence. Do not follow it with a sentence explaining what it means or why it matters. Trust the reader to infer.
- Cut the "explanation chain": action → explanation → strategic implication is a failure pattern. Write the action. Let the implication live in what happens next.
- Internal monologue must sound like the CHARACTER thinking, not the narrator documenting a mechanic. "The formation had three nodes left" not "This was a tri-node defensive formation designed to..."
- After writing any sentence that explains a concept, DELETE IT and check if the scene still works. If it does, the sentence was unnecessary.

Sentence rhythm:
- VARY sentence length deliberately. Follow two short declarative sentences with a longer flowing one. Break a tense sequence with a fragment. Let paragraphs breathe with mixed cadence.
- Avoid chains of 4+ sentences with identical structure (subject-verb-object). Rotate between: fragments, compound sentences, dialogue interruptions, sensory inserts, and longer periodic sentences.
- The prose should feel like a novel, not a storyboard. Storyboard prose = "He did X. She did Y. The result was Z." Novel prose = varied rhythm, texture, voice.${profileSection}

Strict output rules:
- Output ONLY the prose. No scene titles, chapter headers, separators (---), or meta-commentary.
- Use straight quotes (" and '), never smart/curly quotes or other typographic substitutions.
- Do not begin with a character name as the first word.${!hasVoiceOverride ? `
- CRITICAL: Do NOT open with weather, atmosphere, air quality, scent, or environmental description. Instead: mid-dialogue, a character's body in motion, a close-up on an object, an internal thought, a sound, a tactile sensation.
- Do NOT end with philosophical musings, rhetorical questions, or atmospheric fade-outs. End with: a character leaving, a sharp line of dialogue, a decision made in silence, an interruption, a physical gesture.` : ''}${
    guidance?.trim() ? `\n\nSCENE DIRECTION:\n${guidance.trim()}` : ''
  }`;

  const sceneBlock = sceneContext(narrative, scene, resolvedKeys, contextIndex);

  // Scene plan — when available, this is the primary creative direction
  const planBlock = scene.plan
    ? `\nBEAT PLAN (follow this beat sequence — each beat maps to a passage of prose):
${scene.plan.beats.map((b, i) => `  ${i + 1}. [${b.fn}:${b.mechanism}] ${b.what} | anchor: ${b.anchor}`).join('\n')}
${scene.plan.anchors.length > 0 ? `\nANCHOR LINES (these exact formulations must appear in your prose):\n${scene.plan.anchors.map((a) => `  "${a}"`).join('\n')}` : ''}\n`
    : '';

  // Derive logical constraints from the scene graph — these are hard rules the prose must obey
  const logicRules = deriveLogicRules(narrative, scene, resolvedKeys, contextIndex);
  const logicBlock = logicRules ? `\n${logicRules}\n` : '';

  // Previous prose edge for transition continuity
  const adjacentProseBlock = prevProseEnding
    ? `PREVIOUS SCENE ENDING (match tone, avoid repeating imagery or phrasing):\n"""${prevProseEnding}"""`
    : '';

  const instruction = scene.plan
    ? `Follow the beat plan sequence — each beat maps to a passage of prose. The mechanism tells you HOW to write each beat (dialogue = conversation, thought = internal monologue, action = physical movement, etc). The anchor is the sensory detail that grounds the beat.

THREE PILLARS — the prose must honour all three:
1. CONTINUITY: POV character can only perceive what their senses and existing knowledge allow. New continuity mutations must be discovered through specific mechanisms — never referenced before their revelation moment.
2. THREADS: Every thread shift must land at a specific dramatic moment. Show the status change through action, not narration.
3. KNOWLEDGE: World concepts being revealed in this scene (marked in the logical requirements) must feel EARNED — discovered through demonstration, consequence, or character action. Never explain a concept after showing it — let the demonstration speak. Established world knowledge can be referenced freely. New knowledge cannot be treated as pre-existing.

Every thread shift, continuity change, relationship mutation, and world knowledge reveal must appear in the prose. You MUST satisfy every logical requirement. Anchor lines must appear VERBATIM. Fill around the beats with dialogue, internal monologue, physical action, and sensory detail. Write at least ~${sceneScale(scene).estWords} words — this is the minimum bar, not a target to pad toward. You are free to write more if the scene demands it.`
    : `THREE PILLARS — the prose must honour all three:
1. CONTINUITY: POV character can only perceive what their senses and existing knowledge allow. New continuity mutations must be discovered through specific mechanisms — never referenced before their revelation moment.
2. THREADS: Every thread shift must land at a specific dramatic moment. Show the status change through action, not narration.
3. KNOWLEDGE: World concepts being revealed in this scene (marked in the logical requirements) must feel EARNED — discovered through demonstration, consequence, or character action. Never explain a concept after showing it — let the demonstration speak. Established world knowledge can be referenced freely. New knowledge cannot be treated as pre-existing.

Every thread shift, continuity change, relationship mutation, and world knowledge reveal listed above must be dramatised — these are the structural deliveries of this scene. You MUST satisfy every logical requirement. Foreshadow future events through subtle imagery, offhand remarks, and environmental details — never telegraph. Write at least ~${sceneScale(scene).estWords} words — this is the minimum bar, not a target to pad toward. You are free to write more if the scene demands it.`;

  const prompt = `${adjacentProseBlock ? `${adjacentProseBlock}\n\n` : ''}${planBlock}${sceneBlock}
${logicBlock}
${instruction}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  if (onToken) {
    return await callGenerateStream(prompt, systemPrompt, onToken, MAX_TOKENS_DEFAULT, 'generateSceneProse', WRITING_MODEL, reasoningBudget);
  }
  return await callGenerate(prompt, systemPrompt, MAX_TOKENS_DEFAULT, 'generateSceneProse', WRITING_MODEL, reasoningBudget, false);
}

// ── Shared Helpers ───────────────────────────────────────────────────────────

/** Sanitize hallucinated IDs in generated scenes — filter out invalid references instead of crashing. */
function sanitizeScenes(scenes: Scene[], narrative: NarrativeState, label: string): void {
  const validCharIds = new Set(Object.keys(narrative.characters));
  const validLocIds = new Set(Object.keys(narrative.locations));
  const validThreadIds = new Set(Object.keys(narrative.threads));
  const validArtifactIds = new Set(Object.keys(narrative.artifacts ?? {}));
  const allEntityIds = new Set([...validCharIds, ...validLocIds]);
  const stripped: string[] = [];
  const fallbackCharId = Object.keys(narrative.characters)[0];

  for (const scene of scenes) {
    if (!validLocIds.has(scene.locationId)) {
      stripped.push(`locationId "${scene.locationId}" in scene ${scene.id}`);
      scene.locationId = Object.keys(narrative.locations)[0];
    }
    if (!scene.povId || !validCharIds.has(scene.povId)) {
      if (scene.povId) stripped.push(`povId "${scene.povId}" in scene ${scene.id} (invalid)`);
      scene.povId = scene.participantIds.find((pid) => validCharIds.has(pid)) ?? fallbackCharId;
    }
    const validParticipants = scene.participantIds.filter((pid) => {
      if (validCharIds.has(pid)) return true;
      stripped.push(`participantId "${pid}" in scene ${scene.id}`);
      return false;
    });
    scene.participantIds = validParticipants.length > 0 ? validParticipants : [fallbackCharId];
    if (!scene.participantIds.includes(scene.povId)) {
      scene.povId = scene.participantIds[0] ?? fallbackCharId;
    }
    if (!Array.isArray(scene.threadMutations)) scene.threadMutations = [];
    if (!Array.isArray(scene.continuityMutations)) scene.continuityMutations = [];
    if (!Array.isArray(scene.relationshipMutations)) scene.relationshipMutations = [];
    scene.threadMutations = scene.threadMutations.filter((tm) => {
      if (validThreadIds.has(tm.threadId)) return true;
      stripped.push(`threadId "${tm.threadId}" in scene ${scene.id}`);
      return false;
    });
    scene.continuityMutations = scene.continuityMutations.filter((km) => {
      if (!km.characterId || validCharIds.has(km.characterId)) return true;
      stripped.push(`knowledgeMutation characterId "${km.characterId}" in scene ${scene.id}`);
      return false;
    });
    scene.relationshipMutations = scene.relationshipMutations.filter((rm) => {
      if (validCharIds.has(rm.from) && validCharIds.has(rm.to)) return true;
      stripped.push(`relationshipMutation "${rm.from}" -> "${rm.to}" in scene ${scene.id}`);
      return false;
    });
    scene.ownershipMutations = (scene.ownershipMutations ?? []).filter((om) => {
      const ok = validArtifactIds.has(om.artifactId) && allEntityIds.has(om.fromId) && allEntityIds.has(om.toId);
      if (!ok) stripped.push(`ownershipMutation "${om.artifactId}" in scene ${scene.id}`);
      return ok;
    });
    if (scene.ownershipMutations.length === 0) delete scene.ownershipMutations;
    if (scene.characterMovements) {
      const sanitized: Record<string, { locationId: string; transition: string }> = {};
      for (const [charId, mv] of Object.entries(scene.characterMovements)) {
        const movement = typeof mv === 'string' ? { locationId: mv, transition: '' } : mv;
        if (!validCharIds.has(charId)) { stripped.push(`characterMovement charId "${charId}" in scene ${scene.id}`); continue; }
        if (!validLocIds.has(movement.locationId)) { stripped.push(`characterMovement locationId "${movement.locationId}" in scene ${scene.id}`); continue; }
        sanitized[charId] = movement;
      }
      scene.characterMovements = Object.keys(sanitized).length > 0 ? sanitized : undefined;
    }
    // Sanitize worldKnowledgeMutations — ensure arrays exist, nodes have concept, edges have valid refs
    if (scene.worldKnowledgeMutations) {
      const wkm = scene.worldKnowledgeMutations;
      wkm.addedNodes = (wkm.addedNodes ?? []).filter((node) => {
        if (node.concept && node.type) return true;
        stripped.push(`worldKnowledge node missing concept/type in scene ${scene.id}`);
        return false;
      });
      wkm.addedEdges = (wkm.addedEdges ?? []).filter((edge) => {
        if (edge.from && edge.to && edge.relation) return true;
        stripped.push(`worldKnowledge edge missing from/to/relation in scene ${scene.id}`);
        return false;
      });
    } else {
      scene.worldKnowledgeMutations = { addedNodes: [], addedEdges: [] };
    }
    // Ensure continuityMutations have required fields
    scene.continuityMutations = scene.continuityMutations.filter((km) => {
      if (km.characterId && km.nodeId && km.content) return true;
      stripped.push(`continuityMutation missing fields in scene ${scene.id}`);
      return false;
    });
  }
  if (stripped.length > 0) {
    console.warn(`[${label}] Stripped ${stripped.length} hallucinated ID(s):\n` + stripped.map((h) => `  - ${h}`).join('\n'));
  }
}

/** Apply scene mutations to a narrative state (relationships, knowledge, threads, world knowledge). */
function applySceneMutations(n: NarrativeState, scenes: Scene[]): NarrativeState {
  let relationships = [...n.relationships];
  const characters = { ...n.characters };
  const threads = { ...n.threads };
  const worldKnowledge = { nodes: { ...n.worldKnowledge?.nodes }, edges: [...(n.worldKnowledge?.edges ?? [])] };

  for (const scene of scenes) {
    for (const rm of scene.relationshipMutations) {
      const idx = relationships.findIndex((r) => r.from === rm.from && r.to === rm.to);
      if (idx >= 0) {
        const existing = relationships[idx];
        relationships = [...relationships.slice(0, idx), { ...existing, type: rm.type, valence: Math.max(-1, Math.min(1, existing.valence + rm.valenceDelta)) }, ...relationships.slice(idx + 1)];
      } else {
        relationships.push({ from: rm.from, to: rm.to, type: rm.type, valence: Math.max(-1, Math.min(1, rm.valenceDelta)) });
      }
    }
    for (const km of scene.continuityMutations) {
      const char = characters[km.characterId];
      if (!char) continue;
      if (km.action === 'added' && !char.continuity.nodes.some((kn) => kn.id === km.nodeId)) {
        characters[km.characterId] = { ...char, continuity: { ...char.continuity, nodes: [...char.continuity.nodes, { id: km.nodeId, type: km.nodeType ?? 'learned', content: km.content }] } };
      } else if (km.action === 'removed') {
        characters[km.characterId] = { ...char, continuity: { ...char.continuity, nodes: char.continuity.nodes.filter((kn) => kn.id !== km.nodeId) } };
      }
    }
    for (const tm of scene.threadMutations) {
      const thread = threads[tm.threadId];
      if (thread) threads[tm.threadId] = { ...thread, status: tm.to };
    }
    const wkm = scene.worldKnowledgeMutations;
    if (wkm) {
      for (const node of wkm.addedNodes ?? []) {
        if (!worldKnowledge.nodes[node.id]) worldKnowledge.nodes[node.id] = { id: node.id, concept: node.concept, type: node.type };
      }
      for (const edge of wkm.addedEdges ?? []) {
        if (!worldKnowledge.edges.some((e: { from: string; to: string; relation: string }) => e.from === edge.from && e.to === edge.to && e.relation === edge.relation)) {
          worldKnowledge.edges.push({ from: edge.from, to: edge.to, relation: edge.relation });
        }
      }
    }
  }
  return { ...n, relationships, characters, threads, worldKnowledge };
}

// ── Stepwise Arc Generation ──────────────────────────────────────────────────
// Generates an arc one scene at a time. Each scene sees the full narrative
// context including all previously generated scenes in this arc, preventing
// the duplication that plagues batch generation.

export type ArcPlan = {
  arcName: string;
  directionVector: string;
  scenePlan: string[];  // One-line beat description per scene
};

export type GenerateStepwiseOptions = {
  existingArc?: Arc;
  pacingSequence?: PacingSequence;
  worldBuildFocus?: WorldBuild;
  onToken?: (token: string) => void;
  /** Callback for streaming reasoning/thinking tokens */
  onReasoning?: (token: string) => void;
  /** Called after each scene is generated and sanitized. Use to dispatch to store for live UI updates. */
  onScene?: (scene: Scene, arc: Arc, sceneIndex: number) => void;
  /** Return true to abort generation early (e.g., user cancelled). */
  shouldStop?: () => boolean;
};

/**
 * Plan an arc's structure without generating scenes.
 * Returns arc name, direction vector, and a one-line beat per scene.
 */
async function generateArcPlan(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  count: number,
  direction: string,
  sequence: PacingSequence,
): Promise<ArcPlan> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);
  const storySettings: StorySettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };
  const speed = storySettings.threadResolutionSpeed ?? 'moderate';

  const prompt = `${ctx}

${direction.trim() ? `DIRECTION — THIS IS YOUR PRIMARY BRIEF. Your arc plan must execute the beats described here. The direction may include prose-level guidance (time compression, tone shifts, structural techniques, dialogue register) — carry these through into your scene descriptions so the prose writer receives them.\n${direction}` : 'DIRECTION: Use your judgment — choose the most compelling next development.'}

Plan a ${count}-scene arc that faithfully executes the direction above. For each scene, write ONE sentence describing the key action and which threads it advances. Include any prose-level guidance from the direction that applies to that scene. Scenes that collide 2+ threads are preferred.

${buildThreadHealthPrompt(narrative, resolvedKeys, currentIndex, speed)}
${buildCompletedBeatsPrompt(narrative, resolvedKeys, currentIndex)}

ID REFERENCE:
  Characters: ${Object.entries(narrative.characters).map(([id, c]) => `${c.name} (${id})`).join(', ')}
  Threads: ${Object.entries(narrative.threads).map(([id, t]) => `${t.description.slice(0, 40)} (${id})`).join(', ')}

Return JSON:
{
  "arcName": "2-4 word evocative chapter title, unique",
  "directionVector": "Single sentence (10-15 words) with character NAMES",
  "scenePlan": ["Scene 1: [Character] does [action] at [location], advancing [T-XX] and [T-YY]", "Scene 2: ..."]
}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_SMALL, 'generateArcPlan', GENERATE_MODEL, reasoningBudget);
  const parsed = parseJson(raw, 'generateArcPlan') as Partial<ArcPlan>;
  return {
    arcName: parsed.arcName ?? 'Untitled Arc',
    directionVector: parsed.directionVector ?? '',
    scenePlan: parsed.scenePlan ?? Array.from({ length: count }, (_, i) => `Scene ${i + 1}`),
  };
}

/**
 * Generate a single scene within a stepwise arc build.
 * Gets the FULL narrative context (including prior scenes from this arc).
 */
async function generateSingleScene(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  arcId: string,
  arcPlan: ArcPlan,
  sceneIndex: number,
  pacingStep: ModeStep,
  totalScenes: number,
  direction: string,
  storySettings: StorySettings,
  /** Scene IDs already generated in this arc — used to build prior summaries */
  priorArcSceneIds: string[],
  onToken?: (token: string) => void,
  onReasoning?: (token: string) => void,
): Promise<Scene> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);
  const speed = storySettings.threadResolutionSpeed ?? 'moderate';
  const stepPrompt = buildSingleStepPrompt(pacingStep, sceneIndex, totalScenes);

  // Show the full arc plan with completion markers
  const planContext = arcPlan.scenePlan
    .map((beat, i) => {
      const marker = i < sceneIndex ? '✓' : i === sceneIndex ? '→' : ' ';
      return `  ${marker} Scene ${i + 1}: ${beat}`;
    })
    .join('\n');

  // Summaries of scenes already generated in this arc (prevents duplication)
  const priorSummaries = priorArcSceneIds
    .map((id, i) => {
      const s = narrative.scenes[id];
      return s ? `  Scene ${i + 1} (DONE): ${s.summary}` : null;
    })
    .filter(Boolean)
    .join('\n');

  const prompt = `${ctx}

ARC: "${arcPlan.arcName}" — ${arcPlan.directionVector}
${direction.trim() ? `DIRECTION (follow these beats faithfully):\n${direction}` : ''}

ARC PLAN (you are generating the scene marked with →):
${planContext}

${priorSummaries ? `SCENES ALREADY WRITTEN IN THIS ARC (do NOT repeat any action, discovery, or confrontation from these):\n${priorSummaries}\n` : ''}
${stepPrompt}

Generate exactly ONE scene. The summary must use character NAMES and location NAMES (never raw IDs). Include specifics and any context that shapes how the prose should be written (time span, technique, tone). No sentences ending in emotions or realizations.

Return JSON:
{
  "id": "S-GEN-001",
  "arcId": "${arcId}",
  "locationId": "existing location ID",
  "povId": "character ID${storySettings.povMode !== 'free' && storySettings.povCharacterIds.length > 0 ? ` — RESTRICTED to: ${storySettings.povCharacterIds.join(', ')}` : ''}",
  "participantIds": ["character IDs"],
  "characterMovements": {},
  "events": ["event_tags"],
  "threadMutations": [{"threadId": "T-XX", "from": "status", "to": "status"}],
  "continuityMutations": [{"characterId": "C-XX", "nodeId": "K-GEN-001", "action": "added", "content": "what", "nodeType": "type"}],
  "relationshipMutations": [{"from": "C-XX", "to": "C-YY", "type": "desc", "valenceDelta": 0.1}],
  "worldKnowledgeMutations": {"addedNodes": [], "addedEdges": []},
  "ownershipMutations": [],
  "summary": "Rich prose sentences using character NAMES and location NAMES — never raw IDs. Include specifics and any context that shapes prose (time span, technique, tone). NO thin generic summaries."
}

${PROMPT_SUMMARY_REQUIREMENT}
${PROMPT_MUTATIONS}
${Object.keys(narrative.artifacts ?? {}).length > 0 ? PROMPT_ARTIFACTS : ''}
${PROMPT_CONTINUITY}
${buildThreadHealthPrompt(narrative, resolvedKeys, currentIndex, speed)}
${buildCompletedBeatsPrompt(narrative, resolvedKeys, currentIndex)}
Use ONLY these IDs:
  Characters: ${Object.entries(narrative.characters).map(([id, c]) => `${c.name} (${id})`).join(', ')}
  Locations: ${Object.entries(narrative.locations).map(([id, l]) => `${l.name} (${id})`).join(', ')}
  Threads: ${Object.entries(narrative.threads).map(([id, t]) => `${t.description.slice(0, 40)} (${id})`).join(', ')}${Object.keys(narrative.artifacts ?? {}).length > 0 ? `\n  Artifacts: ${Object.entries(narrative.artifacts).map(([id, a]) => `${a.name} (${id})`).join(', ')}` : ''}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const useStream = !!(onToken || onReasoning);
  const raw = useStream
    ? await callGenerateStream(prompt, SYSTEM_PROMPT, onToken ?? (() => {}), MAX_TOKENS_SMALL, 'generateSingleScene', GENERATE_MODEL, reasoningBudget, onReasoning)
    : await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_SMALL, 'generateSingleScene', GENERATE_MODEL, reasoningBudget);

  const parsed = parseJson(raw, 'generateSingleScene') as Scene;
  return { ...parsed, kind: 'scene' as const, arcId };
}

/**
 * Generate an arc one scene at a time.
 * Each scene gets the full narrative context including all prior scenes
 * from this arc, preventing the duplication that plagues batch generation.
 *
 * The onScene callback is called after each scene is sanitized, allowing
 * the caller to dispatch to the store for live UI updates.
 */
export async function generateArcStepwise(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  count: number,
  direction: string,
  options: GenerateStepwiseOptions = {},
): Promise<{ scenes: Scene[]; arc: Arc }> {
  const { existingArc, pacingSequence, worldBuildFocus, onToken, onReasoning, onScene, shouldStop } = options;
  const storySettings: StorySettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };
  const targetLen = storySettings.targetArcLength;
  const sceneCount = count > 0 ? Math.max(3, count) : targetLen;

  // Sample pacing sequence (when enabled)
  let sequence: PacingSequence;
  if (storySettings.usePacingChain === false) {
    // No Markov chain — repeat current mode for all scenes (no pacing constraints)
    const currentMode = detectCurrentMode(narrative, resolvedKeys);
    const corner = NARRATIVE_CUBE[currentMode];
    const neutralStep: ModeStep = { mode: currentMode, name: corner.name, description: corner.description, forces: { payoff: [-2, 2], change: [-2, 2], knowledge: [-2, 2] } };
    sequence = { steps: Array.from({ length: sceneCount }, () => neutralStep), pacingDescription: 'AI Optimal — no pacing chain constraints' };
  } else if (pacingSequence) {
    sequence = pacingSequence;
  } else {
    const currentMode = detectCurrentMode(narrative, resolvedKeys);
    const matrix = MATRIX_PRESETS.find((p) => p.key === storySettings.rhythmPreset)?.matrix ?? DEFAULT_TRANSITION_MATRIX;
    sequence = samplePacingSequence(currentMode, sceneCount, matrix);
  }

  // World build focus appended to direction
  let fullDirection = direction;
  if (worldBuildFocus) {
    const wb = worldBuildFocus;
    const chars = wb.expansionManifest.characters.map((c) => `${c.name} (${c.role})`);
    const locs = wb.expansionManifest.locations.map((l) => l.name);
    const threads = wb.expansionManifest.threads.map((t) => {
      const live = narrative.threads[t.id];
      return `${t.description} [${live?.status ?? t.status}]`;
    });
    const wbLines = [`WORLD BUILD FOCUS: bring in recently introduced entities:`];
    if (chars.length) wbLines.push(`  Characters: ${chars.join(', ')}`);
    if (locs.length) wbLines.push(`  Locations: ${locs.join(', ')}`);
    if (threads.length) wbLines.push(`  Threads: ${threads.join('; ')}`);
    fullDirection = `${direction}\n${wbLines.join('\n')}`;
  }

  // Step 1: Plan the arc
  const arcId = existingArc?.id ?? nextId('ARC', Object.keys(narrative.arcs));
  const plan = await generateArcPlan(narrative, resolvedKeys, currentIndex, sequence.steps.length, fullDirection, sequence);

  // Step 2: Generate scenes one at a time
  const allScenes: Scene[] = [];
  let liveNarrative = JSON.parse(JSON.stringify(narrative)) as NarrativeState;
  let liveResolvedKeys = [...resolvedKeys];
  let liveIndex = currentIndex;

  // Pre-allocate scene IDs so they're sequential
  const sceneIds = nextIds('S', Object.keys(narrative.scenes), sequence.steps.length, 3);

  for (let i = 0; i < sequence.steps.length; i++) {
    if (shouldStop?.()) break;

    const step = sequence.steps[i];
    const priorArcSceneIds = allScenes.map((s) => s.id);
    const scene = await generateSingleScene(
      liveNarrative, liveResolvedKeys, liveIndex,
      arcId, plan, i, step, sequence.steps.length,
      fullDirection, storySettings, priorArcSceneIds, onToken, onReasoning,
    );

    // Assign real scene ID
    scene.id = sceneIds[i];
    scene.summary = scene.summary || `Scene ${i + 1} of arc "${plan.arcName}"`;

    // Sanitize
    sanitizeScenes([scene], liveNarrative, 'generateArcStepwise');

    // Fix knowledge mutation IDs
    const existingKIds = [
      ...Object.values(liveNarrative.characters).flatMap((c) => c.continuity.nodes.map((n) => n.id)),
      ...Object.values(liveNarrative.locations).flatMap((l) => l.continuity.nodes.map((n) => n.id)),
    ];
    const kIds = nextIds('K', existingKIds, scene.continuityMutations.length);
    scene.continuityMutations.forEach((km, j) => { km.nodeId = kIds[j]; });

    // Fix world knowledge IDs
    const existingWKIds = Object.keys(liveNarrative.worldKnowledge?.nodes ?? {});
    const wkm = scene.worldKnowledgeMutations;
    if (wkm) {
      wkm.addedNodes = wkm.addedNodes ?? [];
      wkm.addedEdges = wkm.addedEdges ?? [];
      const wkIds = nextIds('WK', existingWKIds, wkm.addedNodes.length);
      const wkIdMap: Record<string, string> = {};
      wkm.addedNodes.forEach((node, j) => { wkIdMap[node.id] = wkIds[j]; node.id = wkIds[j]; });
      const validWKIds = new Set([...existingWKIds, ...Object.values(wkIdMap)]);
      wkm.addedEdges = wkm.addedEdges
        .map((e) => ({ from: wkIdMap[e.from] ?? e.from, to: wkIdMap[e.to] ?? e.to, relation: e.relation }))
        .filter((e) => validWKIds.has(e.from) && validWKIds.has(e.to));
    }

    allScenes.push(scene);

    // Update live narrative state so the next scene sees everything
    liveNarrative = {
      ...liveNarrative,
      scenes: { ...liveNarrative.scenes, [scene.id]: scene },
    };
    liveNarrative = applySceneMutations(liveNarrative, [scene]);
    liveResolvedKeys = [...liveResolvedKeys, scene.id];
    liveIndex = liveResolvedKeys.length - 1;

    // Build arc progressively
    const currentArc: Arc = existingArc
      ? {
          ...existingArc,
          sceneIds: [...existingArc.sceneIds, ...allScenes.map((s) => s.id)],
          develops: [...new Set([...existingArc.develops, ...allScenes.flatMap((s) => s.threadMutations.map((tm) => tm.threadId))])],
          locationIds: [...new Set([...existingArc.locationIds, ...allScenes.map((s) => s.locationId)])],
          activeCharacterIds: [...new Set([...existingArc.activeCharacterIds, ...allScenes.flatMap((s) => s.participantIds)])],
        }
      : {
          id: arcId,
          name: plan.arcName,
          sceneIds: allScenes.map((s) => s.id),
          develops: [...new Set(allScenes.flatMap((s) => s.threadMutations.map((tm) => tm.threadId)))],
          locationIds: [...new Set(allScenes.map((s) => s.locationId))],
          activeCharacterIds: [...new Set(allScenes.flatMap((s) => s.participantIds))],
          initialCharacterLocations: {},
          directionVector: plan.directionVector,
        };

    // Notify caller for live UI updates
    onScene?.(scene, currentArc, i);
  }

  // Build final arc
  const newSceneIds = allScenes.map((s) => s.id);
  const newDevelops = [...new Set(allScenes.flatMap((s) => s.threadMutations.map((tm) => tm.threadId)))];
  const newLocationIds = [...new Set(allScenes.map((s) => s.locationId))];
  const newCharacterIds = [...new Set(allScenes.flatMap((s) => s.participantIds))];

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
        name: plan.arcName,
        sceneIds: newSceneIds,
        develops: newDevelops,
        locationIds: newLocationIds,
        activeCharacterIds: newCharacterIds,
        initialCharacterLocations: {},
        directionVector: plan.directionVector,
      };

  if (!existingArc && allScenes.length > 0) {
    for (const cid of arc.activeCharacterIds) {
      const firstScene = allScenes.find((s) => s.participantIds.includes(cid));
      if (firstScene) arc.initialCharacterLocations[cid] = firstScene.locationId;
    }
  }

  return { scenes: allScenes, arc };
}
