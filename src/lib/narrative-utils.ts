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

/** Default rolling window size for force computation (recency, windowed normalization) */
export const FORCE_WINDOW_SIZE = 10;

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
  'dormant', 'active', 'escalating', 'escalating', 'escalating', 'critical', 'critical',
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
 * Compute raw change for a scene — mutation reach across affected characters.
 *
 * Counts all mutations (knowledge, relationship, thread) per character, then
 * sums log₂(1 + count) across all affected characters. This naturally captures
 * both breadth (how many characters changed) and depth (how much each changed)
 * with diminishing returns — one character with 8 mutations ≈ three with 1 each.
 */
function rawChange(scene: Scene): number {
  const charMutations: Record<string, number> = {};
  for (const km of scene.knowledgeMutations) {
    charMutations[km.characterId] = (charMutations[km.characterId] ?? 0) + 1;
  }
  for (const rm of scene.relationshipMutations) {
    charMutations[rm.from] = (charMutations[rm.from] ?? 0) + 1;
    charMutations[rm.to] = (charMutations[rm.to] ?? 0) + 1;
  }
  for (const _tm of scene.threadMutations) {
    charMutations[scene.povId] = (charMutations[scene.povId] ?? 0) + 1;
  }
  return Object.values(charMutations).reduce(
    (sum, count) => sum + Math.log2(1 + count), 0,
  );
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
 * Compute raw variety for a scene: how many new elements is the reader encountering?
 *
 * Three components, each measuring a distinct kind of novelty:
 *
 * 1. **Character recency** — first-time participants score 1.0 each; returning
 *    characters score proportionally to how long they've been absent
 *    (gap/window, capped at 1). Summed raw so larger fresh casts score higher.
 *
 * 2. **Location recency** — first visit scores 2.0; revisits score
 *    proportionally to how long ago the location was last used. Weighted 2×
 *    because setting shifts are immediately noticeable.
 *
 * 3. **Ensemble novelty** — average Jaccard distance of this cast vs the last
 *    few casts (not all history). Measures "is this a different *group* than
 *    what we've been seeing?" without permanently flatlining once a cast has
 *    appeared anywhere in history.
 */
function rawVariety(
  scene: Scene,
  charLastSeen: Record<string, number>,
  locLastSeen: Record<string, number>,
  priorCasts: Set<string>[],
  sceneIdx: number,
): number {
  // 1. Character recency: first appearance = 1, returning = gap/window (capped at 1)
  let charRecency = 0;
  for (const id of scene.participantIds) {
    const last = charLastSeen[id];
    if (last === undefined) {
      charRecency += 1; // first appearance
    } else {
      charRecency += Math.min(1, (sceneIdx - last) / FORCE_WINDOW_SIZE);
    }
  }

  // 2. Location recency: first visit = 2, revisit = gap/window × 2 (capped at 2)
  const locLast = locLastSeen[scene.locationId];
  const locRecency = (locLast === undefined ? 1 : Math.min(1, (sceneIdx - locLast) / FORCE_WINDOW_SIZE)) * 2;

  // 3. Ensemble novelty: average Jaccard distance to recent casts only
  const cast = new Set(scene.participantIds);
  let ensembleNovelty = 1;
  if (priorCasts.length > 0) {
    const recent = priorCasts.slice(-FORCE_WINDOW_SIZE);
    ensembleNovelty = recent.reduce((sum, prior) => sum + jaccard(cast, prior), 0) / recent.length;
  }

  return charRecency + locRecency + ensembleNovelty * Math.sqrt(Math.max(cast.size, 1));
}

/**
 * Compute ForceSnapshots for a batch of scenes using z-score normalization.
 * 0 = average moment; positive = above average; negative = below average (units of std deviation).
 *
 * - **Payoff**: phase transitions — thread status changes (weighted by jump magnitude) and relationship valence shifts
 * - **Change**: mutation reach — sum of log₂(1 + mutations) per affected character
 * - **Variety**: new characters (recency-weighted) + new location (2×) + new ensemble (Jaccard vs recent casts)
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

  // Build last-seen indices and participant sets from prior scenes
  const charLastSeen: Record<string, number> = {};
  const locLastSeen: Record<string, number> = {};
  const priorCasts: Set<string>[] = [];
  for (let i = 0; i < priorScenes.length; i++) {
    const s = priorScenes[i];
    for (const pid of s.participantIds) charLastSeen[pid] = i;
    locLastSeen[s.locationId] = i;
    priorCasts.push(new Set(s.participantIds));
  }

  // Compute raw values, updating last-seen as we go
  const rawPayoffs: number[] = [];
  const rawChanges: number[] = [];
  const rawVarieties: number[] = [];
  const baseIdx = priorScenes.length;

  for (let si = 0; si < scenes.length; si++) {
    const scene = scenes[si];
    const globalIdx = baseIdx + si;
    rawPayoffs.push(computeRawPayoff(scene));
    rawChanges.push(rawChange(scene));
    rawVarieties.push(rawVariety(scene, charLastSeen, locLastSeen, priorCasts, globalIdx));
    // Update last-seen for subsequent scenes
    for (const pid of scene.participantIds) charLastSeen[pid] = globalIdx;
    locLastSeen[scene.locationId] = globalIdx;
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

/**
 * Compute raw (non-normalized) force totals for a set of scenes.
 * Returns absolute values suitable for cross-series comparison.
 */
export function computeRawForcetotals(
  scenes: Scene[],
  priorScenes: Scene[] = [],
): { payoff: number[]; change: number[]; variety: number[] } {
  if (scenes.length === 0) return { payoff: [], change: [], variety: [] };

  const charLastSeen: Record<string, number> = {};
  const locLastSeen: Record<string, number> = {};
  const priorCasts: Set<string>[] = [];
  for (let i = 0; i < priorScenes.length; i++) {
    const s = priorScenes[i];
    for (const pid of s.participantIds) charLastSeen[pid] = i;
    locLastSeen[s.locationId] = i;
    priorCasts.push(new Set(s.participantIds));
  }

  const payoff: number[] = [];
  const change: number[] = [];
  const variety: number[] = [];
  const baseIdx = priorScenes.length;

  for (let si = 0; si < scenes.length; si++) {
    const scene = scenes[si];
    const globalIdx = baseIdx + si;
    payoff.push(computeRawPayoff(scene));
    change.push(rawChange(scene));
    variety.push(rawVariety(scene, charLastSeen, locLastSeen, priorCasts, globalIdx));
    for (const pid of scene.participantIds) charLastSeen[pid] = globalIdx;
    locLastSeen[scene.locationId] = globalIdx;
    priorCasts.push(new Set(scene.participantIds));
  }

  return { payoff, change, variety };
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

// ── Scorecard Grading ────────────────────────────────────────────────────────

export type ForceGrades = {
  payoff: number;
  change: number;
  variety: number;
  swing: number;
  streak: number;
  overall: number;
};

const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;


/** Grade a force average 0-20 using exponential saturation */
function gradeForce(a: number, midpoint: number): number {
  return Math.min(20, 20 * (1 - Math.exp(-Math.max(0, a) / midpoint)));
}

/** Average of top 10% values (at least 1) */
function topAvg(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => b - a);
  const k = Math.max(1, Math.ceil(sorted.length * 0.1));
  return avg(sorted.slice(0, k));
}

/** Streak factor based on score color zones.
 *
 *  Each arc earns credit based on its color zone:
 *    green (≥90) = 1.0, yellow-green (80-89) = 0.9, yellow (70-79) = 0.5,
 *    orange (60-69) = 0.2, red (<60) = 0.0
 *
 *  The average credit forms the base score. A streak penalty then reduces
 *  it when below-green arcs (<80) cluster into prolonged low periods.
 *  Each arc in a streak is penalized by zone weight × streak position:
 *    yellow = 1×, orange = 2×, red = 3×
 *  so a red streak compounds much faster than a yellow one. */
function consistencyFactor(arr: number[]): number {
  const n = arr.length;
  if (n < 2) return 1;

  // Zone credit: maps arc score to color-zone reward [0, 1]
  const credit = (s: number) => {
    if (s >= 90) return 1.0;   // green
    if (s >= 80) return 0.9;   // yellow-green
    if (s >= 70) return 0.5;   // yellow
    if (s >= 60) return 0.2;   // orange
    return 0.0;                // red
  };

  // Zone weight for streak penalty: worse zones compound faster
  const zoneWeight = (s: number) => {
    if (s >= 70) return 1;     // yellow
    if (s >= 60) return 2;     // orange
    return 3;                  // red
  };

  // Average zone credit across all arcs
  const avgCredit = avg(arr.map(credit));

  // Streak penalty: consecutive below-green arcs, weighted by zone severity
  if (n < 3) return avgCredit;
  let penalty = 0;
  let pos = 0;
  for (let i = 0; i <= n; i++) {
    if (i < n && arr[i] < 80) {
      pos++;
      penalty += zoneWeight(arr[i]) * pos;
    } else {
      pos = 0;
    }
  }
  const streakFactor = 1 / (1 + penalty / (n * 10));

  return avgCredit * streakFactor;
}

/**
 * Compute force grades (0-20 each, 0-100 overall) from raw force value arrays.
 * Five metrics: payoff, change, variety, swing, and consistency.
 *
 * @param arcOveralls - Optional array of per-arc overall scores (sum of P+C+V+S
 *   for each arc). When provided, consistency measures how stable arc-level quality
 *   is across the story. Without it, consistency defaults to 20 (perfect).
 */
export function gradeForces(
  payoff: number[],
  change: number[],
  variety: number[],
  swing: number[],
  arcOveralls?: number[],
): ForceGrades {
  const swingEffective = avg(swing) * 0.5 + topAvg(swing) * 0.5;

  const payoffGrade = gradeForce(avg(payoff), 3);
  const changeGrade = gradeForce(avg(change), 3);
  const varietyGrade = gradeForce(avg(variety), 2);
  const swingGrade = gradeForce(swingEffective, 5);

  // Streak: zone-based consistency — only applies at series level (cross-arc metric)
  const hasStreak = arcOveralls && arcOveralls.length >= 2;
  const streakGrade = hasStreak ? 20 * consistencyFactor(arcOveralls) : 0;

  // Per-arc: 4 metrics scaled to 0-100; series-level: 5 metrics (including streak) 0-100
  const coreSum = payoffGrade + changeGrade + varietyGrade + swingGrade;
  const overall = hasStreak
    ? coreSum + streakGrade
    : coreSum * (100 / 80);

  return {
    payoff: Math.round(payoffGrade),
    change: Math.round(changeGrade),
    variety: Math.round(varietyGrade),
    swing: Math.round(swingGrade),
    streak: Math.round(streakGrade),
    overall: Math.round(overall),
  };
}
