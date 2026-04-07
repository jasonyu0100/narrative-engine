/**
 * Proposition Classification Engine
 *
 * Classifies propositions into 4 base categories with Local/Global reach:
 *   1. Backward/forward activation strength (cosine similarity)
 *   2. Temporal reach (how far connections span in scene distance)
 *
 * Uses TensorFlow.js for GPU/WASM-accelerated matrix multiplication —
 * the direct equivalent of NumPy's `normed @ normed.T`.
 *
 * Categories (base × reach):
 *   Anchor (Local/Global)  — high backward + high forward
 *   Seed   (Local/Global)  — low backward + high forward
 *   Close (Local/Global)  — high backward + low forward
 *   Texture(Local/Global)  — low backward + low forward
 */

import { resolveEmbeddingsBatch } from './embeddings';
import { resolveEntry, isScene } from '@/types/narrative';
import type {
  NarrativeState,
  PropositionBaseCategory,
  PropositionReach,
  PropositionClassification,
} from '@/types/narrative';

// ── Constants ────────────────────────────────────────────────────────────────

const TOP_K = 5;
const STRENGTH_PERCENTILE = 0.60;
/** Global reach = connections spanning >15% of total scenes (min 3) */
const REACH_RATIO = 0.15;
const REACH_MIN = 5;
const DIMS = 1536;

// ── Colors & Labels ─────────────────────────────────────────────────────────

const BASE_ORDER: PropositionBaseCategory[] = ['Anchor', 'Seed', 'Close', 'Texture'];

/** Base category colors */
export const BASE_COLORS: Record<PropositionBaseCategory, string> = {
  Anchor: '#6366f1',   // indigo
  Seed: '#10b981',     // emerald
  Close: '#f59e0b',   // amber
  Texture: '#6b7280',  // gray
};

/** Darker variants for Global reach */
export const BASE_COLORS_GLOBAL: Record<PropositionBaseCategory, string> = {
  Anchor: '#4338ca',   // dark indigo
  Seed: '#047857',     // dark emerald
  Close: '#b45309',   // dark amber
  Texture: '#4b5563',  // dark gray
};

/** Get color for a classification (darker shade for global) */
export function classificationColor(base: PropositionBaseCategory, reach: PropositionReach): string {
  return reach === 'Global' ? BASE_COLORS_GLOBAL[base] : BASE_COLORS[base];
}

/**
 * Named labels for the 8 profiles.
 * Local: anchor, seed, close, texture
 * Global: foundation, foreshadow, ending, atmosphere
 */
const PROFILE_LABELS: Record<PropositionBaseCategory, { local: string; global: string }> = {
  Anchor: { local: 'anchor', global: 'foundation' },
  Seed: { local: 'seed', global: 'foreshadow' },
  Close: { local: 'close', global: 'ending' },
  Texture: { local: 'texture', global: 'atmosphere' },
};

/** Get the single-word display name for a classification */
export function classificationLabel(base: PropositionBaseCategory, reach: PropositionReach): string {
  return reach === 'Global' ? PROFILE_LABELS[base].global : PROFILE_LABELS[base].local;
}

/** Get all 8 profile label entries (for definitions, legends) */
export const ALL_PROFILE_LABELS: { base: PropositionBaseCategory; reach: PropositionReach; label: string; color: string }[] = [
  { base: 'Anchor', reach: 'Local', label: 'anchor', color: BASE_COLORS.Anchor },
  { base: 'Anchor', reach: 'Global', label: 'foundation', color: BASE_COLORS_GLOBAL.Anchor },
  { base: 'Seed', reach: 'Local', label: 'seed', color: BASE_COLORS.Seed },
  { base: 'Seed', reach: 'Global', label: 'foreshadow', color: BASE_COLORS_GLOBAL.Seed },
  { base: 'Close', reach: 'Local', label: 'close', color: BASE_COLORS.Close },
  { base: 'Close', reach: 'Global', label: 'ending', color: BASE_COLORS_GLOBAL.Close },
  { base: 'Texture', reach: 'Local', label: 'texture', color: BASE_COLORS.Texture },
  { base: 'Texture', reach: 'Global', label: 'atmosphere', color: BASE_COLORS_GLOBAL.Texture },
];

// ── Types ────────────────────────────────────────────────────────────────────

type PropEntry = {
  sceneId: string;
  sceneOrder: number;
  beatIndex: number;
  propIndex: number;
};

