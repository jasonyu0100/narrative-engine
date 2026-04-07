/**
 * Package Export - Create portable .inktide ZIP packages
 *
 * Combines narrative JSON + binary assets into a single ZIP file
 * Assets are read from IndexedDB and packaged for portability
 */

import JSZip from 'jszip';
import { assetManager } from './asset-manager';
import type { NarrativeState, EmbeddingRef } from '@/types/narrative';

// ── Export Options ────────────────────────────────────────────────────────────

export type ExportOptions = {
  includeEmbeddings: boolean;   // Default: true
  includeAudio: boolean;         // Default: true
  includeImages: boolean;        // Default: true
  compressionLevel: 'none' | 'medium' | 'max';  // ZIP compression
};

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeEmbeddings: true,
  includeAudio: true,
  includeImages: true,
  compressionLevel: 'medium',
};

// ── Manifest Type ─────────────────────────────────────────────────────────────

export type PackageManifest = {
  version: number;
  exported: string;
  narrative: {
    id: string;
    title: string;
    sceneCount: number;
    wordCount: number;
  };
  assets: {
    embeddings: number;
    audio: number;
    images: number;
  };
};

// ── Helper Functions ──────────────────────────────────────────────────────────

/**
 * Collect all asset references from the narrative structure
 */
function collectAssetReferences(narrative: NarrativeState): {
  embeddings: Set<string>;
  audio: Set<string>;
  images: Set<string>;
} {
  const refs = {
    embeddings: new Set<string>(),
    audio: new Set<string>(),
    images: new Set<string>(),
  };

  // Helper to collect embedding reference
  const addEmbedding = (ref: EmbeddingRef | undefined) => {
    if (ref && typeof ref === 'string') {
      refs.embeddings.add(ref);
    }
  };

  // Scan all scenes
  for (const scene of Object.values(narrative.scenes)) {
    // Scene-level embeddings
    addEmbedding(scene.summaryEmbedding);
    addEmbedding(scene.proseEmbedding);
    addEmbedding(scene.planEmbeddingCentroid);

    // Audio
    if (scene.audioUrl?.startsWith('audio_')) {
      refs.audio.add(scene.audioUrl);
    }

    // Images
    if (scene.imageUrl?.startsWith('img_')) {
      refs.images.add(scene.imageUrl);
    }

    // Plan embeddings - collect from all plan versions
    if (scene.planVersions) {
      for (const version of scene.planVersions) {
        const plan = version.plan;
        if (!plan) continue;

        for (const beat of plan.beats) {
          addEmbedding(beat.embeddingCentroid);

          for (const prop of beat.propositions) {
            addEmbedding(prop.embedding);
          }
        }
      }
    }
  }

  // Character images
  for (const char of Object.values(narrative.characters)) {
    if (char.imageUrl?.startsWith('img_')) {
      refs.images.add(char.imageUrl);
    }
  }

  // Location images
  for (const loc of Object.values(narrative.locations)) {
    if (loc.imageUrl?.startsWith('img_')) {
      refs.images.add(loc.imageUrl);
    }
  }

  // Artifact images
  for (const artifact of Object.values(narrative.artifacts)) {
    if (artifact.imageUrl?.startsWith('img_')) {
      refs.images.add(artifact.imageUrl);
    }
  }

  // Cover image
  if (narrative.coverImageUrl?.startsWith('img_')) {
    refs.images.add(narrative.coverImageUrl);
  }

  return refs;
}

/**
 * Estimate word count from narrative
 */
function estimateWordCount(narrative: NarrativeState): number {
  let wordCount = 0;

  for (const scene of Object.values(narrative.scenes)) {
    // Use latest prose version for word count estimation
    const latestProse = scene.proseVersions?.[scene.proseVersions.length - 1]?.prose;
    if (latestProse) {
      wordCount += latestProse.split(/\s+/).length;
    }
  }

  return wordCount;
}

// ── Asset Validation ──────────────────────────────────────────────────────────

export type AssetValidationResult = {
  valid: boolean;
  warnings: string[];
  missingAssets: {
    embeddings: string[];
    audio: string[];
    images: string[];
  };
  stats: {
    totalEmbeddings: number;
    missingEmbeddings: number;
    totalAudio: number;
    missingAudio: number;
    totalImages: number;
    missingImages: number;
  };
};

/**
 * Validate that all asset references in the narrative can be resolved
 * Returns detailed report of any missing/orphaned references
 *
 * This should be called before export to warn users about data loss
 */
