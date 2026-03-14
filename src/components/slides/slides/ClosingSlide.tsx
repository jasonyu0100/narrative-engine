'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { SlidesData } from '@/lib/slides-data';

const gradeColor = (v: number) => {
  if (v >= 90) return '#22C55E';
  if (v >= 80) return '#A3E635';
  if (v >= 70) return '#FACC15';
  if (v >= 60) return '#F97316';
  return '#EF4444';
};

export function ClosingSlide({ data }: { data: SlidesData }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;

    const { width } = svgRef.current.getBoundingClientRect();
    const height = 160;
    const margin = { top: 12, right: 16, bottom: 24, left: 32 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const eng = data.engagementCurve;
    const x = d3.scaleLinear().domain([0, eng.length - 1]).range([0, w]);
    const maxAbs = Math.max(...eng.map((e) => Math.abs(e.smoothed)), 0.5) * 1.2;
    const y = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([h, 0]);
    const zeroY = y(0);

    g.append('line').attr('x1', 0).attr('y1', zeroY).attr('x2', w).attr('y2', zeroY)
      .attr('stroke', 'white').attr('stroke-opacity', 0.1);

    // Fill
    const posArea = d3.area<typeof eng[0]>()
      .x((d) => x(d.index)).y0(zeroY).y1((d) => Math.min(y(d.smoothed), zeroY))
      .curve(d3.curveMonotoneX);
    g.append('path').datum(eng).attr('d', posArea).attr('fill', '#F59E0B').attr('fill-opacity', 0.1);

    // Line
    const line = d3.line<typeof eng[0]>()
      .x((d) => x(d.index)).y((d) => y(d.smoothed)).curve(d3.curveMonotoneX);
    g.append('path').datum(eng).attr('d', line)
      .attr('fill', 'none').attr('stroke', '#F59E0B').attr('stroke-width', 2);

    // Peak labels
    const peaks = eng.filter((e) => e.isPeak);
    for (const p of peaks) {
      g.append('path')
        .attr('d', d3.symbol().type(d3.symbolTriangle).size(30)())
        .attr('transform', `translate(${x(p.index)},${y(p.smoothed) - 6})`)
        .attr('fill', '#FCD34D');

      // Scene number label
      g.append('text')
        .attr('x', x(p.index)).attr('y', y(p.smoothed) - 14)
        .attr('text-anchor', 'middle').attr('fill', '#FCD34D').attr('fill-opacity', 0.7)
        .attr('font-size', 8).attr('font-family', 'monospace')
        .text(p.index + 1);
    }

    const valleys = eng.filter((e) => e.isValley);
    for (const v of valleys) {
      g.append('path')
        .attr('d', d3.symbol().type(d3.symbolTriangle).size(30)())
        .attr('transform', `translate(${x(v.index)},${y(v.smoothed) + 6}) rotate(180)`)
        .attr('fill', '#93C5FD').attr('opacity', 0.6);
    }
  }, [data]);

  // Dominant force
  const forces = ['payoff', 'change', 'knowledge'] as const;
  const dominant = forces.reduce((a, b) => data.overallGrades[a] > data.overallGrades[b] ? a : b);
  const forceNames: Record<string, string> = { payoff: 'Payoff', change: 'Change', knowledge: 'Knowledge' };

  return (
    <div className="flex flex-col items-center justify-center h-full px-12 py-8">
      {/* Final annotated curve */}
      <div className="w-full max-w-3xl mb-8">
        <svg ref={svgRef} className="w-full" style={{ height: 160 }} />
      </div>

      {/* Verdict */}
      <div className="text-center mb-8">
        <p className="text-lg text-text-secondary leading-relaxed max-w-2xl">
          A <span className="text-amber-400 font-semibold">{data.shape.name}</span> narrative
          with <span className="font-semibold" style={{ color: '#' + (dominant === 'payoff' ? 'EF4444' : dominant === 'change' ? '22C55E' : '3B82F6') }}>
            {forceNames[dominant]}
          </span>-driven mechanics
          across {data.sceneCount} scenes and {data.arcCount} arcs.
        </p>
      </div>

      {/* Final score */}
      <div className="flex items-center gap-2 mb-8">
        <span className="text-6xl font-bold font-mono" style={{ color: gradeColor(data.overallGrades.overall) }}>
          {data.overallGrades.overall}
        </span>
        <span className="text-xl text-text-dim">/100</span>
      </div>

      {/* Stats summary */}
      <div className="flex items-center gap-6 text-xs text-text-dim">
        <span>{data.peaks.length} peaks</span>
        <span className="opacity-30">/</span>
        <span>{data.troughs.length} valleys</span>
        <span className="opacity-30">/</span>
        <span>{data.characterCount} characters</span>
        <span className="opacity-30">/</span>
        <span>{data.threadCount} threads</span>
      </div>

      <p className="text-xs text-text-dim mt-6 opacity-50">Analysis complete</p>
    </div>
  );
}
