/**
 * Audio blob storage — stores audio as binary blobs in IndexedDB
 * for instant playback via URL.createObjectURL().
 *
 * Scene.audioUrl stores a key like "idb:sceneId" to reference the blob.
 */

import { idbGet, idbPut, idbDelete, AUDIO_STORE } from './idb';

const IDB_PREFIX = 'idb:';

/** Get the marker stored on Scene.audioUrl */
export function audioMarker(sceneId: string): string {
  return `${IDB_PREFIX}${sceneId}`;
}

/** Save audio blob to IndexedDB. Returns the marker to store on the scene. */
export async function saveAudioBlob(sceneId: string, blob: Blob): Promise<string> {
  await idbPut(AUDIO_STORE, sceneId, blob);
  return audioMarker(sceneId);
}

/** Load audio blob and return an object URL for instant playback. Returns null if not found. */
export async function resolveAudioUrl(audioUrl: string, sceneId: string): Promise<string | null> {
  if (!audioUrl || !audioUrl.startsWith(IDB_PREFIX)) return null;
  try {
    const blob = await idbGet<Blob>(AUDIO_STORE, sceneId);
    if (!blob) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/** Delete audio blob from IndexedDB */
export async function deleteAudioBlob(sceneId: string): Promise<void> {
  try {
    await idbDelete(AUDIO_STORE, sceneId);
  } catch {
    // ignore
  }
}
