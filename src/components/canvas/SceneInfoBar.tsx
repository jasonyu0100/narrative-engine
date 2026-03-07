'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene } from '@/types/narrative';

export default function SceneInfoBar() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  // Arc navigation data
  const arcNav = useMemo(() => {
    if (!narrative) return { total: 0, currentArc: 0, arcOrder: [] as { firstTlIdx: number }[] };
    const arcs = Object.values(narrative.arcs);
    const arcOrder: { arcId: string; firstTlIdx: number }[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < state.resolvedSceneKeys.length; i++) {
      const entry = resolveEntry(narrative, state.resolvedSceneKeys[i]);
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
  }, [narrative, state.resolvedSceneKeys, state.currentSceneIndex]);

  const totalScenes = state.resolvedSceneKeys.length;

  // Inline editing
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
        dispatch({ type: 'SET_SCENE_INDEX', index: Math.min(n - 1, totalScenes - 1) });
      } else if (editField === 'arc') {
        const idx = Math.min(n - 1, arcNav.arcOrder.length - 1);
        if (arcNav.arcOrder[idx]) {
          dispatch({ type: 'SET_SCENE_INDEX', index: arcNav.arcOrder[idx].firstTlIdx });
        }
      }
    }
    setEditField(null);
  }, [editValue, editField, totalScenes, arcNav, dispatch]);

  if (!narrative || totalScenes === 0) return null;

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30">
      <div className="glass-pill px-4 py-2 flex items-center gap-3">
        {/* Arc position */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9px] uppercase tracking-widest text-text-dim">Arc</span>
          {editField === 'arc' ? (
            <input
              ref={inputRef}
              type="number"
              min={1}
              max={arcNav.total}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditField(null); }}
              onBlur={commit}
              className="w-8 bg-white/5 text-center text-[11px] font-mono text-text-primary rounded px-1 py-0.5 outline-none border border-white/15 focus:border-white/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => { setEditField('arc'); setEditValue(String(arcNav.currentArc)); }}
              className="text-[11px] font-mono text-text-primary hover:text-white transition-colors bg-white/5 rounded px-1.5 py-0.5 hover:bg-white/10"
            >
              {arcNav.currentArc}
            </button>
          )}
          <span className="text-[9px] text-text-dim font-mono">/ {arcNav.total}</span>
        </div>

        <div className="w-px h-4 bg-white/8" />

        {/* Scene position */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9px] uppercase tracking-widest text-text-dim">Scene</span>
          {editField === 'scene' ? (
            <input
              ref={inputRef}
              type="number"
              min={1}
              max={totalScenes}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditField(null); }}
              onBlur={commit}
              className="w-12 bg-white/5 text-center text-[11px] font-mono text-text-primary rounded px-1 py-0.5 outline-none border border-white/15 focus:border-white/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => { setEditField('scene'); setEditValue(String(state.currentSceneIndex + 1)); }}
              className="text-[11px] font-mono text-text-primary hover:text-white transition-colors bg-white/5 rounded px-1.5 py-0.5 hover:bg-white/10"
            >
              {state.currentSceneIndex + 1}
            </button>
          )}
          <span className="text-[9px] text-text-dim font-mono">/ {totalScenes}</span>
        </div>
      </div>
    </div>
  );
}
