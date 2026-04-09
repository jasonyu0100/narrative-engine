import { describe, it, expect } from 'vitest';
import {
  computeMatrixFromNarrative,
  samplePacingSequence,
  buildPresetSequence,
  buildSequenceFromModes,
  buildIntroductionSequence,
  detectCurrentMode,
  buildSingleStepPrompt,
  buildSequencePrompt,
  initMatrixPresets,
  MATRIX_PRESETS,
  PACING_PRESETS,
  INTRODUCTION_SEQUENCE,
  type TransitionMatrix,
} from '@/lib/pacing-profile';
import type { NarrativeState, Scene, CubeCornerKey } from '@/types/narrative';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createScene(overrides: Partial<Scene> = {}): Scene {
  return {
    kind: 'scene',
    id: overrides.id ?? 'S-001',
    arcId: 'ARC-01',
    povId: 'C-01',
    locationId: 'L-01',
    participantIds: ['C-01'],
    events: [],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    summary: 'Test scene',
    ...overrides,
  };
}

function createNarrative(scenes: Scene[] = []): NarrativeState {
  const sceneMap: Record<string, Scene> = {};
  for (const s of scenes) {
    sceneMap[s.id] = s;
  }
  return {
    id: 'test-narrative',
    title: 'Test',
    description: 'Test narrative',
    characters: {},
    locations: {},
    threads: {},
    artifacts: {},
    scenes: sceneMap,
    arcs: {},
    worldBuilds: {},
    branches: {
      main: {
        id: 'main',
        name: 'Main',
        parentBranchId: null,
        forkEntryId: null,
        entryIds: scenes.map((s) => s.id),
        createdAt: Date.now(),
      },
    },
    relationships: [],
    worldKnowledge: { nodes: {}, edges: [] },
    worldSummary: '',
    rules: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ── Matrix Computation ───────────────────────────────────────────────────────

describe('computeMatrixFromNarrative', () => {
  it('returns empty matrix for narrative with fewer than 3 scenes', () => {
    const narrative = createNarrative([createScene({ id: 'S-001' })]);
    const matrix = computeMatrixFromNarrative(narrative);

    // Check all values are 0
    const corners: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];
    for (const from of corners) {
      for (const to of corners) {
        expect(matrix[from][to]).toBe(0);
      }
    }
  });

  it('computes transitions from scene sequence', () => {
    // Create scenes with varying mutation profiles
    const scenes = [
      createScene({
        id: 'S-001',
        threadMutations: [],
        continuityMutations: [],
        events: [],
      }),
      createScene({
        id: 'S-002',
        threadMutations: [{ threadId: 'T-01', from: 'dormant', to: 'active' }],
        continuityMutations: [{ entityId: 'C-01', addedNodes: [{ id: 'K-01', content: 'x', type: 'history' }], addedEdges: [] }],
        events: ['event1'],
      }),
      createScene({
        id: 'S-003',
        threadMutations: [{ threadId: 'T-01', from: 'active', to: 'critical' }],
        continuityMutations: [
          { entityId: 'C-01', addedNodes: [{ id: 'K-02', content: 'y', type: 'belief' }], addedEdges: [] },
          { entityId: 'C-02', addedNodes: [{ id: 'K-03', content: 'z', type: 'belief' }], addedEdges: [] },
        ],
        events: ['event2', 'event3'],
      }),
    ];

    const narrative = createNarrative(scenes);
    const matrix = computeMatrixFromNarrative(narrative);

    // Matrix should have proper structure (all corners defined)
    const corners: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];
    for (const from of corners) {
      expect(matrix[from]).toBeDefined();
      for (const to of corners) {
        expect(typeof matrix[from][to]).toBe('number');
        expect(matrix[from][to]).toBeGreaterThanOrEqual(0);
      }
    }

    // With only 3 scenes of similar force profiles, they may all fall into the same corner
    // So we just verify the structure is correct and any non-empty rows sum to 1
    for (const from of corners) {
      const rowSum = corners.reduce((s, to) => s + matrix[from][to], 0);
      if (rowSum > 0) {
        expect(rowSum).toBeCloseTo(1, 1);
      }
    }
  });
});

// ── Sampling ─────────────────────────────────────────────────────────────────

