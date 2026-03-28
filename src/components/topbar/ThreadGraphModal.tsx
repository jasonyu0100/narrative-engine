'use client';

import { useMemo, useState } from 'react';
import type { NarrativeState, Thread, Scene } from '@/types/narrative';
import { THREAD_TERMINAL_STATUSES, resolveEntry } from '@/types/narrative';
import { computeThreadStatuses } from '@/lib/narrative-utils';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';

// ── Colors ──────────────────────────────────────────────────────────────────

const STATUS_FILLS: Record<string, string> = {
  dormant:    '#475569',
  active:     '#38BDF8',
  escalating: '#FBBF24',
  critical:   '#F87171',
  resolved:   '#34D399',
  subverted:  '#C084FC',
  abandoned:  '#64748B',
};

const CLUSTER_COLORS = [
  '#38BDF8', '#FBBF24', '#F87171', '#34D399', '#C084FC',
  '#FB923C', '#E879F9', '#22D3EE', '#A3E635', '#FDA4AF',
];

const TERMINAL = new Set<string>(THREAD_TERMINAL_STATUSES);

// ── Cluster detection via union-find ────────────────────────────────────────

type Cluster = { id: number; threadIds: string[]; label: string };

function detectClusters(
  threads: Thread[],
  narrative: NarrativeState,
): { clusters: Cluster[]; threadCluster: Record<string, number> } {
  const parent: Record<string, string> = {};
  const find = (x: string): string => {
    if (!parent[x]) parent[x] = x;
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (const t of threads) find(t.id);

  for (const t of threads) {
    for (const depId of t.dependents) {
      if (narrative.threads[depId]) union(t.id, depId);
    }
  }

  const participantToThreads = new Map<string, string[]>();
  for (const t of threads) {
    for (const p of t.participants) {
      if (!participantToThreads.has(p.id)) participantToThreads.set(p.id, []);
      participantToThreads.get(p.id)!.push(t.id);
    }
  }
  for (const [, tids] of participantToThreads) {
    for (let i = 1; i < tids.length; i++) union(tids[0], tids[i]);
  }

  const groups = new Map<string, string[]>();
  for (const t of threads) {
    const root = find(t.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(t.id);
  }

  const clusters: Cluster[] = [];
  const threadCluster: Record<string, number> = {};
  let idx = 0;
  for (const [, tids] of groups) {
    const participantCounts = new Map<string, number>();
    for (const tid of tids) {
      const t = narrative.threads[tid];
      if (!t) continue;
      for (const p of t.participants) {
        const name = narrative.characters[p.id]?.name ?? narrative.locations[p.id]?.name ?? p.id;
        participantCounts.set(name, (participantCounts.get(name) ?? 0) + 1);
      }
    }
    const topParticipant = [...participantCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? `Cluster ${idx + 1}`;
    clusters.push({ id: idx, threadIds: tids, label: topParticipant });
    for (const tid of tids) threadCluster[tid] = idx;
    idx++;
  }

  return { clusters, threadCluster };
}

// ── Timeline data ───────────────────────────────────────────────────────────

type ThreadRow = {
  threadId: string;
  description: string;
  cluster: number;
  firstScene: number;
  lastScene: number;
  endStatus: string;
  segments: { start: number; end: number; status: string }[];
  transitions: { sceneIdx: number; from: string; to: string }[];
  pulseScenes: number[];
};

type ConvergenceArc = {
  fromThreadId: string;
  toThreadId: string;
  type: 'converges' | 'shared-participant';
  isCrossCluster: boolean;
};

function buildTimelineData(
  narrative: NarrativeState,
  resolvedKeys: string[],
  statuses: Record<string, string>,
): { rows: ThreadRow[]; arcs: ConvergenceArc[]; clusters: Cluster[]; isolatedClusters: Cluster[]; totalScenes: number } {
  const scenes: Scene[] = resolvedKeys
    .map((k) => resolveEntry(narrative, k))
    .filter((e): e is Scene => !!e && e.kind === 'scene');

  const totalScenes = scenes.length;

  // Collect mutations per thread
  const threadMuts = new Map<string, { sceneIdx: number; from: string; to: string }[]>();
  for (let i = 0; i < scenes.length; i++) {
    for (const tm of scenes[i].threadMutations) {
      if (!threadMuts.has(tm.threadId)) threadMuts.set(tm.threadId, []);
      threadMuts.get(tm.threadId)!.push({ sceneIdx: i, from: tm.from.toLowerCase(), to: tm.to.toLowerCase() });
    }
  }

  const allThreads = Object.values(narrative.threads);
  const { clusters, threadCluster } = detectClusters(allThreads, narrative);

  // Build rows
  const rows: ThreadRow[] = [];
  for (const thread of allThreads) {
    const muts = threadMuts.get(thread.id) ?? [];
    const firstScene = muts.length > 0 ? muts[0].sceneIdx : 0;
    const lastScene = muts.length > 0 ? muts[muts.length - 1].sceneIdx : totalScenes - 1;
    const status = statuses[thread.id] ?? thread.status;

    const transitions: ThreadRow['transitions'] = [];
    const pulseScenes: number[] = [];
    for (const m of muts) {
      if (m.from === m.to) pulseScenes.push(m.sceneIdx);
      else transitions.push(m);
    }

    // Build status segments
    const segments: ThreadRow['segments'] = [];
    if (muts.length > 0) {
      let curStatus = muts[0].from;
      let segStart = firstScene;
      for (const m of muts) {
        if (m.from !== m.to) {
          segments.push({ start: segStart, end: m.sceneIdx, status: curStatus });
          curStatus = m.to;
          segStart = m.sceneIdx;
        }
      }
      segments.push({ start: segStart, end: lastScene, status: curStatus });
    } else {
      segments.push({ start: 0, end: totalScenes - 1, status });
    }

    rows.push({
      threadId: thread.id,
      description: thread.description,
      cluster: threadCluster[thread.id] ?? 0,
      firstScene,
      lastScene,
      endStatus: status,
      segments,
      transitions,
      pulseScenes,
    });
  }

  // Sort: by cluster, then by first scene within cluster
  rows.sort((a, b) => a.cluster - b.cluster || a.firstScene - b.firstScene);

  // Build convergence arcs
  const arcs: ConvergenceArc[] = [];
  const arcSet = new Set<string>();
  for (const t of allThreads) {
    for (const depId of t.dependents) {
      if (!narrative.threads[depId]) continue;
      const key = [t.id, depId].sort().join('|');
      if (arcSet.has(key)) continue;
      arcSet.add(key);
      arcs.push({
        fromThreadId: t.id,
        toThreadId: depId,
        type: 'converges',
        isCrossCluster: threadCluster[t.id] !== threadCluster[depId],
      });
    }
  }

  // Detect isolated clusters
  const clusterLinks = new Map<number, Set<number>>();
  for (const c of clusters) clusterLinks.set(c.id, new Set());
  for (const arc of arcs) {
    if (!arc.isCrossCluster) continue;
    const ca = threadCluster[arc.fromThreadId];
    const cb = threadCluster[arc.toThreadId];
    clusterLinks.get(ca)?.add(cb);
    clusterLinks.get(cb)?.add(ca);
  }
  const isolatedClusters = clusters.filter((c) =>
    c.threadIds.length > 1 && (clusterLinks.get(c.id)?.size ?? 0) === 0,
  );

  return { rows, arcs, clusters, isolatedClusters, totalScenes };
}

// ── Component ───────────────────────────────────────────────────────────────

const ROW_H = 28;
const LABEL_W = 220;
const PADDING_TOP = 10;
const CLUSTER_GAP = 14;

export function ThreadGraphModal({
  narrative,
  resolvedKeys,
  currentSceneIndex,
  onClose,
  onSelectThread,
}: {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentSceneIndex: number;
  onClose: () => void;
  onSelectThread: (threadId: string) => void;
}) {
  const statuses = useMemo(
    () => computeThreadStatuses(narrative, currentSceneIndex),
    [narrative, currentSceneIndex],
  );

  const { rows, arcs, clusters, isolatedClusters, totalScenes } = useMemo(
    () => buildTimelineData(narrative, resolvedKeys, statuses),
    [narrative, resolvedKeys, statuses],
  );

  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [hoveredArc, setHoveredArc] = useState<number | null>(null);

  // Compute y positions with cluster gaps
  const rowYMap = useMemo(() => {
    const map = new Map<string, number>();
    let y = PADDING_TOP;
    let prevCluster = -1;
    for (const row of rows) {
      if (row.cluster !== prevCluster && prevCluster !== -1) {
        y += CLUSTER_GAP;
      }
      map.set(row.threadId, y);
      y += ROW_H;
      prevCluster = row.cluster;
    }
    return map;
  }, [rows]);

  // Cluster label positions
  const clusterLabels = useMemo(() => {
    const labels: { cluster: Cluster; y: number }[] = [];
    for (const c of clusters) {
      if (c.threadIds.length === 0) continue;
      const ys = c.threadIds.map((id) => rowYMap.get(id) ?? 0).filter((y) => y > 0);
      if (ys.length === 0) continue;
      labels.push({ cluster: c, y: Math.min(...ys) });
    }
    return labels;
  }, [clusters, rowYMap]);

  const TIMELINE_W = 700;
  const totalH = (rowYMap.get(rows[rows.length - 1]?.threadId) ?? 0) + ROW_H + PADDING_TOP;
  const SVG_W = LABEL_W + TIMELINE_W + 40;
  const SVG_H = Math.max(totalH, 100);

  const sceneToX = (sceneIdx: number) => LABEL_W + (sceneIdx / Math.max(totalScenes - 1, 1)) * TIMELINE_W;

  // Highlight related threads when hovering an arc
  const highlightedThreads = useMemo(() => {
    if (hoveredArc === null) return new Set<string>();
    const arc = arcs[hoveredArc];
    if (!arc) return new Set<string>();
    return new Set([arc.fromThreadId, arc.toThreadId]);
  }, [hoveredArc, arcs]);

  return (
    <Modal onClose={onClose} size="6xl" maxHeight="90vh">
      <ModalHeader onClose={onClose}>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Thread Convergence</h2>
          <p className="text-[11px] text-text-dim mt-0.5">
            {rows.length} threads · {clusters.length} clusters · {arcs.length} convergence links · {totalScenes} scenes
          </p>
        </div>
      </ModalHeader>

        {/* Isolated cluster warnings */}
        {isolatedClusters.length > 0 && (
          <div className="px-6 pt-3 flex flex-col gap-1">
            {isolatedClusters.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded bg-amber-500/10 border border-amber-500/20 px-3 py-1.5">
                <span className="text-amber-400 text-[10px]">&#x26A0;</span>
                <span className="text-[11px] text-amber-300">
                  <strong>{c.label}</strong> cluster ({c.threadIds.length} threads) has no convergence links to other clusters
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Timeline */}
        <div className="flex-1 overflow-auto px-4 py-3 min-h-0">
          <svg width={SVG_W} height={SVG_H} className="select-none">
            {/* Scene axis ticks */}
            {Array.from({ length: Math.min(totalScenes, 20) }, (_, i) => {
              const sceneIdx = Math.round((i / Math.min(totalScenes - 1, 19)) * (totalScenes - 1));
              const x = sceneToX(sceneIdx);
              return (
                <g key={`tick-${i}`}>
                  <line x1={x} y1={0} x2={x} y2={SVG_H} stroke="#fff" strokeWidth={0.5} opacity={0.04} />
                  <text x={x} y={SVG_H - 2} textAnchor="middle" className="text-[8px]" fill="#555">{sceneIdx + 1}</text>
                </g>
              );
            })}

            {/* Cluster labels */}
            {clusterLabels.map(({ cluster: c, y }) => (
              <text
                key={`cl-${c.id}`}
                x={4}
                y={y - 2}
                className="text-[9px] font-semibold select-none"
                fill={CLUSTER_COLORS[c.id % CLUSTER_COLORS.length]}
                opacity={0.6}
              >
                {c.label}
              </text>
            ))}

            {/* Thread rows */}
            {rows.map((row) => {
              const y = rowYMap.get(row.threadId) ?? 0;
              const isHovered = hoveredRow === row.threadId || highlightedThreads.has(row.threadId);
              const isTerminal = TERMINAL.has(row.endStatus);
              const barH = 10;
              const barY = y + (ROW_H - barH) / 2;

              return (
                <g
                  key={row.threadId}
                  className="cursor-pointer"
                  onClick={() => { onSelectThread(row.threadId); onClose(); }}
                  onMouseEnter={() => setHoveredRow(row.threadId)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  {/* Hover background */}
                  {isHovered && (
                    <rect x={0} y={y} width={SVG_W} height={ROW_H} fill="#fff" opacity={0.03} rx={3} />
                  )}

                  {/* Thread label */}
                  <text
                    x={12}
                    y={y + ROW_H / 2 + 1}
                    dominantBaseline="middle"
                    className="text-[10px] select-none"
                    fill={isHovered ? '#ddd' : '#888'}
                    opacity={isTerminal && !isHovered ? 0.4 : 1}
                  >
                    <tspan className="font-mono" fill="#666">{row.threadId} </tspan>
                    {row.description.length > 28 ? row.description.slice(0, 26) + '…' : row.description}
                  </text>

                  {/* Status bar background */}
                  <rect
                    x={sceneToX(row.firstScene)}
                    y={barY}
                    width={Math.max(sceneToX(row.lastScene) - sceneToX(row.firstScene), 2)}
                    height={barH}
                    rx={2}
                    fill="#fff"
                    opacity={0.03}
                  />

                  {/* Status segments */}
                  {row.segments.map((seg, i) => {
                    const x1 = sceneToX(seg.start);
                    const x2 = sceneToX(Math.min(seg.end + 1, totalScenes - 1));
                    return (
                      <rect
                        key={`seg-${i}`}
                        x={x1}
                        y={barY}
                        width={Math.max(x2 - x1, 2)}
                        height={barH}
                        rx={2}
                        fill={STATUS_FILLS[seg.status] ?? '#475569'}
                        opacity={isTerminal ? 0.3 : 0.5}
                      />
                    );
                  })}

                  {/* Transition markers */}
                  {row.transitions.map((t, i) => (
                    <rect
                      key={`tr-${i}`}
                      x={sceneToX(t.sceneIdx) - 1}
                      y={barY - 1}
                      width={2}
                      height={barH + 2}
                      rx={1}
                      fill={STATUS_FILLS[t.to] ?? '#fff'}
                      opacity={0.9}
                    />
                  ))}

                  {/* Pulse ticks */}
                  {row.pulseScenes.map((s, i) => (
                    <line
                      key={`p-${i}`}
                      x1={sceneToX(s)} y1={barY + 2}
                      x2={sceneToX(s)} y2={barY + barH - 2}
                      stroke="#fff" strokeWidth={0.5} opacity={0.15}
                    />
                  ))}

                  {/* End status dot */}
                  <circle
                    cx={sceneToX(row.lastScene) + 8}
                    cy={y + ROW_H / 2}
                    r={3}
                    fill={STATUS_FILLS[row.endStatus] ?? '#475569'}
                    opacity={isTerminal ? 0.4 : 0.8}
                  />
                </g>
              );
            })}

            {/* Convergence arcs — drawn on top */}
            {arcs.map((arc, i) => {
              const y1 = rowYMap.get(arc.fromThreadId);
              const y2 = rowYMap.get(arc.toThreadId);
              if (y1 === undefined || y2 === undefined) return null;

              const cy1 = y1 + ROW_H / 2;
              const cy2 = y2 + ROW_H / 2;

              // Draw arc on the right side of the timeline
              const arcX = LABEL_W + TIMELINE_W + 18 + (i % 4) * 6;
              const isHighlighted = hoveredArc === i ||
                hoveredRow === arc.fromThreadId || hoveredRow === arc.toThreadId;

              const pathD = `M ${arcX - 4} ${cy1} C ${arcX + 8} ${cy1}, ${arcX + 8} ${cy2}, ${arcX - 4} ${cy2}`;

              return (
                <g
                  key={`arc-${i}`}
                  onMouseEnter={() => setHoveredArc(i)}
                  onMouseLeave={() => setHoveredArc(null)}
                  className="cursor-default"
                >
                  {/* Wider invisible hit area */}
                  <path d={pathD} fill="none" stroke="transparent" strokeWidth={8} />
                  <path
                    d={pathD}
                    fill="none"
                    stroke={arc.isCrossCluster ? '#f59e0b' : '#22d3ee'}
                    strokeWidth={isHighlighted ? 2 : (arc.isCrossCluster ? 1.5 : 1)}
                    opacity={isHighlighted ? 0.9 : (arc.isCrossCluster ? 0.5 : 0.25)}
                    strokeDasharray={arc.isCrossCluster ? undefined : '3,3'}
                  />
                  {/* Small dots at endpoints */}
                  <circle cx={arcX - 4} cy={cy1} r={1.5}
                    fill={arc.isCrossCluster ? '#f59e0b' : '#22d3ee'}
                    opacity={isHighlighted ? 0.9 : 0.3}
                  />
                  <circle cx={arcX - 4} cy={cy2} r={1.5}
                    fill={arc.isCrossCluster ? '#f59e0b' : '#22d3ee'}
                    opacity={isHighlighted ? 0.9 : 0.3}
                  />
                </g>
              );
            })}
          </svg>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 px-6 py-3 border-t border-white/6 flex-wrap shrink-0">
          {Object.entries(STATUS_FILLS).filter(([s]) => s !== 'abandoned').map(([status, color]) => (
            <span key={status} className="flex items-center gap-1.5 text-[10px] text-text-dim">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="capitalize">{status}</span>
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-[10px] text-text-dim ml-2">
            <span className="w-4 h-0 border-t-2 border-cyan-400" />
            Within-cluster
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-text-dim">
            <span className="w-4 h-0 border-t-2 border-amber-400" />
            Cross-cluster
          </span>
        </div>
    </Modal>
  );
}
