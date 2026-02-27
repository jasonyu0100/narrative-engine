import type { Scene, Arc, NarrativeState, CubeCornerKey } from './narrative';

// ── MCTS Node ────────────────────────────────────────────────────────────────

export type MCTSNodeId = string;

export type MCTSNode = {
  id: MCTSNodeId;
  parentId: MCTSNodeId | null;
  childIds: MCTSNodeId[];

  // Narrative payload (the generated arc)
  scenes: Scene[];
  arc: Arc;
  direction: string;
  cubeGoal: CubeCornerKey | null;
  beatGoal: BeatDirection | null;

  // Scoring
  immediateScore: number;   // gradeForces().overall for this arc (0-100)
  totalScore: number;       // Sum of backpropagated scores
  visitCount: number;       // Times selected/visited in MCTS

  // Virtual state snapshot (narrative state AFTER this arc is applied)
  virtualNarrative: NarrativeState;
  virtualResolvedKeys: string[];
  virtualCurrentIndex: number;

  // Metadata
  depth: number;            // 0 = root children, 1 = grandchildren, ...
  isExpanded: boolean;      // Has children been generated?
  createdAt: number;
};

// ── MCTS Tree ────────────────────────────────────────────────────────────────

export type MCTSTree = {
  nodes: Record<MCTSNodeId, MCTSNode>;
  // Root represents the current real narrative state (no arc of its own)
  rootNarrative: NarrativeState;
  rootResolvedKeys: string[];
  rootCurrentIndex: number;
  rootChildIds: MCTSNodeId[];
};

// ── MCTS Config ──────────────────────────────────────────────────────────────

/**
 * Search mode — determines how the tree is expanded.
 * - exploit: Low UCB1 C — focus on known-good branches
 * - explore: High UCB1 C — aggressively try new branches
 * - baseline: Layer-by-layer greedy — keep branching at each depth
 *   until a node meets the baseline score, then go deeper
 */
export type SearchMode = 'exploit' | 'explore' | 'baseline';

/** How the recommended path is selected after search completes */
export type PathStrategy = 'best_score' | 'most_explored';

/** How search termination is determined */
export type StopMode = 'timer' | 'iterations';

export type BeatDirection = 'escalate' | 'release' | 'surge' | 'rebound';

export type DirectionMode = 'cube' | 'beats';

export const BEAT_DIRECTIONS: Record<BeatDirection, { name: string; description: string; prompt: string }> = {
  escalate: {
    name: 'Escalate',
    description: 'Rising beats — each scene more mutative than the last',
    prompt: `Structure this arc so each scene is more mutative than the previous one. Specifically:
- Advance at least one thread to a new phase in each scene (dormant→active, active→escalating, etc.)
- Shift relationship valences between characters — new alliances forming, existing loyalties tested
- Spread mutations across more characters as the arc progresses: early scenes affect 1–2 characters, later scenes affect 3+
- Rotate the cast — bring in characters who have been absent from recent scenes
- Move to a location that has not been recently used
Do not resolve or close anything — leave threads open and escalating at the arc's end.`,
  },
  release: {
    name: 'Release',
    description: 'Falling beats — scenes settle, mutations thin out',
    prompt: `Structure this arc so scenes become progressively less mutative. Specifically:
- Do not advance any threads to new phases — leave all thread statuses unchanged
- Avoid relationship valence changes — no new alliances, no betrayals, no revelations
- Keep knowledge mutations minimal or absent — characters reflect on what they know, not learn new things
- Return to recently-seen characters and a familiar, recently-used location
- Keep the ensemble consistent across scenes — the same small group throughout
The arc should feel like aftermath: the dust settling after prior events.`,
  },
  surge: {
    name: 'Surge',
    description: 'Peak then fall — spike of mutations followed by stillness',
    prompt: `Structure this arc as a spike: rapid escalation to a single high-mutation scene, then immediate thinning. Specifically:
- Early scenes: accumulate pressure — small thread advances, minor relationship shifts
- Peak scene (middle or late): maximum mutation density — multiple thread phase transitions including terminal ones (resolved/failed/abandoned), large relationship valence swings (±0.5 or more), knowledge mutations hitting multiple characters simultaneously, new or long-absent characters present
- Post-peak scenes: immediate freeze — no thread mutations, no relationship changes, no new knowledge, return to familiar cast and location
The peak scene should stand out sharply from everything before and after it.`,
  },
  rebound: {
    name: 'Rebound',
    description: 'Fall then rise — stillness giving way to escalating mutations',
    prompt: `Structure this arc as a valley: open in stillness, hold at a low point, then climb back with increasing mutation density. Specifically:
- Opening scenes: freeze — no thread mutations, no relationship changes, no new knowledge, familiar cast and recently-visited location
- Trough scene: minimum mutation density — characters present but nothing changes between them
- Late scenes: rapid escalation — thread phase transitions resume, relationship valences shift, knowledge mutations spread across multiple characters, new or returning-after-absence cast members introduced
The arc should end with clear upward momentum — threads open and advancing, not resolved.`,
  },
};

export type MCTSConfig = {
  parallelism: number;        // Max concurrent generation slots in sliding window
  maxDepth: number;           // Max tree depth (1-10, default 5)
  maxNodes: number;           // Max total nodes (LLM calls) in iterations mode
  searchMode: SearchMode;     // How the tree is expanded
  pathStrategy: PathStrategy; // How to pick the recommended path
  stopMode: StopMode;         // What determines when search ends
  timeLimitSeconds: number;   // Time budget for search (timer mode)
  baselineScore: number;      // Target score per layer (baseline mode)
  randomDirections: boolean;  // If true, pick next cube corner randomly (ignores mode-based ordering)
  directionMode: DirectionMode; // Whether to use cube corners or engagement arc directions
  worldBuildFocusId?: string; // Optional world build commit to seed all generations with
};

export const DEFAULT_MCTS_CONFIG: MCTSConfig = {
  parallelism: 4,
  maxDepth: 5,
  maxNodes: 20,
  searchMode: 'exploit',
  pathStrategy: 'best_score',
  stopMode: 'timer',
  timeLimitSeconds: 60,
  baselineScore: 80,
  randomDirections: false,
  directionMode: 'beats',
};

/** UCB1 exploration constant per mode (baseline uses exploit-level C) */
export const SEARCH_MODE_C: Record<SearchMode, number> = {
  exploit: 0.5,
  explore: 2.5,
  baseline: 0.5,
};

// ── MCTS Run State ───────────────────────────────────────────────────────────

export type MCTSPhase =
  | 'selecting'
  | 'expanding'
  | 'scoring'
  | 'backpropagating';

export type MCTSStatus = 'idle' | 'running' | 'paused' | 'complete';

export type MCTSRunState = {
  status: MCTSStatus;
  tree: MCTSTree;
  config: MCTSConfig;
  iterationsCompleted: number;
  currentPhase: MCTSPhase | null;
  expandingNodeId: MCTSNodeId | null;
  selectedPath: MCTSNodeId[] | null;   // User's chosen path through tree
  bestPath: MCTSNodeId[] | null;       // Algorithm's recommended path
  startedAt: number | null;            // Date.now() when search began (for timer display)
  effectiveBaseline: number | null;    // Current baseline after stagnation relaxation (null = no relaxation)
};
