/**
 * Embedding utilities for semantic search
 * Uses OpenAI text-embedding-3-small model via /api/embeddings
 * Embeddings stored in IndexedDB via AssetManager; narratives contain only reference IDs
 */

import { logInfo, logError } from '@/lib/system-logger';
import { EMBEDDING_BATCH_SIZE } from '@/lib/constants';
import { assetManager } from '@/lib/asset-manager';
import type { EmbeddingRef } from '@/types/narrative';

/**
 * Generate embeddings for an array of texts
 * @param texts Array of text strings to embed
 * @param narrativeId Optional narrative ID for logging context
 * @returns Array of embedding vectors (1536 dims each)
 */
export async function generateEmbeddings(
  texts: string[],
  narrativeId?: string
): Promise<number[][]> {
  const response = await fetch('/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error: ${errorText}`);
  }

  const data = await response.json();

  logInfo('Generated embeddings', {
    source: 'embedding',
    operation: 'generate',
    details: {
      count: texts.length,
      model: data.model,
      totalTokens: data.usage?.total_tokens ?? null,
      narrativeId: narrativeId ?? null,
    },
  });

  return data.embeddings;
}

/**
 * Generate embeddings in batches with progress tracking
 * @param texts Array of text strings to embed
 * @param narrativeId Optional narrative ID for logging context
 * @param onProgress Optional progress callback (completed, total)
 * @returns Array of embedding vectors
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  narrativeId?: string,
  onProgress?: (completed: number, total: number) => void
): Promise<number[][]> {
  const results: number[][] = [];
  let completed = 0;
  const startedAt = Date.now();

  logInfo('Starting embedding batch', {
    source: 'embedding',
    operation: 'batch-generate',
    details: { total: texts.length, batchSize: EMBEDDING_BATCH_SIZE, narrativeId: narrativeId ?? null },
  });

  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    try {
      const embeddings = await generateEmbeddings(batch, narrativeId);
      results.push(...embeddings);
      completed += batch.length;
      onProgress?.(completed, texts.length);
    } catch (error) {
      logError('Failed to generate embedding batch', error, {
        source: 'embedding',
        operation: 'batch-generate',
        details: { batchStart: i, batchSize: batch.length, total: texts.length, narrativeId: narrativeId ?? null },
      });
      throw error;
    }
  }

  logInfo('Embedding batch complete', {
    source: 'embedding',
    operation: 'batch-generate',
    details: {
      total: texts.length,
      durationMs: Date.now() - startedAt,
      narrativeId: narrativeId ?? null,
    },
  });

  return results;
}

/**
 * Compute cosine similarity between two embedding vectors
 * @param a First embedding vector
 * @param b Second embedding vector
 * @returns Similarity score (0-1, higher = more similar)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions must match: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Compute centroid (average) of multiple embedding vectors
 * @param embeddings Array of embedding vectors
 * @returns Centroid vector (same dimensions as input)
 */
export function computeCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];

  const dimensions = embeddings[0].length;
  const centroid = new Array(dimensions).fill(0);

  for (const embedding of embeddings) {
    for (let i = 0; i < dimensions; i++) {
      centroid[i] += embedding[i];
    }
  }

  for (let i = 0; i < dimensions; i++) {
    centroid[i] /= embeddings.length;
  }

  return centroid;
}

/**
 * Resolve an embedding reference to its vector array
 * @param embeddingRef Asset reference ID
 * @returns Embedding vector array, or null if not found
 */
export async function resolveEmbedding(embeddingRef: EmbeddingRef | undefined): Promise<number[] | null> {
  if (!embeddingRef) return null;
  return await assetManager.getEmbedding(embeddingRef);
}

/**
 * Resolve multiple embedding references in batch
 * @param refs Array of embedding references
 * @returns Map of index → vector array (only successful resolutions)
 */
export async function resolveEmbeddingsBatch(refs: (EmbeddingRef | undefined)[]): Promise<Map<number, number[]>> {
  const results = new Map<number, number[]>();

  const refIds: string[] = [];
  const refIndices: number[] = [];

  refs.forEach((ref, i) => {
    if (!ref) return;
    refIds.push(ref);
    refIndices.push(i);
  });

  if (refIds.length > 0) {
    const batchResults = await assetManager.getEmbeddingsBatch(refIds);
    refIds.forEach((id, batchIdx) => {
      const vector = batchResults.get(id);
      if (vector) {
        results.set(refIndices[batchIdx], vector);
      }
    });
  }

  return results;
}

/**
 * Embed propositions and add metadata
 * @param propositions Array of propositions to embed
 * @param narrativeId Optional narrative ID for logging context
 * @returns Propositions with embeddings stored as asset references
 */
export async function embedPropositions(
  propositions: Array<{ content: string; type?: string }>,
  narrativeId?: string
): Promise<Array<{
  content: string;
  type?: string;
  embedding: EmbeddingRef;
  embeddedAt: number;
  embeddingModel: string;
}>> {
  const texts = propositions.map(p => p.content);
  const embeddings = await generateEmbeddingsBatch(texts, narrativeId);
  const timestamp = Date.now();

  return await Promise.all(propositions.map(async (prop, i) => {
    const embeddingId = await assetManager.storeEmbedding(embeddings[i], 'text-embedding-3-small');
    return {
      ...prop,
      embedding: embeddingId,
      embeddedAt: timestamp,
      embeddingModel: 'text-embedding-3-small',
    };
  }));
}
