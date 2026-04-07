import type { NarrativeState, Scene, Arc, WorldBuild, StorySettings, Beat, BeatPlan, BeatProse, BeatProseMap, Proposition } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS, REASONING_BUDGETS, BEAT_FN_LIST, BEAT_MECHANISM_LIST, NARRATIVE_CUBE } from '@/types/narrative';
import { nextId, nextIds } from '@/lib/narrative-utils';
import { callGenerate, callGenerateStream, SYSTEM_PROMPT } from './api';
import { WRITING_MODEL, ANALYSIS_MODEL, GENERATE_MODEL, MAX_TOKENS_LARGE, MAX_TOKENS_DEFAULT, MAX_TOKENS_SMALL, BEAT_DENSITY_MIN, BEAT_DENSITY_MAX, BEAT_DENSITY_DEFAULT, WORDS_PER_BEAT_MIN, WORDS_PER_BEAT_MAX, WORDS_PER_BEAT_DEFAULT, ANALYSIS_TEMPERATURE } from '@/lib/constants';
import { parseJson } from './json';
import { narrativeContext, sceneContext, deriveLogicRules, sceneScale } from './context';
import { PROMPT_FORCE_STANDARDS, PROMPT_STRUCTURAL_RULES, PROMPT_MUTATIONS, PROMPT_ARTIFACTS, PROMPT_POV, PROMPT_CONTINUITY, PROMPT_SUMMARY_REQUIREMENT, promptThreadLifecycle, buildThreadHealthPrompt, buildCompletedBeatsPrompt } from './prompts';
import { samplePacingSequence, buildSequencePrompt, buildSingleStepPrompt, detectCurrentMode, MATRIX_PRESETS, DEFAULT_TRANSITION_MATRIX, type PacingSequence, type ModeStep } from '@/lib/pacing-profile';
import { resolveProfile, resolveSampler, sampleBeatSequence } from '@/lib/beat-profiles';
import { FORMAT_INSTRUCTIONS } from './prose';
import { logWarning, logError, logInfo } from '@/lib/system-logger';
import { retryWithValidation, validateBeatPlan, validateBeatProseMap } from './validation';

/**
 * Split text into sentences, handling edge cases like abbreviations, decimals, and ellipsis.
 * More reliable than simple regex splitting.
 */
function splitIntoSentences(text: string): string[] {
  // Common abbreviations that shouldn't trigger sentence breaks
  const abbreviations = new Set([
    'Dr', 'Mr', 'Mrs', 'Ms', 'Prof', 'Sr', 'Jr',
    'Fig', 'Eq', 'Vol', 'No', 'Ch', 'Sec', 'vs',
    'etc', 'i.e', 'e.g', 'al', 'et'
  ]);

  const sentences: string[] = [];
  let currentSentence = '';
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    currentSentence += char;

    // Check for sentence-ending punctuation
    if (char === '.' || char === '!' || char === '?') {
      // Look ahead for additional punctuation or ellipsis
      let j = i + 1;
      while (j < text.length && (text[j] === '.' || text[j] === '!' || text[j] === '?')) {
        currentSentence += text[j];
        j++;
      }

      // Skip closing quotes/parentheses
      while (j < text.length && (text[j] === '"' || text[j] === "'" || text[j] === ')' || text[j] === ']')) {
        currentSentence += text[j];
        j++;
      }

      // Check if this is a sentence boundary
      let isSentenceBoundary = false;

      // If followed by whitespace + capital letter or end of text, likely a boundary
      if (j >= text.length) {
        isSentenceBoundary = true;
      } else if (j < text.length && /\s/.test(text[j])) {
        // Skip whitespace
        let k = j;
        while (k < text.length && /\s/.test(text[k])) {
          k++;
        }
        // Check if next non-whitespace is capital letter or quote + capital
        if (k < text.length) {
          const nextChar = text[k];
          const isCapital = /[A-Z]/.test(nextChar);
          const isQuoteBeforeCapital = (nextChar === '"' || nextChar === "'") && k + 1 < text.length && /[A-Z]/.test(text[k + 1]);

          if (isCapital || isQuoteBeforeCapital) {
            // Check for abbreviations and decimals
            const words = currentSentence.trim().split(/\s+/);
            const lastWord = words[words.length - 1];
            const wordWithoutPunct = lastWord.replace(/[.!?]+$/, '');

            // Check if it's a decimal number like "1.2"
            const isDecimal = /^\d+\.\d*$/.test(lastWord);
            if (isDecimal) {
              // Don't split on decimal numbers
            } else if (abbreviations.has(wordWithoutPunct)) {
              // It's an abbreviation, but check if it's truly the end of a sentence
              // by looking at the next word
              let nextWordStart = k;
              if (nextChar === '"' || nextChar === "'") {
                nextWordStart = k + 1;
              }
              // Extract the next word
              let nextWordEnd = nextWordStart;
              while (nextWordEnd < text.length && /[A-Za-z]/.test(text[nextWordEnd])) {
                nextWordEnd++;
              }
              const nextWord = text.substring(nextWordStart, nextWordEnd);

              // Common sentence starters that indicate a new sentence despite abbreviation
              const sentenceStarters = new Set([
                'The', 'A', 'An', 'He', 'She', 'It', 'They', 'We', 'I', 'You',
                'This', 'That', 'These', 'Those', 'His', 'Her', 'Their', 'My', 'Our',
                'But', 'And', 'Or', 'So', 'Yet', 'For', 'Nor', 'As', 'If', 'When',
                'Where', 'Why', 'How', 'What', 'Who', 'Which'
              ]);

              if (sentenceStarters.has(nextWord)) {
                isSentenceBoundary = true;
              }
            } else {
              // Not an abbreviation or decimal, so it's a sentence boundary
              isSentenceBoundary = true;
            }
          }
        }
      }

      if (isSentenceBoundary) {
        // Add whitespace that follows
        while (j < text.length && /\s/.test(text[j])) {
          currentSentence += text[j];
          j++;
        }
        sentences.push(currentSentence.trim());
        currentSentence = '';
        i = j - 1; // Will be incremented at end of loop
      } else {
        i = j - 1;
      }
    }

    i++;
  }

  // Add any remaining text
  if (currentSentence.trim()) {
    sentences.push(currentSentence.trim());
  }

  return sentences;
}