export async function validateAssets(narrative: NarrativeState): Promise<AssetValidationResult> {
  const refs = collectAssetReferences(narrative);
  const result: AssetValidationResult = {
    valid: true,
    warnings: [],
    missingAssets: {
      embeddings: [],
      audio: [],
      images: [],
    },
    stats: {
      totalEmbeddings: refs.embeddings.size,
      missingEmbeddings: 0,
      totalAudio: refs.audio.size,
      missingAudio: 0,
      totalImages: refs.images.size,
      missingImages: 0,
    },
  };

  // Check embeddings
  for (const embId of refs.embeddings) {
    const vector = await assetManager.getEmbedding(embId);
    if (!vector) {
      result.valid = false;
      result.missingAssets.embeddings.push(embId);
      result.stats.missingEmbeddings++;
    }
  }

  // Check audio
  for (const audioId of refs.audio) {
    const blob = await assetManager.getAudio(audioId);
    if (!blob) {
      result.valid = false;
      result.missingAssets.audio.push(audioId);
      result.stats.missingAudio++;
    }
  }

  // Check images
  for (const imgId of refs.images) {
    const blob = await assetManager.getImage(imgId);
    if (!blob) {
      result.valid = false;
      result.missingAssets.images.push(imgId);
      result.stats.missingImages++;
    }
  }

  // Generate warnings
  if (result.stats.missingEmbeddings > 0) {
    result.warnings.push(
      `${result.stats.missingEmbeddings} of ${result.stats.totalEmbeddings} embeddings are missing from IndexedDB. ` +
      `These references exist in the narrative but the data cannot be found. ` +
      `Export will succeed but semantic search and plan candidates may not work for affected scenes.`
    );
  }

  if (result.stats.missingAudio > 0) {
    result.warnings.push(
      `${result.stats.missingAudio} of ${result.stats.totalAudio} audio files are missing. ` +
      `Scenes will load but audio playback will fail for: ${result.missingAssets.audio.slice(0, 3).join(', ')}${result.missingAssets.audio.length > 3 ? '...' : ''}`
    );
  }

  if (result.stats.missingImages > 0) {
    result.warnings.push(
      `${result.stats.missingImages} of ${result.stats.totalImages} images are missing. ` +
      `Characters/locations will display without images for: ${result.missingAssets.images.slice(0, 3).join(', ')}${result.missingAssets.images.length > 3 ? '...' : ''}`
    );
  }

  return result;
}

// ── Main Export Function ──────────────────────────────────────────────────────

/**
 * Export narrative as a .inktide package (ZIP archive)
 *
 * Structure:
 * - narrative.json: Core story structure with asset references
 * - manifest.json: Package metadata
 * - embeddings/*.bin: Binary Float32Array files
 * - audio/*.mp3: Audio blobs
 * - images/*.png: Image blobs
 *
 * @param narrative Narrative to export
 * @param options Export options (what to include)
 * @param onProgress Optional progress callback
 * @returns ZIP blob ready for download
 */
