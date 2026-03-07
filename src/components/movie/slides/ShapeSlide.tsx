'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { MovieData } from '@/lib/movie-data';

export function ShapeSlide({ data }: { data: MovieData }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;

    const { width } = svgRef.current.getBoundingClientRect();
    const height = 280;
    const margin = { top: 24, right: 24, bottom: 36, left: 40 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const eng = data.engagementCurve;
    const x = d3.scaleLinear().domain([0, eng.length - 1]).range([0, w]);
    const maxAbs = Math.max(...eng.map((e) => Math.abs(e.smoothed)), 0.5) * 1.2;
    const y = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([h, 0]);
    const zeroY = y(0);

    // Grid
    g.append('line').attr('x1', 0).attr('y1', zeroY).attr('x2', w).attr('y2', zeroY)
      .attr('stroke', 'white').attr('stroke-opacity', 0.15);

    // Positive area
    const posArea = d3.area<typeof eng[0]>()
      .x((d) => x(d.index))
      .y0(zeroY)
      .y1((d) => Math.min(y(d.smoothed), zeroY))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(eng).attr('d', posArea)
      .attr('fill', '#F59E0B').attr('fill-opacity', 0.12);

    // Negative area
    const negArea = d3.area<typeof eng[0]>()
      .x((d) => x(d.index))
      .y0(zeroY)
      .y1((d) => Math.max(y(d.smoothed), zeroY))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(eng).attr('d', negArea)
      .attr('fill', '#93C5FD').attr('fill-opacity', 0.08);

    // Macro trend
    const trendLine = d3.line<typeof eng[0]>()
      .x((d) => x(d.index))
      .y((d) => y(d.macroTrend))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(eng).attr('d', trendLine)
      .attr('fill', 'none').attr('stroke', 'white').attr('stroke-opacity', 0.25)
      .attr('stroke-width', 1.5).attr('stroke-dasharray', '6,4');

    // Engagement line with draw animation
    const line = d3.line<typeof eng[0]>()
      .x((d) => x(d.index))
      .y((d) => y(d.smoothed))
      .curve(d3.curveMonotoneX);

    const path = g.append('path').datum(eng).attr('d', line)
      .attr('fill', 'none').attr('stroke', '#F59E0B').attr('stroke-width', 2);

    const totalLength = (path.node() as SVGPathElement)?.getTotalLength() ?? 0;
    path.attr('stroke-dasharray', totalLength)
      .attr('stroke-dashoffset', totalLength)
      .transition().duration(2000).ease(d3.easeCubicOut)
      .attr('stroke-dashoffset', 0);

    // Peak markers
    const peaks = eng.filter((e) => e.isPeak);
    g.selectAll('.peak').data(peaks).enter()
      .append('path')
      .attr('d', d3.symbol().type(d3.symbolTriangle).size(40)())
      .attr('transform', (d) => `translate(${x(d.index)},${y(d.smoothed) - 8})`)
      .attr('fill', '#FCD34D').attr('opacity', 0)
      .transition().delay(2000).duration(400)
      .attr('opacity', 0.9);

    // Valley markers
    const valleys = eng.filter((e) => e.isValley);
    g.selectAll('.valley').data(valleys).enter()
      .append('path')
      .attr('d', d3.symbol().type(d3.symbolTriangle).size(40)())
      .attr('transform', (d) => `translate(${x(d.index)},${y(d.smoothed) + 8}) rotate(180)`)
      .attr('fill', '#93C5FD').attr('opacity', 0)
      .transition().delay(2000).duration(400)
      .attr('opacity', 0.8);

    // X axis labels
    const labelCount = Math.min(8, eng.length);
    const step = Math.floor(eng.length / labelCount);
    for (let i = 0; i < eng.length; i += step) {
      g.append('text')
        .attr('x', x(i)).attr('y', h + 20)
        .attr('text-anchor', 'middle')
        .attr('fill', 'white').attr('fill-opacity', 0.3)
        .attr('font-size', 10).attr('font-family', 'monospace')
        .text(i + 1);
    }
  }, [data]);

  return (
    <div className="flex flex-col h-full px-12 py-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-text-primary mb-2">The Shape of This Story</h2>
        <p className="text-sm text-text-secondary">
          Engagement curve showing reader interest over {data.sceneCount} scenes.
          Peaks mark high-intensity moments, valleys mark recovery beats.
        </p>
      </div>

      <div className="flex-1 flex flex-col justify-center">
        <svg ref={svgRef} className="w-full" style={{ height: 280 }} />
      </div>

      <div className="mt-6 flex items-center gap-6">
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-white/10 bg-white/[0.03]">
          <svg width="48" height="24" viewBox="0 0 48 24">
            <polyline
              points={data.shape.curve.map(([x, y]) => `${x * 48},${(1 - y) * 24}`).join(' ')}
              fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
          <div>
            <span className="text-sm font-semibold text-amber-400">{data.shape.name}</span>
            <p className="text-[11px] text-text-dim">{data.shape.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-text-dim">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" /> Peaks: {data.peaks.length}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-300" /> Valleys: {data.troughs.length}
          </span>
        </div>
      </div>
    </div>
  );
}
