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
import { callGenerate, SYSTEM_PROMPT } from '@/lib/ai/api';
import { parseJson } from '@/lib/ai/json';

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

// ── Preset Matrices ──────────────────────────────────────────────────────────
// Derived from structural analysis of published works in public/works/.

export type MatrixPreset = {
  key: string;
  name: string;
  description: string;
  matrix: TransitionMatrix;
};

const HP_MATRIX: TransitionMatrix = {
  'HHH': { 'HHH': 0.077, 'HHL': 0.0, 'HLH': 0.154, 'HLL': 0.154, 'LHH': 0.0, 'LHL': 0.154, 'LLH': 0.308, 'LLL': 0.154 },
  'HHL': { 'HHH': 0.091, 'HHL': 0.091, 'HLH': 0.182, 'HLL': 0.0, 'LHH': 0.091, 'LHL': 0.0, 'LLH': 0.364, 'LLL': 0.182 },
  'HLH': { 'HHH': 0.111, 'HHL': 0.111, 'HLH': 0.0, 'HLL': 0.0, 'LHH': 0.111, 'LHL': 0.333, 'LLH': 0.111, 'LLL': 0.222 },
  'HLL': { 'HHH': 0.286, 'HHL': 0.143, 'HLH': 0.143, 'HLL': 0.143, 'LHH': 0.0, 'LHL': 0.0, 'LLH': 0.0, 'LLL': 0.286 },
  'LHH': { 'HHH': 0.667, 'HHL': 0.333, 'HLH': 0.0, 'HLL': 0.0, 'LHH': 0.0, 'LHL': 0.0, 'LLH': 0.0, 'LLL': 0.0 },
  'LHL': { 'HHH': 0.111, 'HHL': 0.0, 'HLH': 0.111, 'HLL': 0.0, 'LHH': 0.0, 'LHL': 0.222, 'LLH': 0.111, 'LLL': 0.444 },
  'LLH': { 'HHH': 0.105, 'HHL': 0.211, 'HLH': 0.0, 'HLL': 0.053, 'LHH': 0.053, 'LHL': 0.158, 'LLH': 0.211, 'LLL': 0.211 },
  'LLL': { 'HHH': 0.105, 'HHL': 0.158, 'HLH': 0.158, 'HLL': 0.158, 'LHH': 0.0, 'LHL': 0.0, 'LLH': 0.263, 'LLL': 0.158 },
};

const NINETEEN84_MATRIX: TransitionMatrix = {
  'HHH': { 'HHH': 0.111, 'HHL': 0.0, 'HLH': 0.111, 'HLL': 0.111, 'LHH': 0.111, 'LHL': 0.222, 'LLH': 0.222, 'LLL': 0.111 },
  'HHL': { 'HHH': 0.167, 'HHL': 0.0, 'HLH': 0.0, 'HLL': 0.333, 'LHH': 0.167, 'LHL': 0.0, 'LLH': 0.0, 'LLL': 0.333 },
  'HLH': { 'HHH': 0.0, 'HHL': 0.0, 'HLH': 0.0, 'HLL': 0.333, 'LHH': 0.667, 'LHL': 0.0, 'LLH': 0.0, 'LLL': 0.0 },
  'HLL': { 'HHH': 0.125, 'HHL': 0.125, 'HLH': 0.0, 'HLL': 0.0, 'LHH': 0.125, 'LHL': 0.0, 'LLH': 0.125, 'LLL': 0.5 },
  'LHH': { 'HHH': 0.0, 'HHL': 0.091, 'HLH': 0.0, 'HLL': 0.0, 'LHH': 0.091, 'LHL': 0.273, 'LLH': 0.091, 'LLL': 0.455 },
  'LHL': { 'HHH': 0.125, 'HHL': 0.25, 'HLH': 0.0, 'HLL': 0.125, 'LHH': 0.0, 'LHL': 0.125, 'LLH': 0.25, 'LLL': 0.125 },
  'LLH': { 'HHH': 0.167, 'HHL': 0.0, 'HLH': 0.0, 'HLL': 0.0, 'LHH': 0.167, 'LHL': 0.0, 'LLH': 0.0, 'LLL': 0.667 },
  'LLL': { 'HHH': 0.174, 'HHL': 0.087, 'HLH': 0.043, 'HLL': 0.13, 'LHH': 0.174, 'LHL': 0.087, 'LLH': 0.043, 'LLL': 0.261 },
};

