'use client';

import { useMemo, useState } from 'react';
import type { NarrativeState, Scene, CubeCornerKey } from '@/types/narrative';
import { NARRATIVE_CUBE, resolveEntry, isScene } from '@/types/narrative';
import { computeForceSnapshots, computeWindowedForces, detectCubeCorner, FORCE_WINDOW_SIZE } from '@/lib/narrative-utils';

type Scope = 'global' | 'local';
type SortKey = 'index' | 'payoff' | 'change' | 'knowledge' | 'proximity';

type SceneEntry = {
  scene: Scene;
  index: number;
  corner: CubeCornerKey;
  cornerName: string;
  proximity: number;
  forces: { payoff: number; change: number; knowledge: number };
  arcName: string;
  locationName: string;
  povName: string;
};

const CORNER_COLORS: Record<CubeCornerKey, string> = {
  HHH: '#a78bfa', // Convergence — purple
  HHL: '#ef4444', // Climax — red
  HLH: '#f97316', // Twist — orange
  HLL: '#facc15', // Closure — yellow
  LHH: '#22d3ee', // Discovery — cyan
  LHL: '#22c55e', // Growth — green
  LLH: '#818cf8', // Wandering — indigo
  LLL: '#6b7280', // Rest — gray
};

export function CubeExplorer({
  narrative,
  resolvedKeys,
  currentSceneIndex,
  onClose,
  onNavigate,
}: {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentSceneIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const [scope, setScope] = useState<Scope>('global');
  const [filterCorner, setFilterCorner] = useState<CubeCornerKey | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('index');
  const [sortAsc, setSortAsc] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const allScenes = useMemo(() => {
    return resolvedKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
  }, [narrative, resolvedKeys]);

  const entries = useMemo((): SceneEntry[] => {
    if (allScenes.length === 0) return [];

    let forceMap: Record<string, { payoff: number; change: number; knowledge: number }>;

    if (scope === 'local') {
      const currentIdx = Math.min(
        allScenes.length - 1,
        resolvedKeys.slice(0, currentSceneIndex + 1)
          .filter((k) => resolveEntry(narrative, k)?.kind === 'scene').length - 1,
      );
      const windowed = computeWindowedForces(allScenes, Math.max(0, currentIdx));
      forceMap = windowed.forceMap;
    } else {
      forceMap = computeForceSnapshots(allScenes);
    }

    return allScenes.map((scene, i) => {
      const forces = forceMap[scene.id] ?? { payoff: 0, change: 0, knowledge: 0 };
      const corner = detectCubeCorner(forces);
      const cubeForces = NARRATIVE_CUBE[corner.key].forces;
      const dist = Math.sqrt(
        (forces.payoff - cubeForces.payoff) ** 2 +
        (forces.change - cubeForces.change) ** 2 +
        (forces.knowledge - cubeForces.knowledge) ** 2,
      );
      const proximity = Math.exp(-dist / 2);

      const arc = Object.values(narrative.arcs).find((a) => a.sceneIds.includes(scene.id));
      const location = narrative.locations[scene.locationId];
      const pov = narrative.characters[scene.povId];

      return {
        scene,
        index: i,
        corner: corner.key,
        cornerName: corner.name,
        proximity,
        forces,
        arcName: arc?.name ?? '',
        locationName: location?.name ?? '',
        povName: pov?.name ?? '',
      };
    });
  }, [allScenes, scope, narrative, resolvedKeys, currentSceneIndex]);

  // Corner counts for filter buttons
  const cornerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) counts[e.corner] = (counts[e.corner] ?? 0) + 1;
    return counts;
  }, [entries]);

  // Filter and sort
  const displayed = useMemo(() => {
    let list = filterCorner === 'all' ? entries : entries.filter((e) => e.corner === filterCorner);

    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'index': cmp = a.index - b.index; break;
        case 'payoff': cmp = a.forces.payoff - b.forces.payoff; break;
        case 'change': cmp = a.forces.change - b.forces.change; break;
        case 'knowledge': cmp = a.forces.knowledge - b.forces.knowledge; break;
        case 'proximity': cmp = a.proximity - b.proximity; break;
      }
      return sortAsc ? cmp : -cmp;
    });

    return list;
  }, [entries, filterCorner, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(key === 'index');
    }
  };

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortAsc ? ' \u25B2' : ' \u25BC') : '';

  return (
    <div className="fixed inset-0 bg-black z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-bg-base border border-white/10 rounded-xl shadow-2xl w-[720px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-text-primary">Cube Explorer</h2>
            <span className="text-[10px] text-text-dim font-mono">{displayed.length} scenes</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Scope toggle */}
            <div className="flex rounded-md overflow-hidden border border-white/10">
              {(['global', 'local'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`px-2.5 py-1 text-[10px] capitalize transition-colors ${
                    scope === s ? 'bg-white/12 text-text-primary' : 'text-text-dim hover:text-text-secondary'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="text-text-dim hover:text-text-primary text-lg leading-none transition">
              &times;
            </button>
          </div>
        </div>

        {/* Corner filter chips */}
        <div className="px-5 py-3 border-b border-white/5 flex flex-wrap gap-1.5 shrink-0">
          <button
            onClick={() => setFilterCorner('all')}
            className={`px-2.5 py-1 rounded-full text-[10px] border transition-colors ${
              filterCorner === 'all'
                ? 'border-white/20 bg-white/10 text-text-primary'
                : 'border-white/8 text-text-dim hover:text-text-secondary hover:border-white/12'
            }`}
          >
            All ({entries.length})
          </button>
          {(Object.keys(NARRATIVE_CUBE) as CubeCornerKey[]).map((key) => {
            const corner = NARRATIVE_CUBE[key];
            const count = cornerCounts[key] ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={key}
                onClick={() => setFilterCorner(filterCorner === key ? 'all' : key)}
                className={`px-2.5 py-1 rounded-full text-[10px] border transition-colors flex items-center gap-1.5 ${
                  filterCorner === key
                    ? 'border-white/20 bg-white/10 text-text-primary'
                    : 'border-white/8 text-text-dim hover:text-text-secondary hover:border-white/12'
                }`}
              >
                <svg width="18" height="10" viewBox="0 0 18 10" className="shrink-0">
                  {([0,1,2]).map((i) => {
                    const isHigh = key[i] === 'H';
                    const colors = ['#EF4444','#22C55E','#3B82F6'];
                    const barH = isHigh ? 7 : 3;
                    return <rect key={i} x={i * 7} y={10 - barH} width={5} height={barH} rx={0.75} fill={colors[i]} opacity={0.75} />;
                  })}
                </svg>
                {corner.name} ({count})
              </button>
            );
          })}
        </div>

        {/* Table header */}
        <div className="grid grid-cols-[40px_80px_1fr_60px_60px_60px_50px] gap-px px-5 py-2 border-b border-white/5 shrink-0 bg-white/[0.02]">
          {[
            { key: 'index' as SortKey, label: '#', width: '' },
            { key: 'proximity' as SortKey, label: 'Corner', width: '' },
            { key: 'index' as SortKey, label: 'Summary', width: '' },
            { key: 'payoff' as SortKey, label: 'P', width: '' },
            { key: 'change' as SortKey, label: 'C', width: '' },
            { key: 'knowledge' as SortKey, label: 'V', width: '' },
            { key: 'proximity' as SortKey, label: 'Prox', width: '' },
          ].map((col, i) => (
            <button
              key={i}
              onClick={() => handleSort(col.key)}
              className="text-[9px] uppercase tracking-wider text-text-dim font-mono text-left hover:text-text-secondary transition-colors"
            >
              {col.label}{sortArrow(col.key)}
            </button>
          ))}
        </div>

        {/* Scene rows */}
        <div className="flex-1 overflow-y-auto">
          {displayed.length === 0 ? (
            <div className="py-12 text-center text-[11px] text-text-dim">No scenes match this filter</div>
          ) : (
            displayed.map((entry) => {
              const isExpanded = expandedId === entry.scene.id;
              return (
                <div key={entry.scene.id}>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : entry.scene.id)}
                    className={`w-full grid grid-cols-[40px_80px_1fr_60px_60px_60px_50px] gap-px px-5 py-2.5 text-left transition-colors ${
                      isExpanded ? 'bg-white/8' : 'hover:bg-white/4'
                    }`}
                  >
                    <span className="text-[10px] font-mono text-text-dim">{entry.index + 1}</span>
                    <span className="flex items-center gap-1.5">
                      <svg width="24" height="12" viewBox="0 0 24 12" className="shrink-0">
                        {(['P','C','V'] as const).map((_, i) => {
                          const isHigh = entry.corner[i] === 'H';
                          const colors = ['#EF4444','#22C55E','#3B82F6'];
                          const barH = isHigh ? 9 : 4;
                          return <rect key={i} x={i * 9} y={12 - barH} width={7} height={barH} rx={1} fill={colors[i]} opacity={0.75} />;
                        })}
                      </svg>
                      <span className="text-[10px] font-medium truncate" style={{ color: CORNER_COLORS[entry.corner] }}>
                        {entry.cornerName}
                      </span>
                    </span>
                    <span className="text-[11px] text-text-secondary truncate pr-2">{entry.scene.summary}</span>
                    <span className="text-[10px] font-mono text-[#EF4444]">{entry.forces.payoff.toFixed(1)}</span>
                    <span className="text-[10px] font-mono text-[#22C55E]">{entry.forces.change.toFixed(1)}</span>
                    <span className="text-[10px] font-mono text-[#3B82F6]">{entry.forces.knowledge.toFixed(1)}</span>
                    <span className="text-[10px] font-mono text-text-dim">{(entry.proximity * 100).toFixed(0)}%</span>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-5 pb-4 pt-1 bg-white/[0.03] border-b border-white/5">
                      <div className="ml-[40px]">
                        {/* Meta row */}
                        <div className="flex items-center gap-4 mb-3 text-[10px] text-text-dim">
                          {entry.arcName && (
                            <span className="flex items-center gap-1">
                              <span className="text-text-dim/50">Arc:</span> {entry.arcName}
                            </span>
                          )}
                          {entry.locationName && (
                            <span className="flex items-center gap-1">
                              <span className="text-text-dim/50">Loc:</span> {entry.locationName}
                            </span>
                          )}
                          {entry.povName && (
                            <span className="flex items-center gap-1">
                              <span className="text-text-dim/50">POV:</span> {entry.povName}
                            </span>
                          )}
                        </div>

                        {/* Full summary */}
                        <p className="text-[11px] text-text-secondary leading-relaxed mb-3">
                          {entry.scene.summary}
                        </p>

                        {/* Corner description */}
                        <div className="rounded-md bg-white/[0.03] border border-white/5 px-3 py-2 mb-3">
                          <span className="text-[9px] uppercase tracking-wider text-text-dim">
                            {NARRATIVE_CUBE[entry.corner].name} ({entry.corner})
                          </span>
                          <p className="text-[10px] text-text-dim mt-1 leading-relaxed">
                            {NARRATIVE_CUBE[entry.corner].description}
                          </p>
                        </div>

                        {/* Events */}
                        {entry.scene.events.length > 0 && (
                          <div className="mb-3">
                            <span className="text-[9px] uppercase tracking-wider text-text-dim block mb-1">Events</span>
                            <ul className="space-y-0.5">
                              {entry.scene.events.map((evt, i) => (
                                <li key={i} className="text-[10px] text-text-secondary flex items-start gap-1.5">
                                  <span className="text-text-dim/40 mt-0.5 shrink-0">&bull;</span>
                                  {evt}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Thread mutations */}
                        {entry.scene.threadMutations.length > 0 && (
                          <div className="mb-3">
                            <span className="text-[9px] uppercase tracking-wider text-text-dim block mb-1">Threads</span>
                            <div className="space-y-1">
                              {entry.scene.threadMutations.map((tm, i) => {
                                const thread = Object.values(narrative.threads).find((t) => t.id === tm.threadId);
                                return (
                                  <div key={i} className="text-[10px] flex items-center gap-2">
                                    <span className="text-text-dim font-mono">{tm.from}</span>
                                    <span className="text-text-dim/40">&rarr;</span>
                                    <span className="text-text-secondary font-mono">{tm.to}</span>
                                    <span className="text-text-dim/60 truncate">{thread?.description ?? tm.threadId}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Participants */}
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-[9px] uppercase tracking-wider text-text-dim">Cast:</span>
                          <span className="text-[10px] text-text-dim">
                            {entry.scene.participantIds
                              .map((pid) => narrative.characters[pid]?.name ?? pid)
                              .join(', ')}
                          </span>
                        </div>

                        {/* Navigate button */}
                        <button
                          onClick={() => {
                            const tlIdx = resolvedKeys.indexOf(entry.scene.id);
                            if (tlIdx >= 0) onNavigate(tlIdx);
                            onClose();
                          }}
                          className="text-[10px] px-3 py-1.5 rounded-full border border-white/10 text-text-dim hover:text-text-secondary hover:border-white/15 transition"
                        >
                          Go to scene
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
