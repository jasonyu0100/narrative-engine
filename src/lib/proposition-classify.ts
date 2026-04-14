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
import { logInfo } from '@/lib/system-logger';
import { resolveEntry, isScene } from '@/types/narrative';
import type {
  NarrativeState,
  PropositionBaseCategory,
  PropositionReach,
  PropositionClassification,
} from '@/types/narrative';

// ── Constants ────────────────────────────────────────────────────────────────

const TOP_K = 5;
/**
 * Absolute cosine-similarity threshold for the hybrid score (0.5*max + 0.5*mean_topk).
 * Benchmarked across 4 works (HP, Alice, AMI paper, QNF paper):
 *   Work medians range 0.548–0.639. Threshold at 0.65 sits just above all medians,
 *   producing Σ variance = 225 across works — good differentiation + diverse mix.
 *   HP: 29%A/17%S/17%C/38%T, Alice: 25%A/19%S/19%C/38%T,
 *   AMI: 14%A/16%S/17%C/53%T, QNF: 7%A/13%S/14%C/67%T.
 */
const STRENGTH_THRESHOLD = 0.65;
/** Global reach = connections spanning >25% of total scenes (min 5) */
const REACH_RATIO = 0.25;
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

/** A connection from one proposition to another */
export type PropConnection = {
  key: string;           // propKey of the connected proposition
  sceneId: string;
  beatIndex: number;
  propIndex: number;
  similarity: number;    // raw cosine similarity
  sceneDist: number;     // scene distance (positive = forward, negative = backward)
};

export type NarrativeClassification = {
  classifications: Map<string, PropositionClassification>;
  /** Top-k backward + forward connections per proposition, sorted by recency (closest first) */
  connections: Map<string, { backward: PropConnection[]; forward: PropConnection[] }>;
  sceneProfiles: Map<string, Record<PropositionBaseCategory, number>>;
  thresholds: { backward: number; forward: number; reachScenes: number };
  computedAt: number;
};

export function propKey(sceneId: string, beatIndex: number, propIndex: number): string {
  return `${sceneId}:${beatIndex}:${propIndex}`;
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
      connections: new Map(),
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
  logInfo(`Resolved proposition embeddings`, {
    source: 'embedding',
    operation: 'proposition-classify-resolve',
    details: { count: n, durationMs: Math.round(t1 - t0) },
  });

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
  logInfo(`Computed proposition similarity matrix`, {
    source: 'embedding',
    operation: 'proposition-classify-matmul',
    details: { size: n, durationMs: Math.round(t2 - t1) },
  });

  // 4. Extract top-k backward/forward from similarity matrix
  const sceneOrders = new Int32Array(entries.map(e => e.sceneOrder));
  const backward = new Float64Array(n);
  const forward = new Float64Array(n);
  const backReach = new Float64Array(n);
  const fwdReach = new Float64Array(n);

  // Reusable top-k buffers
  const topkSims = new Float64Array(TOP_K);
  const topkIdxs = new Int32Array(TOP_K);

  // Store raw top-k connections per proposition per direction
  const backConns: PropConnection[][] = new Array(n);
  const fwdConns: PropConnection[][] = new Array(n);

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

      // Build connection list sorted by recency (closest scene first)
      const conns: PropConnection[] = [];
      for (let m = 0; m < filled; m++) {
        const j = topkIdxs[m];
        const e = entries[j];
        conns.push({
          key: propKey(e.sceneId, e.beatIndex, e.propIndex),
          sceneId: e.sceneId,
          beatIndex: e.beatIndex,
          propIndex: e.propIndex,
          similarity: topkSims[m],
          sceneDist: sceneOrders[j] - sceneI,
        });
      }
      // Sort by recency: smallest absolute scene distance first
      conns.sort((a, b) => Math.abs(a.sceneDist) - Math.abs(b.sceneDist));

      if (dir === 0) { backward[i] = strength; backReach[i] = reach; backConns[i] = conns; }
      else { forward[i] = strength; fwdReach[i] = reach; fwdConns[i] = conns; }
    }
  }

  const t3 = performance.now();
  logInfo(`Extracted proposition top-k connections`, {
    source: 'embedding',
    operation: 'proposition-classify-topk',
    details: { count: n, durationMs: Math.round(t3 - t2) },
  });

  // 5. Absolute threshold — benchmarked across fiction + academic works
  const thB = STRENGTH_THRESHOLD;
  const thF = STRENGTH_THRESHOLD;

  // 6. Classify + build connections map
  const classifications = new Map<string, PropositionClassification>();
  const connections = new Map<string, { backward: PropConnection[]; forward: PropConnection[] }>();
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

    const key = propKey(entry.sceneId, entry.beatIndex, entry.propIndex);
    classifications.set(key, {
      base, reach: reachLabel,
      backward: b, forward: f,
      backReach: backReach[i], fwdReach: fwdReach[i],
    });

    connections.set(key, {
      backward: backConns[i] ?? [],
      forward: fwdConns[i] ?? [],
    });

    if (!sceneProfiles.has(entry.sceneId)) {
      sceneProfiles.set(entry.sceneId, { Anchor: 0, Seed: 0, Close: 0, Texture: 0 });
    }
    sceneProfiles.get(entry.sceneId)![base]++;
  }

  const t4 = performance.now();
  logInfo(`Classified propositions`, {
    source: 'embedding',
    operation: 'proposition-classify-complete',
    details: {
      propositions: n,
      scenes: totalScenes,
      reachThreshold,
      totalMs: Math.round(t4 - t0),
    },
  });

  return {
    classifications,
    connections,
    sceneProfiles,
    thresholds: { backward: thB, forward: thF, reachScenes: reachThreshold },
    computedAt: Date.now(),
  };
}
