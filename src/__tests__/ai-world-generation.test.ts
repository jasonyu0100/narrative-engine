import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NarrativeState, Character, Location, Thread } from '@/types/narrative';

// Mock the AI API layer
vi.mock('@/lib/ai/api', () => ({
  callGenerate: vi.fn(),
  callGenerateStream: vi.fn(),
  SYSTEM_PROMPT: 'Test system prompt',
}));

// Mock narrative context (not relevant to the paths under test)
vi.mock('@/lib/ai/context', () => ({
  narrativeContext: vi.fn().mockReturnValue('Mock narrative context'),
}));

// Mock prompts
vi.mock('@/lib/ai/prompts', () => ({
  PROMPT_FORCE_STANDARDS: 'Mock force standards',
  PROMPT_STRUCTURAL_RULES: 'Mock structural rules',
  PROMPT_MUTATIONS: 'Mock mutations',
  PROMPT_POV: 'Mock POV',
  PROMPT_CONTINUITY: 'Mock continuity',
  PROMPT_SUMMARY_REQUIREMENT: 'Mock summary requirement',
  PROMPT_ENTITY_INTEGRATION: 'Mock entity integration',
}));

// Mock pacing-profile to avoid unrelated markov chain logic
vi.mock('@/lib/pacing-profile', () => ({
  buildSequencePrompt: vi.fn().mockReturnValue('Mock sequence prompt'),
  buildIntroductionSequence: vi.fn().mockReturnValue({
    steps: [],
    pacingDescription: 'Test pacing',
  }),
}));

// Mock embeddings — they hit a network endpoint that isn't available in tests.
vi.mock('@/lib/embeddings', () => ({
  generateEmbeddingsBatch: vi.fn().mockResolvedValue([]),
  computeCentroid: vi.fn().mockReturnValue([]),
  resolveEmbedding: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/asset-manager', () => ({
  assetManager: {
    storeEmbedding: vi.fn().mockResolvedValue('emb-1'),
  },
}));

import { expandWorld, generateNarrative } from '@/lib/ai/world';
import { callGenerate, callGenerateStream } from '@/lib/ai/api';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createCharacter(id: string, overrides: Partial<Character> = {}): Character {
  return {
    id,
    name: `Character ${id}`,
    role: 'recurring',
    threadIds: [],
    continuity: { nodes: {}, edges: [] },
    ...overrides,
  };
}

function createLocation(id: string, overrides: Partial<Location> = {}): Location {
  return {
    id,
    name: `Location ${id}`,
    prominence: 'place',
    parentId: null,
    tiedCharacterIds: [],
    threadIds: [],
    continuity: { nodes: {}, edges: [] },
    ...overrides,
  };
}

function createThread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    description: `Thread ${id}`,
    status: 'active',
    participants: [],
    dependents: [],
    openedAt: 's1',
    threadLog: { nodes: {}, edges: [] },
    ...overrides,
  };
}

