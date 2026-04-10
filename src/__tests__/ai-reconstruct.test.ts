import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reconstructBranch, type ReconstructionProgress, type ReconstructionCallbacks } from '@/lib/ai/reconstruct';
import type { NarrativeState, Scene, Branch, StructureReview, WorldBuild } from '@/types/narrative';

// Mock all AI dependencies
vi.mock('@/lib/ai/api', () => ({
  callGenerate: vi.fn(),
  SYSTEM_PROMPT: 'Mock system prompt',
}));

vi.mock('@/lib/ai/context', () => ({
  narrativeContext: vi.fn(() => 'Mock narrative context'),
}));

vi.mock('@/lib/ai/json', () => ({
  parseJson: vi.fn((str: string) => JSON.parse(str)),
}));

import { callGenerate } from '@/lib/ai/api';
import { parseJson } from '@/lib/ai/json';

// Helper to create minimal narrative
function createMinimalNarrative(): NarrativeState {
  return {
    id: 'test-narrative',
    title: 'Test Story',
    description: 'A test story',
    worldSummary: 'A test world.',
    characters: {
      'C-01': { id: 'C-01', name: 'Hero', role: 'anchor', continuity: { nodes: {}, edges: [] }, threadIds: [] },
      'C-02': { id: 'C-02', name: 'Mentor', role: 'recurring', continuity: { nodes: {}, edges: [] }, threadIds: [] },
    },
    locations: {
      'L-01': { id: 'L-01', name: 'Village', prominence: 'place' as const, parentId: null, tiedCharacterIds: [], continuity: { nodes: {}, edges: [] }, threadIds: [] },
      'L-02': { id: 'L-02', name: 'Forest', prominence: 'place' as const, parentId: null, tiedCharacterIds: [], continuity: { nodes: {}, edges: [] }, threadIds: [] },
    },
    threads: {
      'T-01': { id: 'T-01', description: 'Main quest', status: 'active', participants: [], dependents: [], openedAt: 'S-01', threadLog: { nodes: {}, edges: [] } },
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
        events: ['wakes'],
        threadMutations: [{ threadId: 'T-01', from: 'latent', to: 'active', addedNodes: [], addedEdges: [] }],
        continuityMutations: [],
        relationshipMutations: [],
        summary: 'Hero wakes in village',
      },
      'S-02': {
        kind: 'scene',
        id: 'S-02',
        arcId: 'ARC-01',
        locationId: 'L-01',
        povId: 'C-01',
        participantIds: ['C-01', 'C-02'],
        events: ['meets_mentor'],
        threadMutations: [{ threadId: 'T-01', from: 'active', to: 'active', addedNodes: [], addedEdges: [] }],
        continuityMutations: [],
        relationshipMutations: [],
        summary: 'Hero meets mentor',
      },
      'S-03': {
        kind: 'scene',
        id: 'S-03',
        arcId: 'ARC-01',
        locationId: 'L-02',
        povId: 'C-01',
        participantIds: ['C-01'],
        events: ['enters_forest'],
        threadMutations: [],
        continuityMutations: [],
        relationshipMutations: [],
        summary: 'Hero enters forest',
      },
    },
    branches: {
      'BR-01': {
        id: 'BR-01',
        name: 'main',
        parentBranchId: null,
        forkEntryId: null,
        entryIds: ['S-01', 'S-02', 'S-03'],
        createdAt: Date.now(),
      },
    },
    worldBuilds: {},
    worldKnowledge: { nodes: {}, edges: [] },
    relationships: [],
    artifacts: {},
    rules: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createMockCallbacks(): ReconstructionCallbacks & { progress: ReconstructionProgress[]; readyScenes: Scene[]; createdBranches: Branch[] } {
  const progress: ReconstructionProgress[] = [];
  const readyScenes: Scene[] = [];
  const createdBranches: Branch[] = [];

  return {
    progress,
    readyScenes,
    createdBranches,
    onProgress: (p) => progress.push({ ...p }),
    onSceneReady: (scene) => readyScenes.push({ ...scene }),
    onBranchCreated: (branch) => createdBranches.push({ ...branch }),
  };
}

describe('reconstructBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes through ok scenes unchanged', async () => {
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-01',
      sceneEvals: [
        { sceneId: 'S-01', verdict: 'ok', reason: 'Good scene' },
        { sceneId: 'S-02', verdict: 'ok', reason: 'Good scene' },
        { sceneId: 'S-03', verdict: 'ok', reason: 'Good scene' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };

    const result = await reconstructBranch(
      narrative,
      ['S-01', 'S-02', 'S-03'],
      evaluation,
      callbacks,
      cancelledRef,
    );

    expect(result.scenes).toHaveLength(3);
    // ok scenes reuse their original IDs
    expect(result.scenes[0].id).toBe('S-01');
    expect(result.scenes[1].id).toBe('S-02');
    expect(result.scenes[2].id).toBe('S-03');
    expect(callGenerate).not.toHaveBeenCalled();
  });

  it('removes cut scenes from timeline', async () => {
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-01',
      sceneEvals: [
        { sceneId: 'S-01', verdict: 'ok', reason: '' },
        { sceneId: 'S-02', verdict: 'cut', reason: 'Redundant scene' },
        { sceneId: 'S-03', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };

    const result = await reconstructBranch(
      narrative,
      ['S-01', 'S-02', 'S-03'],
      evaluation,
      callbacks,
      cancelledRef,
    );

    expect(result.scenes).toHaveLength(2);
    expect(result.scenes.map(s => s.id)).toEqual(['S-01', 'S-03']);
    expect(result.branch.entryIds).toEqual(['S-01', 'S-03']);
  });

  it('edits scenes with edit verdict via LLM', async () => {
    const editedScene = {
      locationId: 'L-02',
      povId: 'C-01',
      participantIds: ['C-01', 'C-02'],
      events: ['revised_event'],
      threadMutations: [],
      continuityMutations: [],
      relationshipMutations: [],
      summary: 'Revised scene with fixes',
    };
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(editedScene));
    vi.mocked(parseJson).mockReturnValue(editedScene);

    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-01',
      sceneEvals: [
        { sceneId: 'S-01', verdict: 'ok', reason: '' },
        { sceneId: 'S-02', verdict: 'edit', reason: 'Needs pacing fix' },
        { sceneId: 'S-03', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };

    const result = await reconstructBranch(
      narrative,
      ['S-01', 'S-02', 'S-03'],
      evaluation,
      callbacks,
      cancelledRef,
    );

    expect(result.scenes).toHaveLength(3);
    // Edited scenes get new IDs
    expect(result.scenes[1].id).not.toBe('S-02');
    expect(result.scenes[1].summary).toBe('Revised scene with fixes');
    expect(callGenerate).toHaveBeenCalledTimes(1);
  });

  it('inserts new scenes via LLM', async () => {
    const insertedScene = {
      locationId: 'L-01',
      povId: 'C-02',
      participantIds: ['C-02'],
      events: ['new_event'],
      threadMutations: [{ threadId: 'T-01', from: 'active', to: 'active', addedNodes: [], addedEdges: [] }],
      continuityMutations: [],
      relationshipMutations: [],
      summary: 'New transition scene',
    };
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(insertedScene));
    vi.mocked(parseJson).mockReturnValue(insertedScene);

    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-01',
      sceneEvals: [
        { sceneId: 'S-01', verdict: 'ok', reason: '' },
        { sceneId: 'S-02', verdict: 'ok', reason: '' },
        { sceneId: 'INSERT-1', verdict: 'insert', reason: 'Missing transition', insertAfter: 'S-02' },
        { sceneId: 'S-03', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };

    const result = await reconstructBranch(
      narrative,
      ['S-01', 'S-02', 'S-03'],
      evaluation,
      callbacks,
      cancelledRef,
    );

    expect(result.scenes).toHaveLength(4);
    expect(result.scenes[2].summary).toBe('New transition scene');
    expect(callGenerate).toHaveBeenCalledTimes(1);
  });

  it('moves scenes to new positions', async () => {
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-01',
      sceneEvals: [
        { sceneId: 'S-01', verdict: 'ok', reason: '' },
        { sceneId: 'S-02', verdict: 'move', reason: 'Should come after S-03', moveAfter: 'S-03' },
        { sceneId: 'S-03', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };

    const result = await reconstructBranch(
      narrative,
      ['S-01', 'S-02', 'S-03'],
      evaluation,
      callbacks,
      cancelledRef,
    );

    expect(result.scenes).toHaveLength(3);
    // S-02 moved after S-03: order is now S-01, S-03, S-02
    expect(result.scenes.map(s => s.id)).toEqual(['S-01', 'S-03', 'S-02']);
  });

  it('merges scenes via LLM', async () => {
    const mergedScene = {
      locationId: 'L-01',
      povId: 'C-01',
      participantIds: ['C-01', 'C-02'],
      events: ['combined_event'],
      threadMutations: [{ threadId: 'T-01', from: 'latent', to: 'active', addedNodes: [], addedEdges: [] }],
      continuityMutations: [],
      relationshipMutations: [],
      summary: 'Combined scene with both beats',
    };
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(mergedScene));
    vi.mocked(parseJson).mockReturnValue(mergedScene);

    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-01',
      sceneEvals: [
        { sceneId: 'S-01', verdict: 'ok', reason: '' },
        { sceneId: 'S-02', verdict: 'merge', reason: 'Absorb into S-01', mergeInto: 'S-01' },
        { sceneId: 'S-03', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };

    const result = await reconstructBranch(
      narrative,
      ['S-01', 'S-02', 'S-03'],
      evaluation,
      callbacks,
      cancelledRef,
    );

    expect(result.scenes).toHaveLength(2);
    // S-02 is removed, S-01 is merged
    expect(result.scenes[0].summary).toBe('Combined scene with both beats');
    expect(callGenerate).toHaveBeenCalledTimes(1);
  });

  it('creates branch with version suffix', async () => {
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-01',
      sceneEvals: [
        { sceneId: 'S-01', verdict: 'ok', reason: '' },
        { sceneId: 'S-02', verdict: 'ok', reason: '' },
        { sceneId: 'S-03', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };

    const result = await reconstructBranch(
      narrative,
      ['S-01', 'S-02', 'S-03'],
      evaluation,
      callbacks,
      cancelledRef,
    );

    expect(result.branch.name).toBe('main v2');
    expect(result.branch.parentBranchId).toBeNull(); // Root branch
  });

  it('preserves world builds in timeline order', async () => {
    const narrative = createMinimalNarrative();
    const worldBuild: WorldBuild = {
      id: 'WB-01',
      kind: 'world_build',
      summary: 'World expansion',
      expansionManifest: {
        characters: [],
        locations: [],
        threads: [],
        artifacts: [],
        relationships: [],
        worldKnowledge: { addedNodes: [], addedEdges: [] },
      },
    };
    narrative.worldBuilds['WB-01'] = worldBuild;
    // World build appears between S-01 and S-02
    narrative.branches['BR-01'].entryIds = ['S-01', 'WB-01', 'S-02', 'S-03'];

    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-01',
      sceneEvals: [
        { sceneId: 'S-01', verdict: 'ok', reason: '' },
        { sceneId: 'S-02', verdict: 'ok', reason: '' },
        { sceneId: 'S-03', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };

    const result = await reconstructBranch(
      narrative,
      ['S-01', 'WB-01', 'S-02', 'S-03'],
      evaluation,
      callbacks,
      cancelledRef,
    );

    expect(result.branch.entryIds).toContain('WB-01');
    expect(result.branch.entryIds.indexOf('WB-01')).toBe(1);
  });

  it('invokes progress callbacks', async () => {
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-01',
      sceneEvals: [
        { sceneId: 'S-01', verdict: 'ok', reason: '' },
        { sceneId: 'S-02', verdict: 'ok', reason: '' },
        { sceneId: 'S-03', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };

    await reconstructBranch(
      narrative,
      ['S-01', 'S-02', 'S-03'],
      evaluation,
      callbacks,
      cancelledRef,
    );

    expect(callbacks.progress.length).toBeGreaterThan(0);
    expect(callbacks.progress.some(p => p.phase === 'preparing')).toBe(true);
    expect(callbacks.progress.some(p => p.phase === 'done')).toBe(true);
    expect(callbacks.createdBranches).toHaveLength(1);
  });

  it('handles insert at START position', async () => {
    const insertedScene = {
      locationId: 'L-01',
      povId: 'C-01',
      participantIds: ['C-01'],
      events: ['opening'],
      threadMutations: [],
      continuityMutations: [],
      relationshipMutations: [],
      summary: 'Opening scene',
    };
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(insertedScene));
    vi.mocked(parseJson).mockReturnValue(insertedScene);

    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-01',
      sceneEvals: [
        { sceneId: 'INSERT-1', verdict: 'insert', reason: 'Need an opening', insertAfter: 'START' },
        { sceneId: 'S-01', verdict: 'ok', reason: '' },
        { sceneId: 'S-02', verdict: 'ok', reason: '' },
        { sceneId: 'S-03', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };

    const result = await reconstructBranch(
      narrative,
      ['S-01', 'S-02', 'S-03'],
      evaluation,
      callbacks,
      cancelledRef,
    );

    expect(result.scenes).toHaveLength(4);
    expect(result.scenes[0].summary).toBe('Opening scene');
  });

  it('handles cancellation', async () => {
    vi.mocked(callGenerate).mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 10));
      return JSON.stringify({ summary: 'Should not appear' });
    });

    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-01',
      sceneEvals: [
        { sceneId: 'S-01', verdict: 'edit', reason: 'Fix' },
        { sceneId: 'S-02', verdict: 'edit', reason: 'Fix' },
        { sceneId: 'S-03', verdict: 'edit', reason: 'Fix' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };

    // Cancel immediately
    const promise = reconstructBranch(
      narrative,
      ['S-01', 'S-02', 'S-03'],
      evaluation,
      callbacks,
      cancelledRef,
    );
    cancelledRef.current = true;

    const result = await promise;
    // Should still return a result but with partial work
    expect(result.branch).toBeDefined();
    expect(result.scenes).toBeDefined();
  });

  it('handles edit failures gracefully', async () => {
    vi.mocked(callGenerate).mockRejectedValue(new Error('LLM failed'));

    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-01',
      sceneEvals: [
        { sceneId: 'S-01', verdict: 'ok', reason: '' },
        { sceneId: 'S-02', verdict: 'edit', reason: 'Fix pacing' },
        { sceneId: 'S-03', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };

    const result = await reconstructBranch(
      narrative,
      ['S-01', 'S-02', 'S-03'],
      evaluation,
      callbacks,
      cancelledRef,
    );

    // Should complete without throwing even when LLM operations fail
    expect(result.scenes).toHaveLength(3);
  });

  it('updates arc sceneIds after reconstruction', async () => {
    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-01',
      sceneEvals: [
        { sceneId: 'S-01', verdict: 'ok', reason: '' },
        { sceneId: 'S-02', verdict: 'cut', reason: 'Remove' },
        { sceneId: 'S-03', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };

    const result = await reconstructBranch(
      narrative,
      ['S-01', 'S-02', 'S-03'],
      evaluation,
      callbacks,
      cancelledRef,
    );

    expect(result.arcs['ARC-01'].sceneIds).toEqual(['S-01', 'S-03']);
  });

  it('increments version when branch already has version suffix', async () => {
    const narrative = createMinimalNarrative();
    narrative.branches['BR-01'].name = 'main v2';
    narrative.branches['BR-02'] = {
      id: 'BR-02',
      name: 'main v3',
      parentBranchId: null,
      forkEntryId: null,
      entryIds: [],
      createdAt: Date.now(),
    };

    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-01',
      sceneEvals: [
        { sceneId: 'S-01', verdict: 'ok', reason: '' },
        { sceneId: 'S-02', verdict: 'ok', reason: '' },
        { sceneId: 'S-03', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };

    const result = await reconstructBranch(
      narrative,
      ['S-01', 'S-02', 'S-03'],
      evaluation,
      callbacks,
      cancelledRef,
    );

    expect(result.branch.name).toBe('main v4');
  });

  it('includes thematic question in edit prompts', async () => {
    const editedScene = { summary: 'Edited' };
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify(editedScene));
    vi.mocked(parseJson).mockReturnValue(editedScene);

    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-01',
      sceneEvals: [
        { sceneId: 'S-01', verdict: 'ok', reason: '' },
        { sceneId: 'S-02', verdict: 'edit', reason: 'Fix' },
        { sceneId: 'S-03', verdict: 'ok', reason: '' },
      ],
      repetitions: ['Hero always wins', 'Mentor gives advice'],
      thematicQuestion: 'What defines true courage?',
      overall: 'Story lacks tension',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };

    await reconstructBranch(
      narrative,
      ['S-01', 'S-02', 'S-03'],
      evaluation,
      callbacks,
      cancelledRef,
    );

    const promptArg = vi.mocked(callGenerate).mock.calls[0]![0];
    expect(promptArg).toContain('What defines true courage?');
    expect(promptArg).toContain('Hero always wins');
  });

  it('chains inserts correctly (INSERT-2 after INSERT-1)', async () => {
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(JSON.stringify({ summary: 'First insert' }))
      .mockResolvedValueOnce(JSON.stringify({ summary: 'Second insert' }));
    vi.mocked(parseJson)
      .mockReturnValueOnce({ summary: 'First insert' })
      .mockReturnValueOnce({ summary: 'Second insert' });

    const narrative = createMinimalNarrative();
    const evaluation: StructureReview = {
      id: 'EVAL-1',
      createdAt: new Date().toISOString(),
      branchId: 'BR-01',
      sceneEvals: [
        { sceneId: 'S-01', verdict: 'ok', reason: '' },
        { sceneId: 'INSERT-1', verdict: 'insert', reason: 'First insert', insertAfter: 'S-01' },
        { sceneId: 'INSERT-2', verdict: 'insert', reason: 'Second insert', insertAfter: 'INSERT-1' },
        { sceneId: 'S-02', verdict: 'ok', reason: '' },
        { sceneId: 'S-03', verdict: 'ok', reason: '' },
      ],
      repetitions: [],
      thematicQuestion: '',
      overall: '',
    };
    const callbacks = createMockCallbacks();
    const cancelledRef = { current: false };

    const result = await reconstructBranch(
      narrative,
      ['S-01', 'S-02', 'S-03'],
      evaluation,
      callbacks,
      cancelledRef,
    );

    expect(result.scenes).toHaveLength(5);
    // Order: S-01, INSERT-1, INSERT-2, S-02, S-03
    expect(result.scenes[0].id).toBe('S-01');
    expect(result.scenes[1].summary).toBe('First insert');
    expect(result.scenes[2].summary).toBe('Second insert');
    expect(result.scenes[3].id).toBe('S-02');
  });
});
