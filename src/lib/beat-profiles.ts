/**
 * Beat profile system — Markov chains for prose plan generation.
 *
 * ProseProfile carries voice/style fields only.
 * BeatSampler carries derived beat statistics (markov, mechanisms, density).
 */

import type { BeatFn, BeatMechanism, BeatTransitionMatrix, ProseProfile, BeatSampler, NarrativeState, Scene, BeatProfilePreset } from '@/types/narrative';
export type { BeatProfilePreset };

// ── Default Beat Sampler Data ────────────────────────────────────────────────

export const DEFAULT_BEAT_MATRIX: BeatTransitionMatrix = {
  breathe:    { inform: 0.52, advance: 0.19, bond: 0.05, turn: 0.04, reveal: 0.04, expand: 0.05, foreshadow: 0.03, resolve: 0.03, shift: 0.02, breathe: 0.03 },
  inform:     { advance: 0.41, breathe: 0.15, inform: 0.12, bond: 0.08, turn: 0.06, reveal: 0.05, expand: 0.04, foreshadow: 0.04, resolve: 0.03, shift: 0.02 },
  advance:    { inform: 0.21, advance: 0.23, breathe: 0.14, bond: 0.08, turn: 0.08, reveal: 0.07, expand: 0.05, foreshadow: 0.05, resolve: 0.05, shift: 0.04 },
  bond:       { inform: 0.23, advance: 0.16, breathe: 0.15, bond: 0.12, turn: 0.08, reveal: 0.07, expand: 0.05, foreshadow: 0.05, resolve: 0.05, shift: 0.04 },
  turn:       { advance: 0.27, inform: 0.24, resolve: 0.18, breathe: 0.10, reveal: 0.06, bond: 0.05, expand: 0.04, foreshadow: 0.03, shift: 0.02, turn: 0.01 },
  reveal:     { advance: 0.25, inform: 0.25, breathe: 0.12, bond: 0.10, turn: 0.07, reveal: 0.05, expand: 0.05, foreshadow: 0.04, resolve: 0.04, shift: 0.03 },
  shift:      { advance: 0.31, resolve: 0.17, breathe: 0.10, inform: 0.10, foreshadow: 0.10, bond: 0.07, turn: 0.05, reveal: 0.04, expand: 0.04, shift: 0.02 },
  expand:     { advance: 0.28, inform: 0.19, breathe: 0.17, bond: 0.08, turn: 0.07, reveal: 0.06, expand: 0.05, foreshadow: 0.04, resolve: 0.04, shift: 0.02 },
  foreshadow: { advance: 0.21, inform: 0.16, breathe: 0.13, turn: 0.13, resolve: 0.10, bond: 0.07, reveal: 0.06, expand: 0.05, foreshadow: 0.05, shift: 0.04 },
  resolve:    { breathe: 0.31, advance: 0.26, foreshadow: 0.13, inform: 0.10, bond: 0.05, expand: 0.05, reveal: 0.04, turn: 0.03, shift: 0.02, resolve: 0.01 },
};

export const DEFAULT_MECHANISM_DIST: Partial<Record<BeatMechanism, number>> = {
  dialogue: 0.32, action: 0.23, narration: 0.18, environment: 0.14,
  thought: 0.11, document: 0.01, memory: 0.005, comic: 0.005,
};

export const DEFAULT_BEAT_SAMPLER: BeatSampler = {
  markov: DEFAULT_BEAT_MATRIX,
  mechanismDistribution: DEFAULT_MECHANISM_DIST,
  beatsPerKWord: 12,
};

