import type { NarrativeState, Scene, Arc, CubeCornerKey } from '@/types/narrative';
import { NARRATIVE_CUBE } from '@/types/narrative';
import type { MCTSNode, MCTSNodeId, MCTSTree, MCTSConfig, PathStrategy, MoveType } from '@/types/mcts';
import { SEARCH_MODE_C, DELIVERY_DIRECTIONS } from '@/types/mcts';
import type { SearchMode, DeliveryDirection, DirectionMode } from '@/types/mcts';

// ── Constants ────────────────────────────────────────────────────────────────

export { MCTS_MAX_NODE_CHILDREN as MAX_NODE_CHILDREN } from '@/lib/constants';

// ── Tree Creation ────────────────────────────────────────────────────────────

export function createTree(
  rootNarrative: NarrativeState,
  rootResolvedKeys: string[],
  rootCurrentIndex: number,
): MCTSTree {
  return {
    nodes: {},
    rootNarrative,
    rootResolvedKeys,
    rootCurrentIndex,
    rootChildIds: [],
  };
}

// ── Node ID Generation ───────────────────────────────────────────────────────

let nodeCounter = 0;

export function nextNodeId(): MCTSNodeId {
  return `mcts-${++nodeCounter}-${Date.now()}`;
}

export function resetNodeCounter(): void {
  nodeCounter = 0;
}

// ── UCB1 Selection ───────────────────────────────────────────────────────────

function ucb1(node: MCTSNode, parentVisits: number, C: number): number {
  if (node.visitCount === 0) return Infinity;
  const exploitation = node.totalScore / node.visitCount;
  const exploration = C * Math.sqrt(Math.log(parentVisits) / node.visitCount);
  return exploitation + exploration;
}

/**
 * Compute the maximum number of children (slots) a node is allowed to have.
 *
 * Unified slot model across all three search modes:
 * - **Baseline**: Infinity — unlimited children, depth advances when baseline met.
 * - **Constrained**: branchingFactor — fixed, complete tree.
 * - **Freedom**: Slots grow with exploration. More visits = more slots earned.
 *   Root is special: gets `parallelism` slots to jumpstart all workers.
 *   Non-root: min(branchingFactor, 1 + floor(sqrt(visitCount))).
 */
function maxSlots(
  id: MCTSNodeId | 'root',
  config: MCTSConfig,
  tree: MCTSTree,
): number {
  if (config.searchMode === 'baseline') return Infinity;
  if (config.searchMode === 'constrained') return config.branchingFactor;
  if (config.searchMode === 'greedy') return config.branchingFactor;

  // Freedom mode
  if (id === 'root') return config.parallelism;
  const node = tree.nodes[id];
  if (!node) return 1;
  return Math.min(config.branchingFactor, 1 + Math.floor(Math.sqrt(node.visitCount)));
}

/**
 * Select the next parent node to expand (add one child to).
 *
 * Walk from root using UCB1. At each level, if the current node has available
 * child slots (accounting for in-flight expansions), return it for expansion.
 * Otherwise descend to the best child.
 *
 * inFlightCounts: how many slots are currently generating children for each node.
 */
export function selectNode(
  tree: MCTSTree,
  config: MCTSConfig,
  inFlightCounts: Map<MCTSNodeId | 'root', number> = new Map(),
): MCTSNodeId | null {
  const C = SEARCH_MODE_C[config.searchMode];

  const slotsAvailable = (id: MCTSNodeId | 'root', childCount: number): boolean =>
    childCount + (inFlightCounts.get(id) ?? 0) < maxSlots(id, config, tree);

  // Root: if it has available slots, expand here
  if (slotsAvailable('root', tree.rootChildIds.length)) return 'root';
  if (tree.rootChildIds.length === 0) return null;

  // Walk down via UCB1
  let parentVisits = tree.rootChildIds.reduce((s, id) => s + (tree.nodes[id]?.visitCount ?? 0), 0);

  // Pick best root child to start walk
  let currentId: MCTSNodeId | null = null;
  let bestUcb = -Infinity;
  for (const id of tree.rootChildIds) {
    const node = tree.nodes[id];
    if (!node) continue;
    const score = ucb1(node, parentVisits, C);
    if (score > bestUcb) { bestUcb = score; currentId = id; }
  }

  while (currentId) {
    const node = tree.nodes[currentId];
    if (!node) return null;

    // If this node can take more children, expand here
    if (slotsAvailable(currentId, node.childIds.length)) {
      return currentId;
    }

    // Full or at max depth — descend to best child
    if (node.childIds.length === 0) break;

    const childVisits = node.childIds.reduce((s, id) => s + (tree.nodes[id]?.visitCount ?? 0), 0);
    let nextId: MCTSNodeId | null = null;
    let nextUcb = -Infinity;
    for (const childId of node.childIds) {
      const child = tree.nodes[childId];
      if (!child) continue;
      const score = ucb1(child, childVisits, C);
      if (score > nextUcb) { nextUcb = score; nextId = childId; }
    }
    currentId = nextId;
  }

  // Fallback: find any expandable node
  return findExpandableNode(tree, config, inFlightCounts);
}

