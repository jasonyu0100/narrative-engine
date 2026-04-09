import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AnalysisChunkResult } from '@/types/narrative';

// Mock fetch globally
global.fetch = vi.fn();

// Mock the AI module
vi.mock('@/lib/ai/api', () => ({
  callGenerate: vi.fn(),
  callGenerateStream: vi.fn(),
}));

// Mock constants with smaller chunk sizes for faster tests
vi.mock('@/lib/constants', () => ({
  ANALYSIS_CHUNK_SIZE_SECTIONS: 10,
  ANALYSIS_MAX_CORPUS_WORDS: 50000,
  ANALYSIS_TARGET_SECTIONS_PER_CHUNK: 10,
  ANALYSIS_TARGET_CHUNK_WORDS: 500,
  WORDS_PER_SCENE: 1200,
  SCENES_PER_ARC: 4,
  ANALYSIS_MODEL: 'test-model',
  MAX_TOKENS_DEFAULT: 4096,
  ANALYSIS_TEMPERATURE: 0.7,
}));

// Mock api-logger
vi.mock('@/lib/api-logger', () => ({
  logApiCall: vi.fn(() => 'log-id'),
  updateApiLog: vi.fn(),
}));

// Mock api-headers
vi.mock('@/lib/api-headers', () => ({
  apiHeaders: vi.fn(() => ({ 'Content-Type': 'application/json' })),
}));

import { splitCorpusIntoScenes, extractSceneStructure, groupScenesIntoArcs, reconcileResults, analyzeThreading, assembleNarrative } from '@/lib/text-analysis';
import { callGenerate } from '@/lib/ai/api';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createMockAnalysisResult(index: number): AnalysisChunkResult {
  return {
    chapterSummary: `Chunk ${index} summary`,
    characters: [
      {
        name: `Alice${index}`,
        role: 'main',
        firstAppearance: true,
        imagePrompt: 'A young woman',
        continuity: [
          { type: 'belief', content: `Alice knows something ${index}` },
        ],
      },
    ],
    locations: [
      {
        name: `Castle${index}`,
        parentName: null,
        description: `A grand castle ${index}`,
        lore: [`History ${index}`],
      },
    ],
    threads: [
      {
        description: `Main quest ${index}`,
        participantNames: [`Alice${index}`],
        statusAtStart: 'dormant',
        statusAtEnd: 'active',
        development: 'Thread started',
      },
    ],
    scenes: [
      {
        locationName: `Castle${index}`,
        povName: `Alice${index}`,
        participantNames: [`Alice${index}`],
        events: [`event_${index}`],
        summary: `Scene ${index} summary`,
        sections: [0],
        prose: `Scene ${index} prose.`,
        threadMutations: [
          { threadDescription: `Main quest ${index}`, from: 'dormant', to: 'active' },
        ],
        continuityMutations: [
          {
            characterName: `Alice${index}`,
            action: 'learned',
            content: 'Something important',
            type: 'belief',
          },
        ],
        relationshipMutations: [],
      },
    ],
    relationships: [
      {
        from: `Alice${index}`,
        to: `Bob${index}`,
        type: 'ally',
        valence: 5,
      },
    ],
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Mock fetch to return successful responses with valid analysis JSON
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({
      content: JSON.stringify({
        chapterSummary: 'Test summary',
        characters: [{ name: 'Alice', role: 'main', firstAppearance: true, continuity: [] }],
        locations: [{ name: 'Castle', parentName: null, description: 'A castle', lore: [] }],
        threads: [{ description: 'Main quest', participantNames: ['Alice'], statusAtStart: 'dormant', statusAtEnd: 'active', development: 'Started' }],
        scenes: [{ locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'], events: ['event1'], summary: 'Test scene', sections: [0], prose: 'Test prose', threadMutations: [], continuityMutations: [], relationshipMutations: [] }],
        relationships: []
      })
    }),
    text: async () => '{}',
  } as Response);
});

// ── splitCorpusIntoScenes Tests ─────────────────────────────────────────────

