'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';
import type { GraphViewMode } from '@/types/narrative';

const GRAPH_DOMAINS = [
  { label: 'World',     local: 'spatial' as GraphViewMode, global: 'overview' as GraphViewMode },
  { label: 'Knowledge', local: 'spark'   as GraphViewMode, global: 'codex'    as GraphViewMode },
  { label: 'Threads',   local: 'pulse'   as GraphViewMode, global: 'threads'  as GraphViewMode },
];

const SCOPE_PAIRS: Record<string, { local: GraphViewMode; global: GraphViewMode }> = {
  spatial:  { local: 'spatial', global: 'overview' },
  overview: { local: 'spatial', global: 'overview' },
  spark:    { local: 'spark',   global: 'codex'    },
  codex:    { local: 'spark',   global: 'codex'    },
  pulse:    { local: 'pulse',   global: 'threads'  },
  threads:  { local: 'pulse',   global: 'threads'  },
};

const GRAPH_MODES = new Set<GraphViewMode>(['spatial', 'overview', 'spark', 'codex', 'pulse', 'threads']);

type CanvasMode = 'graph' | 'plan' | 'prose' | 'audio';

// Module-level state shared with SceneProseView
let beatPlanLinkedModeGlobal = false;

function BeatPlanToggle() {
  const [isOn, setIsOn] = useState(() => beatPlanLinkedModeGlobal);

  // Listen for toggle events from SceneProseView to stay in sync
  useEffect(() => {
    const handleToggled = (e: Event) => {
      const newValue = (e as CustomEvent).detail?.value ?? !isOn;
      setIsOn(newValue);
      beatPlanLinkedModeGlobal = newValue;
    };
    window.addEventListener('canvas:beat-plan-toggled', handleToggled);
    return () => window.removeEventListener('canvas:beat-plan-toggled', handleToggled);
  }, [isOn]);

  const handleClick = () => {
    const newValue = !isOn;
    setIsOn(newValue);
    beatPlanLinkedModeGlobal = newValue;
    window.dispatchEvent(new CustomEvent('canvas:toggle-beat-plan'));
    window.dispatchEvent(new CustomEvent('canvas:beat-plan-toggled', { detail: { value: newValue } }));
  };

  return (
    <button
      onClick={handleClick}
      className="relative inline-flex items-center rounded-full transition-all duration-200 overflow-hidden"
      style={{
        width: '64px',
        height: '20px',
        backgroundColor: isOn ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.05)',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: isOn ? 'rgba(245, 158, 11, 0.5)' : 'rgba(255, 255, 255, 0.1)',
      }}
    >
      {/* Background track with labels */}
      <div className="absolute inset-0 flex items-center justify-between px-1.5">
        <span
          className="text-[8px] font-semibold transition-opacity duration-200"
          style={{
            opacity: isOn ? 0 : 0.4,
            color: 'rgba(255, 255, 255, 0.4)',
          }}
        >
          OFF
        </span>
        <span
          className="text-[8px] font-semibold transition-opacity duration-200"
          style={{
            opacity: isOn ? 0.9 : 0,
            color: 'rgb(251, 191, 36)',
          }}
        >
          ON
        </span>
      </div>
      {/* Sliding pill */}
      <div
        className="absolute top-0.5 bottom-0.5 rounded-full transition-all duration-200"
        style={{
          width: '30px',
          left: isOn ? 'calc(100% - 31px)' : '1px',
          backgroundColor: isOn ? 'rgb(251, 191, 36)' : 'rgba(255, 255, 255, 0.3)',
          boxShadow: isOn ? '0 0 10px rgba(251, 191, 36, 0.5)' : '0 1px 3px rgba(0, 0, 0, 0.3)',
        }}
      />
    </button>
  );
}

function resolveCanvasMode(graphViewMode: GraphViewMode): CanvasMode {
  if (graphViewMode === 'plan') return 'plan';
  if (graphViewMode === 'prose') return 'prose';
  if (graphViewMode === 'audio') return 'audio';
  return 'graph';
}

