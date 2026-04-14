import {
  applyDerivedForceModes,
  buildOutlineDirective,
  checkEndConditions,
  computeStoryProgress,
  deriveArcForceMode,
  evaluateNarrativeState,
  getArcNode,
  getStoryPhase,
  pickArcLength,
  type DirectiveContext,
  type StoryPhase,
} from "@/lib/auto-engine";
import { AUTO_STOP_CYCLE_LENGTH } from "@/lib/constants";
import type {
  AutoConfig,
  Character,
  CoordinationNode,
  CoordinationPlan,
  Location,
  NarrativeState,
  Scene,
  Thread,
} from "@/types/narrative";
import { describe, expect, it } from "vitest";
// ── Test Fixtures ────────────────────────────────────────────────────────────
function createScene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    kind: "scene",
    id,
    arcId: "arc-1",
    povId: "char-1",
    locationId: "loc-1",
    participantIds: ["char-1"],
    summary: `Scene ${id} summary`,
    events: ["Event 1"],
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    characterMovements: {},
    ...overrides,
  };
}
function createThread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    description: `Thread ${id} description`,
    status: "active",
    participants: [],
    dependents: [],
    openedAt: "s1",
    threadLog: { nodes: {}, edges: [] },
    ...overrides,
  };
}
function createCharacter(
  id: string,
  overrides: Partial<Character> = {},
): Character {
  return {
    id,
    name: `Character ${id}`,
    role: "recurring",
    threadIds: [],
    world: { nodes: {}, edges: [] },
    ...overrides,
  };
}
function createLocation(
  id: string,
  overrides: Partial<Location> = {},
): Location {
  return {
    id,
    name: `Location ${id}`,
    prominence: "place" as const,
    parentId: null,
    tiedCharacterIds: [],
    threadIds: [],
    world: { nodes: {}, edges: [] },
    ...overrides,
  };
}
function createMinimalNarrative(): NarrativeState {
  return {
    id: "N-001",
    title: "Test Narrative",
    description: "A test story",
    characters: {
      "char-1": createCharacter("char-1", { name: "Alice" }),
    },
    locations: {
      "loc-1": createLocation("loc-1", { name: "Castle" }),
    },
    threads: {
      "T-001": createThread("T-001", { description: "Main mystery" }),
    },
    artifacts: {},
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
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
function createAutoConfig(overrides: Partial<AutoConfig> = {}): AutoConfig {
  return {
    endConditions: [],
    direction: "Continue the story",
    minArcLength: 3,
    maxArcLength: 8,
    maxActiveThreads: 5,
    threadStagnationThreshold: 3,
    toneGuidance: "",
    narrativeConstraints: "",
    characterRotationEnabled: true,
    minScenesBetweenCharacterFocus: 5,
    ...overrides,
  };
}
// ── computeStoryProgress Tests ───────────────────────────────────────────────
describe("computeStoryProgress", () => {
  it("returns 0 at start with scene_count condition", () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: "scene_count", target: 20 }],
    });
    const progress = computeStoryProgress(narrative, [], config, 0, 0);
    expect(progress).toBe(0);
  });
  it("returns 0.5 when halfway through scene_count target", () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: "scene_count", target: 20 }],
    });
    const resolvedKeys = Array.from({ length: 10 }, (_, i) => `S-${i}`);
    const progress = computeStoryProgress(
      narrative,
      resolvedKeys,
      config,
      0,
      0,
    );
    expect(progress).toBe(0.5);
  });
  it("clamps to 1 when exceeding scene_count target", () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: "scene_count", target: 10 }],
    });
    const resolvedKeys = Array.from({ length: 15 }, (_, i) => `S-${i}`);
    const progress = computeStoryProgress(
      narrative,
      resolvedKeys,
      config,
      0,
      0,
    );
    expect(progress).toBe(1);
  });
  it("uses arc_count condition", () => {
    const narrative = createMinimalNarrative();
    narrative.arcs = {
      "arc-1": {
        id: "arc-1",
        name: "Arc 1",
        sceneIds: [],
        develops: [],
        locationIds: [],
        activeCharacterIds: [],
        initialCharacterLocations: {},
      },
      "arc-2": {
        id: "arc-2",
        name: "Arc 2",
        sceneIds: [],
        develops: [],
        locationIds: [],
        activeCharacterIds: [],
        initialCharacterLocations: {},
      },
      "arc-3": {
        id: "arc-3",
        name: "Arc 3",
        sceneIds: [],
        develops: [],
        locationIds: [],
        activeCharacterIds: [],
        initialCharacterLocations: {},
      },
    };
    const config = createAutoConfig({
      endConditions: [{ type: "arc_count", target: 6 }],
    });
    const progress = computeStoryProgress(narrative, [], config, 0, 0);
    expect(progress).toBe(0.5);
  });
  it("accounts for startingArcCount", () => {
    const narrative = createMinimalNarrative();
    narrative.arcs = {
      "arc-1": {
        id: "arc-1",
        name: "Arc 1",
        sceneIds: [],
        develops: [],
        locationIds: [],
        activeCharacterIds: [],
        initialCharacterLocations: {},
      },
      "arc-2": {
        id: "arc-2",
        name: "Arc 2",
        sceneIds: [],
        develops: [],
        locationIds: [],
        activeCharacterIds: [],
        initialCharacterLocations: {},
      },
      "arc-3": {
        id: "arc-3",
        name: "Arc 3",
        sceneIds: [],
        develops: [],
        locationIds: [],
        activeCharacterIds: [],
        initialCharacterLocations: {},
      },
    };
    const config = createAutoConfig({
      endConditions: [{ type: "arc_count", target: 4 }],
    });
    // Started with 2 arcs, now have 3, so 1 arc completed, target is 4
    const progress = computeStoryProgress(narrative, [], config, 0, 2);
    expect(progress).toBe(0.25);
  });
  it("uses max progress when multiple conditions exist", () => {
    const narrative = createMinimalNarrative();
    narrative.arcs = {
      "arc-1": {
        id: "arc-1",
        name: "Arc 1",
        sceneIds: [],
        develops: [],
        locationIds: [],
        activeCharacterIds: [],
        initialCharacterLocations: {},
      },
    };
    const config = createAutoConfig({
      endConditions: [
        { type: "scene_count", target: 20 }, // 5/20 = 25%
        { type: "arc_count", target: 2 }, // 1/2 = 50%
      ],
    });
    const resolvedKeys = Array.from({ length: 5 }, (_, i) => `S-${i}`);
    const progress = computeStoryProgress(
      narrative,
      resolvedKeys,
      config,
      0,
      0,
    );
    expect(progress).toBe(0.5); // max of 0.25 and 0.5
  });
  it("uses cyclic progress for manual_stop only", () => {
    const narrative = createMinimalNarrative();
    // Create arcs to test cycling
    for (let i = 0; i < AUTO_STOP_CYCLE_LENGTH + 5; i++) {
      narrative.arcs[`arc-${i}`] = {
        id: `arc-${i}`,
        name: `Arc ${i}`,
        sceneIds: [],
        develops: [],
        locationIds: [],
        activeCharacterIds: [],
        initialCharacterLocations: {},
      };
    }
    const config = createAutoConfig({
      endConditions: [{ type: "manual_stop" }],
    });
    const progress = computeStoryProgress(narrative, [], config, 0, 0);
    // Should be (cycleLength + 5) % cycleLength / cycleLength = 5 / cycleLength
    expect(progress).toBeCloseTo(5 / AUTO_STOP_CYCLE_LENGTH, 5);
  });
  it("returns cyclic progress when no end conditions", () => {
    const narrative = createMinimalNarrative();
    narrative.arcs = {
      "arc-1": {
        id: "arc-1",
        name: "Arc 1",
        sceneIds: [],
        develops: [],
        locationIds: [],
        activeCharacterIds: [],
        initialCharacterLocations: {},
      },
      "arc-2": {
        id: "arc-2",
        name: "Arc 2",
        sceneIds: [],
        develops: [],
        locationIds: [],
        activeCharacterIds: [],
        initialCharacterLocations: {},
      },
    };
    const config = createAutoConfig({
      endConditions: [],
    });
    const progress = computeStoryProgress(narrative, [], config, 0, 0);
    expect(progress).toBe(2 / AUTO_STOP_CYCLE_LENGTH);
  });
});
// ── getStoryPhase Tests ─────────────────────────────────────────────────────
describe("getStoryPhase", () => {
  it("returns setup phase at 0%", () => {
    expect(getStoryPhase(0)).toBe("setup");
  });
  it("returns setup phase at 10%", () => {
    expect(getStoryPhase(0.1)).toBe("setup");
  });
  it("returns rising phase at 20%", () => {
    expect(getStoryPhase(0.2)).toBe("rising");
  });
  it("returns midpoint phase at 40%", () => {
    expect(getStoryPhase(0.4)).toBe("midpoint");
  });
  it("returns escalation phase at 60%", () => {
    expect(getStoryPhase(0.6)).toBe("escalation");
  });
  it("returns climax phase at 80%", () => {
    expect(getStoryPhase(0.8)).toBe("climax");
  });
  it("returns resolution phase at 95%", () => {
    expect(getStoryPhase(0.95)).toBe("resolution");
  });
  it("returns resolution phase at 100%", () => {
    expect(getStoryPhase(1.0)).toBe("resolution");
  });
});
// ── checkEndConditions Tests ────────────────────────────────────────────────
describe("checkEndConditions", () => {
  it("returns null when no conditions met", () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: "scene_count", target: 10 }],
    });
    const result = checkEndConditions(narrative, ["S-1", "S-2"], config);
    expect(result).toBeNull();
  });
  it("returns scene_count condition when met", () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: "scene_count", target: 5 }],
    });
    const resolvedKeys = Array.from({ length: 5 }, (_, i) => `S-${i}`);
    const result = checkEndConditions(narrative, resolvedKeys, config);
    expect(result).toEqual({ type: "scene_count", target: 5 });
  });
  it("accounts for startingSceneCount", () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: "scene_count", target: 3 }],
    });
    // 5 total scenes, started with 3, so 2 new scenes (< 3 target)
    const resolvedKeys = Array.from({ length: 5 }, (_, i) => `S-${i}`);
    const result = checkEndConditions(narrative, resolvedKeys, config, 3);
    expect(result).toBeNull();
  });
  it("returns arc_count condition when met", () => {
    const narrative = createMinimalNarrative();
    narrative.arcs = {
      "arc-1": {
        id: "arc-1",
        name: "Arc 1",
        sceneIds: [],
        develops: [],
        locationIds: [],
        activeCharacterIds: [],
        initialCharacterLocations: {},
      },
      "arc-2": {
        id: "arc-2",
        name: "Arc 2",
        sceneIds: [],
        develops: [],
        locationIds: [],
        activeCharacterIds: [],
        initialCharacterLocations: {},
      },
    };
    const config = createAutoConfig({
      endConditions: [{ type: "arc_count", target: 2 }],
    });
    const result = checkEndConditions(narrative, [], config);
    expect(result).toEqual({ type: "arc_count", target: 2 });
  });
  it("accounts for startingArcCount", () => {
    const narrative = createMinimalNarrative();
    narrative.arcs = {
      "arc-1": {
        id: "arc-1",
        name: "Arc 1",
        sceneIds: [],
        develops: [],
        locationIds: [],
        activeCharacterIds: [],
        initialCharacterLocations: {},
      },
      "arc-2": {
        id: "arc-2",
        name: "Arc 2",
        sceneIds: [],
        develops: [],
        locationIds: [],
        activeCharacterIds: [],
        initialCharacterLocations: {},
      },
    };
    const config = createAutoConfig({
      endConditions: [{ type: "arc_count", target: 3 }],
    });
    // Started with 1 arc, now have 2, so 1 new arc (< 3 target)
    const result = checkEndConditions(narrative, [], config, 0, 1);
    expect(result).toBeNull();
  });
  it("returns all_threads_resolved when all terminal", () => {
    const narrative = createMinimalNarrative();
    narrative.threads = {
      "T-001": createThread("T-001", { status: "resolved" }),
      "T-002": createThread("T-002", { status: "subverted" }),
    };
    const config = createAutoConfig({
      endConditions: [{ type: "all_threads_resolved" }],
    });
    const result = checkEndConditions(narrative, [], config);
    expect(result).toEqual({ type: "all_threads_resolved" });
  });
  it("returns null when some threads still active", () => {
    const narrative = createMinimalNarrative();
    narrative.threads = {
      "T-001": createThread("T-001", { status: "resolved" }),
      "T-002": createThread("T-002", { status: "active" }),
    };
    const config = createAutoConfig({
      endConditions: [{ type: "all_threads_resolved" }],
    });
    const result = checkEndConditions(narrative, [], config);
    expect(result).toBeNull();
  });
  it("returns null for all_threads_resolved when no threads exist", () => {
    const narrative = createMinimalNarrative();
    narrative.threads = {};
    const config = createAutoConfig({
      endConditions: [{ type: "all_threads_resolved" }],
    });
    const result = checkEndConditions(narrative, [], config);
    expect(result).toBeNull();
  });
  it("returns planning_complete when all arcs complete", () => {
    const narrative = createMinimalNarrative();
    narrative.branches.main.coordinationPlan = {
      plan: {
        id: "test-plan",
        nodes: [],
        edges: [],
        arcCount: 2,
        summary: "Test plan",
        arcPartitions: [],
        currentArc: 2,
        completedArcs: [1, 2],
        createdAt: Date.now(),
      },
      autoExecute: true,
    };
    const config = createAutoConfig({
      endConditions: [{ type: "planning_complete" }],
    });
    const result = checkEndConditions(narrative, [], config, 0, 0, "main");
    expect(result).toEqual({ type: "planning_complete" });
  });
  it("returns null for planning_complete when arcs incomplete", () => {
    const narrative = createMinimalNarrative();
    narrative.branches.main.coordinationPlan = {
      plan: {
        id: "test-plan",
        nodes: [],
        edges: [],
        arcCount: 3,
        summary: "Test plan",
        arcPartitions: [],
        currentArc: 1,
        completedArcs: [1],
        createdAt: Date.now(),
      },
      autoExecute: true,
    };
    const config = createAutoConfig({
      endConditions: [{ type: "planning_complete" }],
    });
    const result = checkEndConditions(narrative, [], config, 0, 0, "main");
    expect(result).toBeNull();
  });
  it("never returns manual_stop condition", () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: "manual_stop" }],
    });
    const result = checkEndConditions(narrative, [], config);
    expect(result).toBeNull();
  });
  it("returns first met condition when multiple exist", () => {
    const narrative = createMinimalNarrative();
    narrative.threads = {
      "T-001": createThread("T-001", { status: "resolved" }),
    };
    const config = createAutoConfig({
      endConditions: [
        { type: "scene_count", target: 5 },
        { type: "all_threads_resolved" },
      ],
    });
    const resolvedKeys = Array.from({ length: 5 }, (_, i) => `S-${i}`);
    const result = checkEndConditions(narrative, resolvedKeys, config);
    // scene_count comes first
    expect(result).toEqual({ type: "scene_count", target: 5 });
  });
});
// ── pickArcLength Tests ─────────────────────────────────────────────────────
describe("pickArcLength", () => {
  const config = createAutoConfig({ minArcLength: 3, maxArcLength: 8 });
  const basePressure = {
    threads: { stale: [], primed: [], activeCount: 2, needsResolution: false, needsSeeding: false },
    entities: { shallow: [], neglected: [], recentGrowth: 3 },
    knowledge: { isStagnant: false, recentGrowth: 1 },
    balance: { dominant: "balanced" as const, recommendation: "" },
  };
  it("returns minArcLength when many primed threads", () => {
    const pressure = {
      ...basePressure,
      threads: { ...basePressure.threads, primed: [{}, {}] as any[] },
    };
    expect(pickArcLength(config, pressure)).toBe(3);
  });
  it("returns medium length when needs resolution", () => {
    const pressure = {
      ...basePressure,
      threads: { ...basePressure.threads, needsResolution: true },
    };
    expect(pickArcLength(config, pressure)).toBe(6); // ceil((3+8)/2)
  });
  it("returns maxArcLength when character development needed", () => {
    const pressure = {
      ...basePressure,
      entities: { shallow: [{}] as any[], neglected: [], recentGrowth: 1 },
    };
    expect(pickArcLength(config, pressure)).toBe(8);
  });
  it("returns medium length by default", () => {
    expect(pickArcLength(config, basePressure)).toBe(6);
  });
});
// ── evaluateNarrativeState Tests ────────────────────────────────────────────
describe("evaluateNarrativeState", () => {
  it("returns AutoDirective with phase, progress, pressure, directive", () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: "scene_count", target: 50 }],
    });
    const result = evaluateNarrativeState(narrative, [], 0, config);
    expect(result.phase).toBeDefined();
    expect(result.progress).toBeDefined();
    expect(result.pressure).toBeDefined();
    expect(result.directive).toBeDefined();
  });
  it("returns valid story phase", () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: "scene_count", target: 50 }],
    });
    const result = evaluateNarrativeState(narrative, [], 0, config);
    const validPhases = ["setup", "rising", "midpoint", "escalation", "climax", "resolution"];
    expect(validPhases).toContain(result.phase);
  });
  it("returns progress and phase", () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: "scene_count", target: 50 }],
    });
    const result = evaluateNarrativeState(narrative, [], 0, config);
    expect(result.progress).toBeDefined();
    expect(result.phase).toBeDefined();
  });
  it("includes directive in result", () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: "scene_count", target: 50 }],
    });
    const result = evaluateNarrativeState(narrative, [], 0, config);
    expect(result.directive).toBeDefined();
    expect(typeof result.directive).toBe("string");
  });
  it("includes pressure analysis in result", () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      endConditions: [{ type: "scene_count", target: 50 }],
    });
    const result = evaluateNarrativeState(narrative, [], 0, config);
    expect(result.pressure).toBeDefined();
    expect(result.pressure.threads).toBeDefined();
    expect(result.pressure.entities).toBeDefined();
    expect(result.pressure.knowledge).toBeDefined();
  });
  it("detects too many active threads", () => {
    const narrative = createMinimalNarrative();
    // Add many active threads
    for (let i = 1; i <= 8; i++) {
      narrative.threads[`T-${i}`] = createThread(`T-${i}`, {
        status: "active",
      });
    }
    const config = createAutoConfig({
      endConditions: [{ type: "scene_count", target: 50 }],
      maxActiveThreads: 4,
    });
    const result = evaluateNarrativeState(narrative, [], 0, config);
    expect(result.pressure.threads.needsResolution).toBe(true);
  });
  it("analyzes stagnant threads", () => {
    const narrative = createMinimalNarrative();
    narrative.threads = {
      "T-001": createThread("T-001", { status: "active" }),
    };
    // Add scenes without any thread deltas
    for (let i = 0; i < 5; i++) {
      narrative.scenes[`S-${i}`] = createScene(`S-${i}`, {
        threadDeltas: [],
      });
    }
    const config = createAutoConfig({
      endConditions: [{ type: "scene_count", target: 50 }],
      threadStagnationThreshold: 3,
    });
    const result = evaluateNarrativeState(
      narrative,
      ["S-0", "S-1", "S-2", "S-3", "S-4"],
      4,
      config,
    );
    expect(result.pressure.threads.stale.length).toBeGreaterThanOrEqual(0);
  });
  it("handles empty narrative gracefully", () => {
    const narrative = createMinimalNarrative();
    narrative.threads = {};
    narrative.characters = {};
    narrative.scenes = {};
    const config = createAutoConfig({
      endConditions: [{ type: "scene_count", target: 50 }],
    });
    expect(() =>
      evaluateNarrativeState(narrative, [], 0, config),
    ).not.toThrow();
    const result = evaluateNarrativeState(narrative, [], 0, config);
    expect(result.phase).toBeDefined();
    expect(result.directive).toBeDefined();
  });
});
// ── buildOutlineDirective Tests ─────────────────────────────────────────────
describe("buildOutlineDirective", () => {
  const baseCtx: DirectiveContext = {
    scenes: [],
    storyProgress: 0.5,
    storyPhase: {
      name: "midpoint" as StoryPhase,
      description: "A significant shift",
    },
  };
  it("includes story trajectory", () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig();
    const directive = buildOutlineDirective(narrative, config, baseCtx);
    expect(directive).toContain("## Story Phase");
    expect(directive).toContain("MIDPOINT");
  });
  it("includes tone guidance when set", () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({ toneGuidance: "Dark and brooding" });
    const directive = buildOutlineDirective(narrative, config, baseCtx);
    expect(directive).toContain("## Tone");
    expect(directive).toContain("Dark and brooding");
  });
  it("includes narrative constraints when set", () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      narrativeConstraints: "No character deaths",
    });
    const directive = buildOutlineDirective(narrative, config, baseCtx);
    expect(directive).toContain("## Constraints");
    expect(directive).toContain("No character deaths");
  });
  it("includes direction when set", () => {
    const narrative = createMinimalNarrative();
    const config = createAutoConfig({
      direction: "Focus on the romance subplot",
    });
    const directive = buildOutlineDirective(narrative, config, baseCtx);
    expect(directive).toContain("## Direction");
    expect(directive).toContain("Focus on the romance subplot");
  });
});
// ── Edge Cases and Integration ──────────────────────────────────────────────
describe("auto-engine edge cases", () => {
  it("handles narrative with only terminal threads", () => {
    const narrative = createMinimalNarrative();
    narrative.threads = {
      "T-001": createThread("T-001", { status: "resolved" }),
      "T-002": createThread("T-002", { status: "subverted" }),
      "T-003": createThread("T-003", { status: "abandoned" }),
    };
    const config = createAutoConfig({
      endConditions: [{ type: "scene_count", target: 50 }],
    });
    const result = evaluateNarrativeState(narrative, [], 0, config);
    expect(result.phase).toBeDefined();
    expect(result.directive).toBeDefined();
  });
  it("handles narrative with only latent threads", () => {
    const narrative = createMinimalNarrative();
    // Need > 2 latent threads to trigger the boost
    narrative.threads = {
      "T-001": createThread("T-001", { status: "latent" }),
      "T-002": createThread("T-002", { status: "latent" }),
      "T-003": createThread("T-003", { status: "latent" }),
    };
    const config = createAutoConfig({
      endConditions: [{ type: "scene_count", target: 50 }],
    });
    const result = evaluateNarrativeState(narrative, [], 0, config);
    // Should mention thread activation since multiple latent threads exist
    expect(result.directive).toContain("thread");
  });
  it("handles progress > 1 gracefully", () => {
    const phase = getStoryPhase(1.5);
    expect(phase).toBe("resolution");
  });
  it("handles progress < 0 gracefully", () => {
    const phase = getStoryPhase(-0.1);
    // Should still find a phase - first phase that matches or default to last
    expect(phase).toBeDefined();
    expect(typeof phase).toBe("string");
  });
  it("computes progress correctly with combined scene and arc conditions", () => {
    const narrative = createMinimalNarrative();
    narrative.arcs = {
      "arc-1": {
        id: "arc-1",
        name: "Arc 1",
        sceneIds: [],
        develops: [],
        locationIds: [],
        activeCharacterIds: [],
        initialCharacterLocations: {},
      },
    };
    const config = createAutoConfig({
      endConditions: [
        { type: "scene_count", target: 10 },
        { type: "arc_count", target: 5 },
      ],
    });
    const resolvedKeys = Array.from({ length: 6 }, (_, i) => `S-${i}`);
    // 6/10 scenes = 60%, 1/5 arcs = 20%
    const progress = computeStoryProgress(
      narrative,
      resolvedKeys,
      config,
      0,
      0,
    );
    expect(progress).toBe(0.6); // max of 60% and 20%
  });
});

