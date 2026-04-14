'use client';

import { useRef, useCallback, useEffect } from 'react';
import { useStore } from '@/lib/store';
import {
  evaluateNarrativeState,
  checkEndConditions,
  pickArcLength,
  buildPlanDirective,
  buildSimplePlanDirective,
  getArcSceneCount,
  getArcNode,
  isPlanComplete,
} from '@/lib/auto-engine';
import { generateScenes, type CoordinationPlanContext } from '@/lib/ai';
import type { AutoRunLog } from '@/types/narrative';
import { logError, logInfo } from '@/lib/system-logger';

export function useAutoPlay() {
  const { state, dispatch } = useStore();
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const runCycle = useCallback(async () => {
    const { activeNarrative, resolvedEntryKeys, autoConfig, viewState } = stateRef.current;
    const { activeBranchId, autoRunState } = viewState;
    if (!activeNarrative || !activeBranchId || !autoRunState) return;

    const headIndex = resolvedEntryKeys.length - 1;
    const branch = activeNarrative.branches[activeBranchId];

    logInfo(`Auto-play cycle ${autoRunState.currentCycle + 1} starting`, {
      source: 'auto-play',
      operation: 'cycle-start',
      details: {
        cycle: autoRunState.currentCycle + 1,
        resolvedEntries: resolvedEntryKeys.length,
        hasCoordinationPlan: !!branch?.coordinationPlan,
        branchId: activeBranchId,
      },
    });

    // ── Coordination Plan Mode ────────────────────────────────────────────────
    // When a coordination plan exists, use plan-based generation
    const coordPlan = branch?.coordinationPlan;
    if (coordPlan) {
      const { plan } = coordPlan;

      // Check if plan is complete
      if (isPlanComplete(coordPlan)) {
        dispatch({
          type: 'LOG_AUTO_CYCLE',
          entry: {
            cycle: autoRunState.currentCycle + 1,
            timestamp: Date.now(),
            action: 'resolution',
            reason: `Coordination plan completed — ${plan.arcCount} arcs done`,
            scenesGenerated: 0,
            worldExpanded: false,
            endConditionMet: { type: 'planning_complete' },
          },
        });
        dispatch({ type: 'STOP_AUTO_RUN' });
        return;
      }

      // Arc indices are 1-based, but currentArc starts at 0 when plan is created
      // Treat 0 as 1 (we're about to execute arc 1)
      const executingArc = plan.currentArc === 0 ? 1 : plan.currentArc;
      const arcNode = getArcNode(plan, executingArc);
      const arcLabel = arcNode?.label ?? `Arc ${executingArc}`;
      const useArcReasoning = autoConfig.useArcReasoning !== false;
      const directive = useArcReasoning
        ? buildPlanDirective(activeNarrative, plan, executingArc)
        : buildSimplePlanDirective(plan, executingArc);
      const sceneCount = getArcSceneCount(plan, executingArc, 4);

      logInfo(`Coordination plan: executing arc ${executingArc}/${plan.arcCount}`, {
        source: 'auto-play',
        operation: 'plan-execution',
        details: { arcIndex: executingArc, sceneCount, arcLabel },
      });

      dispatch({ type: 'SET_AUTO_STATUS', message: `Arc ${executingArc}/${plan.arcCount}: ${arcLabel}` });

      try {
        // Resolve world focus
        const worldFocusMode = activeNarrative.storySettings?.worldFocus ?? 'none';
        let worldBuildFocus = undefined;
        if (worldFocusMode === 'latest') {
          const lastWbKey = [...resolvedEntryKeys].reverse().find((k) => activeNarrative.worldBuilds[k]);
          if (lastWbKey) worldBuildFocus = activeNarrative.worldBuilds[lastWbKey];
        } else if (worldFocusMode === 'custom' && activeNarrative.storySettings?.worldFocusId) {
          worldBuildFocus = activeNarrative.worldBuilds[activeNarrative.storySettings.worldFocusId];
        }

        // Build coordination plan context for structured prompt injection
        const coordinationPlanContext: CoordinationPlanContext = {
          arcIndex: executingArc,
          arcCount: plan.arcCount,
          arcLabel,
          sceneCount,
          forceMode: arcNode?.forceMode,
          directive,
        };

        const { scenes, arc } = await generateScenes(
          activeNarrative, resolvedEntryKeys, headIndex, sceneCount, '', // Empty direction — context flows via coordinationPlanContext
          { worldBuildFocus, coordinationPlanContext },
        );

        if (cancelledRef.current) return;

        dispatch({ type: 'BULK_ADD_SCENES', scenes, arc, branchId: activeBranchId });

        // Log the cycle
        dispatch({
          type: 'LOG_AUTO_CYCLE',
          entry: {
            cycle: autoRunState.currentCycle + 1,
            timestamp: Date.now(),
            action: 'setup',
            reason: `Plan arc ${executingArc}: ${arc.name}`,
            scenesGenerated: scenes.length,
            worldExpanded: false,
            endConditionMet: null,
            arcName: arc.name,
            direction: directive.substring(0, 200),
          },
        });

        // Advance to next arc
        dispatch({ type: 'ADVANCE_COORDINATION_PLAN', branchId: activeBranchId });

        // Show next arc status or completion
        const nextArc = executingArc + 1;
        if (nextArc > plan.arcCount) {
          dispatch({ type: 'SET_AUTO_STATUS', message: 'Plan complete' });
        } else {
          const nextArcNode = getArcNode(plan, nextArc);
          const nextLabel = nextArcNode?.label ?? `Arc ${nextArc}`;
          dispatch({ type: 'SET_AUTO_STATUS', message: `Next: ${nextLabel}` });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logError(`Coordination plan arc ${executingArc} failed`, err, {
          source: 'auto-play',
          operation: 'plan-execution',
          details: { arcIndex: executingArc },
        });

        dispatch({
          type: 'LOG_AUTO_CYCLE',
          entry: {
            cycle: autoRunState.currentCycle + 1,
            timestamp: Date.now(),
            action: 'setup',
            reason: `Arc ${executingArc} generation failed`,
            scenesGenerated: 0,
            worldExpanded: false,
            endConditionMet: null,
            error: errorMsg,
          },
        });
      }

      return;
    }

    // ── Pressure-Based Auto Mode ────────────────────────────────────────────────
    // No coordination plan — use narrative pressure analysis for guidance

    // Check end conditions
    const endMet = checkEndConditions(activeNarrative, resolvedEntryKeys, autoConfig, autoRunState.startingSceneCount, autoRunState.startingArcCount, activeBranchId);
    if (endMet) {
      dispatch({
        type: 'LOG_AUTO_CYCLE',
        entry: {
          cycle: autoRunState.currentCycle + 1,
          timestamp: Date.now(),
          action: 'resolution',
          reason: `End condition met: ${endMet.type}`,
          scenesGenerated: 0,
          worldExpanded: false,
          endConditionMet: endMet,
        },
      });
      dispatch({ type: 'STOP_AUTO_RUN' });
      return;
    }

    // Evaluate narrative state and get directive
    dispatch({ type: 'SET_AUTO_STATUS', message: 'Evaluating narrative state...' });
    const { phase, pressure, directive } = evaluateNarrativeState(
      activeNarrative,
      resolvedEntryKeys,
      headIndex,
      autoConfig,
      autoRunState.startingSceneCount,
      autoRunState.startingArcCount,
    );

    let scenesGenerated = 0;
    let arcName = '';
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

      const sceneCount = pickArcLength(autoConfig, pressure);

      dispatch({ type: 'SET_AUTO_STATUS', message: `Writing ${sceneCount} scenes...` });
      const { scenes, arc } = await generateScenes(
        activeNarrative, resolvedEntryKeys, headIndex, sceneCount, directive, { worldBuildFocus },
      );

      if (cancelledRef.current) return;
      dispatch({ type: 'BULK_ADD_SCENES', scenes, arc, branchId: activeBranchId });

      scenesGenerated = scenes.length;
      arcName = arc.name;

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logError(`Generation cycle ${autoRunState.currentCycle + 1} failed`, err, {
        source: 'auto-play',
        operation: 'scene-generation',
        details: { storyPhase: phase },
      });
      cycleError = errorMsg;
    }

    if (cancelledRef.current) return;

    // Build reason from pressure analysis
    const pressureReasons: string[] = [];
    if (pressure.threads.primed.length > 0) pressureReasons.push(`${pressure.threads.primed.length} primed threads`);
    if (pressure.threads.stale.length > 0) pressureReasons.push(`${pressure.threads.stale.length} stale threads`);
    if (pressure.entities.shallow.length > 0) pressureReasons.push(`${pressure.entities.shallow.length} shallow characters`);
    if (pressure.knowledge.isStagnant) pressureReasons.push('stagnant world-building');
    const reason = pressureReasons.length > 0 ? pressureReasons.join(', ') : `${phase} phase — balanced forces`;

    const logEntry: AutoRunLog = {
      cycle: autoRunState.currentCycle + 1,
      timestamp: Date.now(),
      action: phase,
      reason,
      scenesGenerated,
      worldExpanded: false,
      endConditionMet: null,
      arcName: arcName || undefined,
      error: cycleError || undefined,
    };
    dispatch({ type: 'LOG_AUTO_CYCLE', entry: logEntry });

    // Update status with result
    const failures = (autoRunState.consecutiveFailures ?? 0) + (cycleError ? 1 : 0);
    if (cycleError && failures >= 3) {
      dispatch({ type: 'SET_AUTO_STATUS', message: `Stopped after 3 failures — ${cycleError}` });
      dispatch({ type: 'STOP_AUTO_RUN' });
      return;
    } else if (cycleError) {
      dispatch({ type: 'SET_AUTO_STATUS', message: `Retrying (${failures}/3)...` });
    } else if (scenesGenerated > 0) {
      dispatch({ type: 'SET_AUTO_STATUS', message: 'Preparing next arc...' });
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
      logError('Unhandled error in auto-play runCycle', err, {
        source: 'auto-play',
        operation: 'run-cycle',
        details: {
          consecutiveErrors: consecutiveTickErrors.current + 1,
          cycle: (stateRef.current.viewState.autoRunState?.currentCycle ?? 0) + 1,
        },
      });
      consecutiveTickErrors.current += 1;
      if (consecutiveTickErrors.current >= 3) {
        logError('Auto mode stopped after 3 consecutive unhandled errors', 'Error limit reached', {
          source: 'auto-play',
          operation: 'auto-stop',
          details: {
            consecutiveErrors: consecutiveTickErrors.current,
            cycle: (stateRef.current.viewState.autoRunState?.currentCycle ?? 0) + 1,
          },
        });
        dispatch({ type: 'LOG_AUTO_CYCLE', entry: {
          cycle: (stateRef.current.viewState.autoRunState?.currentCycle ?? 0) + 1,
          timestamp: Date.now(),
          action: 'setup',
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
    if (!state.viewState.autoRunState?.isRunning && runningRef.current) {
      runningRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }, [state.viewState.autoRunState?.isRunning]);

  return {
    start,
    pause,
    resume,
    stop,
    isRunning: state.viewState.autoRunState?.isRunning ?? false,
    isPaused: state.viewState.autoRunState?.isPaused ?? false,
    currentCycle: state.viewState.autoRunState?.currentCycle ?? 0,
    log: state.viewState.autoRunState?.log ?? [],
  };
}
