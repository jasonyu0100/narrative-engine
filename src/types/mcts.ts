import type { Scene, Arc, NarrativeState, CubeCornerKey } from './narrative';

// ── MCTS Node ────────────────────────────────────────────────────────────────

export type MCTSNodeId = string;

export type MoveType = 'arc' | 'scene';

export type MCTSNode = {
  id: MCTSNodeId;
  parentId: MCTSNodeId | null;
  childIds: MCTSNodeId[];

  // Move type
  moveType: MoveType;       // 'arc' = multi-scene arc, 'scene' = single scene

  // Narrative payload (the generated arc)
  scenes: Scene[];
  arc: Arc;
  direction: string;
  cubeGoal: CubeCornerKey | null;
  deliveryGoal: DeliveryDirection | null;

  // Scoring
  immediateScore: number;   // gradeForces().overall for this arc/scene (0-100)
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
 *   directionCount children (4 for delivery, 8 for cube) before going deeper.
 *   Branching factor is locked to the number of available directions.
 * - baseline: Unlimited children per node. Keep generating at each depth
 *   until a node meets the target score, then descend the optimal path
 *   and continue expanding until baseline is met again.
 * - greedy: DFS depth-first. Generate branchingFactor children at the current
 *   frontier, pick the best, descend immediately, repeat. Maximises depth
 *   by always expanding the highest-scoring leaf. All workers target the
 *   same parent for fast parallel evaluation at each level.
 */
export type SearchMode = 'freedom' | 'constrained' | 'baseline' | 'greedy';

/** How the recommended path is selected after search completes */
export type PathStrategy = 'best_score' | 'most_explored';

/** How search termination is determined */
export type StopMode = 'timer' | 'iterations';

export type DeliveryDirection = 'escalate' | 'release' | 'surge' | 'rebound';

export type DirectionMode = 'cube' | 'delivery';

export const DELIVERY_DIRECTIONS: Record<DeliveryDirection, { name: string; description: string; prompt: string }> = {
  escalate: {
    name: 'Escalate',
    description: 'Rising deliveries — each scene raises the stakes',
    prompt: `Structure this arc so each scene raises the stakes higher than the last.
- THREADS: Advance progressively — latent→seeded, seeded→active, active→critical. Each scene pushes at least one thread forward. Widen the circle of consequence across scenes.
- RELATIONSHIPS: Test alliances and loyalties — shifts of ±0.2 to ±0.3 as pressure mounts. Knowledge asymmetries deepen between characters.
- WORLD: Reveal concepts that raise stakes — rules that constrain, systems that threaten, tensions with no easy resolution. 2+ nodes per scene connecting to existing graph.
- Maintain POV streaks (2-4 scenes per perspective).`,
  },
  release: {
    name: 'Release',
    description: 'Falling deliveries — tension dissolves into processing',
    prompt: `Structure this arc as a gradual exhale — the aftermath of intensity.
- THREADS: Pulse at current status rather than advancing — but every scene MUST still touch 2-3 threads. Use same→same pulses (0.25 each) to show threads simmering.
- RELATIONSHIPS: Subtle recalibration — characters process what happened THROUGH each other. Shifts of ±0.1 to ±0.2 as bonds deepen or strain reveals itself quietly.
- CONTINUITY: Characters reflect and notice things they missed during intensity — 2-3 continuity mutations per scene. Realisations, not revelations.
- WORLD: The world's quieter systems emerge — domestic customs, social rituals, environmental rhythms. 1-2 WK nodes per scene showing the world at rest.
- Stay with one POV in familiar settings.`,
  },
  surge: {
    name: 'Surge',
    description: 'Peak then fall — a single climactic moment',
    prompt: `Structure this arc around one explosive peak scene, bookended by build-up and aftermath.
BUILD (early scenes):
- Small thread advances (latent→seeded, seeded→active, pulses on active threads), characters noticing details (2-3 continuity mutations), 1-2 world concepts planted as seeds.

PEAK (one defining scene — load it with mutations):
- THREADS reach critical/terminal phases. Multiple relationship shifts ±0.3-0.5. All participants learn critical information. World rules are TESTED — connections forged through action. This scene should be the densest in the arc.

AFTERMATH (final scenes):
- Threads pulse at their new statuses. Characters process what happened — continuity mutations capturing realisations. Relationships settle into new equilibria with small shifts. The world's established concepts are reaffirmed. Every scene still needs mutations — just quieter ones.`,
  },
  rebound: {
    name: 'Rebound',
    description: 'Fall then rise — stillness gives way to momentum',
    prompt: `Structure this arc as a valley that builds into forward momentum.
OPENING (quiet scenes):
- Threads pulse at current status (2-3 pulses per scene). Characters process and reflect (2-3 continuity mutations). Relationships hold or shift subtly (±0.1). World's quiet systems revealed (1 WK node per scene).

TURN (middle):
- One thread breaks the stillness with a real phase transition. A character learns something crucial — the catalyst. One world concept is revealed that changes the calculus.

RISE (late scenes):
- Threads advance progressively — momentum building. Characters discover new truths and relationships are tested (±0.2-0.3). World concepts connect to existing graph. End with clear upward momentum.
- Maintain POV streaks.`,
  },
};

export type MCTSConfig = {
  moveType: MoveType;         // 'arc' = generate full arcs, 'scene' = generate individual scenes
  parallelism: number;        // Max concurrent generation slots in sliding window
  maxNodes: number;           // Max total nodes (LLM calls) in iterations mode
  searchMode: SearchMode;     // How the tree is expanded
  pathStrategy: PathStrategy; // How to pick the recommended path
  stopMode: StopMode;         // What determines when search ends
  timeLimitSeconds: number;   // Time budget for search (timer mode)
  baselineScore: number;      // Target score per layer (baseline mode)
  randomDirections: boolean;  // If true, pick next cube corner randomly (ignores mode-based ordering)
  directionMode: DirectionMode; // Whether to use cube corners or delivery arc directions
  branchingFactor: number;    // Max children per node (derived from mode: direction count for freedom/constrained, Infinity for baseline)
  worldBuildFocusId?: string; // Optional world build commit to seed all generations with
  direction?: string;   // Optional high-level guidance that steers every generation in the search
  /** Constraints prompt — defaults from StorySettings.storyConstraints, overridable here */
  constraintsPrompt?: string;
};

export const DEFAULT_MCTS_CONFIG: MCTSConfig = {
  moveType: 'arc',
  parallelism: 4,
  maxNodes: 20,
  searchMode: 'constrained',
  pathStrategy: 'best_score',
  stopMode: 'timer',
  timeLimitSeconds: 60,
  baselineScore: 80,
  randomDirections: true,
  directionMode: 'delivery',
  branchingFactor: 4,
};

/** Default branching factor per direction mode */
export const DEFAULT_BRANCHING: Record<DirectionMode, number> = {
  delivery: 4,
  cube: 8,
};

/** UCB1 exploration constant per mode */
export const SEARCH_MODE_C: Record<SearchMode, number> = {
  freedom: 2.5,
  constrained: 0.5,
  baseline: 0.5,
  greedy: 0,
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
  deliveryGoal: DeliveryDirection | null;
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
