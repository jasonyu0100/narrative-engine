import type { NarrativeState, Scene, Arc, WorldBuild, StorySettings, Beat, BeatPlan, BeatProse, BeatProseMap, Proposition, ThreadLogNodeType, SystemNode } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS, REASONING_BUDGETS, BEAT_FN_LIST, BEAT_MECHANISM_LIST, THREAD_ACTIVE_STATUSES, THREAD_TERMINAL_STATUSES } from '@/types/narrative';
import { nextId, nextIds } from '@/lib/narrative-utils';
import { callGenerate, callGenerateStream, SYSTEM_PROMPT } from './api';
import { WRITING_MODEL, GENERATE_MODEL, MAX_TOKENS_LARGE, MAX_TOKENS_DEFAULT, MAX_TOKENS_SMALL, WORDS_PER_BEAT, ANALYSIS_TEMPERATURE } from '@/lib/constants';
import { parseJson } from './json';
import { narrativeContext, sceneContext, sceneScale } from './context';
import { PROMPT_STRUCTURAL_RULES, PROMPT_MUTATIONS, PROMPT_ARTIFACTS, PROMPT_LOCATIONS, PROMPT_POV, PROMPT_CONTINUITY, PROMPT_SUMMARY_REQUIREMENT, PROMPT_BEAT_TAXONOMY, promptThreadLifecycle, buildThreadHealthPrompt, buildCompletedBeatsPrompt, buildForceStandardsPrompt } from './prompts';
import { samplePacingSequence, buildSequencePrompt, detectCurrentMode, MATRIX_PRESETS, DEFAULT_TRANSITION_MATRIX, type PacingSequence } from '@/lib/pacing-profile';
import { resolveProfile, resolveSampler, sampleBeatSequence } from '@/lib/beat-profiles';
import { FORMAT_INSTRUCTIONS } from './prose';
import { logWarning, logError, logInfo } from '@/lib/system-logger';
import { retryWithValidation, validateBeatPlan, validateBeatProseMap } from './validation';
import { sanitizeSystemMutation, systemEdgeKey, makeSystemIdAllocator, resolveSystemConceptIds } from '@/lib/system-graph';

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
  const sceneCount = count > 0 ? Math.max(4, count) : targetLen;
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
  const lines: string[] = [`WORLD BUILD FOCUS (${wb.id} — "${wb.summary}"): The entities below were recently introduced and have not yet had a presence in the story. This arc should bring them in — use these characters in scenes, set at least one scene in these locations, and begin seeding these latent threads:`];
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
      "artifactUsages": [{"artifactId": "A-XX", "characterId": "C-XX or null for unattributed usage", "usage": "what the artifact did — how it delivered utility"}],
      "characterMovements": {"C-XX": {"locationId": "L-YY", "transition": "Descriptive transition: 'Rode horseback through the night', 'Slipped through the back gate at dawn'"}},
      "events": ["event_tag_1", "event_tag_2"],
      "threadMutations": [{"threadId": "T-XX", "from": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "to": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "addedNodes": [{"id": "TK-GEN-001", "content": "thread-specific: what happened to THIS thread in THIS scene (NOT a scene summary)", "type": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall"}]}],
      "continuityMutations": [{"entityId": "C-XX", "addedNodes": [{"id": "K-GEN-001", "content": "complete sentence: what they experienced or became", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}],
      "relationshipMutations": [{"from": "C-XX", "to": "C-YY", "type": "description", "valenceDelta": 0.1}],
      "systemMutations": {"addedNodes": [{"id": "SYS-GEN-001", "concept": "15-25 words, PRESENT tense: a general rule or structural fact about how the world works — no specific characters or events", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"from": "SYS-GEN-001", "to": "SYS-XX", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]},
      "ownershipMutations": [{"artifactId": "A-XX", "fromId": "C-XX or L-XX", "toId": "C-YY or L-YY"}],
      "tieMutations": [{"locationId": "L-XX", "characterId": "C-XX", "action": "add|remove"}],
      "summary": "REQUIRED: Rich prose sentences using character NAMES and location NAMES — never raw IDs (no C-01, T-XX, L-03, WK-GEN, A-01 etc). Write as if for a reader: 'Fang Yuan acquires the Liquor worm' not 'C-01 acquires A-05'. Include specifics: what object, what words, what breaks. NO thin generic summaries. NO sentences ending in emotions/realizations."
    }
  ]
}

Rules:
- Use ONLY existing character IDs and location IDs from the narrative context above
- Scene IDs must be unique: S-GEN-001, S-GEN-002, etc.
- Knowledge node IDs must be unique: K-GEN-001, K-GEN-002, etc.
- World knowledge node IDs for NEW concepts must be unique: SYS-GEN-001, SYS-GEN-002, etc. Reused nodes should keep their original ID.

DENSITY BAR (grading reference means — your arc averages must hit these or it grades in the 60s):
  Fate F ≈ 1.5 per scene · World W ≈ 12 per scene · System S ≈ 3 per scene
  A typical scene: 3-5 entities touched, 10-14 continuity nodes (list in causal order — edges auto-chain), 2-4 world knowledge nodes + 1-3 edges, 2-4 thread pulses (0-1 transitions).
  A climax scene: push to 16-20+ continuity, 5-8 knowledge, 1-2 transitions.
  A quiet scene: 6-8 continuity, 0-1 knowledge, 0-1 pulses.
  Every entity in participantIds that the scene VISIBLY CHANGES must have a continuityMutation. Scan the participant list before returning — any visible participant with zero nodes is a scoring leak.
  REUSE existing WK node IDs when reinforcing — only NEW concepts count as density.
${PROMPT_STRUCTURAL_RULES}
${PROMPT_SUMMARY_REQUIREMENT}
${buildForceStandardsPrompt(storySettings.targetArchetype)}
${PROMPT_MUTATIONS}
${PROMPT_LOCATIONS}
${Object.keys(narrative.artifacts ?? {}).length > 0 ? PROMPT_ARTIFACTS : ''}
${PROMPT_POV}
${PROMPT_CONTINUITY}
${promptThreadLifecycle()}
${buildThreadHealthPrompt(narrative, resolvedKeys, currentIndex)}
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

  // Fix continuity node IDs to be unique and sequential
  const existingKIds = [
    ...Object.values(narrative.characters).flatMap((c) => Object.keys(c.continuity.nodes)),
    ...Object.values(narrative.locations).flatMap((l) => Object.keys(l.continuity.nodes)),
    ...Object.values(narrative.artifacts ?? {}).flatMap((a) => Object.keys(a.continuity.nodes)),
  ];
  const totalNodeMutations = scenes.reduce((sum, s) => sum + s.continuityMutations.reduce((ns, km) => ns + (km.addedNodes?.length ?? 0), 0), 0);
  const kIds = nextIds('K', existingKIds, totalNodeMutations);
  let kIdx = 0;
  for (const scene of scenes) {
    for (const km of scene.continuityMutations) {
      for (const node of km.addedNodes ?? []) {
        node.id = kIds[kIdx++];
      }
    }
  }

  // Fix thread log node IDs to be unique and sequential
  const existingTkIds = Object.values(narrative.threads).flatMap((t) => Object.keys(t.threadLog?.nodes ?? {}));
  const totalLogNodes = scenes.reduce((sum, s) => sum + (s.threadMutations ?? []).reduce((ns, tm) => ns + (tm.addedNodes?.length ?? 0), 0), 0);
  const tkIds = nextIds('TK', existingTkIds, totalLogNodes);
  let tkIdx = 0;
  for (const scene of scenes) {
    for (const tm of scene.threadMutations ?? []) {
      for (const node of tm.addedNodes ?? []) {
        node.id = tkIds[tkIdx++];
      }
    }
  }

  // Sanitize and re-ID world knowledge mutations. Concept-based resolution
  // collapses re-mentioned concepts (existing-graph or earlier-in-batch) to
  // their canonical id so that re-asserting "mana-binding" across scenes
  // does not repeatedly count as a new node and inflate System scores.
  const existingWkNodes = narrative.systemGraph?.nodes ?? {};
  // Cumulative node map: starts as the existing graph and grows with each
  // scene's genuinely-new nodes, so the next scene's resolve sees earlier
  // scenes' contributions as already-known.
  const cumulativeWkNodes: Record<string, SystemNode> = { ...existingWkNodes };
  const allocateFreshWkId = makeSystemIdAllocator(Object.keys(cumulativeWkNodes));
  // Cumulative id remap across all scenes — one entry per LLM-emitted placeholder id.
  const wkIdMap: Record<string, string> = {};
  const validWKIds = new Set<string>(Object.keys(cumulativeWkNodes));
  // Seed seen-edges from the narrative's existing graph so we don't re-add
  // edges that already exist upstream.
  const seenWkEdgeKeys = new Set<string>();
  for (const e of narrative.systemGraph?.edges ?? []) seenWkEdgeKeys.add(systemEdgeKey(e));

  for (const scene of scenes) {
    if (!scene.systemMutations) {
      scene.systemMutations = { addedNodes: [], addedEdges: [] };
    }
    scene.systemMutations.addedNodes = scene.systemMutations.addedNodes ?? [];
    scene.systemMutations.addedEdges = scene.systemMutations.addedEdges ?? [];
    // Resolve concepts: existing wins, then within-scene dupes collapse,
    // then genuinely new concepts get fresh SYS-XX ids.
    const resolved = resolveSystemConceptIds(
      scene.systemMutations.addedNodes,
      cumulativeWkNodes,
      allocateFreshWkId,
    );
    Object.assign(wkIdMap, resolved.idMap);
    scene.systemMutations.addedNodes = resolved.newNodes;
    for (const n of resolved.newNodes) {
      cumulativeWkNodes[n.id] = n;
      validWKIds.add(n.id);
    }
    // Remap edge references using the cumulative map (LLM GEN ids, prior-
    // scene real ids, and existing graph ids all pass through correctly).
    scene.systemMutations.addedEdges = scene.systemMutations.addedEdges.map((edge) => ({
      from: wkIdMap[edge.from] ?? edge.from,
      to: wkIdMap[edge.to] ?? edge.to,
      relation: edge.relation,
    }));
    // Centralised sanitization: self-loops, orphans, cross-scene dupes, bad fields
    sanitizeSystemMutation(scene.systemMutations, validWKIds, seenWkEdgeKeys);
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
  const { generateEmbeddingsBatch, computeCentroid, resolveEmbedding } = await import('@/lib/embeddings');
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
          const resolvedCentroids = (await Promise.all(
            latestPlan.beats.map(b => resolveEmbedding(b.embeddingCentroid))
          )).filter((e): e is number[] => e !== null);
          if (resolvedCentroids.length > 0) {
            scene.planEmbeddingCentroid = await assetManager.storeEmbedding(computeCentroid(resolvedCentroids), 'text-embedding-3-small');
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
  /** Skip embedding generation — used by plan candidates where only the winner gets embedded */
  skipEmbeddings?: boolean,
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
  const targetBeats = scale.targetBeats;
  const estWords = scale.estWords;
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

${PROMPT_BEAT_TAXONOMY}

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
• {"content": "F = activeArcs^α × stageWeight", "type": "formula"}
• {"content": "F represents Fate — the force of threads pulling world and system toward resolution", "type": "definition"}
• {"content": "W = ΔN_c + √ΔE_c — entity transformation (what we learn about characters, locations, artifacts)", "type": "definition"}
• {"content": "S = ΔN + √ΔE — world deepening (rules, structures, concepts)", "type": "definition"}
• {"content": "Thread lifecycle: latent→seeded→active→escalating→critical→resolved/subverted. Escalating = point of no return. Abandoned earns 0.", "type": "definition"}
• {"content": "Published works score 85-95", "type": "evidence"}

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

  // Thread health and spent beats for understanding what needs attention
  const threadHealth = buildThreadHealthPrompt(narrative, resolvedKeys, contextIndex);
  const spentBeats = buildCompletedBeatsPrompt(narrative, resolvedKeys, contextIndex);

  const prompt = `${profileBlock}NARRATIVE CONTEXT:\n${fullContext}
${threadHealth ? `\n${threadHealth}\n` : ''}${spentBeats ? `\n${spentBeats}\n` : ''}${adjacentBlock ? `${adjacentBlock}\n\n` : ''}
${sceneDesc}

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
      embeddingCentroid: undefined as string | undefined,
    };
  });

  const result: BeatPlan = { beats };

  // ── Generate embeddings for all propositions (skipped for candidates) ────
  if (skipEmbeddings) return result;

  const { embedPropositions, computeCentroid, resolveEmbedding } = await import('@/lib/embeddings');
  const { assetManager } = await import('@/lib/asset-manager');

  // Collect all propositions from beats
  const allPropositions: Array<{ content: string; type?: string }> = [];
  result.beats.forEach(beat => {
    allPropositions.push(...beat.propositions);
  });

  // Embed all propositions in batch
  if (allPropositions.length > 0) {
    try {
      const embeddedProps = await embedPropositions(allPropositions, narrative.id);

      // Map embeddings back to plan
      let embeddedIndex = 0;
      for (const beat of result.beats) {
        for (let i = 0; i < beat.propositions.length; i++) {
          beat.propositions[i] = embeddedProps[embeddedIndex++];
        }

        // Compute beat centroid from proposition embeddings and store as asset
        const beatEmbeddings = (await Promise.all(
          beat.propositions.map(p => resolveEmbedding(p.embedding))
        )).filter((e): e is number[] => e !== null);
        if (beatEmbeddings.length > 0) {
          const centroid = computeCentroid(beatEmbeddings);
          beat.embeddingCentroid = await assetManager.storeEmbedding(centroid, 'text-embedding-3-small');
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

  logInfo('Completed scene plan edit', {
    source: 'plan-generation',
    operation: 'edit-plan-complete',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      beatsReturned: beats.length,
    },
  });

  return { beats };
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
/**
 * Split prose into ~100-word chunks on sentence boundaries.
 * Chunks are allowed to exceed 100 words to avoid breaking mid-sentence.
 */
export function splitIntoWordChunks(prose: string, targetWords: number = WORDS_PER_BEAT): string[] {
  const sentences = splitIntoSentences(prose).filter(s => s.trim());
  if (sentences.length === 0) return [prose];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const sentence of sentences) {
    const sentenceWords = sentence.split(/\s+/).length;
    current.push(sentence);
    currentWords += sentenceWords;

    // Break after reaching target — allows the sentence that crosses the boundary to finish
    if (currentWords >= targetWords) {
      chunks.push(current.join(' ').trim());
      current = [];
      currentWords = 0;
    }
  }

  // Flush remaining sentences
  if (current.length > 0) {
    const remainder = current.join(' ').trim();
    // If remainder is very short, merge into the last chunk
    if (chunks.length > 0 && currentWords < targetWords * 0.3) {
      chunks[chunks.length - 1] += ' ' + remainder;
    } else {
      chunks.push(remainder);
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

      // Validate prose map — required for side-by-side view
      if (result.beatProseMap) {
        const mapValidation = validateBeatProseMap(result.beatProseMap, result.plan, prose);
        if (!mapValidation.valid) {
          throw new Error(`Beat prose map validation failed:\n${mapValidation.errors.join('\n')}`);
        }
      } else {
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
  // Strip decorative content before splitting
  const cleanedProse = prose
    .split(/\n\s*\n/)
    .filter((p: string) => p.replace(/[\s*·•–—\-=_#~.]/g, '').trim().length > 0)
    .join('\n\n');

  // Deterministic ~100-word chunks — one chunk = one beat
  const chunks = splitIntoWordChunks(cleanedProse);
  const chunksJson = JSON.stringify(chunks.map((c: string, i: number) => ({ index: i, text: c })));

  const systemPrompt = `You are a beat analyst. You receive a JSON array of pre-split prose chunks. Annotate EACH chunk with its beat function, mechanism, and propositions. The input and output arrays MUST be the same length — one beat per chunk, matched by index.

Return ONLY valid JSON matching this schema:
{
  "beats": [
    {
      "index": 0,
      "fn": "${BEAT_FN_LIST.join('|')}",
      "mechanism": "${BEAT_MECHANISM_LIST.join('|')}",
      "what": "STRUCTURAL SUMMARY: what happens, not how it reads",
      "propositions": [
        {"content": "atomic claim", "type": "state|claim|definition|formula|evidence|rule|comparison|example"}
      ]
    }
  ]
}

CRITICAL RULES:
- Return EXACTLY ${chunks.length} beats — one per input chunk, matched by index 0 through ${chunks.length - 1}.
- Do NOT merge adjacent chunks into one beat. Do NOT skip any chunk. Every chunk gets its own beat.
- Every beat MUST have all three required fields: fn, mechanism, what.

${PROMPT_BEAT_TAXONOMY}

RULES:
- One beat per chunk. Annotate what the chunk does structurally.
- STRUCTURAL SUMMARIES ONLY: The 'what' field describes WHAT HAPPENS, not how it reads as prose.
  • DO: "Guard confronts him about the forged papers" — structural event
  • DON'T: "He muttered, 'The academy won't hold me long'" — pre-written prose
  • DO: "Elders debate whether to proceed with the ceremony" — action summary
  • DON'T: "Her voice cut through the murmur of the crowd" — literary description
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

If the prose mentions "three fundamental forces (Fate, World, System)", you need:
• {"content": "There are three fundamental forces", "type": "claim"}
• {"content": "The three forces are Fate, World, and System", "type": "definition"}

DO NOT summarize multiple claims into one. Each atomic fact gets its own proposition.

Include "type" — any descriptive label. Common types:
- Fiction: state, belief, relationship, event, rule, secret, motivation
- Non-fiction: claim, definition, formula, evidence, parameter, mechanism, comparison, method, constraint, example

FICTION:
• {"content": "Alice falls down a rabbit hole", "type": "event"}
• {"content": "The White Rabbit wears a waistcoat", "type": "state"}
• {"content": "The Cheshire Cat can disappear", "type": "rule"}

NON-FICTION (exhaustive example from a technical paper):
• {"content": "F = activeArcs^α × stageWeight", "type": "formula"}
• {"content": "F represents Fate — the force of threads pulling world and system toward resolution", "type": "definition"}
• {"content": "W = ΔN_c + √ΔE_c — entity transformation (what we learn about characters, locations, artifacts)", "type": "definition"}
• {"content": "S = ΔN + √ΔE — world deepening (rules, structures, concepts)", "type": "definition"}
• {"content": "Thread lifecycle: latent→seeded→active→escalating→critical→resolved/subverted. Escalating = point of no return. Abandoned earns 0.", "type": "definition"}
• {"content": "Sustained threads earn superlinearly: 5 arcs at critical→resolved earns ~34 vs 4 for single-arc", "type": "example"}
• {"content": "Published works score 85-95", "type": "evidence"}
• {"content": "C = √ΔM + √ΔE + √ΔR", "type": "formula"}
• {"content": "ΔM counts continuity mutations", "type": "definition"}
• {"content": "ΔE counts events", "type": "definition"}
• {"content": "ΔR = Σ|Δv|² sums squared valence shifts (L2)", "type": "formula"}
• {"content": "Square roots give diminishing returns", "type": "mechanism"}
• {"content": "Diminishing returns prevent any single axis from dominating", "type": "claim"}

INVALID: craft goals, pacing instructions, meta-commentary.

- Return ONLY valid JSON.`;

  const prompt = `SCENE SUMMARY: ${summary}

CHUNKS (${chunks.length} items, ~100 words each — annotate each one):
${chunksJson}

TASK:
Annotate each chunk with its beat function, mechanism, and propositions. One beat per chunk, in order.

Extract propositions according to density guidelines — light fiction gets 1-2 props/beat, technical prose gets exhaustive extraction.

CONSTRAINTS:
- Return exactly ${chunks.length} beats — one per chunk.
- Use ONLY these 10 beat functions: breathe, inform, advance, bond, turn, reveal, shift, expand, foreshadow, resolve`;

  let accumulated = '';
  const raw = onToken
    ? await callGenerateStream(prompt, systemPrompt, (token) => { accumulated += token; onToken(token, accumulated); }, MAX_TOKENS_SMALL, 'reverseEngineerScenePlan', GENERATE_MODEL, undefined, undefined, ANALYSIS_TEMPERATURE)
    : await callGenerate(prompt, systemPrompt, MAX_TOKENS_SMALL, 'reverseEngineerScenePlan', GENERATE_MODEL, undefined, true, ANALYSIS_TEMPERATURE);

  type BeatData = { fn: string; mechanism: string; what: string; propositions: unknown[] };
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

  // LLM must return exactly one beat per chunk — mismatch is a retry-worthy failure
  if (beats.length !== chunks.length) {
    throw new Error(`Beat count mismatch: got ${beats.length} beats for ${chunks.length} chunks`);
  }

  const plan: BeatPlan = { beats };

  // Prose map is deterministic — chunk i = beat i
  const beatProseMap: BeatProseMap = {
    chunks: chunks.map((prose, i) => ({ beatIndex: i, prose })),
    createdAt: Date.now(),
  };

  return { plan, beatProseMap };
}

/**
 * Build BeatProseMap from chunk counts. Deterministic — no gaps or overlaps possible.
 * The only validation: counts must sum to total paragraphs and each count must be >= 1.
 */
export function buildBeatProseMapFromCounts(
  paragraphs: string[],
  beats: Beat[],
  chunkCounts: number[],
  startIndices?: (number | undefined)[],
): BeatProseMap | null {
  if (paragraphs.length === 0 || beats.length === 0 || chunkCounts.length !== beats.length) return null;

  // Fix simple off-by-one/two errors by adjusting the last beat; anything else regenerates
  const total = chunkCounts.reduce((a, b) => a + b, 0);
  if (total !== paragraphs.length) {
    const diff = paragraphs.length - total;
    const lastIdx = chunkCounts.length - 1;
    if (Math.abs(diff) <= 2 && chunkCounts[lastIdx] + diff >= 1) {
      chunkCounts[lastIdx] += diff;
    } else {
      logWarning('Beat chunk counts do not sum to paragraph count',
        `Sum ${total} ≠ ${paragraphs.length} paragraphs`,
        { source: 'analysis', operation: 'beat-prose-mapping', details: { total, expected: paragraphs.length, counts: chunkCounts.join(',') } }
      );
      return null;
    }
  }

  const chunks: BeatProse[] = [];
  let cursor = 0;

  for (let i = 0; i < chunkCounts.length; i++) {
    const count = chunkCounts[i];
    if (count < 1) {
      logWarning('Beat has zero or negative chunk count',
        `Beat ${i} has chunks=${count}`,
        { source: 'analysis', operation: 'beat-prose-mapping', details: { beatIndex: i, count } }
      );
      return null;
    }

    // startIndex is the source of truth — must match computed cursor exactly
    const expectedStart = startIndices?.[i];
    if (typeof expectedStart === 'number' && expectedStart !== cursor) {
      logWarning('Beat startIndex does not match expected position',
        `Beat ${i}: startIndex=${expectedStart} but expected ${cursor}`,
        { source: 'analysis', operation: 'beat-prose-mapping', details: { beatIndex: i, startIndex: expectedStart, cursor, count } }
      );
      return null;
    }

    const prose = paragraphs.slice(cursor, cursor + count).join('\n\n').trim();
    if (!prose) {
      logWarning('Beat prose is empty', `Beat ${i} spans paragraphs ${cursor}–${cursor + count - 1} but produced empty text`,
        { source: 'analysis', operation: 'beat-prose-mapping', details: { beatIndex: i, cursor, count } }
      );
      return null;
    }

    chunks.push({ beatIndex: i, prose });
    cursor += count;
  }

  return { chunks, createdAt: Date.now() };
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


  const systemPrompt = `You are a dramaturg making TARGETED REVISIONS to a scene plan for "${narrative.title}". This is NOT a regeneration — preserve the existing structure and only modify what the feedback specifically addresses.

Return ONLY valid JSON: { "beats": [{ "fn": "...", "mechanism": "...", "what": "...", "propositions": [{"content": "...", "type": "..."}] }] }

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
${currentPlanText}

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
\n`
    : '';

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
3. SYSTEM: New world concepts feel EARNED — demonstrated through consequence, dialogue, or action. Never explain after showing. Established knowledge can be referenced. New knowledge cannot be pre-explained.

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
3. SYSTEM: New world concepts feel EARNED — demonstrated through consequence, dialogue, or action. Never explain after showing. Established knowledge can be referenced. New knowledge cannot be pre-explained.

Every thread shift, continuity change, relationship mutation, and world knowledge reveal must be dramatised through action and scene. Foreshadow through imagery, subtext, environmental details — never telegraph. Write at least ~${sceneScale(scene).estWords} words, more if the scene demands it.

PROSE PROFILE COMPLIANCE IS MANDATORY: Every sentence must conform to the voice, register, devices, and rules specified above. Match the profile exactly — if it forbids figures of speech, use ZERO. If it demands specific devices, use them.`;

  const prompt = `${profileSection ? `${profileSection}\n\n` : ''}${adjacentProseBlock ? `${adjacentProseBlock}\n\n` : ''}${planBlock}${sceneBlock}

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
  // Pre-compute the union of WK node ids across the whole batch so that a
  // scene-2 edge referencing a scene-1 SYS-GEN-* id is not treated as orphaned.
  // The later concept-resolution pass in generateScenes remaps those GEN ids
  // to real SYS-XX ids using a cumulative map.
  const batchWkNodeIds = new Set<string>(Object.keys(narrative.systemGraph?.nodes ?? {}));
  for (const s of scenes) {
    for (const n of s.systemMutations?.addedNodes ?? []) {
      if (n?.id) batchWkNodeIds.add(n.id);
    }
  }
  const validArtifactIds = new Set(Object.keys(narrative.artifacts ?? {}));
  const allEntityIds = new Set([...validCharIds, ...validLocIds, ...validArtifactIds]);
  const stripped: string[] = [];
  const fallbackCharId = Object.keys(narrative.characters)[0];

  for (const scene of scenes) {
    if (!scene.locationId || !validLocIds.has(scene.locationId)) {
      stripped.push(`locationId "${scene.locationId}" in scene ${scene.id}`);
      scene.locationId = Object.keys(narrative.locations)[0];
    }
    if (!Array.isArray(scene.participantIds)) scene.participantIds = [];
    if (!Array.isArray(scene.events)) scene.events = [];
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
    // Coerce invalid from/to statuses to valid lifecycle phases. The LLM
    // sometimes confuses "pulse" (a log node type) with the from/to status
    // fields and emits things like "from": "pulse", "to": "active". Any
    // value outside the lifecycle vocabulary gets coerced: invalid "from"
    // falls back to the thread's currently-stored status, and invalid "to"
    // becomes a status-hold (same as from). This means a malformed
    // "pulse → active" becomes "active → active" with the log entry's
    // type still set correctly downstream.
    const validStatuses = new Set<string>([...THREAD_ACTIVE_STATUSES, ...THREAD_TERMINAL_STATUSES, 'abandoned']);
    for (const tm of scene.threadMutations) {
      const thread = narrative.threads[tm.threadId];
      const currentStatus = thread?.status ?? 'latent';
      if (!validStatuses.has(tm.from)) {
        stripped.push(`threadMutation "${tm.threadId}" in scene ${scene.id} had invalid from="${tm.from}" — coerced to "${currentStatus}"`);
        tm.from = currentStatus;
      }
      if (!validStatuses.has(tm.to)) {
        stripped.push(`threadMutation "${tm.threadId}" in scene ${scene.id} had invalid to="${tm.to}" — coerced to "${tm.from}" (status-hold)`);
        tm.to = tm.from;
      }
    }
    // Ensure thread log entries have required fields. IDs here are still
    // GEN-* placeholders — downstream remapping assigns real ones. Explicit
    // edges are cleared — the chain is auto-generated by applyThreadMutation.
    // If the LLM omitted addedNodes entirely, synthesize one from the status
    // transition so every threadMutation produces at least one log entry
    // instead of silently dropping the thread's contribution to the log.
    for (const tm of scene.threadMutations) {
      const fallbackType = tm.from === tm.to ? 'pulse' : 'transition';
      tm.addedNodes = (tm.addedNodes ?? [])
        .filter((n) => n && typeof n.content === 'string' && n.content.trim())
        .map((n, idx) => ({
          id: n.id || `TK-GEN-${idx}`,
          content: n.content,
          type: (n.type ?? fallbackType) as ThreadLogNodeType,
        }));
      if (tm.addedNodes.length === 0) {
        const thread = narrative.threads[tm.threadId];
        const desc = thread?.description ?? tm.threadId;
        tm.addedNodes = [{
          id: 'TK-GEN-0',
          content: tm.from === tm.to
            ? `Thread "${desc}" held ${tm.to} without transition`
            : `Thread "${desc}" advanced from ${tm.from} to ${tm.to}`,
          type: fallbackType as ThreadLogNodeType,
        }];
        stripped.push(`threadMutation "${tm.threadId}" in scene ${scene.id} missing log entries — synthesized fallback`);
      }
    }
    scene.continuityMutations = scene.continuityMutations.filter((km) => {
      if (!km.entityId || allEntityIds.has(km.entityId)) return true;
      stripped.push(`continuityMutation entityId "${km.entityId}" in scene ${scene.id}`);
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
    // Validate artifact usages — artifact must exist, character must be a participant,
    // character-owned artifacts can only be used by their owner, location-owned are communal
    scene.artifactUsages = (scene.artifactUsages ?? []).filter((au) => {
      if (!validArtifactIds.has(au.artifactId)) { stripped.push(`artifactUsage artifact "${au.artifactId}" in scene ${scene.id}`); return false; }
      if (au.characterId && !validCharIds.has(au.characterId)) { stripped.push(`artifactUsage character "${au.characterId}" in scene ${scene.id}`); return false; }
      const artifact = narrative.artifacts[au.artifactId];
      // Character-owned artifacts can only be used by their owner; location-owned and world-owned (null) are communal
      if (artifact && artifact.parentId && au.characterId && narrative.characters[artifact.parentId] && artifact.parentId !== au.characterId) {
        stripped.push(`artifactUsage "${au.characterId}" cannot use character-owned artifact "${au.artifactId}" (owned by ${artifact.parentId}) in scene ${scene.id}`);
        return false;
      }
      return true;
    });
    if (scene.artifactUsages.length === 0) delete scene.artifactUsages;
    scene.tieMutations = (scene.tieMutations ?? []).filter((mm) => {
      const ok = validLocIds.has(mm.locationId) && validCharIds.has(mm.characterId) &&
                 (mm.action === 'add' || mm.action === 'remove');
      if (!ok) stripped.push(`tieMutation "${mm.characterId}" at "${mm.locationId}" in scene ${scene.id}`);
      return ok;
    });
    if (scene.tieMutations.length === 0) delete scene.tieMutations;
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
    // Sanitize systemMutations — ensure arrays exist, nodes have concept+type,
    // edges have valid refs, no self-loops, no intra-scene duplicates.
    if (scene.systemMutations) {
      const wkm = scene.systemMutations;
      const beforeNodes = (wkm.addedNodes ?? []).length;
      const beforeEdges = (wkm.addedEdges ?? []).length;
      // Ensure each node carries an id (LLM may omit when emitting arrays) so
      // sanitize's field check doesn't spuriously drop them. IDs here are
      // still GEN-* placeholders — downstream remapping assigns real ones.
      wkm.addedNodes = (wkm.addedNodes ?? []).map((n, idx) => ({
        ...n,
        id: n.id || `SYS-GEN-${idx}`,
      }));
      for (const n of wkm.addedNodes) {
        if (n?.id) batchWkNodeIds.add(n.id);
      }
      // Valid targets for edges: any WK-GEN id anywhere in the batch plus
      // existing graph ids — edges can legitimately cross scene boundaries.
      sanitizeSystemMutation(wkm, batchWkNodeIds, new Set<string>());
      if (wkm.addedNodes.length < beforeNodes) {
        stripped.push(`system nodes (${beforeNodes - wkm.addedNodes.length}) missing concept/type in scene ${scene.id}`);
      }
      if (wkm.addedEdges.length < beforeEdges) {
        stripped.push(`system edges (${beforeEdges - wkm.addedEdges.length}) invalid/self-loop/dup in scene ${scene.id}`);
      }
    } else {
      scene.systemMutations = { addedNodes: [], addedEdges: [] };
    }
    // Ensure continuityMutations have required fields. Node ORDER defines
    // the chain — no explicit edges are stored on mutations.
    scene.continuityMutations = scene.continuityMutations.filter((km) => {
      if (!km.entityId) { stripped.push(`continuityMutation missing entityId in scene ${scene.id}`); return false; }
      km.addedNodes = (km.addedNodes ?? []).filter(n => n.content);
      if (km.addedNodes.length === 0) {
        stripped.push(`continuityMutation empty (no nodes) in scene ${scene.id}`);
        return false;
      }
      return true;
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


