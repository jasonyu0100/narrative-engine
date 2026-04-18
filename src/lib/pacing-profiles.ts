/**
 * Pacing profile system — transition matrices for narrative pacing.
 *
 * Mirrors the beat profile system in beat-profiles.ts:
 *   - A single built-in default (Storyteller)
 *   - Work-derived presets populated at runtime via initPacingPresets()
 *   - A "self" option computed on-the-fly from the current narrative
 *
 * TransitionMatrix maps cube corner → cube corner transition probabilities.
 * MatrixPreset bundles a matrix with display metadata.
 */

import type { CubeCornerKey, NarrativeState, Scene } from '@/types/narrative';
import { resolveEntry } from '@/types/narrative';
import { computeRawForceTotals, zScoreNormalize, resolveEntrySequence, detectCubeCorner } from '@/lib/narrative-utils';

// ── Types ───────────────────────────────────────────────────────────────────

export type TransitionMatrix = Record<CubeCornerKey, Record<CubeCornerKey, number>>;

export type MatrixPreset = {
  key: string;
  name: string;
  description: string;
  matrix: TransitionMatrix;
};

// ── Constants ───────────────────────────────────────────────────────────────

const CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];

// ── Matrix Helpers ──────────────────────────────────────────────────────────

export function emptyMatrix(): TransitionMatrix {
  const m = {} as TransitionMatrix;
  for (const from of CORNERS) {
    m[from] = {} as Record<CubeCornerKey, number>;
    for (const to of CORNERS) m[from][to] = 0;
  }
  return m;
}

// ── Compute Matrix from Narrative ───────────────────────────────────────────

/** Compute a transition matrix from a NarrativeState using the canon (root) branch. */
export function computeMatrixFromNarrative(narrative: NarrativeState): TransitionMatrix {
  const rootBranch = Object.values(narrative.branches).find((b) => b.parentBranchId === null);
  const keys = rootBranch
    ? resolveEntrySequence(narrative.branches, rootBranch.id)
    : Object.keys(narrative.scenes);

  const scenes = keys
    .map((k) => resolveEntry(narrative, k))
    .filter((e): e is Scene => !!e && e.kind === 'scene');

  if (scenes.length < 3) return emptyMatrix();

  const raw = computeRawForceTotals(scenes);
  const np = zScoreNormalize(raw.payoff);
  const nc = zScoreNormalize(raw.change);
  const nk = zScoreNormalize(raw.knowledge);

  const sequence: CubeCornerKey[] = scenes.map((_, i) =>
    detectCubeCorner({ payoff: np[i], change: nc[i], knowledge: nk[i] }).key
  );

  const counts = emptyMatrix();
  for (let i = 0; i < sequence.length - 1; i++) {
    counts[sequence[i]][sequence[i + 1]]++;
  }

  // Normalize rows
  for (const from of CORNERS) {
    const total = CORNERS.reduce((s, to) => s + counts[from][to], 0);
    if (total > 0) {
      for (const to of CORNERS) {
        counts[from][to] = Math.round((counts[from][to] / total) * 1000) / 1000;
      }
    }
  }

  return counts;
}

// ── Default Matrix ──────────────────────────────────────────────────────────

/**
 * Hand-tuned "Storyteller" matrix — designed from narrative principles rather
 * than derived from any single work. Encodes:
 *
 *  1. Escalation ladder: Rest → Lore/Growth → Discovery → Climax/Revelation → Epoch
 *  2. Recovery after peaks: Epoch/Climax always descend to Rest/Closure/Growth
 *  3. Growth as hub: most modes reach Growth, Growth feeds into payoff
 *  4. Lore feeds Discovery: world-building leads to exploration
 *  5. No back-to-back Epoch; low self-loops throughout
 *  6. ~35% payoff-mode steady state — earned, not inflated
 */
const STORYTELLER_MATRIX: TransitionMatrix = (() => {
  const m = emptyMatrix();
  m.HHH = { HHH: 0,    HHL: 0.05, HLH: 0.05, HLL: 0.25, LHH: 0.05, LHL: 0.20, LLH: 0.10, LLL: 0.30 };
  m.HHL = { HHH: 0.05, HHL: 0.05, HLH: 0.05, HLL: 0.20, LHH: 0.10, LHL: 0.20, LLH: 0.10, LLL: 0.25 };
  m.HLH = { HHH: 0.05, HHL: 0.20, HLH: 0.05, HLL: 0.10, LHH: 0.20, LHL: 0.25, LLH: 0.05, LLL: 0.10 };
  m.HLL = { HHH: 0,    HHL: 0.05, HLH: 0,    HLL: 0.05, LHH: 0.15, LHL: 0.25, LLH: 0.25, LLL: 0.25 };
  m.LHH = { HHH: 0.10, HHL: 0.20, HLH: 0.15, HLL: 0,    LHH: 0.10, LHL: 0.20, LLH: 0.15, LLL: 0.10 };
  m.LHL = { HHH: 0.05, HHL: 0.20, HLH: 0.10, HLL: 0,    LHH: 0.20, LHL: 0.15, LLH: 0.15, LLL: 0.15 };
  m.LLH = { HHH: 0.05, HHL: 0.05, HLH: 0.15, HLL: 0,    LHH: 0.25, LHL: 0.20, LLH: 0.15, LLL: 0.15 };
  m.LLL = { HHH: 0,    HHL: 0,    HLH: 0.05, HLL: 0.10, LHH: 0.15, LHL: 0.30, LLH: 0.30, LLL: 0.10 };
  return m;
})();

const STORYTELLER_PRESET: MatrixPreset = {
  key: 'storyteller',
  name: 'Storyteller',
  description: 'Hand-tuned for strong pacing. Escalation ladders, earned payoffs, recovery after peaks.',
  matrix: STORYTELLER_MATRIX,
};

// ── Preset Management ───────────────────────────────────────────────────────

/** Mutable preset list — populated at runtime from analysed works. */
export let PACING_MATRIX_PRESETS: MatrixPreset[] = [];

/** Default matrix — Storyteller is the built-in default. */
export let DEFAULT_TRANSITION_MATRIX: TransitionMatrix = STORYTELLER_MATRIX;

/** Populate presets from loaded work narratives. Called once during hydration. */
export function initPacingPresets(works: { key: string; name: string; narrative: NarrativeState }[]) {
  const presets: MatrixPreset[] = [STORYTELLER_PRESET];

  for (const work of works) {
    const matrix = computeMatrixFromNarrative(work.narrative);
    const totalTransitions = CORNERS.reduce((s, from) =>
      s + CORNERS.reduce((s2, to) => s2 + matrix[from][to], 0), 0);
    if (totalTransitions < 0.5) continue;

    // Auto-generate description from matrix properties
    const payoffFrac = CORNERS.filter((c) => c[0] === 'H')
      .reduce((s, c) => {
        let w = 0;
        for (const from of CORNERS) w += matrix[from][c];
        return s + w;
      }, 0);
    const totalWeight = CORNERS.reduce((s, c) => {
      let w = 0;
      for (const from of CORNERS) w += matrix[from][c];
      return s + w;
    }, 0);
    const payoffPct = totalWeight > 0 ? Math.round((payoffFrac / totalWeight) * 100) : 50;

    presets.push({
      key: work.key,
      name: work.name,
      description: `${payoffPct}% payoff modes. Computed from ${work.name}.`,
      matrix,
    });
  }

  PACING_MATRIX_PRESETS = presets;
  DEFAULT_TRANSITION_MATRIX = STORYTELLER_MATRIX;
  return presets;
}