/** Parse raw proposition data into Proposition objects with free-form type labels */
function parsePropositions(rawProps: unknown[]): Proposition[] {
  return rawProps
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
    .map((p) => {
      const prop: Proposition = { content: String(p.content ?? '') };
      const rawType = typeof p.type === 'string' && p.type.trim() ? p.type.trim() : undefined;
      if (rawType) prop.type = rawType;
      return prop;
    })
    .filter((p) => p.content.length > 0);
}

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

  logInfo('Starting scene generation', {
    source: 'manual-generation',
    operation: 'generate-scenes',
    details: {
      narrativeId: narrative.id,
      arcId,
      sceneCount: count,
      existingArc: !!existingArc,
      hasPacingSequence: !!pacingSequence,
      hasWorldBuildFocus: !!worldBuildFocus,
    },
  });
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
        logWarning(`Scene generation attempt ${attempt + 1} failed, retrying`, err, {
          source: 'manual-generation',
          operation: 'generate-scenes',
          details: { attempt: attempt + 1, maxRetries: MAX_RETRIES }
        });
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

  logInfo('Completed scene generation', {
    source: 'manual-generation',
    operation: 'generate-scenes-complete',
    details: {
      narrativeId: narrative.id,
      arcId,
      arcName,
      scenesGenerated: scenes.length,
      threadsAdvanced: newDevelops.length,
      locationsUsed: newLocationIds.length,
      charactersUsed: newCharacterIds.length,
    },
  });

  // ── Generate embeddings for scene summaries ──────────────────────────────
  const { generateEmbeddingsBatch, computeCentroid } = await import('@/lib/embeddings');
  const { assetManager } = await import('@/lib/asset-manager');

  if (scenes.length > 0) {
    try {
      // Batch 1: Embed scene summaries
      const sceneSummaries = scenes.map(s => s.summary);
      const summaryEmbeddings = await generateEmbeddingsBatch(sceneSummaries, narrative.id);

      // Store embeddings in AssetManager and use references
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const embeddingId = await assetManager.storeEmbedding(summaryEmbeddings[i], 'text-embedding-3-small');
        scene.summaryEmbedding = embeddingId;

        // If scene has plan (in version array), compute plan centroid from beat centroids
        const latestPlan = scene.planVersions?.[scene.planVersions.length - 1]?.plan;
        if (latestPlan) {
          const allBeatCentroids = latestPlan.beats
            .map(b => b.embeddingCentroid)
            .filter((e): e is number[] => Array.isArray(e));
          if (allBeatCentroids.length > 0) {
            scene.planEmbeddingCentroid = computeCentroid(allBeatCentroids);
          }
        }
      }
    } catch (error) {
      // Log error but don't fail scene generation if embedding fails
      logError('Failed to generate embeddings for scenes', error, {
        source: 'manual-generation',
        operation: 'embed-summaries',
        details: { narrativeId: narrative.id, arcId, sceneCount: scenes.length },
      });
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
  logInfo('Starting beat plan generation', {
    source: 'plan-generation',
    operation: 'generate-plan',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      sceneSummary: scene.summary.substring(0, 60),
      hasGuidance: !!guidance,
    },
  });

  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const fullContext = narrativeContext(narrative, resolvedKeys, contextIndex);
  const logicRules = deriveLogicRules(narrative, scene, resolvedKeys, contextIndex);
  const logicBlock = logicRules ? `\n${logicRules}\n` : '';

  // Previous scene's beat plan for flow continuity
  const prevSceneKey = sceneIdx > 0 ? resolvedKeys[sceneIdx - 1] : null;
  const prevScene = prevSceneKey ? narrative.scenes[prevSceneKey] : null;
  const prevPlan = prevScene?.planVersions?.[prevScene.planVersions.length - 1]?.plan;

  const adjacentBlock = prevPlan
    ? `PREVIOUS SCENE ends with: ${prevPlan.beats.slice(-3).map((b) => `[${b.fn}:${b.mechanism}] ${b.what}`).join(', ')}`
    : '';

  // Prose profile context + optional Markov beat sequence
  const profile = resolveProfile(narrative);
  const sampler = resolveSampler(narrative);
  const storySettings: StorySettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };
  const scale = sceneScale(scene);
  const estWords = scale.estWords;
  // Clamp beatsPerKWord to standardized range (8-14)
  const bpkw = Math.min(BEAT_DENSITY_MAX, Math.max(BEAT_DENSITY_MIN, sampler.beatsPerKWord ?? BEAT_DENSITY_DEFAULT));
  const targetBeats = Math.max(8, Math.round(estWords * bpkw / 1000));
  onMeta?.({ targetBeats, estWords });

  // Sample a beat sequence from the Markov chain when enabled
  // Continue from previous scene's ending beat, or default to 'breathe'
  let beatSequenceHint = '';
  if (storySettings.useBeatChain !== false) {
    const prevEndingBeat = prevPlan?.beats?.at(-1)?.fn;
    const sampledBeats = sampleBeatSequence(sampler, targetBeats, prevEndingBeat);
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

The scene context includes a PROSE PROFILE with rules and anti-patterns. Propositions MUST conform to the profile's style. If the profile forbids figurative language, propositions must be plain factual statements. If the profile allows poetic language, propositions can be evocative. Read the profile rules carefully.

Return ONLY valid JSON matching this schema:
{
  "beats": [
    {
      "fn": "${BEAT_FN_LIST.join('|')}",
      "mechanism": "${BEAT_MECHANISM_LIST.join('|')}",
      "what": "STRUCTURAL SUMMARY: what happens, not how it reads",
      "propositions": [
        {"content": "atomic claim", "type": "state|claim|definition|formula|evidence|rule|comparison|example"}
      ]
    }
  ],
  "propositions": [{"content": "atomic claim", "type": "state"}]
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

MECHANISMS (8) — the mechanism determines how prose is written, not what happens:
  dialogue    — Characters SPEAKING to each other or aloud. Requires quoted speech ("...").
  thought     — POV character's INTERNAL monologue. Private reasoning, not spoken.
  action      — PHYSICAL movement, gesture, body in space. Visible and concrete.
  environment — Setting, weather, SOUNDS, spatial context. Sensory details of the world.
  narration   — Narrator's voice commenting. Rhetoric, time compression, exposition.
  memory      — Flashback triggered by association. Temporal shift to the past.
  document    — Embedded text shown literally. Letter, sign, newspaper excerpt.
  comic       — Humor, irony, absurdity. The beat must be funny.

MECHANISM EDGE CASES (important):
  - Overhearing sounds (children shouting, distant calls) = environment, NOT dialogue
  - POV character thinking to themselves = thought, NOT dialogue
  - Character muttering alone = thought (unless another character hears it)
  - Describing what someone said without quoting = narration, NOT dialogue
  - Environmental sounds with voices in them = environment (the setting includes sound)

RULES:
- Open with 1-3 breathe beats to ground the scene physically.
- Produce AT LEAST ${targetBeats} beats. This is the minimum bar — you are free to add more beats if the scene's content warrants it. Do not produce fewer than ${targetBeats}.
- Every structural mutation (thread, continuity, relationship, world knowledge) must map to at least one beat.
- Thread transitions need a concrete trigger in the 'what' field.
- Knowledge gains need a discovery mechanism (overheard, read, deduced, confessed).
- Relationship shifts need a catalytic moment.
- Be specific: "She asks about the missing shipment; he deflects" not "A tense exchange."
- STRUCTURAL SUMMARIES ONLY: The 'what' field describes WHAT HAPPENS, not how it reads as prose.
  • DO: "Guard confronts him about the forged papers" — structural event
  • DON'T: "He muttered, 'The academy won't hold me long'" — pre-written prose
  • DO: "Elders debate whether to proceed with the ceremony" — action summary
  • DON'T: "Her voice cut through the murmur of the crowd" — literary description
  Strip adjectives, adverbs, and literary embellishments. State the event, not its texture. The prose writer adds texture.
- MECHANISM CHOICE is binding: The mechanism determines HOW the prose writer MUST write each beat:
  • dialogue: Characters MUST speak in quotes. Choose for conversations, confrontations, verbal reveals.
  • thought: Internal monologue MUST appear. Choose for reasoning, planning, emotional processing, self-talk.
  • action: Physical movement MUST be described. Choose for fights, gestures, physical tasks.
  • environment: Setting details MUST ground the moment. Choose for scene establishment, atmosphere, ambient sounds.
  • narration: Authorial voice MUST comment. Choose for time compression, exposition, thematic statements.
  The prose writer cannot deviate — dialogue beats WILL contain quoted speech, thought beats WILL contain internal monologue.
  CRITICAL: If the beat describes overhearing sounds or ambient noise, use environment. If the beat describes the POV character's private reasoning, use thought. Only use dialogue when characters are actually speaking to be heard.

PROPOSITIONS:

Propositions are KEY FACTS established by this beat.

DENSITY GUIDELINES (per beat, ~100 words) — FOLLOW THESE STRICTLY:
- Light fiction (atmospheric, whimsical, children's lit): 1-2 propositions MAX
- Standard fiction (dialogue, action): 2-4 propositions
- Dense fiction (world-building, magic systems): 4-6 propositions
- Technical/academic prose: 8-15 propositions MAX (exhaustive but capped at 15)

FICTION EXTRACTION (Alice in Wonderland, Harry Potter, etc.):
Extract ONLY core narrative facts:
- Concrete events that happen ("Alice falls down the rabbit hole")
- Physical states ("The White Rabbit wears a waistcoat")
- Character beliefs/goals ("Alice wants to follow the rabbit")
- World rules ("The Cheshire Cat can disappear")

DO NOT extract from fiction:
- How something is described ("The rabbit hole was dark and deep" → NO)
- Atmospheric details ("mist clung to the village" → NO)
- Literary devices, metaphors, descriptions
- The texture of the prose itself

TECHNICAL/ACADEMIC PROSE EXTRACTION:
The goal is EXHAUSTIVE extraction, capped at 15 propositions per beat. Capture:
- EVERY formula, equation, or mathematical expression (exactly as written)
- EVERY numerical value, statistic, score, or parameter
- EVERY definition of a term or concept
- EVERY comparison or contrast made
- EVERY piece of evidence or cited example
- EVERY named entity, method, or system mentioned
- EVERY cause-effect relationship stated
- EVERY constraint, rule, or requirement
- EVERY claim about what something does, is, or means

If a beat has more than 15 atomic facts, prioritize the most important ones.

DO NOT summarize multiple claims into one. Each atomic fact gets its own proposition.

Include "type" — any descriptive label. Common types:
- Fiction: state, belief, relationship, event, rule, secret, motivation
- Non-fiction: claim, definition, formula, evidence, parameter, mechanism, comparison, method, constraint, example

FICTION:
• {"content": "Alice falls down a rabbit hole", "type": "event"}
• {"content": "The White Rabbit wears a waistcoat", "type": "state"}
• {"content": "The Cheshire Cat can disappear", "type": "rule"}

NON-FICTION (exhaustive example):
• {"content": "P = Σt max(0, φto − φfrom)", "type": "formula"}
• {"content": "P represents Payoff", "type": "definition"}
• {"content": "Payoff quantifies irreversible narrative commitments", "type": "definition"}
• {"content": "dormant=0, active=1, escalating=2, critical=3", "type": "definition"}
• {"content": "Published works score 85-95", "type": "evidence"}
• {"content": "AI-generated narratives score 65-78", "type": "evidence"}
• {"content": "Threads without transition receive pulse of 0.25", "type": "parameter"}

INVALID: craft goals, pacing instructions, meta-commentary.

- PROPOSITIONS (scene-level): claims spanning the whole scene.
- Return ONLY valid JSON.`
  + (() => {
    const parts = [narrative.storySettings?.planGuidance?.trim(), guidance?.trim()].filter(Boolean);
    return parts.length > 0 ? `\n\nPLAN GUIDANCE:\n${parts.join('\n')}` : '';
  })();

  const sceneDesc = `SCENE AT BRANCH HEAD:
Summary: ${scene.summary}
Location: ${narrative.locations[scene.locationId]?.name ?? scene.locationId}
POV: ${narrative.characters[scene.povId]?.name ?? scene.povId}
Participants: ${scene.participantIds.map(id => narrative.characters[id]?.name ?? id).join(', ')}`;

  const prompt = `${profileBlock}NARRATIVE CONTEXT:\n${fullContext}
${adjacentBlock ? `${adjacentBlock}\n\n` : ''}
${sceneDesc}
${logicBlock}
Generate a structured beat plan for the scene at the branch head.

REMINDER: All propositions (per-beat and scene-level) MUST conform to the PROSE PROFILE above. If the profile forbids figurative language, write plain factual propositions only.`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = onReasoning
    ? await callGenerateStream(prompt, systemPrompt, () => {}, MAX_TOKENS_SMALL, 'generateScenePlan', GENERATE_MODEL, reasoningBudget, onReasoning)
    : await callGenerate(prompt, systemPrompt, MAX_TOKENS_SMALL, 'generateScenePlan', GENERATE_MODEL, reasoningBudget);

  const parsed = parseJson(raw, 'generateScenePlan') as { beats?: unknown[]; propositions?: unknown[] };
  const beats = (parsed.beats ?? []).map((b: unknown) => {
    const beat = b as Record<string, unknown>;
    const rawProps = Array.isArray(beat.propositions) ? beat.propositions : [];
    return {
      fn: ((BEAT_FN_LIST as readonly string[]).includes(String(beat.fn)) ? beat.fn : 'advance') as BeatPlan['beats'][0]['fn'],
      mechanism: ((BEAT_MECHANISM_LIST as readonly string[]).includes(String(beat.mechanism)) ? beat.mechanism : 'action') as BeatPlan['beats'][0]['mechanism'],
      what: String(beat.what ?? ''),
      propositions: parsePropositions(rawProps),
      embeddingCentroid: undefined as number[] | undefined,
    };
  });

  const rawSceneProps = Array.isArray(parsed.propositions) ? parsed.propositions : [];
  const scenePropositions = parsePropositions(rawSceneProps);

  const result = {
    beats,
    propositions: scenePropositions.length > 0 ? scenePropositions : undefined,
  };

  // ── Generate embeddings for all propositions ─────────────────────────────
  const { embedPropositions, computeCentroid } = await import('@/lib/embeddings');

  // Collect all propositions from beats and scene-level
  const allPropositions: Array<{ content: string; type?: string }> = [];
  if (result.propositions) {
    allPropositions.push(...result.propositions);
  }
  result.beats.forEach(beat => {
    allPropositions.push(...beat.propositions);
  });

  // Embed all propositions in batch
  if (allPropositions.length > 0) {
    try {
      const embeddedProps = await embedPropositions(allPropositions, narrative.id);

      // Map embeddings back to plan
      let embeddedIndex = 0;
      if (result.propositions) {
        for (let i = 0; i < result.propositions.length; i++) {
          result.propositions[i] = embeddedProps[embeddedIndex++];
        }
      }

      for (const beat of result.beats) {
        for (let i = 0; i < beat.propositions.length; i++) {
          beat.propositions[i] = embeddedProps[embeddedIndex++];
        }

        // Compute beat centroid from proposition embeddings (resolve references if needed)
        const { resolveEmbedding } = await import('@/lib/embeddings');
        const beatEmbeddingPromises = beat.propositions
          .map(p => resolveEmbedding(p.embedding));
        const beatEmbeddings = (await Promise.all(beatEmbeddingPromises))
          .filter((e): e is number[] => e !== null && Array.isArray(e));
        if (beatEmbeddings.length > 0) {
          beat.embeddingCentroid = computeCentroid(beatEmbeddings);
        }
      }
    } catch (error) {
      // Log error but don't fail plan generation if embedding fails
      logError('Failed to generate embeddings for plan', error, {
        source: 'plan-generation',
        operation: 'embed-propositions',
        details: { narrativeId: narrative.id, sceneId: scene.id },
      });
    }
  }

  logInfo('Completed beat plan generation', {
    source: 'plan-generation',
    operation: 'generate-plan-complete',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      beatsGenerated: beats.length,
      totalPropositions: beats.reduce((sum, b) => sum + b.propositions.length, 0),
      scenePropositions: scenePropositions.length,
    },
  });

  return result;
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
  /** Resolved plan for versioned scenes (required - pass from resolvePlanForBranch) */
  currentPlan?: BeatPlan,
): Promise<BeatPlan> {
  const plan = currentPlan;
  if (!plan) throw new Error('Scene has no plan to edit - pass resolved plan from resolvePlanForBranch');

  logInfo('Starting scene plan edit', {
    source: 'plan-generation',
    operation: 'edit-plan',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      issuesCount: issues.length,
      currentBeats: plan.beats.length,
    },
  });

  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const fullContext = narrativeContext(narrative, resolvedKeys, contextIndex);

  const currentPlanJson = JSON.stringify({
    beats: plan.beats.map((b, i) => ({ idx: i + 1, fn: b.fn, mechanism: b.mechanism, what: b.what, propositions: b.propositions })),
    propositions: plan.propositions,
  }, null, 2);

  const issueBlock = issues.map((iss, i) => `${i + 1}. ${iss}`).join('\n');

  const sceneDesc = `Scene: ${scene.summary}`;

  const prompt = `NARRATIVE CONTEXT:\n${fullContext}

SCENE AT BRANCH HEAD:
${sceneDesc}

CURRENT BEAT PLAN:
${currentPlanJson}

ISSUES TO FIX:
${issueBlock}

Edit the beat plan to address every issue above. You may:
- Modify a beat's fn, mechanism, what, or propositions
- Add new beats (to fill gaps or add missing setups)
- Remove beats (if redundant or contradictory)
- Reorder beats (if sequencing is wrong)

CRITICAL: The 'what' field must be a STRUCTURAL SUMMARY of what happens, NOT pre-written prose.
- DO: "Guard confronts him about the forged papers" — structural event
- DON'T: "He muttered, 'The academy won't hold me long'" — pre-written prose with quotes
- DO: "Mist covers the village" — simple fact
- DON'T: "Mist clung, blurring the distinction..." — literary prose
Strip adjectives, adverbs, literary embellishments. State the event, not its texture.

Keep beats that have NO issues exactly as they are — do not rewrite beats that are working.
Return the COMPLETE plan (all beats, not just changed ones) as JSON:
{
  "beats": [
    { "fn": "${BEAT_FN_LIST.join('|')}", "mechanism": "${BEAT_MECHANISM_LIST.join('|')}", "what": "...", "propositions": [{"content": "..."}] }
  ],
  "propositions": [{"content": "..."}]
}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_SMALL, 'editScenePlan', GENERATE_MODEL, reasoningBudget);

  const parsed = parseJson(raw, 'editScenePlan') as { beats?: unknown[]; propositions?: unknown[] };
  const beats = (parsed.beats ?? []).map((b: unknown) => {
    const beat = b as Record<string, unknown>;
    const rawProps = Array.isArray(beat.propositions) ? beat.propositions : [];
    return {
      fn: ((BEAT_FN_LIST as readonly string[]).includes(String(beat.fn)) ? beat.fn : 'advance') as BeatPlan['beats'][0]['fn'],
      mechanism: ((BEAT_MECHANISM_LIST as readonly string[]).includes(String(beat.mechanism)) ? beat.mechanism : 'action') as BeatPlan['beats'][0]['mechanism'],
      what: String(beat.what ?? ''),
      propositions: parsePropositions(rawProps),
    };
  });

  const rawSceneProps = Array.isArray(parsed.propositions) ? parsed.propositions : [];
  const scenePropositions = parsePropositions(rawSceneProps);

  logInfo('Completed scene plan edit', {
    source: 'plan-generation',
    operation: 'edit-plan-complete',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      beatsReturned: beats.length,
      hasPropositions: scenePropositions.length > 0,
    },
  });

  return {
    beats,
    propositions: scenePropositions.length > 0 ? scenePropositions : undefined,
  };
}

