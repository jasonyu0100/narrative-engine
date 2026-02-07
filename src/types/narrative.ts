// ── Thread ───────────────────────────────────────────────────────────────────
export type ThreadStatus = string;

export type ThreadAnchor = {
  id: string;
  type: 'character' | 'location';
};

export type Thread = {
  id: string;
  anchors: ThreadAnchor[];
  description: string;
  status: ThreadStatus;
  openedAt: string;
  dependents: string[];
};

// ── Character ────────────────────────────────────────────────────────────────
export type CharacterRole = 'anchor' | 'recurring' | 'transient';

export type KnowledgeNodeType = string;
export type KnowledgeEdgeType = string;

export type KnowledgeNode = {
  id: string;
  type: KnowledgeNodeType;
  content: string;
};

export type KnowledgeEdge = {
  from: string;
  to: string;
  type: KnowledgeEdgeType;
};

export type KnowledgeGraph = {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
};

export type Character = {
  id: string;
  name: string;
  role: CharacterRole;
  knowledge: KnowledgeGraph;
  threadIds: string[];
};

// ── Location ─────────────────────────────────────────────────────────────────
export type Location = {
  id: string;
  name: string;
  parentId: string | null;
  threadIds: string[];
  knowledge: KnowledgeGraph;
};

export type RelationshipEdge = {
  from: string;
  to: string;
  type: string;
  valence: number;
};

// ── Scene & Arc ─────────────────────────────────────────────────────────────
export type ThreadMutation = {
  threadId: string;
  from: string;
  to: string;
};

export type KnowledgeMutation = {
  characterId: string;
  nodeId: string;
  action: 'added' | 'removed';
  content: string;
  /** LLM-suggested type describing this specific knowledge (e.g. "tactical_insight", "betrayal_discovered") */
  nodeType?: string;
};

export type RelationshipMutation = {
  from: string;
  to: string;
  type: string;
  valenceDelta: number;
};

/** Force values are min-max normalized to [-1, +1] across all scenes.
 *  - stakes:  how much is at risk — AI-provided per scene (0-100 raw), normalized
 *  - pacing:  how much changes — computed from total mutation count, normalized
 *  - variety: how novel the cast/setting is — computed from character/location usage frequency, normalized
 */
export type ForceSnapshot = {
  stakes: number;
  pacing: number;
  variety: number;
};

// ── Narrative Cube (Stakes · Pacing · Variety) ──────────────────────────────
// The three forces (S·P·V) define a cube. Each corner is a recognisable state.
export type CubeCornerKey =
  | 'HHH' | 'HHL' | 'HLH' | 'HLL'
  | 'LHH' | 'LHL' | 'LLH' | 'LLL';

export type CubeCorner = {
  key: CubeCornerKey;
  name: string;
  description: string;
  forces: ForceSnapshot;
};

export const NARRATIVE_CUBE: Record<CubeCornerKey, CubeCorner> = {
  HHH: {
    key: 'HHH',
    name: 'Peak',
    description: 'High stakes, rapid events, unfamiliar cast/setting. Climactic sequences in new territory with everything on the line.',
    forces: { stakes: 1, pacing: 1, variety: 1 },
  },
  HHL: {
    key: 'HHL',
    name: 'Climax',
    description: 'High stakes and rapid events with the familiar cast. The archetypal payoff — maximum investment with known characters.',
    forces: { stakes: 1, pacing: 1, variety: -1 },
  },
  HLH: {
    key: 'HLH',
    name: 'Slow Burn',
    description: 'High stakes but little changes, with new faces or places. Tension through restraint — the calm before the storm in unfamiliar territory.',
    forces: { stakes: 1, pacing: -1, variety: 1 },
  },
  HLL: {
    key: 'HLL',
    name: 'Standoff',
    description: 'High stakes, little changes, familiar ground. Everything is loaded but static — characters endure, suppress, or wait.',
    forces: { stakes: 1, pacing: -1, variety: -1 },
  },
  LHH: {
    key: 'LHH',
    name: 'Exploration',
    description: 'Low stakes, rapid events, new cast/setting. Discovery-driven sequences — world-building, early adventure, open possibility space.',
    forces: { stakes: -1, pacing: 1, variety: 1 },
  },
  LHL: {
    key: 'LHL',
    name: 'Sprint',
    description: 'Low stakes, rapid events, familiar cast. Routine action among known elements — training, travel, episodic sequences.',
    forces: { stakes: -1, pacing: 1, variety: -1 },
  },
  LLH: {
    key: 'LLH',
    name: 'Wandering',
    description: 'Low stakes, little changes, new faces/places. Contemplative or transitional — characters in new environments without clear direction.',
    forces: { stakes: -1, pacing: -1, variety: 1 },
  },
  LLL: {
    key: 'LLL',
    name: 'Quiet',
    description: 'All forces at minimum. Familiar world, no risk, no urgency. Recovery and seed-planting — breathing room after high-intensity sequences.',
    forces: { stakes: -1, pacing: -1, variety: -1 },
  },
};

