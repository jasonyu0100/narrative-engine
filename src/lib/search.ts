/**
 * Semantic Search Engine - Search narrative content using embeddings
 * Supports both inline and decoupled (reference-based) embeddings
 */

import { generateEmbeddings, cosineSimilarity, resolveEmbedding } from './embeddings';
import type { NarrativeState, SearchQuery, SearchResult, EmbeddingRef } from '@/types/narrative';
import { SEARCH_TOP_K_SCENES, SEARCH_TOP_K_BEATS, SEARCH_TOP_K_PROPOSITIONS } from './constants';
import { resolveEntry, isScene } from '@/types/narrative';
import { logInfo, logError } from './system-logger';

/**
 * Search narrative content semantically using embeddings
 *
 * @param narrative - Current narrative state
 * @param resolvedKeys - Resolved entry keys for the active branch
 * @param query - Search query text
 * @returns SearchQuery with results, timeline heatmap, and top results
 */
export async function searchNarrative(
  narrative: NarrativeState,
  resolvedKeys: string[],
  query: string,
): Promise<SearchQuery> {
  logInfo('Starting semantic search', {
    source: 'search',
    operation: 'search',
    details: { narrativeId: narrative.id, query: query.substring(0, 100), entryCount: resolvedKeys.length },
  });

  // Generate query embedding
  const embeddings = await generateEmbeddings([query], narrative.id);
  const queryEmbedding = embeddings[0];

  // Collect all searchable items with embedding references
  const itemsWithRefs: Array<{
    type: 'proposition' | 'beat' | 'scene';
    sceneId: string;
    sceneIndex: number;
    arcId?: string;
    beatIndex?: number;
    propIndex?: number;
    content: string;
    embeddingRef: EmbeddingRef;
    context: string;
  }> = [];

  for (let entryIndex = 0; entryIndex < resolvedKeys.length; entryIndex++) {
    const key = resolvedKeys[entryIndex];
    const entry = resolveEntry(narrative, key);
    if (!entry || !isScene(entry)) continue;

    const scene = entry;

    // Scene summary embedding
    if (scene.summaryEmbedding) {
      itemsWithRefs.push({
        type: 'scene',
        sceneId: scene.id,
        sceneIndex: entryIndex,  // Use position in resolvedKeys, not scene count
        arcId: scene.arcId,
        content: scene.summary,
        embeddingRef: scene.summaryEmbedding,
        context: scene.summary,
      });
    }

    // Beat propositions - use latest plan version
    const latestPlan = scene.planVersions?.[scene.planVersions.length - 1]?.plan;
    if (latestPlan) {
      for (let beatIndex = 0; beatIndex < latestPlan.beats.length; beatIndex++) {
        const beat = latestPlan.beats[beatIndex];

        // Beat-level search using centroid
        if (beat.embeddingCentroid) {
          itemsWithRefs.push({
            type: 'beat',
            sceneId: scene.id,
            sceneIndex: entryIndex,  // Use position in resolvedKeys
            arcId: scene.arcId,
            beatIndex,
            content: beat.what,
            embeddingRef: beat.embeddingCentroid,
            context: `Beat ${beatIndex + 1}: ${beat.what}`,
          });
        }

        // Proposition-level search
        for (let propIndex = 0; propIndex < beat.propositions.length; propIndex++) {
          const prop = beat.propositions[propIndex];
          if (prop.embedding) {
            itemsWithRefs.push({
              type: 'proposition',
              sceneId: scene.id,
              sceneIndex: entryIndex,  // Use position in resolvedKeys
              arcId: scene.arcId,
              beatIndex,
              propIndex,
              content: prop.content,
              embeddingRef: prop.embedding,
              context: `${beat.what} → ${prop.content}`,
            });
          }
        }
      }
    }
  }

  // Resolve all embedding references (batch operation)
  const resolvedEmbeddings = await Promise.all(
    itemsWithRefs.map(item => resolveEmbedding(item.embeddingRef))
  );

  // Filter out items where embedding resolution failed
  const items: Array<{
    type: 'proposition' | 'beat' | 'scene';
    sceneId: string;
    sceneIndex: number;
    arcId?: string;
    beatIndex?: number;
    propIndex?: number;
    content: string;
    embedding: number[];
    context: string;
  }> = [];

  for (let i = 0; i < itemsWithRefs.length; i++) {
    const embedding = resolvedEmbeddings[i];
    if (embedding) {
      items.push({
        ...itemsWithRefs[i],
        embedding,
      });
    }
  }

  // Compute similarities in-memory (linear scan)
  const scored = items.map(item => ({
    ...item,
    similarity: cosineSimilarity(queryEmbedding, item.embedding),
  }));

  // Split into three pools — proportional to granularity
  const scoredScenes = scored.filter(item => item.type === 'scene');
  const scoredBeats = scored.filter(item => item.type === 'beat');
  const scoredPropositions = scored.filter(item => item.type === 'proposition');

  const toResult = ({ type, sceneId, beatIndex, propIndex, content, similarity, context }: typeof scored[0]): SearchResult => ({
    type, id: `${sceneId}-${beatIndex ?? 'scene'}-${propIndex ?? ''}`,
    sceneId, beatIndex, propIndex, content, similarity, context,
  });

  // Top K per pool — propositions get the most slots, scenes the fewest
  const sceneResults: SearchResult[] = scoredScenes
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, SEARCH_TOP_K_SCENES)
    .map(toResult);

  const beatResults = scoredBeats
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, SEARCH_TOP_K_BEATS)
    .map(toResult);

  const propositionResults = scoredPropositions
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, SEARCH_TOP_K_PROPOSITIONS)
    .map(toResult);

  // Detail results = propositions first, then beats (propositions dominate)
  const detailResults: SearchResult[] = [...propositionResults, ...beatResults]
    .sort((a, b) => b.similarity - a.similarity);

  // Combined results = all three pools merged
  const results: SearchResult[] = [...sceneResults, ...detailResults]
    .sort((a, b) => b.similarity - a.similarity);

  // Build scene summary timeline (direct similarity values from scene embeddings)
  // Include ALL entries (scenes and world commits) to preserve timeline structure
  // World commits will have 0 similarity
  const sceneSimilarityMap = new Map<number, number>();
  for (const item of scoredScenes) {
    sceneSimilarityMap.set(item.sceneIndex, item.similarity);
  }

  const sceneTimeline = Array.from({ length: resolvedKeys.length }, (_, i) => ({
    sceneIndex: i,
    similarity: sceneSimilarityMap.get(i) ?? 0,
  }));

  // Build detail timeline (max similarity from beats/propositions per scene)
  // Include ALL entries to preserve timeline structure
  const detailMaxSimilarity = new Map<number, number>();
  for (const item of [...scoredBeats, ...scoredPropositions]) {
    const current = detailMaxSimilarity.get(item.sceneIndex) ?? 0;
    if (item.similarity > current) {
      detailMaxSimilarity.set(item.sceneIndex, item.similarity);
    }
  }

  const detailTimeline = Array.from({ length: resolvedKeys.length }, (_, i) => ({
    sceneIndex: i,
    maxSimilarity: detailMaxSimilarity.get(i) ?? 0,
  }));

  // Find top arc (highest average similarity)
  const arcSimilarities = new Map<string, { sum: number; count: number }>();
  for (const item of scored) {
    if (!item.arcId) continue;
    const current = arcSimilarities.get(item.arcId) ?? { sum: 0, count: 0 };
    arcSimilarities.set(item.arcId, {
      sum: current.sum + item.similarity,
      count: current.count + 1,
    });
  }

  let topArc: { arcId: string; avgSimilarity: number } | null = null;
  for (const [arcId, { sum, count }] of arcSimilarities) {
    const avgSimilarity = sum / count;
    if (!topArc || avgSimilarity > topArc.avgSimilarity) {
      topArc = { arcId, avgSimilarity };
    }
  }

  // Find top scene (highest max similarity)
  let topScene: { sceneId: string; similarity: number } | null = null;
  for (const item of scored) {
    if (item.type === 'scene' && (!topScene || item.similarity > topScene.similarity)) {
      topScene = { sceneId: item.sceneId, similarity: item.similarity };
    }
  }

  // Find top beat (highest similarity from beat-level items)
  let topBeat: { sceneId: string; beatIndex: number; similarity: number } | null = null;
  for (const item of scored) {
    if (item.type === 'beat' && item.beatIndex !== undefined) {
      if (!topBeat || item.similarity > topBeat.similarity) {
        topBeat = { sceneId: item.sceneId, beatIndex: item.beatIndex, similarity: item.similarity };
      }
    }
  }

  logInfo('Completed semantic search', {
    source: 'search',
    operation: 'search-complete',
    details: {
      narrativeId: narrative.id,
      query: query.substring(0, 100),
      totalItems: items.length,
      resultsFound: results.length,
      topScore: results[0]?.similarity ?? 0,
    },
  });

  return {
    query,
    embedding: queryEmbedding,
    results,
    sceneResults,
    detailResults,
    sceneTimeline,
    detailTimeline,
    topArc,
    topScene,
    topBeat,
  };
}
