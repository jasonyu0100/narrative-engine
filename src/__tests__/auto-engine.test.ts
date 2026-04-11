import { describe, it, expect } from 'vitest';
import type { NarrativeState, Scene, Thread, Character, Location, AutoConfig } from '@/types/narrative';
import {
  computeStoryProgress,
  getStoryPhase,
  checkEndConditions,
  evaluateNarrativeState,
  pickArcLength,
  pickCubeGoal,
  buildOutlineDirective,
  type StoryPhase,
  type DirectiveContext,
} from '@/lib/auto-engine';
import { AUTO_STOP_CYCLE_LENGTH } from '@/lib/constants';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createScene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    kind: 'scene',
    id,
    arcId: 'arc-1',
    povId: 'char-1',
    locationId: 'loc-1',
    participantIds: ['char-1'],
    summary: `Scene ${id} summary`,
    events: ['Event 1'],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    characterMovements: {},
    ...overrides,
  };
}

function createThread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    description: `Thread ${id} description`,
    status: 'active',
    participants: [],
    dependents: [],
    openedAt: 's1',
    threadLog: { nodes: {}, edges: [] },
    ...overrides,
  };
}

function createCharacter(id: string, overrides: Partial<Character> = {}): Character {
  return {
    id,
    name: `Character ${id}`,
    role: 'recurring',
    threadIds: [],
    continuity: { nodes: {}, edges: [] },
    ...overrides,
  };
}

function createLocation(id: string, overrides: Partial<Location> = {}): Location {
  return {
    id,
    name: `Location ${id}`,
    prominence: 'place' as const,
    parentId: null,
    tiedCharacterIds: [],
    threadIds: [],
    continuity: { nodes: {}, edges: [] },
    ...overrides,
  };
}

