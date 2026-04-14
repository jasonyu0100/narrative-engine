import type { Branch, NarrativeState, Scene, Thread, ThreadStatus, ForceSnapshot, CubeCornerKey, CubeCorner, SystemGraph, SystemNode, SystemEdge, SystemDelta, WorldBuild, Character, Location, Artifact } from '@/types/narrative';
import { NARRATIVE_CUBE } from '@/types/narrative';
import { FORCE_WINDOW_SIZE, PEAK_WINDOW_SCENES_DIVISOR, SHAPE_TROUGH_BAND_LO, SHAPE_TROUGH_BAND_HI, BEAT_DENSITY_MIN, BEAT_DENSITY_MAX } from '@/lib/constants';

// ── Scene & entity helpers ──────────────────────────────────────────────────

/** The POV character a scene effectively renders through — the declared povId
 *  if valid, otherwise the first participant. Returns undefined only if the
 *  scene has no participants either. */
export function getEffectivePovId(scene: Scene): string | undefined {
  return scene.povId || scene.participantIds[0];
}

/** Resolve a character/location/artifact id to its display name. Returns the
 *  id itself only as a last-resort fallback — callers should treat that as a
 *  data-integrity signal rather than expected behaviour. Null/undefined ids
 *  resolve to "nowhere" (used by ownership deltas with no prior/next owner). */
export function resolveEntityName(narrative: NarrativeState, id: string | null | undefined): string {
  if (!id) return 'nowhere';
  return (
    narrative.characters[id]?.name ??
    narrative.locations[id]?.name ??
    narrative.artifacts[id]?.name ??
    id
  );
}

// ── Sequential ID generation ─────────────────────────────────────────────────

/**
 * Extract the numeric suffix from an entity ID (e.g., "C-01" → 1, "L-12" → 12, "S-003" → 3).
 * Handles various formats: "C-01", "C-1742000000-3", "S-GEN-1742000000-5", etc.
 * Returns the highest trailing number found, or 0 if none.
 */
