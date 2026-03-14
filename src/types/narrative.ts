// ── Thread ───────────────────────────────────────────────────────────────────
export type ThreadStatus = string;

// Canonical thread status vocabulary — single source of truth.
// Active: dormant → active → escalating → critical. Terminal ends a thread.
export const THREAD_ACTIVE_STATUSES = ['dormant', 'active', 'escalating', 'critical'] as const;
export const THREAD_TERMINAL_STATUSES = ['resolved', 'subverted', 'abandoned'] as const;
export const THREAD_PRIMED_STATUSES = ['critical'] as const;

export const THREAD_STATUS_LABELS: Record<string, string> = {
  resolved: 'concluded or ran its course',
  subverted: 'upended, inverted, or twisted',
  abandoned: 'faded without resolution',
};

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

export type KnowledgeNode = {
  id: string;
  type: KnowledgeNodeType;
  content: string;
};

export type KnowledgeGraph = {
  nodes: KnowledgeNode[];
};

export type Character = {
  id: string;
  name: string;
  role: CharacterRole;
  knowledge: KnowledgeGraph;
  threadIds: string[];
  /** AI-generated visual description used as image prompt seed */
  imagePrompt?: string;
  imageUrl?: string;
};

// ── Location ─────────────────────────────────────────────────────────────────
export type Location = {
  id: string;
  name: string;
  parentId: string | null;
  threadIds: string[];
  knowledge: KnowledgeGraph;
  /** AI-generated visual description used as image prompt seed */
  imagePrompt?: string;
  imageUrl?: string;
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

/** Force values are z-score normalized (mean = 0, units = standard deviations).
 *  0 = average moment, positive = above average, negative = below average.
 *  - payoff:  thread phase transitions (weighted by jump magnitude) + relationship valence deltas
 *  - change:  mutation reach (log₂ depth per character) + knowledge turbulence (fraction of cast affected, scaled by cast size)
 *  - variety: how novel the cast/setting is — computed from character/location usage frequency + compositional novelty
 */
export type ForceSnapshot = {
  payoff: number;
  change: number;
  variety: number;
};

// ── Narrative Cube (Payoff · Change · Variety) ──────────────────────────────
// The three forces (P·C·V) define a cube. Each corner is a recognisable narrative state.
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
    name: 'Convergence',
    description: 'Thread phases advance, many characters gain knowledge and shift relationships, with fresh cast and setting. Maximum narrative density.',
    forces: { payoff: 1, change: 1, variety: 1 },
  },
  HHL: {
    key: 'HHL',
    name: 'Climax',
    description: 'Thread phases advance and characters transform through knowledge and relationship shifts, but with the established cast and familiar setting.',
    forces: { payoff: 1, change: 1, variety: -1 },
  },
  HLH: {
    key: 'HLH',
    name: 'Reveal',
    description: 'Thread phases advance in new territory with unfamiliar faces, but few characters are personally affected. A landscape-shifting revelation.',
    forces: { payoff: 1, change: -1, variety: 1 },
  },
  HLL: {
    key: 'HLL',
    name: 'Closure',
    description: 'Thread phases advance quietly with the familiar cast, few personal transformations. Tying up loose ends in known territory.',
    forces: { payoff: 1, change: -1, variety: -1 },
  },
  LHH: {
    key: 'LHH',
    name: 'Discovery',
    description: 'No thread advancement, but many characters gain new knowledge and shift relationships in unfamiliar territory. Exploration and world-building.',
    forces: { payoff: -1, change: 1, variety: 1 },
  },
  LHL: {
    key: 'LHL',
    name: 'Growth',
    description: 'No thread advancement, but characters transform through knowledge and relationship shifts with the established cast. Internal development.',
    forces: { payoff: -1, change: 1, variety: -1 },
  },
  LLH: {
    key: 'LLH',
    name: 'Wandering',
    description: 'No thread advancement, few personal changes, but new faces and unfamiliar places. Transitional — drifting through uncharted territory.',
    forces: { payoff: -1, change: -1, variety: 1 },
  },
  LLL: {
    key: 'LLL',
    name: 'Rest',
    description: 'No thread advancement, no character transformation, familiar cast and setting. Recovery and seed-planting — breathing room.',
    forces: { payoff: -1, change: -1, variety: -1 },
  },
};

export type ExpansionManifest = {
  characterIds: string[];
  locationIds: string[];
  threadIds: string[];
  relationshipCount: number;
};

export type ProseScore = {
  overall: number;
  voice: number;
  pacing: number;
  dialogue: number;
  sensory: number;
  mutation_coverage: number;
  /** Per-dimension critique notes from the grading pass */
  critique?: string;
};

export type CharacterMovement = {
  locationId: string;
  /** Descriptive transition narrating how the character moved, e.g. "Rode horseback through the night to Bree" */
  transition: string;
};

