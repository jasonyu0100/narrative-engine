import { describe, it, expect } from 'vitest';
import {
  getIntroducedIds,
  getContinuityNodesAtScene,
  getRelationshipsAtScene,
  getThreadIdsAtScene,
} from '@/lib/scene-filter';
import type { WorldBuild, Scene, ContinuityNode, ContinuityNodeType, NarrativeState, Thread } from '@/types/narrative';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createWorldBuild(
  id: string,
  characters: { id: string }[] = [],
  locations: { id: string }[] = [],
  threads: { id: string }[] = [],
  artifacts: { id: string }[] = [],
): WorldBuild {
  return {
    kind: 'world_build',
    id,
    summary: `World build ${id}`,
    expansionManifest: {
      characters: characters.map((c) => ({ id: c.id, name: `Char ${c.id}`, role: 'anchor' as const, continuity: { nodes: {}, edges: [] }, threadIds: [] })),
      locations: locations.map((l) => ({ id: l.id, name: `Loc ${l.id}`, prominence: 'place' as const, parentId: null, tiedCharacterIds: [] as string[], continuity: { nodes: {}, edges: [] }, threadIds: [] })),
      threads: threads.map((t) => ({ id: t.id, description: `Thread ${t.id}`, status: 'latent' as const, participants: [], dependents: [], openedAt: 'S-001', threadLog: { nodes: {}, edges: [] } })),
      artifacts: artifacts.map((a) => ({ id: a.id, name: `Artifact ${a.id}`, significance: 'key' as const, parentId: 'C-01', continuity: { nodes: {}, edges: [] }, threadIds: [] })),
      relationships: [],
      worldKnowledge: { addedNodes: [], addedEdges: [] },
    },
  };
}

function createScene(
  id: string,
  continuityMutations: { entityId: string; addedNodes: { id: string; content: string; type: ContinuityNodeType }[] }[] = [],
  relationshipMutations: { from: string; to: string; type: string; valenceDelta: number }[] = [],
): Scene {
  return {
    kind: 'scene',
    id,
    arcId: 'ARC-01',
    povId: 'C-01',
    locationId: 'L-01',
    participantIds: ['C-01'],
    events: [],
    threadMutations: [],
    continuityMutations: continuityMutations.map((km) => ({
      ...km,
      addedEdges: [],
    })),
    relationshipMutations: relationshipMutations.map((rm) => ({
      ...rm,
    })),
    summary: `Scene ${id}`,
  };
}

function createMinimalNarrative(): NarrativeState {
  return {
    id: 'test-narrative',
    title: 'Test',
    description: 'Test narrative',
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
  };
}

// ── getIntroducedIds ─────────────────────────────────────────────────────────

describe('getIntroducedIds', () => {
  it('returns empty sets for no world builds', () => {
    const result = getIntroducedIds({}, ['S-001', 'S-002'], 1);
    expect(result.characterIds.size).toBe(0);
    expect(result.locationIds.size).toBe(0);
    expect(result.threadIds.size).toBe(0);
    expect(result.artifactIds.size).toBe(0);
  });

  it('collects IDs from world builds up to current index', () => {
    const worldBuilds: Record<string, WorldBuild> = {
      'WB-01': createWorldBuild('WB-01', [{ id: 'C-01' }], [{ id: 'L-01' }], [{ id: 'T-01' }]),
      'WB-02': createWorldBuild('WB-02', [{ id: 'C-02' }], [{ id: 'L-02' }], [{ id: 'T-02' }]),
    };
    const resolvedKeys = ['WB-01', 'S-001', 'WB-02', 'S-002'];

    // At index 1 (after WB-01 and S-001)
    const result1 = getIntroducedIds(worldBuilds, resolvedKeys, 1);
    expect(result1.characterIds.has('C-01')).toBe(true);
    expect(result1.characterIds.has('C-02')).toBe(false);

    // At index 3 (after WB-02)
    const result2 = getIntroducedIds(worldBuilds, resolvedKeys, 3);
    expect(result2.characterIds.has('C-01')).toBe(true);
    expect(result2.characterIds.has('C-02')).toBe(true);
  });

  it('collects artifact IDs', () => {
    const worldBuilds: Record<string, WorldBuild> = {
      'WB-01': createWorldBuild('WB-01', [], [], [], [{ id: 'A-01' }, { id: 'A-02' }]),
    };
    const result = getIntroducedIds(worldBuilds, ['WB-01'], 0);
    expect(result.artifactIds.has('A-01')).toBe(true);
    expect(result.artifactIds.has('A-02')).toBe(true);
  });

  it('handles empty resolved keys', () => {
    const worldBuilds: Record<string, WorldBuild> = {
      'WB-01': createWorldBuild('WB-01', [{ id: 'C-01' }]),
    };
    const result = getIntroducedIds(worldBuilds, [], 0);
    expect(result.characterIds.size).toBe(0);
  });
});

