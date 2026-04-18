'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { generateScenePlan, generateSceneProse, reverseEngineerScenePlan } from '@/lib/ai/scenes';
import { generateSceneGameAnalysis } from '@/lib/ai/game-analysis';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';
import { PLAN_CONCURRENCY, PROSE_CONCURRENCY, GAME_CONCURRENCY } from '@/lib/constants';
import { resolveProseForBranch, resolvePlanForBranch } from '@/lib/narrative-utils';
import { logError } from '@/lib/system-logger';

type BulkMode = 'plan' | 'prose' | 'game';

type BulkProgress = {
  completed: number;
  total: number;
  currentSceneId: string | null;
};

type BulkRunState = {
  mode: BulkMode;
  isRunning: boolean;
  isPaused: boolean;
  progress: BulkProgress;
  statusMessage: string;
  startedAt: number;
};

export function useBulkGenerate() {
  const { state, dispatch } = useStore();
  const cancelledRef = useRef(false);
  const pausedRef = useRef(false);
  const runStateRef = useRef<BulkRunState | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [runState, setRunState] = useState<BulkRunState | null>(null);

  const updateRunState = useCallback((updates: Partial<BulkRunState>) => {
    setRunState(prev => {
      if (!prev) return null;
      const next = { ...prev, ...updates };
      runStateRef.current = next;
      return next;
    });
  }, []);

  // Run bulk generation with sliding window concurrency
  const runBulk = useCallback(async (mode: BulkMode, sceneIds: string[]) => {
    const { activeNarrative, resolvedEntryKeys } = stateRef.current;
    if (!activeNarrative || sceneIds.length === 0) return;

    const concurrency =
      mode === 'plan' ? PLAN_CONCURRENCY :
      mode === 'prose' ? PROSE_CONCURRENCY :
      GAME_CONCURRENCY;
    const total = sceneIds.length;
    let completed = 0;
    let nextIndex = 0;

    // Plan extraction source applies to both bulk queues. 'structure' =
    // current forward flow (structure → plan → prose). 'prose' = reverse
    // flow (structure → prose → plan reverse-engineered from prose).
    const planSource = activeNarrative.storySettings?.planExtractionSource ?? 'structure';

    const processScene = async (sceneId: string): Promise<void> => {
      // Wait while paused
      while (pausedRef.current && !cancelledRef.current) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (cancelledRef.current) return;

      const scene = activeNarrative.scenes[sceneId];
      if (!scene) return;

      // Bulk mode ALWAYS generates a new version — existing plan/prose is
      // not a skip condition. The versioning system records each run as a
      // new version so prior results remain recoverable.
      const branches = activeNarrative.branches;
      const activeBranchId = stateRef.current.viewState.activeBranchId!;
      const resolvedPlan = resolvePlanForBranch(scene, activeBranchId, branches);
      const { prose: resolvedProse } = resolveProseForBranch(scene, activeBranchId, branches);

      // Dependency gates — these are structural, not "already exists" gates.
      //   'plan' + 'prose' source: reverse-engineering requires prose to exist.
      //   'prose' + 'structure' source: forward prose generation requires a plan.
      if (mode === 'plan' && planSource === 'prose' && !resolvedProse) return;
      if (mode === 'prose' && planSource === 'structure' && !resolvedPlan) return;
      // Game analysis requires something to read — prefer plan, accept prose.
      // Skip scenes that already have an analysis: unlike plan/prose, game
      // analyses aren't versioned, so re-running would just overwrite. Users
      // can Clear + Generate per-scene to force regeneration.
      if (mode === 'game' && !resolvedPlan && !resolvedProse) return;
      if (mode === 'game' && scene.gameAnalysis) return;

      const statusVerb =
        mode === 'plan' ? (planSource === 'prose' ? 'Reverse-engineering plan for' : 'Planning') :
        mode === 'prose' ? 'Writing' :
        'Analysing games in';
      updateRunState({
        statusMessage: `${statusVerb} "${scene.summary.slice(0, 40)}..."`,
        progress: { completed, total, currentSceneId: sceneId },
      });

      try {
        if (mode === 'game') {
          window.dispatchEvent(new CustomEvent('bulk:game-start', { detail: { sceneId } }));
          const analysis = await generateSceneGameAnalysis(
            activeNarrative,
            scene,
            stateRef.current.viewState.activeBranchId,
            (token) => window.dispatchEvent(new CustomEvent('bulk:game-token', { detail: { sceneId, token } })),
            (token) => window.dispatchEvent(new CustomEvent('bulk:game-reasoning', { detail: { sceneId, token } })),
          );
          window.dispatchEvent(new CustomEvent('bulk:game-complete', { detail: { sceneId } }));
          dispatch({ type: 'SET_GAME_ANALYSIS', sceneId, analysis });
        } else if (mode === 'plan') {
          window.dispatchEvent(new CustomEvent('bulk:plan-start', { detail: { sceneId } }));
          const plan = planSource === 'prose'
            ? (await reverseEngineerScenePlan(
                resolvedProse!,
                scene.summary ?? '',
                (_token, accumulated) => window.dispatchEvent(new CustomEvent('bulk:plan-reasoning', { detail: { sceneId, token: accumulated } })),
              )).plan
            : await generateScenePlan(
                activeNarrative, scene, resolvedEntryKeys,
                (token) => window.dispatchEvent(new CustomEvent('bulk:plan-reasoning', { detail: { sceneId, token } })),
              );
          window.dispatchEvent(new CustomEvent('bulk:plan-complete', { detail: { sceneId } }));
          dispatch({ type: 'UPDATE_SCENE', sceneId, updates: { plan }, versionType: 'generate' });
        } else {
          window.dispatchEvent(new CustomEvent('bulk:prose-start', { detail: { sceneId } }));
          // Prose mode + 'prose' source: generate prose without a plan so it flows free,
          // then reverse-engineer the plan from the resulting prose.
          const planForProse = planSource === 'prose' ? undefined : resolvedPlan;
          const { prose, beatProseMap } = await generateSceneProse(
            activeNarrative, scene, resolvedEntryKeys,
            (token) => window.dispatchEvent(new CustomEvent('bulk:prose-token', { detail: { sceneId, token } })),
            undefined, planForProse,
          );
          window.dispatchEvent(new CustomEvent('bulk:prose-complete', { detail: { sceneId } }));
          dispatch({ type: 'UPDATE_SCENE', sceneId, updates: { prose, beatProseMap }, versionType: 'generate' });

          if (planSource === 'prose') {
            try {
              const { plan, beatProseMap: reBeatMap } = await reverseEngineerScenePlan(prose, scene.summary ?? '');
              dispatch({
                type: 'UPDATE_SCENE',
                sceneId,
                updates: { plan, beatProseMap: reBeatMap ?? beatProseMap },
                versionType: 'generate',
              });
            } catch (err) {
              // Best-effort: prose succeeded, plan extraction didn't. Log but don't fail the scene.
              logError(`Failed to reverse-engineer plan for scene`, err, {
                source: 'plan-generation',
                operation: 'bulk-generate-reverse',
                details: { sceneId, sceneNumber: completed + 1, totalScenes: total }
              });
            }
          }
        }
      } catch (err) {
        logError(`Failed to generate ${mode} for scene`, err, {
          source:
            mode === 'plan' ? 'plan-generation' :
            mode === 'prose' ? 'prose-generation' :
            'analysis',
          operation: 'bulk-generate',
          details: { sceneId, mode, sceneNumber: completed + 1, totalScenes: total }
        });
      }

      // Update progress after each scene completes
      completed++;
      updateRunState({
        progress: { completed, total, currentSceneId: null },
        statusMessage: `Completed ${completed}/${total}`,
      });
    };

    // Sliding window: always keep `concurrency` tasks running
    const runWorker = async (): Promise<void> => {
      while (nextIndex < sceneIds.length && !cancelledRef.current) {
        const idx = nextIndex++;
        await processScene(sceneIds[idx]);
      }
    };

    // Start `concurrency` workers in parallel
    const workers = Array.from({ length: Math.min(concurrency, sceneIds.length) }, () => runWorker());
    await Promise.all(workers);

    // Complete — show message briefly then auto-dismiss
    const wasCancelled = cancelledRef.current;
    updateRunState({
      isRunning: false,
      isPaused: false,
      statusMessage: wasCancelled ? 'Stopped' : 'Complete',
    });

    // Auto-dismiss after 1.5s
    setTimeout(() => {
      setRunState(null);
      runStateRef.current = null;
    }, 1500);
  }, [dispatch, updateRunState]);

  const start = useCallback((mode: BulkMode) => {
    const { activeNarrative, resolvedEntryKeys } = stateRef.current;
    if (!activeNarrative) return;

    const planSource = activeNarrative.storySettings?.planExtractionSource ?? 'structure';

    // Find every scene that bulk mode will regenerate. Queue membership is
    // about dependencies, not "already exists" — bulk always writes new
    // versions, leaving prior versions in history.
    const scenesToProcess: string[] = [];
    for (const key of resolvedEntryKeys) {
      const entry = resolveEntry(activeNarrative, key);
      if (!entry || !isScene(entry)) continue;
      const scene = entry as Scene;

      const branches = activeNarrative.branches;
      const activeBranchId = stateRef.current.viewState.activeBranchId!;
      const resolvedPlan = resolvePlanForBranch(scene, activeBranchId, branches);
      const { prose: resolvedProse } = resolveProseForBranch(scene, activeBranchId, branches);

      if (mode === 'plan') {
        // Structure source: any scene can be forward-generated.
        // Prose source: needs prose to reverse-engineer from.
        if (planSource === 'structure' || resolvedProse) {
          scenesToProcess.push(scene.id);
        }
      } else if (mode === 'prose') {
        // Structure source: prose generation requires a plan first.
        // Prose source: prose can be generated directly.
        if (planSource === 'prose' || resolvedPlan) {
          scenesToProcess.push(scene.id);
        }
      } else if (mode === 'game') {
        // Game analysis prefers a plan; accepts prose as fallback input.
        // Skip scenes that already have an analysis — unlike plan/prose,
        // game analyses aren't versioned.
        if ((resolvedPlan || resolvedProse) && !scene.gameAnalysis) {
          scenesToProcess.push(scene.id);
        }
      }
    }

    if (scenesToProcess.length === 0) {
      return;
    }

    cancelledRef.current = false;
    pausedRef.current = false;

    const initialState: BulkRunState = {
      mode,
      isRunning: true,
      isPaused: false,
      progress: { completed: 0, total: scenesToProcess.length, currentSceneId: null },
      statusMessage: `Starting ${mode} generation...`,
      startedAt: Date.now(),
    };
    setRunState(initialState);
    runStateRef.current = initialState;

    runBulk(mode, scenesToProcess);
  }, [runBulk]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    updateRunState({ isPaused: true, statusMessage: 'Paused' });
  }, [updateRunState]);

  const resume = useCallback(() => {
    pausedRef.current = false;
    updateRunState({ isPaused: false, statusMessage: 'Resuming...' });
  }, [updateRunState]);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    pausedRef.current = false;
    setRunState(null);
    runStateRef.current = null;
  }, []);

  // Count how many scenes bulk mode would process — mirrors the queue
  // filters in start(). Bulk always writes a new version, so the count
  // reflects scenes that satisfy the dependency gates, not scenes missing
  // content.
  const counts = useCallback(() => {
    const { activeNarrative, resolvedEntryKeys, viewState } = stateRef.current;
    const { activeBranchId } = viewState;
    if (!activeNarrative || !activeBranchId) return { needsPlan: 0, needsProse: 0, needsGame: 0 };

    const planSource = activeNarrative.storySettings?.planExtractionSource ?? 'structure';
    const branches = activeNarrative.branches;
    let needsPlan = 0;
    let needsProse = 0;
    let needsGame = 0;

    for (const key of resolvedEntryKeys) {
      const entry = resolveEntry(activeNarrative, key);
      if (!entry || !isScene(entry)) continue;
      const scene = entry as Scene;

      const resolvedPlan = resolvePlanForBranch(scene, activeBranchId, branches);
      const { prose: resolvedProse } = resolveProseForBranch(scene, activeBranchId, branches);

      if (planSource === 'structure' || resolvedProse) needsPlan++;
      if (planSource === 'prose' || resolvedPlan) needsProse++;
      if ((resolvedPlan || resolvedProse) && !scene.gameAnalysis) needsGame++;
    }

    return { needsPlan, needsProse, needsGame };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      pausedRef.current = false;
    };
  }, []);

  return {
    runState,
    start,
    pause,
    resume,
    stop,
    counts,
  };
}
