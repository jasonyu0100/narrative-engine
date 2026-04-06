import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AnalysisJob, AnalysisChunkResult } from '@/types/narrative';

// Mock dependencies
vi.mock('@/lib/text-analysis', () => ({
  analyzeChunkParallel: vi.fn(),
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
  ANALYSIS_MAX_CHUNK_RETRIES: 2,
  ANALYSIS_PLAN_BACKOFF_ENABLED: false, // Disable backoff in tests for speed
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

import { analyzeChunkParallel, reconcileResults, analyzeThreading, assembleNarrative } from '@/lib/text-analysis';
import { reverseEngineerScenePlan } from '@/lib/ai/scenes';
import { analysisRunner } from '@/lib/analysis-runner';

// Use the singleton instance for testing
const AnalysisRunner = analysisRunner;

beforeEach(() => {
  vi.clearAllMocks();

  // Set up default mock implementations
  vi.mocked(analyzeChunkParallel).mockImplementation((_text, chunkIdx) =>
    Promise.resolve(createMockChunkResult(chunkIdx))
  );
  vi.mocked(reconcileResults).mockImplementation(async (results) => results);
  vi.mocked(analyzeThreading).mockResolvedValue({});
  vi.mocked(assembleNarrative).mockResolvedValue({
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
    worldKnowledge: { nodes: {}, edges: [] },
    relationships: [],
    artifacts: {},
    rules: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  vi.mocked(reverseEngineerScenePlan).mockResolvedValue({
    plan: { beats: [] },
    beatProseMap: {
      chunks: [],
      createdAt: Date.now(),
    },
  });
});

afterEach(async () => {
  // Wait for any pending operations to complete and prevent state leakage between tests
  await new Promise(resolve => setTimeout(resolve, 100));
});

// ── Test Fixtures ────────────────────────────────────────────────────────────

let jobCounter = 0;

function createMockJob(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  return {
    id: `JOB-${++jobCounter}`,
    title: 'Test Analysis',
    sourceText: 'Sample text for analysis',
    chunks: [
      { index: 0, text: 'Chunk 1 text', sectionCount: 10 },
      { index: 1, text: 'Chunk 2 text', sectionCount: 10 },
    ],
    results: [null, null],
    status: 'pending',
    currentChunkIndex: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createMockChunkResult(index: number): AnalysisChunkResult {
  return {
    chapterSummary: `Chapter ${index} summary`,
    characters: [
      { name: `Character ${index}`, role: 'main', firstAppearance: true, continuity: [] },
    ],
    locations: [
      { name: `Location ${index}`, parentName: null, description: 'A place', lore: [] },
    ],
    threads: [
      {
        description: `Thread ${index}`,
        participantNames: [`Character ${index}`],
        statusAtStart: 'dormant',
        statusAtEnd: 'active',
        development: 'Started',
      },
    ],
    scenes: [
      {
        locationName: `Location ${index}`,
        povName: `Character ${index}`,
        participantNames: [`Character ${index}`],
        events: ['event'],
        summary: 'Scene summary',
        sections: [0],
        prose: 'Scene prose paragraph 1.\n\nScene prose paragraph 2.',
        threadMutations: [],
        continuityMutations: [],
        relationshipMutations: [],
      },
    ],
    relationships: [],
  };
}

// ── Lifecycle Tests ──────────────────────────────────────────────────────────

describe('AnalysisRunner Lifecycle', () => {
  let dispatchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dispatchMock = vi.fn();
  });

  it('emits stream updates to registered listeners', async () => {

    const streamListener = vi.fn();
    const unsubscribe = AnalysisRunner.onStream(streamListener);

    vi.mocked(analyzeChunkParallel).mockResolvedValue(createMockChunkResult(0));

    const job = createMockJob({ chunks: [{ index: 0, text: 'Test', sectionCount: 1 }], results: [null] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await AnalysisRunner.start(job, dispatchMock as any);

    expect(streamListener).toHaveBeenCalled();

    unsubscribe();
  });

  it('tracks in-flight chunks during Phase 1 extraction', async () => {

    const inFlightListener = vi.fn();
    AnalysisRunner.onInFlightChange(inFlightListener);

    // Delay chunk processing to observe in-flight state
    vi.mocked(analyzeChunkParallel).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(createMockChunkResult(0)), 100))
    );

    const job = createMockJob();
    const runPromise = AnalysisRunner.start(job, dispatchMock as any);

    // Wait a bit for chunks to be in flight
    await new Promise(resolve => setTimeout(resolve, 20));

    const inFlight = AnalysisRunner.getInFlightIndices(job.id);
    expect(inFlight.length).toBeGreaterThan(0);

    await runPromise;
  });

  it('allows cancelling a running job', async () => {

    vi.mocked(analyzeChunkParallel).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(createMockChunkResult(0)), 200))
    );

    const job = createMockJob();
    const runPromise = AnalysisRunner.start(job, dispatchMock as any);

    // Cancel after starting
    setTimeout(() => AnalysisRunner.pause(job.id), 50);

    await runPromise;

    // Should have dispatched pause status
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_ANALYSIS_JOB',
        id: job.id,
        updates: expect.objectContaining({ status: 'paused' }),
      })
    );
  });
});