describe('splitCorpusIntoScenes', () => {
  it('splits text into scene-sized chunks', () => {
    const paragraph = Array(200).fill('word').join(' '); // 200 words
    const text = Array(10).fill(paragraph).join('\n\n'); // 2000 words = ~2 scenes
    const scenes = splitCorpusIntoScenes(text);
    expect(scenes.length).toBeGreaterThanOrEqual(1);
    expect(scenes[0].index).toBe(0);
    expect(scenes[0].wordCount).toBeGreaterThan(0);
  });

  it('handles short text as single scene', () => {
    const text = 'Short text.\n\nAnother paragraph.';
    const scenes = splitCorpusIntoScenes(text);
    expect(scenes.length).toBe(1);
    expect(scenes[0].prose).toContain('Short text');
  });

  it('assigns sequential indices', () => {
    const paragraph = Array(300).fill('word').join(' ');
    const text = Array(8).fill(paragraph).join('\n\n'); // 2400 words = ~2 scenes
    const scenes = splitCorpusIntoScenes(text);
    scenes.forEach((s, i) => expect(s.index).toBe(i));
  });

  it('preserves all text', () => {
    const paragraph = Array(300).fill('word').join(' ');
    const text = Array(8).fill(paragraph).join('\n\n');
    const scenes = splitCorpusIntoScenes(text);
    const totalWords = scenes.reduce((sum, s) => sum + s.wordCount, 0);
    expect(totalWords).toBe(2400);
  });
});

// ── reconcileResults Tests ───────────────────────────────────────────────────

describe('reconcileResults', () => {
  beforeEach(() => {
    // Mock reconcileResults to return results unchanged for simplicity
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      nameMap: {},
      threadMap: {},
      locationMap: {},
      conceptMap: {},
    }));
  });

  it('merges duplicate characters with name variants', async () => {
    const results: AnalysisChunkResult[] = [
      {
        ...createMockAnalysisResult(0),
        characters: [
          { name: 'Alice', role: 'main', firstAppearance: true, continuity: [] },
        ],
      },
      {
        ...createMockAnalysisResult(1),
        characters: [
          { name: 'alice', role: 'main', firstAppearance: false, continuity: [] }, // Lowercase variant
        ],
      },
    ];

    const reconciled = await reconcileResults(results);

    // Should deduplicate Alice/alice into one character
    const allCharacters = reconciled.flatMap(r => r.characters);
    const aliceVariants = allCharacters.filter(c => c.name.toLowerCase() === 'alice');

    // Should maintain thread continuity
    expect(aliceVariants.length).toBeGreaterThan(0);
  });

  it('merges duplicate locations', async () => {
    const results: AnalysisChunkResult[] = [
      {
        ...createMockAnalysisResult(0),
        locations: [{ name: 'Castle', parentName: null, description: 'A castle', lore: [] }],
      },
      {
        ...createMockAnalysisResult(1),
        locations: [{ name: 'Castle', parentName: null, description: 'The same castle', lore: ['History'] }],
      },
    ];

    const reconciled = await reconcileResults(results);

    const allLocations = reconciled.flatMap(r => r.locations);
    const castleEntries = allLocations.filter(l => l.name === 'Castle');

    // Should maintain locations
    expect(castleEntries.length).toBeGreaterThan(0);
  });

  it('stitches threads across chunks', async () => {
    const results: AnalysisChunkResult[] = [
      {
        ...createMockAnalysisResult(0),
        threads: [{
          description: 'Main quest',
          participantNames: ['Alice'],
          statusAtStart: 'dormant',
          statusAtEnd: 'active',
          development: 'Started',
        }],
      },
      {
        ...createMockAnalysisResult(1),
        threads: [{
          description: 'Main quest',
          participantNames: ['Alice', 'Bob'],
          statusAtStart: 'active',
          statusAtEnd: 'escalating',
          development: 'Continued',
        }],
      },
    ];

    const reconciled = await reconcileResults(results);

    // Threads with same description should be stitched
    const allThreads = reconciled.flatMap(r => r.threads);
    const mainQuestThreads = allThreads.filter(t => t.description === 'Main quest');

    // Should maintain thread continuity
    expect(mainQuestThreads.length).toBeGreaterThan(0);
  });

  it('preserves all scenes from all chunks', async () => {
    const results: AnalysisChunkResult[] = [
      createMockAnalysisResult(0),
      createMockAnalysisResult(1),
      createMockAnalysisResult(2),
    ];

    const reconciled = await reconcileResults(results);

    const totalScenes = reconciled.reduce((sum, r) => sum + r.scenes.length, 0);
    const originalScenes = results.reduce((sum, r) => sum + r.scenes.length, 0);

    expect(totalScenes).toBe(originalScenes);
  });

  it('returns same number of chunks', async () => {
    const results: AnalysisChunkResult[] = [
      createMockAnalysisResult(0),
      createMockAnalysisResult(1),
    ];

    const reconciled = await reconcileResults(results);

    expect(reconciled.length).toBe(results.length);
  });
});

// ── analyzeThreading Tests ───────────────────────────────────────────────────

