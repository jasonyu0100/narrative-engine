import type { NarrativeState, Scene, Arc, CubeCornerKey } from '@/types/narrative';
import { NARRATIVE_CUBE } from '@/types/narrative';
import type { MCTSNode, MCTSNodeId, MCTSTree, MCTSConfig, PathStrategy } from '@/types/mcts';
import { SEARCH_MODE_C } from '@/types/mcts';

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
 * Select the most promising node to expand next.
 *
 * Walk from the root, at each level picking the child with the highest UCB1 score,
 * until reaching a node that is either:
 * - Not yet expanded (has no children and hasn't been expanded)
 * - At max depth
 *
 * Returns null if the tree is fully expanded.
 */
export function selectNode(tree: MCTSTree, config: MCTSConfig): MCTSNodeId | null {
  // Start at root level
  const rootChildren = tree.rootChildIds;

  // If root has no children yet, return a sentinel indicating root needs expansion
  if (rootChildren.length === 0) return 'root';

  // Total visits across root children for UCB1 calculation
  let parentVisits = rootChildren.reduce(
    (sum, id) => sum + (tree.nodes[id]?.visitCount ?? 0), 0,
  );

  // Pick best root child
  let bestId: MCTSNodeId | null = null;
  let bestUcb = -Infinity;
  for (const childId of rootChildren) {
    const child = tree.nodes[childId];
    if (!child) continue;
    const score = ucb1(child, parentVisits, SEARCH_MODE_C[config.searchMode]);
    if (score > bestUcb) {
      bestUcb = score;
      bestId = childId;
    }
  }
  if (!bestId) return null;

  // Walk down the tree
  let currentId = bestId;
  while (true) {
    const current = tree.nodes[currentId];
    if (!current) return null;

    // If this node hasn't been expanded and is within depth limit, expand it
    if (!current.isExpanded && current.depth < config.maxDepth - 1) {
      return currentId;
    }

    // If at max depth or no children, can't go deeper
    if (current.childIds.length === 0) {
      // If not expanded and at max depth, mark as terminal — find another node
      return findUnexpandedNode(tree, config);
    }

    // Pick best child at this level
    parentVisits = current.childIds.reduce(
      (sum, id) => sum + (tree.nodes[id]?.visitCount ?? 0), 0,
    );
    bestUcb = -Infinity;
    let nextId: MCTSNodeId | null = null;
    for (const childId of current.childIds) {
      const child = tree.nodes[childId];
      if (!child) continue;
      const score = ucb1(child, parentVisits, SEARCH_MODE_C[config.searchMode]);
      if (score > bestUcb) {
        bestUcb = score;
        nextId = childId;
      }
    }
    if (!nextId) return null;
    currentId = nextId;
  }
}

/** Fallback: find any unexpanded node within depth limit */
function findUnexpandedNode(tree: MCTSTree, config: MCTSConfig): MCTSNodeId | null {
  for (const node of Object.values(tree.nodes)) {
    if (!node.isExpanded && node.depth < config.maxDepth - 1) {
      return node.id;
    }
  }
  return null; // Tree is fully expanded
}

// ── Direction Diversity ──────────────────────────────────────────────────────

const ALL_CUBE_CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];

/**
 * Pick N diverse cube corners for sibling expansion.
 * Maximizes spread by selecting corners that are as different as possible.
 * Excludes any corners already used by existing siblings at this level.
 */
export function pickDiverseDirections(
  count: number,
  existingSiblingGoals: (CubeCornerKey | null)[] = [],
): { direction: string; cubeGoal: CubeCornerKey }[] {
  const usedSet = new Set(existingSiblingGoals.filter((g): g is CubeCornerKey => g !== null));
  const available = ALL_CUBE_CORNERS.filter((c) => !usedSet.has(c));

  // If we need more than available, allow reuse
  const pool = available.length >= count ? available : ALL_CUBE_CORNERS;

  // Shuffle the pool, then greedily pick diverse corners from a random seed
  const remaining = [...pool];
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }

  const selected: CubeCornerKey[] = [];

  // Seed with a random corner
  if (remaining.length > 0) {
    selected.push(remaining.shift()!);
  }

  // Greedily pick the corner most distant from all already-selected
  while (selected.length < count && remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = -1;
    for (let i = 0; i < remaining.length; i++) {
      const minDist = selected.reduce(
        (min, sel) => Math.min(min, hammingDistance(remaining[i], sel)), Infinity,
      );
      if (minDist > bestDist) {
        bestDist = minDist;
        bestIdx = i;
      }
    }
    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected.map((cubeGoal) => ({
    direction: buildDirectionFromCube(cubeGoal),
    cubeGoal,
  }));
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
  virtualNarrative: NarrativeState,
  virtualResolvedKeys: string[],
  virtualCurrentIndex: number,
  immediateScore: number,
): MCTSTree {
  const depth = parentId === 'root' ? 0 : (tree.nodes[parentId]?.depth ?? 0) + 1;

  const node: MCTSNode = {
    id,
    parentId: parentId === 'root' ? null : parentId,
    childIds: [],
    scenes,
    arc,
    direction,
    cubeGoal,
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