const ACTION_SAMPLER: BeatSampler = {
  beatsPerKWord: 16,
  mechanismDistribution: { action: 0.35, dialogue: 0.30, thought: 0.10, environment: 0.12, narration: 0.05, memory: 0.03, document: 0.02, comic: 0.03 },
  markov: {
    breathe:    { inform: 0.40, advance: 0.30, turn: 0.08, reveal: 0.06, bond: 0.04, expand: 0.04, foreshadow: 0.03, resolve: 0.02, shift: 0.02, breathe: 0.01 },
    inform:     { advance: 0.50, turn: 0.12, breathe: 0.08, inform: 0.08, bond: 0.05, reveal: 0.05, expand: 0.03, foreshadow: 0.04, resolve: 0.03, shift: 0.02 },
    advance:    { advance: 0.30, inform: 0.15, turn: 0.15, breathe: 0.08, reveal: 0.08, bond: 0.06, shift: 0.06, resolve: 0.05, expand: 0.04, foreshadow: 0.03 },
    bond:       { advance: 0.30, inform: 0.20, turn: 0.12, breathe: 0.10, reveal: 0.08, bond: 0.06, shift: 0.05, resolve: 0.04, expand: 0.03, foreshadow: 0.02 },
    turn:       { advance: 0.35, resolve: 0.20, inform: 0.15, shift: 0.08, breathe: 0.06, reveal: 0.06, bond: 0.04, expand: 0.03, foreshadow: 0.02, turn: 0.01 },
    reveal:     { advance: 0.35, turn: 0.15, inform: 0.15, bond: 0.10, breathe: 0.08, shift: 0.05, resolve: 0.05, expand: 0.03, foreshadow: 0.03, reveal: 0.01 },
    shift:      { advance: 0.40, turn: 0.15, resolve: 0.15, inform: 0.10, breathe: 0.05, bond: 0.05, foreshadow: 0.04, reveal: 0.03, expand: 0.02, shift: 0.01 },
    expand:     { advance: 0.35, inform: 0.25, breathe: 0.10, turn: 0.08, reveal: 0.06, bond: 0.05, expand: 0.04, foreshadow: 0.04, resolve: 0.02, shift: 0.01 },
    foreshadow: { advance: 0.30, turn: 0.20, inform: 0.15, breathe: 0.10, resolve: 0.08, bond: 0.05, reveal: 0.04, expand: 0.04, shift: 0.03, foreshadow: 0.01 },
    resolve:    { advance: 0.35, breathe: 0.20, foreshadow: 0.15, inform: 0.10, bond: 0.05, expand: 0.05, turn: 0.04, reveal: 0.03, shift: 0.02, resolve: 0.01 },
  },
};

const INTROSPECTIVE_SAMPLER: BeatSampler = {
  beatsPerKWord: 12,
  mechanismDistribution: { thought: 0.30, narration: 0.22, dialogue: 0.20, environment: 0.15, action: 0.08, memory: 0.03, document: 0.01, comic: 0.01 },
  markov: {
    breathe:    { inform: 0.55, breathe: 0.10, advance: 0.10, reveal: 0.06, bond: 0.05, expand: 0.05, foreshadow: 0.04, turn: 0.03, resolve: 0.01, shift: 0.01 },
    inform:     { breathe: 0.25, inform: 0.18, advance: 0.15, bond: 0.10, reveal: 0.08, turn: 0.06, expand: 0.06, foreshadow: 0.05, resolve: 0.04, shift: 0.03 },
    advance:    { breathe: 0.25, inform: 0.25, advance: 0.12, bond: 0.10, turn: 0.08, reveal: 0.06, expand: 0.05, foreshadow: 0.04, resolve: 0.03, shift: 0.02 },
    bond:       { breathe: 0.20, inform: 0.25, bond: 0.15, advance: 0.10, reveal: 0.10, turn: 0.06, foreshadow: 0.05, expand: 0.04, resolve: 0.03, shift: 0.02 },
    turn:       { breathe: 0.20, inform: 0.20, resolve: 0.20, advance: 0.15, reveal: 0.08, bond: 0.06, expand: 0.04, foreshadow: 0.04, shift: 0.02, turn: 0.01 },
    reveal:     { breathe: 0.25, inform: 0.20, bond: 0.15, advance: 0.12, turn: 0.08, reveal: 0.05, expand: 0.05, foreshadow: 0.04, resolve: 0.04, shift: 0.02 },
    shift:      { breathe: 0.20, inform: 0.15, resolve: 0.20, advance: 0.15, bond: 0.08, turn: 0.08, foreshadow: 0.05, reveal: 0.04, expand: 0.03, shift: 0.02 },
    expand:     { breathe: 0.25, inform: 0.25, advance: 0.15, bond: 0.08, turn: 0.07, reveal: 0.06, expand: 0.05, foreshadow: 0.04, resolve: 0.03, shift: 0.02 },
    foreshadow: { breathe: 0.20, inform: 0.20, advance: 0.15, turn: 0.12, resolve: 0.10, bond: 0.07, reveal: 0.05, expand: 0.04, foreshadow: 0.04, shift: 0.03 },
    resolve:    { breathe: 0.40, inform: 0.15, foreshadow: 0.15, advance: 0.10, bond: 0.05, expand: 0.05, reveal: 0.04, turn: 0.03, shift: 0.02, resolve: 0.01 },
  },
};

