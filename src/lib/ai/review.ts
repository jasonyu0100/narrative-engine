import type { NarrativeState, StructureReview, ProseEvaluation, ProseSceneEval, PlanEvaluation, PlanSceneEval, SceneEval, SceneVerdict, Scene, Arc } from '@/types/narrative';
import { resolveEntry, isScene, REASONING_BUDGETS } from '@/types/narrative';
import { callGenerate, callGenerateStream, SYSTEM_PROMPT } from './api';
import { parseJson } from './json';
import { ANALYSIS_MODEL, MAX_TOKENS_DEFAULT, ANALYSIS_TEMPERATURE } from '@/lib/constants';
import { logInfo } from '@/lib/system-logger';
import { resolveProseForBranch, resolvePlanForBranch } from '@/lib/narrative-utils';
import {
  buildBranchReviewPrompt,
  buildProseReviewPrompt,
  buildPlanReviewPrompt,
} from '@/lib/prompts/review';

/**
 * Review a branch by reading only scene summaries.
 *
 * Produces a per-scene verdict (ok / edit / merge / cut / insert / move) and an overall
 * critique covering structure, pacing, repetition, entity arcs (character arcs in fiction;
 * argument arcs in essay/research), and theme.
 * Designed to be cheap — no prose, no deltas, just summaries + arc names.
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

  const prompt = buildBranchReviewPrompt({
    title: narrative.title,
    description: narrative.description,
    threadBlock,
    sceneBlock,
    sceneCount: sceneSummaries.length,
    guidanceBlock,
    guidance,
  });

  const maxTokens = MAX_TOKENS_DEFAULT;
  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = onReasoning
    ? await callGenerateStream(prompt, SYSTEM_PROMPT, () => {}, maxTokens, 'evaluateBranch', ANALYSIS_MODEL, reasoningBudget, onReasoning, ANALYSIS_TEMPERATURE)
    : await callGenerate(prompt, SYSTEM_PROMPT, maxTokens, 'evaluateBranch', ANALYSIS_MODEL, reasoningBudget, true, ANALYSIS_TEMPERATURE);

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

  const prompt = buildProseReviewPrompt({
    title: narrative.title,
    sceneCount: scenesWithProse.length,
    sceneBlocks,
    profileBlock,
    guidanceBlock,
    guidance,
  });

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = onReasoning
    ? await callGenerateStream(prompt, SYSTEM_PROMPT, () => {}, MAX_TOKENS_DEFAULT, 'evaluateProseQuality', ANALYSIS_MODEL, reasoningBudget, onReasoning, ANALYSIS_TEMPERATURE)
    : await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_DEFAULT, 'evaluateProseQuality', ANALYSIS_MODEL, reasoningBudget, true, ANALYSIS_TEMPERATURE);

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
    .filter((c) => Object.keys(c.world?.nodes ?? {}).length)
    .map((c) => `${c.name}: ${Object.values(c.world!.nodes).map((n) => `${n.type}: ${n.content}`).join('; ')}`)
    .join('\n');

  const guidanceBlock = guidance?.trim()
    ? `\nPRIORITY GUIDANCE FROM THE AUTHOR — You MUST address every point below.\n\n${guidance.trim()}`
    : '';

  const sceneBlocks = scenesWithPlans.map((s) =>
    `[${s.id}] POV: ${s.pov} | Loc: ${s.location}\n${s.beats}`
  ).join('\n\n────────────────────────────────\n\n');

  const prompt = buildPlanReviewPrompt({
    title: narrative.title,
    threadBlock,
    charBlock,
    sceneCount: scenesWithPlans.length,
    sceneBlocks,
    guidanceBlock,
    guidance,
  });

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = onReasoning
    ? await callGenerateStream(prompt, SYSTEM_PROMPT, () => {}, MAX_TOKENS_DEFAULT, 'evaluatePlanQuality', ANALYSIS_MODEL, reasoningBudget, onReasoning, ANALYSIS_TEMPERATURE)
    : await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_DEFAULT, 'evaluatePlanQuality', ANALYSIS_MODEL, reasoningBudget, true, ANALYSIS_TEMPERATURE);

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
}
