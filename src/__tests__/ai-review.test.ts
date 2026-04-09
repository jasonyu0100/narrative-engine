import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NarrativeState, Scene, Arc, Thread, Character, Location, BeatPlan } from '@/types/narrative';

// Mock the AI module
vi.mock('@/lib/ai/api', () => ({
  callGenerate: vi.fn(),
  callGenerateStream: vi.fn(),
  SYSTEM_PROMPT: 'Test system prompt',
}));

import {
  reviewBranch,
  reviewProseQuality,
  reviewPlanQuality,
} from '@/lib/ai/review';
import { callGenerate, callGenerateStream } from '@/lib/ai/api';

// ── Test Fixtures ────────────────────────────────────────────────────────────

/** Extends Partial<Scene> with shorthand `prose` and `plan` fields that
 *  get auto-wrapped into `proseVersions` / `planVersions` by createScene. */
type SceneOverrides = Partial<Scene> & { prose?: string; plan?: BeatPlan };

function createScene(id: string, overrides: SceneOverrides = {}): Scene {
  // Pull out shorthand fields before spreading
  const { prose, plan, ...rest } = overrides;

  const scene: Scene = {
    kind: 'scene',
    id,
    arcId: 'arc-1',
    povId: 'char-1',
    locationId: 'loc-1',
    participantIds: ['char-1'],
    summary: `Scene ${id} summary`,
    events: [],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    characterMovements: {},
    ...rest,
  };

  // Shorthand: prose override auto-wraps into proseVersions
  if (prose !== undefined) {
    scene.proseVersions = [{
      version: '1.0.0',
      branchId: 'main',
      prose,
      timestamp: Date.now(),
      versionType: 'generate',
    }];
  }

  // Shorthand: plan override auto-wraps into planVersions
  if (plan !== undefined) {
    scene.planVersions = [{
      version: '1.0.0',
      branchId: 'main',
      plan,
      timestamp: Date.now(),
      versionType: 'generate',
    }];
  }

  return scene;
}

function createArc(id: string, overrides: Partial<Arc> = {}): Arc {
  return {
    id,
    name: `Arc ${id}`,
    sceneIds: [],
    develops: [],
    locationIds: [],
    activeCharacterIds: [],
    initialCharacterLocations: {},
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
    ...overrides,
  };
}

