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

THREADS (primary driver):
- Advance threads progressively — dormant tensions become active, active ones escalate toward crisis points
- Each scene should push at least one thread forward. Do NOT resolve or close threads — leave them open and climbing at the arc's end
- Widen the circle of consequence: early scenes affect one or two characters, later scenes draw more people in

CONTINUITY:
- Characters should learn things that raise the stakes — discoveries that complicate their situation
- Knowledge asymmetries should deepen: some characters learn things others don't, creating dramatic irony
- Relationships should be tested and shifted: alliances strained, loyalties questioned

KNOWLEDGE:
- Reveal world concepts that raise the stakes — rules that constrain, systems that threaten, tensions that have no easy resolution
- Connect new concepts to existing knowledge graph — the world should feel like it's tightening around the characters
- Maintain POV streaks (2-4 scenes per perspective)`,
  },
  release: {
    name: 'Release',
    description: 'Falling beats — tension dissolves into stillness',
    prompt: `Structure this arc as a gradual exhale — the aftermath of intensity.

THREADS:
- No thread phase changes — the plot pauses while characters process what happened
- Threads pulse at their current status, maintaining presence without advancing

CONTINUITY:
- Characters reflect on what they already know rather than learning new things
- Relationship dynamics hold steady — no betrayals, no revelations, no valence shifts
- Keep the same small intimate group throughout in familiar settings

KNOWLEDGE:
- No new world concepts — the codex pauses. Characters operate within established rules
- The arc should feel like the quiet after a storm: emotionally resonant but structurally still
- Stay with one POV throughout`,
  },
  surge: {
    name: 'Surge',
    description: 'Peak then fall — a single climactic moment',
    prompt: `Structure this arc around one explosive peak scene, bookended by restraint.

BUILD (early scenes):
- THREADS: Small advances, minor tensions surfacing — pressure accumulating
- CONTINUITY: Characters notice small things, suspicions forming, pieces assembling
- KNOWLEDGE: One or two new world concepts planted as seeds — rules or systems mentioned but not yet tested

PEAK (one defining scene):
- THREADS: Reach critical/terminal phases — this is the turning point
- CONTINUITY: Multiple characters learn critical information simultaneously — knowledge gaps collapse
- KNOWLEDGE: World rules are TESTED — established concepts prove true or false under pressure. New connections between existing knowledge are forged through action

AFTERMATH (final scenes):
- All three pillars go quiet: no thread changes, no new continuity, no world knowledge reveals
- The same small group absorbing what happened. Stay with one POV
- The contrast between the peak and the stillness makes the climax land harder`,
  },
  rebound: {
    name: 'Rebound',
    description: 'Fall then rise — stillness gives way to momentum',
    prompt: `Structure this arc as a valley that builds into forward momentum.

OPENING (quiet scenes):
- THREADS: No advancement — stasis or waiting
- CONTINUITY: Characters sit with what they know. No new discoveries
- KNOWLEDGE: No new world concepts. Familiar ground, familiar rules

TURN (middle):
- THREADS: One thread stirs — a status change that breaks the stillness
- CONTINUITY: A character learns one crucial thing — the catalyst
- KNOWLEDGE: One world concept is revealed or connected that changes the calculus

RISE (late scenes):
- THREADS: Begin advancing again — momentum building
- CONTINUITY: Characters discover new truths, relationships are tested
- KNOWLEDGE: New world concepts connect to existing ones — the codex expands as the story accelerates
- End with clear upward momentum across all three pillars. Maintain POV streaks`,
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
