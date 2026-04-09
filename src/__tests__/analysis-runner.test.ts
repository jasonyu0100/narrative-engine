import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  worldKnowledge: { nodes: {}, edges: [] },
  relationships: [],
  artifacts: {},
  rules: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(reverseEngineerScenePlan).mockResolvedValue({
    plan: { beats: [{ fn: 'advance', mechanism: 'action', what: 'Test beat', propositions: [] }] },
    beatProseMap: { chunks: [], createdAt: Date.now() },
  });

  vi.mocked(extractSceneStructure).mockResolvedValue({
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
  });

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AnalysisRunner — Scene-first Pipeline', () => {
  it('completes the full pipeline: plans → structure → arcs → reconcile → finalize → assemble', async () => {
    const job = createMockJob();
    const dispatched: any[] = [];
    const dispatch = (action: any) => dispatched.push(action);

    await analysisRunner.start(job, dispatch);

    // Phase 1: Plans — reverseEngineerScenePlan called per scene
    expect(reverseEngineerScenePlan).toHaveBeenCalledTimes(2);

    // Phase 2: Structure — extractSceneStructure called per scene
    expect(extractSceneStructure).toHaveBeenCalledTimes(2);

    // Phase 3: Arcs
    expect(groupScenesIntoArcs).toHaveBeenCalledTimes(1);

    // Phase 4: Reconciliation
    expect(reconcileResults).toHaveBeenCalledTimes(1);

    // Phase 5: Finalization (skipped if < 2 threads, but still reaches assembly)

    // Phase 6: Assembly
    expect(assembleNarrative).toHaveBeenCalledTimes(1);

    // Final status
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

  it('skips scenes that already have plans', async () => {
    const job = createMockJob({
      results: [
        {
          chapterSummary: 'Already done',
          characters: [],
          locations: [],
          threads: [],
          scenes: [{
            locationName: 'Castle',
            povName: 'Alice',
            participantNames: ['Alice'],
            events: ['event'],
            summary: 'Existing summary',
            sections: [],
            prose: 'Existing prose',
            plan: { beats: [{ fn: 'advance', mechanism: 'action', what: 'existing', propositions: [] }] },
            threadMutations: [],
            continuityMutations: [],
            relationshipMutations: [],
          }],
          relationships: [],
        },
        null,
      ],
    });

    await analysisRunner.start(job, () => {});

    // Only scene 2 needs plan extraction
    expect(reverseEngineerScenePlan).toHaveBeenCalledTimes(1);
  });

  it('handles plan extraction failure gracefully', async () => {
    vi.mocked(reverseEngineerScenePlan).mockRejectedValue(new Error('LLM failed'));

    const job = createMockJob();
    const dispatched: any[] = [];
    await analysisRunner.start(job, (action) => dispatched.push(action));

    // Pipeline continues despite plan failures — structure phase runs with whatever succeeded
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
  });

  it('handles structure extraction failure gracefully', async () => {
    vi.mocked(extractSceneStructure).mockRejectedValue(new Error('LLM failed'));

    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    // Pipeline continues — assembly still runs
    expect(assembleNarrative).toHaveBeenCalledTimes(1);
  });

  it('passes structure results to reconciliation', async () => {
    const job = createMockJob();
    await analysisRunner.start(job, () => {});

    const reconciledInput = vi.mocked(reconcileResults).mock.calls[0][0];
    expect(reconciledInput.length).toBe(2);
    // Structure phase populates chapterSummary
    expect(reconciledInput[0].chapterSummary).toBe('Alice explores the castle.');
  });

  it('cancellation pauses the job', async () => {
    // Make plan extraction slow
    vi.mocked(reverseEngineerScenePlan).mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 100))
    );

    const job = createMockJob({ chunks: Array.from({ length: 10 }, (_, i) => ({ index: i, text: `Scene ${i}`, sectionCount: 12 })), results: Array(10).fill(null) });
    const dispatched: any[] = [];

    const promise = analysisRunner.start(job, (action) => dispatched.push(action));

    // Cancel after a short delay
    await new Promise(resolve => setTimeout(resolve, 20));
    analysisRunner.pause(job.id);

    await promise;

    const statusUpdates = dispatched.filter(a => a.type === 'UPDATE_ANALYSIS_JOB').map(a => a.updates);
    expect(statusUpdates.some(u => u.status === 'paused')).toBe(true);
  });
});
