'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import type { NarrativeState, CubeCornerKey, ForceSnapshot, Scene } from '@/types/narrative';
import { NARRATIVE_CUBE, resolveEntry, isScene } from '@/types/narrative';
import { computeForceSnapshots, detectCubeCorner } from '@/lib/narrative-utils';

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
  // Pre-compute normalized rows; unvisited states get uniform distribution
  // so they don't act as probability sinks during iteration
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
  // Entropy
  const entropy = -CORNERS.reduce((s, c) => {
    const p = stationary[c] ?? 0;
    return s + (p > 0.001 ? p * Math.log2(p) : 0);
  }, 0);
  const maxEntropy = Math.log2(8);

  // Self-loop rate
  let selfLoops = 0;
  for (let i = 1; i < sequence.length; i++) {
    if (sequence[i] === sequence[i - 1]) selfLoops++;
  }
  const selfLoopRate = selfLoops / Math.max(sequence.length - 1, 1);

  // Payoff vs buildup
  const payoffModes: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL'];
  const buildupModes: CubeCornerKey[] = ['LHH', 'LHL', 'LLH', 'LLL'];
  const payoffFrac = payoffModes.reduce((s, c) => s + (stationary[c] ?? 0), 0);
  const buildupFrac = buildupModes.reduce((s, c) => s + (stationary[c] ?? 0), 0);

  // Oscillation pairs
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
    if (fwd > 0 && bwd > 0) {
      oscillationPairs.push({ a, b, strength: fwd + bwd });
    }
  }
  oscillationPairs.sort((x, y) => y.strength - x.strength);

  // Factual observations
  const observations: string[] = [];

  const sortedDist = CORNERS.slice().sort((a, b) => (stationary[b] ?? 0) - (stationary[a] ?? 0));
  const topPct = (stationary[sortedDist[0]] ?? 0) * 100;

  if (topPct > 35) {
    observations.push(`${NARRATIVE_CUBE[sortedDist[0]].name} dominant at ${topPct.toFixed(0)}%.`);
  }

  if (selfLoopRate > 0.25) {
    observations.push(`${(selfLoopRate * 100).toFixed(0)}% self-loop rate — tends to stay in modes.`);
  }

  const absent = CORNERS.filter((c) => (stationary[c] ?? 0) < 0.02);
  if (absent.length > 0) {
    observations.push(`Absent: ${absent.map((c) => NARRATIVE_CUBE[c].name).join(', ')}.`);
  }

  // Absorbing states
  const visitCounts: Record<CubeCornerKey, number> = {} as Record<CubeCornerKey, number>;
  for (const c of CORNERS) visitCounts[c] = 0;
  for (const c of sequence) visitCounts[c]++;
  const absorbing = CORNERS.filter((c) => {
    const row = normalizeRow(matrix[c]);
    return row[c] > 0.4 && visitCounts[c] > 3;
  });
  if (absorbing.length > 0) {
    observations.push(`Absorbing: ${absorbing.map((c) => NARRATIVE_CUBE[c].name).join(', ')}.`);
  }

  if (oscillationPairs.length > 0 && oscillationPairs[0].strength >= 4) {
    const p = oscillationPairs[0];
    observations.push(`${NARRATIVE_CUBE[p.a].name} ↔ ${NARRATIVE_CUBE[p.b].name} oscillation (${p.strength}×).`);
  }

  return {
    entropy, maxEntropy, selfLoopRate, payoffFrac, buildupFrac,
    observations,
    oscillationPairs: oscillationPairs.slice(0, 3),
  };
}

// ── Graph Layout ─────────────────────────────────────────────────────────────

type NodePos = { x: number; y: number };

