import type { NarrativeState, Scene, Arc, WorldBuild, StorySettings, Beat, BeatPlan, BeatProse, BeatProseMap, Proposition, ThreadLogNodeType, SystemNode, Artifact, Character, Location as LocationEntity, LocationProminence } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS, REASONING_BUDGETS, BEAT_FN_LIST, BEAT_MECHANISM_LIST, THREAD_ACTIVE_STATUSES, THREAD_TERMINAL_STATUSES } from '@/types/narrative';
import { nextId, nextIds } from '@/lib/narrative-utils';
import { callGenerate, callGenerateStream, SYSTEM_PROMPT } from './api';
import { WRITING_MODEL, GENERATE_MODEL, MAX_TOKENS_LARGE, MAX_TOKENS_DEFAULT, MAX_TOKENS_SMALL, WORDS_PER_BEAT, ANALYSIS_TEMPERATURE } from '@/lib/constants';
import { parseJson } from './json';
import { narrativeContext, sceneContext, buildProseProfile } from './context';
import { PROMPT_STRUCTURAL_RULES, PROMPT_DELTAS, PROMPT_ARTIFACTS, PROMPT_LOCATIONS, PROMPT_POV, PROMPT_WORLD, PROMPT_SUMMARY_REQUIREMENT, promptThreadLifecycle, buildThreadHealthPrompt, buildCompletedBeatsPrompt, PROMPT_FORCE_STANDARDS, buildScenePlanSystemPrompt, buildBeatAnalystSystemPrompt, buildScenePlanEditSystemPrompt, buildSceneProseSystemPrompt } from './prompts';
import { samplePacingSequence, buildSequencePrompt, detectCurrentMode, MATRIX_PRESETS, DEFAULT_TRANSITION_MATRIX, type PacingSequence } from '@/lib/pacing-profile';
import { resolveProfile, resolveSampler, sampleBeatSequence } from '@/lib/beat-profiles';
import { FORMAT_INSTRUCTIONS } from '@/lib/prompts';
import { logWarning, logError, logInfo } from '@/lib/system-logger';
import type { ReasoningGraph } from './reasoning-graph';
import { buildSequentialPath, extractPatternWarningDirectives } from './reasoning-graph';
import { retryWithValidation, validateBeatPlan, validateBeatProseMap } from './validation';
import { sanitizeSystemDelta, systemEdgeKey, makeSystemIdAllocator, resolveSystemConceptIds } from '@/lib/system-graph';

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

/** Context from an active coordination plan, injected directly into generation. */
export type CoordinationPlanContext = {
  /** Current arc index (1-based) */
  arcIndex: number;
  /** Total arc count in the plan */
  arcCount: number;
  /** Arc label from the plan */
  arcLabel: string;
  /** Scene count for this arc */
  sceneCount: number;
  /** Force mode for this arc (e.g., 'fate', 'world', 'system') */
  forceMode?: string;
  /** Full directive built from the plan's reasoning graph */
  directive: string;
};

export type GenerateScenesOptions = {
  existingArc?: Arc;
  /** Pre-sampled pacing sequence. When omitted, one is auto-sampled from the story's transition matrix. */
  pacingSequence?: PacingSequence;
  worldBuildFocus?: WorldBuild;
  /** Reasoning graph that guides scene generation. When provided, replaces direction with structured reasoning path. */
  reasoningGraph?: ReasoningGraph;
  /** Coordination plan context. When provided, injects plan guidance into generation. */
  coordinationPlanContext?: CoordinationPlanContext;
  onToken?: (token: string) => void;
  /** Callback for streaming reasoning/thinking tokens */
  onReasoning?: (token: string) => void;
  /** When true, skip extended reasoning even if story settings enable it */
  disableReasoning?: boolean;
};

export async function generateScenes(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  count: number,
  direction: string,
  options: GenerateScenesOptions = {},
): Promise<{ scenes: Scene[]; arc: Arc }> {
  const { existingArc, pacingSequence, worldBuildFocus, reasoningGraph, coordinationPlanContext, onToken, onReasoning } = options;
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
${reasoningGraph ? `REASONING GRAPH — THIS IS YOUR PRIMARY BRIEF. The graph below captures the strategic logic driving this arc. Each node represents a piece of reasoning — entities, constraints, causal steps, and outcomes. Your scenes must execute this reasoning path exactly.

Arc Summary: ${reasoningGraph.summary}

REASONING PATH (step through in order — each node shows its connections):
${buildSequentialPath(reasoningGraph)}
${(() => {
  const directives = extractPatternWarningDirectives(reasoningGraph);
  return directives ? `\n## COURSE-CORRECTION DIRECTIVES (FROM REASONING GRAPH)\n\n${directives}\n` : "";
})()}
Read through every node. The reasoning nodes (REASONING:) are the core logic you must execute. Entity nodes (CHARACTER/LOCATION/ARTIFACT/SYSTEM:) provide the grounding. Outcome nodes (OUTCOME:) show thread effects you must deliver.

Edge types tell you HOW nodes relate:
- enables: A makes B possible
- constrains: A limits/blocks B
- risks: A creates danger for B
- requires: A depends on B
- causes: A leads to B
- reveals: A exposes information in B
- develops: A deepens B (character arc or theme)
- resolves: A concludes/answers B

Your scenes must walk this reasoning path — don't skip nodes, don't invent reasoning not in the graph.` : coordinationPlanContext ? `COORDINATION PLAN — THIS IS YOUR PRIMARY BRIEF (Arc ${coordinationPlanContext.arcIndex}/${coordinationPlanContext.arcCount}: "${coordinationPlanContext.arcLabel}")

This arc is part of a multi-arc coordination plan. The directive below was derived from backward-induction reasoning across the full plan. Execute it faithfully.
${coordinationPlanContext.forceMode ? `\nForce Mode: ${coordinationPlanContext.forceMode.toUpperCase()} — lean into this narrative force for this arc.` : ''}

${coordinationPlanContext.directive}${direction.trim() ? `

ADDITIONAL DIRECTION — Layer this guidance on top of the coordination plan:
${direction}` : ''}` : direction.trim() ? `DIRECTION — THIS IS YOUR PRIMARY BRIEF. Every scene you generate must execute the beats described here. Do not invent scenes that ignore, skip, or contradict these instructions.

The direction may include prose-level guidance: how to write, not just what happens. Time compression, structural techniques, tone shifts, POV style, internal monologue approach, dialogue register, pacing rhythm — any of these can appear in the direction. When they do, they must flow through into your scene summaries. The summary is the last thing the prose writer sees — anything not in the summary is lost. If the direction says "montage of monthly vignettes," the summary must read as compressed monthly snapshots. If it says "black comedy through internal monologue," the summary must set up that register. If it says "formal, layered prose for the Central Plains," the summary must signal that shift.