function extractIdNumber(id: string): number {
  const match = id.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Compute the next sequential ID for a given prefix by scanning existing IDs in the narrative.
 * Returns zero-padded IDs like "C-09", "L-12", "T-08", "S-016", "ARC-04".
 *
 * @param prefix - Entity prefix (e.g., "C", "L", "T", "S", "ARC", "WX", "K")
 * @param existingIds - Array of existing IDs to scan for the highest number
 * @param padWidth - Zero-padding width (default: 2 for most, 3 for scenes)
 */
export function nextId(prefix: string, existingIds: string[], padWidth = 2): string {
  let max = 0;
  for (const id of existingIds) {
    const n = extractIdNumber(id);
    if (n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(padWidth, '0')}`;
}

/**
 * Generate a batch of sequential IDs starting from the next available number.
 */
export function nextIds(prefix: string, existingIds: string[], count: number, padWidth = 2): string[] {
  let max = 0;
  for (const id of existingIds) {
    const n = extractIdNumber(id);
    if (n > max) max = n;
  }
  return Array.from({ length: count }, (_, i) => `${prefix}-${String(max + 1 + i).padStart(padWidth, '0')}`);
}

/**
 * Resolve the full entry sequence for a branch by walking up to root.
 * Root branch returns its own entryIds.
 * Child branch returns parent's resolved sequence up to forkEntryId (inclusive) + own entryIds.
 */
export function resolveEntrySequence(
  branches: Record<string, Branch>,
  branchId: string,
): string[] {
  const branch = branches[branchId];
  if (!branch) return [];

  // Root branch — just its own entries
  if (!branch.parentBranchId) return branch.entryIds;

  // Recursively resolve parent
  const parentSequence = resolveEntrySequence(branches, branch.parentBranchId);

  // Find the fork point in the parent sequence
  if (branch.forkEntryId) {
    const forkIdx = parentSequence.indexOf(branch.forkEntryId);
    if (forkIdx >= 0) {
      return [...parentSequence.slice(0, forkIdx + 1), ...branch.entryIds];
    }
  }

  // Fallback: append after full parent sequence
  return [...parentSequence, ...branch.entryIds];
}

// ── Prose/Plan Version Resolution ────────────────────────────────────────────
// These functions resolve which prose/plan version a branch should see,
// based on branch lineage and fork timestamps.

import type { BeatPlan, BeatProseMap, ProseScore } from '@/types/narrative';

export type ResolvedProse = {
  prose?: string;
  beatProseMap?: BeatProseMap;
  proseScore?: ProseScore;
};

/**
 * Resolve prose for a scene as viewed by a specific branch.
 * Uses branch lineage and fork timestamps to find the appropriate version.
 *
 * Resolution order:
 * 0. If this branch has an explicit version pointer, use that version
 * 1. If this branch has its own version, use the latest one
 * 2. Otherwise, check parent branch (filtered by fork time)
 * 3. Return empty (no prose yet)
 */
export function resolveProseForBranch(
  scene: Scene,
  branchId: string,
  branches: Record<string, Branch>,
): ResolvedProse {
  const branch = branches[branchId];
  if (!branch) {
    return { prose: undefined, beatProseMap: undefined, proseScore: undefined };
  }

  // 0. Check for explicit version pointer
  const pointer = branch.versionPointers?.[scene.id]?.proseVersion;
  if (pointer) {
    const pinned = (scene.proseVersions ?? []).find(v => v.version === pointer);
    if (pinned) {
      return { prose: pinned.prose, beatProseMap: pinned.beatProseMap, proseScore: pinned.proseScore };
    }
  }

  // 1. Check if this branch has its own version
  const ownVersions = (scene.proseVersions ?? [])
    .filter(v => v.branchId === branchId)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (ownVersions.length > 0) {
    const v = ownVersions[0];
    return { prose: v.prose, beatProseMap: v.beatProseMap, proseScore: v.proseScore };
  }

  // 2. Check parent, filtered by fork time
  if (branch.parentBranchId) {
    const resolved = resolveProseAtTime(scene, branch.parentBranchId, branches, branch.createdAt);
    if (resolved.prose !== undefined) return resolved;
  }

  // 3. Defensive fallback: analysis-runner-assembled narratives may carry prose
  // versions with a placeholder branchId ("main") that does not match any real
  // branch. If we still have versions on the scene and every prior path failed
  // to find one, fall back to the latest version by timestamp. Prevents a
  // scene with real prose from rendering as "V0".
  const allVersions = (scene.proseVersions ?? [])
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp);
  if (allVersions.length > 0) {
    const v = allVersions[0];
    return { prose: v.prose, beatProseMap: v.beatProseMap, proseScore: v.proseScore };
  }

  // 4. No prose yet
  return { prose: undefined, beatProseMap: undefined, proseScore: undefined };
}

/**
 * Internal helper: resolve prose for a branch, only considering versions created before maxTime.
 */
function resolveProseAtTime(
  scene: Scene,
  branchId: string,
  branches: Record<string, Branch>,
  maxTime: number,
): ResolvedProse {
  const branch = branches[branchId];
  if (!branch) {
    return { prose: undefined, beatProseMap: undefined, proseScore: undefined };
  }

  // Versions from this branch, created before maxTime
  const versions = (scene.proseVersions ?? [])
    .filter(v => v.branchId === branchId && v.timestamp <= maxTime)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (versions.length > 0) {
    const v = versions[0];
    return { prose: v.prose, beatProseMap: v.beatProseMap, proseScore: v.proseScore };
  }

  // Recurse to parent
  if (branch.parentBranchId) {
    const parentForkTime = Math.min(maxTime, branch.createdAt);
    return resolveProseAtTime(scene, branch.parentBranchId, branches, parentForkTime);
  }

  return { prose: undefined, beatProseMap: undefined, proseScore: undefined };
}

/**
 * Resolve plan for a scene as viewed by a specific branch.
 * Uses branch lineage and fork timestamps to find the appropriate version.
 *
 * Resolution order:
 * 0. If this branch has an explicit version pointer, use that version
 * 1. If this branch has its own version, use the latest one
 * 2. Otherwise, check parent branch (filtered by fork time)
 * 3. Return undefined (no plan yet)
 */
export function resolvePlanForBranch(
  scene: Scene,
  branchId: string,
  branches: Record<string, Branch>,
): BeatPlan | undefined {
  const branch = branches[branchId];
  if (!branch) return undefined;

  // 0. Check for explicit version pointer
  const pointer = branch.versionPointers?.[scene.id]?.planVersion;
  if (pointer) {
    const pinned = (scene.planVersions ?? []).find(v => v.version === pointer);
    if (pinned) {
      return pinned.plan;
    }
  }

  // 1. Check if this branch has its own version
  const ownVersions = (scene.planVersions ?? [])
    .filter(v => v.branchId === branchId)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (ownVersions.length > 0) {
    return ownVersions[0].plan;
  }

  // 2. Check parent, filtered by fork time
  if (branch.parentBranchId) {
    const resolved = resolvePlanAtTime(scene, branch.parentBranchId, branches, branch.createdAt);
    if (resolved !== undefined) return resolved;
  }

  // 3. Defensive fallback: same rationale as resolveProseForBranch — handle
  // assembled narratives whose version objects carry a placeholder branchId.
  const allVersions = (scene.planVersions ?? [])
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp);
  if (allVersions.length > 0) {
    return allVersions[0].plan;
  }

  // 4. No plan yet
  return undefined;
}

/**
 * Internal helper: resolve plan for a branch, only considering versions created before maxTime.
 */
function resolvePlanAtTime(
  scene: Scene,
  branchId: string,
  branches: Record<string, Branch>,
  maxTime: number,
): BeatPlan | undefined {
  const branch = branches[branchId];
  if (!branch) return undefined;

  // Versions from this branch, created before maxTime
  const versions = (scene.planVersions ?? [])
    .filter(v => v.branchId === branchId && v.timestamp <= maxTime)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (versions.length > 0) {
    return versions[0].plan;
  }

  // Recurse to parent
  if (branch.parentBranchId) {
    const parentForkTime = Math.min(maxTime, branch.createdAt);
    return resolvePlanAtTime(scene, branch.parentBranchId, branches, parentForkTime);
  }

  return undefined;
}

/**
 * Get the version string of the resolved prose for a scene and branch.
 * Returns undefined if using legacy (unversioned) prose.
 */
export function getResolvedProseVersion(
  scene: Scene,
  branchId: string,
  branches: Record<string, Branch>,
): string | undefined {
  const branch = branches[branchId];
  if (!branch) return undefined;

  // Check for explicit version pointer
  const pointer = branch.versionPointers?.[scene.id]?.proseVersion;
  if (pointer) {
    const pinned = (scene.proseVersions ?? []).find(v => v.version === pointer);
    if (pinned) return pinned.version;
  }

  // Check this branch's versions
  const ownVersions = (scene.proseVersions ?? [])
    .filter(v => v.branchId === branchId)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (ownVersions.length > 0) {
    return ownVersions[0].version;
  }

  // Check parent
  if (branch.parentBranchId) {
    return getResolvedProseVersionAtTime(scene, branch.parentBranchId, branches, branch.createdAt);
  }

  return undefined;
}

function getResolvedProseVersionAtTime(
  scene: Scene,
  branchId: string,
  branches: Record<string, Branch>,
  maxTime: number,
): string | undefined {
  const branch = branches[branchId];
  if (!branch) return undefined;

  const versions = (scene.proseVersions ?? [])
    .filter(v => v.branchId === branchId && v.timestamp <= maxTime)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (versions.length > 0) {
    return versions[0].version;
  }

  if (branch.parentBranchId) {
    const parentForkTime = Math.min(maxTime, branch.createdAt);
    return getResolvedProseVersionAtTime(scene, branch.parentBranchId, branches, parentForkTime);
  }

  return undefined;
}

/**
 * Get the version string of the resolved plan for a scene and branch.
 * Returns undefined if using legacy (unversioned) plan.
 */
export function getResolvedPlanVersion(
  scene: Scene,
  branchId: string,
  branches: Record<string, Branch>,
): string | undefined {
  const branch = branches[branchId];
  if (!branch) return undefined;

  // Check for explicit version pointer
  const pointer = branch.versionPointers?.[scene.id]?.planVersion;
  if (pointer) {
    const pinned = (scene.planVersions ?? []).find(v => v.version === pointer);
    if (pinned) return pinned.version;
  }

  // Check this branch's versions
  const ownVersions = (scene.planVersions ?? [])
    .filter(v => v.branchId === branchId)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (ownVersions.length > 0) {
    return ownVersions[0].version;
  }

  // Check parent
  if (branch.parentBranchId) {
    return getResolvedPlanVersionAtTime(scene, branch.parentBranchId, branches, branch.createdAt);
  }

  return undefined;
}

function getResolvedPlanVersionAtTime(
  scene: Scene,
  branchId: string,
  branches: Record<string, Branch>,
  maxTime: number,
): string | undefined {
  const branch = branches[branchId];
  if (!branch) return undefined;

  const versions = (scene.planVersions ?? [])
    .filter(v => v.branchId === branchId && v.timestamp <= maxTime)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (versions.length > 0) {
    return versions[0].version;
  }

  if (branch.parentBranchId) {
    const parentForkTime = Math.min(maxTime, branch.createdAt);
    return getResolvedPlanVersionAtTime(scene, branch.parentBranchId, branches, parentForkTime);
  }

  return undefined;
}

/**
 * Compute thread statuses at a given scene index by replaying threadDeltas.
 * Returns a map of threadId → current status.
 */
export function computeThreadStatuses(
  narrative: NarrativeState,
  sceneIndex: number,
  resolvedEntryKeys?: string[],
): Record<string, ThreadStatus> {
  // Start with the base statuses from thread definitions
  const statuses: Record<string, ThreadStatus> = {};
  for (const [id, thread] of Object.entries(narrative.threads)) {
    statuses[id] = thread.status;
  }

  // Replay deltas up to and including the current scene (skip world builds)
  const sceneKeys = resolvedEntryKeys ?? Object.keys(narrative.scenes);
  for (let i = 0; i <= sceneIndex && i < sceneKeys.length; i++) {
    const scene = narrative.scenes[sceneKeys[i]];
    if (!scene) continue;
    for (const tm of scene.threadDeltas) {
      statuses[tm.threadId] = tm.to;
    }
  }

  return statuses;
}

/** Count distinct arcs where a thread received bandwidth (derived from scenes). */
export function computeActiveArcs(threadId: string, scenes: Record<string, Scene>): number {
  const arcIds = new Set<string>();
  for (const scene of Object.values(scenes)) {
    if (scene.threadDeltas.some((tm) => tm.threadId === threadId)) {
      arcIds.add(scene.arcId);
    }
  }
  return arcIds.size;
}

// ── Stale Thread Detection ─────────────────────────────────────────────────

/** Threshold: threads with no transition for this many scenes are stale. */
export const STALE_THREAD_THRESHOLD = 5;

/** Statuses that are below the fate commitment boundary (can be abandoned). */
const ABANDONABLE_STATUSES = new Set(['latent', 'seeded', 'active']);

/** Statuses at or above the fate commitment boundary (must resolve). */
const COMMITTED_STATUSES = new Set(['escalating', 'critical']);

export type StaleThread = {
  threadId: string;
  status: string;
  scenesSinceTransition: number;
  reason: 'no_transition' | 'high_pulse_ratio' | 'low_bandwidth';
};

/**
 * Detect stale threads that should be abandoned.
 * Threads below 'escalating' that haven't transitioned in STALE_THREAD_THRESHOLD scenes
 * are candidates for cleanup.
 *
 * Returns threads sorted by staleness (most stale first).
 */
export function detectStaleThreads(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
): StaleThread[] {
  const statuses = computeThreadStatuses(narrative, currentSceneIndex, resolvedEntryKeys);
  const staleThreads: StaleThread[] = [];

  // Track last transition scene for each thread
  const lastTransition: Record<string, number> = {};
  const deltaCounts: Record<string, { transitions: number; pulses: number }> = {};

  for (let i = 0; i <= currentSceneIndex && i < resolvedEntryKeys.length; i++) {
    const scene = narrative.scenes[resolvedEntryKeys[i]];
    if (!scene) continue;

    for (const tm of scene.threadDeltas) {
      if (!deltaCounts[tm.threadId]) {
        deltaCounts[tm.threadId] = { transitions: 0, pulses: 0 };
      }
      if (tm.from !== tm.to) {
        lastTransition[tm.threadId] = i;
        deltaCounts[tm.threadId].transitions++;
      } else {
        deltaCounts[tm.threadId].pulses++;
      }
    }
  }

  // Check each thread for staleness
  for (const [threadId, status] of Object.entries(statuses)) {
    // Only check abandonable threads
    if (!ABANDONABLE_STATUSES.has(status)) continue;
    // Skip terminal/abandoned
    if (status === 'resolved' || status === 'subverted' || status === 'abandoned') continue;

    const lastTrans = lastTransition[threadId] ?? -1;
    const scenesSince = lastTrans >= 0 ? currentSceneIndex - lastTrans : currentSceneIndex + 1;
    const counts = deltaCounts[threadId] ?? { transitions: 0, pulses: 0 };
    const totalMuts = counts.transitions + counts.pulses;
    const pulseRatio = totalMuts > 0 ? counts.pulses / totalMuts : 0;

    // Stale if no transition in threshold scenes
    if (scenesSince >= STALE_THREAD_THRESHOLD) {
      staleThreads.push({
        threadId,
        status,
        scenesSinceTransition: scenesSince,
        reason: 'no_transition',
      });
    }
    // Also flag high-pulse threads (spinning without progress)
    else if (pulseRatio > 0.85 && totalMuts >= 4) {
      staleThreads.push({
        threadId,
        status,
        scenesSinceTransition: scenesSince,
        reason: 'high_pulse_ratio',
      });
    }
  }

  // Sort by staleness (most stale first)
  staleThreads.sort((a, b) => b.scenesSinceTransition - a.scenesSinceTransition);

  return staleThreads;
}

/**
 * Check if a thread can be abandoned (is below fate commitment boundary).
 * Returns false for escalating, critical, resolved, subverted threads.
 */
export function canAbandonThread(status: string): boolean {
  return ABANDONABLE_STATUSES.has(status);
}

/**
 * Check if a thread has committed fate (must resolve).
 */
export function isFateCommitted(status: string): boolean {
  return COMMITTED_STATUSES.has(status);
}

/** Classify a thread as storyline or incident based on lifecycle span.
 *  Storyline: activeArcs > 2, or has reached active/critical without resolving quickly.
 *  Incident: resolves within 1-2 arcs, or never progresses past seeded. */
export function classifyThreadKind(thread: Thread, scenes: Record<string, Scene>): 'storyline' | 'incident' {
  const activeArcs = computeActiveArcs(thread.id, scenes);
  if (activeArcs > 2) return 'storyline';
  if (Object.keys(thread.threadLog?.nodes ?? {}).length >= 4) return 'storyline';
  const terminalSet = new Set(['resolved', 'subverted']);
  if (terminalSet.has(thread.status) && activeArcs <= 2) return 'incident';
  if ((thread.status === 'active' || thread.status === 'critical') && activeArcs > 1) return 'storyline';
  return 'incident';
}

// ── Narrative Cube detection ───────────────────────────────────────────────

/** Euclidean distance between two force snapshots */
export function forceDistance(a: ForceSnapshot, b: ForceSnapshot): number {
  return Math.sqrt(
    (a.fate - b.fate) ** 2 +
    (a.world - b.world) ** 2 +
    (a.system - b.system) ** 2,
  );
}

/** Detect the nearest cube corner for a given force snapshot */
export function detectCubeCorner(forces: ForceSnapshot): CubeCorner {
  let best: CubeCorner = NARRATIVE_CUBE.LLL;
  let bestDist = Infinity;
  for (const corner of Object.values(NARRATIVE_CUBE)) {
    const d = forceDistance(forces, corner.forces);
    if (d < bestDist) {
      bestDist = d;
      best = corner;
    }
  }
  return best;
}

/** Returns the proximity (0-1) of forces to a specific cube corner. 1 = at the corner, 0+ = far away.
 *  Uses exponential decay so z-score values beyond ±1 still produce meaningful proximity. */
export function cubeCornerProximity(forces: ForceSnapshot, cornerKey: CubeCornerKey): number {
  const d = forceDistance(forces, NARRATIVE_CUBE[cornerKey].forces);
  return Math.exp(-d / 2);
}

/** Compute swing as Euclidean distance in force space between consecutive scenes.
 *  When reference means are provided, forces are normalized first so each
 *  dimension contributes equally regardless of natural scale.
 *  Returns an array of the same length; the first element is always 0. */
export function computeSwingMagnitudes(
  forceSnapshots: ForceSnapshot[],
  refMeans?: { fate: number; world: number; system: number },
): number[] {
  const rf = refMeans?.fate ?? 1;
  const rw = refMeans?.world ?? 1;
  const rs = refMeans?.system ?? 1;
  const swings: number[] = [0];
  for (let i = 1; i < forceSnapshots.length; i++) {
    const df = (forceSnapshots[i].fate - forceSnapshots[i - 1].fate) / rf;
    const dw = (forceSnapshots[i].world - forceSnapshots[i - 1].world) / rw;
    const ds = (forceSnapshots[i].system - forceSnapshots[i - 1].system) / rs;
    swings.push(Math.sqrt(df * df + dw * dw + ds * ds));
  }
  return swings;
}

/** Compute the average swing over a trailing window of force snapshots */
export function averageSwing(forceSnapshots: ForceSnapshot[], windowSize = FORCE_WINDOW_SIZE): number {
  if (forceSnapshots.length < 2) return 0;
  const swings = computeSwingMagnitudes(forceSnapshots);
  const window = swings.slice(-windowSize);
  return window.reduce((s, v) => s + v, 0) / window.length;
}

/** Default rolling window size for force computation (recency, windowed normalization) */
export { FORCE_WINDOW_SIZE } from '@/lib/constants';

// ── Beat Density Metrics ─────────────────────────────────────────────────────

/**
 * Compute beat density metrics for comparing analysis vs generation.
 * Returns beatsPerKWord, wordsPerBeat, and whether values fall within standard range (8-14).
 */
export function computeBeatMetrics(wordCount: number, beatCount: number) {
  const beatsPerKWord = beatCount > 0 && wordCount > 0
    ? (beatCount / wordCount) * 1000
    : 0;
  const wordsPerBeat = beatCount > 0 ? wordCount / beatCount : 0;

  return {
    beatsPerKWord: Math.round(beatsPerKWord * 10) / 10,
    wordsPerBeat: Math.round(wordsPerBeat),
    withinStandard: beatsPerKWord >= BEAT_DENSITY_MIN && beatsPerKWord <= BEAT_DENSITY_MAX,
  };
}

// ── Force Computation ────────────────────────────────────────────────────────

/**
 * Z-score normalize an array of numbers so the mean maps to 0.
 * Values are in units of standard deviation — positive = above average, negative = below.
 * If all values are equal (zero variance), returns all zeros.
 */
export function zScoreNormalize(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  if (variance === 0) return values.map(() => 0);
  const std = Math.sqrt(variance);
  return values.map((v) => +((v - mean) / std).toFixed(2));
}

// ── Narrative Forces ─────────────────────────────────────────────────────────
//
// Three forces measure distinct dimensions of narrative movement per scene.
// Raw values are z-score normalized: z = (x - μ) / σ.
//
// F = Σ stageWeight(from, to)                (sum of thread transition weights)
// W = ΔN_c + √ΔE_c                           (entity continuity — mirrors S for inner worlds)
// S = ΔN + √ΔE                               (new world-knowledge nodes + sqrt edges)
//
// Swing = ‖f_i - f_{i-1}‖₂                   (Euclidean distance in FWS space)
// D = (F + W + S) / 3                                  (delivery, equal-weighted mean of z-scored forces)
// g(x̃) = 25 - 17·e^{-kx̃}, k = ln(17/4)     (grade, μ = {1.5, 12, 3})
//

/** Context for entity-related calculations (used by external consumers) */
export type EntityContext = {
  characters: Record<string, Character>;
  locations: Record<string, Location>;
  artifacts: Record<string, Artifact>;
  threads: Record<string, Thread>;
};

/** Stage weight for thread lifecycle transitions.
 *  Pulses scale by lifecycle stage — maintaining a critical thread is more significant.
 *  Forward transitions earn progressively more. Resolution is weighted highest.
 *  Abandoned earns 0 — it's cleanup, moving threads to the done pile without contributing to fate.
 *  Escalating is the point of no return — active threads can still be forgotten, escalating must resolve.
 *  Backward transitions and unrecognized statuses earn 0. */
function getStageWeight(from: string, to: string): number {
  if (to === 'abandoned') return 0;  // cleanup, not resolution — no fate

  // Pulses scale by lifecycle stage — sustaining tension at higher stages matters more
  if (from === to) {
    const PULSE_WEIGHTS: Record<string, number> = {
      'latent': 0.25,
      'seeded': 0.5,
      'active': 1.0,
      'escalating': 1.5,
      'critical': 2.0,
    };
    return PULSE_WEIGHTS[from] ?? 0.25;
  }

  const key = `${from}->${to}`;
  const WEIGHTS: Record<string, number> = {
    'latent->seeded': 1.0,
    'seeded->active': 1.5,
    'active->escalating': 2.0,    // point of no return — thread now committed
    'escalating->critical': 3.0,  // peak tension approaches
    'active->critical': 3.0,      // legacy direct jump (prefer escalating path)
    'critical->resolved': 4.0,
    'critical->subverted': 4.0,   // subverted = fate defied, same weight as resolved
  };
  return WEIGHTS[key] ?? 0;
}

/**
 * Compute raw fate score for a scene.
 *
 * F = Σ stageWeight(from, to)
 *
 * Simple sum of transition weights. Pulses (from === to) score 0.
 * Resolution weights more than setup (critical→resolved = 4.0, latent→seeded = 0.5).
 */
function computeRawFate(scene: Scene): number {
  let score = 0;
  for (const tm of scene.threadDeltas) {
    const from = tm.from.toLowerCase();
    const to = tm.to.toLowerCase();
    score += getStageWeight(from, to);
  }
  return score;
}

/** Raw world: W = ΔN_c + √ΔE_c
 *
 *  Entity continuity graph complexity delta per scene.
 *  Mirrors System but for inner worlds — nodes contribute linearly,
 *  edges use sqrt. Same structure, different domain:
 *  System measures what we learn about the WORLD's rules, World measures
 *  what we learn about ENTITIES (characters, locations, artifacts). */
function rawWorld(scene: Scene): number {
  // Nodes contribute linearly; edges are derived from chain-by-order (one
  // per pair of adjacent new nodes), so per delta the edge count is
  // max(0, nodes - 1).
  const contNodes = scene.worldDeltas.reduce((sum, km) => sum + (km.addedNodes?.length ?? 0), 0);
  const contEdges = scene.worldDeltas.reduce((sum, km) => sum + Math.max(0, (km.addedNodes?.length ?? 0) - 1), 0);
  return contNodes + Math.sqrt(contEdges);
}

/** Raw system: S = ΔN + √ΔE
 *
 *  System knowledge graph complexity delta per scene.
 *  Nodes contribute linearly — each new concept is genuinely new information.
 *  Edges use sqrt — the first few connections between concepts matter more
 *  than the tenth. Prevents bulk edge additions from inflating System.
 *
 *  Examples:
 *    3 nodes, 0 edges → S = 3        (isolated concepts)
 *    2 nodes, 2 edges → S = 3.4      (connected)
 *    3 nodes, 4 edges → S = 5        (dense)
 *    1 node,  4 edges → S = 3        (hub integration)
 *    0 nodes, 4 edges → S = 2        (pure reconnection)
 *    0 nodes, 10 edges → S = 3.2     (diminishing returns) */
function rawSystem(scene: Scene): number {
  const wkm = scene.systemDeltas;
  if (!wkm) return 0;
  const n = wkm.addedNodes?.length ?? 0;
  const e = wkm.addedEdges?.length ?? 0;
  return n + Math.sqrt(e);
}

// ── System Graph Utilities ─────────────────────────────────────────

/** Compute degree centrality for each node in the system graph.
 *  More edges = more significant concept. Returns sorted by relevance descending. */
export function rankSystemNodes(graph: SystemGraph): { node: SystemNode; degree: number }[] {
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  return Object.values(graph.nodes)
    .map((node) => ({ node, degree: degree.get(node.id) ?? 0 }))
    .sort((a, b) => b.degree - a.degree);
}

/** Build the cumulative system graph up to a given scene index
 *  by replaying systemDeltas from both scenes and world build commits. */
export function buildCumulativeSystemGraph(
  scenes: Record<string, Scene>,
  resolvedKeys: string[],
  upToIndex: number,
  worldBuilds?: Record<string, WorldBuild>,
): SystemGraph {
  const nodes: Record<string, SystemNode> = {};
  const edges: SystemEdge[] = [];

  const applyDelta = (wkm: SystemDelta) => {
    for (const n of wkm.addedNodes ?? []) {
      if (!nodes[n.id]) nodes[n.id] = { id: n.id, concept: n.concept, type: n.type };
    }
    for (const e of wkm.addedEdges ?? []) {
      if (!edges.some((x) => x.from === e.from && x.to === e.to && x.relation === e.relation)) {
        edges.push({ from: e.from, to: e.to, relation: e.relation });
      }
    }
  };

  for (let i = 0; i <= upToIndex && i < resolvedKeys.length; i++) {
    const key = resolvedKeys[i];
    const scene = scenes[key];
    if (scene?.systemDeltas) {
      applyDelta(scene.systemDeltas);
    }
    const wb = worldBuilds?.[key];
    if (wb?.expansionManifest.systemDeltas) {
      applyDelta(wb.expansionManifest.systemDeltas);
    }
  }
  return { nodes, edges };
}

/**
 * Compute ForceSnapshots for a batch of scenes using z-score normalization.
 * 0 = average moment; positive = above average; negative = below average (units of std deviation).
 *
 * - **Fate**: phase transitions — thread status changes (weighted by jump magnitude and entity investment)
 * - **World**: entity continuity graph complexity delta (ΔN_c + √ΔE_c per scene)
 * - **System**: system graph complexity delta (new nodes + sqrt edges per scene)
 *
 * @param scenes - Ordered list of scenes to compute forces for
 * @param priorScenes - Scenes before this batch (for usage tracking). Empty for initial generation.
 * @param entityCtx - Optional entity context for investment-weighted fate calculation
 */
export function computeForceSnapshots(
  scenes: Scene[],
  _priorScenes: Scene[] = [],
): Record<string, ForceSnapshot> {
  const result: Record<string, ForceSnapshot> = {};
  if (scenes.length === 0) return result;

  // Compute raw values per scene
  const rawFates: number[] = [];
  const rawWorlds: number[] = [];
  const rawSystems: number[] = [];

  for (const scene of scenes) {
    rawFates.push(computeRawFate(scene));
    rawWorlds.push(rawWorld(scene));
    rawSystems.push(rawSystem(scene));
  }

  // Z-score normalize each dimension (mean = 0, units = std deviations)
  const normFates = zScoreNormalize(rawFates);
  const normWorlds = zScoreNormalize(rawWorlds);
  const normSystems = zScoreNormalize(rawSystems);

  for (let i = 0; i < scenes.length; i++) {
    result[scenes[i].id] = {
      fate: normFates[i],
      world: normWorlds[i],
      system: normSystems[i],
    };
  }
  return result;
}

/**
 * Compute raw (non-normalized) force totals for a set of scenes.
 * Returns absolute values suitable for cross-series comparison.
 *
 * @param scenes - Ordered list of scenes
 */
export function computeRawForceTotals(
  scenes: Scene[],
): { fate: number[]; world: number[]; system: number[] } {
  if (scenes.length === 0) return { fate: [], world: [], system: [] };

  const fate: number[] = [];
  const world: number[] = [];
  const system: number[] = [];

  for (const scene of scenes) {
    fate.push(computeRawFate(scene));
    world.push(rawWorld(scene));
    system.push(rawSystem(scene));
  }

  return { fate, world, system };
}

/** Compute a simple moving average over a data series.
 *  Returns an array of the same length; values before the window is full use a smaller window. */
export function movingAverage(data: number[], windowSize: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = data.slice(start, i + 1);
    result.push(window.reduce((s, v) => s + v, 0) / window.length);
  }
  return result;
}

// ── Delivery / Dopamine Curve ──────────────────────────────────────────────

/** Gaussian kernel smooth with mirror-padding at boundaries. */
function gaussianSmooth(values: number[], sigma: number): number[] {
  if (values.length === 0) return [];
  const radius = Math.ceil(sigma * 3);
  const weights: number[] = [];
  let wSum = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    weights.push(w);
    wSum += w;
  }
  return values.map((_, i) => {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = Math.max(0, Math.min(values.length - 1, i + k));
      sum += weights[k + radius] * values[j];
    }
    return sum / wSum;
  });
}

/**
 * Detect local peaks and valleys using minimum drop filtering.
 *
 * A point is a peak if it is the local maximum within `windowR` AND the curve
 * drops by at least `minDrop` on both sides before rising again. This catches
 * every visually obvious bump — even small ones near large peaks — while still
 * filtering flat plateaus. Valley detection is symmetric.
 *
 * Calibrated against subjective peak/valley identification across 4 published
 * works (HP, 1984, Gatsby, Reverend Insanity) with 89/101 alignment.
 */
function detectPeaksAndValleys(
  values: number[],
  minDrop = 0.15,
  windowR = 2,
): { peaks: Set<number>; valleys: Set<number> } {
  const peaks = new Set<number>();
  const valleys = new Set<number>();
  const n = values.length;

  for (let i = 1; i < n - 1; i++) {
    const center = values[i];

    // Check local maximum/minimum within window
    let isMax = true;
    let isMin = true;
    const lo = Math.max(0, i - windowR);
    const hi = Math.min(n - 1, i + windowR);
    for (let k = lo; k <= hi; k++) {
      if (k === i) continue;
      if (values[k] > center) isMax = false;
      if (values[k] < center) isMin = false;
    }

    if (isMax) {
      // How far does the curve drop on each side before rising above this peak?
      let leftMin = center;
      for (let j = i - 1; j >= 0; j--) {
        leftMin = Math.min(leftMin, values[j]);
        if (values[j] > center) break;
      }
      let rightMin = center;
      for (let j = i + 1; j < n; j++) {
        rightMin = Math.min(rightMin, values[j]);
        if (values[j] > center) break;
      }
      // Use the smaller drop (shallower side) — both sides must drop
      if (Math.min(center - leftMin, center - rightMin) >= minDrop) peaks.add(i);
    }

    if (isMin) {
      let leftMax = center;
      for (let j = i - 1; j >= 0; j--) {
        leftMax = Math.max(leftMax, values[j]);
        if (values[j] < center) break;
      }
      let rightMax = center;
      for (let j = i + 1; j < n; j++) {
        rightMax = Math.max(rightMax, values[j]);
        if (values[j] < center) break;
      }
      if (Math.min(leftMax - center, rightMax - center) >= minDrop) valleys.add(i);
    }
  }

  return { peaks, valleys };
}

export interface DeliveryPoint {
  /** Scene index (0-based) */
  index: number;
  /** Delivery: equal-weighted mean of fate, world, and system z-scores.
   *  Measures the overall narrative presence of a scene — how strongly all three forces radiate. */
  delivery: number;
  /** Tension buildup: world + system − fate. High when energy accumulates without release. */
  tension: number;
  /** Gaussian-smoothed delivery (σ=1.5) — local curve shape for display. */
  smoothed: number;
  /** Heavily smoothed macro trend (σ=4) — overall arc of the narrative. */
  macroTrend: number;
  /** True if this is a significant local delivery peak. */
  isPeak: boolean;
  /** True if this is a significant local delivery valley. */
  isValley: boolean;
}

/**
 * Compute the delivery curve from z-score normalised force snapshots.
 *
 * D = (F + W + S) / 3
 *
 * Equal-weighted mean of z-scored forces. Because each force is independently
 * z-score normalised (mean=0, std=1) before averaging, all three contribute
 * equally regardless of their raw scale differences. Peaks emerge from scenes
 * where all three forces fire together — structurally complete moments.
 */
export function computeDeliveryCurve(snapshots: ForceSnapshot[]): DeliveryPoint[] {
  if (snapshots.length === 0) return [];
  const n = snapshots.length;

  const engValues = snapshots.map(({ fate, world, system }) =>
    (fate + world + system) / 3,
  );

  const smoothed = gaussianSmooth(engValues, 1.5);
  const macroTrend = gaussianSmooth(engValues, 4);

  // minDrop: a peak/valley must drop by at least this much on both sides.
  // Low threshold (0.08 × std) catches subtle peaks that are visually obvious.
  const smMean = smoothed.reduce((s, v) => s + v, 0) / n;
  const smStd = Math.sqrt(smoothed.reduce((s, v) => s + (v - smMean) ** 2, 0) / n);
  const minDrop = Math.max(0.03, 0.08 * smStd);

  // Wider window for longer books — prevents peak saturation
  const windowR = Math.max(2, Math.floor(n / PEAK_WINDOW_SCENES_DIVISOR));

  const { peaks, valleys } = detectPeaksAndValleys(smoothed, minDrop, windowR);

  return snapshots.map(({ fate, world, system }, i) => ({
    index: i,
    delivery: engValues[i],
    tension: world + system - fate,
    smoothed: smoothed[i],
    macroTrend: macroTrend[i],
    isPeak: peaks.has(i),
    isValley: valleys.has(i),
  }));
}

// ── Narrative Shape Classification ────────────────────────────────────────────

export interface NarrativeShape {
  key: string;
  name: string;
  description: string;
  /** Characteristic curve as [x, y] pairs, both normalised 0–1 */
  curve: [number, number][];
}

export const SHAPES = {
  climactic: {
    key: 'climactic',
    name: 'Climactic',
    description: 'Build, climax, release — one dominant peak defines the arc',
    curve: [[0,0.2],[0.25,0.5],[0.45,0.8],[0.5,1],[0.55,0.8],[0.75,0.5],[1,0.25]] as [number,number][],
  },
  episodic: {
    key: 'episodic',
    name: 'Episodic',
    description: 'Multiple peaks of similar weight — no single climax dominates',
    curve: [[0,0.3],[0.1,0.7],[0.2,0.3],[0.35,0.75],[0.5,0.25],[0.65,0.8],[0.8,0.3],[0.9,0.7],[1,0.35]] as [number,number][],
  },
  rebounding: {
    key: 'rebounding',
    name: 'Rebounding',
    description: 'A meaningful dip followed by strong recovery',
    curve: [[0,0.6],[0.2,0.35],[0.4,0.1],[0.6,0.3],[0.8,0.65],[1,0.9]] as [number,number][],
  },
  peaking: {
    key: 'peaking',
    name: 'Peaking',
    description: 'Dominant peak early or mid-arc, followed by decline',
    curve: [[0,0.4],[0.2,0.85],[0.35,1],[0.55,0.65],[0.75,0.35],[1,0.15]] as [number,number][],
  },
  escalating: {
    key: 'escalating',
    name: 'Escalating',
    description: 'Momentum rises overall — intensity concentrated toward the end',
    curve: [[0,0.1],[0.2,0.2],[0.4,0.35],[0.6,0.55],[0.8,0.8],[1,1]] as [number,number][],
  },
  flat: {
    key: 'flat',
    name: 'Flat',
    description: 'Too little structural variation — no meaningful peaks or valleys',
    curve: [[0,0.5],[0.25,0.52],[0.5,0.48],[0.75,0.51],[1,0.5]] as [number,number][],
  },
} satisfies Record<string, NarrativeShape>;

/** All shape keys for external use. */
export type NarrativeShapeKey = keyof typeof SHAPES;

/** Shape metrics computed from the delivery curve. */
export interface ShapeMetrics {
  overallSlope: number;
  peakCount: number;
  peakDominance: number;
  peakPosition: number;
  troughDepth: number;
  recoveryStrength: number;
  flatness: number;
}

/**
 * Classify the overall shape of a narrative based on its delivery curve.
 *
 * Accepts delivery values (one per scene), applies Gaussian smoothing,
 * computes six core metrics, derives boolean conditions, and classifies
 * into one of five shapes: Climactic, Episodic, Rebounding, Peaking, Escalating.
 *
 * curve → metrics → booleans → shape
 */
export function classifyNarrativeShape(deliveries: number[]): NarrativeShape {
  if (deliveries.length < 6) return SHAPES.flat;
  const n = deliveries.length;
  const smoothed = gaussianSmooth(deliveries, 1.5);
  const macro = gaussianSmooth(deliveries, 4);

  // ── Metrics ────────────────────────────────────────────────────────────

  // Flatness: std dev of smoothed curve
  const smMean = smoothed.reduce((s, v) => s + v, 0) / n;
  const flatness = Math.sqrt(smoothed.reduce((s, v) => s + (v - smMean) ** 2, 0) / n);

  // Overall slope: macro end minus start
  const overallSlope = macro[n - 1] - macro[0];

  // Peak detection — same minDrop approach as computeDeliveryCurve
  const smStd = flatness;
  const minDrop = Math.max(0.03, 0.08 * smStd);
  const windowR = Math.max(2, Math.floor(n / PEAK_WINDOW_SCENES_DIVISOR));
  const { peaks, valleys } = detectPeaksAndValleys(smoothed, minDrop, windowR);
  const peakCount = peaks.size;

  // Peak prominences
  const peakIndices = Array.from(peaks).sort((a, b) => a - b);
  const prominences = peakIndices.map((pi) => {
    // Prominence: peak value minus the higher of the two nearest bases
    let leftBase = smoothed[0];
    for (let j = pi - 1; j >= 0; j--) {
      if (smoothed[j] > smoothed[pi]) break;
      leftBase = Math.min(leftBase, smoothed[j]);
    }
    let rightBase = smoothed[n - 1];
    for (let j = pi + 1; j < n; j++) {
      if (smoothed[j] > smoothed[pi]) break;
      rightBase = Math.min(rightBase, smoothed[j]);
    }
    return smoothed[pi] - Math.max(leftBase, rightBase);
  });
  const totalProminence = prominences.reduce((s, v) => s + v, 0);
  const maxPromIdx = prominences.length > 0 ? prominences.indexOf(Math.max(...prominences)) : 0;
  const dominantPeakIdx = peakIndices[maxPromIdx] ?? Math.floor(n / 2);

  // Peak dominance: largest prominence / total prominence
  const peakDominance = totalProminence > 0 ? Math.max(...prominences) / totalProminence : 0;

  // Peak position: 0..1
  const peakPosition = dominantPeakIdx / (n - 1);

  // Trough depth and recovery — only counts as a rebound if the trough
  // is in the middle portion of the curve (not at edges) and significantly
  // below the mean. A true V-shape has a concentrated central collapse.
  const valleyIndices = Array.from(valleys).sort((a, b) => a - b);
  let troughDepth = 0;
  let recoveryStrength = 0;
  let troughPosition = 0.5;
  if (valleyIndices.length > 0) {
    // Find deepest trough in the middle 60% of the curve (not edges)
    const midStart = Math.floor(n * SHAPE_TROUGH_BAND_LO);
    const midEnd = Math.floor(n * SHAPE_TROUGH_BAND_HI);
    const midValleys = valleyIndices.filter((vi) => vi >= midStart && vi <= midEnd);
    const searchValleys = midValleys.length > 0 ? midValleys : valleyIndices;

    let deepestIdx = searchValleys[0];
    let deepestVal = smoothed[deepestIdx];
    for (const vi of searchValleys) {
      if (smoothed[vi] < deepestVal) {
        deepestVal = smoothed[vi];
        deepestIdx = vi;
      }
    }
    troughPosition = deepestIdx / (n - 1);

    // Only count if below the mean and in the middle portion
    if (deepestVal < smMean && troughPosition > 0.15 && troughPosition < 0.85) {
      const leftHigh = Math.max(...smoothed.slice(0, deepestIdx + 1));
      const rightHigh = Math.max(...smoothed.slice(deepestIdx));
      troughDepth = Math.min(leftHigh, rightHigh) - deepestVal;
      recoveryStrength = rightHigh - deepestVal;
    }
  }

  // ── Boolean conditions ─────────────────────────────────────────────────

  const isFlat = flatness < 0.15;
  const hasManyPeaks = peakCount >= 4;
  const hasDominantPeak = peakDominance > 0.40;
  const hasEarlyPeak = peakPosition < 0.4;
  const hasMidLatePeak = peakPosition >= 0.4;
  // Rebounding requires a V-shaped macro curve: the middle third must be
  // lower than both outer thirds, AND a deep central trough.
  const t1 = Math.floor(n / 3);
  const t2 = Math.floor(2 * n / 3);
  const segAvg = (a: number, b: number) => macro.slice(a, b).reduce((s, v) => s + v, 0) / (b - a);
  const avgQ1 = segAvg(0, t1);
  const avgQ2 = segAvg(t1, t2);
  const avgQ3 = segAvg(t2, n);
  const hasMacroVShape = avgQ2 < avgQ1 - 0.1 && avgQ2 < avgQ3 - 0.1;
  const hasDeepTrough = troughDepth > 1.5 * smStd && hasMacroVShape;
  const hasStrongRecovery = recoveryStrength > 1.5 * smStd;
  const isRisingOverall = overallSlope > 0.3;
  const isFallingOverall = overallSlope < -0.3;

  // ── Classification (priority order) ────────────────────────────────────

  // ── Classification (priority order) ────────────────────────────────────

  // Guard: too flat to classify meaningfully
  if (isFlat) return SHAPES.flat;

  // Peaking: dominant early peak with decline — front-loaded intensity
  if (hasDominantPeak && hasEarlyPeak && !isRisingOverall) return SHAPES.peaking;

  // Escalating: clear rising trend wins over peak patterns
  if (isRisingOverall && !isFallingOverall) return SHAPES.escalating;

  // Rebounding: exceptional collapse followed by strong recovery.
  // Trough must be below the mean AND exceed 2x the curve's own std dev.
  if (hasDeepTrough && hasStrongRecovery) return SHAPES.rebounding;

  // Episodic: many peaks, none dominant, after directional shapes ruled out.
  // Long-form narratives with repeated fate cycles and no clear slope.
  if (hasManyPeaks && !hasDominantPeak) return SHAPES.episodic;

  // Climactic: dominant mid/late peak, or fallback
  if (hasDominantPeak && hasMidLatePeak) return SHAPES.climactic;

  return SHAPES.climactic;
}

// ── Narrative Archetype Classification ────────────────────────────────────────

export interface NarrativeArchetype {
  key: string;
  name: string;
  description: string;
  /** Which force(s) define this archetype */
  dominant: ('fate' | 'world' | 'system')[];
}

export const ARCHETYPES = {
  opus:        { key: 'opus',        name: 'Opus',        description: 'All three forces in concert — fates land, characters transform, and the world deepens together', dominant: ['fate', 'world', 'system'] as const },
  series:      { key: 'series',      name: 'Series',      description: 'Consequential events that permanently reshape characters — fates land and lives change', dominant: ['fate', 'world'] as const },
  atlas:       { key: 'atlas',       name: 'Atlas',       description: 'Resolutions that map the world — each fate reveals how things work', dominant: ['fate', 'system'] as const },
  chronicle:   { key: 'chronicle',   name: 'Chronicle',   description: 'Characters transform within a deepening world — lives and systems evolve together', dominant: ['world', 'system'] as const },
  classic:     { key: 'classic',     name: 'Classic',     description: 'Fate-driven — threads pay off and relationships shift decisively', dominant: ['fate'] as const },
  stage:       { key: 'stage',       name: 'Stage',       description: 'Rich inner worlds — characters, places, and artifacts with deep continuity that grows and transforms', dominant: ['world'] as const },
  paper:       { key: 'paper',       name: 'Paper',       description: 'Dense with ideas and systems — the depth of the world itself is the draw', dominant: ['system'] as const },
  emerging:    { key: 'emerging',    name: 'Emerging',    description: 'No single force has reached its potential yet — the story is still finding its voice', dominant: [] as const },
} satisfies Record<string, NarrativeArchetype>;

/**
 * Classify a narrative's archetype based on its force grade profile.
 *
 * Uses the relative gap between forces rather than a fixed threshold:
 * - If all three forces are within 5 points of each other → balanced
 * - Otherwise, forces ≥ (max - 5) are "co-dominant"
 * - The combination of dominant forces determines the archetype
 * - Balanced + high (avg ≥ 18) = Masterwork; balanced + low = Intimate
 */
export function classifyArchetype(grades: ForceGrades): NarrativeArchetype {
  const f = grades.fate;
  const w = grades.world;
  const s = grades.system;
  const max = Math.max(f, w, s);
  const gap = 5;
  const floor = 21;

  // A force must score ≥ 21 AND be within 5 of the max to be dominant
  const fDom = f >= floor && f >= max - gap;
  const wDom = w >= floor && w >= max - gap;
  const sDom = s >= floor && s >= max - gap;

  if (fDom && wDom && sDom) return ARCHETYPES.opus;
  if (fDom && wDom)         return ARCHETYPES.series;
  if (fDom && sDom)         return ARCHETYPES.atlas;
  if (wDom && sDom)         return ARCHETYPES.chronicle;
  if (fDom)                 return ARCHETYPES.classic;
  if (wDom)                 return ARCHETYPES.stage;
  if (sDom)                 return ARCHETYPES.paper;
  return ARCHETYPES.emerging;
}

// ── Narrative Scale Classification ────────────────────────────────────────────
// Calibrated from analysed works:
//   Sketch:    < 20 scenes  (short story, one-act)
//   Novella:   20–50 scenes (Romeo & Juliet 24, Great Gatsby 44)
//   Novel:     50–120 scenes (1984 75, HP books 89–110, Tale of Two Cities 100)
//   Epic:      120–300 scenes (Reverend Insanity 133 — partial, first volume)
//   Serial:    300+ scenes (full web serials, multi-volume sagas)

export interface NarrativeScale {
  key: string;
  name: string;
  description: string;
}

const SCALES: Record<string, NarrativeScale> = {
  short:  { key: 'short',  name: 'Short',  description: 'A contained vignette — one conflict, one resolution' },
  story:  { key: 'story',  name: 'Story',  description: 'A focused narrative with room for subplot and development' },
  novel:  { key: 'novel',  name: 'Novel',  description: 'Full-length narrative with multiple arcs and cast depth' },
  epic:   { key: 'epic',   name: 'Epic',   description: 'Extended narrative with sprawling cast and world scope' },
  serial: { key: 'serial', name: 'Serial', description: 'Long-running multi-volume narrative with evolving world' },
};

export function classifyScale(sceneCount: number): NarrativeScale {
  if (sceneCount < 20)  return SCALES.short;
  if (sceneCount < 50)  return SCALES.story;
  if (sceneCount < 120) return SCALES.novel;
  if (sceneCount < 300) return SCALES.epic;
  return SCALES.serial;
}

// ── World Density Classification ─────────────────────────────────────────────
// Measures richness of the world relative to story length.
// Density = (characters + locations + threads + systemNodes) / scenes
// Calibrated from analysed works:
//   Two Cities:     (73+48+32+20)/100  = 1.7
//   HP Azkaban:     (86+74+34+39)/110  = 2.1
//   HP Chamber:     (75+56+50+62)/89   = 2.7
//   Romeo & Juliet: (27+10+14+26)/24   = 3.2
//   AI-generated (early): 15-30 entities / 5-10 scenes = 3-6+

export interface WorldDensity {
  key: string;
  name: string;
  description: string;
  density: number;
}

const DENSITIES: Record<string, Omit<WorldDensity, 'density'>> = {
  sparse:    { key: 'sparse',    name: 'Sparse',    description: 'Minimal world scaffolding — story over setting' },
  focused:   { key: 'focused',   name: 'Focused',   description: 'Lean world built to serve specific narrative needs' },
  developed: { key: 'developed', name: 'Developed', description: 'Substantial world with layered characters and tensions' },
  rich:      { key: 'rich',      name: 'Rich',      description: 'Dense world where every scene touches multiple systems' },
  sprawling: { key: 'sprawling', name: 'Sprawling', description: 'Deeply interconnected world — every corner holds detail' },
};

export function classifyWorldDensity(
  sceneCount: number,
  characterCount: number,
  locationCount: number,
  threadCount: number,
  systemNodeCount: number,
  /** Total continuity nodes across all entities (characters + locations + artifacts) */
  entityContinuityNodeCount?: number,
  /** Total continuity edges across all entities */
  entityContinuityEdgeCount?: number,
): WorldDensity {
  if (sceneCount === 0) return { ...DENSITIES.sparse, density: 0 };
  // Entity continuity contributes to density via the same ΔN + √ΔE pattern
  const continuityContribution = (entityContinuityNodeCount ?? 0) + Math.sqrt(entityContinuityEdgeCount ?? 0);
  const density = (characterCount + locationCount + threadCount + systemNodeCount + continuityContribution) / sceneCount;
  const base = density < 0.5 ? DENSITIES.sparse
    : density < 1.5 ? DENSITIES.focused
    : density < 2.5 ? DENSITIES.developed
    : density < 4.0 ? DENSITIES.rich
    : DENSITIES.sprawling;
  return { ...base, density: Math.round(density * 100) / 100 };
}

// ── Local Position Classification ─────────────────────────────────────────────

export interface NarrativePosition {
  key: 'peak' | 'trough' | 'rising' | 'falling' | 'stable';
  name: string;
  description: string;
}

const POSITIONS: Record<NarrativePosition['key'], NarrativePosition> = {
  peak:    { key: 'peak',    name: 'Peak',    description: 'Deliveries are at a local high — intensity is cresting' },
  trough:  { key: 'trough',  name: 'Trough',  description: 'Deliveries are at a local low — energy has bottomed out' },
  rising:  { key: 'rising',  name: 'Rising',  description: 'Deliveries are climbing — building toward a high point' },
  falling: { key: 'falling', name: 'Falling', description: 'Deliveries are declining — unwinding from a high' },
  stable:  { key: 'stable',  name: 'Stable',  description: 'Deliveries are holding steady — no strong directional movement' },
};

/**
 * Classify the local delivery position at the current (last) point of a delivery window.
 * Checks proximity to detected peaks/valleys first, then falls back to slope direction.
 */
export function classifyCurrentPosition(points: DeliveryPoint[]): NarrativePosition {
  if (points.length === 0) return POSITIONS.stable;
  const n = points.length;

  // Look within the last few points for a detected peak or valley
  const nearWindow = Math.min(4, n);
  const recent = points.slice(-nearWindow);
  let lastPeakOff = -1;
  let lastValleyOff = -1;
  for (let i = 0; i < recent.length; i++) {
    if (recent[i].isPeak)   lastPeakOff   = i;
    if (recent[i].isValley) lastValleyOff = i;
  }

  if (lastPeakOff >= 0 || lastValleyOff >= 0) {
    if (lastPeakOff > lastValleyOff) return POSITIONS.peak;
    return POSITIONS.trough;
  }

  // Fall back to recent slope of smoothed values
  const slopeN = Math.min(6, n);
  const slopePoints = points.slice(-slopeN);
  const smValues = slopePoints.map((p) => p.smoothed);
  const delta = smValues[smValues.length - 1] - smValues[0];
  const smMin = Math.min(...smValues);
  const smMax = Math.max(...smValues);
  const range = smMax - smMin;

  if (range < 0.05) return POSITIONS.stable;
  const norm = delta / range;
  if (norm > 0.2)  return POSITIONS.rising;
  if (norm < -0.2) return POSITIONS.falling;
  return POSITIONS.stable;
}

// ── Windowed Forces ──────────────────────────────────────────────────────────

export type WindowedForceResult = {
  forceMap: Record<string, ForceSnapshot>;
  /** Inclusive scene-array index where the window starts */
  windowStart: number;
  /** Inclusive scene-array index where the window ends */
  windowEnd: number;
};

/**
 * Compute forces normalized within a rolling window around the current scene.
 * The window is the last `windowSize` scenes ending at `currentIndex`.
 * System usage is seeded from scenes before the window so novelty is still relative.
 */
export function computeWindowedForces(
  scenes: Scene[],
  currentIndex: number,
  windowSize: number = FORCE_WINDOW_SIZE,
): WindowedForceResult {
  const empty: WindowedForceResult = { forceMap: {}, windowStart: 0, windowEnd: 0 };
  if (scenes.length === 0) return empty;

  const end = Math.min(currentIndex, scenes.length - 1);
  const start = Math.max(0, end - windowSize + 1);
  const windowScenes = scenes.slice(start, end + 1);
  const priorScenes = scenes.slice(0, start);

  return {
    forceMap: computeForceSnapshots(windowScenes, priorScenes),
    windowStart: start,
    windowEnd: end,
  };
}

// ── Scorecard Grading ────────────────────────────────────────────────────────

export type ForceGrades = {
  fate: number;
  world: number;
  system: number;
  swing: number;
  overall: number;
};

const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

/** Reference means per force — the expected mean for a well-structured narrative.
 *  Raw force values are divided by these to produce a unit-free normalized value
 *  (x̃ = x̄ / μ_ref). At x̃ = 1 the grade reaches ~18/25 (73%).
 *  Originally calibrated from literary works (HP, Gatsby, Crime & Punishment, Coiling Dragon).
 *  Reference means: fate 1.5, world 12, system 3. */
export const FORCE_REFERENCE_MEANS = { fate: 1.5, world: 12, system: 3 } as const;

/** Per-scene density targets by archetype — what the LLM should aim for during generation.
 *  "High" forces use the opus-level reference; "low" forces use relaxed targets.
 *  These are generation hints, not grading references (grading remains universal).
 *
 *  Archetype force profiles:
 *  - opus: all high (balanced masterwork)
 *  - series: fate+world high (consequential character drama)
 *  - atlas: fate+system high (resolutions through world-building)
 *  - chronicle: world+system high (transformative exploration)
 *  - classic: fate high (plot-driven payoffs)
 *  - show: world high (character-driven transformation)
 *  - paper: system high (idea-dense world-building)
 */
import type { ArchetypeKey } from "@/types/narrative";

const HIGH_FATE = 1.5;
const LOW_FATE = 0.5;
const HIGH_WORLD = 12;
const LOW_WORLD = 6;
const HIGH_SYSTEM = 3;
const LOW_SYSTEM = 1;

export type ArchetypeForceProfile = {
  fate: number;
  world: number;
  system: number;
  description: string;
  /** If true, force targets are strictly enforced. If false, they're guidance only. */
  enforced: boolean;
};

export const ARCHETYPE_FORCE_TARGETS: Record<ArchetypeKey, ArchetypeForceProfile> = {
  opus:      { fate: HIGH_FATE, world: HIGH_WORLD, system: HIGH_SYSTEM, enforced: true,  description: "All three forces in concert — fate lands, characters transform, world deepens" },
  series:    { fate: HIGH_FATE, world: HIGH_WORLD, system: LOW_SYSTEM,  enforced: false, description: "Consequential events that reshape characters — plot meets character drama" },
  atlas:     { fate: HIGH_FATE, world: LOW_WORLD,  system: HIGH_SYSTEM, enforced: false, description: "Resolutions through world-building — each fate reveals how things work" },
  chronicle: { fate: LOW_FATE,  world: HIGH_WORLD, system: HIGH_SYSTEM, enforced: false, description: "Transformative exploration — characters grow within a deepening world" },
  classic:   { fate: HIGH_FATE, world: LOW_WORLD,  system: LOW_SYSTEM,  enforced: false, description: "Plot-driven — threads pay off decisively, less focus on transformation or lore" },
  stage:     { fate: LOW_FATE,  world: HIGH_WORLD, system: LOW_SYSTEM,  enforced: false, description: "Rich inner worlds — characters, places, and artifacts with deep continuity" },
  paper:     { fate: LOW_FATE,  world: LOW_WORLD,  system: HIGH_SYSTEM, enforced: false, description: "Idea-dense — the depth and structure of the world itself is the draw" },
};

/** Get per-scene force profile for a given archetype (or opus if empty/invalid) */
export function getArchetypeForceTargets(archetype: ArchetypeKey | "" | undefined): ArchetypeForceProfile {
  if (!archetype || !(archetype in ARCHETYPE_FORCE_TARGETS)) {
    return ARCHETYPE_FORCE_TARGETS.opus;
  }
  return ARCHETYPE_FORCE_TARGETS[archetype];
}


/** Grade a mean-normalized force value 8→25: g(x̃) = 25 − 17·e^{−kx̃}, k = ln(17/4).
 *  Single exponential — floor 8, reference 21 (dominance threshold), cap 25.
 *  k is fully determined by these three constraints. */
const GRADE_K = Math.log(17 / 4);
export function gradeForce(normalizedMean: number): number {
  return 25 - 17 * Math.exp(-GRADE_K * Math.max(0, normalizedMean));
}

/**
 * Grade narrative forces (0–25 each, 0–100 overall).
 * Fate/world/system are raw values, normalised here by FORCE_REFERENCE_MEANS.
 * Swing values are mean-normalised Euclidean distances — graded directly (single normalisation).
 */
export function gradeForces(
  fate: number[],
  world: number[],
  system: number[],
  swing: number[],
): ForceGrades {
  const R = FORCE_REFERENCE_MEANS;
  const fateGrade = gradeForce(avg(fate) / R.fate);
  const worldGrade = gradeForce(avg(world) / R.world);
  const systemGrade = gradeForce(avg(system) / R.system);
  const swingGrade = gradeForce(avg(swing));

  const overall = fateGrade + worldGrade + systemGrade + swingGrade;

  return {
    fate: Math.round(fateGrade),
    world: Math.round(worldGrade),
    system: Math.round(systemGrade),
    swing: Math.round(swingGrade),
    overall: Math.round(overall),
  };
}
