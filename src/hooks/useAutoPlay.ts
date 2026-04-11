'use client';

import { useRef, useCallback, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { evaluateNarrativeState, checkEndConditions, pickArcLength, buildOutlineDirective } from '@/lib/auto-engine';
import { generateScenes, expandWorld } from '@/lib/ai';
import { refreshDirection } from '@/lib/ai/review';
import { generatePhaseDirection } from '@/lib/planning-engine';
import { DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import type { AutoRunLog } from '@/types/narrative';
import { nextId } from '@/lib/narrative-utils';
import { logError } from '@/lib/system-logger';

export function useAutoPlay() {
  const { state, dispatch } = useStore();
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const runCycle = useCallback(async () => {
    const { activeNarrative, resolvedEntryKeys, activeBranchId, autoConfig, autoRunState } = stateRef.current;
    if (!activeNarrative || !activeBranchId || !autoRunState) return;

    // Always generate from the HEAD of the story (end of the resolved entries)
    const headIndex = resolvedEntryKeys.length - 1;

    // Wait if a planning phase just completed — the planning queue hook needs time to
    // run the transition (world expansion + direction generation) before we generate more scenes
    const branch = activeNarrative.branches[activeBranchId];
    const pq = branch?.planningQueue;
    if (pq) {
      const ap = pq.phases[pq.activePhaseIndex];
      if (ap?.status === 'active' && ap.scenesCompleted >= ap.sceneAllocation) {
        // Check if this is the last phase — if so, stop immediately
        const isLastPhase = pq.activePhaseIndex >= pq.phases.length - 1
          || pq.phases.slice(pq.activePhaseIndex + 1).every((p) => p.status === 'completed');
        if (isLastPhase) {
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

    // First-phase init: if queue hasn't started yet or active phase has no direction, run world expansion + direction
    if (pq) {
      let ap = pq.phases[pq.activePhaseIndex];
      let activeIdx = pq.activePhaseIndex;
      // Queue not yet started (activePhaseIndex === -1 or phase still pending) — activate first phase
      if (!ap || ap.status === 'pending') {
        const firstPending = pq.phases.findIndex((p) => p.status === 'pending');
        if (firstPending >= 0) {
          activeIdx = firstPending;
          ap = { ...pq.phases[firstPending], status: 'active' as const };
          dispatch({ type: 'SET_PLANNING_QUEUE', branchId: activeBranchId, queue: { ...pq, activePhaseIndex: activeIdx, phases: pq.phases.map((p, i) => i === activeIdx ? ap! : p) } });
        }
      }
      if (ap?.status === 'active' && !ap.direction && ap.scenesCompleted === 0) {
        dispatch({ type: 'SET_AUTO_STATUS', message: 'Setting up phase...' });
        try {
          if (pq.expandWorld !== false) {
            dispatch({ type: 'SET_AUTO_STATUS', message: 'Expanding world...' });
            const strategy = activeNarrative.storySettings?.expansionStrategy ?? 'dynamic';
            const expansion = await expandWorld(activeNarrative, resolvedEntryKeys, headIndex, ap.worldExpansionHints || '', 'medium', strategy);
            dispatch({
              type: 'EXPAND_WORLD',
              worldBuildId: nextId('WB', Object.keys(activeNarrative.worldBuilds), 3),
              characters: expansion.characters, locations: expansion.locations,
              threads: expansion.threads, relationships: expansion.relationships,
              systemMutations: expansion.systemMutations, artifacts: expansion.artifacts,
              branchId: activeBranchId,
              ownershipMutations: expansion.ownershipMutations, tieMutations: expansion.tieMutations,
              continuityMutations: expansion.continuityMutations, relationshipMutations: expansion.relationshipMutations,
            });
          }
          dispatch({ type: 'SET_AUTO_STATUS', message: 'Generating direction...' });
          const freshNarrative = stateRef.current.activeNarrative ?? activeNarrative;
          const { direction, constraints } = await generatePhaseDirection(freshNarrative, resolvedEntryKeys, headIndex, ap, pq);
          dispatch({ type: 'UPDATE_PLANNING_PHASE', branchId: activeBranchId, phaseIndex: activeIdx, updates: { direction, constraints: constraints || ap.constraints } });
          const baseSettings = { ...DEFAULT_STORY_SETTINGS, ...freshNarrative.storySettings };
          dispatch({ type: 'SET_STORY_SETTINGS', settings: { ...baseSettings, storyDirection: direction, storyConstraints: constraints || ap.constraints || baseSettings.storyConstraints, worldFocus: 'latest' as const } });
          // Log the init as a cycle so the direction appears in the run log
          dispatch({
            type: 'LOG_AUTO_CYCLE',
            entry: {
              cycle: autoRunState.currentCycle + 1,
              timestamp: Date.now(),
              action: 'LLL',
              reason: `Phase "${ap.name}" initialized — world expanded, direction set`,
              scenesGenerated: 0,
              worldExpanded: pq.expandWorld !== false,
              endConditionMet: null,
              phaseName: ap.name,
              direction,
              constraints: constraints || ap.constraints || undefined,
            },
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const isFetchError = errorMsg.includes('fetch failed');
          const isTimeout = errorMsg.includes('timed out');

          let detailedMsg = `[auto-play] Phase "${ap.name}" initialization failed`;
          if (isFetchError) {
            detailedMsg += ' - Network error (check API connectivity)';
          } else if (isTimeout) {
            detailedMsg += ' - Request timed out (LLM took too long)';
          }
          detailedMsg += `\nError: ${errorMsg}`;

          // Log error with structured context
          logError(
            `Phase "${ap.name}" initialization failed`,
            err,
            {
              source: 'auto-play',
              operation: 'phase-init',
              details: {
                phaseName: ap.name,
                sceneAllocation: ap.sceneAllocation,
                cycle: autoRunState.currentCycle + 1,
              },
            }
          );

          // Log the failure to run log
          dispatch({
            type: 'LOG_AUTO_CYCLE',
            entry: {
              cycle: autoRunState.currentCycle + 1,
              timestamp: Date.now(),
              action: 'LLL',
              reason: `Phase init failed: ${errorMsg.split('\n')[0].substring(0, 100)}`,
              scenesGenerated: 0,
              worldExpanded: false,
              endConditionMet: null,
              error: errorMsg,
            },
          });
        }
        return; // Let the next tick proceed with generation
      }
    }

    // Check end conditions
    const endMet = checkEndConditions(activeNarrative, resolvedEntryKeys, autoConfig, autoRunState.startingSceneCount, autoRunState.startingArcCount, activeBranchId);
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
    dispatch({ type: 'SET_AUTO_STATUS', message: 'Choosing next action...' });
    const { weights, directiveCtx } = evaluateNarrativeState(
      activeNarrative,
      resolvedEntryKeys,
      headIndex,
      autoConfig,
      autoRunState.startingSceneCount,
      autoRunState.startingArcCount,
    );
    const chosen = weights[0];
    if (!chosen) {
      dispatch({ type: 'SET_AUTO_STATUS', message: 'No viable action — stopping' });
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
    let sceneCount = 0;

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
      if (freshDir) freshConfig.direction = freshDir;
      if (freshCon) freshConfig.narrativeConstraints = freshCon;

      // Capture direction/constraints for logging
      cycleDirection = freshConfig.direction;
      cycleConstraints = freshConfig.narrativeConstraints;

      // Build the directive that scene generation will follow.
      // Plan mode: direction + constraints derived from plan source text are the
      //   complete brief — passed directly, no outline directive needed.
      // Outline mode: direction + constraints are combined with analytical signals
      //   (thread maturity, force balance, vibrancy) into an outline directive that
      //   gives scene generation creative freedom within the user's guidance.
      const freshPq = stateRef.current.activeNarrative?.branches[activeBranchId]?.planningQueue ?? pq;
      const isPlanMode = freshPq?.mode === 'plan';
      let directive: string;
      if (isPlanMode && freshConfig.direction) {
        directive = freshConfig.direction;
        if (freshConfig.narrativeConstraints) {
          directive += `\n\nCONSTRAINTS: ${freshConfig.narrativeConstraints}`;
        }
      } else {
        directive = buildOutlineDirective(activeNarrative, freshConfig, directiveCtx);
      }

      sceneCount = pickArcLength(autoConfig, action);

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

      // Always generate from the HEAD of the story (end), not from the cursor position
      const headIndex = resolvedEntryKeys.length - 1;

      dispatch({ type: 'SET_AUTO_STATUS', message: `Writing ${sceneCount} scenes...` });
      let { scenes, arc } = await generateScenes(
        activeNarrative, resolvedEntryKeys, headIndex, sceneCount, directive, { worldBuildFocus },
      );
      // Truncate if LLM returned more scenes than requested
      if (phaseRemaining < Infinity && scenes.length > phaseRemaining) {
        scenes = scenes.slice(0, phaseRemaining);
        arc = { ...arc, sceneIds: arc.sceneIds.slice(0, phaseRemaining) };
      }
      if (cancelledRef.current) return;
      dispatch({ type: 'BULK_ADD_SCENES', scenes, arc, branchId: activeBranchId });

      if (cancelledRef.current) return;
      scenesGenerated = scenes.length;
      arcName = arc.name;

      // Course-correct: refresh direction after each arc
      if (pq && scenesGenerated > 0) {
        dispatch({ type: 'SET_AUTO_STATUS', message: 'Course-correcting direction...' });
        const freshState = stateRef.current;
        const freshNarrative = freshState.activeNarrative;
        const freshBranch = freshNarrative?.branches[activeBranchId];
        const freshQueue = freshBranch?.planningQueue;
        const freshPhase = freshQueue?.phases[freshQueue.activePhaseIndex];
        // stateRef.current is always stale within the same runCycle — dispatch queues
        // a re-render but doesn't update the ref until the component re-renders.
        // So freshPhase.scenesCompleted is always the PRE-dispatch value.
        const knownCompleted = (freshPhase?.scenesCompleted ?? 0) + scenesGenerated;
        if (freshNarrative && freshPhase?.status === 'active' && knownCompleted < freshPhase.sceneAllocation) {
          try {
            const patchedPhase = { ...freshPhase, scenesCompleted: knownCompleted };
            const currentDir = freshNarrative.storySettings?.storyDirection?.trim() ?? '';
            const currentCon = freshNarrative.storySettings?.storyConstraints?.trim() ?? '';
            const freshHeadIndex = freshState.resolvedEntryKeys.length - 1;
            const { direction: newDir, constraints: newCon } = await refreshDirection(
              freshNarrative, freshState.resolvedEntryKeys, freshHeadIndex, patchedPhase, currentDir, currentCon,
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
            const errorMsg = err instanceof Error ? err.message : String(err);
            const isFetchError = errorMsg.includes('fetch failed');
            const isTimeout = errorMsg.includes('timed out');

            let detailedMsg = `[auto-play] Course correction (direction refresh) failed for phase "${freshPhase?.name}"`;
            if (isFetchError) {
              detailedMsg += ' - Network error';
            } else if (isTimeout) {
              detailedMsg += ' - Request timed out';
            }
            detailedMsg += `\nPhase progress: ${knownCompleted}/${freshPhase?.sceneAllocation ?? 0} scenes`;
            detailedMsg += `\nError: ${errorMsg}`;

            // Log error with structured context
            logError(
              `Course correction failed for phase "${freshPhase?.name}"`,
              err,
              {
                source: 'auto-play',
                operation: 'course-correction',
                details: {
                  phaseName: freshPhase?.name,
                  scenesCompleted: knownCompleted,
                  sceneAllocation: freshPhase?.sceneAllocation,
                },
              }
            );
          }
        }
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isFetchError = errorMsg.includes('fetch failed');
      const isTimeout = errorMsg.includes('timed out');
      const isJSON = errorMsg.includes('JSON') || errorMsg.includes('parse');

      let detailedMsg = `[auto-play] Cycle ${autoRunState.currentCycle + 1} failed`;
      detailedMsg += `\nAction: ${action} (${chosen.reason})`;
      detailedMsg += `\nTarget scenes: ${sceneCount}`;

      if (isFetchError) {
        detailedMsg += '\nCause: Network error - fetch failed (check API connectivity)';
      } else if (isTimeout) {
        detailedMsg += '\nCause: Request timed out (LLM took too long to respond)';
      } else if (isJSON) {
        detailedMsg += '\nCause: JSON parsing error (LLM returned malformed data)';
      }

      if (pq) {
        const ap = pq.phases[pq.activePhaseIndex];
        if (ap) {
          detailedMsg += `\nPhase: "${ap.name}" (${ap.scenesCompleted}/${ap.sceneAllocation} completed)`;
        }
      }

      detailedMsg += `\nError: ${errorMsg}`;

      // Log error with structured context
      logError(
        `Generation cycle ${autoRunState.currentCycle + 1} failed`,
        err,
        {
          source: 'auto-play',
          operation: 'scene-generation',
          details: {
            action,
            phaseName: pq?.phases[pq.activePhaseIndex]?.name,
            phaseProgress: pq ? `${pq.phases[pq.activePhaseIndex]?.scenesCompleted}/${pq.phases[pq.activePhaseIndex]?.sceneAllocation}` : undefined,
          },
        }
      );

      cycleError = errorMsg;
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
          cycle: (stateRef.current.autoRunState?.currentCycle ?? 0) + 1,
        },
      });
      consecutiveTickErrors.current += 1;
      if (consecutiveTickErrors.current >= 3) {
        logError('Auto mode stopped after 3 consecutive unhandled errors', 'Error limit reached', {
          source: 'auto-play',
          operation: 'auto-stop',
          details: {
            consecutiveErrors: consecutiveTickErrors.current,
            cycle: (stateRef.current.autoRunState?.currentCycle ?? 0) + 1,
          },
        });
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

