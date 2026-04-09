import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_BEAT_MATRIX,
  DEFAULT_FN_MECHANISM_DIST,
  DEFAULT_BEAT_SAMPLER,
  DEFAULT_PROSE_PROFILE,
  computeSamplerFromPlans,
  initBeatProfilePresets,
  sampleMechanismForFn,
  sampleBeatSequence,
  resolveProfile,
  resolveSampler,
  BEAT_PROFILE_PRESETS,
} from '@/lib/beat-profiles';
import { BEATS_PER_KWORD } from '@/lib/constants';
import { DEFAULT_MECHANISM_DIST } from '@/lib/mechanism-profiles';
import type { Scene, NarrativeState, BeatSampler, BeatFn, BeatMechanism } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS } from '@/types/narrative';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createMinimalNarrative(overrides: Partial<NarrativeState> = {}): NarrativeState {
  return {
    id: 'test-narrative',
    title: 'Test',
    description: 'Test narrative',
    characters: {},
    locations: {},
    threads: {},
    artifacts: {},
    scenes: {},
    arcs: {},
    worldBuilds: {},
    branches: {
      main: {
        id: 'main',
        name: 'Main',
        parentBranchId: null,
        forkEntryId: null,
        entryIds: [],
        createdAt: Date.now(),
      },
    },
    relationships: [],
    worldKnowledge: { nodes: {}, edges: [] },
    worldSummary: '',
    rules: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createSceneWithPlan(
  id: string,
  beats: Array<{ fn: BeatFn; mechanism: BeatMechanism }>,
  prose?: string
): Scene {
  const plan = {
    beats: beats.map((b, i) => ({
      index: i,
      fn: b.fn,
      mechanism: b.mechanism,
      summary: `Beat ${i}`,
      characterId: 'char-1',
      characterName: 'Test Character',
      locationShift: null,
      what: `Beat ${i} action`,
      propositions: [{ content: '' }],
    })),
    propositions: [],
  };

  const scene: Scene = {
    kind: 'scene',
    id,
    arcId: 'arc-1',
    povId: 'char-1',
    locationId: 'loc-1',
    participantIds: [],
    summary: 'Test scene',
    events: [],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    characterMovements: {},
    planVersions: [{
      version: '1.0.0',
      branchId: 'main',
      plan,
      timestamp: Date.now(),
      versionType: 'generate',
    }],
  };

  if (prose) {
    scene.proseVersions = [{
      version: '1.0.0',
      branchId: 'main',
      prose,
      timestamp: Date.now(),
      versionType: 'generate',
    }];
  }

  return scene;
}

// ── DEFAULT exports ──────────────────────────────────────────────────────────

describe('DEFAULT exports', () => {
  it('DEFAULT_BEAT_MATRIX has all 10 beat functions as keys', () => {
    const beatFns: BeatFn[] = ['breathe', 'inform', 'advance', 'bond', 'turn', 'reveal', 'shift', 'expand', 'foreshadow', 'resolve'];
    for (const fn of beatFns) {
      expect(DEFAULT_BEAT_MATRIX[fn]).toBeDefined();
    }
  });

  it('DEFAULT_BEAT_MATRIX rows sum to approximately 1', () => {
    for (const row of Object.values(DEFAULT_BEAT_MATRIX)) {
      const sum = Object.values(row).reduce((s, p) => s + (p ?? 0), 0);
      expect(sum).toBeCloseTo(1, 1);
    }
  });

  it('DEFAULT_MECHANISM_DIST sums to approximately 1', () => {
    const sum = Object.values(DEFAULT_MECHANISM_DIST).reduce((s, p) => s + (p ?? 0), 0);
    expect(sum).toBeCloseTo(1, 1);
  });

  it('DEFAULT_BEAT_SAMPLER has required fields', () => {
    expect(DEFAULT_BEAT_SAMPLER.markov).toBe(DEFAULT_BEAT_MATRIX);
    expect(DEFAULT_BEAT_SAMPLER.fnMechanismDistribution).toBe(DEFAULT_FN_MECHANISM_DIST);
    expect(DEFAULT_BEAT_SAMPLER.beatsPerKWord).toBe(BEATS_PER_KWORD);
  });

  it('DEFAULT_PROSE_PROFILE has required fields', () => {
    expect(DEFAULT_PROSE_PROFILE.register).toBe('conversational');
    expect(DEFAULT_PROSE_PROFILE.stance).toBe('close_third');
    expect(DEFAULT_PROSE_PROFILE.devices).toContain('free_indirect_discourse');
    expect(DEFAULT_PROSE_PROFILE.rules.length).toBeGreaterThan(0);
    expect(DEFAULT_PROSE_PROFILE.antiPatterns!.length).toBeGreaterThan(0);
  });

});

// ── computeSamplerFromPlans ──────────────────────────────────────────────────

describe('computeSamplerFromPlans', () => {
  it('returns null for empty scenes array', () => {
    const result = computeSamplerFromPlans([]);
    expect(result).toBeNull();
  });

  it('returns null when no scenes have plans', () => {
    const scenes: Scene[] = [
      { ...createSceneWithPlan('s1', []), planVersions: undefined },
    ];
    const result = computeSamplerFromPlans(scenes);
    expect(result).toBeNull();
  });

  it('returns null when plans have no beats', () => {
    const scene = createSceneWithPlan('s1', []);
    const result = computeSamplerFromPlans([scene]);
    expect(result).toBeNull();
  });

  it('computes fn-conditioned mechanism distribution from beats', () => {
    const scenes = [
      createSceneWithPlan('s1', [
        { fn: 'breathe', mechanism: 'dialogue' },
        { fn: 'inform', mechanism: 'dialogue' },
        { fn: 'advance', mechanism: 'action' },
        { fn: 'turn', mechanism: 'narration' },
      ]),
    ];

    const result = computeSamplerFromPlans(scenes);
    expect(result).not.toBeNull();
    // Each fn has 1 beat, so mechanism is 100% for that fn
    expect(result!.fnMechanismDistribution.breathe?.dialogue).toBe(1);
    expect(result!.fnMechanismDistribution.inform?.dialogue).toBe(1);
    expect(result!.fnMechanismDistribution.advance?.action).toBe(1);
    expect(result!.fnMechanismDistribution.turn?.narration).toBe(1);
  });

  it('computes markov transitions from beat sequences', () => {
    const scenes = [
      createSceneWithPlan('s1', [
        { fn: 'breathe', mechanism: 'dialogue' },
        { fn: 'inform', mechanism: 'dialogue' },
        { fn: 'inform', mechanism: 'action' },
        { fn: 'advance', mechanism: 'action' },
      ]),
    ];

    const result = computeSamplerFromPlans(scenes);
    expect(result).not.toBeNull();
    // breathe -> inform (1 transition)
    expect(result!.markov.breathe?.inform).toBe(1);
    // inform -> inform and inform -> advance (2 transitions from inform)
    expect(result!.markov.inform?.inform).toBe(0.5);
    expect(result!.markov.inform?.advance).toBe(0.5);
  });

  it('computes beatsPerKWord clamped between 6 and 16', () => {
    // Scene with 4 beats and 800 words prose (default estimate)
    const scenes = [
      createSceneWithPlan('s1', [
        { fn: 'breathe', mechanism: 'dialogue' },
        { fn: 'inform', mechanism: 'dialogue' },
        { fn: 'advance', mechanism: 'action' },
        { fn: 'turn', mechanism: 'action' },
      ], 'word '.repeat(800)),
    ];

    const result = computeSamplerFromPlans(scenes);
    expect(result).not.toBeNull();
    expect(result!.beatsPerKWord).toBeGreaterThanOrEqual(6);
    expect(result!.beatsPerKWord).toBeLessThanOrEqual(16);
  });

  it('aggregates transitions across multiple scenes', () => {
    const scenes = [
      createSceneWithPlan('s1', [
        { fn: 'breathe', mechanism: 'dialogue' },
        { fn: 'inform', mechanism: 'dialogue' },
      ]),
      createSceneWithPlan('s2', [
        { fn: 'breathe', mechanism: 'action' },
        { fn: 'advance', mechanism: 'action' },
      ]),
    ];

    const result = computeSamplerFromPlans(scenes);
    expect(result).not.toBeNull();
    // breathe -> inform (1) and breathe -> advance (1)
    expect(result!.markov.breathe?.inform).toBe(0.5);
    expect(result!.markov.breathe?.advance).toBe(0.5);
  });
});

// ── initBeatProfilePresets ───────────────────────────────────────────────────

describe('initBeatProfilePresets', () => {
  beforeEach(() => {
    // Reset presets before each test
    initBeatProfilePresets([]);
  });

  it('includes built-in presets (storyteller, action, introspective)', () => {
    const presets = initBeatProfilePresets([]);
    expect(presets.length).toBe(1);
    expect(presets.map((p) => p.key)).toEqual(['storyteller']);
  });

  it('adds presets from works with proseProfile', () => {
    const narrative = createMinimalNarrative({
      proseProfile: {
        register: 'literary',
        stance: 'omniscient',
        devices: ['metaphor'],
        rules: ['Rule 1'],
        antiPatterns: ['Anti 1'],
      },
    });

    const presets = initBeatProfilePresets([
      { key: 'custom', name: 'Custom Work', narrative },
    ]);

    expect(presets.length).toBe(2); // Storyteller + 1 work
    const customPreset = presets.find((p) => p.key === 'custom');
    expect(customPreset).toBeDefined();
    expect(customPreset!.name).toBe('Custom Work');
    expect(customPreset!.profile.register).toBe('literary');
    expect(customPreset!.profile.stance).toBe('omniscient');
  });

  it('skips works without proseProfile', () => {
    const narrative = createMinimalNarrative(); // no proseProfile

    const presets = initBeatProfilePresets([
      { key: 'no-profile', name: 'No Profile', narrative },
    ]);

    expect(presets.length).toBe(1); // only Storyteller
    expect(presets.find((p) => p.key === 'no-profile')).toBeUndefined();
  });

  it('computes sampler from scene plans when available', () => {
    const narrative = createMinimalNarrative({
      proseProfile: {
        register: 'conversational',
        stance: 'close_third',
        devices: [],
        rules: [],
        antiPatterns: [],
      },
      scenes: {
        's1': createSceneWithPlan('s1', [
          { fn: 'breathe', mechanism: 'dialogue' },
          { fn: 'inform', mechanism: 'dialogue' },
        ]),
      },
    });

    const presets = initBeatProfilePresets([
      { key: 'with-scenes', name: 'With Scenes', narrative },
    ]);

    const preset = presets.find((p) => p.key === 'with-scenes');
    expect(preset).toBeDefined();
    expect(preset!.sampler!.markov.breathe?.inform).toBe(1);
  });

  it('updates BEAT_PROFILE_PRESETS module variable', () => {
    initBeatProfilePresets([]);
    expect(BEAT_PROFILE_PRESETS.length).toBe(1);
    expect(BEAT_PROFILE_PRESETS.map((p) => p.key)).toEqual(['storyteller']);
  });
});

// ── sampleMechanismForFn ─────────────────────────────────────────────────────

describe('sampleMechanismForFn', () => {
  it('returns a valid mechanism', () => {
    const mechanism = sampleMechanismForFn(DEFAULT_BEAT_SAMPLER, 'breathe');
    const validMechanisms: BeatMechanism[] = ['dialogue', 'action', 'narration', 'environment', 'thought', 'document', 'memory', 'comic'];
    expect(validMechanisms).toContain(mechanism);
  });

  it('falls back to DEFAULT_FN_MECHANISM_DIST when sampler distribution is empty', () => {
    const emptySampler: BeatSampler = {
      markov: {},
      fnMechanismDistribution: {},
      beatsPerKWord: 12,
    };
    // When sampler has empty distribution, falls back to DEFAULT_FN_MECHANISM_DIST
    const mechanism = sampleMechanismForFn(emptySampler, 'breathe');
    const validMechanisms: BeatMechanism[] = ['dialogue', 'action', 'narration', 'environment', 'thought', 'document', 'memory', 'comic'];
    expect(validMechanisms).toContain(mechanism);
  });

  it('respects fn-conditioned distribution probabilities', () => {
    // Create a sampler with 100% dialogue for breathe
    const sampler: BeatSampler = {
      markov: {},
      fnMechanismDistribution: { breathe: { dialogue: 1.0 } },
      beatsPerKWord: 12,
    };

    const samples: BeatMechanism[] = [];
    for (let i = 0; i < 100; i++) {
      samples.push(sampleMechanismForFn(sampler, 'breathe'));
    }

    // All samples should be dialogue
    expect(samples.every((m) => m === 'dialogue')).toBe(true);
  });

  it('produces distribution matching input over many samples', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => 0.15);

    const sampler: BeatSampler = {
      markov: {},
      fnMechanismDistribution: { inform: { dialogue: 0.5, action: 0.5 } },
      beatsPerKWord: 12,
    };

    // With random = 0.15, should get dialogue (cumulative 0.5 > 0.15)
    expect(sampleMechanismForFn(sampler, 'inform')).toBe('dialogue');

    vi.spyOn(Math, 'random').mockImplementation(() => 0.75);
    // With random = 0.75, should get action (cumulative 1.0 > 0.75)
    expect(sampleMechanismForFn(sampler, 'inform')).toBe('action');

    vi.restoreAllMocks();
  });

  it('uses DEFAULT_FN_MECHANISM_DIST when fn not in sampler', () => {
    const sampler: BeatSampler = {
      markov: {},
      fnMechanismDistribution: {}, // Empty, will fall back to defaults
      beatsPerKWord: 12,
    };

    // Should fall back to DEFAULT_FN_MECHANISM_DIST for breathe
    const mechanism = sampleMechanismForFn(sampler, 'breathe');
    const validMechanisms: BeatMechanism[] = ['dialogue', 'action', 'narration', 'environment', 'thought', 'document', 'memory', 'comic'];
    expect(validMechanisms).toContain(mechanism);
  });
});

