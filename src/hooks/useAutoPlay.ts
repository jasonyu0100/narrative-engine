'use client';

import { useRef, useCallback, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { evaluateNarrativeState, checkEndConditions, pickArcLength, buildActionDirective, pickCubeGoal, isWorldBuildDue } from '@/lib/auto-engine';
import { generateScenes, expandWorld, suggestWorldExpansion } from '@/lib/ai';
import { nextId } from '@/lib/narrative-utils';
import type { AutoRunLog } from '@/types/narrative';

export function useAutoPlay() {
  const { state, dispatch } = useStore();
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const runCycle = useCallback(async () => {
    const { activeNarrative, resolvedSceneKeys, currentSceneIndex, activeBranchId, autoConfig, autoRunState } = stateRef.current;
    if (!activeNarrative || !activeBranchId || !autoRunState) return;

    // Check end conditions
    const endMet = checkEndConditions(activeNarrative, resolvedSceneKeys, autoConfig, autoRunState.startingSceneCount, autoRunState.startingArcCount);
    if (endMet) {
      dispatch({
        type: 'LOG_AUTO_CYCLE',
        entry: {
          cycle: autoRunState.currentCycle + 1,
          timestamp: Date.now(),
          action: 'LHL',
          reason: `End condition met: ${endMet.type}`,
          scenesGenerated: 0,
          worldExpanded: false,
          endConditionMet: endMet,
        },
      });
      dispatch({ type: 'STOP_AUTO_RUN' });
      return;
    }

    // Evaluate and pick action
    const weights = evaluateNarrativeState(
      activeNarrative,
      resolvedSceneKeys,
      currentSceneIndex,
      autoConfig,
    );
    const chosen = weights[0];
    if (!chosen) {
      dispatch({ type: 'STOP_AUTO_RUN' });
      return;
    }

    const action = chosen.action;
    let scenesGenerated = 0;
    let worldExpanded = false;

    try {
      // World expansion as a pre-step (interval-triggered, not scored)
      if (isWorldBuildDue(activeNarrative, resolvedSceneKeys, autoConfig)) {
        const suggestion = await suggestWorldExpansion(activeNarrative, resolvedSceneKeys, currentSceneIndex);
        if (cancelledRef.current) return;

        const expansion = await expandWorld(activeNarrative, resolvedSceneKeys, currentSceneIndex, suggestion);
        if (cancelledRef.current) return;

        dispatch({
          type: 'EXPAND_WORLD',
          wxId: nextId('WX', Object.keys(activeNarrative.worldBuilds), 3),
          characters: expansion.characters,
          locations: expansion.locations,
          threads: expansion.threads,
          relationships: expansion.relationships,
          branchId: activeBranchId,
        });
        worldExpanded = true;
      }

      // Generate arc toward the chosen cube corner
      const directive = buildActionDirective(action, activeNarrative, resolvedSceneKeys, autoConfig);
      const sceneCount = pickArcLength(autoConfig, action);
      const cubeGoal = pickCubeGoal(action, activeNarrative, resolvedSceneKeys, autoConfig);
      const { scenes, arc } = await generateScenes(
        activeNarrative,
        resolvedSceneKeys,
        currentSceneIndex,
        sceneCount,
        directive,
        undefined,
        cubeGoal,
      );
      if (cancelledRef.current) return;

      dispatch({
        type: 'BULK_ADD_SCENES',
        scenes,
        arc,
        branchId: activeBranchId,
      });
      scenesGenerated = scenes.length;
    } catch (err) {
      // Log error but don't crash the loop
      console.error('[auto-play] cycle error:', err);
    }

    if (cancelledRef.current) return;

    // Log the cycle
    const logEntry: AutoRunLog = {
      cycle: autoRunState.currentCycle + 1,
      timestamp: Date.now(),
      action,
      reason: chosen.reason,
      scenesGenerated,
      worldExpanded,
      endConditionMet: null,
    };
    dispatch({ type: 'LOG_AUTO_CYCLE', entry: logEntry });
  }, [dispatch]);

  // The loop: run a cycle, then immediately continue
  const tick = useCallback(async () => {
    if (cancelledRef.current || !runningRef.current) return;

    await runCycle();

    if (cancelledRef.current || !runningRef.current) return;

    // Continue immediately — no pause between cycles
    timeoutRef.current = setTimeout(() => tick(), 100);
  }, [runCycle]);

  const start = useCallback(() => {
    cancelledRef.current = false;
    runningRef.current = true;
    dispatch({ type: 'START_AUTO_RUN' });
    // Kick off after a brief delay to let state settle
    timeoutRef.current = setTimeout(() => tick(), 500);
  }, [dispatch, tick]);

  const pause = useCallback(() => {
    runningRef.current = false;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    dispatch({ type: 'PAUSE_AUTO_RUN' });
  }, [dispatch]);

  const resume = useCallback(() => {
    cancelledRef.current = false;
    runningRef.current = true;
    dispatch({ type: 'RESUME_AUTO_RUN' });
    timeoutRef.current = setTimeout(() => tick(), 500);
  }, [dispatch, tick]);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    runningRef.current = false;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    dispatch({ type: 'STOP_AUTO_RUN' });
  }, [dispatch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      runningRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Stop if autoRunState goes away or is stopped externally
  useEffect(() => {
    if (!state.autoRunState?.isRunning && runningRef.current) {
      runningRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }, [state.autoRunState?.isRunning]);

  return {
    start,
    pause,
    resume,
    stop,
    isRunning: state.autoRunState?.isRunning ?? false,
    isPaused: state.autoRunState?.isPaused ?? false,
    currentCycle: state.autoRunState?.currentCycle ?? 0,
    log: state.autoRunState?.log ?? [],
  };
}