export type ExpansionManifest = {
  characterIds: string[];
  locationIds: string[];
  threadIds: string[];
  relationshipCount: number;
};

export type Scene = {
  kind: 'scene';
  id: string;
  arcId: string;
  locationId: string;
  participantIds: string[];
  /** Characters who move in this scene — characterId → new locationId. Only include deltas. */
  characterMovements?: Record<string, string>;
  events: string[];
  threadMutations: ThreadMutation[];
  knowledgeMutations: KnowledgeMutation[];
  relationshipMutations: RelationshipMutation[];
  /** AI-provided stakes value (0-100), used by computeForceSnapshots */
  stakes?: number;
  prose: string;
  summary: string;
};

export type WorldBuildCommit = {
  kind: 'world_build';
  id: string;
  summary: string;
  expansionManifest: ExpansionManifest;
};

/** A timeline entry is either a narrative scene or a world-building commit */
export type TimelineEntry = Scene | WorldBuildCommit;

export function isScene(entry: TimelineEntry): entry is Scene {
  return entry.kind === 'scene';
}

export function isWorldBuild(entry: TimelineEntry): entry is WorldBuildCommit {
  return entry.kind === 'world_build';
}

export type Arc = {
  id: string;
  name: string;
  sceneIds: string[];
  develops: string[];
  /** Locations this arc focuses on — determines the spatial graph shown */
  locationIds: string[];
  /** Characters active in this arc — determined by location + thread anchors */
  activeCharacterIds: string[];
  /** Starting positions — characterId → locationId. Established at arc start. */
  initialCharacterLocations: Record<string, string>;
};

// ── Branch ───────────────────────────────────────────────────────────────────
export type Branch = {
  id: string;
  name: string;
  parentBranchId: string | null;
  /** Entry where this branch diverges from its parent (null for root) */
  forkEntryId: string | null;
  /** Ordered timeline entry IDs (scenes + world builds) owned by this branch */
  entryIds: string[];
  createdAt: number;
};

// ── Commit ───────────────────────────────────────────────────────────────────
export type Commit = {
  id: string;
  parentId: string | null;
  sceneId: string;
  arcId: string;
  diffName: string;
  threadMutations: ThreadMutation[];
  knowledgeMutations: KnowledgeMutation[];
  relationshipMutations: RelationshipMutation[];
  authorOverride: string | null;
  createdAt: number;
};

// ── Narrative State ──────────────────────────────────────────────────────────
export type ControlMode = 'auto' | 'manual';

export type NarrativeState = {
  id: string;
  title: string;
  description: string;
  characters: Record<string, Character>;
  locations: Record<string, Location>;
  threads: Record<string, Thread>;
  arcs: Record<string, Arc>;
  scenes: Record<string, Scene>;
  worldBuilds: Record<string, WorldBuildCommit>;
  branches: Record<string, Branch>;
  commits: Commit[];
  relationships: RelationshipEdge[];
  worldSummary: string;
  controlMode: ControlMode;
  activeForces: ForceSnapshot;
  coverImageUrl?: string;
  createdAt: number;
  updatedAt: number;
};

