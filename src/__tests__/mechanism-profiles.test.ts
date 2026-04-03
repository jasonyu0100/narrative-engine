/**
 * Tests for mechanism profile system
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  initMechanismProfilePresets,
  MECHANISM_PROFILE_PRESETS,
  computeMechanismDist,
  resolveMechanismDist,
  DEFAULT_MECHANISM_DIST,
} from '@/lib/mechanism-profiles';
import type { NarrativeState, Scene, BeatMechanism } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS } from '@/types/narrative';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createMinimalNarrative(overrides?: Partial<NarrativeState>): NarrativeState {
  return {
    id: 'test-narrative',
    title: 'Test Narrative',
    description: 'Test',
    characters: {},
    locations: {},
    threads: {},
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
    artifacts: {},
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
  beats: Array<{ fn: string; mechanism: BeatMechanism }>,
): Scene {
  return {
    kind: 'scene',
    id,
    arcId: 'arc-1',
    povId: 'c1',
    locationId: 'loc1',
    participantIds: ['c1'],
    events: [],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    characterMovements: {},
    summary: 'Test scene',
    plan: {
      beats: beats.map((b) => ({ fn: b.fn as any, mechanism: b.mechanism, content: 'test' })),
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('computeMechanismDist', () => {
  it('returns null when no scenes have plans', () => {
    const scenes: Scene[] = [
      createSceneWithPlan('s1', []),
    ];
    const dist = computeMechanismDist(scenes);
    expect(dist).toBeNull();
  });

  it('computes distribution from single scene', () => {
    const scenes = [
      createSceneWithPlan('s1', [
        { fn: 'breathe', mechanism: 'dialogue' },
        { fn: 'inform', mechanism: 'dialogue' },
        { fn: 'advance', mechanism: 'action' },
      ]),
    ];
    const dist = computeMechanismDist(scenes);
    expect(dist).toBeDefined();
    expect(dist!.dialogue).toBeCloseTo(2 / 3);
    expect(dist!.action).toBeCloseTo(1 / 3);
  });

  it('computes distribution across multiple scenes', () => {
    const scenes = [
      createSceneWithPlan('s1', [
        { fn: 'breathe', mechanism: 'dialogue' },
        { fn: 'inform', mechanism: 'thought' },
      ]),
      createSceneWithPlan('s2', [
        { fn: 'advance', mechanism: 'action' },
        { fn: 'breathe', mechanism: 'action' },
      ]),
    ];
    const dist = computeMechanismDist(scenes);
    expect(dist).toBeDefined();
    expect(dist!.dialogue).toBe(0.25);
    expect(dist!.thought).toBe(0.25);
    expect(dist!.action).toBe(0.5);
  });

  it('handles scenes without plans gracefully', () => {
    const scenes = [
      createSceneWithPlan('s1', [
        { fn: 'breathe', mechanism: 'dialogue' },
      ]),
      {
        ...createSceneWithPlan('s2', []),
        plan: undefined,
      },
    ];
    const dist = computeMechanismDist(scenes);
    expect(dist).toBeDefined();
    expect(dist!.dialogue).toBe(1.0);
  });
});

describe('initMechanismProfilePresets', () => {
  beforeEach(() => {
    // Reset presets before each test
    initMechanismProfilePresets([]);
  });

  it('creates Storyteller default preset', () => {
    const presets = initMechanismProfilePresets([]);
    expect(presets.length).toBe(1);
    expect(presets[0].key).toBe('storyteller');
    expect(presets[0].name).toBe('Storyteller');
    expect(presets[0].distribution).toEqual(DEFAULT_MECHANISM_DIST);
  });

  it('adds presets from works with scene plans', () => {
    const narrative = createMinimalNarrative({
      scenes: {
        s1: createSceneWithPlan('s1', [
          { fn: 'breathe', mechanism: 'dialogue' },
          { fn: 'inform', mechanism: 'thought' },
        ]),
        s2: createSceneWithPlan('s2', [
          { fn: 'advance', mechanism: 'action' },
        ]),
      },
    });

    const presets = initMechanismProfilePresets([
      { key: 'custom', name: 'Custom Work', narrative },
    ]);

    expect(presets.length).toBe(2); // Storyteller + custom
    const customPreset = presets.find((p) => p.key === 'custom');
    expect(customPreset).toBeDefined();
    expect(customPreset!.name).toBe('Custom Work');
    expect(customPreset!.distribution.dialogue).toBeCloseTo(1 / 3);
    expect(customPreset!.distribution.thought).toBeCloseTo(1 / 3);
    expect(customPreset!.distribution.action).toBeCloseTo(1 / 3);
  });

  it('skips works without scene plans', () => {
    const narrative = createMinimalNarrative(); // no scenes with plans

    const presets = initMechanismProfilePresets([
      { key: 'no-plans', name: 'No Plans', narrative },
    ]);

    expect(presets.length).toBe(1); // only Storyteller
    expect(presets.find((p) => p.key === 'no-plans')).toBeUndefined();
  });

  it('falls back to stored mechanismDistribution if no scene plans', () => {
    const narrative = createMinimalNarrative({
      proseProfile: {
        register: 'conversational',
        stance: 'close_third',
        devices: [],
        rules: [],
        antiPatterns: [],
        // @ts-expect-error - testing legacy stored distribution
        mechanismDistribution: { dialogue: 0.8, action: 0.2 },
      },
    });

    const presets = initMechanismProfilePresets([
      { key: 'legacy', name: 'Legacy', narrative },
    ]);

    expect(presets.length).toBe(1); // Skipped because no distribution computed from plans
  });

  it('updates MECHANISM_PROFILE_PRESETS global', () => {
    const narrative = createMinimalNarrative({
      scenes: {
        s1: createSceneWithPlan('s1', [
          { fn: 'breathe', mechanism: 'dialogue' },
        ]),
      },
    });

    initMechanismProfilePresets([
      { key: 'work1', name: 'Work 1', narrative },
    ]);

    expect(MECHANISM_PROFILE_PRESETS.length).toBe(2);
    expect(MECHANISM_PROFILE_PRESETS.map((p) => p.key)).toContain('storyteller');
    expect(MECHANISM_PROFILE_PRESETS.map((p) => p.key)).toContain('work1');
  });
});

describe('resolveMechanismDist', () => {
  beforeEach(() => {
    // Set up some presets for testing
    const narrative = createMinimalNarrative({
      scenes: {
        s1: createSceneWithPlan('s1', [
          { fn: 'breathe', mechanism: 'thought' },
        ]),
      },
    });
    initMechanismProfilePresets([
      { key: 'test-preset', name: 'Test Preset', narrative },
    ]);
  });

  it('returns DEFAULT_MECHANISM_DIST when no settings or scenes', () => {
    const narrative = createMinimalNarrative();
    const dist = resolveMechanismDist(narrative);
    expect(dist).toEqual(DEFAULT_MECHANISM_DIST);
  });

  it('returns preset distribution when preset key matches', () => {
    const narrative = createMinimalNarrative({
      storySettings: { ...DEFAULT_STORY_SETTINGS, mechanismProfilePreset: 'storyteller' },
    });
    const dist = resolveMechanismDist(narrative);
    expect(dist).toEqual(DEFAULT_MECHANISM_DIST);
  });

  it('computes distribution from scenes when no preset', () => {
    const narrative = createMinimalNarrative({
      scenes: {
        s1: createSceneWithPlan('s1', [
          { fn: 'breathe', mechanism: 'dialogue' },
          { fn: 'inform', mechanism: 'dialogue' },
          { fn: 'advance', mechanism: 'action' },
        ]),
      },
    });
    const dist = resolveMechanismDist(narrative);
    expect(dist.dialogue).toBeCloseTo(2 / 3);
    expect(dist.action).toBeCloseTo(1 / 3);
  });

  it('falls back to DEFAULT_MECHANISM_DIST when preset not found and no scenes', () => {
    const narrative = createMinimalNarrative({
      storySettings: { ...DEFAULT_STORY_SETTINGS, mechanismProfilePreset: 'nonexistent' },
    });
    const dist = resolveMechanismDist(narrative);
    expect(dist).toEqual(DEFAULT_MECHANISM_DIST);
  });

  it('handles undefined scenes gracefully', () => {
    const narrative = createMinimalNarrative();
    // @ts-expect-error - testing undefined handling
    narrative.scenes = undefined;
    const dist = resolveMechanismDist(narrative);
    expect(dist).toEqual(DEFAULT_MECHANISM_DIST);
  });

  it('resolves custom preset correctly', () => {
    const narrative = createMinimalNarrative({
      storySettings: { ...DEFAULT_STORY_SETTINGS, mechanismProfilePreset: 'test-preset' },
    });
    const dist = resolveMechanismDist(narrative);
    // test-preset was initialized with thought: 1.0
    expect(dist.thought).toBe(1.0);
  });
});
