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

export type ThreadParticipant = {
  id: string;
  type: 'character' | 'location';
};

export type Thread = {
  id: string;
  participants: ThreadParticipant[];
  description: string;
  status: ThreadStatus;
  openedAt: string;
  dependents: string[];
};

// ── Character ────────────────────────────────────────────────────────────────
export type CharacterRole = 'anchor' | 'recurring' | 'transient';

export type ContinuityNodeType = string;

export type ContinuityNode = {
  id: string;
  type: ContinuityNodeType;
  content: string;
};

export type Continuity = {
  nodes: ContinuityNode[];
};

export type Character = {
  id: string;
  name: string;
  role: CharacterRole;
  continuity: Continuity;
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
  continuity: Continuity;
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

// ── Artifact ────────────────────────────────────────────────────────────────
export type ArtifactSignificance = 'key' | 'notable' | 'minor';

export type Artifact = {
  id: string;
  name: string;
  /** Narrative weight: key artifacts alter plots, notable ones recur, minor ones are set dressing */
  significance: ArtifactSignificance;
  /** Continuity graph — what is known about this artifact (lore, history, properties, state changes) */
  continuity: Continuity;
  /** Current owner — a character or location ID (like Location.parentId) */
  parentId: string;
  imagePrompt?: string;
  imageUrl?: string;
};

export type OwnershipMutation = {
  artifactId: string;
  fromId: string;
  toId: string;
};

// ── Scene & Arc ─────────────────────────────────────────────────────────────
export type ThreadMutation = {
  threadId: string;
  from: string;
  to: string;
};

export type ContinuityMutation = {
  characterId: string;
  nodeId: string;
  action: 'added' | 'removed';
  content: string;
  /** LLM-suggested type describing this specific continuity (e.g. "tactical_insight", "betrayal_discovered") */
  nodeType?: string;
};

export type RelationshipMutation = {
  from: string;
  to: string;
  type: string;
  valenceDelta: number;
};

// ── World Knowledge Graph ───────────────────────────────────────────────────

/** Node types define the abstraction level of world knowledge:
 *  - law: A governing truth — something always true in this world. Creates consistency.
 *  - system: An organized process, institution, or mechanism. Creates reality.
 *  - concept: A named abstract idea, phenomenon, or category. Creates richness.
 *  - tension: A contradiction or unresolved force in the world's logic. Creates life. */
export type WorldKnowledgeNodeType = 'law' | 'system' | 'concept' | 'tension';

export type WorldKnowledgeNode = {
  id: string;
  concept: string;
  type: WorldKnowledgeNodeType;
};

export type WorldKnowledgeEdge = {
  from: string;
  to: string;
  relation: string;
};

export type WorldKnowledgeGraph = {
  nodes: Record<string, WorldKnowledgeNode>;
  edges: WorldKnowledgeEdge[];
};

export type WorldKnowledgeMutation = {
  addedNodes: { id: string; concept: string; type: WorldKnowledgeNodeType }[];
  addedEdges: { from: string; to: string; relation: string }[];
};

/** Force values are z-score normalized (mean = 0, units = standard deviations).
 *  0 = average moment, positive = above average, negative = below average.
 *  - payoff:  thread phase transitions (weighted by jump magnitude) + relationship valence deltas
 *  - change:  mutation reach (log₂ depth per character, includes events)
 *  - knowledge: world knowledge graph complexity delta (new nodes + new edges per scene)
 */
export type ForceSnapshot = {
  payoff: number;
  change: number;
  knowledge: number;
};

// ── Narrative Cube (Payoff · Change · Knowledge) ────────────────────────────
// The three forces (P·C·K) define a cube. Each corner is a recognisable narrative state.
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
    name: 'Epoch',
    description: 'Everything converges — threads resolve, characters transform, and the world\'s rules expand. A defining moment that reshapes the narrative landscape.',
    forces: { payoff: 1, change: 1, knowledge: 1 },
  },
  HHL: {
    key: 'HHL',
    name: 'Climax',
    description: 'Threads resolve and characters transform within established world rules. The payoff of what\'s already been built — no new lore needed.',
    forces: { payoff: 1, change: 1, knowledge: -1 },
  },
  HLH: {
    key: 'HLH',
    name: 'Revelation',
    description: 'Threads pay off through world-building. The world\'s rules explain why things happened — lore unlocks resolution without personal transformation.',
    forces: { payoff: 1, change: -1, knowledge: 1 },
  },
  HLL: {
    key: 'HLL',
    name: 'Closure',
    description: 'Quiet resolution within established world rules. Tying up loose ends — conversations that needed to happen, debts paid, promises kept or broken.',
    forces: { payoff: 1, change: -1, knowledge: -1 },
  },
  LHH: {
    key: 'LHH',
    name: 'Discovery',
    description: 'Characters transform through encountering new world systems. No threads resolve — pure exploration, world-building, and possibility.',
    forces: { payoff: -1, change: 1, knowledge: 1 },
  },
  LHL: {
    key: 'LHL',
    name: 'Growth',
    description: 'Internal character development within established world rules. Characters train, bond, argue, and change through interaction — no new lore.',
    forces: { payoff: -1, change: 1, knowledge: -1 },
  },
  LLH: {
    key: 'LLH',
    name: 'Lore',
    description: 'Pure world-building without resolution or transformation. Establishing rules, systems, cultures, and connections for future payoff. Seeds planted in the world\'s structure.',
    forces: { payoff: -1, change: -1, knowledge: 1 },
  },
  LLL: {
    key: 'LLL',
    name: 'Rest',
    description: 'Nothing resolves, no one transforms, no new world concepts. Recovery and breathing room — quiet character deliveries and seed-planting.',
    forces: { payoff: -1, change: -1, knowledge: -1 },
  },
};

