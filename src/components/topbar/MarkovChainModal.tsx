'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import type { NarrativeState, CubeCornerKey, ForceSnapshot, Scene } from '@/types/narrative';
import { NARRATIVE_CUBE, resolveEntry, isScene } from '@/types/narrative';
import { computeForceSnapshots, detectCubeCorner } from '@/lib/narrative-utils';
import { Modal, ModalHeader } from '@/components/Modal';

// ── Types ────────────────────────────────────────────────────────────────────

type TransitionMatrix = Record<CubeCornerKey, Record<CubeCornerKey, number>>;
type TransitionRow = Record<CubeCornerKey, number>;

type Props = {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentSceneIndex: number;
  onClose: () => void;
};

// ── Constants ────────────────────────────────────────────────────────────────

const CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];

const CORNER_COLORS: Record<CubeCornerKey, string> = {
  HHH: '#f59e0b', HHL: '#ef4444', HLH: '#a855f7', HLL: '#6366f1',
  LHH: '#22d3ee', LHL: '#22c55e', LLH: '#3b82f6', LLL: '#6b7280',
};

function probToHeatColor(prob: number): string {
  if (prob === 0) return 'transparent';
  const intensity = Math.round(20 + prob * 80);
  return `rgba(52, 211, 153, ${intensity / 100})`;
}

function probToTextColor(prob: number): string {
  if (prob >= 0.25) return '#ffffff';
  if (prob > 0.05) return '#d1d5db';
  return '#4b5563';
}

// ── Computation ──────────────────────────────────────────────────────────────

function buildTransitionMatrix(scenes: { id: string; forces: ForceSnapshot }[]): TransitionMatrix {
  const counts = {} as TransitionMatrix;
  for (const from of CORNERS) {
    counts[from] = {} as Record<CubeCornerKey, number>;
    for (const to of CORNERS) counts[from][to] = 0;
  }
  for (let i = 0; i < scenes.length - 1; i++) {
    const fromCorner = detectCubeCorner(scenes[i].forces).key;
    const toCorner = detectCubeCorner(scenes[i + 1].forces).key;
    counts[fromCorner][toCorner]++;
  }
  return counts;
}

function normalizeRow(row: Record<CubeCornerKey, number>): TransitionRow {
  const total = Object.values(row).reduce((s, v) => s + v, 0);
  if (total === 0) {
    const result = {} as TransitionRow;
    for (const c of CORNERS) result[c] = 0;
    return result;
  }
  const result = {} as TransitionRow;
  for (const c of CORNERS) result[c] = row[c] / total;
  return result;
}

function cornerSequence(scenes: { id: string; forces: ForceSnapshot }[]): CubeCornerKey[] {
  return scenes.map((s) => detectCubeCorner(s.forces).key);
}

function stationaryDistribution(matrix: TransitionMatrix, iterations = 100): Record<CubeCornerKey, number> {
  const uniform = 1 / CORNERS.length;
  const rows = {} as Record<CubeCornerKey, Record<CubeCornerKey, number>>;
  for (const from of CORNERS) {
    const total = Object.values(matrix[from]).reduce((s, v) => s + v, 0);
    if (total === 0) {
      rows[from] = {} as Record<CubeCornerKey, number>;
      for (const to of CORNERS) rows[from][to] = uniform;
    } else {
      rows[from] = normalizeRow(matrix[from]);
    }
  }

  let dist = {} as Record<CubeCornerKey, number>;
  for (const c of CORNERS) dist[c] = uniform;
  for (let iter = 0; iter < iterations; iter++) {
    const next = {} as Record<CubeCornerKey, number>;
    for (const to of CORNERS) {
      let sum = 0;
      for (const from of CORNERS) sum += dist[from] * rows[from][to];
      next[to] = sum;
    }
    dist = next;
  }
  return dist;
}

// ── Matrix Metrics ───────────────────────────────────────────────────────────

type MatrixMetrics = {
  entropy: number;
  maxEntropy: number;
  selfLoopRate: number;
  payoffFrac: number;
  buildupFrac: number;
  observations: string[];
  oscillationPairs: { a: CubeCornerKey; b: CubeCornerKey; strength: number }[];
};