${direction}` : 'DIRECTION: Use your own judgment — analyze the branch context above and choose the most compelling next development based on unresolved threads, character tensions, and narrative momentum.'}
${worldBuildFocus ? (() => {
  const wb = worldBuildFocus;
  const chars = wb.expansionManifest.newCharacters.map((c) => `${c.name} (${c.role})`);
  const locs = wb.expansionManifest.newLocations.map((l) => l.name);
  const threads = wb.expansionManifest.newThreads.map((t) => {
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

For EACH scene: write the "summary" field FIRST (after id/arcId/locationId/povId/participantIds). The summary is the spine — it states in prose what happens in the scene. ONLY THEN derive the deltas (threadDeltas, worldDeltas, systemDeltas, etc.) from that summary. Every delta must trace back to something explicitly stated in the summary. This prevents abstract delta-assembly that forgets to ground the scene in concrete events.
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
      "summary": "REQUIRED — WRITE THIS FIRST. This is the spine of the scene; every delta below must trace back to something stated here. Rich prose sentences using character NAMES and location NAMES — never raw IDs (no C-01, T-XX, L-03, WK-GEN, A-01 etc). Write as if for a reader: 'Fang Yuan acquires the Liquor worm' not 'C-01 acquires A-05'. Include specifics: what object, what words, what breaks. NO thin generic summaries. NO sentences ending in emotions/realizations.",
      "artifactUsages": [{"artifactId": "A-XX", "characterId": "C-XX", "usage": "what the artifact did — how it delivered utility"}],
      "characterMovements": {"C-XX": {"locationId": "L-YY", "transition": "Descriptive transition: 'Rode horseback through the night', 'Slipped through the back gate at dawn'"}},
      "events": ["event_tag_1", "event_tag_2"],
      "threadDeltas": [{"threadId": "T-XX", "from": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "to": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "addedNodes": [{"id": "TK-GEN-001", "content": "thread-specific: what happened to THIS thread in THIS scene (NOT a scene summary)", "type": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall", "matrixCell": "cc|cd|dc|dd", "actorId": "C-XX", "targetId": "C-YY or null", "stance": "cooperative|competitive|neutral"}]}],
      "worldDeltas": [{"entityId": "C-XX", "addedNodes": [{"id": "K-GEN-001", "content": "complete sentence: what they experienced or became", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}],
      "relationshipDeltas": [{"from": "C-XX", "to": "C-YY", "type": "description", "valenceDelta": 0.1}],
      "systemDeltas": {"addedNodes": [{"id": "SYS-GEN-001", "concept": "15-25 words, PRESENT tense: a general rule or structural fact about how the world works — no specific characters or events", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"from": "SYS-GEN-001", "to": "SYS-XX", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]},
      "ownershipDeltas": [{"artifactId": "A-XX", "fromId": "C-XX or L-XX", "toId": "C-YY or L-YY"}],
      "tieDeltas": [{"locationId": "L-XX", "characterId": "C-XX", "action": "add|remove"}],
      "newCharacters": [{"id": "C-GEN-001", "name": "Full Name", "role": "anchor|recurring|transient", "threadIds": [], "imagePrompt": "1-2 sentence literal physical description", "world": {"nodes": {"K-GEN-XXX": {"id": "K-GEN-XXX", "type": "trait|history|capability|secret|goal", "content": "key fact about this character"}}, "edges": []}}],
      "newLocations": [{"id": "L-GEN-001", "name": "Location Name", "prominence": "domain|place|margin", "parentId": "L-XX (existing parent) or null", "tiedCharacterIds": [], "threadIds": [], "imagePrompt": "1-2 sentence literal visual description", "world": {"nodes": {"K-GEN-XXX": {"id": "K-GEN-XXX", "type": "trait|history", "content": "key fact about this location"}}, "edges": []}}],
      "newArtifacts": [{"id": "A-GEN-001", "name": "Artifact Name", "significance": "key|notable|minor", "parentId": "C-XX or L-XX or null (current owner)", "threadIds": [], "world": {"nodes": {"K-GEN-XXX": {"id": "K-GEN-XXX", "type": "trait|capability|history|state", "content": "what the artifact is, what it does — one fact per node, same world-graph format as characters and locations"}}, "edges": []}}],
      "newThreads": [{"id": "T-GEN-001", "description": "What this tension is about", "status": "latent", "participants": [{"id": "C-XX", "type": "character|location|artifact", "stake": "3-8 words: what they want"}], "payoffMatrices": [{"playerA": "C-XX", "playerB": "C-YY", "actionA": "A's cooperative action", "defectA": "A's defect action", "actionB": "B's cooperative action", "defectB": "B's defect action", "cc": {"outcome": "both cooperate", "payoffA": 3, "payoffB": 3}, "cd": {"outcome": "A cooperates B defects", "payoffA": 1, "payoffB": 4}, "dc": {"outcome": "A defects B cooperates", "payoffA": 4, "payoffB": 1}, "dd": {"outcome": "both defect", "payoffA": 2, "payoffB": 2}}], "threadLog": {"nodes": {}, "edges": []}}]
    }
  ]
}

INTRODUCING NEW ENTITIES — Scenes can introduce new characters, locations, artifacts, or threads on the fly. This is a miniature world expansion that happens naturally during the scene:
- New CHARACTER: Someone appears who isn't in the existing cast — a shopkeeper, a messenger, an ambusher, a bystander who becomes relevant. Give them a name, role, and at least one world node.
- New LOCATION: The scene visits somewhere not yet in the world — a specific room, a hidden spot, a shop, a landmark. Connect it to an existing parent location.
- New ARTIFACT: A tool, weapon, document, or object becomes relevant to the scene — discovered, created, or introduced. Give it significance and utility.
- New THREAD: The scene opens a new tension that wasn't tracked before — a promise made, a debt created, a question raised, a rivalry sparked. Start it as "latent" or "seeded". Threads with 2+ participants MUST include payoffMatrices — one 2×2 matrix per participant pair with cooperate/defect outcomes and ordinal payoffs 1-4.

Be liberal with entity introduction. If the scene needs a blacksmith, introduce one. If characters enter a tavern not yet in the world, introduce it. If someone finds a letter, introduce it as an artifact. These on-the-fly expansions make the world feel alive and responsive. Every new entity gets woven into the world immediately through the scene's deltas.

Rules:
- Use existing character IDs and location IDs from the narrative context when they exist
- Scene IDs must be unique: S-GEN-001, S-GEN-002, etc.
- Knowledge node IDs must be unique: K-GEN-001, K-GEN-002, etc.
- System knowledge node IDs for NEW concepts must be unique: SYS-GEN-001, SYS-GEN-002, etc. Reused nodes should keep their original ID.

DENSITY BAR (grading reference means — your arc averages must hit these or it grades in the 60s):
  Fate F ≈ 1.5 per scene · World W ≈ 12 per scene · System S ≈ 3 per scene
  A typical scene: 3-5 entities touched, 10-14 world nodes (list in causal order — edges auto-chain), 2-4 system knowledge nodes + 1-3 edges, 2-4 thread pulses (0-1 transitions).
  A climax scene: push to 16-20+ world, 5-8 knowledge, 1-2 transitions.
  A quiet scene: 6-8 world, 0-1 knowledge, 0-1 pulses.
  Every participant that was MEANINGFULLY CHANGED by the scene gets a worldDelta — not every participant present. A character who was there but unchanged deserves nothing; a character who was changed (decided, suspected, learned, committed, broke) must have that shift captured.
  AGENCY MATTERS — when a secondary character does get a delta, make it their OWN movement, not a mirror of the POV. "Meng Song suspects Fang Yuan is hiding something" shows a character thinking; "Meng Song is impressed by Fang Yuan" shows them orbiting.
  OFF-SCREEN CHARACTERS can also receive worldDeltas when events reach them through realistic channels — news, rumours, observed public acts, faction intelligence. Use deliberately, not reflexively. Across an arc the cast should evolve alongside the protagonist, not wait on them.
  REUSE existing WK node IDs when reinforcing — only NEW concepts count as density.
${PROMPT_STRUCTURAL_RULES}
${PROMPT_SUMMARY_REQUIREMENT}
${PROMPT_FORCE_STANDARDS}
${PROMPT_DELTAS}
${PROMPT_LOCATIONS}
${Object.keys(narrative.artifacts ?? {}).length > 0 ? PROMPT_ARTIFACTS : ''}
${PROMPT_POV}
${PROMPT_WORLD}
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

  // Allocate real IDs for introduced entities (C-GEN-* → C-XX, etc.)
  // Collect all introduced entities across scenes and assign sequential IDs
  const allNewChars = scenes.flatMap((s) => s.newCharacters ?? []);
  const allNewLocs = scenes.flatMap((s) => s.newLocations ?? []);
  const allNewArts = scenes.flatMap((s) => s.newArtifacts ?? []);
  const allNewThreads = scenes.flatMap((s) => s.newThreads ?? []);

  const charIdMap: Record<string, string> = {};
  const locIdMap: Record<string, string> = {};
  const artIdMap: Record<string, string> = {};
  const threadIdMap: Record<string, string> = {};

  if (allNewChars.length > 0) {
    const realCharIds = nextIds('C', Object.keys(narrative.characters), allNewChars.length);
    allNewChars.forEach((c, i) => {
      charIdMap[c.id] = realCharIds[i];
      c.id = realCharIds[i];
    });
  }
  if (allNewLocs.length > 0) {
    const realLocIds = nextIds('L', Object.keys(narrative.locations), allNewLocs.length);
    allNewLocs.forEach((l, i) => {
      locIdMap[l.id] = realLocIds[i];
      l.id = realLocIds[i];
      // Remap parentId if it references another new location
      if (l.parentId && locIdMap[l.parentId]) {
        l.parentId = locIdMap[l.parentId];
      }
    });
  }
  if (allNewArts.length > 0) {
    const realArtIds = nextIds('A', Object.keys(narrative.artifacts ?? {}), allNewArts.length);
    allNewArts.forEach((a, i) => {
      artIdMap[a.id] = realArtIds[i];
      a.id = realArtIds[i];
    });
  }
  if (allNewThreads.length > 0) {
    const realThreadIds = nextIds('T', Object.keys(narrative.threads), allNewThreads.length);
    allNewThreads.forEach((t, i) => {
      threadIdMap[t.id] = realThreadIds[i];
      t.id = realThreadIds[i];
    });
  }

  // Remap references in scenes to use real IDs
  for (const scene of scenes) {
    // Remap participant IDs, POV, location
    scene.participantIds = scene.participantIds.map((id) => charIdMap[id] ?? id);
    scene.povId = charIdMap[scene.povId] ?? scene.povId;
    scene.locationId = locIdMap[scene.locationId] ?? scene.locationId;
    // Remap worldDeltas entity IDs
    for (const km of scene.worldDeltas ?? []) {
      km.entityId = charIdMap[km.entityId] ?? locIdMap[km.entityId] ?? artIdMap[km.entityId] ?? km.entityId;
    }
    // Remap threadDeltas thread IDs
    for (const tm of scene.threadDeltas ?? []) {
      tm.threadId = threadIdMap[tm.threadId] ?? tm.threadId;
    }
    // Remap relationshipDeltas character IDs
    for (const rm of scene.relationshipDeltas ?? []) {
      rm.from = charIdMap[rm.from] ?? rm.from;
      rm.to = charIdMap[rm.to] ?? rm.to;
    }
    // Remap artifact usages
    for (const au of scene.artifactUsages ?? []) {
      au.artifactId = artIdMap[au.artifactId] ?? au.artifactId;
      if (au.characterId) au.characterId = charIdMap[au.characterId] ?? au.characterId;
    }
    // Remap ownership deltas
    for (const om of scene.ownershipDeltas ?? []) {
      om.artifactId = artIdMap[om.artifactId] ?? om.artifactId;
      om.fromId = charIdMap[om.fromId] ?? locIdMap[om.fromId] ?? om.fromId;
      om.toId = charIdMap[om.toId] ?? locIdMap[om.toId] ?? om.toId;
    }
    // Remap tie deltas
    for (const td of scene.tieDeltas ?? []) {
      td.locationId = locIdMap[td.locationId] ?? td.locationId;
      td.characterId = charIdMap[td.characterId] ?? td.characterId;
    }
    // Remap character movements
    if (scene.characterMovements) {
      const remapped: typeof scene.characterMovements = {};
      for (const [charId, mv] of Object.entries(scene.characterMovements)) {
        const newCharId = charIdMap[charId] ?? charId;
        remapped[newCharId] = {
          ...mv,
          locationId: locIdMap[mv.locationId] ?? mv.locationId,
        };
      }
      scene.characterMovements = remapped;
    }
    // Remap tiedCharacterIds in new locations
    for (const l of scene.newLocations ?? []) {
      l.tiedCharacterIds = l.tiedCharacterIds.map((id) => charIdMap[id] ?? id);
    }
    // Remap thread participants
    for (const t of scene.newThreads ?? []) {
      t.participants = t.participants.map((p) => ({
        ...p,
        id: charIdMap[p.id] ?? locIdMap[p.id] ?? artIdMap[p.id] ?? p.id,
      }));
    }
  }

  // Fix world node IDs to be unique and sequential
  // Include both existing entities and newly introduced entities' world nodes
  const existingKIds = [
    ...Object.values(narrative.characters).flatMap((c) => Object.keys(c.world.nodes)),
    ...Object.values(narrative.locations).flatMap((l) => Object.keys(l.world.nodes)),
    ...Object.values(narrative.artifacts ?? {}).flatMap((a) => Object.keys(a.world.nodes)),
  ];
  // Count world nodes: worldDeltas + new entities' initial world nodes
  const totalNodeDeltas = scenes.reduce((sum, s) => {
    const worldDeltaNodes = s.worldDeltas.reduce((ns, km) => ns + (km.addedNodes?.length ?? 0), 0);
    const newEntityNodes = (s.newCharacters ?? []).reduce((ns, c) => ns + Object.keys(c.world?.nodes ?? {}).length, 0)
      + (s.newLocations ?? []).reduce((ns, l) => ns + Object.keys(l.world?.nodes ?? {}).length, 0)
      + (s.newArtifacts ?? []).reduce((ns, a) => ns + Object.keys(a.world?.nodes ?? {}).length, 0);
    return sum + worldDeltaNodes + newEntityNodes;
  }, 0);
  const kIds = nextIds('K', existingKIds, totalNodeDeltas);
  let kIdx = 0;
  // Remap worldDelta node IDs
  for (const scene of scenes) {
    for (const km of scene.worldDeltas) {
      for (const node of km.addedNodes ?? []) {
        node.id = kIds[kIdx++];
      }
    }
  }
  // Remap new entity world node IDs
  for (const scene of scenes) {
    for (const c of scene.newCharacters ?? []) {
      if (c.world?.nodes) {
        const remappedNodes: typeof c.world.nodes = {};
        for (const [, node] of Object.entries(c.world.nodes)) {
          const newId = kIds[kIdx++];
          remappedNodes[newId] = { ...node, id: newId };
        }
        c.world.nodes = remappedNodes;
      }
    }
    for (const l of scene.newLocations ?? []) {
      if (l.world?.nodes) {
        const remappedNodes: typeof l.world.nodes = {};
        for (const [, node] of Object.entries(l.world.nodes)) {
          const newId = kIds[kIdx++];
          remappedNodes[newId] = { ...node, id: newId };
        }
        l.world.nodes = remappedNodes;
      }
    }
    for (const a of scene.newArtifacts ?? []) {
      if (a.world?.nodes) {
        const remappedNodes: typeof a.world.nodes = {};
        for (const [, node] of Object.entries(a.world.nodes)) {
          const newId = kIds[kIdx++];
          remappedNodes[newId] = { ...node, id: newId };
        }
        a.world.nodes = remappedNodes;
      }
    }
  }

  // Fix thread log node IDs to be unique and sequential
  const existingTkIds = Object.values(narrative.threads).flatMap((t) => Object.keys(t.threadLog?.nodes ?? {}));
  const totalLogNodes = scenes.reduce((sum, s) => sum + (s.threadDeltas ?? []).reduce((ns, tm) => ns + (tm.addedNodes?.length ?? 0), 0), 0);
  const tkIds = nextIds('TK', existingTkIds, totalLogNodes);
  let tkIdx = 0;
  for (const scene of scenes) {
    for (const tm of scene.threadDeltas ?? []) {
      for (const node of tm.addedNodes ?? []) {
        node.id = tkIds[tkIdx++];
      }
    }
  }

  // Sanitize and re-ID system knowledge deltas. Concept-based resolution
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
    if (!scene.systemDeltas) {
      scene.systemDeltas = { addedNodes: [], addedEdges: [] };
    }
    scene.systemDeltas.addedNodes = scene.systemDeltas.addedNodes ?? [];
    scene.systemDeltas.addedEdges = scene.systemDeltas.addedEdges ?? [];
    // Resolve concepts: existing wins, then within-scene dupes collapse,
    // then genuinely new concepts get fresh SYS-XX ids.
    const resolved = resolveSystemConceptIds(
      scene.systemDeltas.addedNodes,
      cumulativeWkNodes,
      allocateFreshWkId,
    );
    Object.assign(wkIdMap, resolved.idMap);
    scene.systemDeltas.addedNodes = resolved.newNodes;
    for (const n of resolved.newNodes) {
      cumulativeWkNodes[n.id] = n;
      validWKIds.add(n.id);
    }
    // Remap edge references using the cumulative map (LLM GEN ids, prior-
    // scene real ids, and existing graph ids all pass through correctly).
    scene.systemDeltas.addedEdges = scene.systemDeltas.addedEdges.map((edge) => ({
      from: wkIdMap[edge.from] ?? edge.from,
      to: wkIdMap[edge.to] ?? edge.to,
      relation: edge.relation,
    }));
    // Centralised sanitization: self-loops, orphans, cross-scene dupes, bad fields
    sanitizeSystemDelta(scene.systemDeltas, validWKIds, seenWkEdgeKeys);
  }

  const newSceneIds = scenes.map((s) => s.id);
  const newDevelops = [...new Set(scenes.flatMap((s) => s.threadDeltas.map((tm) => tm.threadId)))];
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
  }

  return { scenes, arc };
}

/**
 * Phase 1 — fact extraction. Reads the scene's own structural data (summary,
 * deltas, new entities, events) and returns the minimum set of compulsory
 * propositions the scene must land. Scene-only context; no narrative history.
 */
async function extractCompulsoryPropositions(
  narrative: NarrativeState,
  scene: Scene,
  onReasoning: ((token: string) => void) | undefined,
  reasoningBudget: number | undefined,
): Promise<Proposition[]> {
  const systemPrompt = `You are a scene fact-extractor. Read the scene's structural data (summary, deltas, new entities, events) and return the COMPLETE set of compulsory propositions the scene must land.