function createMinimalNarrative(): NarrativeState {
  return {
    id: 'N-001',
    title: 'Test Narrative',
    description: 'A test story',
    characters: {
      'char-1': createCharacter('char-1', { name: 'Alice' }),
    },
    locations: {
      'loc-1': createLocation('loc-1', { name: 'Castle' }),
    },
    threads: {
      'T-001': createThread('T-001', { description: 'Main mystery' }),
    },
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
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: '',
    rules: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createAutoConfig(overrides: Partial<AutoConfig> = {}): AutoConfig {
  return {
    endConditions: [],
    direction: 'Continue the story',
    minArcLength: 3,
    maxArcLength: 8,
    maxActiveThreads: 5,
    threadStagnationThreshold: 3,
    toneGuidance: '',
    narrativeConstraints: '',
    characterRotationEnabled: true,
    minScenesBetweenCharacterFocus: 5,
    ...overrides,
  };
}

// ── computeStoryProgress Tests ───────────────────────────────────────────────

describe('computeStoryProgress', () => {
  it('returns 0 at start with scene_count condition', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 20 }],
    });

    const progress = computeStoryProgress(narrative, [], config, 0, 0);
    expect(progress).toBe(0);
  });

  it('returns 0.5 when halfway through scene_count target', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 20 }],
    });
    const resolvedKeys = Array.from({ length: 10 }, (_, i) => `S-${i}`);

    const progress = computeStoryProgress(narrative, resolvedKeys, config, 0, 0);
    expect(progress).toBe(0.5);
  });

  it('clamps to 1 when exceeding scene_count target', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 10 }],
    });
    const resolvedKeys = Array.from({ length: 15 }, (_, i) => `S-${i}`);

    const progress = computeStoryProgress(narrative, resolvedKeys, config, 0, 0);
    expect(progress).toBe(1);
  });

  it('uses arc_count condition', () => {
    const narrative = createMinimalNarrative();
    narrative.arcs = {
      'arc-1': { id: 'arc-1', name: 'Arc 1', sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
      'arc-2': { id: 'arc-2', name: 'Arc 2', sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
      'arc-3': { id: 'arc-3', name: 'Arc 3', sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
    };
    const config = createAutoConfig({
      endConditions: [{ type: 'arc_count', target: 6 }],
    });

    const progress = computeStoryProgress(narrative, [], config, 0, 0);
    expect(progress).toBe(0.5);
  });

  it('accounts for startingArcCount', () => {
    const narrative = createMinimalNarrative();
    narrative.arcs = {
      'arc-1': { id: 'arc-1', name: 'Arc 1', sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
      'arc-2': { id: 'arc-2', name: 'Arc 2', sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
      'arc-3': { id: 'arc-3', name: 'Arc 3', sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
    };
    const config = createAutoConfig({
      endConditions: [{ type: 'arc_count', target: 4 }],
    });

    // Started with 2 arcs, now have 3, so 1 arc completed, target is 4
    const progress = computeStoryProgress(narrative, [], config, 0, 2);
    expect(progress).toBe(0.25);
  });

  it('uses max progress when multiple conditions exist', () => {
    const narrative = createMinimalNarrative();
    narrative.arcs = {
      'arc-1': { id: 'arc-1', name: 'Arc 1', sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
    };
    const config = createAutoConfig({
      endConditions: [
        { type: 'scene_count', target: 20 },  // 5/20 = 25%
        { type: 'arc_count', target: 2 },     // 1/2 = 50%
      ],
    });
    const resolvedKeys = Array.from({ length: 5 }, (_, i) => `S-${i}`);

    const progress = computeStoryProgress(narrative, resolvedKeys, config, 0, 0);
    expect(progress).toBe(0.5); // max of 0.25 and 0.5
  });

  it('uses cyclic progress for manual_stop only', () => {
    const narrative = createMinimalNarrative();
    // Create arcs to test cycling
    for (let i = 0; i < AUTO_STOP_CYCLE_LENGTH + 5; i++) {
      narrative.arcs[`arc-${i}`] = { id: `arc-${i}`, name: `Arc ${i}`, sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} };
    }
    const config = createAutoConfig({
      endConditions: [{ type: 'manual_stop' }],
    });

    const progress = computeStoryProgress(narrative, [], config, 0, 0);
    // Should be (cycleLength + 5) % cycleLength / cycleLength = 5 / cycleLength
    expect(progress).toBeCloseTo(5 / AUTO_STOP_CYCLE_LENGTH, 5);
  });

  it('returns cyclic progress when no end conditions', () => {
    const narrative = createMinimalNarrative();
    narrative.arcs = {
      'arc-1': { id: 'arc-1', name: 'Arc 1', sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
      'arc-2': { id: 'arc-2', name: 'Arc 2', sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
    };
    const config = createAutoConfig({
      endConditions: [],
    });

    const progress = computeStoryProgress(narrative, [], config, 0, 0);
    expect(progress).toBe(2 / AUTO_STOP_CYCLE_LENGTH);
  });
});

// ── getStoryPhase Tests ─────────────────────────────────────────────────────

describe('getStoryPhase', () => {
  it('returns setup phase at 0%', () => {
    const phase = getStoryPhase(0);
    expect(phase.name).toBe('setup');
  });

  it('returns setup phase at 10%', () => {
    const phase = getStoryPhase(0.1);
    expect(phase.name).toBe('setup');
  });

  it('returns rising phase at 20%', () => {
    const phase = getStoryPhase(0.2);
    expect(phase.name).toBe('rising');
  });

  it('returns midpoint phase at 40%', () => {
    const phase = getStoryPhase(0.4);
    expect(phase.name).toBe('midpoint');
  });

  it('returns escalation phase at 60%', () => {
    const phase = getStoryPhase(0.6);
    expect(phase.name).toBe('escalation');
  });

  it('returns climax phase at 80%', () => {
    const phase = getStoryPhase(0.8);
    expect(phase.name).toBe('climax');
  });

  it('returns resolution phase at 95%', () => {
    const phase = getStoryPhase(0.95);
    expect(phase.name).toBe('resolution');
  });

  it('returns resolution phase at 100%', () => {
    const phase = getStoryPhase(1.0);
    expect(phase.name).toBe('resolution');
  });

  it('phase has cornerBias property', () => {
    const phase = getStoryPhase(0.5);
    expect(phase.cornerBias).toBeDefined();
    expect(typeof phase.cornerBias).toBe('object');
  });

  it('phase has description property', () => {
    const phase = getStoryPhase(0.5);
    expect(phase.description).toBeDefined();
    expect(typeof phase.description).toBe('string');
    expect(phase.description.length).toBeGreaterThan(0);
  });
});

// ── checkEndConditions Tests ────────────────────────────────────────────────

describe('checkEndConditions', () => {
  it('returns null when no conditions met', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 10 }],
    });

    const result = checkEndConditions(narrative, ['S-1', 'S-2'], config);
    expect(result).toBeNull();
  });

  it('returns scene_count condition when met', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 5 }],
    });
    const resolvedKeys = Array.from({ length: 5 }, (_, i) => `S-${i}`);

    const result = checkEndConditions(narrative, resolvedKeys, config);
    expect(result).toEqual({ type: 'scene_count', target: 5 });
  });

  it('accounts for startingSceneCount', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 3 }],
    });
    // 5 total scenes, started with 3, so 2 new scenes (< 3 target)
    const resolvedKeys = Array.from({ length: 5 }, (_, i) => `S-${i}`);

    const result = checkEndConditions(narrative, resolvedKeys, config, 3);
    expect(result).toBeNull();
  });

  it('returns arc_count condition when met', () => {
    const narrative = createMinimalNarrative();
    narrative.arcs = {
      'arc-1': { id: 'arc-1', name: 'Arc 1', sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
      'arc-2': { id: 'arc-2', name: 'Arc 2', sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
    };
    const config = createAutoConfig({
      endConditions: [{ type: 'arc_count', target: 2 }],
    });

    const result = checkEndConditions(narrative, [], config);
    expect(result).toEqual({ type: 'arc_count', target: 2 });
  });

  it('accounts for startingArcCount', () => {
    const narrative = createMinimalNarrative();
    narrative.arcs = {
      'arc-1': { id: 'arc-1', name: 'Arc 1', sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
      'arc-2': { id: 'arc-2', name: 'Arc 2', sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
    };
    const config = createAutoConfig({
      endConditions: [{ type: 'arc_count', target: 3 }],
    });

    // Started with 1 arc, now have 2, so 1 new arc (< 3 target)
    const result = checkEndConditions(narrative, [], config, 0, 1);
    expect(result).toBeNull();
  });

  it('returns all_threads_resolved when all terminal', () => {
    const narrative = createMinimalNarrative();
    narrative.threads = {
      'T-001': createThread('T-001', { status: 'resolved' }),
      'T-002': createThread('T-002', { status: 'subverted' }),
    };
    const config = createAutoConfig({
      endConditions: [{ type: 'all_threads_resolved' }],
    });

    const result = checkEndConditions(narrative, [], config);
    expect(result).toEqual({ type: 'all_threads_resolved' });
  });

  it('returns null when some threads still active', () => {
    const narrative = createMinimalNarrative();
    narrative.threads = {
      'T-001': createThread('T-001', { status: 'resolved' }),
      'T-002': createThread('T-002', { status: 'active' }),
    };
    const config = createAutoConfig({
      endConditions: [{ type: 'all_threads_resolved' }],
    });

    const result = checkEndConditions(narrative, [], config);
    expect(result).toBeNull();
  });

  it('returns null for all_threads_resolved when no threads exist', () => {
    const narrative = createMinimalNarrative();
    narrative.threads = {};
    const config = createAutoConfig({
      endConditions: [{ type: 'all_threads_resolved' }],
    });

    const result = checkEndConditions(narrative, [], config);
    expect(result).toBeNull();
  });

  it('returns planning_complete when all phases done', () => {
    const narrative = createMinimalNarrative();
    narrative.branches.main.planningQueue = {
      profileId: 'test',
      activePhaseIndex: 1,
      phases: [
        { id: 'p1', name: 'Phase 1', objective: 'Test', status: 'completed', sceneAllocation: 5, scenesCompleted: 5, constraints: '', direction: '', worldExpansionHints: '' },
        { id: 'p2', name: 'Phase 2', objective: 'Test', status: 'completed', sceneAllocation: 5, scenesCompleted: 5, constraints: '', direction: '', worldExpansionHints: '' },
      ],
    };
    const config = createAutoConfig({
      endConditions: [{ type: 'planning_complete' }],
    });

    const result = checkEndConditions(narrative, [], config, 0, 0, 'main');
    expect(result).toEqual({ type: 'planning_complete' });
  });

  it('returns null for planning_complete when phases incomplete', () => {
    const narrative = createMinimalNarrative();
    narrative.branches.main.planningQueue = {
      profileId: 'test',
      activePhaseIndex: 1,
      phases: [
        { id: 'p1', name: 'Phase 1', objective: 'Test', status: 'completed', sceneAllocation: 5, scenesCompleted: 5, constraints: '', direction: '', worldExpansionHints: '' },
        { id: 'p2', name: 'Phase 2', objective: 'Test', status: 'active', sceneAllocation: 5, scenesCompleted: 2, constraints: '', direction: '', worldExpansionHints: '' },
      ],
    };
    const config = createAutoConfig({
      endConditions: [{ type: 'planning_complete' }],
    });

    const result = checkEndConditions(narrative, [], config, 0, 0, 'main');
    expect(result).toBeNull();
  });

  it('never returns manual_stop condition', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: 'manual_stop' }],
    });

    const result = checkEndConditions(narrative, [], config);
    expect(result).toBeNull();
  });

  it('returns first met condition when multiple exist', () => {
    const narrative = createMinimalNarrative();
    narrative.threads = {
      'T-001': createThread('T-001', { status: 'resolved' }),
    };
    const config = createAutoConfig({
      endConditions: [
        { type: 'scene_count', target: 5 },
        { type: 'all_threads_resolved' },
      ],
    });
    const resolvedKeys = Array.from({ length: 5 }, (_, i) => `S-${i}`);

    const result = checkEndConditions(narrative, resolvedKeys, config);
    // scene_count comes first
    expect(result).toEqual({ type: 'scene_count', target: 5 });
  });
});

