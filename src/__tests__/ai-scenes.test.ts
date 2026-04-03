import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NarrativeState, Scene, Character, Location, Thread, BeatPlan } from '@/types/narrative';

// Mock the AI module
vi.mock('@/lib/ai/api', () => ({
  callGenerate: vi.fn(),
  callGenerateStream: vi.fn(),
  SYSTEM_PROMPT: 'Test system prompt',
}));

// Mock context building
vi.mock('@/lib/ai/context', () => ({
  narrativeContext: vi.fn().mockReturnValue('Mock narrative context'),
  sceneContext: vi.fn().mockReturnValue('Mock scene context'),
  deriveLogicRules: vi.fn().mockReturnValue(''),
  sceneScale: vi.fn().mockReturnValue({ estWords: 1500 }),
}));

// Mock prompts
vi.mock('@/lib/ai/prompts', () => ({
  PROMPT_FORCE_STANDARDS: 'Mock force standards',
  PROMPT_STRUCTURAL_RULES: 'Mock structural rules',
  PROMPT_MUTATIONS: 'Mock mutations',
  PROMPT_ARTIFACTS: 'Mock artifacts',
  PROMPT_POV: 'Mock POV',
  PROMPT_CONTINUITY: 'Mock continuity',
  PROMPT_SUMMARY_REQUIREMENT: 'Mock summary requirement',
  promptThreadLifecycle: vi.fn().mockReturnValue('Mock thread lifecycle'),
  buildThreadHealthPrompt: vi.fn().mockReturnValue('Mock thread health'),
  buildCompletedBeatsPrompt: vi.fn().mockReturnValue('Mock completed beats'),
}));

// Mock markov functions
vi.mock('@/lib/markov', () => ({
  samplePacingSequence: vi.fn().mockReturnValue({
    steps: [
      { mode: 'HHH', name: 'Climax', description: 'High everything', forces: { payoff: [1, 2], change: [1, 2], knowledge: [1, 2] } },
    ],
    pacingDescription: 'Test pacing',
  }),
  buildSequencePrompt: vi.fn().mockReturnValue('Mock sequence prompt'),
  buildSingleStepPrompt: vi.fn().mockReturnValue('Mock step prompt'),
  detectCurrentMode: vi.fn().mockReturnValue('LLL'),
  MATRIX_PRESETS: [],
  DEFAULT_TRANSITION_MATRIX: {},
}));

// Mock beat profiles
vi.mock('@/lib/beat-profiles', () => ({
  resolveProfile: vi.fn().mockReturnValue({
    register: 'literary',
    stance: 'close_third',
    devices: ['metaphor'],
    rules: ['Show, dont tell'],
    antiPatterns: ['Purple prose'],
  }),
  resolveSampler: vi.fn().mockReturnValue({
    beatsPerKWord: 12,
  }),
  sampleBeatSequence: vi.fn().mockReturnValue([
    { fn: 'breathe', mechanism: 'environment' },
    { fn: 'advance', mechanism: 'action' },
    { fn: 'turn', mechanism: 'dialogue' },
  ]),
}));

import { generateScenes, generateScenePlan, editScenePlan, reverseEngineerScenePlan, rewriteScenePlan, generateSceneProse } from '@/lib/ai/scenes';
import { callGenerate, callGenerateStream } from '@/lib/ai/api';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createScene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    kind: 'scene',
    id,
    arcId: 'ARC-01',
    povId: 'C-01',
    locationId: 'L-01',
    participantIds: ['C-01'],
    summary: `Scene ${id} summary`,
    events: ['event_1'],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    characterMovements: {},
    ...overrides,
  };
}

function createCharacter(id: string, overrides: Partial<Character> = {}): Character {
  return {
    id,
    name: `Character ${id}`,
    role: 'recurring',
    threadIds: [],
    continuity: { nodes: [] },
    ...overrides,
  };
}