function createMinimalNarrative(): NarrativeState {
  return {
    id: 'N-001',
    title: 'Test Narrative',
    description: 'A test story',
    characters: { 'C-01': createCharacter('C-01', { name: 'Alice' }) },
    locations: { 'L-01': createLocation('L-01', { name: 'Castle' }) },
    threads: { 'T-01': createThread('T-01', { description: 'Main quest' }) },
    artifacts: {},
    scenes: {},
    arcs: {},
    worldBuilds: {},
    branches: {
      main: {
        id: 'main', name: 'Main', parentBranchId: null, forkEntryId: null,
        entryIds: [], createdAt: Date.now(),
      },
    },
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: '',
    rules: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── expandWorld: world knowledge mutation handling ──────────────────────────

describe('expandWorld — systemMutations', () => {
  const baseExpansion = {
    characters: [],
    locations: [],
    threads: [],
    relationships: [],
    artifacts: [],
    ownershipMutations: [],
    tieMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
  };

  it('assigns fresh WK ids to new concepts', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      systemMutations: {
        addedNodes: [
          { id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'system' },
          { id: 'SYS-GEN-2', concept: 'Leylines', type: 'concept' },
        ],
        addedEdges: [{ from: 'SYS-GEN-2', to: 'SYS-GEN-1', relation: 'enables' }],
      },
    }));

    const narrative = createMinimalNarrative();
    const result = await expandWorld(narrative, [], 0, 'Expand the magic system');

    const wkm = result.systemMutations!;
    expect(wkm.addedNodes).toHaveLength(2);
    expect(wkm.addedNodes.map((n) => n.id)).toEqual(['SYS-01', 'SYS-02']);
    expect(wkm.addedEdges).toHaveLength(1);
    expect(wkm.addedEdges[0]).toEqual({ from: 'SYS-02', to: 'SYS-01', relation: 'enables' });
  });

  it('collapses re-mentioned concepts to existing SYS ids', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      systemMutations: {
        addedNodes: [
          { id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'principle' },
          { id: 'SYS-GEN-2', concept: 'Blood Runes', type: 'concept' },
        ],
        addedEdges: [{ from: 'SYS-GEN-2', to: 'SYS-GEN-1', relation: 'requires' }],
      },
    }));

    const narrative = createMinimalNarrative();
    // Pre-existing concept.
    narrative.systemGraph = {
      nodes: { 'WK-42': { id: 'WK-42', concept: 'Mana Binding', type: 'system' } },
      edges: [],
    };
    const result = await expandWorld(narrative, [], 0, 'Expand');

    const wkm = result.systemMutations!;
    // Only Blood Runes is genuinely new; Mana Binding collapses to WK-42.
    expect(wkm.addedNodes).toHaveLength(1);
    expect(wkm.addedNodes[0].concept).toBe('Blood Runes');
    // Edge now references the existing id.
    expect(wkm.addedEdges[0]).toEqual({
      from: wkm.addedNodes[0].id,
      to: 'WK-42',
      relation: 'requires',
    });
  });

  it('filters self-loops', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      systemMutations: {
        addedNodes: [
          { id: 'SYS-GEN-1', concept: 'Mana', type: 'concept' },
          { id: 'SYS-GEN-2', concept: 'Runes', type: 'concept' },
        ],
        addedEdges: [
          { from: 'SYS-GEN-1', to: 'SYS-GEN-1', relation: 'enables' },
          { from: 'SYS-GEN-1', to: 'SYS-GEN-2', relation: 'enables' },
        ],
      },
    }));

    const narrative = createMinimalNarrative();
    const result = await expandWorld(narrative, [], 0, 'Expand');

    const edges = result.systemMutations!.addedEdges;
    expect(edges).toHaveLength(1);
    expect(edges[0].from).not.toBe(edges[0].to);
  });

  it('drops edges that duplicate ones already in the existing graph', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      systemMutations: {
        addedNodes: [{ id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'system' }],
        // Tries to re-add an edge that already exists.
        addedEdges: [{ from: 'SYS-GEN-1', to: 'WK-99', relation: 'enables' }],
      },
    }));

    const narrative = createMinimalNarrative();
    narrative.systemGraph = {
      nodes: {
        'WK-99': { id: 'WK-99', concept: 'Pre-existing', type: 'concept' },
      },
      edges: [],
    };
    const result = await expandWorld(narrative, [], 0, 'Expand');

    expect(result.systemMutations!.addedNodes).toHaveLength(1);
    expect(result.systemMutations!.addedEdges).toHaveLength(1);
  });
});

// ── expandWorld: entity continuity normalization + chaining ─────────────────