/** Look up a timeline entry (scene or world build) by ID */
export function resolveEntry(n: NarrativeState, id: string): TimelineEntry | null {
  return n.scenes[id] ?? n.worldBuilds[id] ?? null;
}

export type NarrativeEntry = {
  id: string;
  title: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  sceneCount: number;
  coverThread: string;
  coverImageUrl?: string;
};

// ── Auto Mode ───────────────────────────────────────────────────────────────

export type AutoEndCondition =
  | { type: 'scene_count'; target: number }
  | { type: 'all_threads_resolved' }
  | { type: 'arc_count'; target: number }
  | { type: 'manual_stop' };

/** Auto actions map directly to the 8 narrative cube corners */
export type AutoAction = CubeCornerKey;

export type AutoActionWeight = {
  action: AutoAction;
  score: number;
  reason: string;
};

/** High-level objective that guides auto mode's action selection */
export type AutoObjective = 'resolve_threads' | 'explore_and_resolve' | 'open_ended';

export type AutoConfig = {
  objective: AutoObjective;
  endConditions: AutoEndCondition[];
  minArcLength: number;
  maxArcLength: number;
  /** World build every N arcs (0 = off) */
  worldBuildInterval: number;
  maxActiveThreads: number;
  threadStagnationThreshold: number;
  arcDirectionPrompt: string;
  toneGuidance: string;
  narrativeConstraints: string;
  characterRotationEnabled: boolean;
  minScenesBetweenCharacterFocus: number;
  /** When true, auto mode must use latest world-building elements in new arcs */
  enforceWorldBuildUsage: boolean;
};

export type AutoRunLog = {
  cycle: number;
  timestamp: number;
  action: AutoAction;
  reason: string;
  scenesGenerated: number;
  worldExpanded: boolean;
  endConditionMet: AutoEndCondition | null;
};

export type AutoRunState = {
  isRunning: boolean;
  isPaused: boolean;
  currentCycle: number;
  totalScenesGenerated: number;
  totalWorldExpansions: number;
  startingSceneCount: number;
  startingArcCount: number;
  log: AutoRunLog[];
};

// ── API Logs ─────────────────────────────────────────────────────────────────

export type ApiLogEntry = {
  id: string;
  timestamp: number;
  caller: string;
  status: 'pending' | 'success' | 'error';
  durationMs: number | null;
  promptLength: number;
  responseLength: number | null;
  error: string | null;
  /** Truncated prompt preview */
  promptPreview: string;
  /** Truncated response preview */
  responsePreview: string | null;
};

// ── App State ────────────────────────────────────────────────────────────────
export type InspectorContext =
  | { type: 'scene'; sceneId: string }
  | { type: 'character'; characterId: string }
  | { type: 'location'; locationId: string }
  | { type: 'thread'; threadId: string }
  | { type: 'arc'; arcId: string };

export type WizardStep = 'premise' | 'world' | 'generate';

export type CharacterSketch = {
  name: string;
  role: 'anchor' | 'recurring' | 'transient';
  description: string;
};

export type LocationSketch = {
  name: string;
  description: string;
};

export type WizardData = {
  title: string;
  premise: string;
  genres: string[];
  tone: string;
  setting: string;
  scale: string;
  characters: CharacterSketch[];
  locations: LocationSketch[];
  storyDirection: string;
};

export type GraphViewMode = 'scene' | 'overview';

export type AppState = {
  narratives: NarrativeEntry[];
  activeNarrativeId: string | null;
  activeNarrative: NarrativeState | null;
  controlMode: ControlMode;
  isPlaying: boolean;
  currentSceneIndex: number;
  activeBranchId: string | null;
  /** Resolved scene keys for the active branch (inherited + own) */
  resolvedSceneKeys: string[];
  inspectorContext: InspectorContext | null;
  wizardOpen: boolean;
  wizardStep: WizardStep;
  wizardPrefill: string;
  wizardData: WizardData;
  selectedKnowledgeEntity: string | null;
  autoTimer: number;
  graphViewMode: GraphViewMode;
  autoConfig: AutoConfig;
  autoRunState: AutoRunState | null;
  apiLogs: ApiLogEntry[];
};