// ── sampleBeatSequence ───────────────────────────────────────────────────────

describe('sampleBeatSequence', () => {
  it('returns sequence of specified length', () => {
    const sequence = sampleBeatSequence(DEFAULT_BEAT_SAMPLER, 5);
    expect(sequence.length).toBe(5);
  });

  it('returns empty sequence for length 0', () => {
    const sequence = sampleBeatSequence(DEFAULT_BEAT_SAMPLER, 0);
    expect(sequence.length).toBe(0);
  });

  it('starts with specified startFn', () => {
    const sequence = sampleBeatSequence(DEFAULT_BEAT_SAMPLER, 3, 'turn');
    expect(sequence[0].fn).toBe('turn');
  });

  it('starts with breathe by default', () => {
    const sequence = sampleBeatSequence(DEFAULT_BEAT_SAMPLER, 3);
    expect(sequence[0].fn).toBe('breathe');
  });

  it('each beat has fn and mechanism', () => {
    const sequence = sampleBeatSequence(DEFAULT_BEAT_SAMPLER, 3);
    for (const beat of sequence) {
      expect(beat.fn).toBeDefined();
      expect(beat.mechanism).toBeDefined();
    }
  });

  it('falls back to advance when markov row is missing', () => {
    const sparseMatrixSampler: BeatSampler = {
      markov: {
        breathe: { inform: 1.0 },
        // Missing 'inform' row
      },
      fnMechanismDistribution: { breathe: { action: 1.0 }, inform: { action: 1.0 }, advance: { action: 1.0 } },
      beatsPerKWord: 12,
    };

    const sequence = sampleBeatSequence(sparseMatrixSampler, 3, 'breathe');
    // breathe -> inform (from matrix)
    expect(sequence[0].fn).toBe('breathe');
    // inform -> advance (fallback, no row for inform)
    expect(sequence[1].fn).toBe('inform');
    expect(sequence[2].fn).toBe('advance');
  });

  it('respects markov transitions', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => 0.1);

    const deterministicSampler: BeatSampler = {
      markov: {
        breathe: { inform: 1.0 },
        inform: { advance: 1.0 },
        advance: { turn: 1.0 },
      },
      fnMechanismDistribution: { breathe: { action: 1.0 }, inform: { action: 1.0 }, advance: { action: 1.0 }, turn: { action: 1.0 } },
      beatsPerKWord: 12,
    };

    const sequence = sampleBeatSequence(deterministicSampler, 4, 'breathe');
    expect(sequence.map((b) => b.fn)).toEqual(['breathe', 'inform', 'advance', 'turn']);

    vi.restoreAllMocks();
  });
});

