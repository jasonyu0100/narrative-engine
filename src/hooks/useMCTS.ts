'use client';

import { useRef, useCallback, useState } from 'react';
import { useStore } from '@/lib/store';
import { generateScenes } from '@/lib/ai';
import { NARRATIVE_CUBE } from '@/types/narrative';
import type { MCTSConfig, MCTSTree, MCTSRunState, MCTSNodeId, MCTSStatus, MCTSPhase } from '@/types/mcts';
import { DEFAULT_MCTS_CONFIG } from '@/types/mcts';
import {
  createTree,
  selectNode,
  pickDiverseDirections,
  addChildNode,
  markExpanded,
  backpropagate,
  bestPath,
  pruneToPath,
  getAncestorChain,
  nextNodeId,
  resetNodeCounter,
} from '@/lib/mcts-engine';
import { buildVirtualState, scoreArc, extractOrderedScenes } from '@/lib/mcts-state';

export function useMCTS() {
  const { state, dispatch } = useStore();
  const cancelledRef = useRef(false);
  const runningRef = useRef(false);

  // Persistent tree across runs (for tree reuse after commit)
  const retainedTreeRef = useRef<MCTSTree | null>(null);

  const [runState, setRunState] = useState<MCTSRunState>(() => {
    const narrative = state.activeNarrative;
    const tree = narrative
      ? createTree(narrative, state.resolvedSceneKeys, state.currentSceneIndex)
      : { nodes: {}, rootNarrative: {} as any, rootResolvedKeys: [], rootCurrentIndex: -1, rootChildIds: [] };
    return {
      status: 'idle' as const,
      tree,
      config: DEFAULT_MCTS_CONFIG,
      iterationsCompleted: 0,
      currentPhase: null,
      expandingNodeId: null,
      selectedPath: null,
      bestPath: null,
      startedAt: null,
      effectiveBaseline: null,
    };
  });

  const updatePhase = useCallback((phase: MCTSPhase | null, expandingNodeId: MCTSNodeId | null = null) => {
    setRunState((prev) => ({ ...prev, currentPhase: phase, expandingNodeId }));
  }, []);

  const updateTree = useCallback((tree: MCTSTree) => {
    setRunState((prev) => ({ ...prev, tree }));
  }, []);

  const updateStatus = useCallback((status: MCTSStatus) => {
    setRunState((prev) => ({ ...prev, status }));
  }, []);

  // ── Single MCTS iteration ─────────────────────────────────────────────────

  const runIteration = useCallback(async (
    tree: MCTSTree,
    config: MCTSConfig,
    activeBranchId: string,
    forceTargetId?: MCTSNodeId | 'root', // Override selection for baseline mode
  ): Promise<MCTSTree> => {
    // 1. SELECT — find the node to expand
    updatePhase('selecting');
    const targetId = forceTargetId ?? selectNode(tree, config);
    if (targetId === null) return tree; // fully expanded

    // Determine parent state for generation
    const isRoot = targetId === 'root';
    const parentNarrative = isRoot ? tree.rootNarrative : tree.nodes[targetId]!.virtualNarrative;
    const parentKeys = isRoot ? tree.rootResolvedKeys : tree.nodes[targetId]!.virtualResolvedKeys;
    const parentIndex = isRoot ? tree.rootCurrentIndex : tree.nodes[targetId]!.virtualCurrentIndex;

    // Get existing sibling cube goals and summaries to avoid duplication
    const existingSiblingIds = isRoot
      ? tree.rootChildIds
      : (tree.nodes[targetId]?.childIds ?? []);
    const existingSiblingGoals = existingSiblingIds.map((id) => tree.nodes[id]?.cubeGoal ?? null);
    const existingSiblings = existingSiblingIds
      .map((id) => tree.nodes[id])
      .filter(Boolean)
      .map((n) => ({
        name: n.arc.name,
        summary: n.scenes.map((s) => s.summary).join(' '),
      }));

    // 2. EXPAND — pick diverse directions and generate arcs in parallel
    updatePhase('expanding', targetId === 'root' ? null : targetId);
    const directions = pickDiverseDirections(config.branchingFactor, existingSiblingGoals);

    if (cancelledRef.current) return tree;

    // Build rejection list: existing siblings + the other directions in this batch
    // (since all calls in a batch fire in parallel, each one needs to know about the others)
    const batchPeerDescriptions = directions.map(({ cubeGoal }) => {
      const cube = cubeGoal ? NARRATIVE_CUBE[cubeGoal] : null;
      return cube ? `${cube.name} (${cube.description})` : 'alternative direction';
    });

    // Fire parallel LLM calls
    const results = await Promise.all(
      directions.map(({ direction, cubeGoal }, batchIdx) => {
        // Combine existing siblings with peer directions from this batch (excluding self)
        const peerHints = batchPeerDescriptions
          .filter((_, i) => i !== batchIdx)
          .map((desc) => ({ name: desc, summary: '' }));
        const rejectList = [...existingSiblings, ...peerHints];
        return generateScenes(
          parentNarrative,
          parentKeys,
          parentIndex,
          0, // dynamic — let the LLM choose scene count
          direction,
          undefined,
          cubeGoal,
          rejectList.length > 0 ? rejectList : undefined,
        ).catch((err) => {
          console.error('[mcts] generation error:', err);
          return null;
        });
      }),
    );

    if (cancelledRef.current) return tree;

    // 3. SCORE — score each generated arc and build virtual states
    updatePhase('scoring');
    let updatedTree = tree;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (!result) continue;

      const { scenes, arc } = result;
      const { direction, cubeGoal } = directions[i];

      // Build the ancestor chain for virtual state construction
      const ancestors = isRoot ? [] : getAncestorChain(updatedTree, targetId);
      const parentVirtual = buildVirtualState(
        tree.rootNarrative,
        tree.rootResolvedKeys,
        tree.rootCurrentIndex,
        [...ancestors, { scenes, arc } as any], // Include this node's data
        activeBranchId,
      );

      // Score using prior scenes for context
      const allPriorScenes = extractOrderedScenes(
        isRoot ? tree.rootNarrative : tree.nodes[targetId]!.virtualNarrative,
        isRoot ? tree.rootResolvedKeys : tree.nodes[targetId]!.virtualResolvedKeys,
      );
      const score = scoreArc(scenes, allPriorScenes);

      const nodeId = nextNodeId();
      updatedTree = addChildNode(
        updatedTree,
        isRoot ? 'root' : targetId,
        nodeId,
        scenes,
        arc,
        direction,
        cubeGoal,
        parentVirtual.narrative,
        parentVirtual.resolvedKeys,
        parentVirtual.currentIndex,
        score,
      );

      // 4. BACKPROPAGATE — propagate score up the tree
      updatePhase('backpropagating');
      updatedTree = backpropagate(updatedTree, nodeId);
    }

    // Mark the expanded node
    if (!isRoot && targetId) {
      updatedTree = markExpanded(updatedTree, targetId);
    }

    return updatedTree;
  }, [updatePhase]);

  // ── Main loop ──────────────────────────────────────────────────────────────

  const runLoop = useCallback(async (config: MCTSConfig) => {
    const { activeNarrative, resolvedSceneKeys, currentSceneIndex, activeBranchId } = state;
    if (!activeNarrative || !activeBranchId) return;

    let tree = retainedTreeRef.current ?? createTree(activeNarrative, resolvedSceneKeys, currentSceneIndex);
    retainedTreeRef.current = null;

    const startTime = Date.now();

    setRunState((prev) => ({
      ...prev,
      status: 'running',
      tree,
      config,
      iterationsCompleted: 0,
      currentPhase: null,
      expandingNodeId: null,
      bestPath: null,
      startedAt: startTime,
      effectiveBaseline: null,
    }));
    let iteration = 0;

    /** Check if we should stop based on timer/iteration limits */
    const shouldStop = () => {
      if (cancelledRef.current || !runningRef.current) return true;
      if (config.stopMode === 'timer') {
        return (Date.now() - startTime) / 1000 >= config.timeLimitSeconds;
      }
      return iteration >= config.totalIterations;
    };

    if (config.searchMode === 'baseline') {
      // ── Baseline mode: layer-by-layer ────────────────────────────────
      // At each depth, keep expanding until a node meets baselineScore.
      // branchingFactor is the batch size per expansion, but we don't cap
      // total branches — we keep generating until baseline is met or we
      // hit the stop condition. Once met, descend to the next depth.

      for (let depth = 0; depth < config.maxDepth; depth++) {
        if (shouldStop()) break;

        // Find the parent to expand: root for depth 0, best node at depth-1 otherwise
        let parentTarget: MCTSNodeId | 'root';
        if (depth === 0) {
          parentTarget = 'root';
        } else {
          // Pick the best-scoring node at the previous depth that met baseline
          const prevDepthNodes = Object.values(tree.nodes)
            .filter((n) => n.depth === depth - 1 && n.immediateScore >= config.baselineScore)
            .sort((a, b) => b.immediateScore - a.immediateScore);
          if (prevDepthNodes.length === 0) break; // no parent met baseline
          parentTarget = prevDepthNodes[0].id;
        }

        let layerMet = false;
        let layerBaseline = config.baselineScore;
        let currentEffective: number | null = null;
        let prevBestScore = -1;
        let staleRounds = 0;
        let staleThreshold = 3; // first relaxation after 3 stale rounds, then every 1

        while (!layerMet && !shouldStop()) {
          // Force expand the target parent — keeps adding siblings until baseline met
          tree = await runIteration(tree, config, activeBranchId, parentTarget);
          iteration++;
          if (cancelledRef.current) break;

          // Check if any node at this depth meets the (possibly relaxed) baseline
          const nodesAtDepth = Object.values(tree.nodes).filter((n) => n.depth === depth);
          const bestAtDepth = Math.max(...nodesAtDepth.map((n) => n.immediateScore), 0);
          layerMet = bestAtDepth >= layerBaseline;

          // Stagnation detection — if best score hasn't improved, count stale rounds
          if (bestAtDepth <= prevBestScore) {
            staleRounds++;
            if (staleRounds >= staleThreshold && !layerMet) {
              // Relax baseline by 5, floor at 50
              layerBaseline = Math.max(50, layerBaseline - 5);
              currentEffective = layerBaseline;
              staleRounds = 0;
              staleThreshold = 1; // after first relaxation, lower every stale round
              console.log(`[mcts] baseline relaxed to ${layerBaseline} at depth ${depth} (best: ${bestAtDepth})`);
              // Re-evaluate all existing nodes at this depth against the new baseline
              layerMet = nodesAtDepth.some((n) => n.immediateScore >= layerBaseline);
            }
          } else {
            prevBestScore = bestAtDepth;
            staleRounds = 0;
          }

          // Single state update per iteration — includes effectiveBaseline
          const best = bestPath(tree, config.pathStrategy);
          setRunState((prev) => ({
            ...prev,
            tree,
            iterationsCompleted: iteration,
            bestPath: best,
            ...(currentEffective != null ? { effectiveBaseline: currentEffective } : {}),
          }));
        }

        if (!layerMet) break;
      }
    } else {
      // ── Standard MCTS (exploit/explore) ──────────────────────────────
      while (!shouldStop()) {
        tree = await runIteration(tree, config, activeBranchId);
        iteration++;
        if (cancelledRef.current) break;

        const best = bestPath(tree, config.pathStrategy);
        setRunState((prev) => ({
          ...prev,
          tree,
          iterationsCompleted: iteration,
          bestPath: best,
        }));
      }
    }

    if (!cancelledRef.current) {
      setRunState((prev) => ({
        ...prev,
        status: 'complete',
        currentPhase: null,
        expandingNodeId: null,
      }));
    }

    runningRef.current = false;
  }, [state, runIteration]);

  // ── Controls ───────────────────────────────────────────────────────────────

  const start = useCallback((config: MCTSConfig = DEFAULT_MCTS_CONFIG) => {
    cancelledRef.current = false;
    runningRef.current = true;
    resetNodeCounter();
    runLoop(config);
  }, [runLoop]);

  const pause = useCallback(() => {
    runningRef.current = false;
    updateStatus('paused');
  }, [updateStatus]);

  const resume = useCallback(() => {
    if (runState.status !== 'paused') return;
    cancelledRef.current = false;
    runningRef.current = true;
    updateStatus('running');

    // Continue remaining iterations
    const remaining = runState.config.totalIterations - runState.iterationsCompleted;
    if (remaining <= 0) return;

    const { activeBranchId } = state;
    if (!activeBranchId) return;

    (async () => {
      let tree = runState.tree;
      for (let i = 0; i < remaining; i++) {
        if (cancelledRef.current || !runningRef.current) break;
        tree = await runIteration(tree, runState.config, activeBranchId);
        if (cancelledRef.current) break;
        const best = bestPath(tree, runState.config.pathStrategy);
        setRunState((prev) => ({
          ...prev,
          tree,
          iterationsCompleted: prev.iterationsCompleted + 1,
          bestPath: best,
        }));
      }
      if (!cancelledRef.current) {
        setRunState((prev) => ({ ...prev, status: 'complete', currentPhase: null, expandingNodeId: null }));
      }
      runningRef.current = false;
    })();
  }, [runState, state, runIteration]);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    runningRef.current = false;
    retainedTreeRef.current = null;
    const narrative = state.activeNarrative;
    setRunState((prev) => ({
      ...prev,
      status: 'idle',
      iterationsCompleted: 0,
      currentPhase: null,
      expandingNodeId: null,
      selectedPath: null,
      bestPath: null,
      startedAt: null,
      effectiveBaseline: null,
      tree: narrative
        ? createTree(narrative, state.resolvedSceneKeys, state.currentSceneIndex)
        : { nodes: {}, rootNarrative: {} as any, rootResolvedKeys: [], rootCurrentIndex: -1, rootChildIds: [] },
    }));
  }, [state]);

  const continueSearch = useCallback((additionalIterations: number) => {
    if (runState.status !== 'complete' && runState.status !== 'idle') return;
    const { activeBranchId } = state;
    if (!activeBranchId) return;

    cancelledRef.current = false;
    runningRef.current = true;

    const newTotal = runState.iterationsCompleted + additionalIterations;
    setRunState((prev) => ({
      ...prev,
      status: 'running',
      config: { ...prev.config, totalIterations: newTotal },
      currentPhase: null,
      expandingNodeId: null,
      startedAt: Date.now(),
    }));

    (async () => {
      let tree = runState.tree;
      for (let i = 0; i < additionalIterations; i++) {
        if (cancelledRef.current || !runningRef.current) break;
        tree = await runIteration(tree, runState.config, activeBranchId);
        if (cancelledRef.current) break;
        const best = bestPath(tree, runState.config.pathStrategy);
        setRunState((prev) => ({
          ...prev,
          tree,
          iterationsCompleted: prev.iterationsCompleted + 1,
          bestPath: best,
        }));
      }
      if (!cancelledRef.current) {
        setRunState((prev) => ({ ...prev, status: 'complete', currentPhase: null, expandingNodeId: null }));
      }
      runningRef.current = false;
    })();
  }, [runState, state, runIteration]);

  const selectPath = useCallback((path: MCTSNodeId[]) => {
    setRunState((prev) => ({ ...prev, selectedPath: path }));
  }, []);

  const commitPath = useCallback(() => {
    const path = runState.selectedPath ?? runState.bestPath;
    if (!path || path.length === 0) return;

    const { activeBranchId } = state;
    if (!activeBranchId) return;

    // Apply each arc to the real store in order
    for (const nodeId of path) {
      const node = runState.tree.nodes[nodeId];
      if (!node) continue;
      dispatch({
        type: 'BULK_ADD_SCENES',
        scenes: node.scenes,
        arc: node.arc,
        branchId: activeBranchId,
      });
    }

    // Prune tree for reuse — retain subtree below committed leaf
    const pruned = pruneToPath(runState.tree, path);
    retainedTreeRef.current = pruned;

    // Reset state
    setRunState((prev) => ({
      ...prev,
      status: 'idle',
      iterationsCompleted: 0,
      currentPhase: null,
      expandingNodeId: null,
      selectedPath: null,
      bestPath: null,
      startedAt: null,
      effectiveBaseline: null,
      tree: pruned ?? createTree(state.activeNarrative!, state.resolvedSceneKeys, state.currentSceneIndex),
    }));
  }, [runState, state, dispatch]);

  return {
    runState,
    start,
    pause,
    resume,
    stop,
    selectPath,
    commitPath,
    continueSearch,
  };
}
