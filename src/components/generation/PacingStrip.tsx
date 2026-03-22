'use client';

import { useState, useEffect, useRef } from 'react';
import { NARRATIVE_CUBE } from '@/types/narrative';
import type { CubeCornerKey } from '@/types/narrative';
import type { PacingSequence } from '@/lib/markov';

// ── Constants ────────────────────────────────────────────────────────────────

const CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];

const CORNER_COLORS: Record<CubeCornerKey, string> = {
  HHH: '#f59e0b', HHL: '#ef4444', HLH: '#a855f7', HLL: '#6366f1',
  LHH: '#22d3ee', LHL: '#22c55e', LLH: '#3b82f6', LLL: '#6b7280',
};

// ── PCK Badge (3-column force indicator) ─────────────────────────────────────

const FORCE_LABELS = ['P', 'C', 'K'] as const;
const FORCE_BAR_COLORS = ['#EF4444', '#22C55E', '#3B82F6'];

/** PCK bar badge — matches the ForceCharts cube indicator style exactly. */
export function CubeBadge({ mode, size = 'sm' }: { mode: CubeCornerKey; size?: 'sm' | 'md' }) {
  const w = size === 'md' ? 36 : 24;
  const h = size === 'md' ? 18 : 12;
  const barW = size === 'md' ? 10 : 6;
  const gap = size === 'md' ? 13 : 8.5;
  const highH = size === 'md' ? 14 : 10;
  const lowH = size === 'md' ? 6 : 4;
  const fontSize = size === 'md' ? 4.5 : 0; // only show labels on md

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      {FORCE_LABELS.map((label, i) => {
        const isHigh = mode[i] === 'H';
        const barH = isHigh ? highH : lowH;
        const x = i * gap;
        return (
          <g key={label}>
            <rect x={x} y={h - barH} width={barW} height={barH} rx={1.5} fill={FORCE_BAR_COLORS[i]} opacity={isHigh ? 0.7 : 0.2} />
            {fontSize > 0 && (
              <text x={x + barW / 2} y={h - 1} textAnchor="middle" fontSize={fontSize} fill="rgba(255,255,255,0.45)" fontFamily="monospace">{label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Slot Cell ────────────────────────────────────────────────────────────────

function SlotCell({
  mode,
  index,
  spinning,
  spinMode,
  settled,
  total,
}: {
  mode: CubeCornerKey;
  index: number;
  spinning: boolean;
  spinMode: CubeCornerKey;
  settled: boolean;
  total: number;
}) {
  const displayMode = spinning && !settled ? spinMode : mode;
  const corner = NARRATIVE_CUBE[displayMode];
  const isPayoff = displayMode[0] === 'H';

  return (
    <div
      className={`flex flex-col items-center gap-1.5 transition-all duration-300 ${
        settled ? 'opacity-100' : spinning ? 'opacity-60' : 'opacity-100'
      }`}
      style={{ flex: `1 1 ${100 / total}%`, minWidth: 0 }}
    >
      {/* Badge */}
      <div
        className={`w-full aspect-square rounded-lg flex flex-col items-center justify-center gap-1 border transition-all duration-200 ${
          settled
            ? isPayoff
              ? 'border-white/15 bg-white/[0.06]'
              : 'border-white/6 bg-white/[0.02]'
            : 'border-white/4 bg-white/[0.01]'
        }`}
      >
        <CubeBadge mode={displayMode} size="md" />
        <span
          className="text-[9px] font-semibold leading-none transition-colors duration-150"
          style={{ color: CORNER_COLORS[displayMode] }}
        >
          {corner.name}
        </span>
      </div>
      {/* Index */}
      <span className="text-[8px] font-mono text-text-dim">{index + 1}</span>
    </div>
  );
}

// ── Main PacingStrip ─────────────────────────────────────────────────────────

export function PacingStrip({
  sequence,
  animating,
  onAnimationDone,
}: {
  sequence: PacingSequence;
  animating: boolean;
  onAnimationDone?: () => void;
}) {
  const [spinModes, setSpinModes] = useState<CubeCornerKey[]>([]);
  const [settledCount, setSettledCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      timeoutRefs.current.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (!animating) {
      setSettledCount(sequence.steps.length);
      return;
    }

    setSettledCount(0);
    timeoutRefs.current.forEach(clearTimeout);
    timeoutRefs.current = [];

    // Rapid cycling
    intervalRef.current = setInterval(() => {
      setSpinModes(sequence.steps.map(() => CORNERS[Math.floor(Math.random() * CORNERS.length)]));
    }, 50);

    // Staggered settle
    sequence.steps.forEach((_, i) => {
      const t = setTimeout(() => {
        setSettledCount((prev) => {
          const next = prev + 1;
          if (next >= sequence.steps.length) {
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            const done = setTimeout(() => onAnimationDone?.(), 150);
            timeoutRefs.current.push(done);
          }
          return next;
        });
      }, 300 + i * 150);
      timeoutRefs.current.push(t);
    });

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [animating, sequence, onAnimationDone]);

  return (
    <div className="flex flex-col gap-2">
      {/* Strip */}
      <div className="flex gap-1.5">
        {sequence.steps.map((step, i) => (
          <SlotCell
            key={i}
            mode={step.mode}
            index={i}
            spinning={animating && settledCount <= i}
            spinMode={spinModes[i] ?? 'LLL'}
            settled={settledCount > i}
            total={sequence.steps.length}
          />
        ))}
      </div>

      {/* Pacing summary */}
      {settledCount >= sequence.steps.length && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-text-dim leading-snug">
            {sequence.pacingDescription}
          </p>
          {sequence.reasoning && (
            <p className="text-[10px] text-text-secondary leading-snug italic">
              {sequence.reasoning}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