// ── pickArcLength Tests ─────────────────────────────────────────────────────

describe('pickArcLength', () => {
  const config = createAutoConfig({ minArcLength: 3, maxArcLength: 8 });

  it('returns maxArcLength for high world + high drive corners (HHH)', () => {
    expect(pickArcLength(config, 'HHH')).toBe(8);
  });

  it('returns maxArcLength for HHL corner', () => {
    expect(pickArcLength(config, 'HHL')).toBe(8);
  });

  it('returns minArcLength for low world + low drive corners (LLL)', () => {
    expect(pickArcLength(config, 'LLL')).toBe(3);
  });

  it('returns minArcLength for LLH corner', () => {
    expect(pickArcLength(config, 'LLH')).toBe(3);
  });

  it('returns medium length for mixed corners (HLH)', () => {
    const length = pickArcLength(config, 'HLH');
    expect(length).toBe(6); // ceil((3+8)/2) = 6
  });

  it('returns medium length for LHL corner', () => {
    const length = pickArcLength(config, 'LHL');
    expect(length).toBe(6);
  });

  it('returns medium length for LHH corner', () => {
    const length = pickArcLength(config, 'LHH');
    expect(length).toBe(6);
  });

  it('returns medium length for HLL corner', () => {
    const length = pickArcLength(config, 'HLL');
    expect(length).toBe(6);
  });
});