function computeMatrixMetrics(
  matrix: TransitionMatrix,
  stationary: Record<CubeCornerKey, number>,
  sequence: CubeCornerKey[],
): MatrixMetrics {
  const entropy = -CORNERS.reduce((s, c) => {
    const p = stationary[c] ?? 0;
    return s + (p > 0.001 ? p * Math.log2(p) : 0);
  }, 0);
  const maxEntropy = Math.log2(8);

  let selfLoops = 0;
  for (let i = 1; i < sequence.length; i++) {
    if (sequence[i] === sequence[i - 1]) selfLoops++;
  }
  const selfLoopRate = selfLoops / Math.max(sequence.length - 1, 1);

  const payoffModes: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL'];
  const payoffFrac = payoffModes.reduce((s, c) => s + (stationary[c] ?? 0), 0);
  const buildupFrac = 1 - payoffFrac;

  const bigrams: Record<string, number> = {};
  for (let i = 0; i < sequence.length - 1; i++) {
    const key = `${sequence[i]}|${sequence[i + 1]}`;
    bigrams[key] = (bigrams[key] || 0) + 1;
  }
  const oscillationPairs: { a: CubeCornerKey; b: CubeCornerKey; strength: number }[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(bigrams)) {
    const [a, b] = key.split('|') as [CubeCornerKey, CubeCornerKey];
    if (a === b) continue;
    const rev = `${b}|${a}`;
    const canonical = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const fwd = bigrams[key] || 0;
    const bwd = bigrams[rev] || 0;
    if (fwd > 0 && bwd > 0) oscillationPairs.push({ a, b, strength: fwd + bwd });
  }
  oscillationPairs.sort((x, y) => y.strength - x.strength);

  const observations: string[] = [];
  const sortedDist = CORNERS.slice().sort((a, b) => (stationary[b] ?? 0) - (stationary[a] ?? 0));
  const topPct = (stationary[sortedDist[0]] ?? 0) * 100;
  if (topPct > 35) observations.push(`${NARRATIVE_CUBE[sortedDist[0]].name} dominant at ${topPct.toFixed(0)}%.`);
  if (selfLoopRate > 0.25) observations.push(`${(selfLoopRate * 100).toFixed(0)}% self-loop rate — tends to stay in modes.`);
  const absent = CORNERS.filter((c) => (stationary[c] ?? 0) < 0.02);
  if (absent.length > 0) observations.push(`Absent: ${absent.map((c) => NARRATIVE_CUBE[c].name).join(', ')}.`);
  const visitCounts: Record<CubeCornerKey, number> = {} as Record<CubeCornerKey, number>;
  for (const c of CORNERS) visitCounts[c] = 0;
  for (const c of sequence) visitCounts[c]++;
  const absorbing = CORNERS.filter((c) => { const row = normalizeRow(matrix[c]); return row[c] > 0.4 && visitCounts[c] > 3; });
  if (absorbing.length > 0) observations.push(`Absorbing: ${absorbing.map((c) => NARRATIVE_CUBE[c].name).join(', ')}.`);
  if (oscillationPairs.length > 0 && oscillationPairs[0].strength >= 4) {
    const p = oscillationPairs[0];
    observations.push(`${NARRATIVE_CUBE[p.a].name} ↔ ${NARRATIVE_CUBE[p.b].name} oscillation (${p.strength}×).`);
  }

  return { entropy, maxEntropy, selfLoopRate, payoffFrac, buildupFrac, observations, oscillationPairs: oscillationPairs.slice(0, 3) };
}

// ── Graph Layout ─────────────────────────────────────────────────────────────

type NodePos = { x: number; y: number };

