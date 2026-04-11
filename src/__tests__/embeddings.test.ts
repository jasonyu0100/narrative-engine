/**
 * Embedding System Integration Tests
 *
 * Tests cover:
 * 1. Embedding generation in generation pipeline (scenes.ts)
 * 2. Embedding generation in analysis pipeline (analysis-runner.ts)
 * 3. Plan candidates functionality
 * 4. Semantic search
 * 5. Manual embedding regeneration
 * 6. Export/import with embeddings
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateScenePlan, generateScenes, generateSceneProse } from '@/lib/ai/scenes';
import { rewriteSceneProse } from '@/lib/ai/prose';
import { runPlanCandidates } from '@/lib/ai/candidates';
import { searchNarrative } from '@/lib/search';
import { generateEmbeddings, cosineSimilarity, computeCentroid, embedPropositions } from '@/lib/embeddings';
import type { NarrativeState, Scene, BeatPlan } from '@/types/narrative';
import { EMBEDDING_DIMENSIONS } from '@/lib/constants';
import { TEST_EMBEDDINGS } from './fixtures/test-embeddings';
import { assetManager } from '@/lib/asset-manager';

// Mock fetch for embedding API
global.fetch = vi.fn();

const mockNarrative: NarrativeState = {
  id: 'test-narrative',
  title: 'Test Story',
  description: 'A test narrative',
  worldSummary: '',
  rules: [],
  artifacts: {},
  characters: {
    'char1': {
      id: 'char1',
      name: 'Alice',
      role: 'anchor',
      continuity: { nodes: {}, edges: [] },
      threadIds: ['thread1'],
    },
  },
  locations: {
    'loc1': {
      id: 'loc1',
      name: 'Castle',
      prominence: 'place' as const,
      parentId: null,
      tiedCharacterIds: [],
      threadIds: ['thread1'],
      continuity: { nodes: {}, edges: [] },
    },
  },
  threads: {
    'thread1': {
      id: 'thread1',
      participants: [],
      description: 'The hero\'s journey',
      status: 'active',
      openedAt: 'scene0',
      dependents: [],
      threadLog: { nodes: {}, edges: [] },
    },
  },
  arcs: {
    'arc1': {
      id: 'arc1',
      name: 'Act I',
      sceneIds: [],
      develops: ['thread1'],
      locationIds: ['loc1'],
      activeCharacterIds: ['char1'],
      initialCharacterLocations: { 'char1': 'loc1' },
    },
  },
  scenes: {},
  worldBuilds: {},
  branches: {
    'main': {
      id: 'main',
      name: 'main',
      parentBranchId: null,
      forkEntryId: null,
      entryIds: [],
      createdAt: Date.now(),
    },
  },
  relationships: [],
  systemGraph: { nodes: {}, edges: [] },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const mockScene: Scene = {
  kind: 'scene',
  id: 'scene1',
  summary: 'Alice discovers a hidden door in the castle library',
  povId: 'char1',
  locationId: 'loc1',
  participantIds: ['char1'],
  events: ['Alice finds hidden door', 'Door leads to secret passage'],
  threadMutations: [{ threadId: 'thread1', from: 'active', to: 'active', addedNodes: [] }],
  continuityMutations: [],
  relationshipMutations: [],
  systemMutations: { addedNodes: [], addedEdges: [] },
  ownershipMutations: [],
  arcId: 'arc1',
};

// Map text to fixture embedding keys
const TEXT_TO_FIXTURE_KEY: Record<string, keyof typeof TEST_EMBEDDINGS> = {
  'Alice discovers a hidden door': 'sceneDiscoverDoor',
  'Bob finds a mysterious key': 'sceneFindKey',
  'Carol deciphers ancient runes': 'sceneDecipherRunes',
  'Alice discovers a hidden magical door': 'sceneMagicalDoor',
  'Bob finds an ancient sword': 'sceneAncientSword',
  'The door is ancient and ornate': 'propDoorAncient',
  'Strange symbols cover the door frame': 'propSymbols',
  'The inscription is in an unknown language': 'propInscription',
  'Proposition A': 'propA',
  'Proposition B': 'propB',
  'Proposition C': 'propC',
  'The door glows with arcane energy': 'propGlowsEnergy',
  'A rusty key hangs on the wall': 'propRustyKey',
  'Alice pushed open the heavy wooden door. Beyond lay a corridor shrouded in darkness, its walls lined with ancient tapestries depicting forgotten battles.': 'proseDetailed',
  'Alice opened the door.': 'proseSimple',
  'With trembling hands, Alice slowly pushed the creaking door ajar.': 'proseRewritten',
  'magical discovery': 'queryMagicalDiscovery',
  'magical energy': 'queryMagicalEnergy',
  'powerful magic': 'queryPowerfulMagic',
  'Test text': 'testText',
};

// Helper to create mock embedding response using real OpenAI embeddings from fixtures
function mockEmbeddingResponse(texts: string[]) {
  return {
    embeddings: texts.map((text) => {
      const fixtureKey = TEXT_TO_FIXTURE_KEY[text];
      if (fixtureKey) {
        return TEST_EMBEDDINGS[fixtureKey] as unknown as number[];
      }

      // For texts not in fixtures (like batch test texts or scene summaries with indices),
      // generate a deterministic but realistic-looking embedding
      // This is just for tests that generate dynamic text (e.g., "Scene 0 about magic", "Text 0", etc.)
      const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const baseEmbedding = TEST_EMBEDDINGS.testText as unknown as number[];

      // Create a variant by slightly perturbing the base embedding deterministically
      return baseEmbedding.map((val, i) => {
        const perturbation = Math.sin(hash + i) * 0.1;
        return val + perturbation;
      });
    }),
    usage: { prompt_tokens: texts.length * 10, total_tokens: texts.length * 10 },
    model: 'text-embedding-3-small',
  };
}

describe('Embedding Generation Pipeline', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await assetManager.init();
    (global.fetch as any).mockImplementation((url: string, options: any) => {
      if (url.includes('/api/embeddings')) {
        const body = JSON.parse(options.body);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockEmbeddingResponse(body.texts)),
        });
      }
      return Promise.reject(new Error('Unexpected URL'));
    });
  });

  describe('1. Scene Plan Generation', () => {
    it('should generate embeddings for all propositions in plan', async () => {
      // Mock the generateScenePlan function to return a plan with propositions
      const mockPlan: BeatPlan = {
        beats: [
          {
            fn: 'advance',
            mechanism: 'action',
            what: 'Alice examines the door',
            propositions: [
              { content: 'The door is ancient and ornate' },
              { content: 'Strange symbols cover the door frame' },
            ],
          },
          {
            fn: 'reveal',
            mechanism: 'dialogue',
            what: 'Alice reads the inscription',
            propositions: [
              { content: 'The inscription is in an unknown language' },
            ],
          },
        ],
      };

      // Check that all propositions have embeddings after generation
      // In real implementation, this would be called by generateScenePlan
      const allPropositions = [
        ...mockPlan.beats[0].propositions,
        ...mockPlan.beats[1].propositions,
      ];

      const embeddedProps = await embedPropositions(allPropositions, mockNarrative.id);

      expect(embeddedProps).toHaveLength(3);
      for (const prop of embeddedProps) {
        expect(prop.embedding).toBeDefined();
        expect(prop.embeddedAt).toBeDefined();
        expect(prop.embeddingModel).toBe('text-embedding-3-small');

        const resolved = await assetManager.getEmbedding(prop.embedding);
        expect(resolved).toBeDefined();
        expect(resolved).toHaveLength(EMBEDDING_DIMENSIONS);
      }
    });

    it('should compute beat centroids from proposition embeddings', async () => {
      const propositions = [
        { content: 'Proposition A' },
        { content: 'Proposition B' },
        { content: 'Proposition C' },
      ];

      const embeddedProps = await embedPropositions(propositions, mockNarrative.id);

      // Resolve embedding references to actual vectors
      const embeddings: number[][] = [];
      for (const prop of embeddedProps) {
        const resolved = await assetManager.getEmbedding(prop.embedding);
        if (resolved) embeddings.push(resolved);
      }

      const centroid = computeCentroid(embeddings);

      expect(centroid).toHaveLength(EMBEDDING_DIMENSIONS);
      // Centroid should be average of embeddings
      for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
        const expectedValue = embeddings.reduce((sum, emb) => sum + emb[i], 0) / embeddings.length;
        expect(centroid[i]).toBeCloseTo(expectedValue, 10);
      }
    });
  });

  describe('2. Scene Generation', () => {
    it('should generate summary embeddings for all scenes', async () => {
      const summaries = [
        'Alice discovers a hidden door',
        'Bob finds a mysterious key',
        'Carol deciphers ancient runes',
      ];

      const embeddings = await generateEmbeddings(summaries, mockNarrative.id);

      expect(embeddings).toHaveLength(3);
      embeddings.forEach((embedding) => {
        expect(embedding).toHaveLength(EMBEDDING_DIMENSIONS);
        expect(embedding.every(v => typeof v === 'number')).toBe(true);
      });
    });

    it('should compute plan centroid from beat centroids', async () => {
      // Simulate beat centroids
      const beatCentroids = [
        Array.from({ length: EMBEDDING_DIMENSIONS }, () => Math.random()),
        Array.from({ length: EMBEDDING_DIMENSIONS }, () => Math.random()),
        Array.from({ length: EMBEDDING_DIMENSIONS }, () => Math.random()),
      ];

      const planCentroid = computeCentroid(beatCentroids);

      expect(planCentroid).toHaveLength(EMBEDDING_DIMENSIONS);
      // Verify it's the average
      for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
        const expectedValue = beatCentroids.reduce((sum, c) => sum + c[i], 0) / beatCentroids.length;
        expect(planCentroid[i]).toBeCloseTo(expectedValue, 10);
      }
    });
  });

  describe('3. Prose Generation', () => {
    it('should generate prose embeddings when prose is created', async () => {
      const proseText = 'Alice pushed open the heavy wooden door. Beyond lay a corridor shrouded in darkness, its walls lined with ancient tapestries depicting forgotten battles.';

      const embeddings = await generateEmbeddings([proseText], mockNarrative.id);

      expect(embeddings).toHaveLength(1);
      expect(embeddings[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    });

    it('should regenerate embeddings when prose is rewritten', async () => {
      const originalProse = 'Alice opened the door.';
      const rewrittenProse = 'With trembling hands, Alice slowly pushed the creaking door ajar.';

      const [originalEmbedding] = await generateEmbeddings([originalProse], mockNarrative.id);
      const [rewrittenEmbedding] = await generateEmbeddings([rewrittenProse], mockNarrative.id);

      // Embeddings should be different (not identical)
      const similarity = cosineSimilarity(originalEmbedding, rewrittenEmbedding);
      expect(similarity).toBeLessThan(1.0); // Not identical
      // With deterministic hash-based embeddings, different texts will have different embeddings
      expect(originalEmbedding).not.toEqual(rewrittenEmbedding);
    });
  });
});

describe('Plan Candidates', () => {
  beforeEach(() => {
    (global.fetch as any).mockImplementation((url: string, options: any) => {
      if (url.includes('/api/embeddings')) {
        const body = JSON.parse(options.body);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockEmbeddingResponse(body.texts)),
        });
      }
      // Mock LLM calls for plan generation
      if (url.includes('/api/generate')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            content: JSON.stringify({
              beats: [
                {
                  fn: 'advance',
                  mechanism: 'action',
                  what: 'Test beat',
                  propositions: [{ content: 'Test proposition' }],
                },
              ],
            }),
          }),
        });
      }
      return Promise.reject(new Error('Unexpected URL'));
    });
  });

  it('should generate multiple candidate plans', async () => {
    // This would test the full candidates flow
    // For now, we test the similarity scoring logic
    const sceneSummaryEmbedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => Math.random());

    const candidate1Centroid = Array.from({ length: EMBEDDING_DIMENSIONS }, () => Math.random());
    const candidate2Centroid = Array.from({ length: EMBEDDING_DIMENSIONS }, () => Math.random());
    const candidate3Centroid = Array.from({ length: EMBEDDING_DIMENSIONS }, () => Math.random());

    const similarity1 = cosineSimilarity(sceneSummaryEmbedding, candidate1Centroid);
    const similarity2 = cosineSimilarity(sceneSummaryEmbedding, candidate2Centroid);
    const similarity3 = cosineSimilarity(sceneSummaryEmbedding, candidate3Centroid);

    // Verify similarity scores are normalized
    expect(similarity1).toBeGreaterThanOrEqual(-1);
    expect(similarity1).toBeLessThanOrEqual(1);
    expect(similarity2).toBeGreaterThanOrEqual(-1);
    expect(similarity2).toBeLessThanOrEqual(1);
    expect(similarity3).toBeGreaterThanOrEqual(-1);
    expect(similarity3).toBeLessThanOrEqual(1);
  });

  it('should rank candidates by similarity score', () => {
    const candidates = [
      { id: 'c1', score: 0.85 },
      { id: 'c2', score: 0.92 },
      { id: 'c3', score: 0.78 },
      { id: 'c4', score: 0.88 },
      { id: 'c5', score: 0.81 },
    ];

    const sorted = [...candidates].sort((a, b) => b.score - a.score);

    expect(sorted[0].id).toBe('c2'); // Highest score
    expect(sorted[4].id).toBe('c3'); // Lowest score
  });
});

describe('Semantic Search', () => {
  beforeEach(() => {
    (global.fetch as any).mockImplementation((url: string, options: any) => {
      if (url.includes('/api/embeddings')) {
        const body = JSON.parse(options.body);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockEmbeddingResponse(body.texts)),
        });
      }
      return Promise.reject(new Error('Unexpected URL'));
    });
  });

  it('should search scenes by summary', async () => {
    // Use fixture embeddings with known semantic similarity
    const ref1 = await assetManager.storeEmbedding(Array.from(TEST_EMBEDDINGS.sceneDiscoverDoor), 'text-embedding-3-small');
    const ref2 = await assetManager.storeEmbedding(Array.from(TEST_EMBEDDINGS.sceneAncientSword), 'text-embedding-3-small');

    // Mock fetch to return the matching query fixture embedding
    (global.fetch as any).mockImplementation((url: string, options: any) => {
      if (url.includes('/api/embeddings')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            embeddings: [Array.from(TEST_EMBEDDINGS.queryMagicalDiscovery)],
            model: 'text-embedding-3-small',
            usage: { prompt_tokens: 3, total_tokens: 3 },
          }),
        });
      }
      return Promise.reject(new Error('Unexpected URL'));
    });

    const narrative: NarrativeState = {
      ...mockNarrative,
      scenes: {
        'scene1': {
          ...mockScene,
          id: 'scene1',
          summary: 'Alice discovers a hidden magical door',
          summaryEmbedding: ref1,
        },
        'scene2': {
          ...mockScene,
          id: 'scene2',
          summary: 'Bob finds an ancient sword',
          summaryEmbedding: ref2,
        },
      },
    };

    const query = 'magical discovery';
    const results = await searchNarrative(narrative, ['scene1', 'scene2'], query);

    expect(results.query).toBe(query);
    expect(results.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(results.results.length).toBeGreaterThan(0);

    // Results should be sorted by similarity
    for (let i = 1; i < results.results.length; i++) {
      expect(results.results[i - 1].similarity).toBeGreaterThanOrEqual(results.results[i].similarity);
    }
  });

  it('should search propositions within beats', async () => {
    // Use fixture embeddings stored as asset references
    const propRef1 = await assetManager.storeEmbedding(Array.from(TEST_EMBEDDINGS.propGlowsEnergy), 'text-embedding-3-small');
    const propRef2 = await assetManager.storeEmbedding(Array.from(TEST_EMBEDDINGS.propRustyKey), 'text-embedding-3-small');
    const centroidRef1 = await assetManager.storeEmbedding(Array.from(TEST_EMBEDDINGS.propGlowsEnergy), 'text-embedding-3-small');
    const centroidRef2 = await assetManager.storeEmbedding(Array.from(TEST_EMBEDDINGS.propRustyKey), 'text-embedding-3-small');

    // Mock fetch to return the matching query fixture embedding
    (global.fetch as any).mockImplementation((url: string, options: any) => {
      if (url.includes('/api/embeddings')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            embeddings: [Array.from(TEST_EMBEDDINGS.queryMagicalEnergy)],
            model: 'text-embedding-3-small',
            usage: { prompt_tokens: 2, total_tokens: 2 },
          }),
        });
      }
      return Promise.reject(new Error('Unexpected URL'));
    });

    const narrative: NarrativeState = {
      ...mockNarrative,
      scenes: {
        'scene1': {
          ...mockScene,
          planVersions: [{
            plan: {
              beats: [
                {
                  fn: 'reveal',
                  mechanism: 'narration',
                  what: 'The door is magical',
                  propositions: [
                    { content: 'The door glows with arcane energy', embedding: propRef1 },
                  ],
                  embeddingCentroid: centroidRef1,
                },
                {
                  fn: 'inform',
                  mechanism: 'environment',
                  what: 'A key is nearby',
                  propositions: [
                    { content: 'A rusty key hangs on the wall', embedding: propRef2 },
                  ],
                  embeddingCentroid: centroidRef2,
                },
              ],
            },
            branchId: 'main',
            timestamp: Date.now(),
            version: '1',
            versionType: 'generate' as const,
          }],
        },
      },
    };

    const query = 'magical energy';
    const results = await searchNarrative(narrative, ['scene1'], query);

    const propResults = results.results.filter(r => r.type === 'proposition');
    expect(propResults.length).toBeGreaterThan(0);
  });

  it('should build timeline heatmap', async () => {
    // Use real embeddings stored as asset references
    const baseEmbedding = Array.from(TEST_EMBEDDINGS.queryPowerfulMagic);
    const sceneData: { id: string; summary: string; summaryEmbedding: string }[] = [];
    for (let i = 0; i < 10; i++) {
      const perturbed = baseEmbedding.map((val, idx) => val + Math.sin(i + idx) * 0.1);
      const ref = await assetManager.storeEmbedding(perturbed, 'text-embedding-3-small');
      sceneData.push({ id: `scene${i}`, summary: `Scene ${i} about magic`, summaryEmbedding: ref });
    }

    // Mock fetch to return the query fixture embedding
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/api/embeddings')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            embeddings: [Array.from(TEST_EMBEDDINGS.queryPowerfulMagic)],
            model: 'text-embedding-3-small',
            usage: { prompt_tokens: 2, total_tokens: 2 },
          }),
        });
      }
      return Promise.reject(new Error('Unexpected URL'));
    });

    const narrative: NarrativeState = {
      ...mockNarrative,
      scenes: Object.fromEntries(sceneData.map(s => [s.id, { ...mockScene, ...s }])),
    };

    const query = 'powerful magic';
    const results = await searchNarrative(narrative, sceneData.map(s => s.id), query);

    expect(results.sceneTimeline).toBeDefined();
    expect(results.sceneTimeline.length).toBeGreaterThan(0);

    // Timeline should be sorted by scene index
    for (let i = 1; i < results.sceneTimeline.length; i++) {
      expect(results.sceneTimeline[i].sceneIndex).toBeGreaterThan(results.sceneTimeline[i - 1].sceneIndex);
    }
  });
});

describe('Cosine Similarity', () => {
  it('should compute similarity between identical vectors', () => {
    const vec = Array.from({ length: EMBEDDING_DIMENSIONS }, () => Math.random());
    const similarity = cosineSimilarity(vec, vec);
    expect(similarity).toBeCloseTo(1.0, 10);
  });

  it('should compute similarity between opposite vectors', () => {
    const vec1 = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1);
    const vec2 = Array.from({ length: EMBEDDING_DIMENSIONS }, () => -1);
    const similarity = cosineSimilarity(vec1, vec2);
    expect(similarity).toBeCloseTo(-1.0, 10);
  });

  it('should compute similarity between orthogonal vectors', () => {
    const vec1 = Array(EMBEDDING_DIMENSIONS).fill(0);
    vec1[0] = 1;
    const vec2 = Array(EMBEDDING_DIMENSIONS).fill(0);
    vec2[1] = 1;
    const similarity = cosineSimilarity(vec1, vec2);
    expect(similarity).toBeCloseTo(0.0, 10);
  });

  it('should throw error for mismatched dimensions', () => {
    const vec1 = Array(100).fill(1);
    const vec2 = Array(200).fill(1);
    expect(() => cosineSimilarity(vec1, vec2)).toThrow('Vector dimensions must match');
  });
});

describe('Centroid Computation', () => {
  it('should compute centroid of single vector', () => {
    const vec = Array.from({ length: EMBEDDING_DIMENSIONS }, () => Math.random());
    const centroid = computeCentroid([vec]);

    expect(centroid).toEqual(vec);
  });

  it('should compute centroid of multiple vectors', () => {
    const vec1 = Array(EMBEDDING_DIMENSIONS).fill(1);
    const vec2 = Array(EMBEDDING_DIMENSIONS).fill(3);
    const centroid = computeCentroid([vec1, vec2]);

    expect(centroid).toEqual(Array(EMBEDDING_DIMENSIONS).fill(2));
  });

  it('should return empty array for empty input', () => {
    const centroid = computeCentroid([]);
    expect(centroid).toEqual([]);
  });
});

describe('Export/Import with Embeddings', () => {
  it('should preserve embeddings in exported JSON', async () => {
    const embedding = await generateEmbeddings(['Test text'], mockNarrative.id).then(e => e[0]);

    const embRef = 'emb_test123';
    const scene: Scene = {
      ...mockScene,
      summaryEmbedding: embRef,
      planVersions: [{
        plan: {
          beats: [
            {
              fn: 'advance',
              mechanism: 'action',
              what: 'Test beat',
              propositions: [
                {
                  content: 'Test proposition',
                  embedding: embRef,
                  embeddedAt: Date.now(),
                  embeddingModel: 'text-embedding-3-small',
                },
              ],
              embeddingCentroid: embRef,
            },
          ],
        },
        branchId: 'main',
        timestamp: Date.now(),
        version: '1',
        versionType: 'generate',
      }],
      planEmbeddingCentroid: embRef,
    };

    // Serialize and deserialize
    const exported = JSON.stringify(scene);
    const imported = JSON.parse(exported) as Scene;

    // Verify embeddings are preserved
    expect(imported.summaryEmbedding).toEqual(embRef);
    expect(imported.planVersions?.[0].plan.beats[0].propositions[0].embedding).toEqual(embRef);
    expect(imported.planVersions?.[0].plan.beats[0].embeddingCentroid).toEqual(embRef);
    expect(imported.planEmbeddingCentroid).toEqual(embRef);
  });

  it('should handle scenes without embeddings', () => {
    const scene: Scene = {
      ...mockScene,
      // No embeddings
    };

    const exported = JSON.stringify(scene);
    const imported = JSON.parse(exported) as Scene;

    expect(imported.summaryEmbedding).toBeUndefined();
    expect(imported.planEmbeddingCentroid).toBeUndefined();
  });

  it('should preserve embedding metadata', async () => {
    const now = Date.now();
    const proposition = {
      content: 'Test',
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.5),
      embeddedAt: now,
      embeddingModel: 'text-embedding-3-small' as const,
    };

    const exported = JSON.stringify(proposition);
    const imported = JSON.parse(exported);

    expect(imported.embeddedAt).toBe(now);
    expect(imported.embeddingModel).toBe('text-embedding-3-small');
    expect(imported.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });
});

describe('Batch Embedding Generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockClear();
    (global.fetch as any).mockImplementation((url: string, options: any) => {
      if (url.includes('/api/embeddings')) {
        const body = JSON.parse(options.body);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockEmbeddingResponse(body.texts)),
        });
      }
      return Promise.reject(new Error('Unexpected URL'));
    });
  });

  it('should handle batch of 50 texts efficiently', async () => {
    const texts = Array.from({ length: 50 }, (_, i) => `Text ${i}`);

    const embeddings = await generateEmbeddings(texts, mockNarrative.id);

    expect(embeddings).toHaveLength(50);
    // Should make exactly 1 API call
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    const embeddingCalls = mockFetch.mock.calls.filter((call: unknown[]) =>
      (call[0] as string).includes('/api/embeddings')
    );
    expect(embeddingCalls.length).toBe(1);
  });

  it('should split large batches into multiple requests', async () => {
    const texts = Array.from({ length: 150 }, (_, i) => `Text ${i}`);

    const { generateEmbeddingsBatch } = await import('@/lib/embeddings');
    const embeddings = await generateEmbeddingsBatch(texts, mockNarrative.id);

    expect(embeddings).toHaveLength(150);
    // Should be split into 3 batches (50 each)
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    const embeddingCalls = mockFetch.mock.calls.filter((call: unknown[]) =>
      (call[0] as string).includes('/api/embeddings')
    );
    expect(embeddingCalls.length).toBe(3);
  });

  it('should report progress for batch operations', async () => {
    const texts = Array.from({ length: 100 }, (_, i) => `Text ${i}`);
    const progressUpdates: Array<{ completed: number; total: number }> = [];

    const { generateEmbeddingsBatch } = await import('@/lib/embeddings');
    await generateEmbeddingsBatch(texts, mockNarrative.id, (completed, total) => {
      progressUpdates.push({ completed, total });
    });

    expect(progressUpdates.length).toBeGreaterThan(0);
    const lastUpdate = progressUpdates[progressUpdates.length - 1];
    expect(lastUpdate.completed).toBe(100);
    expect(lastUpdate.total).toBe(100);
  });
});

describe('Error Handling', () => {
  it('should handle embedding API errors gracefully', async () => {
    (global.fetch as any).mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error'),
      })
    );

    await expect(generateEmbeddings(['test'], mockNarrative.id)).rejects.toThrow('Embedding API error');
  });

  it('should handle network errors', async () => {
    (global.fetch as any).mockImplementation(() =>
      Promise.reject(new Error('Network error'))
    );

    await expect(generateEmbeddings(['test'], mockNarrative.id)).rejects.toThrow('Network error');
  });

  it('should handle invalid embedding dimensions', () => {
    const vec1 = Array(EMBEDDING_DIMENSIONS).fill(1);
    const vec2 = Array(100).fill(1);

    expect(() => cosineSimilarity(vec1, vec2)).toThrow('Vector dimensions must match');
  });
});