A compulsory proposition is a fact the prose MUST establish for the scene to count as having happened. Not atmosphere. Not craft flourish. The discrete, checkable claims a reader must come away believing.

THOROUGHNESS — every structural element in the scene data maps to at least one proposition. Walk through the data and confirm you've covered:
  - summary → any commitments the summary makes that aren't yet captured by deltas below
  - each threadDelta → one proposition for the narrative fact that moved the thread (use the thread's description and addedNodes as anchors)
  - each worldDelta → one proposition per addedNode, framed in present-tense state ("X now Y")
  - systemDelta addedNodes → the world rule/principle surfaced
  - relationshipDeltas → the concrete shift ("A now distrusts B")
  - ownershipDeltas → the transfer fact
  - tieDeltas → the tie established or severed
  - artifactUsages → what the artifact did
  - characterMovements → the arrival/departure fact
  - events → any fact the event tag implies that isn't already captured
  - new-characters / new-locations / new-artifacts / new-threads → that this entity now exists, plus one proposition per meaningful world-node they carry in
Completeness matters more than minimalism. A missed delta becomes a continuity hole in later scenes.

DO NOT deduplicate across delta types — each delta is its own commitment even if the surface wording overlaps.
DO NOT include sensory texture, weather, or obvious background.
DO NOT impose an ordering — emit propositions grouped by source for clarity; reordering for prose effect is the planner's job.

Return ONLY JSON: { "propositions": [{"content": "...", "type": "..."}, ...] }
Type is a free label (event, state, rule, relation, secret, goal, transfer, tie, movement, emergence…). Each proposition should be a single complete sentence stating one fact.`;

  const userPrompt = `${sceneContext(narrative, scene)}\n\nExtract every compulsory proposition from the scene above. Walk through every block of the XML; no structural element goes uncovered.`;

  const raw = onReasoning
    ? await callGenerateStream(userPrompt, systemPrompt, () => {}, MAX_TOKENS_SMALL, 'generateScenePlan.extractPropositions', GENERATE_MODEL, reasoningBudget, onReasoning)
    : await callGenerate(userPrompt, systemPrompt, MAX_TOKENS_SMALL, 'generateScenePlan.extractPropositions', GENERATE_MODEL, reasoningBudget);

  const parsed = parseJson(raw, 'generateScenePlan.extractPropositions') as { propositions?: unknown[] };
  return parsePropositions(Array.isArray(parsed.propositions) ? parsed.propositions : []);
}

/**
 * Phase 2 — plan construction. Enrich and order the compulsory propositions
 * into a beat plan using the full narrative context. Emits varied mechanisms
 * so the scene breathes — follows a Markov-sampled beat sequence when the
 * narrative has one, otherwise composes freely.
 */
async function constructBeatPlan(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  compulsoryPropositions: Proposition[],
  guidance: string | undefined,
  onReasoning: ((token: string) => void) | undefined,
  reasoningBudget: number | undefined,
): Promise<BeatPlan> {
  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const storySettings: StorySettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };

  // Previous scene continuity — final few beats + ending beat type
  const prevSceneKey = sceneIdx > 0 ? resolvedKeys[sceneIdx - 1] : null;
  const prevScene = prevSceneKey ? narrative.scenes[prevSceneKey] : null;
  const prevPlan = prevScene?.planVersions?.[prevScene.planVersions.length - 1]?.plan;
  const adjacentBlock = prevPlan
    ? `PREVIOUS SCENE ends with: ${prevPlan.beats.slice(-3).map((b) => `[${b.fn}:${b.mechanism}] ${b.what}`).join(', ')}`
    : '';

  // Optional Markov beat sequence — when the narrative has a sampler, use it
  // as a rhythm hint. When it doesn't, let the LLM compose freely using the
  // full beat-function + mechanism taxonomy (shipped in the system prompt).
  const beatSequenceHint = (() => {
    if (storySettings.useBeatChain === false) return '';
    const sampler = resolveSampler(narrative);
    if (!sampler) return '';
    const suggested = Math.max(3, Math.min(compulsoryPropositions.length, 10));
    const sampled = sampleBeatSequence(sampler, suggested, prevPlan?.beats?.at(-1)?.fn);
    return `\nSUGGESTED BEAT RHYTHM (${suggested} beats — use as a pacing hint, deviate when the scene calls for it):\n${sampled.map((b, i) => `  ${i + 1}. ${b.fn}:${b.mechanism}`).join('\n')}\n`;
  })();

  const compulsoryBlock = compulsoryPropositions.length > 0
    ? `\nCOMPULSORY PROPOSITIONS — the prose MUST transmit every one of these facts. They are what the scene commits to.

The list below is in EXTRACTION ORDER (grouped by structural source). Extraction order is NOT delivery order. Your job:

  1. COVERAGE — every proposition lands in some beat. None dropped.
  2. REORDER — sequence them for maximum narrative effect. Late reveals, early hooks, payoff after setup, interleaved lines of action. The order on the page is a craft decision; the extraction order is just a checklist.
  3. GLUE — where the narrative context shows a gap (a relationship the reader hasn't seen recently, a rule about to be invoked, a memory that frames a moment), add a small number of glue propositions from the narrative context to bridge. Glue enriches; it does not replace.
  4. GROUP — multiple propositions can share a beat when they deliver together (a single dialogue exchange can carry three thread moves). Don't force 1:1.

DELIVERY — prose style follows the PROSE PROFILE above, not a rigid order. The profile decides whether propositions are demonstrated, stated, or imaged; the plan just says WHERE in the scene each lands and WHICH mechanism carries it.

Compulsory propositions (extraction order, group by blank line for readability):

${compulsoryPropositions
      .map((p, i) => `${i + 1}. ${p.content}${p.type ? ` [${p.type}]` : ''}`)
      .join('\n')}\n`
    : '';

  const profileBlock = `\n${buildProseProfile(resolveProfile(narrative))}${beatSequenceHint}\n`;
  const systemPrompt = buildScenePlanSystemPrompt()
    + (() => {
      const parts = [narrative.storySettings?.planGuidance?.trim(), guidance?.trim()].filter(Boolean);
      return parts.length > 0 ? `\n\nPLAN GUIDANCE:\n${parts.join('\n')}` : '';
    })();

  const prompt = `${profileBlock}NARRATIVE CONTEXT:\n${narrativeContext(narrative, resolvedKeys, contextIndex)}
${buildThreadHealthPrompt(narrative, resolvedKeys, contextIndex) ? `\n${buildThreadHealthPrompt(narrative, resolvedKeys, contextIndex)}\n` : ''}${buildCompletedBeatsPrompt(narrative, resolvedKeys, contextIndex) ? `\n${buildCompletedBeatsPrompt(narrative, resolvedKeys, contextIndex)}\n` : ''}${adjacentBlock ? `${adjacentBlock}\n\n` : ''}
SCENE:
${sceneContext(narrative, scene)}
${compulsoryBlock}
Generate a beat plan that GLUES the compulsory propositions into the narrative flow: reordered for effect, enriched with bridge propositions drawn from the narrative context where continuity calls for them, grouped into beats, and paced with varied mechanisms. Coverage is non-negotiable; the ORDERING and GROUPING are your craft decisions. Prose delivery will follow the prose profile — your job is the skeleton, not the voice.`;

  const raw = onReasoning
    ? await callGenerateStream(prompt, systemPrompt, () => {}, MAX_TOKENS_SMALL, 'generateScenePlan', GENERATE_MODEL, reasoningBudget, onReasoning)
    : await callGenerate(prompt, systemPrompt, MAX_TOKENS_SMALL, 'generateScenePlan', GENERATE_MODEL, reasoningBudget);

  const parsed = parseJson(raw, 'generateScenePlan') as { beats?: unknown[] };
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
  return { beats };
}

export async function generateScenePlan(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  onReasoning?: (token: string) => void,
  onMeta?: (meta: { compulsoryCount: number }) => void,
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

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;

  // ── Phase 1 — extract compulsory propositions from scene structure ──
  const compulsoryPropositions = await extractCompulsoryPropositions(narrative, scene, onReasoning, reasoningBudget);
  onMeta?.({ compulsoryCount: compulsoryPropositions.length });
  logInfo('Compulsory propositions extracted', {
    source: 'plan-generation',
    operation: 'extract-propositions',
    details: { sceneId: scene.id, count: compulsoryPropositions.length },
  });

  // ── Phase 2 — enrich and order into a full beat plan ────────────────
  const result = await constructBeatPlan(
    narrative, scene, resolvedKeys, compulsoryPropositions, guidance, onReasoning, reasoningBudget,
  );

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
  }

  logInfo('Completed beat plan generation', {
    source: 'plan-generation',
    operation: 'generate-plan-complete',
    details: {
      narrativeId: narrative.id,
      sceneId: scene.id,
      beatsGenerated: result.beats.length,
      totalPropositions: result.beats.reduce((sum, b) => sum + b.propositions.length, 0),
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

  const systemPrompt = buildBeatAnalystSystemPrompt(chunks.length);

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


  const systemPrompt = buildScenePlanEditSystemPrompt(narrative.title);

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

  // Build prose profile block
  const profileSection = proseProfile
    ? `\n\n${buildProseProfile(proseProfile)}`
    : '';

  const hasVoiceOverride = !!narrative.storySettings?.proseVoice?.trim();
  const proseFormat = narrative.storySettings?.proseFormat ?? 'prose';
  const formatInstructions = FORMAT_INSTRUCTIONS[proseFormat];

  // System prompt is minimal — style constraints moved to user prompt for stronger compliance
  const systemPrompt = buildSceneProseSystemPrompt({
    formatInstructions,
    narrativeTitle: narrative.title,
    worldSummary: narrative.worldSummary,
    proseVoiceOverride: hasVoiceOverride ? narrative.storySettings!.proseVoice! : undefined,
    direction: guidance,
  });

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
- dialogue → a substantive EXCHANGE of quoted speech between characters. A dialogue beat is NOT a single line with a tag. Unfold it: at least 3–5 turns, distinct voices, subtext (what is NOT said), interruptions or silences that carry weight, non-verbal business (glances, gestures, pauses) interleaved between lines. Dialogue carries the bulk of the beat's word budget. A "dialogue" beat that resolves in one or two quoted sentences has failed the mechanism — either expand it into a real conversation or switch the mechanism. In dramatic registers, dialogue is where character and conflict live; treat it accordingly.

  WORKED EXAMPLE — beat: "Shen Lin confronts Meng Song about the missing ledger"

  FAILURE (one-line exchange, mechanism collapsed):
    Shen Lin demanded to know where the ledger was. "Don't play dumb," he said. Meng Song shrugged. "I have no idea what you're talking about."

  SUCCESS (multi-turn exchange, subtext, non-verbal business, distinct voices):
    "The ledger." Shen Lin didn't sit. He set his palms flat on the table, as though the wood might lie if he didn't hold it down. "The one from the eastern storehouse."
    Meng Song looked up from his tea. "You'll have to be more specific. I've signed off on four ledgers this week."
    "You know which one."
    "I know which one you've been losing sleep over." Meng Song tilted the cup, watched a leaf fold in on itself. "That's a different question."
    Silence. Outside, a guard's footfall receded down the corridor, then returned, paused, moved on.
    "If the inspector finds discrepancies —"
    "He won't." Meng Song set the cup down. His fingers were steady. "Because the ledger he sees will be the correct one." A small, almost fond smile. "I thought you trusted me, Shen Lin."
    Shen Lin's palms left marks on the wood. He didn't answer. He didn't need to.

  Notice the elements: each character has a distinct cadence (Shen Lin clipped, Meng Song elliptical); the subtext (accusation, evasion, power inversion) is carried by what is implied rather than stated; the non-verbal business (palms on table, the tea leaf, the footsteps outside, the withheld answer) does as much work as the quoted lines; the silence at the midpoint is a turn. THIS is a dialogue beat. Aim for this level of density and texture whenever dialogue is the declared mechanism — adapted, of course, to the prose profile's register and voice.
- thought → internal monologue, POV character's private reasoning
- action → physical movement, gesture, interaction with objects
- environment → setting, weather, sensory details of the space
- narration → authorial voice, rhetoric, time compression
- memory → flashback triggered by association
- document → embedded text (letter, sign, excerpt) shown literally
- comic → humor, irony, absurdity, undercut expectations

PROPOSITIONS are facts the scene must establish. The mode of transmission is dictated by the declared register:
- In dramatic-realist registers, prefer demonstration over verbatim assertion. Proposition: "Mist covers the village" → transmit via sensory detail (dampness on skin, visibility reduced), action (houses emerge from whiteness), or environment description — not as a flat declaration.
- In lyric, mythic, fabulist, aphoristic, omniscient, or essayistic registers, direct statement is legitimate and sometimes primary. "Mist covered the village, and the village stopped speaking of its dead." is a valid transmission in those registers.
- In declarative / expository registers (essay, research, memoir at distance), propositions can be stated, attributed, and grounded — "The research shows X" is the point, not a failure.
- The reader comes to hold the fact as true. How that holding is earned is register-dependent.

RHYTHM & VOICE — the prose profile is law; the defaults below apply only when the profile is silent:
- Where the profile specifies a rhythm (terse, flowing, periodic, cumulative, incantatory, monotonic-by-design, fragmented, staccato), obey the profile. Hemingway and Saramago have opposite rhythms and both are correct.
- Default (profile silent): vary sentence length — short for impact, long for flow, fragments for urgency; avoid inertial subject-verb-object patterns; front-load clauses, use appositives, embed dependent clauses.
- Match the register declared in the prose profile. In dramatic registers, avoid writing like technical documentation. In essayistic, scholarly, or reportorial registers, exposition IS the register — it is a failure only when it displaces a declared dramatic register.

SHOW, DON'T TELL — default for dramatic registers, adjustable by profile:
- In dramatic registers: prefer demonstration over explanation. Show fear through trembling hands, not "He felt fear". Demonstrate themes through events rather than declaring them. Reveal system knowledge through demonstration, dialogue discovery, or consequence rather than narrator exposition.
- In essayistic, mythic, oracular, auto-theoretical, omniscient, memoiristic, or oral-epic registers: narrator commentary, named emotion, direct thematic statement, and expository paragraphs are legitimate primary tools. Borges tells. Tolstoy's essay-chapters tell. Sebald tells. Rushdie's openings address the reader. When the profile declares such a register, "showing" is still earned through particulars (specific image, specific claim, specific citation), but the prohibition against direct statement is lifted.
- Universal across registers: vagueness is the real failure. "She felt something shift" is weak in every register; "She named the thing that shifted" is strong in reflective registers; "Her hands would not stop" is strong in dramatic registers. The test is specificity, not the verb.

THREE CONTINUITY CONSTRAINTS — the prose honours all three. The *mode* of honouring them is dictated by the declared register, not by a single craft doctrine:
1. WORLD: the POV perceives only what its senses and existing knowledge allow. New world deltas arrive through specific moments in the scene; they are not referenced before they have been established. (In dramatic registers this is "discovery through action"; in essayistic or omniscient registers it is "the narrator introduces it here for the first time, with evidence".)
2. THREADS: each thread shift lands at a specific moment in the scene. In dramatic registers that moment is usually dramatised through action; in reflective, essayistic, or lyric registers it may be named, stated, or imaged — whatever the profile calls for.
3. SYSTEM: new system concepts arrive with grounding — a demonstration, a citation, a consequence, a worked example, or a framing that earns them. What counts as "earning" is register-dependent.

BEAT SIZING — EACH BEAT IS A ~${WORDS_PER_BEAT}-WORD CHUNK OF PROSE. The plan was built on this convention: every beat is allocated roughly ${WORDS_PER_BEAT} words so beat weight stays consistent across the work.
- Write each beat at approximately ${WORDS_PER_BEAT} words of prose. A light beat may land at ~${Math.round(WORDS_PER_BEAT * 0.7)}; a dense dialogue or action beat with many propositions may stretch to ~${Math.round(WORDS_PER_BEAT * 1.3)}. Treat this as the rhythm budget, not a hard cap.
- The plan has already balanced proposition load across beats assuming this size. If a beat carries 4 propositions, it needs ~${WORDS_PER_BEAT} words to land all four with texture; compressing into 40 words will drop or flatten them. Expanding into 200 words will bloat the rhythm and push the scene long.
- Consistency matters. A ~${Math.round(WORDS_PER_BEAT * 0.5)}-word beat followed by a ~${WORDS_PER_BEAT * 2}-word beat reads as broken rhythm. Keep consecutive beats comparable in length unless the plan's mechanism/function explicitly calls for contrast.
- Brevity is still a virtue — do not pad to hit the target. If a beat can honestly deliver its propositions in fewer words, write fewer words. Just do not cut propositions to fit.

Satisfy every logical requirement and achieve every proposition in whatever mode the profile declares.

PROSE PROFILE COMPLIANCE: every sentence conforms to the voice, register, devices, and rules declared above. If the profile forbids figurative language, use zero figures of speech. If it requires specific devices, use them. The profile is the authorial voice — match it.`
    : `RHYTHM & VOICE — the prose profile is law; the defaults below apply only when the profile is silent:
- Where the profile specifies a rhythm, obey the profile. Register and stance from PROSE PROFILE above take precedence over the defaults here.
- Default (profile silent): vary sentence length, front-load clauses, use appositives, vary structure.
- Match the register declared in the prose profile. In dramatic registers, avoid documentation-tone. In essayistic or scholarly registers, exposition IS the register.

SHOW, DON'T TELL — default for dramatic registers, adjustable by profile:
- In dramatic registers: prefer demonstration over explanation — show through body language, action, dialogue subtext; demonstrate themes through events.
- In essayistic, mythic, oracular, omniscient, memoiristic, auto-theoretical, or oral-epic registers: narrator commentary, named emotion, direct thematic statement, and expository paragraphs are legitimate primary tools when the profile declares such a register.
- Universal across registers: vagueness is the real failure. Specificity — a named image, a named claim, a named source — is strong in every register.

THREE CONTINUITY CONSTRAINTS — the prose honours all three. The mode of honouring them is dictated by the declared register:
1. WORLD: the POV perceives only what its senses and existing knowledge allow. New world deltas arrive through specific moments in the scene; they are not referenced before they have been established.
2. THREADS: each thread shift lands at a specific moment in the scene. In dramatic registers the shift is usually dramatised; in reflective, essayistic, or lyric registers it may be named, stated, or imaged.
3. SYSTEM: new system concepts arrive with grounding appropriate to the register — demonstration, citation, consequence, worked example, or named framing.

Render every thread shift, world change, relationship delta, and system reveal in the mode the profile declares. Foreshadow through imagery, subtext, or explicit framing as the profile prefers.

BEAT SIZING — EVEN WITHOUT A PLAN, THINK IN ~${WORDS_PER_BEAT}-WORD BEATS. The scene should read as a sequence of beats of roughly consistent weight — one beat ≈ one paragraph or tight scene moment, ≈${WORDS_PER_BEAT} words. This keeps rhythm even and propositions evenly distributed. No fixed floor, no padding — but if you find a single beat running past ~${WORDS_PER_BEAT * 2} words, it is probably two beats.

PROSE PROFILE COMPLIANCE: every sentence conforms to the declared voice, register, devices, and rules. If the profile forbids figures of speech, use zero. If it requires specific devices, use them.`;

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
    const embeddings = await generateEmbeddings([result.prose], narrative.id);
    proseEmbedding = embeddings[0];
  }

  return { ...result, proseEmbedding };
}