export function CanvasTopBar() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const graphViewMode = state.graphViewMode;
  const canvasMode = resolveCanvasMode(graphViewMode);

  const isGraphMode = GRAPH_MODES.has(graphViewMode);
  const scopePair = isGraphMode ? SCOPE_PAIRS[graphViewMode] : null;
  const isLocal = scopePair ? graphViewMode === scopePair.local : false;

  // Remember last graph mode so we can return to it
  const lastGraphModeRef = useRef<GraphViewMode>('spatial');
  useEffect(() => {
    if (GRAPH_MODES.has(graphViewMode)) lastGraphModeRef.current = graphViewMode;
  }, [graphViewMode]);

  // ── Current scene ──────────────────────────────────────────────────────
  const currentScene = useMemo<Scene | null>(() => {
    if (!narrative) return null;
    const key = state.resolvedEntryKeys[state.currentSceneIndex];
    if (!key) return null;
    const entry = resolveEntry(narrative, key);
    return entry && isScene(entry) ? entry : null;
  }, [narrative, state.resolvedEntryKeys, state.currentSceneIndex]);

  // ── Mode-specific stats ───────────────────────────────────────────────
  const planStats = useMemo(() => {
    if (!currentScene?.plan?.beats) return null;
    const beats = currentScene.plan.beats.length;
    const propositions =
      currentScene.plan.beats.reduce(
        (sum, b) => sum + (b.propositions?.length ?? 0),
        0,
      ) + (currentScene.plan.propositions?.length ?? 0);
    return { beats, propositions };
  }, [currentScene]);

  const proseStats = useMemo(() => {
    if (!currentScene?.prose) return null;
    const text = currentScene.prose;
    const words = text.split(/\s+/).filter(Boolean).length;
    const paragraphs = text.split(/\n\n+/).filter((p) => p.trim()).length;
    return { words, paragraphs };
  }, [currentScene]);

  // ── ARC navigation ────────────────────────────────────────────────────
  const arcNav = useMemo(() => {
    if (!narrative) return { total: 0, currentArc: 0, arcOrder: [] as { arcId: string; firstTlIdx: number }[] };
    const arcs = Object.values(narrative.arcs);
    const arcOrder: { arcId: string; firstTlIdx: number }[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < state.resolvedEntryKeys.length; i++) {
      const entry = resolveEntry(narrative, state.resolvedEntryKeys[i]);
      if (entry && isScene(entry)) {
        const arc = arcs.find((a) => a.sceneIds.includes(entry.id));
        if (arc && !seen.has(arc.id)) {
          seen.add(arc.id);
          arcOrder.push({ arcId: arc.id, firstTlIdx: i });
        }
      }
    }
    let currentArc = 0;
    for (let i = arcOrder.length - 1; i >= 0; i--) {
      if (state.currentSceneIndex >= arcOrder[i].firstTlIdx) { currentArc = i + 1; break; }
    }
    return { total: arcOrder.length, currentArc, arcOrder };
  }, [narrative, state.resolvedEntryKeys, state.currentSceneIndex]);

  // ── Scene navigation ──────────────────────────────────────────────────
  const sceneNav = useMemo(() => {
    if (!narrative) return { sceneIndices: [] as number[], total: 0, currentSceneNum: 0 };
    const sceneIndices: number[] = [];
    for (let i = 0; i < state.resolvedEntryKeys.length; i++) {
      if (narrative.scenes[state.resolvedEntryKeys[i]]) sceneIndices.push(i);
    }
    let currentSceneNum = 0;
    for (let i = 0; i < sceneIndices.length; i++) {
      if (sceneIndices[i] <= state.currentSceneIndex) currentSceneNum = i + 1;
    }
    return { sceneIndices, total: sceneIndices.length, currentSceneNum };
  }, [narrative, state.resolvedEntryKeys, state.currentSceneIndex]);

  // ── Inline editing ────────────────────────────────────────────────────
  const [editField, setEditField] = useState<'scene' | 'arc' | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editField) setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 30);
    else setEditValue('');
  }, [editField]);

  const commit = useCallback(() => {
    const n = parseInt(editValue, 10);
    if (!isNaN(n) && n >= 1) {
      if (editField === 'scene') {
        const idx = Math.min(n - 1, sceneNav.sceneIndices.length - 1);
        if (sceneNav.sceneIndices[idx] !== undefined) {
          dispatch({ type: 'SET_SCENE_INDEX', index: sceneNav.sceneIndices[idx] });
        }
      } else if (editField === 'arc') {
        const idx = Math.min(n - 1, arcNav.arcOrder.length - 1);
        if (arcNav.arcOrder[idx]) {
          dispatch({ type: 'SET_SCENE_INDEX', index: arcNav.arcOrder[idx].firstTlIdx });
        }
      }
    }
    setEditField(null);
  }, [editValue, editField, sceneNav, arcNav, dispatch]);

  const switchMode = useCallback((mode: CanvasMode) => {
    if (mode === 'graph') dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: lastGraphModeRef.current });
    else dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode });
  }, [dispatch]);

  const inputClass = "w-8 bg-white/5 text-center text-[10px] font-mono text-text-primary rounded px-1 py-0.5 outline-none border border-white/15 focus:border-white/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="h-9 shrink-0 flex items-center px-2 gap-2 glass-panel border-b border-border">

      {/* Left — ARC / SCENE navigation */}
      {narrative && sceneNav.total > 0 ? (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="text-[9px] uppercase tracking-wider text-text-dim/60">Arc</span>
            {editField === 'arc' ? (
              <input ref={inputRef} type="number" min={1} max={arcNav.total} value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditField(null); }}
                onBlur={commit} className={inputClass} />
            ) : (
              <button type="button"
                onClick={() => { setEditField('arc'); setEditValue(String(arcNav.currentArc)); }}
                className="text-[10px] font-mono text-text-secondary hover:text-text-primary transition-colors tabular-nums">
                {arcNav.currentArc}<span className="text-text-dim/40">/{arcNav.total}</span>
              </button>
            )}
          </div>

          <div className="w-px h-3 bg-border" />

          <div className="flex items-center gap-1">
            <span className="text-[9px] uppercase tracking-wider text-text-dim/60">Scene</span>
            {editField === 'scene' ? (
              <input ref={inputRef} type="number" min={1} max={sceneNav.total} value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditField(null); }}
                onBlur={commit} className={inputClass} />
            ) : (
              <button type="button"
                onClick={() => { setEditField('scene'); setEditValue(String(sceneNav.currentSceneNum)); }}
                className="text-[10px] font-mono text-text-secondary hover:text-text-primary transition-colors tabular-nums">
                {sceneNav.currentSceneNum}<span className="text-text-dim/40">/{sceneNav.total}</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <span className="text-[10px] text-text-dim/40">No scenes</span>
      )}

      <div className="w-px h-3.5 bg-border" />

      {/* Contextual controls per mode */}
      {canvasMode === 'graph' && (
        <>
          {/* Graph domain tabs */}
          <div className="flex items-center gap-0.5">
            {GRAPH_DOMAINS.map(({ label, local, global: globalMode }) => {
              const isActive = graphViewMode === local || graphViewMode === globalMode;
              return (
                <button key={label}
                  className={`text-[10px] px-2 py-1 rounded transition-colors ${
                    isActive ? 'bg-white/10 text-text-primary' : 'text-text-dim hover:text-text-secondary hover:bg-white/5'
                  }`}
                  onClick={() => dispatch({
                    type: 'SET_GRAPH_VIEW_MODE',
                    mode: isActive ? (graphViewMode === local ? globalMode : local) : local,
                  })}>
                  {label}
                </button>
              );
            })}
          </div>

          {/* Scope toggle */}
          {scopePair && (
            <div className="flex items-center rounded bg-white/4 p-0.5">
              <button
                className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${isLocal ? 'bg-white/10 text-text-primary' : 'text-text-dim hover:text-text-secondary'}`}
                onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: scopePair.local })}>
                Local
              </button>
              <button
                className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${!isLocal ? 'bg-white/10 text-text-primary' : 'text-text-dim hover:text-text-secondary'}`}
                onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: scopePair.global })}>
                Global
              </button>
            </div>
          )}
        </>
      )}

      {canvasMode === 'plan' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-sky-400/60">Plan</span>
          {planStats && (
            <span className="text-[9px] text-text-dim/50 font-mono tabular-nums">
              {planStats.beats} beats{planStats.propositions > 0 && <> &middot; {planStats.propositions} props</>}
            </span>
          )}
          {!planStats && <span className="text-[9px] text-text-dim/30">No plan</span>}
        </div>
      )}

      {canvasMode === 'audio' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-violet-400/60">Audio</span>
          {currentScene?.audioUrl
            ? <span className="text-[9px] text-text-dim/50">Ready</span>
            : currentScene?.prose
              ? <span className="text-[9px] text-text-dim/30">Not generated</span>
              : <span className="text-[9px] text-text-dim/30">No prose</span>}
        </div>
      )}

      {canvasMode === 'prose' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-emerald-400/60">Prose</span>
          {proseStats && (
            <span className="text-[9px] text-text-dim/50 font-mono tabular-nums">
              {proseStats.words.toLocaleString()} words &middot; {proseStats.paragraphs} paragraphs
            </span>
          )}
          {!proseStats && planStats && <span className="text-[9px] text-text-dim/30">Not written</span>}
          {!proseStats && !planStats && <span className="text-[9px] text-text-dim/30">No plan</span>}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right — Mode toggle: Graph / Plan / Prose / Audio */}
      <div className="flex items-center gap-2">
        {/* Beat plan toggle (only in prose mode with beat mapping) - to the LEFT */}
        {canvasMode === 'prose' && currentScene?.plan && currentScene?.beatProseMap &&
         currentScene.beatProseMap.chunks.length === currentScene.plan.beats.length && (
          <BeatPlanToggle />
        )}

        <div className="flex items-center rounded bg-white/4 p-0.5">
          {(['graph', 'plan', 'prose', 'audio'] as CanvasMode[]).map((mode) => {
            const isActive = canvasMode === mode;
            const color = mode === 'plan' ? (isActive ? 'text-sky-400 bg-sky-500/15' : '')
              : mode === 'prose' ? (isActive ? 'text-emerald-400 bg-emerald-500/15' : '')
              : mode === 'audio' ? (isActive ? 'text-violet-400 bg-violet-500/15' : '')
              : (isActive ? 'text-text-primary bg-white/10' : '');
            return (
              <button key={mode}
                className={`text-[10px] px-2 py-0.5 rounded capitalize transition-colors ${
                  isActive ? color : 'text-text-dim hover:text-text-secondary'
                }`}
                onClick={() => switchMode(mode)}>
                {mode}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