export type NarrativeClassification = {
  classifications: Map<string, PropositionClassification>;
  sceneProfiles: Map<string, Record<PropositionBaseCategory, number>>;
  thresholds: { backward: number; forward: number; reachScenes: number };
  computedAt: number;
};

export function propKey(sceneId: string, beatIndex: number, propIndex: number): string {
  return `${sceneId}:${beatIndex}:${propIndex}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  return percentile(arr, 0.5);
}

// ── Classification ──────────────────────────────────────────────────────────

export async function classifyPropositions(
  narrative: NarrativeState,
  resolvedKeys: string[],
): Promise<NarrativeClassification> {
  const t0 = performance.now();

  // 1. Extract propositions in timeline order
  const entries: PropEntry[] = [];
  let sceneOrder = 0;

  for (const key of resolvedKeys) {
    const entry = resolveEntry(narrative, key);
    if (!entry || !isScene(entry)) continue;
    const planVersions = entry.planVersions;
    if (!planVersions || planVersions.length === 0) { sceneOrder++; continue; }
    const plan = planVersions[planVersions.length - 1].plan;
    if (!plan?.beats) { sceneOrder++; continue; }

    for (let beatIdx = 0; beatIdx < plan.beats.length; beatIdx++) {
      const beat = plan.beats[beatIdx];
      if (!beat.propositions) continue;
      for (let propIdx = 0; propIdx < beat.propositions.length; propIdx++) {
        entries.push({ sceneId: entry.id, sceneOrder, beatIndex: beatIdx, propIndex: propIdx });
      }
    }
    sceneOrder++;
  }

  const n = entries.length;
  const totalScenes = sceneOrder;
  const reachThreshold = Math.max(REACH_MIN, Math.round(totalScenes * REACH_RATIO));

  if (n === 0) {
    return {
      classifications: new Map(),
      sceneProfiles: new Map(),
      thresholds: { backward: 0, forward: 0, reachScenes: reachThreshold },
      computedAt: Date.now(),
    };
  }

  // 2. Resolve embeddings in batch
  const embRefs = entries.map(entry => {
    const scene = narrative.scenes[entry.sceneId];
    const plan = scene.planVersions![scene.planVersions!.length - 1].plan;
    return plan.beats[entry.beatIndex].propositions![entry.propIndex].embedding;
  });

  const batchMap = await resolveEmbeddingsBatch(embRefs);
  const t1 = performance.now();
  console.log(`[PropClassify] Resolved ${n} embeddings in ${(t1 - t0).toFixed(0)}ms`);

  // 3. Build flat array and compute similarity matrix via TensorFlow.js
  const flat = new Float32Array(n * DIMS);
  const hasEmbedding = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const vec = batchMap.get(i);
    if (!vec || vec.length !== DIMS) continue;
    hasEmbedding[i] = 1;
    const offset = i * DIMS;
    for (let d = 0; d < DIMS; d++) flat[offset + d] = vec[d];
  }

  // tf.matMul on normalized matrix = full cosine similarity matrix
  // This is the direct equivalent of Python's `normed @ normed.T`
  // Using async data() instead of dataSync() to avoid blocking the main thread
  const tf = await import('@tensorflow/tfjs');
  let simData: Float32Array;
  {
    const mat = tf.tensor2d(flat, [n, DIMS]);
    const norms = mat.norm('euclidean', 1, true);
    const epsilon = tf.scalar(1e-8);
    const normed = mat.div(norms.add(epsilon));
    const sim = tf.matMul(normed, normed, false, true);
    simData = new Float32Array(await sim.data()); // async — non-blocking GPU→CPU transfer
    // Dispose tensors
    sim.dispose();
    normed.dispose();
    epsilon.dispose();
    norms.dispose();
    mat.dispose();
  }

  const t2 = performance.now();
  console.log(`[PropClassify] tf.matMul similarity matrix (${n}×${n}) in ${(t2 - t1).toFixed(0)}ms`);

  // 4. Extract top-k backward/forward from similarity matrix
  const sceneOrders = new Int32Array(entries.map(e => e.sceneOrder));
  const backward = new Float64Array(n);
  const forward = new Float64Array(n);
  const backReach = new Float64Array(n);
  const fwdReach = new Float64Array(n);

  // Reusable top-k buffers
  const topkSims = new Float64Array(TOP_K);
  const topkIdxs = new Int32Array(TOP_K);

  for (let i = 0; i < n; i++) {
    if (!hasEmbedding[i]) continue;
    const rowOffset = i * n;
    const sceneI = sceneOrders[i];

    for (let dir = 0; dir < 2; dir++) {
      const startJ = dir === 0 ? 0 : i + 1;
      const endJ = dir === 0 ? i : n;
      if (startJ >= endJ) continue;

      let filled = 0;
      let minIdx = 0;

      for (let j = startJ; j < endJ; j++) {
        if (!hasEmbedding[j]) continue;
        const sim = simData[rowOffset + j];

        if (filled < TOP_K) {
          topkSims[filled] = sim;
          topkIdxs[filled] = j;
          filled++;
          if (filled === TOP_K) {
            minIdx = 0;
            for (let m = 1; m < TOP_K; m++) {
              if (topkSims[m] < topkSims[minIdx]) minIdx = m;
            }
          }
        } else if (sim > topkSims[minIdx]) {
          topkSims[minIdx] = sim;
          topkIdxs[minIdx] = j;
          minIdx = 0;
          for (let m = 1; m < TOP_K; m++) {
            if (topkSims[m] < topkSims[minIdx]) minIdx = m;
          }
        }
      }

      if (filled === 0) continue;

      // Hybrid score: 0.5 * max + 0.5 * mean_topk
      let maxSim = topkSims[0];
      let sum = topkSims[0];
      for (let m = 1; m < filled; m++) {
        sum += topkSims[m];
        if (topkSims[m] > maxSim) maxSim = topkSims[m];
      }
      const strength = 0.5 * maxSim + 0.5 * (sum / filled);

      // Temporal reach: median scene distance of top-k
      const dists: number[] = [];
      for (let m = 0; m < filled; m++) {
        dists.push(Math.abs(sceneOrders[topkIdxs[m]] - sceneI));
      }
      dists.sort((a, b) => a - b);
      const reach = dists.length % 2 === 1
        ? dists[Math.floor(dists.length / 2)]
        : (dists[dists.length / 2 - 1] + dists[dists.length / 2]) / 2;

      if (dir === 0) { backward[i] = strength; backReach[i] = reach; }
      else { forward[i] = strength; fwdReach[i] = reach; }
    }
  }

  const t3 = performance.now();
  console.log(`[PropClassify] Top-k extraction in ${(t3 - t2).toFixed(0)}ms`);

  // 5. Thresholds
  const validBackward = Array.from(backward).filter((_, i) => i > 0 && backward[i] > 0);
  const validForward = Array.from(forward).filter((_, i) => i < n - 1 && forward[i] > 0);
  const thB = validBackward.length > 0 ? percentile(validBackward, STRENGTH_PERCENTILE) : 0;
  const thF = validForward.length > 0 ? percentile(validForward, STRENGTH_PERCENTILE) : 0;

  // 6. Classify
  const classifications = new Map<string, PropositionClassification>();
  const sceneProfiles = new Map<string, Record<PropositionBaseCategory, number>>();

  for (let i = 0; i < n; i++) {
    const entry = entries[i];
    const b = backward[i];
    const f = forward[i];

    const hiB = b >= thB;
    const hiF = f >= thF;
    let base: PropositionBaseCategory;
    if (hiB && hiF) base = 'Anchor';
    else if (!hiB && hiF) base = 'Seed';
    else if (hiB && !hiF) base = 'Close';
    else base = 'Texture';

    let reach: number;
    if (base === 'Anchor') reach = (backReach[i] + fwdReach[i]) / 2;
    else if (base === 'Seed') reach = fwdReach[i];
    else if (base === 'Close') reach = backReach[i];
    else reach = Math.max(backReach[i], fwdReach[i]);

    const reachLabel: PropositionReach = reach >= reachThreshold ? 'Global' : 'Local';

    classifications.set(propKey(entry.sceneId, entry.beatIndex, entry.propIndex), {
      base, reach: reachLabel,
      backward: b, forward: f,
      backReach: backReach[i], fwdReach: fwdReach[i],
    });

    if (!sceneProfiles.has(entry.sceneId)) {
      sceneProfiles.set(entry.sceneId, { Anchor: 0, Seed: 0, Close: 0, Texture: 0 });
    }
    sceneProfiles.get(entry.sceneId)![base]++;
  }

  const t4 = performance.now();
  console.log(`[PropClassify] ${n} propositions across ${totalScenes} scenes (reach threshold: ${reachThreshold}) in ${(t4 - t0).toFixed(0)}ms`);

  return {
    classifications,
    sceneProfiles,
    thresholds: { backward: thB, forward: thF, reachScenes: reachThreshold },
    computedAt: Date.now(),
  };
}