describe('expandWorld — entity continuity', () => {
  const baseExpansion = {
    locations: [],
    threads: [],
    relationships: [],
    artifacts: [],
    ownershipMutations: [],
    tieMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    systemMutations: { addedNodes: [], addedEdges: [] },
  };

  it('normalizes LLM array-shaped character continuity into a Record', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      characters: [
        {
          id: 'C-02', name: 'Bob', role: 'recurring', threadIds: [],
          // LLM emits nodes as an array (the common shape in practice).
          continuity: {
            nodes: [
              { id: 'K-01', content: 'Former soldier', type: 'history' },
              { id: 'K-02', content: 'Carries a grudge', type: 'belief' },
              { id: 'K-03', content: 'Skilled swordsman', type: 'capability' },
            ],
          },
        },
      ],
    }));

    const narrative = createMinimalNarrative();
    const result = await expandWorld(narrative, [], 0, 'Add Bob');

    const bob = result.characters[0];
    // nodes is now a Record keyed by id, not an array with numeric keys.
    expect(bob.continuity.nodes['K-01']).toBeDefined();
    expect(bob.continuity.nodes['K-02']).toBeDefined();
    expect(bob.continuity.nodes['K-03']).toBeDefined();
    expect(Object.keys(bob.continuity.nodes).sort()).toEqual(['K-01', 'K-02', 'K-03']);
  });

  it('chains initial character continuity nodes via co_occurs edges', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      characters: [
        {
          id: 'C-02', name: 'Bob', role: 'recurring', threadIds: [],
          continuity: {
            nodes: [
              { id: 'K-01', content: 'Former soldier', type: 'history' },
              { id: 'K-02', content: 'Carries a grudge', type: 'belief' },
              { id: 'K-03', content: 'Skilled swordsman', type: 'capability' },
            ],
          },
        },
      ],
    }));

    const narrative = createMinimalNarrative();
    const result = await expandWorld(narrative, [], 0, 'Add Bob');

    const bob = result.characters[0];
    // 3 nodes → 2 co_occurs chain edges
    const coOccursEdges = bob.continuity.edges.filter((e) => e.relation === 'co_occurs');
    expect(coOccursEdges).toHaveLength(2);
    expect(coOccursEdges[0]).toEqual({ from: 'K-01', to: 'K-02', relation: 'co_occurs' });
    expect(coOccursEdges[1]).toEqual({ from: 'K-02', to: 'K-03', relation: 'co_occurs' });
  });

  it('normalizes location and artifact continuity with the same contract', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      characters: [],
      locations: [
        {
          id: 'L-02', name: 'Forest', prominence: 'place', parentId: null, threadIds: [],
          continuity: {
            nodes: [
              { id: 'LK-01', content: 'Ancient grove', type: 'trait' },
              { id: 'LK-02', content: 'Haunted by spirits', type: 'state' },
            ],
          },
        },
      ],
      artifacts: [
        {
          id: 'A-01', name: 'Sword', significance: 'key', threadIds: [], parentId: null,
          continuity: {
            nodes: [
              { id: 'AK-01', content: 'Forged in dragonfire', type: 'history' },
              { id: 'AK-02', content: 'Cuts through stone', type: 'capability' },
            ],
          },
        },
      ],
    }));

    const narrative = createMinimalNarrative();
    const result = await expandWorld(narrative, [], 0, 'Add stuff');

    // Location continuity normalized + chained
    const forest = result.locations[0];
    expect(forest.continuity.nodes['LK-01']).toBeDefined();
    expect(forest.continuity.nodes['LK-02']).toBeDefined();
    expect(forest.continuity.edges.filter((e) => e.relation === 'co_occurs')).toHaveLength(1);

    // Artifact continuity normalized + chained
    const sword = result.artifacts![0];
    expect(sword.continuity.nodes['AK-01']).toBeDefined();
    expect(sword.continuity.nodes['AK-02']).toBeDefined();
    expect(sword.continuity.edges.filter((e) => e.relation === 'co_occurs')).toHaveLength(1);
  });

  it('handles missing continuity gracefully', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      characters: [
        { id: 'C-02', name: 'Bob', role: 'transient', threadIds: [] /* no continuity */ },
      ],
    }));

    const narrative = createMinimalNarrative();
    const result = await expandWorld(narrative, [], 0, 'Add Bob');

    const bob = result.characters[0];
    expect(bob.continuity).toEqual({ nodes: {}, edges: [] });
  });

  it('assigns fallback ids to nodes missing ids', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseExpansion,
      characters: [
        {
          id: 'C-02', name: 'Bob', role: 'recurring', threadIds: [],
          continuity: {
            nodes: [
              { content: 'Former soldier', type: 'history' },
              { content: 'Carries a grudge', type: 'belief' },
            ],
          },
        },
      ],
    }));

    const narrative = createMinimalNarrative();
    const result = await expandWorld(narrative, [], 0, 'Add Bob');

    const bob = result.characters[0];
    const ids = Object.keys(bob.continuity.nodes);
    expect(ids).toHaveLength(2);
    // Fallback ids should still be unique and produce a valid chain.
    expect(new Set(ids).size).toBe(2);
    expect(bob.continuity.edges.filter((e) => e.relation === 'co_occurs')).toHaveLength(1);
  });
});

// ── generateNarrative: initial world generation ─────────────────────────────

