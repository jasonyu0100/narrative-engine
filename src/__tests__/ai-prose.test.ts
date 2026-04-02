import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rewriteSceneProse, generateChartAnnotations } from '@/lib/ai/prose';
import type { NarrativeState, Scene } from '@/types/narrative';

// Mock all AI dependencies
vi.mock('@/lib/ai/api', () => ({
  callGenerate: vi.fn(),
  callGenerateStream: vi.fn(),
  SYSTEM_PROMPT: 'Mock system prompt',
}));

vi.mock('@/lib/ai/context', () => ({
  sceneContext: vi.fn(() => 'Mock scene context block'),
}));

vi.mock('@/lib/ai/json', () => ({
  parseJson: vi.fn((str: string) => JSON.parse(str)),
}));

import { callGenerate, callGenerateStream } from '@/lib/ai/api';
import { sceneContext } from '@/lib/ai/context';
import { parseJson } from '@/lib/ai/json';

// Helper to create minimal narrative
function createMinimalNarrative(): NarrativeState {
  return {
    id: 'test-narrative',
    title: 'Test Story',
    worldSummary: 'A test world with magic and adventure.',
    characters: {
      'C-01': { id: 'C-01', name: 'Hero', description: 'The protagonist', goals: [], relationships: [], knowledge: [], status: { alive: true, introduced: true } },
      'C-02': { id: 'C-02', name: 'Mentor', description: 'A wise guide', goals: [], relationships: [], knowledge: [], status: { alive: true, introduced: true } },
    },
    locations: {
      'L-01': { id: 'L-01', name: 'Village', description: 'A small village', childIds: [] },
      'L-02': { id: 'L-02', name: 'Forest', description: 'A dark forest', childIds: [] },
    },
    threads: {
      'T-01': { id: 'T-01', title: 'Main Quest', description: 'Save the kingdom', status: 'active', history: [] },
    },
    arcs: {
      'ARC-01': { id: 'ARC-01', title: 'Beginning', sceneIds: ['S-01', 'S-02', 'S-03'] },
    },
    scenes: {
      'S-01': {
        id: 'S-01',
        arcId: 'ARC-01',
        locationId: 'L-01',
        povId: 'C-01',
        participantIds: ['C-01'],
        events: ['Wakes up'],
        threadMutations: [],
        continuityMutations: [],
        relationshipMutations: [],
        summary: 'Hero wakes in village',
        prose: 'The morning sun crept through the window. Hero stretched and yawned, ready for adventure.',
      },
      'S-02': {
        id: 'S-02',
        arcId: 'ARC-01',
        locationId: 'L-01',
        povId: 'C-01',
        participantIds: ['C-01', 'C-02'],
        events: ['Meets mentor'],
        threadMutations: [],
        continuityMutations: [],
        relationshipMutations: [],
        summary: 'Hero meets mentor',
        prose: 'Mentor appeared at the door. "Your journey begins today," he said.',
      },
      'S-03': {
        id: 'S-03',
        arcId: 'ARC-01',
        locationId: 'L-02',
        povId: 'C-01',
        participantIds: ['C-01'],
        events: ['Enters forest'],
        threadMutations: [],
        continuityMutations: [],
        relationshipMutations: [],
        summary: 'Hero enters the dark forest',
        prose: 'The trees closed around Hero as he stepped into the forest. Shadows moved.',
      },
    },
    branches: {},
    worldBuilds: {},
    currentBranchId: null,
    defaultBranchId: null,
    worldKnowledge: { nodes: [], edges: [] },
  };
}