// ── pickCubeGoal Tests ──────────────────────────────────────────────────────

describe('pickCubeGoal', () => {
  it('returns the action as the cube goal', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig();

    expect(pickCubeGoal('HHH', narrative, [], config)).toBe('HHH');
    expect(pickCubeGoal('LLL', narrative, [], config)).toBe('LLL');
    expect(pickCubeGoal('HLH', narrative, [], config)).toBe('HLH');
  });
});

// ── evaluateNarrativeState Tests ────────────────────────────────────────────

describe('evaluateNarrativeState', () => {
  it('returns weights for all 8 cube corners', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 50 }],
    });

    const { weights } = evaluateNarrativeState(narrative, [], 0, config);
    expect(weights).toHaveLength(8);

    const actions = weights.map(w => w.action);
    expect(actions).toContain('HHH');
    expect(actions).toContain('HHL');
    expect(actions).toContain('HLH');
    expect(actions).toContain('HLL');
    expect(actions).toContain('LHH');
    expect(actions).toContain('LHL');
    expect(actions).toContain('LLH');
    expect(actions).toContain('LLL');
  });

  it('returns weights sorted by score descending', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 50 }],
    });

    const { weights } = evaluateNarrativeState(narrative, [], 0, config);
    for (let i = 0; i < weights.length - 1; i++) {
      expect(weights[i].score).toBeGreaterThanOrEqual(weights[i + 1].score);
    }
  });

  it('returns directiveCtx with storyProgress and storyPhase', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 50 }],
    });

    const { directiveCtx } = evaluateNarrativeState(narrative, [], 0, config);
    expect(directiveCtx.storyProgress).toBeDefined();
    expect(directiveCtx.storyPhase).toBeDefined();
    expect(directiveCtx.storyPhase.name).toBeDefined();
  });

  it('includes reason in each weight', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 50 }],
    });

    const { weights } = evaluateNarrativeState(narrative, [], 0, config);
    for (const weight of weights) {
      expect(weight.reason).toBeDefined();
      expect(typeof weight.reason).toBe('string');
    }
  });

  it('scores are bounded between 0 and 1', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 50 }],
    });

    const { weights } = evaluateNarrativeState(narrative, [], 0, config);
    for (const weight of weights) {
      expect(weight.score).toBeGreaterThanOrEqual(0);
      expect(weight.score).toBeLessThanOrEqual(1);
    }
  });

  it('penalizes corners when too many active threads', () => {
    const narrative = createMinimalNarrative();
    // Add many active threads
    for (let i = 1; i <= 8; i++) {
      narrative.threads[`T-${i}`] = createThread(`T-${i}`, { status: 'active' });
    }
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 50 }],
      maxActiveThreads: 4,
    });

    const { weights } = evaluateNarrativeState(narrative, [], 0, config);
    // High drive corners should get boost when threads need resolution
    const hhhWeight = weights.find(w => w.action === 'HHH');
    expect(hhhWeight?.reason).toContain('active threads');
  });

  it('includes stagnant thread analysis', () => {
    const narrative = createMinimalNarrative();
    narrative.threads = {
      'T-001': createThread('T-001', { status: 'active' }),
    };
    // Add scenes without any thread mutations
    for (let i = 0; i < 5; i++) {
      narrative.scenes[`S-${i}`] = createScene(`S-${i}`, { threadMutations: [] });
    }
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 50 }],
      threadStagnationThreshold: 3,
    });

    const { directiveCtx } = evaluateNarrativeState(
      narrative,
      ['S-0', 'S-1', 'S-2', 'S-3', 'S-4'],
      4,
      config
    );
    expect(directiveCtx.stagnantThreads).toHaveLength(1);
  });

  it('includes forceSaturation in directiveCtx', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 50 }],
    });

    const { directiveCtx } = evaluateNarrativeState(narrative, [], 0, config);
    expect(directiveCtx.forceSaturation).toBeDefined();
    expect(directiveCtx.forceSaturation.drive).toBeDefined();
    expect(directiveCtx.forceSaturation.world).toBeDefined();
    expect(directiveCtx.forceSaturation.system).toBeDefined();
  });

  it('includes recentSwing in directiveCtx', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 50 }],
    });

    const { directiveCtx } = evaluateNarrativeState(narrative, [], 0, config);
    expect(directiveCtx.recentSwing).toBeDefined();
    expect(typeof directiveCtx.recentSwing).toBe('number');
  });

  it('handles empty narrative gracefully', () => {
    const narrative = createMinimalNarrative();
    narrative.threads = {};
    narrative.characters = {};
    narrative.scenes = {};
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 50 }],
    });

    expect(() => evaluateNarrativeState(narrative, [], 0, config)).not.toThrow();
    const { weights } = evaluateNarrativeState(narrative, [], 0, config);
    expect(weights).toHaveLength(8);
  });
});

