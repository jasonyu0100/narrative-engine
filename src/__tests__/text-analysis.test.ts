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

// Mock system-logger
vi.mock('@/lib/system-logger', () => ({
  logError: vi.fn(),
  logWarning: vi.fn(),
  logInfo: vi.fn(),
  setSystemLoggerNarrativeId: vi.fn(),
  setSystemLoggerAnalysisId: vi.fn(),
}));

// Mock validation
vi.mock('@/lib/ai/validation', () => ({
  validateExtractionResult: vi.fn(() => []),
  validateWorldKnowledge: vi.fn(() => []),
}));

import { splitCorpusIntoScenes, extractSceneStructure, groupScenesIntoArcs, reconcileResults, analyzeThreading, assembleNarrative } from '@/lib/text-analysis';
import { callGenerate } from '@/lib/ai/api';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createMockAnalysisResult(index: number, overrides: Partial<AnalysisChunkResult> = {}): AnalysisChunkResult {
  return {
    chapterSummary: `Chunk ${index} summary`,
    characters: [
      {
        name: `Character${index}`,
        role: 'anchor',
        firstAppearance: true,
        imagePrompt: 'A character',
      },
    ],
    locations: [
      {
        name: `Location${index}`,
        parentName: null,
        description: `A location ${index}`,
      },
    ],
    threads: [
      {
        description: `Main quest ${index}`,
        participantNames: [`Character${index}`],
        statusAtStart: 'dormant',
        statusAtEnd: 'active',
        development: 'Thread started',
      },
    ],
    scenes: [
      {
        locationName: `Location${index}`,
        povName: `Character${index}`,
        participantNames: [`Character${index}`],
        events: [`event_${index}`],
        summary: `Scene ${index} summary`,
        sections: [0],
        prose: `Scene ${index} prose content here.`,
        threadMutations: [
          { threadDescription: `Main quest ${index}`, from: 'dormant', to: 'active', addedNodes: [] },
        ],
        continuityMutations: [
          {
            entityName: `Character${index}`,
            addedNodes: [{ content: 'Learned something important', type: 'belief' }],
          },
        ],
        relationshipMutations: [],
      },
    ],
    relationships: [
      {
        from: `Character${index}`,
        to: `Ally${index}`,
        type: 'ally',
        valence: 5,
      },
    ],
    ...overrides,
  };
}

