'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { SlidesData } from '@/lib/slides-data';

export function ForceDecompositionSlide({ data }: { data: SlidesData }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;

    const { width } = svgRef.current.getBoundingClientRect();
    const height = 300;
    const margin = { top: 20, right: 24, bottom: 36, left: 44 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const n = data.sceneCount;
    const raw = data.rawForces;

    const x = d3.scaleLinear().domain([0, n - 1]).range([0, w]);
    const maxVal = Math.max(
      ...raw.payoff, ...raw.change, ...raw.knowledge, 1,
    );
    const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([h, 0]);

    // Grid lines
    const ticks = y.ticks(5);
    for (const t of ticks) {
      g.append('line').attr('x1', 0).attr('y1', y(t)).attr('x2', w).attr('y2', y(t))
        .attr('stroke', 'white').attr('stroke-opacity', 0.06);
      g.append('text').attr('x', -8).attr('y', y(t) + 3)
        .attr('text-anchor', 'end').attr('fill', 'white').attr('fill-opacity', 0.25)
        .attr('font-size', 9).attr('font-family', 'monospace').text(t.toFixed(1));
    }

    // Areas (stacked look but overlaid with transparency)
    const forces = [
      { data: raw.knowledge, color: '#3B82F6', label: 'Knowledge' },
      { data: raw.change, color: '#22C55E', label: 'Change' },
      { data: raw.payoff, color: '#EF4444', label: 'Payoff' },
    ];

    for (const f of forces) {
      const area = d3.area<number>()
        .x((_, i) => x(i))
        .y0(h)
        .y1((d) => y(d))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(f.data)
        .attr('d', area)
        .attr('fill', f.color)
        .attr('fill-opacity', 0.08);

      const line = d3.line<number>()
        .x((_, i) => x(i))
        .y((d) => y(d))
        .curve(d3.curveMonotoneX);

      const path = g.append('path')
        .datum(f.data)
        .attr('d', line)
        .attr('fill', 'none')
        .attr('stroke', f.color)
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.8);

      // Draw animation
      const totalLength = (path.node() as SVGPathElement)?.getTotalLength() ?? 0;
      path.attr('stroke-dasharray', totalLength)
        .attr('stroke-dashoffset', totalLength)
        .transition().duration(1500).ease(d3.easeCubicOut)
        .attr('stroke-dashoffset', 0);
    }

    // X axis
    const labelCount = Math.min(10, n);
    const step = Math.max(1, Math.floor(n / labelCount));
    for (let i = 0; i < n; i += step) {
      g.append('text').attr('x', x(i)).attr('y', h + 20)
        .attr('text-anchor', 'middle').attr('fill', 'white').attr('fill-opacity', 0.3)
        .attr('font-size', 9).attr('font-family', 'monospace').text(i + 1);
    }
  }, [data]);

  // Find crossover points where dominant force changes
  const crossovers: { idx: number; from: string; to: string }[] = [];
  let prevDom = '';
  for (let i = 0; i < data.sceneCount; i++) {
    const p = data.rawForces.payoff[i];
    const c = data.rawForces.change[i];
    const v = data.rawForces.knowledge[i];
    const dom = p >= c && p >= v ? 'Payoff' : c >= p && c >= v ? 'Change' : 'Knowledge';
    if (prevDom && dom !== prevDom) {
      crossovers.push({ idx: i, from: prevDom, to: dom });
    }
    prevDom = dom;
  }

  return (
    <div className="flex flex-col h-full px-12 py-8">
      <h2 className="text-2xl font-bold text-text-primary mb-2">Force Decomposition</h2>
      <p className="text-sm text-text-secondary mb-4">
        Raw force values over time — showing which narrative engine drives each phase of the story.
      </p>

      <svg ref={svgRef} className="w-full" style={{ height: 300 }} />

      {/* Legend + crossover highlights */}
      <div className="flex items-center gap-6 mt-4">
        {[
          { label: 'Payoff', color: '#EF4444' },
          { label: 'Change', color: '#22C55E' },
          { label: 'Knowledge', color: '#3B82F6' },
        ].map((f) => (
          <span key={f.label} className="flex items-center gap-1.5 text-xs">
            <span className="w-3 h-0.5 rounded" style={{ backgroundColor: f.color }} />
            <span style={{ color: f.color }}>{f.label}</span>
          </span>
        ))}
      </div>

      {crossovers.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {crossovers.slice(0, 5).map((c, i) => (
            <span key={i} className="text-[10px] text-text-dim px-2 py-1 rounded bg-white/[0.03] border border-white/5">
              Scene {c.idx + 1}: {c.from} &rarr; {c.to}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
