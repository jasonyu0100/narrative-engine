import type { Branch, NarrativeState, Scene, ThreadStatus, ForceSnapshot, CubeCornerKey, CubeCorner, WorldKnowledgeGraph, WorldKnowledgeNode, WorldKnowledgeMutation } from '@/types/narrative';
import { NARRATIVE_CUBE } from '@/types/narrative';
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
    (a.knowledge - b.knowledge) ** 2,
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
  refMeans?: { payoff: number; change: number; knowledge: number },
): number[] {
  const rp = refMeans?.payoff ?? 1;
  const rc = refMeans?.change ?? 1;
  const rv = refMeans?.knowledge ?? 1;
  const swings: number[] = [0];
  for (let i = 1; i < forceSnapshots.length; i++) {
    const dp = (forceSnapshots[i].payoff - forceSnapshots[i - 1].payoff) / rp;
    const dc = (forceSnapshots[i].change - forceSnapshots[i - 1].change) / rc;
    const dv = (forceSnapshots[i].knowledge - forceSnapshots[i - 1].knowledge) / rv;
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
// P = Σ |φ_to - φ_from| + Σ |Δv|          (phase distance + valence shifts)
// C = log₂(1 + Σm) + log₂(1 + |events|) (total mutation mass + events; cast-blind)
// V = Σr(g_c) + r(g_ℓ) + J̄               (cast recency + loc recency + ensemble)
//     where r(g) = g / (1 + g)            (parameter-free saturating decay)
//
// S = ‖f_i - f_{i-1}‖₂                   (Euclidean distance in PCV space)
// E = 0.5P + 0.5·tanh(C/2) + 0.5·tanh(K/2) + 0.3·contrast  (delivery, C/K saturated via tanh)
//     contrast = max(0, T[i-1] - T[i])                      (tension release bonus)
//     T = C + K - P                                          (tension: buildup without payoff)
// g(x̃) = 25(1 - e^{-2x̃}), x̃ = x̄/μ     (grade, μ = {1.5, 4.5, 2.5})
//

/** Phase index — distance between indices = magnitude of the phase jump.
 *  Linear ordering: each step is one unit of payoff.
 *  Backwards transitions (e.g. escalating→active) use absolute magnitude.
 *  Terminal statuses sit at the top of the scale (4) so resolving from
 *  any active status produces a natural |φ_to - φ_from| distance. */
const PHASE_INDEX: Record<string, number> = {
  dormant: 0, active: 1, escalating: 2, critical: 3,
  resolved: 4, subverted: 4, abandoned: 4,
};
/** Small reward for same-status "pulse" — thread is mentioned but doesn't transition */
const PULSE_REWARD = 0.25;

function computeRawPayoff(scene: Scene): number {
  let score = 0;

  for (const tm of scene.threadMutations) {
    const from = tm.from.toLowerCase();
    const to = tm.to.toLowerCase();

    if (from === to) {
      score += PULSE_REWARD;
    } else {
      const fi = PHASE_INDEX[from];
      const ti = PHASE_INDEX[to];
      score += fi !== undefined && ti !== undefined ? Math.max(0, ti - fi) : 1;
    }
  }

  return score;
}

/** Raw change: total mutation intensity with sqrt scaling.
 *  C = √|M_c| + √|events|
 *  M_c = continuity mutations (what characters learn, lose, or become).
 *  Cast-blind — a tight 2-character confrontation scores the same as a 10-character
 *  ensemble with equal total mutations. Events contribute as a separate sqrt term. */
function rawChange(scene: Scene): number {
  // sqrt for both — less aggressive compression than log₂,
  // allows dense scenes to spike meaningfully above sparse ones.
  return Math.sqrt(scene.continuityMutations.length) + Math.sqrt(scene.events.length);
}

/** Raw knowledge: K = ΔN + √ΔE
 *
 *  World knowledge graph complexity delta per scene.
 *  Nodes contribute linearly — each new concept is genuinely new information.
 *  Edges use sqrt — the first few connections between concepts matter more
 *  than the tenth. Prevents bulk edge additions from inflating Knowledge.
 *
 *  Examples:
 *    3 nodes, 0 edges → K = 3        (isolated concepts)
 *    2 nodes, 2 edges → K = 3.4      (connected)
 *    3 nodes, 4 edges → K = 5        (dense)
 *    1 node,  4 edges → K = 3        (hub integration)
 *    0 nodes, 4 edges → K = 2        (pure reconnection)
 *    0 nodes, 10 edges → K = 3.2     (diminishing returns) */
function rawKnowledge(scene: Scene): number {
  const wkm = scene.worldKnowledgeMutations;
  if (!wkm) return 0;
  const n = wkm.addedNodes?.length ?? 0;
  const e = wkm.addedEdges?.length ?? 0;
  return n + Math.sqrt(e);
}

// ── World Knowledge Graph Utilities ─────────────────────────────────────────

/** Compute degree centrality for each node in the world knowledge graph.
 *  More edges = more significant concept. Returns sorted by relevance descending. */
export function rankWorldKnowledgeNodes(graph: WorldKnowledgeGraph): { node: WorldKnowledgeNode; degree: number }[] {
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  return Object.values(graph.nodes)
    .map((node) => ({ node, degree: degree.get(node.id) ?? 0 }))
    .sort((a, b) => b.degree - a.degree);
}

/** Build the cumulative world knowledge graph up to a given scene index
 *  by replaying worldKnowledgeMutations from both scenes and world build commits. */
export function buildCumulativeWorldKnowledge(
  scenes: Record<string, Scene>,
  resolvedKeys: string[],
  upToIndex: number,
  baseGraph?: WorldKnowledgeGraph,
  worldBuilds?: Record<string, import('@/types/narrative').WorldBuildCommit>,
): WorldKnowledgeGraph {
  const nodes: Record<string, WorldKnowledgeNode> = { ...(baseGraph?.nodes ?? {}) };
  const edges = [...(baseGraph?.edges ?? [])];

  const applyMutation = (wkm: WorldKnowledgeMutation) => {
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
    if (scene?.worldKnowledgeMutations) {
      applyMutation(scene.worldKnowledgeMutations);
    }
    const wb = worldBuilds?.[key];
    if (wb?.worldKnowledgeMutations) {
      applyMutation(wb.worldKnowledgeMutations);
    }
  }
  return { nodes, edges };
}

/**
 * Compute ForceSnapshots for a batch of scenes using z-score normalization.
 * 0 = average moment; positive = above average; negative = below average (units of std deviation).
 *
 * - **Payoff**: phase transitions — thread status changes (weighted by jump magnitude) and relationship valence deltas
 * - **Change**: mutation reach — sum of log₂(1 + mutations) per affected character (includes events)
 * - **Knowledge**: Σr_char + r_loc — character and location recency
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

  // Compute raw values per scene
  const rawPayoffs: number[] = [];
  const rawChanges: number[] = [];
  const rawKnowledges: number[] = [];

  for (const scene of scenes) {
    rawPayoffs.push(computeRawPayoff(scene));
    rawChanges.push(rawChange(scene));
    rawKnowledges.push(rawKnowledge(scene));
  }

  // Z-score normalize each dimension (mean = 0, units = std deviations)
  const normPayoffs = zScoreNormalize(rawPayoffs);
  const normChanges = zScoreNormalize(rawChanges);
  const normKnowledges = zScoreNormalize(rawKnowledges);

  for (let i = 0; i < scenes.length; i++) {
    result[scenes[i].id] = {
      payoff: normPayoffs[i],
      change: normChanges[i],
      knowledge: normKnowledges[i],
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
): { payoff: number[]; change: number[]; knowledge: number[] } {
  if (scenes.length === 0) return { payoff: [], change: [], knowledge: [] };

  const payoff: number[] = [];
  const change: number[] = [];
  const knowledge: number[] = [];

  for (const scene of scenes) {
    payoff.push(computeRawPayoff(scene));
    change.push(rawChange(scene));
    knowledge.push(rawKnowledge(scene));
  }

  return { payoff, change, knowledge };
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

export interface DeliveryPoint {
  /** Scene index (0-based) */
  index: number;
  /** Delivery: equal-weighted mean of payoff, change, and knowledge z-scores.
   *  Measures the overall narrative presence of a scene — how strongly all three forces radiate. */
  delivery: number;
  /** Tension buildup: change + knowledge − payoff. High when energy accumulates without release. */
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
 * Delivery = 0.5P + 0.5·tanh(C/2) + 0.5·tanh(K/2) + 0.3·contrast
 *
 * Payoff is linear — high payoff IS the climax signal and should not
 * be dampened. Change and Knowledge pass through tanh(x/2) which
 * smoothly saturates toward ±1, preventing ensemble/introduction scenes
 * from dominating delivery through sheer breadth. tanh is differentiable
 * everywhere and preserves negative values naturally.
 *
 * The contrast bonus (0.3 × max(0, T[i-1] - T[i])) rewards scenes where
 * tension drops — buildup releasing into payoff.
 */
export function computeDeliveryCurve(snapshots: ForceSnapshot[]): DeliveryPoint[] {
  if (snapshots.length === 0) return [];
  const n = snapshots.length;

  const CONTRAST_WEIGHT = 0.3;

  // Tension per scene: buildup without release
  const tensions = snapshots.map(({ payoff, change, knowledge }) =>
    change + knowledge - payoff,
  );

  // Contrast: reward scenes where tension drops (= release)
  const contrasts = tensions.map((t, i) =>
    i === 0 ? 0 : Math.max(0, tensions[i - 1] - t),
  );

  const engValues = snapshots.map(({ payoff, change, knowledge }, i) =>
    0.5 * payoff + 0.5 * Math.tanh(change / 2) + 0.5 * Math.tanh(knowledge / 2) + CONTRAST_WEIGHT * contrasts[i],
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

  return snapshots.map(({ payoff, change, knowledge }, i) => ({
    index: i,
    delivery: engValues[i],
    tension: change + knowledge - payoff,
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
    description: 'Deliveries climb continuously — momentum builds from start to finish',
    curve: [[0,0.1],[0.2,0.25],[0.4,0.45],[0.6,0.65],[0.8,0.82],[1,1]] as [number,number][],
  },
  tragedy: {
    key: 'tragedy',
    name: 'Subsiding',
    description: 'Deliveries fall throughout — intensity drains as the narrative progresses',
    curve: [[0,1],[0.2,0.8],[0.4,0.6],[0.6,0.4],[0.8,0.22],[1,0.08]] as [number,number][],
  },
  man_in_hole: {
    key: 'man_in_hole',
    name: 'Rebounding',
    description: 'Deliveries drop in the middle then climb back — low point followed by upswing',
    curve: [[0,0.6],[0.2,0.35],[0.4,0.1],[0.6,0.3],[0.8,0.65],[1,0.9]] as [number,number][],
  },
  icarus: {
    key: 'icarus',
    name: 'Peaking',
    description: 'Deliveries peak early then trail off — intensity concentrated at the opening',
    curve: [[0,0.4],[0.2,0.85],[0.35,1],[0.55,0.65],[0.75,0.35],[1,0.15]] as [number,number][],
  },
  cinderella: {
    key: 'cinderella',
    name: 'Cyclical',
    description: 'Two distinct rises separated by a trough — deliveries crest, fall, then crest again',
    curve: [[0,0.3],[0.2,0.75],[0.35,0.9],[0.5,0.35],[0.65,0.2],[0.8,0.75],[1,1]] as [number,number][],
  },
  one_climax: {
    key: 'one_climax',
    name: 'Climactic',
    description: 'Deliveries converge on one central high — build, climax, resolution',
    curve: [[0,0.2],[0.25,0.5],[0.45,0.8],[0.5,1],[0.55,0.8],[0.75,0.5],[1,0.25]] as [number,number][],
  },
  slow_burn: {
    key: 'slow_burn',
    name: 'Slow Burn',
    description: 'Deliveries stay low early then surge — intensity concentrated at the close',
    curve: [[0,0.15],[0.2,0.2],[0.4,0.18],[0.6,0.35],[0.75,0.65],[0.9,0.9],[1,1]] as [number,number][],
  },
  episodic: {
    key: 'episodic',
    name: 'Episodic',
    description: 'Multiple deliveries of similar weight — no single dominant high point',
    curve: [[0,0.3],[0.1,0.7],[0.2,0.3],[0.35,0.75],[0.5,0.25],[0.65,0.8],[0.8,0.3],[0.9,0.7],[1,0.35]] as [number,number][],
  },
  plateau: {
    key: 'plateau',
    name: 'Uniform',
    description: 'Deliveries show little structural variation — measured and consistent throughout',
    curve: [[0,0.5],[0.25,0.52],[0.5,0.48],[0.75,0.51],[1,0.5]] as [number,number][],
  },
} satisfies Record<string, NarrativeShape>;

/**
 * Classify the overall shape of a narrative based on its delivery curve.
 *
 * Accepts delivery values (one per scene), applies Gaussian smoothing
 * internally, and classifies the trajectory into a named archetype.
 * Uses delivery because it captures the full dopamine profile — payoff-weighted
 * force presence plus tension-release contrast.
 *
 * Inspired by Vonnegut's story shapes and Reagan et al.'s arc research.
 */
export function classifyNarrativeShape(deliveries: number[]): NarrativeShape {
  if (deliveries.length < 6) return SHAPES.plateau;
  const n = deliveries.length;
  const smoothed = gaussianSmooth(deliveries, 1.5);
  const macro = gaussianSmooth(deliveries, 4);

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

  // Peak detection on the smoothed payoff curve
  const smStd = Math.sqrt(smoothed.reduce((s, v) => s + (v - smMean) ** 2, 0) / n);
  const minProm = Math.max(0.1, 0.4 * smStd);
  const windowR = Math.max(2, Math.floor(n / 25));
  const { peaks } = detectPeaksAndValleys(smoothed, minProm, windowR);
  const peakCount = peaks.size;

  // Episodic: four or more labeled peaks with no dominant direction
  if (peakCount >= 4 && Math.abs(overallSlope) < 0.5) return SHAPES.episodic;

  // V-shape: middle third is lowest — dip then recovery
  const midDip = avgQ2 < avgQ1 - 0.12 && avgQ2 < avgQ3 - 0.12;
  // Λ-shape: middle third is highest — classic build and release
  const midPeak = avgQ2 > avgQ1 + 0.12 && avgQ2 > avgQ3 + 0.12;

  if (midPeak) return SHAPES.one_climax;

  if (midDip) {
    return SHAPES.man_in_hole;
  }

  // Strong overall direction
  if (overallSlope > 0.4) {
    if (macro[0] < -0.2 && macro[n - 1] > 0.2) return SHAPES.slow_burn;
    return SHAPES.rags_to_riches;
  }

  if (overallSlope < -0.4) {
    const maxIdx = smoothed.indexOf(Math.max(...smoothed));
    if (maxIdx / n < 0.45) return SHAPES.icarus;
    return SHAPES.tragedy;
  }

  // Two peaks with a rising end → Cinderella double arc
  if (peakCount >= 2 && avgQ3 > avgQ1 + 0.15) return SHAPES.cinderella;

  return SHAPES.one_climax;
}

// ── Narrative Archetype Classification ────────────────────────────────────────

export interface NarrativeArchetype {
  key: string;
  name: string;
  description: string;
  /** Which force(s) define this archetype */
  dominant: ('payoff' | 'change' | 'knowledge')[];
}

const ARCHETYPES = {
  masterwork:  { key: 'masterwork',  name: 'Masterwork',  description: 'All three forces in concert — payoffs land, characters transform, and the world deepens together', dominant: ['payoff', 'change', 'knowledge'] as const },
  epic:        { key: 'epic',        name: 'Epic',        description: 'High-stakes payoffs across a sprawling cast — consequences are real and far-reaching', dominant: ['payoff', 'change'] as const },
  chronicle:   { key: 'chronicle',   name: 'Chronicle',   description: 'Resolutions deepen the world — each payoff reveals how things work', dominant: ['payoff', 'knowledge'] as const },
  saga:        { key: 'saga',        name: 'Saga',        description: 'A rich world explored through many lives — expansive in both cast and ideas', dominant: ['change', 'knowledge'] as const },
  classic:     { key: 'classic',     name: 'Classic',     description: 'Driven by resolution — threads pay off and relationships shift decisively', dominant: ['payoff'] as const },
  anthology:   { key: 'anthology',   name: 'Anthology',   description: 'Many lives touched — the story weaves across a wide cast of characters', dominant: ['change'] as const },
  atlas:       { key: 'atlas',       name: 'Atlas',       description: 'Dense with ideas and systems — the depth of the world itself is the draw', dominant: ['knowledge'] as const },
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
  const p = grades.payoff;
  const c = grades.change;
  const k = grades.knowledge;
  const max = Math.max(p, c, k);
  const gap = 5;
  const floor = 20;

  // A force must score ≥ 20 AND be within 5 of the max to be dominant
  const pDom = p >= floor && p >= max - gap;
  const cDom = c >= floor && c >= max - gap;
  const kDom = k >= floor && k >= max - gap;

  if (pDom && cDom && kDom) return ARCHETYPES.masterwork;
  if (pDom && cDom)         return ARCHETYPES.epic;
  if (pDom && kDom)         return ARCHETYPES.chronicle;
  if (cDom && kDom)         return ARCHETYPES.saga;
  if (pDom)                 return ARCHETYPES.classic;
  if (cDom)                 return ARCHETYPES.anthology;
  if (kDom)                 return ARCHETYPES.atlas;
  return ARCHETYPES.emerging;
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
 * Knowledge usage is seeded from scenes before the window so novelty is still relative.
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
  knowledge: number;
  swing: number;
  overall: number;
};

const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

/** Reference means per force — the expected mean for a well-structured narrative.
 *  Raw force values are divided by these to produce a unit-free normalized value
 *  (x̃ = x̄ / μ_ref). At x̃ = 1 the grade reaches ~18/25 (73%).
 *  Calibrated from literary works (HP, Gatsby, Crime & Punishment, Coiling Dragon). */
export const FORCE_REFERENCE_MEANS = { payoff: 1.5, change: 3.5, knowledge: 2.5 } as const;

/** Grade a mean-normalized force value 0→25: g(x̃) = 25(1 - e^{-2x̃}).
 *  x̃ = x̄ / μ_ref. At x̃ = 1 (matching reference), grade ≈ 22/25 (86%). */
export function gradeForce(normalizedMean: number): number {
  return Math.min(25, 25 * (1 - Math.exp(-2 * Math.max(0, normalizedMean))));
}

/**
 * Grade narrative forces (0–25 each, 0–100 overall).
 * Payoff/change/knowledge are raw values, normalised here by FORCE_REFERENCE_MEANS.
 * Swing values are mean-normalised Euclidean distances — graded directly (single normalisation).
 */
export function gradeForces(
  payoff: number[],
  change: number[],
  knowledge: number[],
  swing: number[],
): ForceGrades {
  const R = FORCE_REFERENCE_MEANS;
  const payoffGrade = gradeForce(avg(payoff) / R.payoff);
  const changeGrade = gradeForce(avg(change) / R.change);
  const knowledgeGrade = gradeForce(avg(knowledge) / R.knowledge);
  const swingGrade = gradeForce(avg(swing));

  const overall = payoffGrade + changeGrade + knowledgeGrade + swingGrade;

  return {
    payoff: Math.round(payoffGrade),
    change: Math.round(changeGrade),
    knowledge: Math.round(knowledgeGrade),
    swing: Math.round(swingGrade),
    overall: Math.round(overall),
  };
}
