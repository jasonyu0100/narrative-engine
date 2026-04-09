import { describe, it, expect } from 'vitest';
import {
  PROMPT_FORCE_STANDARDS,
  PROMPT_STRUCTURAL_RULES,
  PROMPT_MUTATIONS,
  PROMPT_ARTIFACTS,
  PROMPT_POV,
  PROMPT_CONTINUITY,
  PROMPT_SUMMARY_REQUIREMENT,
  promptThreadLifecycle,
  buildThreadHealthPrompt,
  buildCompletedBeatsPrompt,
} from '@/lib/ai/prompts';
import type { NarrativeState, Scene, Thread } from '@/types/narrative';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createMinimalNarrative(overrides: Partial<NarrativeState> = {}): NarrativeState {
  return {
    id: 'test-narrative',
    title: 'Test Story',
    description: 'Test',
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

function createScene(id: string, threadMutations: Array<{ threadId: string; from: string; to: string }>, overrides: Partial<Scene> = {}): Scene {
  return {
    kind: 'scene',
    id,
    arcId: 'arc-1',
    povId: 'c1',
    locationId: 'loc1',
    participantIds: ['c1'],
    summary: `Scene ${id} summary`,
    events: ['event_1'],
    threadMutations,
    continuityMutations: [],
    relationshipMutations: [],
    ...overrides,
  };
}

function createThread(id: string, description: string, status: string = 'dormant'): Thread {
  return {
    id,
    description,
    status,
    participants: [],
    dependents: [],
    openedAt: 's1',
  };
}

// ── Static Prompt Constants ──────────────────────────────────────────────────

describe('Static Prompt Constants', () => {
  describe('PROMPT_FORCE_STANDARDS', () => {
    it('contains payoff reference mean', () => {
      expect(PROMPT_FORCE_STANDARDS).toContain('P ~1.3');
    });

    it('contains change reference mean', () => {
      expect(PROMPT_FORCE_STANDARDS).toContain('C ~4');
    });

    it('contains knowledge reference mean', () => {
      expect(PROMPT_FORCE_STANDARDS).toContain('K ~3.5');
    });

    it('mentions exponential grading', () => {
      expect(PROMPT_FORCE_STANDARDS).toContain('exponential');
    });
  });

  describe('PROMPT_STRUCTURAL_RULES', () => {
    it('contains anti-repetition rules', () => {
      expect(PROMPT_STRUCTURAL_RULES).toContain('ANTI-REPETITION');
      expect(PROMPT_STRUCTURAL_RULES).toContain('NO EVENT TWICE');
    });

    it('contains thread collision rules', () => {
      expect(PROMPT_STRUCTURAL_RULES).toContain('THREAD COLLISION');
      expect(PROMPT_STRUCTURAL_RULES).toContain('2+ threads simultaneously');
    });

    it('contains character discipline rules', () => {
      expect(PROMPT_STRUCTURAL_RULES).toContain('CHARACTER DISCIPLINE');
      expect(PROMPT_STRUCTURAL_RULES).toContain('3+ scenes MUST show visible change');
    });

    it('contains pacing density rules', () => {
      expect(PROMPT_STRUCTURAL_RULES).toContain('PACING DENSITY');
    });
  });

  describe('PROMPT_MUTATIONS', () => {
    it('describes threadMutations', () => {
      expect(PROMPT_MUTATIONS).toContain('threadMutations');
      expect(PROMPT_MUTATIONS).toContain('dormant→active→escalating→critical→terminal');
    });

    it('describes continuityMutations', () => {
      expect(PROMPT_MUTATIONS).toContain('continuityMutations');
      expect(PROMPT_MUTATIONS).toContain('first-person experiential changes');
    });

    it('describes relationshipMutations', () => {
      expect(PROMPT_MUTATIONS).toContain('relationshipMutations');
      expect(PROMPT_MUTATIONS).toContain('valenceDelta');
    });

    it('describes worldKnowledgeMutations', () => {
      expect(PROMPT_MUTATIONS).toContain('worldKnowledgeMutations');
      expect(PROMPT_MUTATIONS).toContain('principle');
      expect(PROMPT_MUTATIONS).toContain('system');
    });
  });

  describe('PROMPT_ARTIFACTS', () => {
    it('describes artifact capabilities', () => {
      expect(PROMPT_ARTIFACTS).toContain('ARTIFACTS');
      expect(PROMPT_ARTIFACTS).toContain('capabilities');
    });
  });

  describe('PROMPT_POV', () => {
    it('describes POV streaks', () => {
      expect(PROMPT_POV).toContain('STREAKS');
      expect(PROMPT_POV).toContain('2-4 consecutive scenes');
    });
  });

  describe('PROMPT_CONTINUITY', () => {
    it('includes teleportation warning', () => {
      expect(PROMPT_CONTINUITY).toContain('NEVER teleport');
    });

    it('includes character movements instruction', () => {
      expect(PROMPT_CONTINUITY).toContain('characterMovements');
    });
  });

  describe('PROMPT_SUMMARY_REQUIREMENT', () => {
    it('includes banned verbs', () => {
      expect(PROMPT_SUMMARY_REQUIREMENT).toContain('BANNED verbs');
      expect(PROMPT_SUMMARY_REQUIREMENT).toContain('realizes');
      expect(PROMPT_SUMMARY_REQUIREMENT).toContain('confirms');
    });

    it('includes example summary', () => {
      expect(PROMPT_SUMMARY_REQUIREMENT).toContain('Michael Corleone');
    });
  });

});

// ── promptThreadLifecycle ────────────────────────────────────────────────────

describe('promptThreadLifecycle', () => {
  it('returns a string with thread lifecycle information', () => {
    const result = promptThreadLifecycle();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes active and terminal statuses', () => {
    const result = promptThreadLifecycle();
    expect(result).toContain('Active statuses');
    expect(result).toContain('Terminal statuses');
  });

  it('includes resolved, subverted, abandoned', () => {
    const result = promptThreadLifecycle();
    expect(result).toContain('resolved');
    expect(result).toContain('subverted');
    expect(result).toContain('abandoned');
  });

  it('mentions thread regression', () => {
    const result = promptThreadLifecycle();
    expect(result).toContain('regress');
  });
});

// ── buildThreadHealthPrompt ──────────────────────────────────────────────────

describe('buildThreadHealthPrompt', () => {
  it('returns empty string when no threads exist', () => {
    const n = createMinimalNarrative();
    const result = buildThreadHealthPrompt(n, [], 0, 'moderate');
    expect(result).toBe('');
  });

  it('includes speed benchmark in header', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Test thread', 'active') },
    });
    const result = buildThreadHealthPrompt(n, [], 0, 'fast');
    expect(result).toContain('FAST');
    expect(result).toContain('~4 scenes/transition');
  });

  it('shows different benchmarks for different speeds', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Test thread', 'active') },
    });

    const slow = buildThreadHealthPrompt(n, [], 0, 'slow');
    expect(slow).toContain('~10 scenes/transition');

    const moderate = buildThreadHealthPrompt(n, [], 0, 'moderate');
    expect(moderate).toContain('~6 scenes/transition');

    const fast = buildThreadHealthPrompt(n, [], 0, 'fast');
    expect(fast).toContain('~4 scenes/transition');
  });

  it('reports thread with no transitions yet', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'The mystery unfolds', 'dormant') },
    });
    const result = buildThreadHealthPrompt(n, [], 0, 'moderate');
    expect(result).toContain('The mystery unfolds');
    expect(result).toContain('no transitions yet');
  });

  it('tracks transition history', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Quest thread', 'escalating') },
      scenes: {
        s1: createScene('s1', [{ threadId: 't1', from: 'dormant', to: 'active' }]),
        s2: createScene('s2', [{ threadId: 't1', from: 'active', to: 'escalating' }]),
      },
    });
    const result = buildThreadHealthPrompt(n, ['s1', 's2'], 1, 'moderate');
    expect(result).toContain('dormant→active');
    expect(result).toContain('active→escalating');
  });

  it('warns about high pulse ratio', () => {
    // Need pulse ratio > 0.8. With 1 transition and 4 pulses = 5 total, ratio = 4/5 = 0.8
    // Need 5 pulses: ratio = 5/6 = 0.83
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Stalled thread', 'active') },
      scenes: {
        s1: createScene('s1', [{ threadId: 't1', from: 'dormant', to: 'active' }]),
        s2: createScene('s2', [{ threadId: 't1', from: 'active', to: 'active' }]),
        s3: createScene('s3', [{ threadId: 't1', from: 'active', to: 'active' }]),
        s4: createScene('s4', [{ threadId: 't1', from: 'active', to: 'active' }]),
        s5: createScene('s5', [{ threadId: 't1', from: 'active', to: 'active' }]),
        s6: createScene('s6', [{ threadId: 't1', from: 'active', to: 'active' }]),
      },
    });
    const result = buildThreadHealthPrompt(n, ['s1', 's2', 's3', 's4', 's5', 's6'], 5, 'moderate');
    expect(result).toContain('HIGH PULSE RATIO');
  });

  it('shows convergence links when present', () => {
    const t1 = createThread('t1', 'Main thread', 'active');
    t1.dependents = ['t2'];
    const n = createMinimalNarrative({
      threads: {
        t1,
        t2: createThread('t2', 'Sub thread', 'dormant'),
      },
    });
    const result = buildThreadHealthPrompt(n, [], 0, 'moderate');
    expect(result).toContain('Converges');
    expect(result).toContain('[t2]');
  });

  it('reports resolved thread count', () => {
    const n = createMinimalNarrative({
      threads: {
        t1: createThread('t1', 'Active thread', 'active'),
        t2: createThread('t2', 'Resolved thread', 'resolved'),
      },
    });
    const result = buildThreadHealthPrompt(n, [], 0, 'moderate');
    expect(result).toContain('1/2 resolved');
  });

  it('warns when scenes since last transition exceeds benchmark', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Stale thread', 'active') },
      scenes: {
        s1: createScene('s1', [{ threadId: 't1', from: 'dormant', to: 'active' }]),
        s2: createScene('s2', []),
        s3: createScene('s3', []),
        s4: createScene('s4', []),
        s5: createScene('s5', []),
        s6: createScene('s6', []),
        s7: createScene('s7', []),
      },
    });
    const result = buildThreadHealthPrompt(n, ['s1', 's2', 's3', 's4', 's5', 's6', 's7'], 6, 'fast');
    // Fast = 4 scenes/transition, we're at 7 since transition
    expect(result).toContain('[!]');
    expect(result).toContain('>4');
  });
});

