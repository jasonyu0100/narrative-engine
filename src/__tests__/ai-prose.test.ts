import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rewriteSceneProse } from '@/lib/ai/prose';
import type { NarrativeState, Scene } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS } from '@/types/narrative';

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
  parseJson: vi.fn(),
}));

import { callGenerate, callGenerateStream } from '@/lib/ai/api';
import { sceneContext } from '@/lib/ai/context';
import { parseJson } from '@/lib/ai/json';

// Helper to create minimal narrative
function createMinimalNarrative(): NarrativeState {
  return {
    id: 'test-narrative',
    title: 'Test Story',
    description: 'A test story',
    worldSummary: 'A test world with magic and adventure.',
    characters: {
      'C-01': { id: 'C-01', name: 'Hero', role: 'anchor', continuity: { nodes: {}, edges: [] }, threadIds: [] },
      'C-02': { id: 'C-02', name: 'Mentor', role: 'recurring', continuity: { nodes: {}, edges: [] }, threadIds: [] },
    },
    locations: {
      'L-01': { id: 'L-01', name: 'Village', prominence: 'place' as const, parentId: null, tiedCharacterIds: [], continuity: { nodes: {}, edges: [] }, threadIds: [] },
      'L-02': { id: 'L-02', name: 'Forest', prominence: 'place' as const, parentId: null, tiedCharacterIds: [], continuity: { nodes: {}, edges: [] }, threadIds: [] },
    },
    threads: {
      'T-01': { id: 'T-01', description: 'Save the kingdom', status: 'active', participants: [], dependents: [], openedAt: 'S-01', threadLog: { nodes: {}, edges: [] } },
    },
    arcs: {
      'ARC-01': { id: 'ARC-01', name: 'Beginning', sceneIds: ['S-01', 'S-02', 'S-03'], develops: [], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
    },
    scenes: {
      'S-01': {
        kind: 'scene',
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
        proseVersions: [{
          prose: 'The morning sun crept through the window. Hero stretched and yawned, ready for adventure.',
          branchId: 'main',
          timestamp: Date.now(),
          version: '1',
          versionType: 'generate' as const,
        }],
      },
      'S-02': {
        kind: 'scene',
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
        proseVersions: [{
          prose: 'Mentor appeared at the door. "Your journey begins today," he said.',
          branchId: 'main',
          timestamp: Date.now(),
          version: '1',
          versionType: 'generate' as const,
        }],
      },
      'S-03': {
        kind: 'scene',
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
        proseVersions: [{
          prose: 'The trees closed around Hero as he stepped into the forest. Shadows moved.',
          branchId: 'main',
          timestamp: Date.now(),
          version: '1',
          versionType: 'generate' as const,
        }],
      },
    },
    branches: {},
    worldBuilds: {},
    worldKnowledge: { nodes: {}, edges: [] },
    relationships: [],
    artifacts: {},
    rules: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('rewriteSceneProse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns prose from LLM JSON response', async () => {
    const mockProse = 'The rewritten prose with improvements.';
    const proseResponse = JSON.stringify({ prose: mockProse });
    const changelogResponse = JSON.stringify({ changelog: '• Fixed pacing\n• Added tension' });

    vi.mocked(callGenerate)
      .mockResolvedValueOnce(proseResponse)
      .mockResolvedValueOnce(changelogResponse);

    vi.mocked(parseJson)
      .mockImplementation((raw: string, _label?: string) => JSON.parse(raw));

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
    const changelogResponse = JSON.stringify({ changelog: '• Streamed changes' });

    vi.mocked(callGenerateStream).mockResolvedValue(mockProse);
    vi.mocked(callGenerate).mockResolvedValue(changelogResponse);
    vi.mocked(parseJson).mockImplementation((raw: string) => JSON.parse(raw));

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
    narrative.storySettings = { ...DEFAULT_STORY_SETTINGS, proseVoice: 'Write in a lyrical, poetic style with rich metaphors.' };
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
    const proseResponse = JSON.stringify({ prose: mockProse });
    const changelogResponse = JSON.stringify({ changelog: ['First change', 'Second change'] });

    vi.mocked(callGenerate)
      .mockResolvedValueOnce(proseResponse)
      .mockResolvedValueOnce(changelogResponse);
    vi.mocked(parseJson).mockImplementation((raw: string) => JSON.parse(raw));

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
    const proseResponse = JSON.stringify({ prose: mockProse });

    vi.mocked(callGenerate)
      .mockResolvedValueOnce(proseResponse)
      .mockRejectedValueOnce(new Error('Changelog failed'));
    vi.mocked(parseJson).mockImplementation((raw: string) => JSON.parse(raw));

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
    const proseResponse = JSON.stringify({ prose: mockProse });
    const changelogResponse = JSON.stringify({ changelog: '' });

    vi.mocked(callGenerate)
      .mockResolvedValueOnce(proseResponse)
      .mockResolvedValueOnce(changelogResponse);
    vi.mocked(parseJson).mockImplementation((raw: string) => JSON.parse(raw));

    const narrative = createMinimalNarrative();
    const orphanScene: Scene = {
      kind: 'scene',
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