export type ExpansionManifest = {
  characters: Character[];
  locations: Location[];
  threads: Thread[];
  relationships: RelationshipEdge[];
  worldKnowledge: WorldKnowledgeMutation;
  artifacts?: Artifact[];
};

export type ProseScore = {
  overall: number;
  voice: number;
  pacing: number;
  dialogue: number;
  sensory: number;
  mutationCoverage: number;
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
  continuityMutations: ContinuityMutation[];
  relationshipMutations: RelationshipMutation[];
  /** World knowledge graph mutations — new concepts and connections about how the world works */
  worldKnowledgeMutations?: WorldKnowledgeMutation;
  /** Artifact ownership changes — objects changing hands between characters/locations */
  ownershipMutations?: OwnershipMutation[];
  /** Delivery-by-delivery scene blueprint — generated before prose to detail HOW mutations unfold */
  plan?: string;
  prose?: string;
  /** Prose quality score from the last rewrite pass */
  proseScore?: ProseScore;
  summary: string;
  imageUrl?: string;
  /** When true, alignment and fix operations skip this scene */
  locked?: boolean;
};

export type WorldBuild = {
  kind: 'world_build';
  id: string;
  summary: string;
  expansionManifest: ExpansionManifest;
};

// ── Alignment ────────────────────────────────────────────────────────────────

export type AlignmentCategory =
  | 'character-state'    // character knows/has/feels something contradicted by another scene
  | 'voice-drift'        // tone, style, or POV discipline shifts between scenes
  | 'timeline'           // temporal impossibilities or inconsistent passage of time
  | 'spatial'            // character in wrong place, impossible movement
  | 'thread-continuity'  // thread status or plot point contradicted across scenes
  | 'tone-shift'         // abrupt unearned mood change between consecutive scenes
  | 'missing-transition' // character arrives/departs/changes state with no connective tissue between scenes
  | 'state-reset'        // injury, emotion, exhaustion, or consequence from a prior scene is silently dropped
  | 'knowledge-leak'     // character acts on information they haven't received yet in the prose
  | 'proximity'          // characters share a scene but prose doesn't establish their spatial relationship
  | 'repetition';        // same beat, reveal, description, or emotional realization happens in multiple scenes

export type AlignmentSeverity = 'minor' | 'moderate' | 'major';

export type AlignmentIssue = {
  id: string;
  category: AlignmentCategory;
  severity: AlignmentSeverity;
  /** Scene IDs involved in this issue (at least 2 — the contradiction pair) */
  sceneIds: string[];
  /** One-line summary of the inconsistency */
  summary: string;
  /** Detailed explanation with quotes from the prose */
  detail: string;
  /** Suggested fix direction (fed as analysis to rewriteSceneProse) */
  fix: string;
  /** How many overlapping windows flagged this same issue (higher = more confident) */
  confidence: number;
};

