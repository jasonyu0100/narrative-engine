import { describe, it, expect } from 'vitest';
import {
  nextId,
  nextIds,
  resolveEntrySequence,
  computeThreadStatuses,
  forceDistance,
  detectCubeCorner,
  cubeCornerProximity,
  computeSwingMagnitudes,
  averageSwing,
  zScoreNormalize,
  computeForceSnapshots,
  computeRawForceTotals,
  movingAverage,
  computeDeliveryCurve,
  classifyNarrativeShape,
  classifyArchetype,
  classifyScale,
  classifyWorldDensity,
  classifyCurrentPosition,
  computeWindowedForces,
  gradeForce,
  gradeForces,
  rankWorldKnowledgeNodes,
  buildCumulativeWorldKnowledge,
} from '@/lib/narrative-utils';
import type { Branch, Scene, NarrativeState, ForceSnapshot, WorldKnowledgeGraph } from '@/types/narrative';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createScene(overrides: Partial<Scene> = {}): Scene {
  return {
    kind: 'scene',
    id: overrides.id ?? 'S-001',
    arcId: 'ARC-01',
    povId: 'C-01',
    locationId: 'L-01',
    participantIds: ['C-01'],
    events: [],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    characterMovements: {},
    summary: 'Test scene',
    ...overrides,
  };
}