// ── getContinuityNodesAtScene ────────────────────────────────────────────────

describe('getContinuityNodesAtScene', () => {
  const nodes: Record<string, ContinuityNode> = {
    'K-01': { id: 'K-01', type: 'history', content: 'Initial knowledge' },
    'K-03': { id: 'K-03', type: 'history', content: 'Never mutated' },
  };

  it('returns all nodes when no mutations exist', () => {
    const scenes: Record<string, Scene> = {};
    const result = getContinuityNodesAtScene(nodes, 'C-01', scenes, [], 0);
    expect(result.length).toBe(2);
  });

  it('includes nodes added up to current index', () => {
    const scenes: Record<string, Scene> = {
      'S-001': createScene('S-001', [{ entityId: 'C-01', addedNodes: [{ id: 'K-02', content: 'Added', type: 'history' }] }]),
      'S-002': createScene('S-002'),
    };
    const resolvedKeys = ['S-001', 'S-002'];

    const result = getContinuityNodesAtScene(nodes, 'C-01', scenes, resolvedKeys, 1);
    expect(result.map((n) => n.id)).toContain('K-02');
  });

  it('does not include nodes added after current index', () => {
    const scenes: Record<string, Scene> = {
      'S-001': createScene('S-001'),
      'S-002': createScene('S-002', [{ entityId: 'C-01', addedNodes: [{ id: 'K-04', content: 'Future', type: 'history' }] }]),
    };
    const resolvedKeys = ['S-001', 'S-002'];

    // At index 0, K-04 hasn't been added yet
    const result = getContinuityNodesAtScene(nodes, 'C-01', scenes, resolvedKeys, 0);
    expect(result.map((n) => n.id)).not.toContain('K-04');

    // At index 1, K-04 is added
    const result2 = getContinuityNodesAtScene(nodes, 'C-01', scenes, resolvedKeys, 1);
    expect(result2.map((n) => n.id)).toContain('K-04');
  });

  it('accumulates nodes across scenes', () => {
    const scenes: Record<string, Scene> = {
      'S-001': createScene('S-001', [{ entityId: 'C-01', addedNodes: [{ id: 'K-05', content: 'First', type: 'history' }] }]),
      'S-002': createScene('S-002', [{ entityId: 'C-01', addedNodes: [{ id: 'K-06', content: 'Second', type: 'history' }] }]),
    };
    const resolvedKeys = ['S-001', 'S-002'];

    const result = getContinuityNodesAtScene(nodes, 'C-01', scenes, resolvedKeys, 1);
    expect(result.map((n) => n.id)).toContain('K-05');
    expect(result.map((n) => n.id)).toContain('K-06');
  });

  it('filters by entity ID', () => {
    const scenes: Record<string, Scene> = {
      'S-001': createScene('S-001', [
        { entityId: 'C-01', addedNodes: [{ id: 'K-07', content: 'C01 learns', type: 'history' }] },
        { entityId: 'C-02', addedNodes: [{ id: 'K-08', content: 'C02 learns', type: 'history' }] },
      ]),
    };
    const resolvedKeys = ['S-001'];

    // C-01 should see K-07 but not K-08 (different entity)
    const result = getContinuityNodesAtScene(nodes, 'C-01', scenes, resolvedKeys, 0);
    expect(result.map((n) => n.id)).toContain('K-07');
    expect(result.map((n) => n.id)).not.toContain('K-08');
  });

  it('includes never-mutated nodes', () => {
    const scenes: Record<string, Scene> = {
      'S-001': createScene('S-001', [{ entityId: 'C-01', addedNodes: [{ id: 'K-09', content: 'New', type: 'history' }] }]),
    };
    const resolvedKeys = ['S-001'];

    const result = getContinuityNodesAtScene(nodes, 'C-01', scenes, resolvedKeys, 0);
    expect(result.map((n) => n.id)).toContain('K-03'); // Never mutated
  });
});

// ── getRelationshipsAtScene ──────────────────────────────────────────────────

