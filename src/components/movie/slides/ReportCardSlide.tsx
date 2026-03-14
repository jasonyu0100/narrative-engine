'use client';

import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import type { MovieData } from '@/lib/movie-data';

const gradeColor = (v: number, max: number) => {
  const pct = v / max;
  if (pct >= 0.9) return '#22C55E';
  if (pct >= 0.8) return '#A3E635';
  if (pct >= 0.7) return '#FACC15';
  if (pct >= 0.6) return '#F97316';
  return '#EF4444';
};

const FORCES = [
  { key: 'payoff' as const, label: 'Payoff', color: '#EF4444' },
  { key: 'change' as const, label: 'Change', color: '#22C55E' },
  { key: 'variety' as const, label: 'Variety', color: '#3B82F6' },
  { key: 'swing' as const, label: 'Swing', color: '#FACC15' },
  { key: 'streak' as const, label: 'Streak', color: '#A78BFA' },
];

export function ReportCardSlide({ data }: { data: MovieData }) {
  const svgRef = useRef<SVGSVGElement>(null);

  const raw = data.rawForces;
  const n = data.sceneCount;
  const stdDev = (arr: number[]) => {
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
  };
  const stats = {
    payoff: { avg: raw.payoff.reduce((s, v) => s + v, 0) / n, peak: Math.max(...raw.payoff), total: raw.payoff.reduce((s, v) => s + v, 0), sd: stdDev(raw.payoff) },
    change: { avg: raw.change.reduce((s, v) => s + v, 0) / n, peak: Math.max(...raw.change), total: raw.change.reduce((s, v) => s + v, 0), sd: stdDev(raw.change) },
    variety: { avg: raw.variety.reduce((s, v) => s + v, 0) / n, peak: Math.max(...raw.variety), total: raw.variety.reduce((s, v) => s + v, 0), sd: stdDev(raw.variety) },
    swing: { avg: data.swings.reduce((s, v) => s + v, 0) / data.swings.length, peak: Math.max(...data.swings), total: data.swings.reduce((s, v) => s + v, 0), sd: stdDev(data.swings) },
  };

  // Arc score chart
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current || data.arcGrades.length < 2) return;

    const rect = svgRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = Math.max(rect.height, 80);
    const margin = { top: 8, right: 8, bottom: 16, left: 24 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const scores = data.arcGrades.map((a) => a.grades.overall);
    const x = d3.scaleBand<number>().domain(scores.map((_, i) => i)).range([0, w]).padding(0.15);
    const y = d3.scaleLinear().domain([0, 100]).range([h, 0]);

    // Zone bands
    const zones = [
      { y0: 0, y1: 60, color: '#EF4444' },
      { y0: 60, y1: 70, color: '#F97316' },
      { y0: 70, y1: 80, color: '#FACC15' },
      { y0: 80, y1: 90, color: '#A3E635' },
      { y0: 90, y1: 100, color: '#22C55E' },
    ];
    for (const z of zones) {
      g.append('rect')
        .attr('x', 0).attr('y', y(z.y1)).attr('width', w).attr('height', y(z.y0) - y(z.y1))
        .attr('fill', z.color).attr('fill-opacity', 0.04);
    }

    // Score bars
    scores.forEach((s, i) => {
      g.append('rect')
        .attr('x', x(i)!).attr('y', y(s)).attr('width', x.bandwidth()).attr('height', h - y(s))
        .attr('fill', gradeColor(s, 100)).attr('fill-opacity', 0.6).attr('rx', 1);
    });

    // Y axis labels
    for (const tick of [25, 50, 75, 100]) {
      g.append('text').attr('x', -4).attr('y', y(tick) + 3)
        .attr('text-anchor', 'end').attr('fill', 'white').attr('fill-opacity', 0.2)
        .attr('font-size', 8).attr('font-family', 'monospace').text(tick);
    }
  }, [data]);

  return (
    <div className="flex flex-col h-full px-20 py-8 max-w-5xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-text-primary">{data.title}</h2>
          <p className="text-xs text-text-dim font-mono mt-0.5">
            {data.sceneCount} scenes / {data.arcCount} arc{data.arcCount !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-5xl font-bold font-mono" style={{ color: gradeColor(data.overallGrades.overall, 100) }}>
            {data.overallGrades.overall}
          </span>
          <span className="text-lg text-text-dim">/100</span>
        </div>
      </div>

      {/* Grade table */}
      <div className="mb-5">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/8">
              <th className="text-left py-2 pr-4 w-28" />
              <th className="text-right py-2 px-4 text-[10px] uppercase tracking-widest text-text-dim font-mono font-normal w-24">Avg</th>
              <th className="text-right py-2 px-4 text-[10px] tracking-widest text-text-dim font-mono font-normal w-24">σ</th>
              <th className="text-right py-2 px-4 text-[10px] uppercase tracking-widest text-text-dim font-mono font-normal w-24">Peak</th>
              <th className="text-right py-2 px-4 text-[10px] uppercase tracking-widest text-text-dim font-mono font-normal w-24">Total</th>
              <th className="text-right py-2 pl-4 text-[10px] uppercase tracking-widest text-text-dim font-mono font-normal w-24">Grade</th>
            </tr>
          </thead>
          <tbody>
            {FORCES.map((f) => {
              const grade = data.overallGrades[f.key];
              const isStreak = f.key === 'streak';
              const s = isStreak ? null : stats[f.key as keyof typeof stats];
              return (
                <tr key={f.key} className="border-b border-white/4">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: f.color }} />
                      <span className="text-sm font-semibold" style={{ color: f.color }}>{f.label}</span>
                    </div>
                  </td>
                  <td className="text-right py-3 px-4 text-sm font-mono font-bold text-text-primary">
                    {s ? s.avg.toFixed(2) : '—'}
                  </td>
                  <td className="text-right py-3 px-4 text-sm font-mono text-text-dim">
                    {s ? s.sd.toFixed(2) : '—'}
                  </td>
                  <td className="text-right py-3 px-4 text-sm font-mono text-text-secondary">
                    {s ? s.peak.toFixed(2) : '—'}
                  </td>
                  <td className="text-right py-3 px-4 text-sm font-mono text-text-secondary">
                    {s ? s.total.toFixed(1) : '—'}
                  </td>
                  <td className="text-right py-3 pl-4">
                    <span className="text-lg font-bold font-mono" style={{ color: gradeColor(grade, 20) }}>
                      {grade}
                    </span>
                    <span className="text-xs text-text-dim">/20</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Arc scores chart */}
      {data.arcGrades.length > 1 && (
        <div className="flex-1 min-h-0">
          <div className="text-[9px] uppercase tracking-widest text-text-dim mb-1">Score by Arc</div>
          <svg ref={svgRef} className="w-full h-full" />
        </div>
      )}
    </div>
  );
}