describe('generateNarrative — systemGraph + initial continuity', () => {
  function baseWorld() {
    return {
      worldSummary: 'A test world',
      imageStyle: 'test style',
      characters: [],
      locations: [],
      threads: [],
      relationships: [],
      artifacts: [],
      scenes: [],
      arcs: [],
      rules: [],
      worldSystems: [],
    };
  }

  it('collapses concepts re-mentioned across initial scenes to one SYS node', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseWorld(),
      characters: [
        { id: 'C-01', name: 'Alice', role: 'anchor', threadIds: [] },
      ],
      locations: [
        { id: 'L-01', name: 'Castle', prominence: 'place', parentId: null, threadIds: [] },
      ],
      threads: [
        { id: 'T-01', participants: [{ id: 'C-01', type: 'character' }], description: 'Quest', status: 'latent', openedAt: 'S-001', dependents: [] },
      ],
      scenes: [
        {
          id: 'S-001', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01',
          participantIds: ['C-01'], events: [],
          threadMutations: [], continuityMutations: [], relationshipMutations: [],
          systemMutations: {
            addedNodes: [{ id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'system' }],
            addedEdges: [],
          },
          summary: 'Alice learns of mana binding.',
        },
        {
          id: 'S-002', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01',
          participantIds: ['C-01'], events: [],
          threadMutations: [], continuityMutations: [], relationshipMutations: [],
          systemMutations: {
            addedNodes: [{ id: 'SYS-GEN-2', concept: 'mana binding', type: 'principle' }],
            addedEdges: [],
          },
          summary: 'Alice practises mana binding.',
        },
      ],
      arcs: [
        { id: 'ARC-01', name: 'Introduction', sceneIds: ['S-001', 'S-002'], develops: ['T-01'], locationIds: ['L-01'], activeCharacterIds: ['C-01'], initialCharacterLocations: { 'C-01': 'L-01' } },
      ],
    }));

    const result = await generateNarrative('Test', 'A story about magic');

    // The re-mentioned concept does not earn a second WK node.
    expect(Object.keys(result.systemGraph!.nodes)).toHaveLength(1);
    const [wk] = Object.values(result.systemGraph!.nodes);
    expect(wk.concept).toBe('Mana Binding');

    // Scene 1 owns the node, scene 2 does not.
    const s1 = result.scenes['S-001'];
    const s2 = result.scenes['S-002'];
    expect(s1.systemMutations!.addedNodes).toHaveLength(1);
    expect(s2.systemMutations!.addedNodes).toHaveLength(0);
  });

  it('normalizes and chains initial character continuity', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseWorld(),
      characters: [
        {
          id: 'C-01', name: 'Alice', role: 'anchor', threadIds: [],
          continuity: {
            nodes: [
              { id: 'K-01', content: 'Royal heir', type: 'history' },
              { id: 'K-02', content: 'Reluctant leader', type: 'trait' },
              { id: 'K-03', content: 'Fears fire', type: 'weakness' },
            ],
          },
        },
      ],
      locations: [
        { id: 'L-01', name: 'Castle', prominence: 'place', parentId: null, threadIds: [] },
      ],
      threads: [
        { id: 'T-01', participants: [{ id: 'C-01', type: 'character' }], description: 'Quest', status: 'latent', openedAt: 'S-001', dependents: [] },
      ],
      scenes: [
        {
          id: 'S-001', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01',
          participantIds: ['C-01'], events: [],
          threadMutations: [], continuityMutations: [], relationshipMutations: [],
          summary: 'Alice arrives.',
        },
      ],
      arcs: [
        { id: 'ARC-01', name: 'Intro', sceneIds: ['S-001'], develops: ['T-01'], locationIds: ['L-01'], activeCharacterIds: ['C-01'], initialCharacterLocations: { 'C-01': 'L-01' } },
      ],
    }));

    const result = await generateNarrative('Test', 'A story');

    const alice = result.characters['C-01'];
    // Nodes became a Record keyed by id, not an array.
    expect(alice.continuity.nodes['K-01']).toBeDefined();
    expect(alice.continuity.nodes['K-02']).toBeDefined();
    expect(alice.continuity.nodes['K-03']).toBeDefined();
    // 3 nodes → 2 co_occurs chain edges
    expect(alice.continuity.edges.filter((e) => e.relation === 'co_occurs')).toHaveLength(2);
  });

  it('filters self-loops from initial world knowledge edges', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseWorld(),
      characters: [
        { id: 'C-01', name: 'Alice', role: 'anchor', threadIds: [] },
      ],
      locations: [
        { id: 'L-01', name: 'Castle', prominence: 'place', parentId: null, threadIds: [] },
      ],
      threads: [
        { id: 'T-01', participants: [{ id: 'C-01', type: 'character' }], description: 'Quest', status: 'latent', openedAt: 'S-001', dependents: [] },
      ],
      scenes: [
        {
          id: 'S-001', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01',
          participantIds: ['C-01'], events: [],
          threadMutations: [], continuityMutations: [], relationshipMutations: [],
          systemMutations: {
            addedNodes: [
              { id: 'SYS-GEN-1', concept: 'Mana', type: 'concept' },
              { id: 'SYS-GEN-2', concept: 'Runes', type: 'concept' },
            ],
            addedEdges: [
              { from: 'SYS-GEN-1', to: 'SYS-GEN-1', relation: 'enables' }, // self-loop
              { from: 'SYS-GEN-1', to: 'SYS-GEN-2', relation: 'enables' },
            ],
          },
          summary: 'Mana flows through runes.',
        },
      ],
      arcs: [
        { id: 'ARC-01', name: 'Intro', sceneIds: ['S-001'], develops: ['T-01'], locationIds: ['L-01'], activeCharacterIds: ['C-01'], initialCharacterLocations: { 'C-01': 'L-01' } },
      ],
    }));

    const result = await generateNarrative('Test', 'A story');

    expect(result.systemGraph!.edges).toHaveLength(1);
    expect(result.systemGraph!.edges[0].from).not.toBe(result.systemGraph!.edges[0].to);
  });

  it('worldOnly mode processes top-level systemMutations block with concept dedup', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseWorld(),
      characters: [
        { id: 'C-01', name: 'Alice', role: 'anchor', threadIds: [] },
      ],
      locations: [
        { id: 'L-01', name: 'Castle', prominence: 'place', parentId: null, threadIds: [] },
      ],
      threads: [
        { id: 'T-01', participants: [{ id: 'C-01', type: 'character' }], description: 'Quest', status: 'latent', openedAt: 'S-001', dependents: [] },
      ],
      systemMutations: {
        addedNodes: [
          { id: 'SYS-GEN-1', concept: 'Mana Binding', type: 'system' },
          { id: 'SYS-GEN-2', concept: 'mana binding', type: 'principle' }, // duplicate
          { id: 'SYS-GEN-3', concept: 'Leylines', type: 'concept' },
        ],
        addedEdges: [],
      },
    }));

    const result = await generateNarrative('Test', 'A plan', [], [], undefined, undefined, undefined, true);

    // Within-batch dupe collapses — only 2 unique concepts.
    expect(Object.keys(result.systemGraph!.nodes)).toHaveLength(2);
  });
});