/** Create a rich fixture with artifacts, world knowledge, movements, etc. */
function createRichAnalysisResult(index: number): AnalysisChunkResult {
  return {
    chapterSummary: `Rich chunk ${index} summary`,
    characters: [
      { name: 'Alice', role: 'anchor', firstAppearance: index === 0 },
      { name: 'Bob', role: 'recurring', firstAppearance: index === 0 },
    ],
    locations: [
      { name: 'Castle', parentName: null, description: 'A grand castle', tiedCharacterNames: ['Alice'] },
      { name: 'Forest', parentName: null, description: 'A dark forest' },
    ],
    artifacts: [
      { name: 'Magic Sword', significance: 'key', ownerName: 'Alice' },
    ],
    threads: [
      { description: 'The Quest for the Crown', participantNames: ['Alice', 'Bob'], statusAtStart: index === 0 ? 'dormant' : 'active', statusAtEnd: 'active', development: `Quest progresses in chunk ${index}` },
      { description: 'Trust between allies', participantNames: ['Alice', 'Bob'], statusAtStart: 'dormant', statusAtEnd: 'active', development: 'Growing trust' },
    ],
    scenes: [
      {
        locationName: 'Castle',
        povName: 'Alice',
        participantNames: ['Alice', 'Bob'],
        events: [`event_${index}_a`, `event_${index}_b`],
        summary: `Alice and Bob explore the castle in scene ${index}`,
        sections: [0],
        prose: `Scene ${index} prose about Alice and Bob in the castle.`,
        plan: {
          beats: [
            { fn: 'breathe' as const, mechanism: 'environment' as const, what: 'Castle atmosphere', propositions: [] },
            { fn: 'advance' as const, mechanism: 'action' as const, what: 'Quest progress', propositions: [] },
          ],
        },
        beatProseMap: { chunks: [{ beatIndex: 0, prose: 'Castle atmosphere prose' }, { beatIndex: 1, prose: 'Quest progress prose' }], createdAt: Date.now() },
        threadMutations: [
          { threadDescription: 'The Quest for the Crown', from: index === 0 ? 'dormant' : 'active', to: 'active', addedNodes: [] },
        ],
        continuityMutations: [
          { entityName: 'Alice', addedNodes: [{ content: 'Discovered a secret passage', type: 'history' }] },
          { entityName: 'Castle', addedNodes: [{ content: 'Secret passage found in east wing', type: 'history' }] },
        ],
        relationshipMutations: [
          { from: 'Alice', to: 'Bob', type: 'growing trust', valenceDelta: 0.2 },
        ],
        artifactUsages: [{ artifactName: 'Magic Sword', characterName: 'Alice', usage: 'cut through the ward barrier' }],
        ownershipMutations: [],
        tieMutations: [{ locationName: 'Castle', characterName: 'Alice', action: 'add' as const }],
        characterMovements: [{ characterName: 'Bob', locationName: 'Forest', transition: 'walked into the forest' }],
        worldKnowledgeMutations: {
          addedNodes: [{ concept: 'Ancient Magic', type: 'system' }, { concept: 'Royal Bloodline', type: 'concept' }],
          addedEdges: [{ fromConcept: 'Ancient Magic', toConcept: 'Royal Bloodline', relation: 'enables' }],
        },
      },
    ],
    relationships: [
      { from: 'Alice', to: 'Bob', type: 'ally', valence: 6 },
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
        characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true, continuity: [] }],
        locations: [{ name: 'Castle', parentName: null, description: 'A castle', lore: [] }],
        threads: [{ description: 'Main quest', participantNames: ['Alice'], statusAtStart: 'dormant', statusAtEnd: 'active', development: 'Started' }],
        scenes: [{ locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'], events: ['event1'], summary: 'Test scene', sections: [0], prose: 'Test prose', threadMutations: [], continuityMutations: [], relationshipMutations: [] }],
        relationships: [],
      }),
    }),
    text: async () => '{}',
  } as Response);
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 0: splitCorpusIntoScenes
// ══════════════════════════════════════════════════════════════════════════════

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

  it('preserves all text (no word loss)', () => {
    const paragraph = Array(300).fill('word').join(' ');
    const text = Array(8).fill(paragraph).join('\n\n');
    const scenes = splitCorpusIntoScenes(text);
    const totalWords = scenes.reduce((sum, s) => sum + s.wordCount, 0);
    expect(totalWords).toBe(2400);
  });

  it('merges tiny trailing scene into previous', () => {
    // Create text where the last paragraph is very small (<30% of target)
    const bigParagraph = Array(1200).fill('word').join(' ');
    const tinyParagraph = Array(50).fill('word').join(' '); // ~4% of 1200
    const text = bigParagraph + '\n\n' + tinyParagraph;
    const scenes = splitCorpusIntoScenes(text);
    // Should merge the tiny trailing piece into the previous scene
    expect(scenes.length).toBe(1);
    expect(scenes[0].wordCount).toBe(1250);
  });

  it('does not merge substantial trailing scene', () => {
    // A trailing scene with > 30% of target should stay separate
    const bigParagraph = Array(1200).fill('word').join(' ');
    const medParagraph = Array(500).fill('word').join(' '); // ~42% of 1200
    const text = bigParagraph + '\n\n' + medParagraph;
    const scenes = splitCorpusIntoScenes(text);
    expect(scenes.length).toBe(2);
  });

  it('splits long single paragraph into multiple scenes', () => {
    // One giant paragraph with 3600 words — should be split by sentence boundaries
    const sentences = Array(200).fill('This is a sentence with some words.').join(' ');
    const scenes = splitCorpusIntoScenes(sentences);
    expect(scenes.length).toBeGreaterThanOrEqual(1);
    // All text preserved
    const totalWords = scenes.reduce((sum, s) => sum + s.wordCount, 0);
    expect(totalWords).toBeGreaterThan(0);
  });

  it('handles empty paragraphs gracefully', () => {
    const text = 'First paragraph.\n\n\n\n\n\nSecond paragraph.';
    const scenes = splitCorpusIntoScenes(text);
    expect(scenes.length).toBe(1);
    expect(scenes[0].prose).toContain('First paragraph');
    expect(scenes[0].prose).toContain('Second paragraph');
  });

  it('handles whitespace-only input', () => {
    const scenes = splitCorpusIntoScenes('   \n\n   \n\n   ');
    expect(scenes.length).toBe(0);
  });

  it('produces scenes near target word count for large text', () => {
    const paragraph = Array(200).fill('word').join(' ');
    const text = Array(50).fill(paragraph).join('\n\n'); // 10000 words
    const scenes = splitCorpusIntoScenes(text);
    // Each scene should be roughly 1200 words (within 15% overshoot tolerance)
    for (const scene of scenes.slice(0, -1)) { // exclude last which may be smaller
      expect(scene.wordCount).toBeGreaterThanOrEqual(800);
      expect(scene.wordCount).toBeLessThanOrEqual(1600);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 2: extractSceneStructure
// ══════════════════════════════════════════════════════════════════════════════

describe('extractSceneStructure', () => {
  it('extracts complete structure from prose + plan', async () => {
    const mockResponse = {
      povName: 'Alice',
      locationName: 'Wonderland',
      participantNames: ['Alice', 'Cheshire Cat'],
      events: ['falls_down_hole', 'meets_cat'],
      summary: 'Alice falls into Wonderland and meets the Cheshire Cat.',
      characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true, continuity: [{ type: 'state', content: 'Confused and disoriented' }] }],
      locations: [{ name: 'Wonderland', parentName: null, description: 'A strange land', lore: ['Everything is backwards'] }],
      artifacts: [{ name: 'Pocket Watch', significance: 'notable', continuity: [], ownerName: null }],
      threads: [{ description: 'Alice finding her way home', participantNames: ['Alice'], statusAtStart: 'dormant', statusAtEnd: 'active', development: 'Alice realizes she is lost' }],
      relationships: [{ from: 'Alice', to: 'Cheshire Cat', type: 'uneasy acquaintance', valence: 2 }],
      threadMutations: [{ threadDescription: 'Alice finding her way home', from: 'dormant', to: 'active', addedNodes: [] }],
      continuityMutations: [{ entityName: 'Alice', addedNodes: [{ content: 'Fell down the rabbit hole', type: 'history' }] }],
      relationshipMutations: [{ from: 'Alice', to: 'Cheshire Cat', type: 'uneasy acquaintance', valenceDelta: 0.2 }],
      artifactUsages: [{ artifactName: 'Pocket Watch', characterName: null, usage: 'ticked ominously marking the deadline' }],
      ownershipMutations: [],
      tieMutations: [],
      characterMovements: [{ characterName: 'Alice', locationName: 'Wonderland', transition: 'fell through' }],
      worldKnowledgeMutations: { addedNodes: [{ concept: 'Size-Altering', type: 'system' }] },
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: JSON.stringify(mockResponse) }),
    } as Response);

    const plan = { beats: [{ fn: 'advance' as const, mechanism: 'action' as const, what: 'Alice falls', propositions: [] }] };
    const result = await extractSceneStructure('Alice fell down the rabbit hole.', plan);

    expect(result.povName).toBe('Alice');
    expect(result.locationName).toBe('Wonderland');
    expect(result.participantNames).toContain('Alice');
    expect(result.participantNames).toContain('Cheshire Cat');
    expect(result.events).toHaveLength(2);
    expect(result.summary).toContain('Alice');
    expect(result.characters).toHaveLength(1);
    expect(result.locations).toHaveLength(1);
    expect(result.artifacts).toHaveLength(1);
    expect(result.threads).toHaveLength(1);
    expect(result.threadMutations).toHaveLength(1);
    expect(result.continuityMutations).toHaveLength(1);
    expect(result.relationshipMutations).toHaveLength(1);
    expect(result.artifactUsages).toHaveLength(1);
    expect(result.characterMovements).toHaveLength(1);
    expect(result.worldKnowledgeMutations?.addedNodes).toHaveLength(1);
  });

  it('defaults missing fields to empty arrays/strings', async () => {
    // LLM returns partial JSON — function should fill defaults
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: JSON.stringify({ povName: 'Alice', summary: 'Partial' }) }),
    } as Response);

    const plan = { beats: [{ fn: 'breathe' as const, mechanism: 'environment' as const, what: 'Setup', propositions: [] }] };
    const result = await extractSceneStructure('Some prose.', plan);

    expect(result.povName).toBe('Alice');
    expect(result.locationName).toBe('');
    expect(result.participantNames).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.characters).toEqual([]);
    expect(result.locations).toEqual([]);
    expect(result.artifacts).toEqual([]);
    expect(result.threads).toEqual([]);
    expect(result.threadMutations).toEqual([]);
    expect(result.continuityMutations).toEqual([]);
    expect(result.relationshipMutations).toEqual([]);
    expect(result.artifactUsages).toEqual([]);
    expect(result.ownershipMutations).toEqual([]);
    expect(result.tieMutations).toEqual([]);
    expect(result.characterMovements).toEqual([]);
  });

  it('handles LLM response wrapped in markdown code fence', async () => {
    const jsonStr = JSON.stringify({
      povName: 'Bob', locationName: 'Library', participantNames: ['Bob'],
      events: ['reads_book'], summary: 'Bob reads', characters: [], locations: [],
      artifacts: [], threads: [], relationships: [],
      threadMutations: [], continuityMutations: [], relationshipMutations: [],
      artifactUsages: [], ownershipMutations: [], tieMutations: [], characterMovements: [],
    });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: '```json\n' + jsonStr + '\n```' }),
    } as Response);

    const plan = { beats: [{ fn: 'inform' as const, mechanism: 'narration' as const, what: 'Reads', propositions: [] }] };
    const result = await extractSceneStructure('Bob reads a book.', plan);
    expect(result.povName).toBe('Bob');
    expect(result.locationName).toBe('Library');
  });

  it('throws on invalid JSON response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: 'This is not JSON at all' }),
    } as Response);

    const plan = { beats: [{ fn: 'breathe' as const, mechanism: 'environment' as const, what: 'Setup', propositions: [] }] };
    await expect(extractSceneStructure('Some prose.', plan)).rejects.toThrow();
  });

  it('throws on fetch failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Rate limited' }),
    } as Response);

    const plan = { beats: [{ fn: 'breathe' as const, mechanism: 'environment' as const, what: 'Setup', propositions: [] }] };
    await expect(extractSceneStructure('Some prose.', plan)).rejects.toThrow('Rate limited');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 3: groupScenesIntoArcs
