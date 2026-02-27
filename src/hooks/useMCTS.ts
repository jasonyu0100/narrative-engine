'use client';

import { useRef, useCallback, useState } from 'react';
import { useStore } from '@/lib/store';
import { generateScenes } from '@/lib/ai';
import type { NarrativeState, Scene, CubeCornerKey, WorldBuildCommit } from '@/types/narrative';
import type { MCTSConfig, MCTSTree, MCTSRunState, MCTSNodeId, MCTSStatus, MCTSPhase, MCTSNode, BeatDirection } from '@/types/mcts';
import { DEFAULT_MCTS_CONFIG } from '@/types/mcts';
import type { Arc } from '@/types/narrative';
import {
  createTree,
  selectNode,
  pickNextDirection,
  addChildNode,
  markExpanded,
  backpropagate,
  bestPath,
  pruneToPath,
  getAncestorChain,
  nextNodeId,
  resetNodeCounter,
  MAX_NODE_CHILDREN,
} from '@/lib/mcts-engine';
import { buildVirtualState, scoreArc, extractOrderedScenes } from '@/lib/mcts-state';

type ExpansionResult = {
  targetId: MCTSNodeId | 'root';
  scenes: Scene[];
  arc: Arc;
  direction: string;
  cubeGoal: CubeCornerKey | null;
  beatGoal: BeatDirection | null;
  virtualNarrative: NarrativeState;
  virtualResolvedKeys: string[];
  virtualCurrentIndex: number;
  score: number;
};

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

  const updateStatus = useCallback((status: MCTSStatus) => {
    setRunState((prev) => ({ ...prev, status }));
  }, []);

  // ── Single MCTS expansion ─────────────────────────────────────────────────

  /**
   * Execute one MCTS expansion: generate a single arc for the given parent node,
   * score it, compute virtual state, and return the result for merging into the tree.
   * All parent data is pre-computed synchronously before this async function is called.
   */
  const runSingleExpansion = useCallback(async (
    targetId: MCTSNodeId | 'root',
    parentNarrative: NarrativeState,
    parentKeys: string[],
    parentIndex: number,
    direction: string,
    cubeGoal: CubeCornerKey | null,
    beatGoal: BeatDirection | null,
    ancestorChain: MCTSNode[],
    allPriorScenes: Scene[],
    existingSiblings: { name: string; summary: string }[],
    activeBranchId: string,
    rootNarrative: NarrativeState,
    rootResolvedKeys: string[],
    rootCurrentIndex: number,
    worldBuildFocus: WorldBuildCommit | undefined,
  ): Promise<ExpansionResult | null> => {
    updatePhase('expanding', targetId === 'root' ? null : targetId);

    const result = await generateScenes(
      parentNarrative, parentKeys, parentIndex, 0,
      direction, undefined, cubeGoal ?? undefined,
      existingSiblings.length > 0 ? existingSiblings : undefined,
      worldBuildFocus,
    ).catch((err) => { console.error('[mcts] generation error:', err); return null; });

    if (!result || cancelledRef.current) return null;

    updatePhase('scoring');
    const { scenes, arc } = result;

    const parentVirtual = buildVirtualState(
      rootNarrative, rootResolvedKeys, rootCurrentIndex,
      [...ancestorChain, { scenes, arc } as any],
      activeBranchId,
    );
    const score = scoreArc(scenes, allPriorScenes);

    return {
      targetId, scenes, arc, direction, cubeGoal, beatGoal,
      virtualNarrative: parentVirtual.narrative,
      virtualResolvedKeys: parentVirtual.resolvedKeys,
      virtualCurrentIndex: parentVirtual.currentIndex,
      score,
    };
  }, [updatePhase]);

  // ── Main loop ──────────────────────────────────────────────────────────────

  const runLoop = useCallback(async (config: MCTSConfig) => {
    const { activeNarrative, resolvedSceneKeys, currentSceneIndex, activeBranchId } = state;
    if (!activeNarrative || !activeBranchId) return;

    let tree = retainedTreeRef.current ?? createTree(activeNarrative, resolvedSceneKeys, currentSceneIndex);
    retainedTreeRef.current = null;
    const worldBuildFocus = config.worldBuildFocusId
      ? activeNarrative.worldBuilds[config.worldBuildFocusId]
      : undefined;

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

    let nodesGenerated = 0;

    const shouldStop = () => {
      if (cancelledRef.current || !runningRef.current) return true;
      if (config.stopMode === 'timer') {
        return (Date.now() - startTime) / 1000 >= config.timeLimitSeconds;
      }
      return nodesGenerated >= config.maxNodes;
    };

    // Sync helper: snapshot parent data from current tree for a new slot
    const prepareSlot = (
      targetId: MCTSNodeId | 'root',
      inFlightGoals: Map<MCTSNodeId | 'root', (string | null)[]>,
    ) => {
      const isRoot = targetId === 'root';
      const parentNode = isRoot ? null : tree.nodes[targetId];
      const parentNarrative = isRoot ? tree.rootNarrative : parentNode?.virtualNarrative;
      const parentKeys = isRoot ? tree.rootResolvedKeys : parentNode?.virtualResolvedKeys;
      const parentIndex = isRoot ? tree.rootCurrentIndex : parentNode?.virtualCurrentIndex;

      if (!parentNarrative || !parentKeys || parentIndex == null) return null;

      const siblingIds = isRoot ? tree.rootChildIds : (parentNode?.childIds ?? []);
      const existingGoals = siblingIds.map((id) => {
        const n = tree.nodes[id];
        return (n?.cubeGoal ?? n?.beatGoal ?? null);
      });
      const currentInFlight = inFlightGoals.get(targetId) ?? [];
      const allUsedGoals = [...existingGoals, ...currentInFlight];

      const { direction, cubeGoal, beatGoal } = pickNextDirection(
        allUsedGoals,
        config.searchMode,
        config.directionMode,
        parentNode?.cubeGoal ?? null,
        config.randomDirections,
      );

      const existingSiblings = siblingIds
        .map((id) => tree.nodes[id])
        .filter(Boolean)
        .map((n) => ({ name: n.arc.name, summary: n.scenes.map((s) => s.summary).join(' ') }));

      const ancestorChain = isRoot ? [] : getAncestorChain(tree, targetId);
      const allPriorScenes = extractOrderedScenes(parentNarrative, parentKeys);

      return { targetId, direction, cubeGoal, beatGoal, parentNarrative, parentKeys, parentIndex, ancestorChain, allPriorScenes, existingSiblings };
    };

    if (config.searchMode === 'baseline') {
      // ── Baseline mode: layer-by-layer, sequential ─────────────────────
      // At each depth, keep adding children to the target parent until a node
      // meets the baseline score. No parallel slots — sequential expansions.
      // No child limit per node (cube positions can be retried).

      for (let depth = 0; depth < config.maxDepth; depth++) {
        if (shouldStop()) break;

        let parentTarget: MCTSNodeId | 'root';
        if (depth === 0) {
          parentTarget = 'root';
        } else {
          const prevDepthNodes = Object.values(tree.nodes)
            .filter((n) => n.depth === depth - 1 && n.immediateScore >= config.baselineScore)
            .sort((a, b) => b.immediateScore - a.immediateScore);
          if (prevDepthNodes.length === 0) break;
          parentTarget = prevDepthNodes[0].id;
        }

        let layerMet = false;
        let layerBaseline = config.baselineScore;
        let currentEffective: number | null = null;
        let prevBestScore = -1;
        let staleRounds = 0;
        let staleThreshold = 3;

        const inFlightGoals = new Map<MCTSNodeId | 'root', (string | null)[]>();

        while (!layerMet && !shouldStop()) {
          const prep = prepareSlot(parentTarget, inFlightGoals);
          if (!prep) break;

          const result = await runSingleExpansion(
            prep.targetId, prep.parentNarrative, prep.parentKeys, prep.parentIndex,
            prep.direction, prep.cubeGoal, prep.beatGoal, prep.ancestorChain, prep.allPriorScenes,
            prep.existingSiblings, activeBranchId,
            tree.rootNarrative, tree.rootResolvedKeys, tree.rootCurrentIndex, worldBuildFocus,
          );

          if (cancelledRef.current) break;
          nodesGenerated++;

          if (result) {
            const nodeId = nextNodeId();
            tree = addChildNode(
              tree, result.targetId === 'root' ? 'root' : result.targetId,
              nodeId, result.scenes, result.arc, result.direction, result.cubeGoal, result.beatGoal,
              result.virtualNarrative, result.virtualResolvedKeys, result.virtualCurrentIndex,
              result.score,
            );
            tree = backpropagate(tree, nodeId);
          }

          const nodesAtDepth = Object.values(tree.nodes).filter((n) => n.depth === depth);
          const bestAtDepth = Math.max(...nodesAtDepth.map((n) => n.immediateScore), 0);
          layerMet = bestAtDepth >= layerBaseline;

          if (bestAtDepth <= prevBestScore) {
            staleRounds++;
            if (staleRounds >= staleThreshold && !layerMet) {
              layerBaseline = Math.max(50, layerBaseline - 5);
              currentEffective = layerBaseline;
              staleRounds = 0;
              staleThreshold = 1;
              layerMet = nodesAtDepth.some((n) => n.immediateScore >= layerBaseline);
            }
          } else {
            prevBestScore = bestAtDepth;
            staleRounds = 0;
          }

          const best = bestPath(tree, config.pathStrategy);
          setRunState((prev) => ({
            ...prev,
            tree,
            iterationsCompleted: nodesGenerated,
            bestPath: best,
            ...(currentEffective != null ? { effectiveBaseline: currentEffective } : {}),
          }));
        }

        if (!layerMet) break;
      }

    } else {
      // ── Standard MCTS (exploit/explore): parallel sliding window ─────
      // Maintain `parallelism` concurrent generation slots. Each slot independently
      // selects the most promising unexpanded node via UCB1, generates one arc,
      // and immediately feeds the result back into the tree. When a slot finishes,
      // a new one starts — keeping the window full at all times.

      type SlotEntry = {
        seq: number;
        targetId: MCTSNodeId | 'root';
        goal: string | null;
        promise: Promise<{ result: ExpansionResult | null; seq: number }>;
      };

      const inFlightCounts = new Map<MCTSNodeId | 'root', number>();
      const inFlightGoals = new Map<MCTSNodeId | 'root', (string | null)[]>();
      const activeSlots: SlotEntry[] = [];
      let slotSeq = 0;

      const tryStartSlot = (): boolean => {
        if (cancelledRef.current || shouldStop()) return false;
        const targetId = selectNode(tree, config, inFlightCounts);
        if (!targetId) return false;

        const prep = prepareSlot(targetId, inFlightGoals);
        if (!prep) return false;

        // Register in-flight (use whichever goal is set)
        const goal = prep.cubeGoal ?? prep.beatGoal;
        inFlightCounts.set(targetId, (inFlightCounts.get(targetId) ?? 0) + 1);
        inFlightGoals.set(targetId, [...(inFlightGoals.get(targetId) ?? []), goal]);

        const seq = slotSeq++;
        const promise = runSingleExpansion(
          prep.targetId, prep.parentNarrative, prep.parentKeys, prep.parentIndex,
          prep.direction, prep.cubeGoal, prep.beatGoal, prep.ancestorChain, prep.allPriorScenes,
          prep.existingSiblings, activeBranchId,
          tree.rootNarrative, tree.rootResolvedKeys, tree.rootCurrentIndex, worldBuildFocus,
        ).then((result) => ({ result, seq }));

        activeSlots.push({ seq, targetId, goal, promise });
        updatePhase('expanding', targetId === 'root' ? null : targetId);
        return true;
      };

      // Fill initial slots
      for (let i = 0; i < config.parallelism; i++) {
        if (!tryStartSlot()) break;
      }

      // Sliding window: wait for first to finish, apply, start replacement
      while (activeSlots.length > 0 && !cancelledRef.current) {
        if (shouldStop() && activeSlots.length === 0) break;

        const { result, seq } = await Promise.race(activeSlots.map((s) => s.promise));

        const completedIdx = activeSlots.findIndex((s) => s.seq === seq);
        if (completedIdx === -1) continue;
        const completed = activeSlots.splice(completedIdx, 1)[0];

        // Release in-flight slot
        const newCount = (inFlightCounts.get(completed.targetId) ?? 1) - 1;
        if (newCount <= 0) inFlightCounts.delete(completed.targetId);
        else inFlightCounts.set(completed.targetId, newCount);

        const targetGoals = inFlightGoals.get(completed.targetId) ?? [];
        const goalIdx = targetGoals.indexOf(completed.goal);
        if (goalIdx >= 0) targetGoals.splice(goalIdx, 1);
        if (targetGoals.length === 0) inFlightGoals.delete(completed.targetId);

        if (result && !cancelledRef.current) {
          const nodeId = nextNodeId();
          tree = addChildNode(
            tree, result.targetId === 'root' ? 'root' : result.targetId,
            nodeId, result.scenes, result.arc, result.direction, result.cubeGoal, result.beatGoal,
            result.virtualNarrative, result.virtualResolvedKeys, result.virtualCurrentIndex,
            result.score,
          );

          updatePhase('backpropagating');
          tree = backpropagate(tree, nodeId);

          // Mark parent expanded when all 8 cube corners have been tried
          if (result.targetId !== 'root') {
            const parent = tree.nodes[result.targetId];
            if (parent && parent.childIds.length >= MAX_NODE_CHILDREN) {
              tree = markExpanded(tree, result.targetId);
            }
          }

          nodesGenerated++;
          const best = bestPath(tree, config.pathStrategy);
          setRunState((prev) => ({
            ...prev,
            tree,
            iterationsCompleted: nodesGenerated,
            bestPath: best,
          }));
        }

        // Start a replacement slot if we haven't hit the stop condition
        if (!shouldStop() && !cancelledRef.current) {
          tryStartSlot();
        }
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
  }, [state, runSingleExpansion]);

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

    const remaining = runState.config.maxNodes - runState.iterationsCompleted;
    if (remaining <= 0) return;

    const { activeBranchId } = state;
    if (!activeBranchId) return;

    (async () => {
      let tree = runState.tree;
      let generated = runState.iterationsCompleted;
      const worldBuildFocus = runState.config.worldBuildFocusId
        ? tree.rootNarrative.worldBuilds[runState.config.worldBuildFocusId]
        : undefined;

      const inFlightCounts = new Map<MCTSNodeId | 'root', number>();
      const inFlightGoals = new Map<MCTSNodeId | 'root', (string | null)[]>();

      type SlotEntry = {
        seq: number;
        targetId: MCTSNodeId | 'root';
        goal: string | null;
        promise: Promise<{ result: ExpansionResult | null; seq: number }>;
      };
      const activeSlots: SlotEntry[] = [];
      let slotSeq = 0;

      const shouldStop = () => cancelledRef.current || !runningRef.current ||
        (runState.config.stopMode === 'iterations' && generated >= runState.config.maxNodes);

      const tryStart = () => {
        if (shouldStop()) return false;
        const targetId = selectNode(tree, runState.config, inFlightCounts);
        if (!targetId) return false;

        const isRoot = targetId === 'root';
        const parentNode = isRoot ? null : tree.nodes[targetId];
        const parentNarrative = isRoot ? tree.rootNarrative : parentNode?.virtualNarrative;
        const parentKeys = isRoot ? tree.rootResolvedKeys : parentNode?.virtualResolvedKeys;
        const parentIndex = isRoot ? tree.rootCurrentIndex : parentNode?.virtualCurrentIndex;
        if (!parentNarrative || !parentKeys || parentIndex == null) return false;

        const siblingIds = isRoot ? tree.rootChildIds : (parentNode?.childIds ?? []);
        const existingGoals = siblingIds.map((id) => {
          const n = tree.nodes[id];
          return (n?.cubeGoal ?? n?.beatGoal ?? null);
        });
        const currentInFlight = inFlightGoals.get(targetId) ?? [];
        const { direction, cubeGoal, beatGoal } = pickNextDirection(
          [...existingGoals, ...currentInFlight], runState.config.searchMode, runState.config.directionMode,
          parentNode?.cubeGoal ?? null, runState.config.randomDirections,
        );
        const existingSiblings = siblingIds.map((id) => tree.nodes[id]).filter(Boolean)
          .map((n) => ({ name: n.arc.name, summary: n.scenes.map((s) => s.summary).join(' ') }));
        const ancestorChain = isRoot ? [] : getAncestorChain(tree, targetId);
        const allPriorScenes = extractOrderedScenes(parentNarrative, parentKeys);

        const goal = cubeGoal ?? beatGoal;
        inFlightCounts.set(targetId, (inFlightCounts.get(targetId) ?? 0) + 1);
        inFlightGoals.set(targetId, [...(inFlightGoals.get(targetId) ?? []), goal]);

        const seq = slotSeq++;
        const promise = runSingleExpansion(
          targetId, parentNarrative, parentKeys, parentIndex,
          direction, cubeGoal, beatGoal, ancestorChain, allPriorScenes, existingSiblings,
          activeBranchId, tree.rootNarrative, tree.rootResolvedKeys, tree.rootCurrentIndex, worldBuildFocus,
        ).then((result) => ({ result, seq }));
        activeSlots.push({ seq, targetId, goal, promise });
        return true;
      };

      for (let i = 0; i < runState.config.parallelism; i++) {
        if (!tryStart()) break;
      }

      while (activeSlots.length > 0 && !cancelledRef.current) {
        const { result, seq } = await Promise.race(activeSlots.map((s) => s.promise));
        const idx = activeSlots.findIndex((s) => s.seq === seq);
        if (idx === -1) continue;
        const completed = activeSlots.splice(idx, 1)[0];

        const newCount = (inFlightCounts.get(completed.targetId) ?? 1) - 1;
        if (newCount <= 0) inFlightCounts.delete(completed.targetId);
        else inFlightCounts.set(completed.targetId, newCount);
        const goals = inFlightGoals.get(completed.targetId) ?? [];
        const gi = goals.indexOf(completed.goal);
        if (gi >= 0) goals.splice(gi, 1);
        if (goals.length === 0) inFlightGoals.delete(completed.targetId);

        if (result && !cancelledRef.current) {
          const nodeId = nextNodeId();
          tree = addChildNode(tree, result.targetId === 'root' ? 'root' : result.targetId,
            nodeId, result.scenes, result.arc, result.direction, result.cubeGoal, result.beatGoal,
            result.virtualNarrative, result.virtualResolvedKeys, result.virtualCurrentIndex, result.score);
          tree = backpropagate(tree, nodeId);
          if (result.targetId !== 'root') {
            const parent = tree.nodes[result.targetId];
            if (parent && parent.childIds.length >= MAX_NODE_CHILDREN) tree = markExpanded(tree, result.targetId);
          }
          generated++;
          const best = bestPath(tree, runState.config.pathStrategy);
          setRunState((prev) => ({ ...prev, tree, iterationsCompleted: generated, bestPath: best }));
        }
        if (!shouldStop()) tryStart();
      }

      if (!cancelledRef.current) {
        setRunState((prev) => ({ ...prev, status: 'complete', currentPhase: null, expandingNodeId: null }));
      }
      runningRef.current = false;
    })();
  }, [runState, state, runSingleExpansion]);

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

  const continueSearch = useCallback((additionalNodes: number) => {
    if (runState.status !== 'complete' && runState.status !== 'idle') return;
    const { activeBranchId } = state;
    if (!activeBranchId) return;

    cancelledRef.current = false;
    runningRef.current = true;

    const newMax = runState.iterationsCompleted + additionalNodes;
    const updatedConfig = { ...runState.config, maxNodes: newMax };

    setRunState((prev) => ({
      ...prev,
      status: 'running',
      config: updatedConfig,
      currentPhase: null,
      expandingNodeId: null,
      startedAt: Date.now(),
    }));

    // Use same sliding window as resume — inline implementation
    (async () => {
      let tree = runState.tree;
      let generated = runState.iterationsCompleted;
      const worldBuildFocus = updatedConfig.worldBuildFocusId
        ? tree.rootNarrative.worldBuilds[updatedConfig.worldBuildFocusId]
        : undefined;

      const inFlightCounts = new Map<MCTSNodeId | 'root', number>();
      const inFlightGoals = new Map<MCTSNodeId | 'root', (string | null)[]>();

      type SlotEntry = {
        seq: number;
        targetId: MCTSNodeId | 'root';
        goal: string | null;
        promise: Promise<{ result: ExpansionResult | null; seq: number }>;
      };
      const activeSlots: SlotEntry[] = [];
      let slotSeq = 0;

      const shouldStop = () => cancelledRef.current || !runningRef.current || generated >= newMax;

      const tryStart = () => {
        if (shouldStop()) return false;
        const targetId = selectNode(tree, updatedConfig, inFlightCounts);
        if (!targetId) return false;
        const isRoot = targetId === 'root';
        const parentNode = isRoot ? null : tree.nodes[targetId];
        const parentNarrative = isRoot ? tree.rootNarrative : parentNode?.virtualNarrative;
        const parentKeys = isRoot ? tree.rootResolvedKeys : parentNode?.virtualResolvedKeys;
        const parentIndex = isRoot ? tree.rootCurrentIndex : parentNode?.virtualCurrentIndex;
        if (!parentNarrative || !parentKeys || parentIndex == null) return false;

        const siblingIds = isRoot ? tree.rootChildIds : (parentNode?.childIds ?? []);
        const existingGoals = siblingIds.map((id) => {
          const n = tree.nodes[id];
          return (n?.cubeGoal ?? n?.beatGoal ?? null);
        });
        const currentInFlight = inFlightGoals.get(targetId) ?? [];
        const { direction, cubeGoal, beatGoal } = pickNextDirection(
          [...existingGoals, ...currentInFlight], updatedConfig.searchMode, updatedConfig.directionMode,
          parentNode?.cubeGoal ?? null, updatedConfig.randomDirections,
        );
        const existingSiblings = siblingIds.map((id) => tree.nodes[id]).filter(Boolean)
          .map((n) => ({ name: n.arc.name, summary: n.scenes.map((s) => s.summary).join(' ') }));
        const ancestorChain = isRoot ? [] : getAncestorChain(tree, targetId);
        const allPriorScenes = extractOrderedScenes(parentNarrative, parentKeys);

        const goal = cubeGoal ?? beatGoal;
        inFlightCounts.set(targetId, (inFlightCounts.get(targetId) ?? 0) + 1);
        inFlightGoals.set(targetId, [...(inFlightGoals.get(targetId) ?? []), goal]);

        const seq = slotSeq++;
        const promise = runSingleExpansion(
          targetId, parentNarrative, parentKeys, parentIndex,
          direction, cubeGoal, beatGoal, ancestorChain, allPriorScenes, existingSiblings,
          activeBranchId, tree.rootNarrative, tree.rootResolvedKeys, tree.rootCurrentIndex, worldBuildFocus,
        ).then((result) => ({ result, seq }));
        activeSlots.push({ seq, targetId, goal, promise });
        return true;
      };

      for (let i = 0; i < updatedConfig.parallelism; i++) {
        if (!tryStart()) break;
      }

      while (activeSlots.length > 0 && !cancelledRef.current) {
        const { result, seq } = await Promise.race(activeSlots.map((s) => s.promise));
        const idx = activeSlots.findIndex((s) => s.seq === seq);
        if (idx === -1) continue;
        const completed = activeSlots.splice(idx, 1)[0];

        const newCount = (inFlightCounts.get(completed.targetId) ?? 1) - 1;
        if (newCount <= 0) inFlightCounts.delete(completed.targetId);
        else inFlightCounts.set(completed.targetId, newCount);
        const goals = inFlightGoals.get(completed.targetId) ?? [];
        const gi = goals.indexOf(completed.goal);
        if (gi >= 0) goals.splice(gi, 1);
        if (goals.length === 0) inFlightGoals.delete(completed.targetId);

        if (result && !cancelledRef.current) {
          const nodeId = nextNodeId();
          tree = addChildNode(tree, result.targetId === 'root' ? 'root' : result.targetId,
            nodeId, result.scenes, result.arc, result.direction, result.cubeGoal, result.beatGoal,
            result.virtualNarrative, result.virtualResolvedKeys, result.virtualCurrentIndex, result.score);
          tree = backpropagate(tree, nodeId);
          if (result.targetId !== 'root') {
            const parent = tree.nodes[result.targetId];
            if (parent && parent.childIds.length >= MAX_NODE_CHILDREN) tree = markExpanded(tree, result.targetId);
          }
          generated++;
          const best = bestPath(tree, updatedConfig.pathStrategy);
          setRunState((prev) => ({ ...prev, tree, iterationsCompleted: generated, bestPath: best }));
        }
        if (!shouldStop()) tryStart();
      }

      if (!cancelledRef.current) {
        setRunState((prev) => ({ ...prev, status: 'complete', currentPhase: null, expandingNodeId: null }));
      }
      runningRef.current = false;
    })();
  }, [runState, state, runSingleExpansion]);

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
