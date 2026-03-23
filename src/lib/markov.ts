/**
 * Markov chain sequence generation for narrative pacing.
 *
 * Samples a sequence of cube corner modes from a transition matrix,
 * producing a pacing plan for an arc before scene generation begins.
 * The default matrix is derived from Harry Potter and the Sorcerer's Stone.
 */

import type { CubeCornerKey, NarrativeState, Scene } from '@/types/narrative';
import { NARRATIVE_CUBE, resolveEntry } from '@/types/narrative';
import { computeForceSnapshots, detectCubeCorner } from '@/lib/narrative-utils';

// ── Types ────────────────────────────────────────────────────────────────────

export type TransitionMatrix = Record<CubeCornerKey, Record<CubeCornerKey, number>>;

export type ModeStep = {
  mode: CubeCornerKey;
  name: string;
  description: string;
  /** Target force ranges derived from the cube corner */
  forces: {
    payoff: [number, number];
    change: [number, number];
    knowledge: [number, number];
  };
};

export type PacingSequence = {
  steps: ModeStep[];
  /** Human-readable pacing description for the prompt */
  pacingDescription: string;
};

// ── Constants ────────────────────────────────────────────────────────────────

const CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];

// ── Matrix Computation ───────────────────────────────────────────────────────

import { computeRawForcetotals, zScoreNormalize, resolveSceneSequence } from '@/lib/narrative-utils';