export type AlignmentReport = {
  id: string;
  createdAt: string;
  /** Window config used */
  windowSize: number;
  stride: number;
  /** Scene range audited */
  sceneIds: string[];
  issues: AlignmentIssue[];
};

/** One scene's entry in a chronological continuity plan.
 *  Created by synthesizing raw alignment issues into ordered, non-conflicting edits. */
export type ContinuityEdit = {
  sceneId: string;
  /** Ordered list of issue IDs this edit resolves */
  issueIds: string[];
  /** Full rewrite analysis — what to change and why, accounting for earlier edits in the sequence */
  analysis: string;
};

/** Chronologically-ordered edit plan produced from raw alignment issues.
 *  Each edit is aware of earlier edits so fixes don't contradict each other. */
export type ContinuityPlan = {
  id: string;
  alignmentReportId: string;
  /** Edits in chronological scene order — earlier edits are applied first */
  edits: ContinuityEdit[];
};

/** A timeline entry is either a narrative scene or a world build */
export type TimelineEntry = Scene | WorldBuild;

export function isScene(entry: TimelineEntry): entry is Scene {
  return entry.kind === 'scene';
}

export function isWorldBuild(entry: TimelineEntry): entry is WorldBuild {
  return entry.kind === 'world_build';
}

export type Arc = {
  id: string;
  name: string;
  sceneIds: string[];
  develops: string[];
  /** Locations this arc focuses on — determines the spatial graph shown */
  locationIds: string[];
  /** Characters active in this arc — determined by location + thread participants */
  activeCharacterIds: string[];
  /** Starting positions — characterId → locationId. Established at arc start. */
  initialCharacterLocations: Record<string, string>;
  /** Short sentence summarising the narrative direction of this arc */
  directionVector?: string;
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
  /** Branch-scoped planning queue (optional — absent means no planning layer) */
  planningQueue?: PlanningQueue;
  createdAt: number;
};

// ── Narrative State ──────────────────────────────────────────────────────────

export type NarrativeState = {
  id: string;
  title: string;
  description: string;
  /** Derived cache — recomputed from world-build manifests + scene mutations via resolvedEntryKeys */
  characters: Record<string, Character>;
  /** Derived cache — recomputed from world-build manifests + scene mutations via resolvedEntryKeys */
  locations: Record<string, Location>;
  /** Derived cache — recomputed from world-build manifests + scene mutations via resolvedEntryKeys */
  threads: Record<string, Thread>;
  /** Derived cache — recomputed from world-build manifests + scene ownership mutations */
  artifacts: Record<string, Artifact>;
  arcs: Record<string, Arc>;
  scenes: Record<string, Scene>;
  worldBuilds: Record<string, WorldBuild>;
  branches: Record<string, Branch>;
  /** Derived cache — recomputed from world-build manifests + scene mutations via resolvedEntryKeys */
  relationships: RelationshipEdge[];
  /** Derived cache — cumulative world knowledge graph built from world-build manifests + scene mutations */
  worldKnowledge: WorldKnowledgeGraph;
  worldSummary: string;
  /** World rules / commandments that the narrative must follow */
  rules: string[];
  coverImageUrl?: string;
  /** Style directive appended to all image generation prompts for visual consistency */
  imageStyle?: string;
  /** Story-level settings that guide generation (POV, tone, pacing, etc.) */
  storySettings?: StorySettings;
  /** Chat threads keyed by thread ID — persisted with the narrative */
  chatThreads?: Record<string, ChatThread>;
  /** Notes keyed by note ID — persisted with the narrative */
  notes?: Record<string, Note>;
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
  /** Narrative shape classification key */
  shapeKey?: string;
  /** Narrative shape name for display */
  shapeName?: string;
  /** Narrative shape curve points [x,y] normalised 0-1 */
  shapeCurve?: [number, number][];
  /** Narrative archetype classification key */
  archetypeKey?: string;
  /** Narrative archetype name for display */
  archetypeName?: string;
  /** Overall force grade (0-100) */
  overallScore?: number;
};

// ── Story Settings ──────────────────────────────────────────────────────────

