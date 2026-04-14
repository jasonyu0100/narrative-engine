/**
 * Asset Manager - Decoupled storage for large binary assets
 *
 * ARCHITECTURE:
 * - Narrative JSON stores ONLY references (IDs like "emb_abc123", "audio_xyz789")
 * - Binary data (embeddings, audio, images) stored in IndexedDB
 * - Export packages combine narrative + assets in ZIP
 *
 * BENEFITS:
 * - Narrative JSON: ~1MB (git-friendly, readable)
 * - Binary storage: 50% smaller than JSON
 * - Selective loading: Only load assets when needed
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { nanoid } from 'nanoid';
import { logError } from '@/lib/system-logger';

// ── IndexedDB Schema ──────────────────────────────────────────────────────────

interface AssetDB extends DBSchema {
  /**
   * Embeddings Store
   * - 1536-dim vectors stored as Float32Array (6KB each)
   * - ID format: "emb_abc123" (10 chars)
   * - Indexed by narrativeId for efficient per-narrative queries
   */
  embeddings: {
    key: string;
    value: {
      id: string;
      vector: Float32Array;  // Binary storage — Float32 is sufficient for embedding similarity
      model: string;         // "text-embedding-3-small"
      narrativeId: string;   // Which narrative owns this asset
      createdAt: number;
    };
    indexes: { 'by-narrative': string };
  };

  /**
   * Audio Store
   * - Audio blobs (MP3, WAV, etc.)
   * - ID format: "audio_xyz789" (10 chars)
   * - Indexed by narrativeId for efficient per-narrative queries
   */
  audio: {
    key: string;
    value: {
      id: string;
      blob: Blob;
      format: string;  // "audio/mp3", "audio/wav"
      duration?: number;  // seconds
      narrativeId: string;   // Which narrative owns this asset
      createdAt: number;
    };
    indexes: { 'by-narrative': string };
  };

  /**
   * Images Store
   * - Image blobs (PNG, JPG, etc.)
   * - ID format: "img_def456" (10 chars)
   * - Indexed by narrativeId for efficient per-narrative queries
   */
  images: {
    key: string;
    value: {
      id: string;
      blob: Blob;
      format: string;  // "image/png", "image/jpeg"
      width?: number;
      height?: number;
      narrativeId: string;   // Which narrative owns this asset
      createdAt: number;
    };
    indexes: { 'by-narrative': string };
  };
}

// ── Asset Manager ─────────────────────────────────────────────────────────────

class AssetManager {
  private db: IDBPDatabase<AssetDB> | null = null;
  private dbName = 'inktide-assets';
  private dbVersion = 1;

  // Blob URL cache (for audio/images)
  private blobUrlCache = new Map<string, string>();

  // ── Initialization ──────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.db) return; // Already initialized

