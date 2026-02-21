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

export type MCTSConfig = {
  branchingFactor: number;      // Initial children per expansion (default 5)
  maxDepth: number;             // Max tree depth (1-10, default 5)
  totalIterations: number;      // Iteration cap (iterations mode)
  searchMode: SearchMode;       // How the tree is expanded
  pathStrategy: PathStrategy;   // How to pick the recommended path
  stopMode: StopMode;           // What determines when search ends
  timeLimitSeconds: number;     // Time budget for search (timer mode)
  baselineScore: number;        // Target score per layer (baseline mode)
};

export const DEFAULT_MCTS_CONFIG: MCTSConfig = {
  branchingFactor: 5,
  maxDepth: 5,
  totalIterations: 5,
  searchMode: 'exploit',
  pathStrategy: 'best_score',
  stopMode: 'timer',
  timeLimitSeconds: 60,
  baselineScore: 80,
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
