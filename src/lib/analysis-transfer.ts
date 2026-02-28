/**
 * Transfer large analysis source text between routes via IndexedDB.
 * sessionStorage has a ~5 MB limit; IndexedDB does not.
 * Uses the existing 'meta' store to avoid a DB version bump.
 */

import { idbPut, idbGet, idbDelete, META_STORE } from './image-store';

const KEY = 'transfer:analysis-source';

export function setAnalysisSource(text: string): Promise<void> {
  return idbPut(META_STORE, KEY, text);
}

export function getAnalysisSource(): Promise<string | null> {
  return idbGet<string>(META_STORE, KEY).then((v) => v ?? null);
}

export function removeAnalysisSource(): Promise<void> {
  return idbDelete(META_STORE, KEY);
}
