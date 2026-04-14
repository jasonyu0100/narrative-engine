/**
 * IndexedDB helpers — thin wrappers over the raw API.
 *
 * Used by persistence.ts for all app storage.
 */

import { logError, logWarning } from '@/lib/system-logger';

const DB_NAME = 'inktide-main';
const DB_VERSION = 1;
const NARRATIVES_STORE = 'narratives';
const META_STORE = 'meta';
const API_LOGS_STORE = 'apiLogs';

let dbPromise: Promise<IDBDatabase> | null = null;

// ── Error Types ──────────────────────────────────────────────────────────────

export class IndexedDBUnavailableError extends Error {
  constructor(reason: string) {
    super(`IndexedDB unavailable: ${reason}`);
    this.name = 'IndexedDBUnavailableError';
  }
}

export class IndexedDBQuotaExceededError extends Error {
  constructor(operation: string) {
    super(`Storage quota exceeded during: ${operation}`);
    this.name = 'IndexedDBQuotaExceededError';
  }
}

// ── Availability Check ───────────────────────────────────────────────────────

/**
 * Check if IndexedDB is available and usable
 * Returns object with availability status and reason if unavailable
 */
export function checkIndexedDBAvailability(): { available: boolean; reason?: string } {
  // Server-side
  if (typeof window === 'undefined') {
    return { available: false, reason: 'Running on server (SSR)' };
  }

  // No IndexedDB API
  if (!window.indexedDB) {
    return { available: false, reason: 'Browser does not support IndexedDB' };
  }

  // Check for private/incognito mode (best effort detection)
  // Some browsers block IndexedDB in private mode
  try {
    // Firefox throws in private mode when checking localStorage
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      // Modern browsers - we can proceed, will fail gracefully if blocked
      return { available: true };
    }
  } catch (err) {
    return { available: false, reason: 'Private/incognito mode detected' };
  }

  return { available: true };
}

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB not available on server'));
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(NARRATIVES_STORE)) {
        db.createObjectStore(NARRATIVES_STORE);
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
      if (!db.objectStoreNames.contains(API_LOGS_STORE)) {
        db.createObjectStore(API_LOGS_STORE);
      }
      // Audio storage migrated to inktide-assets database (asset-manager.ts)
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      logError('Failed to open IndexedDB', req.error, {
        source: 'persistence',
        operation: 'open-indexeddb',
        details: { dbName: DB_NAME, dbVersion: DB_VERSION }
      });
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

// ── Generic helpers ──────────────────────────────────────────────────────────

export async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut(storeName: string, key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGetAllKeys(storeName: string): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
}

export async function idbDeleteByPrefix(storeName: string, prefix: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
          cursor.delete();
        }
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Store name constants ─────────────────────────────────────────────────────

export { NARRATIVES_STORE, META_STORE, API_LOGS_STORE };