function createCharacter(id: string, overrides: Partial<Character> = {}): Character {
  return {
    id,
    name: `Character ${id}`,
    role: 'recurring',
    continuity: { nodes: {}, edges: [] },
    threadIds: [],
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
    continuity: { nodes: {}, edges: [] },
    threadIds: [],
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
      'char-2': createCharacter('char-2', { name: 'Bob' }),
    },
    locations: {
      'loc-1': createLocation('loc-1', { name: 'Castle' }),
    },
    threads: {
      'T-001': createThread('T-001', { description: 'Main mystery' }),
    },
    artifacts: {},
    scenes: {},
    arcs: {
      'arc-1': createArc('arc-1', { name: 'First Arc' }),
    },
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
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── evaluateBranch Tests ─────────────────────────────────────────────────────

describe('evaluateBranch', () => {
  it('returns empty result when no scenes', async () => {
    const narrative = createMinimalNarrative();
    const result = await reviewBranch(narrative, [], 'main');

    expect(result.overall).toBe('No scenes to evaluate.');
    expect(result.sceneEvals).toEqual([]);
    expect(result.branchId).toBe('main');
    expect(callGenerate).not.toHaveBeenCalled();
  });

  it('parses valid evaluation response', async () => {
    const mockResponse = JSON.stringify({
      overall: 'Good structure overall with some pacing issues.',
      sceneEvals: [
        { sceneId: 'S-001', verdict: 'ok', reason: 'Strong opening' },
        { sceneId: 'S-002', verdict: 'edit', reason: 'Needs more tension' },
      ],
      repetitions: ['Location reuse', 'Similar dialogue'],
      thematicQuestion: 'What is the cost of power?',
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'S-001': createScene('S-001', { summary: 'Hero arrives' }),
      'S-002': createScene('S-002', { summary: 'First challenge' }),
    };

    const result = await reviewBranch(narrative, ['S-001', 'S-002'], 'main');

    expect(result.overall).toBe('Good structure overall with some pacing issues.');
    expect(result.sceneEvals.length).toBe(2);
    expect(result.sceneEvals[0].verdict).toBe('ok');
    expect(result.sceneEvals[1].verdict).toBe('edit');
    expect(result.repetitions).toContain('Location reuse');
    expect(result.thematicQuestion).toBe('What is the cost of power?');
  });

  it('handles all verdict types', async () => {
    const mockResponse = JSON.stringify({
      overall: 'Mixed results',
      sceneEvals: [
        { sceneId: 'S-001', verdict: 'ok', reason: 'Works' },
        { sceneId: 'S-002', verdict: 'edit', reason: 'Needs work' },
        { sceneId: 'S-003', verdict: 'merge', reason: 'Combine', mergeInto: 'S-002' },
        { sceneId: 'S-004', verdict: 'cut', reason: 'Remove' },
        { sceneId: 'S-005', verdict: 'move', reason: 'Reposition', moveAfter: 'S-001' },
        { sceneId: 'INSERT-1', verdict: 'insert', reason: 'Add scene', insertAfter: 'S-001' },
      ],
      repetitions: [],
      thematicQuestion: '',
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'S-001': createScene('S-001'),
      'S-002': createScene('S-002'),
      'S-003': createScene('S-003'),
      'S-004': createScene('S-004'),
      'S-005': createScene('S-005'),
    };

    const result = await reviewBranch(narrative, ['S-001', 'S-002', 'S-003', 'S-004', 'S-005'], 'main');

    expect(result.sceneEvals.find((e) => e.sceneId === 'S-001')?.verdict).toBe('ok');
    expect(result.sceneEvals.find((e) => e.sceneId === 'S-002')?.verdict).toBe('edit');
    expect(result.sceneEvals.find((e) => e.sceneId === 'S-003')?.verdict).toBe('merge');
    expect(result.sceneEvals.find((e) => e.sceneId === 'S-003')?.mergeInto).toBe('S-002');
    expect(result.sceneEvals.find((e) => e.sceneId === 'S-004')?.verdict).toBe('cut');
    expect(result.sceneEvals.find((e) => e.sceneId === 'S-005')?.verdict).toBe('move');
    expect(result.sceneEvals.find((e) => e.sceneId === 'S-005')?.moveAfter).toBe('S-001');
    expect(result.sceneEvals.find((e) => e.sceneId === 'INSERT-1')?.verdict).toBe('insert');
  });

  it('converts merge to cut when target is invalid', async () => {
    const mockResponse = JSON.stringify({
      overall: 'Analysis',
      sceneEvals: [
        { sceneId: 'S-001', verdict: 'merge', reason: 'Merge', mergeInto: 'NONEXISTENT' },
      ],
      repetitions: [],
      thematicQuestion: '',
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    narrative.scenes = { 'S-001': createScene('S-001') };

    const result = await reviewBranch(narrative, ['S-001'], 'main');

    // Should convert to cut because target doesn't exist
    expect(result.sceneEvals[0].verdict).toBe('cut');
    expect(result.sceneEvals[0].reason).toContain('merge target invalid');
  });

  it('converts invalid verdict to ok', async () => {
    const mockResponse = JSON.stringify({
      overall: 'Analysis',
      sceneEvals: [
        { sceneId: 'S-001', verdict: 'invalid_verdict', reason: 'Test' },
      ],
      repetitions: [],
      thematicQuestion: '',
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    narrative.scenes = { 'S-001': createScene('S-001') };

    const result = await reviewBranch(narrative, ['S-001'], 'main');

    expect(result.sceneEvals[0].verdict).toBe('ok');
  });

  it('handles parse failure gracefully', async () => {
    vi.mocked(callGenerate).mockResolvedValue('Not valid JSON at all');

    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'S-001': createScene('S-001'),
      'S-002': createScene('S-002'),
    };

    const result = await reviewBranch(narrative, ['S-001', 'S-002'], 'main');

    expect(result.overall).toContain('parse failed');
    expect(result.sceneEvals.length).toBe(2);
    expect(result.sceneEvals.every((e) => e.verdict === 'ok')).toBe(true);
  });

  it('uses streaming when onReasoning callback provided', async () => {
    const mockResponse = JSON.stringify({
      overall: 'Streamed analysis',
      sceneEvals: [{ sceneId: 'S-001', verdict: 'ok', reason: 'Good' }],
      repetitions: [],
      thematicQuestion: 'Theme?',
    });
    vi.mocked(callGenerateStream).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    narrative.scenes = { 'S-001': createScene('S-001') };
    const onReasoning = vi.fn();

    const result = await reviewBranch(narrative, ['S-001'], 'main', undefined, onReasoning);

    expect(callGenerateStream).toHaveBeenCalled();
    expect(callGenerate).not.toHaveBeenCalled();
    expect(result.overall).toBe('Streamed analysis');
  });

  it('includes guidance in prompt when provided', async () => {
    const mockResponse = JSON.stringify({
      overall: 'Guided analysis',
      sceneEvals: [],
      repetitions: [],
      thematicQuestion: '',
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    narrative.scenes = { 'S-001': createScene('S-001') };

    await reviewBranch(narrative, ['S-001'], 'main', 'Focus on pacing issues');

    const promptArg = vi.mocked(callGenerate).mock.calls[0][0];
    expect(promptArg).toContain('Focus on pacing issues');
    expect(promptArg).toContain('PRIORITY GUIDANCE');
  });

  it('filters out evals for non-existent scenes', async () => {
    const mockResponse = JSON.stringify({
      overall: 'Analysis',
      sceneEvals: [
        { sceneId: 'S-001', verdict: 'ok', reason: 'Good' },
        { sceneId: 'S-NONEXISTENT', verdict: 'ok', reason: 'Bad' },
      ],
      repetitions: [],
      thematicQuestion: '',
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    narrative.scenes = { 'S-001': createScene('S-001') };

    const result = await reviewBranch(narrative, ['S-001'], 'main');

    expect(result.sceneEvals.length).toBe(1);
    expect(result.sceneEvals[0].sceneId).toBe('S-001');
  });

  it('generates unique evaluation ID', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      overall: 'Test',
      sceneEvals: [],
      repetitions: [],
      thematicQuestion: '',
    }));

    const narrative = createMinimalNarrative();
    narrative.scenes = { 'S-001': createScene('S-001') };

    const result1 = await reviewBranch(narrative, ['S-001'], 'main');
    const result2 = await reviewBranch(narrative, ['S-001'], 'main');

    expect(result1.id).toMatch(/^EVAL-/);
    expect(result2.id).toMatch(/^EVAL-/);
  });
});

// ── evaluateProseQuality Tests ───────────────────────────────────────────────

describe('evaluateProseQuality', () => {
  it('returns empty result when no scenes have prose', async () => {
    const narrative = createMinimalNarrative();
    narrative.scenes = { 'S-001': createScene('S-001', { prose: undefined }) };

    const result = await reviewProseQuality(narrative, ['S-001'], 'main');

    expect(result.overall).toBe('No scenes with prose to evaluate.');
    expect(result.sceneEvals).toEqual([]);
    expect(callGenerate).not.toHaveBeenCalled();
  });

  it('parses valid prose evaluation response', async () => {
    const mockResponse = JSON.stringify({
      overall: 'Strong prose with some repetition.',
      sceneEvals: [
        { sceneId: 'S-001', verdict: 'ok', issues: [] },
        { sceneId: 'S-002', verdict: 'edit', issues: ['Dialogue too formal', 'Missing sensory detail'] },
      ],
      patterns: ['Overuse of adverbs'],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'S-001': createScene('S-001', { prose: 'The hero walked into the room.' }),
      'S-002': createScene('S-002', { prose: 'She said formally, "Good day."' }),
    };

    const result = await reviewProseQuality(narrative, ['S-001', 'S-002'], 'main');

    expect(result.overall).toBe('Strong prose with some repetition.');
    expect(result.sceneEvals.length).toBe(2);
    expect(result.sceneEvals[0].verdict).toBe('ok');
    expect(result.sceneEvals[1].verdict).toBe('edit');
    expect(result.sceneEvals[1].issues).toContain('Dialogue too formal');
    expect(result.patterns).toContain('Overuse of adverbs');
  });

  it('handles parse failure gracefully', async () => {
    vi.mocked(callGenerate).mockResolvedValue('Invalid JSON');

    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'S-001': createScene('S-001', { prose: 'Some prose text.' }),
    };

    const result = await reviewProseQuality(narrative, ['S-001'], 'main');

    expect(result.overall).toContain('parse failed');
    expect(result.sceneEvals.length).toBe(1);
    expect(result.sceneEvals[0].verdict).toBe('ok');
    expect(result.sceneEvals[0].issues).toContain('Parse failed — defaulted');
  });

  it('includes prose profile in prompt when available', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      overall: 'Analysis',
      sceneEvals: [],
      patterns: [],
    }));

    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'S-001': createScene('S-001', { prose: 'Text' }),
    };
    narrative.proseProfile = {
      register: 'literary',
      stance: 'close third',
      tense: 'past',
      sentenceRhythm: 'varied',
      interiority: 'deep',
      dialogueWeight: 'moderate',
      devices: ['metaphor', 'symbolism'],
      rules: ['Show, don\'t tell'],
      antiPatterns: ['No adverbs in dialogue tags'],
    };

    await reviewProseQuality(narrative, ['S-001'], 'main');

    const promptArg = vi.mocked(callGenerate).mock.calls[0][0];
    expect(promptArg).toContain('PROSE PROFILE');
    expect(promptArg).toContain('literary');
    expect(promptArg).toContain('close third');
    expect(promptArg).toContain('metaphor');
    expect(promptArg).toContain('No adverbs in dialogue tags');
  });

  it('uses streaming when onReasoning provided', async () => {
    vi.mocked(callGenerateStream).mockResolvedValue(JSON.stringify({
      overall: 'Streamed',
      sceneEvals: [],
      patterns: [],
    }));

    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'S-001': createScene('S-001', { prose: 'Text' }),
    };
    const onReasoning = vi.fn();

    await reviewProseQuality(narrative, ['S-001'], 'main', undefined, onReasoning);

    expect(callGenerateStream).toHaveBeenCalled();
  });

  it('filters issues to strings only', async () => {
    const mockResponse = JSON.stringify({
      overall: 'Analysis',
      sceneEvals: [
        { sceneId: 'S-001', verdict: 'edit', issues: ['Valid issue', 123, null, { obj: true }] },
      ],
      patterns: [],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'S-001': createScene('S-001', { prose: 'Text' }),
    };

    const result = await reviewProseQuality(narrative, ['S-001'], 'main');

    expect(result.sceneEvals[0].issues).toEqual(['Valid issue']);
  });

  it('generates unique prose evaluation ID', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      overall: 'Test',
      sceneEvals: [],
      patterns: [],
    }));

    const narrative = createMinimalNarrative();
    narrative.scenes = { 'S-001': createScene('S-001', { prose: 'Text' }) };

    const result = await reviewProseQuality(narrative, ['S-001'], 'main');

    expect(result.id).toMatch(/^PEVAL-/);
  });
});

