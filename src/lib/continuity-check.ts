/**
 * Continuity Checking Engine
 *
 * Classifies candidate plan propositions against the existing narrative
 * and detects continuity violations via LLM binary checks.
 *
 * Two operations:
 *   1. classifyCandidatePlan() — classify a plan's propositions against all prior
 *      (backward-only, since the candidate is at the narrative head)
 *   2. checkContinuityViolations() — LLM check on high-backward anchor/foundation/close/ending
 *      propositions for contradictions with their strongest activations
 */

import { resolveEmbeddingsBatch } from './embeddings';
import { classificationLabel, classificationColor, BASE_COLORS } from './proposition-classify';
import { resolveEntry, isScene } from '@/types/narrative';
import { callGenerate } from './ai/api';
import { parseJson } from './ai/json';
import { ANALYSIS_MODEL, ANALYSIS_TEMPERATURE } from './constants';
import type {
  NarrativeState,
  BeatPlan,
  PropositionBaseCategory,
  PropositionReach,
  ContinuityViolation,
  EmbeddingRef,
} from '@/types/narrative';

// ── Constants ────────────────────────────────────────────────────────────────

const TOP_K = 5;
const STRENGTH_PERCENTILE = 0.60;
const REACH_RATIO = 0.15;
const REACH_MIN = 5;

/** Types that trigger LLM continuity check when high-backward */
const CHECK_LABELS = new Set(['anchor', 'foundation', 'close', 'ending']);

// ── Types ────────────────────────────────────────────────────────────────────

type PriorProp = {
  sceneId: string;
  content: string;
  embedding: number[];
};

type CandidateProp = {
  beatIndex: number;
  propIndex: number;
  content: string;
  embedding: number[];
};

export type CandidateClassification = {
  beatIndex: number;
  propIndex: number;
  label: string;
  color: string;
  base: PropositionBaseCategory;
  reach: PropositionReach;
  backwardScore: number;
  /** Top activated prior propositions (for violation check context) */
  topPriors: { sceneId: string; content: string; similarity: number }[];
};

// ── Gather prior propositions ───────────────────────────────────────────────

async function gatherPriorPropositions(
  narrative: NarrativeState,
  resolvedKeys: string[],
): Promise<PriorProp[]> {
  const priors: { sceneId: string; content: string; embRef: EmbeddingRef }[] = [];

  for (const key of resolvedKeys) {
    const entry = resolveEntry(narrative, key);
    if (!entry || !isScene(entry)) continue;
    const plan = entry.planVersions?.[entry.planVersions.length - 1]?.plan;
    if (!plan?.beats) continue;

    for (const beat of plan.beats) {
      if (!beat.propositions) continue;
      for (const prop of beat.propositions) {
        if (prop.embedding) {
          priors.push({ sceneId: entry.id, content: prop.content, embRef: prop.embedding });
        }
      }
    }
  }

  // Resolve embeddings in batch
  const refs = priors.map(p => p.embRef);
  const batchMap = await resolveEmbeddingsBatch(refs);

  const result: PriorProp[] = [];
  for (let i = 0; i < priors.length; i++) {
    const vec = batchMap.get(i);
    if (vec) result.push({ sceneId: priors[i].sceneId, content: priors[i].content, embedding: vec });
  }

  return result;
}

// ── Classify candidate plan ─────────────────────────────────────────────────

/**
 * Classify a candidate plan's propositions against the existing narrative.
 * Uses backward-only activation (candidate is at narrative head — no forward exists).
 *
 * Returns per-proposition classification labels and their top activating priors.
 */
