/**
 * Bulk Embedding Hook - Manual regeneration of embeddings for scenes
 *
 * Use cases:
 * - Importing old narratives (before embeddings existed)
 * - Embedding generation failed during plan/scene creation
 * - Manual plan edits (embeddings not auto-regenerated)
 * - Embeddings corrupted or incomplete
 */

import { useState, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { generateEmbeddingsBatch, embedPropositions, computeCentroid, resolveEmbedding } from '@/lib/embeddings';
import { assetManager } from '@/lib/asset-manager';
import { logInfo, logError } from '@/lib/system-logger';

export type EmbedMode = 'summaries' | 'propositions' | 'prose';

export type EmbedProgress = {
  mode: EmbedMode;
  completed: number;
  total: number;
  currentSceneId?: string;
};

export type EmbedStats = {
  summaries: { total: number; missing: number };
  propositions: { total: number; missing: number };
  prose: { total: number; missing: number };
};

/**
 * Hook for bulk embedding generation
 */
export function useBulkEmbed() {
  const { state, dispatch } = useStore();
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [progress, setProgress] = useState<EmbedProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Compute embedding coverage stats for current narrative
   */
  const computeStats = useCallback((): EmbedStats | null => {
    const narrative = state.activeNarrative;
    const resolvedKeys = state.resolvedEntryKeys;
    if (!narrative || !resolvedKeys) return null;

    const stats: EmbedStats = {
      summaries: { total: 0, missing: 0 },
      propositions: { total: 0, missing: 0 },
      prose: { total: 0, missing: 0 },
    };

    for (const key of resolvedKeys) {
      const scene = narrative.scenes[key];
      if (!scene) continue;

      // Summary embeddings
      stats.summaries.total++;
      if (!scene.summaryEmbedding) stats.summaries.missing++;

      // Proposition embeddings - use latest plan version
      const latestPlan = scene.planVersions?.[scene.planVersions.length - 1]?.plan;
      if (latestPlan) {
        for (const beat of latestPlan.beats) {
          stats.propositions.total += beat.propositions.length;
          stats.propositions.missing += beat.propositions.filter(p => !p.embedding).length;
        }
      }

      // Prose embeddings
      if (scene.proseVersions && scene.proseVersions.length > 0) {
        stats.prose.total++;
        if (!scene.proseEmbedding) stats.prose.missing++;
      }
    }

    return stats;
  }, [state.activeNarrative, state.resolvedEntryKeys]);

  /**
   * Generate embeddings for selected modes
   */
  const generateEmbeddings = useCallback(async (modes: EmbedMode[]) => {
    const narrative = state.activeNarrative;
    const resolvedKeys = state.resolvedEntryKeys;
    if (!narrative || !resolvedKeys) {
      setError('No active narrative');
      return;
    }

    setIsEmbedding(true);
    setError(null);

    try {
      for (const mode of modes) {
        if (mode === 'summaries') {
          await embedSummaries(narrative.id, resolvedKeys);
        } else if (mode === 'propositions') {
          await embedPropositionsForScenes(narrative.id, resolvedKeys);
        } else if (mode === 'prose') {
          await embedProse(narrative.id, resolvedKeys);
        }
      }

      logInfo('Completed bulk embedding', {
        source: 'embedding',
        operation: 'bulk-embed-complete',
        details: { narrativeId: narrative.id, modeCount: modes.length },
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      logError('Failed to generate bulk embeddings', err, {
        source: 'embedding',
        operation: 'bulk-embed',
        details: { narrativeId: narrative.id, modeCount: modes.length },
      });
    } finally {
      setIsEmbedding(false);
      setProgress(null);
    }
  }, [state.activeNarrative, state.resolvedEntryKeys]);

  /**
   * Embed scene summaries
   */
  const embedSummaries = async (narrativeId: string, resolvedKeys: string[]) => {
    const narrative = state.activeNarrative;
    if (!narrative) return;

    const scenesToEmbed = resolvedKeys
      .map(key => narrative.scenes[key])
      .filter(scene => scene && !scene.summaryEmbedding);

    if (scenesToEmbed.length === 0) return;

    setProgress({ mode: 'summaries', completed: 0, total: scenesToEmbed.length });

    const summaries = scenesToEmbed.map(s => s.summary);
    const embeddings = await generateEmbeddingsBatch(
      summaries,
      narrativeId,
      (completed, total) => {
        setProgress({ mode: 'summaries', completed, total });
      }
    );

    // Store embeddings in AssetManager and update scenes with references
    for (let i = 0; i < scenesToEmbed.length; i++) {
      const embeddingId = await assetManager.storeEmbedding(embeddings[i], 'text-embedding-3-small');
      dispatch({
        type: 'UPDATE_SCENE',
        sceneId: scenesToEmbed[i].id,
        updates: { summaryEmbedding: embeddingId },
      });
    }
  };

  /**
   * Embed propositions in scene plans
   */
  const embedPropositionsForScenes = async (narrativeId: string, resolvedKeys: string[]) => {
    const narrative = state.activeNarrative;
    if (!narrative) return;

    const scenesWithPlans = resolvedKeys
      .map(key => narrative.scenes[key])
      .filter(scene => scene?.planVersions && scene.planVersions.length > 0);

    if (scenesWithPlans.length === 0) return;

    let totalProcessed = 0;
    const totalScenes = scenesWithPlans.length;

    for (const scene of scenesWithPlans) {
      const latestPlanVersion = scene.planVersions?.[scene.planVersions.length - 1];
      if (!latestPlanVersion) continue;
      const latestPlan = latestPlanVersion.plan;

      setProgress({
        mode: 'propositions',
        completed: totalProcessed,
        total: totalScenes,
        currentSceneId: scene.id,
      });

      // Collect all propositions from scene
      const allPropositions: Array<{
        content: string;
        type?: string;
        beatIndex: number;
        propIndex: number;
      }> = [];

      // Beat-level propositions
      latestPlan.beats.forEach((beat, beatIndex) => {
        beat.propositions.forEach((prop, propIndex) => {
          if (!prop.embedding) {
            allPropositions.push({ ...prop, beatIndex, propIndex });
          }
        });
      });

      if (allPropositions.length > 0) {
        // Generate embeddings for missing propositions
        const embeddedProps = await embedPropositions(
          allPropositions.map(p => ({ content: p.content, type: p.type })),
          narrativeId
        );

        // Create updated plan with new embeddings
        const updatedPlan = { ...latestPlan };

        // Update beat-level propositions and recompute centroids
        updatedPlan.beats = await Promise.all(updatedPlan.beats.map(async (beat, beatIndex) => {
          const updatedBeat = { ...beat, propositions: [...beat.propositions] };

          // Map embeddings back
          allPropositions.forEach((prop, embeddedIndex) => {
            if (prop.beatIndex === beatIndex) {
              updatedBeat.propositions[prop.propIndex] = embeddedProps[embeddedIndex];
            }
          });

          // Recompute beat centroid from resolved embeddings and store as asset
          const resolvedBeatEmbeddings = (await Promise.all(
            updatedBeat.propositions.map(p => resolveEmbedding(p.embedding))
          )).filter((e): e is number[] => e !== null);
          if (resolvedBeatEmbeddings.length > 0) {
            const centroid = computeCentroid(resolvedBeatEmbeddings);
            updatedBeat.embeddingCentroid = await assetManager.storeEmbedding(centroid, 'text-embedding-3-small');
          }

          return updatedBeat;
        }));

        // Compute plan centroid from resolved beat centroids
        const resolvedBeatCentroids = (await Promise.all(
          updatedPlan.beats.map(b => resolveEmbedding(b.embeddingCentroid))
        )).filter((c): c is number[] => c !== null);
        const planEmbeddingCentroid = resolvedBeatCentroids.length > 0
          ? await assetManager.storeEmbedding(computeCentroid(resolvedBeatCentroids), 'text-embedding-3-small')
          : undefined;

        // Update scene with new plan and centroid
        dispatch({
          type: 'UPDATE_SCENE',
          sceneId: scene.id,
          updates: { plan: updatedPlan, planEmbeddingCentroid },
        });
      }

      totalProcessed++;
    }
  };

  /**
   * Embed prose text for scenes
   */
  const embedProse = async (narrativeId: string, resolvedKeys: string[]) => {
    const narrative = state.activeNarrative;
    if (!narrative) return;

    const scenesWithProse = resolvedKeys
      .map(key => narrative.scenes[key])
      .filter(scene => {
        if (!scene || !scene.proseVersions || scene.proseVersions.length === 0) return false;
        return !scene.proseEmbedding; // Only scenes missing prose embedding
      });

    if (scenesWithProse.length === 0) return;

    setProgress({ mode: 'prose', completed: 0, total: scenesWithProse.length });

    const proseTexts = scenesWithProse.map(s => {
      const latestVersion = s.proseVersions![s.proseVersions!.length - 1];
      return latestVersion.prose;
    });

    const embeddings = await generateEmbeddingsBatch(
      proseTexts,
      narrativeId,
      (completed, total) => {
        setProgress({ mode: 'prose', completed, total });
      }
    );

    // Store embeddings in AssetManager and update scenes with references
    for (let i = 0; i < scenesWithProse.length; i++) {
      const embeddingId = await assetManager.storeEmbedding(embeddings[i], 'text-embedding-3-small');
      dispatch({
        type: 'UPDATE_SCENE',
        sceneId: scenesWithProse[i].id,
        updates: { proseEmbedding: embeddingId },
      });
    }
  };

  return {
    isEmbedding,
    progress,
    error,
    computeStats,
    generateEmbeddings,
  };
}
