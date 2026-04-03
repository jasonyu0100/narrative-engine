'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import type { NarrativeState, BeatFn, BeatMechanism, Scene } from '@/types/narrative';
import { BEAT_FN_LIST, resolveEntry, isScene } from '@/types/narrative';
import { computeSamplerFromPlans } from '@/lib/beat-profiles';
import { flattenFnMechDist } from '@/lib/mechanism-profiles';
import { Modal, ModalHeader } from '@/components/Modal';

// ── Types ────────────────────────────────────────────────────────────────────

type BeatMatrix = Record<BeatFn, Record<BeatFn, number>>;
type BeatRow = Record<BeatFn, number>;

type Props = {
  narrative: NarrativeState;
  resolvedKeys: string[];
  onClose: () => void;
};

// ── Constants ────────────────────────────────────────────────────────────────

const FN_COLORS: Record<BeatFn, string> = {
  breathe: '#6b7280', inform: '#3b82f6', advance: '#22c55e', bond: '#ec4899',
  turn: '#f59e0b', reveal: '#a855f7', shift: '#ef4444', expand: '#06b6d4',
  foreshadow: '#84cc16', resolve: '#14b8a6',
};

const MECH_COLORS: Record<string, string> = {
  dialogue: '#3b82f6', thought: '#a855f7', action: '#22c55e', environment: '#06b6d4',
  narration: '#f59e0b', memory: '#ec4899', document: '#84cc16', comic: '#ef4444',
};

const SETUP_FNS: BeatFn[] = ['breathe', 'inform', 'expand', 'foreshadow', 'bond'];

function probToHeatColor(prob: number): string {
  if (prob === 0) return 'transparent';
  const intensity = Math.round(20 + prob * 80);
  return `rgba(167, 139, 250, ${intensity / 100})`;
}

function probToTextColor(prob: number): string {
  if (prob >= 0.25) return '#ffffff';
  if (prob > 0.05) return '#d1d5db';
  return '#4b5563';
}

// ── Computation ──────────────────────────────────────────────────────────────

function buildBeatMatrix(sequence: BeatFn[]): BeatMatrix {
  const counts = {} as BeatMatrix;
  for (const from of BEAT_FN_LIST) {
    counts[from] = {} as Record<BeatFn, number>;
    for (const to of BEAT_FN_LIST) counts[from][to] = 0;
  }
  for (let i = 0; i < sequence.length - 1; i++) {
    if (counts[sequence[i]]) counts[sequence[i]][sequence[i + 1]]++;
  }
  return counts;
}

function normalizeRow(row: Record<BeatFn, number>): BeatRow {
  const total = Object.values(row).reduce((s, v) => s + v, 0);
  if (total === 0) {
    const result = {} as BeatRow;
    for (const c of BEAT_FN_LIST) result[c] = 0;
    return result;
  }
  const result = {} as BeatRow;
  for (const c of BEAT_FN_LIST) result[c] = row[c] / total;
  return result;
}

function stationaryDistribution(matrix: BeatMatrix, iterations = 100): Record<BeatFn, number> {
  const N = BEAT_FN_LIST.length;
  const uniform = 1 / N;
  const rows = {} as Record<BeatFn, Record<BeatFn, number>>;
  for (const from of BEAT_FN_LIST) {
    const total = Object.values(matrix[from]).reduce((s, v) => s + v, 0);
    if (total === 0) {
      rows[from] = {} as Record<BeatFn, number>;
      for (const to of BEAT_FN_LIST) rows[from][to] = uniform;
    } else {
      rows[from] = normalizeRow(matrix[from]);
    }
  }
  let dist = {} as Record<BeatFn, number>;
  for (const c of BEAT_FN_LIST) dist[c] = uniform;
  for (let iter = 0; iter < iterations; iter++) {
    const next = {} as Record<BeatFn, number>;
    for (const to of BEAT_FN_LIST) {
      let sum = 0;
      for (const from of BEAT_FN_LIST) sum += dist[from] * rows[from][to];
      next[to] = sum;
    }
    dist = next;
  }
  return dist;
}

// ── Metrics ──────────────────────────────────────────────────────────────────

