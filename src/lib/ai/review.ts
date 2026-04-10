import type { NarrativeState, StructureReview, ProseEvaluation, ProseSceneEval, PlanEvaluation, PlanSceneEval, SceneEval, SceneVerdict, Scene, Arc, PlanningPhase } from '@/types/narrative';
import { resolveEntry, isScene, REASONING_BUDGETS, DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { callGenerate, callGenerateStream, SYSTEM_PROMPT } from './api';
import { parseJson } from './json';
import { narrativeContext } from './context';
import { buildThreadHealthPrompt, buildCompletedBeatsPrompt } from './prompts';
import { ANALYSIS_MODEL, MAX_TOKENS_DEFAULT, MAX_TOKENS_SMALL, ANALYSIS_TEMPERATURE } from '@/lib/constants';
import { logInfo } from '@/lib/system-logger';
import { resolveProseForBranch, resolvePlanForBranch } from '@/lib/narrative-utils';

/**
 * Review a branch by reading only scene summaries.
 *
 * Produces a per-scene verdict (ok / edit / merge / cut / insert / move) and an overall
 * critique covering structure, pacing, repetition, character arcs, and theme.
 * Designed to be cheap — no prose, no mutations, just summaries + arc names.
 */
export async function reviewBranch(
  narrative: NarrativeState,
  resolvedKeys: string[],
  branchId: string,
  /** Optional external guidance — e.g. paste from ChatGPT, editor notes, specific focus areas */
  guidance?: string,
  /** Stream reasoning tokens as the model thinks */
  onReasoning?: (token: string) => void,
): Promise<StructureReview> {
  logInfo('Starting branch evaluation', {
    source: 'analysis',
    operation: 'evaluate-branch',
    details: {
      narrativeId: narrative.id,
      branchId,
      sceneCount: resolvedKeys.filter(k => { const e = resolveEntry(narrative, k); return e && isScene(e); }).length,
      hasGuidance: !!guidance,
    },
  });

  // Collect scenes with their arc context
  const sceneSummaries: { idx: number; id: string; arc: string; pov: string; location: string; summary: string }[] = [];
  for (let i = 0; i < resolvedKeys.length; i++) {
    const entry = resolveEntry(narrative, resolvedKeys[i]);
    if (!entry || !isScene(entry)) continue;
    const scene = entry as Scene;
    const arc = narrative.arcs[scene.arcId] as Arc | undefined;
    const pov = narrative.characters[scene.povId]?.name ?? scene.povId;
    const location = narrative.locations[scene.locationId]?.name ?? scene.locationId;
    sceneSummaries.push({
      idx: i + 1,
      id: scene.id,
      arc: arc?.name ?? 'standalone',
      pov,
      location,
      summary: scene.summary,
    });
  }

  if (sceneSummaries.length === 0) {
    return {
      id: `EVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: 'No scenes to evaluate.',
      sceneEvals: [],
      repetitions: [],
      thematicQuestion: '',
    };
  }

  // Build a compact scene list — summaries only
  const sceneBlock = sceneSummaries
    .map((s) => `${s.id} | Arc: "${s.arc}" | POV: ${s.pov} | Loc: ${s.location}\n    ${s.summary}`)
    .join('\n────────────────────────────────\n');

  // Thread overview for context
  const threads = Object.values(narrative.threads);
  const threadBlock = threads
    .map((t) => `${t.id}: ${t.description} [${t.status}]`)
    .join('\n');

  const guidanceBlock = guidance?.trim()
    ? `

PRIORITY GUIDANCE FROM THE AUTHOR — These are specific issues the author has identified. You MUST address every point below. For each issue raised, identify the specific scenes affected and flag them as "edit". Your overall critique MUST discuss these issues. Do not ignore any of them.

${guidance.trim()}`
    : '';

  const prompt = `You are a story editor reviewing a complete branch of a serialized narrative. You have ONLY scene summaries — no prose. Your job is to evaluate structural quality.
${guidanceBlock}

TITLE: "${narrative.title}"
DESCRIPTION: ${narrative.description}

THREADS:
${threadBlock}

SCENE SUMMARIES (${sceneSummaries.length} scenes):
${sceneBlock}

Evaluate this branch on these dimensions:

1. **STRUCTURE** — Does the sequence build? Are arcs well-shaped or do they fizzle?
2. **PACING** — Is there breathing room between high-intensity moments? Any flatlines?
3. **REPETITION** — Are beats, locations, or character reactions repeating? Name the stale patterns.
4. **CHARACTER** — Who changes? Who is stuck in a loop? Who appears but does nothing?
5. **THREADS** — Which threads are advancing well? Which are stagnating or being ignored?
6. **THEME** — What is this story about underneath the plot? Is it interrogating anything?

For EACH scene, assign a verdict. These map to concrete operations:
- "ok" — scene works. No changes needed.
- "edit" — scene should exist but needs revision. You may change ANYTHING: POV, location, participants, summary, events, mutations. Use for: wrong POV for this moment, repetitive beats that need variation, weak execution, continuity breaks, scenes that need restructuring while keeping their place in the timeline.
- "merge" — this scene covers the same beat as another and should be ABSORBED into the stronger one. You MUST specify "mergeInto" with the target scene ID. The two become one denser scene. Use when two scenes advance the same thread with similar dramatic shape.
- "cut" — scene is redundant and adds nothing. The story is tighter without it.
- "move" — scene content is correct but it is in the wrong position. You MUST specify "moveAfter" with the scene ID it should follow. The scene is lifted from its current position and re-planted there with NO content changes. Use for sequencing adjustments: a scene that reveals information too early, a drive arriving before its setup, an out-of-order character introduction. Combine with "edit" by using "move" on the scene and a separate "edit" if content also needs changing.
- "insert" — a new scene should be CREATED at this position to fill a pacing gap, advance a stalled thread, or add a missing beat. You MUST specify "insertAfter" with the scene ID it should follow, or "START" to insert before the very first scene. The "reason" field is the generation brief: describe what happens, who is involved, the location, which threads advance, and any specific beats. The "sceneId" should be a placeholder like "INSERT-1", "INSERT-2", etc.

STRUCTURAL OPERATIONS GUIDE:
- If 5 scenes cover the same beat: keep the strongest as "ok", merge 1-2 into it, cut the rest.
- If a thread has 8 scenes but only 3 distinct beats: merge within each beat, cut the remainder.
- If a scene is premature but otherwise good: use "move" to place it after the scene that sets it up.
- If a drive arrives before its setup: "move" the drive to after the setup scene.
- If a scene needs to be BOTH moved AND revised: "move" it to the right position, and also mark it "edit" — wait, these are separate verdicts. Instead: move it, and in the reason note that content also needs changing so the editor can apply a follow-up edit pass.
- If there is a missing transition, an unearned drive, or a thread that needs setup before it pays off: insert a new scene at the right position.
- "mergeInto" must reference a scene that is NOT itself cut/merged/moved.
- "moveAfter" must reference a scene that is NOT itself being cut/merged. It can reference an INSERT placeholder ID if the scene should follow a newly inserted scene.
- Prefer merge over cut when the weaker scene has unique content worth absorbing.
- Prefer move over cut+insert when the scene content is sound — moving preserves the exact prose.
- Use insert sparingly — only when the gap is structural, not cosmetic.

CONTINUITY IS PARAMOUNT. Scenes that contradict established knowledge, misplace characters, or leak information must be flagged — never "ok".

COMPRESSION IS EXPECTED. Most branches benefit from losing 20-40% of their scenes through merges and cuts. Do not preserve scenes out of politeness.

CROSS-SCENE CONSISTENCY — CRITICAL:
All edits are applied in parallel. Each edited scene only sees its own reason — it does NOT see what other scenes are being changed. This means YOU must encode cross-scene continuity into each reason explicitly.

Before writing reasons, mentally map the full set of changes you're proposing and identify causal chains:
1. List every scene getting a non-"ok" verdict.
2. For each such scene, ask: does this change affect something an upstream or downstream scene references? Does it resolve a contradiction that another edit also touches?
3. Write reasons so that each edit is self-sufficient — the scene being edited can be rewritten correctly even without knowing what other scenes look like.

RULES FOR EDIT REASONS:
- If scene A's edit removes, adds, or changes a fact that scene B depends on, scene B's reason MUST say: "Note: [scene A] is being edited to [specific change] — this scene must be consistent with that."
- If two scenes currently contradict each other, decide which edit is authoritative and make the other move to it explicitly in its reason.
- If a scene is being cut or merged, any surviving scene that referenced it must have a reason that accounts for its removal.
- Edit reasons are instructions to a rewriter who cannot see the rest of the branch. Make them complete.

Return JSON:
{
  "overall": "3-5 paragraph critique. Name scenes, characters, patterns. End with the thematic question.",
  "sceneEvals": [
    { "sceneId": "S-001", "verdict": "ok|edit|merge|cut|move|insert", "reason": "For edit: 1-3 sentences instructing the rewriter. For move: one sentence explaining why this position is wrong and where it belongs. For insert: full generation brief. For merge/cut: one sentence.", "mergeInto": "S-002 (merge only)", "moveAfter": "S-003 (move only — exact scene ID this scene should follow)", "insertAfter": "S-004 or START (insert only — scene ID, INSERT placeholder, or START for before first scene)" }
  ],
  "repetitions": ["pattern 1", "pattern 2"],
  "thematicQuestion": "The human question underneath the plot"
}

Every scene must appear in sceneEvals. Use the EXACT scene IDs shown above (e.g. "S-001", not "1" or "scene 1").${guidance?.trim() ? `\n\nREMINDER — The author specifically asked you to address: "${guidance.trim()}". Your overall critique and scene verdicts MUST reflect this. Any scene affected by this guidance MUST NOT be marked "ok".` : ''}`;

  const maxTokens = MAX_TOKENS_DEFAULT;
  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = onReasoning
    ? await callGenerateStream(prompt, SYSTEM_PROMPT, () => {}, maxTokens, 'evaluateBranch', ANALYSIS_MODEL, reasoningBudget, onReasoning, ANALYSIS_TEMPERATURE)
    : await callGenerate(prompt, SYSTEM_PROMPT, maxTokens, 'evaluateBranch', ANALYSIS_MODEL, reasoningBudget, true, ANALYSIS_TEMPERATURE);

  try {
    const parsed = parseJson(raw, 'evaluateBranch') as {
      overall?: string;
      sceneEvals?: { sceneId?: string; verdict?: string; reason?: string; mergeInto?: string; insertAfter?: string; moveAfter?: string }[];
      repetitions?: string[];
      thematicQuestion?: string;
    };

    const validVerdicts = new Set<SceneVerdict>(['ok', 'edit', 'merge', 'cut', 'insert', 'move']);
    const sceneEvals: SceneEval[] = (parsed.sceneEvals ?? [])
      .filter((e) => e.sceneId && (narrative.scenes[e.sceneId] || e.verdict === 'insert'))
      .map((e) => {
        const rawVerdict = e.verdict as string;
        const verdict = validVerdicts.has(rawVerdict as SceneVerdict) ? (rawVerdict as SceneVerdict) : 'ok';
        const eval_: SceneEval = { sceneId: e.sceneId!, verdict, reason: e.reason ?? '' };
        if (verdict === 'merge') {
          const targetEval = parsed.sceneEvals?.find((t) => t.sceneId === e.mergeInto);
          const targetVerdict = targetEval?.verdict;
          const targetInvalid = !e.mergeInto || !narrative.scenes[e.mergeInto]
            || targetVerdict === 'cut' || targetVerdict === 'merge' || targetVerdict === 'move';
          if (targetInvalid) {
            eval_.verdict = 'cut';
            eval_.reason = `${eval_.reason} (merge target invalid or also removed, converted to cut)`;
          } else {
            eval_.mergeInto = e.mergeInto;
          }
        }
        if (verdict === 'insert') {
          eval_.insertAfter = e.insertAfter;
        }
        if (verdict === 'move') {
          eval_.moveAfter = e.moveAfter;
        }
        return eval_;
      });

    const result = {
      id: `EVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: parsed.overall ?? 'Evaluation failed to produce analysis.',
      sceneEvals,
      repetitions: parsed.repetitions ?? [],
      thematicQuestion: parsed.thematicQuestion ?? '',
    };

    logInfo('Completed branch evaluation', {
      source: 'analysis',
      operation: 'evaluate-branch-complete',
      details: {
        narrativeId: narrative.id,
        branchId,
        evaluationId: result.id,
        scenesEvaluated: sceneEvals.length,
        verdictOk: sceneEvals.filter(e => e.verdict === 'ok').length,
        verdictEdit: sceneEvals.filter(e => e.verdict === 'edit').length,
        verdictMerge: sceneEvals.filter(e => e.verdict === 'merge').length,
        verdictCut: sceneEvals.filter(e => e.verdict === 'cut').length,
        verdictInsert: sceneEvals.filter(e => e.verdict === 'insert').length,
        repetitionsFound: result.repetitions.length,
      },
    });

    return result;
  } catch {
    logInfo('Branch evaluation failed to parse', {
      source: 'analysis',
      operation: 'evaluate-branch-parse-error',
      details: {
        narrativeId: narrative.id,
        branchId,
        scenesDefaulted: sceneSummaries.length,
      },
    });
    return {
      id: `EVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: 'Evaluation parse failed. Raw response logged.',
      sceneEvals: sceneSummaries.map((s) => ({ sceneId: s.id, verdict: 'ok' as const, reason: 'Parse failed — defaulted' })),
      repetitions: [],
      thematicQuestion: '',
    };
  }
}

// ── Prose Quality Evaluation ─────────────────────────────────────────────────

export async function reviewProseQuality(
  narrative: NarrativeState,
  resolvedKeys: string[],
  branchId: string,
  guidance?: string,
  onReasoning?: (token: string) => void,
): Promise<ProseEvaluation> {
  // Collect scenes that have prose (using resolved versions)
  const branches = narrative.branches;
  const scenesWithProse: { id: string; pov: string; location: string; summary: string; prose: string; wordCount: number }[] = [];
  for (const key of resolvedKeys) {
    const entry = resolveEntry(narrative, key);
    if (!entry || !isScene(entry)) continue;
    const scene = entry as Scene;
    const { prose } = resolveProseForBranch(scene, branchId, branches);
    if (!prose) continue;
    scenesWithProse.push({
      id: scene.id,
      pov: narrative.characters[scene.povId]?.name ?? scene.povId,
      location: narrative.locations[scene.locationId]?.name ?? scene.locationId,
      summary: scene.summary,
      prose,
      wordCount: prose.split(/\s+/).length,
    });
  }

  if (scenesWithProse.length === 0) {
    return {
      id: `PEVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: 'No scenes with prose to evaluate.',
      sceneEvals: [],
      patterns: [],
    };
  }

  // Build prose profile context
  const profile = narrative.proseProfile;
  const profileBlock = profile
    ? `PROSE PROFILE (the prose should conform to this voice):
Register: ${profile.register} | Stance: ${profile.stance}${profile.tense ? ` | Tense: ${profile.tense}` : ''}${profile.sentenceRhythm ? ` | Rhythm: ${profile.sentenceRhythm}` : ''}${profile.interiority ? ` | Interiority: ${profile.interiority}` : ''}${profile.dialogueWeight ? ` | Dialogue: ${profile.dialogueWeight}` : ''}
${profile.devices?.length ? `Devices: ${profile.devices.join(', ')}` : ''}
${profile.rules?.length ? `Rules:\n${profile.rules.map((r) => `  - ${r}`).join('\n')}` : ''}${profile.antiPatterns?.length ? `\nAnti-patterns (flag violations):\n${profile.antiPatterns.map((a) => `  ✗ ${a}`).join('\n')}` : ''}`
    : '';

  const guidanceBlock = guidance?.trim()
    ? `\nPRIORITY GUIDANCE FROM THE AUTHOR — You MUST address every point below. For each issue raised, identify the specific scenes affected and flag them as "edit".\n\n${guidance.trim()}`
    : '';

  // Build scene blocks with prose
  const sceneBlocks = scenesWithProse.map((s) =>
    `[${s.id}] POV: ${s.pov} | Loc: ${s.location} | ${s.wordCount} words\nSummary: ${s.summary}\n${s.prose}`
  ).join('\n\n════════════════════════════════\n\n');

  const prompt = `You are a prose editor reviewing the actual written prose of a serialized narrative. You have both summaries and full prose text. Evaluate prose QUALITY — not plot structure.
${guidanceBlock}
${profileBlock ? `\n${profileBlock}\n` : ''}
TITLE: "${narrative.title}"

SCENES WITH PROSE (${scenesWithProse.length} scenes):
${sceneBlocks}

Evaluate the prose on these dimensions:

1. **VOICE CONSISTENCY** — Does the prose match the prose profile? Is the register, rhythm, and interiority consistent?
2. **CRAFT** — Sentence quality, word choice, show-don't-tell, dialogue naturalism, sensory grounding
3. **PACING** — Within-scene pacing. Are beats rushed or drawn out? Does the prose breathe?
4. **CONTINUITY** — Does the prose contradict established facts, character positions, or knowledge?
5. **REPETITION** — Repeated phrases, images, sentence structures, or verbal tics across scenes
6. **PROFILE COMPLIANCE** — If a prose profile is provided, does the prose follow its rules?

For EACH scene, assign a verdict:
- "ok" — prose is strong, no changes needed
- "edit" — prose needs revision. List specific, actionable issues.

Be specific in your issues. Not "dialogue feels off" but "Fang Yuan speaks in elaborate metaphors in lines 3-5, violating the 'plain, forgettable language' rule."

Return JSON:
{
  "overall": "2-4 paragraph prose quality critique. Name specific scenes and quote specific lines.",
  "sceneEvals": [
    { "sceneId": "S-001", "verdict": "ok|edit", "issues": ["specific issue 1", "specific issue 2"] }
  ],
  "patterns": ["recurring prose issue 1", "recurring prose issue 2"]
}

Every scene with prose must appear in sceneEvals. Use the exact scene IDs.${guidance?.trim() ? `\n\nREMINDER — The author specifically asked you to address: "${guidance.trim()}". Your overall critique and scene verdicts MUST reflect this.` : ''}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = onReasoning
    ? await callGenerateStream(prompt, SYSTEM_PROMPT, () => {}, MAX_TOKENS_DEFAULT, 'evaluateProseQuality', ANALYSIS_MODEL, reasoningBudget, onReasoning, ANALYSIS_TEMPERATURE)
    : await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_DEFAULT, 'evaluateProseQuality', ANALYSIS_MODEL, reasoningBudget, true, ANALYSIS_TEMPERATURE);

  try {
    const parsed = parseJson(raw, 'evaluateProseQuality') as {
      overall?: string;
      sceneEvals?: { sceneId?: string; verdict?: string; issues?: string[] }[];
      patterns?: string[];
    };

    const sceneEvals: ProseSceneEval[] = (parsed.sceneEvals ?? [])
      .filter((e) => e.sceneId && scenesWithProse.some((s) => s.id === e.sceneId))
      .map((e) => ({
        sceneId: e.sceneId!,
        verdict: (e.verdict === 'edit' ? 'edit' : 'ok') as ProseSceneEval['verdict'],
        issues: Array.isArray(e.issues) ? e.issues.filter((i): i is string => typeof i === 'string') : [],
      }));

    const result = {
      id: `PEVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: parsed.overall ?? 'Evaluation failed to produce analysis.',
      sceneEvals,
      patterns: parsed.patterns ?? [],
    };

    logInfo('Completed prose quality evaluation', {
      source: 'analysis',
      operation: 'evaluate-prose-complete',
      details: {
        narrativeId: narrative.id,
        branchId,
        evaluationId: result.id,
        scenesEvaluated: sceneEvals.length,
        verdictOk: sceneEvals.filter(e => e.verdict === 'ok').length,
        verdictEdit: sceneEvals.filter(e => e.verdict === 'edit').length,
        patternsFound: result.patterns.length,
      },
    });

    return result;
  } catch {
    return {
      id: `PEVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: 'Prose evaluation parse failed. Raw response logged.',
      sceneEvals: scenesWithProse.map((s) => ({ sceneId: s.id, verdict: 'ok' as const, issues: ['Parse failed — defaulted'] })),
      patterns: [],
    };
  }
}

// ── Plan Quality Evaluation ─────────────────────────────────────────────────

export async function reviewPlanQuality(
  narrative: NarrativeState,
  resolvedKeys: string[],
  branchId: string,
  guidance?: string,
  onReasoning?: (token: string) => void,
): Promise<PlanEvaluation> {
  // Collect scenes that have beat plans
  const sceneList: Scene[] = [];
  for (const key of resolvedKeys) {
    const entry = resolveEntry(narrative, key);
    if (entry && isScene(entry)) sceneList.push(entry as Scene);
  }

  const branches = narrative.branches;
  const scenesWithPlans: { id: string; pov: string; location: string; beats: string }[] = [];
  for (let i = 0; i < sceneList.length; i++) {
    const scene = sceneList[i];
    const plan = resolvePlanForBranch(scene, branchId, branches);
    if (!plan?.beats?.length) continue;
    scenesWithPlans.push({
      id: scene.id,
      pov: narrative.characters[scene.povId]?.name ?? scene.povId,
      location: narrative.locations[scene.locationId]?.name ?? scene.locationId,
      beats: plan.beats.map((b, j) => `  ${j + 1}. [${b.fn}:${b.mechanism}] ${b.what}\n     Props: ${b.propositions.map(p => `"${p.content}"`).join('; ')}`).join('\n'),
    });
  }

  if (scenesWithPlans.length === 0) {
    return {
      id: `PLEVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: 'No scenes with beat plans to evaluate.',
      sceneEvals: [],
      patterns: [],
    };
  }

  const threadBlock = Object.values(narrative.threads)
    .map((t) => `${t.id}: ${t.description} [${t.status}]`).join('\n');

  const charBlock = Object.values(narrative.characters)
    .filter((c) => Object.keys(c.continuity?.nodes ?? {}).length)
    .map((c) => `${c.name}: ${Object.values(c.continuity!.nodes).map((n) => `${n.type}: ${n.content}`).join('; ')}`)
    .join('\n');

  const guidanceBlock = guidance?.trim()
    ? `\nPRIORITY GUIDANCE FROM THE AUTHOR — You MUST address every point below.\n\n${guidance.trim()}`
    : '';

  const sceneBlocks = scenesWithPlans.map((s) =>
    `[${s.id}] POV: ${s.pov} | Loc: ${s.location}\n${s.beats}`
  ).join('\n\n────────────────────────────────\n\n');

  const prompt = `You are a continuity editor reviewing beat plans. Each scene has a beat-by-beat blueprint and declared mutations. Your job: verify the BEATS are internally consistent, cross-scene continuous, and actually deliver the declared mutations.
${guidanceBlock}

TITLE: "${narrative.title}"

THREADS:
${threadBlock}

CHARACTER KNOWLEDGE:
${charBlock || '(none tracked yet)'}

SCENES WITH BEAT PLANS (${scenesWithPlans.length} scenes):
${sceneBlocks}

For each scene, check:
1. **BEAT-TO-MUTATION ALIGNMENT** — Do the beats actually show what the declared mutations claim? If a thread mutation says T-03 escalates, which specific beat delivers that escalation? If no beat does, flag it.
2. **CROSS-PLAN CONTINUITY** — Does this plan's opening beats follow logically from the previous plan's closing beats? Character positions, emotional states, knowledge, injuries.
3. **INTERNAL BEAT LOGIC** — Do beats within the plan follow causally? Does beat 5 depend on something beat 3 established?
4. **CHARACTER KNOWLEDGE** — Does any beat have a character act on information they haven't learned yet in prior scenes or earlier beats?
5. **SPATIAL/TEMPORAL** — Are characters where they should be? Can all beats plausibly occur in one scene?

Verdicts:
- "ok" — beats are consistent, mutations are earned by specific beats
- "edit" — issues found. Each issue must reference a specific beat number and what's wrong.

Be precise: "Beat 4 declares Fang Yuan recognises the seal pattern, but no prior beat or scene establishes he has seen this pattern before" — not "continuity error."

Return JSON:
{
  "overall": "2-3 paragraph analysis focused on beat quality and mutation alignment.",
  "sceneEvals": [
    { "sceneId": "S-001", "verdict": "ok|edit", "issues": ["Beat N: specific issue"] }
  ],
  "patterns": ["recurring issue across multiple plans"]
}

Every scene with a plan must appear.${guidance?.trim() ? `\n\nREMINDER — The author asked you to address: "${guidance.trim()}".` : ''}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = onReasoning
    ? await callGenerateStream(prompt, SYSTEM_PROMPT, () => {}, MAX_TOKENS_DEFAULT, 'evaluatePlanQuality', ANALYSIS_MODEL, reasoningBudget, onReasoning, ANALYSIS_TEMPERATURE)
    : await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_DEFAULT, 'evaluatePlanQuality', ANALYSIS_MODEL, reasoningBudget, true, ANALYSIS_TEMPERATURE);

  try {
    const parsed = parseJson(raw, 'evaluatePlanQuality') as {
      overall?: string;
      sceneEvals?: { sceneId?: string; verdict?: string; issues?: string[] }[];
      patterns?: string[];
    };

    const sceneEvals: PlanSceneEval[] = (parsed.sceneEvals ?? [])
      .filter((e) => e.sceneId && scenesWithPlans.some((s) => s.id === e.sceneId))
      .map((e) => ({
        sceneId: e.sceneId!,
        verdict: (e.verdict === 'edit' ? 'edit' : 'ok') as PlanSceneEval['verdict'],
        issues: Array.isArray(e.issues) ? e.issues.filter((i): i is string => typeof i === 'string') : [],
      }));

    const result = {
      id: `PLEVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: parsed.overall ?? 'Plan evaluation failed.',
      sceneEvals,
      patterns: parsed.patterns ?? [],
    };

    logInfo('Completed plan quality evaluation', {
      source: 'analysis',
      operation: 'evaluate-plan-complete',
      details: {
        narrativeId: narrative.id,
        branchId,
        evaluationId: result.id,
        scenesEvaluated: sceneEvals.length,
        verdictOk: sceneEvals.filter(e => e.verdict === 'ok').length,
        verdictEdit: sceneEvals.filter(e => e.verdict === 'edit').length,
        patternsFound: result.patterns.length,
      },
    });

    return result;
  } catch {
    return {
      id: `PLEVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: 'Plan evaluation parse failed.',
      sceneEvals: scenesWithPlans.map((s) => ({ sceneId: s.id, verdict: 'ok' as const, issues: ['Parse failed'] })),
      patterns: [],
    };
  }
}

// ── Direction Refresh (Course Correction) ─────────────────────────────────────────────────

export async function refreshDirection(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  phase: PlanningPhase,
  currentDirection: string,
  currentConstraints: string,
): Promise<{ direction: string; constraints: string; sceneBudget?: Record<string, number> }> {
  const ctx = narrativeContext(narrative, resolvedKeys, currentIndex);

  const scenesRemaining = phase.sceneAllocation - phase.scenesCompleted;
  const avgArcSize = 4; // typical arc length
  const estimatedArcsRemaining = Math.max(1, Math.ceil(scenesRemaining / avgArcSize));
  const threadHealthBlock = buildThreadHealthPrompt(narrative, resolvedKeys, currentIndex);

  const PACING_DIRECTIVE = `PACING — Bandwidth-based thread management.
- Threads with low activeArcs relative to total arcs are starved — prioritise them for bandwidth in the next arc.
- Each arc should advance at least 1 thread by one lifecycle phase. Arcs that only pulse threads are losing momentum.
- Threads at critical MUST resolve soon. Threads at latent/seeded that remain stale should be discarded or advanced.
- Name specific threads that need bandwidth and what their target lifecycle phase should be.`;

  // Build phase progress block showing what's been completed
  let phaseProgressBlock = '';
  if (phase.sourceText) {
    const completedScenes = resolvedKeys
      .slice(Math.max(0, resolvedKeys.length - 10)) // Last 10 scenes
      .map((key) => {
        const entry = resolveEntry(narrative, key);
        if (!entry || !isScene(entry)) return null;
        const scene = entry as Scene;
        return `${scene.id}: ${scene.summary}`;
      })
      .filter((s): s is string => s !== null);

    if (completedScenes.length > 0) {
      phaseProgressBlock = `PHASE PROGRESS (recent scenes):\n${completedScenes.join('\n')}\n`;
    }
  }

  // Source-text mode: prioritize sequential source material tracking
  // Non-source mode: full analytical review with 9 lenses
  const prompt = phase.sourceText
    ? `${ctx}

An arc just wrapped. You have ${scenesRemaining} scenes left in this phase.

PHASE: "${phase.name}"
PHASE OBJECTIVE: ${phase.objective}
PROGRESS: ${phase.scenesCompleted} / ${phase.sceneAllocation} scenes
${phase.constraints ? `PHASE CONSTRAINTS: ${phase.constraints}` : ''}
${phase.structuralRules ? `STRUCTURAL RULES:\n${phase.structuralRules}` : ''}

SOURCE MATERIAL (the beat sheet for this phase — your primary reference, but not a rigid script):
${phase.sourceText}

${phaseProgressBlock}

${threadHealthBlock}

${buildCompletedBeatsPrompt(narrative, resolvedKeys, currentIndex)}

Your job: figure out where we are in the source material, then write direction for the next arc that ADVANCES through it while addressing any issues in the story so far.

Step 1 — LOCATE THE CURSOR. Read the PHASE PROGRESS scenes above. Identify the LAST source material beat that has been covered. State it explicitly: "The story has reached: [specific source beat]."

Step 2 — GAUGE PACING. There are ${scenesRemaining} scenes left and approximately ${estimatedArcsRemaining} arc(s) remaining in this phase. Your direction covers ONE arc (~${Math.min(scenesRemaining, avgArcSize)} scenes, approximately ${Math.round(100 / estimatedArcsRemaining)}% of remaining source material). Do NOT try to cover everything — leave later beats for the next course correction.
  • If the source has clear chapter/section breaks, one chapter = one arc is a good heuristic.
  • If this is the LAST arc (${estimatedArcsRemaining === 1 ? 'IT IS' : 'it is not'}), cover ALL remaining source material.

Step 3 — IDENTIFY THE NEXT KEY BEATS. Starting AFTER the cursor, select ONLY the next arc's worth of source beats IN SOURCE ORDER. This should be 2-4 key beats, not more. These are what the next arc must hit.

Step 4 — ASSESS THE STORY. Review thread health, character development, and pacing from the scenes so far. Note any issues: stagnant threads, underdeveloped character arcs, missing setup for upcoming beats, or pacing problems. The direction should address these alongside the source beats.

Step 5 — Write the direction, constraints, and scene budget.

RULES:
- The direction REPLACES the current direction entirely. It is a fresh, standalone brief.
- The source material's KEY BEATS must happen in source order. Do not skip or reorder them.
- Between key beats, you have creative flexibility for connective tissue.
- Any beat in PHASE PROGRESS is done. Move forward.
- QUOTE THE SOURCE. The direction is the last thing scene generation sees — it won't see the source text. So copy across anything scene generation needs: prose samples, dialogue snippets, structural techniques (montage, vignettes, timeskip), tone guidance, internal monologue style. If the source says "short titled vignettes, each 200-400 words, covering thirteen months," write that verbatim into the direction.
- Use imperative voice. Use thread IDs alongside character names.

OUTPUT:

- Direction: Write it as if scene generation will ONLY see this text and nothing else. Include the source's own words for any prose style, format, technique, or dialogue guidance. One paragraph per beat, naming POV character, location, participants, and thread transitions.

- Constraints: What MUST NOT happen. Ban re-staging any beat from PHASE PROGRESS. Ban confirmation scenes. Protect threads meant for later phases. Do not contradict the source material.

- Scene budget: For each active thread, how many scenes it should appear in during the next arc.

All three fields MUST be plain strings in the JSON.

Return JSON:
{
  "direction": "prose string — beat-specific scene blueprint for this arc's portion",
  "constraints": "prose string — 3-5 sentences with specific prohibitions",
  "sceneBudget": {"T-XX": 2, "T-YY+T-ZZ": 1}
}`
    : `${ctx}

You are a showrunner reviewing dailies. An arc just wrapped. You have ${scenesRemaining} scenes left in this phase. Your job is to write the updated direction and constraints for the NEXT arc — building on what works, correcting what doesn't.

PHASE: "${phase.name}"
PHASE OBJECTIVE: ${phase.objective}
PROGRESS: ${phase.scenesCompleted} / ${phase.sceneAllocation} scenes
${phase.constraints ? `PHASE CONSTRAINTS: ${phase.constraints}` : ''}
${phase.structuralRules ? `STRUCTURAL RULES (mechanical requirements — audit compliance and enforce in next direction):\n${phase.structuralRules}` : ''}
CURRENT DIRECTION: ${currentDirection || '(none set)'}
CURRENT CONSTRAINTS: ${currentConstraints || '(none set)'}

${threadHealthBlock}

${buildCompletedBeatsPrompt(narrative, resolvedKeys, currentIndex)}

${PACING_DIRECTIVE}

Review the scene history and thread bandwidth report through these lenses:

1. THREAD COMPRESSION AUDIT — For EACH active thread, answer:
   a) How many scenes has this thread appeared in so far?
   b) How many of those scenes changed its status (real transitions vs pulses)?
   c) What is the RATIO of scenes-to-transitions? A healthy ratio is 1:1 to 2:1. A ratio of 5:1 or worse means the thread is bloated — it's appearing in scenes without advancing.
   d) How many more beats (status transitions) does this thread need to reach resolution?
   e) Therefore, how many MORE scenes should this thread appear in? (Answer: same as beats remaining, plus at most 1 setup scene.)
   Name each thread, its ratio, and its scene budget for the next arc. If a thread's ratio is worse than 3:1, the direction MUST either compress it (force a transition) or cut it from the next arc entirely.