export async function classifyCandidatePlan(
  narrative: NarrativeState,
  resolvedKeys: string[],
  candidatePlan: BeatPlan,
): Promise<{
  classifications: CandidateClassification[];
  labels: Record<string, string>; // "beatIdx:propIdx" → label
}> {
  const t0 = performance.now();

  // 1. Gather all prior proposition embeddings
  const priors = await gatherPriorPropositions(narrative, resolvedKeys);
  if (priors.length === 0) {
    return { classifications: [], labels: {} };
  }

  // 2. Gather candidate proposition embeddings
  const candidateProps: CandidateProp[] = [];
  const candidateEmbRefs: (EmbeddingRef | undefined)[] = [];

  for (let bi = 0; bi < candidatePlan.beats.length; bi++) {
    const beat = candidatePlan.beats[bi];
    if (!beat.propositions) continue;
    for (let pi = 0; pi < beat.propositions.length; pi++) {
      const prop = beat.propositions[pi];
      candidateProps.push({ beatIndex: bi, propIndex: pi, content: prop.content, embedding: [] });
      candidateEmbRefs.push(prop.embedding);
    }
  }

  const candidateBatch = await resolveEmbeddingsBatch(candidateEmbRefs);

  // Filter to candidates that have embeddings
  const validCandidates: (CandidateProp & { embedding: number[] })[] = [];
  for (let i = 0; i < candidateProps.length; i++) {
    const vec = candidateBatch.get(i);
    if (vec) validCandidates.push({ ...candidateProps[i], embedding: vec });
  }

  if (validCandidates.length === 0) {
    return { classifications: [], labels: {} };
  }

  // 3. Compute backward activation via TF.js matMul
  const totalScenes = new Set(resolvedKeys.map(k => {
    const e = resolveEntry(narrative, k);
    return e && isScene(e) ? e.id : null;
  }).filter(Boolean)).size;
  const reachThreshold = Math.max(REACH_MIN, Math.round(totalScenes * REACH_RATIO));

  const sceneOrderMap = new Map<string, number>();
  let sceneIdx = 0;
  for (const key of resolvedKeys) {
    const entry = resolveEntry(narrative, key);
    if (entry && isScene(entry)) { sceneOrderMap.set(entry.id, sceneIdx); sceneIdx++; }
  }
  const candidateSceneOrder = sceneIdx;

  const DIMS = 1536;
  const priorCount = priors.length;
  const candCount = validCandidates.length;

  // Build normalized matrices
  const priorFlat = new Float32Array(priorCount * DIMS);
  const candFlat = new Float32Array(candCount * DIMS);

  for (let i = 0; i < priorCount; i++) {
    const vec = priors[i].embedding;
    const off = i * DIMS;
    let norm = 0;
    for (let d = 0; d < DIMS; d++) { priorFlat[off + d] = vec[d]; norm += vec[d] * vec[d]; }
    norm = Math.sqrt(norm);
    if (norm > 0) for (let d = 0; d < DIMS; d++) priorFlat[off + d] /= norm;
  }

  for (let i = 0; i < candCount; i++) {
    const vec = validCandidates[i].embedding;
    const off = i * DIMS;
    let norm = 0;
    for (let d = 0; d < DIMS; d++) { candFlat[off + d] = vec[d]; norm += vec[d] * vec[d]; }
    norm = Math.sqrt(norm);
    if (norm > 0) for (let d = 0; d < DIMS; d++) candFlat[off + d] /= norm;
  }

  // matMul: [candCount × DIMS] × [DIMS × priorCount] = [candCount × priorCount]
  const tf = await import('@tensorflow/tfjs');
  const candMat = tf.tensor2d(candFlat, [candCount, DIMS]);
  const priorMat = tf.tensor2d(priorFlat, [priorCount, DIMS]);
  const simMat = tf.matMul(candMat, priorMat, false, true);
  const simData = new Float32Array(await simMat.data());
  simMat.dispose(); candMat.dispose(); priorMat.dispose();

  // Extract top-k per candidate
  const backwardScores: number[] = [];
  const classifications: CandidateClassification[] = [];

  for (let ci = 0; ci < candCount; ci++) {
    const cand = validCandidates[ci];
    const rowOffset = ci * priorCount;

    // Find top-k
    const sims: { sim: number; idx: number }[] = [];
    for (let j = 0; j < priorCount; j++) sims.push({ sim: simData[rowOffset + j], idx: j });
    sims.sort((a, b) => b.sim - a.sim);

    const topk = sims.slice(0, TOP_K);
    const maxSim = topk[0]?.sim ?? 0;
    const meanTopk = topk.reduce((s, x) => s + x.sim, 0) / (topk.length || 1);
    const backwardScore = 0.5 * maxSim + 0.5 * meanTopk;
    backwardScores.push(backwardScore);

    // Temporal reach
    const distances = topk.map(x => {
      const priorOrder = sceneOrderMap.get(priors[x.idx].sceneId) ?? 0;
      return Math.abs(candidateSceneOrder - priorOrder);
    });
    const sortedDists = [...distances].sort((a, b) => a - b);
    const medianReach = sortedDists.length % 2 === 1
      ? sortedDists[Math.floor(sortedDists.length / 2)]
      : (sortedDists[sortedDists.length / 2 - 1] + sortedDists[sortedDists.length / 2]) / 2;

    classifications.push({
      beatIndex: cand.beatIndex,
      propIndex: cand.propIndex,
      label: '',
      color: '',
      base: 'Texture',
      reach: medianReach >= reachThreshold ? 'Global' : 'Local',
      backwardScore,
      topPriors: topk.map(x => ({
        sceneId: priors[x.idx].sceneId,
        content: priors[x.idx].content,
        similarity: x.sim,
      })),
    });
  }

  // 4. Compute threshold and assign categories
  const validScores = backwardScores.filter(s => s > 0);
  validScores.sort((a, b) => a - b);
  const thIdx = Math.floor(validScores.length * STRENGTH_PERCENTILE);
  const threshold = validScores[thIdx] ?? 0;

  for (let i = 0; i < classifications.length; i++) {
    const c = classifications[i];
    const hiBack = c.backwardScore >= threshold;
    // Forward is unknown for candidates — treat as LO (conservative)
    // High backward = Anchor or Close depending on context
    // Low backward = Seed or Texture
    const base: PropositionBaseCategory = hiBack ? 'Close' : 'Texture';
    // Refine: if the candidate's content introduces new concepts (low similarity to top prior), it's more Anchor-like
    // For simplicity, use: hiBack = Close (resolving), loBack = Texture (new content)
    // Seeds require forward evidence which candidates don't have yet
    c.base = base;
    c.label = classificationLabel(base, c.reach);
    c.color = classificationColor(base, c.reach);
  }

  const labels: Record<string, string> = {};
  for (const c of classifications) {
    labels[`${c.beatIndex}:${c.propIndex}`] = c.label;
  }

  const t1 = performance.now();
  console.log(`[ContinuityCheck] Classified ${validCandidates.length} candidate propositions against ${priors.length} priors in ${(t1 - t0).toFixed(0)}ms`);

  return { classifications, labels };
}

