import {
  buildCompletedBeatsPrompt,
  buildForceStandardsPrompt,
  buildThreadHealthPrompt,
  PROMPT_ARTIFACTS,
  PROMPT_BEAT_TAXONOMY,
  PROMPT_CONTINUITY,
  PROMPT_ENTITY_INTEGRATION,
  PROMPT_FORCE_STANDARDS,
  PROMPT_LOCATIONS,
  PROMPT_MUTATIONS,
  PROMPT_POV,
  PROMPT_STRUCTURAL_RULES,
  PROMPT_SUMMARY_REQUIREMENT,
  promptThreadLifecycle,
} from "@/lib/ai/prompts";
import type { NarrativeState, Scene, Thread } from "@/types/narrative";
import { describe, expect, it } from "vitest";
// ── Test Fixtures ────────────────────────────────────────────────────────────
function createMinimalNarrative(
  overrides: Partial<NarrativeState> = {},
): NarrativeState {
  return {
    id: "test-narrative",
    title: "Test Story",
    description: "Test",
    characters: {},
    locations: {},
    threads: {},
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
    ...overrides,
  };
}
function createScene(
  id: string,
  threadMutations: Array<{
    threadId: string;
    from: string;
    to: string;
    addedNodes?: [];
    addedEdges?: [];
  }>,
  overrides: Partial<Scene> = {},
): Scene {
  return {
    kind: "scene",
    id,
    arcId: "arc-1",
    povId: "c1",
    locationId: "loc1",
    participantIds: ["c1"],
    summary: `Scene ${id} summary`,
    events: ["event_1"],
    threadMutations: threadMutations.map((tm) => ({
      threadId: tm.threadId,
      from: tm.from,
      to: tm.to,
      addedNodes: [],
    })),
    continuityMutations: [],
    relationshipMutations: [],
    ...overrides,
  };
}
function createThread(
  id: string,
  description: string,
  status: string = "latent",
): Thread {
  return {
    id,
    description,
    status,
    participants: [],
    dependents: [],
    openedAt: "s1",
    threadLog: { nodes: {}, edges: [] },
  };
}
// ── Static Prompt Constants ──────────────────────────────────────────────────
describe("Static Prompt Constants", () => {
  describe("PROMPT_FORCE_STANDARDS", () => {
    it("contains fate target", () => {
      expect(PROMPT_FORCE_STANDARDS).toMatch(/FATE[\s\S]+Target:/);
    });
    it("contains world target", () => {
      expect(PROMPT_FORCE_STANDARDS).toMatch(/WORLD[\s\S]+Target:/);
    });
    it("contains system target", () => {
      expect(PROMPT_FORCE_STANDARDS).toMatch(/SYSTEM[\s\S]+Target:/);
    });
    it("mentions balance archetypes", () => {
      expect(PROMPT_FORCE_STANDARDS).toContain("BALANCE");
    });
  });
  describe("PROMPT_STRUCTURAL_RULES", () => {
    it("contains anti-repetition rules", () => {
      expect(PROMPT_STRUCTURAL_RULES).toContain("ANTI-REPETITION");
      expect(PROMPT_STRUCTURAL_RULES).toContain("NO EVENT TWICE");
      expect(PROMPT_STRUCTURAL_RULES).toContain("NO STRUCTURE REPEAT");
      expect(PROMPT_STRUCTURAL_RULES).toContain("EVERY SCENE CHANGES STATE");
    });
    it("contains thread collision rules", () => {
      expect(PROMPT_STRUCTURAL_RULES).toContain("THREAD COLLISION");
      expect(PROMPT_STRUCTURAL_RULES).toContain("2+ threads simultaneously");
      expect(PROMPT_STRUCTURAL_RULES).toContain("COST");
    });
    it("contains character discipline rules", () => {
      expect(PROMPT_STRUCTURAL_RULES).toContain("CHARACTER DISCIPLINE");
      expect(PROMPT_STRUCTURAL_RULES).toContain(
        "3+ scenes MUST show visible change",
      );
      expect(PROMPT_STRUCTURAL_RULES).toContain("plan per arc must go wrong");
    });
    it("contains pacing density rules", () => {
      expect(PROMPT_STRUCTURAL_RULES).toContain("PACING DENSITY");
      expect(PROMPT_STRUCTURAL_RULES).toContain("Battle");
      expect(PROMPT_STRUCTURAL_RULES).toContain("Quiet");
    });
    it("contains scan instruction", () => {
      expect(PROMPT_STRUCTURAL_RULES).toContain("SCAN");
    });
  });
  describe("PROMPT_MUTATIONS", () => {
    it("describes threadMutations with status lifecycle", () => {
      expect(PROMPT_MUTATIONS).toContain("threadMutations");
      // Status axis explicitly enumerates the lifecycle vocabulary so the
      // LLM can't slot in "pulse" (a log node type) as a status.
      expect(PROMPT_MUTATIONS).toContain(
        "latent | seeded | active | escalating | critical | resolved | subverted | abandoned",
      );
      // And the prompt must explicitly forbid the pulse-as-status confusion.
      expect(PROMPT_MUTATIONS).toContain('"pulse" is NOT a status');
    });
    it("describes thread log types", () => {
      expect(PROMPT_MUTATIONS).toContain("LOG TYPE");
      expect(PROMPT_MUTATIONS).toContain("pulse");
      expect(PROMPT_MUTATIONS).toContain("transition");
      expect(PROMPT_MUTATIONS).toContain("payoff");
    });
    it("describes commitment concept", () => {
      expect(PROMPT_MUTATIONS).toContain("COMMITMENT");
      expect(PROMPT_MUTATIONS).toContain("escalating");
    });
    it("describes continuityMutations", () => {
      expect(PROMPT_MUTATIONS).toContain("continuityMutations");
      expect(PROMPT_MUTATIONS).toContain("PRESENT TENSE facts");
    });
    it("describes relationshipMutations with valence scale", () => {
      expect(PROMPT_MUTATIONS).toContain("relationshipMutations");
      expect(PROMPT_MUTATIONS).toContain("valenceDelta");
      expect(PROMPT_MUTATIONS).toContain("±0.1");
      expect(PROMPT_MUTATIONS).toContain("±0.3");
      expect(PROMPT_MUTATIONS).toContain("±0.5");
    });
    it("describes systemMutations with node types", () => {
      expect(PROMPT_MUTATIONS).toContain("systemMutations");
      expect(PROMPT_MUTATIONS).toContain("principle");
      expect(PROMPT_MUTATIONS).toContain("concept");
      expect(PROMPT_MUTATIONS).toContain("tension");
      expect(PROMPT_MUTATIONS).toContain("constraint");
    });
    it("includes density targets", () => {
      expect(PROMPT_MUTATIONS).toContain("DENSITY TARGETS");
      expect(PROMPT_MUTATIONS).toContain("Breather");
      expect(PROMPT_MUTATIONS).toContain("Typical");
      expect(PROMPT_MUTATIONS).toContain("Climactic");
    });
    it("includes force formulas", () => {
      expect(PROMPT_MUTATIONS).toContain("FORMULAS");
    });
  });
  describe("PROMPT_ARTIFACTS", () => {
    it("describes artifact usage and ownership", () => {
      expect(PROMPT_ARTIFACTS).toContain("ARTIFACTS");
      expect(PROMPT_ARTIFACTS).toContain("OWNERSHIP");
      expect(PROMPT_ARTIFACTS).toContain("character");
      expect(PROMPT_ARTIFACTS).toContain("location");
      expect(PROMPT_ARTIFACTS).toContain("world-owned");
    });
  });
  describe("PROMPT_POV", () => {
    it("describes POV streaks", () => {
      expect(PROMPT_POV).toContain("STREAKS");
      expect(PROMPT_POV).toContain("2-4 consecutive scenes");
    });
    it("recommends anchor POV characters per arc", () => {
      expect(PROMPT_POV).toContain("1-2 POV characters");
    });
    it("suggests single POV option", () => {
      expect(PROMPT_POV).toContain("Single POV");
    });
  });
  describe("PROMPT_CONTINUITY", () => {
    it("includes teleportation warning", () => {
      expect(PROMPT_CONTINUITY).toContain("NEVER teleport");
    });
    it("includes character movements instruction", () => {
      expect(PROMPT_CONTINUITY).toContain("characterMovements");
    });
    it("includes consequence persistence", () => {
      expect(PROMPT_CONTINUITY).toContain("Injuries");
      expect(PROMPT_CONTINUITY).toContain("persist");
    });
    it("includes information asymmetry rule", () => {
      expect(PROMPT_CONTINUITY).toContain("cannot act on information");
    });
    it("includes time gap signaling", () => {
      expect(PROMPT_CONTINUITY).toContain("time gaps");
    });
  });
  describe("PROMPT_SUMMARY_REQUIREMENT", () => {
    it("includes banned verbs", () => {
      expect(PROMPT_SUMMARY_REQUIREMENT).toContain("BANNED:");
      expect(PROMPT_SUMMARY_REQUIREMENT).toContain("realizes");
      expect(PROMPT_SUMMARY_REQUIREMENT).toContain("confirms");
    });
    it("includes summary requirements", () => {
      expect(PROMPT_SUMMARY_REQUIREMENT).toContain("SUMMARY");
      expect(PROMPT_SUMMARY_REQUIREMENT).toContain("CHARACTER NAMES");
    });
  });
  describe("PROMPT_BEAT_TAXONOMY", () => {
    it("defines all 10 beat functions", () => {
      expect(PROMPT_BEAT_TAXONOMY).toContain("FUNCTIONS (10)");
      expect(PROMPT_BEAT_TAXONOMY).toContain("breathe");
      expect(PROMPT_BEAT_TAXONOMY).toContain("inform");
      expect(PROMPT_BEAT_TAXONOMY).toContain("advance");
      expect(PROMPT_BEAT_TAXONOMY).toContain("bond");
      expect(PROMPT_BEAT_TAXONOMY).toContain("turn");
      expect(PROMPT_BEAT_TAXONOMY).toContain("reveal");
      expect(PROMPT_BEAT_TAXONOMY).toContain("shift");
      expect(PROMPT_BEAT_TAXONOMY).toContain("expand");
      expect(PROMPT_BEAT_TAXONOMY).toContain("foreshadow");
      expect(PROMPT_BEAT_TAXONOMY).toContain("resolve");
    });
    it("defines all 8 mechanisms", () => {
      expect(PROMPT_BEAT_TAXONOMY).toContain("MECHANISMS (8)");
      expect(PROMPT_BEAT_TAXONOMY).toContain("dialogue");
      expect(PROMPT_BEAT_TAXONOMY).toContain("thought");
      expect(PROMPT_BEAT_TAXONOMY).toContain("action");
      expect(PROMPT_BEAT_TAXONOMY).toContain("environment");
      expect(PROMPT_BEAT_TAXONOMY).toContain("narration");
      expect(PROMPT_BEAT_TAXONOMY).toContain("memory");
      expect(PROMPT_BEAT_TAXONOMY).toContain("document");
      expect(PROMPT_BEAT_TAXONOMY).toContain("comic");
    });
    it("includes edge case guidance", () => {
      expect(PROMPT_BEAT_TAXONOMY).toContain("EDGE CASES");
    });
  });
  describe("PROMPT_LOCATIONS", () => {
    it("defines locations as physical places", () => {
      expect(PROMPT_LOCATIONS).toContain("LOCATIONS");
      expect(PROMPT_LOCATIONS).toContain("PHYSICAL places");
    });
    it("includes hierarchy guidance", () => {
      expect(PROMPT_LOCATIONS).toContain("HIERARCHY");
      expect(PROMPT_LOCATIONS).toContain("parentId");
    });
    it("includes character ties concept", () => {
      expect(PROMPT_LOCATIONS).toContain("TIES");
    });
  });
  describe("PROMPT_ENTITY_INTEGRATION", () => {
    it("defines character integration rules", () => {
      expect(PROMPT_ENTITY_INTEGRATION).toContain("Characters");
      expect(PROMPT_ENTITY_INTEGRATION).toContain("relationship");
    });
    it("defines location nesting rules", () => {
      expect(PROMPT_ENTITY_INTEGRATION).toContain("Locations");
      expect(PROMPT_ENTITY_INTEGRATION).toContain("parentId");
    });
    it("defines artifact concreteness rules", () => {
      expect(PROMPT_ENTITY_INTEGRATION).toContain("Artifacts");
      expect(PROMPT_ENTITY_INTEGRATION).toContain("CONCRETE TOOLS");
    });
    it("defines thread participant rules", () => {
      expect(PROMPT_ENTITY_INTEGRATION).toContain("Thread participants");
    });
    it("mentions cultural naming consistency", () => {
      expect(PROMPT_ENTITY_INTEGRATION).toContain("cultural palette");
    });
  });
});
// ── buildForceStandardsPrompt ───────────────────────────────────────────────
describe("buildForceStandardsPrompt", () => {
  it("returns the standard force prompt", () => {
    const result = buildForceStandardsPrompt();
    expect(result).toBe(PROMPT_FORCE_STANDARDS);
  });
  it("includes three force definitions", () => {
    const result = buildForceStandardsPrompt();
    expect(result).toContain("FATE");
    expect(result).toContain("WORLD");
    expect(result).toContain("SYSTEM");
  });
  it("includes scale guidance", () => {
    const result = buildForceStandardsPrompt();
    expect(result).toContain("SCALE");
    expect(result).toContain("Beat");
    expect(result).toContain("Scene");
    expect(result).toContain("Arc");
  });
  it("includes density guidance", () => {
    const result = buildForceStandardsPrompt();
    expect(result).toContain("DENSITY");
  });
});
// ── promptThreadLifecycle ────────────────────────────────────────────────────
describe("promptThreadLifecycle", () => {
  it("returns a string with thread lifecycle information", () => {
    const result = promptThreadLifecycle();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
  it("includes lifecycle stages", () => {
    const result = promptThreadLifecycle();
    expect(result).toContain("latent");
    expect(result).toContain("seeded");
    expect(result).toContain("critical");
  });
  it("includes terminal statuses", () => {
    const result = promptThreadLifecycle();
    expect(result).toContain("resolved");
    expect(result).toContain("subverted");
  });
  it("mentions commitment levels", () => {
    const result = promptThreadLifecycle();
    expect(result).toContain("COMMITMENT");
  });
});
// ── buildThreadHealthPrompt ──────────────────────────────────────────────────
describe("buildThreadHealthPrompt", () => {
  it("returns empty string when no threads exist", () => {
    const n = createMinimalNarrative();
    const result = buildThreadHealthPrompt(n, [], 0);
    expect(result).toBe("");
  });
  it("includes bandwidth header", () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread("t1", "Test thread", "active") },
    });
    const result = buildThreadHealthPrompt(n, [], 0);
    expect(result).toContain("THREAD BANDWIDTH");
    expect(result).toContain("1 active");
  });
  it("reports thread description and status", () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread("t1", "The mystery unfolds", "latent") },
    });
    const result = buildThreadHealthPrompt(n, [], 0);
    expect(result).toContain("The mystery unfolds");
    expect(result).toContain("latent");
  });
  it("reports activeArcs and bandwidth ratio", () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread("t1", "Quest thread", "active") },
      scenes: {
        s1: createScene("s1", [
          { threadId: "t1", from: "latent", to: "active" },
        ]),
      },
    });
    const result = buildThreadHealthPrompt(n, ["s1"], 0);
    expect(result).toContain("activeArcs");
  });
  it("shows convergence links when present", () => {
    const t1 = createThread("t1", "Main thread", "active");
    t1.dependents = ["t2"];
    const n = createMinimalNarrative({
      threads: {
        t1,
        t2: createThread("t2", "Sub thread", "latent"),
      },
    });
    const result = buildThreadHealthPrompt(n, [], 0);
    expect(result).toContain("Converges");
    expect(result).toContain("[t2]");
  });
  it("reports resolved thread count", () => {
    const n = createMinimalNarrative({
      threads: {
        t1: createThread("t1", "Active thread", "active"),
        t2: createThread("t2", "Resolved thread", "resolved"),
      },
    });
    const result = buildThreadHealthPrompt(n, [], 0);
    expect(result).toContain("1/2 resolved");
  });
  it("flags starved active threads", () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread("t1", "Starved thread", "active") },
      arcs: {
        "ARC-01": {
          id: "ARC-01",
          name: "Arc 1",
          sceneIds: [],
          develops: [],
          locationIds: [],
          activeCharacterIds: [],
          initialCharacterLocations: {},
        },
      },
    });
    const result = buildThreadHealthPrompt(n, [], 0);
    expect(result).toContain("EMERGENCY");
  });
});
// ── buildCompletedBeatsPrompt ────────────────────────────────────────────────
describe("buildCompletedBeatsPrompt", () => {
  it("returns empty string when no transitions have occurred", () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread("t1", "Test", "latent") },
      scenes: {
        s1: createScene("s1", [
          { threadId: "t1", from: "latent", to: "latent" },
        ]), // pulse, not transition
      },
    });
    const result = buildCompletedBeatsPrompt(n, ["s1"], 0);
    expect(result).toBe("");
  });
  it("includes SPENT BEATS header", () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread("t1", "Test thread", "active") },
      scenes: {
        s1: createScene("s1", [
          { threadId: "t1", from: "latent", to: "active" },
        ]),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ["s1"], 0);
    expect(result).toContain("SPENT BEATS");
    expect(result).toContain("CLOSED");
  });
  it("lists thread transition chain", () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread("t1", "Quest thread", "active") },
      scenes: {
        s1: createScene("s1", [
          { threadId: "t1", from: "latent", to: "active" },
        ]),
        s2: createScene("s2", [
          { threadId: "t1", from: "active", to: "active" },
        ]),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ["s1", "s2"], 1);
    expect(result).toContain("Quest thread");
    expect(result).toContain("latent → active");
    expect(result).toContain("active");
  });
  it("includes scene summaries", () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread("t1", "Test", "active") },
      scenes: {
        s1: createScene(
          "s1",
          [{ threadId: "t1", from: "latent", to: "active" }],
          {
            summary: "The hero discovers the secret passage",
          },
        ),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ["s1"], 0);
    expect(result).toContain("secret passage");
  });
  it("includes scene events", () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread("t1", "Test", "active") },
      scenes: {
        s1: createScene(
          "s1",
          [{ threadId: "t1", from: "latent", to: "active" }],
          {
            events: ["ambush_triggered", "ally_wounded"],
          },
        ),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ["s1"], 0);
    expect(result).toContain("ambush_triggered");
    expect(result).toContain("ally_wounded");
  });
  it("labels terminal threads appropriately", () => {
    const n = createMinimalNarrative({
      threads: { t1: createThread("t1", "Resolved thread", "resolved") },
      scenes: {
        s1: createScene("s1", [
          { threadId: "t1", from: "critical", to: "resolved" },
        ]),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ["s1"], 0);
    expect(result).toContain("[RESOLVED]");
  });
  it("handles multiple threads", () => {
    const n = createMinimalNarrative({
      threads: {
        t1: createThread("t1", "Thread one", "active"),
        t2: createThread("t2", "Thread two", "active"),
      },
      scenes: {
        s1: createScene("s1", [
          { threadId: "t1", from: "latent", to: "active" },
          { threadId: "t2", from: "latent", to: "active" },
        ]),
        s2: createScene("s2", [
          { threadId: "t2", from: "active", to: "active" },
        ]),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ["s1", "s2"], 1);
    expect(result).toContain("Thread one");
    expect(result).toContain("Thread two");
  });
  it("truncates long thread descriptions", () => {
    const longDescription = "A".repeat(100);
    const n = createMinimalNarrative({
      threads: { t1: createThread("t1", longDescription, "active") },
      scenes: {
        s1: createScene("s1", [
          { threadId: "t1", from: "latent", to: "active" },
        ]),
      },
    });
    const result = buildCompletedBeatsPrompt(n, ["s1"], 0);
    expect(result).toContain("A".repeat(50)); // Truncated to 50 chars
    expect(result).not.toContain("A".repeat(60));
  });
});
