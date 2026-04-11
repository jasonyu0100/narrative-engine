/**
 * Package Export/Import Tests
 *
 * Tests for .inktide ZIP package export and import
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { exportAsPackage, estimateExportSize } from '@/lib/package-export';
import { importFromPackage, validatePackage, getPackageInfo, formatBytes } from '@/lib/package-import';
import { assetManager } from '@/lib/asset-manager';
import type { NarrativeState, Scene, Character, Location } from '@/types/narrative';

// Helper to convert Blob to File (with ArrayBuffer for Node.js compatibility)
async function blobToFile(blob: Blob, filename: string): Promise<File> {
  const arrayBuffer = await blob.arrayBuffer();
  return new File([arrayBuffer], filename, { type: blob.type });
}

// Helper to create a minimal test narrative
function createTestNarrative(): NarrativeState {
  const narrative: NarrativeState = {
    id: 'test-narrative',
    title: 'Test Story',
    description: 'A test narrative for package export/import',
    characters: {},
    locations: {},
    threads: {},
    artifacts: {},
    arcs: {},
    scenes: {},
    worldBuilds: {},
    branches: {
      main: {
        id: 'main',
        name: 'Main',
        parentBranchId: null,
        forkEntryId: null,
        entryIds: ['scene1', 'scene2'],
        createdAt: Date.now(),
      },
    },
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: 'Test world',
    rules: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return narrative;
}

describe('Package Export/Import', () => {
  beforeEach(async () => {
    await assetManager.init();
  });

  describe('Export Size Estimation', () => {
    it('should estimate narrative size', () => {
      const narrative = createTestNarrative();
      const estimate = estimateExportSize(narrative, {
        includeEmbeddings: false,
        includeAudio: false,
        includeImages: false,
        compressionLevel: 'none',
      });

      expect(estimate.narrative).toBeGreaterThan(0);
      expect(estimate.embeddings).toBe(0);
      expect(estimate.audio).toBe(0);
      expect(estimate.images).toBe(0);
      expect(estimate.total).toBe(estimate.narrative);
    });

    it('should estimate embeddings size', async () => {
      const narrative = createTestNarrative();

      // Add scenes with embeddings
      const emb1 = await assetManager.storeEmbedding(Array.from({ length: 1536 }, () => 0.1), 'text-embedding-3-small');
      const emb2 = await assetManager.storeEmbedding(Array.from({ length: 1536 }, () => 0.2), 'text-embedding-3-small');

      narrative.scenes = {
        scene1: {
          kind: 'scene',
          id: 'scene1',
          arcId: 'arc1',
          locationId: 'loc1',
          povId: 'char1',
          participantIds: [],
          events: [],
          threadMutations: [],
          continuityMutations: [],
          relationshipMutations: [],
          summary: 'Scene 1',
          summaryEmbedding: emb1,
        } as Scene,
        scene2: {
          kind: 'scene',
          id: 'scene2',
          arcId: 'arc1',
          locationId: 'loc1',
          povId: 'char1',
          participantIds: [],
          events: [],
          threadMutations: [],
          continuityMutations: [],
          relationshipMutations: [],
          summary: 'Scene 2',
          summaryEmbedding: emb2,
        } as Scene,
      };

      const estimate = estimateExportSize(narrative, {
        includeEmbeddings: true,
        includeAudio: false,
        includeImages: false,
        compressionLevel: 'none',
      });

      expect(estimate.embeddings).toBeGreaterThan(0);
      // 2 embeddings * ~6KB each ≈ 12KB
      expect(estimate.embeddings).toBeGreaterThanOrEqual(12000);
    });
  });

  describe('Package Export', () => {
    it('should create a valid ZIP package', async () => {
      const narrative = createTestNarrative();

      const zipBlob = await exportAsPackage(narrative, {
        includeEmbeddings: false,
        includeAudio: false,
        includeImages: false,
        compressionLevel: 'none',
      });

      expect(zipBlob).toBeInstanceOf(Blob);
      expect(zipBlob.size).toBeGreaterThan(0);
    });

    it('should include narrative.json in package', async () => {
      const narrative = createTestNarrative();

      const zipBlob = await exportAsPackage(narrative, {
        includeEmbeddings: false,
        includeAudio: false,
        includeImages: false,
        compressionLevel: 'none',
      });

      // Convert blob to file with ArrayBuffer for Node.js compatibility
      const file = await blobToFile(zipBlob, 'test.inktide');
      const validation = await validatePackage(file);

      expect(validation.valid).toBe(true);
    });

    it('should export embeddings as binary files', async () => {
      const narrative = createTestNarrative();

      const emb1 = await assetManager.storeEmbedding(Array.from({ length: 1536 }, () => 0.5), 'text-embedding-3-small');

      narrative.scenes.scene1 = {
        kind: 'scene',
        id: 'scene1',
        arcId: 'arc1',
        locationId: 'loc1',
        povId: 'char1',
        participantIds: [],
        events: [],
        threadMutations: [],
        continuityMutations: [],
        relationshipMutations: [],
        summary: 'Test scene',
        summaryEmbedding: emb1,
      } as Scene;

      const zipBlob = await exportAsPackage(narrative, {
        includeEmbeddings: true,
        includeAudio: false,
        includeImages: false,
        compressionLevel: 'none',
      });

      const file = new File([zipBlob], 'test.inktide');
      const info = await getPackageInfo(file);

      expect(info.manifest.assets.embeddings).toBe(1);
      expect(info.sizes.embeddings).toBeGreaterThan(0);
    });

    it('should collect images from all entity types', async () => {
      const narrative = createTestNarrative();

      // Add images
      const charImg = await assetManager.storeImage(new Blob(['char']), 'image/png');
      const locImg = await assetManager.storeImage(new Blob(['loc']), 'image/png');
      const coverImg = await assetManager.storeImage(new Blob(['cover']), 'image/png');

      narrative.characters.char1 = {
        id: 'char1',
        name: 'Character 1',
        role: 'anchor',
        continuity: { nodes: {}, edges: [] },
        threadIds: [],
        imageUrl: charImg,
      } as Character;

      narrative.locations.loc1 = {
        id: 'loc1',
        name: 'Location 1',
        prominence: 'place' as const,
        parentId: null,
        tiedCharacterIds: [],
        threadIds: [],
        continuity: { nodes: {}, edges: [] },
        imageUrl: locImg,
      } as Location;

      narrative.coverImageUrl = coverImg;

      const zipBlob = await exportAsPackage(narrative, {
        includeEmbeddings: false,
        includeAudio: false,
        includeImages: true,
        compressionLevel: 'none',
      });

      const file = new File([zipBlob], 'test.inktide');
      const info = await getPackageInfo(file);

      expect(info.manifest.assets.images).toBe(3);
    });

    it('should track export progress', async () => {
      const narrative = createTestNarrative();
      const progressUpdates: Array<{ status: string; percent: number }> = [];

      await exportAsPackage(
        narrative,
        {
          includeEmbeddings: false,
          includeAudio: false,
          includeImages: false,
          compressionLevel: 'none',
        },
        (status, percent) => {
          progressUpdates.push({ status, percent });
        }
      );

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[0].percent).toBe(0);
      expect(progressUpdates[progressUpdates.length - 1].percent).toBe(100);
    });
  });

  describe('Package Validation', () => {
    it('should validate correct package structure', async () => {
      const narrative = createTestNarrative();
      const zipBlob = await exportAsPackage(narrative, {
        includeEmbeddings: false,
        includeAudio: false,
        includeImages: false,
        compressionLevel: 'none',
      });

      const file = new File([zipBlob], 'valid.inktide');
      const validation = await validatePackage(file);

      expect(validation.valid).toBe(true);
      expect(validation.error).toBeUndefined();
    });

    it('should reject invalid ZIP files', async () => {
      const invalidBlob = new Blob(['not a zip file']);
      const file = new File([invalidBlob], 'invalid.inktide');

      const validation = await validatePackage(file);

      expect(validation.valid).toBe(false);
      expect(validation.error).toBeDefined();
    });
  });

  describe('Package Import', () => {
    it('should import a simple package', async () => {
      const original = createTestNarrative();

      const zipBlob = await exportAsPackage(original, {
        includeEmbeddings: false,
        includeAudio: false,
        includeImages: false,
        compressionLevel: 'none',
      });

      const file = new File([zipBlob], 'test.inktide');
      const imported = await importFromPackage(file, {
        importEmbeddings: false,
        importAudio: false,
        importImages: false,
      });

      expect(imported.id).toBe(original.id);
      expect(imported.title).toBe(original.title);
      expect(imported.description).toBe(original.description);
    });

    it('should restore embeddings to IndexedDB', async () => {
      const original = createTestNarrative();

      const emb1 = await assetManager.storeEmbedding(Array.from({ length: 1536 }, () => 0.42), 'text-embedding-3-small');

      original.scenes.scene1 = {
        kind: 'scene',
        id: 'scene1',
        arcId: 'arc1',
        locationId: 'loc1',
        povId: 'char1',
        participantIds: [],
        events: [],
        threadMutations: [],
        continuityMutations: [],
        relationshipMutations: [],
        summary: 'Test',
        summaryEmbedding: emb1,
      } as Scene;

      const zipBlob = await exportAsPackage(original, {
        includeEmbeddings: true,
        includeAudio: false,
        includeImages: false,
        compressionLevel: 'none',
      });

      // Clear the embedding from IndexedDB
      await assetManager.deleteEmbedding(emb1);
      expect(await assetManager.getEmbedding(emb1)).toBeNull();

      // Import should restore it
      const file = new File([zipBlob], 'test.inktide');
      const imported = await importFromPackage(file, {
        importEmbeddings: true,
        importAudio: false,
        importImages: false,
      });

      const restoredEmbedding = await assetManager.getEmbedding(emb1);
      expect(restoredEmbedding).not.toBeNull();
      expect(restoredEmbedding?.length).toBe(1536);
    });

    it('should track import progress', async () => {
      const narrative = createTestNarrative();

      const zipBlob = await exportAsPackage(narrative, {
        includeEmbeddings: false,
        includeAudio: false,
        includeImages: false,
        compressionLevel: 'none',
      });

      const file = new File([zipBlob], 'test.inktide');
      const progressUpdates: Array<{ status: string; percent: number }> = [];

      await importFromPackage(
        file,
        {
          importEmbeddings: false,
          importAudio: false,
          importImages: false,
        },
        (status, percent) => {
          progressUpdates.push({ status, percent });
        }
      );

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1].percent).toBe(100);
    });
  });

  describe('Full Round-Trip', () => {
    it('should export and import with all asset types', async () => {
      const original = createTestNarrative();

      // Add embedding
      const emb = await assetManager.storeEmbedding(Array.from({ length: 1536 }, () => 0.7), 'text-embedding-3-small');

      // Add image
      const img = await assetManager.storeImage(new Blob(['test-image']), 'image/png');

      // Add audio
      const audio = await assetManager.storeAudio(new Blob(['test-audio']), 'audio/mpeg');

      original.scenes.scene1 = {
        kind: 'scene',
        id: 'scene1',
        arcId: 'arc1',
        locationId: 'loc1',
        povId: 'char1',
        participantIds: [],
        events: [],
        threadMutations: [],
        continuityMutations: [],
        relationshipMutations: [],
        summary: 'Full test',
        summaryEmbedding: emb,
        imageUrl: img,
        audioUrl: audio,
      } as Scene;

      // Export
      const zipBlob = await exportAsPackage(original, {
        includeEmbeddings: true,
        includeAudio: true,
        includeImages: true,
        compressionLevel: 'medium',
      });

      // Clear IndexedDB
      await assetManager.deleteEmbedding(emb);
      await assetManager.deleteImage(img);
      await assetManager.deleteAudio(audio);

      // Import
      const file = new File([zipBlob], 'full-test.inktide');
      const imported = await importFromPackage(file, {
        importEmbeddings: true,
        importAudio: true,
        importImages: true,
      });

      // Verify narrative structure
      expect(imported.id).toBe(original.id);
      expect(imported.scenes.scene1.summaryEmbedding).toBe(emb);
      expect(imported.scenes.scene1.imageUrl).toBe(img);
      expect(imported.scenes.scene1.audioUrl).toBe(audio);

      // Verify assets restored
      expect(await assetManager.getEmbedding(emb)).not.toBeNull();
      expect(await assetManager.getImage(img)).not.toBeNull();
      expect(await assetManager.getAudio(audio)).not.toBeNull();
    });
  });

  describe('Utility Functions', () => {
    it('should format bytes correctly', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(500)).toBe('500.0 B');
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1536 * 1024)).toBe('1.5 MB');
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    });

    it('should get package info without importing', async () => {
      const narrative = createTestNarrative();
      narrative.title = 'Info Test';

      const zipBlob = await exportAsPackage(narrative, {
        includeEmbeddings: false,
        includeAudio: false,
        includeImages: false,
        compressionLevel: 'none',
      });

      const file = new File([zipBlob], 'info.inktide');
      const info = await getPackageInfo(file);

      expect(info.manifest.narrative.title).toBe('Info Test');
      expect(info.sizes.narrative).toBeGreaterThan(0);
      expect(info.sizes.total).toBeGreaterThan(0);
    });
  });
});
