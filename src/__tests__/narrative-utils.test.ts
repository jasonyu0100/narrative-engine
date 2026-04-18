import {
  averageSwing,
  buildCumulativeSystemGraph,
  classifyArchetype,
  classifyCurrentPosition,
  classifyNarrativeShape,
  classifyScale,
  classifyWorldDensity,
  computeDeliveryCurve,
  computeForceSnapshots,
  computeRawForceTotals,
  computeSwingMagnitudes,
  computeThreadStatuses,
  computeWindowedForces,
  cubeCornerProximity,
  detectCubeCorner,
  forceDistance,
  gradeForce,
  gradeForces,
  movingAverage,
  nextId,
  nextIds,
  rankSystemNodes,
  resolveEntrySequence,
  zScoreNormalize,
} from "@/lib/narrative-utils";
import type {
  Branch,
  ForceSnapshot,
  NarrativeState,
  Scene,
  SystemGraph,
} from "@/types/narrative";
import { describe, expect, it } from "vitest";
// ── Test Fixtures ────────────────────────────────────────────────────────────
function createScene(overrides: Partial<Scene> = {}): Scene {
  return {
    kind: "scene",
    id: overrides.id ?? "S-001",
    arcId: "ARC-01",
    povId: "C-01",
    locationId: "L-01",
    participantIds: ["C-01"],
    events: [],
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    characterMovements: {},
    summary: "Test scene",
    ...overrides,
  };
}
function createNarrative(
  overrides: Partial<NarrativeState> = {},
): NarrativeState {
  return {
    id: "test-narrative",
    title: "Test",
    description: "Test narrative",
    characters: {},
    locations: {},
    threads: {},
    scenes: {},
    arcs: {},
    worldBuilds: {},
    branches: {
      main: {
        id: "main",
        name: "Main",
        parentBranchId: null,
        forkEntryId: null,
        entryIds: [],
        createdAt: Date.now(),
      },
    },
    artifacts: {},
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}
// ── ID Generation ────────────────────────────────────────────────────────────
describe("nextId", () => {
  it("returns first ID when no existing IDs", () => {
    expect(nextId("C", [])).toBe("C-01");
    expect(nextId("S", [], 3)).toBe("S-001");
  });
  it("increments from highest existing ID", () => {
    expect(nextId("C", ["C-01", "C-02", "C-03"])).toBe("C-04");
  });
  it("handles non-sequential existing IDs", () => {
    expect(nextId("C", ["C-01", "C-05", "C-03"])).toBe("C-06");
  });
  it("handles complex ID formats", () => {
    expect(nextId("C", ["C-1742000000-3", "C-01"])).toBe("C-04");
  });
  it("respects custom padding width", () => {
    expect(nextId("S", ["S-001", "S-002"], 3)).toBe("S-003");
  });
});
describe("nextIds", () => {
  it("generates multiple sequential IDs", () => {
    const ids = nextIds("C", ["C-01"], 3);
    expect(ids).toEqual(["C-02", "C-03", "C-04"]);
  });
  it("handles empty existing IDs", () => {
    const ids = nextIds("S", [], 2, 3);
    expect(ids).toEqual(["S-001", "S-002"]);
  });
});
// ── Branch Resolution ────────────────────────────────────────────────────────
describe("resolveEntrySequence", () => {
  it("returns empty array for non-existent branch", () => {
    const branches: Record<string, Branch> = {};
    expect(resolveEntrySequence(branches, "non-existent")).toEqual([]);
  });
  it("returns own entries for root branch", () => {
    const branches: Record<string, Branch> = {
      main: {
        id: "main",
        name: "Main",
        parentBranchId: null,
        forkEntryId: null,
        entryIds: ["S-001", "S-002"],
        createdAt: 0,
      },
    };
    expect(resolveEntrySequence(branches, "main")).toEqual(["S-001", "S-002"]);
  });
  it("includes parent entries up to fork point", () => {
    const branches: Record<string, Branch> = {
      main: {
        id: "main",
        name: "Main",
        parentBranchId: null,
        forkEntryId: null,
        entryIds: ["S-001", "S-002", "S-003"],
        createdAt: 0,
      },
      child: {
        id: "child",
        name: "Child",
        entryIds: ["S-004", "S-005"],
        parentBranchId: "main",
        forkEntryId: "S-002",
        createdAt: 1,
      },
    };
    expect(resolveEntrySequence(branches, "child")).toEqual([
      "S-001",
      "S-002",
      "S-004",
      "S-005",
    ]);
  });
  it("handles deeply nested branches", () => {
    const branches: Record<string, Branch> = {
      main: {
        id: "main",
        name: "Main",
        parentBranchId: null,
        forkEntryId: null,
        entryIds: ["S-001", "S-002"],
        createdAt: 0,
      },
      child: {
        id: "child",
        name: "Child",
        entryIds: ["S-003"],
        parentBranchId: "main",
        forkEntryId: "S-001",
        createdAt: 1,
      },
      grandchild: {
        id: "grandchild",
        name: "Grandchild",
        entryIds: ["S-004"],
        parentBranchId: "child",
        forkEntryId: "S-003",
        createdAt: 2,
      },
    };
    expect(resolveEntrySequence(branches, "grandchild")).toEqual([
      "S-001",
      "S-003",
      "S-004",
    ]);
  });
});
// ── Thread Status Computation ────────────────────────────────────────────────
describe("computeThreadStatuses", () => {
  it("returns base statuses when no scenes", () => {
    const narrative = createNarrative({
      threads: {
        "T-01": {
          id: "T-01",
          status: "latent",
          description: "Thread 1",
          participants: [],
          dependents: [],
          openedAt: "S-000",
          threadLog: { nodes: {}, edges: [] },
        },
        "T-02": {
          id: "T-02",
          status: "active",
          description: "Thread 2",
          participants: [],
          dependents: [],
          openedAt: "S-000",
          threadLog: { nodes: {}, edges: [] },
        },
      },
    });
    const statuses = computeThreadStatuses(narrative, 0);
    expect(statuses["T-01"]).toBe("latent");
    expect(statuses["T-02"]).toBe("active");
  });
  it("applies thread deltas from scenes", () => {
    const narrative = createNarrative({
      threads: {
        "T-01": {
          id: "T-01",
          status: "latent",
          description: "Thread",
          participants: [],
          dependents: [],
          openedAt: "S-000",
          threadLog: { nodes: {}, edges: [] },
        },
      },
      scenes: {
        "S-001": createScene({
          id: "S-001",
          threadDeltas: [
            { threadId: "T-01", from: "latent", to: "active", addedNodes: [] },
          ],
        }),
        "S-002": createScene({
          id: "S-002",
          threadDeltas: [
            { threadId: "T-01", from: "active", to: "active", addedNodes: [] },
          ],
        }),
      },
    });
    expect(
      computeThreadStatuses(narrative, 0, ["S-001", "S-002"])["T-01"],
    ).toBe("active");
    expect(
      computeThreadStatuses(narrative, 1, ["S-001", "S-002"])["T-01"],
    ).toBe("active");
  });
});
// ── Force Distance & Cube Detection ──────────────────────────────────────────
describe("forceDistance", () => {
  it("returns 0 for identical snapshots", () => {
    const a: ForceSnapshot = { fate: 1, world: 1, system: 1 };
    expect(forceDistance(a, a)).toBe(0);
  });
  it("computes Euclidean distance", () => {
    const a: ForceSnapshot = { fate: 0, world: 0, system: 0 };
    const b: ForceSnapshot = { fate: 3, world: 4, system: 0 };
    expect(forceDistance(a, b)).toBe(5);
  });
});
describe("detectCubeCorner", () => {
  it("detects HHH corner for high forces", () => {
    const forces: ForceSnapshot = { fate: 1.5, world: 1.5, system: 1.5 };
    const corner = detectCubeCorner(forces);
    expect(corner.key).toBe("HHH");
  });
  it("detects LLL corner for low forces", () => {
    const forces: ForceSnapshot = { fate: -1.5, world: -1.5, system: -1.5 };
    const corner = detectCubeCorner(forces);
    expect(corner.key).toBe("LLL");
  });
});
describe("cubeCornerProximity", () => {
  it("returns 1 when at the corner", () => {
    const forces: ForceSnapshot = { fate: 1, world: 1, system: 1 };
    expect(cubeCornerProximity(forces, "HHH")).toBeCloseTo(1, 1);
  });
  it("returns smaller values further from corner", () => {
    const close: ForceSnapshot = { fate: 0.9, world: 0.9, system: 0.9 };
    const far: ForceSnapshot = { fate: -1, world: -1, system: -1 };
    expect(cubeCornerProximity(close, "HHH")).toBeGreaterThan(
      cubeCornerProximity(far, "HHH"),
    );
  });
});
// ── Swing Computation ────────────────────────────────────────────────────────
describe("computeSwingMagnitudes", () => {
  it("returns [0] for single snapshot", () => {
    const snapshots: ForceSnapshot[] = [{ fate: 1, world: 1, system: 1 }];
    expect(computeSwingMagnitudes(snapshots)).toEqual([0]);
  });
  it("computes Euclidean distance between consecutive snapshots", () => {
    const snapshots: ForceSnapshot[] = [
      { fate: 0, world: 0, system: 0 },
      { fate: 1, world: 0, system: 0 },
    ];
    const swings = computeSwingMagnitudes(snapshots);
    expect(swings[0]).toBe(0);
    expect(swings[1]).toBe(1);
  });
  it("normalizes by reference means when provided", () => {
    const snapshots: ForceSnapshot[] = [
      { fate: 0, world: 0, system: 0 },
      { fate: 2, world: 0, system: 0 },
    ];
    const refMeans = { fate: 2, world: 1, system: 1 };
    const swings = computeSwingMagnitudes(snapshots, refMeans);
    expect(swings[1]).toBe(1); // 2/2 = 1
  });
});
describe("averageSwing", () => {
  it("returns 0 for empty or single snapshot", () => {
    expect(averageSwing([])).toBe(0);
    expect(averageSwing([{ fate: 1, world: 1, system: 1 }])).toBe(0);
  });
});
// ── Z-Score Normalization ────────────────────────────────────────────────────
describe("zScoreNormalize", () => {
  it("returns empty array for empty input", () => {
    expect(zScoreNormalize([])).toEqual([]);
  });
  it("returns all zeros for constant values", () => {
    expect(zScoreNormalize([5, 5, 5, 5])).toEqual([0, 0, 0, 0]);
  });
  it("normalizes with mean 0 and unit std", () => {
    const values = [2, 4, 6, 8];
    const normalized = zScoreNormalize(values);
    // Mean should be 0
    const mean = normalized.reduce((s, v) => s + v, 0) / normalized.length;
    expect(mean).toBeCloseTo(0, 5);
    // Std should be ~1
    const variance =
      normalized.reduce((s, v) => s + v * v, 0) / normalized.length;
    expect(Math.sqrt(variance)).toBeCloseTo(1, 1);
  });
});
// ── Force Computation ────────────────────────────────────────────────────────
describe("computeForceSnapshots", () => {
  it("returns empty object for empty scenes", () => {
    expect(computeForceSnapshots([])).toEqual({});
  });
  it("computes z-score normalized forces", () => {
    const scenes: Scene[] = [
      createScene({
        id: "S-001",
        threadDeltas: [
          { threadId: "T-01", from: "latent", to: "seeded", addedNodes: [] },
        ],
        worldDeltas: [],
        events: ["event1"],
      }),
      createScene({
        id: "S-002",
        threadDeltas: [
          { threadId: "T-01", from: "seeded", to: "active", addedNodes: [] },
        ],
        worldDeltas: [
          {
            entityId: "C-01",
            addedNodes: [{ id: "K-01", content: "secret", type: "secret" }],
          },
        ],
        events: ["event1", "event2"],
      }),
    ];
    const snapshots = computeForceSnapshots(scenes);
    expect(Object.keys(snapshots)).toHaveLength(2);
    expect(snapshots["S-001"]).toBeDefined();
    expect(snapshots["S-002"]).toBeDefined();
  });
});
describe("computeRawForceTotals", () => {
  it("returns empty arrays for empty scenes", () => {
    const result = computeRawForceTotals([]);
    expect(result).toEqual({ fate: [], world: [], system: [] });
  });
  it("computes raw values without normalization", () => {
    const scenes: Scene[] = [
      createScene({
        id: "S-001",
        threadDeltas: [
          { threadId: "T-01", from: "latent", to: "seeded", addedNodes: [] },
        ],
      }),
    ];
    const result = computeRawForceTotals(scenes);
    expect(result.fate).toHaveLength(1);
    expect(result.fate[0]).toBe(1.0); // latent→seeded = 1.0 weight
  });
});

// ── Fate weight invariants ──────────────────────────────────────────────────
// The stage-weight table is the spine of the Fate formula. Every legal
// forward transition must earn nonzero fate — if the table has a gap, the
// LLM's valid multi-stage jumps (e.g. latent→escalating in a scene that
// both surfaces and commits a thread) silently contribute zero and the
// fate curve flattens. These invariants lock the table shape so future
// edits can't accidentally reintroduce gaps or let holding out-earn
// advancement.
describe("fate weight invariants", () => {
  const STAGES = ['latent', 'seeded', 'active', 'escalating', 'critical'] as const;
  const STAGE_INDEX: Record<string, number> = {
    latent: 0, seeded: 1, active: 2, escalating: 3, critical: 4,
    resolved: 5, subverted: 5,
  };
  const fate = (from: string, to: string) =>
    computeRawForceTotals([
      createScene({
        threadDeltas: [{ threadId: 'T-01', from: from as Scene['threadDeltas'][0]['from'], to: to as Scene['threadDeltas'][0]['to'], addedNodes: [] }],
      }),
    ]).fate[0];

  it("every forward transition earns nonzero fate", () => {
    const gaps: string[] = [];
    const terminals = ['resolved', 'subverted'] as const;
    for (const from of STAGES) {
      for (const to of [...STAGES, ...terminals]) {
        if (STAGE_INDEX[to] > STAGE_INDEX[from]) {
          if (fate(from, to) === 0) gaps.push(`${from}->${to}`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it("forward transitions earn the weight of their destination stage", () => {
    // A multi-stage jump earns the same as a single-step arrival at the
    // same stage — the LLM shouldn't be penalised for compressing stages
    // into one scene when the prose genuinely earns it.
    const DEST_WEIGHT: Record<string, number> = {
      seeded: 1.0, active: 1.5, escalating: 2.0, critical: 3.0,
      resolved: 5.0, subverted: 5.0,
    };
    const violations: string[] = [];
    for (const from of STAGES) {
      for (const [to, expected] of Object.entries(DEST_WEIGHT)) {
        if (STAGE_INDEX[to] <= STAGE_INDEX[from]) continue;
        const w = fate(from, to);
        if (w !== expected) violations.push(`${from}->${to}: ${w} (expected ${expected})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("advancement always out-earns holding at the same stage", () => {
    // Every forward transition from stage S must earn strictly more than
    // a pulse at stage S — otherwise the LLM can farm fate by coasting.
    const violations: string[] = [];
    const terminals = ['resolved', 'subverted'] as const;
    for (const from of STAGES) {
      const pulse = fate(from, from);
      for (const to of [...STAGES, ...terminals]) {
        if (STAGE_INDEX[to] > STAGE_INDEX[from]) {
          const forward = fate(from, to);
          if (forward <= pulse) violations.push(`${from}->${to} (${forward}) ≤ pulse@${from} (${pulse})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("abandonment earns zero fate (cleanup, not resolution)", () => {
    for (const from of STAGES) {
      expect(fate(from, 'abandoned')).toBe(0);
    }
  });

  it("backward transitions earn zero fate (regression is not fate)", () => {
    expect(fate('escalating', 'active')).toBe(0);
    expect(fate('critical', 'active')).toBe(0);
    expect(fate('resolved', 'escalating')).toBe(0);
  });

  it("pulses are monotonically non-decreasing by stage", () => {
    const pulses = STAGES.map((s) => fate(s, s));
    for (let i = 1; i < pulses.length; i++) {
      expect(pulses[i]).toBeGreaterThanOrEqual(pulses[i - 1]);
    }
  });
});
// ── Moving Average ───────────────────────────────────────────────────────────
describe("movingAverage", () => {
  it("returns same array for window size 1", () => {
    const data = [1, 2, 3, 4, 5];
    expect(movingAverage(data, 1)).toEqual(data);
  });
  it("computes correct moving averages", () => {
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
describe("computeDeliveryCurve", () => {
  it("returns empty array for empty input", () => {
    expect(computeDeliveryCurve([])).toEqual([]);
  });
  it("computes delivery points with all properties", () => {
    const snapshots: ForceSnapshot[] = [
      { fate: 0, world: 0, system: 0 },
      { fate: 1, world: 1, system: 1 },
      { fate: -1, world: -1, system: -1 },
      { fate: 0.5, world: 0.5, system: 0.5 },
    ];
    const curve = computeDeliveryCurve(snapshots);
    expect(curve).toHaveLength(4);
    for (const point of curve) {
      expect(point).toHaveProperty("index");
      expect(point).toHaveProperty("delivery");
      expect(point).toHaveProperty("tension");
      expect(point).toHaveProperty("smoothed");
      expect(point).toHaveProperty("macroTrend");
      expect(point).toHaveProperty("isPeak");
      expect(point).toHaveProperty("isValley");
    }
  });
});
// ── Shape Classification ─────────────────────────────────────────────────────
describe("classifyNarrativeShape", () => {
  it("returns flat for very short delivery arrays", () => {
    const shape = classifyNarrativeShape([0.5, 0.5, 0.5]);
    expect(shape.key).toBe("flat");
  });
  it("returns flat for constant deliveries", () => {
    const deliveries = Array(20).fill(0.5);
    const shape = classifyNarrativeShape(deliveries);
    expect(shape.key).toBe("flat");
  });
  it("detects escalating pattern for rising deliveries", () => {
    const deliveries = Array(20)
      .fill(0)
      .map((_, i) => i * 0.1);
    const shape = classifyNarrativeShape(deliveries);
    expect(shape.key).toBe("escalating");
  });
});
// ── Archetype Classification ─────────────────────────────────────────────────
describe("classifyArchetype", () => {
  it("returns opus when every force clears the Opus floor (≥22)", () => {
    // All three at 22 or higher → opus. The floor sits one notch above the
    // dominance floor (21), so clearly-balanced profiles like 22/23/24 land
    // here instead of being demoted to a two-force pair.
    expect(
      classifyArchetype({ fate: 22, world: 22, system: 22, swing: 20, overall: 86 }).key,
    ).toBe("opus");
    expect(
      classifyArchetype({ fate: 22, world: 23, system: 24, swing: 20, overall: 89 }).key,
    ).toBe("opus");
    expect(
      classifyArchetype({ fate: 24, world: 25, system: 23, swing: 20, overall: 92 }).key,
    ).toBe("opus");
  });
  it("demotes three-way nominal dominance when any force sits below the Opus floor", () => {
    // fate 24 + world 21 + system 24 — all three nominally dominant (≥21,
    // within 5 of max), but world=21 is below Opus floor 22. Weakest force
    // (world) is dropped, leaving fate + system → atlas.
    expect(
      classifyArchetype({ fate: 24, world: 21, system: 24, swing: 20, overall: 89 }).key,
    ).toBe("atlas");
    // fate weakest of the three-way → chronicle (world + system)
    expect(
      classifyArchetype({ fate: 21, world: 24, system: 24, swing: 20, overall: 89 }).key,
    ).toBe("chronicle");
    // system weakest of the three-way → series (fate + world)
    expect(
      classifyArchetype({ fate: 24, world: 24, system: 21, swing: 20, overall: 89 }).key,
    ).toBe("series");
  });
  it("returns series for co-dominant fate + world", () => {
    const grades = { fate: 24, world: 23, system: 15, swing: 18, overall: 80 };
    expect(classifyArchetype(grades).key).toBe("series");
  });
  it("returns atlas for co-dominant fate + system", () => {
    const grades = { fate: 24, world: 15, system: 22, swing: 18, overall: 79 };
    expect(classifyArchetype(grades).key).toBe("atlas");
  });
  it("returns chronicle for co-dominant world + system", () => {
    const grades = { fate: 15, world: 23, system: 22, swing: 18, overall: 78 };
    expect(classifyArchetype(grades).key).toBe("chronicle");
  });
  it("returns classic for fate-dominant", () => {
    const grades = { fate: 24, world: 15, system: 15, swing: 18, overall: 72 };
    expect(classifyArchetype(grades).key).toBe("classic");
  });
  it("returns stage for world-dominant", () => {
    const grades = { fate: 15, world: 24, system: 15, swing: 18, overall: 72 };
    expect(classifyArchetype(grades).key).toBe("stage");
  });
  it("returns paper for system-dominant", () => {
    const grades = { fate: 15, world: 15, system: 24, swing: 18, overall: 72 };
    expect(classifyArchetype(grades).key).toBe("paper");
  });
  it("requires ≥21 to count as dominant even if within 5 of max", () => {
    // fate 20 is within 5 of max but below the dominance floor → no fate
    // dominance. With world 20 below floor too, only system dominates → paper.
    const grades = { fate: 20, world: 20, system: 22, swing: 12, overall: 70 };
    expect(classifyArchetype(grades).key).toBe("paper");
  });
  it("returns emerging for low grades", () => {
    const grades = { fate: 10, world: 12, system: 8, swing: 10, overall: 40 };
    expect(classifyArchetype(grades).key).toBe("emerging");
  });
  it("returns emerging when all forces are below the dominance floor", () => {
    // All within 5 of each other, all below 21 — no dominant force
    const grades = { fate: 19, world: 20, system: 18, swing: 14, overall: 68 };
    expect(classifyArchetype(grades).key).toBe("emerging");
  });
});
// ── Scale Classification ─────────────────────────────────────────────────────
describe("classifyScale", () => {
  it("classifies by scene count", () => {
    expect(classifyScale(10).key).toBe("short");
    expect(classifyScale(30).key).toBe("story");
    expect(classifyScale(80).key).toBe("novel");
    expect(classifyScale(200).key).toBe("epic");
    expect(classifyScale(500).key).toBe("serial");
  });
});
// ── World Density Classification ─────────────────────────────────────────────
describe("classifyWorldDensity", () => {
  it("returns sparse for zero scenes", () => {
    expect(classifyWorldDensity(0, 5, 3, 2, 10).key).toBe("sparse");
  });
  it("calculates density correctly", () => {
    // (10 + 5 + 5 + 5) / 10 = 2.5
    const result = classifyWorldDensity(10, 10, 5, 5, 5);
    expect(result.density).toBeCloseTo(2.5, 1);
    expect(result.key).toBe("rich");
  });
});
// ── Current Position Classification ──────────────────────────────────────────
describe("classifyCurrentPosition", () => {
  it("returns stable for empty points", () => {
    expect(classifyCurrentPosition([]).key).toBe("stable");
  });
  it("detects peak when last point is peak", () => {
    const points = [
      {
        index: 0,
        delivery: 0.2,
        tension: 0,
        smoothed: 0.2,
        macroTrend: 0.3,
        isPeak: false,
        isValley: false,
      },
      {
        index: 1,
        delivery: 0.8,
        tension: 0,
        smoothed: 0.8,
        macroTrend: 0.5,
        isPeak: true,
        isValley: false,
      },
    ];
    expect(classifyCurrentPosition(points).key).toBe("peak");
  });
  it("detects trough when last point is valley", () => {
    const points = [
      {
        index: 0,
        delivery: 0.8,
        tension: 0,
        smoothed: 0.8,
        macroTrend: 0.5,
        isPeak: false,
        isValley: false,
      },
      {
        index: 1,
        delivery: 0.2,
        tension: 0,
        smoothed: 0.2,
        macroTrend: 0.3,
        isPeak: false,
        isValley: true,
      },
    ];
    expect(classifyCurrentPosition(points).key).toBe("trough");
  });
});
// ── Windowed Forces ──────────────────────────────────────────────────────────
describe("computeWindowedForces", () => {
  it("returns empty result for empty scenes", () => {
    const result = computeWindowedForces([], 0);
    expect(result.forceMap).toEqual({});
  });
  it("computes forces within window", () => {
    const scenes = [
      createScene({ id: "S-001" }),
      createScene({ id: "S-002" }),
      createScene({ id: "S-003" }),
    ];
    const result = computeWindowedForces(scenes, 2, 2);
    expect(result.windowStart).toBe(1);
    expect(result.windowEnd).toBe(2);
    expect(Object.keys(result.forceMap)).toContain("S-002");
    expect(Object.keys(result.forceMap)).toContain("S-003");
  });
});
// ── Grading Functions ────────────────────────────────────────────────────────
describe("gradeForce", () => {
  it("returns floor of 8 for 0 input", () => {
    expect(gradeForce(0)).toBe(8);
  });
  it("caps at 25", () => {
    expect(gradeForce(100)).toBe(25);
  });
  it("returns 21 at normalized mean of 1 (dominance threshold)", () => {
    expect(gradeForce(1)).toBe(21);
  });
  it("returns floor of 8 at zero", () => {
    expect(gradeForce(0)).toBe(8);
  });
});
describe("gradeForces", () => {
  it("returns grades for each force and overall", () => {
    const grades = gradeForces(
      [2.5, 2.5], // fate at reference
      [7, 7], // world at reference
      [4, 4], // system at reference
      [1, 1], // swing
    );
    expect(grades).toHaveProperty("fate");
    expect(grades).toHaveProperty("world");
    expect(grades).toHaveProperty("system");
    expect(grades).toHaveProperty("swing");
    expect(grades).toHaveProperty("overall");
    // Individual grades are rounded before summing for overall, which is also rounded
    // So overall should be within ±2 of the sum due to rounding
    const sum = grades.fate + grades.world + grades.system + grades.swing;
    expect(Math.abs(grades.overall - sum)).toBeLessThanOrEqual(2);
  });
});
// ── System Knowledge Graph ────────────────────────────────────────────────────
describe("rankSystemNodes", () => {
  it("returns empty array for empty graph", () => {
    const graph: SystemGraph = { nodes: {}, edges: [] };
    expect(rankSystemNodes(graph)).toEqual([]);
  });
  it("ranks nodes by degree centrality", () => {
    const graph: SystemGraph = {
      nodes: {
        "K-01": { id: "K-01", concept: "Magic", type: "system" },
        "K-02": { id: "K-02", concept: "Wands", type: "system" },
        "K-03": { id: "K-03", concept: "Spells", type: "concept" },
      },
      edges: [
        { from: "K-01", to: "K-02", relation: "enables" },
        { from: "K-01", to: "K-03", relation: "enables" },
        { from: "K-02", to: "K-03", relation: "produces" },
      ],
    };
    const ranked = rankSystemNodes(graph);
    expect(ranked[0].node.id).toBe("K-01"); // degree 2
  });
});
describe("buildCumulativeSystemGraph", () => {
  it("accumulates deltas from scenes", () => {
    const scenes: Record<string, Scene> = {
      "S-001": createScene({
        id: "S-001",
        systemDeltas: {
          addedNodes: [{ id: "K-01", concept: "Magic", type: "system" }],
          addedEdges: [],
        },
      }),
      "S-002": createScene({
        id: "S-002",
        systemDeltas: {
          addedNodes: [{ id: "K-02", concept: "Wands", type: "system" }],
          addedEdges: [{ from: "K-01", to: "K-02", relation: "enables" }],
        },
      }),
    };
    const graph = buildCumulativeSystemGraph(scenes, ["S-001", "S-002"], 1);
    expect(Object.keys(graph.nodes)).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
  });
});