/**
 * Reverse-engineer a beat plan from existing prose.
 * Used for analysis — extracts structural beats with propositions.
 * Focused on exhaustive proposition extraction; paragraph mapping is done separately.
 *
 * Returns the plan with beats and propositions.
 */
/**
 * Split prose into evenly-sized chunks by sentence/paragraph boundaries.
 * Ensures consistent granularity for beat extraction.
 */
function splitProseEvenly(prose: string, targetChunks: number): string[] {
  // First try natural paragraph splits
  const paragraphs = prose.split(/\n\s*\n/).filter(p => p.trim());

  // If we have enough paragraphs, distribute them evenly
  if (paragraphs.length >= targetChunks) {
    const chunks: string[] = [];
    const parasPerChunk = paragraphs.length / targetChunks;

    for (let i = 0; i < targetChunks; i++) {
      const start = Math.floor(i * parasPerChunk);
      const end = i === targetChunks - 1 ? paragraphs.length : Math.floor((i + 1) * parasPerChunk);
      chunks.push(paragraphs.slice(start, end).join('\n\n'));
    }

    return chunks;
  }

  // Not enough paragraphs - split by sentences using proper tokenization
  const sentences = splitIntoSentences(prose).filter(s => s.trim());
  if (sentences.length >= targetChunks) {
    const chunks: string[] = [];
    const sentencesPerChunk = sentences.length / targetChunks;

    for (let i = 0; i < targetChunks; i++) {
      const start = Math.floor(i * sentencesPerChunk);
      const end = i === targetChunks - 1 ? sentences.length : Math.floor((i + 1) * sentencesPerChunk);
      chunks.push(sentences.slice(start, end).join(' '));
    }

    return chunks;
  }

  // Very short prose - split by words
  const words = prose.split(/\s+/).filter(w => w.trim());
  const chunks: string[] = [];
  const wordsPerChunk = Math.ceil(words.length / targetChunks);

  for (let i = 0; i < targetChunks; i++) {
    const start = i * wordsPerChunk;
    const end = Math.min((i + 1) * wordsPerChunk, words.length);
    if (start < words.length) {
      chunks.push(words.slice(start, end).join(' '));
    }
  }

  return chunks.length > 0 ? chunks : [prose];
}

