'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { NARRATIVE_CUBE } from '@/types/narrative';
import type { CubeCornerKey } from '@/types/narrative';
import type { PacingSequence } from '@/lib/pacing-profile';

// ── Constants ────────────────────────────────────────────────────────────────

const CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];

const CORNER_COLORS: Record<CubeCornerKey, string> = {
  HHH: '#f59e0b', HHL: '#ef4444', HLH: '#a855f7', HLL: '#6366f1',
  LHH: '#22d3ee', LHL: '#22c55e', LLH: '#3b82f6', LLL: '#6b7280',
};

type Pos = { x: number; y: number };

function circlePositions(cx: number, cy: number, r: number): Record<CubeCornerKey, Pos> {
  const pos = {} as Record<CubeCornerKey, Pos>;
  CORNERS.forEach((c, i) => {
    const angle = (i / CORNERS.length) * Math.PI * 2 - Math.PI / 2;
    pos[c] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  return pos;
}

// ── Animated Markov Graph ────────────────────────────────────────────────────

export function MarkovGraph({
  sequence,
  startMode,
  animating,
  onAnimationDone,
  width = 280,
  height = 280,
}: {
  sequence: PacingSequence;
  startMode: CubeCornerKey;
  animating: boolean;
  onAnimationDone?: () => void;
  width?: number;
  height?: number;
}) {
  const positions = useMemo(() => circlePositions(width / 2, height / 2, Math.min(width, height) * 0.36), [width, height]);
  const nodeR = 20;

  // Animation state
  const [activeStep, setActiveStep] = useState(-1); // -1 = not started, 0..n = walking
  const [ballPos, setBallPos] = useState<Pos | null>(null);
  const [trail, setTrail] = useState<{ from: Pos; to: Pos; color: string }[]>([]);
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Full path including start
  const fullPath = useMemo(() => [startMode, ...sequence.steps.map((s) => s.mode)], [startMode, sequence]);

  useEffect(() => {
    return () => timeoutRefs.current.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (!animating) {
      // Show final state
      setActiveStep(fullPath.length - 1);
      setBallPos(positions[fullPath[fullPath.length - 1]]);
      // Build full trail
      const t: { from: Pos; to: Pos; color: string }[] = [];
      for (let i = 0; i < fullPath.length - 1; i++) {
        t.push({ from: positions[fullPath[i]], to: positions[fullPath[i + 1]], color: CORNER_COLORS[fullPath[i + 1]] });
      }
      setTrail(t);
      return;
    }

    // Reset
    setActiveStep(0);
    setBallPos(positions[fullPath[0]]);
    setTrail([]);
    timeoutRefs.current.forEach(clearTimeout);
    timeoutRefs.current = [];

    const stepDelay = 250;

    for (let i = 0; i < fullPath.length - 1; i++) {
      const t = setTimeout(() => {
        const fromPos = positions[fullPath[i]];
        const toPos = positions[fullPath[i + 1]];
        const toColor = CORNER_COLORS[fullPath[i + 1]];

        // Animate ball to next position
        setBallPos(toPos);
        setActiveStep(i + 1);
        setTrail((prev) => [...prev, { from: fromPos, to: toPos, color: toColor }]);

        if (i === fullPath.length - 2) {
          const done = setTimeout(() => onAnimationDone?.(), 300);
          timeoutRefs.current.push(done);
        }
      }, (i + 1) * stepDelay);
      timeoutRefs.current.push(t);
    }

    return () => timeoutRefs.current.forEach(clearTimeout);
  }, [animating, sequence, startMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentMode = activeStep >= 0 && activeStep < fullPath.length ? fullPath[activeStep] : startMode;

  return (
    <svg width={width} height={height} className="select-none">
      {/* Trail edges */}
      {trail.map((t, i) => (
        <line
          key={i}
          x1={t.from.x} y1={t.from.y} x2={t.to.x} y2={t.to.y}
          stroke={t.color}
          strokeWidth={2}
          opacity={0.4}
          strokeLinecap="round"
        />
      ))}

      {/* Trail step numbers */}
      {trail.map((t, i) => (
        <text
          key={`n${i}`}
          x={(t.from.x + t.to.x) / 2}
          y={(t.from.y + t.to.y) / 2 - 5}
          fill="rgba(255,255,255,0.3)"
          fontSize="8"
          fontFamily="monospace"
          textAnchor="middle"
        >
          {i + 1}
        </text>
      ))}

      {/* Nodes */}
      {CORNERS.map((c) => {
        const pos = positions[c];
        const isActive = c === currentMode;
        const isInPath = fullPath.includes(c) && activeStep >= fullPath.indexOf(c);

        return (
          <g key={c}>
            <circle
              cx={pos.x} cy={pos.y} r={nodeR}
              fill={CORNER_COLORS[c]}
              opacity={isInPath ? 0.9 : 0.15}
              className="transition-opacity duration-200"
            />
            {isActive && (
              <circle
                cx={pos.x} cy={pos.y} r={nodeR + 4}
                fill="none"
                stroke={CORNER_COLORS[c]}
                strokeWidth={2}
                opacity={0.6}
              >
                <animate attributeName="r" values={`${nodeR + 2};${nodeR + 7};${nodeR + 2}`} dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.6;0.2;0.6" dur="1.5s" repeatCount="indefinite" />
              </circle>
            )}
            <text
              x={pos.x} y={pos.y + 1}
              fill="#fff"
              fontSize="8"
              fontWeight="600"
              textAnchor="middle"
              dominantBaseline="middle"
              opacity={isInPath ? 1 : 0.3}
              className="pointer-events-none transition-opacity duration-200"
            >
              {NARRATIVE_CUBE[c].name}
            </text>
          </g>
        );
      })}

      {/* Animated ball */}
      {ballPos && (
        <circle
          cx={ballPos.x}
          cy={ballPos.y}
          r={6}
          fill="#ffffff"
          opacity={0.9}
          className="transition-all duration-200"
        >
          <animate attributeName="r" values="5;7;5" dur="0.8s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  );
}