export type Scene = {
  kind: 'scene';
  id: string;
  arcId: string;
  locationId: string;
  /** Character whose perspective this scene is told from */
  povId: string;
  participantIds: string[];
  /** Characters who move in this scene — characterId → movement details. Only include deltas. */
  characterMovements?: Record<string, CharacterMovement>;
  events: string[];
  threadMutations: ThreadMutation[];
  knowledgeMutations: KnowledgeMutation[];
  relationshipMutations: RelationshipMutation[];
  /** Beat-by-beat scene blueprint — generated before prose to detail HOW mutations unfold */
  plan?: string;
  prose?: string;
  /** Prose quality score from the last rewrite pass */
  proseScore?: ProseScore;
  summary: string;
  imageUrl?: string;
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
  /** World rules / commandments that the narrative must follow */
  rules: string[];
  controlMode: ControlMode;
  activeForces: ForceSnapshot;
  coverImageUrl?: string;
  /** Style directive appended to all image generation prompts for visual consistency */
  imageStyle?: string;
  /** Story-level settings that guide generation (POV, tone, pacing, etc.) */
  storySettings?: StorySettings;
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

// ── Story Settings ──────────────────────────────────────────────────────────

/** How many POV characters drive the narrative */
export type POVMode = 'single' | 'dual' | 'ensemble' | 'free';

export type StorySettings = {
  /** How POV is distributed across the story */
  povMode: POVMode;
  /** Character IDs designated as POV characters (empty = use all anchors) */
  povCharacterIds: string[];
  /** High-level story direction / north star prompt */
  storyDirection: string;
  /** Target arc length in scenes */
  targetArcLength: number;
  /** Prose voice/style the AI should mimic when writing */
  proseVoice: string;
  /** Guidance for how scene plans should be structured */
  planGuidance: string;
};

export const DEFAULT_STORY_SETTINGS: StorySettings = {
  povMode: 'free',
  povCharacterIds: [],
  storyDirection: '',
  targetArcLength: 4,
  proseVoice: '',
  planGuidance: '',
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
  /** How large each world-building expansion is */
  worldBuildSize: 'small' | 'medium' | 'large';
  maxActiveThreads: number;
  threadStagnationThreshold: number;
  /** High-level north star that steers every arc */
  northStarPrompt: string;
  toneGuidance: string;
  narrativeConstraints: string;
  characterRotationEnabled: boolean;
  minScenesBetweenCharacterFocus: number;
  /** When true, auto mode must use latest world-building elements in new arcs */
  enforceWorldBuildUsage: boolean;
  /** When true, auto mode generates prose for each scene after structural generation */
  includeProse: boolean;
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

// ── Text Analysis ────────────────────────────────────────────────────────────

export type AnalysisChunkResult = {
  chapterSummary: string;
  characters: { name: string; role: string; firstAppearance: boolean; imagePrompt?: string; knowledge: { type: string; content: string }[] }[];
  locations: { name: string; parentName: string | null; description: string; imagePrompt?: string; lore: string[] }[];
  threads: { description: string; anchorNames: string[]; statusAtStart: string; statusAtEnd: string; development: string }[];
  scenes: {
    locationName: string; povName: string; participantNames: string[]; events: string[];
    summary: string; sections: number[]; prose?: string;
    threadMutations: { threadDescription: string; from: string; to: string }[];
    knowledgeMutations: { characterName: string; action: string; content: string; type: string }[];
    relationshipMutations: { from: string; to: string; type: string; valenceDelta: number }[];
    characterMovements?: { characterName: string; locationName: string; transition: string }[];
  }[];
  relationships: { from: string; to: string; type: string; valence: number }[];
};

export type AnalysisJob = {
  id: string;
  title: string;
  sourceText: string;
  /** Text split into numbered sections */
  chunks: { index: number; text: string; sectionCount: number }[];
  /** Results per chunk (same indices as chunks) */
  results: (AnalysisChunkResult | null)[];
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  currentChunkIndex: number;
  error?: string;
  /** The assembled narrative ID once complete */
  narrativeId?: string;
  createdAt: number;
  updatedAt: number;
};

// ── App State ────────────────────────────────────────────────────────────────
export type InspectorContext =
  | { type: 'scene'; sceneId: string }
  | { type: 'character'; characterId: string }
  | { type: 'location'; locationId: string }
  | { type: 'thread'; threadId: string }
  | { type: 'arc'; arcId: string };

export type WizardStep = 'form' | 'details' | 'generate';

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
  characters: CharacterSketch[];
  locations: LocationSketch[];
  rules: string[];
};

export type GraphViewMode = 'scene' | 'overview' | 'prose';

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
  wizardData: WizardData;
  selectedKnowledgeEntity: string | null;
  autoTimer: number;
  graphViewMode: GraphViewMode;
  autoConfig: AutoConfig;
  autoRunState: AutoRunState | null;
  apiLogs: ApiLogEntry[];
  analysisJobs: AnalysisJob[];
};
