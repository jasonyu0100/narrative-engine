'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { SlidesData } from '@/lib/slides-data';
import { BASE_COLORS } from '@/lib/proposition-classify';
import type { PropositionBaseCategory } from '@/types/narrative';

const BASE_ORDER: PropositionBaseCategory[] = ['Anchor', 'Seed', 'Close', 'Texture'];

export function PropositionTimelineSlide({ data }: { data: SlidesData }) {
  const svgRef = useRef<SVGSVGElement>(null);

  const timeline = data.propositionTimeline;
  const hasClassified = timeline.some(t => Object.values(t.totals).some(v => v > 0));

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current || timeline.length === 0) return;

    const width = 700;
    const height = 260;
    const margin = { top: 20, right: 20, bottom: 30, left: 40 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const n = timeline.length;
    const x = d3.scaleLinear().domain([0, n - 1]).range([0, w]);

    if (hasClassified) {
      // Stacked area chart — 4 base categories as proportions
      const stackData = timeline.map((t, i) => {
        const total = t.total || 1;
        return {
          i,
          Anchor: t.totals.Anchor / total,
          Seed: t.totals.Seed / total,
          Close: t.totals.Close / total,
          Texture: t.totals.Texture / total,
        };
      });

      const y = d3.scaleLinear().domain([0, 1]).range([h, 0]);

      const stack = d3.stack<typeof stackData[0]>()
        .keys(BASE_ORDER)
        .order(d3.stackOrderNone)
        .offset(d3.stackOffsetNone);

      const series = stack(stackData);

      const area = d3.area<d3.SeriesPoint<typeof stackData[0]>>()
        .x((_, i) => x(i))
        .y0(d => y(d[0]))
        .y1(d => y(d[1]))
        .curve(d3.curveMonotoneX);

      // Draw stacked areas with animation
      g.selectAll('.layer')
        .data(series)
        .enter()
        .append('path')
        .attr('class', 'layer')
        .attr('fill', d => BASE_COLORS[d.key as PropositionBaseCategory])
        .attr('opacity', 0)
        .attr('d', area as never)
        .transition()
        .duration(800)
        .delay((_, i) => i * 150)
        .attr('opacity', 0.7);

      // Y axis labels
      g.append('text')
        .attr('x', -8).attr('y', y(1)).attr('dy', '0.3em')
        .attr('text-anchor', 'end').attr('font-size', '8px').attr('fill', 'rgba(255,255,255,0.25)')
        .text('100%');
      g.append('text')
        .attr('x', -8).attr('y', y(0.5)).attr('dy', '0.3em')
        .attr('text-anchor', 'end').attr('font-size', '8px').attr('fill', 'rgba(255,255,255,0.15)')
        .text('50%');
    } else {
      // No classification yet — show proposition density as bar chart
      const maxTotal = Math.max(...timeline.map(t => t.total), 1);
      const y = d3.scaleLinear().domain([0, maxTotal]).range([h, 0]);
      const barW = Math.max(1, w / n - 1);

      g.selectAll('rect')
        .data(timeline)
        .enter()
        .append('rect')
        .attr('x', (_, i) => x(i) - barW / 2)
        .attr('y', d => y(d.total))
        .attr('width', barW)
        .attr('height', d => h - y(d.total))
        .attr('fill', 'rgba(255,255,255,0.15)')
        .attr('rx', 1)
        .attr('opacity', 0)
        .transition()
        .duration(600)
        .delay((_, i) => i * 5)
        .attr('opacity', 1);

      // Y axis
      g.append('text')
        .attr('x', -8).attr('y', y(maxTotal)).attr('dy', '0.3em')
        .attr('text-anchor', 'end').attr('font-size', '8px').attr('fill', 'rgba(255,255,255,0.25)')
        .text(maxTotal.toString());
    }

    // X axis — scene numbers
    const tickCount = Math.min(10, n);
    const tickStep = Math.ceil(n / tickCount);
    for (let i = 0; i < n; i += tickStep) {
      g.append('text')
        .attr('x', x(i)).attr('y', h + 16)
        .attr('text-anchor', 'middle').attr('font-size', '8px').attr('fill', 'rgba(255,255,255,0.2)')
        .text(i + 1);
    }

    // Axis line
    g.append('line')
      .attr('x1', 0).attr('y1', h).attr('x2', w).attr('y2', h)
      .attr('stroke', 'rgba(255,255,255,0.1)');

  }, [timeline, hasClassified]);

  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 px-8">
      <h2 className="text-[10px] uppercase tracking-[0.25em] text-white/25 font-mono">
        {hasClassified ? 'Proposition Classification Timeline' : 'Proposition Density'}
      </h2>

      <svg ref={svgRef} className="w-full max-w-[700px] h-auto" />

      {/* Legend */}
      {hasClassified && (
        <div className="flex items-center gap-6">
          {BASE_ORDER.map(base => (
            <div key={base} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: BASE_COLORS[base], opacity: 0.7 }} />
              <span className="text-[10px]" style={{ color: BASE_COLORS[base] }}>{base}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-white/30 max-w-lg text-center leading-relaxed">
        {hasClassified
          ? 'Stacked proportions show how structural roles shift across the narrative. Watch for Seed compression toward the end and Close expansion in the climax.'
          : 'Proposition density per scene. Classification data will appear once embeddings are processed.'
        }
      </p>
    </div>
  );
}