describe('getRelationshipsAtScene', () => {
  it('returns empty array when no relationships exist', () => {
    const narrative = createMinimalNarrative();
    const result = getRelationshipsAtScene(narrative, [], 0);
    expect(result).toEqual([]);
  });

  it('excludes relationships with unintroduced characters', () => {
    const narrative = createMinimalNarrative();
    narrative.worldBuilds['WB-01'] = createWorldBuild('WB-01', [{ id: 'C-01' }]);
    narrative.relationships = [
      { from: 'C-01', to: 'C-02', type: 'ally', valence: 0.5 },
    ];

    const result = getRelationshipsAtScene(narrative, ['WB-01'], 0);
    // C-02 not introduced, so relationship excluded
    expect(result.length).toBe(0);
  });

  it('includes relationships where both characters are introduced', () => {
    const narrative = createMinimalNarrative();
    narrative.worldBuilds['WB-01'] = createWorldBuild('WB-01', [{ id: 'C-01' }, { id: 'C-02' }]);
    narrative.relationships = [
      { from: 'C-01', to: 'C-02', type: 'ally', valence: 0.5 },
    ];

    const result = getRelationshipsAtScene(narrative, ['WB-01'], 0);
    expect(result.length).toBe(1);
    expect(result[0].from).toBe('C-01');
  });

  it('subtracts future mutation deltas from valence', () => {
    const narrative = createMinimalNarrative();
    narrative.worldBuilds['WB-01'] = createWorldBuild('WB-01', [{ id: 'C-01' }, { id: 'C-02' }]);
    // First scene establishes the relationship (so it's not "future created")
    narrative.scenes['S-001'] = createScene('S-001', [], [
      { from: 'C-01', to: 'C-02', type: 'ally', valenceDelta: 0.5 },
    ]);
    // Second scene modifies it
    narrative.scenes['S-002'] = createScene('S-002', [], [
      { from: 'C-01', to: 'C-02', type: 'rival', valenceDelta: -0.3 },
    ]);
    narrative.relationships = [
      { from: 'C-01', to: 'C-02', type: 'rival', valence: 0.2 }, // Final valence after S-002
    ];

    const resolvedKeys = ['WB-01', 'S-001', 'S-002'];

    // At index 1 (S-001), before S-002's mutation
    const result = getRelationshipsAtScene(narrative, resolvedKeys, 1);
    expect(result.length).toBe(1);
    // Final valence is 0.2, future delta is -0.3, so valence at S-001 is 0.2 - (-0.3) = 0.5
    expect(result[0].valence).toBeCloseTo(0.5, 5);
  });

  it('excludes relationships created by future scenes', () => {
    const narrative = createMinimalNarrative();
    narrative.worldBuilds['WB-01'] = createWorldBuild('WB-01', [{ id: 'C-01' }, { id: 'C-02' }]);
    narrative.scenes['S-001'] = createScene('S-001');
    narrative.scenes['S-002'] = createScene('S-002', [], [
      { from: 'C-01', to: 'C-02', type: 'ally', valenceDelta: 0.5 },
    ]);
    narrative.relationships = [
      { from: 'C-01', to: 'C-02', type: 'ally', valence: 0.5 },
    ];

    const resolvedKeys = ['WB-01', 'S-001', 'S-002'];

    // At index 1, relationship doesn't exist yet (created by S-002)
    const result = getRelationshipsAtScene(narrative, resolvedKeys, 1);
    expect(result.length).toBe(0);
  });
});

// ── getThreadIdsAtScene ──────────────────────────────────────────────────────

describe('getThreadIdsAtScene', () => {
  it('returns empty array for no threads', () => {
    const result = getThreadIdsAtScene([], {}, [], 0);
    expect(result).toEqual([]);
  });

  it('includes threads opened at or before current index', () => {
    const threads: Record<string, Thread> = {
      'T-01': {
        id: 'T-01',
        description: 'Desc 1',
        status: 'active',
        openedAt: 'WB-01',
        dependents: [],
        participants: [],
        threadLog: { nodes: {}, edges: [] },
      },
      'T-02': {
        id: 'T-02',
        description: 'Desc 2',
        status: 'latent',
        openedAt: 'S-002',
        dependents: [],
        participants: [],
        threadLog: { nodes: {}, edges: [] },
      },
    };
    const resolvedKeys = ['WB-01', 'S-001', 'S-002'];

    // At index 0, only T-01 is introduced
    const result1 = getThreadIdsAtScene(['T-01', 'T-02'], threads, resolvedKeys, 0);
    expect(result1).toEqual(['T-01']);

    // At index 2, both threads are introduced
    const result2 = getThreadIdsAtScene(['T-01', 'T-02'], threads, resolvedKeys, 2);
    expect(result2).toEqual(['T-01', 'T-02']);
  });

  it('excludes threads with unknown openedAt', () => {
    const threads: Record<string, Thread> = {
      'T-01': {
        id: 'T-01',
        description: 'Desc 1',
        status: 'active',
        openedAt: 'UNKNOWN-KEY',
        dependents: [],
        participants: [],
        threadLog: { nodes: {}, edges: [] },
      },
    };
    const resolvedKeys = ['WB-01', 'S-001'];

    const result = getThreadIdsAtScene(['T-01'], threads, resolvedKeys, 1);
    expect(result).toEqual([]);
  });

  it('handles missing thread gracefully', () => {
    const threads: Record<string, Thread> = {};
    const result = getThreadIdsAtScene(['T-01'], threads, ['S-001'], 0);
    expect(result).toEqual([]);
  });
});
