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

import { computeRawForceTotals, zScoreNormalize, resolveEntrySequence } from '@/lib/narrative-utils';

/** Compute a transition matrix from a NarrativeState using the canon (root) branch. */
export function computeMatrixFromNarrative(narrative: NarrativeState): TransitionMatrix {
  // Find root branch
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
  //              HHH   HHL   HLH   HLL   LHH   LHL   LLH   LLL
  // From Epoch — everything just converged, must recover
  m.HHH = { HHH: 0,    HHL: 0.05, HLH: 0.05, HLL: 0.25, LHH: 0.05, LHL: 0.20, LLH: 0.10, LLL: 0.30 };
  // From Climax — threads resolved, characters need to breathe
  m.HHL = { HHH: 0.05, HHL: 0.05, HLH: 0.05, HLL: 0.20, LHH: 0.10, LHL: 0.20, LLH: 0.10, LLL: 0.25 };
  // From Revelation — truth unlocked, characters must grapple with it
  m.HLH = { HHH: 0.05, HHL: 0.20, HLH: 0.05, HLL: 0.10, LHH: 0.20, LHL: 0.25, LLH: 0.05, LLL: 0.10 };
  // From Closure — loose ends tied, new chapter begins
  m.HLL = { HHH: 0,    HHL: 0.05, HLH: 0,    HLL: 0.05, LHH: 0.15, LHL: 0.25, LLH: 0.25, LLL: 0.25 };
  // From Discovery — encountered something new, process or escalate
  m.LHH = { HHH: 0.10, HHL: 0.20, HLH: 0.15, HLL: 0,    LHH: 0.10, LHL: 0.20, LLH: 0.15, LLL: 0.10 };
  // From Growth — character ready, can escalate or continue building
  m.LHL = { HHH: 0.05, HHL: 0.20, HLH: 0.10, HLL: 0,    LHH: 0.20, LHL: 0.15, LLH: 0.15, LLL: 0.15 };
  // From Lore — world expanded, explore or develop characters within it
  m.LLH = { HHH: 0.05, HHL: 0.05, HLH: 0.15, HLL: 0,    LHH: 0.25, LHL: 0.20, LLH: 0.15, LLL: 0.15 };
  // From Rest — calm before the storm, build outward
  m.LLL = { HHH: 0,    HHL: 0,    HLH: 0.05, HLL: 0.10, LHH: 0.15, LHL: 0.30, LLH: 0.30, LLL: 0.10 };
  return m;
})();

const STORYTELLER_PRESET: MatrixPreset = {
  key: 'storyteller',
  name: 'Storyteller',
  description: 'Hand-tuned for strong pacing. Escalation ladders, earned payoffs, recovery after peaks.',
  matrix: STORYTELLER_MATRIX,
};

/** Uniform transition matrix — every corner equally likely from every other. Pure chaos. */
const RANDOM_MATRIX: TransitionMatrix = (() => {
  const m = {} as TransitionMatrix;
  const p = 1 / 8;
  for (const from of CORNERS) {
    m[from] = {} as Record<CubeCornerKey, number>;
    for (const to of CORNERS) m[from][to] = p;
  }
  return m;
})();

const RANDOM_PRESET: MatrixPreset = {
  key: 'random',
  name: 'Random',
  description: 'Uniform transitions — every narrative mode equally likely. Unpredictable, chaotic pacing.',
  matrix: RANDOM_MATRIX,
};

/** Mutable preset list — populated at runtime from analysed works. */
export let MATRIX_PRESETS: MatrixPreset[] = [];

/** Default matrix — Storyteller is the built-in default. */
export let DEFAULT_TRANSITION_MATRIX: TransitionMatrix = STORYTELLER_MATRIX;

/** Populate presets from loaded work narratives. Called once during hydration. */
export function initMatrixPresets(works: { key: string; name: string; narrative: NarrativeState }[]) {
  const presets: MatrixPreset[] = [STORYTELLER_PRESET, RANDOM_PRESET];

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

    presets.push({
      key: work.key,
      name: work.name,
      description: `${payoffPct}% payoff modes. Computed from ${work.name}.`,
      matrix,
    });
  }

  MATRIX_PRESETS = presets;
  DEFAULT_TRANSITION_MATRIX = STORYTELLER_MATRIX;
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

// ── Pacing Presets ───────────────────────────────────────────────────────────

export type PacingPreset = {
  key: string;
  name: string;
  description: string;
  /** Fixed sequence of cube corner modes — bypasses Markov sampling */
  modes: CubeCornerKey[];
};

/**
 * Curated pacing presets for manual generation.
 * Each preset is a fixed sequence of cube positions designed to achieve
 * a specific narrative purpose. Bypasses the randomised Markov chain.
 */
