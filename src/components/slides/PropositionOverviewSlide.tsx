'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { SlidesData } from '@/lib/slides-data';
import { BASE_COLORS } from '@/lib/proposition-classify';
import type { PropositionBaseCategory } from '@/types/narrative';

const BASE_ORDER: PropositionBaseCategory[] = ['Anchor', 'Seed', 'Close', 'Texture'];

export function PropositionOverviewSlide({ data }: { data: SlidesData }) {
  const svgRef = useRef<SVGSVGElement>(null);

  const totals = data.propositionTotals;
  const total = data.propositionCount;
  const hasData = total > 0 && Object.values(totals).some(v => v > 0);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current || !hasData) return;

    const size = 220;
    const outerR = 90;
    const innerR = 55;

    svg.attr('viewBox', `0 0 ${size} ${size}`);
    const g = svg.append('g').attr('transform', `translate(${size / 2},${size / 2})`);

    const pie = d3.pie<{ key: PropositionBaseCategory; value: number }>()
      .value(d => d.value)
      .sort(null);

    const arc = d3.arc<d3.PieArcDatum<{ key: PropositionBaseCategory; value: number }>>()
      .innerRadius(innerR)
      .outerRadius(outerR)
      .padAngle(0.02)
      .cornerRadius(3);

    const slices = BASE_ORDER.filter(k => totals[k] > 0).map(k => ({ key: k, value: totals[k] }));
    const arcs = pie(slices);

    // Animated arcs
    g.selectAll('path')
      .data(arcs)
      .enter()
      .append('path')
      .attr('fill', d => BASE_COLORS[d.data.key])
      .attr('opacity', 0.8)
      .attr('d', arc as never)
      .attr('stroke-dasharray', function() { return `${(this as SVGPathElement).getTotalLength()}`; })
      .attr('stroke-dashoffset', function() { return `${(this as SVGPathElement).getTotalLength()}`; })
      .transition()
      .duration(800)
      .ease(d3.easeCubicOut)
      .attr('stroke-dashoffset', '0');

    // Center count
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.1em')
      .attr('fill', 'rgba(255,255,255,0.7)')
      .attr('font-size', '24px')
      .attr('font-weight', '600')
      .attr('font-family', 'ui-monospace, monospace')
      .text(total.toLocaleString());

    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '1.5em')
      .attr('fill', 'rgba(255,255,255,0.3)')
      .attr('font-size', '9px')
      .attr('letter-spacing', '0.1em')
      .text('PROPOSITIONS');
  }, [totals, total, hasData]);

  if (!hasData) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-white/30 text-sm">No proposition classification data available.</p>
      </div>
    );
  }

  const anchorRatio = total > 0 ? totals.Anchor / total : 0;

  return (
    <div className="h-full flex flex-col items-center justify-center gap-8 px-12">
      <h2 className="text-[10px] uppercase tracking-[0.25em] text-white/25 font-mono">
        Proposition Structure
      </h2>

      <div className="flex items-center gap-12">
        <svg ref={svgRef} className="w-56 h-56" />

        <div className="space-y-3">
          {BASE_ORDER.map(base => {
            const count = totals[base];
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={base} className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: BASE_COLORS[base] }} />
                <div className="w-24">
                  <span className="text-[13px] font-semibold" style={{ color: BASE_COLORS[base] }}>{base}</span>
                </div>
                <span className="text-[13px] font-mono text-white/50 w-12 text-right">{pct.toFixed(0)}%</span>
                <span className="text-[11px] text-white/25 font-mono">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-8 text-center">
        <div>
          <div className="text-[22px] font-bold font-mono" style={{ color: BASE_COLORS.Anchor }}>
            {(anchorRatio * 100).toFixed(0)}%
          </div>
          <div className="text-[9px] text-white/30 uppercase tracking-wider mt-1">Anchor Ratio</div>
        </div>
        <div>
          <div className="text-[22px] font-bold font-mono" style={{ color: BASE_COLORS.Seed }}>
            {totals.Seed}
          </div>
          <div className="text-[9px] text-white/30 uppercase tracking-wider mt-1">Seeds</div>
        </div>
        <div>
          <div className="text-[22px] font-bold font-mono" style={{ color: BASE_COLORS.Close }}>
            {totals.Close}
          </div>
          <div className="text-[9px] text-white/30 uppercase tracking-wider mt-1">Closes</div>
        </div>
      </div>
    </div>
  );
}
