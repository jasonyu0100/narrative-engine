/**
 * Package Import - Import .inktide packages
 *
 * Supports two formats:
 * 1. ZIP packages - exported via ExportPackageModal (includes assets)
 * 2. Plain JSON - bundled works format (NarrativeState only)
 */

import JSZip from 'jszip';
import { assetManager } from './asset-manager';
import type { NarrativeState } from '@/types/narrative';
import type { PackageManifest } from './package-export';

// ── Import Options ────────────────────────────────────────────────────────────

export type ImportOptions = {
  importEmbeddings: boolean;
  importAudio: boolean;
  importImages: boolean;
};

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  importEmbeddings: true,
  importAudio: true,
  importImages: true,
};

// ── Format Detection ──────────────────────────────────────────────────────────

/**
 * Detect if file is ZIP or plain JSON
 */
async function detectFormat(file: File): Promise<'zip' | 'json'> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // ZIP files start with PK (0x504B)
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B) {
    return 'zip';
  }

  // Try to parse as JSON
  try {
    const text = new TextDecoder().decode(arrayBuffer);
    JSON.parse(text);
    return 'json';
  } catch {
    throw new Error('File is neither a valid ZIP nor JSON format');
  }
}

// ── Helper Functions ──────────────────────────────────────────────────────────

/**
 * Read and parse the package manifest (ZIP format only)
 */
export async function readPackageManifest(file: File): Promise<PackageManifest> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new Error('Invalid .inktide ZIP: missing manifest.json');
  }

  const manifestText = await manifestFile.async('text');
  return JSON.parse(manifestText) as PackageManifest;
}

/**
 * Check if a file is a valid .inktide package (supports both formats)
 */
export async function validatePackage(file: File): Promise<{ valid: boolean; error?: string; format?: 'zip' | 'json' }> {
  try {
    const format = await detectFormat(file);

    if (format === 'json') {
      // Plain JSON format - validate NarrativeState structure
      const text = await file.text();
      const narrative = JSON.parse(text) as NarrativeState;

      if (!narrative.id || !narrative.title || !narrative.scenes) {
        return { valid: false, error: 'Invalid NarrativeState structure' };
      }

      return { valid: true, format: 'json' };
    } else {
      // ZIP format - validate package structure
      const arrayBuffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);

      if (!zip.file('manifest.json')) {
        return { valid: false, error: 'Missing manifest.json' };
      }

      if (!zip.file('narrative.json')) {
        return { valid: false, error: 'Missing narrative.json' };
      }

      // Try to parse manifest
      const manifestFile = zip.file('manifest.json');
      if (manifestFile) {
        const manifestText = await manifestFile.async('text');
        const manifest = JSON.parse(manifestText);

        if (!manifest.version || !manifest.narrative) {
          return { valid: false, error: 'Invalid manifest structure' };
        }
      }

      return { valid: true, format: 'zip' };
    }
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ── Main Import Function ──────────────────────────────────────────────────────

/**
 * Import narrative from .inktide package
 *
 * Supports two formats:
 * - ZIP: Full package with embeddings, audio, images
 * - JSON: Plain NarrativeState (bundled works format)
 *
 * @param file .inktide file (ZIP or JSON)
 * @param options Import options (only applies to ZIP format)
 * @param onProgress Optional progress callback
 * @returns Restored narrative state
 */
export async function importFromPackage(
  file: File,
  options: ImportOptions = DEFAULT_IMPORT_OPTIONS,
  onProgress?: (status: string, percent: number) => void,
): Promise<NarrativeState> {
  onProgress?.('Loading package...', 0);

  // Detect format
  const format = await detectFormat(file);

  if (format === 'json') {
    // Plain JSON format - just parse and return
    onProgress?.('Reading narrative...', 50);
    const text = await file.text();
    const narrative = JSON.parse(text) as NarrativeState;
    onProgress?.('Complete!', 100);
    return narrative;
  }

  // ZIP format - full import with assets
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  onProgress?.('Reading narrative...', 5);

  // Read narrative.json
  const narrativeFile = zip.file('narrative.json');
  if (!narrativeFile) {
    throw new Error('Invalid .inktide ZIP: missing narrative.json');
  }

  const narrativeText = await narrativeFile.async('text');
  const narrative = JSON.parse(narrativeText) as NarrativeState;

  // 3. Import embeddings
  if (options.importEmbeddings) {
    const embeddingsFolder = zip.folder('embeddings');

    if (embeddingsFolder) {
      const files = Object.values(embeddingsFolder.files).filter(f => !f.dir && f.name.endsWith('.bin'));

      onProgress?.('Importing embeddings...', 10);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = file.name.split('/').pop()!;
        const embId = fileName.replace('.bin', '');

        try {
          // Read binary Float32Array
          const buffer = await file.async('arraybuffer');
          const float32Array = new Float32Array(buffer);
          const vector = Array.from(float32Array);

          // Store in IndexedDB with original ID (preserves references in narrative)
          await assetManager.storeEmbedding(vector, 'text-embedding-3-small', embId);

          if (i % 100 === 0) {
            const percent = 10 + (i / files.length) * 60;
            onProgress?.(`Importing embeddings: ${i}/${files.length}`, percent);
          }
        } catch (error) {
          console.warn(`Failed to import embedding ${embId}:`, error);
        }
      }

      onProgress?.(`Imported ${files.length} embeddings`, 70);
    }
  }

  // 4. Import audio
  if (options.importAudio) {
    const audioFolder = zip.folder('audio');

    if (audioFolder) {
      const files = Object.values(audioFolder.files).filter(f => !f.dir);

      onProgress?.('Importing audio...', 70);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = file.name.split('/').pop()!;
        const [audioId] = fileName.split('.');

        try {
          const blob = await file.async('blob');

          // Store in IndexedDB with original ID
          await assetManager.storeAudio(blob, blob.type, audioId);

          if (i % 10 === 0) {
            const percent = 70 + (i / files.length) * 15;
            onProgress?.(`Importing audio: ${i}/${files.length}`, percent);
          }
        } catch (error) {
          console.warn(`Failed to import audio ${audioId}:`, error);
        }
      }

      onProgress?.(`Imported ${files.length} audio clips`, 85);
    }
  }

  // 5. Import images
  if (options.importImages) {
    const imagesFolder = zip.folder('images');

    if (imagesFolder) {
      const files = Object.values(imagesFolder.files).filter(f => !f.dir);

      onProgress?.('Importing images...', 85);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = file.name.split('/').pop()!;
        const [imgId] = fileName.split('.');

        try {
          const blob = await file.async('blob');

          // Store in IndexedDB with original ID
          await assetManager.storeImage(blob, blob.type, imgId);

          if (i % 10 === 0) {
            const percent = 85 + (i / files.length) * 15;
            onProgress?.(`Importing images: ${i}/${files.length}`, percent);
          }
        } catch (error) {
          console.warn(`Failed to import image ${imgId}:`, error);
        }
      }

      onProgress?.(`Imported ${files.length} images`, 100);
    }
  }

  onProgress?.('Complete!', 100);

  return narrative;
}