/** How many POV characters drive the narrative */
export type POVMode = 'single' | 'ensemble' | 'free';

/** Which world commit to seed generations with */
export type WorldFocusMode = 'latest' | 'custom' | 'none';

export type StorySettings = {
  /** How POV is distributed across the story */
  povMode: POVMode;
  /** Character IDs designated as POV characters (empty = use all anchors) */
  povCharacterIds: string[];
  /** High-level story direction / north star prompt */
  storyDirection: string;
  /** Negative prompt — things the AI should avoid */
  storyConstraints: string;
  /** Target arc length in scenes */
  targetArcLength: number;
  /** Markov chain rhythm preset key (from MATRIX_PRESETS) */
  rhythmPreset: string;
  /** Prose voice/style the AI should mimic when writing */
  proseVoice: string;
  /** Guidance for how scene plans should be structured */
  planGuidance: string;
  /** How many recent scenes the LLM sees when building context (time horizon) */
  branchTimeHorizon: number;
  /** Optional custom prompt for cover image generation */
  coverPrompt: string;
  /** World focus mode — which world commit to seed generations with */
  worldFocus: WorldFocusMode;
  /** Specific WorldBuild ID when worldFocus is 'custom' */
  worldFocusId?: string;
};

export const BRANCH_TIME_HORIZON_OPTIONS = [25, 50, 100, 200] as const;

export const DEFAULT_STORY_SETTINGS: StorySettings = {
  povMode: 'free',
  povCharacterIds: [],
  storyDirection: '',
  storyConstraints: '',
  targetArcLength: 5,
  rhythmPreset: '',
  proseVoice: '',
  planGuidance: '',
  branchTimeHorizon: 50,
  coverPrompt: '',
  worldFocus: 'none',
};

// ── Planning Queue ──────────────────────────────────────────────────────────

/** Completion status of a planning phase */
export type PlanningPhaseStatus = 'pending' | 'active' | 'completed';

/** A single phase in the planning queue — an allocated block of scenes with objectives */
export type PlanningPhase = {
  id: string;
  /** Display name (e.g. "Call to Adventure", "Ordeal") */
  name: string;
  /** What this phase should achieve */
  objective: string;
  /** Number of scenes allocated to this phase */
  sceneAllocation: number;
  /** Number of scenes generated so far in this phase */
  scenesCompleted: number;
  /** Current status */
  status: PlanningPhaseStatus;
  /** Phase-specific constraint overrides (empty = use story settings) */
  constraints: string;
  /** AI-generated direction for this phase (set when phase becomes active) */
  direction: string;
  /** AI-generated completion report when phase finishes */
  completionReport?: string;
  /** World build ID created during transition into this phase */
  worldBuildId?: string;
  /** Hints for world expansion when transitioning into this phase */
  worldExpansionHints: string;
};

/** A named superstructure template that populates the queue */
export type PlanningProfile = {
  id: string;
  name: string;
  description: string;
  /** 'complete' for self-contained stories, 'episodic' for series volumes */
  category: 'complete' | 'episodic';
  /** Whether this is a built-in archetype or user-created */
  builtIn: boolean;
  /** Phase templates — no runtime state, just the blueprint */
  phases: {
    name: string;
    objective: string;
    sceneAllocation: number;
    constraints: string;
    worldExpansionHints: string;
  }[];
};

/** Branch-scoped planning queue */
export type PlanningQueue = {
  /** The profile that populated this queue (null if manually built) */
  profileId: string | null;
  /** Ordered list of phases */
  phases: PlanningPhase[];
  /** Index of the currently active phase (-1 if none active yet) */
  activePhaseIndex: number;
};

// ── Auto Mode ───────────────────────────────────────────────────────────────

export type AutoEndCondition =
  | { type: 'scene_count'; target: number }
  | { type: 'all_threads_resolved' }
  | { type: 'arc_count'; target: number }
  | { type: 'planning_complete' }
  | { type: 'manual_stop' };

/** Auto actions map directly to the 8 narrative cube corners */
export type AutoAction = CubeCornerKey;

export type AutoActionWeight = {
  action: AutoAction;
  score: number;
  reason: string;
};

