'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { MovieData, Segment } from '@/lib/movie-data';

const FORCE_META: Record<string, { label: string; color: string }> = {
  payoff: { label: 'Payoff', color: '#EF4444' },
  change: { label: 'Change', color: '#22C55E' },
  variety: { label: 'Variety', color: '#3B82F6' },
};

export function SegmentSlide({ data, segment }: { data: MovieData; segment: Segment }) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Derived stats
  const sceneCount = segment.endIdx - segment.startIdx + 1;
  const segScenes = data.scenes.slice(segment.startIdx, segment.endIdx + 1);
  const segForces = data.forceSnapshots.slice(segment.startIdx, segment.endIdx + 1);

  const peaksInSeg = data.engagementCurve.filter((e) => e.isPeak && e.index >= segment.startIdx && e.index <= segment.endIdx);
  const valleysInSeg = data.engagementCurve.filter((e) => e.isValley && e.index >= segment.startIdx && e.index <= segment.endIdx);

  // Engagement trend: compare first-half avg to second-half avg
  const segEng = data.engagementCurve.slice(segment.startIdx, segment.endIdx + 1);
  const mid = Math.floor(segEng.length / 2);
  const firstHalf = segEng.slice(0, mid);
  const secondHalf = segEng.slice(mid);
  const avgFirst = firstHalf.length > 0 ? firstHalf.reduce((s, e) => s + e.smoothed, 0) / firstHalf.length : 0;
  const avgSecond = secondHalf.length > 0 ? secondHalf.reduce((s, e) => s + e.smoothed, 0) / secondHalf.length : 0;
  const trend = avgSecond - avgFirst;
  const trendLabel = Math.abs(trend) < 0.1 ? 'Steady' : trend > 0 ? 'Rising' : 'Falling';

  // Unique characters in this segment
  const charSet = new Set<string>();
  for (const s of segScenes) {
    charSet.add(s.povId);
    for (const p of s.participantIds) charSet.add(p);
  }

  // Unique locations
  const locSet = new Set(segScenes.map((s) => s.locationId));

  // Thread activity summary: count distinct threads touched, terminal transitions
  const threadsTouched = new Set<string>();
  let terminalCount = 0;
  const terminalStatuses = new Set(['resolved', 'subverted', 'abandoned']);
  for (const tc of segment.threadChanges) {
    threadsTouched.add(tc.threadId);
    if (terminalStatuses.has(tc.to.toLowerCase())) terminalCount++;
  }

  // Average force values for this segment
  const avgForces = {
    payoff: segForces.reduce((s, f) => s + f.payoff, 0) / (segForces.length || 1),
    change: segForces.reduce((s, f) => s + f.change, 0) / (segForces.length || 1),
    variety: segForces.reduce((s, f) => s + f.variety, 0) / (segForces.length || 1),
  };

  const dominant = FORCE_META[segment.dominantForce];

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;

    const { width } = svgRef.current.getBoundingClientRect();
    const height = 140;
    const margin = { top: 12, right: 16, bottom: 24, left: 28 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const fullEng = data.engagementCurve;
    const x = d3.scaleLinear().domain([0, fullEng.length - 1]).range([0, w]);
    const maxAbs = Math.max(...fullEng.map((e) => Math.abs(e.smoothed)), 0.5) * 1.2;
    const y = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([h, 0]);
    const zeroY = y(0);

    g.append('line').attr('x1', 0).attr('y1', zeroY).attr('x2', w).attr('y2', zeroY)
      .attr('stroke', 'white').attr('stroke-opacity', 0.08);

    // Full curve (dim)
    const line = d3.line<typeof fullEng[0]>()
      .x((d) => x(d.index)).y((d) => y(d.smoothed)).curve(d3.curveMonotoneX);
    g.append('path').datum(fullEng).attr('d', line)
      .attr('fill', 'none').attr('stroke', 'white').attr('stroke-opacity', 0.08).attr('stroke-width', 1);

    // Highlight region
    g.append('rect')
      .attr('x', x(segment.startIdx)).attr('y', 0)
      .attr('width', Math.max(1, x(segment.endIdx) - x(segment.startIdx))).attr('height', h)
      .attr('fill', '#F59E0B').attr('fill-opacity', 0.04);

    // Segment curve (bright)
    const segEngData = fullEng.slice(segment.startIdx, segment.endIdx + 1);
    const segArea = d3.area<typeof fullEng[0]>()
      .x((d) => x(d.index)).y0(zeroY).y1((d) => y(d.smoothed)).curve(d3.curveMonotoneX);
    g.append('path').datum(segEngData).attr('d', segArea)
      .attr('fill', '#F59E0B').attr('fill-opacity', 0.12);
    g.append('path').datum(segEngData).attr('d', line)
      .attr('fill', 'none').attr('stroke', '#F59E0B').attr('stroke-width', 2);

    // Peak/valley markers — always show at least one of each
    const detectedPeaks = segEngData.filter((e) => e.isPeak);
    const detectedValleys = segEngData.filter((e) => e.isValley);

    const peakPoints = detectedPeaks.length > 0
      ? detectedPeaks
      : segEngData.length > 0
        ? [segEngData.reduce((a, b) => (b.smoothed > a.smoothed ? b : a), segEngData[0])]
        : [];
    const valleyPoints = detectedValleys.length > 0
      ? detectedValleys
      : segEngData.length > 1
        ? [segEngData.reduce((a, b) => (b.smoothed < a.smoothed ? b : a), segEngData[0])]
        : [];

    for (const e of peakPoints) {
      g.append('path').attr('d', d3.symbol().type(d3.symbolTriangle).size(30)())
        .attr('transform', `translate(${x(e.index)},${y(e.smoothed) - 6})`).attr('fill', '#FCD34D');
    }
    for (const e of valleyPoints) {
      // Don't overlap with peak if it's the same point
      if (peakPoints.some((p) => p.index === e.index)) continue;
      g.append('path').attr('d', d3.symbol().type(d3.symbolTriangle).size(30)())
        .attr('transform', `translate(${x(e.index)},${y(e.smoothed) + 6}) rotate(180)`).attr('fill', '#93C5FD');
    }

    // Boundary labels
    g.append('text').attr('x', x(segment.startIdx)).attr('y', h + 16)
      .attr('text-anchor', 'middle').attr('fill', 'white').attr('fill-opacity', 0.3)
      .attr('font-size', 9).attr('font-family', 'monospace').text(segment.startIdx + 1);
    g.append('text').attr('x', x(segment.endIdx)).attr('y', h + 16)
      .attr('text-anchor', 'middle').attr('fill', 'white').attr('fill-opacity', 0.3)
      .attr('font-size', 9).attr('font-family', 'monospace').text(segment.endIdx + 1);
  }, [data, segment]);

  return (
    <div className="flex flex-col h-full px-12 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <h2 className="text-2xl font-bold text-text-primary">Segment {segment.index + 1}</h2>
        <span className="text-sm text-text-dim font-mono">Scenes {segment.startIdx + 1}–{segment.endIdx + 1}</span>
        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold" style={{ backgroundColor: dominant.color + '18', color: dominant.color }}>
          {dominant.label}-driven
        </span>
        <span className={`ml-auto text-xs font-mono ${trend > 0.1 ? 'text-emerald-400' : trend < -0.1 ? 'text-red-400' : 'text-text-dim'}`}>
          {trendLabel} {trend > 0 ? '↗' : trend < -0.1 ? '↘' : '→'}
        </span>
      </div>

      {/* Engagement chart */}
      <svg ref={svgRef} className="w-full shrink-0" style={{ height: 140 }} />

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-4 mt-4 mb-5">
        {[
          { value: sceneCount, label: 'Scenes', color: 'text-text-primary' },
          { value: `${peaksInSeg.length} / ${valleysInSeg.length}`, label: 'Peaks / Valleys', color: 'text-amber-400' },
          { value: charSet.size, label: 'Characters', color: 'text-text-primary' },
          { value: locSet.size, label: 'Locations', color: 'text-emerald-400' },
        ].map((stat) => (
          <div key={stat.label} className="px-3 py-2.5 rounded-lg bg-white/3 border border-white/5">
            <div className={`text-lg font-mono font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-[9px] uppercase tracking-widest text-text-dim mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Bottom: Force profile + Thread summary */}
      <div className="flex-1 grid grid-cols-2 gap-8 min-h-0">
        {/* Force profile */}
        <div>
          <div className="text-[9px] uppercase tracking-widest text-text-dim mb-3">Force Profile</div>
          <div className="space-y-2.5">
            {(['payoff', 'change', 'variety'] as const).map((f) => {
              const meta = FORCE_META[f];
              const val = avgForces[f];
              const maxVal = Math.max(avgForces.payoff, avgForces.change, avgForces.variety, 0.5);
              return (
                <div key={f} className="flex items-center gap-2">
                  <span className="text-[10px] font-medium w-12 capitalize" style={{ color: meta.color }}>{meta.label}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(val / maxVal) * 100}%`, backgroundColor: meta.color, opacity: 0.6 }} />
                  </div>
                  <span className="text-[10px] font-mono text-text-secondary w-10 text-right">{val.toFixed(1)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-[10px] text-text-dim">
            Avg engagement: <span className="text-amber-400 font-mono font-semibold">{segment.avgEngagement.toFixed(2)}</span>
          </div>
        </div>

        {/* Thread summary */}
        <div>
          <div className="text-[9px] uppercase tracking-widest text-text-dim mb-3">Thread Activity</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-text-dim">Threads touched</span>
              <span className="font-mono text-text-primary font-semibold">{threadsTouched.size}</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-text-dim">Total mutations</span>
              <span className="font-mono text-text-secondary">{segment.threadChanges.length}</span>
            </div>
            {terminalCount > 0 && (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-text-dim">Threads resolved</span>
                <span className="font-mono text-emerald-400">{terminalCount}</span>
              </div>
            )}
          </div>

          {/* Top thread transitions in this segment, resolved to descriptions */}
          {segment.threadChanges.length > 0 && (
            <div className="mt-3 space-y-1">
              {segment.threadChanges
                .filter((tc) => tc.from !== tc.to) // skip pulses for the overview
                .slice(0, 4)
                .map((tc, i) => {
                  const desc = data.threadDescriptions[tc.threadId];
                  const label = desc ? (desc.length > 45 ? desc.slice(0, 45) + '\u2026' : desc) : tc.threadId;
                  return (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <span className="text-text-secondary truncate flex-1" title={desc}>{label}</span>
                      <span className="text-text-dim shrink-0">{tc.from}</span>
                      <span className="text-amber-400/60 shrink-0">&rarr;</span>
                      <span className="text-text-primary font-medium shrink-0">{tc.to}</span>
                    </div>
                  );
                })}
              {segment.threadChanges.filter((tc) => tc.from !== tc.to).length > 4 && (
                <span className="text-[9px] text-text-dim">+{segment.threadChanges.filter((tc) => tc.from !== tc.to).length - 4} more transitions</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