function createLocation(id: string, overrides: Partial<Location> = {}): Location {
  return {
    id,
    name: `Location ${id}`,
    parentId: null,
    threadIds: [],
    continuity: { nodes: [] },
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

function createMinimalNarrative(): NarrativeState {
  return {
    id: 'N-001',
    title: 'Test Narrative',
    description: 'A test story',
    characters: {
      'C-01': createCharacter('C-01', { name: 'Alice' }),
      'C-02': createCharacter('C-02', { name: 'Bob' }),
    },
    locations: {
      'L-01': createLocation('L-01', { name: 'Castle' }),
      'L-02': createLocation('L-02', { name: 'Forest' }),
    },
    threads: {
      'T-01': createThread('T-01', { description: 'Main quest' }),
      'T-02': createThread('T-02', { description: 'Side quest' }),
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
    worldKnowledge: { nodes: {}, edges: [] },
    worldSummary: 'A fantasy world',
    rules: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── generateScenes Tests ─────────────────────────────────────────────────────

describe('generateScenes', () => {
  it('returns parsed scenes and arc from LLM response', async () => {
    const mockResponse = JSON.stringify({
      arcName: 'The Siege Begins',
      directionVector: 'Alice leads the defense while Bob scouts.',
      scenes: [
        {
          id: 'S-GEN-001',
          arcId: 'ARC-01',
          locationId: 'L-01',
          povId: 'C-01',
          participantIds: ['C-01', 'C-02'],
          events: ['battle_prep'],
          threadMutations: [{ threadId: 'T-01', from: 'active', to: 'escalating' }],
          continuityMutations: [],
          relationshipMutations: [],
          summary: 'Alice prepares the castle defenses while Bob rides out.',
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, 'Test direction');

    expect(result.scenes).toHaveLength(1);
    expect(result.arc.name).toBe('The Siege Begins');
    expect(result.scenes[0].summary).toContain('Alice prepares');
  });

  it('assigns sequential scene IDs', async () => {
    const mockResponse = JSON.stringify({
      arcName: 'Test Arc',
      scenes: [
        { id: 'S-GEN-001', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01', participantIds: ['C-01'], events: [], threadMutations: [], continuityMutations: [], relationshipMutations: [], summary: 'Scene 1' },
        { id: 'S-GEN-002', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01', participantIds: ['C-01'], events: [], threadMutations: [], continuityMutations: [], relationshipMutations: [], summary: 'Scene 2' },
        { id: 'S-GEN-003', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01', participantIds: ['C-01'], events: [], threadMutations: [], continuityMutations: [], relationshipMutations: [], summary: 'Scene 3' },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 3, 'Test direction');

    expect(result.scenes[0].id).toBe('S-001');
    expect(result.scenes[1].id).toBe('S-002');
    expect(result.scenes[2].id).toBe('S-003');
  });

  it('sanitizes invalid character IDs from participantIds', async () => {
    const mockResponse = JSON.stringify({
      arcName: 'Test Arc',
      scenes: [
        {
          id: 'S-GEN-001',
          arcId: 'ARC-01',
          locationId: 'L-01',
          povId: 'C-01',
          participantIds: ['C-01', 'C-INVALID', 'C-02'],
          events: [],
          threadMutations: [],
          continuityMutations: [],
          relationshipMutations: [],
          summary: 'Test scene',
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, 'Test');

    // Invalid character should be stripped
    expect(result.scenes[0].participantIds).toEqual(['C-01', 'C-02']);
  });

  it('sanitizes invalid location IDs', async () => {
    const mockResponse = JSON.stringify({
      arcName: 'Test Arc',
      scenes: [
        {
          id: 'S-GEN-001',
          arcId: 'ARC-01',
          locationId: 'L-INVALID',
          povId: 'C-01',
          participantIds: ['C-01'],
          events: [],
          threadMutations: [],
          continuityMutations: [],
          relationshipMutations: [],
          summary: 'Test scene',
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, 'Test');

    // Invalid location should be replaced with first valid location
    expect(result.scenes[0].locationId).toBe('L-01');
  });

  it('sanitizes invalid thread IDs in threadMutations', async () => {
    const mockResponse = JSON.stringify({
      arcName: 'Test Arc',
      scenes: [
        {
          id: 'S-GEN-001',
          arcId: 'ARC-01',
          locationId: 'L-01',
          povId: 'C-01',
          participantIds: ['C-01'],
          events: [],
          threadMutations: [
            { threadId: 'T-01', from: 'active', to: 'escalating' },
            { threadId: 'T-INVALID', from: 'active', to: 'critical' },
          ],
          continuityMutations: [],
          relationshipMutations: [],
          summary: 'Test scene',
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, 'Test');

    // Only valid thread mutation should remain
    expect(result.scenes[0].threadMutations).toHaveLength(1);
    expect(result.scenes[0].threadMutations[0].threadId).toBe('T-01');
  });

  it('builds arc with correct metadata', async () => {
    const mockResponse = JSON.stringify({
      arcName: 'Test Arc',
      directionVector: 'Characters face challenges',
      scenes: [
        { id: 'S-GEN-001', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01', participantIds: ['C-01'], events: [], threadMutations: [{ threadId: 'T-01', from: 'active', to: 'escalating' }], continuityMutations: [], relationshipMutations: [], summary: 'Scene 1' },
        { id: 'S-GEN-002', arcId: 'ARC-01', locationId: 'L-02', povId: 'C-02', participantIds: ['C-02'], events: [], threadMutations: [{ threadId: 'T-02', from: 'active', to: 'critical' }], continuityMutations: [], relationshipMutations: [], summary: 'Scene 2' },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 2, 'Test');

    expect(result.arc.name).toBe('Test Arc');
    expect(result.arc.directionVector).toBe('Characters face challenges');
    expect(result.arc.sceneIds).toHaveLength(2);
    expect(result.arc.develops).toContain('T-01');
    expect(result.arc.develops).toContain('T-02');
    expect(result.arc.locationIds).toContain('L-01');
    expect(result.arc.locationIds).toContain('L-02');
    expect(result.arc.activeCharacterIds).toContain('C-01');
    expect(result.arc.activeCharacterIds).toContain('C-02');
  });

  it('continues existing arc when provided', async () => {
    const mockResponse = JSON.stringify({
      scenes: [
        { id: 'S-GEN-001', arcId: 'ARC-EXISTING', locationId: 'L-02', povId: 'C-02', participantIds: ['C-02'], events: [], threadMutations: [], continuityMutations: [], relationshipMutations: [], summary: 'Continuation scene' },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const existingArc = {
      id: 'ARC-EXISTING',
      name: 'Existing Arc',
      sceneIds: ['S-001', 'S-002'],
      develops: ['T-01'],
      locationIds: ['L-01'],
      activeCharacterIds: ['C-01'],
      initialCharacterLocations: { 'C-01': 'L-01' },
    };

    const result = await generateScenes(narrative, [], 0, 1, 'Continue', { existingArc });

    expect(result.arc.id).toBe('ARC-EXISTING');
    expect(result.arc.name).toBe('Existing Arc');
    expect(result.arc.sceneIds).toContain('S-001');
    expect(result.arc.sceneIds).toContain('S-002');
    expect(result.arc.locationIds).toContain('L-01');
    expect(result.arc.locationIds).toContain('L-02');
  });

  it('assigns sequential knowledge mutation IDs', async () => {
    const mockResponse = JSON.stringify({
      arcName: 'Test Arc',
      scenes: [
        {
          id: 'S-GEN-001',
          arcId: 'ARC-01',
          locationId: 'L-01',
          povId: 'C-01',
          participantIds: ['C-01'],
          events: [],
          threadMutations: [],
          continuityMutations: [
            { characterId: 'C-01', nodeId: 'K-GEN-001', action: 'added', content: 'First knowledge', nodeType: 'fact' },
            { characterId: 'C-01', nodeId: 'K-GEN-002', action: 'added', content: 'Second knowledge', nodeType: 'secret' },
          ],
          relationshipMutations: [],
          summary: 'Test scene',
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, 'Test');

    // Knowledge IDs should be sequential K-01, K-02 (2-digit padding)
    expect(result.scenes[0].continuityMutations[0].nodeId).toBe('K-01');
    expect(result.scenes[0].continuityMutations[1].nodeId).toBe('K-02');
  });

  it('retries on JSON parse failure', async () => {
    vi.mocked(callGenerate)
      .mockRejectedValueOnce(new Error('Invalid JSON'))
      .mockResolvedValueOnce(JSON.stringify({
        arcName: 'Test Arc',
        scenes: [
          { id: 'S-GEN-001', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01', participantIds: ['C-01'], events: [], threadMutations: [], continuityMutations: [], relationshipMutations: [], summary: 'Test' },
        ],
      }));

    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, 'Test');

    expect(result.scenes).toHaveLength(1);
    expect(vi.mocked(callGenerate)).toHaveBeenCalledTimes(2);
  });
});

// ── generateScenePlan Tests ──────────────────────────────────────────────────

describe('generateScenePlan', () => {
  it('returns parsed beat plan from LLM response', async () => {
    const mockResponse = JSON.stringify({
      beats: [
        { fn: 'breathe', mechanism: 'environment', what: 'Fog rolls across the field', anchor: 'The grey mist' },
        { fn: 'advance', mechanism: 'action', what: 'Alice draws her sword', anchor: 'Steel singing' },
        { fn: 'turn', mechanism: 'dialogue', what: 'Bob reveals the betrayal', anchor: '"You never knew"' },
      ],
      anchors: ['The fog tasted of ash and old promises.'],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const scene = createScene('S-001');

    const result = await generateScenePlan(narrative, scene, []);

    expect(result.beats).toHaveLength(3);
    expect(result.beats[0].fn).toBe('breathe');
    expect(result.beats[0].mechanism).toBe('environment');
    expect(result.anchors).toHaveLength(1);
  });

  it('validates beat function values', async () => {
    const mockResponse = JSON.stringify({
      beats: [
        { fn: 'invalid_fn', mechanism: 'action', what: 'Something happens', anchor: 'detail' },
        { fn: 'advance', mechanism: 'action', what: 'Valid beat', anchor: 'anchor' },
      ],
      anchors: [],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const scene = createScene('S-001');

    const result = await generateScenePlan(narrative, scene, []);

    // Invalid fn should default to 'advance'
    expect(result.beats[0].fn).toBe('advance');
    expect(result.beats[1].fn).toBe('advance');
  });

  it('validates mechanism values', async () => {
    const mockResponse = JSON.stringify({
      beats: [
        { fn: 'breathe', mechanism: 'invalid_mechanism', what: 'Something', anchor: 'detail' },
      ],
      anchors: [],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const scene = createScene('S-001');

    const result = await generateScenePlan(narrative, scene, []);

    // Invalid mechanism should default to 'action'
    expect(result.beats[0].mechanism).toBe('action');
  });

  it('filters non-string anchors', async () => {
    const mockResponse = JSON.stringify({
      beats: [{ fn: 'breathe', mechanism: 'environment', what: 'Test', anchor: 'anchor' }],
      anchors: ['Valid anchor', 123, null, 'Another valid'],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const scene = createScene('S-001');

    const result = await generateScenePlan(narrative, scene, []);

    expect(result.anchors).toEqual(['Valid anchor', 'Another valid']);
  });
});

// ── editScenePlan Tests ──────────────────────────────────────────────────────

describe('editScenePlan', () => {
  it('returns edited beat plan based on issues', async () => {
    const mockResponse = JSON.stringify({
      beats: [
        { fn: 'breathe', mechanism: 'environment', what: 'Revised opening', anchor: 'new anchor' },
        { fn: 'reveal', mechanism: 'dialogue', what: 'Character secret exposed', anchor: 'gasp' },
      ],
      anchors: ['The truth hung between them.'],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const scene = createScene('S-001', {
      plan: {
        beats: [
          { fn: 'breathe', mechanism: 'environment', what: 'Original opening', anchor: 'old anchor' },
        ],
        anchors: [],
      },
    });

    const result = await editScenePlan(narrative, scene, [], ['Opening is too slow', 'Missing character reveal']);

    expect(result.beats).toHaveLength(2);
    expect(result.beats[0].what).toBe('Revised opening');
    expect(result.beats[1].fn).toBe('reveal');
  });

  it('throws if scene has no plan', async () => {
    const narrative = createMinimalNarrative();
    const scene = createScene('S-001'); // No plan

    await expect(editScenePlan(narrative, scene, [], ['Issue'])).rejects.toThrow('Scene has no plan');
  });
});

// ── reverseEngineerScenePlan Tests ───────────────────────────────────────────

describe('reverseEngineerScenePlan', () => {
  it('extracts beat structure from prose', async () => {
    const mockResponse = JSON.stringify({
      beats: [
        { fn: 'breathe', mechanism: 'environment', what: 'Morning light', anchor: 'golden rays' },
        { fn: 'bond', mechanism: 'dialogue', what: 'Characters reconnect', anchor: 'warm smile' },
      ],
      anchors: ['The morning light fell like honey.'],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const prose = 'The morning light fell like honey across the chamber. "I missed you," she said with a warm smile.';
    const summary = 'Characters reunite at dawn';

    const result = await reverseEngineerScenePlan(prose, summary);

    expect(result.beats).toHaveLength(2);
    expect(result.anchors[0]).toContain('morning light');
  });

  it('handles streaming with onToken callback', async () => {
    const mockResponse = JSON.stringify({
      beats: [{ fn: 'advance', mechanism: 'action', what: 'Action beat', anchor: 'detail' }],
      anchors: [],
    });
    vi.mocked(callGenerateStream).mockResolvedValue(mockResponse);

    const tokens: string[] = [];
    const result = await reverseEngineerScenePlan(
      'Test prose',
      'Test summary',
      (token) => tokens.push(token),
    );

    expect(result.beats).toHaveLength(1);
    expect(vi.mocked(callGenerateStream)).toHaveBeenCalled();
  });
});

// ── rewriteScenePlan Tests ───────────────────────────────────────────────────

describe('rewriteScenePlan', () => {
  it('rewrites plan based on editorial feedback', async () => {
    const mockResponse = JSON.stringify({
      beats: [
        { fn: 'turn', mechanism: 'action', what: 'Dramatic reversal', anchor: 'twist moment' },
        { fn: 'resolve', mechanism: 'dialogue', what: 'Conflict settles', anchor: 'final words' },
      ],
      anchors: ['Everything changed in that instant.'],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const scene = createScene('S-001');
    const currentPlan: BeatPlan = {
      beats: [
        { fn: 'advance', mechanism: 'action', what: 'Original beat', anchor: 'anchor' },
      ],
      anchors: [],
    };

    const result = await rewriteScenePlan(
      narrative,
      scene,
      [],
      currentPlan,
      'Add more dramatic tension and a clearer resolution',
    );

    expect(result.beats).toHaveLength(2);
    expect(result.beats[0].fn).toBe('turn');
    expect(result.anchors).toHaveLength(1);
  });

  it('falls back to current plan if LLM returns empty beats', async () => {
    const mockResponse = JSON.stringify({
      beats: [],
      anchors: ['New anchor'],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);

    const narrative = createMinimalNarrative();
    const scene = createScene('S-001');
    const currentPlan: BeatPlan = {
      beats: [
        { fn: 'breathe', mechanism: 'environment', what: 'Original', anchor: 'original' },
      ],
      anchors: ['Old anchor'],
    };

    const result = await rewriteScenePlan(narrative, scene, [], currentPlan, 'Feedback');

    // Should fall back to current plan's beats
    expect(result.beats).toHaveLength(1);
    expect(result.beats[0].fn).toBe('breathe');
    // But use new anchors
    expect(result.anchors).toEqual(['New anchor']);
  });
});

// ── generateSceneProse Tests ─────────────────────────────────────────────────

describe('generateSceneProse', () => {
  it('returns prose from LLM response', async () => {
    const mockProse = 'The castle walls loomed against the grey sky. Alice drew her blade, the steel singing as it cleared the scabbard.';
    vi.mocked(callGenerate).mockResolvedValue(mockProse);

    const narrative = createMinimalNarrative();
    const scene = createScene('S-001', {
      summary: 'Alice prepares for battle at the castle',
    });

    const result = await generateSceneProse(narrative, scene, []);

    expect(result).toBe(mockProse);
  });

  it('includes beat plan in prompt when available', async () => {
    const mockProse = 'Test prose output';
    vi.mocked(callGenerate).mockResolvedValue(mockProse);

    const narrative = createMinimalNarrative();
    const scene = createScene('S-001', {
      plan: {
        beats: [
          { fn: 'breathe', mechanism: 'environment', what: 'Opening atmosphere', anchor: 'grey sky' },
        ],
        anchors: ['The sky was the color of old iron.'],
      },
    });

    await generateSceneProse(narrative, scene, []);

    const callArgs = vi.mocked(callGenerate).mock.calls[0];
    expect(callArgs[0]).toContain('BEAT PLAN');
    expect(callArgs[0]).toContain('breathe:environment');
    expect(callArgs[0]).toContain('ANCHOR LINES');
    expect(callArgs[0]).toContain('old iron');
  });

  it('handles streaming with onToken callback', async () => {
    const mockProse = 'Streamed prose content';
    vi.mocked(callGenerateStream).mockResolvedValue(mockProse);

    const narrative = createMinimalNarrative();
    const scene = createScene('S-001');
    const tokens: string[] = [];

    const result = await generateSceneProse(narrative, scene, [], (token) => tokens.push(token));

    expect(result).toBe(mockProse);
    expect(vi.mocked(callGenerateStream)).toHaveBeenCalled();
  });

  it('includes prose guidance when provided', async () => {
    const mockProse = 'Test output';
    vi.mocked(callGenerate).mockResolvedValue(mockProse);

    const narrative = createMinimalNarrative();
    const scene = createScene('S-001');

    await generateSceneProse(narrative, scene, [], undefined, 'Write with dark humor');

    const callArgs = vi.mocked(callGenerate).mock.calls[0];
    expect(callArgs[1]).toContain('SCENE DIRECTION');
    expect(callArgs[1]).toContain('dark humor');
  });

  it('includes prose profile when available', async () => {
    const mockProse = 'Test output';
    vi.mocked(callGenerate).mockResolvedValue(mockProse);

    const narrative = createMinimalNarrative();
    narrative.proseProfile = {
      register: 'literary',
      stance: 'close_third',
      devices: ['metaphor', 'irony'],
      rules: ['Show, dont tell'],
      antiPatterns: ['Purple prose'],
    };
    const scene = createScene('S-001');

    await generateSceneProse(narrative, scene, []);

    const callArgs = vi.mocked(callGenerate).mock.calls[0];
    // Prose profile is in user prompt (arg 0), not system prompt (arg 1)
    expect(callArgs[0]).toContain('PROSE PROFILE');
    expect(callArgs[0]).toContain('literary');
    expect(callArgs[0]).toContain('close_third');
  });
});
