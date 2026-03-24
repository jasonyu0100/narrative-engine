'use client';

import React from 'react';

/**
 * Unique SVG shape for each narrative archetype.
 * Maps force-dominance profiles to visually distinctive icons.
 */

type ArchetypeKey = 'masterwork' | 'epic' | 'chronicle' | 'saga' | 'classic' | 'anthology' | 'tome' | 'emerging';

interface ArchetypeIconProps {
  archetypeKey: string;
  size?: number;
  color?: string;
  className?: string;
}

/** Default violet-400 matching archetype badge color */
const DEFAULT_COLOR = '#A78BFA';

export function ArchetypeIcon({ archetypeKey, size = 20, color = DEFAULT_COLOR, className }: ArchetypeIconProps) {
  const key = archetypeKey as ArchetypeKey;
  const s = size;
  const half = s / 2;

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {SHAPES[key]?.(half, s, color) ?? SHAPES.emerging(half, s, color)}
    </svg>
  );
}

const SHAPES: Record<ArchetypeKey, (half: number, s: number, c: string) => React.ReactNode> = {
  // Masterwork: concentric rings — convergence
  masterwork: (half, s, c) => (
    <>
      <circle cx={half} cy={half} r={s * 0.38} stroke={c} strokeWidth={1} />
      <circle cx={half} cy={half} r={s * 0.22} stroke={c} strokeWidth={1} />
      <circle cx={half} cy={half} r={s * 0.07} fill={c} />
    </>
  ),

  // Epic: upward chevron — ascent
  epic: (half, s, c) => (
    <>
      <polyline points={`${s * 0.18},${s * 0.58} ${half},${s * 0.22} ${s * 0.82},${s * 0.58}`} stroke={c} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={`${s * 0.18},${s * 0.76} ${half},${s * 0.40} ${s * 0.82},${s * 0.76}`} stroke={c} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.4} />
    </>
  ),

  // Chronicle: two parallel horizontals with a bisecting vertical — layered record
  chronicle: (half, s, c) => (
    <>
      <line x1={s * 0.2} y1={s * 0.33} x2={s * 0.8} y2={s * 0.33} stroke={c} strokeWidth={1.2} strokeLinecap="round" />
      <line x1={s * 0.2} y1={s * 0.67} x2={s * 0.8} y2={s * 0.67} stroke={c} strokeWidth={1.2} strokeLinecap="round" />
      <line x1={half} y1={s * 0.18} x2={half} y2={s * 0.82} stroke={c} strokeWidth={1.2} strokeLinecap="round" strokeOpacity={0.4} />
    </>
  ),

  // Saga: expanding arc — outward sweep
  saga: (half, s, c) => (
    <>
      <path d={`M ${s * 0.22} ${s * 0.7} A ${s * 0.35} ${s * 0.35} 0 0 1 ${s * 0.78} ${s * 0.7}`} stroke={c} strokeWidth={1.2} strokeLinecap="round" fill="none" />
      <path d={`M ${s * 0.3} ${s * 0.48} A ${s * 0.24} ${s * 0.24} 0 0 1 ${s * 0.7} ${s * 0.48}`} stroke={c} strokeWidth={1.2} strokeLinecap="round" fill="none" />
      <circle cx={half} cy={s * 0.3} r={s * 0.04} fill={c} />
    </>
  ),

  // Classic: single rotated square — clean, balanced
  classic: (half, s, c) => {
    const r = s * 0.3;
    return (
      <rect
        x={half - r}
        y={half - r}
        width={r * 2}
        height={r * 2}
        transform={`rotate(45 ${half} ${half})`}
        stroke={c}
        strokeWidth={1.2}
        fill="none"
      />
    );
  },

  // Anthology: three offset dots — discrete parts
  anthology: (half, s, c) => {
    const r = s * 0.07;
    return (
      <>
        <circle cx={s * 0.28} cy={half} r={r} fill={c} />
        <circle cx={half} cy={half} r={r} fill={c} />
        <circle cx={s * 0.72} cy={half} r={r} fill={c} />
      </>
    );
  },

  // tome: single hexagon — structure
  tome: (half, s, c) => {
    const r = s * 0.36;
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      return `${half + r * Math.cos(a)},${half + r * Math.sin(a)}`;
    }).join(' ');
    return <polygon points={pts} stroke={c} strokeWidth={1.2} strokeLinejoin="round" fill="none" />;
  },

  // Emerging: broken circle — incomplete form
  emerging: (half, s, c) => {
    const r = s * 0.32;
    return (
      <path
        d={`M ${half + r} ${half} A ${r} ${r} 0 1 1 ${half} ${half - r}`}
        stroke={c}
        strokeWidth={1.2}
        strokeLinecap="round"
        fill="none"
      />
    );
  },
};