export async function reverseEngineerScenePlan(
  prose: string,
  summary: string,
  onToken?: (token: string, accumulated: string) => void,
): Promise<{ plan: BeatPlan; beatProseMap: BeatProseMap | null }> {
  // Wrap with retry logic and validation
  return retryWithValidation(
    async () => {
      const result = await reverseEngineerScenePlanOnce(prose, summary, onToken);

      // Validate beat plan structure
      const planValidation = validateBeatPlan({ beats: result.plan.beats });
      if (!planValidation.valid) {
        throw new Error(`Beat plan validation failed:\n${planValidation.errors.join('\n')}`);
      }

      // Validate prose map if present
      if (result.beatProseMap) {
        const mapValidation = validateBeatProseMap(result.beatProseMap, result.plan, prose);
        if (!mapValidation.valid) {
          // Fail on prose map validation to trigger retry - this ensures side-by-side view works
          throw new Error(`Beat prose map validation failed:\n${mapValidation.errors.join('\n')}`);
        }
      } else {
        // No prose map generated - this is a problem for side-by-side views
        throw new Error('No beat prose map generated - side-by-side view requires valid mapping');
      }

      return result;
    },
    () => ({ valid: true, errors: [] }), // Validation already done inside
    'reverseEngineerScenePlan',
    3,
    'analysis' // source context for logging
  );
}

/**
 * Single attempt at extracting a beat plan from prose (internal, for retry logic)
 */