// ── Shared Helpers ───────────────────────────────────────────────────────────

/** Sanitize hallucinated IDs in generated scenes — filter out invalid references instead of crashing. */
export function sanitizeScenes(scenes: Scene[], narrative: NarrativeState, label: string): void {
  const validCharIds = new Set(Object.keys(narrative.characters));
  const validLocIds = new Set(Object.keys(narrative.locations));
  const validThreadIds = new Set(Object.keys(narrative.threads));
  // Pre-compute the union of WK node ids across the whole batch so that a
  // scene-2 edge referencing a scene-1 SYS-GEN-* id is not treated as orphaned.
  // The later concept-resolution pass in generateScenes remaps those GEN ids
  // to real SYS-XX ids using a cumulative map.
  const batchWkNodeIds = new Set<string>(Object.keys(narrative.systemGraph?.nodes ?? {}));
  for (const s of scenes) {
    for (const n of s.systemDeltas?.addedNodes ?? []) {
      if (n?.id) batchWkNodeIds.add(n.id);
    }
  }
  const validArtifactIds = new Set(Object.keys(narrative.artifacts ?? {}));
  const allEntityIds = new Set([...validCharIds, ...validLocIds, ...validArtifactIds]);
  const stripped: string[] = [];
  const fallbackCharId = Object.keys(narrative.characters)[0];

  // ── First pass: register introduced entities across every scene ──
  // Must happen BEFORE reference validation so that participantIds /
  // povId / worldDeltas / etc. referencing a freshly-introduced entity
  // don't get stripped as "invalid".
  for (const scene of scenes) {
    if (Array.isArray(scene.newCharacters)) {
      scene.newCharacters = scene.newCharacters.filter((c) => {
        if (!c.id || !c.name || !c.role) {
          stripped.push(`newCharacter missing required fields in scene ${scene.id}`);
          return false;
        }
        if (validCharIds.has(c.id)) {
          stripped.push(`newCharacter "${c.id}" collides with existing character in scene ${scene.id}`);
          return false;
        }
        return true;
      }).map((c) => {
        const validRoles: Character['role'][] = ['anchor', 'recurring', 'transient'];
        const role: Character['role'] = validRoles.includes(c.role)
          ? c.role
          : 'transient';
        if (role !== c.role) {
          stripped.push(`newCharacter "${c.id}" role coerced to "transient" in scene ${scene.id}`);
        }
        const world = c.world ?? { nodes: {}, edges: [] };
        if (Object.keys(world.nodes).length === 0) {
          stripped.push(`newCharacter "${c.id}" introduced with empty world in scene ${scene.id}`);
        }
        const cleaned: Character = {
          id: c.id,
          name: c.name,
          role,
          threadIds: c.threadIds ?? [],
          world,
          ...(c.imagePrompt ? { imagePrompt: c.imagePrompt } : {}),
          ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
        };
        return cleaned;
      });
      for (const c of scene.newCharacters) {
        validCharIds.add(c.id);
        allEntityIds.add(c.id);
      }
      if (scene.newCharacters.length === 0) delete scene.newCharacters;
    }
    if (Array.isArray(scene.newLocations)) {
      scene.newLocations = scene.newLocations.filter((l) => {
        if (!l.id || !l.name) {
          stripped.push(`newLocation missing required fields in scene ${scene.id}`);
          return false;
        }
        if (validLocIds.has(l.id)) {
          stripped.push(`newLocation "${l.id}" collides with existing location in scene ${scene.id}`);
          return false;
        }
        if (l.parentId && !validLocIds.has(l.parentId)) {
          stripped.push(`newLocation "${l.id}" has invalid parentId "${l.parentId}" in scene ${scene.id}`);
          l.parentId = null;
        }
        return true;
      }).map((l) => {
        const legacy = l as LocationEntity & { prominence?: string };
        const validProminences: LocationProminence[] = ['domain', 'place', 'margin'];
        const prominence: LocationProminence = validProminences.includes(legacy.prominence as LocationProminence)
          ? (legacy.prominence as LocationProminence)
          : 'place';
        if (prominence !== legacy.prominence) {
          stripped.push(`newLocation "${l.id}" prominence coerced to "place" in scene ${scene.id}`);
        }
        const world = l.world ?? { nodes: {}, edges: [] };
        if (Object.keys(world.nodes).length === 0) {
          stripped.push(`newLocation "${l.id}" introduced with empty world in scene ${scene.id}`);
        }
        const cleaned: LocationEntity = {
          id: l.id,
          name: l.name,
          prominence,
          parentId: l.parentId ?? null,
          tiedCharacterIds: l.tiedCharacterIds ?? [],
          threadIds: l.threadIds ?? [],
          world,
          ...(l.imagePrompt ? { imagePrompt: l.imagePrompt } : {}),
          ...(l.imageUrl ? { imageUrl: l.imageUrl } : {}),
        };
        return cleaned;
      });
      for (const l of scene.newLocations!) {
        validLocIds.add(l.id);
        allEntityIds.add(l.id);
      }
      if (scene.newLocations!.length === 0) delete scene.newLocations;
    }
    if (Array.isArray(scene.newArtifacts)) {
      scene.newArtifacts = scene.newArtifacts.filter((a) => {
        if (!a.id || !a.name) {
          stripped.push(`newArtifact missing required fields in scene ${scene.id}`);
          return false;
        }
        if (validArtifactIds.has(a.id)) {
          stripped.push(`newArtifact "${a.id}" collides with existing artifact in scene ${scene.id}`);
          return false;
        }
        return true;
      }).map((a) => {
        const validSignificances: Artifact['significance'][] = ['key', 'notable', 'minor'];
        const significance: Artifact['significance'] = validSignificances.includes(a.significance)
          ? a.significance
          : 'minor';
        if (significance !== a.significance) {
          stripped.push(`newArtifact "${a.id}" significance coerced to "minor" in scene ${scene.id}`);
        }
        const world = a.world ?? { nodes: {}, edges: [] };
        if (Object.keys(world.nodes).length === 0) {
          stripped.push(`newArtifact "${a.id}" introduced with empty world in scene ${scene.id}`);
        }
        const cleaned: Artifact = {
          id: a.id,
          name: a.name,
          significance,
          parentId: a.parentId ?? null,
          threadIds: a.threadIds ?? [],
          world,
          ...(a.imagePrompt ? { imagePrompt: a.imagePrompt } : {}),
          ...(a.imageUrl ? { imageUrl: a.imageUrl } : {}),
        };
        return cleaned;
      });
      for (const a of scene.newArtifacts) {
        validArtifactIds.add(a.id);
        allEntityIds.add(a.id);
      }
      if (scene.newArtifacts.length === 0) delete scene.newArtifacts;
    }
    if (Array.isArray(scene.newThreads)) {
      scene.newThreads = scene.newThreads.filter((t) => {
        if (!t.id || !t.description) {
          stripped.push(`newThread missing required fields in scene ${scene.id}`);
          return false;
        }
        if (validThreadIds.has(t.id)) {
          stripped.push(`newThread "${t.id}" collides with existing thread in scene ${scene.id}`);
          return false;
        }
        return true;
      }).map((t) => {
        // ThreadParticipant only has {id, type}. Canonicalise to drop any
        // extra fields the LLM emits (e.g. a phantom `role` left over from
        // prior schema drafts) and filter against the right entity set per
        // anchor type so dangling ids never reach the narrative.
        const validParticipants = (t.participants ?? []).flatMap((p) => {
          const ok =
            (p.type === 'character' && validCharIds.has(p.id)) ||
            (p.type === 'location' && validLocIds.has(p.id)) ||
            (p.type === 'artifact' && validArtifactIds.has(p.id));
          if (!ok) {
            stripped.push(`newThread "${t.id}" participant ${p.type} "${p.id}" in scene ${scene.id}`);
            return [];
          }
          return [{ id: p.id, type: p.type }];
        });
        return {
          id: t.id,
          description: t.description,
          status: 'latent' as const,
          participants: validParticipants,
          openedAt: t.openedAt ?? scene.id,
          dependents: t.dependents ?? [],
          threadLog: t.threadLog ?? { nodes: {}, edges: [] },
        };
      });
      for (const t of scene.newThreads) {
        validThreadIds.add(t.id);
      }
      if (scene.newThreads.length === 0) delete scene.newThreads;
    }
  }

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
    // A character introduced in this scene is, by definition, participating
    // in it — otherwise the LLM wouldn't have grounds to introduce them. If
    // the LLM omitted them from participantIds, splice them in rather than
    // leaving the scene with a dangling newCharacter that never appears.
    for (const c of scene.newCharacters ?? []) {
      if (!validParticipants.includes(c.id)) {
        validParticipants.push(c.id);
        stripped.push(`newCharacter "${c.id}" auto-added to participantIds in scene ${scene.id}`);
      }
    }
    scene.participantIds = validParticipants.length > 0 ? validParticipants : [fallbackCharId];
    if (!scene.participantIds.includes(scene.povId)) {
      scene.povId = scene.participantIds[0] ?? fallbackCharId;
    }
    if (!Array.isArray(scene.threadDeltas)) scene.threadDeltas = [];
    if (!Array.isArray(scene.worldDeltas)) scene.worldDeltas = [];
    if (!Array.isArray(scene.relationshipDeltas)) scene.relationshipDeltas = [];
    scene.threadDeltas = scene.threadDeltas.filter((tm) => {
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
    for (const tm of scene.threadDeltas) {
      const thread = narrative.threads[tm.threadId];
      const currentStatus = thread?.status ?? 'latent';
      if (!validStatuses.has(tm.from)) {
        stripped.push(`threadDelta "${tm.threadId}" in scene ${scene.id} had invalid from="${tm.from}" — coerced to "${currentStatus}"`);
        tm.from = currentStatus;
      }
      if (!validStatuses.has(tm.to)) {
        stripped.push(`threadDelta "${tm.threadId}" in scene ${scene.id} had invalid to="${tm.to}" — coerced to "${tm.from}" (status-hold)`);
        tm.to = tm.from;
      }
    }
    // Ensure thread log entries have required fields. IDs here are still
    // GEN-* placeholders — downstream remapping assigns real ones. Explicit
    // edges are cleared — the chain is auto-generated by applyThreadDelta.
    // If the LLM omitted addedNodes entirely, synthesize one from the status
    // transition so every threadDelta produces at least one log entry
    // instead of silently dropping the thread's contribution to the log.
    for (const tm of scene.threadDeltas) {
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
        stripped.push(`threadDelta "${tm.threadId}" in scene ${scene.id} missing log entries — synthesized fallback`);
      }
    }
    scene.worldDeltas = scene.worldDeltas.filter((km) => {
      if (!km.entityId) {
        stripped.push(`worldDelta missing entityId in scene ${scene.id}`);
        return false;
      }
      if (allEntityIds.has(km.entityId)) return true;
      stripped.push(`worldDelta entityId "${km.entityId}" in scene ${scene.id}`);
      return false;
    });
    scene.relationshipDeltas = scene.relationshipDeltas.filter((rm) => {
      if (rm.from === rm.to) {
        stripped.push(`relationshipDelta self-loop "${rm.from}" in scene ${scene.id}`);
        return false;
      }
      if (validCharIds.has(rm.from) && validCharIds.has(rm.to)) return true;
      stripped.push(`relationshipDelta "${rm.from}" -> "${rm.to}" in scene ${scene.id}`);
      return false;
    });
    scene.ownershipDeltas = (scene.ownershipDeltas ?? []).filter((om) => {
      // fromId/toId can be null per schema (artifact introduced from nowhere
      // or discarded to nowhere). Only validate non-null ids against the
      // known entity set.
      const fromOk = om.fromId === null || allEntityIds.has(om.fromId);
      const toOk = om.toId === null || allEntityIds.has(om.toId);
      const ok = validArtifactIds.has(om.artifactId) && fromOk && toOk;
      if (!ok) stripped.push(`ownershipDelta "${om.artifactId}" in scene ${scene.id}`);
      return ok;
    });
    if (scene.ownershipDeltas.length === 0) delete scene.ownershipDeltas;
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
    scene.tieDeltas = (scene.tieDeltas ?? []).filter((mm) => {
      const ok = validLocIds.has(mm.locationId) && validCharIds.has(mm.characterId) &&
                 (mm.action === 'add' || mm.action === 'remove');
      if (!ok) stripped.push(`tieDelta "${mm.characterId}" at "${mm.locationId}" in scene ${scene.id}`);
      return ok;
    });
    if (scene.tieDeltas.length === 0) delete scene.tieDeltas;
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

    // (Introduced entities — newCharacters / newLocations / newArtifacts /
    // newThreads — were registered in the first pass above so reference
    // validation earlier in this loop could see them.)

    // Sanitize systemDeltas — ensure arrays exist, nodes have concept+type,
    // edges have valid refs, no self-loops, no intra-scene duplicates.
    if (scene.systemDeltas) {
      const wkm = scene.systemDeltas;
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
      sanitizeSystemDelta(wkm, batchWkNodeIds, new Set<string>());
      if (wkm.addedNodes.length < beforeNodes) {
        stripped.push(`system nodes (${beforeNodes - wkm.addedNodes.length}) missing concept/type in scene ${scene.id}`);
      }
      if (wkm.addedEdges.length < beforeEdges) {
        stripped.push(`system edges (${beforeEdges - wkm.addedEdges.length}) invalid/self-loop/dup in scene ${scene.id}`);
      }
    } else {
      scene.systemDeltas = { addedNodes: [], addedEdges: [] };
    }
    // Ensure worldDeltas have required fields. Node ORDER defines
    // the chain — no explicit edges are stored. Type sanitization in applyWorldDelta.
    scene.worldDeltas = scene.worldDeltas.filter((km) => {
      if (!km.entityId) { stripped.push(`worldDelta missing entityId in scene ${scene.id}`); return false; }
      km.addedNodes = (km.addedNodes ?? []).filter(n => n.content);
      if (km.addedNodes.length === 0) {
        stripped.push(`worldDelta empty (no nodes) in scene ${scene.id}`);
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


