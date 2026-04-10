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

function createScene(id: string, threadMutations: Array<{ threadId: string; from: string; to: string; addedNodes?: []; addedEdges?: [] }>, overrides: Partial<Scene> = {}): Scene {
  return {
    kind: 'scene',
    id,
    arcId: 'arc-1',
    povId: 'c1',
    locationId: 'loc1',
    participantIds: ['c1'],
    summary: `Scene ${id} summary`,
    events: ['event_1'],
    threadMutations: threadMutations.map((tm) => ({ threadId: tm.threadId, from: tm.from, to: tm.to, addedNodes: [], addedEdges: [] })),
    continuityMutations: [],
    relationshipMutations: [],
    ...overrides,
  };
}

function createThread(id: string, description: string, status: string = 'latent'): Thread {
  return {
    id,
    description,
    status,
    participants: [],
    dependents: [],
    openedAt: 's1',
    threadLog: { nodes: {}, edges: [] },
  };
}

// ── Static Prompt Constants ──────────────────────────────────────────────────

describe('Static Prompt Constants', () => {
  describe('PROMPT_FORCE_STANDARDS', () => {
    it('contains drive reference per-scene target', () => {
      expect(PROMPT_FORCE_STANDARDS).toMatch(/DRIVE[\s\S]+Reference:/);
    });

    it('contains world reference per-scene target', () => {
      expect(PROMPT_FORCE_STANDARDS).toMatch(/WORLD[\s\S]+Reference:/);
    });

    it('contains system reference per-scene target', () => {
      expect(PROMPT_FORCE_STANDARDS).toMatch(/SYSTEM[\s\S]+Reference:/);
    });

    it('mentions dominance framing', () => {
      expect(PROMPT_FORCE_STANDARDS).toContain('dominant');
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
      expect(PROMPT_MUTATIONS).toContain('latent→seeded→active→critical→resolved/subverted');
    });

    it('describes continuityMutations', () => {
      expect(PROMPT_MUTATIONS).toContain('continuityMutations');
      expect(PROMPT_MUTATIONS).toContain('what we LEARN about an entity');
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
    it('describes artifact utility and ownership', () => {
      expect(PROMPT_ARTIFACTS).toContain('ARTIFACTS');
      expect(PROMPT_ARTIFACTS).toContain('UTILITY');
      expect(PROMPT_ARTIFACTS).toContain('Character-owned');
      expect(PROMPT_ARTIFACTS).toContain('Location-owned');
      expect(PROMPT_ARTIFACTS).toContain('World-owned');
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

  it('includes lifecycle stages', () => {
    const result = promptThreadLifecycle();
    expect(result).toContain('latent');
    expect(result).toContain('seeded');
    expect(result).toContain('critical');
  });

  it('includes terminal statuses', () => {
    const result = promptThreadLifecycle();
    expect(result).toContain('resolved');
    expect(result).toContain('subverted');
  });

  it('mentions bandwidth and fate', () => {
    const result = promptThreadLifecycle();
    expect(result).toContain('bandwidth');
  });
});

// ── buildThreadHealthPrompt ──────────────────────────────────────────────────

describe('buildThreadHealthPrompt', () => {
  it('returns empty string when no threads exist', () => {
    const n = createMinimalNarrative();
    const result = buildThreadHealthPrompt(n, [], 0);
    expect(result).toBe('');
  });

  it('includes bandwidth header', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Test thread', 'active') },
    });
    const result = buildThreadHealthPrompt(n, [], 0);
    expect(result).toContain('THREAD BANDWIDTH');
    expect(result).toContain('1 active');
  });

  it('reports thread description and status', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'The mystery unfolds', 'latent') },
    });
    const result = buildThreadHealthPrompt(n, [], 0);
    expect(result).toContain('The mystery unfolds');
    expect(result).toContain('latent');
  });

  it('reports activeArcs and bandwidth ratio', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Quest thread', 'active') },
      scenes: {
        s1: createScene('s1', [{ threadId: 't1', from: 'latent', to: 'active' }]),
      },
    });
    const result = buildThreadHealthPrompt(n, ['s1'], 0);
    expect(result).toContain('activeArcs');
  });

  it('shows convergence links when present', () => {
    const t1 = createThread('t1', 'Main thread', 'active');
    t1.dependents = ['t2'];
    const n = createMinimalNarrative({
      threads: {
        t1,
        t2: createThread('t2', 'Sub thread', 'latent'),
      },
    });
    const result = buildThreadHealthPrompt(n, [], 0);
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
    const result = buildThreadHealthPrompt(n, [], 0);
    expect(result).toContain('1/2 resolved');
  });

  it('flags starved active threads', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Starved thread', 'active') },
      arcs: { 'ARC-01': { id: 'ARC-01', name: 'Arc 1', sceneIds: [], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} } },
    });
    const result = buildThreadHealthPrompt(n, [], 0);
    expect(result).toContain('EMERGENCY');
  });
});

// ── buildCompletedBeatsPrompt ────────────────────────────────────────────────

describe('buildCompletedBeatsPrompt', () => {
  it('returns empty string when no transitions have occurred', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Test', 'latent') },
      scenes: {
        s1: createScene('s1', [{ threadId: 't1', from: 'latent', to: 'latent' }]), // pulse, not transition
      },
    });
    const result = buildCompletedBeatsPrompt(n, ['s1'], 0);
    expect(result).toBe('');
  });

  it('includes SPENT BEATS header', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Test thread', 'active') },
      scenes: {
        s1: createScene('s1', [{ threadId: 't1', from: 'latent', to: 'active' }]),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ['s1'], 0);
    expect(result).toContain('SPENT BEATS');
    expect(result).toContain('CLOSED');
  });

  it('lists thread transition chain', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Quest thread', 'active') },
      scenes: {
        s1: createScene('s1', [{ threadId: 't1', from: 'latent', to: 'active' }]),
        s2: createScene('s2', [{ threadId: 't1', from: 'active', to: 'active' }]),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ['s1', 's2'], 1);
    expect(result).toContain('Quest thread');
    expect(result).toContain('latent → active');
    expect(result).toContain('active');
  });

  it('includes scene summaries', () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread('t1', 'Test', 'active') },
      scenes: {
        s1: createScene('s1', [{ threadId: 't1', from: 'latent', to: 'active' }], {
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
        s1: createScene('s1', [{ threadId: 't1', from: 'latent', to: 'active' }], {
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
        t2: createThread('t2', 'Thread two', 'active'),
      },
      scenes: {
        s1: createScene('s1', [
          { threadId: 't1', from: 'latent', to: 'active' },
          { threadId: 't2', from: 'latent', to: 'active' },
        ]),
        s2: createScene('s2', [
          { threadId: 't2', from: 'active', to: 'active' },
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
        s1: createScene('s1', [{ threadId: 't1', from: 'latent', to: 'active' }]),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ['s1'], 0);
    expect(result).toContain('A'.repeat(50)); // Truncated to 50 chars
    expect(result).not.toContain('A'.repeat(60));
  });
});