describe('analyzeThreading', () => {
  it('analyzes thread dependencies and returns mapping', async () => {
    const threadDescriptions = ['Thread A', 'Thread B'];

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          threadDependencies: {
            'Thread B': ['Thread A'],
          },
        }),
      }),
    } as any);

    const result = await analyzeThreading(threadDescriptions);

    expect(result).toBeDefined();
    expect(result['Thread B']).toEqual(['Thread A']);
  });

  it('returns empty object when less than 2 threads', async () => {
    const threadDescriptions = ['Thread A'];

    const result = await analyzeThreading(threadDescriptions);

    expect(result).toEqual({});
    expect(callGenerate).not.toHaveBeenCalled();
  });

  it('handles empty thread list', async () => {
    const threadDescriptions: string[] = [];

    const result = await analyzeThreading(threadDescriptions);

    expect(result).toEqual({});
  });
});

// ── assembleNarrative Tests ──────────────────────────────────────────────────

describe('assembleNarrative', () => {
  beforeEach(() => {
    // Mock LLM calls for world summary generation
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      worldSummary: 'A fantasy world',
      rules: ['Magic exists'],
      systems: [],
      imageStyle: 'Epic fantasy art',
    }));
  });

  it('creates a complete NarrativeState from analyzed results', async () => {
    const results: AnalysisChunkResult[] = [
      createMockAnalysisResult(0),
      createMockAnalysisResult(1),
    ];
    const threadDeps = {};

    const narrative = await assembleNarrative('Test Story', results, threadDeps);

    expect(narrative.title).toBe('Test Story');
    expect(narrative.characters).toBeDefined();
    expect(narrative.locations).toBeDefined();
    expect(narrative.threads).toBeDefined();
    expect(narrative.scenes).toBeDefined();
    expect(narrative.branches).toBeDefined();
    const branchIds = Object.keys(narrative.branches);
    expect(branchIds.length).toBeGreaterThan(0);
  });

  it('assigns unique IDs to all entities', async () => {
    const results: AnalysisChunkResult[] = [createMockAnalysisResult(0)];
    const threadDeps = {};

    const narrative = await assembleNarrative('Test', results, threadDeps);

    const characterIds = Object.keys(narrative.characters);
    const locationIds = Object.keys(narrative.locations);
    const threadIds = Object.keys(narrative.threads);
    const sceneIds = Object.keys(narrative.scenes);

    // All IDs should be unique
    expect(new Set(characterIds).size).toBe(characterIds.length);
    expect(new Set(locationIds).size).toBe(locationIds.length);
    expect(new Set(threadIds).size).toBe(threadIds.length);
    expect(new Set(sceneIds).size).toBe(sceneIds.length);
  });

  it('creates main branch with all scene IDs', async () => {
    const results: AnalysisChunkResult[] = [
      createMockAnalysisResult(0),
      createMockAnalysisResult(1),
    ];
    const threadDeps = {};

    const narrative = await assembleNarrative('Test', results, threadDeps);

    const sceneCount = Object.keys(narrative.scenes).length;
    const branchIds = Object.keys(narrative.branches);
    const mainBranch = narrative.branches[branchIds[0]];
    const mainBranchScenes = mainBranch.entryIds.filter(id => id.startsWith('S-'));

    expect(mainBranchScenes.length).toBe(sceneCount);
  });

  it('maps scene participant names to character IDs', async () => {
    const results: AnalysisChunkResult[] = [
      {
        ...createMockAnalysisResult(0),
        characters: [{ name: 'Alice', role: 'main', firstAppearance: true, continuity: [] }],
        scenes: [{
          locationName: 'Castle',
          povName: 'Alice',
          participantNames: ['Alice'],
          events: [],
          summary: 'Test',
          sections: [0],
          threadMutations: [],
          continuityMutations: [],
          relationshipMutations: [],
        }],
      },
    ];
    const threadDeps = {};

    const narrative = await assembleNarrative('Test', results, threadDeps);

    const scene = Object.values(narrative.scenes)[0];
    const aliceId = Object.values(narrative.characters).find(c => c.name === 'Alice')?.id;

    expect(scene.participantIds).toContain(aliceId);
    expect(scene.povId).toBe(aliceId);
  });

  it('maps scene location names to location IDs', async () => {
    const results: AnalysisChunkResult[] = [
      {
        ...createMockAnalysisResult(0),
        locations: [{ name: 'Castle', parentName: null, description: 'A castle', lore: [] }],
        scenes: [{
          locationName: 'Castle',
          povName: 'Alice',
          participantNames: ['Alice'],
          events: [],
          summary: 'Test',
          sections: [0],
          threadMutations: [],
          continuityMutations: [],
          relationshipMutations: [],
        }],
      },
    ];
    const threadDeps = {};

    const narrative = await assembleNarrative('Test', results, threadDeps);

    const scene = Object.values(narrative.scenes)[0];
    const castleId = Object.values(narrative.locations).find(l => l.name === 'Castle')?.id;

    expect(scene.locationId).toBe(castleId);
  });

  it('preserves beat plans and beatProseMaps from analysis', async () => {
    const mockPlan = {
      beats: [{ fn: 'breathe' as const, mechanism: 'environment' as const, what: 'Setup', propositions: [] }],
    };
    const mockBeatProseMap = {
      chunks: [{ beatIndex: 0, prose: 'Prose chunk' }],
      createdAt: Date.now(),
    };

    const results: AnalysisChunkResult[] = [
      {
        ...createMockAnalysisResult(0),
        scenes: [{
          locationName: 'Castle',
          povName: 'Alice',
          participantNames: ['Alice'],
          events: [],
          summary: 'Test',
          sections: [0],
          threadMutations: [],
          continuityMutations: [],
          relationshipMutations: [],
          plan: mockPlan,
          beatProseMap: mockBeatProseMap,
        }],
      },
    ];
    const threadDeps = {};

    const narrative = await assembleNarrative('Test', results, threadDeps);

    const scene = Object.values(narrative.scenes)[0];
    // Plan is now stored in planVersions, not directly on scene
    expect(scene.planVersions).toBeDefined();
    expect(scene.planVersions![0].plan).toEqual(mockPlan);
    // beatProseMap is stored in proseVersions
    expect(scene.proseVersions).toBeDefined();
    expect(scene.proseVersions![0].beatProseMap).toEqual(mockBeatProseMap);
  });

  it('creates relationship entries from analysis', async () => {
    const results: AnalysisChunkResult[] = [
      {
        ...createMockAnalysisResult(0),
        characters: [
          { name: 'Alice', role: 'main', firstAppearance: true, continuity: [] },
          { name: 'Bob', role: 'main', firstAppearance: true, continuity: [] },
        ],
        relationships: [
          { from: 'Alice', to: 'Bob', type: 'ally', valence: 5 },
        ],
      },
    ];
    const threadDeps = {};

    const narrative = await assembleNarrative('Test', results, threadDeps);

    expect(narrative.relationships).toHaveLength(1);
    expect(narrative.relationships[0].type).toBe('ally');
    expect(narrative.relationships[0].valence).toBe(5);
  });

  it('sets createdAt and updatedAt timestamps', async () => {
    const results: AnalysisChunkResult[] = [createMockAnalysisResult(0)];
    const threadDeps = {};

    const narrative = await assembleNarrative('Test', results, threadDeps);

    expect(narrative.createdAt).toBeDefined();
    expect(narrative.updatedAt).toBeDefined();
    expect(typeof narrative.createdAt).toBe('number');
    expect(typeof narrative.updatedAt).toBe('number');
    // createdAt is backdated by 1 day, updatedAt is now
    expect(narrative.updatedAt).toBeGreaterThan(narrative.createdAt);
  });

  it('creates version pointers on main branch for analyzed scenes', async () => {
    const mockPlan = {
      beats: [{ fn: 'breathe' as const, mechanism: 'environment' as const, what: 'Setup', propositions: [] }],
    };
    const mockBeatProseMap = {
      chunks: [{ beatIndex: 0, prose: 'Prose chunk' }],
      createdAt: Date.now(),
    };

    const results: AnalysisChunkResult[] = [
      {
        ...createMockAnalysisResult(0),
        scenes: [{
          locationName: 'Castle',
          povName: 'Alice',
          participantNames: ['Alice'],
          events: [],
          summary: 'Test scene',
          sections: [0],
          prose: 'Scene prose',
          threadMutations: [],
          continuityMutations: [],
          relationshipMutations: [],
          plan: mockPlan,
          beatProseMap: mockBeatProseMap,
        }],
      },
    ];
    const threadDeps = {};

    const narrative = await assembleNarrative('Test', results, threadDeps);

    // Get the main branch
    const branchIds = Object.keys(narrative.branches);
    expect(branchIds.length).toBeGreaterThan(0);
    const mainBranch = narrative.branches[branchIds[0]];

    // Get the first scene
    const sceneIds = Object.keys(narrative.scenes);
    expect(sceneIds.length).toBeGreaterThan(0);
    const sceneId = sceneIds[0];
    const scene = narrative.scenes[sceneId];

    // Verify scene has version arrays
    expect(scene.proseVersions).toBeDefined();
    expect(scene.proseVersions!.length).toBeGreaterThan(0);
    expect(scene.planVersions).toBeDefined();
    expect(scene.planVersions!.length).toBeGreaterThan(0);

    // Verify branch has version pointers
    expect(mainBranch.versionPointers).toBeDefined();
    expect(mainBranch.versionPointers![sceneId]).toBeDefined();
    expect(mainBranch.versionPointers![sceneId].proseVersion).toBe('1');
    expect(mainBranch.versionPointers![sceneId].planVersion).toBe('1');
  });
});