const GATSBY_MATRIX: TransitionMatrix = {
  'HHH': { 'HHH': 0.182, 'HHL': 0.0, 'HLH': 0.0, 'HLL': 0.0, 'LHH': 0.182, 'LHL': 0.091, 'LLH': 0.182, 'LLL': 0.364 },
  'HHL': { 'HHH': 1.0, 'HHL': 0.0, 'HLH': 0.0, 'HLL': 0.0, 'LHH': 0.0, 'LHL': 0.0, 'LLH': 0.0, 'LLL': 0.0 },
  'HLH': { 'HHH': 0.0, 'HHL': 0.0, 'HLH': 0.333, 'HLL': 0.333, 'LHH': 0.0, 'LHL': 0.333, 'LLH': 0.0, 'LLL': 0.0 },
  'HLL': { 'HHH': 0.0, 'HHL': 0.25, 'HLH': 0.0, 'HLL': 0.25, 'LHH': 0.0, 'LHL': 0.0, 'LLH': 0.0, 'LLL': 0.5 },
  'LHH': { 'HHH': 0.2, 'HHL': 0.0, 'HLH': 0.0, 'HLL': 0.0, 'LHH': 0.2, 'LHL': 0.0, 'LLH': 0.0, 'LLL': 0.6 },
  'LHL': { 'HHH': 0.333, 'HHL': 0.0, 'HLH': 0.0, 'HLL': 0.667, 'LHH': 0.0, 'LHL': 0.0, 'LLH': 0.0, 'LLL': 0.0 },
  'LLH': { 'HHH': 0.5, 'HHL': 0.0, 'HLH': 0.5, 'HLL': 0.0, 'LHH': 0.0, 'LHL': 0.0, 'LLH': 0.0, 'LLL': 0.0 },
  'LLL': { 'HHH': 0.357, 'HHL': 0.071, 'HLH': 0.071, 'HLL': 0.0, 'LHH': 0.071, 'LHL': 0.071, 'LLH': 0.0, 'LLL': 0.357 },
};

const ALICE_MATRIX: TransitionMatrix = {
  'HHH': { 'HHH': 0.25, 'HHL': 0.25, 'HLH': 0.0, 'HLL': 0.0, 'LHH': 0.25, 'LHL': 0.25, 'LLH': 0.0, 'LLL': 0.0 },
  'HHL': { 'HHH': 0.0, 'HHL': 0.0, 'HLH': 0.0, 'HLL': 0.0, 'LHH': 0.0, 'LHL': 0.0, 'LLH': 0.0, 'LLL': 1.0 },
  'HLH': { 'HHH': 0.0, 'HHL': 0.0, 'HLH': 0.0, 'HLL': 1.0, 'LHH': 0.0, 'LHL': 0.0, 'LLH': 0.0, 'LLL': 0.0 },
  'HLL': { 'HHH': 0.5, 'HHL': 0.5, 'HLH': 0.0, 'HLL': 0.0, 'LHH': 0.0, 'LHL': 0.0, 'LLH': 0.0, 'LLL': 0.0 },
  'LHH': { 'HHH': 0.0, 'HHL': 0.0, 'HLH': 0.0, 'HLL': 0.0, 'LHH': 0.0, 'LHL': 0.0, 'LLH': 0.0, 'LLL': 1.0 },
  'LHL': { 'HHH': 0.333, 'HHL': 0.0, 'HLH': 0.333, 'HLL': 0.0, 'LHH': 0.0, 'LHL': 0.0, 'LLH': 0.0, 'LLL': 0.333 },
  'LLH': { 'HHH': 0.0, 'HHL': 0.0, 'HLH': 0.0, 'HLL': 0.0, 'LHH': 0.0, 'LHL': 0.0, 'LLH': 0.0, 'LLL': 1.0 },
  'LLL': { 'HHH': 0.167, 'HHL': 0.0, 'HLH': 0.0, 'HLL': 0.167, 'LHH': 0.0, 'LHL': 0.167, 'LLH': 0.167, 'LLL': 0.333 },
};

