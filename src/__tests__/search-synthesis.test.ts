/**
 * Search Synthesis Tests
 *
 * Tests the AI-powered search synthesis functionality:
 * - Context building from search results
 * - AI overview generation with citations
 * - Streaming token callback
 * - Fallback synthesis on errors
 * - Citation metadata mapping
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { synthesizeSearchResults } from '@/lib/ai/search-synthesis';
import type { NarrativeState, SearchResult } from '@/types/narrative';
import * as apiModule from '@/lib/ai/api';
import * as jsonModule from '@/lib/ai/json';

// Mock modules
vi.mock('@/lib/ai/api');
vi.mock('@/lib/ai/json');
vi.mock('@/lib/system-logger');

describe('synthesizeSearchResults', () => {
  let mockNarrative: NarrativeState;
  let mockResults: SearchResult[];
  let mockSceneResults: SearchResult[];
  let mockDetailResults: SearchResult[];
  let mockTopArc: { arcId: string; avgSimilarity: number };
  let mockTopScene: { sceneId: string; similarity: number };
  let mockTimeline: Array<{ sceneIndex: number; maxSimilarity: number }>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockNarrative = {
      id: 'test-narrative',
      title: 'Test Story',
      description: 'A test narrative',
      worldSummary: '',
      rules: [],
      artifacts: {},
      characters: {},
      locations: {},
      threads: {},
      arcs: {
        arc1: {
          id: 'arc1',
          name: 'Act I',
          sceneIds: ['scene1', 'scene2'],
          develops: [],
          locationIds: [],
          activeCharacterIds: [],
          initialCharacterLocations: {},
        },
      },
      scenes: {},
      worldBuilds: {},
      branches: {
        main: {
          id: 'main',
          name: 'main',
          parentBranchId: null,
          forkEntryId: null,
          entryIds: [],
          createdAt: 0,
        },
      },
      relationships: [],
      worldKnowledge: { nodes: {}, edges: [] },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Split results into scene-level and detail-level
    mockSceneResults = [
      {
        type: 'scene',
        id: 'scene2-scene',
        sceneId: 'scene2',
        content: 'Hero faces a challenge',
        similarity: 0.82,
        context: 'Hero faces a challenge',
      },
    ];

    mockDetailResults = [
      {
        type: 'proposition',
        id: 'scene1-0-0',
        sceneId: 'scene1',
        beatIndex: 0,
        propIndex: 0,
        content: 'The castle gates swing open',
        similarity: 0.95,
        context: 'Beat 1: Hero enters the castle',
      },
      {
        type: 'beat',
        id: 'scene1-1',
        sceneId: 'scene1',
        beatIndex: 1,
        content: 'King reveals the prophecy',
        similarity: 0.88,
        context: 'Beat 2: King reveals the prophecy',
      },
    ];

    // Combined results across all types
    mockResults = [...mockSceneResults, ...mockDetailResults];

    mockTopArc = {
      arcId: 'arc1',
      avgSimilarity: 0.85,
    };

    mockTopScene = {
      sceneId: 'scene1',
      similarity: 0.90,
    };

    mockTimeline = [
      { sceneIndex: 0, maxSimilarity: 0.90 },
      { sceneIndex: 1, maxSimilarity: 0.82 },
      { sceneIndex: 2, maxSimilarity: 0.75 },
    ];

    // Setup default successful response
    vi.mocked(apiModule.callGenerateStream).mockImplementation(
      async (prompt: string, system: string, onToken: (token: string) => void): Promise<string> => {
        const response = JSON.stringify({
          overview: 'The search reveals key moments in the hero\'s journey [1]. The castle entrance [2] and the prophecy revelation [3] are central themes.',
          citationIds: [1, 2, 3],
        });

        // Simulate streaming
        if (onToken) {
          for (const char of response) {
            onToken(char);
          }
        }

        return response;
      }
    );

    vi.mocked(jsonModule.parseJson).mockReturnValue({
      overview: 'The search reveals key moments in the hero\'s journey [1]. The castle entrance [2] and the prophecy revelation [3] are central themes.',
      citationIds: [1, 2, 3],
    });
  });

  it('should call AI API with proper context', async () => {
    const query = 'castle entrance';

    await synthesizeSearchResults(
      mockNarrative,
      query,
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline
    );

    expect(apiModule.callGenerateStream).toHaveBeenCalled();

    const callArgs = vi.mocked(apiModule.callGenerateStream).mock.calls[0];
    const [prompt] = callArgs;
    expect(prompt).toContain('SEARCH QUERY');
    expect(prompt).toContain('SEARCH RESULTS');
    expect(prompt).toContain(query);
  });

  it('should stream tokens to callback', async () => {
    const onToken = vi.fn();

    await synthesizeSearchResults(
      mockNarrative,
      'test',
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline,
      onToken
    );

    expect(onToken).toHaveBeenCalled();
  });

  it('should return synthesis with overview and citations', async () => {
    const result = await synthesizeSearchResults(
      mockNarrative,
      'test',
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline
    );

    expect(result).toHaveProperty('overview');
    expect(result).toHaveProperty('citations');
    expect(typeof result.overview).toBe('string');
    expect(Array.isArray(result.citations)).toBe(true);
  });

  it('should map citation IDs to result metadata', async () => {
    const result = await synthesizeSearchResults(
      mockNarrative,
      'test',
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline
    );

    expect(result.citations.length).toBe(3);

    // Results are sorted by similarity descending when combined
    const sortedResults = [...mockSceneResults, ...mockDetailResults].sort((a, b) => b.similarity - a.similarity);

    result.citations.forEach((citation, idx) => {
      expect(citation).toHaveProperty('id');
      expect(citation).toHaveProperty('sceneId');
      expect(citation).toHaveProperty('type');
      expect(citation).toHaveProperty('title');
      expect(citation).toHaveProperty('similarity');

      // Verify citation ID matches
      expect(citation.id).toBe(idx + 1);

      // Verify metadata from corresponding result (sorted by similarity)
      const correspondingResult = sortedResults[idx];
      expect(citation.sceneId).toBe(correspondingResult.sceneId);
      expect(citation.similarity).toBe(correspondingResult.similarity);
    });
  });

  it('should truncate long content in citation titles', async () => {
    const longContent = 'A'.repeat(100);
    // Set long content on the highest similarity result (mockDetailResults[0] has 0.95)
    // which will be first after sorting by similarity
    mockDetailResults[0].content = longContent;

    const result = await synthesizeSearchResults(
      mockNarrative,
      'test',
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline
    );

    const citation = result.citations[0];
    expect(citation.title.length).toBeLessThanOrEqual(60);
    expect(citation.title).toContain('...');
  });

  it('should filter invalid citation IDs', async () => {
    // Mock response with invalid citation IDs (100 and -1 exceed results length or are negative)
    vi.mocked(apiModule.callGenerateStream).mockImplementation(
      async (_prompt: string, _system: string, onToken: (token: string) => void): Promise<string> => {
        const response = 'Test overview with citations [1], [2], [100], and [-1].';
        if (onToken) {
          for (const char of response) {
            onToken(char);
          }
        }
        return response;
      }
    );

    const result = await synthesizeSearchResults(
      mockNarrative,
      'test',
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline
    );

    // Should only include valid citations (1, 2) - 100 exceeds results.length, -1 is invalid
    expect(result.citations.length).toBe(2);
    expect(result.citations[0].id).toBe(1);
    expect(result.citations[1].id).toBe(2);
  });

  it('should handle synthesis errors with fallback', async () => {
    vi.mocked(apiModule.callGenerateStream).mockRejectedValue(new Error('API error'));

    const result = await synthesizeSearchResults(
      mockNarrative,
      'test query',
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline
    );

    // Should return fallback synthesis
    expect(result.overview).toContain('Found 3 results');
    expect(result.overview).toContain('test query');
    expect(result.overview).toContain('Act I');
    expect(result.citations.length).toBeLessThanOrEqual(3);
  });

  it('should handle invalid JSON response', async () => {
    vi.mocked(jsonModule.parseJson).mockImplementation(() => {
      throw new Error('Invalid JSON');
    });

    const result = await synthesizeSearchResults(
      mockNarrative,
      'test',
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline
    );

    // Should return fallback
    expect(result.overview).toBeDefined();
    expect(result.citations).toBeDefined();
  });

  it('should handle missing overview in response', async () => {
    vi.mocked(jsonModule.parseJson).mockReturnValue({
      citationIds: [1, 2],
      // missing overview
    } as { overview: string; citationIds: number[] });

    const result = await synthesizeSearchResults(
      mockNarrative,
      'test',
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline
    );

    // Should return fallback
    expect(result.overview).toBeDefined();
  });

  it('should handle null top arc gracefully', async () => {
    const result = await synthesizeSearchResults(
      mockNarrative,
      'test',
      mockSceneResults,
      mockDetailResults,
      null,
      mockTopScene,
      mockTimeline
    );

    expect(result.overview).toBeDefined();
    expect(result.citations).toBeDefined();
  });

  it('should handle empty results', async () => {
    vi.mocked(apiModule.callGenerateStream).mockRejectedValue(new Error('No results'));

    const result = await synthesizeSearchResults(
      mockNarrative,
      'test',
      [],
      [],
      null,
      null,
      []
    );

    expect(result.overview).toBeDefined();
    expect(result.citations.length).toBe(0);
  });

  it('should map result types correctly to citation types', async () => {
    const result = await synthesizeSearchResults(
      mockNarrative,
      'test',
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline
    );

    // Citations are extracted from combined results sorted by similarity
    // Order depends on which citations the LLM referenced in the synthesis
    expect(result.citations.length).toBeGreaterThan(0);
    expect(['scene', 'beat', 'proposition']).toContain(result.citations[0].type);
  });

  it('should not call onToken if not provided', async () => {
    // Should not throw error when onToken is undefined
    await expect(
      synthesizeSearchResults(
        mockNarrative,
        'test',
        mockSceneResults,
        mockDetailResults,
        mockTopArc,
        mockTopScene,
        mockTimeline
      )
    ).resolves.toBeDefined();
  });

  it('should include top arc in context', async () => {
    await synthesizeSearchResults(
      mockNarrative,
      'test',
      mockSceneResults,
      mockDetailResults,
      mockTopArc,
      mockTopScene,
      mockTimeline
    );

    const callArgs = vi.mocked(apiModule.callGenerateStream).mock.calls[0];
    const [prompt] = callArgs;
    expect(prompt).toContain('TOP ARC');
    expect(prompt).toContain('Act I');
  });
});