type BeatMetrics = {
  entropy: number;
  maxEntropy: number;
  selfLoopRate: number;
  setupFrac: number;
  payoffFrac: number;
  observations: string[];
  oscillationPairs: { a: BeatFn; b: BeatFn; strength: number }[];
};

function computeBeatMetrics(matrix: BeatMatrix, stationary: Record<BeatFn, number>, sequence: BeatFn[]): BeatMetrics {
  const entropy = -BEAT_FN_LIST.reduce((s, c) => {
    const p = stationary[c] ?? 0;
    return s + (p > 0.001 ? p * Math.log2(p) : 0);
  }, 0);
  const maxEntropy = Math.log2(10);

  let selfLoops = 0;
  for (let i = 1; i < sequence.length; i++) if (sequence[i] === sequence[i - 1]) selfLoops++;
  const selfLoopRate = selfLoops / Math.max(sequence.length - 1, 1);

  const setupFrac = SETUP_FNS.reduce((s, c) => s + (stationary[c] ?? 0), 0);
  const payoffFrac = 1 - setupFrac;

  const bigrams: Record<string, number> = {};
  for (let i = 0; i < sequence.length - 1; i++) {
    const key = `${sequence[i]}|${sequence[i + 1]}`;
    bigrams[key] = (bigrams[key] || 0) + 1;
  }
  const oscillationPairs: { a: BeatFn; b: BeatFn; strength: number }[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(bigrams)) {
    const [a, b] = key.split('|') as [BeatFn, BeatFn];
    if (a === b) continue;
    const canonical = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const fwd = bigrams[key] || 0;
    const bwd = bigrams[`${b}|${a}`] || 0;
    if (fwd > 0 && bwd > 0) oscillationPairs.push({ a, b, strength: fwd + bwd });
  }
  oscillationPairs.sort((x, y) => y.strength - x.strength);

  const observations: string[] = [];
  const sortedDist = BEAT_FN_LIST.slice().sort((a, b) => (stationary[b] ?? 0) - (stationary[a] ?? 0));
  const topPct = (stationary[sortedDist[0]] ?? 0) * 100;
  if (topPct > 25) observations.push(`${sortedDist[0]} dominant at ${topPct.toFixed(0)}%.`);
  if (selfLoopRate > 0.15) observations.push(`${(selfLoopRate * 100).toFixed(0)}% self-loop rate — tends to repeat beats.`);
  const absent = BEAT_FN_LIST.filter((c) => (stationary[c] ?? 0) < 0.02);
  if (absent.length > 0) observations.push(`Absent: ${absent.join(', ')}.`);
  const visitCounts = {} as Record<BeatFn, number>;
  for (const c of BEAT_FN_LIST) visitCounts[c] = 0;
  for (const c of sequence) visitCounts[c]++;
  const absorbing = BEAT_FN_LIST.filter((c) => { const row = normalizeRow(matrix[c]); return row[c] > 0.3 && visitCounts[c] > 3; });
  if (absorbing.length > 0) observations.push(`Absorbing: ${absorbing.join(', ')}.`);
  if (oscillationPairs.length > 0 && oscillationPairs[0].strength >= 4) {
    const p = oscillationPairs[0];
    observations.push(`${p.a} \u2194 ${p.b} oscillation (${p.strength}\u00D7).`);
  }

  return { entropy, maxEntropy, selfLoopRate, setupFrac, payoffFrac, observations, oscillationPairs: oscillationPairs.slice(0, 3) };
}

// ── Graph Layout ─────────────────────────────────────────────────────────────

type NodePos = { x: number; y: number };

