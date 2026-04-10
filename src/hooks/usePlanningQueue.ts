'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '@/lib/store';
import { buildPhaseCompletionSummary, generatePhaseDirection } from '@/lib/planning-engine';
import { expandWorld } from '@/lib/ai';
import { nextId } from '@/lib/narrative-utils';
import { DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import type { PlanningQueue } from '@/types/narrative';
import { logError } from '@/lib/system-logger';

/**
 * Reactive hook that watches the planning queue and triggers phase transitions
 * when a phase's scene allocation is met.
 *
 * Phase transitions always happen automatically — the queue advances, a completion
 * report is generated, and the next phase is activated. In auto mode, world expansion
 * and direction generation also run automatically. In manual mode, the user can
 * trigger world expansion and direction regeneration from the queue UI.
 */
export function usePlanningQueue() {
  const { state, dispatch } = useStore();
  const stateRef = useRef(state);
  stateRef.current = state;

  const [transitioning, setTransitioning] = useState(false);
  const [transitionStep, setTransitionStep] = useState<string | null>(null);
  const [phaseJustCompleted, setPhaseJustCompleted] = useState<{ name: string; summary: string; nextPhaseName?: string } | null>(null);
  const transitioningRef = useRef(false);
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

  // Unique key to prevent re-triggering the same completion
  const completionKey = phaseComplete && queue
    ? `${branchId}-${queue.activePhaseIndex}-${activePhase.scenesCompleted}-${activePhase.direction?.slice(0, 20) ?? ''}`
    : null;

  useEffect(() => {
    if (!phaseComplete || !queue || !branchId || !activePhase) return;
    if (transitioningRef.current) return;
    if (completionKey === lastProcessedRef.current) return;

    lastProcessedRef.current = completionKey;
    runTransition(queue, branchId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionKey]);

  /**
   * Run the phase transition pipeline.
   * Always: report → advance.
   * Auto mode: + world expansion → direction generation.
   * Manual mode: advance only, user controls world/direction from queue UI.
   */
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

      // 1. Completion summary (no LLM call — built from scene data)
      // Always use the head index (end of story) for generation operations
      const headIndex = s.resolvedEntryKeys.length - 1;
      if (!phase.completionReport) {
        const summary = buildPhaseCompletionSummary(
          narrative, s.resolvedEntryKeys, headIndex, phase,
        );
        dispatch({
          type: 'UPDATE_PLANNING_PHASE',
          branchId: bid,
          phaseIndex: phaseIdx,
          updates: { completionReport: summary },
        });
      }

      // 2. Always advance the queue — don't block on user action
      dispatch({ type: 'ADVANCE_PLANNING_PHASE', branchId: bid });

      const nextPhaseIdx = phaseIdx + 1;
      const nextPhase = q.phases[nextPhaseIdx];

      // 3. In manual mode, notify the user so they can set up the next phase
      if (!isAutoRunning) {
        setPhaseJustCompleted({
          name: phase.name,
          summary: phase.completionReport ?? `${phase.scenesCompleted} scenes completed.`,
          nextPhaseName: nextPhase?.name,
        });
      }

      // 4. In auto mode, run world expansion + direction for the next phase
      if (nextPhase && isAutoRunning) {
        const freshState1 = stateRef.current;
        const freshNarrative1 = freshState1.activeNarrative ?? narrative;

        // World expansion - always from the head of the story
        if (q.expandWorld !== false) {
          setTransitionStep('Expanding world...');
          const strategy = freshNarrative1.storySettings?.expansionStrategy ?? 'dynamic';
          const freshHeadIndex1 = freshState1.resolvedEntryKeys.length - 1;
          const expansion = await expandWorld(
            freshNarrative1, freshState1.resolvedEntryKeys, freshHeadIndex1,
            nextPhase.worldExpansionHints || '', 'medium', strategy, nextPhase.sourceText,
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
            ownershipMutations: expansion.ownershipMutations,
            tieMutations: expansion.tieMutations,
            continuityMutations: expansion.continuityMutations,
            relationshipMutations: expansion.relationshipMutations,
          });
        }

        // Direction generation - always from the head of the story
        setTransitionStep('Generating direction...');
        const freshState2 = stateRef.current;
        const freshNarrative2 = freshState2.activeNarrative ?? freshNarrative1;
        const freshHeadIndex2 = freshState2.resolvedEntryKeys.length - 1;
        const { direction, constraints } = await generatePhaseDirection(
          freshNarrative2, freshState2.resolvedEntryKeys, freshHeadIndex2,
          nextPhase, q,
        );

        dispatch({
          type: 'UPDATE_PLANNING_PHASE',
          branchId: bid,
          phaseIndex: nextPhaseIdx,
          updates: { direction, constraints: constraints || nextPhase.constraints },
        });

        const baseSettings = { ...DEFAULT_STORY_SETTINGS, ...freshNarrative2.storySettings };
        dispatch({
          type: 'SET_STORY_SETTINGS',
          settings: {
            ...baseSettings,
            storyDirection: direction,
            storyConstraints: constraints || nextPhase.constraints || baseSettings.storyConstraints,
            worldFocus: 'latest' as const,
          },
        });
      }
    } catch (err) {
      const phaseIdx = q.activePhaseIndex;
      const nextPhaseIdx = phaseIdx + 1;
      logError('Planning queue phase transition failed', err, {
        source: 'other',
        operation: 'planning-queue-transition',
        details: {
          fromPhase: phaseIdx,
          toPhase: nextPhaseIdx,
          phaseName: q.phases[nextPhaseIdx]?.name,
        }
      });
    } finally {
      transitioningRef.current = false;
      setTransitioning(false);
      setTransitionStep(null);
    }
  }, [dispatch, isAutoRunning]);

  /** Extend the current phase with additional scenes */
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
    lastProcessedRef.current = null;
  }, [branchId, queue, dispatch]);

  const dismissCompletion = useCallback(() => setPhaseJustCompleted(null), []);

  return {
    queue,
    activePhase,
    transitioning,
    transitionStep,
    extendPhase,
    phaseJustCompleted,
    dismissCompletion,
  };
}
