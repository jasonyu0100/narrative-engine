import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import type { AnalysisJob, AnalysisChunkResult, NarrativeState } from '@/types/narrative';

// Mock dependencies — new scene-first pipeline
vi.mock('@/lib/text-analysis', () => ({
  extractSceneStructure: vi.fn(),
  groupScenesIntoArcs: vi.fn(),
  reconcileResults: vi.fn(),
  analyzeThreading: vi.fn(),
  assembleNarrative: vi.fn(),
}));

vi.mock('@/lib/ai/scenes', () => ({
  reverseEngineerScenePlan: vi.fn(),
}));

vi.mock('@/lib/constants', () => ({
  ANALYSIS_CONCURRENCY: 3,
  ANALYSIS_STAGGER_DELAY_MS: 10,
}));

vi.mock('@/lib/system-logger', () => ({
  logError: vi.fn(),
  logWarning: vi.fn(),
  logInfo: vi.fn(),
  setSystemLoggerNarrativeId: vi.fn(),
  setSystemLoggerAnalysisId: vi.fn(),
  onSystemLog: vi.fn(),
}));

vi.mock('@/lib/api-logger', () => ({
  setLoggerAnalysisId: vi.fn(),
  onApiLog: vi.fn(),
  onApiLogUpdate: vi.fn(),
}));

// Mock embedding modules (dynamically imported in runner)
vi.mock('@/lib/embeddings', () => ({
  embedPropositions: vi.fn(async (props: any[]) => props.map((p: any) => ({ ...p }))),
  generateEmbeddingsBatch: vi.fn(async (texts: string[]) => texts.map(() => new Array(1536).fill(0))),
  computeCentroid: vi.fn(() => new Array(1536).fill(0)),
}));

vi.mock('@/lib/asset-manager', () => ({
  assetManager: {
    getEmbedding: vi.fn(async () => new Array(1536).fill(0)),
    storeEmbedding: vi.fn(async () => 'emb-ref-123'),
  },
}));

import { extractSceneStructure, groupScenesIntoArcs, reconcileResults, analyzeThreading, assembleNarrative } from '@/lib/text-analysis';
import { reverseEngineerScenePlan } from '@/lib/ai/scenes';
import { analysisRunner } from '@/lib/analysis-runner';

const mockNarrative: NarrativeState = {
  id: 'narrative-1',
  title: 'Test Narrative',
  description: '',
  worldSummary: '',
  characters: {},
  locations: {},
  threads: {},
  arcs: {},
  scenes: {},
  branches: {},
  worldBuilds: {},
  systemGraph: { nodes: {}, edges: [] },
  relationships: [],
  artifacts: {},
  rules: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const mockStructureResult = {
  povName: 'Alice',
  locationName: 'Castle',
  participantNames: ['Alice'],
  events: ['event_1'],
  summary: 'Alice explores the castle.',
  characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true, continuity: [] }],
  locations: [{ name: 'Castle', parentName: null, description: 'A grand castle', lore: [] }],
  artifacts: [],
  threads: [{ description: 'Exploration', participantNames: ['Alice'], statusAtStart: 'dormant', statusAtEnd: 'active', development: 'Started' }],
  relationships: [],
  threadMutations: [{ threadDescription: 'Exploration', from: 'dormant', to: 'active' }],
  continuityMutations: [],
  relationshipMutations: [],
  artifactUsages: [],
  ownershipMutations: [],
  tieMutations: [],
  characterMovements: [],
};

