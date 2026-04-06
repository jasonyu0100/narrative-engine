'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { generateScenePlan, generateSceneProse } from '@/lib/ai/scenes';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';
import { PLAN_CONCURRENCY, PROSE_CONCURRENCY } from '@/lib/constants';
import { resolveProseForBranch, resolvePlanForBranch } from '@/lib/narrative-utils';
import { logError } from '@/lib/system-logger';

type BulkMode = 'plan' | 'prose';

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

    const concurrency = mode === 'plan' ? PLAN_CONCURRENCY : PROSE_CONCURRENCY;
    const total = sceneIds.length;
    let completed = 0;
    let nextIndex = 0;

    const processScene = async (sceneId: string): Promise<void> => {
      // Wait while paused
      while (pausedRef.current && !cancelledRef.current) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (cancelledRef.current) return;

      const scene = activeNarrative.scenes[sceneId];
      if (!scene) return;

      // Skip if already has content (using resolved versions)
      const branches = activeNarrative.branches;
      const activeBranchId = stateRef.current.activeBranchId!;
      const resolvedPlan = resolvePlanForBranch(scene, activeBranchId, branches);
      const { prose: resolvedProse } = resolveProseForBranch(scene, activeBranchId, branches);
      if (mode === 'plan' && resolvedPlan) return;
      if (mode === 'prose' && resolvedProse) return;
      if (mode === 'prose' && !resolvedPlan) return;

      updateRunState({
        statusMessage: `${mode === 'plan' ? 'Planning' : 'Writing'} "${scene.summary.slice(0, 40)}..."`,
        progress: { completed, total, currentSceneId: sceneId },
      });

      try {
        if (mode === 'plan') {
          const plan = await generateScenePlan(activeNarrative, scene, resolvedEntryKeys);
          dispatch({ type: 'UPDATE_SCENE', sceneId, updates: { plan }, versionType: 'generate' });
        } else {
          const { prose, beatProseMap } = await generateSceneProse(activeNarrative, scene, resolvedEntryKeys, undefined, undefined, resolvedPlan);
          dispatch({ type: 'UPDATE_SCENE', sceneId, updates: { prose, beatProseMap }, versionType: 'generate' });
        }
      } catch (err) {
        logError(`Failed to generate ${mode} for scene`, err, {
          source: mode === 'plan' ? 'plan-generation' : 'prose-generation',
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

    // Find all scenes that need generation
    const scenesToProcess: string[] = [];
    for (const key of resolvedEntryKeys) {
      const entry = resolveEntry(activeNarrative, key);
      if (!entry || !isScene(entry)) continue;
      const scene = entry as Scene;

      // Use resolved versions to check what needs generation
      const branches = activeNarrative.branches;
      const activeBranchId = stateRef.current.activeBranchId!;
      const resolvedPlan = resolvePlanForBranch(scene, activeBranchId, branches);
      const { prose: resolvedProse } = resolveProseForBranch(scene, activeBranchId, branches);

      if (mode === 'plan' && !resolvedPlan) {
        scenesToProcess.push(scene.id);
      } else if (mode === 'prose' && resolvedPlan && !resolvedProse) {
        scenesToProcess.push(scene.id);
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

  // Count how many scenes need plan/prose (using resolved versions)
  const counts = useCallback(() => {
    const { activeNarrative, resolvedEntryKeys, activeBranchId } = stateRef.current;
    if (!activeNarrative || !activeBranchId) return { needsPlan: 0, needsProse: 0 };

    const branches = activeNarrative.branches;
    let needsPlan = 0;
    let needsProse = 0;

    for (const key of resolvedEntryKeys) {
      const entry = resolveEntry(activeNarrative, key);
      if (!entry || !isScene(entry)) continue;
      const scene = entry as Scene;

      const resolvedPlan = resolvePlanForBranch(scene, activeBranchId, branches);
      const { prose: resolvedProse } = resolveProseForBranch(scene, activeBranchId, branches);

      if (!resolvedPlan) needsPlan++;
      if (resolvedPlan && !resolvedProse) needsProse++;
    }

    return { needsPlan, needsProse };
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
