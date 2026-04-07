/**
 * Plan Candidates - Generate multiple candidate plans and rank by semantic similarity
 * Supports both inline and decoupled (reference-based) embeddings
 */

import { generateScenePlan } from './scenes';
import { cosineSimilarity, computeCentroid, generateEmbeddings, resolveEmbedding } from '@/lib/embeddings';
import type { NarrativeState, Scene, PlanCandidates, PlanCandidate } from '@/types/narrative';
import { PLAN_CANDIDATES_COUNT } from '@/lib/constants';
import { logInfo } from '@/lib/system-logger';

/**
 * Run plan candidates: generate k candidate plans and rank by similarity to scene summary
 *
 * @param narrative - Current narrative state
 * @param scene - Scene to generate plans for
 * @param resolvedKeys - Resolved entry keys for context
 * @param candidateCount - Number of candidate plans to generate (default 5)
 * @param onProgress - Optional progress callback (completed, total)
 * @returns PlanCandidates with ranked candidates
 */
export async function runPlanCandidates(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  candidateCount = PLAN_CANDIDATES_COUNT,
  onProgress?: (completed: number, total: number) => void,
): Promise<PlanCandidates> {
  logInfo('Starting plan candidates', {
    source: 'plan-generation',
    operation: 'candidates',
    details: { sceneId: scene.id, candidateCount },
  });

  // Generate scene summary embedding if not present
  if (!scene.summaryEmbedding) {
    const embeddings = await generateEmbeddings([scene.summary], narrative.id);
    scene.summaryEmbedding = embeddings[0];
  }

  // Resolve scene summary embedding (may be reference or inline)
  const sceneSummaryEmbedding = await resolveEmbedding(scene.summaryEmbedding);
  if (!sceneSummaryEmbedding) {
    throw new Error('Failed to resolve scene summary embedding');
  }

  // Generate k candidate plans in parallel with diversity guidance
  const promises = Array.from({ length: candidateCount }, (_, i) =>
    generateScenePlan(
      narrative,
      scene,
      resolvedKeys,
      undefined,
      undefined,
      `Candidate ${i + 1}: Vary beat ordering, density, and proposition distribution for diversity.`,
    )
  );

  const candidatePlans = await Promise.all(promises);
  onProgress?.(candidateCount, candidateCount);

  // Score each candidate by similarity to scene summary
  const candidates: PlanCandidate[] = await Promise.all(candidatePlans.map(async (plan, index) => {
    // Resolve all beat centroid references
    const beatCentroidRefs = plan.beats
      .filter(b => b.embeddingCentroid)
      .map(b => b.embeddingCentroid!);

    const resolvedBeatCentroids = await Promise.all(
      beatCentroidRefs.map(ref => resolveEmbedding(ref))
    );

    // Filter out failed resolutions
    const beatCentroids = resolvedBeatCentroids.filter(c => c !== null) as number[][];

    // Compute plan centroid as average of beat centroids
    const centroid = beatCentroids.length > 0 ? computeCentroid(beatCentroids) : [];

    // Compute overall similarity score (plan centroid vs scene summary)
    const similarityScore = centroid.length > 0
      ? cosineSimilarity(centroid, sceneSummaryEmbedding)
      : 0;

    // Compute per-beat similarity scores
    const beatScores = await Promise.all(plan.beats.map(async (beat, beatIndex) => {
      if (!beat.embeddingCentroid) {
        return { beatIndex, score: 0 };
      }

      const beatCentroid = await resolveEmbedding(beat.embeddingCentroid);
      const score = beatCentroid
        ? cosineSimilarity(beatCentroid, sceneSummaryEmbedding)
        : 0;

      return { beatIndex, score };
    }));

    return {
      id: `candidate-${index}`,
      plan,
      centroid,
      similarityScore,
      beatScores,
      timestamp: Date.now(),
    };
  }));

  // Sort by similarity score descending (highest first)
  candidates.sort((a, b) => b.similarityScore - a.similarityScore);

  const winner = candidates[0]?.id ?? '';

  logInfo('Completed plan candidates', {
    source: 'plan-generation',
    operation: 'candidates-complete',
    details: {
      sceneId: scene.id,
      candidateCount: candidates.length,
      winnerScore: candidates[0]?.similarityScore ?? 0,
      totalViolations: candidates.reduce((sum, c) => sum + (c.continuityViolations?.length ?? 0), 0),
    },
  });

  return {
    sceneId: scene.id,
    candidates,
    winner,
    createdAt: Date.now(),
  };
}