    this.db = await openDB<AssetDB>(this.dbName, this.dbVersion, {
      upgrade(db) {
        // Create stores with narrativeId indexes
        if (!db.objectStoreNames.contains('embeddings')) {
          const embStore = db.createObjectStore('embeddings', { keyPath: 'id' });
          embStore.createIndex('by-narrative', 'narrativeId');
        }
        if (!db.objectStoreNames.contains('audio')) {
          const audioStore = db.createObjectStore('audio', { keyPath: 'id' });
          audioStore.createIndex('by-narrative', 'narrativeId');
        }
        if (!db.objectStoreNames.contains('images')) {
          const imgStore = db.createObjectStore('images', { keyPath: 'id' });
          imgStore.createIndex('by-narrative', 'narrativeId');
        }
      },
    });
  }

  private ensureInitialized(): IDBPDatabase<AssetDB> {
    if (!this.db) {
      throw new Error('AssetManager not initialized. Call init() first.');
    }
    return this.db;
  }

  // ── Embeddings ──────────────────────────────────────────────────────────────

  /**
   * Store an embedding vector and return its ID reference
   * @param vector - 1536-dim embedding array
   * @param model - Model name (default: "text-embedding-3-small")
   * @param id - Optional ID (for imports)
   * @returns ID reference like "emb_abc123"
   */
  async storeEmbedding(
    vector: number[],
    model: string = 'text-embedding-3-small',
    id?: string,
    narrativeId: string = 'global',
  ): Promise<string> {
    const db = this.ensureInitialized();

    const embeddingId = id || this.generateId('emb');
    const entry = {
      id: embeddingId,
      vector: new Float32Array(vector),
      model,
      narrativeId,
      createdAt: Date.now(),
    };

    await db.put('embeddings', entry);
    return embeddingId;
  }

  /**
   * Retrieve an embedding vector by ID
   * @param id - ID like "emb_abc123"
   * @returns Embedding array or null if not found
   */
  async getEmbedding(id: string): Promise<number[] | null> {
    const db = this.ensureInitialized();
    const entry = await db.get('embeddings', id);

    if (!entry) return null;

    // Convert Float32Array back to regular array
    return Array.from(entry.vector);
  }

  /**
   * Retrieve multiple embeddings at once (batch operation)
   * @param ids - Array of IDs
   * @returns Map of ID → embedding array
   */
  async getEmbeddingsBatch(ids: string[]): Promise<Map<string, number[]>> {
    const db = this.ensureInitialized();
    const results = new Map<string, number[]>();

    await Promise.all(
      ids.map(async (id) => {
        const entry = await db.get('embeddings', id);
        if (entry) {
          results.set(id, Array.from(entry.vector));
        }
      }),
    );

    return results;
  }

  /**
   * Delete an embedding by ID
   */
  async deleteEmbedding(id: string): Promise<void> {
    const db = this.ensureInitialized();
    await db.delete('embeddings', id);
  }

  // ── Audio ───────────────────────────────────────────────────────────────────

  /**
   * Store audio blob and return its ID reference
   * @param blob - Audio blob (MP3, WAV, etc.)
   * @param format - MIME type (e.g., "audio/mp3")
   * @param id - Optional ID (for imports)
   * @param narrativeId - Narrative ID (default: 'global')
   * @returns ID reference like "audio_xyz789"
   */
  async storeAudio(blob: Blob, format?: string, id?: string, narrativeId: string = 'global'): Promise<string> {
    const db = this.ensureInitialized();

    const audioId = id || this.generateId('audio');
    const entry = {
      id: audioId,
      blob,
      format: format || blob.type,
      narrativeId,
      createdAt: Date.now(),
    };

    await db.put('audio', entry);
    return audioId;
  }

  /**
   * Retrieve audio blob by ID
   */
  async getAudio(id: string): Promise<Blob | null> {
    const db = this.ensureInitialized();
    const entry = await db.get('audio', id);
    return entry?.blob || null;
  }

  /**
   * Get audio as a blob URL (for <audio> elements)
   * - Creates blob URL on first call
   * - Caches URL for subsequent calls
   * - Call revokeBlobUrls() to clean up
   */
  async getAudioUrl(id: string): Promise<string | null> {
    // Check cache first
    if (this.blobUrlCache.has(id)) {
      return this.blobUrlCache.get(id)!;
    }

    // Fetch blob and create URL
    const blob = await this.getAudio(id);
    if (!blob) return null;

    const url = URL.createObjectURL(blob);
    this.blobUrlCache.set(id, url);
    return url;
  }

  /**
   * Delete audio by ID
   */
  async deleteAudio(id: string): Promise<void> {
    const db = this.ensureInitialized();
    await db.delete('audio', id);

    // Revoke blob URL if cached
    if (this.blobUrlCache.has(id)) {
      URL.revokeObjectURL(this.blobUrlCache.get(id)!);
      this.blobUrlCache.delete(id);
    }
  }

  // ── Images ──────────────────────────────────────────────────────────────────

  /**
   * Store image blob and return its ID reference
   * @param blob - Image blob (PNG, JPG, etc.)
   * @param format - MIME type (e.g., "image/png")
   * @param id - Optional ID (for imports)
   * @param narrativeId - Narrative ID (default: 'global')
   * @returns ID reference like "img_def456"
   */
  async storeImage(blob: Blob, format?: string, id?: string, narrativeId: string = 'global'): Promise<string> {
    const db = this.ensureInitialized();

    const imageId = id || this.generateId('img');
    const entry = {
      id: imageId,
      blob,
      format: format || blob.type,
      narrativeId,
      createdAt: Date.now(),
    };

    await db.put('images', entry);
    return imageId;
  }

  /**
   * Retrieve image blob by ID
   */
  async getImage(id: string): Promise<Blob | null> {
    const db = this.ensureInitialized();
    const entry = await db.get('images', id);
    return entry?.blob || null;
  }

  /**
   * Get image as a blob URL (for <img> elements)
   */
  async getImageUrl(id: string): Promise<string | null> {
    // Check cache first
    if (this.blobUrlCache.has(id)) {
      return this.blobUrlCache.get(id)!;
    }

    // Fetch blob and create URL
    const blob = await this.getImage(id);
    if (!blob) return null;

    const url = URL.createObjectURL(blob);
    this.blobUrlCache.set(id, url);
    return url;
  }

  /**
   * Delete image by ID
   */
  async deleteImage(id: string): Promise<void> {
    const db = this.ensureInitialized();
    await db.delete('images', id);

    // Revoke blob URL if cached
    if (this.blobUrlCache.has(id)) {
      URL.revokeObjectURL(this.blobUrlCache.get(id)!);
      this.blobUrlCache.delete(id);
    }
  }

  // ── Cleanup & Utilities ─────────────────────────────────────────────────────

  /**
   * Get all asset IDs currently stored
   */
  async getAllAssetIds(): Promise<{
    embeddings: string[];
    audio: string[];
    images: string[];
  }> {
    const db = this.ensureInitialized();

    const [embeddings, audio, images] = await Promise.all([
      db.getAllKeys('embeddings'),
      db.getAllKeys('audio'),
      db.getAllKeys('images'),
    ]);

    return { embeddings, audio, images };
  }

  /**
   * Delete assets not referenced in the narrative
   * (Garbage collection for unused assets)
   */
  async pruneUnreferencedAssets(referencedIds: {
    embeddings: Set<string>;
    audio: Set<string>;
    images: Set<string>;
  }): Promise<{ deletedCount: number }> {
    const db = this.ensureInitialized();
    const allIds = await this.getAllAssetIds();

    let deletedCount = 0;

    // Delete unreferenced embeddings
    for (const embId of allIds.embeddings) {
      if (!referencedIds.embeddings.has(embId)) {
        await db.delete('embeddings', embId);
        deletedCount++;
      }
    }

    // Delete unreferenced audio
    for (const audioId of allIds.audio) {
      if (!referencedIds.audio.has(audioId)) {
        await this.deleteAudio(audioId); // Use deleteAudio to revoke blob URLs
        deletedCount++;
      }
    }

    // Delete unreferenced images
    for (const imgId of allIds.images) {
      if (!referencedIds.images.has(imgId)) {
        await this.deleteImage(imgId); // Use deleteImage to revoke blob URLs
        deletedCount++;
      }
    }

    return { deletedCount };
  }

  /**
   * Revoke all cached blob URLs
   * Call this when closing the app or switching narratives
   */
  revokeBlobUrls(): void {
    for (const url of this.blobUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobUrlCache.clear();
  }

  /**
   * Clear all assets (DANGER: destructive)
   */
  async clearAllAssets(): Promise<void> {
    const db = this.ensureInitialized();
    await Promise.all([
      db.clear('embeddings'),
      db.clear('audio'),
      db.clear('images'),
    ]);
    this.revokeBlobUrls();
  }

  /**
   * Delete all assets for a specific narrative
   * @param narrativeId - The narrative ID to delete assets for
   * @returns Count of deleted assets
   */
  async deleteNarrativeAssets(narrativeId: string): Promise<{ embeddingCount: number; audioCount: number; imageCount: number }> {
    const db = this.ensureInitialized();

    let embeddingCount = 0;
    let audioCount = 0;
    let imageCount = 0;

    // Delete embeddings for this narrative
    const embeddingIds = await db.getAllKeysFromIndex('embeddings', 'by-narrative', narrativeId);
    for (const id of embeddingIds) {
      await this.deleteEmbedding(id as string);
      embeddingCount++;
    }

    // Delete audio for this narrative
    const audioIds = await db.getAllKeysFromIndex('audio', 'by-narrative', narrativeId);
    for (const id of audioIds) {
      await this.deleteAudio(id as string);
      audioCount++;
    }

    // Delete images for this narrative
    const imageIds = await db.getAllKeysFromIndex('images', 'by-narrative', narrativeId);
    for (const id of imageIds) {
      await this.deleteImage(id as string);
      imageCount++;
    }

    return { embeddingCount, audioCount, imageCount };
  }

  // ── Private Helpers ─────────────────────────────────────────────────────────

  private generateId(prefix: string): string {
    // Format: "emb_abc123" (10 chars total)
    return `${prefix}_${nanoid(6)}`;
  }
}

// ── Export Singleton Instance ─────────────────────────────────────────────────

export const assetManager = new AssetManager();

// Auto-initialize on import (browser environment only)
if (typeof window !== 'undefined') {
  assetManager.init().catch((err) => {
    logError('Failed to initialize AssetManager', err, {
      source: 'asset',
      operation: 'init',
    });
  });
}