// ── Continuity violation detection ──────────────────────────────────────────

/**
 * Check high-backward propositions for continuity violations.
 * Only checks types that reference prior content: anchor, foundation, close, ending.
 * Uses LLM binary contradiction check.
 */
/**
 * Check high-backward propositions for continuity violations.
 *
 * @param classifications - classified propositions (with topPriors populated)
 * @param candidateContents - map of "beatIdx:propIdx" → candidate proposition content
 */
/** Concurrency for parallel per-scene LLM calls */
const CONCURRENCY = 10;

/** Group classifications by scene, then check each scene as one LLM call */
export type SceneCheckInput = {
  sceneId: string;
  sceneSummary: string;
  classifications: CandidateClassification[];
  candidateContents: Record<string, string>;
};

/**
 * Check continuity per scene — one LLM call per scene, 10 concurrent.
 * Each call receives all high-value propositions in that scene + their activated priors.
 */
export async function checkContinuityViolations(
  classifications: CandidateClassification[],
  candidateContents?: Record<string, string>,
): Promise<ContinuityViolation[]> {
  const toCheck = classifications.filter(c =>
    CHECK_LABELS.has(c.label) && c.topPriors.length > 0
  );

  if (toCheck.length === 0) return [];

  const t0 = performance.now();

  // Group by scene (using sceneId if available on the classification, otherwise treat as one scene)
  const sceneGroups = new Map<string, CandidateClassification[]>();
  for (const c of toCheck) {
    const sid = (c as CandidateClassification & { sceneId?: string }).sceneId ?? 'single';
    if (!sceneGroups.has(sid)) sceneGroups.set(sid, []);
    sceneGroups.get(sid)!.push(c);
  }

  const scenes = Array.from(sceneGroups.entries());

  async function checkScene(sceneId: string, props: CandidateClassification[]): Promise<ContinuityViolation[]> {
    // Build prompt: scene's new propositions vs their activated priors
    const propositionBlock = props.map((c, idx) => {
      const content = candidateContents?.[`${c.beatIndex}:${c.propIndex}`] ?? `[${c.label}]`;
      const priors = c.topPriors.slice(0, 3).map((p, j) => `    Prior ${j + 1}: "${p.content}"`).join('\n');
      return `[${idx + 1}] (${c.label}) "${content}"\n  Activated priors:\n${priors}`;
    }).join('\n\n');

    const prompt = `You are checking narrative continuity for a scene. Below are high-value propositions from this scene, each with the prior established facts they most strongly activate.

For each proposition, determine if it contradicts or conflicts with its activated priors.

${propositionBlock}

Respond with a JSON array. For each proposition that HAS a continuity issue, include:
{"idx": <number>, "issue": true, "explanation": "<one sentence describing the contradiction>", "suggestion": "<one sentence fix>"}
If all propositions are consistent, return [].`;

    try {
      const result = await callGenerate(
        prompt,
        'Check narrative continuity for a scene. Respond only with a JSON array. Include suggestion for fixes.',
        800,
        'continuity-check-scene',
        ANALYSIS_MODEL,
        undefined,
        true,
        ANALYSIS_TEMPERATURE,
      );

      const parsed = parseJson(result, 'continuity-check-scene') as Array<{ idx?: number; issue?: boolean; explanation?: string; suggestion?: string }>;
      const violations: ContinuityViolation[] = [];

      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (!entry.issue || entry.idx == null) continue;
          const idx = entry.idx - 1;
          if (idx < 0 || idx >= props.length) continue;
          const c = props[idx];
          violations.push({
            beatIndex: c.beatIndex,
            propIndex: c.propIndex,
            candidateContent: candidateContents?.[`${c.beatIndex}:${c.propIndex}`] ?? '',
            priorContent: c.topPriors.slice(0, 3).map(p => p.content),
            priorSceneIds: c.topPriors.slice(0, 3).map(p => p.sceneId),
            isViolation: true,
            explanation: (entry.explanation ?? 'Continuity issue') + (entry.suggestion ? ` → ${entry.suggestion}` : ''),
            activationScore: c.backwardScore,
            label: c.label,
          });
        }
      }
      return violations;
    } catch (err) {
      console.warn(`[ContinuityCheck] Scene ${sceneId} check failed:`, err);
      return [];
    }
  }

  // Sliding window: 10 scenes in parallel
  const allViolations: ContinuityViolation[] = [];

  for (let i = 0; i < scenes.length; i += CONCURRENCY) {
    const window = scenes.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      window.map(([sid, props]) => checkScene(sid, props))
    );
    for (const r of results) allViolations.push(...r);
  }

  const t1 = performance.now();
  console.log(`[ContinuityCheck] Checked ${scenes.length} scenes (${toCheck.length} propositions), concurrency ${CONCURRENCY}, in ${(t1 - t0).toFixed(0)}ms, found ${allViolations.length} violations`);

  return allViolations;
}
