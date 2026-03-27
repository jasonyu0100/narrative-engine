'use client';

import { useRef, useCallback, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { evaluateNarrativeState, checkEndConditions, pickArcLength, buildActionDirective } from '@/lib/auto-engine';
import { generateScenes } from '@/lib/ai';
import { refreshDirection } from '@/lib/ai/review';
import { DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import type { AutoRunLog } from '@/types/narrative';

export function useAutoPlay() {
  const { state, dispatch } = useStore();
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const runCycle = useCallback(async () => {
    const { activeNarrative, resolvedEntryKeys, currentSceneIndex, activeBranchId, autoConfig, autoRunState } = stateRef.current;
    if (!activeNarrative || !activeBranchId || !autoRunState) return;

    // Wait if a planning phase just completed — the planning queue hook needs time to
    // run the transition (world expansion + direction generation) before we generate more scenes
    const branch = activeNarrative.branches[activeBranchId];
    const pq = branch?.planningQueue;
    if (pq) {
      const ap = pq.phases[pq.activePhaseIndex];
      if (ap?.status === 'active' && ap.scenesCompleted >= ap.sceneAllocation) {
        // Phase just completed — skip this tick, let usePlanningQueue handle transition
        return;
      }
      // All phases completed — stop immediately regardless of end condition config
      if (pq.phases.every((p) => p.status === 'completed')) {
        dispatch({
          type: 'LOG_AUTO_CYCLE',
          entry: {
            cycle: autoRunState.currentCycle + 1, timestamp: Date.now(), action: 'LHL',
            reason: 'Planning queue completed — all phases done',
            scenesGenerated: 0, worldExpanded: false,
            endConditionMet: { type: 'planning_complete' },
          },
        });
        dispatch({ type: 'STOP_AUTO_RUN' });
        return;
      }
    }

    // Check end conditions
    const endMet = checkEndConditions(activeNarrative, resolvedEntryKeys, autoConfig, autoRunState.startingSceneCount, autoRunState.startingArcCount);
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
    dispatch({ type: 'SET_AUTO_STATUS', message: 'Evaluating narrative state...' });
    const { weights, directiveCtx } = evaluateNarrativeState(
      activeNarrative,
      resolvedEntryKeys,
      currentSceneIndex,
      autoConfig,
      autoRunState.startingSceneCount,
      autoRunState.startingArcCount,
    );
    const chosen = weights[0];
    if (!chosen) {
      dispatch({ type: 'STOP_AUTO_RUN' });
      return;
    }

    const action = chosen.action;
    let scenesGenerated = 0;
    let worldExpanded = false;
    let arcName = '';
    let cycleDirection = '';
    let cycleConstraints = '';
    let courseCorrection: { direction: string; constraints: string } | undefined;
    let cycleError = '';

    try {
      // Resolve world focus from story settings
      const worldFocusMode = activeNarrative.storySettings?.worldFocus ?? 'none';
      let worldBuildFocus = undefined;
      if (worldFocusMode === 'latest') {
        const lastWbKey = [...resolvedEntryKeys].reverse().find((k) => activeNarrative.worldBuilds[k]);
        if (lastWbKey) worldBuildFocus = activeNarrative.worldBuilds[lastWbKey];
      } else if (worldFocusMode === 'custom' && activeNarrative.storySettings?.worldFocusId) {
        worldBuildFocus = activeNarrative.worldBuilds[activeNarrative.storySettings.worldFocusId];
      }

      // Merge fresh story settings direction/constraints into auto config
      // (planning queue may have updated these mid-run)
      const freshConfig = { ...autoConfig };
      const freshDir = activeNarrative.storySettings?.storyDirection?.trim();
      const freshCon = activeNarrative.storySettings?.storyConstraints?.trim();
      if (freshDir) freshConfig.northStarPrompt = freshDir;
      if (freshCon) freshConfig.narrativeConstraints = freshCon;

      // Capture direction/constraints for logging
      cycleDirection = freshConfig.northStarPrompt;
      cycleConstraints = freshConfig.narrativeConstraints;

      // Generate arc — cap scene count to fit planning phase allocation
      const directive = buildActionDirective(action, activeNarrative, freshConfig, directiveCtx);
      let sceneCount = pickArcLength(autoConfig, action);

      // If a planning queue phase is active, cap to remaining scenes exactly
      const MIN_ARC_SCENES = 3;
      let phaseRemaining = Infinity;
      if (pq) {
        const ap = pq.phases[pq.activePhaseIndex];
        if (ap?.status === 'active') {
          phaseRemaining = ap.sceneAllocation - ap.scenesCompleted;
          if (phaseRemaining <= 0) return; // Phase already full, let transition handle it

          // If remaining is less than a viable arc, absorb into this arc to avoid 1-2 scene runts
          // e.g. 7 remaining with sceneCount=5 → would leave 2. Instead generate all 7.
          const wouldLeave = phaseRemaining - Math.min(sceneCount, phaseRemaining);
          if (wouldLeave > 0 && wouldLeave < MIN_ARC_SCENES) {
            // Generate all remaining scenes in one arc
            sceneCount = phaseRemaining;
          } else {
            sceneCount = Math.min(sceneCount, phaseRemaining);
          }
        }
      }

      dispatch({ type: 'SET_AUTO_STATUS', message: `Generating ${sceneCount} scenes...` });
      let { scenes, arc } = await generateScenes(
        activeNarrative,
        resolvedEntryKeys,
        currentSceneIndex,
        sceneCount,
        directive,
        { worldBuildFocus },
      );

      // Truncate if LLM returned more scenes than requested
      if (phaseRemaining < Infinity && scenes.length > phaseRemaining) {
        scenes = scenes.slice(0, phaseRemaining);
        arc = { ...arc, sceneIds: arc.sceneIds.slice(0, phaseRemaining) };
      }
      if (cancelledRef.current) return;

      dispatch({
        type: 'BULK_ADD_SCENES',
        scenes,
        arc,
        branchId: activeBranchId,
      });
      scenesGenerated = scenes.length;
      arcName = arc.name;

      // Course-correct: refresh direction after each arc
      if (pq && scenesGenerated > 0) {
        dispatch({ type: 'SET_AUTO_STATUS', message: 'Refreshing direction...' });
        const freshState = stateRef.current;
        const freshNarrative = freshState.activeNarrative;
        const freshBranch = freshNarrative?.branches[activeBranchId];
        const freshQueue = freshBranch?.planningQueue;
        const freshPhase = freshQueue?.phases[freshQueue.activePhaseIndex];
        if (freshNarrative && freshPhase?.status === 'active' && freshPhase.scenesCompleted < freshPhase.sceneAllocation) {
          try {
            const currentDir = freshNarrative.storySettings?.storyDirection?.trim() ?? '';
            const currentCon = freshNarrative.storySettings?.storyConstraints?.trim() ?? '';
            const { direction: newDir, constraints: newCon } = await refreshDirection(
              freshNarrative, freshState.resolvedEntryKeys, freshState.currentSceneIndex, freshPhase, currentDir, currentCon,
            );
            if (newDir !== currentDir || newCon !== currentCon) {
              courseCorrection = { direction: newDir, constraints: newCon };
              const baseSettings = { ...DEFAULT_STORY_SETTINGS, ...freshNarrative.storySettings };
              dispatch({
                type: 'SET_STORY_SETTINGS',
                settings: { ...baseSettings, storyDirection: newDir, storyConstraints: newCon },
              });
            }
          } catch (err) {
            console.error('[auto-play] direction refresh failed:', err);
          }
        }
      }

    } catch (err) {
      console.error('[auto-play] cycle error:', err);
      cycleError = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'SET_AUTO_STATUS', message: `Error: ${cycleError}` });
    }

    if (cancelledRef.current) return;

    // Log the cycle with full details
    const phaseName = pq ? pq.phases[pq.activePhaseIndex]?.name : undefined;
    const phaseProgress = pq ? `${pq.phases[pq.activePhaseIndex]?.scenesCompleted ?? 0}/${pq.phases[pq.activePhaseIndex]?.sceneAllocation ?? 0}` : undefined;

    const logEntry: AutoRunLog = {
      cycle: autoRunState.currentCycle + 1,
      timestamp: Date.now(),
      action,
      reason: chosen.reason,
      scenesGenerated,
      worldExpanded,
      endConditionMet: null,
      arcName: arcName || undefined,
      phaseName,
      phaseProgress,
      direction: cycleDirection || undefined,
      constraints: cycleConstraints || undefined,
      courseCorrection,
      error: cycleError || undefined,
    };
    dispatch({ type: 'LOG_AUTO_CYCLE', entry: logEntry });

    // Stop after 3 consecutive failures
    const failures = (autoRunState.consecutiveFailures ?? 0) + (cycleError ? 1 : 0);
    if (cycleError && failures >= 3) {
      dispatch({ type: 'STOP_AUTO_RUN' });
      return;
    }
  }, [dispatch]);

  // The loop: run a cycle, then immediately continue
  const consecutiveTickErrors = useRef(0);
  const tick = useCallback(async () => {
    if (cancelledRef.current || !runningRef.current) return;

    try {
      await runCycle();
      consecutiveTickErrors.current = 0;
    } catch (err) {
      console.error('[auto-play] Unhandled error in runCycle:', err);
      consecutiveTickErrors.current += 1;
      if (consecutiveTickErrors.current >= 3) {
        console.error('[auto-play] 3 consecutive unhandled errors — stopping auto mode');
        dispatch({ type: 'LOG_AUTO_CYCLE', entry: {
          cycle: (stateRef.current.autoRunState?.currentCycle ?? 0) + 1,
          timestamp: Date.now(),
          action: 'LLL',
          reason: 'Auto mode stopped — 3 consecutive errors. Check API Logs for details.',
          scenesGenerated: 0,
          worldExpanded: false,
          endConditionMet: null,
          error: err instanceof Error ? err.message : String(err),
        }});
        dispatch({ type: 'STOP_AUTO_RUN' });
        return;
      }
    }

    if (cancelledRef.current || !runningRef.current) return;

    // Continue immediately — no pause between cycles
    timeoutRef.current = setTimeout(() => tick(), 100);
  }, [runCycle, dispatch]);

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