/**
 * Get package info without importing
 * Useful for showing preview/confirmation dialog
 * Supports both ZIP and JSON formats
 */
export async function getPackageInfo(file: File): Promise<{
  manifest: PackageManifest;
  sizes: {
    narrative: number;
    embeddings: number;
    audio: number;
    images: number;
    total: number;
  };
  format: 'zip' | 'json';
}> {
  const format = await detectFormat(file);

  if (format === 'json') {
    // Plain JSON format - build manifest from narrative
    const text = await file.text();
    const narrative = JSON.parse(text) as NarrativeState;

    const sceneCount = Object.keys(narrative.scenes).length;

    // Calculate word count from prose versions
    let wordCount = 0;
    for (const scene of Object.values(narrative.scenes)) {
      const latestProse = scene.proseVersions?.[scene.proseVersions.length - 1]?.prose;
      if (latestProse) {
        wordCount += latestProse.split(/\s+/).length;
      }
    }

    const manifest: PackageManifest = {
      version: 1,
      exported: new Date().toISOString(),
      narrative: {
        id: narrative.id,
        title: narrative.title,
        sceneCount,
        wordCount,
      },
      assets: {
        embeddings: 0,
        audio: 0,
        images: 0,
      },
    };

    return {
      manifest,
      sizes: {
        narrative: file.size,
        embeddings: 0,
        audio: 0,
        images: 0,
        total: file.size,
      },
      format: 'json',
    };
  }

  // ZIP format - full analysis
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const manifest = await readPackageManifest(file);

  let narrativeSize = 0;
  let embeddingsSize = 0;
  let audioSize = 0;
  let imagesSize = 0;

  // Calculate sizes
  const narrativeFile = zip.file('narrative.json');
  if (narrativeFile) {
    const content = await narrativeFile.async('arraybuffer');
    narrativeSize = content.byteLength;
  }

  const embeddingsFolder = zip.folder('embeddings');
  if (embeddingsFolder) {
    for (const file of Object.values(embeddingsFolder.files)) {
      if (!file.dir) {
        const content = await file.async('arraybuffer');
        embeddingsSize += content.byteLength;
      }
    }
  }

  const audioFolder = zip.folder('audio');
  if (audioFolder) {
    for (const file of Object.values(audioFolder.files)) {
      if (!file.dir) {
        const content = await file.async('arraybuffer');
        audioSize += content.byteLength;
      }
    }
  }

  const imagesFolder = zip.folder('images');
  if (imagesFolder) {
    for (const file of Object.values(imagesFolder.files)) {
      if (!file.dir) {
        const content = await file.async('arraybuffer');
        imagesSize += content.byteLength;
      }
    }
  }

  return {
    manifest,
    sizes: {
      narrative: narrativeSize,
      embeddings: embeddingsSize,
      audio: audioSize,
      images: imagesSize,
      total: narrativeSize + embeddingsSize + audioSize + imagesSize,
    },
    format: 'zip',
  };
}