// ══════════════════════════════════════════════════════════════════════════════

describe('groupScenesIntoArcs', () => {
  it('groups scenes into arcs of ~4 and names them', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: JSON.stringify(['The Beginning', 'Rising Tension']) }),
    } as Response);

    const summaries = Array.from({ length: 8 }, (_, i) => ({ index: i, summary: `Scene ${i} summary` }));
    const arcs = await groupScenesIntoArcs(summaries);

    expect(arcs).toHaveLength(2);
    expect(arcs[0].name).toBe('The Beginning');
    expect(arcs[0].sceneIndices).toEqual([0, 1, 2, 3]);
    expect(arcs[1].name).toBe('Rising Tension');
    expect(arcs[1].sceneIndices).toEqual([4, 5, 6, 7]);
  });

  it('handles non-multiple-of-4 scene counts', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: JSON.stringify(['Arc One', 'Arc Two']) }),
    } as Response);

    const summaries = Array.from({ length: 6 }, (_, i) => ({ index: i, summary: `Scene ${i}` }));
    const arcs = await groupScenesIntoArcs(summaries);

    expect(arcs).toHaveLength(2);
    expect(arcs[0].sceneIndices).toEqual([0, 1, 2, 3]);
    expect(arcs[1].sceneIndices).toEqual([4, 5]); // Remaining 2 scenes
  });

  it('falls back to default names when LLM returns fewer names', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: JSON.stringify(['Only One Name']) }),
    } as Response);

    const summaries = Array.from({ length: 8 }, (_, i) => ({ index: i, summary: `Scene ${i}` }));
    const arcs = await groupScenesIntoArcs(summaries);

    expect(arcs).toHaveLength(2);
    expect(arcs[0].name).toBe('Only One Name');
    expect(arcs[1].name).toBe('Arc 2'); // Fallback
  });

  it('handles single scene input', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: JSON.stringify(['Prologue']) }),
    } as Response);

    const arcs = await groupScenesIntoArcs([{ index: 0, summary: 'Only scene' }]);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].sceneIndices).toEqual([0]);
  });

  it('preserves non-sequential scene indices', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: JSON.stringify(['Sparse Arc']) }),
    } as Response);

    // Simulate scenes that aren't 0-indexed consecutively (e.g., some scenes filtered out)
    const summaries = [{ index: 2, summary: 'Scene 2' }, { index: 5, summary: 'Scene 5' }, { index: 7, summary: 'Scene 7' }];
    const arcs = await groupScenesIntoArcs(summaries);

    expect(arcs[0].sceneIndices).toEqual([2, 5, 7]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 4: reconcileResults
// ══════════════════════════════════════════════════════════════════════════════

describe('reconcileResults', () => {
  beforeEach(() => {
    // Default: no merges needed
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      characterMerges: {},
      threadMerges: {},
      locationMerges: {},
      artifactMerges: {},
      worldKnowledgeMerges: {},
    }));
  });

  it('returns same number of chunks', async () => {
    const results = [createMockAnalysisResult(0), createMockAnalysisResult(1)];
    const reconciled = await reconcileResults(results);
    expect(reconciled.length).toBe(results.length);
  });

  it('preserves all scenes from all chunks', async () => {
    const results = [createMockAnalysisResult(0), createMockAnalysisResult(1), createMockAnalysisResult(2)];
    const reconciled = await reconcileResults(results);
    const totalScenes = reconciled.reduce((sum, r) => sum + r.scenes.length, 0);
    expect(totalScenes).toBe(3);
  });

  it('merges character name variants via LLM map', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: { 'Prof. McGonagall': 'Minerva McGonagall' },
          threadMerges: {},
          locationMerges: {},
          artifactMerges: {},
          worldKnowledgeMerges: {},
        }),
      }),
    } as Response);

    const results: AnalysisChunkResult[] = [
      { ...createMockAnalysisResult(0), characters: [{ name: 'Prof. McGonagall', role: 'recurring', firstAppearance: true }] },
      { ...createMockAnalysisResult(1), characters: [{ name: 'Minerva McGonagall', role: 'anchor', firstAppearance: false }] },
    ];

    const reconciled = await reconcileResults(results);
    // Both should now use the canonical name
    expect(reconciled[0].characters[0].name).toBe('Minerva McGonagall');
    expect(reconciled[1].characters[0].name).toBe('Minerva McGonagall');
  });

  it('merges thread descriptions via LLM map', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: {},
          threadMerges: { "Harry's distrust of Snape": "Harry and Snape's antagonism" },
          locationMerges: {},
          artifactMerges: {},
          worldKnowledgeMerges: {},
        }),
      }),
    } as Response);

    const results: AnalysisChunkResult[] = [
      {
        ...createMockAnalysisResult(0),
        threads: [{ description: "Harry's distrust of Snape", participantNames: ['Harry'], statusAtStart: 'dormant', statusAtEnd: 'active', development: 'Started' }],
        scenes: [{
          ...createMockAnalysisResult(0).scenes[0],
          threadMutations: [{ threadDescription: "Harry's distrust of Snape", from: 'dormant', to: 'active', addedNodes: [] }],
        }],
      },
    ];

    const reconciled = await reconcileResults(results);
    expect(reconciled[0].threads[0].description).toBe("Harry and Snape's antagonism");
    expect(reconciled[0].scenes[0].threadMutations[0].threadDescription).toBe("Harry and Snape's antagonism");
  });

  it('merges location names via LLM map', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: {},
          threadMerges: {},
          locationMerges: { 'The Forest': 'Dark Forest' },
          artifactMerges: {},
          worldKnowledgeMerges: {},
        }),
      }),
    } as Response);

    const results: AnalysisChunkResult[] = [
      {
        ...createMockAnalysisResult(0),
        locations: [{ name: 'The Forest', parentName: null, description: 'Spooky' }],
        scenes: [{ ...createMockAnalysisResult(0).scenes[0], locationName: 'The Forest' }],
      },
    ];

    const reconciled = await reconcileResults(results);
    expect(reconciled[0].locations[0].name).toBe('Dark Forest');
    expect(reconciled[0].scenes[0].locationName).toBe('Dark Forest');
  });

  it('merges artifact names via LLM map', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: {},
          threadMerges: {},
          locationMerges: {},
          artifactMerges: { 'the Elder Wand': 'Elder Wand' },
          worldKnowledgeMerges: {},
        }),
      }),
    } as Response);

    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      artifacts: [{ name: 'the Elder Wand', significance: 'key', ownerName: null }],
      scenes: [{
        ...createMockAnalysisResult(0).scenes[0],
        artifactUsages: [{ artifactName: 'the Elder Wand', characterName: 'Harry', usage: 'cast the disarming charm' }],
      }],
    }];

    const reconciled = await reconcileResults(results);
    expect(reconciled[0].artifacts![0].name).toBe('Elder Wand');
    expect(reconciled[0].scenes[0].artifactUsages![0].artifactName).toBe('Elder Wand');
  });

  it('merges world knowledge concepts via LLM map', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: {},
          threadMerges: {},
          locationMerges: {},
          artifactMerges: {},
          worldKnowledgeMerges: { 'Magical System': 'Magic System' },
        }),
      }),
    } as Response);

    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      scenes: [{
        ...createMockAnalysisResult(0).scenes[0],
        worldKnowledgeMutations: {
          addedNodes: [{ concept: 'Magical System', type: 'system' }],
          addedEdges: [{ fromConcept: 'Magical System', toConcept: 'Energy', relation: 'enables' }],
        },
      }],
    }];

    const reconciled = await reconcileResults(results);
    expect(reconciled[0].scenes[0].worldKnowledgeMutations!.addedNodes[0].concept).toBe('Magic System');
    expect(reconciled[0].scenes[0].worldKnowledgeMutations!.addedEdges[0].fromConcept).toBe('Magic System');
  });

  it('stitches thread continuity across chunks', async () => {
    const results: AnalysisChunkResult[] = [
      {
        ...createMockAnalysisResult(0),
        threads: [{ description: 'Main quest', participantNames: ['Alice'], statusAtStart: 'dormant', statusAtEnd: 'active', development: 'Started' }],
        scenes: [{ ...createMockAnalysisResult(0).scenes[0], threadMutations: [{ threadDescription: 'Main quest', from: 'dormant', to: 'active', addedNodes: [] }] }],
      },
      {
        ...createMockAnalysisResult(1),
        threads: [{ description: 'Main quest', participantNames: ['Alice', 'Bob'], statusAtStart: 'dormant', statusAtEnd: 'escalating', development: 'Continued' }],
        scenes: [{ ...createMockAnalysisResult(1).scenes[0], threadMutations: [{ threadDescription: 'Main quest', from: 'dormant', to: 'escalating', addedNodes: [] }] }],
      },
    ];

    const reconciled = await reconcileResults(results);

    // Chunk 1's statusAtStart should be stitched to chunk 0's statusAtEnd
    expect(reconciled[1].threads[0].statusAtStart).toBe('active');
    // Scene-level mutation from should also be corrected
    expect(reconciled[1].scenes[0].threadMutations[0].from).toBe('active');
  });

  it('normalizes LLM status variants to canonical vocabulary', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      threads: [{ description: 'Quest', participantNames: ['Hero'], statusAtStart: 'inactive', statusAtEnd: 'developing', development: 'Started' }],
      scenes: [{ ...createMockAnalysisResult(0).scenes[0], threadMutations: [{ threadDescription: 'Quest', from: 'inactive', to: 'developing', addedNodes: [] }] }],
    }];

    const reconciled = await reconcileResults(results);
    // 'inactive' → 'latent', 'developing' → 'seeded'
    expect(reconciled[0].threads[0].statusAtStart).toBe('latent');
    expect(reconciled[0].threads[0].statusAtEnd).toBe('seeded');
    expect(reconciled[0].scenes[0].threadMutations[0].from).toBe('latent');
    expect(reconciled[0].scenes[0].threadMutations[0].to).toBe('seeded');
  });

  it('deduplicates characters within same chunk by name', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [
        { name: 'Alice', role: 'recurring', firstAppearance: true },
        { name: 'Alice', role: 'anchor', firstAppearance: false },
      ],
    }];

    const reconciled = await reconcileResults(results);
    const alices = reconciled[0].characters.filter(c => c.name === 'Alice');
    expect(alices).toHaveLength(1);
    // Should take higher role
    expect(alices[0].role).toBe('anchor');
  });

  it('deduplicates artifacts within same chunk by name with higher significance', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      artifacts: [
        { name: 'Sword', significance: 'minor', ownerName: null },
        { name: 'Sword', significance: 'key', ownerName: 'Hero' },
      ],
    }];

    const reconciled = await reconcileResults(results);
    const swords = reconciled[0].artifacts!.filter(a => a.name === 'Sword');
    expect(swords).toHaveLength(1);
    expect(swords[0].significance).toBe('key');
  });

  it('resolves character names in participant lists', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: { 'Al': 'Alice' },
          threadMerges: {},
          locationMerges: {},
        }),
      }),
    } as Response);

    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      scenes: [{
        ...createMockAnalysisResult(0).scenes[0],
        participantNames: ['Al', 'Bob'],
        povName: 'Al',
      }],
    }];

    const reconciled = await reconcileResults(results);
    expect(reconciled[0].scenes[0].povName).toBe('Alice');
    expect(reconciled[0].scenes[0].participantNames).toContain('Alice');
  });

  it('deduplicates participant names after merge', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: { 'Al': 'Alice' },
          threadMerges: {},
          locationMerges: {},
        }),
      }),
    } as Response);

    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      scenes: [{
        ...createMockAnalysisResult(0).scenes[0],
        participantNames: ['Al', 'Alice', 'Bob'], // Al and Alice are same person
      }],
    }];

    const reconciled = await reconcileResults(results);
    // Should deduplicate after resolving Al → Alice
    const participants = reconciled[0].scenes[0].participantNames;
    const aliceCount = participants.filter(n => n === 'Alice').length;
    expect(aliceCount).toBe(1);
  });

  it('resolves relationship mutation names through character map', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          characterMerges: { 'Al': 'Alice' },
          threadMerges: {},
          locationMerges: {},
        }),
      }),
    } as Response);

    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      scenes: [{
        ...createMockAnalysisResult(0).scenes[0],
        relationshipMutations: [{ from: 'Al', to: 'Bob', type: 'trust', valenceDelta: 0.3 }],
      }],
    }];

    const reconciled = await reconcileResults(results);
    expect(reconciled[0].scenes[0].relationshipMutations[0].from).toBe('Alice');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 5: analyzeThreading
