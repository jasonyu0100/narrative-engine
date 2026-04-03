/**
 * Mechanism profile system — prose delivery mechanism distributions.
 *
 * Separates mechanism preferences from beat transitions, allowing independent control:
 *   - Pacing: Which cube corners to use (Harry Potter)
 *   - Beats: Which beat function transitions to use (Reverend Insanity)
 *   - Mechanisms: Which delivery mechanisms to use (1984)
 *
 * A single built-in default (Storyteller) + work-derived presets + "self" option.
 */

import type { BeatMechanism, NarrativeState, Scene, MechanismProfilePreset } from '@/types/narrative';
export type { MechanismProfilePreset };

// ── Default Mechanism Distribution ──────────────────────────────────────────

export const DEFAULT_MECHANISM_DIST: Partial<Record<BeatMechanism, number>> = {
  dialogue: 0.32,
  action: 0.23,
  narration: 0.18,
  environment: 0.14,
  thought: 0.11,
  document: 0.01,
  memory: 0.005,
  comic: 0.005,
};

// ── Compute Distribution from Scene Plans ───────────────────────────────────

export function computeMechanismDist(scenes: Scene[]): Partial<Record<BeatMechanism, number>> | null {
  const mechCounts: Record<string, number> = {};
  let totalBeats = 0;

  for (const scene of scenes) {
    const beats = scene.plan?.beats;
    if (!beats || beats.length === 0) continue;
    for (const beat of beats) {
      totalBeats++;
      mechCounts[beat.mechanism] = (mechCounts[beat.mechanism] ?? 0) + 1;
    }
  }

  if (totalBeats === 0) return null;

  const mechanismDistribution: Partial<Record<BeatMechanism, number>> = {};
  for (const [mech, count] of Object.entries(mechCounts)) {
    mechanismDistribution[mech as BeatMechanism] = count / totalBeats;
  }

  return mechanismDistribution;
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
    // Compute from scene plans
    const dist = computeMechanismDist(Object.values(narrative.scenes));
    if (!dist) continue;

    // Fallback to stored distribution in proseProfile
    const raw = narrative.proseProfile as unknown as Record<string, unknown>;
    const rawMechDist = raw?.mechanismDistribution as Partial<Record<BeatMechanism, number>> | undefined;
    const distribution = dist ?? rawMechDist ?? DEFAULT_MECHANISM_DIST;

    const scenesAnalyzed = raw?.scenesAnalyzed as number | undefined;
    presets.push({
      key,
      name,
      description: scenesAnalyzed ? `${scenesAnalyzed} scenes` : 'Work-derived',
      distribution,
    });
  }

  MECHANISM_PROFILE_PRESETS = presets;
  return presets;
}

// ── Resolution ──────────────────────────────────────────────────────────────

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