// ── resolveProfile ───────────────────────────────────────────────────────────

describe('resolveProfile', () => {
  beforeEach(() => {
    initBeatProfilePresets([]);
  });

  it('returns DEFAULT_PROSE_PROFILE when no settings or proseProfile', () => {
    const narrative = createMinimalNarrative();
    const profile = resolveProfile(narrative);
    expect(profile).toBe(DEFAULT_PROSE_PROFILE);
  });

  it('returns narrative proseProfile when no preset specified', () => {
    const customProfile = {
      register: 'literary' as const,
      stance: 'omniscient' as const,
      devices: ['metaphor' as const],
      rules: ['custom rule'],
      antiPatterns: ['custom anti'],
    };
    const narrative = createMinimalNarrative({ proseProfile: customProfile });
    const profile = resolveProfile(narrative);
    expect(profile).toBe(customProfile);
  });

  it('returns default profile when preset key has no match', () => {
    const narrative = createMinimalNarrative({
      storySettings: { ...DEFAULT_STORY_SETTINGS, beatProfilePreset: 'nonexistent' },
    });
    const profile = resolveProfile(narrative);
    expect(profile).toBe(DEFAULT_PROSE_PROFILE);
  });

  it('returns narrative proseProfile for preset="self"', () => {
    const customProfile = {
      register: 'raw' as const,
      stance: 'close_third' as const,
      devices: [],
      rules: [],
      antiPatterns: [],
    };
    const narrative = createMinimalNarrative({
      proseProfile: customProfile,
      storySettings: { ...DEFAULT_STORY_SETTINGS, beatProfilePreset: 'self' },
    });
    const profile = resolveProfile(narrative);
    expect(profile).toBe(customProfile);
  });

  it('falls back to DEFAULT_PROSE_PROFILE when preset not found', () => {
    const narrative = createMinimalNarrative({
      storySettings: { ...DEFAULT_STORY_SETTINGS, beatProfilePreset: 'nonexistent' },
    });
    const profile = resolveProfile(narrative);
    expect(profile).toBe(DEFAULT_PROSE_PROFILE);
  });

  it('falls back to narrative proseProfile when preset not found but profile exists', () => {
    const customProfile = {
      register: 'literary' as const,
      stance: 'close_third' as const,
      devices: [],
      rules: [],
      antiPatterns: [],
    };
    const narrative = createMinimalNarrative({
      proseProfile: customProfile,
      storySettings: { ...DEFAULT_STORY_SETTINGS, beatProfilePreset: 'nonexistent' },
    });
    const profile = resolveProfile(narrative);
    expect(profile).toBe(customProfile);
  });
});

