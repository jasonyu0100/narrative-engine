/**
 * Markov chain sequence generation for narrative pacing.
 *
 * Samples a sequence of cube corner modes from a transition matrix,
 * producing a pacing plan for an arc before scene generation begins.
 * The default matrix is derived from Harry Potter and the Sorcerer's Stone.
 */

import { computeForceSnapshots, detectCubeCorner } from "@/lib/narrative-utils";
import type { CubeCornerKey, NarrativeState, Scene } from "@/types/narrative";
import { NARRATIVE_CUBE, resolveEntry } from "@/types/narrative";

// ── Types ────────────────────────────────────────────────────────────────────

export type TransitionMatrix = Record<
  CubeCornerKey,
  Record<CubeCornerKey, number>
>;

export type ModeStep = {
  mode: CubeCornerKey;
  name: string;
  description: string;
  /** Target force ranges derived from the cube corner */
  forces: {
    fate: [number, number];
    world: [number, number];
    system: [number, number];
  };
};

export type PacingSequence = {
  steps: ModeStep[];
  /** Human-readable pacing description for the prompt */
  pacingDescription: string;
};

// ── Constants ────────────────────────────────────────────────────────────────

const CORNERS: CubeCornerKey[] = [
  "HHH",
  "HHL",
  "HLH",
  "HLL",
  "LHH",
  "LHL",
  "LLH",
  "LLL",
];

// ── Matrix Computation ───────────────────────────────────────────────────────

import {
  computeRawForceTotals,
  resolveEntrySequence,
  zScoreNormalize,
} from "@/lib/narrative-utils";