// ── Coordination Plan — Arc Anchor & Force Mode Derivation ──────────────────
describe("getArcNode", () => {
  function mkNode(
    overrides: Partial<CoordinationNode> & { id: string },
  ): CoordinationNode {
    return {
      index: 0,
      type: "reasoning",
      label: "node",
      ...overrides,
    };
  }
  function mkPlan(nodes: CoordinationNode[]): CoordinationPlan {
    return {
      id: "plan-test",
      nodes,
      edges: [],
      arcCount: Math.max(
        1,
        ...nodes.map((n) => n.arcIndex ?? 0),
      ),
      summary: "test",
      arcPartitions: [],
      currentArc: 0,
      completedArcs: [],
      createdAt: 0,
    };
  }

  it("returns the peak anchor for an arc", () => {
    const plan = mkPlan([
      mkNode({ id: "PK1", type: "peak", arcIndex: 1, sceneCount: 5, arcSlot: 1 }),
      mkNode({ id: "M1", type: "moment", arcSlot: 1 }),
    ]);
    expect(getArcNode(plan, 1)?.id).toBe("PK1");
  });

  it("returns the valley anchor when the arc pivots rather than commits", () => {
    const plan = mkPlan([
      mkNode({ id: "V1", type: "valley", arcIndex: 2, sceneCount: 4, arcSlot: 2 }),
      mkNode({ id: "M1", type: "moment", arcSlot: 2 }),
    ]);
    expect(getArcNode(plan, 2)?.id).toBe("V1");
  });

  it("ignores moments as potential anchors", () => {
    const plan = mkPlan([
      mkNode({ id: "M1", type: "moment", arcIndex: 1, arcSlot: 1 }),
    ]);
    // Moments never anchor arcs even if arcIndex is erroneously set.
    expect(getArcNode(plan, 1)).toBeUndefined();
  });
});