/** Fallback: find any node that still has available child slots */
function findExpandableNode(
  tree: MCTSTree,
  config: MCTSConfig,
  inFlightCounts: Map<MCTSNodeId | 'root', number>,
): MCTSNodeId | null {
  for (const node of Object.values(tree.nodes)) {
    const inFlight = inFlightCounts.get(node.id) ?? 0;
    if (node.childIds.length + inFlight < maxSlots(node.id, config, tree)) {
      return node.id;
    }
  }
  return null;
}

// ── Direction Diversity ──────────────────────────────────────────────────────

const ALL_CUBE_CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];

const ALL_DELIVERY_DIRECTIONS: DeliveryDirection[] = ['escalate', 'release', 'surge', 'rebound'];

/**
 * Pick the next direction to explore for a given parent node.
 *
 * When directionMode === 'delivery':
 * - Pool = ['escalate', 'release', 'surge'] minus already-used ones
 * - If pool empty, allow reuse of all 3
 * - Random mode: pick random from pool
 * - Deterministic mode: cycle in canonical order (escalate → release → surge)
 *
 * When directionMode === 'cube' (default):
 * - Pool = 8 cube corners minus already-used ones
 * - Random mode: pick randomly from available corners
 * - Deterministic based on search mode:
 *   - exploit: pick the corner closest (min Hamming) to the parent's own cube direction
 *   - explore/baseline: pick the corner most diverse (max min-Hamming) from existing siblings
 * - In baseline mode, allows reusing corners when all 8 are exhausted.
 */
export function pickNextDirection(
  existingGoals: (string | null)[],
  searchMode: SearchMode,
  directionMode: DirectionMode,
  parentCubeGoal?: CubeCornerKey | null,
  randomDirections = false,
): { direction: string; cubeGoal: CubeCornerKey | null; deliveryGoal: DeliveryDirection | null } {
  if (directionMode === 'delivery') {
    const usedSet = new Set(existingGoals.filter((g): g is string => g !== null));
    const pool = ALL_DELIVERY_DIRECTIONS.filter((d) => !usedSet.has(d));

    let chosen: DeliveryDirection;
    if (pool.length > 0) {
      // Unused directions available — pick from them
      chosen = randomDirections
        ? pool[Math.floor(Math.random() * pool.length)]
        : pool[0];
    } else {
      // All 4 used — round-robin by count to keep distribution even
      const counts = new Map<DeliveryDirection, number>();
      for (const g of existingGoals) {
        if (g && ALL_DELIVERY_DIRECTIONS.includes(g as DeliveryDirection)) {
          const d = g as DeliveryDirection;
          counts.set(d, (counts.get(d) ?? 0) + 1);
        }
      }
      const minCount = Math.min(...ALL_DELIVERY_DIRECTIONS.map((d) => counts.get(d) ?? 0));
      const leastUsed = ALL_DELIVERY_DIRECTIONS.filter((d) => (counts.get(d) ?? 0) === minCount);
      chosen = randomDirections
        ? leastUsed[Math.floor(Math.random() * leastUsed.length)]
        : leastUsed[0];
    }

    return { direction: DELIVERY_DIRECTIONS[chosen].prompt, cubeGoal: null, deliveryGoal: chosen };
  }

  // Cube mode
  const usedSet = new Set(existingGoals.filter((g): g is CubeCornerKey => g !== null));
  let pool = ALL_CUBE_CORNERS.filter((c) => !usedSet.has(c));

  // Baseline: allow reuse when all 8 corners exhausted
  if (pool.length === 0) {
    pool = [...ALL_CUBE_CORNERS];
  }

  let chosen: CubeCornerKey;

  if (randomDirections) {
    // Random: pick any available corner with equal probability
    chosen = pool[Math.floor(Math.random() * pool.length)];
  } else {
    const existing = existingGoals.filter((g): g is CubeCornerKey => g !== null);

    if (existing.length === 0) {
      // No siblings yet: start from first in canonical order
      chosen = pool[0];
    } else {
      // Explore/baseline: maximize diversity — pick corner most different from all existing siblings
      chosen = pool.reduce((best, c) => {
        const minDistC = Math.min(...existing.map((e) => hammingDistance(c, e)));
        const minDistBest = Math.min(...existing.map((e) => hammingDistance(best, e)));
        return minDistC > minDistBest ? c : best;
      });
    }
  }

  return { direction: buildDirectionFromCube(chosen), cubeGoal: chosen, deliveryGoal: null };
}