// ── evaluatePlanQuality Tests ────────────────────────────────────────────────

describe('evaluatePlanQuality', () => {
  it('returns empty result when no scenes have plans', async () => {
    const narrative = createMinimalNarrative();
    narrative.scenes = { 'S-001': createScene('S-001', { plan: undefined }) };

    const result = await reviewPlanQuality(narrative, ['S-001'], 'main');

    expect(result.overall).toBe('No scenes with beat plans to evaluate.');
    expect(result.sceneEvals).toEqual([]);
    expect(callGenerate).not.toHaveBeenCalled();
  });

  it('parses valid plan evaluation response', async () => {
    const mockResponse = JSON.stringify({
      overall: 'Plans are well-structured with some continuity issues.',
      sceneEvals: [
        { sceneId: 'S-001', verdict: 'ok', issues: [] },
        { sceneId: 'S-002', verdict: 'edit', issues: ['Beat 3: Character knowledge leak'] },
      ],
      patterns: ['Rushed transitions between beats'],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'S-001': createScene('S-001', {
        plan: {
          beats: [
            { fn: 'breathe', mechanism: 'environment', what: 'Intro scene', propositions: [{ content: 'The door opens' }] },
          ],
        },
      }),
      'S-002': createScene('S-002', {
        plan: {
          beats: [
            { fn: 'advance', mechanism: 'action', what: 'Discovery', propositions: [{ content: 'She finds the letter' }] },
          ],
        },
      }),
    };

    const result = await reviewPlanQuality(narrative, ['S-001', 'S-002'], 'main');

    expect(result.overall).toBe('Plans are well-structured with some continuity issues.');
    expect(result.sceneEvals.length).toBe(2);
    expect(result.sceneEvals[0].verdict).toBe('ok');
    expect(result.sceneEvals[1].verdict).toBe('edit');
    expect(result.sceneEvals[1].issues).toContain('Beat 3: Character knowledge leak');
    expect(result.patterns).toContain('Rushed transitions between beats');
  });

  it('handles parse failure gracefully', async () => {
    vi.mocked(callGenerate).mockResolvedValue('Not JSON');

    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'S-001': createScene('S-001', {
        plan: { beats: [{ fn: 'breathe', mechanism: 'environment', what: 'Test', propositions: [{ content: 'Anchor' }] }] },
      }),
    };

    const result = await reviewPlanQuality(narrative, ['S-001'], 'main');

    expect(result.overall).toContain('parse failed');
    expect(result.sceneEvals.length).toBe(1);
    expect(result.sceneEvals[0].verdict).toBe('ok');
  });

  it('includes character knowledge in prompt', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      overall: 'Analysis',
      sceneEvals: [],
      patterns: [],
    }));

    const narrative = createMinimalNarrative();
    narrative.characters['char-1'] = createCharacter('char-1', {
      name: 'Alice',
      continuity: {
        nodes: {
          'node-1': { id: 'node-1', content: 'Knows the secret', type: 'secret' },
          'node-2': { id: 'node-2', content: 'Has the key', type: 'capability' },
        },
        edges: [],
      },
    });
    narrative.scenes = {
      'S-001': createScene('S-001', {
        plan: { beats: [{ fn: 'breathe', mechanism: 'environment', what: 'Test', propositions: [{ content: 'A' }] }] },
      }),
    };

    await reviewPlanQuality(narrative, ['S-001'], 'main');

    const promptArg = vi.mocked(callGenerate).mock.calls[0][0];
    expect(promptArg).toContain('CHARACTER KNOWLEDGE');
    expect(promptArg).toContain('Alice');
    expect(promptArg).toContain('Knows the secret');
  });

  it('uses streaming when onReasoning provided', async () => {
    vi.mocked(callGenerateStream).mockResolvedValue(JSON.stringify({
      overall: 'Streamed',
      sceneEvals: [],
      patterns: [],
    }));

    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'S-001': createScene('S-001', {
        plan: { beats: [{ fn: 'breathe', mechanism: 'environment', what: 'Test', propositions: [{ content: 'A' }] }] },
      }),
    };
    const onReasoning = vi.fn();

    await reviewPlanQuality(narrative, ['S-001'], 'main', undefined, onReasoning);

    expect(callGenerateStream).toHaveBeenCalled();
  });

  it('generates unique plan evaluation ID', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      overall: 'Test',
      sceneEvals: [],
      patterns: [],
    }));

    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'S-001': createScene('S-001', {
        plan: { beats: [{ fn: 'breathe', mechanism: 'environment', what: 'Test', propositions: [{ content: 'A' }] }] },
      }),
    };

    const result = await reviewPlanQuality(narrative, ['S-001'], 'main');

    expect(result.id).toMatch(/^PLEVAL-/);
  });

  it('skips scenes without beats', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      overall: 'Analysis',
      sceneEvals: [{ sceneId: 'S-002', verdict: 'ok', issues: [] }],
      patterns: [],
    }));

    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'S-001': createScene('S-001', { plan: { beats: [] } }), // Empty beats
      'S-002': createScene('S-002', {
        plan: { beats: [{ fn: 'breathe', mechanism: 'environment', what: 'Test', propositions: [{ content: 'A' }] }] },
      }),
    };

    const result = await reviewPlanQuality(narrative, ['S-001', 'S-002'], 'main');

    expect(result.sceneEvals.length).toBe(1);
    expect(result.sceneEvals[0].sceneId).toBe('S-002');
  });

  it('includes guidance in prompt when provided', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      overall: 'Guided analysis',
      sceneEvals: [],
      patterns: [],
    }));

    const narrative = createMinimalNarrative();
    narrative.scenes = {
      'S-001': createScene('S-001', {
        plan: { beats: [{ fn: 'breathe', mechanism: 'environment', what: 'Test', propositions: [{ content: 'A' }] }] },
      }),
    };

    await reviewPlanQuality(narrative, ['S-001'], 'main', 'Check beat consistency');

    const promptArg = vi.mocked(callGenerate).mock.calls[0][0];
    expect(promptArg).toContain('Check beat consistency');
    expect(promptArg).toContain('PRIORITY GUIDANCE');
  });
});
