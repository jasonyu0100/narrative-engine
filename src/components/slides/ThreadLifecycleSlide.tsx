'use client';

import type { SlidesData } from '@/lib/slides-data';

const STATUS_COLORS: Record<string, string> = {
  dormant:    '#475569',
  active:     '#38BDF8',
  escalating: '#FBBF24',
  critical:   '#F87171',
  resolved:   '#34D399',
  subverted:  '#C084FC',
  abandoned:  '#64748B',
};

const ROW_H = 22;
const LABEL_W = 200;
const ARC_ZONE = 50;

export function ThreadLifecycleSlide({ data }: { data: SlidesData }) {
  const totalScenes = data.scenes.length;
  if (totalScenes === 0) return null;

  // Build rows sorted by first appearance
  const rows = data.threadLifecycles
    .map((tl) => {
      const firstScene = tl.statuses[0]?.sceneIdx ?? 0;
      const lastScene = tl.statuses[tl.statuses.length - 1]?.sceneIdx ?? totalScenes - 1;
      const endStatus = tl.statuses[tl.statuses.length - 1]?.status ?? 'dormant';

      // Build segments
      const segments: { start: number; end: number; status: string }[] = [];
      let curStatus = '';
      let segStart = 0;
      for (const s of tl.statuses) {
        if (s.status !== curStatus) {
          if (curStatus) segments.push({ start: segStart, end: s.sceneIdx, status: curStatus });
          curStatus = s.status;
          segStart = s.sceneIdx;
        }
      }
      if (curStatus) segments.push({ start: segStart, end: lastScene, status: curStatus });

      // Transitions
      const transitions: { sceneIdx: number; to: string }[] = [];
      for (let i = 1; i < tl.statuses.length; i++) {
        if (tl.statuses[i].status !== tl.statuses[i - 1].status) {
          transitions.push({ sceneIdx: tl.statuses[i].sceneIdx, to: tl.statuses[i].status });
        }
      }

      // Pulses
      const pulseScenes: number[] = [];
      for (let i = 0; i < data.scenes.length; i++) {
        for (const tm of data.scenes[i].threadMutations) {
          if (tm.threadId === tl.threadId && tm.from === tm.to) pulseScenes.push(i);
        }
      }

      return { ...tl, firstScene, lastScene, endStatus, segments, transitions, pulseScenes };
    })
    .sort((a, b) => a.firstScene - b.firstScene);

  const TIMELINE_W = 600;
  const SVG_W = LABEL_W + TIMELINE_W + ARC_ZONE;
  const SVG_H = rows.length * ROW_H + 20;

  const sceneToX = (idx: number) => LABEL_W + (idx / Math.max(totalScenes - 1, 1)) * TIMELINE_W;

  // Build convergence arcs
  const rowIndex = new Map(rows.map((r, i) => [r.threadId, i]));
  const arcs = (data.threadConvergences ?? [])
    .map((c) => ({ ...c, fromRow: rowIndex.get(c.fromId), toRow: rowIndex.get(c.toId) }))
    .filter((a): a is typeof a & { fromRow: number; toRow: number } => a.fromRow !== undefined && a.toRow !== undefined);

  return (
    <div className="flex flex-col h-full px-10 py-6 justify-center">
      <div className="flex items-center gap-3 mb-1">
        <h2 className="text-2xl font-bold text-text-primary">Thread Convergence</h2>
        <span className="text-xs text-text-dim font-mono">
          {rows.length} threads · {arcs.length} convergence links
        </span>
      </div>
      <p className="text-xs text-text-dim mb-4">
        Thread lifecycles on a shared timeline. Arcs on the right show convergence links between threads.
      </p>

      <div className="overflow-y-auto flex-1">
        <svg width={SVG_W} height={SVG_H}>
          {/* Scene gridlines */}
          {Array.from({ length: Math.min(totalScenes, 15) }, (_, i) => {
            const idx = Math.round((i / Math.min(totalScenes - 1, 14)) * (totalScenes - 1));
            const x = sceneToX(idx);
            return (
              <g key={`grid-${i}`}>
                <line x1={x} y1={0} x2={x} y2={SVG_H} stroke="#fff" strokeWidth={0.5} opacity={0.04} />
                <text x={x} y={SVG_H - 2} textAnchor="middle" className="text-[7px]" fill="#444">{idx + 1}</text>
              </g>
            );
          })}

          {/* Thread rows */}
          {rows.map((row, rowIdx) => {
            const y = rowIdx * ROW_H + 10;
            const barH = 8;
            const barY = y + (ROW_H - barH) / 2;
            const isTerminal = ['resolved', 'subverted', 'abandoned'].includes(row.endStatus);

            return (
              <g key={row.threadId}>
                {/* Label */}
                <text
                  x={8} y={y + ROW_H / 2 + 1}
                  dominantBaseline="middle"
                  className="text-[9px] select-none"
                  fill={isTerminal ? '#555' : '#888'}
                >
                  <tspan className="font-mono" fill="#555">{row.threadId} </tspan>
                  {row.description.length > 26 ? row.description.slice(0, 24) + '…' : row.description}
                </text>

                {/* Bar bg */}
                <rect
                  x={sceneToX(row.firstScene)} y={barY}
                  width={Math.max(sceneToX(row.lastScene) - sceneToX(row.firstScene), 2)}
                  height={barH} rx={2} fill="#fff" opacity={0.03}
                />

                {/* Status segments */}
                {row.segments.map((seg, i) => {
                  const x1 = sceneToX(seg.start);
                  const x2 = sceneToX(Math.min(seg.end + 1, totalScenes - 1));
                  return (
                    <rect key={`s-${i}`} x={x1} y={barY}
                      width={Math.max(x2 - x1, 2)} height={barH} rx={2}
                      fill={STATUS_COLORS[seg.status] ?? '#475569'}
                      opacity={isTerminal ? 0.3 : 0.5}
                    />
                  );
                })}

                {/* Transitions */}
                {row.transitions.map((t, i) => (
                  <rect key={`t-${i}`}
                    x={sceneToX(t.sceneIdx) - 1} y={barY - 1}
                    width={2} height={barH + 2} rx={1}
                    fill={STATUS_COLORS[t.to] ?? '#fff'} opacity={0.9}
                  />
                ))}

                {/* Pulses */}
                {row.pulseScenes.map((s, i) => (
                  <line key={`p-${i}`}
                    x1={sceneToX(s)} y1={barY + 1}
                    x2={sceneToX(s)} y2={barY + barH - 1}
                    stroke="#fff" strokeWidth={0.5} opacity={0.12}
                  />
                ))}

                {/* End dot */}
                <circle
                  cx={sceneToX(row.lastScene) + 6} cy={y + ROW_H / 2}
                  r={2.5} fill={STATUS_COLORS[row.endStatus] ?? '#475569'}
                  opacity={isTerminal ? 0.4 : 0.8}
                />
              </g>
            );
          })}

          {/* Convergence arcs on the right */}
          {arcs.map((arc, i) => {
            const y1 = arc.fromRow * ROW_H + 10 + ROW_H / 2;
            const y2 = arc.toRow * ROW_H + 10 + ROW_H / 2;
            const arcX = LABEL_W + TIMELINE_W + 14 + (i % 5) * 7;
            const d = `M ${arcX - 3} ${y1} C ${arcX + 10} ${y1}, ${arcX + 10} ${y2}, ${arcX - 3} ${y2}`;
            return (
              <path key={`arc-${i}`} d={d} fill="none"
                stroke="#22d3ee" strokeWidth={1} opacity={0.35}
              />
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/6 flex-wrap">
        {Object.entries(STATUS_COLORS).filter(([s]) => s !== 'abandoned').map(([status, color]) => (
          <span key={status} className="flex items-center gap-1.5 text-[10px] text-text-dim">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="capitalize">{status}</span>
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[10px] text-text-dim ml-2">
          <span className="w-4 h-0 border-t border-cyan-400" />
          Convergence
        </span>
      </div>
    </div>
  );
}