export type AutoConfig = {
  endConditions: AutoEndCondition[];
  minArcLength: number;
  maxArcLength: number;
  maxActiveThreads: number;
  threadStagnationThreshold: number;
  /** High-level north star that steers every arc */
  northStarPrompt: string;
  toneGuidance: string;
  /** Constraints prompt — defaults from StorySettings.storyConstraints, overridable here */
  narrativeConstraints: string;
  characterRotationEnabled: boolean;
  minScenesBetweenCharacterFocus: number;
};

export type AutoRunLog = {
  cycle: number;
  timestamp: number;
  action: AutoAction;
  reason: string;
  scenesGenerated: number;
  worldExpanded: boolean;
  endConditionMet: AutoEndCondition | null;
  /** Human-readable details for debugging */
  arcName?: string;
  /** Phase name if planning queue is active */
  phaseName?: string;
  phaseProgress?: string;
  /** Direction and constraints used for this cycle */
  direction?: string;
  constraints?: string;
  /** Course correction output (if refreshDirection ran) */
  courseCorrection?: { direction: string; constraints: string };
  /** Error message if something failed */
  error?: string;
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
  /** AI model used for this call */
  model?: string;
  status: 'pending' | 'success' | 'error';
  durationMs: number | null;
  promptTokens: number;
  responseTokens: number | null;
  error: string | null;
  /** Truncated prompt preview */
  promptPreview: string;
  /** Truncated response preview */
  responsePreview: string | null;
};

// ── Text Analysis ────────────────────────────────────────────────────────────

export type AnalysisChunkResult = {
  chapterSummary: string;
  characters: { name: string; role: string; firstAppearance: boolean; imagePrompt?: string; continuity: { type: string; content: string }[] }[];
  locations: { name: string; parentName: string | null; description: string; imagePrompt?: string; lore: string[] }[];
  artifacts?: { name: string; significance: string; continuity: { type: string; content: string }[]; ownerName: string }[];
  threads: { description: string; participantNames: string[]; statusAtStart: string; statusAtEnd: string; development: string }[];
  scenes: {
    locationName: string; povName: string; participantNames: string[]; events: string[];
    summary: string; sections: number[]; prose?: string;
    threadMutations: { threadDescription: string; from: string; to: string }[];
    continuityMutations: { characterName: string; action: string; content: string; type: string }[];
    relationshipMutations: { from: string; to: string; type: string; valenceDelta: number }[];
    ownershipMutations?: { artifactName: string; fromName: string; toName: string }[];
    characterMovements?: { characterName: string; locationName: string; transition: string }[];
    worldKnowledgeMutations?: {
      addedNodes: { concept: string; type: string }[];
      addedEdges: { fromConcept: string; toConcept: string; relation: string }[];
    };
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
  | { type: 'arc'; arcId: string }
  | { type: 'knowledge'; nodeId: string }
  | { type: 'artifact'; artifactId: string };

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

export type ThreadSketch = {
  description: string;
  participantNames: string[];
};

export type WizardData = {
  title: string;
  premise: string;
  characters: CharacterSketch[];
  locations: LocationSketch[];
  threads: ThreadSketch[];
  rules: string[];
};

export type GraphViewMode = 'spatial' | 'overview' | 'prose' | 'spark' | 'codex';

// ── Chat Threads ──────────────────────────────────────────────────────────────
export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ChatThread = {
  id: string;
  name: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

// ── Notes ─────────────────────────────────────────────────────────────────────
export type Note = {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type AppState = {
  narratives: NarrativeEntry[];
  activeNarrativeId: string | null;
  activeNarrative: NarrativeState | null;
  isPlaying: boolean;
  currentSceneIndex: number;
  activeBranchId: string | null;
  /** Ordered timeline entry IDs (scenes + world builds) for the active branch, resolved across parent branches */
  resolvedEntryKeys: string[];
  inspectorContext: InspectorContext | null;
  wizardOpen: boolean;
  wizardStep: WizardStep;
  wizardData: WizardData;
  selectedKnowledgeEntity: string | null;
  graphViewMode: GraphViewMode;
  autoConfig: AutoConfig;
  autoRunState: AutoRunState | null;
  apiLogs: ApiLogEntry[];
  analysisJobs: AnalysisJob[];
  activeChatThreadId: string | null;
  activeNoteId: string | null;
};
