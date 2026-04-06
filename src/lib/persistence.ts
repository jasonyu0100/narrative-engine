import type { NarrativeState, AnalysisJob, ApiLogEntry, DiscoveryInquiry } from '@/types/narrative';
import { idbGet, idbPut, idbDelete, idbGetAll, NARRATIVES_STORE, META_STORE, API_LOGS_STORE } from '@/lib/idb';
import { logInfo, logError } from '@/lib/system-logger';

const ACTIVE_KEY = 'activeNarrativeId';
const ACTIVE_BRANCH_KEY = 'activeBranchId';
const LS_STORAGE_KEY = 'narrative-engine:narratives';

// ── Narratives ───────────────────────────────────────────────────────────────

export async function loadNarratives(): Promise<NarrativeState[]> {
  if (typeof window === 'undefined') return [];
  try {
    return await idbGetAll<NarrativeState>(NARRATIVES_STORE);
  } catch (err) {
    throw new Error(`Failed to load narratives: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function saveNarrative(narrative: NarrativeState): Promise<void> {
  try {
    await idbPut(NARRATIVES_STORE, narrative.id, narrative);
  } catch (err) {
    throw new Error(`Failed to save narrative "${narrative.id}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function deleteNarrative(id: string): Promise<void> {
  try {
    await idbDelete(NARRATIVES_STORE, id);
  } catch (err) {
    // Errors logged at caller level
  }
}

export async function loadNarrative(id: string): Promise<NarrativeState | null> {
  try {
    const n = await idbGet<NarrativeState>(NARRATIVES_STORE, id);
    return n ?? null;
  } catch (err) {
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
    // Errors logged at caller level
  }
}

export async function loadActiveNarrativeId(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const id = await idbGet<string>(META_STORE, ACTIVE_KEY);
    return id ?? null;
  } catch (err) {
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
    // Errors logged at caller level
  }
}

export async function loadActiveBranchId(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const id = await idbGet<string>(META_STORE, ACTIVE_BRANCH_KEY);
    return id ?? null;
  } catch (err) {
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
    return [];
  }
}

export async function saveAnalysisJobs(jobs: AnalysisJob[]): Promise<void> {
  try {
    await idbPut(META_STORE, ANALYSIS_JOBS_KEY, jobs);
  } catch (err) {
    // Errors logged at caller level
  }
}

// ── API Logs (per narrative) ─────────────────────────────────────────────────

/** Load all API logs for a given narrative */
export async function loadApiLogs(narrativeId: string): Promise<ApiLogEntry[]> {
  if (typeof window === 'undefined') return [];
  try {
    const logs = await idbGet<ApiLogEntry[]>(API_LOGS_STORE, narrativeId);
    return logs ?? [];
  } catch (err) {
    return [];
  }
}

/** Save all API logs for a given narrative */
export async function saveApiLogs(narrativeId: string, logs: ApiLogEntry[]): Promise<void> {
  try {
    await idbPut(API_LOGS_STORE, narrativeId, logs);
  } catch (err) {
    // Errors logged at caller level
  }
}

/** Delete API logs for a narrative (used when deleting a narrative) */
export async function deleteApiLogs(narrativeId: string): Promise<void> {
  try {
    await idbDelete(API_LOGS_STORE, narrativeId);
  } catch (err) {
    // Errors logged at caller level
  }
}

// ── Discovery Inquiries ──────────────────────────────────────────────────────

const DISCOVERY_KEY = 'discoveryInquiries';

export async function loadDiscoveryInquiries(): Promise<DiscoveryInquiry[]> {
  if (typeof window === 'undefined') return [];
  try {
    const inquiries = await idbGet<DiscoveryInquiry[]>(META_STORE, DISCOVERY_KEY);
    return inquiries ?? [];
  } catch (err) {
    return [];
  }
}

export async function saveDiscoveryInquiry(inquiry: DiscoveryInquiry): Promise<void> {
  try {
    const all = await loadDiscoveryInquiries();
    const idx = all.findIndex((i) => i.id === inquiry.id);
    if (idx >= 0) all[idx] = inquiry;
    else all.unshift(inquiry);
    await idbPut(META_STORE, DISCOVERY_KEY, all);
  } catch (err) {
    // Errors logged at caller level if needed
  }
}

export async function deleteDiscoveryInquiry(id: string): Promise<void> {
  try {
    const all = await loadDiscoveryInquiries();
    await idbPut(META_STORE, DISCOVERY_KEY, all.filter((i) => i.id !== id));
  } catch (err) {
    // Errors logged at caller level if needed
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

    logInfo(`Migrating ${parsed.length} narrative(s) from localStorage to IndexedDB`, {
      source: 'other',
      operation: 'migrate-storage',
      details: { narrativeCount: parsed.length }
    });

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
    logInfo('Migration complete — localStorage cleared', {
      source: 'other',
      operation: 'migrate-storage',
      details: { narrativeCount: parsed.length }
    });
  } catch (err) {
    logError('Migration failed — localStorage data preserved', err, {
      source: 'other',
      operation: 'migrate-storage'
    });
  }
}
