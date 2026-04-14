import type {
  BeatPlan,
  Character,
  Location,
  NarrativeState,
  Scene,
  Thread,
} from "@/types/narrative";
import { beforeEach, describe, expect, it, vi } from "vitest";
// Mock the AI module
vi.mock("@/lib/ai/api", () => ({
  callGenerate: vi.fn(),
  callGenerateStream: vi.fn(),
  SYSTEM_PROMPT: "Test system prompt",
}));
// Mock context building
vi.mock("@/lib/ai/context", () => ({
  narrativeContext: vi.fn().mockReturnValue("Mock narrative context"),
  sceneContext: vi.fn().mockReturnValue("Mock scene context"),
  sceneScale: vi.fn().mockReturnValue({ estWords: 1500 }),
  buildProseProfile: vi.fn().mockReturnValue("PROSE PROFILE\nVoice: literary"),
}));
// Mock prompts
vi.mock("@/lib/ai/prompts", () => ({
  PROMPT_FORCE_STANDARDS: "Mock force standards",
  PROMPT_STRUCTURAL_RULES: "Mock structural rules",
  PROMPT_DELTAS: "Mock deltas",
  PROMPT_ARTIFACTS: "Mock artifacts",
  PROMPT_LOCATIONS: "Mock locations",
  PROMPT_POV: "Mock POV",
  PROMPT_WORLD: "Mock continuity",
  PROMPT_SUMMARY_REQUIREMENT: "Mock summary requirement",
  PROMPT_BEAT_TAXONOMY: "Mock beat taxonomy",
  promptThreadLifecycle: vi.fn().mockReturnValue("Mock thread lifecycle"),
  buildThreadHealthPrompt: vi.fn().mockReturnValue("Mock thread health"),
  buildCompletedBeatsPrompt: vi.fn().mockReturnValue("Mock completed beats"),
  buildForceStandardsPrompt: vi.fn().mockReturnValue("Mock force standards prompt"),
}));
// Mock markov functions
vi.mock("@/lib/markov", () => ({
  samplePacingSequence: vi.fn().mockReturnValue({
    steps: [
      {
        mode: "HHH",
        name: "Climax",
        description: "High everything",
        forces: { fate: [1, 2], world: [1, 2], system: [1, 2] },
      },
    ],
    pacingDescription: "Test pacing",
  }),
  buildSequencePrompt: vi.fn().mockReturnValue("Mock sequence prompt"),
  buildSingleStepPrompt: vi.fn().mockReturnValue("Mock step prompt"),
  detectCurrentMode: vi.fn().mockReturnValue("LLL"),
  MATRIX_PRESETS: [],
  DEFAULT_TRANSITION_MATRIX: {},
}));
// Mock beat profiles
vi.mock("@/lib/beat-profiles", () => ({
  resolveProfile: vi.fn().mockReturnValue({
    register: "literary",
    stance: "close_third",
    devices: ["metaphor"],
    rules: ["Show, dont tell"],
    antiPatterns: ["Purple prose"],
  }),
  resolveSampler: vi.fn().mockReturnValue({
    beatsPerKWord: 12,
  }),
  sampleBeatSequence: vi.fn().mockReturnValue([
    { fn: "breathe", mechanism: "environment" },
    { fn: "advance", mechanism: "action" },
    { fn: "turn", mechanism: "dialogue" },
  ]),
}));
import { callGenerate, callGenerateStream } from "@/lib/ai/api";
import {
  editScenePlan,
  generateScenePlan,
  generateSceneProse,
  generateScenes,
  reverseEngineerScenePlan,
  rewriteScenePlan,
  sanitizeScenes,
} from "@/lib/ai/scenes";
// ── Test Fixtures ────────────────────────────────────────────────────────────
function createScene(
  id: string,
  overrides: Partial<Scene> & { plan?: BeatPlan } = {},
): Scene {
  const { plan, ...rest } = overrides;
  return {
    kind: "scene",
    id,
    arcId: "ARC-01",
    povId: "C-01",
    locationId: "L-01",
    participantIds: ["C-01"],
    summary: `Scene ${id} summary`,
    events: ["event_1"],
    threadDeltas: [],
    worldDeltas: [],
    relationshipDeltas: [],
    characterMovements: {},
    ...rest,
    ...(plan
      ? {
          planVersions: [
            {
              plan,
              branchId: "main",
              timestamp: Date.now(),
              version: "1",
              versionType: "generate" as const,
            },
          ],
        }
      : {}),
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
function createMinimalNarrative(): NarrativeState {
  return {
    id: "N-001",
    title: "Test Narrative",
    description: "A test story",
    characters: {
      "C-01": createCharacter("C-01", { name: "Alice" }),
      "C-02": createCharacter("C-02", { name: "Bob" }),
    },
    locations: {
      "L-01": createLocation("L-01", { name: "Castle" }),
      "L-02": createLocation("L-02", { name: "Forest" }),
    },
    threads: {
      "T-01": createThread("T-01", { description: "Main quest" }),
      "T-02": createThread("T-02", { description: "Side quest" }),
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
    worldSummary: "A fantasy world",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
// ── Setup ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
});
// ── generateScenes Tests ─────────────────────────────────────────────────────
describe("generateScenes", () => {
  it("returns parsed scenes and arc from LLM response", async () => {
    const mockResponse = JSON.stringify({
      arcName: "The Siege Begins",
      directionVector: "Alice leads the defense while Bob scouts.",
      scenes: [
        {
          id: "S-GEN-001",
          arcId: "ARC-01",
          locationId: "L-01",
          povId: "C-01",
          participantIds: ["C-01", "C-02"],
          events: ["battle_prep"],
          threadDeltas: [
            { threadId: "T-01", from: "active", to: "active", addedNodes: [] },
          ],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Alice prepares the castle defenses while Bob rides out.",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, "Test direction");
    expect(result.scenes).toHaveLength(1);
    expect(result.arc.name).toBe("The Siege Begins");
    expect(result.scenes[0].summary).toContain("Alice prepares");
  });
  it("assigns sequential scene IDs", async () => {
    const mockResponse = JSON.stringify({
      arcName: "Test Arc",
      scenes: [
        {
          id: "S-GEN-001",
          arcId: "ARC-01",
          locationId: "L-01",
          povId: "C-01",
          participantIds: ["C-01"],
          events: [],
          threadDeltas: [],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Scene 1",
        },
        {
          id: "S-GEN-002",
          arcId: "ARC-01",
          locationId: "L-01",
          povId: "C-01",
          participantIds: ["C-01"],
          events: [],
          threadDeltas: [],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Scene 2",
        },
        {
          id: "S-GEN-003",
          arcId: "ARC-01",
          locationId: "L-01",
          povId: "C-01",
          participantIds: ["C-01"],
          events: [],
          threadDeltas: [],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Scene 3",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 3, "Test direction");
    expect(result.scenes[0].id).toBe("S-001");
    expect(result.scenes[1].id).toBe("S-002");
    expect(result.scenes[2].id).toBe("S-003");
  });
  it("sanitizes invalid character IDs from participantIds", async () => {
    const mockResponse = JSON.stringify({
      arcName: "Test Arc",
      scenes: [
        {
          id: "S-GEN-001",
          arcId: "ARC-01",
          locationId: "L-01",
          povId: "C-01",
          participantIds: ["C-01", "C-INVALID", "C-02"],
          events: [],
          threadDeltas: [],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Test scene",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, "Test");
    // Invalid character should be stripped
    expect(result.scenes[0].participantIds).toEqual(["C-01", "C-02"]);
  });
  it("sanitizes invalid location IDs", async () => {
    const mockResponse = JSON.stringify({
      arcName: "Test Arc",
      scenes: [
        {
          id: "S-GEN-001",
          arcId: "ARC-01",
          locationId: "L-INVALID",
          povId: "C-01",
          participantIds: ["C-01"],
          events: [],
          threadDeltas: [],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Test scene",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, "Test");
    // Invalid location should be replaced with first valid location
    expect(result.scenes[0].locationId).toBe("L-01");
  });
  it("sanitizes invalid thread IDs in threadDeltas", async () => {
    const mockResponse = JSON.stringify({
      arcName: "Test Arc",
      scenes: [
        {
          id: "S-GEN-001",
          arcId: "ARC-01",
          locationId: "L-01",
          povId: "C-01",
          participantIds: ["C-01"],
          events: [],
          threadDeltas: [
            { threadId: "T-01", from: "active", to: "active", addedNodes: [] },
            {
              threadId: "T-INVALID",
              from: "active",
              to: "critical",
              addedNodes: [],
            },
          ],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Test scene",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, "Test");
    // Only valid thread delta should remain
    expect(result.scenes[0].threadDeltas).toHaveLength(1);
    expect(result.scenes[0].threadDeltas[0].threadId).toBe("T-01");
  });
  it("builds arc with correct metadata", async () => {
    const mockResponse = JSON.stringify({
      arcName: "Test Arc",
      directionVector: "Characters face challenges",
      scenes: [
        {
          id: "S-GEN-001",
          arcId: "ARC-01",
          locationId: "L-01",
          povId: "C-01",
          participantIds: ["C-01"],
          events: [],
          threadDeltas: [
            { threadId: "T-01", from: "active", to: "active", addedNodes: [] },
          ],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Scene 1",
        },
        {
          id: "S-GEN-002",
          arcId: "ARC-01",
          locationId: "L-02",
          povId: "C-02",
          participantIds: ["C-02"],
          events: [],
          threadDeltas: [
            {
              threadId: "T-02",
              from: "active",
              to: "critical",
              addedNodes: [],
            },
          ],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Scene 2",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 2, "Test");
    expect(result.arc.name).toBe("Test Arc");
    expect(result.arc.directionVector).toBe("Characters face challenges");
    expect(result.arc.sceneIds).toHaveLength(2);
    expect(result.arc.develops).toContain("T-01");
    expect(result.arc.develops).toContain("T-02");
    expect(result.arc.locationIds).toContain("L-01");
    expect(result.arc.locationIds).toContain("L-02");
    expect(result.arc.activeCharacterIds).toContain("C-01");
    expect(result.arc.activeCharacterIds).toContain("C-02");
  });
  it("continues existing arc when provided", async () => {
    const mockResponse = JSON.stringify({
      scenes: [
        {
          id: "S-GEN-001",
          arcId: "ARC-EXISTING",
          locationId: "L-02",
          povId: "C-02",
          participantIds: ["C-02"],
          events: [],
          threadDeltas: [],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Continuation scene",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const existingArc = {
      id: "ARC-EXISTING",
      name: "Existing Arc",
      sceneIds: ["S-001", "S-002"],
      develops: ["T-01"],
      locationIds: ["L-01"],
      activeCharacterIds: ["C-01"],
      initialCharacterLocations: { "C-01": "L-01" },
    };
    const result = await generateScenes(narrative, [], 0, 1, "Continue", {
      existingArc,
    });
    expect(result.arc.id).toBe("ARC-EXISTING");
    expect(result.arc.name).toBe("Existing Arc");
    expect(result.arc.sceneIds).toContain("S-001");
    expect(result.arc.sceneIds).toContain("S-002");
    expect(result.arc.locationIds).toContain("L-01");
    expect(result.arc.locationIds).toContain("L-02");
  });
  it("assigns sequential knowledge delta IDs", async () => {
    const mockResponse = JSON.stringify({
      arcName: "Test Arc",
      scenes: [
        {
          id: "S-GEN-001",
          arcId: "ARC-01",
          locationId: "L-01",
          povId: "C-01",
          participantIds: ["C-01"],
          events: [],
          threadDeltas: [],
          worldDeltas: [
            {
              entityId: "C-01",
              addedNodes: [
                { id: "K-GEN-001", content: "First knowledge", type: "fact" },
                {
                  id: "K-GEN-002",
                  content: "Second knowledge",
                  type: "secret",
                },
              ],
            },
          ],
          relationshipDeltas: [],
          summary: "Test scene",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, "Test");
    // Knowledge node IDs should be sequential K-01, K-02 (2-digit padding)
    const nodes = result.scenes[0].worldDeltas[0].addedNodes;
    expect(nodes[0].id).toBe("K-01");
    expect(nodes[1].id).toBe("K-02");
  });
  it("retries on JSON parse failure", async () => {
    vi.mocked(callGenerate)
      .mockRejectedValueOnce(new Error("Invalid JSON"))
      .mockResolvedValueOnce(
        JSON.stringify({
          arcName: "Test Arc",
          scenes: [
            {
              id: "S-GEN-001",
              arcId: "ARC-01",
              locationId: "L-01",
              povId: "C-01",
              participantIds: ["C-01"],
              events: [],
              threadDeltas: [],
              worldDeltas: [],
              relationshipDeltas: [],
              summary: "Test",
            },
          ],
        }),
      );
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, "Test");
    expect(result.scenes).toHaveLength(1);
    expect(vi.mocked(callGenerate)).toHaveBeenCalledTimes(2);
  });
  // ── System delta handling ──────────────────────────────────────
  describe("systemDeltas", () => {
    it("assigns sequential WK IDs to new concepts", async () => {
      const mockResponse = JSON.stringify({
        arcName: "Arc",
        scenes: [
          {
            id: "S-GEN-001",
            arcId: "ARC-01",
            locationId: "L-01",
            povId: "C-01",
            participantIds: ["C-01"],
            events: [],
            threadDeltas: [],
            worldDeltas: [],
            relationshipDeltas: [],
            systemDeltas: {
              addedNodes: [
                { id: "SYS-GEN-1", concept: "Mana Binding", type: "system" },
                { id: "SYS-GEN-2", concept: "Leylines", type: "concept" },
              ],
              addedEdges: [
                { from: "SYS-GEN-2", to: "SYS-GEN-1", relation: "enables" },
              ],
            },
            summary: "S",
          },
        ],
      });
      vi.mocked(callGenerate).mockResolvedValue(mockResponse);
      const narrative = createMinimalNarrative();
      const result = await generateScenes(narrative, [], 0, 1, "Test");
      const wkm = result.scenes[0].systemDeltas!;
      expect(wkm.addedNodes).toHaveLength(2);
      expect(wkm.addedNodes[0].id).toBe("SYS-01");
      expect(wkm.addedNodes[1].id).toBe("SYS-02");
      // Edge endpoints were remapped from SYS-GEN-* to real ids
      expect(wkm.addedEdges).toHaveLength(1);
      expect(wkm.addedEdges[0]).toEqual({
        from: "SYS-02",
        to: "SYS-01",
        relation: "enables",
      });
    });
    it("collapses re-asserted concepts to existing WK ids (no System inflation)", async () => {
      const mockResponse = JSON.stringify({
        arcName: "Arc",
        scenes: [
          {
            id: "S-GEN-001",
            arcId: "ARC-01",
            locationId: "L-01",
            povId: "C-01",
            participantIds: ["C-01"],
            events: [],
            threadDeltas: [],
            worldDeltas: [],
            relationshipDeltas: [],
            systemDeltas: {
              addedNodes: [
                { id: "SYS-GEN-1", concept: "Mana Binding", type: "principle" },
              ],
              addedEdges: [],
            },
            summary: "S",
          },
        ],
      });
      vi.mocked(callGenerate).mockResolvedValue(mockResponse);
      const narrative = createMinimalNarrative();
      // Pre-seed the graph with a matching concept under a different id.
      narrative.systemGraph = {
        nodes: {
          "WK-07": { id: "WK-07", concept: "Mana Binding", type: "system" },
        },
        edges: [],
      };
      const result = await generateScenes(narrative, [], 0, 1, "Test");
      // The re-asserted concept does not earn a new node.
      expect(result.scenes[0].systemDeltas!.addedNodes).toHaveLength(0);
    });
    it("collapses within-batch duplicate concepts across scenes", async () => {
      const mockResponse = JSON.stringify({
        arcName: "Arc",
        scenes: [
          {
            id: "S-GEN-001",
            arcId: "ARC-01",
            locationId: "L-01",
            povId: "C-01",
            participantIds: ["C-01"],
            events: [],
            threadDeltas: [],
            worldDeltas: [],
            relationshipDeltas: [],
            systemDeltas: {
              addedNodes: [
                { id: "SYS-GEN-1", concept: "Mana Binding", type: "system" },
              ],
              addedEdges: [],
            },
            summary: "S1",
          },
          {
            id: "S-GEN-002",
            arcId: "ARC-01",
            locationId: "L-01",
            povId: "C-01",
            participantIds: ["C-01"],
            events: [],
            threadDeltas: [],
            worldDeltas: [],
            relationshipDeltas: [],
            systemDeltas: {
              addedNodes: [
                { id: "SYS-GEN-2", concept: "mana binding", type: "principle" },
              ],
              addedEdges: [],
            },
            summary: "S2",
          },
        ],
      });
      vi.mocked(callGenerate).mockResolvedValue(mockResponse);
      const narrative = createMinimalNarrative();
      const result = await generateScenes(narrative, [], 0, 2, "Test");
      // Scene 1 adds the node; scene 2 does not (re-mention).
      expect(result.scenes[0].systemDeltas!.addedNodes).toHaveLength(1);
      expect(result.scenes[0].systemDeltas!.addedNodes[0].id).toBe("SYS-01");
      expect(result.scenes[1].systemDeltas!.addedNodes).toHaveLength(0);
    });
    it("remaps edges in a later scene to reference nodes added by an earlier scene", async () => {
      const mockResponse = JSON.stringify({
        arcName: "Arc",
        scenes: [
          {
            id: "S-GEN-001",
            arcId: "ARC-01",
            locationId: "L-01",
            povId: "C-01",
            participantIds: ["C-01"],
            events: [],
            threadDeltas: [],
            worldDeltas: [],
            relationshipDeltas: [],
            systemDeltas: {
              addedNodes: [
                { id: "SYS-GEN-1", concept: "Mana Binding", type: "system" },
              ],
              addedEdges: [],
            },
            summary: "S1",
          },
          {
            id: "S-GEN-002",
            arcId: "ARC-01",
            locationId: "L-01",
            povId: "C-01",
            participantIds: ["C-01"],
            events: [],
            threadDeltas: [],
            worldDeltas: [],
            relationshipDeltas: [],
            systemDeltas: {
              addedNodes: [
                { id: "SYS-GEN-2", concept: "Leylines", type: "concept" },
              ],
              // Refers to the prior-scene concept by its GEN id.
              addedEdges: [
                { from: "SYS-GEN-2", to: "SYS-GEN-1", relation: "draws_from" },
              ],
            },
            summary: "S2",
          },
        ],
      });
      vi.mocked(callGenerate).mockResolvedValue(mockResponse);
      const narrative = createMinimalNarrative();
      const result = await generateScenes(narrative, [], 0, 2, "Test");
      expect(result.scenes[1].systemDeltas!.addedEdges).toHaveLength(1);
      // SYS-GEN-1 from scene 1 was resolved to SYS-01; scene 2's edge points to it.
      expect(result.scenes[1].systemDeltas!.addedEdges[0]).toEqual({
        from: "SYS-02",
        to: "SYS-01",
        relation: "draws_from",
      });
    });
    it("filters self-loops from edges", async () => {
      const mockResponse = JSON.stringify({
        arcName: "Arc",
        scenes: [
          {
            id: "S-GEN-001",
            arcId: "ARC-01",
            locationId: "L-01",
            povId: "C-01",
            participantIds: ["C-01"],
            events: [],
            threadDeltas: [],
            worldDeltas: [],
            relationshipDeltas: [],
            systemDeltas: {
              addedNodes: [
                { id: "SYS-GEN-1", concept: "Mana", type: "concept" },
                { id: "SYS-GEN-2", concept: "Runes", type: "concept" },
              ],
              addedEdges: [
                { from: "SYS-GEN-1", to: "SYS-GEN-1", relation: "enables" }, // self-loop
                { from: "SYS-GEN-1", to: "SYS-GEN-2", relation: "enables" }, // valid
              ],
            },
            summary: "S",
          },
        ],
      });
      vi.mocked(callGenerate).mockResolvedValue(mockResponse);
      const narrative = createMinimalNarrative();
      const result = await generateScenes(narrative, [], 0, 1, "Test");
      const edges = result.scenes[0].systemDeltas!.addedEdges;
      expect(edges).toHaveLength(1);
      expect(edges[0].from).not.toBe(edges[0].to);
    });
    it("deduplicates edges across scenes", async () => {
      const mockResponse = JSON.stringify({
        arcName: "Arc",
        scenes: [
          {
            id: "S-GEN-001",
            arcId: "ARC-01",
            locationId: "L-01",
            povId: "C-01",
            participantIds: ["C-01"],
            events: [],
            threadDeltas: [],
            worldDeltas: [],
            relationshipDeltas: [],
            systemDeltas: {
              addedNodes: [
                { id: "SYS-GEN-1", concept: "Mana", type: "concept" },
                { id: "SYS-GEN-2", concept: "Runes", type: "concept" },
              ],
              addedEdges: [
                { from: "SYS-GEN-1", to: "SYS-GEN-2", relation: "enables" },
              ],
            },
            summary: "S1",
          },
          {
            id: "S-GEN-002",
            arcId: "ARC-01",
            locationId: "L-01",
            povId: "C-01",
            participantIds: ["C-01"],
            events: [],
            threadDeltas: [],
            worldDeltas: [],
            relationshipDeltas: [],
            systemDeltas: {
              addedNodes: [],
              // Both concepts collapse to existing WK ids; the edge is a dup of S1.
              addedEdges: [
                { from: "SYS-GEN-1", to: "SYS-GEN-2", relation: "enables" },
              ],
            },
            summary: "S2",
          },
        ],
      });
      vi.mocked(callGenerate).mockResolvedValue(mockResponse);
      const narrative = createMinimalNarrative();
      const result = await generateScenes(narrative, [], 0, 2, "Test");
      // First scene keeps its edge; second scene's duplicate is dropped.
      expect(result.scenes[0].systemDeltas!.addedEdges).toHaveLength(1);
      expect(result.scenes[1].systemDeltas!.addedEdges).toHaveLength(0);
    });
    it("drops orphan edges referencing unknown WK ids", async () => {
      const mockResponse = JSON.stringify({
        arcName: "Arc",
        scenes: [
          {
            id: "S-GEN-001",
            arcId: "ARC-01",
            locationId: "L-01",
            povId: "C-01",
            participantIds: ["C-01"],
            events: [],
            threadDeltas: [],
            worldDeltas: [],
            relationshipDeltas: [],
            systemDeltas: {
              addedNodes: [
                { id: "SYS-GEN-1", concept: "Mana", type: "concept" },
              ],
              // WK-99 doesn't exist anywhere.
              addedEdges: [
                { from: "SYS-GEN-1", to: "WK-99", relation: "enables" },
              ],
            },
            summary: "S",
          },
        ],
      });
      vi.mocked(callGenerate).mockResolvedValue(mockResponse);
      const narrative = createMinimalNarrative();
      const result = await generateScenes(narrative, [], 0, 1, "Test");
      expect(result.scenes[0].systemDeltas!.addedEdges).toHaveLength(0);
    });
  });
});
// ── generateScenePlan Tests ──────────────────────────────────────────────────
describe("generateScenePlan", () => {
  it("returns parsed beat plan from LLM response", async () => {
    const mockResponse = JSON.stringify({
      beats: [
        {
          fn: "breathe",
          mechanism: "environment",
          what: "Fog rolls across the field",
          propositions: [{ content: "The grey mist" }],
        },
        {
          fn: "advance",
          mechanism: "action",
          what: "Alice draws her sword",
          propositions: [{ content: "Steel singing" }],
        },
        {
          fn: "turn",
          mechanism: "dialogue",
          what: "Bob reveals the betrayal",
          propositions: [{ content: '"You never knew"' }],
        },
      ],
      propositions: [{ content: "The fog tasted of ash and old promises." }],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001");
    const result = await generateScenePlan(narrative, scene, []);
    expect(result.beats).toHaveLength(3);
    expect(result.beats[0].fn).toBe("breathe");
    expect(result.beats[0].mechanism).toBe("environment");
  });
  it("validates beat function values", async () => {
    const mockResponse = JSON.stringify({
      beats: [
        {
          fn: "invalid_fn",
          mechanism: "action",
          what: "Something happens",
          propositions: [{ content: "detail" }],
        },
        {
          fn: "advance",
          mechanism: "action",
          what: "Valid beat",
          propositions: [{ content: "anchor" }],
        },
      ],
      propositions: [],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001");
    const result = await generateScenePlan(narrative, scene, []);
    // Invalid fn should default to 'advance'
    expect(result.beats[0].fn).toBe("advance");
    expect(result.beats[1].fn).toBe("advance");
  });
  it("validates mechanism values", async () => {
    const mockResponse = JSON.stringify({
      beats: [
        {
          fn: "breathe",
          mechanism: "invalid_mechanism",
          what: "Something",
          propositions: [{ content: "detail" }],
        },
      ],
      propositions: [],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001");
    const result = await generateScenePlan(narrative, scene, []);
    // Invalid mechanism should default to 'action'
    expect(result.beats[0].mechanism).toBe("action");
  });
  it("filters non-string anchors", async () => {
    const mockResponse = JSON.stringify({
      beats: [
        {
          fn: "breathe",
          mechanism: "environment",
          what: "Test",
          propositions: [{ content: "anchor" }],
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001");
    const result = await generateScenePlan(narrative, scene, []);
    expect(result.beats[0].propositions).toEqual([{ content: "anchor" }]);
  });
});
// ── editScenePlan Tests ──────────────────────────────────────────────────────
describe("editScenePlan", () => {
  it("returns edited beat plan based on issues", async () => {
    const mockResponse = JSON.stringify({
      beats: [
        {
          fn: "breathe",
          mechanism: "environment",
          what: "Revised opening",
          propositions: [{ content: "new anchor" }],
        },
        {
          fn: "reveal",
          mechanism: "dialogue",
          what: "Character secret exposed",
          propositions: [{ content: "gasp" }],
        },
      ],
      propositions: [{ content: "The truth hung between them." }],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001", {
      plan: {
        beats: [
          {
            fn: "breathe",
            mechanism: "environment",
            what: "Original opening",
            propositions: [{ content: "old anchor" }],
          },
        ],
      },
    });
    const currentPlan = scene.planVersions![0].plan;
    const result = await editScenePlan(
      narrative,
      scene,
      [],
      ["Opening is too slow", "Missing character reveal"],
      currentPlan,
    );
    expect(result.beats).toHaveLength(2);
    expect(result.beats[0].what).toBe("Revised opening");
    expect(result.beats[1].fn).toBe("reveal");
  });
  it("throws if no plan is passed", async () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001"); // No plan
    await expect(
      editScenePlan(narrative, scene, [], ["Issue"], undefined),
    ).rejects.toThrow("Scene has no plan");
  });
});
// ── reverseEngineerScenePlan Tests ───────────────────────────────────────────
describe("reverseEngineerScenePlan", () => {
  it("extracts beat structure from prose and returns plan", async () => {
    const mockResponse = JSON.stringify({
      beats: [
        {
          fn: "breathe",
          mechanism: "environment",
          what: "Morning light filters through",
          propositions: [{ content: "golden rays" }],
          chunks: 3,
        },
        {
          fn: "bond",
          mechanism: "dialogue",
          what: "Characters reconnect emotionally",
          propositions: [{ content: "warm smile" }],
          chunks: 3,
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const prose =
      'The morning light fell like honey across the chamber, casting long shadows that danced upon the ancient stone walls. Dust motes swirled in the golden beams, caught in their eternal waltz through the still air. The room held its breath, waiting for something, though what exactly remained unclear to those who stood within its bounds. Every surface gleamed with the soft warmth of dawn breaking over distant mountains. The air itself seemed to shimmer with possibility, thick with the promise of a new beginning after so many dark days. Outside the window, birds began their morning song, their voices rising in a chorus that echoed through the valley below.\n\n"I missed you," she said with a warm smile that crinkled the corners of her eyes. Her voice carried the weight of countless days spent apart, each one a small eternity of longing and hope. He reached out to take her hand, feeling the familiar warmth of her touch, and knew in that moment that everything they had endured had been worth it. The distance melted away like morning frost under the sun. They stood there together, neither speaking, both understanding that words were unnecessary now. The silence between them was comfortable, filled with all the things they had wanted to say during their time apart.';
    const summary = "Characters reunite at dawn";
    const result = await reverseEngineerScenePlan(prose, summary);
    expect(result.plan.beats).toHaveLength(2);
    expect(result.plan.beats[0].fn).toBe("breathe");
    expect(result.plan.beats[0].mechanism).toBe("environment");
    expect(result.plan.beats[1].fn).toBe("bond");
    expect(result.plan.beats[1].mechanism).toBe("dialogue");
  });
  it("validates beat functions and mechanisms to prevent invalid values", async () => {
    const mockResponse = JSON.stringify({
      beats: [
        {
          fn: "INVALID_FN",
          mechanism: "INVALID_MECH",
          what: "Something happens here in the scene",
          propositions: [{ content: "descriptive fact" }],
        },
        {
          fn: "INVALID_FN2",
          mechanism: "INVALID_MECH2",
          what: "Confrontation at the door",
          propositions: [{ content: "another fact" }],
        },
      ],
      propositions: [],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const prose =
      "The room was quiet except for the steady drip of water from a crack in the ceiling. Each drop fell in perfect rhythm, marking time like a metronome in the otherwise silent chamber. Alice stood by the window, watching the street below with careful attention, her hand resting on the cold glass as she tried to make sense of everything that had happened. The events of the past few days swirled through her mind like leaves caught in a whirlwind, each memory sharp and painful. She had replayed every conversation, every decision, trying to find the moment where things had gone wrong.\n\nFootsteps echoed in the hallway outside, growing louder with each passing second. She tensed, her breath catching in her throat as the door handle began to turn. This was the moment she had been waiting for, the confrontation she had been dreading, and now there was no escape. Her fingers curled into fists at her sides as the door swung open. The figure in the doorway was backlit by the hallway light, casting a long shadow across the floor. She knew who it was before they spoke, had known this moment was coming for days now.";
    const result = await reverseEngineerScenePlan(prose, "Test");
    // Should default invalid values
    expect(result.plan.beats[0].fn).toBe("advance"); // Default fn
    expect(result.plan.beats[0].mechanism).toBe("action"); // Default mechanism
  });
  it("filters out invalid propositions without content", async () => {
    const mockResponse = JSON.stringify({
      beats: [
        {
          fn: "breathe",
          mechanism: "environment",
          what: "Setting up the atmospheric scene",
          propositions: [
            { content: "Valid proposition" },
            { content: "" }, // Empty
            { notContent: "wrong key" }, // Wrong structure
            { content: "Another valid one" },
          ],
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const prose =
      "The old manor stood silhouetted against the darkening sky, its windows like empty eye sockets staring down at the overgrown garden below. Ivy had claimed the walls long ago, wrapping around the crumbling stonework in a suffocating embrace. The air smelled of decay and forgotten things, heavy with the weight of years abandoned. No one had lived here for decades, yet tonight the house seemed to be waiting for something. The wind howled through the broken shutters, creating an eerie symphony that echoed across the empty rooms. Every board creaked, every shadow moved, and the very foundation of the building seemed to groan under the burden of time. The moon emerged from behind the clouds, casting silver light across the desolate scene.";
    const result = await reverseEngineerScenePlan(prose, "Test");
    expect(result.plan.beats[0].propositions).toHaveLength(2);
    expect(result.plan.beats[0].propositions[0].content).toBe(
      "Valid proposition",
    );
    expect(result.plan.beats[0].propositions[1].content).toBe(
      "Another valid one",
    );
  });
  it("handles streaming with onToken callback", async () => {
    const mockResponse = JSON.stringify({
      beats: [
        {
          fn: "advance",
          mechanism: "action",
          what: "Action beat moves the plot forward",
          propositions: [{ content: "descriptive detail" }],
        },
      ],
    });
    vi.mocked(callGenerateStream).mockResolvedValue(mockResponse);
    const tokens: string[] = [];
    const result = await reverseEngineerScenePlan(
      "The detective moved quickly down the narrow alley, his coat whipping behind him in the cold wind. His hand rested on the grip of his pistol, ready for whatever might emerge from the shadows ahead. Each step brought him closer to the truth he had been chasing for months, and closer to the danger that came with it. The sound of footsteps behind him confirmed his suspicions, and he knew there was no turning back now. The alley twisted and turned, leading him deeper into the maze of the city old quarter. Overhead, laundry lines stretched between buildings, their forgotten contents flapping in the breeze like ghosts of lives long past.",
      "Test summary",
      (token) => tokens.push(token),
    );
    expect(result.plan.beats.length).toBeGreaterThanOrEqual(1);
    expect(vi.mocked(callGenerateStream)).toHaveBeenCalled();
  });
});
// ── rewriteScenePlan Tests ───────────────────────────────────────────────────
describe("rewriteScenePlan", () => {
  it("rewrites plan based on editorial feedback", async () => {
    const mockResponse = JSON.stringify({
      beats: [
        {
          fn: "turn",
          mechanism: "action",
          what: "Dramatic reversal",
          propositions: [{ content: "twist moment" }],
        },
        {
          fn: "resolve",
          mechanism: "dialogue",
          what: "Conflict settles",
          propositions: [{ content: "final words" }],
        },
      ],
      propositions: [{ content: "Everything changed in that instant." }],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001");
    const currentPlan: BeatPlan = {
      beats: [
        {
          fn: "advance",
          mechanism: "action",
          what: "Original beat",
          propositions: [{ content: "anchor" }],
        },
      ],
    };
    const result = await rewriteScenePlan(
      narrative,
      scene,
      [],
      currentPlan,
      "Add more dramatic tension and a clearer resolution",
    );
    expect(result.beats).toHaveLength(2);
    expect(result.beats[0].fn).toBe("turn");
  });
  it("falls back to current plan if LLM returns empty beats", async () => {
    const mockResponse = JSON.stringify({
      beats: [],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001");
    const currentPlan: BeatPlan = {
      beats: [
        {
          fn: "breathe",
          mechanism: "environment",
          what: "Original",
          propositions: [{ content: "original" }],
        },
      ],
    };
    const result = await rewriteScenePlan(
      narrative,
      scene,
      [],
      currentPlan,
      "Feedback",
    );
    // Should fall back to current plan's beats
    expect(result.beats).toHaveLength(1);
    expect(result.beats[0].fn).toBe("breathe");
  });
});
// ── generateSceneProse Tests ─────────────────────────────────────────────────
describe("generateSceneProse", () => {
  it("returns prose from LLM response", async () => {
    const mockProse =
      "The castle walls loomed against the grey sky. Alice drew her blade, the steel singing as it cleared the scabbard.";
    vi.mocked(callGenerate).mockResolvedValue(mockProse);
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001", {
      summary: "Alice prepares for battle at the castle",
    });
    const result = await generateSceneProse(narrative, scene, []);
    expect(result.prose).toBe(mockProse);
  });
  it("includes beat plan in prompt when available", async () => {
    const mockProse = "Test prose output";
    vi.mocked(callGenerate).mockResolvedValue(mockProse);
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001", {
      plan: {
        beats: [
          {
            fn: "breathe",
            mechanism: "environment",
            what: "Opening atmosphere",
            propositions: [{ content: "grey sky" }],
          },
        ],
      },
    });
    await generateSceneProse(narrative, scene, []);
    const callArgs = vi.mocked(callGenerate).mock.calls[0];
    expect(callArgs[0]).toContain("BEAT PLAN");
    expect(callArgs[0]).toContain("breathe:environment");
    expect(callArgs[0]).toContain("grey sky");
  });
  it("handles streaming with onToken callback", async () => {
    const mockProse = "Streamed prose content";
    vi.mocked(callGenerateStream).mockResolvedValue(mockProse);
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001");
    const tokens: string[] = [];
    const result = await generateSceneProse(narrative, scene, [], (token) =>
      tokens.push(token),
    );
    expect(result.prose).toBe(mockProse);
    expect(vi.mocked(callGenerateStream)).toHaveBeenCalled();
  });
  it("includes prose guidance when provided", async () => {
    const mockProse = "Test output";
    vi.mocked(callGenerate).mockResolvedValue(mockProse);
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001");
    await generateSceneProse(
      narrative,
      scene,
      [],
      undefined,
      "Write with dark humor",
    );
    const callArgs = vi.mocked(callGenerate).mock.calls[0];
    expect(callArgs[1]).toContain("SCENE DIRECTION");
    expect(callArgs[1]).toContain("dark humor");
  });
  it("includes prose profile when available", async () => {
    const mockProse = "Test output";
    vi.mocked(callGenerate).mockResolvedValue(mockProse);
    const narrative = createMinimalNarrative();
    narrative.proseProfile = {
      register: "literary",
      stance: "close_third",
      devices: ["metaphor", "irony"],
      rules: ["Show, dont tell"],
      antiPatterns: ["Purple prose"],
    };
    const scene = createScene("S-001");
    await generateSceneProse(narrative, scene, []);
    const callArgs = vi.mocked(callGenerate).mock.calls[0];
    // Prose profile is in user prompt (arg 0), not system prompt (arg 1)
    expect(callArgs[0]).toContain("PROSE PROFILE");
    expect(callArgs[0]).toContain("literary");
  });
  it("parses BEAT_END markers and creates beatProseMap", async () => {
    const mockProse = `The morning light filtered through the window.
[BEAT_END:0]
She reached for her sword.
[BEAT_END:1]
"We must go now," he said.`;
    vi.mocked(callGenerate).mockResolvedValue(mockProse);
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001", {
      plan: {
        beats: [
          {
            fn: "breathe",
            mechanism: "environment",
            what: "Morning light",
            propositions: [],
          },
          {
            fn: "advance",
            mechanism: "action",
            what: "Reaches for sword",
            propositions: [],
          },
          {
            fn: "turn",
            mechanism: "dialogue",
            what: "Urgency",
            propositions: [],
          },
        ],
      },
    });
    const result = await generateSceneProse(narrative, scene, []);
    expect(result.beatProseMap).toBeDefined();
    expect(result.beatProseMap?.chunks).toHaveLength(3);
    expect(result.beatProseMap?.chunks[0].prose).toBe(
      "The morning light filtered through the window.",
    );
    expect(result.beatProseMap?.chunks[1].prose).toBe(
      "She reached for her sword.",
    );
    expect(result.beatProseMap?.chunks[2].prose).toBe(
      '"We must go now," he said.',
    );
    expect(result.prose).not.toContain("[BEAT_END:");
  });
  it("retries when BEAT_END markers are missing", async () => {
    const proseWithoutMarkers =
      "The morning light filtered through the window. She reached for her sword.";
    const proseWithMarkers = `The morning light filtered through the window.
[BEAT_END:0]
She reached for her sword.`;
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(proseWithoutMarkers) // First attempt - no markers
      .mockResolvedValueOnce(proseWithMarkers); // Second attempt - has markers
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001", {
      plan: {
        beats: [
          {
            fn: "breathe",
            mechanism: "environment",
            what: "Morning light",
            propositions: [],
          },
          {
            fn: "advance",
            mechanism: "action",
            what: "Reaches for sword",
            propositions: [],
          },
        ],
      },
    });
    const result = await generateSceneProse(narrative, scene, []);
    expect(vi.mocked(callGenerate)).toHaveBeenCalledTimes(2);
    expect(result.beatProseMap).toBeDefined();
    expect(result.beatProseMap?.chunks).toHaveLength(2);
  });
  it("returns prose without beatProseMap after max retries on marker failure", async () => {
    const proseWithoutMarkers =
      "The morning light filtered through the window. She reached for her sword.";
    vi.mocked(callGenerate)
      .mockResolvedValueOnce(proseWithoutMarkers) // First attempt
      .mockResolvedValueOnce(proseWithoutMarkers); // Second attempt (max retries)
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001", {
      plan: {
        beats: [
          {
            fn: "breathe",
            mechanism: "environment",
            what: "Morning light",
            propositions: [],
          },
          {
            fn: "advance",
            mechanism: "action",
            what: "Reaches for sword",
            propositions: [],
          },
        ],
      },
    });
    const result = await generateSceneProse(narrative, scene, []);
    expect(vi.mocked(callGenerate)).toHaveBeenCalledTimes(2);
    expect(result.beatProseMap).toBeUndefined();
    expect(result.prose).toBe(proseWithoutMarkers);
  });
  it("handles invalid marker order gracefully", async () => {
    const mockProse = `First beat prose.
[BEAT_END:0]
Second beat prose.
[BEAT_END:2]
Third beat prose.`; // Skipped beat 1!
    vi.mocked(callGenerate).mockResolvedValueOnce(mockProse)
      .mockResolvedValueOnce(`Fixed prose.
[BEAT_END:0]
Fixed prose 2.
[BEAT_END:1]
Fixed prose 3.`);
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001", {
      plan: {
        beats: [
          {
            fn: "breathe",
            mechanism: "environment",
            what: "Beat 1",
            propositions: [],
          },
          {
            fn: "advance",
            mechanism: "action",
            what: "Beat 2",
            propositions: [],
          },
          {
            fn: "turn",
            mechanism: "dialogue",
            what: "Beat 3",
            propositions: [],
          },
        ],
      },
    });
    const result = await generateSceneProse(narrative, scene, []);
    expect(result.beatProseMap).toBeDefined();
    expect(result.beatProseMap?.chunks).toHaveLength(3);
  });
  it("correctly handles all beats marked with no prose after last marker", async () => {
    // This tests the fix for the case where LLM correctly places all markers
    // (e.g., [BEAT_END:0] through [BEAT_END:8] for 9 beats) with no trailing prose
    const mockProse = `First beat prose.
[BEAT_END:0]
Second beat prose.
[BEAT_END:1]
Third beat prose.
[BEAT_END:2]`;
    vi.mocked(callGenerate).mockResolvedValue(mockProse);
    const narrative = createMinimalNarrative();
    const scene = createScene("S-001", {
      plan: {
        beats: [
          {
            fn: "breathe",
            mechanism: "environment",
            what: "Beat 1",
            propositions: [],
          },
          {
            fn: "advance",
            mechanism: "action",
            what: "Beat 2",
            propositions: [],
          },
          {
            fn: "turn",
            mechanism: "dialogue",
            what: "Beat 3",
            propositions: [],
          },
        ],
      },
    });
    const result = await generateSceneProse(narrative, scene, []);
    // Should successfully parse without adding an extra beat
    expect(result.beatProseMap).toBeDefined();
    expect(result.beatProseMap?.chunks).toHaveLength(3);
    expect(result.beatProseMap?.chunks[0].beatIndex).toBe(0);
    expect(result.beatProseMap?.chunks[1].beatIndex).toBe(1);
    expect(result.beatProseMap?.chunks[2].beatIndex).toBe(2);
    expect(result.prose).not.toContain("[BEAT_END:");
  });
});
// ── Thread Log (TK) ID Handling ──────────────────────────────────────────────
// These tests lock in the fix for the bug where the LLM emits TK-GEN-0 in
// every scene of an arc and applyThreadDelta's duplicate-id guard
// silently drops every log entry after the first scene for each thread.
describe("generateScenes — thread log TK ID remap", () => {
  it("assigns globally unique TK-* IDs when LLM re-uses GEN placeholders across scenes", async () => {
    // LLM emits TK-GEN-1 and TK-GEN-2 in BOTH scenes for the same thread —
    // without a remap, applyThreadDelta would silently drop scene 2's
    // contribution during store replay.
    const mockResponse = JSON.stringify({
      arcName: "Test Arc",
      scenes: [
        {
          id: "S-GEN-001",
          arcId: "ARC-01",
          locationId: "L-01",
          povId: "C-01",
          participantIds: ["C-01"],
          events: [],
          threadDeltas: [
            {
              threadId: "T-01",
              from: "active",
              to: "active",
              addedNodes: [
                { id: "TK-GEN-1", content: "scene 1 pulse A", type: "pulse" },
                { id: "TK-GEN-2", content: "scene 1 pulse B", type: "pulse" },
              ],
            },
          ],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Scene 1",
        },
        {
          id: "S-GEN-002",
          arcId: "ARC-01",
          locationId: "L-01",
          povId: "C-01",
          participantIds: ["C-01"],
          events: [],
          threadDeltas: [
            {
              threadId: "T-01",
              from: "active",
              to: "active",
              addedNodes: [
                { id: "TK-GEN-1", content: "scene 2 pulse A", type: "pulse" },
                { id: "TK-GEN-2", content: "scene 2 pulse B", type: "pulse" },
              ],
            },
          ],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Scene 2",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 2, "Test");
    // Collect all TK IDs across both scenes — they must all be unique.
    const allTkIds = result.scenes.flatMap((s) =>
      s.threadDeltas.flatMap((tm) => tm.addedNodes?.map((n) => n.id) ?? []),
    );
    expect(allTkIds).toHaveLength(4);
    expect(new Set(allTkIds).size).toBe(4); // all unique
    // No lingering TK-GEN placeholders — all should be real sequential IDs.
    for (const id of allTkIds) {
      expect(id).toMatch(/^TK-\d+$/);
    }
  });
  it("synthesizes a fallback log entry when LLM omits addedNodes entirely", async () => {
    const mockResponse = JSON.stringify({
      arcName: "Test Arc",
      scenes: [
        {
          id: "S-GEN-001",
          arcId: "ARC-01",
          locationId: "L-01",
          povId: "C-01",
          participantIds: ["C-01"],
          events: [],
          threadDeltas: [
            // Status transition with no log entries — should synthesize one.
            { threadId: "T-01", from: "seeded", to: "active", addedNodes: [] },
            // Pulse with no log entries — should synthesize one too.
            { threadId: "T-02", from: "active", to: "active", addedNodes: [] },
          ],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Scene",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, "Test");
    const [t1, t2] = result.scenes[0].threadDeltas;
    expect(t1.addedNodes).toHaveLength(1);
    expect(t1.addedNodes![0].content).toMatch(/advanced from seeded to active/);
    expect(t1.addedNodes![0].type).toBe("transition");
    expect(t2.addedNodes).toHaveLength(1);
    expect(t2.addedNodes![0].content).toMatch(/held active without transition/);
    expect(t2.addedNodes![0].type).toBe("pulse");
  });
  it('coerces invalid status values (e.g. "pulse") in from/to fields', async () => {
    // The LLM sometimes confuses the log node type "pulse" with a status
    // value and emits something like "from": "pulse", "to": "active".
    // The sanitizer must coerce both fields to valid lifecycle statuses
    // so the thread's stored status can't be polluted.
    const mockResponse = JSON.stringify({
      arcName: "Test Arc",
      scenes: [
        {
          id: "S-GEN-001",
          arcId: "ARC-01",
          locationId: "L-01",
          povId: "C-01",
          participantIds: ["C-01"],
          events: [],
          threadDeltas: [
            // Invalid: "pulse" is a log node type, never a status.
            { threadId: "T-01", from: "pulse", to: "active", addedNodes: [] },
            // Valid pulse pattern: same→same status with a pulse log entry.
            {
              threadId: "T-02",
              from: "active",
              to: "active",
              addedNodes: [
                { id: "TK-GEN-001", content: "real pulse", type: "pulse" },
              ],
            },
          ],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Scene",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, "Test");
    const tms = result.scenes[0].threadDeltas;
    // First delta: "pulse" was coerced to T-01's current status ("active").
    // T-01 in the minimal narrative is created with status "active".
    expect(tms[0].from).toBe("active");
    expect(tms[0].to).toBe("active");
    // Second delta passes through unchanged.
    expect(tms[1].from).toBe("active");
    expect(tms[1].to).toBe("active");
    expect(tms[1].addedNodes![0].content).toBe("real pulse");
    expect(tms[1].addedNodes![0].type).toBe("pulse");
  });
  it("synthesized fallback nodes are assigned unique TK-* IDs like any other", async () => {
    const mockResponse = JSON.stringify({
      arcName: "Test Arc",
      scenes: [
        {
          id: "S-GEN-001",
          arcId: "ARC-01",
          locationId: "L-01",
          povId: "C-01",
          participantIds: ["C-01"],
          events: [],
          threadDeltas: [
            {
              threadId: "T-01",
              from: "active",
              to: "critical",
              addedNodes: [],
            },
            { threadId: "T-02", from: "seeded", to: "active", addedNodes: [] },
          ],
          worldDeltas: [],
          relationshipDeltas: [],
          summary: "Scene",
        },
      ],
    });
    vi.mocked(callGenerate).mockResolvedValue(mockResponse);
    const narrative = createMinimalNarrative();
    const result = await generateScenes(narrative, [], 0, 1, "Test");
    const allTkIds = result.scenes[0].threadDeltas.flatMap(
      (tm) => tm.addedNodes?.map((n) => n.id) ?? [],
    );
    expect(allTkIds).toHaveLength(2);
    expect(new Set(allTkIds).size).toBe(2);
    for (const id of allTkIds) {
      expect(id).toMatch(/^TK-\d+$/);
    }
  });
});

// ── sanitizeScenes — newly-introduced entities visible to reference checks ──
// Regression: the LLM frequently puts a newly-introduced character ID in
// both `newCharacters` and `participantIds` of the same scene (the character
// participates in the scene that introduces them). If sanitization validates
// `participantIds` before registering `newCharacters`, the participant is
// stripped as "invalid" and the character disappears from scene inspectors,
// the world graph, and downstream logic. Entities registered in `new*`
// fields MUST be treated as valid references within the same scene.
describe("sanitizeScenes — introduced entities survive reference validation", () => {
  it("keeps newCharacter's id in participantIds", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-01", "C-GEN-001"],
      povId: "C-01",
      locationId: "L-01",
      newCharacters: [
        {
          id: "C-GEN-001",
          name: "Liu He",
          role: "transient",
          threadIds: [],
          world: { nodes: {}, edges: [] },
        },
      ],
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.participantIds).toContain("C-GEN-001");
    expect(scene.newCharacters?.[0]?.id).toBe("C-GEN-001");
  });

  it("keeps newLocation's id as the scene's locationId", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-01"],
      povId: "C-01",
      locationId: "L-GEN-001",
      newLocations: [
        {
          id: "L-GEN-001",
          name: "Qing Mao Mountain's Edge",
          parentId: null,
          prominence: "place",
          tiedCharacterIds: [],
          threadIds: [],
          world: { nodes: {}, edges: [] },
        },
      ],
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.locationId).toBe("L-GEN-001");
  });

  it("keeps newArtifact's id in artifactUsages", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-01"],
      povId: "C-01",
      locationId: "L-01",
      artifactUsages: [{ artifactId: "A-GEN-001", characterId: "C-01", usage: "inspects" }],
      newArtifacts: [
        {
          id: "A-GEN-001",
          name: "Spring Autumn Cicada",
          significance: "key",
          parentId: null,
          threadIds: [],
          world: { nodes: {}, edges: [] },
        },
      ],
    } as unknown as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.artifactUsages?.[0]?.artifactId).toBe("A-GEN-001");
  });

  it("keeps newThread's id in threadDeltas", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-01"],
      povId: "C-01",
      locationId: "L-01",
      threadDeltas: [{ threadId: "T-GEN-001", from: "latent", to: "seeded", addedNodes: [] }],
      newThreads: [
        {
          id: "T-GEN-001",
          description: "A fresh tension emerges",
          status: "latent",
          participants: [],
          dependents: [],
          openedAt: "s1",
          threadLog: { nodes: {}, edges: [] },
        },
      ],
    } as unknown as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.threadDeltas.find((td) => td.threadId === "T-GEN-001")).toBeDefined();
  });

  it("keeps newCharacter's id as a worldDelta entityId", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-01", "C-GEN-001"],
      povId: "C-01",
      locationId: "L-01",
      worldDeltas: [
        {
          entityId: "C-GEN-001",
          addedNodes: [{ id: "K-GEN-001", type: "trait", content: "calculating eyes" }],
        },
      ],
      newCharacters: [
        {
          id: "C-GEN-001",
          name: "Liu He",
          role: "transient",
          threadIds: [],
          world: { nodes: {}, edges: [] },
        },
      ],
    } as unknown as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.worldDeltas.find((wd) => wd.entityId === "C-GEN-001")).toBeDefined();
  });

  it("cross-scene: entity introduced in scene 1 is valid in scene 2", () => {
    const narrative = createMinimalNarrative();
    const scene1 = createScene("S-1", {
      participantIds: ["C-01"],
      povId: "C-01",
      locationId: "L-01",
      newCharacters: [
        {
          id: "C-GEN-001",
          name: "Liu He",
          role: "transient",
          threadIds: [],
          world: { nodes: {}, edges: [] },
        },
      ],
    } as Partial<Scene>);
    const scene2 = createScene("S-2", {
      participantIds: ["C-01", "C-GEN-001"],
      povId: "C-01",
      locationId: "L-01",
    } as Partial<Scene>);
    sanitizeScenes([scene1, scene2], narrative, "test");
    expect(scene2.participantIds).toContain("C-GEN-001");
  });

  it("still strips participantIds that reference genuinely unknown characters", () => {
    const narrative = createMinimalNarrative();
    const scene = createScene("S-1", {
      participantIds: ["C-01", "C-DOES-NOT-EXIST"],
      povId: "C-01",
      locationId: "L-01",
    } as Partial<Scene>);
    sanitizeScenes([scene], narrative, "test");
    expect(scene.participantIds).toContain("C-01");
    expect(scene.participantIds).not.toContain("C-DOES-NOT-EXIST");
  });
});
