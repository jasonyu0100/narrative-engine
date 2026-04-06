'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';
import { saveAudioBlob } from '@/lib/audio-store';
import { apiHeaders } from '@/lib/api-headers';
import { AUDIO_CONCURRENCY } from '@/lib/constants';
import { resolveProseForBranch } from '@/lib/narrative-utils';
import { logError } from '@/lib/system-logger';

type AudioProgress = {
  completed: number;
  total: number;
  currentSceneId: string | null;
};

type AudioRunState = {
  isRunning: boolean;
  isPaused: boolean;
  progress: AudioProgress;
  statusMessage: string;
  startedAt: number;
};

export function useBulkAudioGenerate() {
  const { state, dispatch } = useStore();
  const cancelledRef = useRef(false);
  const pausedRef = useRef(false);
  const runStateRef = useRef<AudioRunState | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [runState, setRunState] = useState<AudioRunState | null>(null);

  const updateRunState = useCallback((updates: Partial<AudioRunState>) => {
    setRunState(prev => {
      if (!prev) return null;
      const next = { ...prev, ...updates };
      runStateRef.current = next;
      return next;
    });
  }, []);

  // Run bulk audio generation with sliding window concurrency
  const runBulk = useCallback(async (sceneIds: string[]) => {
    const { activeNarrative, activeBranchId } = stateRef.current;
    if (!activeNarrative || !activeBranchId || sceneIds.length === 0) return;

    const voice = activeNarrative.storySettings?.audioVoice || 'onyx';
    const model = activeNarrative.storySettings?.audioModel || 'tts-1';
    const branches = activeNarrative.branches;

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

      // Resolve prose for current branch
      const { prose } = resolveProseForBranch(scene, activeBranchId, branches);

      // Skip if no prose or already has audio
      if (!prose) return;
      if (scene.audioUrl) return;

      updateRunState({
        statusMessage: `Generating audio for "${scene.summary.slice(0, 40)}..."`,
        progress: { completed, total, currentSceneId: sceneId },
      });

      try {
        const res = await fetch('/api/generate-audio', {
          method: 'POST',
          headers: apiHeaders(),
          body: JSON.stringify({ voice, model, text: prose }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'TTS failed' }));
          throw new Error(err.error || `TTS failed (${res.status})`);
        }

        const blob = await res.blob();
        const marker = await saveAudioBlob(sceneId, blob);
        dispatch({ type: 'SET_SCENE_AUDIO', sceneId, audioUrl: marker });
      } catch (err) {
        logError('Failed to generate audio for scene', err, {
          source: 'other',
          operation: 'bulk-audio-generate',
          details: { sceneId, sceneNumber: completed + 1, totalScenes: total }
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
    const workers = Array.from({ length: Math.min(AUDIO_CONCURRENCY, sceneIds.length) }, () => runWorker());
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

  const start = useCallback(() => {
    const { activeNarrative, resolvedEntryKeys, activeBranchId } = stateRef.current;
    if (!activeNarrative || !activeBranchId) return;

    const branches = activeNarrative.branches;

    // Find all scenes that need audio generation
    const scenesToProcess: string[] = [];
    for (const key of resolvedEntryKeys) {
      const entry = resolveEntry(activeNarrative, key);
      if (!entry || !isScene(entry)) continue;
      const scene = entry as Scene;

      // Has resolved prose but no audio
      const { prose } = resolveProseForBranch(scene, activeBranchId, branches);
      if (prose && !scene.audioUrl) {
        scenesToProcess.push(scene.id);
      }
    }

    if (scenesToProcess.length === 0) {
      return;
    }

    cancelledRef.current = false;
    pausedRef.current = false;

    const initialState: AudioRunState = {
      isRunning: true,
      isPaused: false,
      progress: { completed: 0, total: scenesToProcess.length, currentSceneId: null },
      statusMessage: 'Starting audio generation...',
      startedAt: Date.now(),
    };
    setRunState(initialState);
    runStateRef.current = initialState;

    runBulk(scenesToProcess);
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

  // Count how many scenes need audio
  const count = useCallback(() => {
    const { activeNarrative, resolvedEntryKeys, activeBranchId } = stateRef.current;
    if (!activeNarrative || !activeBranchId) return 0;

    const branches = activeNarrative.branches;
    let needsAudio = 0;

    for (const key of resolvedEntryKeys) {
      const entry = resolveEntry(activeNarrative, key);
      if (!entry || !isScene(entry)) continue;
      const scene = entry as Scene;

      const { prose } = resolveProseForBranch(scene, activeBranchId, branches);
      if (prose && !scene.audioUrl) needsAudio++;
    }

    return needsAudio;
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
    count,
  };
}
