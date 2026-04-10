'use client';

import Link from 'next/link';
import type { SlidesData } from '@/lib/slides-data';

const gradeColor = (v: number) => {
  if (v >= 90) return '#22C55E';
  if (v >= 80) return '#A3E635';
  if (v >= 70) return '#FACC15';
  if (v >= 60) return '#F97316';
  return '#EF4444';
};

export function ClosingSlide({ data, onClose }: { data: SlidesData; onClose: () => void }) {
  const dominant = (['drive', 'world', 'system'] as const)
    .reduce((a, b) => data.overallGrades[a] > data.overallGrades[b] ? a : b);
  const dominantColors: Record<string, string> = { drive: '#EF4444', world: '#22C55E', system: '#3B82F6' };

  return (
    <div className="flex items-center justify-center h-full px-12 relative overflow-hidden">
      {/* Subtle radial glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 60% 40% at 50% 45%, ${dominantColors[dominant]}08 0%, transparent 70%)`,
        }}
      />

      <div className="flex flex-col items-center text-center relative">
        <h1 className="text-4xl font-bold text-text-primary leading-tight max-w-2xl mb-3">
          {data.title}
        </h1>

        <div className="flex items-center gap-1 mb-8">
          <span className="text-3xl font-bold font-mono" style={{ color: gradeColor(data.overallGrades.overall) }}>
            {data.overallGrades.overall}
          </span>
          <span className="text-sm text-text-dim">/100</span>
        </div>

        <p className="text-[13px] text-white/35 max-w-md leading-relaxed mb-8">
          This concludes the force analysis. Explore the knowledge graph to see how characters, threads, and world-building connect across scenes.
        </p>

        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-[12px] font-medium text-text-primary border border-white/10 hover:border-white/20 transition-all"
          >
            Explore the Graph
          </button>
          <Link
            href="/"
            className="px-5 py-2.5 rounded-lg text-[12px] font-medium text-text-dim hover:text-text-secondary border border-white/8 hover:border-white/15 transition-all"
          >
            Return Home
          </Link>
        </div>
      </div>
    </div>
  );
}