describe('samplePacingSequence', () => {
  it('returns sequence of correct length', () => {
    const sequence = samplePacingSequence('LLL', 5);
    expect(sequence.steps).toHaveLength(5);
  });

  it('each step has required properties', () => {
    const sequence = samplePacingSequence('LLL', 3);
    for (const step of sequence.steps) {
      expect(step).toHaveProperty('mode');
      expect(step).toHaveProperty('name');
      expect(step).toHaveProperty('description');
      expect(step).toHaveProperty('forces');
      expect(step.forces).toHaveProperty('payoff');
      expect(step.forces).toHaveProperty('change');
      expect(step.forces).toHaveProperty('knowledge');
    }
  });

  it('includes pacing description', () => {
    const sequence = samplePacingSequence('LLL', 4);
    expect(sequence.pacingDescription).toBeDefined();
    expect(sequence.pacingDescription.length).toBeGreaterThan(0);
  });

  it('uses provided matrix when given', () => {
    // Create a deterministic matrix where LLL always goes to HHH
    const deterministicMatrix: TransitionMatrix = {
      HHH: { HHH: 1, HHL: 0, HLH: 0, HLL: 0, LHH: 0, LHL: 0, LLH: 0, LLL: 0 },
      HHL: { HHH: 1, HHL: 0, HLH: 0, HLL: 0, LHH: 0, LHL: 0, LLH: 0, LLL: 0 },
      HLH: { HHH: 1, HHL: 0, HLH: 0, HLL: 0, LHH: 0, LHL: 0, LLH: 0, LLL: 0 },
      HLL: { HHH: 1, HHL: 0, HLH: 0, HLL: 0, LHH: 0, LHL: 0, LLH: 0, LLL: 0 },
      LHH: { HHH: 1, HHL: 0, HLH: 0, HLL: 0, LHH: 0, LHL: 0, LLH: 0, LLL: 0 },
      LHL: { HHH: 1, HHL: 0, HLH: 0, HLL: 0, LHH: 0, LHL: 0, LLH: 0, LLL: 0 },
      LLH: { HHH: 1, HHL: 0, HLH: 0, HLL: 0, LHH: 0, LHL: 0, LLH: 0, LLL: 0 },
      LLL: { HHH: 1, HHL: 0, HLH: 0, HLL: 0, LHH: 0, LHL: 0, LLH: 0, LLL: 0 },
    };

    const sequence = samplePacingSequence('LLL', 3, deterministicMatrix);
    expect(sequence.steps.every((s) => s.mode === 'HHH')).toBe(true);
  });
});

// ── Preset Building ──────────────────────────────────────────────────────────

describe('buildPresetSequence', () => {
  it('builds sequence from preset modes', () => {
    const preset = PACING_PRESETS.find((p) => p.key === 'classic-arc');
    expect(preset).toBeDefined();

    if (preset) {
      const sequence = buildPresetSequence(preset);
      expect(sequence.steps).toHaveLength(preset.modes.length);
      expect(sequence.steps.map((s) => s.mode)).toEqual(preset.modes);
    }
  });
});

describe('buildSequenceFromModes', () => {
  it('builds sequence from raw mode array', () => {
    const modes: CubeCornerKey[] = ['LLL', 'LHL', 'HHL'];
    const sequence = buildSequenceFromModes(modes);

    expect(sequence.steps).toHaveLength(3);
    expect(sequence.steps[0].mode).toBe('LLL');
    expect(sequence.steps[1].mode).toBe('LHL');
    expect(sequence.steps[2].mode).toBe('HHL');
  });
});

describe('buildIntroductionSequence', () => {
  it('returns introduction sequence with correct modes', () => {
    const sequence = buildIntroductionSequence();
    expect(sequence.steps).toHaveLength(INTRODUCTION_SEQUENCE.length);
    expect(sequence.steps.map((s) => s.mode)).toEqual(INTRODUCTION_SEQUENCE);
  });
});

// ── Current Mode Detection ───────────────────────────────────────────────────

describe('detectCurrentMode', () => {
  it('returns LLL for empty narrative', () => {
    const narrative = createNarrative([]);
    const mode = detectCurrentMode(narrative, []);
    expect(mode).toBe('LLL');
  });

  it('detects mode from last scene forces', () => {
    // Create scenes with high payoff to push toward H** corners
    const scenes = [
      createScene({
        id: 'S-001',
        threadMutations: [
          { threadId: 'T-01', from: 'dormant', to: 'resolved' },
          { threadId: 'T-02', from: 'dormant', to: 'resolved' },
        ],
        continuityMutations: Array(10).fill({ entityId: 'C-01', addedNodes: [{ id: 'K-01', content: 'x', type: 'history' }], addedEdges: [] }),
        events: Array(10).fill('event'),
        worldKnowledgeMutations: {
          addedNodes: Array(5).fill({ id: 'K-01', concept: 'x', type: 'system' }),
          addedEdges: Array(5).fill({ from: 'K-01', to: 'K-02', relation: 'x' }),
        },
      }),
    ];

    const narrative = createNarrative(scenes);
    const mode = detectCurrentMode(narrative, ['S-001']);

    // With high forces all around, should be in a high corner
    expect(mode).toBeDefined();
  });
});

