import type { NarrativeState, NarrativeViewState, AnalysisJob, ApiLogEntry, SystemLogEntry, SearchQuery } from '@/types/narrative';
import { idbGet, idbPut, idbDelete, idbGetAll, NARRATIVES_STORE, META_STORE, API_LOGS_STORE } from '@/lib/idb';
import { logInfo, logError, logWarning } from '@/lib/system-logger';

const ACTIVE_KEY = 'activeNarrativeId';
const ACTIVE_BRANCH_KEY = 'activeBranchId';
const LS_STORAGE_KEY = 'narrative-engine:narratives';

// ── Schema Migration ────────────────────────────────────────────────────────
// Persisted narratives may use old field names from before the terminology
// refactor. This migration runs once per load and transforms old names to
// current ones so the rest of the codebase can assume the canonical schema.
// If data is already current, the function is a no-op.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateNarrative(raw: any): NarrativeState {
  // ── Entity inner graphs: "continuity" → "world" ──────────────────
  function migrateEntity(e: Record<string, unknown>): void {
    if (e.continuity && !e.world) {
      e.world = e.continuity;
      delete e.continuity;
    }
  }
  for (const c of Object.values(raw.characters ?? {})) migrateEntity(c as Record<string, unknown>);
  for (const l of Object.values(raw.locations ?? {})) migrateEntity(l as Record<string, unknown>);
  for (const a of Object.values(raw.artifacts ?? {})) migrateEntity(a as Record<string, unknown>);

  // ── Scenes: mutation → delta renames ─────────────────────────────
  for (const s of Object.values(raw.scenes ?? {}) as Record<string, unknown>[]) {
    if (s.threadMutations && !s.threadDeltas) { s.threadDeltas = s.threadMutations; delete s.threadMutations; }
    if (s.continuityMutations && !s.worldDeltas) { s.worldDeltas = s.continuityMutations; delete s.continuityMutations; }
    if (s.relationshipMutations && !s.relationshipDeltas) { s.relationshipDeltas = s.relationshipMutations; delete s.relationshipMutations; }
    if (s.worldKnowledgeMutations && !s.systemDeltas) { s.systemDeltas = s.worldKnowledgeMutations; delete s.worldKnowledgeMutations; }
    if (s.ownershipMutations && !s.ownershipDeltas) { s.ownershipDeltas = s.ownershipMutations; delete s.ownershipMutations; }
    if (s.tieMutations && !s.tieDeltas) { s.tieDeltas = s.tieMutations; delete s.tieMutations; }
  }

  // ── WorldBuild expansion manifests: old entity field names ────────
  for (const wb of Object.values(raw.worldBuilds ?? {}) as Record<string, unknown>[]) {
    const em = wb.expansionManifest as Record<string, unknown> | undefined;
    if (!em) continue;
    if (em.characters && !em.newCharacters) { em.newCharacters = em.characters; delete em.characters; }
    if (em.locations && !em.newLocations) { em.newLocations = em.locations; delete em.locations; }
    if (em.threads && !em.newThreads) { em.newThreads = em.threads; delete em.threads; }
    if (em.worldKnowledge && !em.systemDeltas) { em.systemDeltas = em.worldKnowledge; delete em.worldKnowledge; }
    if (em.worldKnowledgeMutations && !em.systemDeltas) { em.systemDeltas = em.worldKnowledgeMutations; delete em.worldKnowledgeMutations; }
    // Migrate entities within the manifest
    for (const c of (em.newCharacters ?? []) as Record<string, unknown>[]) migrateEntity(c);
    for (const l of (em.newLocations ?? []) as Record<string, unknown>[]) migrateEntity(l);
    for (const a of ((em.newArtifacts ?? em.artifacts ?? []) as Record<string, unknown>[])) migrateEntity(a);
    if (em.artifacts && !em.newArtifacts) { em.newArtifacts = em.artifacts; delete em.artifacts; }
    // Relationship field rename
    if (em.relationships && !em.relationshipDeltas) { em.relationshipDeltas = em.relationships; delete em.relationships; }
    if (em.continuityMutations && !em.worldDeltas) { em.worldDeltas = em.continuityMutations; delete em.continuityMutations; }
    if (em.relationshipMutations && !em.relationshipDeltas) { em.relationshipDeltas = em.relationshipMutations; delete em.relationshipMutations; }
    if (em.ownershipMutations && !em.ownershipDeltas) { em.ownershipDeltas = em.ownershipMutations; delete em.ownershipMutations; }
    if (em.tieMutations && !em.tieDeltas) { em.tieDeltas = em.tieMutations; delete em.tieMutations; }
  }

  // ── Top-level system graph: "worldKnowledge" → "systemGraph" ─────
  if (raw.worldKnowledge && !raw.systemGraph) {
    raw.systemGraph = raw.worldKnowledge;
    delete raw.worldKnowledge;
  }

  return raw as NarrativeState;
}