/**
 * The introduction sequence used by the wizard for new story generation.
 * Designed to showcase the world across varied locations, introduce the cast
 * through natural interaction, plant threads as seeds, and build to a first
 * climax that hooks the reader.
 *
 * Rest → Lore → Growth → Discovery → Lore → Growth → Discovery → Climax
 *
 * 1. Rest — establish the ordinary world, atmosphere, the protagonist's status quo
 * 2. Lore — reveal the world's rules, systems, or history that will matter later
 * 3. Growth — characters interact, bonds form, tensions surface
 * 4. Discovery — something new enters the picture, characters are changed by it
 * 5. Lore — deepen the world further, plant seeds for future payoff
 * 6. Growth — relationships develop, alliances or rivalries crystallise
 * 7. Discovery — the stakes become clear, the world expands again
 * 8. Climax — threads converge for the first time, the story can't go back
 */
export const INTRODUCTION_SEQUENCE: CubeCornerKey[] = ['LLL', 'LLH', 'LHL', 'LHH', 'LLH', 'LHL', 'LHH', 'HHL'];

export const PACING_PRESETS: PacingPreset[] = [
  // ── 3-scene arcs ───────────────────────────────────
  { key: 'sucker-punch',   name: 'Sucker Punch',      description: 'Quiet calm, then everything hits at once',                                modes: ['LLL', 'LHL', 'HHH'] },
  { key: 'quick-resolve',  name: 'Quick Resolve',     description: 'Set up the world, pay it off, tie it up',                                modes: ['LLH', 'HHL', 'HLL'] },
  { key: 'crucible',       name: 'Crucible',          description: 'Discover, grow through it, earn the payoff',                              modes: ['LHH', 'LHL', 'HHL'] },

  // ── 5-scene arcs ───────────────────────────────────
  { key: 'classic-arc',    name: 'Classic Arc',        description: 'The workhorse — rest, build, build, climax, closure',                     modes: ['LLL', 'LHL', 'LHH', 'HHL', 'HLL'] },
  { key: 'unravelling',    name: 'Unravelling',        description: 'Layer clues, connect them, then confront what they mean',                 modes: ['LLH', 'LHH', 'LHL', 'HLH', 'HLL'] },
  { key: 'pressure',       name: 'Pressure Cooker',    description: 'Relentless buildup with no relief until the final scene',                modes: ['LHL', 'LHH', 'LHL', 'LHH', 'HHH'] },
  { key: 'inversion',      name: 'Inversion',          description: 'Calm trust, deepening world, then everything flips',                     modes: ['LHL', 'LLL', 'LLH', 'HHL', 'HHH'] },
  { key: 'deep-dive',      name: 'Deep Dive',          description: 'Enter the unknown, learn its rules, emerge changed',                    modes: ['LLH', 'LHH', 'LLH', 'LHL', 'HHL'] },

  // ── 8-scene arcs ───────────────────────────────────
  { key: 'introduction',   name: 'Introduction',       description: 'Establish the world, introduce the cast, plant threads, build to first climax', modes: INTRODUCTION_SEQUENCE },
  { key: 'full-arc',       name: 'Full Arc',           description: 'Complete cycle — setup, world, growth, discovery, escalation, climax, epoch, closure', modes: ['LLL', 'LLH', 'LHL', 'LHH', 'LHL', 'HHL', 'HHH', 'HLL'] },
  { key: 'slow-burn',      name: 'Slow Burn',          description: 'Patient buildup across five quiet scenes before a three-scene storm',    modes: ['LLL', 'LLH', 'LHL', 'LLH', 'LHL', 'LHH', 'HHL', 'HHH'] },
  { key: 'roller-coaster', name: 'Roller Coaster',     description: 'Alternating peaks and valleys — high swing, dynamic pacing',             modes: ['LHL', 'HHL', 'LLL', 'LHH', 'HHL', 'LHL', 'HHH', 'HLL'] },
  { key: 'revelation-arc', name: 'Revelation Arc',     description: 'Layer knowledge scene by scene until the world clicks into focus',       modes: ['LLH', 'LLH', 'LHH', 'LLH', 'HLH', 'LHL', 'HLH', 'HHH'] },
  { key: 'gauntlet',       name: 'Gauntlet',           description: 'Early challenge, regroup, sustained escalation, final reckoning',        modes: ['HHL', 'LLL', 'LHL', 'LHH', 'HHL', 'LHL', 'LHH', 'HHH'] },
];

/** Build a PacingSequence from a preset (bypasses Markov sampling). */
export function buildPresetSequence(preset: PacingPreset): PacingSequence {
  const steps: ModeStep[] = preset.modes.map((mode) => ({
    mode,
    name: NARRATIVE_CUBE[mode].name,
    description: NARRATIVE_CUBE[mode].description,
    forces: FORCE_TARGETS[mode],
  }));

  return { steps, pacingDescription: buildPacingDescription(steps) };
}

/** Build a PacingSequence from a raw list of modes. */
export function buildSequenceFromModes(modes: CubeCornerKey[]): PacingSequence {
  return buildPresetSequence({ key: 'custom', name: 'Custom', description: 'Custom sequence', modes });
}

