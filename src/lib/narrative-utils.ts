import type { Branch, NarrativeState, Scene, ThreadStatus, ForceSnapshot, CubeCornerKey, CubeCorner } from '@/types/narrative';
import { NARRATIVE_CUBE, THREAD_TERMINAL_STATUSES } from '@/types/narrative';
import { FORCE_WINDOW_SIZE } from '@/lib/constants';

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
/** Compute swing as Euclidean distance in force space between consecutive scenes.
 *  When reference means are provided, forces are normalized first so each
 *  dimension contributes equally regardless of natural scale. */
export function computeSwingMagnitudes(
  forceSnapshots: ForceSnapshot[],
  refMeans?: { payoff: number; change: number; variety: number },
): number[] {
  const rp = refMeans?.payoff ?? 1;
  const rc = refMeans?.change ?? 1;
  const rv = refMeans?.variety ?? 1;
  const swings: number[] = [0];
  for (let i = 1; i < forceSnapshots.length; i++) {
    const dp = (forceSnapshots[i].payoff - forceSnapshots[i - 1].payoff) / rp;
    const dc = (forceSnapshots[i].change - forceSnapshots[i - 1].change) / rc;
    const dv = (forceSnapshots[i].variety - forceSnapshots[i - 1].variety) / rv;
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
export { FORCE_WINDOW_SIZE } from '@/lib/constants';

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
// P = Σ |φ_to - φ_from| + Σ |Δv|^1.5     (phase distance + super-linear valence shifts)
// C = Σ_c log₂(1 + m_c)                  (mutation reach per character)
// V = Σr(g_c) + r(g_ℓ) + J̄               (cast recency + loc recency + ensemble)
//     where r(g) = g / (1 + g)            (parameter-free saturating decay)
//
// S = ‖f_i - f_{i-1}‖₂                   (Euclidean distance in PCV space)
// E = (P + C + V) / 3                    (engagement, Gaussian smoothed)
// g(x̃) = 20(1 - e^{-2x̃}), x̃ = x̄/μ     (grade, μ = {2, 7, 4.5, 1.2})
//

/** Phase index — distance between indices = magnitude of the phase jump.
 *  Linear ordering: each step is one unit of payoff. */
const PHASE_INDEX: Record<string, number> = {
  dormant: 0, active: 1, escalating: 2, critical: 3,
};
/** Terminal transitions use the full phase length (max distance in the active chain) */
const TERMINAL_PHASE_DISTANCE = Object.keys(PHASE_INDEX).length; // 4
const TERMINAL_STATUS_SET = new Set<string>(THREAD_TERMINAL_STATUSES.map((s) => s.toLowerCase()));

function computeRawPayoff(scene: Scene): number {
  let score = 0;

  for (const tm of scene.threadMutations) {
    const from = tm.from.toLowerCase();
    const to = tm.to.toLowerCase();
    if (from === to) continue;

    if (TERMINAL_STATUS_SET.has(to)) {
      score += TERMINAL_PHASE_DISTANCE;
    } else {
      const fi = PHASE_INDEX[from];
      const ti = PHASE_INDEX[to];
      score += fi !== undefined && ti !== undefined ? Math.abs(ti - fi) : 1;
    }
  }

  // Valence shifts use |Δv|^1.5 — small drifts are dampened,
  // large swings (reversals) contribute near-full weight.
  for (const rm of scene.relationshipMutations) {
    const av = Math.abs(rm.valenceDelta);
    score += av ** 1.5;
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


/** Raw variety: V = Σr(g_c) + r(g_ℓ) + J̄
 *
 *  - Σr(g_c): sum of recency across participants (scales with cast size)
 *  - r(g_ℓ): location recency [0, 1]
 *  - J̄: mean Jaccard distance vs all prior casts [0, 1]
 *
 *  Recency: r(g) = g / (1 + g). First appearance → r = 1. */
function rawVariety(
  scene: Scene,
  charLastSeen: Record<string, number>,
  locLastSeen: Record<string, number>,
  priorCasts: Set<string>[],
  sceneIdx: number,
): number {
  const recency = (lastSeen: number | undefined) => {
    if (lastSeen === undefined) return 1;
    const g = sceneIdx - lastSeen;
    return g / (1 + g);
  };

  // Character recency: sum (not mean) so larger fresh casts produce stronger signal
  const charRecency = scene.participantIds.reduce((sum, id) => sum + recency(charLastSeen[id]), 0);

  // Location recency → [0, 1]
  const locRecency = recency(locLastSeen[scene.locationId]);

  // Ensemble novelty: mean Jaccard distance → [0, 1]
  const cast = new Set(scene.participantIds);
  let ensembleNovelty = 1;
  if (priorCasts.length > 0) {
    ensembleNovelty = priorCasts.reduce((sum, prior) => sum + jaccard(cast, prior), 0) / priorCasts.length;
  }

  return charRecency + locRecency + ensembleNovelty;
}

/**
 * Compute ForceSnapshots for a batch of scenes using z-score normalization.
 * 0 = average moment; positive = above average; negative = below average (units of std deviation).
 *
 * - **Payoff**: phase transitions — thread status changes (weighted by jump magnitude) and squared relationship valence shifts (small drifts dampened, large swings amplified)
 * - **Change**: mutation reach — sum of log₂(1 + mutations) per affected character
 * - **Variety**: r̄_char + r_loc + J̄ — three [0,1] components equally weighted
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

// ── Engagement / Dopamine Curve ────────────────────────────────────────────

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
 * Detect local peaks and valleys with prominence filtering.
 *
 * A peak is a local maximum within a window of `windowR` that stands at least
 * `minProminence` above the lowest point between it and the nearest higher peak.
 * Valley detection is symmetric. Uses the smoothed series for stable detection.
 */
function detectPeaksAndValleys(
  values: number[],
  minProminence = 0.5,
  windowR = 2,
): { peaks: Set<number>; valleys: Set<number> } {
  const peaks = new Set<number>();
  const valleys = new Set<number>();
  const n = values.length;
  for (let i = windowR; i < n - windowR; i++) {
    const center = values[i];
    let isMax = true;
    let isMin = true;
    for (let k = i - windowR; k <= i + windowR; k++) {
      if (k === i) continue;
      if (values[k] > center) isMax = false;
      if (values[k] < center) isMin = false;
    }
    if (isMax) {
      let leftBase = Infinity;
      for (let j = i - 1; j >= 0; j--) {
        leftBase = Math.min(leftBase, values[j]);
        if (values[j] > center) break;
      }
      let rightBase = Infinity;
      for (let j = i + 1; j < n; j++) {
        rightBase = Math.min(rightBase, values[j]);
        if (values[j] > center) break;
      }
      const base = Math.max(
        leftBase === Infinity ? values[0] : leftBase,
        rightBase === Infinity ? values[n - 1] : rightBase,
      );
      if (center - base >= minProminence) peaks.add(i);
    }
    if (isMin) {
      let leftBase = -Infinity;
      for (let j = i - 1; j >= 0; j--) {
        leftBase = Math.max(leftBase, values[j]);
        if (values[j] < center) break;
      }
      let rightBase = -Infinity;
      for (let j = i + 1; j < n; j++) {
        rightBase = Math.max(rightBase, values[j]);
        if (values[j] < center) break;
      }
      const base = Math.min(
        leftBase === -Infinity ? values[0] : leftBase,
        rightBase === -Infinity ? values[n - 1] : rightBase,
      );
      if (base - center >= minProminence) valleys.add(i);
    }
  }
  return { peaks, valleys };
}

export interface EngagementPoint {
  /** Scene index (0-based) */
  index: number;
  /**
   * Composite engagement score: equal-weighted mean of payoff, change, and variety,
   * amplified by an anticipation factor when prior scenes had high emotional change.
   */
  engagement: number;
  /** Tension buildup: change + variety − payoff. High when energy accumulates without release. */
  tension: number;
  /** Gaussian-smoothed engagement (σ=1.5) — local curve shape for display. */
  smoothed: number;
  /** Heavily smoothed macro trend (σ=4) — overall arc of the narrative. */
  macroTrend: number;
  /** True if this is a significant local engagement peak (dopamine spike). */
  isPeak: boolean;
  /** True if this is a significant local engagement valley (rest/recovery). */
  isValley: boolean;
}

/**
 * Compute the reader engagement (dopamine) curve from z-score normalised force snapshots.
 *
 * Engagement is the equal-weighted mean of all three forces — no arbitrary prioritisation.
 * Peak/valley detection uses adaptive prominence (relative to the signal's own variance) and
 * an adaptive window radius so longer books don't produce spuriously many local extrema.
 */
export function computeEngagementCurve(snapshots: ForceSnapshot[]): EngagementPoint[] {
  if (snapshots.length === 0) return [];
  const n = snapshots.length;

  const engValues = snapshots.map(({ payoff, change, variety }) =>
    (payoff + change + variety) / 3,
  );

  const smoothed = gaussianSmooth(engValues, 1.5);
  const macroTrend = gaussianSmooth(engValues, 4);

  // Prominence relative to the signal's own spread — works for both flat and spiky narratives
  const smMean = smoothed.reduce((s, v) => s + v, 0) / n;
  const smStd = Math.sqrt(smoothed.reduce((s, v) => s + (v - smMean) ** 2, 0) / n);
  const minProminence = Math.max(0.1, 0.4 * smStd);

  // Wider window for longer books — prevents peak saturation
  const windowR = Math.max(2, Math.floor(n / 25));

  const { peaks, valleys } = detectPeaksAndValleys(smoothed, minProminence, windowR);

  return snapshots.map(({ payoff, change, variety }, i) => ({
    index: i,
    engagement: engValues[i],
    tension: change + variety - payoff,
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

const SHAPES = {
  rags_to_riches: {
    key: 'rags_to_riches',
    name: 'Escalating',
    description: 'Beats climb continuously — momentum builds from start to finish',
    curve: [[0,0.1],[0.2,0.25],[0.4,0.45],[0.6,0.65],[0.8,0.82],[1,1]] as [number,number][],
  },
  tragedy: {
    key: 'tragedy',
    name: 'Subsiding',
    description: 'Beats fall throughout — intensity drains as the narrative progresses',
    curve: [[0,1],[0.2,0.8],[0.4,0.6],[0.6,0.4],[0.8,0.22],[1,0.08]] as [number,number][],
  },
  man_in_hole: {
    key: 'man_in_hole',
    name: 'Rebounding',
    description: 'Beats drop in the middle then climb back — low point followed by upswing',
    curve: [[0,0.6],[0.2,0.35],[0.4,0.1],[0.6,0.3],[0.8,0.65],[1,0.9]] as [number,number][],
  },
  icarus: {
    key: 'icarus',
    name: 'Peaking',
    description: 'Beats peak early then trail off — intensity concentrated at the opening',
    curve: [[0,0.4],[0.2,0.85],[0.35,1],[0.55,0.65],[0.75,0.35],[1,0.15]] as [number,number][],
  },
  cinderella: {
    key: 'cinderella',
    name: 'Cyclical',
    description: 'Two distinct rises separated by a trough — beats crest, fall, then crest again',
    curve: [[0,0.3],[0.2,0.75],[0.35,0.9],[0.5,0.35],[0.65,0.2],[0.8,0.75],[1,1]] as [number,number][],
  },
  one_climax: {
    key: 'one_climax',
    name: 'Climactic',
    description: 'Beats converge on one central high — build, climax, resolution',
    curve: [[0,0.2],[0.25,0.5],[0.45,0.8],[0.5,1],[0.55,0.8],[0.75,0.5],[1,0.25]] as [number,number][],
  },
  slow_burn: {
    key: 'slow_burn',
    name: 'Slow Burn',
    description: 'Beats stay low early then surge — intensity concentrated at the close',
    curve: [[0,0.15],[0.2,0.2],[0.4,0.18],[0.6,0.35],[0.75,0.65],[0.9,0.9],[1,1]] as [number,number][],
  },
  episodic: {
    key: 'episodic',
    name: 'Episodic',
    description: 'Multiple beats of similar weight — no single dominant high point',
    curve: [[0,0.3],[0.1,0.7],[0.2,0.3],[0.35,0.75],[0.5,0.25],[0.65,0.8],[0.8,0.3],[0.9,0.7],[1,0.35]] as [number,number][],
  },
  plateau: {
    key: 'plateau',
    name: 'Uniform',
    description: 'Beats show little structural variation — measured and consistent throughout',
    curve: [[0,0.5],[0.25,0.52],[0.5,0.48],[0.75,0.51],[1,0.5]] as [number,number][],
  },
} satisfies Record<string, NarrativeShape>;

/**
 * Classify the overall shape of an engagement curve into a named narrative archetype.
 *
 * Uses the macro trend (heavily smoothed) for direction and overall slope,
 * and the peak count from the local detection for episodic vs focused structure.
 * Inspired by Vonnegut's story shapes and Reagan et al.'s arc research.
 */
export function classifyNarrativeShape(points: EngagementPoint[]): NarrativeShape {
  if (points.length < 6) return SHAPES.plateau;
  const n = points.length;
  const macro = points.map((p) => p.macroTrend);
  const smoothed = points.map((p) => p.smoothed);

  // Variance of the smoothed curve — low means flat/plateau
  const smMean = smoothed.reduce((s, v) => s + v, 0) / n;
  const variance = Math.sqrt(smoothed.reduce((s, v) => s + (v - smMean) ** 2, 0) / n);
  if (variance < 0.15) return SHAPES.plateau;

  // Third-segment macro trend averages
  const t1 = Math.floor(n / 3);
  const t2 = Math.floor(2 * n / 3);
  const segAvg = (a: number, b: number) => macro.slice(a, b).reduce((s, v) => s + v, 0) / (b - a);
  const avgQ1 = segAvg(0, t1);
  const avgQ2 = segAvg(t1, t2);
  const avgQ3 = segAvg(t2, n);

  const overallSlope = macro[n - 1] - macro[0];
  const peakCount = points.filter((p) => p.isPeak).length;

  // Episodic: four or more labeled peaks with no dominant direction
  if (peakCount >= 4 && Math.abs(overallSlope) < 0.5) return SHAPES.episodic;

  // V-shape: middle third is lowest — dip then recovery
  const midDip = avgQ2 < avgQ1 - 0.12 && avgQ2 < avgQ3 - 0.12;
  // Λ-shape: middle third is highest — classic build and release
  const midPeak = avgQ2 > avgQ1 + 0.12 && avgQ2 > avgQ3 + 0.12;

  if (midPeak) return SHAPES.one_climax;

  if (midDip) {
    // Man in Hole if it recovers to at least starting level
    return SHAPES.man_in_hole;
  }

  // Strong overall direction
  if (overallSlope > 0.4) {
    // Slow Burn: starts genuinely below zero and climbs to positive
    if (macro[0] < -0.2 && macro[n - 1] > 0.2) return SHAPES.slow_burn;
    return SHAPES.rags_to_riches;
  }

  if (overallSlope < -0.4) {
    // Icarus: peak is in the first half, then falls away
    const maxIdx = smoothed.indexOf(Math.max(...smoothed));
    if (maxIdx / n < 0.45) return SHAPES.icarus;
    return SHAPES.tragedy;
  }

  // Two peaks with a rising end → Cinderella double arc
  if (peakCount >= 2 && avgQ3 > avgQ1 + 0.15) return SHAPES.cinderella;

  return SHAPES.one_climax;
}

// ── Local Position Classification ─────────────────────────────────────────────

export interface NarrativePosition {
  key: 'peak' | 'trough' | 'rising' | 'falling' | 'stable';
  name: string;
  description: string;
}

const POSITIONS: Record<NarrativePosition['key'], NarrativePosition> = {
  peak:    { key: 'peak',    name: 'Peak',    description: 'Beats are at a local high — intensity is cresting' },
  trough:  { key: 'trough',  name: 'Trough',  description: 'Beats are at a local low — energy has bottomed out' },
  rising:  { key: 'rising',  name: 'Rising',  description: 'Beats are climbing — building toward a high point' },
  falling: { key: 'falling', name: 'Falling', description: 'Beats are declining — unwinding from a high' },
  stable:  { key: 'stable',  name: 'Stable',  description: 'Beats are holding steady — no strong directional movement' },
};

/**
 * Classify the local beat position at the current (last) point of an engagement window.
 * Checks proximity to detected peaks/valleys first, then falls back to slope direction.
 */
export function classifyCurrentPosition(points: EngagementPoint[]): NarrativePosition {
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

/** Reference means per force — the expected mean for a well-structured narrative.
 *  Raw force values are divided by these to produce a unit-free normalized value
 *  (x̃ = x̄ / μ_ref). At x̃ = 1 the grade reaches ~86%.
 *  Calibrated from literary works (HP, Gatsby, Crime & Punishment, Coiling Dragon). */
export const FORCE_REFERENCE_MEANS = { payoff: 1.75, change: 7, variety: 4.5, swing: 1.2 } as const;

/** Grade a mean-normalized force value 0→20: g(x̃) = 20(1 - e^{-2x̃}).
 *  x̃ = x̄ / μ_ref. At x̃ = 1 (matching reference), grade ≈ 17/20 (86%). */
export function gradeForce(normalizedMean: number): number {
  return Math.min(20, 20 * (1 - Math.exp(-2 * Math.max(0, normalizedMean))));
}

/** Streak: sigmoid credit κ(s) = σ(0.1(s - 55)).
 *  Penalty accumulates over consecutive sub-60 arcs, weighted by run position. */
function consistencyFactor(arr: number[]): number {
  const n = arr.length;
  if (n < 2) return 1;

  // Sigmoid credit: arcs above 70 get near-full credit, below 40 get near-zero
  const credit = (s: number) => 1 / (1 + Math.exp(-0.1 * (s - 55)));
  const avgCredit = avg(arr.map(credit));

  if (n < 3) return avgCredit;

  // Streak penalty: only consecutive arcs below 60 (genuinely weak) compound
  let penalty = 0;
  let pos = 0;
  for (let i = 0; i <= n; i++) {
    if (i < n && arr[i] < 60) {
      pos++;
      penalty += (1 - credit(arr[i])) * pos;
    } else {
      pos = 0;
    }
  }

  return avgCredit / (1 + penalty / (n * 8));
}

/**
 * Grade narrative forces (0–20 each, 0–100 overall).
 * Each force is mean-normalized then graded: g(x̃) = 20(1 - e^{-2x̃}), μ = {2, 7, 4.5, 1.2}.
 * Series-level includes a 5th metric (streak/consistency).
 */
export function gradeForces(
  payoff: number[],
  change: number[],
  variety: number[],
  swing: number[],
  arcOveralls?: number[],
): ForceGrades {
  const R = FORCE_REFERENCE_MEANS;
  const payoffGrade = gradeForce(avg(payoff) / R.payoff);
  const changeGrade = gradeForce(avg(change) / R.change);
  const varietyGrade = gradeForce(avg(variety) / R.variety);
  const swingGrade = gradeForce(avg(swing) / R.swing);

  const hasStreak = arcOveralls && arcOveralls.length >= 2;
  const streakGrade = hasStreak ? 20 * consistencyFactor(arcOveralls) : 0;

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
