'use client';

import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { computeForceSnapshots, computeDeliveryCurve, classifyCurrentPosition, getEffectivePovId } from '@/lib/narrative-utils';
import type { Scene } from '@/types/narrative';

const POSITION_COLORS: Record<string, string> = {
  peak:    '#F59E0B',
  trough:  '#3B82F6',
  rising:  '#22C55E',
  falling: '#EF4444',
  stable:  'rgba(255,255,255,0.3)',
};

type Props = {
  arcId: string;
};

export default function ArcDetail({ arcId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  if (!narrative) return null;

  const arc = narrative.arcs[arcId];
  if (!arc) return null;

  const arcScenes = useMemo(() => {
    const resolvedSet = new Set(state.resolvedEntryKeys);
    return arc.sceneIds
      .filter((sid) => resolvedSet.has(sid))
      .map((sid) => narrative.scenes[sid])
      .filter(Boolean);
  }, [arc, narrative, state.resolvedEntryKeys]);

  const delivery = useMemo(() => {
    const allScenes = state.resolvedEntryKeys
      .map((k) => narrative.scenes[k])
      .filter((s): s is Scene => !!s);
    if (allScenes.length === 0) return null;
    const forceMap = computeForceSnapshots(allScenes);
    const ordered = allScenes.map((s) => forceMap[s.id]).filter(Boolean);
    const pts = computeDeliveryCurve(ordered);
    if (pts.length < 2) return null;
    const arcSceneIds = new Set(arc.sceneIds);
    const arcStart = allScenes.findIndex((s) => arcSceneIds.has(s.id));
    const position = classifyCurrentPosition(pts);
    return { pts, arcStart, position };
  }, [narrative, state.resolvedEntryKeys, arc.sceneIds]);

  return (
    <div className="flex flex-col gap-4">
      {/* Arc header */}
      <div>
        <div className="flex items-baseline gap-2">
          <h2 className="text-[10px] uppercase tracking-widest text-text-dim">Arc</h2>
          <span className="font-mono text-[10px] text-text-dim">{arcId}</span>
        </div>
        <p className="text-sm text-text-primary font-medium mt-0.5">{arc.name}</p>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-[10px] text-text-dim uppercase tracking-wider">
        <span>{arcScenes.length} scenes</span>
        <span>{arc.activeCharacterIds.length} characters</span>
        <span>{arc.locationIds.length} locations</span>
      </div>

      {/* Delivery chart */}
      {delivery && (() => {
        const { pts, arcStart, position } = delivery;
        const n = pts.length;
        const W = 260, H = 48;
        const smoothed = pts.map((p) => p.smoothed);
        const min = Math.min(...smoothed);
        const max = Math.max(...smoothed);
        const range = max - min || 1;
        const toY = (v: number) => H - ((v - min) / range) * (H - 4) - 2;
        const allPts = smoothed.map((v, i) => `${(i / (n - 1)) * W},${toY(v)}`).join(' ');
        const arcX1 = arcStart >= 0 ? (arcStart / (n - 1)) * W : W;
        const arcPts = arcStart >= 0
          ? smoothed.slice(arcStart).map((v, i) => `${((arcStart + i) / (n - 1)) * W},${toY(v)}`).join(' ')
          : '';
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase tracking-widest text-text-dim">Delivery</span>
              {position && (
                <span className="text-[9px] font-medium" style={{ color: POSITION_COLORS[position.key] ?? 'white' }}>
                  {position.name}
                </span>
              )}
            </div>
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="rounded bg-white/2">
              <rect x={arcX1} y={0} width={W - arcX1} height={H} fill="rgba(245,158,11,0.06)" />
              <polyline points={allPts} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeLinejoin="round" />
              {arcPts && <polyline points={arcPts} fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
              {pts.map((p, i) => {
                if (!p.isPeak && !p.isValley) return null;
                const cx = (i / (n - 1)) * W;
                const cy = toY(p.smoothed);
                return p.isPeak
                  ? <polygon key={i} points={`${cx},${cy - 6} ${cx - 3.5},${cy} ${cx + 3.5},${cy}`} fill="#F59E0B" opacity="0.8" />
                  : <polygon key={i} points={`${cx},${cy + 6} ${cx - 3.5},${cy} ${cx + 3.5},${cy}`} fill="#3B82F6" opacity="0.8" />;
              })}
            </svg>
          </div>
        );
      })()}

      {/* Threads developed */}
      {arc.develops.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Develops
          </h3>
          <div className="flex flex-col gap-1">
            {arc.develops.map((threadId) => {
              const thread = narrative.threads[threadId];
              const transitions = arcScenes.flatMap((s) =>
                s.kind === 'scene' ? s.threadDeltas.filter((tm) => tm.threadId === threadId) : []
              );
              return (
                <button
                  key={threadId}
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: 'SET_INSPECTOR',
                      context: { type: 'thread', threadId },
                    })
                  }
                  className="flex flex-col gap-1 rounded bg-white/3 px-2 py-1.5 text-left transition-colors hover:bg-white/7 group"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-text-dim shrink-0">{threadId}</span>
                    <span className="text-[10px] text-text-secondary group-hover:text-text-primary transition-colors leading-relaxed">
                      {thread?.description ?? threadId}
                    </span>
                  </div>
                  {transitions.length > 0 && (
                    <div className="flex items-center gap-1 pl-9 font-mono text-[9px]">
                      <span className="text-text-dim">{transitions[0].from}</span>
                      {transitions.map((tm, i) => (
                        <span key={i} className="flex items-center gap-1">
                          <span className="text-text-dim/50">→</span>
                          <span className="text-amber-400">{tm.to}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Characters */}
      {arc.activeCharacterIds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Characters
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {arc.activeCharacterIds.map((cid) => {
              const char = narrative.characters[cid];
              if (!char) return null;
              return (
                <button
                  key={cid}
                  type="button"
                  onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'character', characterId: cid } })}
                  className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                >
                  {char.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Scene summaries */}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
          Scene Summaries
        </h3>
        <div className="flex flex-col gap-2">
          {arcScenes.map((scene, i) => {
            const sceneIdx = state.resolvedEntryKeys.indexOf(scene.id);
            const loc = scene.kind === 'scene' ? narrative.locations[scene.locationId] : null;
            const povId = scene.kind === 'scene' ? getEffectivePovId(scene) : null;
            const pov = povId ? narrative.characters[povId] : null;
            return (
              <button
                key={scene.id}
                type="button"
                onClick={() => {
                  if (sceneIdx >= 0) {
                    dispatch({ type: 'SET_SCENE_INDEX', index: sceneIdx });
                  }
                  dispatch({
                    type: 'SET_INSPECTOR',
                    context: { type: 'scene', sceneId: scene.id },
                  });
                }}
                className="group flex flex-col gap-1 rounded bg-white/3 p-2 text-left transition-colors hover:bg-white/7"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-text-dim shrink-0">{i + 1}</span>
                  {loc && <span className="text-[10px] text-text-dim">{loc.name}</span>}
                  {pov && <span className="text-[10px] text-text-dim ml-auto">POV: {pov.name}</span>}
                </div>
                <p className="text-xs text-text-secondary leading-relaxed group-hover:text-text-primary transition-colors">
                  {scene.summary || 'No summary available.'}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
