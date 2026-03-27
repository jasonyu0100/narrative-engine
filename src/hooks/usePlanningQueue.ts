'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '@/lib/store';
import { generatePhaseCompletionReport, generatePhaseDirection } from '@/lib/planning-engine';
import { expandWorld } from '@/lib/ai';
import { nextId } from '@/lib/narrative-utils';
import { DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import type { PlanningQueue } from '@/types/narrative';

/**
 * Reactive hook that watches the planning queue and triggers phase transitions
 * when a phase's scene allocation is met. Works regardless of generation mode
 * (manual, auto, MCTS).
 *
 * In manual mode, sets `pendingCompletion` so the page can show the modal.
 * In auto mode, advances automatically.
 */
export function usePlanningQueue() {
  const { state, dispatch } = useStore();
  const stateRef = useRef(state);
  stateRef.current = state;

  const [transitioning, setTransitioning] = useState(false);
  const [transitionStep, setTransitionStep] = useState<string | null>(null);
  const [pendingCompletion, setPendingCompletion] = useState<{
    report: string;
    queue: PlanningQueue;
  } | null>(null);
  const transitioningRef = useRef(false);
  // Track which phase index we last processed to avoid re-triggering
  const lastProcessedRef = useRef<string | null>(null);

  const branchId = state.activeBranchId;
  const branch = branchId ? state.activeNarrative?.branches[branchId] : null;
  const queue = branch?.planningQueue;
  const activePhase = queue?.phases[queue.activePhaseIndex];
  const isAutoRunning = state.autoRunState?.isRunning ?? false;

  // Detect when the active phase has met its scene allocation
  const phaseComplete = activePhase
    && activePhase.status === 'active'
    && activePhase.scenesCompleted >= activePhase.sceneAllocation;

  // Build a unique key for this completion event
  const completionKey = phaseComplete && queue
    ? `${branchId}-${queue.activePhaseIndex}-${activePhase.scenesCompleted}`
    : null;

  useEffect(() => {
    if (!phaseComplete || !queue || !branchId || !activePhase) return;
    if (transitioningRef.current) return;
    if (completionKey === lastProcessedRef.current) return;

    lastProcessedRef.current = completionKey;

    if (isAutoRunning) {
      // Auto mode: check if the phase reached a natural stopping point
      // If threads are mid-escalation (active/escalating but not critical/resolved),
      // extend the phase by a few scenes instead of forcing transition
      const s = stateRef.current;
      const narrative = s.activeNarrative;
      if (narrative && activePhase) {
        const activeThreads = Object.values(narrative.threads).filter(
          (t) => t.status === 'active' || t.status === 'escalating'
        );
        const criticalOrResolved = Object.values(narrative.threads).filter(
          (t) => t.status === 'critical' || t.status === 'resolved' || t.status === 'subverted'
        );
        // If many threads are mid-escalation and few have reached crisis/resolution,
        // the phase hasn't reached a natural boundary — extend it
        const midEscalation = activeThreads.length;
        const concluded = criticalOrResolved.length;
        if (midEscalation > concluded + 2 && activePhase.sceneAllocation < 15) {
          // Extend by 3 scenes (one more mini-arc)
          dispatch({
            type: 'UPDATE_PLANNING_PHASE',
            branchId,
            phaseIndex: queue.activePhaseIndex,
            updates: { sceneAllocation: activePhase.sceneAllocation + 3 },
          });
          lastProcessedRef.current = null; // Reset so it can re-trigger
          return;
        }
      }
      // Natural stopping point reached — advance
      runTransition(queue, branchId);
    } else {
      // Manual / idle: generate report and wait for user decision
      generateReport(queue, branchId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionKey, isAutoRunning]);

  async function generateReport(q: PlanningQueue, bid: string) {
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    setTransitioning(true);
    setTransitionStep('Generating completion report...');

    try {
      const { activeNarrative, resolvedEntryKeys, currentSceneIndex } = stateRef.current;
      if (!activeNarrative) return;

      const phase = q.phases[q.activePhaseIndex];
      if (!phase) return;

      const report = await generatePhaseCompletionReport(
        activeNarrative, resolvedEntryKeys, currentSceneIndex, phase,
      );

      dispatch({
        type: 'UPDATE_PLANNING_PHASE',
        branchId: bid,
        phaseIndex: q.activePhaseIndex,
        updates: { completionReport: report },
      });

      setPendingCompletion({ report, queue: q });
    } catch (err) {
      console.error('[planning-queue] report generation failed:', err);
    } finally {
      transitioningRef.current = false;
      setTransitioning(false);
      setTransitionStep(null);
    }
  }

  /** Run the full transition pipeline: report → world expansion → direction → advance */
  const runTransition = useCallback(async (q: PlanningQueue, bid: string) => {
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    setTransitioning(true);

    try {
      const s = stateRef.current;
      const narrative = s.activeNarrative;
      if (!narrative) return;

      const phaseIdx = q.activePhaseIndex;
      const phase = q.phases[phaseIdx];
      if (!phase) return;

      // 1. Completion report
      if (!phase.completionReport) {
        setTransitionStep('Generating completion report...');
        const report = await generatePhaseCompletionReport(
          narrative, s.resolvedEntryKeys, s.currentSceneIndex, phase,
        );
        dispatch({
          type: 'UPDATE_PLANNING_PHASE',
          branchId: bid,
          phaseIndex: phaseIdx,
          updates: { completionReport: report },
        });
      }

      const nextPhaseIdx = phaseIdx + 1;
      const nextPhase = q.phases[nextPhaseIdx];

      if (nextPhase) {
        // 2. World expansion
        let worldExpanded = false;
        const freshState1 = stateRef.current;
        const freshNarrative1 = freshState1.activeNarrative ?? narrative;
        if (nextPhase.worldExpansionHints) {
          setTransitionStep('Expanding world...');
          const strategy = freshNarrative1.storySettings?.expansionStrategy ?? 'dynamic';
          const expansion = await expandWorld(
            freshNarrative1, freshState1.resolvedEntryKeys, freshState1.currentSceneIndex,
            nextPhase.worldExpansionHints, 'medium', strategy,
          );
          dispatch({
            type: 'EXPAND_WORLD',
            worldBuildId: nextId('WB', Object.keys(freshNarrative1.worldBuilds), 3),
            characters: expansion.characters,
            locations: expansion.locations,
            threads: expansion.threads,
            relationships: expansion.relationships,
            worldKnowledgeMutations: expansion.worldKnowledgeMutations,
            artifacts: expansion.artifacts,
            branchId: bid,
          });
          worldExpanded = true;
        }

        // 3. Generate direction and constraints
        setTransitionStep('Generating direction...');
        const freshState2 = stateRef.current;
        const freshNarrative2 = freshState2.activeNarrative ?? freshNarrative1;
        const { direction, constraints } = await generatePhaseDirection(
          freshNarrative2, freshState2.resolvedEntryKeys, freshState2.currentSceneIndex,
          nextPhase, q,
        );

        // 4. Advance the queue
        dispatch({ type: 'ADVANCE_PLANNING_PHASE', branchId: bid });

        // 5. Set direction on new active phase
        dispatch({
          type: 'UPDATE_PLANNING_PHASE',
          branchId: bid,
          phaseIndex: nextPhaseIdx,
          updates: { direction, constraints: constraints || nextPhase.constraints },
        });

        // 6. Update story settings
        const baseSettings = { ...DEFAULT_STORY_SETTINGS, ...freshNarrative2.storySettings };
        dispatch({
          type: 'SET_STORY_SETTINGS',
          settings: {
            ...baseSettings,
            storyDirection: direction,
            storyConstraints: constraints || nextPhase.constraints || baseSettings.storyConstraints,
            ...(worldExpanded ? { worldFocus: 'latest' as const } : {}),
          },
        });
      } else {
        // Queue exhausted
        dispatch({ type: 'ADVANCE_PLANNING_PHASE', branchId: bid });
      }

      setPendingCompletion(null);
    } catch (err) {
      console.error('[planning-queue] transition failed:', err);
    } finally {
      transitioningRef.current = false;
      setTransitioning(false);
      setTransitionStep(null);
    }
  }, [dispatch]);

  /** User chose to extend the current phase (add more scenes) */
  const extendPhase = useCallback((additionalScenes = 5) => {
    if (!branchId || !queue) return;
    const phase = queue.phases[queue.activePhaseIndex];
    if (!phase) return;
    dispatch({
      type: 'UPDATE_PLANNING_PHASE',
      branchId,
      phaseIndex: queue.activePhaseIndex,
      updates: { sceneAllocation: phase.sceneAllocation + additionalScenes },
    });
    setPendingCompletion(null);
    lastProcessedRef.current = null; // Reset so it can re-trigger
  }, [branchId, queue, dispatch]);

  /** User chose to advance to the next phase */
  const advancePhase = useCallback((customWorldPrompt?: string) => {
    if (!branchId || !queue) return;
    // If custom world prompt, update the next phase's world hints before transitioning
    const nextIdx = queue.activePhaseIndex + 1;
    if (customWorldPrompt && nextIdx < queue.phases.length) {
      dispatch({
        type: 'UPDATE_PLANNING_PHASE',
        branchId,
        phaseIndex: nextIdx,
        updates: { worldExpansionHints: customWorldPrompt },
      });
    }
    // Re-read queue after dispatch
    const freshQueue = stateRef.current.activeNarrative?.branches[branchId]?.planningQueue ?? queue;
    runTransition(freshQueue, branchId);
  }, [branchId, queue, dispatch, runTransition]);

  return {
    queue,
    activePhase,
    transitioning,
    transitionStep,
    pendingCompletion,
    extendPhase,
    advancePhase,
  };
}