export async function exportAsPackage(
  narrative: NarrativeState,
  options: ExportOptions = DEFAULT_EXPORT_OPTIONS,
  onProgress?: (status: string, percent: number) => void,
): Promise<Blob> {
  const zip = new JSZip();

  onProgress?.('Collecting assets...', 0);

  // 1. Collect all asset references from narrative
  const assetRefs = collectAssetReferences(narrative);

  onProgress?.('Writing narrative...', 5);

  // 2. Add narrative.json (core structure with references only)
  const narrativeJson = JSON.stringify(narrative, null, 2);
  zip.file('narrative.json', narrativeJson);

  // 3. Add manifest
  const manifest: PackageManifest = {
    version: 1,
    exported: new Date().toISOString(),
    narrative: {
      id: narrative.id,
      title: narrative.title,
      sceneCount: Object.keys(narrative.scenes).length,
      wordCount: estimateWordCount(narrative),
    },
    assets: {
      embeddings: assetRefs.embeddings.size,
      audio: assetRefs.audio.size,
      images: assetRefs.images.size,
    },
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  // 4. Add embeddings (if enabled)
  if (options.includeEmbeddings && assetRefs.embeddings.size > 0) {
    onProgress?.('Exporting embeddings...', 10);
    const embeddingsFolder = zip.folder('embeddings')!;
    const embIds = Array.from(assetRefs.embeddings);

    for (let i = 0; i < embIds.length; i++) {
      const embId = embIds[i];
      const vector = await assetManager.getEmbedding(embId);

      if (vector) {
        // Store as binary Float32Array
        const float32Array = new Float32Array(vector);
        const buffer = float32Array.buffer;
        embeddingsFolder.file(`${embId}.bin`, buffer);
      }

      if (i % 100 === 0) {
        const percent = 10 + (i / embIds.length) * 60;
        onProgress?.(`Exporting embeddings: ${i}/${embIds.length}`, percent);
      }
    }
  }

  // 5. Add audio (if enabled)
  if (options.includeAudio && assetRefs.audio.size > 0) {
    onProgress?.('Exporting audio...', 70);
    const audioFolder = zip.folder('audio')!;
    const audioIds = Array.from(assetRefs.audio);

    for (let i = 0; i < audioIds.length; i++) {
      const audioId = audioIds[i];
      const blob = await assetManager.getAudio(audioId);

      if (blob) {
        const ext = blob.type.split('/')[1] || 'mp3';
        // Convert to ArrayBuffer for better cross-environment compatibility
        const arrayBuffer = await blob.arrayBuffer();
        audioFolder.file(`${audioId}.${ext}`, arrayBuffer);
      }

      if (i % 10 === 0) {
        const percent = 70 + (i / audioIds.length) * 15;
        onProgress?.(`Exporting audio: ${i}/${audioIds.length}`, percent);
      }
    }
  }

  // 6. Add images (if enabled)
  if (options.includeImages && assetRefs.images.size > 0) {
    onProgress?.('Exporting images...', 85);
    const imagesFolder = zip.folder('images')!;
    const imgIds = Array.from(assetRefs.images);

    for (let i = 0; i < imgIds.length; i++) {
      const imgId = imgIds[i];
      const blob = await assetManager.getImage(imgId);

      if (blob) {
        const ext = blob.type.split('/')[1] || 'png';
        // Convert to ArrayBuffer for better cross-environment compatibility
        const arrayBuffer = await blob.arrayBuffer();
        imagesFolder.file(`${imgId}.${ext}`, arrayBuffer);
      }

      if (i % 10 === 0) {
        const percent = 85 + (i / imgIds.length) * 10;
        onProgress?.(`Exporting images: ${i}/${imgIds.length}`, percent);
      }
    }
  }

  // 7. Generate ZIP
  onProgress?.('Compressing...', 95);

  const compressionOptions = {
    none: { compression: 'STORE' as const },
    medium: { compression: 'DEFLATE' as const, compressionOptions: { level: 6 } },
    max: { compression: 'DEFLATE' as const, compressionOptions: { level: 9 } },
  }[options.compressionLevel];

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    ...compressionOptions,
  });

  onProgress?.('Complete!', 100);

  return zipBlob;
}

/**
 * Get estimated export size (for preview) - uses rough averages for speed
 */
export function estimateExportSize(narrative: NarrativeState, options: ExportOptions): {
  narrative: number;
  embeddings: number;
  audio: number;
  images: number;
  total: number;
} {
  const assetRefs = collectAssetReferences(narrative);

  // Rough estimates
  const narrativeSize = JSON.stringify(narrative).length;
  const embeddingsSize = options.includeEmbeddings ? assetRefs.embeddings.size * 6144 : 0;  // 6KB per embedding
  const audioSize = options.includeAudio ? assetRefs.audio.size * 2.5 * 1024 * 1024 : 0;   // 2.5MB avg per audio
  const imagesSize = options.includeImages ? assetRefs.images.size * 200 * 1024 : 0;        // 200KB avg per image

  const total = narrativeSize + embeddingsSize + audioSize + imagesSize;

  return {
    narrative: narrativeSize,
    embeddings: embeddingsSize,
    audio: audioSize,
    images: imagesSize,
    total,
  };
}

/**
 * Get exact export size by reading actual blob sizes from IndexedDB
 * Slower than estimateExportSize but 100% accurate
 */
export async function calculateExactExportSize(narrative: NarrativeState, options: ExportOptions): Promise<{
  narrative: number;
  embeddings: number;
  audio: number;
  images: number;
  total: number;
}> {
  const assetRefs = collectAssetReferences(narrative);

  // Narrative JSON size (exact)
  const narrativeSize = JSON.stringify(narrative).length;

  let embeddingsSize = 0;
  let audioSize = 0;
  let imagesSize = 0;

  // Calculate exact embedding sizes
  if (options.includeEmbeddings) {
    for (const embId of assetRefs.embeddings) {
      const vector = await assetManager.getEmbedding(embId);
      if (vector) {
        // Float32Array in ZIP: 1536 dimensions * 4 bytes
        embeddingsSize += vector.length * 4;
      }
    }
  }

  // Calculate exact audio sizes
  if (options.includeAudio) {
    for (const audioId of assetRefs.audio) {
      const blob = await assetManager.getAudio(audioId);
      if (blob) {
        audioSize += blob.size;
      }
    }
  }

  // Calculate exact image sizes
  if (options.includeImages) {
    for (const imgId of assetRefs.images) {
      const blob = await assetManager.getImage(imgId);
      if (blob) {
        imagesSize += blob.size;
      }
    }
  }

  const total = narrativeSize + embeddingsSize + audioSize + imagesSize;

  return {
    narrative: narrativeSize,
    embeddings: embeddingsSize,
    audio: audioSize,
    images: imagesSize,
    total,
  };
}