function circleLayout(width: number, height: number): Record<CubeCornerKey, NodePos> {
  const cx = width / 2;
  const cy = height / 2;
  // Use more of the space, leave room for labels below nodes
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
  matrix,
  sequence,
  stationary,
  width,
  height,
  focusedCorner,
  onFocusCorner,
}: {
  matrix: TransitionMatrix;
  sequence: CubeCornerKey[];
  stationary: Record<CubeCornerKey, number>;
  width: number;
  height: number;
  focusedCorner: CubeCornerKey | null;
  onFocusCorner: (c: CubeCornerKey | null) => void;
}) {
  const positions = useMemo(() => circleLayout(width, height), [width, height]);
  const [hoveredCorner, setHoveredCorner] = useState<CubeCornerKey | null>(null);

  const activeCorner = focusedCorner ?? hoveredCorner;

  const maxCount = useMemo(() => {
    let max = 0;
    for (const from of CORNERS)
      for (const to of CORNERS)
        if (from !== to && matrix[from][to] > max) max = matrix[from][to];
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

  // Scale node sizes to viewport
  const baseR = Math.min(width, height) * 0.04;
  const maxExtraR = baseR * 0.6;

  return (
    <svg width={width} height={height} className="select-none">
      <defs>
        <marker id="arrow-heat" viewBox="0 0 10 6" refX="9" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 3 L 0 6 z" fill="rgba(52, 211, 153, 0.7)" />
        </marker>
      </defs>

      {/* Edges */}
      {CORNERS.map((from) =>
        CORNERS.filter((to) => to !== from && matrix[from][to] > 0).map((to) => {
          const count = matrix[from][to];
          const prob = normalizeRow(matrix[from])[to];
          const p1 = positions[from];
          const p2 = positions[to];

          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const nx = -dy / len;
          const ny = dx / len;
          const offset = 6;

          const toR = baseR + (visitCounts[to] / maxVisits) * maxExtraR;
          const fromR = baseR + (visitCounts[from] / maxVisits) * maxExtraR;
          const startRatio = Math.min(1, (fromR + 10) / len);
          const endRatio = Math.max(0, (len - toR - 10) / len);
          const sx = p1.x + dx * startRatio + offset * nx;
          const sy = p1.y + dy * startRatio + offset * ny;
          const ex = p1.x + dx * endRatio + offset * nx;
          const ey = p1.y + dy * endRatio + offset * ny;

          const isRelevant = activeCorner === from || activeCorner === to;
          const baseOpacity = 0.1 + 0.8 * (count / maxCount);
          const opacity = activeCorner ? (isRelevant ? Math.max(baseOpacity, 0.5) : 0.03) : baseOpacity;
          const strokeWidth = 1.5 + 3 * (count / maxCount);

          return (
            <g key={`${from}-${to}`}>
              <line
                x1={sx} y1={sy} x2={ex} y2={ey}
                stroke="rgba(52, 211, 153, 1)"
                strokeWidth={strokeWidth}
                opacity={opacity}
                markerEnd="url(#arrow-heat)"
                className="transition-opacity duration-150"
              />
              {isRelevant && prob > 0.05 && (
                <text
                  x={(sx + ex) / 2 + nx * 16} y={(sy + ey) / 2 + ny * 16}
                  fill="#ffffff" fontSize="12" fontWeight="500"
                  textAnchor="middle" dominantBaseline="middle"
                  className="pointer-events-none"
                >
                  {(prob * 100).toFixed(0)}%
                </text>
              )}
            </g>
          );
        }),
      )}

      {/* Nodes */}
      {CORNERS.map((c) => {
        const pos = positions[c];
        const corner = NARRATIVE_CUBE[c];
        const visits = visitCounts[c];
        const r = baseR + (visits / maxVisits) * maxExtraR;
        const isHighlighted = activeCorner === c || activeCorner === null;
        const isCurrent = currentMode === c;
        const isFocused = focusedCorner === c;

        return (
          <g
            key={c}
            className="cursor-pointer transition-opacity duration-150"
            opacity={isHighlighted ? 1 : 0.2}
            onMouseEnter={() => setHoveredCorner(c)}
            onMouseLeave={() => setHoveredCorner(null)}
            onClick={() => onFocusCorner(isFocused ? null : c)}
          >
            {isCurrent && (
              <circle cx={pos.x} cy={pos.y} r={r + 8} fill="none" stroke={CORNER_COLORS[c]} strokeWidth={2} opacity={0.5}>
                <animate attributeName="r" values={`${r + 6};${r + 14};${r + 6}`} dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0.15;0.5" dur="2s" repeatCount="indefinite" />
              </circle>
            )}
            {isFocused && (
              <circle cx={pos.x} cy={pos.y} r={r + 5} fill="none" stroke="#ffffff" strokeWidth={1.5} strokeDasharray="5 3" opacity={0.6} />
            )}
            {selfLoops[c] > 0 && (
              <circle
                cx={pos.x} cy={pos.y}
                r={r + 4 + (selfLoops[c] / maxCount) * 6}
                fill="none" stroke={CORNER_COLORS[c]}
                strokeWidth={1 + (selfLoops[c] / maxCount) * 2}
                strokeDasharray="5 4" opacity={0.35}
              />
            )}
            <circle cx={pos.x} cy={pos.y} r={r} fill={CORNER_COLORS[c]} opacity={0.9}
              stroke={isFocused ? '#ffffff' : hoveredCorner === c ? '#ffffff' : 'transparent'}
              strokeWidth={isFocused ? 2.5 : 2}
            />
            <text x={pos.x} y={pos.y + 1} fill="#fff" fontSize="13" fontWeight="600"
              textAnchor="middle" dominantBaseline="middle" className="pointer-events-none">
              {corner.name}
            </text>
            <text x={pos.x} y={pos.y + r + 16} fill="#9ca3af" fontSize="11"
              textAnchor="middle" className="pointer-events-none">
              {visits > 0 ? `${visits}×` : '—'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Focus Panel ──────────────────────────────────────────────────────────────

function FocusPanel({
  corner,
  matrix,
  stationary,
  sequence,
  onClose,
}: {
  corner: CubeCornerKey;
  matrix: TransitionMatrix;
  stationary: Record<CubeCornerKey, number>;
  sequence: CubeCornerKey[];
  onClose: () => void;
}) {
  const cube = NARRATIVE_CUBE[corner];
  const outgoing = normalizeRow(matrix[corner]);
  const outgoingCount = Object.values(matrix[corner]).reduce((s, v) => s + v, 0);

  const incoming = {} as Record<CubeCornerKey, number>;
  const incomingCounts = {} as Record<CubeCornerKey, number>;
  for (const from of CORNERS) incomingCounts[from] = matrix[from][corner];
  const inTotal = Object.values(incomingCounts).reduce((s, v) => s + v, 0);
  for (const from of CORNERS) incoming[from] = inTotal > 0 ? incomingCounts[from] / inTotal : 0;

  const visits = sequence.filter((c) => c === corner).length;

  let runs = 0;
  let runLength = 0;
  for (let i = 0; i < sequence.length; i++) {
    if (sequence[i] === corner) { runLength++; }
    else if (runLength > 0) { runs++; runLength = 0; }
  }
  if (runLength > 0) runs++;
  const avgDwell = runs > 0 ? (visits / runs).toFixed(1) : '—';

  const sortedOutgoing = CORNERS
    .map((c) => ({ corner: c, prob: outgoing[c], count: matrix[corner][c] }))
    .filter((o) => o.count > 0)
    .sort((a, b) => b.prob - a.prob);

  const sortedIncoming = CORNERS
    .map((c) => ({ corner: c, prob: incoming[c], count: incomingCounts[c] }))
    .filter((o) => o.count > 0)
    .sort((a, b) => b.prob - a.prob);

  return (
    <div className="border-t border-white/5 px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full" style={{ backgroundColor: CORNER_COLORS[corner] }} />
          <span className="text-[14px] font-semibold" style={{ color: CORNER_COLORS[corner] }}>
            {cube.name}
          </span>
          <span className="text-[12px] text-text-dim">{cube.description}</span>
        </div>
        <button onClick={onClose} className="text-[11px] text-text-dim hover:text-text-primary px-2 py-1 rounded hover:bg-white/5">
          Clear
        </button>
      </div>

      <div className="flex items-center gap-6 mb-4 text-[12px]">
        <div><span className="text-text-dim">Visits: </span><span className="text-text-primary font-medium">{visits}</span></div>
        <div><span className="text-text-dim">Equilibrium: </span><span className="text-text-primary font-medium">{(stationary[corner] * 100).toFixed(1)}%</span></div>
        <div><span className="text-text-dim">Avg dwell: </span><span className="text-text-primary font-medium">{avgDwell} scenes</span></div>
        <div><span className="text-text-dim">Self-loop: </span><span className="text-text-primary font-medium">{outgoingCount > 0 ? `${(outgoing[corner] * 100).toFixed(0)}%` : '—'}</span></div>
      </div>

      <div className="grid grid-cols-2 gap-8">
        <div>
          <div className="text-[11px] text-text-dim uppercase tracking-wider mb-2 font-medium">Outgoing ({outgoingCount})</div>
          <div className="space-y-1.5">
            {sortedOutgoing.map(({ corner: to, prob, count }) => (
              <div key={to} className="flex items-center gap-2.5 text-[12px]">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: CORNER_COLORS[to] }} />
                <span className="w-20" style={{ color: CORNER_COLORS[to] }}>{NARRATIVE_CUBE[to].name}</span>
                <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${prob * 100}%`, backgroundColor: 'rgba(52, 211, 153, 0.7)' }} />
                </div>
                <span className="text-text-dim tabular-nums w-10 text-right">{(prob * 100).toFixed(0)}%</span>
                <span className="text-text-dim/50 tabular-nums w-6 text-right text-[11px]">{count}</span>
              </div>
            ))}
            {sortedOutgoing.length === 0 && <span className="text-[11px] text-text-dim">No outgoing transitions</span>}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-text-dim uppercase tracking-wider mb-2 font-medium">Incoming ({inTotal})</div>
          <div className="space-y-1.5">
            {sortedIncoming.map(({ corner: from, prob, count }) => (
              <div key={from} className="flex items-center gap-2.5 text-[12px]">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: CORNER_COLORS[from] }} />
                <span className="w-20" style={{ color: CORNER_COLORS[from] }}>{NARRATIVE_CUBE[from].name}</span>
                <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${prob * 100}%`, backgroundColor: 'rgba(52, 211, 153, 0.7)' }} />
                </div>
                <span className="text-text-dim tabular-nums w-10 text-right">{(prob * 100).toFixed(0)}%</span>
                <span className="text-text-dim/50 tabular-nums w-6 text-right text-[11px]">{count}</span>
              </div>
            ))}
            {sortedIncoming.length === 0 && <span className="text-[11px] text-text-dim">No incoming transitions</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Transition Table ─────────────────────────────────────────────────────────

function TransitionTable({
  matrix,
  focusedCorner,
  onFocusCorner,
}: {
  matrix: TransitionMatrix;
  focusedCorner: CubeCornerKey | null;
  onFocusCorner: (c: CubeCornerKey | null) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr>
            <th className="p-2 text-left text-text-dim font-medium w-24">From ↓ To →</th>
            {CORNERS.map((c) => (
              <th key={c} className="p-2 text-center font-medium" style={{ color: CORNER_COLORS[c] }}>
                {NARRATIVE_CUBE[c].name}
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
              <tr
                key={from}
                className={`border-t border-white/5 cursor-pointer transition-colors ${
                  isFocused ? 'bg-white/6' : 'hover:bg-white/3'
                }`}
                onClick={() => onFocusCorner(isFocused ? null : from)}
              >
                <td className="p-2 font-medium" style={{ color: CORNER_COLORS[from] }}>
                  {NARRATIVE_CUBE[from].name}
                </td>
                {CORNERS.map((to) => {
                  const prob = row[to];
                  return (
                    <td
                      key={to}
                      className="p-2 text-center tabular-nums"
                      style={{
                        backgroundColor: probToHeatColor(prob),
                        color: probToTextColor(prob),
                      }}
                      title={`${NARRATIVE_CUBE[from].name} → ${NARRATIVE_CUBE[to].name}: ${(prob * 100).toFixed(1)}%`}
                    >
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
  );
}

// ── Equilibrium Bars ─────────────────────────────────────────────────────────

function StationaryBars({ stationary }: { stationary: Record<CubeCornerKey, number> }) {
  const maxPct = Math.max(...Object.values(stationary)) * 100;
  return (
    <div className="flex items-end gap-2 h-24">
      {CORNERS.map((c) => {
        const pct = stationary[c] * 100;
        const h = maxPct > 0 ? (pct / maxPct) * 60 : 0;
        return (
          <div key={c} className="flex-1 flex flex-col items-center gap-1">
            {pct > 1 && (
              <span className="text-[10px] tabular-nums text-text-dim">{pct.toFixed(0)}%</span>
            )}
            <div
              className="w-full rounded-t"
              style={{
                height: `${Math.max(h, pct > 0 ? 2 : 0)}px`,
                backgroundColor: CORNER_COLORS[c],
                opacity: 0.85,
              }}
            />
            <span className="text-[10px] text-text-dim font-medium leading-tight text-center">
              {NARRATIVE_CUBE[c].name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Prediction Panel ─────────────────────────────────────────────────────────

function PredictionPanel({
  currentMode,
  matrix,
}: {
  currentMode: CubeCornerKey;
  matrix: TransitionMatrix;
}) {
  const row = normalizeRow(matrix[currentMode]);
  const sorted = CORNERS
    .map((c) => ({ corner: c, prob: row[c] }))
    .filter((o) => o.prob > 0.01)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 4);

  if (sorted.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-text-dim uppercase tracking-wider font-medium">
        Next from {NARRATIVE_CUBE[currentMode].name}
      </div>
      {sorted.map(({ corner, prob }) => (
        <div key={corner} className="flex items-center gap-2.5 text-[12px]">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: CORNER_COLORS[corner] }} />
          <span className="w-20" style={{ color: CORNER_COLORS[corner] }}>{NARRATIVE_CUBE[corner].name}</span>
          <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${prob * 100}%`, backgroundColor: CORNER_COLORS[corner], opacity: 0.7 }}
            />
          </div>
          <span className="text-text-dim tabular-nums text-[11px] w-10 text-right">{(prob * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
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
      return {
        matrix: emptyMatrix,
        sequence: [] as CubeCornerKey[],
        stationary: emptyStat,
        totalTransitions: 0,
      };
    }

    const snapshots = computeForceSnapshots(scenes);
    const scenesWithForces = scenes.map((s) => ({
      id: s.id,
      forces: snapshots[s.id] || { payoff: 0, change: 0, knowledge: 0 },
    }));

    const mat = buildTransitionMatrix(scenesWithForces);
    const seq = cornerSequence(scenesWithForces);
    const stat = stationaryDistribution(mat);
    const total = CORNERS.reduce(
      (s, from) => s + CORNERS.reduce((s2, to) => s2 + mat[from][to], 0), 0,
    );

    return { matrix: mat, sequence: seq, stationary: stat, totalTransitions: total };
  }, [narrative, resolvedKeys]);

  const currentMode = cornerSeq.length > 0 ? cornerSeq[cornerSeq.length - 1] : null;
  const metrics = useMemo(
    () => computeMatrixMetrics(matrix, stationary, cornerSeq),
    [matrix, stationary, cornerSeq],
  );

  return (
    <div className="fixed inset-0 bg-bg-base z-50">
      <div className="flex flex-col w-full h-full" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-3 border-b border-white/5 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-[14px] font-semibold text-text-primary">State Machine</h2>
            {currentMode && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 text-[11px]">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CORNER_COLORS[currentMode] }} />
                <span className="text-text-dim">Now:</span>
                <span style={{ color: CORNER_COLORS[currentMode] }} className="font-medium">
                  {NARRATIVE_CUBE[currentMode].name}
                </span>
              </div>
            )}
            <span className="text-[11px] text-text-dim">
              {cornerSeq.length} scenes · {totalTransitions} transitions
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="ml-2 p-1.5 rounded hover:bg-white/10 text-text-dim hover:text-text-primary transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex min-h-0">
          {/* Graph — fills all available space */}
          <div ref={graphRef} className="flex-1 min-w-0">
            <TransitionGraph
              matrix={matrix}
              sequence={cornerSeq}
              stationary={stationary}
              width={graphSize.width}
              height={graphSize.height}
              focusedCorner={focusedCorner}
              onFocusCorner={setFocusedCorner}
            />
          </div>

          {/* Sidebar */}
          <div className="w-96 border-l border-white/5 p-5 space-y-6 shrink-0 overflow-y-auto">
            {/* Metrics */}
            <div className="space-y-3">
              <div className="text-[11px] text-text-dim uppercase tracking-wider font-medium">Metrics</div>
              <div>
                <div className="flex justify-between text-[12px] mb-0.5">
                  <span className="text-text-secondary">Variety</span>
                  <span className="text-text-primary tabular-nums font-medium">{metrics.entropy.toFixed(2)} / {metrics.maxEntropy.toFixed(2)}</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${(metrics.entropy / metrics.maxEntropy) * 100}%` }} />
                </div>
                <p className="text-[10px] text-text-dim mt-1">How evenly the story uses all 8 modes. High = wide range, low = repetitive.</p>
              </div>
              <div>
                <div className="flex justify-between text-[12px] mb-0.5">
                  <span className="text-text-secondary">Self-loops</span>
                  <span className="text-text-primary tabular-nums font-medium">{(metrics.selfLoopRate * 100).toFixed(0)}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full bg-amber-500/70" style={{ width: `${metrics.selfLoopRate * 100}%` }} />
                </div>
                <p className="text-[10px] text-text-dim mt-1">How often consecutive scenes stay in the same mode. High = sticky, low = every scene shifts.</p>
              </div>
              <div>
                <div className="flex justify-between text-[12px] mb-0.5">
                  <span className="text-text-secondary">Payoff / Buildup</span>
                  <span className="text-text-primary tabular-nums font-medium">{(metrics.payoffFrac * 100).toFixed(0)}% / {(metrics.buildupFrac * 100).toFixed(0)}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden flex">
                  <div className="h-full bg-red-500/70" style={{ width: `${metrics.payoffFrac * 100}%` }} />
                  <div className="h-full bg-blue-500/70" style={{ width: `${metrics.buildupFrac * 100}%` }} />
                </div>
                <p className="text-[10px] text-text-dim mt-1">
                  <span className="text-red-400">Payoff</span> = Epoch, Climax, Revelation, Closure.{' '}
                  <span className="text-blue-400">Buildup</span> = Discovery, Growth, Lore, Rest.
                </p>
              </div>
            </div>

            {/* Observations */}
            {metrics.observations.length > 0 && (
              <div>
                <div className="text-[11px] text-text-dim uppercase tracking-wider mb-2 font-medium">Observations</div>
                <div className="space-y-1">
                  {metrics.observations.map((d: string, i: number) => (
                    <p key={i} className="text-[11px] text-text-secondary leading-snug">{d}</p>
                  ))}
                </div>
                {metrics.oscillationPairs.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {metrics.oscillationPairs.map(({ a, b, strength }: { a: CubeCornerKey; b: CubeCornerKey; strength: number }) => (
                      <div key={`${a}-${b}`} className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 text-[10px]">
                        <span style={{ color: CORNER_COLORS[a] }}>{NARRATIVE_CUBE[a].name}</span>
                        <span className="text-text-dim">↔</span>
                        <span style={{ color: CORNER_COLORS[b] }}>{NARRATIVE_CUBE[b].name}</span>
                        <span className="text-text-dim">{strength}×</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Prediction */}
            {currentMode && (
              <PredictionPanel currentMode={currentMode} matrix={matrix} />
            )}

            {/* Equilibrium */}
            <div>
              <div className="text-[11px] text-text-dim uppercase tracking-wider mb-2 font-medium">Equilibrium</div>
              <StationaryBars stationary={stationary} />
            </div>
          </div>
        </div>

        {/* Focus panel (appears when a node is clicked) */}
        {focusedCorner && (
          <div className="shrink-0">
            <FocusPanel
              corner={focusedCorner}
              matrix={matrix}
              stationary={stationary}
              sequence={cornerSeq}
              onClose={() => setFocusedCorner(null)}
            />
          </div>
        )}

        {/* Matrix */}
        <div className="shrink-0 border-t border-white/5 px-6 py-4 max-h-[40vh] overflow-auto">
          <TransitionTable
            matrix={matrix}
            focusedCorner={focusedCorner}
            onFocusCorner={setFocusedCorner}
          />
          <div className="flex items-center gap-3 mt-3 text-[10px] text-text-dim">
            <span>Probability:</span>
            <div className="flex items-center gap-1">
              <div className="w-12 h-2.5 rounded-sm" style={{ background: 'linear-gradient(to right, rgba(52,211,153,0.05), rgba(52,211,153,0.9))' }} />
              <span>0%</span>
              <span className="ml-8">100%</span>
            </div>
            <span className="ml-auto">Click a row to focus</span>
          </div>
        </div>
      </div>
    </div>
  );
}
