'use client';

import { useMemo, useState } from 'react';
import type { SlidesData } from '@/lib/slides-data';
import type { CubeCornerKey, ForceSnapshot } from '@/types/narrative';
import { NARRATIVE_CUBE } from '@/types/narrative';
import { detectCubeCorner } from '@/lib/narrative-utils';

const CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];

const CORNER_COLORS: Record<CubeCornerKey, string> = {
  HHH: '#f59e0b', HHL: '#ef4444', HLH: '#a855f7', HLL: '#6366f1',
  LHH: '#22d3ee', LHL: '#22c55e', LLH: '#3b82f6', LLL: '#6b7280',
};

type TransitionMatrix = Record<CubeCornerKey, Record<CubeCornerKey, number>>;

function buildMatrix(snapshots: ForceSnapshot[]): TransitionMatrix {
  const counts = {} as TransitionMatrix;
  for (const from of CORNERS) { counts[from] = {} as Record<CubeCornerKey, number>; for (const to of CORNERS) counts[from][to] = 0; }
  for (let i = 0; i < snapshots.length - 1; i++) {
    const f = detectCubeCorner(snapshots[i]).key;
    const t = detectCubeCorner(snapshots[i + 1]).key;
    counts[f][t]++;
  }
  return counts;
}

function normalizeRow(row: Record<CubeCornerKey, number>): Record<CubeCornerKey, number> {
  const total = Object.values(row).reduce((s, v) => s + v, 0);
  const result = {} as Record<CubeCornerKey, number>;
  for (const c of CORNERS) result[c] = total > 0 ? row[c] / total : 0;
  return result;
}

function stationaryDist(matrix: TransitionMatrix): Record<CubeCornerKey, number> {
  const uniform = 1 / CORNERS.length;
  const rows = {} as Record<CubeCornerKey, Record<CubeCornerKey, number>>;
  for (const from of CORNERS) {
    const total = Object.values(matrix[from]).reduce((s, v) => s + v, 0);
    rows[from] = total === 0 ? Object.fromEntries(CORNERS.map((c) => [c, uniform])) as Record<CubeCornerKey, number> : normalizeRow(matrix[from]);
  }
  let dist = Object.fromEntries(CORNERS.map((c) => [c, uniform])) as Record<CubeCornerKey, number>;
  for (let iter = 0; iter < 100; iter++) {
    const next = {} as Record<CubeCornerKey, number>;
    for (const to of CORNERS) { let sum = 0; for (const from of CORNERS) sum += dist[from] * rows[from][to]; next[to] = sum; }
    dist = next;
  }
  return dist;
}