// ── Narratives ───────────────────────────────────────────────────────────────

export async function loadNarratives(): Promise<NarrativeState[]> {
  if (typeof window === 'undefined') return [];
  try {
    const all = await idbGetAll<NarrativeState>(NARRATIVES_STORE);
    return all.map(migrateNarrative);
  } catch (err) {
    logError('Failed to load narratives', err, {
      source: 'persistence',
      operation: 'load-narratives',
    });
    throw new Error(`Failed to load narratives: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function saveNarrative(narrative: NarrativeState): Promise<void> {
  try {
    await idbPut(NARRATIVES_STORE, narrative.id, narrative);
  } catch (err) {
    const isQuota = err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22);
    logError(`Failed to save narrative "${narrative.id}"`, err, {
      source: 'persistence',
      operation: 'save-narrative',
      details: {
        narrativeId: narrative.id,
        sceneCount: Object.keys(narrative.scenes ?? {}).length,
        quotaExceeded: isQuota,
      },
    });
    throw new Error(`Failed to save narrative "${narrative.id}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function deleteNarrative(id: string): Promise<void> {
  try {
    await idbDelete(NARRATIVES_STORE, id);
    logInfo(`Deleted narrative ${id}`, {
      source: 'persistence',
      operation: 'delete-narrative',
      details: { narrativeId: id },
    });
  } catch (err) {
    logError(`Failed to delete narrative ${id}`, err, {
      source: 'persistence',
      operation: 'delete-narrative',
      details: { narrativeId: id },
    });
  }
}

export async function loadNarrative(id: string): Promise<NarrativeState | null> {
  try {
    const n = await idbGet<NarrativeState>(NARRATIVES_STORE, id);
    return n ? migrateNarrative(n) : null;
  } catch (err) {
    logError(`Failed to load narrative ${id}`, err, {
      source: 'persistence',
      operation: 'load-narrative',
      details: { narrativeId: id },
    });
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
    logWarning(`Failed to save API logs for narrative ${narrativeId}`, err, {
      source: 'persistence',
      operation: 'save-api-logs',
      details: { narrativeId, logCount: logs.length },
    });
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

// ── API Logs (per analysis job) ───────────────────────────────────────────────

function analysisLogsKey(analysisId: string): string {
  return `analysis:${analysisId}`;
}

/** Load all API logs for a given analysis job */
export async function loadAnalysisApiLogs(analysisId: string): Promise<ApiLogEntry[]> {
  if (typeof window === 'undefined') return [];
  try {
    const logs = await idbGet<ApiLogEntry[]>(API_LOGS_STORE, analysisLogsKey(analysisId));
    return logs ?? [];
  } catch (err) {
    return [];
  }
}

/** Save all API logs for a given analysis job */
export async function saveAnalysisApiLogs(analysisId: string, logs: ApiLogEntry[]): Promise<void> {
  try {
    await idbPut(API_LOGS_STORE, analysisLogsKey(analysisId), logs);
  } catch (err) {
    // Errors logged at caller level
  }
}

/** Delete API logs for an analysis job (used when deleting an analysis job) */
export async function deleteAnalysisApiLogs(analysisId: string): Promise<void> {
  try {
    await idbDelete(API_LOGS_STORE, analysisLogsKey(analysisId));
  } catch (err) {
    // Errors logged at caller level
  }
}

// ── System Logs (per narrative) ───────────────────────────────────────────────

function systemLogsKey(narrativeId: string): string {
  return `system:${narrativeId}`;
}

/** Load all system logs for a given narrative */
export async function loadSystemLogs(narrativeId: string): Promise<SystemLogEntry[]> {
  if (typeof window === 'undefined') return [];
  try {
    const logs = await idbGet<SystemLogEntry[]>(API_LOGS_STORE, systemLogsKey(narrativeId));
    return logs ?? [];
  } catch (err) {
    return [];
  }
}

/** Save all system logs for a given narrative */
export async function saveSystemLogs(narrativeId: string, logs: SystemLogEntry[]): Promise<void> {
  try {
    await idbPut(API_LOGS_STORE, systemLogsKey(narrativeId), logs);
  } catch (err) {
    logWarning(`Failed to save system logs for narrative ${narrativeId}`, err, {
      source: 'persistence',
      operation: 'save-system-logs',
      details: { narrativeId, logCount: logs.length },
    });
  }
}

/** Delete system logs for a narrative (used when deleting a narrative) */
export async function deleteSystemLogs(narrativeId: string): Promise<void> {
  try {
    await idbDelete(API_LOGS_STORE, systemLogsKey(narrativeId));
  } catch (err) {
    // Errors logged at caller level
  }
}

// ── System Logs (per analysis job) ────────────────────────────────────────────

function analysisSystemLogsKey(analysisId: string): string {
  return `system-analysis:${analysisId}`;
}

/** Load all system logs for a given analysis job */
export async function loadAnalysisSystemLogs(analysisId: string): Promise<SystemLogEntry[]> {
  if (typeof window === 'undefined') return [];
  try {
    const logs = await idbGet<SystemLogEntry[]>(API_LOGS_STORE, analysisSystemLogsKey(analysisId));
    return logs ?? [];
  } catch (err) {
    return [];
  }
}

/** Save all system logs for a given analysis job */
export async function saveAnalysisSystemLogs(analysisId: string, logs: SystemLogEntry[]): Promise<void> {
  try {
    await idbPut(API_LOGS_STORE, analysisSystemLogsKey(analysisId), logs);
  } catch (err) {
    // Errors logged at caller level
  }
}

/** Delete system logs for an analysis job */
export async function deleteAnalysisSystemLogs(analysisId: string): Promise<void> {
  try {
    await idbDelete(API_LOGS_STORE, analysisSystemLogsKey(analysisId));
  } catch (err) {
    // Errors logged at caller level
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
      source: 'persistence',
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
      source: 'persistence',
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

// ── Search State ─────────────────────────────────────────────────────────────

function getSearchStateKey(narrativeId: string): string {
  return `search:${narrativeId}`;
}

export async function saveSearchState(narrativeId: string, query: SearchQuery | null): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await idbPut(META_STORE, getSearchStateKey(narrativeId), query);
  } catch (err) {
    // Silently fail for search state persistence
  }
}

export async function loadSearchState(narrativeId: string): Promise<SearchQuery | null> {
  if (typeof window === 'undefined') return null;
  try {
    return (await idbGet<SearchQuery | null>(META_STORE, getSearchStateKey(narrativeId))) ?? null;
  } catch (err) {
    return null;
  }
}

// ── View State (per narrative) ───────────────────────────────────────────────

function getViewStateKey(narrativeId: string): string {
  return `viewState:${narrativeId}`;
}

export async function saveViewState(narrativeId: string, viewState: NarrativeViewState): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await idbPut(META_STORE, getViewStateKey(narrativeId), viewState);
  } catch (err) {
    // Silently fail for view state persistence
  }
}

export async function loadViewState(narrativeId: string): Promise<NarrativeViewState | null> {
  if (typeof window === 'undefined') return null;
  try {
    return (await idbGet<NarrativeViewState | null>(META_STORE, getViewStateKey(narrativeId))) ?? null;
  } catch (err) {
    return null;
  }
}

export async function deleteViewState(narrativeId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await idbDelete(META_STORE, getViewStateKey(narrativeId));
  } catch (err) {
    // Silently fail
  }
}