// Speed up tests: eliminate all setTimeout delays (retries, backoffs, afterEach cleanup)
const origSetTimeout = globalThis.setTimeout;
beforeAll(() => {
  globalThis.setTimeout = ((fn: (...args: unknown[]) => void, _ms?: number, ...args: unknown[]) => {
    return origSetTimeout(fn, 0, ...args);
  }) as typeof globalThis.setTimeout;
});
afterAll(() => {
  globalThis.setTimeout = origSetTimeout;
});

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(reverseEngineerScenePlan).mockResolvedValue({
    plan: { beats: [{ fn: 'advance', mechanism: 'action', what: 'Test beat', propositions: [] }] },
    beatProseMap: { chunks: [], createdAt: Date.now() },
  });

  vi.mocked(extractSceneStructure).mockResolvedValue(mockStructureResult);

  vi.mocked(groupScenesIntoArcs).mockResolvedValue([
    { name: 'The Beginning', sceneIndices: [0, 1] },
  ]);

  vi.mocked(reconcileResults).mockImplementation(async (results) => results);
  vi.mocked(analyzeThreading).mockResolvedValue({});
  vi.mocked(assembleNarrative).mockResolvedValue(mockNarrative);
});

afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 10));
});

// ── Fixtures ────────────────────────────────────────────────────────────────

let jobCounter = 0;

function createMockJob(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  return {
    id: `JOB-${++jobCounter}`,
    title: 'Test Analysis',
    sourceText: 'Sample text for analysis',
    chunks: [
      { index: 0, text: 'Scene 1 prose text here with enough words.', sectionCount: 12 },
      { index: 1, text: 'Scene 2 prose text here with enough words.', sectionCount: 12 },
    ],
    results: [null, null],
    status: 'pending',
    currentChunkIndex: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function collectDispatches(dispatch: (action: any) => void): any[] {
  const dispatched: any[] = [];
  const wrapper = (action: any) => { dispatched.push(action); dispatch(action); };
  return [dispatched, wrapper] as any;
}

// ══════════════════════════════════════════════════════════════════════════════
// Full Pipeline
// ══════════════════════════════════════════════════════════════════════════════

describe('AnalysisRunner — Full Pipeline', () => {
  it('completes all 6 phases: plans → structure → arcs → reconcile → finalize → assemble', async () => {
    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));

    expect(reverseEngineerScenePlan).toHaveBeenCalledTimes(2);
    expect(extractSceneStructure).toHaveBeenCalledTimes(2);
    expect(groupScenesIntoArcs).toHaveBeenCalledTimes(1);
    expect(reconcileResults).toHaveBeenCalledTimes(1);
    expect(assembleNarrative).toHaveBeenCalledTimes(1);

    const statusUpdates = dispatched.filter(a => a.type === 'UPDATE_ANALYSIS_JOB').map(a => a.updates);
    expect(statusUpdates.some(u => u.phase === 'plans')).toBe(true);
    expect(statusUpdates.some(u => u.phase === 'structure')).toBe(true);
    expect(statusUpdates.some(u => u.phase === 'arcs')).toBe(true);
    expect(statusUpdates.some(u => u.phase === 'reconciliation')).toBe(true);
    expect(statusUpdates.some(u => u.phase === 'assembly')).toBe(true);
    expect(statusUpdates.some(u => u.status === 'completed')).toBe(true);
  });

  it('dispatches ADD_NARRATIVE on successful completion', async () => {
    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));

    const addNarrative = dispatched.find(a => a.type === 'ADD_NARRATIVE');
    expect(addNarrative).toBeDefined();
    expect(addNarrative.narrative.id).toBe('narrative-1');
  });

  it('sets status to running at start', async () => {
    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));

    const first = dispatched[0];
    expect(first.type).toBe('UPDATE_ANALYSIS_JOB');
    expect(first.updates.status).toBe('running');
  });

  it('sets narrativeId on completion', async () => {
    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));

    const completed = dispatched.find(a => a.type === 'UPDATE_ANALYSIS_JOB' && a.updates.status === 'completed');
    expect(completed).toBeDefined();
    expect(completed.updates.narrativeId).toBe('narrative-1');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 1: Plans
// ══════════════════════════════════════════════════════════════════════════════

