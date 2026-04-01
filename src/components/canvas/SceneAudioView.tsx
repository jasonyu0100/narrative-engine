'use client';

import { useEffect, useRef } from 'react';
import type { NarrativeState, Scene } from '@/types/narrative';
import { useStore } from '@/lib/store';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';

export function SceneAudioView({
  narrative,
  scene,
}: {
  narrative: NarrativeState;
  scene: Scene;
}) {
  const { dispatch } = useStore();
  const player = useAudioPlayer();
  const { state: ps } = player;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasAudio = !!scene.audioUrl;
  const hasProse = !!scene.prose;
  const hasVoice = !!narrative.storySettings?.audioVoice;
  const isThisScene = ps.sceneId === scene.id;
  const isPlaying = isThisScene && ps.playing;
  const currentTime = isThisScene ? ps.currentTime : 0;
  const duration = isThisScene ? ps.duration : 0;

  // Listen for palette events
  useEffect(() => {
    const onGenerate = () => { if (scene.prose) player.generate(scene.id, scene.prose); };
    const onClear = () => { player.clear(scene.id); };
    window.addEventListener('canvas:generate-audio', onGenerate);
    window.addEventListener('canvas:clear-audio', onClear);
    return () => {
      window.removeEventListener('canvas:generate-audio', onGenerate);
      window.removeEventListener('canvas:clear-audio', onClear);
    };
  }, [player, scene.id, scene.prose]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasAudio) return;
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
  }, [currentTime, duration, scene.id, hasAudio]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // force redraw
      const canvas = canvasRef.current;
      if (canvas) canvas.dispatchEvent(new Event('resize'));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!duration) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    player.seek(pct * duration);
  };

  return (
    <div ref={containerRef} className="h-full flex flex-col items-center justify-center px-8">

      {ps.loading && (
        <div className="flex flex-col items-center gap-3">
          <div className="w-5 h-5 border-2 border-violet-500/20 border-t-violet-400 rounded-full animate-spin" />
          <p className="text-[11px] text-text-dim">Generating audio...</p>
        </div>
      )}

      {hasAudio && !ps.loading && (
        <div className="w-full max-w-4xl flex flex-col items-center gap-6">
          <canvas ref={canvasRef} className="w-full cursor-pointer" style={{ height: '20vh' }} onClick={handleSeek} />
          <div className="flex items-center gap-5">
            <span className="text-[11px] text-text-dim font-mono tabular-nums w-12 text-right">{formatTime(currentTime)}</span>
            <button
              onClick={() => player.toggle(scene.id, scene.audioUrl!)}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition ${
                isPlaying ? 'bg-violet-500/25 text-violet-300 ring-2 ring-violet-500/25' : 'bg-white/10 text-text-primary hover:bg-white/15'
              }`}
            >
              {isPlaying ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="ml-1"><polygon points="6,3 20,12 6,21" /></svg>
              )}
            </button>
            <span className="text-[11px] text-text-dim font-mono tabular-nums w-12">{formatTime(duration)}</span>
          </div>
        </div>
      )}

      {!hasAudio && !ps.loading && (
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