async function reverseEngineerScenePlanOnce(
  prose: string,
  summary: string,
  onToken?: (token: string, accumulated: string) => void,
): Promise<{ plan: BeatPlan; beatProseMap: BeatProseMap | null }> {
  const systemPrompt = `You are a beat analyst. Given numbered prose paragraphs, identify the structural beat sequence — what each beat does, how it's delivered, which paragraphs it spans, and the propositions it establishes.

Return ONLY valid JSON matching this schema:
{
  "beats": [
    {
      "fn": "${BEAT_FN_LIST.join('|')}",
      "mechanism": "${BEAT_MECHANISM_LIST.join('|')}",
      "what": "STRUCTURAL SUMMARY: what happens, not how it reads",
      "startPara": 0,
      "endPara": 2,
      "propositions": [
        {"content": "atomic claim", "type": "state|claim|definition|formula|evidence|rule|comparison|example"}
      ]
    }
  ]
}

CRITICAL INDEXING RULES:
- Chunks use 0-based indexing: [0], [1], [2], ..., [N-1] where N is total chunk count
- Every beat MUST include startPara and endPara (both inclusive, 0-based indices)
- Beat ranges must be sequential with NO GAPS: if beat N ends at X, beat N+1 MUST start at X+1
- First beat MUST start at startPara: 0
- Last beat MUST end at endPara: N-1 (the last valid chunk index)
- All N chunks must be covered exactly once
- DO NOT use chunk indices >= N (out of bounds)
- Group chunks naturally (typically 1-3 chunks per beat) to stay within word count range

EXAMPLE (20 chunks of ~45 words each, grouped into ~10 beats of ~90 words):
✓ CORRECT: [
  {"startPara": 0, "endPara": 1, "fn": "breathe", ...},  // 2 chunks = ~90 words
  {"startPara": 2, "endPara": 2, "fn": "inform", ...},   // 1 chunk = ~45 words (acceptable for brief moment)
  {"startPara": 3, "endPara": 5, "fn": "advance", ...},  // 3 chunks = ~135 words (acceptable for complex action)
  {"startPara": 6, "endPara": 7, "fn": "turn", ...},     // 2 chunks = ~90 words
  ...
  {"startPara": 18, "endPara": 19, "fn": "resolve", ...} // Must end at last chunk (19)
]
✗ WRONG: endPara: 20 is out of bounds (max valid index is 19)
✗ WRONG: gap between beats (beat ends at 5, next starts at 7)
✗ WRONG: {"startPara": 0, "endPara": 9} - 10 chunks = ~450 words (way too large)

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

MECHANISMS (8) — the mechanism determines how prose is written, not what happens:
  dialogue    — Characters SPEAKING to each other or aloud. Requires quoted speech ("...").
  thought     — POV character's INTERNAL monologue. Private reasoning, not spoken.
  action      — PHYSICAL movement, gesture, body in space. Visible and concrete.
  environment — Setting, weather, SOUNDS, spatial context. Sensory details of the world.
  narration   — Narrator's voice commenting. Rhetoric, time compression, exposition.
  memory      — Flashback triggered by association. Temporal shift to the past.
  document    — Embedded text shown literally. Letter, sign, newspaper excerpt.
  comic       — Humor, irony, absurdity. The beat must be funny.

MECHANISM EDGE CASES (important):
  - Overhearing sounds (children shouting, distant calls) = environment, NOT dialogue
  - POV character thinking to themselves = thought, NOT dialogue
  - Character muttering alone = thought (unless another character hears it)
  - Describing what someone said without quoting = narration, NOT dialogue
  - Environmental sounds with voices in them = environment (the setting includes sound)

RULES:
- Identify one beat per meaningful unit of action, dialogue, or shift. Target ~${BEAT_DENSITY_MIN}-${BEAT_DENSITY_MAX} beats per 1000 words.
- Every beat must map to a specific moment in the prose.
- STRUCTURAL SUMMARIES ONLY: The 'what' field describes WHAT HAPPENS, not how it reads as prose.
  • DO: "Guard confronts him about the forged papers" — structural event
  • DON'T: "He muttered, 'The academy won't hold me long'" — pre-written prose
  • DO: "Elders debate whether to proceed with the ceremony" — action summary
  • DON'T: "Her voice cut through the murmur of the crowd" — literary description
  • DO: "Mist covers the village at dawn" — simple fact
  • DON'T: "Mist clung to the village, blurring the distinction between homes and mountain" — literary prose
  Strip adjectives, adverbs, and literary embellishments. State the event, not its texture.
- MECHANISM CHOICE must match how the prose was actually written:
  • dialogue: Prose contains quoted speech — characters speaking to be heard.
  • thought: Prose contains internal monologue — POV character's private reasoning.
  • action: Prose describes physical movement, gesture, body in space.
  • environment: Prose describes setting, weather, sounds, sensory context.
  • narration: Prose has authorial voice, time compression, exposition.
  CRITICAL: If the prose shows overhearing sounds or ambient noise, use environment. If the prose shows the POV character's private reasoning, use thought. Only use dialogue when characters are actually speaking to be heard.

PROPOSITIONS:

Propositions are KEY FACTS established by this beat.

DENSITY GUIDELINES (per beat, ~100 words) — FOLLOW THESE STRICTLY:
- Light fiction (atmospheric, whimsical, children's lit): 1-2 propositions MAX
- Standard fiction (dialogue, action): 2-4 propositions
- Dense fiction (world-building, magic systems): 4-6 propositions
- Technical/academic prose: 8-15 propositions MAX (exhaustive but capped at 15)

FICTION EXTRACTION (Alice in Wonderland, Harry Potter, etc.):
Extract ONLY core narrative facts:
- Concrete events that happen ("Alice falls down the rabbit hole")
- Physical states ("The White Rabbit wears a waistcoat")
- Character beliefs/goals ("Alice wants to follow the rabbit")
- World rules ("The Cheshire Cat can disappear")

DO NOT extract from fiction:
- How something is described ("The rabbit hole was dark and deep" → NO)
- Atmospheric details ("mist clung to the village" → NO)
- Literary devices, metaphors, descriptions
- The texture of the prose itself

TECHNICAL/ACADEMIC PROSE EXTRACTION:
The goal is EXHAUSTIVE extraction, capped at 15 propositions per beat. Capture:
- EVERY formula, equation, or mathematical expression (exactly as written)
- EVERY numerical value, statistic, score, or parameter
- EVERY definition of a term or concept
- EVERY comparison or contrast made
- EVERY piece of evidence or cited example
- EVERY named entity, method, or system mentioned
- EVERY cause-effect relationship stated
- EVERY constraint, rule, or requirement
- EVERY claim about what something does, is, or means

If a beat has more than 15 atomic facts, prioritize the most important ones.

If the prose says "Published works score 85–95, while unguided AI output achieves 65–78", you need:
• {"content": "Published works score 85-95", "type": "evidence"}
• {"content": "Unguided AI output scores 65-78", "type": "evidence"}
• {"content": "There is a score gap between published works and AI output", "type": "claim"}

If the prose mentions "three fundamental forces (Payoff, Change, Knowledge)", you need:
• {"content": "There are three fundamental forces", "type": "claim"}
• {"content": "The three forces are Payoff, Change, and Knowledge", "type": "definition"}

DO NOT summarize multiple claims into one. Each atomic fact gets its own proposition.

Include "type" — any descriptive label. Common types:
- Fiction: state, belief, relationship, event, rule, secret, motivation
- Non-fiction: claim, definition, formula, evidence, parameter, mechanism, comparison, method, constraint, example

FICTION:
• {"content": "Alice falls down a rabbit hole", "type": "event"}
• {"content": "The White Rabbit wears a waistcoat", "type": "state"}
• {"content": "The Cheshire Cat can disappear", "type": "rule"}

NON-FICTION (exhaustive example from a technical paper):
• {"content": "P = Σt max(0, φto − φfrom)", "type": "formula"}
• {"content": "P represents Payoff", "type": "definition"}
• {"content": "Payoff quantifies irreversible narrative commitments", "type": "definition"}
• {"content": "dormant=0, active=1, escalating=2, critical=3, resolved/subverted/abandoned=4", "type": "definition"}
• {"content": "A thread transitioning from active to critical contributes |3-1|=2 to Payoff", "type": "example"}
• {"content": "Published works score 85-95", "type": "evidence"}
• {"content": "AI-generated narratives score 65-78", "type": "evidence"}
• {"content": "Threads without transition receive pulse of 0.25", "type": "parameter"}
• {"content": "The pulse is sufficient for visibility without inflating the metric", "type": "claim"}
• {"content": "C = √ΔM + √ΔE + √ΔR", "type": "formula"}
• {"content": "ΔM counts continuity mutations", "type": "definition"}
• {"content": "ΔE counts events", "type": "definition"}
• {"content": "ΔR = Σ|Δv|² sums squared valence shifts (L2)", "type": "formula"}
• {"content": "Square roots give diminishing returns", "type": "mechanism"}
• {"content": "Diminishing returns prevent any single axis from dominating", "type": "claim"}

INVALID: craft goals, pacing instructions, meta-commentary.

- Return ONLY valid JSON.`;

  // Estimate target beats based on word count and beat density constants
  const wordCount = prose.split(/\s+/).length;
  const estimatedBeats = Math.max(Math.round(wordCount / WORDS_PER_BEAT_DEFAULT), 3);

  // Split prose into fine-grained chunks (2x beats) so LLM can group naturally
  const targetChunks = estimatedBeats * 2;
  const paragraphs = splitProseEvenly(prose, targetChunks);
  const numberedProse = paragraphs.map((p, i) => `[${i}] ${p}`).join('\n\n');

  const lastIndex = paragraphs.length - 1;
  const prompt = `SCENE SUMMARY: ${summary}

NUMBERED PROSE (${paragraphs.length} chunks, indices [0-${lastIndex}]):
${numberedProse}

TASK:
Group these chunks into beats by identifying natural narrative boundaries. Each beat should span consecutive chunks.

Extract propositions according to density guidelines - light fiction gets 1-2 props/beat, technical prose gets exhaustive extraction.

CRITICAL CONSTRAINTS - BEAT SIZE:
- Target beat size: ${WORDS_PER_BEAT_DEFAULT} words (acceptable range: ${WORDS_PER_BEAT_MIN}-${WORDS_PER_BEAT_MAX} words)
- Each beat should typically span 1-3 consecutive chunks to stay within this range
- Beats outside ${WORDS_PER_BEAT_MIN}-${WORDS_PER_BEAT_MAX} words are acceptable ONLY if required for natural narrative boundaries
- Aim for approximately ${estimatedBeats} total beats

CRITICAL CONSTRAINTS - INDEXING:
- Valid paragraph indices: 0 to ${lastIndex} (inclusive)
- Beat ranges must be sequential with NO GAPS: if beat N ends at X, beat N+1 MUST start at X+1
- First beat MUST start at paragraph 0
- Final beat MUST end at paragraph ${lastIndex}
- All ${paragraphs.length} paragraphs must be covered exactly once
- DO NOT use paragraph indices >= ${paragraphs.length} (out of bounds)`;

  let accumulated = '';
  const raw = onToken
    ? await callGenerateStream(prompt, systemPrompt, (token) => { accumulated += token; onToken(token, accumulated); }, MAX_TOKENS_SMALL, 'reverseEngineerScenePlan', GENERATE_MODEL, undefined, undefined, ANALYSIS_TEMPERATURE)
    : await callGenerate(prompt, systemPrompt, MAX_TOKENS_SMALL, 'reverseEngineerScenePlan', GENERATE_MODEL, undefined, true, ANALYSIS_TEMPERATURE);

  type BeatData = { fn: string; mechanism: string; what: string; propositions: unknown[]; startPara?: number; endPara?: number };
  const parsed = parseJson(raw, 'reverseEngineerScenePlan') as { beats?: unknown[] };

  const beats: Beat[] = (parsed.beats ?? []).map((b: unknown) => {
    const beatData = b as BeatData;
    const rawProps = Array.isArray(beatData.propositions) ? beatData.propositions : [];
    return {
      fn: ((BEAT_FN_LIST as readonly string[]).includes(String(beatData.fn)) ? beatData.fn : 'advance') as Beat['fn'],
      mechanism: ((BEAT_MECHANISM_LIST as readonly string[]).includes(String(beatData.mechanism)) ? beatData.mechanism : 'action') as Beat['mechanism'],
      what: String(beatData.what ?? ''),
      propositions: parsePropositions(rawProps),
    };
  });

  const plan: BeatPlan = { beats };

  // Build BeatProseMap from LLM-provided ranges
  const beatsWithRanges = (parsed.beats ?? []).map((b: unknown, i: number) => ({
    beat: beats[i],
    startPara: (b as BeatData).startPara,
    endPara: (b as BeatData).endPara,
  }));

  const beatProseMap = buildBeatProseMap(paragraphs, beatsWithRanges);

  return { plan, beatProseMap };
}

function buildBeatProseMap(
  paragraphs: string[],
  beatsWithRanges: Array<{ beat: Beat; startPara?: number; endPara?: number }>
): BeatProseMap | null {
  if (paragraphs.length === 0 || beatsWithRanges.length === 0) return null;

  // Validate and build from LLM ranges - no heuristic fallback
  const chunks = tryBuildFromRanges(paragraphs, beatsWithRanges);
  if (chunks) {
    return { chunks, createdAt: Date.now() };
  }

  // Invalid ranges - return null so caller can retry
  logWarning('Beat-prose mapping failed: invalid ranges', 'LLM provided invalid paragraph ranges', {
    source: 'prose-generation',
    operation: 'beat-prose-mapping'
  });
  return null;
}

/**
 * Attempt to build chunks from LLM-provided paragraph ranges.
 * Validates ranges are sequential, non-overlapping, and cover full prose.
 * Stores prose strings directly.
 */