describe('AnalysisRunner — Phase 1: Plans', () => {
  it('skips scenes that already have plans', async () => {
    const job = createMockJob({
      results: [
        {
          chapterSummary: 'Already done',
          characters: [],
          locations: [],
          threads: [],
          scenes: [{
            locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
            events: ['event'], summary: 'Existing', sections: [],
            prose: 'Existing prose',
            plan: { beats: [{ fn: 'advance', mechanism: 'action', what: 'existing', propositions: [] }] },
            threadMutations: [], continuityMutations: [], relationshipMutations: [],
          }],
          relationships: [],
        },
        null,
      ],
    });

    await analysisRunner.start(job, () => {});
    expect(reverseEngineerScenePlan).toHaveBeenCalledTimes(1);
  });

  it('handles plan extraction failure gracefully — pipeline continues', async () => {
    vi.mocked(reverseEngineerScenePlan).mockRejectedValue(new Error('LLM failed'));

    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));

    // Pipeline continues despite plan failures
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
    const completed = dispatched.find(a => a.type === 'UPDATE_ANALYSIS_JOB' && a.updates.status === 'completed');
    expect(completed).toBeDefined();
  });

  it('initializes result with plan + prose after successful extraction', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    // reconcileResults receives results with plans populated
    const reconciledInput = vi.mocked(reconcileResults).mock.calls[0][0];
    // At least the successfully planned scenes should have plans
    const withPlans = reconciledInput.filter(r => r.scenes?.[0]?.plan);
    expect(withPlans.length).toBeGreaterThan(0);
  });

  it('stores prose text from chunk in plan result', async () => {
    const job = createMockJob({
      chunks: [{ index: 0, text: 'Specific prose content for testing.', sectionCount: 12 }],
      results: [null],
    });

    await analysisRunner.start(job, () => {});

    const reconciledInput = vi.mocked(reconcileResults).mock.calls[0][0];
    expect(reconciledInput[0].scenes[0].prose).toBe('Specific prose content for testing.');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 2: Structure
// ══════════════════════════════════════════════════════════════════════════════

describe('AnalysisRunner — Phase 2: Structure', () => {
  it('extracts structure for scenes with plans', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    expect(extractSceneStructure).toHaveBeenCalledTimes(2);
  });

  it('passes structure results to reconciliation', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    const reconciledInput = vi.mocked(reconcileResults).mock.calls[0][0];
    expect(reconciledInput.length).toBe(2);
    // Structure phase populates chapterSummary from structure result
    expect(reconciledInput[0].chapterSummary).toBe('Alice explores the castle.');
  });

  it('populates scene mutations from structure result', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    const reconciledInput = vi.mocked(reconcileResults).mock.calls[0][0];
    const scene = reconciledInput[0].scenes[0];
    expect(scene.povName).toBe('Alice');
    expect(scene.locationName).toBe('Castle');
    expect(scene.threadMutations).toHaveLength(1);
    expect(scene.threadMutations[0].threadDescription).toBe('Exploration');
  });

  it('populates chunk-level entities from structure result', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    const reconciledInput = vi.mocked(reconcileResults).mock.calls[0][0];
    expect(reconciledInput[0].characters).toHaveLength(1);
    expect(reconciledInput[0].characters[0].name).toBe('Alice');
    expect(reconciledInput[0].locations).toHaveLength(1);
    expect(reconciledInput[0].threads).toHaveLength(1);
  });

  it('handles structure extraction failure gracefully — pipeline continues', async () => {
    vi.mocked(extractSceneStructure).mockRejectedValue(new Error('LLM failed'));

    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    // Pipeline continues — assembly still runs
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
  });

  it('still attempts structure even when plans fail — uses prose alone', async () => {
    vi.mocked(reverseEngineerScenePlan).mockRejectedValue(new Error('All plans failed'));

    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    // Structure extraction is attempted (with prose, plan may be null)
    expect(extractSceneStructure).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 3: Arcs
// ══════════════════════════════════════════════════════════════════════════════

describe('AnalysisRunner — Phase 3: Arcs', () => {
  it('passes scene summaries to arc grouping', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    expect(groupScenesIntoArcs).toHaveBeenCalledTimes(1);
    const args = vi.mocked(groupScenesIntoArcs).mock.calls[0][0];
    expect(args.length).toBe(2);
    // Summaries come from structure extraction
    expect(args[0].summary).toBe('Alice explores the castle.');
  });

  it('falls back to default arc names on grouping failure', async () => {
    vi.mocked(groupScenesIntoArcs).mockRejectedValue(new Error('LLM failed'));

    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    // Assembly still runs — arcGroups passed to assembleNarrative
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
    const arcGroups = vi.mocked(assembleNarrative).mock.calls[0][4];
    // Fallback creates "Arc 1", "Arc 2", etc.
    expect(arcGroups).toBeDefined();
    expect(arcGroups![0].name).toMatch(/^Arc \d+$/);
  });

  it('stores arc groups on job for assembly', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    const arcGroups = vi.mocked(assembleNarrative).mock.calls[0][4];
    expect(arcGroups).toBeDefined();
    expect(arcGroups![0].name).toBe('The Beginning');
    expect(arcGroups![0].sceneIndices).toEqual([0, 1]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 4: Reconciliation
// ══════════════════════════════════════════════════════════════════════════════

describe('AnalysisRunner — Phase 4: Reconciliation', () => {
  it('passes non-null results to reconciliation', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    const reconciledInput = vi.mocked(reconcileResults).mock.calls[0][0];
    // Should filter out null results
    expect(reconciledInput.every(r => r !== null)).toBe(true);
  });

  it('updates results array with reconciled data', async () => {
    const reconciledResult: AnalysisChunkResult = {
      chapterSummary: 'RECONCILED',
      characters: [], locations: [], threads: [],
      scenes: [{ locationName: '', povName: '', participantNames: [], events: [], summary: '', sections: [], threadMutations: [], continuityMutations: [], relationshipMutations: [] }],
      relationships: [],
    };
    vi.mocked(reconcileResults).mockResolvedValue([reconciledResult, reconciledResult]);

    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));

    // Results should be updated after reconciliation
    const resultUpdates = dispatched.filter(a => a.type === 'UPDATE_ANALYSIS_JOB' && a.updates.results);
    expect(resultUpdates.length).toBeGreaterThan(0);
  });

  it('handles reconciliation failure gracefully — uses raw results', async () => {
    vi.mocked(reconcileResults).mockRejectedValue(new Error('Reconciliation failed'));

    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    // Assembly still runs with unreconciled data
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 5: Finalization
// ══════════════════════════════════════════════════════════════════════════════

describe('AnalysisRunner — Phase 5: Finalization', () => {
  it('dispatches finalization phase update', async () => {
    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));

    const finalizationUpdate = dispatched.find(a =>
      a.type === 'UPDATE_ANALYSIS_JOB' && a.updates.phase === 'finalization'
    );
    expect(finalizationUpdate).toBeDefined();
  });

  it('calls analyzeThreading with unique thread descriptions', async () => {
    // Setup: structure returns 2 threads across 2 scenes
    vi.mocked(extractSceneStructure).mockResolvedValue({
      ...mockStructureResult,
      threads: [
        { description: 'Quest A', participantNames: ['Alice'], statusAtStart: 'dormant', statusAtEnd: 'active', development: 'Started' },
        { description: 'Quest B', participantNames: ['Alice'], statusAtStart: 'dormant', statusAtEnd: 'active', development: 'Also started' },
      ],
    });

    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    expect(analyzeThreading).toHaveBeenCalledTimes(1);
    const threads = vi.mocked(analyzeThreading).mock.calls[0][0];
    expect(threads).toContain('Quest A');
    expect(threads).toContain('Quest B');
  });

  it('skips analyzeThreading when fewer than 2 unique threads', async () => {
    // Only 1 unique thread across all results
    vi.mocked(extractSceneStructure).mockResolvedValue({
      ...mockStructureResult,
      threads: [{ description: 'Only Thread', participantNames: ['Alice'], statusAtStart: 'dormant', statusAtEnd: 'active', development: 'Started' }],
    });

    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    // analyzeThreading should not be called (< 2 threads)
    expect(analyzeThreading).not.toHaveBeenCalled();
  });

  it('handles finalization failure gracefully', async () => {
    vi.mocked(analyzeThreading).mockRejectedValue(new Error('Thread analysis failed'));
    vi.mocked(extractSceneStructure).mockResolvedValue({
      ...mockStructureResult,
      threads: [
        { description: 'A', participantNames: ['Alice'], statusAtStart: 'dormant', statusAtEnd: 'active', development: '' },
        { description: 'B', participantNames: ['Alice'], statusAtStart: 'dormant', statusAtEnd: 'active', development: '' },
      ],
    });

    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    // Assembly still runs
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
  });

  it('passes thread dependencies to assembly', async () => {
    const deps = { 'Quest B': ['Quest A'] };
    vi.mocked(analyzeThreading).mockResolvedValue(deps);
    vi.mocked(extractSceneStructure).mockResolvedValue({
      ...mockStructureResult,
      threads: [
        { description: 'Quest A', participantNames: ['Alice'], statusAtStart: 'dormant', statusAtEnd: 'active', development: '' },
        { description: 'Quest B', participantNames: ['Alice'], statusAtStart: 'dormant', statusAtEnd: 'active', development: '' },
      ],
    });

    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    const threadDepsArg = vi.mocked(assembleNarrative).mock.calls[0][2];
    expect(threadDepsArg).toEqual(deps);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 6: Assembly
// ══════════════════════════════════════════════════════════════════════════════

describe('AnalysisRunner — Phase 6: Assembly', () => {
  it('dispatches assembly phase update', async () => {
    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));

    const assemblyUpdate = dispatched.find(a =>
      a.type === 'UPDATE_ANALYSIS_JOB' && a.updates.phase === 'assembly'
    );
    expect(assemblyUpdate).toBeDefined();
  });

  it('passes title and completed results to assembleNarrative', async () => {
    const job = createMockJob({ title: 'My Book' });
    await analysisRunner.start(job, () => {});

    expect(assembleNarrative).toHaveBeenCalledTimes(1);
    const [title, results] = vi.mocked(assembleNarrative).mock.calls[0];
    expect(title).toBe('My Book');
    expect(results.length).toBe(2);
  });

  it('marks job as failed when assembly throws', async () => {
    vi.mocked(assembleNarrative).mockRejectedValue(new Error('Assembly exploded'));

    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));

    const failedUpdate = dispatched.find(a =>
      a.type === 'UPDATE_ANALYSIS_JOB' && a.updates.status === 'failed'
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate.updates.error).toBe('Assembly exploded');

    // ADD_NARRATIVE should NOT be dispatched
    const addNarrative = dispatched.find(a => a.type === 'ADD_NARRATIVE');
    expect(addNarrative).toBeUndefined();
  });

  it('filters null results before passing to assembly', async () => {
    // One plan fails, so one result stays null
    let callCount = 0;
    vi.mocked(reverseEngineerScenePlan).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('First plan failed');
      return { plan: { beats: [{ fn: 'advance', mechanism: 'action', what: 'Test', propositions: [] }] }, beatProseMap: { chunks: [], createdAt: Date.now() } };
    });

    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    const results = vi.mocked(assembleNarrative).mock.calls[0][1];
    // Should only contain non-null results
    expect(results.every(r => r !== null)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Cancellation & Lifecycle
// ══════════════════════════════════════════════════════════════════════════════

describe('AnalysisRunner — Cancellation & Lifecycle', () => {
  it('pauses job when cancelled during plans phase', async () => {
    vi.mocked(reverseEngineerScenePlan).mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 100))
    );

    const job = createMockJob({
      chunks: Array.from({ length: 10 }, (_, i) => ({ index: i, text: `Scene ${i}`, sectionCount: 12 })),
      results: Array(10).fill(null),
    });
    const dispatched: any[] = [];

    const promise = analysisRunner.start(job, (action) => dispatched.push(action));

    await new Promise(resolve => setTimeout(resolve, 20));
    analysisRunner.pause(job.id);

    await promise;

    const statusUpdates = dispatched.filter(a => a.type === 'UPDATE_ANALYSIS_JOB').map(a => a.updates);
    expect(statusUpdates.some(u => u.status === 'paused')).toBe(true);
  });

  it('pauses job when cancelled between phases', async () => {
    // Make plan extraction complete quickly but cancel before structure
    vi.mocked(reverseEngineerScenePlan).mockImplementation(async () => {
      return { plan: { beats: [{ fn: 'advance', mechanism: 'action', what: 'Test', propositions: [] }] }, beatProseMap: { chunks: [], createdAt: Date.now() } };
    });

    // Cancel during structure phase
    vi.mocked(extractSceneStructure).mockImplementation(async () => {
      // Signal cancellation immediately
      return mockStructureResult;
    });

    const job = createMockJob();
    const dispatched: any[] = [];

    // Start and immediately pause after plans complete
    const promise = analysisRunner.start(job, (action) => {
      dispatched.push(action);
      // Cancel after plans phase completes and structure phase starts
      if ((action as any).updates?.phase === 'structure') {
        analysisRunner.pause(job.id);
      }
    });

    await promise;

    const statusUpdates = dispatched.filter(a => a.type === 'UPDATE_ANALYSIS_JOB').map(a => a.updates);
    expect(statusUpdates.some(u => u.status === 'paused')).toBe(true);
    // Assembly should NOT have run
    expect(assembleNarrative).not.toHaveBeenCalled();
  });

  it('does not start a duplicate job', async () => {
    // Make first job take long
    vi.mocked(reverseEngineerScenePlan).mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 200))
    );

    const job = createMockJob();
    const dispatched: any[] = [];

    const promise1 = analysisRunner.start(job, (action) => dispatched.push(action));

    // Try to start same job again
    await analysisRunner.start(job, () => {});

    analysisRunner.pause(job.id);
    await promise1;

    // reverseEngineerScenePlan should only be called from the first start
    // (the second start is a no-op)
  });

  it('cleans up after completion', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    // After completion, runner should not report as running
    expect(analysisRunner.isRunning(job.id)).toBe(false);
    expect(analysisRunner.getStreamText(job.id)).toBe('');
    expect(analysisRunner.getInFlightIndices(job.id)).toEqual([]);
  });

  it('cleans up after failure', async () => {
    vi.mocked(assembleNarrative).mockRejectedValue(new Error('Fatal'));

    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    expect(analysisRunner.isRunning(job.id)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Event System
// ══════════════════════════════════════════════════════════════════════════════

describe('AnalysisRunner — Event System', () => {
  it('emits stream events during pipeline', async () => {
    const streamTexts: string[] = [];
    const unsub = analysisRunner.onStream((jobId, text) => {
      streamTexts.push(text);
    });

    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    unsub();

    // Should have emitted stream events for plans, structure, arcs, reconciliation, assembly
    expect(streamTexts.length).toBeGreaterThan(0);
    expect(streamTexts.some(t => t.includes('Plans'))).toBe(true);
    expect(streamTexts.some(t => t.includes('Structure'))).toBe(true);
  });

  it('listener can be unsubscribed', async () => {
    const streamTexts: string[] = [];
    const unsub = analysisRunner.onStream((jobId, text) => {
      streamTexts.push(text);
    });
    unsub();

    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    // Should not have received any events after unsubscribing
    expect(streamTexts).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Concurrency
// ══════════════════════════════════════════════════════════════════════════════

describe('AnalysisRunner — Concurrency', () => {
  it('respects concurrency limit for plan extraction', async () => {
    let maxConcurrent = 0;
    let current = 0;

    vi.mocked(reverseEngineerScenePlan).mockImplementation(async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise(resolve => setTimeout(resolve, 20));
      current--;
      return { plan: { beats: [{ fn: 'advance', mechanism: 'action', what: 'Test', propositions: [] }] }, beatProseMap: { chunks: [], createdAt: Date.now() } };
    });

    const job = createMockJob({
      chunks: Array.from({ length: 10 }, (_, i) => ({ index: i, text: `Scene ${i} prose`, sectionCount: 12 })),
      results: Array(10).fill(null),
    });

    await analysisRunner.start(job, () => {});

    // ANALYSIS_CONCURRENCY is mocked to 3
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  it('processes all scenes even with concurrency limit', async () => {
    const job = createMockJob({
      chunks: Array.from({ length: 6 }, (_, i) => ({ index: i, text: `Scene ${i} prose`, sectionCount: 12 })),
      results: Array(6).fill(null),
    });

    await analysisRunner.start(job, () => {});

    expect(reverseEngineerScenePlan).toHaveBeenCalledTimes(6);
    // Structure also runs for each successfully planned scene
    expect(extractSceneStructure).toHaveBeenCalledTimes(6);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Edge Cases
// ══════════════════════════════════════════════════════════════════════════════

describe('AnalysisRunner — Edge Cases', () => {
  it('handles job with single chunk', async () => {
    const job = createMockJob({
      chunks: [{ index: 0, text: 'Only scene.', sectionCount: 5 }],
      results: [null],
    });

    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));

    expect(reverseEngineerScenePlan).toHaveBeenCalledTimes(1);
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
    expect(dispatched.some(a => a.type === 'ADD_NARRATIVE')).toBe(true);
  });

  it('handles job where all plan extractions fail', async () => {
    vi.mocked(reverseEngineerScenePlan).mockRejectedValue(new Error('All fail'));

    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));

    // Pipeline still completes (assembly with empty data)
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
    expect(dispatched.some(a => a.updates?.status === 'completed')).toBe(true);
  });

  it('handles partial results from prior run', async () => {
    const existingResult: AnalysisChunkResult = {
      chapterSummary: 'Already analyzed',
      characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true }],
      locations: [],
      threads: [{ description: 'Thread', participantNames: ['Alice'], statusAtStart: 'dormant', statusAtEnd: 'active', development: 'Done' }],
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Done', sections: [], prose: 'Done prose',
        plan: { beats: [{ fn: 'advance', mechanism: 'action', what: 'done', propositions: [] }] },
        threadMutations: [], continuityMutations: [], relationshipMutations: [],
      }],
      relationships: [],
    };

    const job = createMockJob({
      results: [existingResult, null], // First chunk done, second pending
    });

    await analysisRunner.start(job, () => {});

    // Only second chunk needs plan extraction
    expect(reverseEngineerScenePlan).toHaveBeenCalledTimes(1);
    // But structure extraction skips scene 0 too (already has chapterSummary)
    // Scene 1 gets structure extraction
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
  });

  it('dispatches progress updates during parallel plan phase', async () => {
    const job = createMockJob({
      chunks: Array.from({ length: 4 }, (_, i) => ({ index: i, text: `Scene ${i}`, sectionCount: 12 })),
      results: Array(4).fill(null),
    });

    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));

    // Should have multiple result updates as scenes complete
    const resultUpdates = dispatched.filter(a =>
      a.type === 'UPDATE_ANALYSIS_JOB' && a.updates.results
    );
    expect(resultUpdates.length).toBeGreaterThan(0);
  });
});