2. THREAD BANDWIDTH — Study the bandwidth report above. Which threads have low activeArcs relative to total arcs? Which are starved? Name specific threads, their lifecycle stage, and whether they need bandwidth allocation, advancement, or discarding.

3. CHARACTER COST — Has the protagonist faced a genuine setback they didn't choose? Have secondary characters changed or are they stuck in loops? Name who needs to change and how.

4. RHYTHM — Were the recent scenes all the same density? The next arc needs contrast.

5. FRESHNESS — Are any patterns repeating? Same locations, same character reactions, same beats? Name the stale patterns and ban them. Pay special attention to: characters "watching in horror", characters "attempting to sabotage/intervene" repeatedly, characters having the same confrontation multiple times, investigation scenes that discover "more evidence" without changing the investigator's plan.

6. MOMENTUM — With ${scenesRemaining} scenes left, what MUST happen before this phase ends? Are we on track? If not, which threads can be accelerated and which can be abandoned?

7. ARTIFACTS — Are any existing artifacts being ignored or underused? Should one change hands?

8. STRUCTURAL COMPLIANCE — Audit the recent scenes against the STRUCTURAL RULES above (if any). Are convergence requirements being met? Is drive density on target? Are scene functions varied or repeating? Is protagonist gravity maintained? Name specific violations and what the next arc must do to correct them.