function tryBuildFromRanges(
  paragraphs: string[],
  beatsWithRanges: Array<{ beat: Beat; startPara?: number; endPara?: number }>
): BeatProse[] | null {
  const chunks: BeatProse[] = [];
  let lastEndPara = -1;

  for (let i = 0; i < beatsWithRanges.length; i++) {
    const { startPara, endPara } = beatsWithRanges[i];

    // Check if ranges exist
    if (typeof startPara !== 'number' || typeof endPara !== 'number') {
      logWarning(
        'Beat extraction validation failed: missing paragraph range',
        `Beat ${i} has undefined startPara or endPara`,
        {
          source: 'analysis',
          operation: 'beat-range-validation',
          details: { beatIndex: i, startPara, endPara, totalBeats: beatsWithRanges.length },
        }
      );
      return null;
    }

    // Validate sequential (no gaps or overlaps)
    if (startPara !== lastEndPara + 1) {
      logWarning(
        'Beat extraction validation failed: non-sequential ranges',
        `Beat ${i} range [${startPara}, ${endPara}] not sequential (last ended at ${lastEndPara})`,
        {
          source: 'analysis',
          operation: 'beat-range-validation',
          details: { beatIndex: i, startPara, endPara, lastEndPara, totalBeats: beatsWithRanges.length },
        }
      );
      return null;
    }

    // Validate bounds
    if (startPara < 0 || endPara >= paragraphs.length || startPara > endPara) {
      logWarning(
        'Beat extraction validation failed: out of bounds range',
        `Beat ${i} has invalid range [${startPara}, ${endPara}] (paragraphs: ${paragraphs.length})`,
        {
          source: 'analysis',
          operation: 'beat-range-validation',
          details: { beatIndex: i, startPara, endPara, paragraphCount: paragraphs.length, totalBeats: beatsWithRanges.length },
        }
      );
      return null;
    }

    // Validate non-empty content
    const proseChunk = paragraphs.slice(startPara, endPara + 1).join('\n\n').trim();
    if (!proseChunk) {
      logWarning(
        'Beat extraction validation failed: empty prose chunk',
        `Beat ${i} has no content after joining paragraphs [${startPara}, ${endPara}]`,
        {
          source: 'analysis',
          operation: 'beat-range-validation',
          details: { beatIndex: i, startPara, endPara, totalBeats: beatsWithRanges.length },
        }
      );
      return null;
    }

    // Validate beat size (only warn if TREMENDOUSLY out of range)
    const wordCount = proseChunk.split(/\s+/).length;
    const EXTREMELY_SHORT = 20; // Probably an error
    const EXTREMELY_LONG = 500; // Probably an error
    if (wordCount < EXTREMELY_SHORT || wordCount > EXTREMELY_LONG) {
      logWarning(
        `Beat ${i} size tremendously out of range`,
        `Beat has ${wordCount} words (expected roughly 50-200 for most beats)`,
        {
          source: 'analysis',
          operation: 'beat-size-validation',
          details: {
            beatIndex: i,
            wordCount,
            startPara,
            endPara,
          },
        }
      );
    }

    // Store prose directly
    chunks.push({ beatIndex: i, prose: proseChunk });
    lastEndPara = endPara;
  }

  // Verify full coverage (all paragraphs assigned)
  if (lastEndPara !== paragraphs.length - 1) {
    logWarning(
      'Beat extraction validation failed: incomplete coverage',
      `Beats only cover paragraphs 0-${lastEndPara}, but prose has ${paragraphs.length} paragraphs`,
      {
        source: 'analysis',
        operation: 'beat-range-validation',
        details: { lastEndPara, paragraphCount: paragraphs.length, totalBeats: beatsWithRanges.length },
      }
    );
    return null;
  }

  // Detect duplicate prose chunks (critical: prevents alignment errors)
  const proseSet = new Set<string>();
  for (let i = 0; i < chunks.length; i++) {
    if (proseSet.has(chunks[i].prose)) {
      logWarning(
        'Beat extraction validation failed: duplicate prose detected',
        `Beat ${i} has identical prose to a previous beat`,
        {
          source: 'analysis',
          operation: 'beat-range-validation',
          details: { beatIndex: i, totalBeats: chunks.length, prosePreview: chunks[i].prose.substring(0, 100) },
        }
      );
      return null;
    }
    proseSet.add(chunks[i].prose);
  }

  return chunks;
}

/**
 * Fallback: segment prose by word count distribution.
 * If not enough paragraphs, splits them into finer chunks to avoid duplicates.
 * Stores prose strings directly.
 */

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
  onReasoning?: (token: string) => void,
): Promise<BeatPlan> {
  logInfo('Starting scene plan rewrite', {
    source: 'plan-generation',
    operation: 'rewrite-plan',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      currentBeats: currentPlan.beats.length,
      analysisLength: analysis.length,
    },
  });

  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const fullContext = narrativeContext(narrative, resolvedKeys, contextIndex);

  const currentPlanText = currentPlan.beats.map((b, i) =>
    `${i + 1}. [${b.fn}:${b.mechanism}] ${b.what}\n   Propositions: ${b.propositions.map(p => `"${p.content}"`).join('; ')}`
  ).join('\n');
  const currentProps = currentPlan.propositions && currentPlan.propositions.length > 0
    ? `\nScene Propositions: ${currentPlan.propositions.map((p) => `"${p.content}"`).join(', ')}`
    : '';

  const systemPrompt = `You are a dramaturg making TARGETED REVISIONS to a scene plan for "${narrative.title}". This is NOT a regeneration — preserve the existing structure and only modify what the feedback specifically addresses.

Return ONLY valid JSON: { "beats": [{ "fn": "...", "mechanism": "...", "what": "...", "propositions": [{"content": "...", "type": "..."}] }], "propositions": [{"content": "...", "type": "..."}] }

Beat functions: ${BEAT_FN_LIST.join(', ')}
Mechanisms: ${BEAT_MECHANISM_LIST.join(', ')}

REWRITE RULES — STRUCTURE PRESERVATION:
1. KEEP the same number of beats unless feedback explicitly requests adding/removing beats
2. KEEP unchanged beats EXACTLY as they are (same fn, mechanism, what, propositions)
3. ONLY MODIFY beats that the feedback specifically targets
4. Preserve the overall scene arc and flow

PROPOSITIONS — KEY FACTS established by each beat:
Propositions are atomic claims that capture what the reader learns. When you modify a beat's 'what' field, update its propositions to match.

Density per beat: 2-4 propositions for standard fiction
Types: state, belief, relationship, event, rule, secret, motivation, claim, discovery

Extract ONLY: concrete events, physical states, character beliefs/goals/discoveries, world rules, relationship shifts
DO NOT include: atmospheric texture, literary devices, how things are described`;

  const sceneDesc = `Scene at branch head: ${scene.summary}`;

  const prompt = `NARRATIVE CONTEXT:\n${fullContext}

SCENE AT BRANCH HEAD:
${sceneDesc}

CURRENT PLAN:
${currentPlanText}${currentProps}

TARGETED FEEDBACK:
${analysis}

Make TARGETED REVISIONS based on the feedback above. This is a surgical edit, not a regeneration.

CRITICAL — PRESERVE STRUCTURE:
1. Return ALL ${currentPlan.beats.length} beats — do not add or remove unless feedback explicitly requests it
2. For beats NOT mentioned in feedback: copy them EXACTLY (same fn, mechanism, what, propositions)
3. For beats mentioned in feedback: apply the specific changes requested
4. Maintain the scene's narrative arc and flow

WHEN MODIFYING A BEAT:
- The 'what' field must be a STRUCTURAL SUMMARY, not prose (no quotes, no literary language)
- Update propositions to match the new content (2-4 per beat, with types: state, event, rule, discovery, etc.)
- Keep fn and mechanism unless the feedback specifically asks for a change

Scene-level "propositions" should capture the overall takeaways from the scene.`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = onReasoning
    ? await callGenerateStream(prompt, systemPrompt, () => {}, MAX_TOKENS_SMALL, 'rewriteScenePlan', GENERATE_MODEL, reasoningBudget, onReasoning)
    : await callGenerate(prompt, systemPrompt, MAX_TOKENS_SMALL, 'rewriteScenePlan', GENERATE_MODEL, reasoningBudget);
  const parsed = parseJson(raw, 'rewriteScenePlan') as { beats?: unknown[]; propositions?: unknown[] };

  const beats = (parsed.beats ?? []).map((b: unknown) => {
    const beat = b as Record<string, unknown>;
    const rawProps = Array.isArray(beat.propositions) ? beat.propositions : [];
    return {
      fn: ((BEAT_FN_LIST as readonly string[]).includes(String(beat.fn)) ? beat.fn : 'advance') as BeatPlan['beats'][0]['fn'],
      mechanism: ((BEAT_MECHANISM_LIST as readonly string[]).includes(String(beat.mechanism)) ? beat.mechanism : 'action') as BeatPlan['beats'][0]['mechanism'],
      what: String(beat.what ?? ''),
      propositions: parsePropositions(rawProps),
    };
  });

  const rawSceneProps = Array.isArray(parsed.propositions) ? parsed.propositions : [];
  const scenePropositions = parsePropositions(rawSceneProps);

  logInfo('Completed scene plan rewrite', {
    source: 'plan-generation',
    operation: 'rewrite-plan-complete',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      beatsReturned: beats.length > 0 ? beats.length : currentPlan.beats.length,
      usedFallback: beats.length === 0,
    },
  });

  return {
    beats: beats.length > 0 ? beats : currentPlan.beats,
    propositions: scenePropositions.length > 0 ? scenePropositions : currentPlan.propositions,
  };
}

