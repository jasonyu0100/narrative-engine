'use client';

import { useMemo, useState } from 'react';
import type { SlidesData } from '@/lib/slides-data';
import type { BeatFn } from '@/types/narrative';
import { BEAT_FN_LIST } from '@/types/narrative';

const FN_COLORS: Record<BeatFn, string> = {
  breathe: '#6b7280', inform: '#3b82f6', advance: '#22c55e', bond: '#ec4899',
  turn: '#f59e0b', reveal: '#a855f7', shift: '#ef4444', expand: '#06b6d4',
  foreshadow: '#84cc16', resolve: '#14b8a6',
};

type BeatMatrix = Record<BeatFn, Record<BeatFn, number>>;

function buildMatrix(sequence: string[]): BeatMatrix {
  const counts = {} as BeatMatrix;
  for (const from of BEAT_FN_LIST) { counts[from] = {} as Record<BeatFn, number>; for (const to of BEAT_FN_LIST) counts[from][to] = 0; }
  for (let i = 0; i < sequence.length - 1; i++) {
    const f = sequence[i] as BeatFn;
    const t = sequence[i + 1] as BeatFn;
    if (counts[f] && counts[f][t] !== undefined) counts[f][t]++;
  }
  return counts;
}

function normalizeRow(row: Record<BeatFn, number>): Record<BeatFn, number> {
  const total = Object.values(row).reduce((s, v) => s + v, 0);
  const result = {} as Record<BeatFn, number>;
  for (const c of BEAT_FN_LIST) result[c] = total > 0 ? row[c] / total : 0;
  return result;
}

function stationaryDist(matrix: BeatMatrix): Record<BeatFn, number> {
  const N = BEAT_FN_LIST.length;
  const uniform = 1 / N;
  const rows = {} as Record<BeatFn, Record<BeatFn, number>>;
  for (const from of BEAT_FN_LIST) {
    const total = Object.values(matrix[from]).reduce((s, v) => s + v, 0);
    rows[from] = total === 0 ? Object.fromEntries(BEAT_FN_LIST.map((c) => [c, uniform])) as Record<BeatFn, number> : normalizeRow(matrix[from]);
  }
  let dist = Object.fromEntries(BEAT_FN_LIST.map((c) => [c, uniform])) as Record<BeatFn, number>;
  for (let iter = 0; iter < 100; iter++) {
    const next = {} as Record<BeatFn, number>;
    for (const to of BEAT_FN_LIST) { let sum = 0; for (const from of BEAT_FN_LIST) sum += dist[from] * rows[from][to]; next[to] = sum; }
    dist = next;
  }
  return dist;
}

/** Categorise beat functions into structural roles */
const SETUP_FNS: BeatFn[] = ['breathe', 'inform', 'expand', 'foreshadow', 'bond'];