9. THREAD COLLISION OPPORTUNITIES — Which threads share characters, locations, or resources? The next arc's direction should specify at least one scene where two threads collide — characters from different subplots in the same location, forced to deal with each other. This is how you compress: instead of Thread A getting 3 scenes and Thread B getting 3 scenes, you get 3-4 scenes where both advance simultaneously.

CRITICAL OUTPUT RULES:
- The direction you write REPLACES the current direction entirely. It is NOT appended. Write it as a fresh, standalone brief.
- Do NOT restate the previous direction. If the previous direction asked for something and it HAPPENED, move on. If it didn't happen, escalate the ask — don't repeat it.
- PHASE OBJECTIVE ANCHOR: The phase objective above is your north star. Every direction you write must serve that objective. If the objective says "establish the alliance," every arc's direction must either build toward establishing it, deal with obstacles to it, or pay it off. You may adjust tactics (different characters, different mechanisms) but you must NOT drift away from the objective. If the objective is partially achieved, the direction must address the remaining parts.
- Do NOT be analytical or explanatory. This is a directive, not a report. Use imperative voice: "Fang Yuan diverts the grain. Mo Bei Liu calls an emergency session."
- Use thread IDs and target statuses alongside character names — technical precision helps. e.g. "Fang Yuan diverts the grain, pushing T-41 to critical."