/**
 * Parse beat-aligned prose from LLM output with [BEAT_END:N] markers.
 * Returns clean prose + beatProseMap (prose strings) if markers are valid, otherwise prose only.
 *
 * @returns { prose, beatProseMap?, markersFailed } - markersFailed indicates if beat markers were missing/invalid
 */
function parseBeatProseMap(
  rawProse: string,
  beatCount: number,
): { prose: string; beatProseMap?: BeatProseMap; markersFailed?: boolean } {
  // If no markers, return prose as-is with failure flag
  if (!rawProse.includes('[BEAT_END:')) {
    logWarning('Beat markers not found in generated prose', 'LLM did not include BEAT_END markers', {
      source: 'prose-generation',
      operation: 'parse-beat-markers'
    });
    return { prose: rawProse, markersFailed: true };
  }

  // First pass: extract raw prose text per beat
  const beatTexts: { beatIndex: number; text: string }[] = [];
  const lines = rawProse.split('\n');
  let currentBeatIndex = 0;
  let currentProse: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*\[BEAT_END:(\d+)\]\s*$/);
    if (match) {
      const beatIndex = parseInt(match[1], 10);
      if (!isNaN(beatIndex) && beatIndex === currentBeatIndex) {
        const proseText = currentProse.join('\n').trim();
        // Always add beat, even if empty (to maintain beat count)
        beatTexts.push({ beatIndex, text: proseText });
        currentProse = [];
        currentBeatIndex++;
      } else {
        logWarning('Beat markers out of order', `Expected beat ${currentBeatIndex}, got ${beatIndex}`, {
          source: 'prose-generation',
          operation: 'parse-beat-markers',
          details: { expected: currentBeatIndex, got: beatIndex }
        });
        return { prose: rawProse.replace(/\[BEAT_END:\d+\]\n?/g, '').trim(), markersFailed: true };
      }
    } else {
      currentProse.push(line);
    }
  }

  // Handle final beat: only add if there's prose after the last marker OR we're missing beats
  const finalProse = currentProse.join('\n').trim();
  const needsFinalBeat = finalProse.length > 0 || currentBeatIndex < beatCount;

  if (needsFinalBeat) {
    beatTexts.push({ beatIndex: currentBeatIndex, text: finalProse });
  }

  // Reconstruct clean prose (no markers)
  const prose = beatTexts.map((b) => b.text).join('\n\n');

  // Validate we got expected number of beats with sequential indices
  if (beatTexts.length !== beatCount || !beatTexts.every((b, i) => b.beatIndex === i)) {
    logWarning('Beat count mismatch in generated prose', `Expected ${beatCount} beats, got ${beatTexts.length}`, {
      source: 'prose-generation',
      operation: 'parse-beat-markers',
      details: {
        expected: beatCount,
        actual: beatTexts.length,
        finalProseLength: finalProse.length,
        lastBeatIndex: currentBeatIndex - 1,
      }
    });
    return { prose: rawProse.replace(/\[BEAT_END:\d+\]\n?/g, '').trim(), markersFailed: true };
  }

  // Success: create beat-to-prose mapping with prose strings
  const chunks: BeatProse[] = beatTexts.map((bt) => ({
    beatIndex: bt.beatIndex,
    prose: bt.text,
  }));

  logInfo(`Successfully parsed ${chunks.length} beat chunks from prose`, {
    source: 'prose-generation',
    operation: 'parse-beat-markers',
    details: { beatCount: chunks.length }
  });

  return {
    prose,
    beatProseMap: {
      chunks,
      createdAt: Date.now(),
    },
    markersFailed: false,
  };
}

export async function generateSceneProse(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  onToken?: (token: string) => void,
  /** Per-scene prose direction appended to the system prompt */
  guidance?: string,
  /** Resolved plan to use (overrides scene.plan for versioned scenes) */
  plan?: BeatPlan,
): Promise<{ prose: string; beatProseMap?: BeatProseMap; proseEmbedding?: number[] }> {
  // Use provided plan (required for prose generation)
  const activePlan = plan ?? scene.planVersions?.[scene.planVersions.length - 1]?.plan;

  logInfo('Starting prose generation', {
    source: 'prose-generation',
    operation: 'generate-prose',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      sceneSummary: scene.summary.substring(0, 60),
      hasPlan: !!activePlan,
      hasGuidance: !!guidance,
    },
  });

  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;

  // Previous scene prose ending for transition continuity
  const prevSceneKey = sceneIdx > 0 ? resolvedKeys[sceneIdx - 1] : null;
  const prevScene = prevSceneKey ? narrative.scenes[prevSceneKey] : null;
  const prevProse = prevScene?.proseVersions?.[prevScene.proseVersions.length - 1]?.prose;
  const prevProseEnding = prevProse
    ? prevProse.split('\n').filter((l) => l.trim()).slice(-3).join('\n')
    : '';

  // Use resolveProfile to respect beatProfilePreset selection (same as generateScenePlan)
  const proseProfile = resolveProfile(narrative);

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
  const proseFormat = narrative.storySettings?.proseFormat ?? 'prose';
  const formatInstructions = FORMAT_INSTRUCTIONS[proseFormat];

  // System prompt is minimal — style constraints moved to user prompt for stronger compliance
  const systemPrompt = `${formatInstructions.systemRole} You are crafting a single scene for "${narrative.title}".

Tone: ${narrative.worldSummary.slice(0, 200)}.
${hasVoiceOverride
    ? `\nAUTHOR VOICE (this is the PRIMARY creative direction — all craft defaults below are subordinate to this voice):