// ── buildOutlineDirective Tests ─────────────────────────────────────────────

describe('buildOutlineDirective', () => {
  const baseCtx: DirectiveContext = {
    scenes: [],
    stagnantThreads: [],
    primedThreads: [],
    continuityOpportunities: [],
    forceSaturation: {
      drive: { saturated: false, direction: 0 },
      world: { saturated: false, direction: 0 },
      system: { saturated: false, direction: 0 },
    },
    recentSwing: 0.6,
    storyProgress: 0.5,
    storyPhase: { name: 'midpoint' as StoryPhase, description: 'A significant shift' },
  };

  it('includes story trajectory', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig();

    const directive = buildOutlineDirective(narrative, config, baseCtx);
    expect(directive).toContain('STORY TRAJECTORY');
    expect(directive).toContain('50%');
    expect(directive).toContain('MIDPOINT');
  });

  it('includes tone guidance when set', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({ toneGuidance: 'Dark and brooding' });

    const directive = buildOutlineDirective(narrative, config, baseCtx);
    expect(directive).toContain('Tone: Dark and brooding');
  });

  it('includes narrative constraints when set', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({ narrativeConstraints: 'No character deaths' });

    const directive = buildOutlineDirective(narrative, config, baseCtx);
    expect(directive).toContain('Constraints: No character deaths');
  });

  it('includes direction when set', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({ direction: 'Focus on the romance subplot' });

    const directive = buildOutlineDirective(narrative, config, baseCtx);
    expect(directive).toContain('OUTLINE DIRECTION');
    expect(directive).toContain('Focus on the romance subplot');
  });

  it('includes force balance correction when forces saturated high', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig();
    const ctx: DirectiveContext = {
      ...baseCtx,
      forceSaturation: {
        drive: { saturated: true, direction: 1 },
        world: { saturated: false, direction: 0 },
        system: { saturated: false, direction: 0 },
      },
    };

    const directive = buildOutlineDirective(narrative, config, ctx);
    expect(directive).toContain('FORCE BALANCE CORRECTION');
    expect(directive).toContain('Drive has been at maximum');
  });

  it('includes force balance correction when forces saturated low', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig();
    const ctx: DirectiveContext = {
      ...baseCtx,
      forceSaturation: {
        drive: { saturated: false, direction: 0 },
        world: { saturated: true, direction: -1 },
        system: { saturated: false, direction: 0 },
      },
    };

    const directive = buildOutlineDirective(narrative, config, ctx);
    expect(directive).toContain('FORCE BALANCE CORRECTION');
    expect(directive).toContain('World has stagnated');
  });

  it('includes swing vibrancy warning for low swing', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig();
    const ctx: DirectiveContext = {
      ...baseCtx,
      recentSwing: 0.2,
    };

    const directive = buildOutlineDirective(narrative, config, ctx);
    expect(directive).toContain('BALANCE VIBRANCY');
    expect(directive).toContain('flat');
  });

  it('includes swing vibrancy note for moderate swing', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig();
    const ctx: DirectiveContext = {
      ...baseCtx,
      recentSwing: 0.5,
    };

    const directive = buildOutlineDirective(narrative, config, ctx);
    expect(directive).toContain('BALANCE VIBRANCY');
    expect(directive).toContain('dynamic range');
  });

  it('includes positive swing note for high swing', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig();
    const ctx: DirectiveContext = {
      ...baseCtx,
      recentSwing: 1.6,
    };

    const directive = buildOutlineDirective(narrative, config, ctx);
    expect(directive).toContain('BALANCE VIBRANCY');
    expect(directive).toContain('Excellent');
  });

  it('includes ripe threads when primed', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig();
    const ctx: DirectiveContext = {
      ...baseCtx,
      primedThreads: [
        {
          thread: createThread('T-001', {
            description: 'The secret identity',
            status: 'critical',
            participants: [{ type: 'character', id: 'char-1' }],
          }),
          score: 0.8,
        },
      ],
    };
    narrative.characters['char-1'] = createCharacter('char-1', { name: 'Alice' });

    const directive = buildOutlineDirective(narrative, config, ctx);
    expect(directive).toContain('RIPE THREADS');
    expect(directive).toContain('The secret identity');
    expect(directive).toContain('Alice');
  });

  it('includes knowledge gaps when present', () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig();
    const ctx: DirectiveContext = {
      ...baseCtx,
      continuityOpportunities: [
        {
          holderName: 'Alice',
          ignorantName: 'Bob',
          content: 'the true heir',
          dramaticWeight: 0.6,
        },
      ],
    };

    const directive = buildOutlineDirective(narrative, config, ctx);
    expect(directive).toContain('KNOWLEDGE GAPS');
    expect(directive).toContain('Alice knows');
    expect(directive).toContain('the true heir');
    expect(directive).toContain('Bob does not');
  });

  it('includes unused world-build elements', () => {
    const narrative = createMinimalNarrative();
    narrative.worldBuilds = {
      'wb-1': {
        id: 'wb-1',
        kind: 'world_build',
        summary: 'test',
        expansionManifest: {
          characters: [{ id: 'char-unused', name: 'Unused Char', role: 'recurring', continuity: { nodes: {}, edges: [] }, threadIds: [] }],
          locations: [{ id: 'loc-unused', name: 'Unused Location', prominence: 'place' as const, parentId: null, tiedCharacterIds: [], continuity: { nodes: {}, edges: [] }, threadIds: [] }],
          threads: [{ id: 'T-unused', description: 'Unused thread', participants: [], status: 'latent', openedAt: 's1', dependents: [], threadLog: { nodes: {}, edges: [] } }],
          artifacts: [],
          relationships: [],
          systemMutations: { addedNodes: [], addedEdges: [] },
        },
      },
    };
    narrative.characters['char-unused'] = createCharacter('char-unused', { name: 'Unused Char' });
    narrative.locations['loc-unused'] = createLocation('loc-unused', { name: 'Unused Location' });
    narrative.threads['T-unused'] = createThread('T-unused', { description: 'Unused thread' });
    const config = createAutoConfig();

    const directive = buildOutlineDirective(narrative, config, baseCtx);
    expect(directive).toContain('unused world-building elements');
    expect(directive).toContain('Unused Char');
    expect(directive).toContain('Unused Location');
    expect(directive).toContain('Unused thread');
  });

  it('does not include world-build clause when all elements used', () => {
    const narrative = createMinimalNarrative();
    narrative.worldBuilds = {
      'wb-1': {
        id: 'wb-1',
        kind: 'world_build',
        summary: 'test',
        expansionManifest: {
          characters: [{ id: 'char-1', name: 'Alice', role: 'recurring', continuity: { nodes: {}, edges: [] }, threadIds: [] }],
          locations: [{ id: 'loc-1', name: 'Castle', prominence: 'place' as const, parentId: null, tiedCharacterIds: [], continuity: { nodes: {}, edges: [] }, threadIds: [] }],
          threads: [],
          artifacts: [],
          relationships: [],
          systemMutations: { addedNodes: [], addedEdges: [] },
        },
      },
    };
    // Add scenes that use the elements
    narrative.scenes['S-1'] = createScene('S-1', {
      participantIds: ['char-1'],
      locationId: 'loc-1',
    });
    const config = createAutoConfig();
    const ctx: DirectiveContext = {
      ...baseCtx,
      scenes: [narrative.scenes['S-1']],
    };

    const directive = buildOutlineDirective(narrative, config, ctx);
    expect(directive).not.toContain('unused world-building elements');
  });
});

