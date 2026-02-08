import type { Branch, NarrativeState, Scene, ThreadStatus, ForceSnapshot, CubeCornerKey, CubeCorner } from '@/types/narrative';
import { NARRATIVE_CUBE, THREAD_TERMINAL_STATUSES } from '@/types/narrative';

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
export function resolveSceneSequence(
  branches: Record<string, Branch>,
  branchId: string,
): string[] {
  const branch = branches[branchId];
  if (!branch) return [];

  // Root branch — just its own entries
  if (!branch.parentBranchId) return branch.entryIds;

  // Recursively resolve parent
  const parentSequence = resolveSceneSequence(branches, branch.parentBranchId);

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

/**
 * Compute thread statuses at a given scene index by replaying threadMutations.
 * Returns a map of threadId → current status.
 */
export function computeThreadStatuses(
  narrative: NarrativeState,
  sceneIndex: number,
  resolvedSceneKeys?: string[],
): Record<string, ThreadStatus> {
  // Start with the base statuses from thread definitions
  const statuses: Record<string, ThreadStatus> = {};
  for (const [id, thread] of Object.entries(narrative.threads)) {
    statuses[id] = thread.status;
  }

  // Replay mutations up to and including the current scene (skip world builds)
  const sceneKeys = resolvedSceneKeys ?? Object.keys(narrative.scenes);
  for (let i = 0; i <= sceneIndex && i < sceneKeys.length; i++) {
    const scene = narrative.scenes[sceneKeys[i]];
    if (!scene) continue;
    for (const tm of scene.threadMutations) {
      statuses[tm.threadId] = tm.to;
    }
  }

  return statuses;
}

// ── Narrative Cube detection ───────────────────────────────────────────────

/** Euclidean distance between two force snapshots */
function forceDistance(a: ForceSnapshot, b: ForceSnapshot): number {
  return Math.sqrt(
    (a.payoff - b.payoff) ** 2 +
    (a.change - b.change) ** 2 +
    (a.variety - b.variety) ** 2,
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

/** Compute swing magnitude (Euclidean distance) between consecutive force snapshots.
 *  Returns an array of the same length; the first element is always 0. */
export function computeSwingMagnitudes(forceSnapshots: ForceSnapshot[]): number[] {
  const swings: number[] = [0];
  for (let i = 1; i < forceSnapshots.length; i++) {
    const dp = forceSnapshots[i].payoff - forceSnapshots[i - 1].payoff;
    const dc = forceSnapshots[i].change - forceSnapshots[i - 1].change;
    const dv = forceSnapshots[i].variety - forceSnapshots[i - 1].variety;
    swings.push(Math.sqrt(dp * dp + dc * dc + dv * dv));
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

// ── Force Computation ────────────────────────────────────────────────────────

/**
 * Z-score normalize an array of numbers so the mean maps to 0.
 * Values are in units of standard deviation — positive = above average, negative = below.
 * If all values are equal (zero variance), returns all zeros.
 */
function zScoreNormalize(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  if (variance === 0) return values.map(() => 0);
  const std = Math.sqrt(variance);
  return values.map((v) => +((v - mean) / std).toFixed(2));
}

/**
 * Compute raw payoff for a scene — measures phase transitions only.
 *
 * Payoff = how many irreversible state changes occur.
 * Only thread mutations where the status actually changes (from ≠ to) count.
 * Weighted by the magnitude of the jump in the status progression and
 * whether the transition is terminal (irreversible).
 * Relationship valence shifts also contribute — larger swings = higher payoff.
 *
 * Scenes where nothing transitions score 0 regardless of how many mutations exist.
 */

/** Ordered progression index — distance between indices = magnitude of the phase jump */
const STATUS_PHASE_ORDER: string[] = [
  'dormant', 'surfacing', 'escalating', 'fractured', 'converging', 'critical', 'threatened',
];
const TERMINAL_PHASE_WEIGHT: Record<string, number> = {
  resolved: 6,
  done: 3,
  subverted: 8,
  closed: 4,
  abandoned: 2,
};
const TERMINAL_STATUS_SET = new Set<string>(THREAD_TERMINAL_STATUSES.map((s) => s.toLowerCase()));

function computeRawPayoff(scene: Scene): number {
  let score = 0;

  for (const tm of scene.threadMutations) {
    const from = tm.from.toLowerCase();
    const to = tm.to.toLowerCase();
    if (from === to) continue; // no phase transition

    if (TERMINAL_STATUS_SET.has(to)) {
      // Terminal transitions: use dedicated weight (irreversible endings)
      score += TERMINAL_PHASE_WEIGHT[to] ?? 5;
    } else {
      // Active-to-active: magnitude = distance in phase order
      const fromIdx = STATUS_PHASE_ORDER.indexOf(from);
      const toIdx = STATUS_PHASE_ORDER.indexOf(to);
      if (fromIdx >= 0 && toIdx >= 0) {
        score += Math.abs(toIdx - fromIdx);
      } else {
        score += 1; // unknown status, still a transition
      }
    }
  }

  // Relationship phase shifts — magnitude of valence swing
  for (const rm of scene.relationshipMutations) {
    score += Math.abs(rm.valenceDelta) * 10;
  }

  return score;
}

/**
 * Compute raw change for a scene — total mutation count.
 *
 * Change = how much characters learn, change, and are affected.
 * Every mutation (thread touch, knowledge gain/loss, relationship shift) counts.
 */
function rawChange(scene: Scene): number {
  return scene.threadMutations.length
    + scene.knowledgeMutations.length
    + scene.relationshipMutations.length;
}

/**
 * Jaccard distance between two sets: 1 - |intersection| / |union|.
 * Returns 1 when sets are completely disjoint (novel), 0 when identical.
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const v of a) if (b.has(v)) intersection++;
  const union = a.size + b.size - intersection;
  return 1 - intersection / union;
}

/**
 * Compute raw variety for a scene combining entity freshness and compositional novelty.
 *
 * - **Entity freshness**: lower avg participant + location usage = newer elements.
 * - **Compositional novelty**: Jaccard distance of this scene's participant set vs
 *   all prior participant sets. High when this combination of characters is new,
 *   even if the individuals have appeared before.
 */
function rawVariety(scene: Scene, charUsage: Record<string, number>, locUsage: Record<string, number>, priorCasts: Set<string>[]): number {
  // Entity freshness (negative — less usage = higher variety)
  const participantUsage = scene.participantIds.reduce((sum, id) => sum + (charUsage[id] ?? 0), 0);
  const avgParticipantUsage = scene.participantIds.length > 0 ? participantUsage / scene.participantIds.length : 0;
  const locationUsage = locUsage[scene.locationId] ?? 0;
  const freshness = -1 * (avgParticipantUsage + locationUsage);

  // Compositional novelty: min Jaccard distance to any prior cast
  const cast = new Set(scene.participantIds);
  let novelty = 1; // fully novel if no prior scenes
  if (priorCasts.length > 0) {
    let minDist = 1;
    for (const prior of priorCasts) {
      minDist = Math.min(minDist, jaccard(cast, prior));
    }
    novelty = minDist;
  }

  // Combine: freshness is an unbounded negative number, novelty is [0,1].
  // Scale novelty into the same order of magnitude as freshness so both
  // contribute meaningfully before z-score normalization.
  // A scene with ~5 avg usage and ~5 location usage has freshness ≈ -10,
  // so scaling novelty by 10 keeps them balanced.
  return freshness + novelty * 10;
}

/**
 * Compute ForceSnapshots for a batch of scenes using z-score normalization.
 * 0 = average moment; positive = above average; negative = below average (units of std deviation).
 *
 * - **Payoff**: phase transitions — thread status changes (weighted by jump magnitude) and relationship valence shifts
 * - **Change**: mutation volume — how much characters learn, change, and are affected (total mutation count)
 * - **Variety**: combines entity freshness (participant/location usage) and compositional novelty (Jaccard distance of cast vs prior casts)
 *
 * @param scenes - Ordered list of scenes to compute forces for
 * @param priorScenes - Scenes before this batch (for usage tracking). Empty for initial generation.
 */
export function computeForceSnapshots(
  scenes: Scene[],
  priorScenes: Scene[] = [],
): Record<string, ForceSnapshot> {
  const result: Record<string, ForceSnapshot> = {};
  if (scenes.length === 0) return result;

  // Build cumulative usage counts and participant sets from prior scenes
  const charUsage: Record<string, number> = {};
  const locUsage: Record<string, number> = {};
  const priorCasts: Set<string>[] = [];
  for (const s of priorScenes) {
    for (const pid of s.participantIds) charUsage[pid] = (charUsage[pid] ?? 0) + 1;
    locUsage[s.locationId] = (locUsage[s.locationId] ?? 0) + 1;
    priorCasts.push(new Set(s.participantIds));
  }

  // Compute raw values, updating usage counts as we go
  const rawPayoffs: number[] = [];
  const rawChanges: number[] = [];
  const rawVarieties: number[] = [];

  for (const scene of scenes) {
    rawPayoffs.push(computeRawPayoff(scene));
    rawChanges.push(rawChange(scene));
    rawVarieties.push(rawVariety(scene, charUsage, locUsage, priorCasts));
    // Update usage for subsequent scenes
    for (const pid of scene.participantIds) charUsage[pid] = (charUsage[pid] ?? 0) + 1;
    locUsage[scene.locationId] = (locUsage[scene.locationId] ?? 0) + 1;
    priorCasts.push(new Set(scene.participantIds));
  }

  // Z-score normalize each dimension (mean = 0, units = std deviations)
  const normPayoffs = zScoreNormalize(rawPayoffs);
  const normChanges = zScoreNormalize(rawChanges);
  const normVarieties = zScoreNormalize(rawVarieties);

  for (let i = 0; i < scenes.length; i++) {
    result[scenes[i].id] = {
      payoff: normPayoffs[i],
      change: normChanges[i],
      variety: normVarieties[i],
    };
  }
  return result;
}

// ── Windowed Forces ──────────────────────────────────────────────────────────

/** Default rolling window size for relative force computation */
export const FORCE_WINDOW_SIZE = 10;

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
 * Variety usage is seeded from scenes before the window so novelty is still relative.
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