describe('rewriteSceneProse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns prose from LLM JSON response', async () => {
    const mockProse = 'The rewritten prose with improvements.';
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ prose: mockProse }))
      .mockResolvedValueOnce(JSON.stringify({ changelog: '• Fixed pacing\n• Added tension' }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ prose: mockProse })
      .mockReturnValueOnce({ changelog: '• Fixed pacing\n• Added tension' });

    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-02']!;
    const result = await rewriteSceneProse(
      narrative,
      scene,
      ['S-01', 'S-02', 'S-03'],
      'Original prose here',
      'Add more tension in the dialogue',
    );

    expect(result.prose).toBe(mockProse);
    expect(result.changelog).toBe('• Fixed pacing\n• Added tension');
    expect(callGenerate).toHaveBeenCalledTimes(2);
  });

  it('handles streaming mode with onToken callback', async () => {
    const mockProse = 'Streamed prose content.';
    const tokens: string[] = [];
    vi.mocked(callGenerateStream).mockResolvedValue(mockProse);
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({ changelog: '• Streamed changes' }));
    vi.mocked(parseJson).mockReturnValue({ changelog: '• Streamed changes' });

    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-02']!;
    const result = await rewriteSceneProse(
      narrative,
      scene,
      ['S-01', 'S-02', 'S-03'],
      'Original prose',
      'Analysis',
      0,
      0,
      undefined,
      (token) => tokens.push(token),
    );

    expect(result.prose).toBe(mockProse);
    expect(callGenerateStream).toHaveBeenCalled();
    expect(callGenerate).toHaveBeenCalledTimes(1); // Only changelog call
  });

  it('includes past scene context when contextPast > 0', async () => {
    const mockProse = 'Prose with past context.';
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ prose: mockProse }))
      .mockResolvedValueOnce(JSON.stringify({ changelog: '' }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ prose: mockProse })
      .mockReturnValueOnce({ changelog: '' });

    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-02']!;
    await rewriteSceneProse(
      narrative,
      scene,
      ['S-01', 'S-02', 'S-03'],
      'Original prose',
      'Analysis',
      1, // contextPast = 1
    );

    const promptCall = vi.mocked(callGenerate).mock.calls[0]![0];
    expect(promptCall).toContain('PRECEDING SCENES');
    expect(promptCall).toContain('Hero wakes in village');
  });

  it('includes future scene context when contextFuture > 0', async () => {
    const mockProse = 'Prose with future context.';
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ prose: mockProse }))
      .mockResolvedValueOnce(JSON.stringify({ changelog: '' }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ prose: mockProse })
      .mockReturnValueOnce({ changelog: '' });

    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-02']!;
    await rewriteSceneProse(
      narrative,
      scene,
      ['S-01', 'S-02', 'S-03'],
      'Original prose',
      'Analysis',
      0,
      1, // contextFuture = 1
    );

    const promptCall = vi.mocked(callGenerate).mock.calls[0]![0];
    expect(promptCall).toContain('FOLLOWING SCENES');
    expect(promptCall).toContain('Hero enters the dark forest');
  });

  it('includes pinned reference scenes', async () => {
    const mockProse = 'Prose with references.';
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ prose: mockProse }))
      .mockResolvedValueOnce(JSON.stringify({ changelog: '' }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ prose: mockProse })
      .mockReturnValueOnce({ changelog: '' });

    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-02']!;
    await rewriteSceneProse(
      narrative,
      scene,
      ['S-01', 'S-02', 'S-03'],
      'Original prose',
      'Analysis',
      0,
      0,
      ['S-03'], // Reference scene
    );

    const promptCall = vi.mocked(callGenerate).mock.calls[0]![0];
    expect(promptCall).toContain('PINNED REFERENCE SCENES');
    expect(promptCall).toContain('Hero enters the dark forest');
  });

  it('excludes current scene from reference scenes', async () => {
    const mockProse = 'Prose without self-reference.';
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ prose: mockProse }))
      .mockResolvedValueOnce(JSON.stringify({ changelog: '' }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ prose: mockProse })
      .mockReturnValueOnce({ changelog: '' });

    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-02']!;
    await rewriteSceneProse(
      narrative,
      scene,
      ['S-01', 'S-02', 'S-03'],
      'Original prose',
      'Analysis',
      0,
      0,
      ['S-02'], // Same as current scene
    );

    const promptCall = vi.mocked(callGenerate).mock.calls[0]![0];
    expect(promptCall).not.toContain('PINNED REFERENCE SCENES');
  });

  it('uses prose voice override when available', async () => {
    const mockProse = 'Voiced prose.';
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ prose: mockProse }))
      .mockResolvedValueOnce(JSON.stringify({ changelog: '' }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ prose: mockProse })
      .mockReturnValueOnce({ changelog: '' });

    const narrative = createMinimalNarrative();
    narrative.storySettings = { proseVoice: 'Write in a lyrical, poetic style with rich metaphors.' };
    const scene = narrative.scenes['S-02']!;
    await rewriteSceneProse(
      narrative,
      scene,
      ['S-01', 'S-02', 'S-03'],
      'Original prose',
      'Analysis',
    );

    const systemPromptArg = vi.mocked(callGenerate).mock.calls[0]![1];
    expect(systemPromptArg).toContain('AUTHOR VOICE');
    expect(systemPromptArg).toContain('lyrical, poetic style');
  });

  it('handles changelog array format', async () => {
    const mockProse = 'Prose.';
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ prose: mockProse }))
      .mockResolvedValueOnce(JSON.stringify({ changelog: ['First change', 'Second change'] }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ prose: mockProse })
      .mockReturnValueOnce({ changelog: ['First change', 'Second change'] });

    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-02']!;
    const result = await rewriteSceneProse(
      narrative,
      scene,
      ['S-01', 'S-02', 'S-03'],
      'Original prose',
      'Analysis',
    );

    expect(result.changelog).toBe('• First change\n• Second change');
  });

  it('continues gracefully when changelog generation fails', async () => {
    const mockProse = 'Good prose.';
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ prose: mockProse }))
      .mockRejectedValueOnce(new Error('Changelog failed'));
    vi.mocked(parseJson).mockReturnValueOnce({ prose: mockProse });

    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-02']!;
    const result = await rewriteSceneProse(
      narrative,
      scene,
      ['S-01', 'S-02', 'S-03'],
      'Original prose',
      'Analysis',
    );

    expect(result.prose).toBe(mockProse);
    expect(result.changelog).toBe('');
  });

  it('uses default paragraph context when no expanded context', async () => {
    const mockProse = 'Prose with default context.';
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ prose: mockProse }))
      .mockResolvedValueOnce(JSON.stringify({ changelog: '' }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ prose: mockProse })
      .mockReturnValueOnce({ changelog: '' });

    const narrative = createMinimalNarrative();
    const scene = narrative.scenes['S-02']!;
    await rewriteSceneProse(
      narrative,
      scene,
      ['S-01', 'S-02', 'S-03'],
      'Original prose',
      'Analysis',
      0, // contextPast = 0
      0, // contextFuture = 0
    );

    const promptCall = vi.mocked(callGenerate).mock.calls[0]![0];
    // Should include ending/opening snippets, not full scenes
    expect(promptCall).toContain('PREVIOUS SCENE ENDING');
    expect(promptCall).toContain('NEXT SCENE OPENING');
  });

  it('handles scene not in resolvedKeys', async () => {
    const mockProse = 'Prose for orphan scene.';
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ prose: mockProse }))
      .mockResolvedValueOnce(JSON.stringify({ changelog: '' }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ prose: mockProse })
      .mockReturnValueOnce({ changelog: '' });

    const narrative = createMinimalNarrative();
    const orphanScene: Scene = {
      id: 'S-ORPHAN',
      arcId: 'ARC-01',
      locationId: 'L-01',
      povId: 'C-01',
      participantIds: ['C-01'],
      events: [],
      threadMutations: [],
      continuityMutations: [],
      relationshipMutations: [],
      summary: 'Orphan scene',
    };
    narrative.scenes['S-ORPHAN'] = orphanScene;

    const result = await rewriteSceneProse(
      narrative,
      orphanScene,
      ['S-01', 'S-02', 'S-03'], // Does not include S-ORPHAN
      'Original prose',
      'Analysis',
    );

    expect(result.prose).toBe(mockProse);
    expect(sceneContext).toHaveBeenCalled();
  });
});

