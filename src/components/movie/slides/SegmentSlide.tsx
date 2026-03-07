'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { MovieData, Segment } from '@/lib/movie-data';

const FORCE_LABELS: Record<string, { label: string; color: string }> = {
  payoff: { label: 'Payoff', color: '#EF4444' },
  change: { label: 'Change', color: '#22C55E' },
  variety: { label: 'Variety', color: '#3B82F6' },
};

export function SegmentSlide({ data, segment }: { data: MovieData; segment: Segment }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;

    const { width } = svgRef.current.getBoundingClientRect();
    const height = 180;
    const margin = { top: 16, right: 16, bottom: 28, left: 32 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Full engagement curve in dim
    const fullEng = data.engagementCurve;
    const x = d3.scaleLinear().domain([0, fullEng.length - 1]).range([0, w]);
    const maxAbs = Math.max(...fullEng.map((e) => Math.abs(e.smoothed)), 0.5) * 1.2;
    const y = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([h, 0]);
    const zeroY = y(0);

    g.append('line').attr('x1', 0).attr('y1', zeroY).attr('x2', w).attr('y2', zeroY)
      .attr('stroke', 'white').attr('stroke-opacity', 0.1);

    // Full curve (dim)
    const line = d3.line<typeof fullEng[0]>()
      .x((d) => x(d.index)).y((d) => y(d.smoothed)).curve(d3.curveMonotoneX);
    g.append('path').datum(fullEng).attr('d', line)
      .attr('fill', 'none').attr('stroke', 'white').attr('stroke-opacity', 0.1).attr('stroke-width', 1);

    // Highlight region
    g.append('rect')
      .attr('x', x(segment.startIdx)).attr('y', 0)
      .attr('width', x(segment.endIdx) - x(segment.startIdx)).attr('height', h)
      .attr('fill', '#F59E0B').attr('fill-opacity', 0.05);

    // Segment curve (bright)
    const segEng = fullEng.slice(segment.startIdx, segment.endIdx + 1);
    const segArea = d3.area<typeof fullEng[0]>()
      .x((d) => x(d.index)).y0(zeroY).y1((d) => y(d.smoothed)).curve(d3.curveMonotoneX);
    g.append('path').datum(segEng).attr('d', segArea)
      .attr('fill', '#F59E0B').attr('fill-opacity', 0.15);
    g.append('path').datum(segEng).attr('d', line)
      .attr('fill', 'none').attr('stroke', '#F59E0B').attr('stroke-width', 2);

    // Peaks in segment
    for (const e of segEng.filter((e) => e.isPeak)) {
      g.append('path')
        .attr('d', d3.symbol().type(d3.symbolTriangle).size(36)())
        .attr('transform', `translate(${x(e.index)},${y(e.smoothed) - 7})`)
        .attr('fill', '#FCD34D');
    }
    // Valleys in segment
    for (const e of segEng.filter((e) => e.isValley)) {
      g.append('path')
        .attr('d', d3.symbol().type(d3.symbolTriangle).size(36)())
        .attr('transform', `translate(${x(e.index)},${y(e.smoothed) + 7}) rotate(180)`)
        .attr('fill', '#93C5FD');
    }
  }, [data, segment]);

  const sceneRange = `${segment.startIdx + 1}–${segment.endIdx + 1}`;
  const dominant = FORCE_LABELS[segment.dominantForce];

  return (
    <div className="flex flex-col h-full px-12 py-8">
      <div className="flex items-center gap-4 mb-2">
        <h2 className="text-2xl font-bold text-text-primary">
          Segment {segment.index + 1}
        </h2>
        <span className="text-sm text-text-dim font-mono">Scenes {sceneRange}</span>
        <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: dominant.color + '20', color: dominant.color }}>
          {dominant.label}-driven
        </span>
      </div>

      <svg ref={svgRef} className="w-full" style={{ height: 180 }} />

      <div className="flex-1 grid grid-cols-2 gap-8 mt-4">
        {/* Thread changes */}
        <div>
          <h3 className="text-xs uppercase tracking-widest text-text-dim mb-3">Thread Movements</h3>
          {segment.threadChanges.length === 0 ? (
            <p className="text-xs text-text-dim italic">No thread mutations in this segment</p>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {segment.threadChanges.slice(0, 8).map((tc, i) => {
                const thread = data.scenes[0] ? undefined : undefined; // placeholder
                const threadDesc = Object.values(data.scenes)
                  .flatMap(() => [])
                  .length === 0 ? tc.threadId : tc.threadId;
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-text-dim font-mono">#{tc.sceneIdx + 1}</span>
                    <span className="text-text-secondary">{tc.threadId}</span>
                    <span className="text-text-dim">{tc.from}</span>
                    <span className="text-text-dim">&rarr;</span>
                    <span className="text-text-primary font-medium">{tc.to}</span>
                  </div>
                );
              })}
              {segment.threadChanges.length > 8 && (
                <p className="text-[10px] text-text-dim">+{segment.threadChanges.length - 8} more</p>
              )}
            </div>
          )}
        </div>

        {/* Key scenes */}
        <div>
          <h3 className="text-xs uppercase tracking-widest text-text-dim mb-3">Key Moments</h3>
          <div className="space-y-3">
            {segment.keyScenes.map((ks) => (
              <div key={ks.idx} className="border-l-2 border-amber-400/40 pl-3">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs text-text-dim font-mono">Scene {ks.idx + 1}</span>
                  <span className="text-[10px] text-amber-400 font-mono">E:{ks.engagement.toFixed(2)}</span>
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">{ks.summary}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