// ── Edge Cases and Integration ──────────────────────────────────────────────

describe('auto-engine edge cases', () => {
  it('handles narrative with only terminal threads', () => {
    const narrative = createMinimalNarrative();
    narrative.threads = {
      'T-001': createThread('T-001', { status: 'resolved' }),
      'T-002': createThread('T-002', { status: 'subverted' }),
      'T-003': createThread('T-003', { status: 'abandoned' }),
    };
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 50 }],
    });

    const { weights } = evaluateNarrativeState(narrative, [], 0, config);
    expect(weights).toHaveLength(8);
  });

  it('handles narrative with only latent threads', () => {
    const narrative = createMinimalNarrative();
    // Need > 2 latent threads to trigger the boost
    narrative.threads = {
      'T-001': createThread('T-001', { status: 'latent' }),
      'T-002': createThread('T-002', { status: 'latent' }),
      'T-003': createThread('T-003', { status: 'latent' }),
    };
    const config = createAutoConfig({
      endConditions: [{ type: 'scene_count', target: 50 }],
    });

    const { weights } = evaluateNarrativeState(narrative, [], 0, config);
    // Should boost knowledge corners since > 2 latent (dormant) threads exist
    const lhhWeight = weights.find(w => w.action === 'LHH');
    expect(lhhWeight?.reason).toContain('latent'); // source uses "latent" in reason string
  });

  it('handles progress > 1 gracefully', () => {
    const phase = getStoryPhase(1.5);
    expect(phase.name).toBe('resolution');
  });

  it('handles progress < 0 gracefully', () => {
    const phase = getStoryPhase(-0.1);
    // Should still find a phase - first phase that matches or default to last
    expect(phase).toBeDefined();
    expect(phase.name).toBeDefined();
  });

  it('computes progress correctly with combined scene and arc conditions', () => {
    const narrative = createMinimalNarrative();
    narrative.arcs = {
      'arc-1': { id: 'arc-1', name: 'Arc 1', sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
    };
    const config = createAutoConfig({
      endConditions: [
        { type: 'scene_count', target: 10 },
        { type: 'arc_count', target: 5 },
      ],
    });
    const resolvedKeys = Array.from({ length: 6 }, (_, i) => `S-${i}`);

    // 6/10 scenes = 60%, 1/5 arcs = 20%
    const progress = computeStoryProgress(narrative, resolvedKeys, config, 0, 0);
    expect(progress).toBe(0.6); // max of 60% and 20%
  });
});