describe('generateChartAnnotations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed annotations from LLM response', async () => {
    const mockAnnotations = [
      { sceneIndex: 0, force: 'payoff', label: 'Hero faces danger' },
      { sceneIndex: 2, force: 'change', label: 'Major revelation' },
      { sceneIndex: 4, force: 'knowledge', label: 'New character introduced' },
    ];
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(mockAnnotations));

    const narrative = createMinimalNarrative();
    const forceData = [
      { sceneIndex: 0, sceneId: 'S-01', arcName: 'Arc 1', forces: { payoff: 2.5, change: 1.0, knowledge: 0.5 }, corner: 'high-payoff', summary: 'Test scene', threadChanges: [], location: 'Village', participants: ['Hero'] },
      { sceneIndex: 1, sceneId: 'S-02', arcName: 'Arc 1', forces: { payoff: 0.5, change: 2.0, knowledge: 1.0 }, corner: 'high-change', summary: 'Another scene', threadChanges: [], location: 'Forest', participants: ['Hero', 'Mentor'] },
    ];

    const result = await generateChartAnnotations(narrative, forceData);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ sceneIndex: 0, force: 'payoff', label: 'Hero faces danger' });
    expect(callGenerate).toHaveBeenCalled();
  });

  it('handles markdown code fences in response', async () => {
    const mockAnnotations = [
      { sceneIndex: 1, force: 'knowledge', label: 'Discovery' },
    ];
    vi.mocked(callGenerate).mockResolvedValue('```json\n' + JSON.stringify(mockAnnotations) + '\n```');

    const narrative = createMinimalNarrative();
    const forceData = [
      { sceneIndex: 0, sceneId: 'S-01', arcName: 'Arc 1', forces: { payoff: 1.0, change: 1.0, knowledge: 1.0 }, corner: 'balanced', summary: 'Test', threadChanges: [], location: 'Village', participants: ['Hero'] },
    ];

    const result = await generateChartAnnotations(narrative, forceData);

    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe('Discovery');
  });

  it('filters invalid annotations', async () => {
    const mockResponse = [
      { sceneIndex: 0, force: 'payoff', label: 'Valid' },
      { sceneIndex: 'invalid', force: 'payoff', label: 'Invalid index' }, // Invalid sceneIndex
      { sceneIndex: 1, force: 'invalid', label: 'Invalid force' }, // Invalid force
      { sceneIndex: 2, force: 'change' }, // Missing label
      { sceneIndex: 3, force: 'knowledge', label: 123 }, // Invalid label type
      { force: 'payoff', label: 'Missing index' }, // Missing sceneIndex
    ];
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(mockResponse));

    const narrative = createMinimalNarrative();
    const forceData = [
      { sceneIndex: 0, sceneId: 'S-01', arcName: 'Arc 1', forces: { payoff: 1.0, change: 1.0, knowledge: 1.0 }, corner: 'balanced', summary: 'Test', threadChanges: [], location: 'Village', participants: ['Hero'] },
    ];

    const result = await generateChartAnnotations(narrative, forceData);

    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe('Valid');
  });

  it('returns empty array for non-array response', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({ annotations: [] }));

    const narrative = createMinimalNarrative();
    const forceData = [
      { sceneIndex: 0, sceneId: 'S-01', arcName: 'Arc 1', forces: { payoff: 1.0, change: 1.0, knowledge: 1.0 }, corner: 'balanced', summary: 'Test', threadChanges: [], location: 'Village', participants: ['Hero'] },
    ];

    const result = await generateChartAnnotations(narrative, forceData);

    expect(result).toEqual([]);
  });

  it('includes thread changes in trajectory lines', async () => {
    const mockAnnotations = [{ sceneIndex: 0, force: 'payoff', label: 'Threat escalates' }];
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(mockAnnotations));

    const narrative = createMinimalNarrative();
    const forceData = [
      {
        sceneIndex: 0,
        sceneId: 'S-01',
        arcName: 'Arc 1',
        forces: { payoff: 2.0, change: 1.0, knowledge: 0.5 },
        corner: 'high-payoff',
        summary: 'Test scene',
        threadChanges: ['Main Quest: active → escalating'],
        location: 'Village',
        participants: ['Hero'],
      },
    ];

    await generateChartAnnotations(narrative, forceData);

    const promptCall = vi.mocked(callGenerate).mock.calls[0]![0];
    expect(promptCall).toContain('Main Quest: active → escalating');
  });

  it('validates all three force types', async () => {
    const mockAnnotations = [
      { sceneIndex: 0, force: 'payoff', label: 'Danger' },
      { sceneIndex: 1, force: 'change', label: 'Revelation' },
      { sceneIndex: 2, force: 'knowledge', label: 'Discovery' },
    ];
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(mockAnnotations));

    const narrative = createMinimalNarrative();
    const forceData = [
      { sceneIndex: 0, sceneId: 'S-01', arcName: 'Arc 1', forces: { payoff: 2.0, change: 0.5, knowledge: 0.5 }, corner: 'high-payoff', summary: 'Test', threadChanges: [], location: 'Village', participants: ['Hero'] },
    ];

    const result = await generateChartAnnotations(narrative, forceData);

    expect(result.some(a => a.force === 'payoff')).toBe(true);
    expect(result.some(a => a.force === 'change')).toBe(true);
    expect(result.some(a => a.force === 'knowledge')).toBe(true);
  });
});
