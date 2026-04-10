'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { SlidesData } from '@/lib/slides-data';

const FORCE_COLORS: Record<string, string> = {
  drive: '#EF4444', world: '#22C55E', system: '#3B82F6', swing: '#FACC15',
};

const gradeColor = (v: number) => {
  if (v >= 90) return '#22C55E';
  if (v >= 80) return '#A3E635';
  if (v >= 70) return '#FACC15';
  if (v >= 60) return '#F97316';
  return '#EF4444';
};

export function TitleSlide({ data }: { data: SlidesData }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;

    const { width } = svgRef.current.getBoundingClientRect();
    const height = 120;
    const margin = { top: 8, right: 16, bottom: 16, left: 24 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const eng = data.deliveryCurve;
    const x = d3.scaleLinear().domain([0, eng.length - 1]).range([0, w]);
    const maxAbs = Math.max(...eng.map((e) => Math.abs(e.smoothed)), 0.5) * 1.2;
    const y = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([h, 0]);
    const zeroY = y(0);

    g.append('line').attr('x1', 0).attr('y1', zeroY).attr('x2', w).attr('y2', zeroY)
      .attr('stroke', 'white').attr('stroke-opacity', 0.08);

    const posArea = d3.area<typeof eng[0]>()
      .x((d) => x(d.index)).y0(zeroY).y1((d) => Math.min(y(d.smoothed), zeroY))
      .curve(d3.curveMonotoneX);
    g.append('path').datum(eng).attr('d', posArea).attr('fill', '#F59E0B').attr('fill-opacity', 0.1);

    const line = d3.line<typeof eng[0]>()
      .x((d) => x(d.index)).y((d) => y(d.smoothed)).curve(d3.curveMonotoneX);
    g.append('path').datum(eng).attr('d', line)
      .attr('fill', 'none').attr('stroke', '#F59E0B').attr('stroke-width', 2);

    for (const p of eng.filter((e) => e.isPeak)) {
      g.append('path')
        .attr('d', d3.symbol().type(d3.symbolTriangle).size(24)())
        .attr('transform', `translate(${x(p.index)},${y(p.smoothed) - 5})`)
        .attr('fill', '#FCD34D');
    }

    for (const v of eng.filter((e) => e.isValley)) {
      g.append('path')
        .attr('d', d3.symbol().type(d3.symbolTriangle).size(24)())
        .attr('transform', `translate(${x(v.index)},${y(v.smoothed) + 5}) rotate(180)`)
        .attr('fill', '#93C5FD').attr('opacity', 0.6);
    }
  }, [data]);

  const forces = ['drive', 'world', 'system'] as const;
  const colors: Record<string, string> = { drive: '#EF4444', world: '#22C55E', system: '#3B82F6' };
  const names: Record<string, string> = { drive: 'Drive', world: 'World', system: 'System' };
  const dominant = forces.reduce((a, b) => data.overallGrades[a] > data.overallGrades[b] ? a : b);

  return (
    <div className="flex flex-col items-center justify-center h-full px-12 py-8 relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 50% 50% at 50% 55%, ${gradeColor(data.overallGrades.overall)}06 0%, transparent 70%)`,
        }}
      />

      {/* Title */}
      <h1 className="text-5xl font-bold text-text-primary mb-6 leading-tight max-w-2xl text-center relative">
        {data.title}
      </h1>

      {/* Sparkline */}
      <div className="w-full max-w-3xl mb-6 relative">
        <svg ref={svgRef} className="w-full" style={{ height: 120 }} />
      </div>

      {/* Verdict */}
      <div className="text-center mb-6 relative">
        <p className="text-lg text-text-secondary leading-relaxed max-w-2xl italic">
          {'\u201C'}A <span className="text-emerald-400 font-semibold">{data.density.name}</span>
          {', '}<span className="text-amber-400 font-semibold">{data.shape.name}</span>
          {' '}<span className="text-cyan-400 font-semibold">{data.scale.name}</span>
          {' of '}<span className="text-violet-400 font-semibold inline-flex items-center gap-1">{data.archetype.name}</span>
          {' archetype.\u201D'}
        </p>
      </div>

      {/* Score + force breakdown */}
      <div className="flex items-center gap-8 mb-6 relative">
        <div className="flex items-baseline gap-1">
          <span className="text-6xl font-bold font-mono" style={{ color: gradeColor(data.overallGrades.overall) }}>
            {data.overallGrades.overall}
          </span>
          <span className="text-xl text-text-dim">/100</span>
        </div>

        <div className="flex flex-col gap-1.5">
          {(['drive', 'world', 'system', 'swing'] as const).map((f) => (
            <div key={f} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: FORCE_COLORS[f] }} />
              <span className="text-[10px] w-16 capitalize" style={{ color: FORCE_COLORS[f] }}>{f}</span>
              <div className="w-24 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(data.overallGrades[f] / 25) * 100}%`, backgroundColor: FORCE_COLORS[f], opacity: 0.7 }}
                />
              </div>
              <span className="text-[10px] font-mono text-text-dim w-8 text-right">{data.overallGrades[f]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats summary */}
      <div className="flex items-center gap-5 text-xs text-text-dim relative">
        <span>{data.peaks.length} peak{data.peaks.length !== 1 ? 's' : ''}</span>
        <span className="opacity-20">|</span>
        <span>{data.troughs.length} valle{data.troughs.length !== 1 ? 'ys' : 'y'}</span>
        <span className="opacity-20">|</span>
        <span>{data.characterCount} characters</span>
        <span className="opacity-20">|</span>
        <span>{data.threadCount} threads</span>
        <span className="opacity-20">|</span>
        <span>{data.sceneCount} scenes</span>
      </div>
    </div>
  );
}