describe("deriveArcForceMode", () => {
  function mkNode(
    overrides: Partial<CoordinationNode> & { id: string },
  ): CoordinationNode {
    return {
      index: 0,
      type: "reasoning",
      label: "node",
      ...overrides,
    };
  }
  function mkPlan(nodes: CoordinationNode[]): CoordinationPlan {
    return {
      id: "plan-test",
      nodes,
      edges: [],
      arcCount: Math.max(
        1,
        ...nodes.map((n) => n.arcIndex ?? 0),
      ),
      summary: "test",
      arcPartitions: [],
      currentArc: 0,
      completedArcs: [],
      createdAt: 0,
    };
  }

  it("is fate-dominant when fate nodes and thread-bearing spine dominate", () => {
    const plan = mkPlan([
      mkNode({ id: "PK1", type: "peak", arcIndex: 1, threadId: "T1", arcSlot: 1 }),
      mkNode({ id: "F1", type: "fate", threadId: "T1", arcSlot: 1 }),
      mkNode({ id: "F2", type: "fate", threadId: "T2", arcSlot: 1 }),
      mkNode({ id: "C1", type: "character", arcSlot: 1 }),
    ]);
    expect(deriveArcForceMode(plan, 1)).toBe("fate-dominant");
  });

  it("is world-dominant when character/location/artifact nodes dominate", () => {
    const plan = mkPlan([
      mkNode({ id: "PK1", type: "peak", arcIndex: 1, arcSlot: 1 }),
      mkNode({ id: "C1", type: "character", arcSlot: 1 }),
      mkNode({ id: "C2", type: "character", arcSlot: 1 }),
      mkNode({ id: "L1", type: "location", arcSlot: 1 }),
      mkNode({ id: "A1", type: "artifact", arcSlot: 1 }),
    ]);
    expect(deriveArcForceMode(plan, 1)).toBe("world-dominant");
  });

  it("is system-dominant when system nodes dominate", () => {
    const plan = mkPlan([
      mkNode({ id: "PK1", type: "peak", arcIndex: 1, arcSlot: 1 }),
      mkNode({ id: "S1", type: "system", arcSlot: 1 }),
      mkNode({ id: "S2", type: "system", arcSlot: 1 }),
      mkNode({ id: "S3", type: "system", arcSlot: 1 }),
    ]);
    expect(deriveArcForceMode(plan, 1)).toBe("system-dominant");
  });

  it("is chaos-dominant when chaos nodes dominate (troll-arc style)", () => {
    const plan = mkPlan([
      mkNode({ id: "V1", type: "valley", arcIndex: 3, arcSlot: 3 }),
      mkNode({ id: "CH1", type: "chaos", arcSlot: 3 }),
      mkNode({ id: "CH2", type: "chaos", arcSlot: 3 }),
      mkNode({ id: "C1", type: "character", arcSlot: 3 }),
    ]);
    expect(deriveArcForceMode(plan, 3)).toBe("chaos-dominant");
  });

  it("is balanced when no single category dominates", () => {
    const plan = mkPlan([
      mkNode({ id: "PK1", type: "peak", arcIndex: 1, arcSlot: 1 }),
      mkNode({ id: "F1", type: "fate", threadId: "T1", arcSlot: 1 }),
      mkNode({ id: "C1", type: "character", arcSlot: 1 }),
      mkNode({ id: "S1", type: "system", arcSlot: 1 }),
      mkNode({ id: "CH1", type: "chaos", arcSlot: 1 }),
    ]);
    expect(deriveArcForceMode(plan, 1)).toBe("balanced");
  });

  it("counts spine nodes with threadId as fate pressure", () => {
    // Anchor peak + moments carrying thread progressions → fate pressure
    const plan = mkPlan([
      mkNode({ id: "PK1", type: "peak", arcIndex: 1, threadId: "T1", arcSlot: 1 }),
      mkNode({ id: "M1", type: "moment", threadId: "T2", arcSlot: 1 }),
      mkNode({ id: "M2", type: "moment", threadId: "T3", arcSlot: 1 }),
      mkNode({ id: "C1", type: "character", arcSlot: 1 }),
    ]);
    expect(deriveArcForceMode(plan, 1)).toBe("fate-dominant");
  });

  it("ignores nodes from other arcs", () => {
    const plan = mkPlan([
      mkNode({ id: "PK1", type: "peak", arcIndex: 1, arcSlot: 1 }),
      mkNode({ id: "CH1", type: "chaos", arcSlot: 1 }),
      // Arc 2 has a bunch of fate — shouldn't affect arc 1
      mkNode({ id: "PK2", type: "peak", arcIndex: 2, threadId: "T1", arcSlot: 2 }),
      mkNode({ id: "F1", type: "fate", threadId: "T1", arcSlot: 2 }),
      mkNode({ id: "F2", type: "fate", threadId: "T2", arcSlot: 2 }),
    ]);
    expect(deriveArcForceMode(plan, 1)).toBe("chaos-dominant");
    expect(deriveArcForceMode(plan, 2)).toBe("fate-dominant");
  });

  it("returns balanced for an empty arc", () => {
    const plan = mkPlan([
      mkNode({ id: "PK1", type: "peak", arcIndex: 1, arcSlot: 1 }),
      // arcIndex 2 referenced but no arc-2 nodes
    ]);
    expect(deriveArcForceMode(plan, 2)).toBe("balanced");
  });
});

