'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { SlidesData } from '@/lib/slides-data';

const FORCE_COLORS = {
  drive: '#EF4444',
  world: '#22C55E',
  system: '#3B82F6',
  swing: '#FACC15',
};

export function ForcesOverviewSlide({ data }: { data: SlidesData }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;

    const size = 240;
    const center = size / 2;
    const maxR = size / 2 - 30;

    svg.attr('viewBox', `0 0 ${size} ${size}`);

    const g = svg.append('g').attr('transform', `translate(${center},${center})`);

    // Axes: P, C, K, S at 90 degree intervals
    const axes = [
      { key: 'drive' as const, label: 'Drive', angle: -Math.PI / 2 },
      { key: 'world' as const, label: 'World', angle: 0 },
      { key: 'system' as const, label: 'System', angle: Math.PI / 2 },
      { key: 'swing' as const, label: 'Swing', angle: Math.PI },
    ];

    // Grid rings
    for (let r = 0.25; r <= 1; r += 0.25) {
      const points = axes.map((a) => [
        Math.cos(a.angle) * maxR * r,
        Math.sin(a.angle) * maxR * r,
      ]);
      g.append('polygon')
        .attr('points', points.map((p) => p.join(',')).join(' '))
        .attr('fill', 'none').attr('stroke', 'white').attr('stroke-opacity', 0.08);
    }

    // Axis lines
    for (const a of axes) {
      g.append('line')
        .attr('x1', 0).attr('y1', 0)
        .attr('x2', Math.cos(a.angle) * maxR).attr('y2', Math.sin(a.angle) * maxR)
        .attr('stroke', 'white').attr('stroke-opacity', 0.15);

      g.append('text')
        .attr('x', Math.cos(a.angle) * (maxR + 18))
        .attr('y', Math.sin(a.angle) * (maxR + 18))
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .attr('fill', FORCE_COLORS[a.key]).attr('font-size', 11).attr('font-weight', 600)
        .text(a.label);
    }

    // Normalize grades to 0-1 (grade is 0-25)
    const values = {
      drive: data.overallGrades.drive / 25,
      world: data.overallGrades.world / 25,
      system: data.overallGrades.system / 25,
      swing: data.overallGrades.swing / 25,
    };

    // Data polygon with animation
    const dataPoints = axes.map((a) => [
      Math.cos(a.angle) * maxR * values[a.key],
      Math.sin(a.angle) * maxR * values[a.key],
    ]);

    // Animate from center
    const zeroPoints = axes.map((a) => [0, 0]);

    const polygon = g.append('polygon')
      .attr('points', zeroPoints.map((p) => p.join(',')).join(' '))
      .attr('fill', '#F59E0B').attr('fill-opacity', 0.15)
      .attr('stroke', '#F59E0B').attr('stroke-width', 2).attr('stroke-opacity', 0.8);

    polygon.transition().duration(1200).ease(d3.easeCubicOut)
      .attr('points', dataPoints.map((p) => p.join(',')).join(' '));

    // Grade dots
    for (let i = 0; i < axes.length; i++) {
      g.append('circle')
        .attr('cx', dataPoints[i][0]).attr('cy', dataPoints[i][1])
        .attr('r', 0).attr('fill', FORCE_COLORS[axes[i].key])
        .transition().delay(1200).duration(300)
        .attr('r', 4);
    }
  }, [data]);

  // Determine dominant force
  const forces = ['drive', 'world', 'system', 'swing'] as const;
  const avgRaw = {
    drive: data.rawForces.drive.reduce((s, v) => s + v, 0) / data.sceneCount,
    world: data.rawForces.world.reduce((s, v) => s + v, 0) / data.sceneCount,
    system: data.rawForces.system.reduce((s, v) => s + v, 0) / data.sceneCount,
  };
  const dominant = forces.reduce((a, b) => data.overallGrades[a] > data.overallGrades[b] ? a : b);

  const forceDescriptions: Record<string, string> = {
    drive: 'Thread resolutions and relationship shifts carry the narrative weight',
    world: 'Character transformation and continuity mutations drive the story forward',
    system: 'World-building density — new concepts, systems, and connections expand the reader\'s understanding',
  };

  return (
    <div className="flex flex-col justify-center h-full px-12 py-8">
      <h2 className="text-2xl font-bold text-text-primary mb-2">Forces At Play</h2>
      <p className="text-sm text-text-secondary mb-6">
        Four narrative forces graded against literary reference benchmarks.
      </p>

      <div className="flex items-center gap-12">
        {/* Radar chart */}
        <div className="shrink-0">
          <svg ref={svgRef} className="w-60 h-60" />
        </div>

        {/* Force breakdown */}
        <div className="flex-1 space-y-5">
          {forces.map((f) => (
            <div key={f} className="flex items-center gap-4">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: FORCE_COLORS[f] }} />
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium capitalize" style={{ color: FORCE_COLORS[f] }}>{f}</span>
                  <span className="text-sm font-mono font-semibold text-text-primary">
                    {data.overallGrades[f]}<span className="text-xs text-text-dim">/25</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-1000"
                    style={{
                      width: `${(data.overallGrades[f] / 25) * 100}%`,
                      backgroundColor: FORCE_COLORS[f],
                      opacity: 0.7,
                    }}
                  />
                </div>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-6 pt-3 border-t border-white/8">
            <div className="ml-auto text-lg font-mono font-bold text-text-primary">
              {data.overallGrades.overall}<span className="text-xs text-text-dim">/100</span>
            </div>
          </div>

          {/* Dominant force callout */}
          <div className="px-4 py-3 rounded-lg border border-white/8 bg-white/[0.02]">
            <p className="text-xs text-text-dim mb-0.5">Dominant Force</p>
            <p className="text-sm font-medium capitalize" style={{ color: FORCE_COLORS[dominant] }}>
              {dominant}
            </p>
            <p className="text-xs text-text-dim mt-1">{forceDescriptions[dominant]}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
