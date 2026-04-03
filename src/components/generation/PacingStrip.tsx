'use client';

import { useState, useEffect, useRef } from 'react';
import { NARRATIVE_CUBE } from '@/types/narrative';
import type { CubeCornerKey } from '@/types/narrative';
import type { PacingSequence } from '@/lib/pacing-profile';

// ── Constants ────────────────────────────────────────────────────────────────

const CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];

const CORNER_COLORS: Record<CubeCornerKey, string> = {
  HHH: '#f59e0b', HHL: '#ef4444', HLH: '#a855f7', HLL: '#6366f1',
  LHH: '#22d3ee', LHL: '#22c55e', LLH: '#3b82f6', LLL: '#6b7280',
};

// ── PCK Badge ────────────────────────────────────────────────────────────────

const FORCE_LABELS = ['P', 'C', 'K'] as const;
const FORCE_BAR_COLORS = ['#EF4444', '#22C55E', '#3B82F6'];

export function CubeBadge({ mode, size = 'sm' }: { mode: CubeCornerKey; size?: 'sm' | 'md' }) {
  const w = size === 'md' ? 36 : 24;
  const h = size === 'md' ? 18 : 12;
  const barW = size === 'md' ? 10 : 6;
  const gap = size === 'md' ? 13 : 8.5;
  const highH = size === 'md' ? 14 : 10;
  const lowH = size === 'md' ? 6 : 4;
  const fontSize = size === 'md' ? 4.5 : 0;

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

// ── Transition Chain (mathematical notation with arrows) ─────────────────────

function TransitionStep({
  mode,
  spinning,
  spinMode,
  settled,
  showArrow,
}: {
  mode: CubeCornerKey;
  spinning: boolean;
  spinMode: CubeCornerKey;
  settled: boolean;
  showArrow: boolean;
}) {
  const displayMode = spinning && !settled ? spinMode : mode;
  const corner = NARRATIVE_CUBE[displayMode];

  return (
    <>
      {showArrow && (
        <span className="text-text-dim/30 text-[13px] font-light select-none mx-0.5">→</span>
      )}
      <div
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-all duration-200 ${
          settled ? 'opacity-100' : spinning ? 'opacity-40' : 'opacity-100'
        }`}
        style={{
          backgroundColor: settled ? `${CORNER_COLORS[displayMode]}15` : 'transparent',
        }}
      >
        <CubeBadge mode={displayMode} size="sm" />
        <span
          className="text-[10px] font-semibold leading-none whitespace-nowrap transition-colors duration-150"
          style={{ color: CORNER_COLORS[displayMode] }}
        >
          {corner.name}
        </span>
      </div>
    </>
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

    intervalRef.current = setInterval(() => {
      setSpinModes(sequence.steps.map(() => CORNERS[Math.floor(Math.random() * CORNERS.length)]));
    }, 50);

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
    <div className="flex flex-col gap-3">
      {/* Transition chain */}
      <div className="flex items-center flex-wrap gap-y-1.5">
        {sequence.steps.map((step, i) => (
          <TransitionStep
            key={i}
            mode={step.mode}
            spinning={animating && settledCount <= i}
            spinMode={spinModes[i] ?? 'LLL'}
            settled={settledCount > i}
            showArrow={i > 0}
          />
        ))}
      </div>

      {/* Pacing summary */}
      {settledCount >= sequence.steps.length && (
        <p className="text-[10px] text-text-dim leading-snug">
          {sequence.pacingDescription}
        </p>
      )}
    </div>
  );
}