${narrative.storySettings!.proseVoice!.trim()}
`
    : ''}
${formatInstructions.formatRules}${
    guidance?.trim() ? `\n\nSCENE DIRECTION:\n${guidance.trim()}` : ''
  }`;

  const sceneBlock = sceneContext(narrative, scene, resolvedKeys, contextIndex);

  // Scene plan — when available, this is the primary creative direction
  const planBlock = activePlan
    ? `\nBEAT PLAN (follow this beat sequence — each beat maps to a passage of prose):
${activePlan.beats.map((b, i) =>
  `  ${i + 1}. [${b.fn}:${b.mechanism}] ${b.what}
     Propositions: ${b.propositions.map(p => `"${p.content}"`).join('; ')}`
).join('\n')}

PROPOSITIONS ARE STORY WORLD FACTS TO TRANSMIT — atomic claims the reader must come to believe are true. Your job is to transmit these beliefs through prose craft. NEVER copy propositions verbatim. NEVER state them as flat declarations. Transmit them through demonstration, implication, sensory detail, action, and atmosphere.

HOW TO TRANSMIT PROPOSITIONS:
Given proposition: "Mist covers the village at dawn"
  • Direct sensory: "He couldn't see past ten paces. Dampness clung to his skin."
  • Through action: "Houses materialized from whiteness as he walked."
  • Environmental: "The mountain disappeared into grey nothing above the rooftops."
All three methods transmit the same world fact. Choose your method based on the beat's mechanism and the prose profile's voice.

Given proposition: "Fang Yuan views other people as tools"
  • Through thought: His gaze swept over the crowd. Resources. Obstacles. Nothing between.
  • Through action: He stepped around the old woman without breaking stride.
  • Through dialogue: "They'll serve. Or they won't." He didn't look back.
The proposition is a belief-state to establish. HOW you establish it is craft.

CRITICAL: If a proposition contains figurative language and the prose profile forbids figures of speech, REWRITE the proposition as literal fact, then transmit that. "Smoke dances like spirits" becomes "Smoke rises in twisted columns" if metaphor is forbidden.
${activePlan.propositions && activePlan.propositions.length > 0 ? `\nSCENE PROPOSITIONS (story world facts spanning the whole scene):\n${activePlan.propositions.map((p) => `  "${p.content}"`).join('\n')}` : ''}\n`
    : '';

  // Derive logical constraints from the scene graph — these are hard rules the prose must obey
  const logicRules = deriveLogicRules(narrative, scene, resolvedKeys, contextIndex);
  const logicBlock = logicRules ? `\n${logicRules}\n` : '';

  // Previous prose edge for transition continuity
  const adjacentProseBlock = prevProseEnding
    ? `PREVIOUS SCENE ENDING (match tone, avoid repeating imagery or phrasing):\n"""${prevProseEnding}"""`
    : '';

  const instruction = activePlan
    ? `Follow the beat plan sequence — each beat maps to a passage of prose. The mechanism defines the delivery MODE (dialogue, thought, action, etc). The propositions define STORY WORLD FACTS TO TRANSMIT (what the reader must come to believe is true). Your job is to weave both into compelling, voiced prose.

BEAT BOUNDARY MARKERS:
After completing the prose for each beat, insert a marker line on its own:
[BEAT_END:0]
[BEAT_END:1]
[BEAT_END:2]
...and so on for each beat in the plan (0-indexed).

These markers help track which prose came from which beat and will be removed from the final prose. Place them BETWEEN beats, not within paragraphs. Do NOT include a marker after the final beat.

Example structure for a 3-beat scene:
[Prose for beat 0...]

[BEAT_END:0]

[Prose for beat 1...]

[BEAT_END:1]

[Prose for beat 2...]

MECHANISMS define delivery mode:
- dialogue → quoted speech between characters
- thought → internal monologue, POV character's private reasoning
- action → physical movement, gesture, interaction with objects
- environment → setting, weather, sensory details of the space
- narration → authorial voice, rhetoric, time compression
- memory → flashback triggered by association
- document → embedded text (letter, sign, excerpt) shown literally
- comic → humor, irony, absurdity, undercut expectations

PROPOSITIONS are story world facts — transmit them through prose craft, NEVER copy verbatim:
- Proposition: "Mist covers the village" → Transmit via sensory detail (dampness on skin, visibility reduced), action (houses emerge from whiteness), or environment description — but NEVER write "Mist covers the village"
- Proposition: "Fang Yuan has 500 years of future knowledge" → Transmit via thought (he remembers events not yet happened), action (he navigates with impossible certainty), or dialogue (he predicts with unnatural precision) — but NEVER write "Fang Yuan has 500 years of future knowledge"
- Proposition: "No one is watching the path" → Transmit via observation (empty path stretches ahead, no movement in periphery), environment (silence, absence of voices), or action (he relaxes his guard) — but NEVER write "No one is watching the path"
The reader must come to believe these facts are true. HOW you transmit them is craft.

RHYTHM & VOICE (critical — prose must breathe):
- Vary sentence length: short for impact, long for flow, fragments for urgency
- Use the register and stance from PROSE PROFILE above — if it says "terse", be terse; if it says "lyrical", be lyrical
- Avoid repetitive subject-verb-object patterns — front-load clauses, use appositives, embed dependent clauses
- Never write like technical documentation or a wikipedia article — this is fiction, not exposition

SHOW, DON'T TELL (non-negotiable):
- NO info-dumping: never explain systems, concepts, or backstory in prose paragraphs
- NO explicit emotion naming: show fear through trembling hands, not "He felt fear"
- NO thematic statements: demonstrate themes through events, don't declare them
- World knowledge reveals must emerge through demonstration, dialogue discovery, or consequence — never narrator explanation

THREE PILLARS — the prose must honour all three:
1. CONTINUITY: POV character perceives only what their senses and existing knowledge allow. New continuity mutations discovered through specific mechanisms, never referenced before revelation.
2. THREADS: Every thread shift lands at a dramatic moment through action, not narration.
3. KNOWLEDGE: New world concepts feel EARNED — demonstrated through consequence, dialogue, or action. Never explain after showing. Established knowledge can be referenced. New knowledge cannot be pre-explained.

You must satisfy every logical requirement and achieve every proposition — but achieve them through craft, implication, and demonstration. Write at least ~${sceneScale(scene).estWords} words. If the scene demands more, write more.

PROSE PROFILE COMPLIANCE IS MANDATORY: Every sentence must conform to the voice, register, devices, and rules specified above. If profile forbids figurative language, use ZERO figures of speech. If profile demands specific devices, use them. The profile defines your authorial voice — match it exactly.`
    : `RHYTHM & VOICE (critical — prose must breathe):
- Vary sentence length: short for impact, long for flow, fragments for urgency
- Use the register and stance from PROSE PROFILE above — match the authorial voice exactly
- Avoid repetitive patterns — front-load clauses, use appositives, vary structure
- This is fiction, not exposition — never write like documentation

SHOW, DON'T TELL (non-negotiable):
- NO info-dumping or system explanations in prose paragraphs
- NO explicit emotion naming — show through body language, action, dialogue subtext
- NO thematic statements — demonstrate through events and contrasts
- World knowledge reveals through demonstration, discovery, consequence — never narrator explanation

THREE PILLARS — the prose must honour all three:
1. CONTINUITY: POV character perceives only what senses and existing knowledge allow. New continuity mutations discovered through specific moments, never referenced before revelation.
2. THREADS: Every thread shift lands at a dramatic moment through action, not narration.
3. KNOWLEDGE: New world concepts feel EARNED — demonstrated through consequence, dialogue, or action. Never explain after showing. Established knowledge can be referenced. New knowledge cannot be pre-explained.

Every thread shift, continuity change, relationship mutation, and world knowledge reveal must be dramatised through action and scene. Foreshadow through imagery, subtext, environmental details — never telegraph. Write at least ~${sceneScale(scene).estWords} words, more if the scene demands it.

PROSE PROFILE COMPLIANCE IS MANDATORY: Every sentence must conform to the voice, register, devices, and rules specified above. Match the profile exactly — if it forbids figures of speech, use ZERO. If it demands specific devices, use them.`;

  const prompt = `${profileSection ? `${profileSection}\n\n` : ''}${adjacentProseBlock ? `${adjacentProseBlock}\n\n` : ''}${planBlock}${sceneBlock}
${logicBlock}
${instruction}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;

  // Helper: Generate raw prose from LLM
  const generateRaw = async (): Promise<string> => {
    if (onToken) {
      return callGenerateStream(prompt, systemPrompt, onToken, MAX_TOKENS_DEFAULT, 'generateSceneProse', WRITING_MODEL, reasoningBudget);
    }
    return callGenerate(prompt, systemPrompt, MAX_TOKENS_DEFAULT, 'generateSceneProse', WRITING_MODEL, reasoningBudget, false);
  };

  // Generation with retry on marker failure (max 2 attempts)
  const MAX_ATTEMPTS = 2;
  let result: { prose: string; beatProseMap?: BeatProseMap; markersFailed?: boolean } | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const rawProse = await generateRaw();

    // Parse beat boundaries if scene has a plan
    result = activePlan
      ? parseBeatProseMap(rawProse, activePlan.beats.length)
      : { prose: rawProse };

    // Success: markers valid or no plan to check
    if (!result.markersFailed || !activePlan) {
      break;
    }

    // Failure: markers invalid
    if (attempt < MAX_ATTEMPTS) {
      logWarning(`Beat markers failed on attempt ${attempt}/${MAX_ATTEMPTS}, retrying`, 'Prose generation returned invalid beat markers', {
        source: 'prose-generation',
        operation: 'generate-prose-with-beats',
        details: { attempt, maxAttempts: MAX_ATTEMPTS }
      });
    } else {
      logError(`Beat markers failed after ${MAX_ATTEMPTS} attempts`, 'Returning prose without beat mapping', {
        source: 'prose-generation',
        operation: 'generate-prose-with-beats',
        details: { maxAttempts: MAX_ATTEMPTS }
      });
    }
  }

  // Invariant: result must exist after loop
  if (!result) {
    throw new Error('[generateSceneProse] Internal error: no result after generation loop');
  }

  logInfo('Completed prose generation', {
    source: 'prose-generation',
    operation: 'generate-prose-complete',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      proseLength: result.prose.length,
      hasBeatMap: !!result.beatProseMap,
      beatChunks: result.beatProseMap?.chunks.length ?? 0,
      markersFailed: result.markersFailed ?? false,
    },
  });

  // ── Generate prose embedding ─────────────────────────────────────────────
  const { generateEmbeddings } = await import('@/lib/embeddings');

  let proseEmbedding: number[] | undefined;
  if (result.prose && result.prose.length > 0) {
    try {
      const embeddings = await generateEmbeddings([result.prose], narrative.id);
      proseEmbedding = embeddings[0];
    } catch (error) {
      // Log error but don't fail prose generation if embedding fails
      logError('Failed to generate prose embedding', error, {
        source: 'prose-generation',
        operation: 'embed-prose',
        details: { narrativeId: narrative.id, sceneId: scene.id },
      });
    }
  }

  return { ...result, proseEmbedding };
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
    logWarning(`Stripped ${stripped.length} hallucinated ID(s) from ${label}`, stripped.join(', '), {
      source: 'manual-generation',
      operation: 'clean-scene-data',
      details: { count: stripped.length, type: label }
    });
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

  logInfo('Starting stepwise arc generation', {
    source: 'manual-generation',
    operation: 'generate-arc-stepwise',
    details: {
      narrativeId: narrative.id,
      arcId: existingArc?.id ?? 'new',
      sceneCount,
      existingArc: !!existingArc,
      hasPacingSequence: !!pacingSequence,
      hasWorldBuildFocus: !!worldBuildFocus,
    },
  });

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

  logInfo('Completed stepwise arc generation', {
    source: 'manual-generation',
    operation: 'generate-arc-stepwise-complete',
    details: {
      narrativeId: narrative.id,
      arcId: arc.id,
      arcName: arc.name,
      scenesGenerated: allScenes.length,
      threadsInvolved: arc.develops.length,
      locationsUsed: arc.locationIds.length,
      charactersInvolved: arc.activeCharacterIds.length,
    },
  });

  return { scenes: allScenes, arc };
}