// ── buildCompletedBeatsPrompt ────────────────────────────────────────────────

describe('buildCompletedBeatsPrompt', () => {
  it('returns empty string when no transitions have occurred', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Test', 'dormant') },
      scenes: {
        s1: createScene('s1', [{ threadId: 't1', from: 'dormant', to: 'dormant' }]), // pulse, not transition
      },
    });
    const result = buildCompletedBeatsPrompt(n, ['s1'], 0);
    expect(result).toBe('');
  });

  it('includes SPENT BEATS header', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Test thread', 'active') },
      scenes: {
        s1: createScene('s1', [{ threadId: 't1', from: 'dormant', to: 'active' }]),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ['s1'], 0);
    expect(result).toContain('SPENT BEATS');
    expect(result).toContain('CLOSED');
  });

  it('lists thread transition chain', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Quest thread', 'escalating') },
      scenes: {
        s1: createScene('s1', [{ threadId: 't1', from: 'dormant', to: 'active' }]),
        s2: createScene('s2', [{ threadId: 't1', from: 'active', to: 'escalating' }]),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ['s1', 's2'], 1);
    expect(result).toContain('Quest thread');
    expect(result).toContain('dormant → active');
    expect(result).toContain('escalating');
  });

  it('includes scene summaries', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Test', 'active') },
      scenes: {
        s1: createScene('s1', [{ threadId: 't1', from: 'dormant', to: 'active' }], {
          summary: 'The hero discovers the secret passage',
        }),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ['s1'], 0);
    expect(result).toContain('secret passage');
  });

  it('includes scene events', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Test', 'active') },
      scenes: {
        s1: createScene('s1', [{ threadId: 't1', from: 'dormant', to: 'active' }], {
          events: ['ambush_triggered', 'ally_wounded'],
        }),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ['s1'], 0);
    expect(result).toContain('ambush_triggered');
    expect(result).toContain('ally_wounded');
  });

  it('labels terminal threads appropriately', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Resolved thread', 'resolved') },
      scenes: {
        s1: createScene('s1', [{ threadId: 't1', from: 'critical', to: 'resolved' }]),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ['s1'], 0);
    expect(result).toContain('[RESOLVED]');
  });

  it('handles multiple threads', () => {
    const n = createMinimalNarrative({
      threads: {
        t1: createThread('t1', 'Thread one', 'active'),
        t2: createThread('t2', 'Thread two', 'escalating'),
      },
      scenes: {
        s1: createScene('s1', [
          { threadId: 't1', from: 'dormant', to: 'active' },
          { threadId: 't2', from: 'dormant', to: 'active' },
        ]),
        s2: createScene('s2', [
          { threadId: 't2', from: 'active', to: 'escalating' },
        ]),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ['s1', 's2'], 1);
    expect(result).toContain('Thread one');
    expect(result).toContain('Thread two');
  });

  it('truncates long thread descriptions', () => {
    const longDescription = 'A'.repeat(100);
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', longDescription, 'active') },
      scenes: {
        s1: createScene('s1', [{ threadId: 't1', from: 'dormant', to: 'active' }]),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ['s1'], 0);
    expect(result).toContain('A'.repeat(50)); // Truncated to 50 chars
    expect(result).not.toContain('A'.repeat(60));
  });
});