// ── Phase 1: Extraction Tests ────────────────────────────────────────────────

describe('Phase 1: Parallel Extraction', () => {
  let dispatchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dispatchMock = vi.fn();
  });

  it('processes all chunks in parallel up to MAX_CONCURRENCY', async () => {
    const job = createMockJob({
      chunks: [
        { index: 0, text: 'C0', sectionCount: 1 },
        { index: 1, text: 'C1', sectionCount: 1 },
        { index: 2, text: 'C2', sectionCount: 1 },
        { index: 3, text: 'C3', sectionCount: 1 },
      ],
      results: [null, null, null, null],
    });

    vi.mocked(analyzeChunkParallel).mockResolvedValue(createMockChunkResult(0));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await AnalysisRunner.start(job, dispatchMock as any);

    expect(analyzeChunkParallel).toHaveBeenCalledTimes(4);
  });

  it('retries failed chunks up to MAX_RETRIES', async () => {
    const job = createMockJob({
      chunks: [{ index: 0, text: 'Chunk', sectionCount: 1 }],
      results: [null],
    });

    let callCount = 0;
    vi.mocked(analyzeChunkParallel).mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        // Use a parse/type error that will trigger auto-retry
        return Promise.reject(new Error('JSON parse error: unexpected token'));
      }
      return Promise.resolve(createMockChunkResult(0));
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await AnalysisRunner.start(job, dispatchMock as any);

    // Should have been called 3 times (initial + 2 retries)
    expect(analyzeChunkParallel).toHaveBeenCalledTimes(3);

    // Job should complete successfully after retries
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_ANALYSIS_JOB',
        updates: expect.objectContaining({ status: 'completed' }),
      })
    );
  });

  it('fails job if chunk fails after all retries', async () => {
    const job = createMockJob({
      chunks: [{ index: 0, text: 'Chunk', sectionCount: 1 }],
      results: [null],
    });

    vi.mocked(analyzeChunkParallel).mockRejectedValue(new Error('Persistent failure'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await AnalysisRunner.start(job, dispatchMock as any);

    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_ANALYSIS_JOB',
        updates: expect.objectContaining({
          status: 'failed',
          error: expect.stringContaining('Extraction failed after retry'),
        }),
      })
    );
  });

  it('updates currentChunkIndex as chunks complete', async () => {
    const job = createMockJob({
      chunks: [
        { index: 0, text: 'C0', sectionCount: 1 },
        { index: 1, text: 'C1', sectionCount: 1 },
      ],
      results: [null, null],
    });

    vi.mocked(analyzeChunkParallel).mockResolvedValue(createMockChunkResult(0));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await AnalysisRunner.start(job, dispatchMock as any);

    const updateCalls = dispatchMock.mock.calls.filter(
      (call: any[]) => call[0].type === 'UPDATE_ANALYSIS_JOB' && call[0].updates.currentChunkIndex !== undefined
    );

    expect(updateCalls.length).toBeGreaterThan(0);
  });
});

