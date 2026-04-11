import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NarrativeState, PlanningQueue, PlanningPhase, Scene } from '@/types/narrative';

// Mock the AI module
vi.mock('@/lib/ai/api', () => ({
  callGenerate: vi.fn(),
  callGenerateStream: vi.fn(),
  SYSTEM_PROMPT: 'Test system prompt',
}));

// Mock context building
vi.mock('@/lib/ai/context', () => ({
  narrativeContext: vi.fn().mockReturnValue('Mock branch context'),
}));

import {
  buildPhaseCompletionSummary,
  generatePhaseDirection,
  generateCustomPlan,
  generateOutline,
  checkPhaseCompletion,
} from '@/lib/planning-engine';
import { callGenerate, callGenerateStream } from '@/lib/ai/api';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createScene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    kind: 'scene',
    id,
    arcId: 'arc-1',
    povId: 'char-1',
    locationId: 'loc-1',
    participantIds: ['char-1'],
    summary: `Scene ${id} summary text here`,
    events: [],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    characterMovements: {},
    ...overrides,
  };
}

function createMinimalNarrative(): NarrativeState {
  return {
    id: 'N-001',
    title: 'Test Narrative',
    description: 'Test description',
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
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: '',
    rules: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createPlanningPhase(overrides: Partial<PlanningPhase> = {}): PlanningPhase {
  return {
    id: 'phase-1',
    name: 'Test Phase',
    objective: 'Test objective',
    direction: '',
    status: 'active',
    sceneAllocation: 5,
    scenesCompleted: 0,
    constraints: 'No constraints',
    worldExpansionHints: '',
    ...overrides,
  };
}

function createPlanningQueue(overrides: Partial<PlanningQueue> = {}): PlanningQueue {
  return {
    profileId: null,
    activePhaseIndex: 0,
    phases: [createPlanningPhase()],
    expandWorld: true,
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── buildPhaseCompletionSummary Tests ────────────────────────────────────────

describe('buildPhaseCompletionSummary', () => {
  it('returns summary with zero scenes completed', () => {
    const narrative = createMinimalNarrative();
    const phase = createPlanningPhase({ scenesCompleted: 0 });

    const summary = buildPhaseCompletionSummary(narrative, [], 0, phase);

    expect(summary).toBe('0 scenes completed. ');
  });

  it('includes scene summaries', () => {
    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'scene-1': createScene('scene-1', { summary: 'First scene happens' }),
      'scene-2': createScene('scene-2', { summary: 'Second scene follows' }),
    };
    const phase = createPlanningPhase({ scenesCompleted: 2 });
    const resolvedKeys = ['scene-1', 'scene-2'];

    const summary = buildPhaseCompletionSummary(narrative, resolvedKeys, 1, phase);

    expect(summary).toContain('2 scenes completed');
    expect(summary).toContain('First scene happens');
    expect(summary).toContain('Second scene follows');
  });

  it('truncates long summaries', () => {
    const narrative = createMinimalNarrative();
    const longText = 'x'.repeat(200);
    narrative.scenes = {
      'scene-1': createScene('scene-1', { summary: longText }),
    };
    const phase = createPlanningPhase({ scenesCompleted: 1 });

    const summary = buildPhaseCompletionSummary(narrative, ['scene-1'], 0, phase);

    // Should truncate to 150 chars
    expect(summary).not.toContain(longText);
    expect(summary.length).toBeLessThan(200);
  });

  it('handles missing scene summaries', () => {
    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'scene-1': createScene('scene-1', { summary: undefined }),
    };
    const phase = createPlanningPhase({ scenesCompleted: 1 });

    const summary = buildPhaseCompletionSummary(narrative, ['scene-1'], 0, phase);

    expect(summary).toContain('(no summary)');
  });

  it('collects scenes from current index backwards', () => {
    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'scene-1': createScene('scene-1', { summary: 'First' }),
      'scene-2': createScene('scene-2', { summary: 'Second' }),
      'scene-3': createScene('scene-3', { summary: 'Third' }),
    };
    const phase = createPlanningPhase({ scenesCompleted: 2 });
    const resolvedKeys = ['scene-1', 'scene-2', 'scene-3'];

    // Current index is 2 (scene-3), collect 2 scenes
    const summary = buildPhaseCompletionSummary(narrative, resolvedKeys, 2, phase);

    // Should include scene-2 and scene-3 (last 2 scenes)
    expect(summary).toContain('Second');
    expect(summary).toContain('Third');
  });
});

// ── checkPhaseCompletion Tests ───────────────────────────────────────────────

describe('checkPhaseCompletion', () => {
  it('returns null for undefined queue', () => {
    const result = checkPhaseCompletion(undefined, 3);
    expect(result).toBeNull();
  });

  it('returns null when no active phase', () => {
    const queue = createPlanningQueue({
      phases: [createPlanningPhase({ status: 'pending' })],
    });
    const result = checkPhaseCompletion(queue, 3);
    expect(result).toBeNull();
  });

  it('returns null when phase status is not active', () => {
    const queue = createPlanningQueue({
      phases: [createPlanningPhase({ status: 'completed' })],
    });
    const result = checkPhaseCompletion(queue, 3);
    expect(result).toBeNull();
  });

  it('returns null when allocation not reached', () => {
    const queue = createPlanningQueue({
      phases: [createPlanningPhase({
        status: 'active',
        sceneAllocation: 10,
        scenesCompleted: 3,
      })],
    });
    const result = checkPhaseCompletion(queue, 2); // 3 + 2 = 5 < 10
    expect(result).toBeNull();
  });

  it('returns phase when allocation exactly reached', () => {
    const phase = createPlanningPhase({
      status: 'active',
      sceneAllocation: 5,
      scenesCompleted: 3,
    });
    const queue = createPlanningQueue({ phases: [phase] });

    const result = checkPhaseCompletion(queue, 2); // 3 + 2 = 5 = allocation
    expect(result).toBe(phase);
  });

  it('returns phase when allocation exceeded', () => {
    const phase = createPlanningPhase({
      status: 'active',
      sceneAllocation: 5,
      scenesCompleted: 4,
    });
    const queue = createPlanningQueue({ phases: [phase] });

    const result = checkPhaseCompletion(queue, 3); // 4 + 3 = 7 > 5
    expect(result).toBe(phase);
  });

  it('checks correct phase based on activePhaseIndex', () => {
    const phase0 = createPlanningPhase({
      status: 'completed',
      sceneAllocation: 5,
      scenesCompleted: 5,
    });
    const phase1 = createPlanningPhase({
      status: 'active',
      sceneAllocation: 8,
      scenesCompleted: 6,
    });
    const queue = createPlanningQueue({
      activePhaseIndex: 1,
      phases: [phase0, phase1],
    });

    const result = checkPhaseCompletion(queue, 2); // 6 + 2 = 8 = allocation
    expect(result).toBe(phase1);
  });
});

// ── generatePhaseDirection Tests (with mocked AI) ────────────────────────────

describe('generatePhaseDirection', () => {
  it('returns parsed direction and constraints from LLM response', async () => {
    const mockResponse = JSON.stringify({
      direction: 'Move the story forward with tension',
      constraints: 'Do not reveal the twist yet',
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const phase = createPlanningPhase();
    const queue = createPlanningQueue({ phases: [phase] });

    const result = await generatePhaseDirection(narrative, [], 0, phase, queue);

    expect(result.direction).toBe('Move the story forward with tension');
    expect(result.constraints).toBe('Do not reveal the twist yet');
    expect(callGenerate).toHaveBeenCalled();
  });

  it('handles JSON embedded in response text', async () => {
    const mockResponse = 'Here is the plan:\n```json\n{"direction": "test direction", "constraints": "test constraints"}\n```';
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const phase = createPlanningPhase();
    const queue = createPlanningQueue({ phases: [phase] });

    const result = await generatePhaseDirection(narrative, [], 0, phase, queue);

    expect(result.direction).toBe('test direction');
    expect(result.constraints).toBe('test constraints');
  });

  it('falls back to phase objective on parse failure', async () => {
    vi.mocked(callGenerate).mockResolvedValue('Invalid JSON response');

    const narrative = createMinimalNarrative();
    const phase = createPlanningPhase({
      objective: 'Fallback objective',
      constraints: 'Fallback constraints',
    });
    const queue = createPlanningQueue({ phases: [phase] });

    const result = await generatePhaseDirection(narrative, [], 0, phase, queue);

    expect(result.direction).toBe('Fallback objective');
    expect(result.constraints).toBe('Fallback constraints');
  });

  it('uses streaming when onReasoning callback provided', async () => {
    const mockResponse = JSON.stringify({
      direction: 'streamed direction',
      constraints: 'streamed constraints',
    });
    vi.mocked(callGenerateStream).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const phase = createPlanningPhase();
    const queue = createPlanningQueue({ phases: [phase] });
    const onReasoning = vi.fn();

    const result = await generatePhaseDirection(narrative, [], 0, phase, queue, onReasoning);

    expect(result.direction).toBe('streamed direction');
    expect(callGenerateStream).toHaveBeenCalled();
    expect(callGenerate).not.toHaveBeenCalled();
  });

  it('converts non-string direction to string', async () => {
    const mockResponse = JSON.stringify({
      direction: ['item1', 'item2'],
      constraints: { rule: 'test' },
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const phase = createPlanningPhase();
    const queue = createPlanningQueue({ phases: [phase] });

    const result = await generatePhaseDirection(narrative, [], 0, phase, queue);

    // Should stringify arrays/objects
    expect(result.direction).toContain('item1');
    expect(result.constraints).toContain('rule');
  });

  it('includes completed phases summary in prompt', async () => {
    vi.mocked(callGenerate).mockResolvedValue('{"direction": "d", "constraints": "c"}');

    const narrative = createMinimalNarrative();
    const completedPhase = createPlanningPhase({
      name: 'Phase 1',
      status: 'completed',
      completionReport: 'Phase 1 completed successfully',
    });
    const activePhase = createPlanningPhase({ name: 'Phase 2', status: 'active' });
    const queue = createPlanningQueue({
      activePhaseIndex: 1,
      phases: [completedPhase, activePhase],
    });

    await generatePhaseDirection(narrative, [], 0, activePhase, queue);

    // Verify the prompt includes completed phase info
    const callArgs = vi.mocked(callGenerate).mock.calls[0];
    expect(callArgs[0]).toContain('Phase 1');
    expect(callArgs[0]).toContain('completed successfully');
  });
});

// ── generateCustomPlan Tests (with mocked AI) ────────────────────────────────

describe('generateCustomPlan', () => {
  it('parses valid plan response', async () => {
    const mockResponse = JSON.stringify({
      name: 'Epic Journey',
      phases: [
        {
          name: 'The Beginning',
          objective: 'Set up the world',
          sceneAllocation: 6,
          constraints: 'No deaths yet',
          worldExpansionHints: 'Add a mentor character',
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const result = await generateCustomPlan(narrative, [], 0, 'My story plan...');

    expect(result.name).toBe('Epic Journey');
    expect(result.phases.length).toBe(1);
    expect(result.phases[0].name).toBe('The Beginning');
    expect(result.phases[0].sceneAllocation).toBe(6);
  });

  it('handles missing optional fields', async () => {
    const mockResponse = JSON.stringify({
      name: 'Plan',
      phases: [
        {
          name: 'Phase 1',
          objective: 'Do things',
          sceneAllocation: 4,
          constraints: '',
          worldExpansionHints: '',
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const result = await generateCustomPlan(narrative, [], 0, 'Plan document');

    expect(result.phases[0].structuralRules).toBeUndefined();
    expect(result.phases[0].sourceText).toBeUndefined();
  });

  it('throws on parse failure', async () => {
    vi.mocked(callGenerate).mockResolvedValue('Not valid JSON');

    const narrative = createMinimalNarrative();

    await expect(generateCustomPlan(narrative, [], 0, 'Plan'))
      .rejects.toThrow('Failed to generate custom plan');
  });

  it('defaults to Custom Plan name', async () => {
    const mockResponse = JSON.stringify({
      phases: [],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const result = await generateCustomPlan(narrative, [], 0, 'Plan');

    expect(result.name).toBe('Custom Plan');
  });

  it('coerces invalid sceneAllocation to 4', async () => {
    const mockResponse = JSON.stringify({
      name: 'Plan',
      phases: [
        {
          name: 'Phase',
          objective: 'Obj',
          sceneAllocation: 'invalid',
          constraints: '',
          worldExpansionHints: '',
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const result = await generateCustomPlan(narrative, [], 0, 'Plan');

    expect(result.phases[0].sceneAllocation).toBe(4);
  });

  it('uses streaming when onReasoning provided', async () => {
    const mockResponse = JSON.stringify({
      name: 'Streamed Plan',
      phases: [],
    });
    vi.mocked(callGenerateStream).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const onReasoning = vi.fn();

    const result = await generateCustomPlan(narrative, [], 0, 'Plan', onReasoning);

    expect(result.name).toBe('Streamed Plan');
    expect(callGenerateStream).toHaveBeenCalled();
  });
});

// ── generateOutline Tests (with mocked AI) ───────────────────────────────────

describe('generateOutline', () => {
  it('parses valid outline response', async () => {
    const mockResponse = JSON.stringify({
      name: 'Story Arc',
      phases: [
        {
          name: 'Rising Action',
          objective: 'Build tension',
          sceneAllocation: 8,
          constraints: 'Keep mystery alive',
          worldExpansionHints: 'Add antagonist',
        },
        {
          name: 'Climax',
          objective: 'Maximum confrontation',
          sceneAllocation: 4,
          constraints: '',
          worldExpansionHints: '',
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const result = await generateOutline(narrative, [], 0);

    expect(result.name).toBe('Story Arc');
    expect(result.phases.length).toBe(2);
    expect(result.phases[0].name).toBe('Rising Action');
    expect(result.phases[1].name).toBe('Climax');
  });

  it('defaults to AI Outline name', async () => {
    const mockResponse = JSON.stringify({
      phases: [],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const result = await generateOutline(narrative, [], 0);

    expect(result.name).toBe('AI Outline');
  });

  it('throws on parse failure', async () => {
    vi.mocked(callGenerate).mockResolvedValue('Invalid response');

    const narrative = createMinimalNarrative();

    await expect(generateOutline(narrative, [], 0))
      .rejects.toThrow('Failed to generate outline');
  });

  it('uses streaming when onReasoning provided', async () => {
    const mockResponse = JSON.stringify({
      name: 'Streamed Outline',
      phases: [],
    });
    vi.mocked(callGenerateStream).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const onReasoning = vi.fn();

    const result = await generateOutline(narrative, [], 0, onReasoning);

    expect(result.name).toBe('Streamed Outline');
    expect(callGenerateStream).toHaveBeenCalled();
  });

  it('handles empty phases array', async () => {
    const mockResponse = JSON.stringify({
      name: 'Empty Plan',
      phases: [],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const result = await generateOutline(narrative, [], 0);

    expect(result.phases).toEqual([]);
  });

  it('coerces invalid phase values', async () => {
    const mockResponse = JSON.stringify({
      name: 'Plan',
      phases: [
        {
          name: null,
          objective: 123,
          sceneAllocation: 'bad',
          constraints: ['array'],
          worldExpansionHints: undefined,
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const result = await generateOutline(narrative, [], 0);

    const phase = result.phases[0];
    expect(phase.name).toBe('Untitled Phase');
    expect(phase.objective).toBe('123');
    expect(phase.sceneAllocation).toBe(4);
    expect(phase.constraints).toContain('array');
    expect(phase.worldExpansionHints).toBe('');
  });
});
