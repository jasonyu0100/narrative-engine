import { describe, it, expect } from 'vitest';
import { computeSlidesData } from '@/lib/slides-data';
import type { NarrativeState, Scene } from '@/types/narrative';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createMinimalNarrative(overrides: Partial<NarrativeState> = {}): NarrativeState {
  return {
    id: 'test-narrative',
    title: 'Test Story',
    description: 'A test narrative',
    characters: {},
    locations: {},
    threads: {},
    artifacts: {},
    scenes: {},
    arcs: {},
    worldBuilds: {},
    branches: {
      main: {
        id: 'main',
        name: 'Main',
        parentBranchId: null,
        forkEntryId: null,
        entryIds: [],
        createdAt: Date.now(),
      },
    },
    relationships: [],
    worldKnowledge: { nodes: {}, edges: [] },
    worldSummary: '',
    rules: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createScene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    kind: 'scene',
    id,
    arcId: 'arc-1',
    povId: 'c1',
    locationId: 'loc1',
    participantIds: ['c1'],
    summary: `Scene ${id} summary`,
    events: ['event_1'],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    ...overrides,
  };
}

// ── computeSlidesData ────────────────────────────────────────────────────────

describe('computeSlidesData', () => {
  it('returns correct basic counts for empty narrative', () => {
    const n = createMinimalNarrative();
    const data = computeSlidesData(n, []);

    expect(data.title).toBe('Test Story');
    expect(data.description).toBe('A test narrative');
    expect(data.sceneCount).toBe(0);
    expect(data.arcCount).toBe(0);
    expect(data.characterCount).toBe(0);
    expect(data.locationCount).toBe(0);
    expect(data.threadCount).toBe(0);
  });

  it('counts entities correctly', () => {
    const n = createMinimalNarrative({
      characters: {
        c1: { id: 'c1', name: 'Hero', role: 'anchor', continuity: { nodes: {}, edges: [] }, threadIds: [] },
        c2: { id: 'c2', name: 'Sidekick', role: 'recurring', continuity: { nodes: {}, edges: [] }, threadIds: [] },
      },
      locations: {
        loc1: { id: 'loc1', name: 'Castle', prominence: 'place' as const, parentId: null, tiedCharacterIds: [], continuity: { nodes: {}, edges: [] }, threadIds: [] },
      },
      threads: {
        t1: { id: 't1', description: 'Quest', status: 'active', participants: [], dependents: [], openedAt: 's1', threadLog: { nodes: {}, edges: [] } },
        t2: { id: 't2', description: 'Romance', status: 'latent', participants: [], dependents: [], openedAt: 's1', threadLog: { nodes: {}, edges: [] } },
      },
    });
    const data = computeSlidesData(n, []);

    expect(data.characterCount).toBe(2);
    expect(data.locationCount).toBe(1);
    expect(data.threadCount).toBe(2);
  });

  it('processes scenes and computes force snapshots', () => {
    const n = createMinimalNarrative({
      characters: {
        c1: { id: 'c1', name: 'Hero', role: 'anchor', continuity: { nodes: {}, edges: [] }, threadIds: [] },
      },
      locations: {
        loc1: { id: 'loc1', name: 'Castle', prominence: 'place' as const, parentId: null, tiedCharacterIds: [], continuity: { nodes: {}, edges: [] }, threadIds: [] },
      },
      threads: {
        t1: { id: 't1', description: 'Quest', status: 'active', participants: [], dependents: [], openedAt: 's1', threadLog: { nodes: {}, edges: [] } },
      },
      scenes: {
        s1: createScene('s1', {
          threadMutations: [{ threadId: 't1', from: 'latent', to: 'active', addedNodes: [], addedEdges: [] }],
          continuityMutations: [
            { entityId: 'c1', addedNodes: [{ id: 'n1', content: 'Learned something', type: 'belief' }], addedEdges: [] },
          ],
          events: ['event_1', 'event_2'],
        }),
        s2: createScene('s2', {
          threadMutations: [{ threadId: 't1', from: 'active', to: 'active', addedNodes: [], addedEdges: [] }],
          events: ['event_3'],
        }),
      },
      arcs: {
        'arc-1': { id: 'arc-1', name: 'Act I', sceneIds: ['s1', 's2'], develops: ['t1'], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
      },
    });

    const data = computeSlidesData(n, ['s1', 's2']);

    expect(data.sceneCount).toBe(2);
    expect(data.scenes.length).toBe(2);
    expect(data.forceSnapshots.length).toBe(2);
    expect(data.deliveryCurve.length).toBe(2);
    expect(data.arcCount).toBe(1);
  });

  it('computes thread lifecycles', () => {
    const n = createMinimalNarrative({
      threads: {
        t1: { id: 't1', description: 'Quest', status: 'active', participants: [], dependents: [], openedAt: 's1', threadLog: { nodes: {}, edges: [] } },
      },
      scenes: {
        s1: createScene('s1', {
          threadMutations: [{ threadId: 't1', from: 'latent', to: 'active', addedNodes: [], addedEdges: [] }],
        }),
        s2: createScene('s2', {
          threadMutations: [{ threadId: 't1', from: 'active', to: 'active', addedNodes: [], addedEdges: [] }],
        }),
      },
    });

    const data = computeSlidesData(n, ['s1', 's2']);

    expect(data.threadLifecycles.length).toBe(1);
    expect(data.threadLifecycles[0].threadId).toBe('t1');
    expect(data.threadLifecycles[0].statuses.length).toBeGreaterThan(0);
  });

  it('computes thread convergences', () => {
    const n = createMinimalNarrative({
      threads: {
        t1: { id: 't1', description: 'Main Quest', status: 'active', participants: [], dependents: ['t2'], openedAt: 's1', threadLog: { nodes: {}, edges: [] } },
        t2: { id: 't2', description: 'Sub Quest', status: 'active', participants: [], dependents: [], openedAt: 's1', threadLog: { nodes: {}, edges: [] } },
      },
    });

    const data = computeSlidesData(n, []);

    expect(data.threadConvergences.length).toBe(1);
    expect(data.threadConvergences[0]).toEqual({ fromId: 't1', toId: 't2' });
  });

  it('computes top characters by participation', () => {
    const n = createMinimalNarrative({
      characters: {
        c1: { id: 'c1', name: 'Hero', role: 'anchor', continuity: { nodes: {}, edges: [] }, threadIds: [] },
        c2: { id: 'c2', name: 'Mentor', role: 'recurring', continuity: { nodes: {}, edges: [] }, threadIds: [] },
      },
      scenes: {
        s1: createScene('s1', { participantIds: ['c1', 'c2'] }),
        s2: createScene('s2', { participantIds: ['c1'] }),
        s3: createScene('s3', { participantIds: ['c1'] }),
      },
    });

    const data = computeSlidesData(n, ['s1', 's2', 's3']);

    expect(data.topCharacters.length).toBe(2);
    expect(data.topCharacters[0].character.name).toBe('Hero');
    expect(data.topCharacters[0].sceneCount).toBe(3);
    expect(data.topCharacters[1].character.name).toBe('Mentor');
    expect(data.topCharacters[1].sceneCount).toBe(1);
  });

  it('computes top locations by usage', () => {
    const n = createMinimalNarrative({
      locations: {
        loc1: { id: 'loc1', name: 'Castle', prominence: 'place' as const, parentId: null, tiedCharacterIds: [], continuity: { nodes: {}, edges: [] }, threadIds: [] },
        loc2: { id: 'loc2', name: 'Forest', prominence: 'place' as const, parentId: null, tiedCharacterIds: [], continuity: { nodes: {}, edges: [] }, threadIds: [] },
      },
      scenes: {
        s1: createScene('s1', { locationId: 'loc1' }),
        s2: createScene('s2', { locationId: 'loc1' }),
        s3: createScene('s3', { locationId: 'loc2' }),
      },
    });

    const data = computeSlidesData(n, ['s1', 's2', 's3']);

    expect(data.topLocations.length).toBe(2);
    expect(data.topLocations[0].location.name).toBe('Castle');
    expect(data.topLocations[0].sceneCount).toBe(2);
    expect(data.topLocations[1].location.name).toBe('Forest');
    expect(data.topLocations[1].sceneCount).toBe(1);
  });

  it('computes cube distribution', () => {
    const n = createMinimalNarrative({
      scenes: {
        s1: createScene('s1', {
          threadMutations: [{ threadId: 't1', from: 'latent', to: 'critical', addedNodes: [], addedEdges: [] }],
        }),
        s2: createScene('s2', {
          continuityMutations: [
            { entityId: 'c1', addedNodes: [{ id: 'n1', content: 'K1', type: 'belief' }, { id: 'n2', content: 'K2', type: 'belief' }], addedEdges: [] },
          ],
        }),
      },
      threads: {
        t1: { id: 't1', description: 'Quest', status: 'active', participants: [], dependents: [], openedAt: 's1', threadLog: { nodes: {}, edges: [] } },
      },
    });

    const data = computeSlidesData(n, ['s1', 's2']);

    // Should have all 8 cube corners initialized
    expect(Object.keys(data.cubeDistribution).length).toBe(8);
    // Total should equal scene count
    const total = Object.values(data.cubeDistribution).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(2);
  });

  it('builds name lookup maps', () => {
    const n = createMinimalNarrative({
      characters: {
        c1: { id: 'c1', name: 'Hero', role: 'anchor', continuity: { nodes: {}, edges: [] }, threadIds: [] },
      },
      locations: {
        loc1: { id: 'loc1', name: 'Castle', prominence: 'place' as const, parentId: null, tiedCharacterIds: [], continuity: { nodes: {}, edges: [] }, threadIds: [] },
      },
      threads: {
        t1: { id: 't1', description: 'Quest', status: 'active', participants: [], dependents: [], openedAt: 's1', threadLog: { nodes: {}, edges: [] } },
      },
    });

    const data = computeSlidesData(n, []);

    expect(data.characterNames['c1']).toBe('Hero');
    expect(data.locationNames['loc1']).toBe('Castle');
    expect(data.threadDescriptions['t1']).toBe('Quest');
  });

  it('includes cover image URL when present', () => {
    const n = createMinimalNarrative({
      coverImageUrl: 'https://example.com/cover.jpg',
    });

    const data = computeSlidesData(n, []);
    expect(data.coverImageUrl).toBe('https://example.com/cover.jpg');
  });

  it('computes arc grades', () => {
    const n = createMinimalNarrative({
      scenes: {
        s1: createScene('s1', {
          threadMutations: [{ threadId: 't1', from: 'latent', to: 'active', addedNodes: [], addedEdges: [] }],
          events: ['e1', 'e2'],
        }),
        s2: createScene('s2', {
          threadMutations: [{ threadId: 't1', from: 'active', to: 'active', addedNodes: [], addedEdges: [] }],
        }),
      },
      threads: {
        t1: { id: 't1', description: 'Quest', status: 'active', participants: [], dependents: [], openedAt: 's1', threadLog: { nodes: {}, edges: [] } },
      },
      arcs: {
        'arc-1': { id: 'arc-1', name: 'Act I', sceneIds: ['s1', 's2'], develops: ['t1'], locationIds: [], activeCharacterIds: [], initialCharacterLocations: {} },
      },
    });

    const data = computeSlidesData(n, ['s1', 's2']);

    expect(data.arcGrades.length).toBe(1);
    expect(data.arcGrades[0].arcName).toBe('Act I');
    expect(data.arcGrades[0].sceneCount).toBe(2);
    expect(data.arcGrades[0].grades).toBeDefined();
  });
});
