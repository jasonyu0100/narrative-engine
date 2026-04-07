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

import { resolveEmbeddingsBatch, cosineSimilarity } from './embeddings';
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

  // 3. Compute backward activation for each candidate against all priors
  const totalScenes = new Set(resolvedKeys.map(k => {
    const e = resolveEntry(narrative, k);
    return e && isScene(e) ? e.id : null;
  }).filter(Boolean)).size;
  const reachThreshold = Math.max(REACH_MIN, Math.round(totalScenes * REACH_RATIO));

  // Get scene order for reach computation
  const sceneOrderMap = new Map<string, number>();
  let sceneIdx = 0;
  for (const key of resolvedKeys) {
    const entry = resolveEntry(narrative, key);
    if (entry && isScene(entry)) { sceneOrderMap.set(entry.id, sceneIdx); sceneIdx++; }
  }
  const candidateSceneOrder = sceneIdx; // candidate is at the next position

  const backwardScores: number[] = [];
  const classifications: CandidateClassification[] = [];

  for (const cand of validCandidates) {
    // Compute cosine similarity against all priors
    const sims: { sim: number; idx: number }[] = [];
    for (let j = 0; j < priors.length; j++) {
      sims.push({ sim: cosineSimilarity(cand.embedding, priors[j].embedding), idx: j });
    }
    sims.sort((a, b) => b.sim - a.sim);

    const topk = sims.slice(0, TOP_K);
    const maxSim = topk[0]?.sim ?? 0;
    const meanTopk = topk.reduce((s, x) => s + x.sim, 0) / (topk.length || 1);
    const backwardScore = 0.5 * maxSim + 0.5 * meanTopk;
    backwardScores.push(backwardScore);

    // Temporal reach
    const distances = topk.map(x => {
      const priorSceneId = priors[x.idx].sceneId;
      const priorOrder = sceneOrderMap.get(priorSceneId) ?? 0;
      return Math.abs(candidateSceneOrder - priorOrder);
    });
    const sortedDists = [...distances].sort((a, b) => a - b);
    const medianReach = sortedDists.length % 2 === 1
      ? sortedDists[Math.floor(sortedDists.length / 2)]
      : (sortedDists[sortedDists.length / 2 - 1] + sortedDists[sortedDists.length / 2]) / 2;

    // Store top priors for violation check
    const topPriors = topk.map(x => ({
      sceneId: priors[x.idx].sceneId,
      content: priors[x.idx].content,
      similarity: x.sim,
    }));

    classifications.push({
      beatIndex: cand.beatIndex,
      propIndex: cand.propIndex,
      label: '', // filled after threshold
      color: '',
      base: 'Texture', // default
      reach: medianReach >= reachThreshold ? 'Global' : 'Local',
      backwardScore,
      topPriors,
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
export async function checkContinuityViolations(
  classifications: CandidateClassification[],
): Promise<ContinuityViolation[]> {
  // Filter to high-backward propositions with check-worthy labels
  const toCheck = classifications.filter(c =>
    CHECK_LABELS.has(c.label) && c.topPriors.length > 0
  );

  if (toCheck.length === 0) return [];

  const t0 = performance.now();
  const violations: ContinuityViolation[] = [];

  // Batch: check multiple propositions in one LLM call
  const batchSize = 5;
  for (let i = 0; i < toCheck.length; i += batchSize) {
    const batch = toCheck.slice(i, i + batchSize);

    const checks = batch.map((c, idx) => {
      const priorsText = c.topPriors.slice(0, 3).map((p, j) => `  Prior ${j + 1}: "${p.content}"`).join('\n');
      return `Check ${idx + 1}:\nNew proposition: "${c.beatIndex}:${c.propIndex}: ${c.topPriors[0]?.content ? '' : ''}${classifications.find(x => x.beatIndex === c.beatIndex && x.propIndex === c.propIndex)?.label ?? ''}"\nNew: "${batch[idx].topPriors.length > 0 ? '' : '(no priors)'}"\n---\nNew proposition: "${c.label}" — "${c.topPriors[0] ? '' : ''}"\n`;
    });

    // Build a cleaner prompt
    const promptParts = batch.map((c, idx) => {
      const topPrior = c.topPriors[0];
      return `Check ${idx + 1}:
Prior: "${topPrior.content}"
New: "${classifications.find(x => x.beatIndex === c.beatIndex && x.propIndex === c.propIndex) ? '' : ''}${c.topPriors[0]?.content ?? ''}"`;
    });

    // Simpler: one check per proposition against its strongest prior
    for (const c of batch) {
      const topPrior = c.topPriors[0];
      if (!topPrior) continue;

      const prompt = `You are checking narrative continuity. Does the new proposition contradict or violate the established prior?

Prior (established): "${topPrior.content}"
New (candidate): "${classifications.find(x => x.beatIndex === c.beatIndex && x.propIndex === c.propIndex)?.topPriors[0]?.content ?? ''}"

Respond with JSON: {"contradiction": true/false, "explanation": "one sentence"}`;

      try {
        const result = await callGenerate(
          `Prior: "${topPrior.content}"\nNew: "${c.topPriors[0]?.content ?? ''}"\n\nDoes the new proposition contradict the prior? Respond JSON: {"contradiction": boolean, "explanation": "brief"}`,
          'Check narrative continuity between two propositions. Respond only with JSON.',
          200,
          'continuity-check',
          ANALYSIS_MODEL,
          undefined,
          true,
          ANALYSIS_TEMPERATURE,
        );

        const parsed = parseJson(result, 'continuity-check') as { contradiction?: boolean; explanation?: string };

        if (parsed?.contradiction) {
          violations.push({
            beatIndex: c.beatIndex,
            propIndex: c.propIndex,
            candidateContent: '', // Will be filled by caller
            priorContent: c.topPriors.slice(0, 3).map(p => p.content),
            priorSceneIds: c.topPriors.slice(0, 3).map(p => p.sceneId),
            isViolation: true,
            explanation: parsed.explanation ?? 'Contradiction detected',
            activationScore: c.backwardScore,
            label: c.label,
          });
        }
      } catch (err) {
        console.warn(`[ContinuityCheck] LLM check failed for ${c.beatIndex}:${c.propIndex}:`, err);
      }
    }
  }

  const t1 = performance.now();
  console.log(`[ContinuityCheck] Checked ${toCheck.length} propositions, found ${violations.length} violations in ${(t1 - t0).toFixed(0)}ms`);

  return violations;
}