export function BeatProfileSlide({ data }: { data: SlidesData }) {
  const [hovered, setHovered] = useState<BeatFn | null>(null);

  const { matrix, sequence, visitCounts, stationary, metrics } = useMemo(() => {
    const seq = data.beatSequence;
    const m = buildMatrix(seq);
    const visits = {} as Record<BeatFn, number>;
    for (const c of BEAT_FN_LIST) visits[c] = 0;
    for (const c of seq) if (visits[c as BeatFn] !== undefined) visits[c as BeatFn]++;
    const stat = stationaryDist(m);

    // Metrics
    const entropy = -BEAT_FN_LIST.reduce((s, c) => { const p = stat[c] ?? 0; return s + (p > 0.001 ? p * Math.log2(p) : 0); }, 0);
    let selfLoops = 0;
    for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) selfLoops++;
    const selfLoopRate = selfLoops / Math.max(seq.length - 1, 1);
    const setupFrac = SETUP_FNS.reduce((s, c) => s + (stat[c] ?? 0), 0);

    const absent = BEAT_FN_LIST.filter((c) => (stat[c] ?? 0) < 0.02);
    const observations: string[] = [];
    if (absent.length > 0) observations.push(`Absent: ${absent.join(', ')}.`);

    // Oscillation detection
    const bigrams: Record<string, number> = {};
    for (let i = 0; i < seq.length - 1; i++) bigrams[`${seq[i]}|${seq[i + 1]}`] = (bigrams[`${seq[i]}|${seq[i + 1]}`] || 0) + 1;
    const oscPairs: { a: BeatFn; b: BeatFn; strength: number }[] = [];
    const seen = new Set<string>();
    for (const key of Object.keys(bigrams)) {
      const [a, b] = key.split('|') as [BeatFn, BeatFn];
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
      observations.push(`${p.a} \u21C4 ${p.b} oscillation (${p.strength}\u00D7).`);
    }

    return {
      matrix: m, sequence: seq, visitCounts: visits, stationary: stat,
      metrics: {
        entropy, maxEntropy: Math.log2(10), selfLoopRate,
        setupFrac, driveFrac: 1 - setupFrac,
        observations, oscillationPairs: oscPairs.slice(0, 3),
        density: data.beatSampler?.beatsPerKWord ?? 0,
      },
    };
  }, [data.beatSequence, data.beatSampler]);

  const maxCount = useMemo(() => {
    let max = 0;
    for (const from of BEAT_FN_LIST) for (const to of BEAT_FN_LIST) if (from !== to && matrix[from][to] > max) max = matrix[from][to];
    return Math.max(max, 1);
  }, [matrix]);

  const maxVisits = Math.max(...Object.values(visitCounts), 1);

  // Graph layout — circular for 10 nodes
  const GW = 420;
  const GH = 380;
  const gcx = GW / 2;
  const gcy = GH / 2;
  const gr = GW * 0.34;
  const baseR = GW * 0.035;
  const maxExtraR = baseR * 0.6;

  const positions = useMemo(() => {
    const p = {} as Record<BeatFn, { x: number; y: number }>;
    BEAT_FN_LIST.forEach((c, i) => {
      const angle = (i / BEAT_FN_LIST.length) * Math.PI * 2 - Math.PI / 2;
      p[c] = { x: gcx + gr * Math.cos(angle), y: gcy + gr * Math.sin(angle) };
    });
    return p;
  }, []);

  if (sequence.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center px-10 py-6">
        <p className="text-text-dim text-sm">No beat plans available yet.</p>
        <p className="text-[11px] text-text-dim mt-1">Generate scene plans to see beat profile analytics.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full px-10 py-6 overflow-y-auto">
      <div className="flex gap-6 items-center flex-1 min-h-0">
      {/* Graph */}
      <div className="shrink-0">
        <svg width={GW} height={GH} className="select-none">
          <defs>
            <marker id="bp-arrow" viewBox="0 0 10 6" refX="9" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 3 L 0 6 z" fill="rgba(167, 139, 250, 0.7)" />
            </marker>
          </defs>

          {/* Edges */}
          {BEAT_FN_LIST.map((from) =>
            BEAT_FN_LIST.filter((to) => to !== from && matrix[from][to] > 0).map((to) => {
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
                  stroke="rgba(167, 139, 250, 1)" strokeWidth={1.5 + 3 * (count / maxCount)}
                  opacity={opacity} markerEnd="url(#bp-arrow)"
                />
              );
            }),
          )}

          {/* Nodes */}
          {BEAT_FN_LIST.map((c) => {
            const pos = positions[c];
            const visits = visitCounts[c];
            const r = baseR + (visits / maxVisits) * maxExtraR;
            const isHigh = hovered === c || hovered === null;
            return (
              <g key={c} opacity={isHigh ? 1 : 0.2}
                onMouseEnter={() => setHovered(c)} onMouseLeave={() => setHovered(null)}
                className="cursor-pointer"
              >
                <circle cx={pos.x} cy={pos.y} r={r} fill={FN_COLORS[c]} opacity={0.9}
                  stroke={hovered === c ? '#fff' : 'transparent'} strokeWidth={2}
                />
                <text x={pos.x} y={pos.y + 1} fill="#fff" fontSize="10" fontWeight="600"
                  textAnchor="middle" dominantBaseline="middle" className="pointer-events-none select-none">
                  {c}
                </text>
                <text x={pos.x} y={pos.y + r + 14} fill="#9ca3af" fontSize="10"
                  textAnchor="middle" className="pointer-events-none select-none">
                  {visits > 0 ? `${visits}\u00D7` : '\u2014'}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Metrics panel */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div>
          <h2 className="text-xl font-bold text-text-primary mb-0.5">Beat Profile</h2>
          <p className="text-[11px] text-text-dim">
            {sequence.length} beats · {sequence.length - 1} transitions
            {metrics.density > 0 && <> · {metrics.density} beats/kword</>}
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
              <div className="h-full rounded-full bg-violet-400" style={{ width: `${(metrics.entropy / metrics.maxEntropy) * 100}%` }} />
            </div>
            <p className="text-[9px] text-text-dim mt-1">How evenly the story uses all 10 beat functions. High = wide range, low = repetitive.</p>
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
            <p className="text-[9px] text-text-dim mt-1">How often consecutive beats repeat the same function. High = monotonous, low = every beat shifts.</p>
          </div>

          {/* Setup / Drive */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-text-dim uppercase tracking-wider">Setup / Drive</span>
              <span className="text-xs font-mono text-text-primary">{(metrics.setupFrac * 100).toFixed(0)}% / {(metrics.driveFrac * 100).toFixed(0)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden flex">
              <div className="h-full bg-sky-400" style={{ width: `${metrics.setupFrac * 100}%` }} />
              <div className="h-full bg-red-400" style={{ width: `${metrics.driveFrac * 100}%` }} />
            </div>
            <p className="text-[9px] text-text-dim mt-1">
              <span className="text-sky-400">Setup</span> = breathe, inform, expand, foreshadow, bond.{' '}
              <span className="text-red-400">Drive</span> = advance, turn, reveal, shift, resolve.
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
                <span style={{ color: FN_COLORS[p.a] }}>{p.a}</span>
                <span className="text-text-dim">&#x21C4;</span>
                <span style={{ color: FN_COLORS[p.b] }}>{p.b}</span>
                <span className="text-text-dim ml-0.5">{p.strength}&times;</span>
              </span>
            ))}
          </div>
        )}

        {/* Equilibrium */}
        <div>
          <span className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">Equilibrium</span>
          <div className="flex items-end gap-1" style={{ height: 70 }}>
            {BEAT_FN_LIST
              .slice()
              .sort((a, b) => (stationary[a] ?? 0) - (stationary[b] ?? 0))
              .map((c) => {
                const pct = (stationary[c] ?? 0) * 100;
                const barH = Math.max(pct * 2.5, 2);
                return (
                  <div key={c} className="flex flex-col items-center gap-1 flex-1">
                    <span className="text-[8px] text-text-dim font-mono">{pct > 1 ? `${pct.toFixed(0)}%` : ''}</span>
                    <div className="w-full rounded-t" style={{ height: barH, backgroundColor: FN_COLORS[c], opacity: pct > 1 ? 0.8 : 0.2 }} />
                    <span className="text-[7px] text-text-dim truncate w-full text-center">{c}</span>
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