// ── Built-in Prose Profiles ──────────────────────────────────────────────────

export const DEFAULT_PROSE_PROFILE: ProseProfile = {
  register: 'conversational',
  stance: 'close_third',
  devices: ['free_indirect_discourse', 'dramatic_irony'],
  rules: ['Show emotion through physical reaction, never name it'],
};

export const ACTION_PROFILE: ProseProfile = {
  register: 'raw',
  stance: 'close_third',
  tense: 'past',
  sentenceRhythm: 'terse',
  interiority: 'surface',
  dialogueWeight: 'heavy',
  devices: ['dramatic_irony', 'comic_escalation'],
  rules: ['Show urgency through short sentences and physical reactions', 'Never pause for internal monologue during action — show through body'],
};

export const INTROSPECTIVE_PROFILE: ProseProfile = {
  register: 'literary',
  stance: 'close_third',
  tense: 'past',
  sentenceRhythm: 'flowing',
  interiority: 'deep',
  dialogueWeight: 'sparse',
  devices: ['free_indirect_discourse', 'ironic_understatement', 'extended_metaphor'],
  rules: ['Emotions through landscape and object — the world reflects inner state', 'Let observations accumulate before any character acts'],
};

// ── Compute sampler from scene plans ────────────────────────────────────────

export function computeSamplerFromPlans(scenes: Scene[]): BeatSampler | null {
  const transitionCounts: Record<string, Record<string, number>> = {};
  const mechCounts: Record<string, number> = {};
  let totalBeats = 0;

  for (const scene of scenes) {
    const beats = scene.plan?.beats;
    if (!beats || beats.length === 0) continue;
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      totalBeats++;
      mechCounts[beat.mechanism] = (mechCounts[beat.mechanism] ?? 0) + 1;
      if (i < beats.length - 1) {
        const from = beat.fn;
        const to = beats[i + 1].fn;
        if (!transitionCounts[from]) transitionCounts[from] = {};
        transitionCounts[from][to] = (transitionCounts[from][to] ?? 0) + 1;
      }
    }
  }

  if (totalBeats === 0) return null;

  const markov: BeatTransitionMatrix = {};
  for (const [from, tos] of Object.entries(transitionCounts)) {
    const total = Object.values(tos).reduce((s, n) => s + n, 0);
    markov[from as BeatFn] = Object.fromEntries(
      Object.entries(tos).map(([to, n]) => [to, n / total])
    ) as Partial<Record<BeatFn, number>>;
  }

  const mechanismDistribution: Partial<Record<BeatMechanism, number>> = {};
  for (const [mech, count] of Object.entries(mechCounts)) {
    mechanismDistribution[mech as BeatMechanism] = count / totalBeats;
  }

  // Only count scenes that actually have plans; use real prose word counts when available
  const scenesWithPlans = scenes.filter((s) => s.plan?.beats?.length);
  let avgWordsPerScene = 800;
  const withProse = scenesWithPlans.filter((s) => s.prose);
  if (withProse.length > 0) {
    avgWordsPerScene = Math.round(withProse.reduce((sum, s) => sum + s.prose!.split(/\s+/).length, 0) / withProse.length);
  }
  // Clamp to 6-16 — real works range from 9 (RI) to 12 (default). Values outside this range
  // indicate corrupted data (e.g. plans generated with inflated beat counts).
  const rawBpkw = Math.round((totalBeats / scenesWithPlans.length) / Math.max(avgWordsPerScene, 400) * 1000);
  const beatsPerKWord = Math.min(16, Math.max(6, rawBpkw)) || 12;

  return { markov, mechanismDistribution, beatsPerKWord };
}

/** @deprecated Use computeSamplerFromPlans */
export const computeProfileFromPlans = computeSamplerFromPlans;

// ── Preset management ────────────────────────────────────────────────────────

export let BEAT_PROFILE_PRESETS: BeatProfilePreset[] = [];