/** Hamming distance between two cube corner keys (e.g., HHH vs LLL = 3) */
function hammingDistance(a: CubeCornerKey, b: CubeCornerKey): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) d++;
  }
  return d;
}

/** Build a natural-language direction from a cube corner goal */
function buildDirectionFromCube(corner: CubeCornerKey): string {
  const cube = NARRATIVE_CUBE[corner];
  return `Steer the narrative toward "${cube.name}": ${cube.description}`;
}

// ── Tree Mutation (Immutable) ────────────────────────────────────────────────

/**
 * Add a child node to the tree. Returns a new tree (immutable update).
 */
export function addChildNode(
  tree: MCTSTree,
  parentId: MCTSNodeId | 'root',
  id: MCTSNodeId,
  scenes: Scene[],
  arc: Arc,
  direction: string,
  cubeGoal: CubeCornerKey | null,
  deliveryGoal: DeliveryDirection | null,
  virtualNarrative: NarrativeState,
  virtualResolvedKeys: string[],
  virtualCurrentIndex: number,
  immediateScore: number,
  moveType: MoveType = 'arc',
): MCTSTree {
  const depth = parentId === 'root' ? 0 : (tree.nodes[parentId]?.depth ?? 0) + 1;

  const node: MCTSNode = {
    id,
    parentId: parentId === 'root' ? null : parentId,
    childIds: [],
    moveType,
    scenes,
    arc,
    direction,
    cubeGoal,
    deliveryGoal,
    immediateScore,
    totalScore: immediateScore,
    visitCount: 1,
    virtualNarrative,
    virtualResolvedKeys,
    virtualCurrentIndex,
    depth,
    isExpanded: false,
    createdAt: Date.now(),
  };

  const nodes = { ...tree.nodes, [id]: node };

  // Update parent's childIds
  if (parentId === 'root') {
    return { ...tree, nodes, rootChildIds: [...tree.rootChildIds, id] };
  }

  const parent = nodes[parentId];
  if (parent) {
    nodes[parentId] = { ...parent, childIds: [...parent.childIds, id] };
  }

  return { ...tree, nodes };
}

/**
 * Mark a node as expanded (children have been generated).
 */
export function markExpanded(tree: MCTSTree, nodeId: MCTSNodeId): MCTSTree {
  const node = tree.nodes[nodeId];
  if (!node) return tree;
  return {
    ...tree,
    nodes: { ...tree.nodes, [nodeId]: { ...node, isExpanded: true } },
  };
}

/**
 * Backpropagate a score from a node up to the root.
 * Increments visitCount and adds the score to totalScore at each ancestor.
 */
export function backpropagate(tree: MCTSTree, nodeId: MCTSNodeId): MCTSTree {
  const node = tree.nodes[nodeId];
  if (!node) return tree;

  const score = node.immediateScore;
  const nodes = { ...tree.nodes };
  let currentId = node.parentId;

  while (currentId) {
    const current = nodes[currentId];
    if (!current) break;
    nodes[currentId] = {
      ...current,
      visitCount: current.visitCount + 1,
      totalScore: current.totalScore + score,
    };
    currentId = current.parentId;
  }

  return { ...tree, nodes };
}