/** Compute a transition matrix from a NarrativeState using the canon (root) branch. */
export function computeMatrixFromNarrative(narrative: NarrativeState): TransitionMatrix {
  // Find root branch
  const rootBranch = Object.values(narrative.branches).find((b) => b.parentBranchId === null);
  const keys = rootBranch
    ? resolveSceneSequence(narrative.branches, rootBranch.id)
    : Object.keys(narrative.scenes);

  const scenes = keys
    .map((k) => resolveEntry(narrative, k))
    .filter((e): e is Scene => !!e && e.kind === 'scene');

  if (scenes.length < 3) return emptyMatrix();

  const raw = computeRawForcetotals(scenes);
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

function emptyMatrix(): TransitionMatrix {
  const m = {} as TransitionMatrix;
  for (const from of CORNERS) {
    m[from] = {} as Record<CubeCornerKey, number>;
    for (const to of CORNERS) m[from][to] = 0;
  }
  return m;
}

// ── Preset Matrices ──────────────────────────────────────────────────────────

export type MatrixPreset = {
  key: string;
  name: string;
  description: string;
  matrix: TransitionMatrix;
};

/** Mutable preset list — populated at runtime from analysed works. */
export let MATRIX_PRESETS: MatrixPreset[] = [];

/** Default matrix — HP is the fallback until presets are loaded. */
export let DEFAULT_TRANSITION_MATRIX: TransitionMatrix = emptyMatrix();

/** Populate presets from loaded work narratives. Called once during hydration. */
export function initMatrixPresets(works: { key: string; name: string; narrative: NarrativeState }[]) {
  const presets: MatrixPreset[] = [];

  for (const work of works) {
    const matrix = computeMatrixFromNarrative(work.narrative);
    // Check it has enough data (at least some non-zero transitions)
    const totalTransitions = CORNERS.reduce((s, from) =>
      s + CORNERS.reduce((s2, to) => s2 + matrix[from][to], 0), 0);
    if (totalTransitions < 0.5) continue; // empty matrix, skip

    // Auto-generate description from matrix properties
    const payoffFrac = CORNERS.filter((c) => c[0] === 'H')
      .reduce((s, c) => {
        // sum stationary-ish weight
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

    let selfLoops = 0;
    let totalRows = 0;
    for (const c of CORNERS) {
      if (matrix[c][c] > 0) { selfLoops += matrix[c][c]; totalRows++; }
      else totalRows++;
    }

    presets.push({
      key: work.key,
      name: work.name,
      description: `${payoffPct}% payoff modes. Computed from ${work.name}.`,
      matrix,
    });
  }

  MATRIX_PRESETS = presets;

  // Set default to first preset (usually HP based on alphabetical loading order)
  // Prefer harry_potter if available
  const hp = presets.find((p) => p.key.includes('harry_potter'));
  DEFAULT_TRANSITION_MATRIX = hp?.matrix ?? presets[0]?.matrix ?? emptyMatrix();
}

/**
 * Force target ranges per cube corner.
 * High = above reference mean, Low = below or near zero.
 * Ranges are [min, max] raw force values to guide generation.
 */
const FORCE_TARGETS: Record<CubeCornerKey, { payoff: [number, number]; change: [number, number]; knowledge: [number, number] }> = {
  // Epoch: everything high
  'HHH': { payoff: [2, 6], change: [4, 8], knowledge: [3, 7] },
  // Climax: high payoff + change, low knowledge
  'HHL': { payoff: [2, 6], change: [4, 8], knowledge: [0, 1.5] },
  // Revelation: high payoff + knowledge, low change
  'HLH': { payoff: [2, 5], change: [0, 2], knowledge: [3, 7] },
  // Closure: high payoff, low change + knowledge
  'HLL': { payoff: [2, 5], change: [0, 2], knowledge: [0, 1.5] },
  // Discovery: high change + knowledge, low payoff
  'LHH': { payoff: [0, 1], change: [3, 7], knowledge: [3, 6] },
  // Growth: high change, low payoff + knowledge
  'LHL': { payoff: [0, 1], change: [3, 7], knowledge: [0, 1.5] },
  // Lore: high knowledge, low payoff + change
  'LLH': { payoff: [0, 1], change: [0, 2], knowledge: [3, 7] },
  // Rest: everything low
  'LLL': { payoff: [0, 1], change: [0, 2], knowledge: [0, 1.5] },
};

// ── Sampling ─────────────────────────────────────────────────────────────────

/** Sample the next mode from a transition matrix row using weighted random. */
function sampleNext(matrix: TransitionMatrix, current: CubeCornerKey): CubeCornerKey {
  const row = matrix[current];
  const r = Math.random();
  let cumulative = 0;
  for (const corner of CORNERS) {
    cumulative += row[corner] ?? 0;
    if (r < cumulative) return corner;
  }
  // Fallback (rounding error) — return last non-zero
  return CORNERS.find((c) => (row[c] ?? 0) > 0) ?? 'LLL';
}

/**
 * Generate a pacing sequence by sampling the Markov chain.
 *
 * @param startMode - Current mode of the story (last scene's cube corner)
 * @param length - Number of scenes to plan
 * @param matrix - Transition matrix to sample from (defaults to HP matrix)
 */
export function samplePacingSequence(
  startMode: CubeCornerKey,
  length: number,
  matrix: TransitionMatrix = DEFAULT_TRANSITION_MATRIX,
): PacingSequence {
  const modes: CubeCornerKey[] = [];
  let current = startMode;

  for (let i = 0; i < length; i++) {
    const next = sampleNext(matrix, current);
    modes.push(next);
    current = next;
  }

  const steps: ModeStep[] = modes.map((mode) => ({
    mode,
    name: NARRATIVE_CUBE[mode].name,
    description: NARRATIVE_CUBE[mode].description,
    forces: FORCE_TARGETS[mode],
  }));

  const pacingDescription = buildPacingDescription(steps);

  return { steps, pacingDescription };
}

// ── Pacing Description ───────────────────────────────────────────────────────

function buildPacingDescription(steps: ModeStep[]): string {
  const total = steps.length;
  const payoffCount = steps.filter((s) => s.mode[0] === 'H').length;
  const buildupCount = total - payoffCount;
  const payoffPct = Math.round((payoffCount / total) * 100);

  // Find the peak scene (highest force targets)
  const peakIdx = steps.reduce((best, s, i) => {
    const intensity = s.forces.payoff[1] + s.forces.change[1] + s.forces.knowledge[1];
    const bestIntensity = steps[best].forces.payoff[1] + steps[best].forces.change[1] + steps[best].forces.knowledge[1];
    return intensity > bestIntensity ? i : best;
  }, 0);

  const lines: string[] = [];
  lines.push(`${total}-scene arc: ${buildupCount} buildup, ${payoffCount} payoff (${payoffPct}% payoff).`);

  // Describe the shape
  const modeNames = steps.map((s) => s.name);
  lines.push(`Sequence: ${modeNames.join(' → ')}.`);

  if (peakIdx === 0) {
    lines.push('Opens with the peak — front-loaded intensity, followed by processing.');
  } else if (peakIdx === total - 1) {
    lines.push('Builds toward a peak at the end — escalating arc.');
  } else {
    lines.push(`Peak at scene ${peakIdx + 1} (${steps[peakIdx].name}) — buildup before, processing after.`);
  }

  return lines.join(' ');
}

// ── Current Mode Detection ───────────────────────────────────────────────────

/** Detect the current narrative mode from the last scene on the branch. */
export function detectCurrentMode(
  narrative: NarrativeState,
  resolvedKeys: string[],
): CubeCornerKey {
  const allScenes = resolvedKeys
    .map((k) => resolveEntry(narrative, k))
    .filter((e): e is Scene => !!e && e.kind === 'scene');
  if (allScenes.length === 0) return 'LLL'; // default Rest for new stories
  const snapshots = computeForceSnapshots(allScenes);
  const lastScene = allScenes[allScenes.length - 1];
  const lastForces = snapshots[lastScene.id];
  if (!lastForces) return 'LLL';
  return detectCubeCorner(lastForces).key;
}

// ── Prompt Generation ────────────────────────────────────────────────────────

/**
 * Build the per-scene pacing prompt block from a sequence.
 * This replaces the old cube goal and delivery direction prompts.
 */
export function buildSequencePrompt(sequence: PacingSequence): string {
  const lines: string[] = [];

  lines.push(`PACING SEQUENCE (${sequence.pacingDescription})`);
  lines.push('');
  lines.push('Each scene in this arc has a specific narrative mode assignment. The mode determines the scene\'s force profile — which forces should be HIGH and which should be LOW. Follow these assignments:');
  lines.push('');

  for (let i = 0; i < sequence.steps.length; i++) {
    const step = sequence.steps[i];
    const cube = NARRATIVE_CUBE[step.mode];
    const p = step.mode[0] === 'H' ? 'HIGH' : 'LOW';
    const c = step.mode[1] === 'H' ? 'HIGH' : 'LOW';
    const k = step.mode[2] === 'H' ? 'HIGH' : 'LOW';

    lines.push(`SCENE ${i + 1} — ${cube.name} (Payoff: ${p}, Change: ${c}, Knowledge: ${k})`);
    lines.push(`  ${cube.description}`);
    lines.push(`  Target ranges: Payoff ${step.forces.payoff[0]}–${step.forces.payoff[1]}, Change ${step.forces.change[0]}–${step.forces.change[1]}, Knowledge ${step.forces.knowledge[0]}–${step.forces.knowledge[1]}`);

    // Add specific behavioral guidance per mode
    if (step.mode[0] === 'L') {
      lines.push('  This is a BUILDUP scene — do NOT advance threads to terminal statuses. Pulses and minor transitions only. Focus on the HIGH dimensions.');
    }
    if (step.mode === 'LLL') {
      lines.push('  REST scene — minimal mutations. Characters reflect, observe, exist in the world. Atmosphere over action.');
    }

    lines.push('');
  }

  lines.push('CRITICAL: Scene force profiles MUST match their assignments. A scene assigned REST cannot have 4 thread transitions. A scene assigned EPOCH should be the densest in the arc. This variation creates the peaks and valleys that make a story breathe.');

  return lines.join('\n');
}