function circleLayout(width: number, height: number): Record<BeatFn, NodePos> {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.38 - 20;
  const positions = {} as Record<BeatFn, NodePos>;
  BEAT_FN_LIST.forEach((c, i) => {
    const angle = (i / BEAT_FN_LIST.length) * Math.PI * 2 - Math.PI / 2;
    positions[c] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  return positions;
}

// ── SVG Graph ────────────────────────────────────────────────────────────────

function BeatTransitionGraph({
  matrix, sequence, width, height, focusedFn, onFocusFn,
}: {
  matrix: BeatMatrix; sequence: BeatFn[];
  width: number; height: number;
  focusedFn: BeatFn | null; onFocusFn: (c: BeatFn | null) => void;
}) {
  const positions = useMemo(() => circleLayout(width, height), [width, height]);
  const [hoveredFn, setHoveredFn] = useState<BeatFn | null>(null);
  const activeFn = focusedFn ?? hoveredFn;

  const maxCount = useMemo(() => {
    let max = 0;
    for (const from of BEAT_FN_LIST) for (const to of BEAT_FN_LIST) if (from !== to && matrix[from][to] > max) max = matrix[from][to];
    return Math.max(max, 1);
  }, [matrix]);

  const selfLoops = useMemo(() => {
    const loops = {} as Record<BeatFn, number>;
    for (const c of BEAT_FN_LIST) loops[c] = matrix[c][c];
    return loops;
  }, [matrix]);

  const visitCounts = useMemo(() => {
    const counts = {} as Record<BeatFn, number>;
    for (const c of BEAT_FN_LIST) counts[c] = 0;
    for (const c of sequence) counts[c]++;
    return counts;
  }, [sequence]);

  const maxVisits = Math.max(...Object.values(visitCounts), 1);
  const currentFn = sequence.length > 0 ? sequence[sequence.length - 1] : null;
  const baseR = Math.min(width, height) * 0.035;
  const maxExtraR = baseR * 0.6;

  return (
    <svg width={width} height={height} className="select-none">
      <defs>
        <marker id="bp-arrow-heat" viewBox="0 0 10 6" refX="9" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 3 L 0 6 z" fill="rgba(167, 139, 250, 0.7)" />
        </marker>
      </defs>

      {BEAT_FN_LIST.map((from) =>
        BEAT_FN_LIST.filter((to) => to !== from && matrix[from][to] > 0).map((to) => {
          const count = matrix[from][to];
          const prob = normalizeRow(matrix[from])[to];
          const p1 = positions[from]; const p2 = positions[to];
          const dx = p2.x - p1.x; const dy = p2.y - p1.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const nx = -dy / len; const ny = dx / len;
          const toR = baseR + (visitCounts[to] / maxVisits) * maxExtraR;
          const fromR = baseR + (visitCounts[from] / maxVisits) * maxExtraR;
          const sx = p1.x + dx * Math.min(1, (fromR + 10) / len) + 6 * nx;
          const sy = p1.y + dy * Math.min(1, (fromR + 10) / len) + 6 * ny;
          const ex = p1.x + dx * Math.max(0, (len - toR - 10) / len) + 6 * nx;
          const ey = p1.y + dy * Math.max(0, (len - toR - 10) / len) + 6 * ny;
          const isRelevant = activeFn === from || activeFn === to;
          const baseOpacity = 0.1 + 0.8 * (count / maxCount);
          const opacity = activeFn ? (isRelevant ? Math.max(baseOpacity, 0.5) : 0.03) : baseOpacity;
          return (
            <g key={`${from}-${to}`}>
              <line x1={sx} y1={sy} x2={ex} y2={ey}
                stroke="rgba(167, 139, 250, 1)" strokeWidth={1.5 + 3 * (count / maxCount)}
                opacity={opacity} markerEnd="url(#bp-arrow-heat)" className="transition-opacity duration-150" />
              {isRelevant && prob > 0.05 && (
                <text x={(sx + ex) / 2 + nx * 16} y={(sy + ey) / 2 + ny * 16}
                  fill="#ffffff" fontSize="12" fontWeight="500" textAnchor="middle" dominantBaseline="middle" className="pointer-events-none">
                  {(prob * 100).toFixed(0)}%
                </text>
              )}
            </g>
          );
        }),
      )}

      {BEAT_FN_LIST.map((c) => {
        const pos = positions[c];
        const visits = visitCounts[c]; const r = baseR + (visits / maxVisits) * maxExtraR;
        const isHighlighted = activeFn === c || activeFn === null;
        const isCurrent = currentFn === c; const isFocused = focusedFn === c;
        return (
          <g key={c} className="cursor-pointer transition-opacity duration-150" opacity={isHighlighted ? 1 : 0.2}
            onMouseEnter={() => setHoveredFn(c)} onMouseLeave={() => setHoveredFn(null)}
            onClick={() => onFocusFn(isFocused ? null : c)}>
            {isCurrent && (
              <circle cx={pos.x} cy={pos.y} r={r + 8} fill="none" stroke={FN_COLORS[c]} strokeWidth={2} opacity={0.5}>
                <animate attributeName="r" values={`${r + 6};${r + 14};${r + 6}`} dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0.15;0.5" dur="2s" repeatCount="indefinite" />
              </circle>
            )}
            {isFocused && <circle cx={pos.x} cy={pos.y} r={r + 5} fill="none" stroke="#ffffff" strokeWidth={1.5} strokeDasharray="5 3" opacity={0.6} />}
            {selfLoops[c] > 0 && (
              <circle cx={pos.x} cy={pos.y} r={r + 4 + (selfLoops[c] / maxCount) * 6}
                fill="none" stroke={FN_COLORS[c]} strokeWidth={1 + (selfLoops[c] / maxCount) * 2} strokeDasharray="5 4" opacity={0.35} />
            )}
            <circle cx={pos.x} cy={pos.y} r={r} fill={FN_COLORS[c]} opacity={0.9}
              stroke={isFocused ? '#ffffff' : hoveredFn === c ? '#ffffff' : 'transparent'} strokeWidth={isFocused ? 2.5 : 2} />
            <text x={pos.x} y={pos.y + 1} fill="#fff" fontSize="12" fontWeight="600"
              textAnchor="middle" dominantBaseline="middle" className="pointer-events-none">{c}</text>
            <text x={pos.x} y={pos.y + r + 16} fill="#9ca3af" fontSize="11"
              textAnchor="middle" className="pointer-events-none">{visits > 0 ? `${visits}\u00D7` : '\u2014'}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Main Modal ───────────────────────────────────────────────────────────────

export function BeatProfileModal({ narrative, resolvedKeys, onClose }: Props) {
  const [focusedFn, setFocusedFn] = useState<BeatFn | null>(null);
  const graphRef = useRef<HTMLDivElement>(null);
  const [graphSize, setGraphSize] = useState({ width: 600, height: 500 });

  useEffect(() => {
    if (!graphRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setGraphSize({ width: Math.max(width, 300), height: Math.max(height, 300) });
      }
    });
    ro.observe(graphRef.current);
    return () => ro.disconnect();
  }, []);

  const { matrix, sequence, stationary, totalTransitions, mechDist, density } = useMemo(() => {
    const scenes = resolvedKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));

    const seq: BeatFn[] = [];
    for (const s of scenes) {
      if (s.plan?.beats) {
        for (const b of s.plan.beats) seq.push(b.fn);
      }
    }

    if (seq.length === 0) {
      const emptyMatrix = {} as BeatMatrix;
      const emptyStat = {} as Record<BeatFn, number>;
      for (const c of BEAT_FN_LIST) {
        emptyMatrix[c] = {} as Record<BeatFn, number>;
        for (const to of BEAT_FN_LIST) emptyMatrix[c][to] = 0;
        emptyStat[c] = 0;
      }
      return { matrix: emptyMatrix, sequence: [] as BeatFn[], stationary: emptyStat, totalTransitions: 0, mechDist: {} as Partial<Record<BeatMechanism, number>>, density: 0 };
    }

    const mat = buildBeatMatrix(seq);
    const stat = stationaryDistribution(mat);
    const total = BEAT_FN_LIST.reduce((s, from) => s + BEAT_FN_LIST.reduce((s2, to) => s2 + mat[from][to], 0), 0);
    const sampler = computeSamplerFromPlans(scenes);

    return { matrix: mat, sequence: seq, stationary: stat, totalTransitions: total, mechDist: sampler?.fnMechanismDistribution ? flattenFnMechDist(sampler.fnMechanismDistribution) : {}, density: sampler?.beatsPerKWord ?? 0 };
  }, [narrative, resolvedKeys]);

  const currentFn = sequence.length > 0 ? sequence[sequence.length - 1] : null;
  const metrics = useMemo(() => computeBeatMetrics(matrix, stationary, sequence), [matrix, stationary, sequence]);

  // Focused node detail
  const focusDetail = useMemo(() => {
    if (!focusedFn) return null;
    const outgoing = normalizeRow(matrix[focusedFn]);
    const outCount = Object.values(matrix[focusedFn]).reduce((s, v) => s + v, 0);
    const inCounts = {} as Record<BeatFn, number>;
    for (const from of BEAT_FN_LIST) inCounts[from] = matrix[from][focusedFn];
    const inTotal = Object.values(inCounts).reduce((s, v) => s + v, 0);
    const incoming = {} as Record<BeatFn, number>;
    for (const from of BEAT_FN_LIST) incoming[from] = inTotal > 0 ? inCounts[from] / inTotal : 0;

    const visits = sequence.filter((c) => c === focusedFn).length;
    let runs = 0, runLen = 0;
    for (let i = 0; i < sequence.length; i++) {
      if (sequence[i] === focusedFn) runLen++;
      else if (runLen > 0) { runs++; runLen = 0; }
    }
    if (runLen > 0) runs++;

    return {
      outgoing, outCount, incoming, inTotal, visits,
      avgDwell: runs > 0 ? (visits / runs).toFixed(1) : '\u2014',
      sortedOut: BEAT_FN_LIST.map((c) => ({ c, prob: outgoing[c], count: matrix[focusedFn][c] })).filter((o) => o.count > 0).sort((a, b) => b.prob - a.prob),
      sortedIn: BEAT_FN_LIST.map((c) => ({ c, prob: incoming[c], count: inCounts[c] })).filter((o) => o.count > 0).sort((a, b) => b.prob - a.prob),
    };
  }, [focusedFn, matrix, sequence]);

  return (
    <Modal onClose={onClose} fullScreen>
      <ModalHeader onClose={onClose}>
        <h2 className="text-[14px] font-semibold text-text-primary">Beat Profile</h2>
        {currentFn && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 text-[11px]">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: FN_COLORS[currentFn] }} />
            <span className="text-text-dim">Last:</span>
            <span style={{ color: FN_COLORS[currentFn] }} className="font-medium">{currentFn}</span>
          </div>
        )}
        <span className="text-[11px] text-text-dim">
          {sequence.length} beats · {totalTransitions} transitions
          {density > 0 && <> · {density} beats/kword</>}
        </span>
      </ModalHeader>

      {sequence.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-text-dim text-sm">No beat plans available yet.</p>
            <p className="text-[11px] text-text-dim mt-1">Generate scene plans to see beat profile analytics.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* Graph */}
          <div ref={graphRef} className="flex-1 min-w-0">
            <BeatTransitionGraph matrix={matrix} sequence={sequence}
              width={graphSize.width} height={graphSize.height}
              focusedFn={focusedFn} onFocusFn={setFocusedFn} />
          </div>

          {/* Sidebar — all analytics in one scrollable panel */}
          <div className="w-[420px] border-l border-white/5 shrink-0 overflow-y-auto">

            {/* Metrics strip */}
            <div className="px-5 py-4 space-y-2.5 border-b border-white/5">
              <MetricBar label="Variety" value={`${metrics.entropy.toFixed(2)} / ${metrics.maxEntropy.toFixed(2)}`}
                pct={(metrics.entropy / metrics.maxEntropy) * 100} color="bg-violet-500/70" />
              <MetricBar label="Self-loops" value={`${(metrics.selfLoopRate * 100).toFixed(0)}%`}
                pct={metrics.selfLoopRate * 100} color="bg-amber-500/70" />
              <div>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-text-dim">Setup / Payoff</span>
                  <span className="text-text-primary tabular-nums">{(metrics.setupFrac * 100).toFixed(0)}% / {(metrics.payoffFrac * 100).toFixed(0)}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden flex">
                  <div className="h-full bg-sky-500/70" style={{ width: `${metrics.setupFrac * 100}%` }} />
                  <div className="h-full bg-red-500/70" style={{ width: `${metrics.payoffFrac * 100}%` }} />
                </div>
              </div>

              {/* Mechanisms inline */}
              {Object.keys(mechDist).length > 0 && (
                <div className="pt-1">
                  <div className="text-[10px] text-text-dim uppercase tracking-wider mb-1">Mechanisms</div>
                  <div className="space-y-0.5">
                    {Object.entries(mechDist)
                      .filter(([, v]) => v && v > 0)
                      .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
                      .map(([mech, pct]) => (
                        <div key={mech} className="flex items-center gap-1.5">
                          <span className="text-[9px] font-mono w-14 shrink-0" style={{ color: MECH_COLORS[mech] || '#888' }}>{mech}</span>
                          <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${(pct ?? 0) * 100}%`, backgroundColor: MECH_COLORS[mech] || '#888', opacity: 0.7 }} />
                          </div>
                          <span className="text-[9px] text-text-dim tabular-nums w-7 text-right">{Math.round((pct ?? 0) * 100)}%</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Observations inline */}
              {(metrics.observations.length > 0 || metrics.oscillationPairs.length > 0) && (
                <div className="pt-1 space-y-1">
                  {metrics.observations.map((o, i) => (
                    <p key={i} className="text-[10px] text-text-secondary leading-snug">{o}</p>
                  ))}
                  {metrics.oscillationPairs.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {metrics.oscillationPairs.map(({ a, b, strength }) => (
                        <span key={`${a}-${b}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 text-[9px]">
                          <span style={{ color: FN_COLORS[a] }}>{a}</span>
                          <span className="text-text-dim">{'\u2194'}</span>
                          <span style={{ color: FN_COLORS[b] }}>{b}</span>
                          <span className="text-text-dim">{strength}{'\u00D7'}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Focus detail OR prediction + equilibrium */}
            {focusDetail && focusedFn ? (
              <div className="px-5 py-4 border-b border-white/5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: FN_COLORS[focusedFn] }} />
                    <span className="text-[13px] font-semibold" style={{ color: FN_COLORS[focusedFn] }}>{focusedFn}</span>
                  </div>
                  <button onClick={() => setFocusedFn(null)} className="text-[10px] text-text-dim hover:text-text-primary px-2 py-0.5 rounded hover:bg-white/5">Clear</button>
                </div>
                <div className="flex gap-4 mb-3 text-[11px]">
                  <span><span className="text-text-dim">Visits </span><span className="text-text-primary">{focusDetail.visits}</span></span>
                  <span><span className="text-text-dim">Eq </span><span className="text-text-primary">{(stationary[focusedFn] * 100).toFixed(1)}%</span></span>
                  <span><span className="text-text-dim">Dwell </span><span className="text-text-primary">{focusDetail.avgDwell}</span></span>
                  <span><span className="text-text-dim">Loop </span><span className="text-text-primary">{focusDetail.outCount > 0 ? `${(focusDetail.outgoing[focusedFn] * 100).toFixed(0)}%` : '\u2014'}</span></span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] text-text-dim uppercase tracking-wider mb-1.5">Out ({focusDetail.outCount})</div>
                    {focusDetail.sortedOut.slice(0, 5).map(({ c: to, prob }) => (
                      <div key={to} className="flex items-center gap-1.5 text-[11px] mb-1">
                        <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: FN_COLORS[to] }} />
                        <span className="w-16 truncate" style={{ color: FN_COLORS[to] }}>{to}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${prob * 100}%`, backgroundColor: 'rgba(167, 139, 250, 0.7)' }} />
                        </div>
                        <span className="text-text-dim tabular-nums w-8 text-right text-[10px]">{(prob * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="text-[10px] text-text-dim uppercase tracking-wider mb-1.5">In ({focusDetail.inTotal})</div>
                    {focusDetail.sortedIn.slice(0, 5).map(({ c: from, prob }) => (
                      <div key={from} className="flex items-center gap-1.5 text-[11px] mb-1">
                        <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: FN_COLORS[from] }} />
                        <span className="w-16 truncate" style={{ color: FN_COLORS[from] }}>{from}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${prob * 100}%`, backgroundColor: 'rgba(167, 139, 250, 0.7)' }} />
                        </div>
                        <span className="text-text-dim tabular-nums w-8 text-right text-[10px]">{(prob * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="px-5 py-4 border-b border-white/5 space-y-4">
                {/* Prediction */}
                {currentFn && (() => {
                  const row = normalizeRow(matrix[currentFn]);
                  const sorted = BEAT_FN_LIST.map((c) => ({ c, prob: row[c] })).filter((o) => o.prob > 0.01).sort((a, b) => b.prob - a.prob).slice(0, 5);
                  if (sorted.length === 0) return null;
                  return (
                    <div>
                      <div className="text-[10px] text-text-dim uppercase tracking-wider mb-1.5">Next from {currentFn}</div>
                      {sorted.map(({ c, prob }) => (
                        <div key={c} className="flex items-center gap-1.5 text-[11px] mb-1">
                          <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: FN_COLORS[c] }} />
                          <span className="w-16 truncate" style={{ color: FN_COLORS[c] }}>{c}</span>
                          <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${prob * 100}%`, backgroundColor: FN_COLORS[c], opacity: 0.7 }} />
                          </div>
                          <span className="text-text-dim tabular-nums text-[10px] w-8 text-right">{(prob * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Equilibrium */}
                <div>
                  <div className="text-[10px] text-text-dim uppercase tracking-wider mb-1.5">Equilibrium</div>
                  <div className="flex items-end gap-1 h-16">
                    {BEAT_FN_LIST.map((c) => {
                      const pct = stationary[c] * 100;
                      const maxPct = Math.max(...Object.values(stationary)) * 100;
                      const h = maxPct > 0 ? (pct / maxPct) * 48 : 0;
                      return (
                        <div key={c} className="flex-1 flex flex-col items-center gap-0.5">
                          {pct > 1 && <span className="text-[7px] tabular-nums text-text-dim">{pct.toFixed(0)}%</span>}
                          <div className="w-full rounded-t" style={{ height: `${Math.max(h, pct > 0 ? 2 : 0)}px`, backgroundColor: FN_COLORS[c], opacity: 0.85 }} />
                          <span className="text-[6px] text-text-dim leading-tight text-center truncate w-full">{c}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Transition matrix */}
            <div className="px-5 py-4">
              <div className="text-[10px] text-text-dim uppercase tracking-wider mb-2">Transition Matrix</div>
              <div className="overflow-x-auto">
                <table className="w-full text-[9px] border-collapse">
                  <thead>
                    <tr>
                      <th className="p-0.5 text-left text-text-dim font-medium w-12"></th>
                      {BEAT_FN_LIST.map((c) => (
                        <th key={c} className="p-0.5 text-center font-medium" style={{ color: FN_COLORS[c] }}>
                          {c.slice(0, 3)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {BEAT_FN_LIST.map((from) => {
                      const row = normalizeRow(matrix[from]);
                      const totalCount = Object.values(matrix[from]).reduce((s, v) => s + v, 0);
                      const isFocused = focusedFn === from;
                      return (
                        <tr key={from}
                          className={`border-t border-white/5 cursor-pointer transition-colors ${isFocused ? 'bg-white/6' : 'hover:bg-white/3'}`}
                          onClick={() => setFocusedFn(isFocused ? null : from)}>
                          <td className="p-0.5 font-medium" style={{ color: FN_COLORS[from] }}>{from.slice(0, 3)}</td>
                          {BEAT_FN_LIST.map((to) => {
                            const prob = row[to];
                            return (
                              <td key={to} className="p-0.5 text-center tabular-nums"
                                style={{ backgroundColor: probToHeatColor(prob), color: probToTextColor(prob) }}
                                title={`${from} \u2192 ${to}: ${(prob * 100).toFixed(1)}%`}>
                                {totalCount > 0 && prob > 0 ? `${(prob * 100).toFixed(0)}` : totalCount > 0 ? '\u00B7' : '\u2013'}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Compact Metric Bar ───────────────────────────────────────────────────────

function MetricBar({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-0.5">
        <span className="text-text-dim">{label}</span>
        <span className="text-text-primary tabular-nums">{value}</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