// ── Best Path ────────────────────────────────────────────────────────────────

/**
 * Find the best path through the tree.
 *
 * - **hillclimb**: DFS over all paths, pick the one with the highest average
 *   immediate score. Evaluates every root-to-any-depth path exhaustively.
 * - **robust**: Standard MCTS — at each level pick the most-visited child.
 *   Visit count reflects search confidence after exploration/exploitation.
 */
export function bestPath(tree: MCTSTree, strategy: PathStrategy = 'best_score'): MCTSNodeId[] {
  if (strategy === 'most_explored') {
    const path: MCTSNodeId[] = [];
    let childIds = tree.rootChildIds;
    while (childIds.length > 0) {
      let bestId: MCTSNodeId | null = null;
      let bestVisits = -1;
      let tiebreak = -Infinity;
      for (const id of childIds) {
        const node = tree.nodes[id];
        if (!node) continue;
        if (node.visitCount > bestVisits ||
            (node.visitCount === bestVisits && node.immediateScore > tiebreak)) {
          bestVisits = node.visitCount;
          tiebreak = node.immediateScore;
          bestId = id;
        }
      }
      if (!bestId) break;
      path.push(bestId);
      childIds = tree.nodes[bestId]?.childIds ?? [];
    }
    return path;
  }

  // hillclimb: best average path via DFS
  let best: MCTSNodeId[] = [];
  let bestAvg = -Infinity;

  function dfs(childIds: MCTSNodeId[], path: MCTSNodeId[], sum: number) {
    if (path.length > 0) {
      const avg = sum / path.length;
      if (avg > bestAvg || (avg === bestAvg && path.length > best.length)) {
        bestAvg = avg;
        best = [...path];
      }
    }
    for (const id of childIds) {
      const node = tree.nodes[id];
      if (!node) continue;
      path.push(id);
      dfs(node.childIds, path, sum + node.immediateScore);
      path.pop();
    }
  }

  dfs(tree.rootChildIds, [], 0);
  return best;
}

// ── Prune to Path (Tree Reuse) ───────────────────────────────────────────────

/**
 * Prune the tree to retain only the subtree rooted at the last node in the committed path.
 * The committed leaf becomes the new logical root — its virtual state is the new root state,
 * and its children become the new root children.
 */
export function pruneToPath(tree: MCTSTree, pathIds: MCTSNodeId[]): MCTSTree | null {
  if (pathIds.length === 0) return null;

  const leafId = pathIds[pathIds.length - 1];
  const leaf = tree.nodes[leafId];
  if (!leaf) return null;

  // Collect all descendant node IDs from the leaf
  const keepIds = new Set<MCTSNodeId>();
  const queue = [...leaf.childIds];
  while (queue.length > 0) {
    const id = queue.pop()!;
    keepIds.add(id);
    const node = tree.nodes[id];
    if (node) queue.push(...node.childIds);
  }

  // Build new nodes map with only descendants, reparenting leaf's children to root
  const nodes: Record<MCTSNodeId, MCTSNode> = {};
  for (const id of keepIds) {
    const node = tree.nodes[id];
    if (!node) continue;
    nodes[id] = {
      ...node,
      parentId: node.parentId === leafId ? null : node.parentId,
      depth: node.depth - leaf.depth - 1,
    };
  }

  return {
    nodes,
    rootNarrative: leaf.virtualNarrative,
    rootResolvedKeys: leaf.virtualResolvedKeys,
    rootCurrentIndex: leaf.virtualCurrentIndex,
    rootChildIds: leaf.childIds.filter((id) => keepIds.has(id)),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Get the ancestor chain from root to a given node (inclusive, root-first order) */
export function getAncestorChain(tree: MCTSTree, nodeId: MCTSNodeId): MCTSNode[] {
  const chain: MCTSNode[] = [];
  let currentId: MCTSNodeId | null = nodeId;
  while (currentId) {
    const node: MCTSNode | undefined = tree.nodes[currentId];
    if (!node) break;
    chain.unshift(node);
    currentId = node.parentId;
  }
  return chain;
}

/** Count total nodes in the tree */
export function treeSize(tree: MCTSTree): number {
  return Object.keys(tree.nodes).length;
}
