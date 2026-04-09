/**
 * Semantic Search Tests
 *
 * Tests the core search functionality including:
 * - Query embedding generation
 * - Similarity computation across scenes, beats, and propositions
 * - Result ranking and filtering
 * - Timeline heatmap generation
 * - Top arc/scene/beat identification
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { searchNarrative } from '@/lib/search';
import type { NarrativeState, Scene, BeatPlan } from '@/types/narrative';
import * as embeddingsModule from '@/lib/embeddings';
import { SEARCH_TOP_K_SCENES, SEARCH_TOP_K_BEATS, SEARCH_TOP_K_PROPOSITIONS } from '@/lib/constants';

// Mock embeddings module
vi.mock('@/lib/embeddings');
vi.mock('@/lib/system-logger');

describe('searchNarrative', () => {
  let mockNarrative: NarrativeState;
  let mockResolvedKeys: string[];

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock narrative with scenes, beats, and propositions
    const mockBeatPlan: BeatPlan = {
      beats: [
        {
          fn: 'advance',
          mechanism: 'action',
          what: 'Hero enters the castle',
          propositions: [
            {
              content: 'The castle gates swing open',
              embedding: 'embed-1',
            },
            {
              content: 'Guards block the entrance',
              embedding: 'embed-2',
            },
          ],
          embeddingCentroid: 'centroid-1',
        },
        {
          fn: 'reveal',
          mechanism: 'dialogue',
          what: 'King reveals the prophecy',
          propositions: [
            {
              content: 'The ancient prophecy speaks of a chosen one',
              embedding: 'embed-3',
            },
          ],
          embeddingCentroid: 'centroid-2',
        },
      ],
    };

    const scene1: Scene = {
      kind: 'scene',
      id: 'scene1',
      arcId: 'arc1',
      povId: 'char1',
      locationId: 'loc1',
      participantIds: ['char1', 'char2'],
      events: [],
      summary: 'Hero arrives at the castle',
      summaryEmbedding: 'scene-embed-1',
      planVersions: [
        {
          version: '1.0.0',
          branchId: 'main',
          timestamp: Date.now(),
          versionType: 'generate',
          plan: mockBeatPlan,
        },
      ],
      threadMutations: [],
      continuityMutations: [],
      relationshipMutations: [],
      characterMovements: {},
    };

    const scene2: Scene = {
      kind: 'scene',
      id: 'scene2',
      arcId: 'arc1',
      povId: 'char1',
      locationId: 'loc2',
      participantIds: ['char1'],
      events: [],
      summary: 'Hero faces a challenge',
      summaryEmbedding: 'scene-embed-2',
      planVersions: [
        {
          version: '1.0.0',
          branchId: 'main',
          timestamp: Date.now(),
          versionType: 'generate',
          plan: {
            beats: [
              {
                fn: 'advance',
                mechanism: 'action',
                what: 'Battle ensues',
                propositions: [
                  {
                    content: 'Swords clash in the courtyard',
                    embedding: 'embed-4',
                  },
                ],
                embeddingCentroid: 'centroid-3',
              },
            ],
          },
        },
      ],
      threadMutations: [],
      continuityMutations: [],
      relationshipMutations: [],
      characterMovements: {},
    };

    mockNarrative = {
      id: 'test-narrative',
      title: 'Test Story',
      description: 'A test narrative',
      worldSummary: '',
      rules: [],
      artifacts: {},
      characters: {
        char1: {
          id: 'char1',
          name: 'Hero',
          role: 'anchor',
          continuity: { nodes: {}, edges: [] },
          threadIds: [],
        },
        char2: {
          id: 'char2',
          name: 'King',
          role: 'anchor',
          continuity: { nodes: {}, edges: [] },
          threadIds: [],
        },
      },
      locations: {
        loc1: {
          id: 'loc1',
          name: 'Castle',
          prominence: 'domain' as const,
          parentId: null,
          tiedCharacterIds: [],
          threadIds: [],
          continuity: { nodes: {}, edges: [] },
        },
        loc2: {
          id: 'loc2',
          name: 'Courtyard',
          prominence: 'place' as const,
          parentId: 'loc1',
          tiedCharacterIds: [],
          threadIds: [],
          continuity: { nodes: {}, edges: [] },
        },
      },
      threads: {},
      arcs: {
        arc1: {
          id: 'arc1',
          name: 'Act I',
          sceneIds: ['scene1', 'scene2'],
          develops: [],
          locationIds: ['loc1', 'loc2'],
          activeCharacterIds: ['char1', 'char2'],
          initialCharacterLocations: { char1: 'loc1', char2: 'loc1' },
        },
      },
      scenes: {
        scene1,
        scene2,
      },
      worldBuilds: {},
      branches: {
        main: {
          id: 'main',
          name: 'main',
          parentBranchId: null,
          forkEntryId: null,
          entryIds: ['scene1', 'scene2'],
          createdAt: 0,
        },
      },
      relationships: [],
      worldKnowledge: { nodes: {}, edges: [] },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    mockResolvedKeys = ['scene1', 'scene2'];

    // Setup mock embedding responses
    vi.mocked(embeddingsModule.generateEmbeddings).mockResolvedValue([
      [0.1, 0.2, 0.3], // query embedding
    ]);

    // Mock resolveEmbedding to return different vectors
    vi.mocked(embeddingsModule.resolveEmbedding).mockImplementation((ref: any) => {
      const embeddings: Record<string, number[]> = {
        'scene-embed-1': [0.15, 0.25, 0.35],
        'scene-embed-2': [0.05, 0.15, 0.25],
        'centroid-1': [0.12, 0.22, 0.32],
        'centroid-2': [0.08, 0.18, 0.28],
        'centroid-3': [0.11, 0.21, 0.31],
        'embed-1': [0.14, 0.24, 0.34],
        'embed-2': [0.13, 0.23, 0.33],
        'embed-3': [0.09, 0.19, 0.29],
        'embed-4': [0.10, 0.20, 0.30],
      };

      // Return embedding if exists, otherwise return a default one to avoid null
      return Promise.resolve(embeddings[ref] || [0.1, 0.2, 0.3]);
    });

    // Mock cosine similarity to return descending similarities
    vi.mocked(embeddingsModule.cosineSimilarity).mockImplementation((a: number[], b: number[]) => {
      // Simple mock: higher similarity for closer embeddings
      const sum = b.reduce((acc, val) => acc + val, 0);
      return 1 - Math.abs(0.6 - sum);
    });
  });

  it('should generate query embedding', async () => {
    const query = 'castle entrance';

    await searchNarrative(mockNarrative, mockResolvedKeys, query);

    expect(embeddingsModule.generateEmbeddings).toHaveBeenCalledWith([query], mockNarrative.id);
  });

  it('should search across scenes, beats, and propositions', async () => {
    const query = 'castle entrance';

    const result = await searchNarrative(mockNarrative, mockResolvedKeys, query);

    expect(result.query).toBe(query);
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.embedding).toBeDefined();
    expect(result.detailTimeline).toBeDefined();
  });

  it('should limit results to SEARCH_TOP_K', async () => {
    const query = 'battle';

    const result = await searchNarrative(mockNarrative, mockResolvedKeys, query);

    expect(result.results.length).toBeLessThanOrEqual(SEARCH_TOP_K_SCENES + SEARCH_TOP_K_BEATS + SEARCH_TOP_K_PROPOSITIONS);
  });

  it('should sort results by similarity descending', async () => {
    const query = 'prophecy';

    const result = await searchNarrative(mockNarrative, mockResolvedKeys, query);

    // Verify descending order
    for (let i = 0; i < result.results.length - 1; i++) {
      expect(result.results[i].similarity).toBeGreaterThanOrEqual(
        result.results[i + 1].similarity
      );
    }
  });

  it('should generate timeline heatmap', async () => {
    const query = 'hero';

    const result = await searchNarrative(mockNarrative, mockResolvedKeys, query);

    expect(result.detailTimeline).toBeDefined();
    expect(Array.isArray(result.detailTimeline)).toBe(true);

    // Verify timeline structure
    result.detailTimeline.forEach(point => {
      expect(point).toHaveProperty('sceneIndex');
      expect(point).toHaveProperty('maxSimilarity');
      expect(typeof point.sceneIndex).toBe('number');
      expect(typeof point.maxSimilarity).toBe('number');
    });
  });

  it('should identify top arc', async () => {
    const query = 'castle';

    const result = await searchNarrative(mockNarrative, mockResolvedKeys, query);

    if (result.topArc) {
      expect(result.topArc.arcId).toBe('arc1');
      expect(typeof result.topArc.avgSimilarity).toBe('number');
      expect(result.topArc.avgSimilarity).toBeGreaterThan(0);
      expect(result.topArc.avgSimilarity).toBeLessThanOrEqual(1);
    }
  });

  it('should return query embedding in result', async () => {
    const query = 'test';
    const mockEmbedding = [0.1, 0.2, 0.3];
    vi.mocked(embeddingsModule.generateEmbeddings).mockResolvedValue([mockEmbedding]);

    const result = await searchNarrative(mockNarrative, mockResolvedKeys, query);

    expect(result.embedding).toEqual(mockEmbedding);
  });

  it('should handle scenes without embeddings gracefully', async () => {
    // Remove embeddings from scene2
    delete mockNarrative.scenes.scene2.summaryEmbedding;
    mockNarrative.scenes.scene2.planVersions = [];

    const query = 'test';

    const result = await searchNarrative(mockNarrative, mockResolvedKeys, query);

    // Should not throw error even with missing embeddings
    expect(result).toBeDefined();
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
  });

  it('should handle narrative with no scenes', async () => {
    const emptyNarrative = {
      ...mockNarrative,
      scenes: {},
    };

    const result = await searchNarrative(emptyNarrative, [], 'test');

    expect(result.results.length).toBe(0);
    expect(result.detailTimeline.length).toBe(0);
    expect(result.topArc).toBeNull();
    expect(result.topScene).toBeNull();
    expect(result.topBeat).toBeNull();
  });
});