export function PacingProfileSlide({ data }: { data: SlidesData }) {
  const [hovered, setHovered] = useState<CubeCornerKey | null>(null);

  const { matrix, visitCounts, stationary, metrics } = useMemo(() => {
    const snaps = data.forceSnapshots;
    const m = buildMatrix(snaps);
    const seq = snaps.map((s) => detectCubeCorner(s).key);
    const visits = {} as Record<CubeCornerKey, number>;
    for (const c of CORNERS) visits[c] = 0;
    for (const c of seq) visits[c]++;
    const stat = stationaryDist(m);

    // Metrics
    const entropy = -CORNERS.reduce((s, c) => { const p = stat[c] ?? 0; return s + (p > 0.001 ? p * Math.log2(p) : 0); }, 0);
    let selfLoops = 0;
    for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) selfLoops++;
    const selfLoopRate = selfLoops / Math.max(seq.length - 1, 1);
    const driveModes: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL'];
    const driveFrac = driveModes.reduce((s, c) => s + (stat[c] ?? 0), 0);

    const absent = CORNERS.filter((c) => (stat[c] ?? 0) < 0.02);
    const observations: string[] = [];
    if (absent.length > 0) observations.push(`Absent: ${absent.map((c) => NARRATIVE_CUBE[c].name).join(', ')}.`);

    // Oscillation
    const bigrams: Record<string, number> = {};
    for (let i = 0; i < seq.length - 1; i++) bigrams[`${seq[i]}|${seq[i + 1]}`] = (bigrams[`${seq[i]}|${seq[i + 1]}`] || 0) + 1;
    const oscPairs: { a: CubeCornerKey; b: CubeCornerKey; strength: number }[] = [];
    const seen = new Set<string>();
    for (const key of Object.keys(bigrams)) {
      const [a, b] = key.split('|') as [CubeCornerKey, CubeCornerKey];
      if (a === b) continue;
      const canon = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(canon)) continue;
      seen.add(canon);
      const fwd = bigrams[key] || 0;
      const bwd = bigrams[`${b}|${a}`] || 0;
      if (fwd > 0 && bwd > 0) oscPairs.push({ a, b, strength: fwd + bwd });
    }
    oscPairs.sort((x, y) => y.strength - x.strength);

    if (oscPairs.length > 0 && oscPairs[0].strength >= 4) {
      const p = oscPairs[0];
      observations.push(`${NARRATIVE_CUBE[p.a].name} ⇄ ${NARRATIVE_CUBE[p.b].name} oscillation (${p.strength}×).`);
    }

    return {
      matrix: m, visitCounts: visits, stationary: stat,
      metrics: { entropy, maxEntropy: Math.log2(8), selfLoopRate, driveFrac, buildupFrac: 1 - driveFrac, observations, oscillationPairs: oscPairs.slice(0, 3) },
    };
  }, [data.forceSnapshots]);

  const maxCount = useMemo(() => {
    let max = 0;
    for (const from of CORNERS) for (const to of CORNERS) if (from !== to && matrix[from][to] > max) max = matrix[from][to];
    return Math.max(max, 1);
  }, [matrix]);

  const maxVisits = Math.max(...Object.values(visitCounts), 1);

  // Graph layout
  const GW = 420;
  const GH = 380;
  const gcx = GW / 2;
  const gcy = GH / 2;
  const gr = GW * 0.34;
  const baseR = GW * 0.04;
  const maxExtraR = baseR * 0.6;

  const positions = useMemo(() => {
    const p = {} as Record<CubeCornerKey, { x: number; y: number }>;
    CORNERS.forEach((c, i) => {
      const angle = (i / CORNERS.length) * Math.PI * 2 - Math.PI / 2;
      p[c] = { x: gcx + gr * Math.cos(angle), y: gcy + gr * Math.sin(angle) };
    });
    return p;
  }, []);

  return (
    <div className="flex flex-col h-full px-10 py-6 overflow-y-auto">
      <div className="flex gap-6 items-center flex-1 min-h-0">
      {/* Graph */}
      <div className="shrink-0">
        <svg width={GW} height={GH} className="select-none">
          <defs>
            <marker id="sm-arrow" viewBox="0 0 10 6" refX="9" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 3 L 0 6 z" fill="rgba(52, 211, 153, 0.7)" />
            </marker>
          </defs>

          {/* Edges */}
          {CORNERS.map((from) =>
            CORNERS.filter((to) => to !== from && matrix[from][to] > 0).map((to) => {
              const count = matrix[from][to];
              const p1 = positions[from];
              const p2 = positions[to];
              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const len = Math.sqrt(dx * dx + dy * dy);
              const nx = -dy / len;
              const ny = dx / len;
              const toR = baseR + (visitCounts[to] / maxVisits) * maxExtraR;
              const fromR = baseR + (visitCounts[from] / maxVisits) * maxExtraR;
              const sx = p1.x + dx * Math.min(1, (fromR + 8) / len) + 5 * nx;
              const sy = p1.y + dy * Math.min(1, (fromR + 8) / len) + 5 * ny;
              const ex = p1.x + dx * Math.max(0, (len - toR - 8) / len) + 5 * nx;
              const ey = p1.y + dy * Math.max(0, (len - toR - 8) / len) + 5 * ny;
              const isRelevant = hovered === from || hovered === to;
              const baseOpacity = 0.1 + 0.8 * (count / maxCount);
              const opacity = hovered ? (isRelevant ? Math.max(baseOpacity, 0.5) : 0.03) : baseOpacity;
              return (
                <line key={`${from}-${to}`}
                  x1={sx} y1={sy} x2={ex} y2={ey}
                  stroke="rgba(52, 211, 153, 1)" strokeWidth={1.5 + 3 * (count / maxCount)}
                  opacity={opacity} markerEnd="url(#sm-arrow)"
                />
              );
            }),
          )}

          {/* Nodes */}
          {CORNERS.map((c) => {
            const pos = positions[c];
            const visits = visitCounts[c];
            const r = baseR + (visits / maxVisits) * maxExtraR;
            const isHigh = hovered === c || hovered === null;
            return (
              <g key={c} opacity={isHigh ? 1 : 0.2}
                onMouseEnter={() => setHovered(c)} onMouseLeave={() => setHovered(null)}
                className="cursor-pointer"
              >
                <circle cx={pos.x} cy={pos.y} r={r} fill={CORNER_COLORS[c]} opacity={0.9}
                  stroke={hovered === c ? '#fff' : 'transparent'} strokeWidth={2}
                />
                <text x={pos.x} y={pos.y + 1} fill="#fff" fontSize="11" fontWeight="600"
                  textAnchor="middle" dominantBaseline="middle" className="pointer-events-none select-none">
                  {NARRATIVE_CUBE[c].name}
                </text>
                <text x={pos.x} y={pos.y + r + 14} fill="#9ca3af" fontSize="10"
                  textAnchor="middle" className="pointer-events-none select-none">
                  {visits > 0 ? `${visits}×` : '—'}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Metrics panel */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div>
          <h2 className="text-xl font-bold text-text-primary mb-0.5">Pacing Profile</h2>
          <p className="text-[11px] text-text-dim">
            {data.sceneCount} scenes · {data.sceneCount - 1} transitions
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {/* Variety */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-text-dim uppercase tracking-wider">Variety</span>
              <span className="text-xs font-mono text-text-primary">{metrics.entropy.toFixed(2)} / {metrics.maxEntropy.toFixed(2)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-400" style={{ width: `${(metrics.entropy / metrics.maxEntropy) * 100}%` }} />
            </div>
            <p className="text-[9px] text-text-dim mt-1">How evenly the story uses all 8 modes. High = wide range, low = repetitive.</p>
          </div>

          {/* Self-loops */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-text-dim uppercase tracking-wider">Self-loops</span>
              <span className="text-xs font-mono text-text-primary">{(metrics.selfLoopRate * 100).toFixed(0)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full rounded-full bg-amber-400" style={{ width: `${metrics.selfLoopRate * 100}%` }} />
            </div>
            <p className="text-[9px] text-text-dim mt-1">How often consecutive scenes stay in the same mode. High = sticky, low = every scene shifts.</p>
          </div>

          {/* Drive / Buildup */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-text-dim uppercase tracking-wider">Drive / Buildup</span>
              <span className="text-xs font-mono text-text-primary">{(metrics.driveFrac * 100).toFixed(0)}% / {(metrics.buildupFrac * 100).toFixed(0)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden flex">
              <div className="h-full bg-red-400" style={{ width: `${metrics.driveFrac * 100}%` }} />
              <div className="h-full bg-sky-400" style={{ width: `${metrics.buildupFrac * 100}%` }} />
            </div>
            <p className="text-[9px] text-text-dim mt-1">
              <span className="text-red-400">Drive</span> = Epoch, Climax, Revelation, Closure.{' '}
              <span className="text-sky-400">Buildup</span> = Discovery, Growth, Lore, Rest.
            </p>
          </div>
        </div>

        {/* Observations */}
        {metrics.observations.length > 0 && (
          <div>
            <span className="text-[10px] text-text-dim uppercase tracking-wider block mb-1">Observations</span>
            {metrics.observations.map((o, i) => (
              <p key={i} className="text-[11px] text-text-secondary leading-relaxed">{o}</p>
            ))}
          </div>
        )}

        {/* Oscillation pairs */}
        {metrics.oscillationPairs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {metrics.oscillationPairs.map((p, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-[10px] text-text-secondary">
                <span style={{ color: CORNER_COLORS[p.a] }}>{NARRATIVE_CUBE[p.a].name}</span>
                <span className="text-text-dim">&#x21C4;</span>
                <span style={{ color: CORNER_COLORS[p.b] }}>{NARRATIVE_CUBE[p.b].name}</span>
                <span className="text-text-dim ml-0.5">{p.strength}&times;</span>
              </span>
            ))}
          </div>
        )}

        {/* Equilibrium */}
        <div>
          <span className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">Equilibrium</span>
          <div className="flex items-end gap-1.5" style={{ height: 70 }}>
            {CORNERS
              .slice()
              .sort((a, b) => (stationary[a] ?? 0) - (stationary[b] ?? 0))
              .map((c) => {
                const pct = (stationary[c] ?? 0) * 100;
                const barH = Math.max(pct * 2.5, 2);
                return (
                  <div key={c} className="flex flex-col items-center gap-1 flex-1">
                    <span className="text-[8px] text-text-dim font-mono">{pct > 1 ? `${pct.toFixed(0)}%` : ''}</span>
                    <div className="w-full rounded-t" style={{ height: barH, backgroundColor: CORNER_COLORS[c], opacity: pct > 1 ? 0.8 : 0.2 }} />
                    <span className="text-[7px] text-text-dim truncate w-full text-center">{NARRATIVE_CUBE[c].name}</span>
                  </div>
                );
              })}
          </div>
        </div>

      </div>
      </div>

    </div>
  );
}