/** Compute a transition matrix from a NarrativeState using the canon (root) branch. */
export function computeMatrixFromNarrative(
  narrative: NarrativeState,
): TransitionMatrix {
  // Find root branch
  const rootBranch = Object.values(narrative.branches).find(
    (b) => b.parentBranchId === null,
  );
  const keys = rootBranch
    ? resolveEntrySequence(narrative.branches, rootBranch.id)
    : Object.keys(narrative.scenes);

  const scenes = keys
    .map((k) => resolveEntry(narrative, k))
    .filter((e): e is Scene => !!e && e.kind === "scene");

  if (scenes.length < 3) return emptyMatrix();

  const raw = computeRawForceTotals(scenes);
  const np = zScoreNormalize(raw.fate);
  const nc = zScoreNormalize(raw.world);
  const nk = zScoreNormalize(raw.system);

  const sequence: CubeCornerKey[] = scenes.map(
    (_, i) =>
      detectCubeCorner({ fate: np[i], world: nc[i], system: nk[i] }).key,
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
 *  3. Growth as hub: most modes reach Growth, Growth feeds into fate
 *  4. Lore feeds Discovery: world-building leads to exploration
 *  5. No back-to-back Epoch; low self-loops throughout
 *  6. ~35% fate-mode steady state — earned, not inflated
 */
const STORYTELLER_MATRIX: TransitionMatrix = (() => {
  const m = emptyMatrix();
  //              HHH   HHL   HLH   HLL   LHH   LHL   LLH   LLL
  // From Epoch — everything just converged, must recover
  m.HHH = {
    HHH: 0,
    HHL: 0.05,
    HLH: 0.05,
    HLL: 0.25,
    LHH: 0.05,
    LHL: 0.2,
    LLH: 0.1,
    LLL: 0.3,
  };
  // From Climax — threads resolved, characters need to breathe
  m.HHL = {
    HHH: 0.05,
    HHL: 0.05,
    HLH: 0.05,
    HLL: 0.2,
    LHH: 0.1,
    LHL: 0.2,
    LLH: 0.1,
    LLL: 0.25,
  };
  // From Revelation — truth unlocked, characters must grapple with it
  m.HLH = {
    HHH: 0.05,
    HHL: 0.2,
    HLH: 0.05,
    HLL: 0.1,
    LHH: 0.2,
    LHL: 0.25,
    LLH: 0.05,
    LLL: 0.1,
  };
  // From Closure — loose ends tied, new chapter begins
  m.HLL = {
    HHH: 0,
    HHL: 0.05,
    HLH: 0,
    HLL: 0.05,
    LHH: 0.15,
    LHL: 0.25,
    LLH: 0.25,
    LLL: 0.25,
  };
  // From Discovery — encountered something new, process or escalate
  m.LHH = {
    HHH: 0.1,
    HHL: 0.2,
    HLH: 0.15,
    HLL: 0,
    LHH: 0.1,
    LHL: 0.2,
    LLH: 0.15,
    LLL: 0.1,
  };
  // From Growth — character ready, can escalate or continue building
  m.LHL = {
    HHH: 0.05,
    HHL: 0.2,
    HLH: 0.1,
    HLL: 0,
    LHH: 0.2,
    LHL: 0.15,
    LLH: 0.15,
    LLL: 0.15,
  };
  // From Lore — world expanded, explore or develop characters within it
  m.LLH = {
    HHH: 0.05,
    HHL: 0.05,
    HLH: 0.15,
    HLL: 0,
    LHH: 0.25,
    LHL: 0.2,
    LLH: 0.15,
    LLL: 0.15,
  };
  // From Rest — calm before the storm, build outward
  m.LLL = {
    HHH: 0,
    HHL: 0,
    HLH: 0.05,
    HLL: 0.1,
    LHH: 0.15,
    LHL: 0.3,
    LLH: 0.3,
    LLL: 0.1,
  };
  return m;
})();

export const STORYTELLER_PRESET: MatrixPreset = {
  key: "storyteller",
  name: "Storyteller",
  description:
    "Hand-tuned for strong pacing. Escalation ladders, earned fates, recovery after peaks.",
  matrix: STORYTELLER_MATRIX,
};

/** Mutable preset list — populated at runtime from analysed works. */
export let MATRIX_PRESETS: MatrixPreset[] = [];

/** Default matrix — Storyteller is the built-in default. */
export let DEFAULT_TRANSITION_MATRIX: TransitionMatrix = STORYTELLER_MATRIX;

/** Populate presets from loaded work narratives. Called once during hydration. */
export function initMatrixPresets(
  works: { key: string; name: string; narrative: NarrativeState }[],
) {
  const presets: MatrixPreset[] = [STORYTELLER_PRESET];

  for (const work of works) {
    const matrix = computeMatrixFromNarrative(work.narrative);
    // Check it has enough data (at least some non-zero transitions)
    const totalTransitions = CORNERS.reduce(
      (s, from) => s + CORNERS.reduce((s2, to) => s2 + matrix[from][to], 0),
      0,
    );
    if (totalTransitions < 0.5) continue; // empty matrix, skip

    // Auto-generate description from matrix properties
    const fateFrac = CORNERS.filter((c) => c[0] === "H").reduce((s, c) => {
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
    const fatePct =
      totalWeight > 0 ? Math.round((fateFrac / totalWeight) * 100) : 50;

    presets.push({
      key: work.key,
      name: work.name,
      description: `${fatePct}% fate modes. Computed from ${work.name}.`,
      matrix,
    });
  }

  MATRIX_PRESETS = presets;
  DEFAULT_TRANSITION_MATRIX = STORYTELLER_MATRIX;
}

/**
 * Force target ranges per cube corner.
 * High = above reference mean (fate 1.5, world 12, system 3), Low = below or near zero.
 * Ranges are [min, max] raw force values to guide generation.
 * "High" anchors above reference (dominance territory); "Low" stays near the floor
 * so the LLM produces real contrast instead of hugging the mean.
 */
const FORCE_TARGETS: Record<
  CubeCornerKey,
  { fate: [number, number]; world: [number, number]; system: [number, number] }
> = {
  // Epoch: everything high
  HHH: { fate: [1.5, 4], world: [12, 20], system: [3, 8] },
  // Climax: high fate + world, low system
  HHL: { fate: [1.5, 4], world: [12, 20], system: [0, 2] },
  // Revelation: high fate + system, low world
  HLH: { fate: [1.5, 4], world: [0, 6], system: [3, 8] },
  // Closure: high fate, low world + system
  HLL: { fate: [1.5, 4], world: [0, 6], system: [0, 2] },
  // Discovery: high world + system, low fate
  LHH: { fate: [0, 1], world: [12, 20], system: [3, 8] },
  // Growth: high world, low fate + system
  LHL: { fate: [0, 1], world: [12, 20], system: [0, 2] },
  // Lore: high system, low fate + world
  LLH: { fate: [0, 1], world: [0, 6], system: [3, 8] },
  // Rest: everything low
  LLL: { fate: [0, 1], world: [0, 6], system: [0, 2] },
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
 * 5. Lore — deepen the world further, plant seeds for future fate
 * 6. Growth — relationships develop, alliances or rivalries crystallise
 * 7. Discovery — the stakes become clear, the world expands again
 * 8. Climax — threads converge for the first time, the story can't go back
 */
export const INTRODUCTION_SEQUENCE: CubeCornerKey[] = [
  "LLL",
  "LLH",
  "LHL",
  "LHH",
  "LLH",
  "LHL",
  "LHH",
  "HHL",
];

export const PACING_PRESETS: PacingPreset[] = [
  // ── 3-scene arcs ───────────────────────────────────
  {
    key: "sucker-punch",
    name: "Sucker Punch",
    description: "Quiet calm, then everything hits at once",
    modes: ["LLL", "LHL", "HHH"],
  },
  {
    key: "quick-resolve",
    name: "Quick Resolve",
    description: "Set up the world, pay it off, tie it up",
    modes: ["LLH", "HHL", "HLL"],
  },
  {
    key: "crucible",
    name: "Crucible",
    description: "Discover, grow through it, earn the fate",
    modes: ["LHH", "LHL", "HHL"],
  },

  // ── 5-scene arcs ───────────────────────────────────
  {
    key: "classic-arc",
    name: "Classic Arc",
    description: "The workhorse — rest, build, build, climax, closure",
    modes: ["LLL", "LHL", "LHH", "HHL", "HLL"],
  },
  {
    key: "unravelling",
    name: "Unravelling",
    description: "Layer clues, connect them, then confront what they mean",
    modes: ["LLH", "LHH", "LHL", "HLH", "HLL"],
  },
  {
    key: "pressure",
    name: "Pressure Cooker",
    description: "Relentless buildup with no relief until the final scene",
    modes: ["LHL", "LHH", "LHL", "LHH", "HHH"],
  },
  {
    key: "inversion",
    name: "Inversion",
    description: "Calm trust, deepening world, then everything flips",
    modes: ["LHL", "LLL", "LLH", "HHL", "HHH"],
  },
  {
    key: "deep-dive",
    name: "Deep Dive",
    description: "Enter the unknown, learn its rules, emerge changed",
    modes: ["LLH", "LHH", "LLH", "LHL", "HHL"],
  },

  // ── 8-scene arcs ───────────────────────────────────
  {
    key: "introduction",
    name: "Introduction",
    description:
      "Establish the world, introduce the cast, plant threads, build to first climax",
    modes: INTRODUCTION_SEQUENCE,
  },
  {
    key: "full-arc",
    name: "Full Arc",
    description:
      "Complete cycle — setup, world, growth, discovery, escalation, climax, epoch, closure",
    modes: ["LLL", "LLH", "LHL", "LHH", "LHL", "HHL", "HHH", "HLL"],
  },
  {
    key: "slow-burn",
    name: "Slow Burn",
    description:
      "Patient buildup across five quiet scenes before a three-scene storm",
    modes: ["LLL", "LLH", "LHL", "LLH", "LHL", "LHH", "HHL", "HHH"],
  },
  {
    key: "roller-coaster",
    name: "Roller Coaster",
    description: "Alternating peaks and valleys — high swing, dynamic pacing",
    modes: ["LHL", "HHL", "LLL", "LHH", "HHL", "LHL", "HHH", "HLL"],
  },
  {
    key: "revelation-arc",
    name: "Revelation Arc",
    description:
      "Layer knowledge scene by scene until the world clicks into focus",
    modes: ["LLH", "LLH", "LHH", "LLH", "HLH", "LHL", "HLH", "HHH"],
  },
  {
    key: "gauntlet",
    name: "Gauntlet",
    description:
      "Early challenge, regroup, sustained escalation, final reckoning",
    modes: ["HHL", "LLL", "LHL", "LHH", "HHL", "LHL", "LHH", "HHH"],
  },
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
  return buildPresetSequence({
    key: "custom",
    name: "Custom",
    description: "Custom sequence",
    modes,
  });
}

/** Build the introduction sequence for new story generation (wizard). */
export function buildIntroductionSequence(): PacingSequence {
  return buildPresetSequence({
    key: "introduction",
    name: "Introduction",
    description:
      "Establish the world, introduce the cast, plant threads, build to first climax",
    modes: INTRODUCTION_SEQUENCE,
  });
}

// ── Sampling ─────────────────────────────────────────────────────────────────

/** Sample the next mode from a transition matrix row using weighted random. */
function sampleNext(
  matrix: TransitionMatrix,
  current: CubeCornerKey,
): CubeCornerKey {
  const row = matrix[current];
  const r = Math.random();
  let cumulative = 0;
  for (const corner of CORNERS) {
    cumulative += row[corner] ?? 0;
    if (r < cumulative) return corner;
  }
  // Fallback (rounding error) — return last non-zero
  return CORNERS.find((c) => (row[c] ?? 0) > 0) ?? "LLL";
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
  const fateCount = steps.filter((s) => s.mode[0] === "H").length;
  const buildupCount = total - fateCount;
  const fatePct = Math.round((fateCount / total) * 100);

  // Find the peak scene (highest force targets)
  const peakIdx = steps.reduce((best, s, i) => {
    const intensity = s.forces.fate[1] + s.forces.world[1] + s.forces.system[1];
    const bestIntensity =
      steps[best].forces.fate[1] +
      steps[best].forces.world[1] +
      steps[best].forces.system[1];
    return intensity > bestIntensity ? i : best;
  }, 0);

  const lines: string[] = [];
  lines.push(
    `${total}-scene arc: ${buildupCount} buildup, ${fateCount} fate (${fatePct}% fate).`,
  );

  // Describe the shape
  const modeNames = steps.map((s) => s.name);
  lines.push(`Sequence: ${modeNames.join(" → ")}.`);

  if (peakIdx === 0) {
    lines.push(
      "Opens with the peak — front-loaded intensity, followed by processing.",
    );
  } else if (peakIdx === total - 1) {
    lines.push("Builds toward a peak at the end — escalating arc.");
  } else {
    lines.push(
      `Peak at scene ${peakIdx + 1} (${steps[peakIdx].name}) — buildup before, processing after.`,
    );
  }

  return lines.join(" ");
}

// ── Current Mode Detection ───────────────────────────────────────────────────

/** Detect the current narrative mode from the last scene on the branch. */
export function detectCurrentMode(
  narrative: NarrativeState,
  resolvedKeys: string[],
): CubeCornerKey {
  const allScenes = resolvedKeys
    .map((k) => resolveEntry(narrative, k))
    .filter((e): e is Scene => !!e && e.kind === "scene");
  if (allScenes.length === 0) return "LLL"; // default Rest for new stories
  const snapshots = computeForceSnapshots(allScenes);
  const lastScene = allScenes[allScenes.length - 1];
  const lastForces = snapshots[lastScene.id];
  if (!lastForces) return "LLL";
  return detectCubeCorner(lastForces).key;
}

// ── Prompt Generation ────────────────────────────────────────────────────────

/**
 * Compact mutation guidance per cube corner — concise version for token efficiency.
 */
const MODE_GUIDANCE: Record<CubeCornerKey, string> = {
  HHH: `EPOCH — densest scene. 2+ terminal threads, 18-25+ continuity nodes across 4-6 entities, 6-10 world knowledge nodes with 3-5 edges. Everything spikes.`,
  HHL: `CLIMAX — threads pay off, characters transform. 2+ terminal threads, 18-25+ continuity nodes across 4-6 entities, minimal new world knowledge (0-2 nodes).`,
  HLH: `REVELATION — threads resolve via world-building. Thread transitions from discovery, lean continuity (4-8 nodes), 6-10 new world knowledge nodes with 4-6 edges.`,
  HLL: `CLOSURE — quiet resolution. 1-2 terminal threads, sparse continuity (3-6 nodes), 0-2 world knowledge. Aftermath, not action.`,
  LHH: `DISCOVERY — encounter something new. No terminals, 14-22 continuity nodes across 3-5 entities, 5-8 world knowledge nodes with 3-5 edges. Exploration.`,
  LHL: `GROWTH — character development. No resolutions, 14-22 continuity nodes across 3-5 entities, 0-2 world knowledge. Relationships shift, interiors deepen.`,
  LLH: `LORE — pure world-building. Pulses only, 3-6 continuity nodes, 6-12 world knowledge nodes with 4-8 edges. Plant seeds, reveal systems.`,
  LLL: `REST — minimal everything. 0-1 pulses, 3-6 continuity nodes across 2-3 entities, 0-2 world knowledge. Breathing room — but still DOES something to whoever is present.`,
};

/**
 * Build a pacing prompt for a SINGLE scene step within a sequence.
 * Used by stepwise scene generation where each scene is generated independently.
 */
export function buildSingleStepPrompt(
  step: ModeStep,
  sceneIndex: number,
  totalScenes: number,
): string {
  const p = step.mode[0] === "H" ? "HIGH" : "LOW";
  const c = step.mode[1] === "H" ? "HIGH" : "LOW";
  const k = step.mode[2] === "H" ? "HIGH" : "LOW";
  const targets = `P:${step.forces.fate[0]}-${step.forces.fate[1]} W:${step.forces.world[0]}-${step.forces.world[1]} S:${step.forces.system[0]}-${step.forces.system[1]}`;
  return `PACING — Scene ${sceneIndex + 1}/${totalScenes}: ${NARRATIVE_CUBE[step.mode].name} [P:${p} W:${c} S:${k}]
${MODE_GUIDANCE[step.mode]}
Targets: ${targets}. Reference means across the arc: P≈3, W≈14, S≈5. Mutations ARE forces — match counts to targets, never hug the mean.`;
}

/**
 * Build the per-scene pacing prompt block from a sequence.
 * Uses compact table format to minimize tokens while preserving all guidance.
 */
export function buildSequencePrompt(sequence: PacingSequence): string {
  const lines: string[] = [];

  lines.push(`PACING SEQUENCE (${sequence.pacingDescription})`);
  lines.push("");
  lines.push(
    "Mode determines mutation profile. Formulas compute forces FROM mutations:",
  );
  lines.push(
    "  P = Σ thread transitions (pulse=0.25) | W = ΔN_c + √ΔE_c (entity continuity) | S = ΔN + √ΔE (world knowledge)",
  );
  lines.push(
    "  Reference means (target averages across the arc): P≈3, W≈14, S≈5. Scenes should breathe above/below these — not hug them.",
  );
  lines.push("");

  // Build compact scene assignments
  for (let i = 0; i < sequence.steps.length; i++) {
    const step = sequence.steps[i];
    const p = step.mode[0] === "H" ? "HIGH" : "LOW";
    const c = step.mode[1] === "H" ? "HIGH" : "LOW";
    const k = step.mode[2] === "H" ? "HIGH" : "LOW";
    const targets = `P:${step.forces.fate[0]}-${step.forces.fate[1]} W:${step.forces.world[0]}-${step.forces.world[1]} S:${step.forces.system[0]}-${step.forces.system[1]}`;

    lines.push(
      `SCENE ${i + 1} — ${NARRATIVE_CUBE[step.mode].name} [P:${p} W:${c} S:${k}]`,
    );
    lines.push(`  ${MODE_GUIDANCE[step.mode]}`);
    lines.push(`  Targets: ${targets}`);
    lines.push("");
  }

  lines.push(
    "CRITICAL: Mutations ARE forces. Match counts to targets — dense/sparse variation creates pacing rhythm.",
  );

  return lines.join("\n");
}
