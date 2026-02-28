import type { NarrativeState, AnalysisJob } from '@/types/narrative';
import { idbGet, idbPut, idbDelete, idbGetAll, idbDeleteByPrefix, IMAGES_STORE, NARRATIVES_STORE, META_STORE } from '@/lib/image-store';

const ACTIVE_KEY = 'activeNarrativeId';
const ACTIVE_BRANCH_KEY = 'activeBranchId';
const LS_STORAGE_KEY = 'narrative-engine:narratives';

// ── Narratives ───────────────────────────────────────────────────────────────

export async function loadNarratives(): Promise<NarrativeState[]> {
  if (typeof window === 'undefined') return [];
  try {
    return await idbGetAll<NarrativeState>(NARRATIVES_STORE);
  } catch (err) {
    console.error('[persistence] Failed to load narratives from IndexedDB:', err);
    throw new Error(`Failed to load narratives: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function saveNarrative(narrative: NarrativeState): Promise<void> {
  try {
    await idbPut(NARRATIVES_STORE, narrative.id, narrative);
  } catch (err) {
    console.error('[persistence] Failed to save narrative:', narrative.id, err);
    throw new Error(`Failed to save narrative "${narrative.id}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function deleteNarrative(id: string): Promise<void> {
  try {
    await Promise.all([
      idbDelete(NARRATIVES_STORE, id),
      idbDeleteByPrefix(IMAGES_STORE, id),
    ]);
  } catch (err) {
    console.error('[persistence] Failed to delete narrative:', id, err);
  }
}

export async function loadNarrative(id: string): Promise<NarrativeState | null> {
  try {
    const n = await idbGet<NarrativeState>(NARRATIVES_STORE, id);
    return n ?? null;
  } catch (err) {
    console.error('[persistence] Failed to load narrative:', id, err);
    return null;
  }
}

// ── Active narrative ID ──────────────────────────────────────────────────────

export async function saveActiveNarrativeId(id: string | null): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if (id) {
      await idbPut(META_STORE, ACTIVE_KEY, id);
    } else {
      await idbDelete(META_STORE, ACTIVE_KEY);
    }
  } catch (err) {
    console.error('[persistence] Failed to save active narrative ID:', err);
  }
}

export async function loadActiveNarrativeId(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const id = await idbGet<string>(META_STORE, ACTIVE_KEY);
    return id ?? null;
  } catch (err) {
    console.error('[persistence] Failed to load active narrative ID:', err);
    return null;
  }
}

// ── Active branch ID ─────────────────────────────────────────────────────────

export async function saveActiveBranchId(id: string | null): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if (id) {
      await idbPut(META_STORE, ACTIVE_BRANCH_KEY, id);
    } else {
      await idbDelete(META_STORE, ACTIVE_BRANCH_KEY);
    }
  } catch (err) {
    console.error('[persistence] Failed to save active branch ID:', err);
  }
}

export async function loadActiveBranchId(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const id = await idbGet<string>(META_STORE, ACTIVE_BRANCH_KEY);
    return id ?? null;
  } catch (err) {
    console.error('[persistence] Failed to load active branch ID:', err);
    return null;
  }
}

// ── Analysis Jobs ────────────────────────────────────────────────────────────

const ANALYSIS_JOBS_KEY = 'analysisJobs';

export async function loadAnalysisJobs(): Promise<AnalysisJob[]> {
  if (typeof window === 'undefined') return [];
  try {
    const jobs = await idbGet<AnalysisJob[]>(META_STORE, ANALYSIS_JOBS_KEY);
    return jobs ?? [];
  } catch (err) {
    console.error('[persistence] Failed to load analysis jobs:', err);
    return [];
  }
}

export async function saveAnalysisJobs(jobs: AnalysisJob[]): Promise<void> {
  try {
    await idbPut(META_STORE, ANALYSIS_JOBS_KEY, jobs);
  } catch (err) {
    console.error('[persistence] Failed to save analysis jobs:', err);
  }
}

// ── Migration: localStorage → IndexedDB ──────────────────────────────────────

/**
 * One-time migration: move narratives from localStorage to IndexedDB.
 * After migration, clears the old localStorage key.
 */
export async function migrateFromLocalStorage(): Promise<void> {
  if (typeof window === 'undefined') return;

  const raw = localStorage.getItem(LS_STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.removeItem(LS_STORAGE_KEY);
      return;
    }

    console.log(`[persistence] Migrating ${parsed.length} narrative(s) from localStorage to IndexedDB...`);

    for (const narrative of parsed as NarrativeState[]) {
      await idbPut(NARRATIVES_STORE, narrative.id, narrative);
    }

    // Migrate active narrative ID
    const activeId = localStorage.getItem('narrative-engine:activeNarrativeId');
    if (activeId) {
      await idbPut(META_STORE, ACTIVE_KEY, activeId);
      localStorage.removeItem('narrative-engine:activeNarrativeId');
    }

    localStorage.removeItem(LS_STORAGE_KEY);
    console.log('[persistence] Migration complete — localStorage cleared');
  } catch (err) {
    console.error('[persistence] Migration failed — localStorage data preserved:', err);
  }
}
