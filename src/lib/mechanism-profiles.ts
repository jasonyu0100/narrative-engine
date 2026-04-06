/**
 * Mechanism profile system — prose delivery mechanism distributions.
 *
 * Now uses function-conditioned distributions to preserve correlations from source texts.
 * The separate mechanism preset selector in UI will show the FLAT distribution derived
 * from the fn-conditioned data for visualization, but sampling uses fn-conditioned.
 */

import type { BeatFn, BeatMechanism, NarrativeState, Scene, MechanismProfilePreset, FnMechanismDistribution, Branch } from '@/types/narrative';
import { DEFAULT_FN_MECHANISM_DIST } from '@/lib/beat-profiles';
import { resolvePlanForBranch } from '@/lib/narrative-utils';

export type { MechanismProfilePreset };

// ── Flatten fn-conditioned distribution for visualization ────────────────────

/** Compute a flat mechanism distribution from fn-conditioned distribution (for UI visualization) */
export function flattenFnMechDist(fnMechDist: FnMechanismDistribution): Partial<Record<BeatMechanism, number>> {
  const counts: Record<string, number> = {};
  let total = 0;

  // Weight each fn's mechanism distribution equally (assumes uniform fn distribution)
  for (const [_fn, mechDist] of Object.entries(fnMechDist)) {
    if (!mechDist) continue;
    for (const [mech, prob] of Object.entries(mechDist)) {
      counts[mech] = (counts[mech] ?? 0) + (prob ?? 0);
      total += prob ?? 0;
    }
  }

  if (total === 0) return {};

  const result: Partial<Record<BeatMechanism, number>> = {};
  for (const [mech, count] of Object.entries(counts)) {
    result[mech as BeatMechanism] = count / total;
  }
  return result;
}

/** Default flat distribution derived from DEFAULT_FN_MECHANISM_DIST */
export const DEFAULT_MECHANISM_DIST = flattenFnMechDist(DEFAULT_FN_MECHANISM_DIST);

// ── Compute Distribution from Scene Plans ───────────────────────────────────

export function computeFnMechanismDist(scenes: Scene[]): FnMechanismDistribution | null {
  const fnMechCounts: Record<string, Record<string, number>> = {};
  const fnTotalCounts: Record<string, number> = {};
  let totalBeats = 0;

  for (const scene of scenes) {
    const beats = scene.plan?.beats;
    if (!beats || beats.length === 0) continue;
    for (const beat of beats) {
      totalBeats++;
      if (!fnMechCounts[beat.fn]) fnMechCounts[beat.fn] = {};
      fnMechCounts[beat.fn][beat.mechanism] = (fnMechCounts[beat.fn][beat.mechanism] ?? 0) + 1;
      fnTotalCounts[beat.fn] = (fnTotalCounts[beat.fn] ?? 0) + 1;
    }
  }

  if (totalBeats === 0) return null;

  const fnMechanismDistribution: FnMechanismDistribution = {};
  for (const [fn, mechMap] of Object.entries(fnMechCounts)) {
    const fnTotal = fnTotalCounts[fn] ?? 1;
    fnMechanismDistribution[fn as BeatFn] = Object.fromEntries(
      Object.entries(mechMap).map(([mech, count]) => [mech, count / fnTotal])
    ) as Partial<Record<BeatMechanism, number>>;
  }

  return fnMechanismDistribution;
}

/** Compute flat mechanism distribution from scenes (for UI visualization) */
export function computeMechanismDist(scenes: Scene[]): Partial<Record<BeatMechanism, number>> | null {
  const fnMechDist = computeFnMechanismDist(scenes);
  if (!fnMechDist) return null;
  return flattenFnMechDist(fnMechDist);
}

/**
 * Compute fn-conditioned mechanism distribution using resolved plans (version-aware).
 * Use this for user narratives with versioned plans.
 */
export function computeFnMechanismDistResolved(
  scenes: Scene[],
  branchId: string,
  branches: Record<string, Branch>,
): FnMechanismDistribution | null {
  const fnMechCounts: Record<string, Record<string, number>> = {};
  const fnTotalCounts: Record<string, number> = {};
  let totalBeats = 0;

  for (const scene of scenes) {
    const plan = resolvePlanForBranch(scene, branchId, branches);
    const beats = plan?.beats;
    if (!beats || beats.length === 0) continue;
    for (const beat of beats) {
      totalBeats++;
      if (!fnMechCounts[beat.fn]) fnMechCounts[beat.fn] = {};
      fnMechCounts[beat.fn][beat.mechanism] = (fnMechCounts[beat.fn][beat.mechanism] ?? 0) + 1;
      fnTotalCounts[beat.fn] = (fnTotalCounts[beat.fn] ?? 0) + 1;
    }
  }

  if (totalBeats === 0) return null;

  const fnMechanismDistribution: FnMechanismDistribution = {};
  for (const [fn, mechMap] of Object.entries(fnMechCounts)) {
    const fnTotal = fnTotalCounts[fn] ?? 1;
    fnMechanismDistribution[fn as BeatFn] = Object.fromEntries(
      Object.entries(mechMap).map(([mech, count]) => [mech, count / fnTotal])
    ) as Partial<Record<BeatMechanism, number>>;
  }

  return fnMechanismDistribution;
}

// ── Preset Management ───────────────────────────────────────────────────────

export let MECHANISM_PROFILE_PRESETS: MechanismProfilePreset[] = [];

/** Populate presets from loaded work narratives. Called once during hydration. */
export function initMechanismProfilePresets(works: { key: string; name: string; narrative: NarrativeState }[]) {
  const presets: MechanismProfilePreset[] = [
    {
      key: 'storyteller',
      name: 'Storyteller',
      description: 'Balanced fiction',
      distribution: DEFAULT_MECHANISM_DIST,
    },
  ];

  for (const { key, name, narrative } of works) {
    // Compute fn-conditioned distribution, then flatten for UI display
    const fnDist = computeFnMechanismDist(Object.values(narrative.scenes));
    const dist = fnDist ? flattenFnMechDist(fnDist) : null;
    if (!dist || Object.keys(dist).length === 0) continue;

    const raw = narrative.proseProfile as unknown as Record<string, unknown>;
    const scenesAnalyzed = raw?.scenesAnalyzed as number | undefined;
    presets.push({
      key,
      name,
      description: scenesAnalyzed ? `${scenesAnalyzed} scenes` : 'Work-derived',
      distribution: dist,
    });
  }

  MECHANISM_PROFILE_PRESETS = presets;
  return presets;
}

// ── Resolution ──────────────────────────────────────────────────────────────

/** Resolve flat mechanism distribution for UI visualization */
export function resolveMechanismDist(narrative: NarrativeState): Partial<Record<BeatMechanism, number>> {
  const preset = narrative.storySettings?.mechanismProfilePreset;
  if (preset) {
    const found = MECHANISM_PROFILE_PRESETS.find((p) => p.key === preset);
    if (found?.distribution) return found.distribution;
  }
  // Compute live from scene plans if available
  const fromPlans = computeMechanismDist(Object.values(narrative.scenes ?? {}));
  if (fromPlans) return fromPlans;
  return DEFAULT_MECHANISM_DIST;
}

/** Resolve fn-conditioned mechanism distribution for actual sampling */
export function resolveFnMechanismDist(narrative: NarrativeState): FnMechanismDistribution {
  // Compute from scene plans if available
  const fromPlans = computeFnMechanismDist(Object.values(narrative.scenes ?? {}));
  if (fromPlans && Object.keys(fromPlans).length > 0) return fromPlans;
  return DEFAULT_FN_MECHANISM_DIST;
}
