'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { NarrativeState, Scene } from '@/types/narrative';
import { useStore } from '@/lib/store';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { apiHeaders } from '@/lib/api-headers';
import { saveAudioBlob, resolveAudioUrl, deleteAudioBlob } from '@/lib/audio-store';

export function SceneAudioView({
  narrative,
  scene,
}: {
  narrative: NarrativeState;
  scene: Scene;
}) {
  const { dispatch } = useStore();
  const access = useFeatureAccess();

  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(() =>
    scene.audioUrl ? 'ready' : 'idle'
  );
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Get the audio URL — from scene directly
  const audioUrl = scene.audioUrl || '';

  // Reset on scene change
  useEffect(() => {
    stopPlayback();
    setStatus(scene.audioUrl ? 'ready' : 'idle');
    setError('');
    setCurrentTime(0);
    setDuration(0);
  }, [scene.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function stopPlayback() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPlaying(false);
  }

  // Cleanup on unmount
  useEffect(() => () => stopPlayback(), []);

  const generateAudio = useCallback(async () => {
    if (!scene.prose) return;
    const voice = narrative.storySettings?.audioVoice || 'nova';
    const model = narrative.storySettings?.audioModel || 'tts-1';

    if (access.userApiKeys && !access.hasOpenAiKey) {
      window.dispatchEvent(new Event('open-api-keys'));
      return;
    }

    setStatus('loading');
    setError('');
    try {
      const res = await fetch('/api/generate-audio', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ voice, model, text: scene.prose }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'TTS failed' }));
        throw new Error(err.error || `TTS failed (${res.status})`);
      }
      const blob = await res.blob();
      // Store blob in IndexedDB, save lightweight marker on the scene
      const marker = await saveAudioBlob(scene.id, blob);
      dispatch({ type: 'SET_SCENE_AUDIO', sceneId: scene.id, audioUrl: marker });
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [narrative, scene, access, dispatch]);

  const clearAudio = useCallback(() => {
    stopPlayback();
    setStatus('idle');
    setCurrentTime(0);
    setDuration(0);
    deleteAudioBlob(scene.id);
    dispatch({ type: 'CLEAR_SCENE_AUDIO', sceneId: scene.id });
  }, [scene.id, dispatch]);

  // Palette events
  useEffect(() => {
    const onGen = () => { generateAudio(); };
    const onClear = () => { clearAudio(); };
    window.addEventListener('canvas:generate-audio', onGen);
    window.addEventListener('canvas:clear-audio', onClear);
    return () => {
      window.removeEventListener('canvas:generate-audio', onGen);
      window.removeEventListener('canvas:clear-audio', onClear);
    };
  }, [generateAudio, clearAudio]);

  // Play/pause
  const togglePlay = useCallback(async () => {
    // If something is playing, stop it
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    // If was playing, just stop
    if (playing) {
      setPlaying(false);
      return;
    }
    // Resolve audio URL — from IDB blob or legacy data URL
    if (!audioUrl) return;
    const playUrl = await resolveAudioUrl(audioUrl, scene.id);
    if (!playUrl) return;
    const audio = new Audio(playUrl);
    audio.onloadedmetadata = () => setDuration(audio.duration);
    audio.onended = () => { setPlaying(false); setCurrentTime(0); if (timerRef.current) clearInterval(timerRef.current); };
    audio.play();
    audioRef.current = audio;
    setPlaying(true);
    // Poll currentTime for waveform progress
    timerRef.current = setInterval(() => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
    }, 100);
  }, [playing, audioUrl, scene.id]);

  // Seek
  const seek = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!duration) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const t = pct * duration;
    if (audioRef.current) audioRef.current.currentTime = t;
    setCurrentTime(t);
  }, [duration]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const mid = h / 2;
    const bars = Math.floor(w / 6);
    const barW = 3;
    const gap = (w - bars * barW) / Math.max(1, bars - 1);
    const progress = duration > 0 ? currentTime / duration : 0;

    ctx.clearRect(0, 0, w, h);

    const seed = scene.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    for (let i = 0; i < bars; i++) {
      const n1 = Math.sin(seed * 0.1 + i * 0.7) * 0.3;
      const n2 = Math.sin(seed * 0.3 + i * 1.3) * 0.25;
      const n3 = Math.sin(i * 0.4 + seed * 0.05) * 0.15;
      const n4 = Math.cos(i * 0.2 + seed * 0.15) * 0.1;
      const amplitude = Math.max(0.06, Math.min(0.95, n1 + n2 + n3 + n4 + 0.4));
      const barH = amplitude * h * 0.85;
      const x = i * (barW + gap);
      ctx.fillStyle = i / bars < progress ? 'rgba(139, 92, 246, 0.8)' : 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.roundRect(x, mid - barH / 2, barW, barH, 1.5);
      ctx.fill();
    }
  }, [currentTime, duration, scene.id, status]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCurrentTime((t) => t));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const hasProse = !!scene.prose;
  const hasVoice = !!narrative.storySettings?.audioVoice;

  return (
    <div ref={containerRef} className="h-full flex flex-col items-center justify-center px-8">

      {status === 'loading' && (
        <div className="flex flex-col items-center gap-3">
          <div className="w-5 h-5 border-2 border-violet-500/20 border-t-violet-400 rounded-full animate-spin" />
          <p className="text-[11px] text-text-dim">Generating audio...</p>
        </div>
      )}

      {status === 'error' && (
        <div className="text-center">
          <p className="text-[11px] text-red-400/80 mb-3">{error}</p>
          <button onClick={() => void generateAudio()} className="text-[10px] px-4 py-1.5 rounded-full border border-white/10 text-text-dim hover:text-text-secondary transition">Retry</button>
        </div>
      )}

      {status === 'ready' && (
        <div className="w-full max-w-4xl flex flex-col items-center gap-6">
          <canvas ref={canvasRef} className="w-full cursor-pointer" style={{ height: '20vh' }} onClick={seek} />
          <div className="flex items-center gap-5">
            <span className="text-[11px] text-text-dim font-mono tabular-nums w-12 text-right">{formatTime(currentTime)}</span>
            <button
              onClick={togglePlay}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition ${
                playing ? 'bg-violet-500/25 text-violet-300 ring-2 ring-violet-500/25' : 'bg-white/10 text-text-primary hover:bg-white/15'
              }`}
            >
              {playing ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="ml-1"><polygon points="6,3 20,12 6,21" /></svg>
              )}
            </button>
            <span className="text-[11px] text-text-dim font-mono tabular-nums w-12">{formatTime(duration)}</span>
          </div>
        </div>
      )}

      {status === 'idle' && (
        <div className="flex flex-col items-center gap-3">
          {!hasVoice ? (
            <>
              <p className="text-[11px] text-text-dim">No voice configured.</p>
              <button onClick={() => window.dispatchEvent(new CustomEvent('open-story-settings'))}
                className="text-[10px] text-violet-400/80 hover:text-violet-400 transition">
                Open Story Settings
              </button>
            </>
          ) : !hasProse ? (
            <>
              <p className="text-[11px] text-text-dim">Generate prose first, then create audio.</p>
              <button onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: 'prose' })}
                className="text-[10px] text-emerald-400/80 hover:text-emerald-400 transition">
                Switch to Prose &rarr;
              </button>
            </>
          ) : (
            <>
              <p className="text-[11px] text-text-dim">No audio for this scene yet.</p>
              <p className="text-[10px] text-text-dim/40">Use the palette below to generate audio.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