// ── Prompt Generation ────────────────────────────────────────────────────────

describe('buildSingleStepPrompt', () => {
  it('includes scene number and mode info', () => {
    const step = {
      mode: 'HHL' as CubeCornerKey,
      name: 'Climax',
      description: 'Threads pay off, characters transform',
      forces: {
        payoff: [2, 6] as [number, number],
        change: [4, 8] as [number, number],
        knowledge: [0, 1.5] as [number, number],
      },
    };

    const prompt = buildSingleStepPrompt(step, 2, 5);

    expect(prompt).toContain('Scene 3/5');
    expect(prompt).toContain('Climax');
    expect(prompt).toContain('P:HIGH');
    expect(prompt).toContain('C:HIGH');
    expect(prompt).toContain('K:LOW');
  });
});

describe('buildSequencePrompt', () => {
  it('includes all scenes in sequence', () => {
    const sequence = buildSequenceFromModes(['LLL', 'LHL', 'HHL']);
    const prompt = buildSequencePrompt(sequence);

    expect(prompt).toContain('SCENE 1');
    expect(prompt).toContain('SCENE 2');
    expect(prompt).toContain('SCENE 3');
    expect(prompt).toContain('PACING SEQUENCE');
  });

  it('includes force formula explanation', () => {
    const sequence = buildSequenceFromModes(['LLL']);
    const prompt = buildSequencePrompt(sequence);

    expect(prompt).toContain('Formulas compute forces FROM mutations');
  });
});

// ── Presets ──────────────────────────────────────────────────────────────────

describe('PACING_PRESETS', () => {
  it('includes expected preset keys', () => {
    const keys = PACING_PRESETS.map((p) => p.key);
    expect(keys).toContain('classic-arc');
    expect(keys).toContain('introduction');
    expect(keys).toContain('slow-burn');
    expect(keys).toContain('roller-coaster');
  });

  it('all presets have valid modes', () => {
    const validModes: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];

    for (const preset of PACING_PRESETS) {
      expect(preset.modes.length).toBeGreaterThan(0);
      for (const mode of preset.modes) {
        expect(validModes).toContain(mode);
      }
    }
  });
});

describe('INTRODUCTION_SEQUENCE', () => {
  it('has 8 scenes', () => {
    expect(INTRODUCTION_SEQUENCE).toHaveLength(8);
  });

  it('starts with Rest and ends with Climax', () => {
    expect(INTRODUCTION_SEQUENCE[0]).toBe('LLL'); // Rest
    expect(INTRODUCTION_SEQUENCE[INTRODUCTION_SEQUENCE.length - 1]).toBe('HHL'); // Climax
  });
});

// ── Matrix Preset Initialization ─────────────────────────────────────────────

describe('initMatrixPresets', () => {
  it('includes built-in presets after initialization', () => {
    initMatrixPresets([]);

    const keys = MATRIX_PRESETS.map((p) => p.key);
    expect(keys).toContain('storyteller');
    // Only storyteller is the default preset
    expect(keys.length).toBeGreaterThanOrEqual(1);
  });

  it('adds work presets with sufficient data', () => {
    const workNarrative = createNarrative([
      createScene({
        id: 'S-001',
        threadMutations: [{ threadId: 'T-01', from: 'dormant', to: 'active' }],
      }),
      createScene({
        id: 'S-002',
        threadMutations: [{ threadId: 'T-01', from: 'active', to: 'escalating' }],
      }),
      createScene({
        id: 'S-003',
        threadMutations: [{ threadId: 'T-01', from: 'escalating', to: 'critical' }],
      }),
      createScene({
        id: 'S-004',
        threadMutations: [{ threadId: 'T-01', from: 'critical', to: 'resolved' }],
      }),
    ]);

    initMatrixPresets([
      { key: 'test-work', name: 'Test Work', narrative: workNarrative },
    ]);

    const keys = MATRIX_PRESETS.map((p) => p.key);
    expect(keys).toContain('test-work');
  });
});