/** Build the introduction sequence for new story generation (wizard). */
export function buildIntroductionSequence(): PacingSequence {
  return buildPresetSequence({
    key: 'introduction',
    name: 'Introduction',
    description: 'Establish the world, introduce the cast, plant threads, build to first climax',
    modes: INTRODUCTION_SEQUENCE,
  });
}

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
 * Mutation guidance per cube corner — tells the LLM exactly what kind of
 * mutations each mode requires so the computed forces land where intended.
 */
const MODE_GUIDANCE: Record<CubeCornerKey, string> = {
  HHH: `EPOCH — the densest scene in the arc. Multiple threads must transition (preferably to terminal statuses: resolved/subverted/abandoned). Many continuity mutations — characters learn, lose, or become something new. Introduce or heavily connect world knowledge nodes. Every force should spike. This is the scene readers remember.`,

  HHL: `CLIMAX — threads pay off and characters transform, but within established world rules. Multiple thread transitions (2+ to terminal statuses). High continuity mutations — characters are permanently changed by what happens. Minimal or zero new world knowledge nodes — use what's already been established. The payoff comes from character action, not revelation.`,

  HLH: `REVELATION — threads resolve through world-building, not character action. Thread transitions should come from discovering how the world works (a rule explains everything, a secret is unveiled). Few continuity mutations — characters observe more than they change. Add new world knowledge nodes and connect them to existing ones. The "aha" moment.`,

  HLL: `CLOSURE — quiet resolution. Tie up loose ends: a conversation that needed to happen, a debt paid, a promise kept or broken. 1-2 thread transitions to terminal statuses. Few continuity mutations. No new world knowledge. This scene exhales — aftermath, not action.`,

  LHH: `DISCOVERY — characters encounter something new and are changed by it. No thread transitions to terminal statuses (threads stay active or escalate at most). High continuity mutations — characters learn, are surprised, have their assumptions challenged. Add new world knowledge nodes — the world is expanding. Pure exploration and possibility.`,

  LHL: `GROWTH — internal character development through interaction. No thread resolutions. High continuity mutations — characters train, argue, bond, confess, strategise. No new world knowledge — this takes place within established rules. Relationships may shift. The quiet scene where characters become who they need to be for what's coming.`,

  LLH: `LORE — pure world-building. No thread transitions beyond minor pulses. Few continuity mutations. Add world knowledge nodes and edges — new rules, systems, cultures, factions, history. Plant seeds. The reader should feel the world getting deeper and more interconnected. Save the payoff for later.`,

  LLL: `REST — minimal everything. 0-1 thread pulses (same-status mentions only). 1-3 continuity mutations at most. No new world knowledge. Characters reflect, recover, observe. Atmosphere and breathing room. This scene exists so the next peak feels earned.`,
};

/**
 * Build the per-scene pacing prompt block from a sequence.
 * Each scene gets its cube mode, a description of what that mode demands
 * in terms of mutations, and target force ranges.
 */
export function buildSequencePrompt(sequence: PacingSequence): string {
  const lines: string[] = [];

  lines.push(`PACING SEQUENCE (${sequence.pacingDescription})`);
  lines.push('');
  lines.push('Each scene has a cube mode assignment that determines its force profile. The mode dictates what KIND of mutations the scene should have — thread transitions, continuity changes, world knowledge expansion — and how many. The formulas compute forces FROM these mutations, so if you want a scene to land at a specific cube corner, you must generate the right mutations.');
  lines.push('');
  lines.push('Force formulas (for reference):');
  lines.push('  Payoff = Σ max(0, phase_to - phase_from) per thread transition (same-status pulse = 0.25). Reversions score 0.');
  lines.push('  Change = √(continuity_mutations) + √(events)');
  lines.push('  Knowledge = new_world_nodes + √(new_world_edges)');
  lines.push('');

  for (let i = 0; i < sequence.steps.length; i++) {
    const step = sequence.steps[i];
    const p = step.mode[0] === 'H' ? 'HIGH' : 'LOW';
    const c = step.mode[1] === 'H' ? 'HIGH' : 'LOW';
    const k = step.mode[2] === 'H' ? 'HIGH' : 'LOW';

    lines.push(`SCENE ${i + 1} — ${NARRATIVE_CUBE[step.mode].name} [P:${p} C:${c} K:${k}]`);
    lines.push(`  ${MODE_GUIDANCE[step.mode]}`);
    lines.push(`  Targets: Payoff ${step.forces.payoff[0]}–${step.forces.payoff[1]}, Change ${step.forces.change[0]}–${step.forces.change[1]}, Knowledge ${step.forces.knowledge[0]}–${step.forces.knowledge[1]}`);
    lines.push('');
  }

  lines.push('CRITICAL: The mutations you generate ARE the forces. A REST scene with 4 thread transitions will compute as a Climax — the formulas don\'t care what you call it. Match your mutation counts to the mode targets above. This variation between dense and sparse scenes creates the peaks and valleys that make a story breathe.');

  return lines.join('\n');
}