function circleLayout(width: number, height: number): Record<CubeCornerKey, NodePos> {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.38 - 20;
  const positions = {} as Record<CubeCornerKey, NodePos>;
  CORNERS.forEach((c, i) => {
    const angle = (i / CORNERS.length) * Math.PI * 2 - Math.PI / 2;
    positions[c] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  return positions;
}

// ── SVG Graph ────────────────────────────────────────────────────────────────

function TransitionGraph({
  matrix, sequence, width, height, focusedCorner, onFocusCorner,
}: {
  matrix: TransitionMatrix; sequence: CubeCornerKey[];
  width: number; height: number;
  focusedCorner: CubeCornerKey | null; onFocusCorner: (c: CubeCornerKey | null) => void;
}) {
  const positions = useMemo(() => circleLayout(width, height), [width, height]);
  const [hoveredCorner, setHoveredCorner] = useState<CubeCornerKey | null>(null);
  const activeCorner = focusedCorner ?? hoveredCorner;

  const maxCount = useMemo(() => {
    let max = 0;
    for (const from of CORNERS) for (const to of CORNERS) if (from !== to && matrix[from][to] > max) max = matrix[from][to];
    return Math.max(max, 1);
  }, [matrix]);

  const selfLoops = useMemo(() => {
    const loops = {} as Record<CubeCornerKey, number>;
    for (const c of CORNERS) loops[c] = matrix[c][c];
    return loops;
  }, [matrix]);

  const visitCounts = useMemo(() => {
    const counts = {} as Record<CubeCornerKey, number>;
    for (const c of CORNERS) counts[c] = 0;
    for (const c of sequence) counts[c]++;
    return counts;
  }, [sequence]);

  const maxVisits = Math.max(...Object.values(visitCounts), 1);
  const currentMode = sequence.length > 0 ? sequence[sequence.length - 1] : null;
  const baseR = Math.min(width, height) * 0.04;
  const maxExtraR = baseR * 0.6;

  return (
    <svg width={width} height={height} className="select-none">
      <defs>
        <marker id="arrow-heat" viewBox="0 0 10 6" refX="9" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 3 L 0 6 z" fill="rgba(52, 211, 153, 0.7)" />
        </marker>
      </defs>

      {CORNERS.map((from) =>
        CORNERS.filter((to) => to !== from && matrix[from][to] > 0).map((to) => {
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
          const isRelevant = activeCorner === from || activeCorner === to;
          const baseOpacity = 0.1 + 0.8 * (count / maxCount);
          const opacity = activeCorner ? (isRelevant ? Math.max(baseOpacity, 0.5) : 0.03) : baseOpacity;
          return (
            <g key={`${from}-${to}`}>
              <line x1={sx} y1={sy} x2={ex} y2={ey}
                stroke="rgba(52, 211, 153, 1)" strokeWidth={1.5 + 3 * (count / maxCount)}
                opacity={opacity} markerEnd="url(#arrow-heat)" className="transition-opacity duration-150" />
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

      {CORNERS.map((c) => {
        const pos = positions[c]; const corner = NARRATIVE_CUBE[c];
        const visits = visitCounts[c]; const r = baseR + (visits / maxVisits) * maxExtraR;
        const isHighlighted = activeCorner === c || activeCorner === null;
        const isCurrent = currentMode === c; const isFocused = focusedCorner === c;
        return (
          <g key={c} className="cursor-pointer transition-opacity duration-150" opacity={isHighlighted ? 1 : 0.2}
            onMouseEnter={() => setHoveredCorner(c)} onMouseLeave={() => setHoveredCorner(null)}
            onClick={() => onFocusCorner(isFocused ? null : c)}>
            {isCurrent && (
              <circle cx={pos.x} cy={pos.y} r={r + 8} fill="none" stroke={CORNER_COLORS[c]} strokeWidth={2} opacity={0.5}>
                <animate attributeName="r" values={`${r + 6};${r + 14};${r + 6}`} dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0.15;0.5" dur="2s" repeatCount="indefinite" />
              </circle>
            )}
            {isFocused && <circle cx={pos.x} cy={pos.y} r={r + 5} fill="none" stroke="#ffffff" strokeWidth={1.5} strokeDasharray="5 3" opacity={0.6} />}
            {selfLoops[c] > 0 && (
              <circle cx={pos.x} cy={pos.y} r={r + 4 + (selfLoops[c] / maxCount) * 6}
                fill="none" stroke={CORNER_COLORS[c]} strokeWidth={1 + (selfLoops[c] / maxCount) * 2} strokeDasharray="5 4" opacity={0.35} />
            )}
            <circle cx={pos.x} cy={pos.y} r={r} fill={CORNER_COLORS[c]} opacity={0.9}
              stroke={isFocused ? '#ffffff' : hoveredCorner === c ? '#ffffff' : 'transparent'} strokeWidth={isFocused ? 2.5 : 2} />
            <text x={pos.x} y={pos.y + 1} fill="#fff" fontSize="13" fontWeight="600"
              textAnchor="middle" dominantBaseline="middle" className="pointer-events-none">{corner.name}</text>
            <text x={pos.x} y={pos.y + r + 16} fill="#9ca3af" fontSize="11"
              textAnchor="middle" className="pointer-events-none">{visits > 0 ? `${visits}×` : '—'}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Main Modal ───────────────────────────────────────────────────────────────

export function MarkovChainModal({ narrative, resolvedKeys, currentSceneIndex, onClose }: Props) {
  const [focusedCorner, setFocusedCorner] = useState<CubeCornerKey | null>(null);
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

  const { matrix, sequence: cornerSeq, stationary, totalTransitions } = useMemo(() => {
    const scenes = resolvedKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
    if (scenes.length === 0) {
      const emptyMatrix = {} as TransitionMatrix;
      const emptyStat = {} as Record<CubeCornerKey, number>;
      for (const c of CORNERS) {
        emptyMatrix[c] = {} as Record<CubeCornerKey, number>;
        for (const to of CORNERS) emptyMatrix[c][to] = 0;
        emptyStat[c] = 0;
      }
      return { matrix: emptyMatrix, sequence: [] as CubeCornerKey[], stationary: emptyStat, totalTransitions: 0 };
    }

    const snapshots = computeForceSnapshots(scenes);
    const scenesWithForces = scenes.map((s) => ({ id: s.id, forces: snapshots[s.id] || { payoff: 0, change: 0, knowledge: 0 } }));
    const mat = buildTransitionMatrix(scenesWithForces);
    const seq = cornerSequence(scenesWithForces);
    const stat = stationaryDistribution(mat);
    const total = CORNERS.reduce((s, from) => s + CORNERS.reduce((s2, to) => s2 + mat[from][to], 0), 0);
    return { matrix: mat, sequence: seq, stationary: stat, totalTransitions: total };
  }, [narrative, resolvedKeys]);

  const currentMode = cornerSeq.length > 0 ? cornerSeq[cornerSeq.length - 1] : null;
  const metrics = useMemo(() => computeMatrixMetrics(matrix, stationary, cornerSeq), [matrix, stationary, cornerSeq]);

  // Focused node detail
  const focusDetail = useMemo(() => {
    if (!focusedCorner) return null;
    const outgoing = normalizeRow(matrix[focusedCorner]);
    const outCount = Object.values(matrix[focusedCorner]).reduce((s, v) => s + v, 0);
    const inCounts = {} as Record<CubeCornerKey, number>;
    for (const from of CORNERS) inCounts[from] = matrix[from][focusedCorner];
    const inTotal = Object.values(inCounts).reduce((s, v) => s + v, 0);
    const incoming = {} as Record<CubeCornerKey, number>;
    for (const from of CORNERS) incoming[from] = inTotal > 0 ? inCounts[from] / inTotal : 0;

    const visits = cornerSeq.filter((c) => c === focusedCorner).length;
    let runs = 0, runLen = 0;
    for (let i = 0; i < cornerSeq.length; i++) {
      if (cornerSeq[i] === focusedCorner) runLen++;
      else if (runLen > 0) { runs++; runLen = 0; }
    }
    if (runLen > 0) runs++;

    return {
      outgoing, outCount, incoming, inTotal, visits,
      avgDwell: runs > 0 ? (visits / runs).toFixed(1) : '—',
      sortedOut: CORNERS.map((c) => ({ c, prob: outgoing[c], count: matrix[focusedCorner][c] })).filter((o) => o.count > 0).sort((a, b) => b.prob - a.prob),
      sortedIn: CORNERS.map((c) => ({ c, prob: incoming[c], count: inCounts[c] })).filter((o) => o.count > 0).sort((a, b) => b.prob - a.prob),
    };
  }, [focusedCorner, matrix, cornerSeq]);

  return (
    <Modal onClose={onClose} fullScreen>
      <ModalHeader onClose={onClose}>
        <h2 className="text-[14px] font-semibold text-text-primary">Pacing Profile</h2>
        {currentMode && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 text-[11px]">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CORNER_COLORS[currentMode] }} />
            <span className="text-text-dim">Now:</span>
            <span style={{ color: CORNER_COLORS[currentMode] }} className="font-medium">{NARRATIVE_CUBE[currentMode].name}</span>
          </div>
        )}
        <span className="text-[11px] text-text-dim">{cornerSeq.length} scenes · {totalTransitions} transitions</span>
      </ModalHeader>

      <div className="flex-1 flex min-h-0">
        {/* Graph */}
        <div ref={graphRef} className="flex-1 min-w-0">
          <TransitionGraph matrix={matrix} sequence={cornerSeq}
            width={graphSize.width} height={graphSize.height}
            focusedCorner={focusedCorner} onFocusCorner={setFocusedCorner} />
        </div>

        {/* Sidebar — all analytics in one scrollable panel */}
        <div className="w-[420px] border-l border-white/5 shrink-0 overflow-y-auto">

          {/* Metrics strip */}
          <div className="px-5 py-4 space-y-2.5 border-b border-white/5">
            <MetricBar label="Variety" value={`${metrics.entropy.toFixed(2)} / ${metrics.maxEntropy.toFixed(2)}`}
              pct={(metrics.entropy / metrics.maxEntropy) * 100} color="bg-emerald-500/70" />
            <MetricBar label="Self-loops" value={`${(metrics.selfLoopRate * 100).toFixed(0)}%`}
              pct={metrics.selfLoopRate * 100} color="bg-amber-500/70" />
            <div>
              <div className="flex justify-between text-[11px] mb-0.5">
                <span className="text-text-dim">Payoff / Buildup</span>
                <span className="text-text-primary tabular-nums">{(metrics.payoffFrac * 100).toFixed(0)}% / {(metrics.buildupFrac * 100).toFixed(0)}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden flex">
                <div className="h-full bg-red-500/70" style={{ width: `${metrics.payoffFrac * 100}%` }} />
                <div className="h-full bg-blue-500/70" style={{ width: `${metrics.buildupFrac * 100}%` }} />
              </div>
            </div>

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
                        <span style={{ color: CORNER_COLORS[a] }}>{NARRATIVE_CUBE[a].name}</span>
                        <span className="text-text-dim">↔</span>
                        <span style={{ color: CORNER_COLORS[b] }}>{NARRATIVE_CUBE[b].name}</span>
                        <span className="text-text-dim">{strength}×</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Focus detail OR prediction + equilibrium */}
          {focusDetail && focusedCorner ? (
            <div className="px-5 py-4 border-b border-white/5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CORNER_COLORS[focusedCorner] }} />
                  <span className="text-[13px] font-semibold" style={{ color: CORNER_COLORS[focusedCorner] }}>{NARRATIVE_CUBE[focusedCorner].name}</span>
                </div>
                <button onClick={() => setFocusedCorner(null)} className="text-[10px] text-text-dim hover:text-text-primary px-2 py-0.5 rounded hover:bg-white/5">Clear</button>
              </div>
              <div className="flex gap-4 mb-3 text-[11px]">
                <span><span className="text-text-dim">Visits </span><span className="text-text-primary">{focusDetail.visits}</span></span>
                <span><span className="text-text-dim">Eq </span><span className="text-text-primary">{(stationary[focusedCorner] * 100).toFixed(1)}%</span></span>
                <span><span className="text-text-dim">Dwell </span><span className="text-text-primary">{focusDetail.avgDwell}</span></span>
                <span><span className="text-text-dim">Loop </span><span className="text-text-primary">{focusDetail.outCount > 0 ? `${(focusDetail.outgoing[focusedCorner] * 100).toFixed(0)}%` : '—'}</span></span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] text-text-dim uppercase tracking-wider mb-1.5">Out ({focusDetail.outCount})</div>
                  {focusDetail.sortedOut.slice(0, 5).map(({ c: to, prob, count }) => (
                    <div key={to} className="flex items-center gap-1.5 text-[11px] mb-1">
                      <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: CORNER_COLORS[to] }} />
                      <span className="w-16 truncate" style={{ color: CORNER_COLORS[to] }}>{NARRATIVE_CUBE[to].name}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${prob * 100}%`, backgroundColor: 'rgba(52, 211, 153, 0.7)' }} />
                      </div>
                      <span className="text-text-dim tabular-nums w-8 text-right text-[10px]">{(prob * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-[10px] text-text-dim uppercase tracking-wider mb-1.5">In ({focusDetail.inTotal})</div>
                  {focusDetail.sortedIn.slice(0, 5).map(({ c: from, prob, count }) => (
                    <div key={from} className="flex items-center gap-1.5 text-[11px] mb-1">
                      <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: CORNER_COLORS[from] }} />
                      <span className="w-16 truncate" style={{ color: CORNER_COLORS[from] }}>{NARRATIVE_CUBE[from].name}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${prob * 100}%`, backgroundColor: 'rgba(52, 211, 153, 0.7)' }} />
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
              {currentMode && (() => {
                const row = normalizeRow(matrix[currentMode]);
                const sorted = CORNERS.map((c) => ({ c, prob: row[c] })).filter((o) => o.prob > 0.01).sort((a, b) => b.prob - a.prob).slice(0, 4);
                if (sorted.length === 0) return null;
                return (
                  <div>
                    <div className="text-[10px] text-text-dim uppercase tracking-wider mb-1.5">Next from {NARRATIVE_CUBE[currentMode].name}</div>
                    {sorted.map(({ c, prob }) => (
                      <div key={c} className="flex items-center gap-1.5 text-[11px] mb-1">
                        <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: CORNER_COLORS[c] }} />
                        <span className="w-16 truncate" style={{ color: CORNER_COLORS[c] }}>{NARRATIVE_CUBE[c].name}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${prob * 100}%`, backgroundColor: CORNER_COLORS[c], opacity: 0.7 }} />
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
                <div className="flex items-end gap-1.5 h-16">
                  {CORNERS.map((c) => {
                    const pct = stationary[c] * 100;
                    const maxPct = Math.max(...Object.values(stationary)) * 100;
                    const h = maxPct > 0 ? (pct / maxPct) * 48 : 0;
                    return (
                      <div key={c} className="flex-1 flex flex-col items-center gap-0.5">
                        {pct > 1 && <span className="text-[8px] tabular-nums text-text-dim">{pct.toFixed(0)}%</span>}
                        <div className="w-full rounded-t" style={{ height: `${Math.max(h, pct > 0 ? 2 : 0)}px`, backgroundColor: CORNER_COLORS[c], opacity: 0.85 }} />
                        <span className="text-[7px] text-text-dim leading-tight text-center">{NARRATIVE_CUBE[c].name}</span>
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
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr>
                    <th className="p-1 text-left text-text-dim font-medium w-16"></th>
                    {CORNERS.map((c) => (
                      <th key={c} className="p-1 text-center font-medium" style={{ color: CORNER_COLORS[c] }}>
                        {NARRATIVE_CUBE[c].name.slice(0, 3)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CORNERS.map((from) => {
                    const row = normalizeRow(matrix[from]);
                    const totalCount = Object.values(matrix[from]).reduce((s, v) => s + v, 0);
                    const isFocused = focusedCorner === from;
                    return (
                      <tr key={from}
                        className={`border-t border-white/5 cursor-pointer transition-colors ${isFocused ? 'bg-white/6' : 'hover:bg-white/3'}`}
                        onClick={() => setFocusedCorner(isFocused ? null : from)}>
                        <td className="p-1 font-medium" style={{ color: CORNER_COLORS[from] }}>{NARRATIVE_CUBE[from].name.slice(0, 3)}</td>
                        {CORNERS.map((to) => {
                          const prob = row[to];
                          return (
                            <td key={to} className="p-1 text-center tabular-nums"
                              style={{ backgroundColor: probToHeatColor(prob), color: probToTextColor(prob) }}
                              title={`${NARRATIVE_CUBE[from].name} → ${NARRATIVE_CUBE[to].name}: ${(prob * 100).toFixed(1)}%`}>
                              {totalCount > 0 && prob > 0 ? `${(prob * 100).toFixed(0)}` : totalCount > 0 ? '·' : '–'}
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