// ── Directory Import ─────────────────────────────────────────────────────────

/**
 * Validate a directory FileList as an InkTide package
 * Expects narrative.json at minimum, optionally manifest.json and embeddings/*.bin
 */
export async function validateDirectory(files: FileList): Promise<{ valid: boolean; error?: string }> {
  const fileMap = new Map<string, File>();
  for (const file of Array.from(files)) {
    // webkitRelativePath is "dirName/narrative.json" — strip the leading directory
    const relPath = file.webkitRelativePath.split('/').slice(1).join('/');
    fileMap.set(relPath, file);
  }

  const narrativeFile = fileMap.get('narrative.json');
  if (!narrativeFile) {
    return { valid: false, error: 'Missing narrative.json in directory' };
  }

  try {
    const text = await narrativeFile.text();
    const narrative = JSON.parse(text) as NarrativeState;
    if (!narrative.id || !narrative.title || !narrative.scenes) {
      return { valid: false, error: 'Invalid NarrativeState structure in narrative.json' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Failed to parse narrative.json' };
  }
}

/**
 * Get package info from a directory FileList
 */
export async function getDirectoryInfo(files: FileList): Promise<{
  manifest: PackageManifest;
  sizes: {
    narrative: number;
    embeddings: number;
    audio: number;
    images: number;
    total: number;
  };
  format: 'directory';
}> {
  const fileMap = new Map<string, File>();
  for (const file of Array.from(files)) {
    const relPath = file.webkitRelativePath.split('/').slice(1).join('/');
    fileMap.set(relPath, file);
  }

  const narrativeFile = fileMap.get('narrative.json')!;
  const text = await narrativeFile.text();
  const narrative = JSON.parse(text) as NarrativeState;

  // Check for package manifest
  const manifestFile = fileMap.get('manifest.json');
  let embeddingCount = 0;
  let audioCount = 0;
  let imageCount = 0;

  // Count assets by prefix
  let embeddingsSize = 0;
  let audioSize = 0;
  let imagesSize = 0;

  for (const [relPath, file] of fileMap) {
    if (relPath.startsWith('embeddings/') && relPath.endsWith('.bin')) {
      embeddingCount++;
      embeddingsSize += file.size;
    } else if (relPath.startsWith('audio/')) {
      audioCount++;
      audioSize += file.size;
    } else if (relPath.startsWith('images/')) {
      imageCount++;
      imagesSize += file.size;
    }
  }

  const sceneCount = Object.keys(narrative.scenes).length;
  let wordCount = 0;
  for (const scene of Object.values(narrative.scenes)) {
    const latestProse = scene.proseVersions?.[scene.proseVersions.length - 1]?.prose;
    if (latestProse) {
      wordCount += latestProse.split(/\s+/).length;
    }
  }

  // Use package manifest if present, otherwise build from narrative
  let exported = new Date().toISOString();
  if (manifestFile) {
    try {
      const mText = await manifestFile.text();
      const m = JSON.parse(mText);
      if (m.exported) exported = m.exported;
    } catch { /* ignore */ }
  }

  const manifest: PackageManifest = {
    version: 1,
    exported,
    narrative: {
      id: narrative.id,
      title: narrative.title,
      sceneCount,
      wordCount,
    },
    assets: {
      embeddings: embeddingCount,
      audio: audioCount,
      images: imageCount,
    },
  };

  return {
    manifest,
    sizes: {
      narrative: narrativeFile.size,
      embeddings: embeddingsSize,
      audio: audioSize,
      images: imagesSize,
      total: narrativeFile.size + embeddingsSize + audioSize + imagesSize,
    },
    format: 'directory',
  };
}

/**
 * Import narrative from a directory FileList
 *
 * @param files FileList from a directory input (webkitdirectory)
 * @param options Import options
 * @param onProgress Optional progress callback
 * @returns Restored narrative state
 */
export async function importFromDirectory(
  files: FileList,
  options: ImportOptions = DEFAULT_IMPORT_OPTIONS,
  onProgress?: (status: string, percent: number) => void,
): Promise<NarrativeState> {
  onProgress?.('Loading directory...', 0);

  const fileMap = new Map<string, File>();
  for (const file of Array.from(files)) {
    const relPath = file.webkitRelativePath.split('/').slice(1).join('/');
    fileMap.set(relPath, file);
  }

  // Read narrative
  const narrativeFile = fileMap.get('narrative.json');
  if (!narrativeFile) {
    throw new Error('Missing narrative.json in directory');
  }

  onProgress?.('Reading narrative...', 5);
  const text = await narrativeFile.text();
  const narrative = JSON.parse(text) as NarrativeState;

  // Import embeddings
  if (options.importEmbeddings) {
    const embFiles = Array.from(fileMap.entries()).filter(
      ([relPath]) => relPath.startsWith('embeddings/') && relPath.endsWith('.bin')
    );

    if (embFiles.length > 0) {
      onProgress?.('Importing embeddings...', 10);

      for (let i = 0; i < embFiles.length; i++) {
        const [relPath, file] = embFiles[i];
        const fileName = relPath.split('/').pop()!;
        const embId = fileName.replace('.bin', '');

        try {
          const buffer = await file.arrayBuffer();
          const float32Array = new Float32Array(buffer);
          const vector = Array.from(float32Array);
          await assetManager.storeEmbedding(vector, 'text-embedding-3-small', embId);
        } catch (error) {
          console.warn(`Failed to import embedding ${embId}:`, error);
        }

        if (i % 100 === 0) {
          const percent = 10 + (i / embFiles.length) * 60;
          onProgress?.(`Importing embeddings: ${i}/${embFiles.length}`, percent);
        }
      }

      onProgress?.(`Imported ${embFiles.length} embeddings`, 70);
    }
  }

  // Import audio
  if (options.importAudio) {
    const audioFiles = Array.from(fileMap.entries()).filter(
      ([relPath]) => relPath.startsWith('audio/')
    );

    if (audioFiles.length > 0) {
      onProgress?.('Importing audio...', 70);

      for (let i = 0; i < audioFiles.length; i++) {
        const [, file] = audioFiles[i];
        const fileName = file.name;
        const [audioId] = fileName.split('.');

        try {
          const blob = new Blob([await file.arrayBuffer()], { type: file.type });
          await assetManager.storeAudio(blob, blob.type, audioId);
        } catch (error) {
          console.warn(`Failed to import audio ${audioId}:`, error);
        }

        if (i % 10 === 0) {
          const percent = 70 + (i / audioFiles.length) * 15;
          onProgress?.(`Importing audio: ${i}/${audioFiles.length}`, percent);
        }
      }

      onProgress?.(`Imported ${audioFiles.length} audio clips`, 85);
    }
  }

  // Import images
  if (options.importImages) {
    const imageFiles = Array.from(fileMap.entries()).filter(
      ([relPath]) => relPath.startsWith('images/')
    );

    if (imageFiles.length > 0) {
      onProgress?.('Importing images...', 85);

      for (let i = 0; i < imageFiles.length; i++) {
        const [, file] = imageFiles[i];
        const fileName = file.name;
        const [imgId] = fileName.split('.');

        try {
          const blob = new Blob([await file.arrayBuffer()], { type: file.type });
          await assetManager.storeImage(blob, blob.type, imgId);
        } catch (error) {
          console.warn(`Failed to import image ${imgId}:`, error);
        }

        if (i % 10 === 0) {
          const percent = 85 + (i / imageFiles.length) * 15;
          onProgress?.(`Importing images: ${i}/${imageFiles.length}`, percent);
        }
      }

      onProgress?.(`Imported ${imageFiles.length} images`, 100);
    }
  }

  onProgress?.('Complete!', 100);
  return narrative;
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