// ── generateNarrative: pilot thread logs ────────────────────────────────────
// Locks in the fix for the bug where the pilot schema omitted addedNodes,
// producing 8 pilot scenes with no thread log history. Also verifies the
// TK-ID remap so scenes using the same LLM placeholder don't collide.

describe('generateNarrative — pilot thread logs', () => {
  function baseWorld() {
    return {
      worldSummary: 'A test world',
      imageStyle: 'test style',
      characters: [{ id: 'C-01', name: 'Alice', role: 'anchor', threadIds: [] }],
      locations: [{ id: 'L-01', name: 'Castle', prominence: 'place', parentId: null, threadIds: [] }],
      threads: [
        { id: 'T-01', participants: [{ id: 'C-01', type: 'character' }], description: 'Main quest', status: 'latent', openedAt: 'S-001', dependents: [] },
        { id: 'T-02', participants: [{ id: 'C-01', type: 'character' }], description: 'Side quest', status: 'latent', openedAt: 'S-001', dependents: [] },
      ],
      relationships: [],
      artifacts: [],
      arcs: [
        { id: 'ARC-01', name: 'Pilot', sceneIds: ['S-001', 'S-002', 'S-003'], develops: ['T-01', 'T-02'], locationIds: ['L-01'], activeCharacterIds: ['C-01'], initialCharacterLocations: { 'C-01': 'L-01' } },
      ],
      rules: [],
      worldSystems: [],
    };
  }

  it('populates thread logs from pilot scene threadMutations', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseWorld(),
      scenes: [
        {
          id: 'S-001', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01',
          participantIds: ['C-01'], events: [],
          threadMutations: [{
            threadId: 'T-01', from: 'latent', to: 'seeded',
            addedNodes: [
              { id: 'TK-GEN-001', content: 'Alice hears rumour of the crown', type: 'setup' },
            ],
          }],
          continuityMutations: [], relationshipMutations: [],
          summary: 'Alice hears of the crown.',
        },
        {
          id: 'S-002', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01',
          participantIds: ['C-01'], events: [],
          threadMutations: [{
            threadId: 'T-01', from: 'seeded', to: 'active',
            addedNodes: [
              { id: 'TK-GEN-001', content: 'Alice decides to pursue the crown', type: 'transition' },
              { id: 'TK-GEN-002', content: 'escalation', type: 'escalation' },
            ],
          }],
          continuityMutations: [], relationshipMutations: [],
          summary: 'Alice decides to pursue.',
        },
      ],
    }));

    const result = await generateNarrative('Test', 'A story');

    const t1 = result.threads['T-01'];
    expect(t1.threadLog).toBeDefined();
    // 3 log entries across 2 scenes — all must be present, none dropped.
    expect(Object.keys(t1.threadLog.nodes)).toHaveLength(3);

    // TK IDs must be globally unique — no collisions despite LLM re-using
    // TK-GEN-001 across scenes. Without the remap, scene 2's first node
    // would collide with scene 1's and be silently dropped.
    const allTkIds = Object.keys(t1.threadLog.nodes);
    expect(new Set(allTkIds).size).toBe(allTkIds.length);
    for (const id of allTkIds) {
      expect(id).toMatch(/^TK-\d+$/);
      expect(id).not.toMatch(/GEN/);
    }

    // All three content strings must be preserved.
    const contents = Object.values(t1.threadLog.nodes).map((n) => n.content);
    expect(contents).toContain('Alice hears rumour of the crown');
    expect(contents).toContain('Alice decides to pursue the crown');
    expect(contents).toContain('escalation');
  });

  it('chains adjacent log nodes within a single mutation via co_occurs', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseWorld(),
      scenes: [
        {
          id: 'S-001', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01',
          participantIds: ['C-01'], events: [],
          threadMutations: [{
            threadId: 'T-01', from: 'latent', to: 'seeded',
            addedNodes: [
              { id: 'TK-GEN-001', content: 'setup', type: 'setup' },
              { id: 'TK-GEN-002', content: 'escalation', type: 'escalation' },
              { id: 'TK-GEN-003', content: 'transition', type: 'transition' },
            ],
          }],
          continuityMutations: [], relationshipMutations: [],
          summary: 'Scene',
        },
      ],
    }));

    const result = await generateNarrative('Test', 'A story');
    const t1 = result.threads['T-01'];
    // 3 nodes → 2 auto-chain edges
    expect(t1.threadLog.edges).toHaveLength(2);
    expect(t1.threadLog.edges.every((e) => e.relation === 'co_occurs')).toBe(true);
  });

  it('synthesizes fallback log entries when LLM omits addedNodes', async () => {
    vi.mocked(callGenerate).mockResolvedValue(JSON.stringify({
      ...baseWorld(),
      scenes: [
        {
          id: 'S-001', arcId: 'ARC-01', locationId: 'L-01', povId: 'C-01',
          participantIds: ['C-01'], events: [],
          threadMutations: [
            // LLM omitted addedNodes — pilot fallback should synthesize one.
            { threadId: 'T-01', from: 'latent', to: 'seeded', addedNodes: [] },
            { threadId: 'T-02', from: 'latent', to: 'latent', addedNodes: [] },
          ],
          continuityMutations: [], relationshipMutations: [],
          summary: 'Scene',
        },
      ],
    }));

    const result = await generateNarrative('Test', 'A story');

    const t1Nodes = Object.values(result.threads['T-01'].threadLog.nodes);
    const t2Nodes = Object.values(result.threads['T-02'].threadLog.nodes);
    expect(t1Nodes).toHaveLength(1);
    expect(t1Nodes[0].content).toMatch(/advanced from latent to seeded/);
    expect(t1Nodes[0].type).toBe('transition');
    expect(t2Nodes).toHaveLength(1);
    expect(t2Nodes[0].content).toMatch(/held latent without transition/);
    expect(t2Nodes[0].type).toBe('pulse');
  });
});
