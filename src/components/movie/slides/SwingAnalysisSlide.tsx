'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { MovieData } from '@/lib/movie-data';

export function SwingAnalysisSlide({ data }: { data: MovieData }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;

    const { width } = svgRef.current.getBoundingClientRect();
    const height = 220;
    const margin = { top: 16, right: 24, bottom: 32, left: 44 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const swings = data.swings;
    const x = d3.scaleLinear().domain([0, swings.length - 1]).range([0, w]);
    const maxSwing = Math.max(...swings, 0.5) * 1.1;
    const y = d3.scaleLinear().domain([0, maxSwing]).range([h, 0]);

    // Grid
    const ticks = y.ticks(4);
    for (const t of ticks) {
      g.append('line').attr('x1', 0).attr('y1', y(t)).attr('x2', w).attr('y2', y(t))
        .attr('stroke', 'white').attr('stroke-opacity', 0.06);
    }

    // Area
    const area = d3.area<number>()
      .x((_, i) => x(i)).y0(h).y1((d) => y(d)).curve(d3.curveMonotoneX);
    g.append('path').datum(swings).attr('d', area)
      .attr('fill', '#facc15').attr('fill-opacity', 0.08);

    // Line
    const line = d3.line<number>()
      .x((_, i) => x(i)).y((d) => y(d)).curve(d3.curveMonotoneX);
    const path = g.append('path').datum(swings).attr('d', line)
      .attr('fill', 'none').attr('stroke', '#facc15').attr('stroke-width', 1.5);

    const totalLength = (path.node() as SVGPathElement)?.getTotalLength() ?? 0;
    path.attr('stroke-dasharray', totalLength)
      .attr('stroke-dashoffset', totalLength)
      .transition().duration(1500).ease(d3.easeCubicOut)
      .attr('stroke-dashoffset', 0);

    // Moving average
    const windowSize = Math.max(3, Math.floor(swings.length / 10));
    const ma: number[] = [];
    for (let i = 0; i < swings.length; i++) {
      const start = Math.max(0, i - windowSize + 1);
      const window = swings.slice(start, i + 1);
      ma.push(window.reduce((s, v) => s + v, 0) / window.length);
    }
    g.append('path').datum(ma).attr('d', line)
      .attr('fill', 'none').attr('stroke', '#facc15').attr('stroke-width', 2).attr('stroke-opacity', 0.4)
      .attr('stroke-dasharray', '4,3');

    // X axis
    const labelCount = Math.min(8, swings.length);
    const step = Math.max(1, Math.floor(swings.length / labelCount));
    for (let i = 0; i < swings.length; i += step) {
      g.append('text').attr('x', x(i)).attr('y', h + 20)
        .attr('text-anchor', 'middle').attr('fill', 'white').attr('fill-opacity', 0.3)
        .attr('font-size', 9).attr('font-family', 'monospace').text(i + 1);
    }
  }, [data]);

  const avgSwing = data.swings.reduce((s, v) => s + v, 0) / data.swings.length;
  const maxSwing = Math.max(...data.swings);
  const variance = Math.sqrt(data.swings.reduce((s, v) => s + (v - avgSwing) ** 2, 0) / data.swings.length);

  // Pacing classification
  const pacingType = variance < avgSwing * 0.5
    ? 'Steady' : variance > avgSwing * 1.2
      ? 'Erratic' : 'Varied';

  return (
    <div className="flex flex-col h-full px-12 py-8">
      <h2 className="text-2xl font-bold text-text-primary mb-2">Swing Analysis</h2>
      <p className="text-sm text-text-secondary mb-4">
        Scene-to-scene volatility in force space — high swing means dramatic shifts between consecutive scenes.
      </p>

      <svg ref={svgRef} className="w-full" style={{ height: 220 }} />

      <div className="flex items-center gap-8 mt-4">
        <div className="flex flex-col items-center px-4 py-3 rounded-lg border border-white/8 bg-white/[0.02]">
          <span className="text-lg font-mono font-bold text-yellow-400">{avgSwing.toFixed(2)}</span>
          <span className="text-[10px] text-text-dim uppercase tracking-wider">Avg Swing</span>
        </div>
        <div className="flex flex-col items-center px-4 py-3 rounded-lg border border-white/8 bg-white/[0.02]">
          <span className="text-lg font-mono font-bold text-text-primary">{maxSwing.toFixed(2)}</span>
          <span className="text-[10px] text-text-dim uppercase tracking-wider">Max Swing</span>
        </div>
        <div className="flex flex-col items-center px-4 py-3 rounded-lg border border-white/8 bg-white/[0.02]">
          <span className="text-lg font-mono font-bold text-text-secondary">{variance.toFixed(2)}</span>
          <span className="text-[10px] text-text-dim uppercase tracking-wider">Std Dev</span>
        </div>
        <div className="flex flex-col items-center px-4 py-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.03]">
          <span className="text-lg font-semibold text-amber-400">{pacingType}</span>
          <span className="text-[10px] text-text-dim uppercase tracking-wider">Pacing</span>
        </div>
      </div>

      <div className="flex items-center gap-4 mt-3 text-[10px] text-text-dim">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-yellow-400 rounded" /> Swing
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-yellow-400/40 rounded" style={{ borderTop: '1px dashed' }} /> Moving Avg
        </span>
      </div>
    </div>
  );
}