export function initBeatProfilePresets(works: { key: string; name: string; narrative: NarrativeState }[]) {
  const presets: BeatProfilePreset[] = [
    { key: 'storyteller',   name: 'Storyteller',   description: 'Balanced fiction',                                    profile: DEFAULT_PROSE_PROFILE, sampler: DEFAULT_BEAT_SAMPLER },
    { key: 'action',        name: 'Action',         description: 'Fast pacing, high advance/turn — action & thrillers', profile: ACTION_PROFILE,        sampler: ACTION_SAMPLER },
    { key: 'introspective', name: 'Introspective',  description: 'Slow pacing, thought-heavy — literary fiction',       profile: INTROSPECTIVE_PROFILE, sampler: INTROSPECTIVE_SAMPLER },
  ];

  for (const { key, name, narrative } of works) {
    if (!narrative.proseProfile) continue;

    const raw = narrative.proseProfile as unknown as Record<string, unknown>;
    const profile: ProseProfile = {
      register:       narrative.proseProfile.register       ?? 'conversational',
      stance:         narrative.proseProfile.stance         ?? 'close_third',
      tense:          narrative.proseProfile.tense,
      sentenceRhythm: narrative.proseProfile.sentenceRhythm,
      interiority:    narrative.proseProfile.interiority,
      dialogueWeight: narrative.proseProfile.dialogueWeight,
      devices:        narrative.proseProfile.devices        ?? [],
      rules:          narrative.proseProfile.rules          ?? [],
    };

    // Compute sampler from scene plans, fallback to stored markovTransitions
    const fromPlans = computeSamplerFromPlans(Object.values(narrative.scenes));
    const rawMarkov = raw.markovTransitions as BeatTransitionMatrix | undefined;
    const rawMechDist = raw.mechanismDistribution as Partial<Record<BeatMechanism, number>> | undefined;
    const rawBeatsPerKWord = raw.avgBeatsPerKWord as number | undefined;
    const sampler: BeatSampler = {
      markov:                fromPlans?.markov                ?? rawMarkov    ?? DEFAULT_BEAT_MATRIX,
      mechanismDistribution: fromPlans?.mechanismDistribution ?? rawMechDist  ?? DEFAULT_MECHANISM_DIST,
      beatsPerKWord:         fromPlans?.beatsPerKWord         ?? rawBeatsPerKWord ?? 12,
    };

    const scenesAnalyzed = raw.scenesAnalyzed as number | undefined;
    presets.push({
      key,
      name,
      description: `${profile.register} ${profile.stance.replace(/_/g, ' ')}${scenesAnalyzed ? ` — ${scenesAnalyzed} scenes` : ''}`,
      profile,
      sampler,
    });
  }

  BEAT_PROFILE_PRESETS = presets;
  return presets;
}

// ── Sampling ─────────────────────────────────────────────────────────────────

export function sampleBeatSequence(
  sampler: BeatSampler,
  length: number,
  startFn: BeatFn = 'breathe',
): BeatFn[] {
  const sequence: BeatFn[] = [];
  let current = startFn;

  for (let i = 0; i < length; i++) {
    sequence.push(current);
    const row = sampler.markov[current];
    if (!row) { current = 'advance'; continue; }

    const r = Math.random();
    let cumulative = 0;
    let next: BeatFn = 'advance';
    for (const [fn, prob] of Object.entries(row)) {
      cumulative += (prob as number);
      if (r <= cumulative) { next = fn as BeatFn; break; }
    }
    current = next;
  }

  return sequence;
}

export function sampleMechanism(sampler: BeatSampler): BeatMechanism {
  const dist = sampler.mechanismDistribution;
  const r = Math.random();
  let cumulative = 0;
  for (const [mech, prob] of Object.entries(dist)) {
    cumulative += (prob as number) ?? 0;
    if (r <= cumulative) return mech as BeatMechanism;
  }
  return 'action';
}

// ── Resolution ───────────────────────────────────────────────────────────────

export function resolveProfile(narrative: NarrativeState): ProseProfile {
  const preset = narrative.storySettings?.beatProfilePreset;
  if (preset === 'self' && narrative.proseProfile) return narrative.proseProfile;
  if (preset) {
    const found = BEAT_PROFILE_PRESETS.find((p) => p.key === preset);
    if (found) return found.profile;
  }
  if (narrative.proseProfile) return narrative.proseProfile;
  return DEFAULT_PROSE_PROFILE;
}

export function resolveSampler(narrative: NarrativeState): BeatSampler {
  const preset = narrative.storySettings?.beatProfilePreset;
  if (preset) {
    const found = BEAT_PROFILE_PRESETS.find((p) => p.key === preset);
    if (found?.sampler) return found.sampler;
  }
  // Compute live from scene plans if available
  const fromPlans = computeSamplerFromPlans(Object.values(narrative.scenes ?? {}));
  if (fromPlans) return fromPlans;
  return DEFAULT_BEAT_SAMPLER;
}
