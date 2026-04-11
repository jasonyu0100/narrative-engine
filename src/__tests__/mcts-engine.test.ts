import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTree,
  nextNodeId,
  resetNodeCounter,
  selectNode,
  pickNextDirection,
  addChildNode,
  markExpanded,
  backpropagate,
  bestPath,
  pruneToPath,
  getAncestorChain,
  treeSize,
} from '@/lib/mcts-engine';
import type { MCTSTree, MCTSConfig, MCTSNodeId } from '@/types/mcts';
import type { NarrativeState, Scene, Arc, CubeCornerKey } from '@/types/narrative';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function createMinimalNarrative(): NarrativeState {
  return {
    id: 'test-narrative',
    title: 'Test',
    description: 'Test narrative',
    characters: {},
    locations: {},
    threads: {},
    artifacts: {},
    scenes: {},
    arcs: {},
    worldBuilds: {},
    branches: {
      main: {
        id: 'main',
        name: 'Main',
        parentBranchId: null,
        forkEntryId: null,
        entryIds: [],
        createdAt: Date.now(),
      },
    },
    relationships: [],
    systemGraph: { nodes: {}, edges: [] },
    worldSummary: '',
    rules: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createMinimalScene(id: string): Scene {
  return {
    kind: 'scene',
    id,
    arcId: 'ARC-01',
    povId: 'C-01',
    locationId: 'L-01',
    participantIds: ['C-01'],
    events: [],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    summary: 'Test scene',
  };
}

function createMinimalArc(id: string): Arc {
  return {
    id,
    name: 'Test Arc',
    sceneIds: [],
    develops: [],
    locationIds: [],
    activeCharacterIds: [],
    initialCharacterLocations: {},
  };
}

function createMCTSConfig(overrides: Partial<MCTSConfig> = {}): MCTSConfig {
  return {
    moveType: 'scene',
    searchMode: 'freedom',
    directionMode: 'cube',
    branchingFactor: 4,
    parallelism: 2,
    maxNodes: 100,
    stopMode: 'iterations',
    timeLimitSeconds: 60,
    baselineScore: 70,
    pathStrategy: 'best_score',
    randomDirections: false,
    ...overrides,
  };
}

// ── Tree Creation ────────────────────────────────────────────────────────────

describe('createTree', () => {
  it('creates an empty tree with narrative root', () => {
    const narrative = createMinimalNarrative();
    const resolvedKeys = ['S-001', 'S-002'];
    const currentIndex = 1;

    const tree = createTree(narrative, resolvedKeys, currentIndex);

    expect(tree.nodes).toEqual({});
    expect(tree.rootNarrative).toBe(narrative);
    expect(tree.rootResolvedKeys).toEqual(resolvedKeys);
    expect(tree.rootCurrentIndex).toBe(currentIndex);
    expect(tree.rootChildIds).toEqual([]);
  });
});

// ── Node ID Generation ───────────────────────────────────────────────────────

describe('nextNodeId', () => {
  beforeEach(() => {
    resetNodeCounter();
  });

  it('generates unique node IDs', () => {
    const id1 = nextNodeId();
    const id2 = nextNodeId();
    const id3 = nextNodeId();

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  it('includes incrementing counter', () => {
    const id1 = nextNodeId();
    const id2 = nextNodeId();

    expect(id1).toMatch(/^mcts-1-/);
    expect(id2).toMatch(/^mcts-2-/);
  });
});

describe('resetNodeCounter', () => {
  it('resets counter so next ID starts from 1', () => {
    nextNodeId();
    nextNodeId();
    resetNodeCounter();
    const id = nextNodeId();
    expect(id).toMatch(/^mcts-1-/);
  });
});

// ── Select Node ──────────────────────────────────────────────────────────────

describe('selectNode', () => {
  beforeEach(() => {
    resetNodeCounter();
  });

  it('returns root when tree has no children', () => {
    const tree = createTree(createMinimalNarrative(), [], 0);
    const config = createMCTSConfig({ searchMode: 'freedom' });

    const selected = selectNode(tree, config);
    expect(selected).toBe('root');
  });

  it('returns null when root has no slots and no children', () => {
    const tree = createTree(createMinimalNarrative(), [], 0);
    const config = createMCTSConfig({ searchMode: 'freedom', parallelism: 0 });

    const selected = selectNode(tree, config);
    expect(selected).toBe(null);
  });

  it('accounts for in-flight expansions', () => {
    const tree = createTree(createMinimalNarrative(), [], 0);
    const config = createMCTSConfig({ searchMode: 'freedom', parallelism: 2 });

    // Root has 2 slots, but 2 are in-flight
    const inFlightCounts = new Map<MCTSNodeId | 'root', number>([['root', 2]]);
    const selected = selectNode(tree, config, inFlightCounts);
    expect(selected).toBe(null);
  });

  it('returns expandable child node when root is full', () => {
    let tree = createTree(createMinimalNarrative(), [], 0);
    const config = createMCTSConfig({ searchMode: 'constrained', branchingFactor: 2 });

    // Add 2 children to root (fills it)
    const scene = createMinimalScene('S-001');
    const arc = createMinimalArc('ARC-01');
    const narrative = createMinimalNarrative();

    tree = addChildNode(tree, 'root', 'node-1', [scene], arc, 'Direction 1', 'HHH', null, narrative, [], 0, 0.5);
    tree = addChildNode(tree, 'root', 'node-2', [scene], arc, 'Direction 2', 'LLL', null, narrative, [], 0, 0.6);

    // Root is now full with 2 children
    const selected = selectNode(tree, config);

    // Should select one of the child nodes (they're expandable)
    expect(['node-1', 'node-2']).toContain(selected);
  });

  describe('search modes', () => {
    it('baseline mode has infinite slots', () => {
      let tree = createTree(createMinimalNarrative(), [], 0);
      const config = createMCTSConfig({ searchMode: 'baseline' });

      // Add many children to root
      const scene = createMinimalScene('S-001');
      const arc = createMinimalArc('ARC-01');
      const narrative = createMinimalNarrative();

      for (let i = 0; i < 10; i++) {
        tree = addChildNode(tree, 'root', `node-${i}`, [scene], arc, `Direction ${i}`, 'HHH', null, narrative, [], 0, 0.5);
      }

      // Should still return root as it has infinite slots
      const selected = selectNode(tree, config);
      expect(selected).toBe('root');
    });

    it('constrained mode uses fixed branching factor', () => {
      let tree = createTree(createMinimalNarrative(), [], 0);
      const config = createMCTSConfig({ searchMode: 'constrained', branchingFactor: 3 });

      const scene = createMinimalScene('S-001');
      const arc = createMinimalArc('ARC-01');
      const narrative = createMinimalNarrative();

      // Add 3 children to root (fills constrained mode)
      for (let i = 0; i < 3; i++) {
        tree = addChildNode(tree, 'root', `node-${i}`, [scene], arc, `Direction ${i}`, 'HHH', null, narrative, [], 0, 0.5);
      }

      // Root should no longer be selected
      const selected = selectNode(tree, config);
      expect(selected).not.toBe('root');
    });
  });
});

// ── Pick Next Direction ──────────────────────────────────────────────────────

describe('pickNextDirection', () => {
  describe('cube mode', () => {
    it('returns first corner when no existing goals', () => {
      const result = pickNextDirection([], 'freedom', 'cube', null, false);
      expect(result.cubeGoal).toBe('HHH');
      expect(result.deliveryGoal).toBeNull();
      expect(result.direction).toContain('Steer the narrative');
    });

    it('picks diverse corners based on existing goals', () => {
      // HHH is used, should pick something diverse (LLL is maximally different)
      const result = pickNextDirection(['HHH'], 'freedom', 'cube', null, false);
      expect(result.cubeGoal).toBe('LLL'); // Most different from HHH (Hamming distance 3)
    });

    it('cycles through all corners before reusing', () => {
      const usedCorners: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH'];
      const result = pickNextDirection(usedCorners, 'freedom', 'cube', null, false);
      expect(result.cubeGoal).toBe('LLL'); // Only one left
    });

    it('allows reusing corners when all 8 are exhausted', () => {
      const allCorners: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];
      const result = pickNextDirection(allCorners, 'baseline', 'cube', null, false);
      expect(result.cubeGoal).not.toBeNull();
    });

    it('uses random selection when randomDirections is true', () => {
      // Run multiple times to verify randomness
      const results = new Set<CubeCornerKey>();
      for (let i = 0; i < 50; i++) {
        const result = pickNextDirection([], 'freedom', 'cube', null, true);
        results.add(result.cubeGoal!);
      }
      // Should get multiple different corners due to randomness
      expect(results.size).toBeGreaterThan(1);
    });
  });

  describe('delivery mode', () => {
    it('returns escalate first when no existing goals', () => {
      const result = pickNextDirection([], 'freedom', 'delivery', null, false);
      expect(result.deliveryGoal).toBe('escalate');
      expect(result.cubeGoal).toBeNull();
    });

    it('cycles through delivery directions', () => {
      let result = pickNextDirection(['escalate'], 'freedom', 'delivery', null, false);
      expect(result.deliveryGoal).toBe('release');

      result = pickNextDirection(['escalate', 'release'], 'freedom', 'delivery', null, false);
      expect(result.deliveryGoal).toBe('surge');

      result = pickNextDirection(['escalate', 'release', 'surge'], 'freedom', 'delivery', null, false);
      expect(result.deliveryGoal).toBe('rebound');
    });

    it('round-robins when all directions used', () => {
      const allUsed = ['escalate', 'release', 'surge', 'rebound'];
      const result = pickNextDirection(allUsed, 'freedom', 'delivery', null, false);
      expect(['escalate', 'release', 'surge', 'rebound']).toContain(result.deliveryGoal);
    });
  });
});

// ── Add Child Node ───────────────────────────────────────────────────────────

describe('addChildNode', () => {
  beforeEach(() => {
    resetNodeCounter();
  });

  it('adds node to root children', () => {
    const tree = createTree(createMinimalNarrative(), [], 0);
    const scene = createMinimalScene('S-001');
    const arc = createMinimalArc('ARC-01');
    const narrative = createMinimalNarrative();

    const newTree = addChildNode(
      tree, 'root', 'node-1', [scene], arc, 'Test direction', 'HHH', null,
      narrative, ['S-001'], 1, 0.75
    );

    expect(newTree.rootChildIds).toContain('node-1');
    expect(newTree.nodes['node-1']).toBeDefined();
    expect(newTree.nodes['node-1'].parentId).toBeNull();
    expect(newTree.nodes['node-1'].depth).toBe(0);
    expect(newTree.nodes['node-1'].immediateScore).toBe(0.75);
  });

  it('adds node to non-root parent', () => {
    let tree = createTree(createMinimalNarrative(), [], 0);
    const scene = createMinimalScene('S-001');
    const arc = createMinimalArc('ARC-01');
    const narrative = createMinimalNarrative();

    // First add a root child
    tree = addChildNode(tree, 'root', 'parent-node', [scene], arc, 'Parent', 'HHH', null, narrative, [], 0, 0.5);

    // Then add child to that node
    tree = addChildNode(tree, 'parent-node', 'child-node', [scene], arc, 'Child', 'LLL', null, narrative, [], 0, 0.6);

    expect(tree.nodes['child-node'].parentId).toBe('parent-node');
    expect(tree.nodes['child-node'].depth).toBe(1);
    expect(tree.nodes['parent-node'].childIds).toContain('child-node');
  });

  it('preserves immutability', () => {
    const tree = createTree(createMinimalNarrative(), [], 0);
    const scene = createMinimalScene('S-001');
    const arc = createMinimalArc('ARC-01');
    const narrative = createMinimalNarrative();

    const newTree = addChildNode(tree, 'root', 'node-1', [scene], arc, 'Test', 'HHH', null, narrative, [], 0, 0.5);

    expect(tree.rootChildIds).toEqual([]);
    expect(newTree.rootChildIds).toContain('node-1');
    expect(tree).not.toBe(newTree);
  });

  it('sets delivery goal when provided', () => {
    const tree = createTree(createMinimalNarrative(), [], 0);
    const scene = createMinimalScene('S-001');
    const arc = createMinimalArc('ARC-01');
    const narrative = createMinimalNarrative();

    const newTree = addChildNode(
      tree, 'root', 'node-1', [scene], arc, 'Escalate tension', null, 'escalate',
      narrative, [], 0, 0.5
    );

    expect(newTree.nodes['node-1'].cubeGoal).toBeNull();
    expect(newTree.nodes['node-1'].deliveryGoal).toBe('escalate');
  });
});

// ── Mark Expanded ────────────────────────────────────────────────────────────

describe('markExpanded', () => {
  it('marks node as expanded', () => {
    let tree = createTree(createMinimalNarrative(), [], 0);
    const scene = createMinimalScene('S-001');
    const arc = createMinimalArc('ARC-01');
    const narrative = createMinimalNarrative();

    tree = addChildNode(tree, 'root', 'node-1', [scene], arc, 'Test', 'HHH', null, narrative, [], 0, 0.5);
    expect(tree.nodes['node-1'].isExpanded).toBe(false);

    tree = markExpanded(tree, 'node-1');
    expect(tree.nodes['node-1'].isExpanded).toBe(true);
  });

  it('returns same tree if node not found', () => {
    const tree = createTree(createMinimalNarrative(), [], 0);
    const result = markExpanded(tree, 'nonexistent');
    expect(result).toBe(tree);
  });
});

// ── Backpropagate ────────────────────────────────────────────────────────────

describe('backpropagate', () => {
  beforeEach(() => {
    resetNodeCounter();
  });

  it('propagates score up to ancestors', () => {
    let tree = createTree(createMinimalNarrative(), [], 0);
    const scene = createMinimalScene('S-001');
    const arc = createMinimalArc('ARC-01');
    const narrative = createMinimalNarrative();

    // Create a chain: root -> node-1 -> node-2 -> node-3
    tree = addChildNode(tree, 'root', 'node-1', [scene], arc, 'D1', 'HHH', null, narrative, [], 0, 0.5);
    tree = addChildNode(tree, 'node-1', 'node-2', [scene], arc, 'D2', 'HHL', null, narrative, [], 0, 0.6);
    tree = addChildNode(tree, 'node-2', 'node-3', [scene], arc, 'D3', 'LLL', null, narrative, [], 0, 0.9);

    // Backpropagate from node-3
    tree = backpropagate(tree, 'node-3');

    // node-1 and node-2 should have increased visit counts and scores
    expect(tree.nodes['node-1'].visitCount).toBe(2);
    expect(tree.nodes['node-1'].totalScore).toBeCloseTo(0.5 + 0.9, 5);
    expect(tree.nodes['node-2'].visitCount).toBe(2);
    expect(tree.nodes['node-2'].totalScore).toBeCloseTo(0.6 + 0.9, 5);
    // node-3 should be unchanged (it's the source)
    expect(tree.nodes['node-3'].visitCount).toBe(1);
  });

  it('handles root children correctly', () => {
    let tree = createTree(createMinimalNarrative(), [], 0);
    const scene = createMinimalScene('S-001');
    const arc = createMinimalArc('ARC-01');
    const narrative = createMinimalNarrative();

    tree = addChildNode(tree, 'root', 'node-1', [scene], arc, 'D1', 'HHH', null, narrative, [], 0, 0.5);
    tree = addChildNode(tree, 'node-1', 'node-2', [scene], arc, 'D2', 'HHL', null, narrative, [], 0, 0.8);

    tree = backpropagate(tree, 'node-2');

    // node-1 (root child with parentId=null) should have propagated score
    expect(tree.nodes['node-1'].visitCount).toBe(2);
    expect(tree.nodes['node-1'].totalScore).toBeCloseTo(0.5 + 0.8, 5);
  });
});

// ── Best Path ────────────────────────────────────────────────────────────────

describe('bestPath', () => {
  beforeEach(() => {
    resetNodeCounter();
  });

  it('returns empty array for empty tree', () => {
    const tree = createTree(createMinimalNarrative(), [], 0);
    const path = bestPath(tree);
    expect(path).toEqual([]);
  });

  describe('best_score strategy (hillclimb)', () => {
    it('selects path with highest average score', () => {
      let tree = createTree(createMinimalNarrative(), [], 0);
      const scene = createMinimalScene('S-001');
      const arc = createMinimalArc('ARC-01');
      const narrative = createMinimalNarrative();

      // Create two branches from root
      // Branch 1: node-1 (0.3) -> node-1a (0.4) -> avg = 0.35
      // Branch 2: node-2 (0.8) -> node-2a (0.9) -> avg = 0.85
      tree = addChildNode(tree, 'root', 'node-1', [scene], arc, 'D1', 'HHH', null, narrative, [], 0, 0.3);
      tree = addChildNode(tree, 'node-1', 'node-1a', [scene], arc, 'D1a', 'HHL', null, narrative, [], 0, 0.4);
      tree = addChildNode(tree, 'root', 'node-2', [scene], arc, 'D2', 'LLL', null, narrative, [], 0, 0.8);
      tree = addChildNode(tree, 'node-2', 'node-2a', [scene], arc, 'D2a', 'LLH', null, narrative, [], 0, 0.9);

      const path = bestPath(tree, 'best_score');
      expect(path).toEqual(['node-2', 'node-2a']);
    });

    it('prefers longer paths with same average score', () => {
      let tree = createTree(createMinimalNarrative(), [], 0);
      const scene = createMinimalScene('S-001');
      const arc = createMinimalArc('ARC-01');
      const narrative = createMinimalNarrative();

      // Two paths with same average (0.5)
      // Short: node-1 (0.5)
      // Long: node-2 (0.5) -> node-2a (0.5)
      tree = addChildNode(tree, 'root', 'node-1', [scene], arc, 'D1', 'HHH', null, narrative, [], 0, 0.5);
      tree = addChildNode(tree, 'root', 'node-2', [scene], arc, 'D2', 'LLL', null, narrative, [], 0, 0.5);
      tree = addChildNode(tree, 'node-2', 'node-2a', [scene], arc, 'D2a', 'LLH', null, narrative, [], 0, 0.5);

      const path = bestPath(tree, 'best_score');
      expect(path.length).toBe(2);
      expect(path).toEqual(['node-2', 'node-2a']);
    });
  });

  describe('most_explored strategy (robust)', () => {
    it('selects path with most visits', () => {
      let tree = createTree(createMinimalNarrative(), [], 0);
      const scene = createMinimalScene('S-001');
      const arc = createMinimalArc('ARC-01');
      const narrative = createMinimalNarrative();

      // Create two branches
      tree = addChildNode(tree, 'root', 'node-1', [scene], arc, 'D1', 'HHH', null, narrative, [], 0, 0.9);
      tree = addChildNode(tree, 'root', 'node-2', [scene], arc, 'D2', 'LLL', null, narrative, [], 0, 0.3);

      // Simulate more visits to node-2 via backpropagation
      tree = addChildNode(tree, 'node-2', 'node-2a', [scene], arc, 'D2a', 'LLH', null, narrative, [], 0, 0.4);
      tree = backpropagate(tree, 'node-2a');
      tree = addChildNode(tree, 'node-2', 'node-2b', [scene], arc, 'D2b', 'LHL', null, narrative, [], 0, 0.5);
      tree = backpropagate(tree, 'node-2b');

      // node-2 now has visitCount=3, node-1 has visitCount=1
      const path = bestPath(tree, 'most_explored');
      expect(path[0]).toBe('node-2');
    });

    it('uses immediate score as tiebreaker', () => {
      let tree = createTree(createMinimalNarrative(), [], 0);
      const scene = createMinimalScene('S-001');
      const arc = createMinimalArc('ARC-01');
      const narrative = createMinimalNarrative();

      // Two nodes with same visit count but different immediate scores
      tree = addChildNode(tree, 'root', 'node-1', [scene], arc, 'D1', 'HHH', null, narrative, [], 0, 0.3);
      tree = addChildNode(tree, 'root', 'node-2', [scene], arc, 'D2', 'LLL', null, narrative, [], 0, 0.8);

      const path = bestPath(tree, 'most_explored');
      expect(path[0]).toBe('node-2'); // Higher immediate score
    });
  });
});

// ── Prune to Path ────────────────────────────────────────────────────────────

describe('pruneToPath', () => {
  beforeEach(() => {
    resetNodeCounter();
  });

  it('returns null for empty path', () => {
    const tree = createTree(createMinimalNarrative(), [], 0);
    const result = pruneToPath(tree, []);
    expect(result).toBeNull();
  });

  it('returns null if path leaf not found', () => {
    const tree = createTree(createMinimalNarrative(), [], 0);
    const result = pruneToPath(tree, ['nonexistent']);
    expect(result).toBeNull();
  });

  it('prunes to subtree rooted at path leaf', () => {
    let tree = createTree(createMinimalNarrative(), [], 0);
    const scene = createMinimalScene('S-001');
    const arc = createMinimalArc('ARC-01');
    const narrative = createMinimalNarrative();

    // root -> node-1 -> node-1a -> node-1a1
    //      -> node-2 (separate branch, should be pruned)
    tree = addChildNode(tree, 'root', 'node-1', [scene], arc, 'D1', 'HHH', null, narrative, ['S-001'], 1, 0.5);
    tree = addChildNode(tree, 'node-1', 'node-1a', [scene], arc, 'D1a', 'HHL', null, narrative, ['S-002'], 2, 0.6);
    tree = addChildNode(tree, 'node-1a', 'node-1a1', [scene], arc, 'D1a1', 'HLH', null, narrative, ['S-003'], 3, 0.7);
    tree = addChildNode(tree, 'root', 'node-2', [scene], arc, 'D2', 'LLL', null, narrative, ['S-004'], 4, 0.8);

    // Prune to path [node-1, node-1a]
    const pruned = pruneToPath(tree, ['node-1', 'node-1a']);

    expect(pruned).not.toBeNull();
    // node-1a's children become the new root children
    expect(pruned!.rootChildIds).toEqual(['node-1a1']);
    // node-2 should be gone
    expect(pruned!.nodes['node-2']).toBeUndefined();
    // node-1 and node-1a should be gone (path nodes removed)
    expect(pruned!.nodes['node-1']).toBeUndefined();
    expect(pruned!.nodes['node-1a']).toBeUndefined();
    // node-1a1 should exist with adjusted depth and null parent
    expect(pruned!.nodes['node-1a1']).toBeDefined();
    expect(pruned!.nodes['node-1a1'].parentId).toBeNull();
    expect(pruned!.nodes['node-1a1'].depth).toBe(0);
  });

  it('updates root narrative to leaf virtual state', () => {
    let tree = createTree(createMinimalNarrative(), [], 0);
    const scene = createMinimalScene('S-001');
    const arc = createMinimalArc('ARC-01');
    const leafNarrative = { ...createMinimalNarrative(), id: 'leaf-narrative' };

    tree = addChildNode(tree, 'root', 'node-1', [scene], arc, 'D1', 'HHH', null, leafNarrative, ['S-001', 'S-002'], 5, 0.5);

    const pruned = pruneToPath(tree, ['node-1']);

    expect(pruned!.rootNarrative.id).toBe('leaf-narrative');
    expect(pruned!.rootResolvedKeys).toEqual(['S-001', 'S-002']);
    expect(pruned!.rootCurrentIndex).toBe(5);
  });
});

// ── Get Ancestor Chain ───────────────────────────────────────────────────────

describe('getAncestorChain', () => {
  beforeEach(() => {
    resetNodeCounter();
  });

  it('returns empty array for nonexistent node', () => {
    const tree = createTree(createMinimalNarrative(), [], 0);
    const chain = getAncestorChain(tree, 'nonexistent');
    expect(chain).toEqual([]);
  });

  it('returns single node for root child', () => {
    let tree = createTree(createMinimalNarrative(), [], 0);
    const scene = createMinimalScene('S-001');
    const arc = createMinimalArc('ARC-01');
    const narrative = createMinimalNarrative();

    tree = addChildNode(tree, 'root', 'node-1', [scene], arc, 'D1', 'HHH', null, narrative, [], 0, 0.5);

    const chain = getAncestorChain(tree, 'node-1');
    expect(chain.length).toBe(1);
    expect(chain[0].id).toBe('node-1');
  });

  it('returns ancestors in root-first order', () => {
    let tree = createTree(createMinimalNarrative(), [], 0);
    const scene = createMinimalScene('S-001');
    const arc = createMinimalArc('ARC-01');
    const narrative = createMinimalNarrative();

    tree = addChildNode(tree, 'root', 'node-1', [scene], arc, 'D1', 'HHH', null, narrative, [], 0, 0.5);
    tree = addChildNode(tree, 'node-1', 'node-2', [scene], arc, 'D2', 'HHL', null, narrative, [], 0, 0.6);
    tree = addChildNode(tree, 'node-2', 'node-3', [scene], arc, 'D3', 'LLL', null, narrative, [], 0, 0.7);

    const chain = getAncestorChain(tree, 'node-3');
    expect(chain.length).toBe(3);
    expect(chain[0].id).toBe('node-1'); // Root-first
    expect(chain[1].id).toBe('node-2');
    expect(chain[2].id).toBe('node-3');
  });
});

// ── Tree Size ────────────────────────────────────────────────────────────────

describe('treeSize', () => {
  beforeEach(() => {
    resetNodeCounter();
  });

  it('returns 0 for empty tree', () => {
    const tree = createTree(createMinimalNarrative(), [], 0);
    expect(treeSize(tree)).toBe(0);
  });

  it('counts all nodes in tree', () => {
    let tree = createTree(createMinimalNarrative(), [], 0);
    const scene = createMinimalScene('S-001');
    const arc = createMinimalArc('ARC-01');
    const narrative = createMinimalNarrative();

    tree = addChildNode(tree, 'root', 'node-1', [scene], arc, 'D1', 'HHH', null, narrative, [], 0, 0.5);
    tree = addChildNode(tree, 'root', 'node-2', [scene], arc, 'D2', 'LLL', null, narrative, [], 0, 0.6);
    tree = addChildNode(tree, 'node-1', 'node-3', [scene], arc, 'D3', 'HHL', null, narrative, [], 0, 0.7);

    expect(treeSize(tree)).toBe(3);
  });
});
