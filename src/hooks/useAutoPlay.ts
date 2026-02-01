'use client';

import { useRef, useCallback, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { evaluateNarrativeState, checkEndConditions, pickArcLength, buildActionDirective } from '@/lib/auto-engine';
import { generateScenes, expandWorld, suggestWorldExpansion } from '@/lib/ai';
import type { AutoAction, AutoRunLog } from '@/types/narrative';

export function useAutoPlay() {
  const { state, dispatch } = useStore();
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  const runCycle = useCallback(async () => {
    const { activeNarrative, resolvedSceneKeys, currentSceneIndex, activeBranchId, autoConfig, autoRunState } = state;
    if (!activeNarrative || !activeBranchId || !autoRunState) return;

    // Check end conditions
    const endMet = checkEndConditions(activeNarrative, resolvedSceneKeys, autoConfig);
    if (endMet) {
      dispatch({
        type: 'LOG_AUTO_CYCLE',
        entry: {
          cycle: autoRunState.currentCycle + 1,
          timestamp: Date.now(),
          action: 'generate_arc',
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
      if (action === 'expand_world') {
        // World expansion cycle
        const suggestion = await suggestWorldExpansion(activeNarrative, resolvedSceneKeys, currentSceneIndex);
        if (cancelledRef.current) return;

        const directive = buildActionDirective(action, activeNarrative, resolvedSceneKeys, autoConfig);
        const expansion = await expandWorld(activeNarrative, resolvedSceneKeys, currentSceneIndex, `${directive}\n\n${suggestion}`);
        if (cancelledRef.current) return;

        dispatch({
          type: 'EXPAND_WORLD',
          wxId: `WX-${Date.now()}`,
          characters: expansion.characters,
          locations: expansion.locations,
          threads: expansion.threads,
          relationships: expansion.relationships,
          branchId: activeBranchId,
        });
        worldExpanded = true;
      } else {
        // All other actions generate an arc with scenes
        const directive = buildActionDirective(action, activeNarrative, resolvedSceneKeys, autoConfig);
        const sceneCount = pickArcLength(autoConfig, action);
        const arcName = actionToArcName(action);

        const { scenes, arc } = await generateScenes(
          activeNarrative,
          resolvedSceneKeys,
          currentSceneIndex,
          sceneCount,
          arcName,
          directive,
        );
        if (cancelledRef.current) return;

        dispatch({
          type: 'BULK_ADD_SCENES',
          scenes,
          arc,
          branchId: activeBranchId,
        });
        scenesGenerated = scenes.length;
      }
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
  }, [state, dispatch]);

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

function actionToArcName(action: AutoAction): string {
  switch (action) {
    case 'generate_arc': return 'Continuation';
    case 'escalate_toward_climax': return 'Escalation';
    case 'introduce_complication': return 'Complication';
    case 'resolve_thread': return 'Resolution';
    case 'quiet_interlude': return 'Interlude';
    case 'expand_world': return 'Expansion';
  }
}
