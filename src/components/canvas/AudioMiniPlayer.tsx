'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useStore } from '@/lib/store';
import { IconChevronLeft, IconChevronRight } from '@/components/icons';

export function NowPlayingPill() {
  const { state: player, toggle, seek, stop, play } = useAudioPlayer();
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Current scene from timeline (what user is looking at)
  const currentSceneKey = narrative ? state.resolvedEntryKeys[state.currentSceneIndex] : null;
  const currentScene = currentSceneKey && narrative ? narrative.scenes[currentSceneKey] ?? null : null;
  const playingScene = player.sceneId && narrative ? narrative.scenes[player.sceneId] ?? null : null;
  const scene = playingScene ?? currentScene;

  // Find prev/next scenes with audio in timeline order
  const { prevScene, nextScene } = useMemo(() => {
    if (!narrative || !player.sceneId) return { prevScene: null, nextScene: null };
    const keys = state.resolvedEntryKeys;
    const currentIdx = keys.indexOf(player.sceneId);
    if (currentIdx < 0) return { prevScene: null, nextScene: null };

    let prev = null;
    for (let i = currentIdx - 1; i >= 0; i--) {
      const s = narrative.scenes[keys[i]];
      if (s?.audioUrl) { prev = s; break; }
    }
    let next = null;
    for (let i = currentIdx + 1; i < keys.length; i++) {
      const s = narrative.scenes[keys[i]];
      if (s?.audioUrl) { next = s; break; }
    }
    return { prevScene: prev, nextScene: next };
  }, [state.resolvedEntryKeys, player.sceneId, narrative]);

  if (!narrative || !scene) return null;

  const hasAnyAudio = player.sceneId !== null;
  const currentSceneHasAudio = !!currentScene?.audioUrl;
  const progress = player.duration > 0 ? player.currentTime / player.duration : 0;
  const arc = Object.values(narrative.arcs).find((a) => a.sceneIds.includes(scene.id));

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Pill button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`px-2.5 py-1 rounded-full transition-colors flex items-center gap-1.5 text-[12px] border ${
          player.playing
            ? 'border-violet-500/30 text-violet-400 bg-violet-500/10 hover:bg-violet-500/15'
            : 'border-white/8 text-text-secondary hover:text-text-primary hover:bg-white/5 hover:border-white/15'
        }`}
        title="Audio player"
      >
        {player.playing ? (
          <div className="w-3 h-3 flex items-center justify-center gap-px">
            <div className="w-0.5 h-2 bg-violet-400 rounded-full animate-pulse" />
            <div className="w-0.5 h-3 bg-violet-400 rounded-full animate-pulse" style={{ animationDelay: '0.15s' }} />
            <div className="w-0.5 h-1.5 bg-violet-400 rounded-full animate-pulse" style={{ animationDelay: '0.3s' }} />
          </div>
        ) : (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
          </svg>
        )}
        {hasAnyAudio ? (
          <span className="font-mono tabular-nums">{formatTime(player.currentTime)}</span>
        ) : (
          <span>Audio</span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute top-full mt-2 right-0 w-80 rounded-xl border border-white/10 overflow-hidden z-50"
          style={{ background: '#1a1a1a', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
        >
          <div className="px-4 py-3">
            {hasAnyAudio ? (
              <>
                {/* Now playing info */}
                <p className="text-[11px] text-text-secondary leading-snug line-clamp-2 mb-0.5">{playingScene?.summary}</p>
                {arc && <p className="text-[9px] text-text-dim/50 mb-1">{arc.name}</p>}
                {/* Switch to current scene if different */}
                {currentScene && currentScene.id !== player.sceneId && currentSceneHasAudio && (
                  <button
                    onClick={() => play(currentScene.id, currentScene.audioUrl!)}
                    className="text-[10px] text-violet-400/70 hover:text-violet-400 transition mt-1 mb-1"
                  >
                    Play current scene instead &rarr;
                  </button>
                )}
              </>
            ) : (
              /* Nothing playing */
              currentSceneHasAudio && currentScene ? (
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] text-text-secondary line-clamp-1 flex-1 mr-2">{currentScene.summary.slice(0, 60)}</p>
                  <button
                    onClick={() => play(currentScene.id, currentScene.audioUrl!)}
                    className="shrink-0 w-7 h-7 rounded-full bg-violet-500/15 text-violet-400 flex items-center justify-center hover:bg-violet-500/25 transition"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5"><polygon points="6,3 20,12 6,21" /></svg>
                  </button>
                </div>
              ) : (
                <p className="text-[10px] text-text-dim/50 text-center py-1">No audio for current scene</p>
              )
            )}

            {/* Progress + controls — only when audio is active */}
            {hasAnyAudio && (
              <>
                <div
                  className="h-1.5 bg-white/8 rounded-full cursor-pointer mb-2"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    seek(pct * player.duration);
                  }}
                >
                  <div className="h-full bg-violet-400/70 rounded-full transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-text-dim font-mono tabular-nums">{formatTime(player.currentTime)}</span>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => prevScene && play(prevScene.id, prevScene.audioUrl!)}
                      disabled={!prevScene}
                      className={`w-7 h-7 flex items-center justify-center rounded-full transition ${
                        prevScene ? 'text-text-secondary hover:text-text-primary hover:bg-white/10' : 'text-text-dim/20 cursor-default'
                      }`}
                      title={prevScene ? 'Previous scene' : 'No previous audio'}
                    >
                      <IconChevronLeft size={14} />
                    </button>

                    <button
                      onClick={() => toggle(player.sceneId!, playingScene?.audioUrl ?? scene.audioUrl!)}
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition ${
                        player.playing ? 'bg-violet-500/20 text-violet-300' : 'bg-white/10 text-text-primary hover:bg-white/15'
                      }`}
                    >
                      {player.playing ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5"><polygon points="6,3 20,12 6,21" /></svg>
                      )}
                    </button>

                    <button
                      onClick={() => nextScene && play(nextScene.id, nextScene.audioUrl!)}
                      disabled={!nextScene}
                      className={`w-7 h-7 flex items-center justify-center rounded-full transition ${
                        nextScene ? 'text-text-secondary hover:text-text-primary hover:bg-white/10' : 'text-text-dim/20 cursor-default'
                      }`}
                      title={nextScene ? 'Next scene' : 'No next audio'}
                    >
                      <IconChevronRight size={14} />
                    </button>

                    <button onClick={() => { stop(); setOpen(false); }} className="text-[9px] text-text-dim/40 hover:text-text-dim transition px-1.5 ml-1">
                      Stop
                    </button>
                  </div>

                  <span className="text-[9px] text-text-dim font-mono tabular-nums">{formatTime(player.duration)}</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