function createNarrative(overrides: Partial<NarrativeState> = {}): NarrativeState {
  return {
    id: 'test-narrative',
    title: 'Test',
    description: 'Test narrative',
    characters: {},
    locations: {},
    threads: {},
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
    artifacts: {},
    relationships: [],
    worldKnowledge: { nodes: {}, edges: [] },
    worldSummary: '',
    rules: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ── ID Generation ────────────────────────────────────────────────────────────

describe('nextId', () => {
  it('returns first ID when no existing IDs', () => {
    expect(nextId('C', [])).toBe('C-01');
    expect(nextId('S', [], 3)).toBe('S-001');
  });

  it('increments from highest existing ID', () => {
    expect(nextId('C', ['C-01', 'C-02', 'C-03'])).toBe('C-04');
  });

  it('handles non-sequential existing IDs', () => {
    expect(nextId('C', ['C-01', 'C-05', 'C-03'])).toBe('C-06');
  });

  it('handles complex ID formats', () => {
    expect(nextId('C', ['C-1742000000-3', 'C-01'])).toBe('C-04');
  });

  it('respects custom padding width', () => {
    expect(nextId('S', ['S-001', 'S-002'], 3)).toBe('S-003');
  });
});

describe('nextIds', () => {
  it('generates multiple sequential IDs', () => {
    const ids = nextIds('C', ['C-01'], 3);
    expect(ids).toEqual(['C-02', 'C-03', 'C-04']);
  });

  it('handles empty existing IDs', () => {
    const ids = nextIds('S', [], 2, 3);
    expect(ids).toEqual(['S-001', 'S-002']);
  });
});

// ── Branch Resolution ────────────────────────────────────────────────────────

describe('resolveEntrySequence', () => {
  it('returns empty array for non-existent branch', () => {
    const branches: Record<string, Branch> = {};
    expect(resolveEntrySequence(branches, 'non-existent')).toEqual([]);
  });

  it('returns own entries for root branch', () => {
    const branches: Record<string, Branch> = {
      main: { id: 'main', name: 'Main', parentBranchId: null, forkEntryId: null, entryIds: ['S-001', 'S-002'], createdAt: 0 },
    };
    expect(resolveEntrySequence(branches, 'main')).toEqual(['S-001', 'S-002']);
  });

  it('includes parent entries up to fork point', () => {
    const branches: Record<string, Branch> = {
      main: { id: 'main', name: 'Main', parentBranchId: null, forkEntryId: null, entryIds: ['S-001', 'S-002', 'S-003'], createdAt: 0 },
      child: {
        id: 'child',
        name: 'Child',
        entryIds: ['S-004', 'S-005'],
        parentBranchId: 'main',
        forkEntryId: 'S-002',
        createdAt: 1,
      },
    };
    expect(resolveEntrySequence(branches, 'child')).toEqual(['S-001', 'S-002', 'S-004', 'S-005']);
  });

  it('handles deeply nested branches', () => {
    const branches: Record<string, Branch> = {
      main: { id: 'main', name: 'Main', parentBranchId: null, forkEntryId: null, entryIds: ['S-001', 'S-002'], createdAt: 0 },
      child: {
        id: 'child',
        name: 'Child',
        entryIds: ['S-003'],
        parentBranchId: 'main',
        forkEntryId: 'S-001',
        createdAt: 1,
      },
      grandchild: {
        id: 'grandchild',
        name: 'Grandchild',
        entryIds: ['S-004'],
        parentBranchId: 'child',
        forkEntryId: 'S-003',
        createdAt: 2,
      },
    };
    expect(resolveEntrySequence(branches, 'grandchild')).toEqual(['S-001', 'S-003', 'S-004']);
  });
});

// ── Thread Status Computation ────────────────────────────────────────────────

describe('computeThreadStatuses', () => {
  it('returns base statuses when no scenes', () => {
    const narrative = createNarrative({
      threads: {
        'T-01': { id: 'T-01', status: 'latent', description: 'Thread 1', participants: [], dependents: [], openedAt: 'S-000', threadLog: { nodes: {}, edges: [] } },
        'T-02': { id: 'T-02', status: 'active', description: 'Thread 2', participants: [], dependents: [], openedAt: 'S-000', threadLog: { nodes: {}, edges: [] } },
      },
    });
    const statuses = computeThreadStatuses(narrative, 0);
    expect(statuses['T-01']).toBe('latent');
    expect(statuses['T-02']).toBe('active');
  });

  it('applies thread mutations from scenes', () => {
    const narrative = createNarrative({
      threads: {
        'T-01': { id: 'T-01', status: 'latent', description: 'Thread', participants: [], dependents: [], openedAt: 'S-000', threadLog: { nodes: {}, edges: [] } },
      },
      scenes: {
        'S-001': createScene({
          id: 'S-001',
          threadMutations: [{ threadId: 'T-01', from: 'latent', to: 'active' }],
        }),
        'S-002': createScene({
          id: 'S-002',
          threadMutations: [{ threadId: 'T-01', from: 'active', to: 'active' }],
        }),
      },
    });

    expect(computeThreadStatuses(narrative, 0, ['S-001', 'S-002'])['T-01']).toBe('active');
    expect(computeThreadStatuses(narrative, 1, ['S-001', 'S-002'])['T-01']).toBe('active');
  });
});

// ── Force Distance & Cube Detection ──────────────────────────────────────────

describe('forceDistance', () => {
  it('returns 0 for identical snapshots', () => {
    const a: ForceSnapshot = { drive: 1, world: 1, system: 1 };
    expect(forceDistance(a, a)).toBe(0);
  });

  it('computes Euclidean distance', () => {
    const a: ForceSnapshot = { drive: 0, world: 0, system: 0 };
    const b: ForceSnapshot = { drive: 3, world: 4, system: 0 };
    expect(forceDistance(a, b)).toBe(5);
  });
});

describe('detectCubeCorner', () => {
  it('detects HHH corner for high forces', () => {
    const forces: ForceSnapshot = { drive: 1.5, world: 1.5, system: 1.5 };
    const corner = detectCubeCorner(forces);
    expect(corner.key).toBe('HHH');
  });

  it('detects LLL corner for low forces', () => {
    const forces: ForceSnapshot = { drive: -1.5, world: -1.5, system: -1.5 };
    const corner = detectCubeCorner(forces);
    expect(corner.key).toBe('LLL');
  });
});

describe('cubeCornerProximity', () => {
  it('returns 1 when at the corner', () => {
    const forces: ForceSnapshot = { drive: 1, world: 1, system: 1 };
    expect(cubeCornerProximity(forces, 'HHH')).toBeCloseTo(1, 1);
  });

  it('returns smaller values further from corner', () => {
    const close: ForceSnapshot = { drive: 0.9, world: 0.9, system: 0.9 };
    const far: ForceSnapshot = { drive: -1, world: -1, system: -1 };
    expect(cubeCornerProximity(close, 'HHH')).toBeGreaterThan(cubeCornerProximity(far, 'HHH'));
  });
});

// ── Swing Computation ────────────────────────────────────────────────────────

describe('computeSwingMagnitudes', () => {
  it('returns [0] for single snapshot', () => {
    const snapshots: ForceSnapshot[] = [{ drive: 1, world: 1, system: 1 }];
    expect(computeSwingMagnitudes(snapshots)).toEqual([0]);
  });

  it('computes Euclidean distance between consecutive snapshots', () => {
    const snapshots: ForceSnapshot[] = [
      { drive: 0, world: 0, system: 0 },
      { drive: 1, world: 0, system: 0 },
    ];
    const swings = computeSwingMagnitudes(snapshots);
    expect(swings[0]).toBe(0);
    expect(swings[1]).toBe(1);
  });

  it('normalizes by reference means when provided', () => {
    const snapshots: ForceSnapshot[] = [
      { drive: 0, world: 0, system: 0 },
      { drive: 2, world: 0, system: 0 },
    ];
    const refMeans = { drive: 2, world: 1, system: 1 };
    const swings = computeSwingMagnitudes(snapshots, refMeans);
    expect(swings[1]).toBe(1); // 2/2 = 1
  });
});

describe('averageSwing', () => {
  it('returns 0 for empty or single snapshot', () => {
    expect(averageSwing([])).toBe(0);
    expect(averageSwing([{ drive: 1, world: 1, system: 1 }])).toBe(0);
  });
});

// ── Z-Score Normalization ────────────────────────────────────────────────────

describe('zScoreNormalize', () => {
  it('returns empty array for empty input', () => {
    expect(zScoreNormalize([])).toEqual([]);
  });

  it('returns all zeros for constant values', () => {
    expect(zScoreNormalize([5, 5, 5, 5])).toEqual([0, 0, 0, 0]);
  });

  it('normalizes with mean 0 and unit std', () => {
    const values = [2, 4, 6, 8];
    const normalized = zScoreNormalize(values);

    // Mean should be 0
    const mean = normalized.reduce((s, v) => s + v, 0) / normalized.length;
    expect(mean).toBeCloseTo(0, 5);

    // Std should be ~1
    const variance = normalized.reduce((s, v) => s + v * v, 0) / normalized.length;
    expect(Math.sqrt(variance)).toBeCloseTo(1, 1);
  });
});

// ── Force Computation ────────────────────────────────────────────────────────

describe('computeForceSnapshots', () => {
  it('returns empty object for empty scenes', () => {
    expect(computeForceSnapshots([])).toEqual({});
  });

  it('computes z-score normalized forces', () => {
    const scenes: Scene[] = [
      createScene({
        id: 'S-001',
        threadMutations: [{ threadId: 'T-01', from: 'latent', to: 'seeded' }],
        continuityMutations: [],
        events: ['event1'],
      }),
      createScene({
        id: 'S-002',
        threadMutations: [{ threadId: 'T-01', from: 'seeded', to: 'active' }],
        continuityMutations: [{ entityId: 'C-01', addedNodes: [{ id: 'K-01', content: 'secret', type: 'secret' }], addedEdges: [] }],
        events: ['event1', 'event2'],
      }),
    ];

    const snapshots = computeForceSnapshots(scenes);
    expect(Object.keys(snapshots)).toHaveLength(2);
    expect(snapshots['S-001']).toBeDefined();
    expect(snapshots['S-002']).toBeDefined();
  });
});

describe('computeRawForceTotals', () => {
  it('returns empty arrays for empty scenes', () => {
    const result = computeRawForceTotals([]);
    expect(result).toEqual({ drive: [], world: [], system: [] });
  });

  it('computes raw values without normalization', () => {
    const scenes: Scene[] = [
      createScene({
        id: 'S-001',
        threadMutations: [{ threadId: 'T-01', from: 'latent', to: 'seeded' }],
      }),
    ];

    const result = computeRawForceTotals(scenes);
    expect(result.drive).toHaveLength(1);
    expect(result.drive[0]).toBe(0.5); // latent→seeded = 0.5 weight, activeArcs=1
  });
});

// ── Moving Average ───────────────────────────────────────────────────────────

describe('movingAverage', () => {
  it('returns same array for window size 1', () => {
    const data = [1, 2, 3, 4, 5];
    expect(movingAverage(data, 1)).toEqual(data);
  });

  it('computes correct moving averages', () => {
    const data = [1, 2, 3, 4, 5];
    const result = movingAverage(data, 3);
    expect(result[0]).toBe(1); // [1]
    expect(result[1]).toBe(1.5); // [1, 2]
    expect(result[2]).toBe(2); // [1, 2, 3]
    expect(result[3]).toBe(3); // [2, 3, 4]
    expect(result[4]).toBe(4); // [3, 4, 5]
  });
});

// ── Delivery Curve ───────────────────────────────────────────────────────────

describe('computeDeliveryCurve', () => {
  it('returns empty array for empty input', () => {
    expect(computeDeliveryCurve([])).toEqual([]);
  });

  it('computes delivery points with all properties', () => {
    const snapshots: ForceSnapshot[] = [
      { drive: 0, world: 0, system: 0 },
      { drive: 1, world: 1, system: 1 },
      { drive: -1, world: -1, system: -1 },
      { drive: 0.5, world: 0.5, system: 0.5 },
    ];

    const curve = computeDeliveryCurve(snapshots);
    expect(curve).toHaveLength(4);

    for (const point of curve) {
      expect(point).toHaveProperty('index');
      expect(point).toHaveProperty('delivery');
      expect(point).toHaveProperty('tension');
      expect(point).toHaveProperty('smoothed');
      expect(point).toHaveProperty('macroTrend');
      expect(point).toHaveProperty('isPeak');
      expect(point).toHaveProperty('isValley');
    }
  });
});

// ── Shape Classification ─────────────────────────────────────────────────────

describe('classifyNarrativeShape', () => {
  it('returns flat for very short delivery arrays', () => {
    const shape = classifyNarrativeShape([0.5, 0.5, 0.5]);
    expect(shape.key).toBe('flat');
  });

  it('returns flat for constant deliveries', () => {
    const deliveries = Array(20).fill(0.5);
    const shape = classifyNarrativeShape(deliveries);
    expect(shape.key).toBe('flat');
  });

  it('detects escalating pattern for rising deliveries', () => {
    const deliveries = Array(20).fill(0).map((_, i) => i * 0.1);
    const shape = classifyNarrativeShape(deliveries);
    expect(shape.key).toBe('escalating');
  });
});

// ── Archetype Classification ─────────────────────────────────────────────────

describe('classifyArchetype', () => {
  it('returns opus for balanced high grades', () => {
    const grades = { drive: 24, world: 23, system: 22, swing: 20, overall: 89 };
    expect(classifyArchetype(grades).key).toBe('opus');
  });

  it('returns classic for drive-dominant', () => {
    const grades = { drive: 24, world: 15, system: 15, swing: 18, overall: 72 };
    expect(classifyArchetype(grades).key).toBe('classic');
  });

  it('returns emerging for low grades', () => {
    const grades = { drive: 10, world: 12, system: 8, swing: 10, overall: 40 };
    expect(classifyArchetype(grades).key).toBe('emerging');
  });
});

// ── Scale Classification ─────────────────────────────────────────────────────

describe('classifyScale', () => {
  it('classifies by scene count', () => {
    expect(classifyScale(10).key).toBe('short');
    expect(classifyScale(30).key).toBe('story');
    expect(classifyScale(80).key).toBe('novel');
    expect(classifyScale(200).key).toBe('epic');
    expect(classifyScale(500).key).toBe('serial');
  });
});

// ── World Density Classification ─────────────────────────────────────────────

describe('classifyWorldDensity', () => {
  it('returns sparse for zero scenes', () => {
    expect(classifyWorldDensity(0, 5, 3, 2, 10).key).toBe('sparse');
  });

  it('calculates density correctly', () => {
    // (10 + 5 + 5 + 5) / 10 = 2.5
    const result = classifyWorldDensity(10, 10, 5, 5, 5);
    expect(result.density).toBeCloseTo(2.5, 1);
    expect(result.key).toBe('rich');
  });
});

// ── Current Position Classification ──────────────────────────────────────────

describe('classifyCurrentPosition', () => {
  it('returns stable for empty points', () => {
    expect(classifyCurrentPosition([]).key).toBe('stable');
  });

  it('detects peak when last point is peak', () => {
    const points = [
      { index: 0, delivery: 0.2, tension: 0, smoothed: 0.2, macroTrend: 0.3, isPeak: false, isValley: false },
      { index: 1, delivery: 0.8, tension: 0, smoothed: 0.8, macroTrend: 0.5, isPeak: true, isValley: false },
    ];
    expect(classifyCurrentPosition(points).key).toBe('peak');
  });

  it('detects trough when last point is valley', () => {
    const points = [
      { index: 0, delivery: 0.8, tension: 0, smoothed: 0.8, macroTrend: 0.5, isPeak: false, isValley: false },
      { index: 1, delivery: 0.2, tension: 0, smoothed: 0.2, macroTrend: 0.3, isPeak: false, isValley: true },
    ];
    expect(classifyCurrentPosition(points).key).toBe('trough');
  });
});

// ── Windowed Forces ──────────────────────────────────────────────────────────

describe('computeWindowedForces', () => {
  it('returns empty result for empty scenes', () => {
    const result = computeWindowedForces([], 0);
    expect(result.forceMap).toEqual({});
  });

  it('computes forces within window', () => {
    const scenes = [
      createScene({ id: 'S-001' }),
      createScene({ id: 'S-002' }),
      createScene({ id: 'S-003' }),
    ];

    const result = computeWindowedForces(scenes, 2, 2);
    expect(result.windowStart).toBe(1);
    expect(result.windowEnd).toBe(2);
    expect(Object.keys(result.forceMap)).toContain('S-002');
    expect(Object.keys(result.forceMap)).toContain('S-003');
  });
});

// ── Grading Functions ────────────────────────────────────────────────────────

describe('gradeForce', () => {
  it('returns floor of 8 for 0 input', () => {
    expect(gradeForce(0)).toBe(8);
  });

  it('caps at 25', () => {
    expect(gradeForce(100)).toBe(25);
  });

  it('returns 21 at normalized mean of 1 (dominance threshold)', () => {
    expect(gradeForce(1)).toBe(21);
  });

  it('returns floor of 8 at zero', () => {
    expect(gradeForce(0)).toBe(8);
  });
});

describe('gradeForces', () => {
  it('returns grades for each force and overall', () => {
    const grades = gradeForces(
      [1.5, 1.5], // drive at reference
      [7, 7],     // world at reference
      [4, 4],     // system at reference
      [1, 1],     // swing
    );

    expect(grades).toHaveProperty('drive');
    expect(grades).toHaveProperty('world');
    expect(grades).toHaveProperty('system');
    expect(grades).toHaveProperty('swing');
    expect(grades).toHaveProperty('overall');
    // Individual grades are rounded before summing for overall, which is also rounded
    // So overall should be within ±2 of the sum due to rounding
    const sum = grades.drive + grades.world + grades.system + grades.swing;
    expect(Math.abs(grades.overall - sum)).toBeLessThanOrEqual(2);
  });
});

// ── World Knowledge Graph ────────────────────────────────────────────────────

describe('rankWorldKnowledgeNodes', () => {
  it('returns empty array for empty graph', () => {
    const graph: WorldKnowledgeGraph = { nodes: {}, edges: [] };
    expect(rankWorldKnowledgeNodes(graph)).toEqual([]);
  });

  it('ranks nodes by degree centrality', () => {
    const graph: WorldKnowledgeGraph = {
      nodes: {
        'K-01': { id: 'K-01', concept: 'Magic', type: 'system' },
        'K-02': { id: 'K-02', concept: 'Wands', type: 'system' },
        'K-03': { id: 'K-03', concept: 'Spells', type: 'concept' },
      },
      edges: [
        { from: 'K-01', to: 'K-02', relation: 'enables' },
        { from: 'K-01', to: 'K-03', relation: 'enables' },
        { from: 'K-02', to: 'K-03', relation: 'produces' },
      ],
    };

    const ranked = rankWorldKnowledgeNodes(graph);
    expect(ranked[0].node.id).toBe('K-01'); // degree 2
  });
});

describe('buildCumulativeWorldKnowledge', () => {
  it('accumulates mutations from scenes', () => {
    const scenes: Record<string, Scene> = {
      'S-001': createScene({
        id: 'S-001',
        worldKnowledgeMutations: {
          addedNodes: [{ id: 'K-01', concept: 'Magic', type: 'system' }],
          addedEdges: [],
        },
      }),
      'S-002': createScene({
        id: 'S-002',
        worldKnowledgeMutations: {
          addedNodes: [{ id: 'K-02', concept: 'Wands', type: 'system' }],
          addedEdges: [{ from: 'K-01', to: 'K-02', relation: 'enables' }],
        },
      }),
    };

    const graph = buildCumulativeWorldKnowledge(scenes, ['S-001', 'S-002'], 1);
    expect(Object.keys(graph.nodes)).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
  });
});