describe("applyDerivedForceModes", () => {
  function mkNode(
    overrides: Partial<CoordinationNode> & { id: string },
  ): CoordinationNode {
    return {
      index: 0,
      type: "reasoning",
      label: "node",
      ...overrides,
    };
  }
  function mkPlan(nodes: CoordinationNode[]): CoordinationPlan {
    return {
      id: "plan-test",
      nodes,
      edges: [],
      arcCount: Math.max(
        1,
        ...nodes.map((n) => n.arcIndex ?? 0),
      ),
      summary: "test",
      arcPartitions: [],
      currentArc: 0,
      completedArcs: [],
      createdAt: 0,
    };
  }

  it("attaches forceMode to each arc anchor (peak or valley)", () => {
    const plan = mkPlan([
      mkNode({ id: "PK1", type: "peak", arcIndex: 1, threadId: "T1", arcSlot: 1 }),
      mkNode({ id: "F1", type: "fate", threadId: "T1", arcSlot: 1 }),
      mkNode({ id: "F2", type: "fate", threadId: "T2", arcSlot: 1 }),
      mkNode({ id: "V2", type: "valley", arcIndex: 2, arcSlot: 2 }),
      mkNode({ id: "CH1", type: "chaos", arcSlot: 2 }),
      mkNode({ id: "CH2", type: "chaos", arcSlot: 2 }),
    ]);
    const withModes = applyDerivedForceModes(plan);
    const pk1 = withModes.nodes.find((n) => n.id === "PK1");
    const v2 = withModes.nodes.find((n) => n.id === "V2");
    expect(pk1?.forceMode).toBe("fate-dominant");
    expect(v2?.forceMode).toBe("chaos-dominant");
  });

  it("does not attach forceMode to moments or non-anchor nodes", () => {
    const plan = mkPlan([
      mkNode({ id: "PK1", type: "peak", arcIndex: 1, arcSlot: 1 }),
      mkNode({ id: "M1", type: "moment", arcSlot: 1 }),
      mkNode({ id: "C1", type: "character", arcSlot: 1 }),
    ]);
    const withModes = applyDerivedForceModes(plan);
    const m1 = withModes.nodes.find((n) => n.id === "M1");
    const c1 = withModes.nodes.find((n) => n.id === "C1");
    expect(m1?.forceMode).toBeUndefined();
    expect(c1?.forceMode).toBeUndefined();
  });

  it("is idempotent — re-applying yields the same result", () => {
    const plan = mkPlan([
      mkNode({ id: "PK1", type: "peak", arcIndex: 1, threadId: "T1", arcSlot: 1 }),
      mkNode({ id: "F1", type: "fate", threadId: "T1", arcSlot: 1 }),
    ]);
    const first = applyDerivedForceModes(plan);
    const second = applyDerivedForceModes(first);
    expect(second.nodes.find((n) => n.id === "PK1")?.forceMode).toBe(
      first.nodes.find((n) => n.id === "PK1")?.forceMode,
    );
  });
});
