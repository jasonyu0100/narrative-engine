'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import type { NarrativeState, Scene, Thread } from '@/types/narrative';
import { THREAD_TERMINAL_STATUSES, resolveEntry } from '@/types/narrative';
import { computeThreadStatuses } from '@/lib/narrative-utils';

const STATUS_FILLS: Record<string, string> = {
  dormant:    '#475569',
  active:     '#38BDF8',
  escalating: '#FBBF24',
  critical:   '#F87171',
  resolved:   '#34D399',
  subverted:  '#C084FC',
  abandoned:  '#64748B',
};

const TERMINAL = new Set<string>(THREAD_TERMINAL_STATUSES);
const ROW_H = 26;
const LABEL_W = 200;

type ThreadRow = {
  threadId: string;
  description: string;
  cluster: number;
  clusterLabel: string;
  firstScene: number;
  lastScene: number;
  endStatus: string;
  segments: { start: number; end: number; status: string }[];
  transitions: { sceneIdx: number; to: string }[];
  pulseScenes: number[];
};

type Arc = { fromId: string; toId: string; isCrossCluster: boolean };

// ── Cluster detection ───────────────────────────────────────────────────────

function detectClusters(narrative: NarrativeState): Record<string, { cluster: number; label: string }> {
  const threads = Object.values(narrative.threads);
  const parent: Record<string, string> = {};
  const find = (x: string): string => { if (!parent[x]) parent[x] = x; if (parent[x] !== x) parent[x] = find(parent[x]); return parent[x]; };
  const union = (a: string, b: string) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[ra] = rb; };

  for (const t of threads) find(t.id);
  for (const t of threads) for (const d of t.dependents) if (narrative.threads[d]) union(t.id, d);

  const pMap = new Map<string, string[]>();
  for (const t of threads) for (const p of t.participants) { if (!pMap.has(p.id)) pMap.set(p.id, []); pMap.get(p.id)!.push(t.id); }
  for (const [, ids] of pMap) for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);

  const groups = new Map<string, string[]>();
  for (const t of threads) { const r = find(t.id); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(t.id); }

  const result: Record<string, { cluster: number; label: string }> = {};
  let idx = 0;
  for (const [, tids] of groups) {
    const counts = new Map<string, number>();
    for (const tid of tids) {
      const t = narrative.threads[tid]; if (!t) continue;
      for (const p of t.participants) {
        const name = narrative.characters[p.id]?.name ?? narrative.locations[p.id]?.name ?? p.id;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    const label = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? `Cluster ${idx + 1}`;
    for (const tid of tids) result[tid] = { cluster: idx, label };
    idx++;
  }
  return result;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ThreadGraphView({
  narrative,
  resolvedKeys,
  currentIndex,
  onSelectThread,
}: {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentIndex: number;
  onSelectThread: (threadId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 500 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setDims({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const statuses = useMemo(
    () => computeThreadStatuses(narrative, currentIndex),
    [narrative, currentIndex],
  );

  const { rows, arcs, totalScenes } = useMemo(() => {
    const scenes: Scene[] = resolvedKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && e.kind === 'scene');
    const total = scenes.length;
    if (total === 0) return { rows: [] as ThreadRow[], arcs: [] as Arc[], totalScenes: 0 };

    const clusterInfo = detectClusters(narrative);
    const threadMuts = new Map<string, { sceneIdx: number; from: string; to: string }[]>();
    for (let i = 0; i < scenes.length; i++) {
      for (const tm of scenes[i].threadMutations) {
        if (!threadMuts.has(tm.threadId)) threadMuts.set(tm.threadId, []);
        threadMuts.get(tm.threadId)!.push({ sceneIdx: i, from: tm.from.toLowerCase(), to: tm.to.toLowerCase() });
      }
    }

    const r: ThreadRow[] = Object.values(narrative.threads).map((thread) => {
      const muts = threadMuts.get(thread.id) ?? [];
      const first = muts.length > 0 ? muts[0].sceneIdx : 0;
      const last = muts.length > 0 ? muts[muts.length - 1].sceneIdx : total - 1;
      const status = statuses[thread.id] ?? thread.status;
      const ci = clusterInfo[thread.id] ?? { cluster: 0, label: '' };

      const transitions: ThreadRow['transitions'] = [];
      const pulses: number[] = [];
      for (const m of muts) { if (m.from === m.to) pulses.push(m.sceneIdx); else transitions.push({ sceneIdx: m.sceneIdx, to: m.to }); }

      const segments: ThreadRow['segments'] = [];
      if (muts.length > 0) {
        let cur = muts[0].from; let start = first;
        for (const m of muts) { if (m.from !== m.to) { segments.push({ start, end: m.sceneIdx, status: cur }); cur = m.to; start = m.sceneIdx; } }
        segments.push({ start, end: last, status: cur });
      } else {
        segments.push({ start: 0, end: total - 1, status });
      }

      return { threadId: thread.id, description: thread.description, cluster: ci.cluster, clusterLabel: ci.label, firstScene: first, lastScene: last, endStatus: status, segments, transitions, pulseScenes: pulses };
    }).sort((a, b) => a.cluster - b.cluster || a.firstScene - b.firstScene);

    // Arcs
    const arcList: Arc[] = [];
    const arcSet = new Set<string>();
    for (const t of Object.values(narrative.threads)) {
      for (const depId of t.dependents) {
        if (!narrative.threads[depId]) continue;
        const key = [t.id, depId].sort().join('|');
        if (!arcSet.has(key)) { arcSet.add(key); arcList.push({ fromId: t.id, toId: depId, isCrossCluster: (clusterInfo[t.id]?.cluster ?? 0) !== (clusterInfo[depId]?.cluster ?? 0) }); }
      }
    }

    return { rows: r, arcs: arcList, totalScenes: total };
  }, [narrative, resolvedKeys, statuses]);

  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  if (totalScenes === 0 || rows.length === 0) {
    return <div ref={containerRef} className="h-full w-full flex items-center justify-center"><p className="text-text-dim text-xs">No thread data</p></div>;
  }

  const ARC_ZONE = 50;
  const timelineW = Math.max(dims.w - LABEL_W - ARC_ZONE - 20, 200);
  const svgH = Math.max(rows.length * ROW_H + 30, dims.h);
  const svgW = LABEL_W + timelineW + ARC_ZONE;
  const sceneToX = (idx: number) => LABEL_W + (idx / Math.max(totalScenes - 1, 1)) * timelineW;

  const rowIndex = new Map(rows.map((r, i) => [r.threadId, i]));

  // Highlighted threads from hovered row's convergence links
  const highlighted = useMemo(() => {
    if (!hoveredRow) return new Set<string>();
    const t = narrative.threads[hoveredRow];
    if (!t) return new Set<string>();
    const s = new Set(t.dependents.filter((id) => narrative.threads[id]));
    for (const other of Object.values(narrative.threads)) {
      if (other.dependents.includes(hoveredRow)) s.add(other.id);
    }
    return s;
  }, [hoveredRow, narrative]);

  // Cluster separators
  let prevCluster = -1;
  const clusterSeps: { y: number; label: string; color: string }[] = [];
  const CLUSTER_COLORS = ['#38BDF8', '#FBBF24', '#F87171', '#34D399', '#C084FC', '#FB923C', '#E879F9', '#22D3EE'];
  rows.forEach((r, i) => {
    if (r.cluster !== prevCluster) {
      clusterSeps.push({ y: i * ROW_H + 8, label: r.clusterLabel, color: CLUSTER_COLORS[r.cluster % CLUSTER_COLORS.length] });
      prevCluster = r.cluster;
    }
  });

  return (
    <div ref={containerRef} className="h-full w-full overflow-auto" style={{ scrollbarWidth: 'thin' }}>
      <svg width={svgW} height={svgH}>
        {/* Scene gridlines */}
        {Array.from({ length: Math.min(totalScenes, 20) }, (_, i) => {
          const idx = Math.round((i / Math.min(totalScenes - 1, 19)) * (totalScenes - 1));
          const x = sceneToX(idx);
          return <line key={i} x1={x} y1={0} x2={x} y2={svgH} stroke="#fff" strokeWidth={0.5} opacity={0.03} />;
        })}

        {/* Cluster separators */}
        {clusterSeps.map((cs, i) => (
          <g key={`cs-${i}`}>
            {i > 0 && <line x1={0} y1={cs.y - 6} x2={svgW} y2={cs.y - 6} stroke={cs.color} strokeWidth={0.5} opacity={0.15} />}
            <text x={4} y={cs.y - 10} className="text-[8px] font-semibold select-none" fill={cs.color} opacity={0.5}>{cs.label}</text>
          </g>
        ))}

        {/* Thread rows */}
        {rows.map((row, rowIdx) => {
          const y = rowIdx * ROW_H + 10;
          const barH = 8;
          const barY = y + (ROW_H - barH) / 2;
          const isHov = hoveredRow === row.threadId || highlighted.has(row.threadId);
          const isTerm = TERMINAL.has(row.endStatus);

          return (
            <g key={row.threadId} className="cursor-pointer"
              onClick={() => onSelectThread(row.threadId)}
              onMouseEnter={() => setHoveredRow(row.threadId)}
              onMouseLeave={() => setHoveredRow(null)}
            >
              {isHov && <rect x={0} y={y} width={svgW} height={ROW_H} fill="#fff" opacity={0.03} rx={2} />}
              <text x={10} y={y + ROW_H / 2 + 1} dominantBaseline="middle" className="text-[9px] select-none" fill={isHov ? '#ccc' : '#777'} opacity={isTerm && !isHov ? 0.4 : 1}>
                <tspan className="font-mono" fill="#555">{row.threadId} </tspan>
                {row.description.length > 26 ? row.description.slice(0, 24) + '…' : row.description}
              </text>
              <rect x={sceneToX(row.firstScene)} y={barY} width={Math.max(sceneToX(row.lastScene) - sceneToX(row.firstScene), 2)} height={barH} rx={2} fill="#fff" opacity={0.03} />
              {row.segments.map((seg, i) => {
                const x1 = sceneToX(seg.start); const x2 = sceneToX(Math.min(seg.end + 1, totalScenes - 1));
                return <rect key={i} x={x1} y={barY} width={Math.max(x2 - x1, 2)} height={barH} rx={2} fill={STATUS_FILLS[seg.status] ?? '#475569'} opacity={isTerm ? 0.3 : 0.5} />;
              })}
              {row.transitions.map((t, i) => <rect key={`t-${i}`} x={sceneToX(t.sceneIdx) - 1} y={barY - 1} width={2} height={barH + 2} rx={1} fill={STATUS_FILLS[t.to] ?? '#fff'} opacity={0.9} />)}
              {row.pulseScenes.map((s, i) => <line key={`p-${i}`} x1={sceneToX(s)} y1={barY + 1} x2={sceneToX(s)} y2={barY + barH - 1} stroke="#fff" strokeWidth={0.5} opacity={0.12} />)}
              <circle cx={sceneToX(row.lastScene) + 6} cy={y + ROW_H / 2} r={2.5} fill={STATUS_FILLS[row.endStatus] ?? '#475569'} opacity={isTerm ? 0.4 : 0.8} />
            </g>
          );
        })}

        {/* Convergence arcs */}
        {arcs.map((arc, i) => {
          const r1 = rowIndex.get(arc.fromId);
          const r2 = rowIndex.get(arc.toId);
          if (r1 === undefined || r2 === undefined) return null;
          const y1 = r1 * ROW_H + 10 + ROW_H / 2;
          const y2 = r2 * ROW_H + 10 + ROW_H / 2;
          const arcX = LABEL_W + timelineW + 12 + (i % 5) * 7;
          const d = `M ${arcX - 3} ${y1} C ${arcX + 12} ${y1}, ${arcX + 12} ${y2}, ${arcX - 3} ${y2}`;
          const isHov = hoveredRow === arc.fromId || hoveredRow === arc.toId;
          return (
            <path key={`a-${i}`} d={d} fill="none"
              stroke={arc.isCrossCluster ? '#f59e0b' : '#22d3ee'}
              strokeWidth={isHov ? 2 : 1}
              opacity={isHov ? 0.8 : (arc.isCrossCluster ? 0.4 : 0.2)}
            />
          );
        })}
      </svg>
    </div>
  );
}
