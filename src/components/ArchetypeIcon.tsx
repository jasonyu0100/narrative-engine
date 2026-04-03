'use client';

import React from 'react';

/**
 * Unique SVG shape for each narrative archetype.
 * Maps force-dominance profiles to visually distinctive icons.
 */

export type ArchetypeKey = 'opus' | 'tempest' | 'chronicle' | 'mosaic' | 'classic' | 'saga' | 'tome' | 'emerging';

export const ARCHETYPE_COLORS: Record<ArchetypeKey, string> = {
  opus: '#f59e0b', tempest: '#ef4444', chronicle: '#3b82f6',
  mosaic: '#8b5cf6', classic: '#10b981', saga: '#ec4899',
  tome: '#06b6d4', emerging: '#6b7280',
};

interface ArchetypeIconProps {
  archetypeKey: string;
  size?: number;
  color?: string;
  className?: string;
}

export function ArchetypeIcon({ archetypeKey, size = 20, color, className }: ArchetypeIconProps) {
  const resolvedColor = color ?? ARCHETYPE_COLORS[archetypeKey as ArchetypeKey] ?? '#6b7280';
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
      {SHAPES[key]?.(half, s, resolvedColor) ?? SHAPES.emerging(half, s, resolvedColor)}
    </svg>
  );
}

const SHAPES: Record<ArchetypeKey, (half: number, s: number, c: string) => React.ReactNode> = {
  // Opus: concentric rings — convergence
  opus: (half, s, c) => (
    <>
      <circle cx={half} cy={half} r={s * 0.38} stroke={c} strokeWidth={1} />
      <circle cx={half} cy={half} r={s * 0.22} stroke={c} strokeWidth={1} />
      <circle cx={half} cy={half} r={s * 0.07} fill={c} />
    </>
  ),

  // Tempest: upward chevron — ascent
  tempest: (half, s, c) => (
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

  // Mosaic: expanding arc — outward sweep
  mosaic: (half, s, c) => (
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

  // Saga: three offset dots — people-driven
  saga: (half, s, c) => {
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
