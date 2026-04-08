/**
 * AssetManager Tests
 *
 * Tests for IndexedDB-based asset storage (embeddings, images, audio)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { assetManager } from '@/lib/asset-manager';

// Helper to compare vectors with Float32 precision tolerance
function expectVectorsClose(actual: number[] | null, expected: number[], tolerance = 1e-6) {
  expect(actual).toBeTruthy();
  expect(actual!.length).toBe(expected.length);

  for (let i = 0; i < expected.length; i++) {
    expect(Math.abs(actual![i] - expected[i])).toBeLessThan(tolerance);
  }
}

describe('AssetManager', () => {
  beforeEach(async () => {
    // Initialize assetManager before each test
    await assetManager.init();
  });

  describe('Embedding Storage', () => {
    it('should store and retrieve embeddings', async () => {
      const vector = Array.from({ length: 1536 }, (_, i) => Math.random());
      const embId = await assetManager.storeEmbedding(vector, 'text-embedding-3-small');

      expect(embId).toMatch(/^emb_/);
      expect(embId.length).toBe(10);

      const retrieved = await assetManager.getEmbedding(embId);
      expectVectorsClose(retrieved, vector);
    });

    it('should support custom embedding IDs', async () => {
      const vector = Array.from({ length: 1536 }, () => 0.5);
      const customId = 'emb_custom1';
      const embId = await assetManager.storeEmbedding(vector, 'text-embedding-3-small', customId);

      expect(embId).toBe(customId);

      const retrieved = await assetManager.getEmbedding(customId);
      expectVectorsClose(retrieved, vector);
    });

    it('should batch retrieve embeddings', async () => {
      const vectors = [
        Array.from({ length: 1536 }, () => 0.1),
        Array.from({ length: 1536 }, () => 0.2),
        Array.from({ length: 1536 }, () => 0.3),
      ];

      const ids = await Promise.all(
        vectors.map((v) => assetManager.storeEmbedding(v, 'text-embedding-3-small'))
      );

      const results = await assetManager.getEmbeddingsBatch(ids);

      expect(results.size).toBe(3);
      ids.forEach((id, i) => {
        expectVectorsClose(results.get(id)!, vectors[i]);
      });
    });

    it('should return null for non-existent embeddings', async () => {
      const result = await assetManager.getEmbedding('emb_nonexist');
      expect(result).toBeNull();
    });

    it('should delete embeddings', async () => {
      const vector = Array.from({ length: 1536 }, () => 0.42);
      const embId = await assetManager.storeEmbedding(vector, 'text-embedding-3-small');

      const retrieved1 = await assetManager.getEmbedding(embId);
      expectVectorsClose(retrieved1, vector);

      await assetManager.deleteEmbedding(embId);

      const retrieved2 = await assetManager.getEmbedding(embId);
      expect(retrieved2).toBeNull();
    });

    it('should handle batch retrieval with missing IDs', async () => {
      const vector = Array.from({ length: 1536 }, () => 0.7);
      const embId = await assetManager.storeEmbedding(vector, 'text-embedding-3-small');

      const results = await assetManager.getEmbeddingsBatch([
        embId,
        'emb_missing1',
        'emb_missing2',
      ]);

      expect(results.size).toBe(1);
      expectVectorsClose(results.get(embId)!, vector);
      expect(results.get('emb_missing1')).toBeUndefined();
    });
  });

  describe('Image Storage', () => {
    it('should store and retrieve images', async () => {
      const imageBlob = new Blob(['fake-image-data'], { type: 'image/png' });
      const imgId = await assetManager.storeImage(imageBlob, 'image/png');

      expect(imgId).toMatch(/^img_/);
      expect(imgId.length).toBe(10);

      const retrieved = await assetManager.getImage(imgId);
      expect(retrieved).toBeInstanceOf(Blob);
      expect(retrieved?.type).toBe('image/png');
    });

    it('should generate blob URLs for images', async () => {
      const imageBlob = new Blob(['test-image'], { type: 'image/webp' });
      const imgId = await assetManager.storeImage(imageBlob, 'image/webp');

      const blobUrl = await assetManager.getImageUrl(imgId);
      expect(blobUrl).toMatch(/^blob:/);
    });

    it('should support custom image IDs', async () => {
      const imageBlob = new Blob(['custom-image'], { type: 'image/jpeg' });
      const customId = 'img_cover01';
      const imgId = await assetManager.storeImage(imageBlob, 'image/jpeg', customId);

      expect(imgId).toBe(customId);

      const retrieved = await assetManager.getImage(customId);
      expect(retrieved?.type).toBe('image/jpeg');
    });

    it('should return null for non-existent images', async () => {
      const result = await assetManager.getImage('img_nonexist');
      expect(result).toBeNull();
    });

    it('should delete images', async () => {
      const imageBlob = new Blob(['delete-me'], { type: 'image/png' });
      const imgId = await assetManager.storeImage(imageBlob, 'image/png');

      const retrieved1 = await assetManager.getImage(imgId);
      expect(retrieved1).not.toBeNull();

      await assetManager.deleteImage(imgId);

      const retrieved2 = await assetManager.getImage(imgId);
      expect(retrieved2).toBeNull();
    });
  });

  describe('Audio Storage', () => {
    it('should store and retrieve audio', async () => {
      const audioBlob = new Blob(['fake-audio-data'], { type: 'audio/mpeg' });
      const audioId = await assetManager.storeAudio(audioBlob, 'audio/mpeg');

      expect(audioId).toMatch(/^audio_/);
      expect(audioId.length).toBe(12);  // "audio_" + 6 chars = 12

      const retrieved = await assetManager.getAudio(audioId);
      expect(retrieved).toBeInstanceOf(Blob);
      expect(retrieved?.type).toBe('audio/mpeg');
    });

    it('should generate blob URLs for audio', async () => {
      const audioBlob = new Blob(['test-audio'], { type: 'audio/mpeg' });
      const audioId = await assetManager.storeAudio(audioBlob, 'audio/mpeg');

      const blobUrl = await assetManager.getAudioUrl(audioId);
      expect(blobUrl).toMatch(/^blob:/);
    });

    it('should support custom audio IDs', async () => {
      const audioBlob = new Blob(['scene-audio'], { type: 'audio/mpeg' });
      const customId = 'audio_scene123';
      const audioId = await assetManager.storeAudio(audioBlob, 'audio/mpeg', customId);

      expect(audioId).toBe(customId);

      const retrieved = await assetManager.getAudio(customId);
      expect(retrieved?.type).toBe('audio/mpeg');
    });

    it('should return null for non-existent audio', async () => {
      const result = await assetManager.getAudio('audio_nonexist');
      expect(result).toBeNull();
    });

    it('should delete audio', async () => {
      const audioBlob = new Blob(['remove-audio'], { type: 'audio/mpeg' });
      const audioId = await assetManager.storeAudio(audioBlob, 'audio/mpeg');

      const retrieved1 = await assetManager.getAudio(audioId);
      expect(retrieved1).not.toBeNull();

      await assetManager.deleteAudio(audioId);

      const retrieved2 = await assetManager.getAudio(audioId);
      expect(retrieved2).toBeNull();
    });
  });

  describe('Garbage Collection', () => {
    it('should prune unreferenced assets', async () => {
      // Clear all assets first to get accurate count
      await assetManager.pruneUnreferencedAssets({
        embeddings: new Set(),
        audio: new Set(),
        images: new Set(),
      });

      // Store some assets
      const emb1 = await assetManager.storeEmbedding(Array.from({ length: 1536 }, () => 0.1), 'text-embedding-3-small');
      const emb2 = await assetManager.storeEmbedding(Array.from({ length: 1536 }, () => 0.2), 'text-embedding-3-small');
      const img1 = await assetManager.storeImage(new Blob(['img1']), 'image/png');
      const audio1 = await assetManager.storeAudio(new Blob(['audio1']), 'audio/mpeg');

      // Only reference emb1 and img1
      const referencedIds = {
        embeddings: new Set([emb1]),
        audio: new Set<string>(),
        images: new Set([img1]),
      };

      const result = await assetManager.pruneUnreferencedAssets(referencedIds);

      // Should delete emb2 and audio1, keep emb1 and img1
      expect(result.deletedCount).toBe(2);

      // Verify kept assets still exist
      expect(await assetManager.getEmbedding(emb1)).not.toBeNull();
      expect(await assetManager.getImage(img1)).not.toBeNull();

      // Verify deleted assets are gone
      expect(await assetManager.getEmbedding(emb2)).toBeNull();
      expect(await assetManager.getAudio(audio1)).toBeNull();
    });
  });

  describe('Binary Storage Efficiency', () => {
    it('should store embeddings as binary Float32Array', async () => {
      const vector = Array.from({ length: 1536 }, () => Math.random());
      const embId = await assetManager.storeEmbedding(vector, 'text-embedding-3-small');

      const retrieved = await assetManager.getEmbedding(embId);

      // Verify precision is maintained (Float32)
      retrieved?.forEach((val, i) => {
        // Float32 precision check - values should be close but not exact
        expect(Math.abs(val - vector[i])).toBeLessThan(1e-6);
      });
    });

    it('should correctly handle embedding dimensions', async () => {
      const dimensions = 1536;
      const vector = Array.from({ length: dimensions }, (_, i) => i / dimensions);
      const embId = await assetManager.storeEmbedding(vector, 'text-embedding-3-small');

      const retrieved = await assetManager.getEmbedding(embId);
      expect(retrieved?.length).toBe(dimensions);
    });
  });
});