// ── resolveSampler ───────────────────────────────────────────────────────────

describe('resolveSampler', () => {
  beforeEach(() => {
    initBeatProfilePresets([]);
  });

  it('returns DEFAULT_BEAT_SAMPLER when no settings or scenes', () => {
    const narrative = createMinimalNarrative();
    const sampler = resolveSampler(narrative);
    expect(sampler).toStrictEqual(DEFAULT_BEAT_SAMPLER);
  });

  it('returns preset sampler when preset key matches', () => {
    const narrative = createMinimalNarrative({
      storySettings: { ...DEFAULT_STORY_SETTINGS, beatProfilePreset: 'storyteller' },
    });
    const sampler = resolveSampler(narrative);
    expect(sampler.beatsPerKWord).toBe(DEFAULT_BEAT_SAMPLER.beatsPerKWord);
  });

  it('computes sampler from scenes when no preset', () => {
    const narrative = createMinimalNarrative({
      scenes: {
        's1': createSceneWithPlan('s1', [
          { fn: 'breathe', mechanism: 'thought' },
          { fn: 'inform', mechanism: 'thought' },
        ]),
      },
    });
    const sampler = resolveSampler(narrative, 'main');
    expect(sampler.fnMechanismDistribution.breathe?.thought).toBe(1);
    expect(sampler.fnMechanismDistribution.inform?.thought).toBe(1);
    expect(sampler.markov.breathe?.inform).toBe(1);
  });

  it('falls back to DEFAULT_BEAT_SAMPLER when preset not found and no scenes', () => {
    const narrative = createMinimalNarrative({
      storySettings: { ...DEFAULT_STORY_SETTINGS, beatProfilePreset: 'nonexistent' },
    });
    const sampler = resolveSampler(narrative);
    expect(sampler).toStrictEqual(DEFAULT_BEAT_SAMPLER);
  });

  it('handles undefined scenes gracefully', () => {
    const narrative = createMinimalNarrative();
    // @ts-expect-error - testing undefined handling
    narrative.scenes = undefined;
    const sampler = resolveSampler(narrative);
    expect(sampler).toStrictEqual(DEFAULT_BEAT_SAMPLER);
  });
});