export const MATRIX_PRESETS: MatrixPreset[] = [
  {
    key: 'harry_potter',
    name: 'Harry Potter',
    description: 'Balanced explorer — high variety, low self-loops, buildup-heavy (57%). Wide range of modes with Lore↔Rest oscillation.',
    matrix: HP_MATRIX,
  },
  {
    key: 'nineteen_eighty_four',
    name: '1984',
    description: 'Pressure cooker — buildup-dominant (66%), long dwelling in Rest/Growth then sudden Epoch eruptions.',
    matrix: NINETEEN84_MATRIX,
  },
  {
    key: 'great_gatsby',
    name: 'Great Gatsby',
    description: 'Pendulum — oscillates between Rest and Epoch. Strong self-loops (23%). Bipolar intensity.',
    matrix: GATSBY_MATRIX,
  },
  {
    key: 'alice',
    name: 'Alice in Wonderland',
    description: 'Episodic — spike-and-reset pattern. Climax always resets to Rest. Each episode is self-contained.',
    matrix: ALICE_MATRIX,
  },
];

/** Default matrix — Harry Potter (most balanced, best general-purpose). */
export const DEFAULT_TRANSITION_MATRIX: TransitionMatrix = HP_MATRIX;

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

// ── AI-Optimized Sequence ────────────────────────────────────────────────────

/**
 * Ask an LLM to pick the optimal mode sequence given the user's direction
 * and the transition matrix probabilities. The LLM sees the available
 * transitions from each state and picks the path that best serves the
 * creative direction while respecting the matrix's structural patterns.
 */
export async function optimizeSequence(
  startMode: CubeCornerKey,
  length: number,
  direction: string,
  matrix: TransitionMatrix = DEFAULT_TRANSITION_MATRIX,
): Promise<PacingSequence> {
  const modeNames: Record<CubeCornerKey, string> = {} as Record<CubeCornerKey, string>;
  for (const c of CORNERS) modeNames[c] = NARRATIVE_CUBE[c].name;

  // Build a readable transition table for the LLM
  const transitionDesc = CORNERS.map((from) => {
    const row = matrix[from];
    const options = CORNERS
      .filter((to) => (row[to] ?? 0) > 0.01)
      .map((to) => `${modeNames[to]} (${Math.round((row[to] ?? 0) * 100)}%)`)
      .join(', ');
    return `From ${modeNames[from]}: ${options || 'no transitions'}`;
  }).join('\n');

  const prompt = `You are selecting a pacing sequence for a narrative arc. The story is currently in "${modeNames[startMode]}" mode.

DIRECTION: ${direction}

The 8 narrative modes and what they mean:
${CORNERS.map((c) => `- ${modeNames[c]} (${c}): ${NARRATIVE_CUBE[c].description}`).join('\n')}

Available transitions (probabilities from the story's rhythm profile):
${transitionDesc}

Select exactly ${length} modes that best serve the DIRECTION above while following natural transition paths. Consider:
- Which modes build toward the direction's intent?
- Where should the peak scene(s) land?
- How much buildup is needed before payoff?
- The sequence should feel like a natural story rhythm, not random.

Return JSON: {"sequence": ["${CORNERS[0]}", ...]} — an array of exactly ${length} cube corner keys.`;

  try {
    const raw = await callGenerate(prompt, SYSTEM_PROMPT, 1000, 'optimizeSequence');
    const parsed = parseJson(raw, 'optimizeSequence') as { sequence: string[] };

    if (Array.isArray(parsed.sequence) && parsed.sequence.length === length) {
      const validModes = new Set<string>(CORNERS);
      const modes = parsed.sequence
        .map((s) => (validModes.has(s) ? s : null) as CubeCornerKey | null)
        .filter((m): m is CubeCornerKey => m !== null);

      if (modes.length === length) {
        const steps: ModeStep[] = modes.map((mode) => ({
          mode,
          name: NARRATIVE_CUBE[mode].name,
          description: NARRATIVE_CUBE[mode].description,
          forces: FORCE_TARGETS[mode],
        }));
        return { steps, pacingDescription: buildPacingDescription(steps) };
      }
    }
  } catch (err) {
    console.warn('[optimizeSequence] LLM call failed, falling back to random sample:', err);
  }

  // Fallback to random sampling
  return samplePacingSequence(startMode, length, matrix);
}
