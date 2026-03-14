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
 * - freedom: Dynamic UCB1 allocation (high C). Tree shape is organic —
 *   promising nodes get more children, dead ends are abandoned early.
 *   Branching factor is a soft cap (direction count), not a target.
 * - constrained: Complete tree. Every node at each depth gets exactly
 *   directionCount children (4 for beats, 8 for cube) before going deeper.
 *   Branching factor is locked to the number of available directions.
 * - baseline: Unlimited children per node. Keep generating at each depth
 *   until a node meets the target score, then descend the optimal path
 *   and continue expanding until baseline is met again.
 */
export type SearchMode = 'freedom' | 'constrained' | 'baseline';

/** How the recommended path is selected after search completes */
export type PathStrategy = 'best_score' | 'most_explored';

/** How search termination is determined */
export type StopMode = 'timer' | 'iterations';

export type BeatDirection = 'escalate' | 'release' | 'surge' | 'rebound';

export type DirectionMode = 'cube' | 'beats';

export const BEAT_DIRECTIONS: Record<BeatDirection, { name: string; description: string; prompt: string }> = {
  escalate: {
    name: 'Escalate',
    description: 'Rising beats — each scene raises the stakes',
    prompt: `Structure this arc so each scene raises the stakes higher than the last.

- Let tensions build naturally: early scenes plant seeds and surface questions, later scenes force confrontations and hard choices
- Advance threads progressively — dormant tensions become active, active ones escalate toward crisis points
- Widen the circle of consequence: early scenes affect one or two characters, later scenes draw more people in
- Rotate who we see — bring characters back who've been absent, shift to locations we haven't visited recently
- Relationships should be tested and shifted: alliances strained, loyalties questioned, new bonds forged under pressure
- Do NOT resolve or close threads — leave them open and climbing at the arc's end`,
  },
  release: {
    name: 'Release',
    description: 'Falling beats — tension dissolves into stillness',
    prompt: `Structure this arc as a gradual exhale — the aftermath of intensity.

- No thread phase changes — the plot pauses while characters process what happened
- Keep the same small intimate group throughout; don't introduce new faces or unfamiliar settings
- Return to a familiar, recently-visited location — the comfort of known ground
- Characters reflect on what they already know rather than learning new things
- Relationship dynamics hold steady — no betrayals, no revelations, no valence shifts
- The arc should feel like the quiet after a storm: emotionally resonant but structurally still`,
  },
  surge: {
    name: 'Surge',
    description: 'Peak then fall — a single climactic moment',
    prompt: `Structure this arc around one explosive peak scene, bookended by restraint.

BUILD (early scenes):
- Slow accumulation of pressure: small thread advances, minor relationship tensions surfacing
- Narrow focus — few characters, familiar setting, intimate scale

PEAK (one defining scene):
- Everything converges: threads reach terminal phases, relationships undergo dramatic shifts
- The widest cast — bring in long-absent characters, shift to a location that hasn't been seen
- Multiple characters should learn critical new information simultaneously
- This scene should feel unmistakably like the turning point of the arc

AFTERMATH (final scenes):
- Immediate stillness: no thread changes, no new knowledge, no relationship shifts
- The same small group, the same familiar place — the world absorbing what just happened
- The sharp contrast between the peak and the quiet makes the climax land harder`,
  },
  rebound: {
    name: 'Rebound',
    description: 'Fall then rise — stillness gives way to momentum',
    prompt: `Structure this arc as a valley that builds into forward momentum.

OPENING (quiet scenes):
- Begin in stillness: no thread advancement, no new information, no relationship changes
- Familiar characters in a familiar place — the story at its lowest energy
- The same small group across these scenes, a sense of stasis or waiting

TURN (middle):
- Something shifts: a thread stirs, a character learns one crucial thing, someone unexpected appears
- The first crack in the stillness — subtle but unmistakable

RISE (late scenes):
- Threads begin advancing again, relationships are tested, characters discover new truths
- Widen the cast — bring in characters who've been absent, move to locations not recently visited
- End with clear upward momentum: threads open and escalating, the ensemble reshuffled, energy climbing`,
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
  branchingFactor: number;    // Max children per node (derived from mode: direction count for freedom/constrained, Infinity for baseline)
  worldBuildFocusId?: string; // Optional world build commit to seed all generations with
  northStarPrompt?: string;   // Optional high-level guidance that steers every generation in the search
};

export const DEFAULT_MCTS_CONFIG: MCTSConfig = {
  parallelism: 8,
  maxDepth: 5,
  maxNodes: 20,
  searchMode: 'freedom',
  pathStrategy: 'best_score',
  stopMode: 'timer',
  timeLimitSeconds: 60,
  baselineScore: 80,
  randomDirections: false,
  directionMode: 'beats',
  branchingFactor: 4,
};

/** Default branching factor per direction mode */
export const DEFAULT_BRANCHING: Record<DirectionMode, number> = {
  beats: 4,
  cube: 8,
};

/** UCB1 exploration constant per mode */
export const SEARCH_MODE_C: Record<SearchMode, number> = {
  freedom: 2.5,
  constrained: 0.5,
  baseline: 0.5,
};

// ── MCTS Run State ───────────────────────────────────────────────────────────

export type MCTSPhase =
  | 'selecting'
  | 'expanding'
  | 'scoring'
  | 'backpropagating';

export type MCTSStatus = 'idle' | 'running' | 'paused' | 'complete';

/** An in-flight LLM generation that hasn't resolved to a tree node yet */
export type PendingExpansion = {
  id: string;                          // unique slot key (e.g. "slot-0")
  parentId: MCTSNodeId | 'root';
  direction: string;
  cubeGoal: CubeCornerKey | null;
  beatGoal: BeatDirection | null;
  streamText: string;
  startedAt: number;
};

export type MCTSRunState = {
  status: MCTSStatus;
  tree: MCTSTree;
  config: MCTSConfig;
  iterationsCompleted: number;
  currentPhase: MCTSPhase | null;
  expandingNodeIds: MCTSNodeId[];       // All parent nodes with active expansions
  pendingExpansions: Record<string, PendingExpansion>; // In-flight LLM generations keyed by slot id
  selectedPath: MCTSNodeId[] | null;   // User's chosen path through tree
  bestPath: MCTSNodeId[] | null;       // Algorithm's recommended path
  startedAt: number | null;            // Date.now() when search began (for timer display)
  effectiveBaseline: number | null;    // Current baseline after stagnation relaxation (null = no relaxation)
};