Write direction, constraints, and scene budget:

- Direction (3-5 sentences): Imperative orders for the next arc. Each sentence: [Character] [does specific thing] [at specific place] [causing specific consequence] [thread target]. At least one sentence must describe a COLLISION — two threads forced into the same scene.

- Constraints (3-5 sentences): What MUST NOT happen. Ban re-staging or re-confirming any beat already delivered. Ban confirmation scenes. Ban stale patterns. Protect threads meant for later phases. Each constraint must name a specific thread, character, or beat.

- Scene budget (object): For each active thread, how many scenes it should appear in during the next arc. Threads that collide share a budget slot.

All three fields MUST be plain strings in the JSON — never arrays or objects. Write all detail as prose inside the string.

Return JSON:
{
  "direction": "prose string — 3-5 imperative sentences",
  "constraints": "prose string — 3-5 sentences with specific prohibitions",
  "sceneBudget": {"T-XX": 2, "T-YY+T-ZZ": 1}
}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const maxTokens = phase.sourceText ? MAX_TOKENS_DEFAULT : MAX_TOKENS_SMALL;
  const raw = await callGenerate(prompt, SYSTEM_PROMPT, maxTokens, 'refreshDirection', undefined, reasoningBudget);

  try {
    const parsed = parseJson(raw, 'refreshDirection') as { direction?: string; constraints?: string; sceneBudget?: Record<string, number> };
    // Embed scene budget into direction text so it flows through to generateScenes
    // without needing a new StorySettings field
    let direction = parsed.direction ? String(parsed.direction) : currentDirection;
    if (parsed.sceneBudget && Object.keys(parsed.sceneBudget).length > 0) {
      const budgetLines = Object.entries(parsed.sceneBudget)
        .map(([threads, count]) => `  ${threads}: ${count} scene${count !== 1 ? 's' : ''}`)
        .join('\n');
      direction += `\n\nSCENE BUDGET (each thread gets this many scenes — no more):\n${budgetLines}`;
    }

    logInfo('Completed course correction', {
      source: 'auto-play',
      operation: 'refresh-direction-complete',
      details: {
        narrativeId: narrative.id,
        phaseName: phase.name,
        scenesRemaining,
        threadsInBudget: Object.keys(parsed.sceneBudget ?? {}).length,
        directionUpdated: !!parsed.direction,
        constraintsUpdated: !!parsed.constraints,
      },
    });

    return {
      direction,
      constraints: parsed.constraints ? String(parsed.constraints) : currentConstraints,
      sceneBudget: parsed.sceneBudget,
    };
  } catch {
    return { direction: currentDirection, constraints: currentConstraints };
  }
}