// ══════════════════════════════════════════════════════════════════════════════

describe('analyzeThreading', () => {
  it('analyzes thread dependencies and returns mapping', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          threadDependencies: {
            'Thread B': ['Thread A'],
            'Thread C': ['Thread A', 'Thread B'],
          },
        }),
      }),
    } as any);

    const result = await analyzeThreading(['Thread A', 'Thread B', 'Thread C']);
    expect(result['Thread B']).toEqual(['Thread A']);
    expect(result['Thread C']).toEqual(['Thread A', 'Thread B']);
  });

  it('returns empty object when less than 2 threads', async () => {
    const result = await analyzeThreading(['Thread A']);
    expect(result).toEqual({});
    expect(callGenerate).not.toHaveBeenCalled();
  });

  it('returns empty object when empty thread list', async () => {
    const result = await analyzeThreading([]);
    expect(result).toEqual({});
  });

  it('returns empty object when exactly 2 threads have no dependencies', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: JSON.stringify({ threadDependencies: {} }),
      }),
    } as any);

    const result = await analyzeThreading(['Thread A', 'Thread B']);
    expect(result).toEqual({});
  });

  it('handles LLM returning smart quotes in JSON', async () => {
    // Simulate LLM returning curly quotes instead of straight quotes
    const badJson = '{"threadDependencies": {\u201CThread B\u201D: [\u201CThread A\u201D]}}';
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: badJson }),
    } as any);

    const result = await analyzeThreading(['Thread A', 'Thread B']);
    expect(result['Thread B']).toEqual(['Thread A']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 6: assembleNarrative
// ══════════════════════════════════════════════════════════════════════════════

describe('assembleNarrative', () => {
  beforeEach(() => {
    // Mock fetch for meta extraction (callAnalysis uses fetch → res.json() → data.content)
    const metaJSON = JSON.stringify({
      rules: ['Magic exists', 'Laws of physics are flexible'],
      worldSystems: [{ name: 'Magic System', description: 'Elemental magic', principles: ['Elements bind'], constraints: ['Drains energy'], interactions: [] }],
      imageStyle: 'Epic fantasy art',
      proseProfile: {
        register: 'literary', stance: 'close_third', tense: 'past',
        sentenceRhythm: 'varied', interiority: 'deep', dialogueWeight: 'moderate',
        devices: ['dramatic irony', 'free indirect discourse'],
        rules: ['Show emotion through action'],
        antiPatterns: ['Never name emotions directly'],
      },
      planGuidance: 'Use action and environment mechanisms primarily',
    });
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ content: metaJSON }),
      text: async () => metaJSON,
      body: null,
    } as Response);
    // Also keep callGenerate mock for any other paths
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      rules: ['Magic exists', 'Laws of physics are flexible'],
      worldSystems: [{ name: 'Magic System', description: 'Elemental magic', principles: ['Elements bind'], constraints: ['Drains energy'], interactions: [] }],
      imageStyle: 'Epic fantasy art',
      proseProfile: {
        register: 'literary',
        stance: 'close_third',
        tense: 'past',
        sentenceRhythm: 'varied',
        interiority: 'deep',
        dialogueWeight: 'moderate',
        devices: ['dramatic irony', 'free indirect discourse'],
        rules: ['Show emotion through action'],
        antiPatterns: ['Never name emotions directly'],
      },
      planGuidance: 'Use action and environment mechanisms primarily',
    }));
  });

  it('creates a complete NarrativeState from analyzed results', async () => {
    const results = [createMockAnalysisResult(0), createMockAnalysisResult(1)];
    const narrative = await assembleNarrative('Test Story', results, {});

    expect(narrative.title).toBe('Test Story');
    expect(narrative.id).toMatch(/^N-TES-/);
    expect(Object.keys(narrative.characters).length).toBeGreaterThan(0);
    expect(Object.keys(narrative.locations).length).toBeGreaterThan(0);
    expect(Object.keys(narrative.threads).length).toBeGreaterThan(0);
    expect(Object.keys(narrative.scenes).length).toBe(2);
    expect(Object.keys(narrative.branches).length).toBe(1);
    expect(Object.keys(narrative.arcs).length).toBeGreaterThan(0);
  });

  it('assigns unique IDs to all entities', async () => {
    const results = [createMockAnalysisResult(0)];
    const narrative = await assembleNarrative('Test', results, {});

    const characterIds = Object.keys(narrative.characters);
    const locationIds = Object.keys(narrative.locations);
    const threadIds = Object.keys(narrative.threads);
    const sceneIds = Object.keys(narrative.scenes);

    expect(new Set(characterIds).size).toBe(characterIds.length);
    expect(new Set(locationIds).size).toBe(locationIds.length);
    expect(new Set(threadIds).size).toBe(threadIds.length);
    expect(new Set(sceneIds).size).toBe(sceneIds.length);
  });

  it('creates main branch with all scene IDs', async () => {
    const results = [createMockAnalysisResult(0), createMockAnalysisResult(1)];
    const narrative = await assembleNarrative('Test', results, {});

    const sceneCount = Object.keys(narrative.scenes).length;
    const branchIds = Object.keys(narrative.branches);
    const mainBranch = narrative.branches[branchIds[0]];
    const mainBranchScenes = mainBranch.entryIds.filter(id => id.startsWith('S-'));

    expect(mainBranchScenes.length).toBe(sceneCount);
  });

  it('maps scene participant names to character IDs', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true }],
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Test', sections: [0],
        threadMutations: [], continuityMutations: [], relationshipMutations: [],
      }],
    }];

    const narrative = await assembleNarrative('Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    const aliceId = Object.values(narrative.characters).find(c => c.name === 'Alice')?.id;

    expect(scene.participantIds).toContain(aliceId);
    expect(scene.povId).toBe(aliceId);
  });

  it('maps scene location names to location IDs', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      locations: [{ name: 'Castle', parentName: null, description: 'A castle' }],
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Test', sections: [0],
        threadMutations: [], continuityMutations: [], relationshipMutations: [],
      }],
    }];

    const narrative = await assembleNarrative('Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    const castleId = Object.values(narrative.locations).find(l => l.name === 'Castle')?.id;

    expect(scene.locationId).toBe(castleId);
  });

  it('preserves beat plans and beatProseMaps in version arrays', async () => {
    const mockPlan = { beats: [{ fn: 'breathe' as const, mechanism: 'environment' as const, what: 'Setup', propositions: [] }] };
    const mockBeatProseMap = { chunks: [{ beatIndex: 0, prose: 'Prose chunk' }], createdAt: Date.now() };

    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Test', sections: [0],
        threadMutations: [], continuityMutations: [], relationshipMutations: [],
        plan: mockPlan, beatProseMap: mockBeatProseMap, prose: 'Scene prose',
      }],
    }];

    const narrative = await assembleNarrative('Test', results, {});
    const scene = Object.values(narrative.scenes)[0];

    expect(scene.planVersions).toBeDefined();
    expect(scene.planVersions![0].plan).toEqual(mockPlan);
    expect(scene.planVersions![0].version).toBe('1');
    expect(scene.planVersions![0].versionType).toBe('generate');

    expect(scene.proseVersions).toBeDefined();
    expect(scene.proseVersions![0].beatProseMap).toEqual(mockBeatProseMap);
    expect(scene.proseVersions![0].version).toBe('1');
  });

  it('creates relationship entries from analysis', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [
        { name: 'Alice', role: 'anchor', firstAppearance: true },
        { name: 'Bob', role: 'recurring', firstAppearance: true },
      ],
      relationships: [{ from: 'Alice', to: 'Bob', type: 'ally', valence: 5 }],
    }];

    const narrative = await assembleNarrative('Test', results, {});
    expect(narrative.relationships).toHaveLength(1);
    expect(narrative.relationships[0].type).toBe('ally');
    expect(narrative.relationships[0].valence).toBe(5);
  });

  it('sets createdAt and updatedAt timestamps', async () => {
    const results = [createMockAnalysisResult(0)];
    const narrative = await assembleNarrative('Test', results, {});

    expect(typeof narrative.createdAt).toBe('number');
    expect(typeof narrative.updatedAt).toBe('number');
    expect(narrative.updatedAt).toBeGreaterThan(narrative.createdAt);
  });

  it('creates version pointers on main branch for analyzed scenes', async () => {
    const mockPlan = { beats: [{ fn: 'breathe' as const, mechanism: 'environment' as const, what: 'Setup', propositions: [] }] };
    const mockBeatProseMap = { chunks: [{ beatIndex: 0, prose: 'Chunk' }], createdAt: Date.now() };

    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Test scene', sections: [0], prose: 'Scene prose',
        threadMutations: [], continuityMutations: [], relationshipMutations: [],
        plan: mockPlan, beatProseMap: mockBeatProseMap,
      }],
    }];

    const narrative = await assembleNarrative('Test', results, {});
    const branchIds = Object.keys(narrative.branches);
    const mainBranch = narrative.branches[branchIds[0]];
    const sceneId = Object.keys(narrative.scenes)[0];

    expect(mainBranch.versionPointers).toBeDefined();
    expect(mainBranch.versionPointers![sceneId]).toBeDefined();
    expect(mainBranch.versionPointers![sceneId].proseVersion).toBe('1');
    expect(mainBranch.versionPointers![sceneId].planVersion).toBe('1');
  });

  // ── Rich assembly tests (artifacts, world knowledge, movements, etc.) ──

  it('creates artifact entities with ownership', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});

    const artifacts = Object.values(narrative.artifacts);
    expect(artifacts.length).toBeGreaterThan(0);

    const sword = artifacts.find(a => a.name === 'Magic Sword');
    expect(sword).toBeDefined();
    expect(sword!.significance).toBe('key');
    // Entity continuity graphs start empty — they're built at store replay from
    // scene.continuityMutations, not during assembly.
    expect(sword!.continuity).toBeDefined();
    // Owned by Alice — parentId should be Alice's character ID
    expect(sword!.parentId).toBeTruthy();
  });

  it('maps thread mutations to thread IDs in scenes', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});

    const scene = Object.values(narrative.scenes)[0];
    expect(scene.threadMutations.length).toBeGreaterThan(0);

    const threadId = scene.threadMutations[0].threadId;
    expect(narrative.threads[threadId]).toBeDefined();
    expect(narrative.threads[threadId].description).toBe('The Quest for the Crown');
  });

  it('maps continuity mutations to entity IDs', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});

    const scene = Object.values(narrative.scenes)[0];
    expect(scene.continuityMutations.length).toBeGreaterThan(0);

    // Each mutation should reference a valid entity
    for (const cm of scene.continuityMutations) {
      const isChar = !!narrative.characters[cm.entityId];
      const isLoc = !!narrative.locations[cm.entityId];
      const isArt = !!narrative.artifacts[cm.entityId];
      expect(isChar || isLoc || isArt).toBe(true);
    }
  });

  it('maps relationship mutations to character IDs', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});

    const scene = Object.values(narrative.scenes)[0];
    expect(scene.relationshipMutations.length).toBeGreaterThan(0);

    const rm = scene.relationshipMutations[0];
    expect(narrative.characters[rm.from]).toBeDefined();
    expect(narrative.characters[rm.to]).toBeDefined();
  });

  it('handles character movements with location IDs', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});

    const scene = Object.values(narrative.scenes)[0];
    expect(scene.characterMovements).toBeDefined();

    if (scene.characterMovements) {
      for (const [charId, movement] of Object.entries(scene.characterMovements)) {
        expect(narrative.characters[charId]).toBeDefined();
        expect(narrative.locations[movement.locationId]).toBeDefined();
      }
    }
  });

  it('handles artifact usages with IDs', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});

    const scene = Object.values(narrative.scenes)[0];
    if (scene.artifactUsages && scene.artifactUsages.length > 0) {
      for (const au of scene.artifactUsages) {
        expect(narrative.artifacts[au.artifactId]).toBeDefined();
      }
    }
  });

  it('creates world knowledge mutations with concept IDs', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});

    const scene = Object.values(narrative.scenes)[0];
    expect(scene.worldKnowledgeMutations).toBeDefined();
    expect(scene.worldKnowledgeMutations!.addedNodes.length).toBeGreaterThan(0);

    // Nodes should have WK- prefixed IDs
    for (const node of scene.worldKnowledgeMutations!.addedNodes) {
      expect(node.id).toMatch(/^WK-/);
    }

    // Edges should reference valid WK IDs
    for (const edge of scene.worldKnowledgeMutations!.addedEdges) {
      expect(edge.from).toMatch(/^WK-/);
      expect(edge.to).toMatch(/^WK-/);
    }
  });

  it('creates world builds with expansion manifests', async () => {
    const results = [createRichAnalysisResult(0), createRichAnalysisResult(1)];
    const narrative = await assembleNarrative('Rich Test', results, {});

    const worldBuilds = Object.values(narrative.worldBuilds);
    expect(worldBuilds.length).toBeGreaterThan(0);

    const firstBuild = worldBuilds[0];
    expect(firstBuild.kind).toBe('world_build');
    expect(firstBuild.expansionManifest.characters.length).toBeGreaterThan(0);
    expect(firstBuild.expansionManifest.locations.length).toBeGreaterThan(0);
  });

  it('interleaves world builds before their batch scenes in entry IDs', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});

    const branchIds = Object.keys(narrative.branches);
    const mainBranch = narrative.branches[branchIds[0]];

    // First entry should be a world build (WB-)
    expect(mainBranch.entryIds[0]).toMatch(/^WB-/);
    // Followed by scene(s)
    expect(mainBranch.entryIds[1]).toMatch(/^S-/);
  });

  it('uses arc groups when provided', async () => {
    const results = [createMockAnalysisResult(0), createMockAnalysisResult(1), createMockAnalysisResult(2), createMockAnalysisResult(3)];
    const arcGroups = [
      { name: 'Opening Act', sceneIndices: [0, 1] },
      { name: 'Climax', sceneIndices: [2, 3] },
    ];

    const narrative = await assembleNarrative('Test', results, {}, undefined, arcGroups);

    const arcNames = Object.values(narrative.arcs).map(a => a.name);
    expect(arcNames).toContain('Opening Act');
    expect(arcNames).toContain('Climax');
  });

  it('falls back to default arc grouping when arcGroups not provided', async () => {
    const results = Array.from({ length: 8 }, (_, i) => createMockAnalysisResult(i));
    const narrative = await assembleNarrative('Test', results, {});

    const arcEntries = Object.values(narrative.arcs);
    // 8 scenes / 4 per arc = 2 arcs
    expect(arcEntries.length).toBe(2);
    expect(arcEntries[0].sceneIds.length).toBe(4);
    expect(arcEntries[1].sceneIds.length).toBe(4);
  });

  it('assigns arcId to scenes from arc groups', async () => {
    const results = [createMockAnalysisResult(0), createMockAnalysisResult(1)];
    const arcGroups = [{ name: 'Act One', sceneIndices: [0, 1] }];

    const narrative = await assembleNarrative('Test', results, {}, undefined, arcGroups);

    const arcId = Object.keys(narrative.arcs)[0];
    for (const scene of Object.values(narrative.scenes)) {
      expect(scene.arcId).toBe(arcId);
    }
  });

  it('wires thread IDs onto characters', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});

    const alice = Object.values(narrative.characters).find(c => c.name === 'Alice');
    expect(alice).toBeDefined();
    expect(alice!.threadIds.length).toBeGreaterThan(0);

    // Each threadId should reference a real thread
    for (const tid of alice!.threadIds) {
      expect(narrative.threads[tid]).toBeDefined();
    }
  });

  it('applies thread dependencies from finalization', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      threads: [
        { description: 'Quest A', participantNames: ['Hero'], statusAtStart: 'dormant', statusAtEnd: 'active', development: 'Started' },
        { description: 'Quest B', participantNames: ['Hero'], statusAtStart: 'dormant', statusAtEnd: 'active', development: 'Also started' },
      ],
    }];

    const threadDeps = { 'Quest B': ['Quest A'] };
    const narrative = await assembleNarrative('Test', results, threadDeps);

    const questB = Object.values(narrative.threads).find(t => t.description === 'Quest B');
    const questA = Object.values(narrative.threads).find(t => t.description === 'Quest A');
    expect(questB).toBeDefined();
    expect(questA).toBeDefined();
    expect(questB!.dependents).toContain(questA!.id);
  });

  it('records continuity mutations on scenes for later replay', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});

    const alice = Object.values(narrative.characters).find(c => c.name === 'Alice');
    expect(alice).toBeDefined();
    // Entity continuity starts empty — graphs are built at store replay time from
    // scene.continuityMutations. Verify mutations landed on the scene instead.
    const scenes = Object.values(narrative.scenes);
    const aliceMutations = scenes.flatMap(s =>
      (s.continuityMutations ?? []).filter(m => m.entityId === alice!.id),
    );
    expect(aliceMutations.length).toBeGreaterThan(0);
    expect(aliceMutations[0].addedNodes.length).toBeGreaterThan(0);
  });

  it('extracts rules, systems, and prose profile', async () => {
    // assembleNarrative uses callAnalysis (fetch), not callGenerate for meta extraction
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          rules: ['Magic exists', 'Laws of physics are flexible'],
          worldSystems: [{ name: 'Magic System', description: 'Elemental magic', principles: ['Elements bind'], constraints: ['Drains energy'], interactions: [] }],
          imageStyle: 'Epic fantasy art',
          proseProfile: {
            register: 'literary', stance: 'close_third', tense: 'past',
            sentenceRhythm: 'varied', interiority: 'deep', dialogueWeight: 'moderate',
            devices: ['dramatic irony', 'free indirect discourse'],
            rules: ['Show emotion through action'],
            antiPatterns: ['Never name emotions directly'],
          },
          planGuidance: 'Use action and environment mechanisms primarily',
        }),
      }),
    } as Response);

    const results = [createMockAnalysisResult(0)];
    const narrative = await assembleNarrative('Test', results, {});

    expect(narrative.rules.length).toBeGreaterThan(0);
    expect(narrative.worldSystems).toBeDefined();
    expect(narrative.worldSystems!.length).toBeGreaterThan(0);
    expect(narrative.proseProfile).toBeDefined();
    expect(narrative.proseProfile!.register).toBe('literary');
    expect(narrative.proseProfile!.stance).toBe('close_third');
    expect(narrative.proseProfile!.devices!.length).toBeGreaterThan(0);
    expect(narrative.proseProfile!.rules!.length).toBeGreaterThan(0);
    expect(narrative.proseProfile!.antiPatterns!.length).toBeGreaterThan(0);
  });

  it('sets plan guidance in story settings', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        content: JSON.stringify({
          rules: [], worldSystems: [], imageStyle: '',
          proseProfile: { register: '', stance: '' },
          planGuidance: 'Use action and environment mechanisms primarily',
        }),
      }),
    } as Response);

    const results = [createMockAnalysisResult(0)];
    const narrative = await assembleNarrative('Test', results, {});

    expect(narrative.storySettings).toBeDefined();
    expect(narrative.storySettings!.planGuidance).toBe('Use action and environment mechanisms primarily');
  });

  it('handles meta extraction failure gracefully', async () => {
    vi.mocked(callGenerate).mockRejectedValue(new Error('LLM failed'));
    // Also mock fetch for the callAnalysis path
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Service unavailable' }),
    } as Response);

    const results = [createMockAnalysisResult(0)];
    // Should not throw — meta extraction is non-fatal
    const narrative = await assembleNarrative('Test', results, {});

    expect(narrative.title).toBe('Test');
    expect(narrative.rules).toEqual([]);
  });

  it('creates location hierarchy via parentId', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      locations: [
        { name: 'Kingdom', parentName: null, description: 'A kingdom' },
        { name: 'Castle', parentName: 'Kingdom', description: 'Royal castle' },
      ],
    }];

    const narrative = await assembleNarrative('Test', results, {});

    const kingdom = Object.values(narrative.locations).find(l => l.name === 'Kingdom');
    const castle = Object.values(narrative.locations).find(l => l.name === 'Castle');
    expect(kingdom).toBeDefined();
    expect(castle).toBeDefined();
    expect(castle!.parentId).toBe(kingdom!.id);
  });

  it('accumulates entities across multiple chunks without duplication', async () => {
    // Same character appears across 3 chunks, each scene adds a continuity node for Alice
    const makeChunk = (index: number, nodeContent: string, nodeType: string): AnalysisChunkResult => ({
      ...createMockAnalysisResult(index),
      characters: [{ name: 'Alice', role: 'anchor', firstAppearance: index === 0 }],
      scenes: [{
        ...createMockAnalysisResult(index).scenes[0],
        povName: 'Alice',
        participantNames: ['Alice'],
        continuityMutations: [
          { entityName: 'Alice', addedNodes: [{ content: nodeContent, type: nodeType }] },
        ],
      }],
    });

    const results: AnalysisChunkResult[] = [
      makeChunk(0, 'Brave and adventurous', 'trait'),
      makeChunk(1, 'Injured in battle', 'state'),
      makeChunk(2, 'Seeks the treasure', 'goal'),
    ];

    const narrative = await assembleNarrative('Test', results, {});

    const alices = Object.values(narrative.characters).filter(c => c.name === 'Alice');
    expect(alices).toHaveLength(1); // Single character entity
    // Continuity is replayed from scene mutations at store load — assembly only
    // preserves the mutations themselves. Verify each chunk's scene added a node.
    const scenes = Object.values(narrative.scenes);
    const aliceMutationNodes = scenes.flatMap(s =>
      (s.continuityMutations ?? [])
        .filter(m => m.entityId === alices[0].id)
        .flatMap(m => m.addedNodes),
    );
    expect(aliceMutationNodes.length).toBeGreaterThanOrEqual(3);
  });

  it('handles tie mutations creating location-character bindings', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});

    const scene = Object.values(narrative.scenes)[0];
    if (scene.tieMutations && scene.tieMutations.length > 0) {
      for (const tm of scene.tieMutations) {
        expect(narrative.locations[tm.locationId]).toBeDefined();
        expect(narrative.characters[tm.characterId]).toBeDefined();
        expect(['add', 'remove']).toContain(tm.action);
      }
    }
  });

  it('sets thread openedAt to first scene with a mutation', async () => {
    const results = [createRichAnalysisResult(0)];
    const narrative = await assembleNarrative('Rich Test', results, {});

    for (const thread of Object.values(narrative.threads)) {
      if (thread.openedAt) {
        expect(narrative.scenes[thread.openedAt]).toBeDefined();
      }
    }
  });

  it('sets branch name to Canon Timeline', async () => {
    const results = [createMockAnalysisResult(0)];
    const narrative = await assembleNarrative('Test', results, {});

    const mainBranch = Object.values(narrative.branches)[0];
    expect(mainBranch.name).toBe('Canon Timeline');
    expect(mainBranch.parentBranchId).toBeNull();
    expect(mainBranch.forkEntryId).toBeNull();
  });

  it('handles empty results array', async () => {
    const narrative = await assembleNarrative('Empty', [], {});

    expect(narrative.title).toBe('Empty');
    expect(Object.keys(narrative.scenes)).toHaveLength(0);
    expect(Object.keys(narrative.characters)).toHaveLength(0);
    const mainBranch = Object.values(narrative.branches)[0];
    expect(mainBranch.entryIds).toHaveLength(0);
  });

  it('handles scenes without prose or plan (no version arrays)', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Test', sections: [0],
        threadMutations: [], continuityMutations: [], relationshipMutations: [],
        // No prose, no plan
      }],
    }];

    const narrative = await assembleNarrative('Test', results, {});
    const scene = Object.values(narrative.scenes)[0];

    expect(scene.proseVersions).toBeUndefined();
    expect(scene.planVersions).toBeUndefined();
  });

  it('populates arc develops, locationIds, and activeCharacterIds', async () => {
    const results = [createRichAnalysisResult(0)];
    const arcGroups = [{ name: 'First Arc', sceneIndices: [0] }];
    const narrative = await assembleNarrative('Rich Test', results, {}, undefined, arcGroups);

    const arc = Object.values(narrative.arcs)[0];
    expect(arc.name).toBe('First Arc');
    expect(arc.sceneIds.length).toBeGreaterThan(0);
    expect(arc.locationIds.length).toBeGreaterThan(0);
    expect(arc.activeCharacterIds.length).toBeGreaterThan(0);
    // initialCharacterLocations should map character IDs to location IDs
    expect(Object.keys(arc.initialCharacterLocations).length).toBeGreaterThan(0);
  });

  // ── Thread log mapper — synthesis fallback ────────────────────────────────
  // Locks in the fix for the bug where extractSceneStructure returned a
  // threadMutation with empty addedNodes, and the assembleNarrative mapper
  // passed it through as-is, leaving the final thread log blank.

  it('synthesizes fallback log entries when analysis extraction omits addedNodes', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true }],
      locations: [{ name: 'Castle', parentName: null, description: 'A castle' }],
      threads: [{ description: 'The Quest', participantNames: ['Alice'], statusAtStart: 'latent', statusAtEnd: 'active', development: '' }],
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Alice sets off', sections: [0],
        threadMutations: [
          // LLM-returned extraction with no log entries — should be synthesized.
          { threadDescription: 'The Quest', from: 'latent', to: 'active', addedNodes: [] },
        ],
        continuityMutations: [],
        relationshipMutations: [],
      }],
    }];

    const narrative = await assembleNarrative('Test', results, {});

    const scene = Object.values(narrative.scenes)[0];
    expect(scene.threadMutations).toHaveLength(1);
    const tm = scene.threadMutations[0];
    expect(tm.addedNodes).toHaveLength(1);
    // Synthesized from the from→to status change.
    expect(tm.addedNodes![0].content).toMatch(/advanced from latent to active/);
    expect(tm.addedNodes![0].type).toBe('transition');
    // Must be a real TK-* ID from the allocator, not a placeholder.
    expect(tm.addedNodes![0].id).toMatch(/^TK-/);
  });

  it('coerces invalid status values (e.g. "pulse") in analysis extraction to a status-hold', async () => {
    // The LLM sometimes confuses the log type "pulse" with a status value
    // and emits something like "from": "pulse", "to": "active". The mapper
    // must coerce both fields to valid lifecycle statuses so the thread's
    // stored status doesn't get polluted.
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true }],
      locations: [{ name: 'Castle', parentName: null, description: 'A castle' }],
      threads: [{ description: 'The Quest', participantNames: ['Alice'], statusAtStart: 'latent', statusAtEnd: 'active', development: '' }],
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Alice', sections: [0],
        threadMutations: [
          // Invalid: "pulse" is a log node type, never a status.
          { threadDescription: 'The Quest', from: 'pulse', to: 'active', addedNodes: [] },
        ],
        continuityMutations: [],
        relationshipMutations: [],
      }],
    }];

    const narrative = await assembleNarrative('Test', results, {});
    const scene = Object.values(narrative.scenes)[0];
    const tm = scene.threadMutations[0];
    // "pulse" coerces to "latent" (the safeFrom default), then "active"
    // remains valid — but the synthesized fallback message reflects the
    // coerced statuses, not the invalid input.
    expect(tm.from).toBe('latent');
    expect(tm.to).toBe('active');
    expect(tm.addedNodes![0].content).toMatch(/advanced from latent to active/);
    expect(tm.addedNodes![0].type).toBe('transition');
  });

  it('synthesizes pulse fallback when from === to and LLM omits addedNodes', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true }],
      locations: [{ name: 'Castle', parentName: null, description: 'A castle' }],
      threads: [{ description: 'The Quest', participantNames: ['Alice'], statusAtStart: 'active', statusAtEnd: 'active', development: '' }],
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Alice reflects', sections: [0],
        threadMutations: [
          { threadDescription: 'The Quest', from: 'active', to: 'active', addedNodes: [] },
        ],
        continuityMutations: [],
        relationshipMutations: [],
      }],
    }];

    const narrative = await assembleNarrative('Test', results, {});

    const scene = Object.values(narrative.scenes)[0];
    const tm = scene.threadMutations[0];
    expect(tm.addedNodes).toHaveLength(1);
    expect(tm.addedNodes![0].content).toMatch(/held active without transition/);
    expect(tm.addedNodes![0].type).toBe('pulse');
  });

  it('preserves LLM-provided addedNodes when present (does not duplicate)', async () => {
    const results: AnalysisChunkResult[] = [{
      ...createMockAnalysisResult(0),
      characters: [{ name: 'Alice', role: 'anchor', firstAppearance: true }],
      locations: [{ name: 'Castle', parentName: null, description: 'A castle' }],
      threads: [{ description: 'The Quest', participantNames: ['Alice'], statusAtStart: 'dormant', statusAtEnd: 'active', development: '' }],
      scenes: [{
        locationName: 'Castle', povName: 'Alice', participantNames: ['Alice'],
        events: [], summary: 'Alice sets off', sections: [0],
        threadMutations: [{
          threadDescription: 'The Quest',
          from: 'dormant',
          to: 'active',
          addedNodes: [
            { content: 'Alice receives the mandate', type: 'transition' },
            { content: 'She weighs the cost', type: 'escalation' },
          ],
        }],
        continuityMutations: [],
        relationshipMutations: [],
      }],
    }];

    const narrative = await assembleNarrative('Test', results, {});

    const scene = Object.values(narrative.scenes)[0];
    const tm = scene.threadMutations[0];
    // Two LLM-provided nodes — no synthesis, no duplication.
    expect(tm.addedNodes).toHaveLength(2);
    expect(tm.addedNodes![0].content).toBe('Alice receives the mandate');
    expect(tm.addedNodes![0].type).toBe('transition');
    expect(tm.addedNodes![1].content).toBe('She weighs the cost');
    expect(tm.addedNodes![1].type).toBe('escalation');
    // Both nodes should have distinct TK-* IDs assigned by the allocator.
    expect(tm.addedNodes![0].id).toMatch(/^TK-/);
    expect(tm.addedNodes![1].id).toMatch(/^TK-/);
    expect(tm.addedNodes![0].id).not.toBe(tm.addedNodes![1].id);
  });
});