// ── Phase 2: Plan Extraction Tests ──────────────────────────────────────────

describe('Phase 2: Beat Plan Extraction', () => {
  let dispatchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dispatchMock = vi.fn();
  });

  it('extracts beat plans from all scenes with prose', async () => {
    const chunkResult = createMockChunkResult(0);
    // Add a second scene without prose
    chunkResult.scenes.push({
      locationName: 'Loc2',
      povName: 'Char2',
      participantNames: ['Char2'],
      events: [],
      summary: 'Summary without prose',
      sections: [1],
      threadMutations: [],
      continuityMutations: [],
      relationshipMutations: [],
    });

    vi.mocked(analyzeChunkParallel).mockResolvedValue(chunkResult);
    vi.mocked(reverseEngineerScenePlan).mockResolvedValue({
      plan: {
        beats: [{ fn: 'breathe', mechanism: 'environment', what: 'Setup', propositions: [] }],
      },
      beatProseMap: {
        chunks: [{ beatIndex: 0, prose: 'Para 1' }],
        createdAt: Date.now(),
      },
    });

    const job = createMockJob({
      chunks: [{ index: 0, text: 'Test', sectionCount: 1 }],
      results: [null],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await AnalysisRunner.start(job, dispatchMock as any);

    // Should only extract plan for scene with prose
    expect(reverseEngineerScenePlan).toHaveBeenCalledTimes(1);
    expect(reverseEngineerScenePlan).toHaveBeenCalledWith(
      chunkResult.scenes[0].prose,
      chunkResult.scenes[0].summary,
      expect.any(Function)
    );
  });

  it('stores both plan and beatProseMap in scene', async () => {
    const chunkResult = createMockChunkResult(0);

    vi.mocked(analyzeChunkParallel).mockResolvedValue(chunkResult);

    const mockPlan = {
      beats: [{ fn: 'advance' as const, mechanism: 'action' as const, what: 'Action', propositions: [] }],
    };
    const mockBeatProseMap = {
      chunks: [{ beatIndex: 0, prose: 'Action prose' }],
      createdAt: Date.now(),
    };

    vi.mocked(reverseEngineerScenePlan).mockResolvedValue({
      plan: mockPlan,
      beatProseMap: mockBeatProseMap,
    });

    const job = createMockJob({
      chunks: [{ index: 0, text: 'Test', sectionCount: 1 }],
      results: [null],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await AnalysisRunner.start(job, dispatchMock as any);

    // Check that results were updated with both plan and beatProseMap
    const updateCall = dispatchMock.mock.calls.find(
      (call: any[]) =>
        call[0].type === 'UPDATE_ANALYSIS_JOB' &&
        call[0].updates.results?.[0]?.scenes?.[0]?.plan
    );

    expect(updateCall).toBeDefined();
    expect(updateCall![0].updates.results[0].scenes[0].plan).toEqual(mockPlan);
    expect(updateCall![0].updates.results[0].scenes[0].beatProseMap).toEqual(mockBeatProseMap);
  });

  it('continues if beat plan extraction fails for a scene (non-fatal)', async () => {
    const chunkResult = createMockChunkResult(0);

    vi.mocked(analyzeChunkParallel).mockResolvedValue(chunkResult);

    // Mock plan extraction to always fail
    vi.mocked(reverseEngineerScenePlan).mockImplementation(() => {
      return Promise.reject(new Error('Plan extraction failed'));
    });

    const job = createMockJob({
      chunks: [{ index: 0, text: 'Test', sectionCount: 1 }],
      results: [null],
    });

    // Set longer timeout due to retry delays
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await AnalysisRunner.start(job, dispatchMock as any);

    // Job should still complete successfully
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_ANALYSIS_JOB',
        updates: expect.objectContaining({ status: 'completed' }),
      })
    );
  }, 15000);

  it('emits plan stream updates during extraction', async () => {
    const chunkResult = createMockChunkResult(0);

    vi.mocked(analyzeChunkParallel).mockResolvedValue(chunkResult);

    vi.mocked(reverseEngineerScenePlan).mockImplementation(async (_prose, _summary, onToken) => {
      // Call onToken synchronously before resolving
      if (onToken) {
        onToken('beat', 'beat');
        onToken(' plan', 'beat plan');
      }
      return {
        plan: { beats: [{ fn: 'breathe', mechanism: 'environment', what: 'Setup', propositions: [] }] },
        beatProseMap: { chunks: [], createdAt: Date.now() },
      };
    });

    const planStreamListener = vi.fn();
    AnalysisRunner.onPlanStream(planStreamListener);

    const job = createMockJob({
      chunks: [{ index: 0, text: 'Test', sectionCount: 1 }],
      results: [null],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await AnalysisRunner.start(job, dispatchMock as any);

    expect(planStreamListener).toHaveBeenCalled();
  });
});

// ── Phase 3: Reconciliation Tests ───────────────────────────────────────────

describe('Phase 3: Reconciliation', () => {
  let dispatchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dispatchMock = vi.fn();
  });

  it('calls reconcileResults with all chunk results', async () => {
    const results = [createMockChunkResult(0), createMockChunkResult(1)];

    // Explicitly mock to ensure it's working
    vi.mocked(analyzeChunkParallel).mockImplementation((_text, idx) =>
      Promise.resolve(createMockChunkResult(idx))
    );
    vi.mocked(reconcileResults).mockResolvedValue(results);

    const job = createMockJob({
      chunks: [
        { index: 0, text: 'C0', sectionCount: 1 },
        { index: 1, text: 'C1', sectionCount: 1 },
      ],
      results: [null, null],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await AnalysisRunner.start(job, dispatchMock as any);

    // Verify reconcileResults was called with array of 2 results
    // (results may have been augmented by Phase 2 plan extraction)
    expect(reconcileResults).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(reconcileResults).mock.calls[0];
    expect(callArgs[0]).toHaveLength(2);
    expect(callArgs[0][0]).toMatchObject({
      chapterSummary: 'Chapter 0 summary',
      characters: expect.any(Array),
      scenes: expect.any(Array),
    });
    expect(callArgs[0][1]).toMatchObject({
      chapterSummary: 'Chapter 1 summary',
      characters: expect.any(Array),
      scenes: expect.any(Array),
    });
    expect(callArgs[1]).toEqual(expect.any(Function));
  });

  it('updates phase to reconciliation during Phase 3', async () => {
    vi.mocked(analyzeChunkParallel).mockResolvedValue(createMockChunkResult(0));
    vi.mocked(reconcileResults).mockResolvedValue([createMockChunkResult(0)]);

    const job = createMockJob({
      chunks: [{ index: 0, text: 'Test', sectionCount: 1 }],
      results: [null],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await AnalysisRunner.start(job, dispatchMock as any);

    const phaseUpdate = dispatchMock.mock.calls.find(
      (call: any[]) => call[0].updates?.phase === 'reconciliation'
    );

    expect(phaseUpdate).toBeDefined();
  });
});

// ── Phase 4: Finalization Tests ──────────────────────────────────────────────

describe('Phase 4: Finalization', () => {
  let dispatchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dispatchMock = vi.fn();
  });

  it('calls analyzeThreading with canonical thread descriptions', async () => {
    // Need at least 2 threads for analyzeThreading to be called
    const results = [createMockChunkResult(0), createMockChunkResult(1)];

    vi.mocked(analyzeChunkParallel).mockImplementation((_text, idx) =>
      Promise.resolve(createMockChunkResult(idx))
    );
    vi.mocked(reconcileResults).mockResolvedValue(results);
    vi.mocked(analyzeThreading).mockResolvedValue({});

    const job = createMockJob({
      chunks: [
        { index: 0, text: 'Test 1', sectionCount: 1 },
        { index: 1, text: 'Test 2', sectionCount: 1 },
      ],
      results: [null, null],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await AnalysisRunner.start(job, dispatchMock as any);

    // Should be called with array of thread descriptions and callback
    expect(analyzeThreading).toHaveBeenCalledWith(
      expect.arrayContaining(['Thread 0', 'Thread 1']),
      expect.any(Function)
    );
  });

  it('updates phase to finalization during Phase 4', async () => {
    vi.mocked(analyzeChunkParallel).mockResolvedValue(createMockChunkResult(0));
    vi.mocked(reconcileResults).mockResolvedValue([createMockChunkResult(0)]);
    vi.mocked(analyzeThreading).mockResolvedValue({});

    const job = createMockJob({
      chunks: [{ index: 0, text: 'Test', sectionCount: 1 }],
      results: [null],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await AnalysisRunner.start(job, dispatchMock as any);

    const phaseUpdate = dispatchMock.mock.calls.find(
      (call: any[]) => call[0].updates?.phase === 'finalization'
    );

    expect(phaseUpdate).toBeDefined();
  });
});

// ── Phase 5: Assembly Tests ──────────────────────────────────────────────────

describe('Phase 5: Assembly', () => {
  let dispatchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dispatchMock = vi.fn();
  });

  it('calls assembleNarrative with finalized results', async () => {
    const results = [createMockChunkResult(0)];

    vi.mocked(analyzeChunkParallel).mockResolvedValue(results[0]);
    vi.mocked(reconcileResults).mockResolvedValue(results);
    vi.mocked(analyzeThreading).mockResolvedValue({});
    vi.mocked(assembleNarrative).mockReturnValue({ id: 'N-001', title: 'Test' } as any);

    const job = createMockJob({
      chunks: [{ index: 0, text: 'Test', sectionCount: 1 }],
      results: [null],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await AnalysisRunner.start(job, dispatchMock as any);

    expect(assembleNarrative).toHaveBeenCalledWith(
      job.title,
      results,
      expect.any(Object),  // threadDependencies
      expect.any(Function) // onToken callback
    );
  });

  it('creates narrative in store and updates job with narrativeId', async () => {
    const mockNarrative = { id: 'N-ASSEMBLED', title: 'Test Narrative' } as any;

    vi.mocked(analyzeChunkParallel).mockResolvedValue(createMockChunkResult(0));
    vi.mocked(reconcileResults).mockResolvedValue([createMockChunkResult(0)]);
    vi.mocked(analyzeThreading).mockResolvedValue({});
    vi.mocked(assembleNarrative).mockResolvedValue(mockNarrative);

    const job = createMockJob({
      chunks: [{ index: 0, text: 'Test', sectionCount: 1 }],
      results: [null],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await AnalysisRunner.start(job, dispatchMock as any);

    // Should create narrative
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADD_NARRATIVE',
        narrative: mockNarrative,
      })
    );

    // Should update job with narrativeId
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_ANALYSIS_JOB',
        updates: expect.objectContaining({
          narrativeId: mockNarrative.id,
          status: 'completed',
        }),
      })
    );
  });

  it('updates phase to assembly during Phase 5', async () => {
    vi.mocked(analyzeChunkParallel).mockResolvedValue(createMockChunkResult(0));
    vi.mocked(reconcileResults).mockResolvedValue([createMockChunkResult(0)]);
    vi.mocked(analyzeThreading).mockResolvedValue({});
    vi.mocked(assembleNarrative).mockResolvedValue({ id: 'N-001', title: 'Test' } as any);

    const job = createMockJob({
      chunks: [{ index: 0, text: 'Test', sectionCount: 1 }],
      results: [null],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await AnalysisRunner.start(job, dispatchMock as any);

    const phaseUpdate = dispatchMock.mock.calls.find(
      (call: any[]) => call[0].updates?.phase === 'assembly'
    );

    expect(phaseUpdate).toBeDefined();
  });
});
