'use client';

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { resolveAudioUrl, saveAudioBlob, deleteAudioBlob } from '@/lib/audio-store';
import { useStore } from '@/lib/store';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { apiHeaders } from '@/lib/api-headers';

type AudioPlayerState = {
  sceneId: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  loading: boolean;
};

type AudioPlayerApi = {
  state: AudioPlayerState;
  play: (sceneId: string, audioUrl: string) => void;
  pause: () => void;
  resume: () => void;
  toggle: (sceneId: string, audioUrl: string) => void;
  seek: (time: number) => void;
  stop: () => void;
  generate: (sceneId: string, prose: string) => Promise<void>;
  clear: (sceneId: string) => void;
};

const AudioPlayerContext = createContext<AudioPlayerApi | null>(null);

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const { state: appState, dispatch } = useStore();
  const access = useFeatureAccess();
  const narrative = appState.activeNarrative;

  const [playerState, setPlayerState] = useState<AudioPlayerState>({
    sceneId: null,
    playing: false,
    currentTime: 0,
    duration: 0,
    loading: false,
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = setInterval(() => {
      if (audioRef.current) setPlayerState((s) => ({ ...s, currentTime: audioRef.current!.currentTime }));
    }, 100);
  }, [stopTimer]);

  const stop = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    stopTimer();
    setPlayerState({ sceneId: null, playing: false, currentTime: 0, duration: 0, loading: false });
  }, [stopTimer]);

  const play = useCallback(async (sceneId: string, audioUrl: string) => {
    // Stop current
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    stopTimer();

    setPlayerState((s) => ({ ...s, sceneId, playing: false, currentTime: 0, duration: 0 }));

    const url = await resolveAudioUrl(audioUrl, sceneId);
    if (!url) return;

    const audio = new Audio(url);
    audio.onloadedmetadata = () => setPlayerState((s) => ({ ...s, duration: audio.duration }));
    audio.onended = () => {
      stopTimer();
      setPlayerState((s) => ({ ...s, playing: false, currentTime: 0 }));
    };
    audio.play();
    audioRef.current = audio;
    setPlayerState((s) => ({ ...s, playing: true }));
    startTimer();
  }, [stopTimer, startTimer]);

  const pause = useCallback(() => {
    if (audioRef.current) audioRef.current.pause();
    stopTimer();
    setPlayerState((s) => ({ ...s, playing: false }));
  }, [stopTimer]);

  const resume = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play();
      setPlayerState((s) => ({ ...s, playing: true }));
      startTimer();
    }
  }, [startTimer]);

  const toggle = useCallback((sceneId: string, audioUrl: string) => {
    if (playerState.sceneId === sceneId && playerState.playing) {
      pause();
    } else if (playerState.sceneId === sceneId && !playerState.playing && audioRef.current) {
      resume();
    } else {
      play(sceneId, audioUrl);
    }
  }, [playerState.sceneId, playerState.playing, play, pause, resume]);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setPlayerState((s) => ({ ...s, currentTime: time }));
    }
  }, []);

  const generate = useCallback(async (sceneId: string, prose: string) => {
    if (!prose || !narrative) return;
    const voice = narrative.storySettings?.audioVoice || 'nova';
    const model = narrative.storySettings?.audioModel || 'tts-1';

    if (access.userApiKeys && !access.hasOpenAiKey) {
      window.dispatchEvent(new Event('open-api-keys'));
      return;
    }

    setPlayerState((s) => ({ ...s, loading: true }));
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
      setPlayerState((s) => ({ ...s, loading: false }));
    } catch {
      setPlayerState((s) => ({ ...s, loading: false }));
    }
  }, [narrative, access, dispatch]);

  const clear = useCallback((sceneId: string) => {
    if (playerState.sceneId === sceneId) stop();
    deleteAudioBlob(sceneId);
    dispatch({ type: 'CLEAR_SCENE_AUDIO', sceneId });
  }, [playerState.sceneId, stop, dispatch]);

  const api: AudioPlayerApi = { state: playerState, play, pause, resume, toggle, seek, stop, generate, clear };

  return (
    <AudioPlayerContext.Provider value={api}>
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer(): AudioPlayerApi {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error('useAudioPlayer must be used within AudioPlayerProvider');
  return ctx;
}
