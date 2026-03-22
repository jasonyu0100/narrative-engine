'use client';

import { useState, useEffect, useRef } from 'react';
import { NARRATIVE_CUBE } from '@/types/narrative';
import type { CubeCornerKey } from '@/types/narrative';
import type { PacingSequence, ModeStep } from '@/lib/markov';

// ── Constants ────────────────────────────────────────────────────────────────

const CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];

const CORNER_COLORS: Record<CubeCornerKey, string> = {
  HHH: '#f59e0b', HHL: '#ef4444', HLH: '#a855f7', HLL: '#6366f1',
  LHH: '#22d3ee', LHL: '#22c55e', LLH: '#3b82f6', LLL: '#6b7280',
};

const CORNER_BG: Record<CubeCornerKey, string> = {
  HHH: 'rgba(245,158,11,0.12)', HHL: 'rgba(239,68,68,0.12)', HLH: 'rgba(168,85,247,0.12)', HLL: 'rgba(99,102,241,0.12)',
  LHH: 'rgba(34,211,238,0.12)', LHL: 'rgba(34,197,94,0.12)', LLH: 'rgba(59,130,246,0.12)', LLL: 'rgba(107,114,128,0.12)',
};

// ── Force Bars (mini inline visualization) ───────────────────────────────────

function ForceBars({ step }: { step: ModeStep }) {
  const maxVal = 8;
  const forces = [
    { key: 'P', color: '#EF4444', range: step.forces.payoff },
    { key: 'C', color: '#22C55E', range: step.forces.change },
    { key: 'K', color: '#3B82F6', range: step.forces.knowledge },
  ];
  return (
    <div className="flex items-center gap-1">
      {forces.map(({ key, color, range }) => (
        <div key={key} className="flex items-center gap-0.5">
          <span className="text-[7px] font-mono" style={{ color, opacity: 0.6 }}>{key}</span>
          <div className="w-8 h-1 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                marginLeft: `${(range[0] / maxVal) * 100}%`,
                width: `${((range[1] - range[0]) / maxVal) * 100}%`,
                backgroundColor: color,
                opacity: 0.7,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Slot Cell (single mode in the strip) ─────────────────────────────────────

function SlotCell({
  step,
  index,
  spinning,
  spinMode,
  settled,
}: {
  step: ModeStep;
  index: number;
  spinning: boolean;
  spinMode: CubeCornerKey;
  settled: boolean;
}) {
  const displayMode = spinning && !settled ? spinMode : step.mode;
  const corner = NARRATIVE_CUBE[displayMode];
  const isPayoff = displayMode[0] === 'H';

  return (
    <div
      className={`relative flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg border transition-all duration-300 ${
        settled
          ? isPayoff
            ? 'border-white/12 shadow-sm'
            : 'border-white/6'
          : spinning
          ? 'border-white/20'
          : 'border-white/6'
      }`}
      style={{
        backgroundColor: settled || !spinning ? CORNER_BG[displayMode] : 'rgba(255,255,255,0.03)',
        minWidth: '80px',
      }}
    >
      {/* Index */}
      <span className="absolute -top-2 left-2 text-[8px] font-mono text-text-dim bg-bg-base px-1 rounded">
        {index + 1}
      </span>

      {/* Mode dot + name */}
      <div className="flex items-center gap-1.5 mt-0.5">
        <div
          className="w-2.5 h-2.5 rounded-full transition-colors duration-150"
          style={{ backgroundColor: CORNER_COLORS[displayMode] }}
        />
        <span
          className="text-[11px] font-semibold transition-colors duration-150"
          style={{ color: CORNER_COLORS[displayMode] }}
        >
          {corner.name}
        </span>
      </div>

      {/* Force bars */}
      {settled && <ForceBars step={step} />}

      {/* H/L indicator */}
      <div className="flex items-center gap-px mt-0.5">
        {displayMode.split('').map((c, i) => (
          <span
            key={i}
            className="text-[7px] font-mono font-bold"
            style={{
              color: CORNER_COLORS[displayMode],
              opacity: c === 'H' ? 0.9 : 0.25,
            }}
          >
            {c}
          </span>
        ))}
      </div>
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
  /** When true, plays the slot-machine spin animation */
  animating: boolean;
  onAnimationDone?: () => void;
}) {
  const [spinModes, setSpinModes] = useState<CubeCornerKey[]>([]);
  const [settledCount, setSettledCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      timeoutRefs.current.forEach(clearTimeout);
    };
  }, []);

  // Spin animation
  useEffect(() => {
    if (!animating) {
      setSettledCount(sequence.steps.length);
      return;
    }

    setSettledCount(0);
    timeoutRefs.current.forEach(clearTimeout);
    timeoutRefs.current = [];

    // Rapid cycling of random modes
    intervalRef.current = setInterval(() => {
      setSpinModes(sequence.steps.map(() => CORNERS[Math.floor(Math.random() * CORNERS.length)]));
    }, 60);

    // Settle each slot sequentially with staggered delays
    const settleDelay = 200; // ms between each slot settling
    const initialDelay = 400; // ms before first slot settles

    sequence.steps.forEach((_, i) => {
      const t = setTimeout(() => {
        setSettledCount((prev) => {
          const next = prev + 1;
          // Stop spinning when all settled
          if (next >= sequence.steps.length) {
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            // Fire callback after a brief pause
            const done = setTimeout(() => onAnimationDone?.(), 200);
            timeoutRefs.current.push(done);
          }
          return next;
        });
      }, initialDelay + i * settleDelay);
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
      {/* Strip */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {sequence.steps.map((step, i) => (
          <SlotCell
            key={i}
            step={step}
            index={i}
            spinning={animating && settledCount <= i}
            spinMode={spinModes[i] ?? 'LLL'}
            settled={settledCount > i}
          />
        ))}
      </div>

      {/* Pacing summary */}
      {settledCount >= sequence.steps.length && (
        <p className="text-[10px] text-text-dim leading-snug animate-fade-in">
          {sequence.pacingDescription}
        </p>
      )}
    </div>
  );
}
