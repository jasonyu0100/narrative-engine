'use client';

import { useMemo, useState, useRef, useEffect, useCallback, useId } from 'react';
import * as d3 from 'd3';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene, type Scene, type ForceSnapshot, type CubeCornerKey } from '@/types/narrative';
import { computeForceSnapshots, computeWindowedForces, computeRawForceTotals, computeSwingMagnitudes, detectCubeCorner, gradeForces, FORCE_REFERENCE_MEANS, zScoreNormalize, movingAverage, FORCE_WINDOW_SIZE, computeDeliveryCurve, classifyCurrentPosition, type DeliveryPoint } from '@/lib/narrative-utils';
import { IconLineChart, IconPencilDraw } from '@/components/icons';

type ForceKey = 'payoff' | 'change' | 'knowledge' | 'swing' | 'delivery';

type SceneDataPoint = {
  index: number;
  sceneId: string;
  arcId: string;
  arcName: string;
  summary: string;
  location: string;
  participants: string[];
  forces: ForceSnapshot;
  swing: number;
  corner: string;
  cornerKey: CubeCornerKey;
  threadChanges: string[];
};

type ArcRegion = {
  arcId: string;
  name: string;
  startIndex: number;
  endIndex: number;
};

type DrawLine = { points: [number, number][] };

type ChartForceKey = 'payoff' | 'change' | 'knowledge' | 'swing';
const FORCE_CONFIG: { key: ChartForceKey; label: string; color: string }[] = [
  { key: 'payoff', label: 'PAYOFF', color: '#EF4444' },
  { key: 'change', label: 'CHANGE', color: '#22C55E' },
  { key: 'knowledge', label: 'KNOWLEDGE', color: '#3B82F6' },
  { key: 'swing', label: 'SWING', color: '#facc15' },
];

const MARGIN = { top: 36, right: 16, bottom: 4, left: 48 };
const MARGIN_DENSE = { top: 36, right: 16, bottom: 4, left: 16 };
import { DENSE_ARC_THRESHOLD } from '@/lib/constants';

function ForceChart({
  data,
  forceKey,
  label,
  color,
  arcRegions,
  hoverIndex,
  onHover,
  selectedIndex,
  onSelect,
  windowRange,
  height,
  width,
  drawing,
  drawLines,
  onDrawStart,
  onDrawMove,
  onDrawEnd,
  dense,
}: {
  data: SceneDataPoint[];
  forceKey: ChartForceKey;
  label: string;
  color: string;
  arcRegions: ArcRegion[];
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  windowRange: { start: number; end: number } | null;
  height: number;
  width: number;
  drawing: boolean;
  drawLines: DrawLine[];
  onDrawStart: (forceKey: ForceKey, x: number, y: number) => void;
  onDrawMove: (x: number, y: number) => void;
  onDrawEnd: () => void;
  dense: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = useId().replace(/:/g, '_') + `_${forceKey}`;

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (data.length === 0 || width <= 0) return;

    const m = dense ? MARGIN_DENSE : MARGIN;
    const chartWidth = width - m.left - m.right;
    const chartHeight = height - m.top - m.bottom;

    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    // Clip path so chart content stays within bounds
    g.append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', chartWidth).attr('height', chartHeight);

    const xScale = d3.scaleLinear().domain([0, Math.max(data.length - 1, 1)]).range([0, chartWidth]);

    // Dynamic y-domain: symmetric if data has negatives, positive-only if all ≥ 0
    const values = data.map((d) => forceKey === 'swing' ? d.swing : d.forces[forceKey]);
    const allPositive = (d3.min(values) ?? 0) >= 0;
    const maxAbs = Math.max(d3.max(values.map(Math.abs)) ?? 1, 1);
    const yScale = d3.scaleLinear()
      .domain(allPositive ? [0, maxAbs * 1.1] : [-maxAbs, maxAbs])
      .range([chartHeight, 0]);

    // Window highlight region
    if (windowRange) {
      const wx1 = xScale(windowRange.start);
      const wx2 = xScale(windowRange.end);
      g.append('rect')
        .attr('x', wx1).attr('y', 0)
        .attr('width', Math.max(wx2 - wx1, 1))
        .attr('height', chartHeight)
        .attr('fill', color)
        .attr('opacity', 0.06);
      g.append('line')
        .attr('x1', wx1).attr('x2', wx1)
        .attr('y1', 0).attr('y2', chartHeight)
        .attr('stroke', color)
        .attr('stroke-width', 0.5)
        .attr('opacity', 0.3);
    }

    // Arc boundary lines + arc number labels
    // Thin out labels when dense: show every Nth arc number
    const arcLabelStep = arcRegions.length > 40 ? 10 : arcRegions.length > 20 ? 5 : arcRegions.length > 10 ? 2 : 1;
    arcRegions.forEach((arc, i) => {
      const x1 = xScale(arc.startIndex);
      if (i > 0) {
        g.append('line')
          .attr('x1', x1).attr('x2', x1)
          .attr('y1', 0).attr('y2', chartHeight)
          .attr('stroke', 'rgba(255,255,255,0.06)')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '4,4');
      }
      // Arc number at top of boundary
      if (i % arcLabelStep === 0) {
        const cx = xScale((arc.startIndex + arc.endIndex) / 2);
        g.append('text')
          .attr('x', cx)
          .attr('y', -m.top + 26)
          .attr('text-anchor', 'middle')
          .attr('fill', 'rgba(255,255,255,0.2)')
          .attr('font-size', '8px')
          .attr('font-family', 'monospace')
          .text(i + 1);
      }
    });

    // Gridlines — dynamic based on maxAbs, filtered to y-domain
    const [domainMin, domainMax] = yScale.domain();
    const gridValues = [0];
    const step = maxAbs <= 2 ? 0.5 : maxAbs <= 5 ? 1 : Math.ceil(maxAbs / 4);
    for (let v = step; v <= maxAbs; v += step) {
      if (v <= domainMax) gridValues.push(v);
      if (-v >= domainMin) gridValues.push(-v);
    }

    gridValues.forEach((v) => {
      const y = yScale(v);
      g.append('line')
        .attr('x1', 0).attr('x2', chartWidth)
        .attr('y1', y).attr('y2', y)
        .attr('stroke', v === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)')
        .attr('stroke-width', v === 0 ? 1 : 0.5);

      if (!dense) {
        g.append('text')
          .attr('x', -8)
          .attr('y', y)
          .attr('dy', '0.35em')
          .attr('text-anchor', 'end')
          .attr('fill', 'rgba(255,255,255,0.25)')
          .attr('font-size', '9px')
          .attr('font-family', 'monospace')
          .text(Number.isInteger(v) ? v.toString() : v.toFixed(1));
      }
    });

    // Window average based on selected scene's window range
    const windowSlice = windowRange
      ? values.slice(windowRange.start, windowRange.end + 1)
      : values.slice(-FORCE_WINDOW_SIZE);
    const winAvg = windowSlice.length > 0 ? windowSlice.reduce((s, v) => s + v, 0) / windowSlice.length : 0;

    // Force label
    g.append('text')
      .attr('x', 6)
      .attr('y', -m.top + 14)
      .attr('fill', color)
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .attr('letter-spacing', '0.1em')
      .text(label);

    // Window avg after label
    g.append('text')
      .attr('x', 6 + label.length * 8 + 6)
      .attr('y', -m.top + 14)
      .attr('fill', color)
      .attr('font-size', '9px')
      .attr('font-weight', '600')
      .attr('font-family', 'monospace')
      .attr('opacity', 0.7)
      .text(`w${winAvg >= 0 ? '+' : ''}${winAvg.toFixed(2)}`);

    // Clipped chart group
    const clipped = g.append('g').attr('clip-path', `url(#${clipId})`);

    // Subtle background fill so chart area is always visible
    clipped.append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', chartWidth).attr('height', chartHeight)
      .attr('fill', color)
      .attr('opacity', 0.03);

    // Area fill
    const area = d3.area<number>()
      .x((_, i) => xScale(i))
      .y0(yScale(0))
      .y1((d) => yScale(d))
      .curve(d3.curveMonotoneX);

    clipped.append('path')
      .datum(values)
      .attr('d', area)
      .attr('fill', color)
      .attr('opacity', 0.08);

    // Line
    const line = d3.line<number>()
      .x((_, i) => xScale(i))
      .y((d) => yScale(d))
      .curve(d3.curveMonotoneX);

    clipped.append('path')
      .datum(values)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('opacity', 0.9);

    // Moving average overlay
    if (values.length >= FORCE_WINDOW_SIZE) {
      const ma = movingAverage(values, FORCE_WINDOW_SIZE);
      clipped.append('path')
        .datum(ma)
        .attr('d', line)
        .attr('fill', 'none')
        .attr('stroke', '#FFFFFF')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3,2')
        .attr('opacity', 0.4);
    }

    // Draw lines overlay
    for (const dl of drawLines) {
      if (dl.points.length < 2) continue;
      const drawPath = d3.line<[number, number]>()
        .x((d) => d[0])
        .y((d) => d[1]);

      g.append('path')
        .datum(dl.points)
        .attr('d', drawPath)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(255, 255, 255, 0.7)')
        .attr('stroke-width', 1.5)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round');
    }

    // Hover crosshair
    if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < data.length) {
      const cx = xScale(hoverIndex);
      const cy = yScale(values[hoverIndex]);

      g.append('line')
        .attr('x1', cx).attr('x2', cx)
        .attr('y1', 0).attr('y2', chartHeight)
        .attr('stroke', 'rgba(255,255,255,0.3)')
        .attr('stroke-width', 1);

      g.append('line')
        .attr('x1', 0).attr('x2', chartWidth)
        .attr('y1', cy).attr('y2', cy)
        .attr('stroke', color)
        .attr('stroke-width', 0.5)
        .attr('stroke-dasharray', '3,3')
        .attr('opacity', 0.5);

      clipped.append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', 4)
        .attr('fill', color)
        .attr('stroke', '#111')
        .attr('stroke-width', 2);

      // Hover dot + value top-right
      g.append('circle')
        .attr('cx', chartWidth - 46)
        .attr('cy', -MARGIN.top + 11)
        .attr('r', 3)
        .attr('fill', color);

      g.append('text')
        .attr('x', chartWidth - 4)
        .attr('y', -m.top + 14)
        .attr('text-anchor', 'end')
        .attr('fill', color)
        .attr('font-size', '11px')
        .attr('font-family', 'monospace')
        .attr('font-weight', '600')
        .text(values[hoverIndex].toFixed(2));
    }

    // Selected scene cursor (persistent, distinct from hover)
    if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex < data.length && selectedIndex !== hoverIndex) {
      const sx = xScale(selectedIndex);
      const sy = yScale(values[selectedIndex]);

      g.append('line')
        .attr('x1', sx).attr('x2', sx)
        .attr('y1', 0).attr('y2', chartHeight)
        .attr('stroke', 'rgba(255,255,255,0.25)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '2,2');

      clipped.append('circle')
        .attr('cx', sx)
        .attr('cy', sy)
        .attr('r', 4.5)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.7);
    }

    // Interaction overlay
    g.append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', chartWidth).attr('height', chartHeight)
      .attr('fill', 'transparent')
      .style('cursor', drawing ? 'crosshair' : 'pointer')
      .on('mousemove', (event: MouseEvent) => {
        if (drawing) return;
        const [mx] = d3.pointer(event);
        const idx = Math.round(xScale.invert(mx));
        if (idx >= 0 && idx < data.length) onHover(idx);
      })
      .on('mouseleave', () => { if (!drawing) onHover(null); })
      .on('click', (event: MouseEvent) => {
        if (drawing) return;
        const [mx] = d3.pointer(event);
        const idx = Math.round(xScale.invert(mx));
        if (idx >= 0 && idx < data.length) onSelect(idx);
      })
      .on('mousedown', (event: MouseEvent) => {
        if (!drawing) return;
        event.preventDefault();
        const [mx, my] = d3.pointer(event);
        onDrawStart(forceKey, mx, my);
      })
      .on('mousemove.draw', (event: MouseEvent) => {
        if (!drawing) return;
        const [mx, my] = d3.pointer(event);
        onDrawMove(mx, my);
      })
      .on('mouseup', () => {
        if (drawing) onDrawEnd();
      });
  }, [data, forceKey, label, color, arcRegions, hoverIndex, onHover, selectedIndex, onSelect, windowRange, height, width, drawing, drawLines, onDrawStart, onDrawMove, onDrawEnd, dense, clipId]);

  return (
    <svg ref={svgRef} width={width} height={height} className="block" />
  );
}

type ArcZone = {
  arcId: string;
  name: string;
  startIndex: number;
  endIndex: number;
  grade: number; // 0-100
};

function ZoneBar({
  data,
  arcRegions,
  allScenes,
  hoverIndex,
  onHover,
  selectedIndex,
  onSelect,
  windowRange,
  width,
  height,
  dense,
}: {
  data: SceneDataPoint[];
  arcRegions: ArcRegion[];
  allScenes: Scene[];
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  windowRange: { start: number; end: number } | null;
  width: number;
  height: number;
  dense: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Compute per-arc grades — raw forces for grading, z-score swing (no double normalisation)
  const arcZones = useMemo((): ArcZone[] => {
    if (allScenes.length === 0 || arcRegions.length === 0) return [];

    const raw = computeRawForceTotals(allScenes);
    const rawForces = raw.payoff.map((_, i) => ({
      payoff: raw.payoff[i],
      change: raw.change[i],
      knowledge: raw.knowledge[i],
    }));
    const swings = computeSwingMagnitudes(rawForces, FORCE_REFERENCE_MEANS);

    return arcRegions.map((arc) => {
      const forceIndices: number[] = [];
      for (let i = arc.startIndex; i <= arc.endIndex; i++) {
        if (i < allScenes.length && allScenes[i].arcId === arc.arcId) {
          forceIndices.push(i);
        }
      }
      const arcPayoff = forceIndices.map((i) => raw.payoff[i]);
      const arcChange = forceIndices.map((i) => raw.change[i]);
      const arcKnowledge = forceIndices.map((i) => raw.knowledge[i]);
      const arcSwing = forceIndices.map((i, idx) => idx === 0 ? 0 : swings[i]);
      const { overall: grade } = gradeForces(arcPayoff, arcChange, arcKnowledge, arcSwing);

      return {
        arcId: arc.arcId,
        name: arc.name,
        startIndex: arc.startIndex,
        endIndex: arc.endIndex,
        grade,
      };
    });
  }, [allScenes, arcRegions]);

  // Map each scene index to its arc grade for hover display
  const sceneGrades = useMemo(() => {
    const grades = new Array<number>(data.length).fill(0);
    for (const zone of arcZones) {
      for (let i = zone.startIndex; i <= zone.endIndex; i++) {
        grades[i] = zone.grade;
      }
    }
    return grades;
  }, [data.length, arcZones]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (data.length === 0 || width <= 0) return;

    const m = dense ? MARGIN_DENSE : MARGIN;
    const chartWidth = width - m.left - m.right;
    const chartHeight = height - m.top - m.bottom;

    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    const xScale = d3.scaleLinear().domain([0, Math.max(data.length - 1, 1)]).range([0, chartWidth]);

    // Label
    g.append('text')
      .attr('x', 6)
      .attr('y', -m.top + 14)
      .attr('fill', 'rgba(255,255,255,0.5)')
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .attr('letter-spacing', '0.1em')
      .text('ZONES');

    // Window highlight region
    if (windowRange) {
      const wx1 = xScale(windowRange.start);
      const wx2 = xScale(windowRange.end);
      g.append('rect')
        .attr('x', wx1).attr('y', 0)
        .attr('width', Math.max(wx2 - wx1, 1))
        .attr('height', chartHeight)
        .attr('fill', 'rgba(255,255,255,0.04)');
    }

    // Render arc zone blocks — use half-step offsets so adjacent arcs meet without overlap
    const halfStep = data.length > 1 ? (chartWidth / (data.length - 1)) / 2 : 0;
    for (const zone of arcZones) {
      const x1 = Math.max(0, xScale(zone.startIndex) - halfStep);
      const x2 = Math.min(chartWidth, xScale(zone.endIndex) + halfStep);
      const w = Math.max(x2 - x1, 1);

      // Zone background: matches grade color thresholds (90/80/70/60)
      const zoneColor = zone.grade >= 90
        ? `rgba(34, 197, 94, ${0.08 + (zone.grade - 90) / 10 * 0.25})`
        : zone.grade >= 80
        ? `rgba(163, 230, 53, ${0.06 + (zone.grade - 80) / 10 * 0.12})`
        : zone.grade >= 70
        ? `rgba(250, 204, 21, ${0.05 + (zone.grade - 70) / 10 * 0.10})`
        : zone.grade >= 60
        ? `rgba(249, 115, 22, ${0.06 + (zone.grade - 60) / 10 * 0.12})`
        : `rgba(239, 68, 68, ${0.08 + (60 - zone.grade) / 60 * 0.25})`;

      g.append('rect')
        .attr('x', x1)
        .attr('y', 0)
        .attr('width', w)
        .attr('height', chartHeight)
        .attr('fill', zoneColor);

      // Grade label centered in zone (hide in dense mode)
      if (!dense && w > 24) {
        const gradeColor = zone.grade >= 90 ? '#22C55E'
          : zone.grade >= 80 ? '#a3e635'
          : zone.grade >= 70 ? '#FACC15'
          : zone.grade >= 60 ? '#F97316'
          : '#EF4444';

        g.append('text')
          .attr('x', x1 + w / 2)
          .attr('y', chartHeight / 2)
          .attr('dy', '0.35em')
          .attr('text-anchor', 'middle')
          .attr('fill', gradeColor)
          .attr('font-size', '11px')
          .attr('font-family', 'monospace')
          .attr('font-weight', '700')
          .attr('opacity', 0.8)
          .text(zone.grade);
      }
    }

    // Hover crosshair
    if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < data.length) {
      // Hover grade top-right
      const grade = sceneGrades[hoverIndex];
      const zoneLabel = grade >= 90 ? 'GREAT' : grade >= 80 ? 'GOOD' : grade >= 70 ? 'OK' : grade >= 60 ? 'WEAK' : 'DANGER';
      const zoneColor = grade >= 90 ? '#22C55E' : grade >= 80 ? '#a3e635' : grade >= 70 ? '#FACC15' : grade >= 60 ? '#F97316' : '#EF4444';
      g.append('text')
        .attr('x', chartWidth - 4)
        .attr('y', -m.top + 14)
        .attr('text-anchor', 'end')
        .attr('fill', zoneColor)
        .attr('font-size', '10px')
        .attr('font-family', 'monospace')
        .attr('font-weight', '600')
        .text(`${zoneLabel} ${grade}/100`);
    }

    // Interaction overlay
    g.append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', chartWidth).attr('height', chartHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'pointer')
      .on('mousemove', (event: MouseEvent) => {
        const [mx] = d3.pointer(event);
        const idx = Math.round(xScale.invert(mx));
        if (idx >= 0 && idx < data.length) onHover(idx);
      })
      .on('mouseleave', () => onHover(null))
      .on('click', (event: MouseEvent) => {
        const [mx] = d3.pointer(event);
        const idx = Math.round(xScale.invert(mx));
        if (idx >= 0 && idx < data.length) onSelect(idx);
      });
  }, [data, arcRegions, arcZones, sceneGrades, hoverIndex, onHover, selectedIndex, onSelect, windowRange, width, height, dense]);

  return (
    <svg ref={svgRef} width={width} height={height} className="block" />
  );
}

const DELIVERY_COLOR = '#F59E0B';
const PEAK_COLOR = '#FCD34D';
const VALLEY_COLOR = '#93C5FD';

function DeliveryChart({
  data,
  delivery,
  arcRegions,
  hoverIndex,
  onHover,
  selectedIndex,
  onSelect,
  windowRange,
  height,
  width,
  dense,
  drawing,
  drawLines,
  onDrawStart,
  onDrawMove,
  onDrawEnd,
}: {
  data: SceneDataPoint[];
  delivery: DeliveryPoint[];
  arcRegions: ArcRegion[];
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  windowRange: { start: number; end: number } | null;
  height: number;
  width: number;
  dense: boolean;
  drawing: boolean;
  drawLines: DrawLine[];
  onDrawStart: (forceKey: ForceKey, x: number, y: number) => void;
  onDrawMove: (x: number, y: number) => void;
  onDrawEnd: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = useId().replace(/:/g, '_') + '_delivery';

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (delivery.length === 0 || width <= 0) return;

    const m = dense ? MARGIN_DENSE : MARGIN;
    const chartWidth = width - m.left - m.right;
    const chartHeight = height - m.top - m.bottom;

    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    g.append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', chartWidth).attr('height', chartHeight);

    const xScale = d3.scaleLinear().domain([0, Math.max(delivery.length - 1, 1)]).range([0, chartWidth]);
    const allValues = delivery.flatMap((e) => [e.smoothed, e.macroTrend]);
    const maxAbs = Math.max(d3.max(allValues.map(Math.abs)) ?? 1, 0.5);
    // 20% headroom so peak/valley markers don't get clipped at the domain boundary
    const yScale = d3.scaleLinear().domain([-maxAbs * 1.2, maxAbs * 1.2]).range([chartHeight, 0]);

    // Window highlight
    if (windowRange) {
      const wx1 = xScale(windowRange.start);
      const wx2 = xScale(windowRange.end);
      g.append('rect')
        .attr('x', wx1).attr('y', 0)
        .attr('width', Math.max(wx2 - wx1, 1)).attr('height', chartHeight)
        .attr('fill', DELIVERY_COLOR).attr('opacity', 0.06);
      g.append('line')
        .attr('x1', wx1).attr('x2', wx1)
        .attr('y1', 0).attr('y2', chartHeight)
        .attr('stroke', DELIVERY_COLOR).attr('stroke-width', 0.5).attr('opacity', 0.3);
    }

    // Arc boundary lines + arc number labels
    const arcLabelStep = arcRegions.length > 40 ? 10 : arcRegions.length > 20 ? 5 : arcRegions.length > 10 ? 2 : 1;
    arcRegions.forEach((arc, i) => {
      const x1 = xScale(arc.startIndex);
      if (i > 0) {
        g.append('line')
          .attr('x1', x1).attr('x2', x1)
          .attr('y1', 0).attr('y2', chartHeight)
          .attr('stroke', 'rgba(255,255,255,0.06)')
          .attr('stroke-width', 1).attr('stroke-dasharray', '4,4');
      }
      if (i % arcLabelStep === 0) {
        const cx = xScale((arc.startIndex + arc.endIndex) / 2);
        g.append('text')
          .attr('x', cx)
          .attr('y', -m.top + 26)
          .attr('text-anchor', 'middle')
          .attr('fill', 'rgba(255,255,255,0.2)')
          .attr('font-size', '8px')
          .attr('font-family', 'monospace')
          .text(i + 1);
      }
    });

    // Gridlines
    const step = maxAbs <= 2 ? 0.5 : maxAbs <= 5 ? 1 : Math.ceil(maxAbs / 4);
    const gridValues = [0];
    for (let v = step; v <= maxAbs; v += step) gridValues.push(v, -v);
    gridValues.forEach((v) => {
      const y = yScale(v);
      g.append('line')
        .attr('x1', 0).attr('x2', chartWidth)
        .attr('y1', y).attr('y2', y)
        .attr('stroke', v === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)')
        .attr('stroke-width', v === 0 ? 1 : 0.5);
      if (!dense) {
        g.append('text')
          .attr('x', -8).attr('y', y).attr('dy', '0.35em')
          .attr('text-anchor', 'end')
          .attr('fill', 'rgba(255,255,255,0.25)')
          .attr('font-size', '9px').attr('font-family', 'monospace')
          .text(Number.isInteger(v) ? v.toString() : v.toFixed(1));
      }
    });

    // Window average
    const windowSlice = windowRange
      ? delivery.slice(windowRange.start, windowRange.end + 1)
      : delivery.slice(-FORCE_WINDOW_SIZE);
    const winAvg = windowSlice.length > 0
      ? windowSlice.reduce((s, e) => s + e.delivery, 0) / windowSlice.length
      : 0;

    // Label
    g.append('text')
      .attr('x', 6).attr('y', -m.top + 14)
      .attr('fill', DELIVERY_COLOR)
      .attr('font-size', '10px').attr('font-weight', '600').attr('letter-spacing', '0.1em')
      .text('DELIVERY');
    g.append('text')
      .attr('x', 6 + 5 * 8 + 6).attr('y', -m.top + 14)
      .attr('fill', DELIVERY_COLOR)
      .attr('font-size', '9px').attr('font-weight', '600').attr('font-family', 'monospace').attr('opacity', 0.7)
      .text(`w${winAvg >= 0 ? '+' : ''}${winAvg.toFixed(2)}`);

    const clipped = g.append('g').attr('clip-path', `url(#${clipId})`);

    // Positive fill (above zero)
    clipped.append('path')
      .datum(delivery)
      .attr('d', d3.area<DeliveryPoint>()
        .x((e) => xScale(e.index))
        .y0(yScale(0))
        .y1((e) => yScale(Math.max(0, e.smoothed)))
        .curve(d3.curveMonotoneX))
      .attr('fill', DELIVERY_COLOR).attr('opacity', 0.10);

    // Negative fill (below zero)
    clipped.append('path')
      .datum(delivery)
      .attr('d', d3.area<DeliveryPoint>()
        .x((e) => xScale(e.index))
        .y0(yScale(0))
        .y1((e) => yScale(Math.min(0, e.smoothed)))
        .curve(d3.curveMonotoneX))
      .attr('fill', VALLEY_COLOR).attr('opacity', 0.07);

    // Macro trend (dashed, white)
    clipped.append('path')
      .datum(delivery)
      .attr('d', d3.line<DeliveryPoint>()
        .x((e) => xScale(e.index))
        .y((e) => yScale(e.macroTrend))
        .curve(d3.curveMonotoneX))
      .attr('fill', 'none')
      .attr('stroke', 'rgba(255,255,255,0.25)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '5,4');

    // Primary delivery line (smoothed)
    clipped.append('path')
      .datum(delivery)
      .attr('d', d3.line<DeliveryPoint>()
        .x((e) => xScale(e.index))
        .y((e) => yScale(e.smoothed))
        .curve(d3.curveMonotoneX))
      .attr('fill', 'none')
      .attr('stroke', DELIVERY_COLOR)
      .attr('stroke-width', 2)
      .attr('opacity', 0.9);

    // Peak markers — upward triangles
    const triUp = d3.symbol().type(d3.symbolTriangle).size(40);
    delivery.filter((e) => e.isPeak).forEach((e) => {
      const cx = xScale(e.index);
      const cy = yScale(e.smoothed);
      clipped.append('path')
        .attr('d', triUp)
        .attr('transform', `translate(${cx},${cy - 10})`)
        .attr('fill', PEAK_COLOR)
        .attr('opacity', 0.9);
      if (!dense) {
        clipped.append('text')
          .attr('x', cx).attr('y', cy - 20)
          .attr('text-anchor', 'middle')
          .attr('fill', PEAK_COLOR)
          .attr('font-size', '8px').attr('font-family', 'monospace').attr('opacity', 0.8)
          .text(`#${e.index + 1}`);
      }
    });

    // Valley markers — downward triangles
    delivery.filter((e) => e.isValley).forEach((e) => {
      const cx = xScale(e.index);
      const cy = yScale(e.smoothed);
      clipped.append('path')
        .attr('d', triUp)
        .attr('transform', `translate(${cx},${cy + 10}) rotate(180)`)
        .attr('fill', VALLEY_COLOR)
        .attr('opacity', 0.8);
      if (!dense) {
        clipped.append('text')
          .attr('x', cx).attr('y', cy + 22)
          .attr('text-anchor', 'middle')
          .attr('fill', VALLEY_COLOR)
          .attr('font-size', '8px').attr('font-family', 'monospace').attr('opacity', 0.8)
          .text(`#${e.index + 1}`);
      }
    });

    // Hover crosshair
    if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < delivery.length) {
      const e = delivery[hoverIndex];
      const cx = xScale(e.index);
      const cy = yScale(e.smoothed);
      g.append('line')
        .attr('x1', cx).attr('x2', cx).attr('y1', 0).attr('y2', chartHeight)
        .attr('stroke', 'rgba(255,255,255,0.3)').attr('stroke-width', 1);
      g.append('line')
        .attr('x1', 0).attr('x2', chartWidth).attr('y1', cy).attr('y2', cy)
        .attr('stroke', DELIVERY_COLOR).attr('stroke-width', 0.5)
        .attr('stroke-dasharray', '3,3').attr('opacity', 0.5);
      clipped.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', 4)
        .attr('fill', DELIVERY_COLOR).attr('stroke', '#111').attr('stroke-width', 2);
      g.append('circle')
        .attr('cx', chartWidth - 46).attr('cy', -MARGIN.top + 11)
        .attr('r', 3).attr('fill', DELIVERY_COLOR);
      g.append('text')
        .attr('x', chartWidth - 4).attr('y', -m.top + 14)
        .attr('text-anchor', 'end')
        .attr('fill', DELIVERY_COLOR)
        .attr('font-size', '11px').attr('font-family', 'monospace').attr('font-weight', '600')
        .text(e.delivery.toFixed(2));
    }

    // Selected scene marker
    if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex < delivery.length && selectedIndex !== hoverIndex) {
      const e = delivery[selectedIndex];
      const sx = xScale(e.index);
      const sy = yScale(e.smoothed);
      g.append('line')
        .attr('x1', sx).attr('x2', sx).attr('y1', 0).attr('y2', chartHeight)
        .attr('stroke', 'rgba(255,255,255,0.25)').attr('stroke-width', 1).attr('stroke-dasharray', '2,2');
      clipped.append('circle')
        .attr('cx', sx).attr('cy', sy).attr('r', 4.5)
        .attr('fill', 'none').attr('stroke', DELIVERY_COLOR).attr('stroke-width', 1.5).attr('opacity', 0.7);
    }

    // Draw lines overlay
    for (const dl of drawLines) {
      if (dl.points.length < 2) continue;
      const drawPath = d3.line<[number, number]>()
        .x((d) => d[0])
        .y((d) => d[1]);
      g.append('path')
        .datum(dl.points)
        .attr('d', drawPath)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(255, 255, 255, 0.7)')
        .attr('stroke-width', 1.5)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round');
    }

    // Interaction overlay
    g.append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', chartWidth).attr('height', chartHeight)
      .attr('fill', 'transparent').style('cursor', drawing ? 'crosshair' : 'pointer')
      .on('mousemove', (event: MouseEvent) => {
        if (drawing) return;
        const [mx] = d3.pointer(event);
        const idx = Math.round(xScale.invert(mx));
        if (idx >= 0 && idx < data.length) onHover(idx);
      })
      .on('mouseleave', () => { if (!drawing) onHover(null); })
      .on('click', (event: MouseEvent) => {
        if (drawing) return;
        const [mx] = d3.pointer(event);
        const idx = Math.round(xScale.invert(mx));
        if (idx >= 0 && idx < data.length) onSelect(idx);
      })
      .on('mousedown', (event: MouseEvent) => {
        if (!drawing) return;
        event.preventDefault();
        const [mx, my] = d3.pointer(event);
        onDrawStart('delivery', mx, my);
      })
      .on('mousemove.draw', (event: MouseEvent) => {
        if (!drawing) return;
        const [mx, my] = d3.pointer(event);
        onDrawMove(mx, my);
      })
      .on('mouseup', () => {
        if (drawing) onDrawEnd();
      });
  }, [delivery, data, arcRegions, hoverIndex, onHover, selectedIndex, onSelect, windowRange, height, width, dense, drawing, drawLines, onDrawStart, onDrawMove, onDrawEnd, clipId]);

  return <svg ref={svgRef} width={width} height={height} className="block" />;
}

function ArcLabelsBar({
  arcRegions,
  dataLength,
  width,
}: {
  arcRegions: ArcRegion[];
  dataLength: number;
  width: number;
}) {
  const chartWidth = width - MARGIN.left - MARGIN.right;
  const xScale = d3.scaleLinear().domain([0, Math.max(dataLength - 1, 1)]).range([0, chartWidth]);

  return (
    <div className="relative" style={{ height: 28, marginLeft: MARGIN.left, marginRight: MARGIN.right, width: chartWidth }}>
      {arcRegions.map((arc) => {
        const x1 = xScale(arc.startIndex);
        const x2 = xScale(arc.endIndex);
        const w = Math.max(x2 - x1, 1);
        return (
          <div
            key={arc.arcId}
            className="absolute top-0 flex items-center justify-center overflow-hidden"
            style={{ left: x1, width: w, height: 28 }}
          >
            <span className="text-[9px] uppercase tracking-widest text-text-dim truncate px-1">
              {arc.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ForceAnalytics({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(() => {
    // Initialize to the current scene so the tracker opens with it selected
    if (!narrative) return null;
    const currentKey = state.resolvedEntryKeys[state.currentSceneIndex];
    if (!currentKey) return null;
    const currentEntry = resolveEntry(narrative, currentKey);
    if (!currentEntry || !isScene(currentEntry)) return null;
    // Find this scene's index in the scene-only array
    let sceneIdx = 0;
    for (let i = 0; i <= state.currentSceneIndex; i++) {
      const k = state.resolvedEntryKeys[i];
      const e = resolveEntry(narrative, k);
      if (e && isScene(e)) {
        if (i === state.currentSceneIndex) return sceneIdx;
        sceneIdx++;
      }
    }
    return null;
  });

  // View mode: individual force charts or delivery curve
  const [view, setView] = useState<'forces' | 'delivery'>('forces');

  // Raw force toggle (absolute values vs z-score normalised)
  const [showRawForce, setShowRawForce] = useState(true);

  // Sliding window: null = show all, number = window size in scenes
  const [slidingWindow, setSlidingWindow] = useState<number | null>(null);
  const WINDOW_PRESETS = [25, 50, 100, 200] as const;

  // Drawing state
  const [drawing, setDrawing] = useState(false);
  const [drawLines, setDrawLines] = useState<Record<ForceKey, DrawLine[]>>({
    payoff: [], change: [], knowledge: [], swing: [], delivery: [],
  });
  const [activeDrawKey, setActiveDrawKey] = useState<ForceKey | null>(null);
  const activeLineRef = useRef<[number, number][]>([]);

  const onDrawStart = useCallback((forceKey: ForceKey, x: number, y: number) => {
    setActiveDrawKey(forceKey);
    activeLineRef.current = [[x, y]];
  }, []);

  const onDrawMove = useCallback((x: number, y: number) => {
    if (!activeDrawKey) return;
    activeLineRef.current.push([x, y]);
    setDrawLines((prev) => {
      const existing = prev[activeDrawKey];
      // Replace the in-progress line (last entry) with the updated points
      const base = existing.length > 0 && activeLineRef.current.length > 1
        ? existing.slice(0, -1)
        : existing;
      return { ...prev, [activeDrawKey]: [...base, { points: [...activeLineRef.current] }] };
    });
  }, [activeDrawKey]);

  const onDrawEnd = useCallback(() => {
    if (!activeDrawKey || activeLineRef.current.length < 2) {
      setActiveDrawKey(null);
      return;
    }
    setDrawLines((prev) => ({
      ...prev,
      [activeDrawKey]: [...prev[activeDrawKey], { points: [...activeLineRef.current] }],
    }));
    activeLineRef.current = [];
    setActiveDrawKey(null);
  }, [activeDrawKey]);

  const clearDrawings = useCallback(() => {
    setDrawLines({ payoff: [], change: [], knowledge: [], swing: [], delivery: [] });
  }, []);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) setDims({ width, height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const allScenes = useMemo(() => {
    if (!narrative) return [];
    return state.resolvedEntryKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
  }, [narrative, state.resolvedEntryKeys]);

  const forceMap = useMemo(() => {
    if (allScenes.length === 0) return {};
    return computeForceSnapshots(allScenes);
  }, [allScenes]);

  const dataPoints = useMemo((): SceneDataPoint[] => {
    if (!narrative || allScenes.length === 0) return [];
    const points = allScenes.map((scene, i) => {
      const forces = forceMap[scene.id] ?? { payoff: 0, change: 0, knowledge: 0 };
      const corner = detectCubeCorner(forces);
      const arc = Object.values(narrative.arcs).find((a) => a.sceneIds.includes(scene.id));
      const location = narrative.locations[scene.locationId];
      return {
        index: i,
        sceneId: scene.id,
        arcId: arc?.id ?? '',
        arcName: arc?.name ?? 'Unknown',
        summary: scene.summary,
        location: location?.name ?? scene.locationId,
        participants: scene.participantIds.map((pid) => narrative.characters[pid]?.name ?? pid),
        forces,
        swing: 0,
        corner: corner.name,
        cornerKey: corner.key as CubeCornerKey,
        threadChanges: scene.threadMutations.map(
          (tm) => `${narrative.threads[tm.threadId]?.description?.slice(0, 50) ?? tm.threadId}: ${tm.from} → ${tm.to}`
        ),
      };
    });
    // Compute swing magnitudes, then z-score normalize
    const rawSwings = points.map((_, i) => {
      if (i === 0) return 0;
      const prev = points[i - 1].forces;
      const curr = points[i].forces;
      const dp = curr.payoff - prev.payoff;
      const dc = curr.change - prev.change;
      const dk = curr.knowledge - prev.knowledge;
      return Math.sqrt(dp * dp + dc * dc + dk * dk);
    });
    const normSwings = zScoreNormalize(rawSwings);
    for (let i = 0; i < points.length; i++) {
      points[i].swing = normSwings[i];
    }
    return points;
  }, [narrative, allScenes, forceMap]);

  // Raw (non-normalised) data points for absolute force view
  const rawDataPoints = useMemo((): SceneDataPoint[] => {
    if (dataPoints.length === 0 || allScenes.length === 0) return [];
    const raw = computeRawForceTotals(allScenes);
    return dataPoints.map((dp, i) => ({
      ...dp,
      forces: {
        payoff: raw.payoff[i] ?? 0,
        change: raw.change[i] ?? 0,
        knowledge: raw.knowledge[i] ?? 0,
      },
      swing: i === 0 ? 0 : (() => {
        const dP = raw.payoff[i] - raw.payoff[i - 1];
        const dC = raw.change[i] - raw.change[i - 1];
        const dV = raw.knowledge[i] - raw.knowledge[i - 1];
        return Math.sqrt(dP * dP + dC * dC + dV * dV);
      })(),
    }));
  }, [dataPoints, allScenes]);

  const allActiveDataPoints = showRawForce ? rawDataPoints : dataPoints;

  // Sliding window: slice data around selected scene (or end of timeline)
  const { activeDataPoints, slidingWindowOffset, visibleScenes } = useMemo(() => {
    if (slidingWindow === null || allActiveDataPoints.length <= slidingWindow) {
      return { activeDataPoints: allActiveDataPoints, slidingWindowOffset: 0, visibleScenes: allScenes };
    }
    // Center window on selectedIndex, or pin to end if no selection
    const anchor = selectedIndex ?? allActiveDataPoints.length - 1;
    const half = Math.floor(slidingWindow / 2);
    let start = anchor - half;
    let end = start + slidingWindow;
    // Clamp
    if (start < 0) { start = 0; end = slidingWindow; }
    if (end > allActiveDataPoints.length) { end = allActiveDataPoints.length; start = end - slidingWindow; }
    start = Math.max(0, start);
    const sliced = allActiveDataPoints.slice(start, end).map((d, i) => ({ ...d, index: i }));
    return { activeDataPoints: sliced, slidingWindowOffset: start, visibleScenes: allScenes.slice(start, end) };
  }, [allActiveDataPoints, allScenes, slidingWindow, selectedIndex]);

  // Delivery curve always computed from z-score normalised forces
  // When windowed, use the windowed slice of the normalized data
  const deliveryData = useMemo((): DeliveryPoint[] => {
    if (dataPoints.length === 0) return [];
    if (slidingWindow !== null && slidingWindow < dataPoints.length) {
      const anchor = selectedIndex ?? dataPoints.length - 1;
      const half = Math.floor(slidingWindow / 2);
      let start = anchor - half;
      let end = start + slidingWindow;
      if (start < 0) { start = 0; end = slidingWindow; }
      if (end > dataPoints.length) { end = dataPoints.length; start = end - slidingWindow; }
      start = Math.max(0, start);
      return computeDeliveryCurve(dataPoints.slice(start, end).map((d) => d.forces));
    }
    return computeDeliveryCurve(dataPoints.map((d) => d.forces));
  }, [dataPoints, slidingWindow, selectedIndex]);

  // Current cube corner + local delivery position — tracks the focused scene
  const { currentCube, localPosition } = useMemo(() => {
    if (dataPoints.length === 0) return { currentCube: null, localPosition: null };
    const focusIdx = selectedIndex ?? dataPoints.length - 1;
    const clamped = Math.max(0, Math.min(focusIdx, dataPoints.length - 1));
    const cube = detectCubeCorner(dataPoints[clamped].forces);
    // Local delivery position: use delivery data up to the focused scene
    const engUpToFocus = deliveryData.slice(0, Math.min(clamped + 1, deliveryData.length));
    const window = engUpToFocus.slice(-FORCE_WINDOW_SIZE);
    const pos = window.length > 0 ? classifyCurrentPosition(window) : null;
    return { currentCube: cube, localPosition: pos };
  }, [dataPoints, deliveryData, selectedIndex]);

  const arcRegions = useMemo((): ArcRegion[] => {
    if (activeDataPoints.length === 0) return [];
    const regions: ArcRegion[] = [];
    let current: ArcRegion | null = null;
    for (let i = 0; i < activeDataPoints.length; i++) {
      const d = activeDataPoints[i];
      if (!current || current.arcId !== d.arcId) {
        if (current) regions.push(current);
        current = { arcId: d.arcId, name: d.arcName, startIndex: i, endIndex: i };
      } else {
        current.endIndex = i;
      }
    }
    if (current) regions.push(current);
    return regions;
  }, [activeDataPoints]);

  // Visible selected index (for chart props) — computed early for windowRange
  const visibleSelIdx = selectedIndex !== null ? selectedIndex - slidingWindowOffset : null;

  // Window range for selected scene (relative to visible data)
  const windowRange = useMemo(() => {
    if (visibleSelIdx === null || activeDataPoints.length === 0) return null;
    if (visibleSelIdx < 0 || visibleSelIdx >= activeDataPoints.length) return null;
    const end = Math.min(visibleSelIdx, activeDataPoints.length - 1);
    const start = Math.max(0, end - FORCE_WINDOW_SIZE + 1);
    return { start, end };
  }, [visibleSelIdx, activeDataPoints]);

  // Select a scene: translate visible index → full index, then dispatch
  const handleSelect = useCallback((visibleIndex: number) => {
    const fullIndex = visibleIndex + slidingWindowOffset;
    setSelectedIndex(fullIndex);
    if (dataPoints.length > 0 && fullIndex < dataPoints.length) {
      const sceneId = dataPoints[fullIndex].sceneId;
      const tlIdx = state.resolvedEntryKeys.indexOf(sceneId);
      if (tlIdx >= 0) {
        dispatch({ type: 'SET_SCENE_INDEX', index: tlIdx });
      }
    }
  }, [dataPoints, slidingWindowOffset, state.resolvedEntryKeys, dispatch]);

  const stats = useMemo(() => {
    if (dataPoints.length === 0) return null;
    const cornerCounts: Record<string, number> = {};
    let transitions = 0;
    for (let i = 0; i < dataPoints.length; i++) {
      cornerCounts[dataPoints[i].corner] = (cornerCounts[dataPoints[i].corner] ?? 0) + 1;
      if (i > 0 && dataPoints[i].cornerKey !== dataPoints[i - 1].cornerKey) transitions++;
    }
    const dominantCorner = Object.entries(cornerCounts).sort((a, b) => b[1] - a[1])[0];
    return {
      totalScenes: dataPoints.length,
      totalArcs: arcRegions.length,
      transitions,
      dominantCorner: dominantCorner ? `${dominantCorner[0]} (${dominantCorner[1]})` : '—',
    };
  }, [dataPoints, arcRegions]);

  const hoveredScene = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < activeDataPoints.length
    ? activeDataPoints[hoverIndex]
    : null;

  const selectedScene = visibleSelIdx !== null && visibleSelIdx >= 0 && visibleSelIdx < activeDataPoints.length
    ? activeDataPoints[visibleSelIdx]
    : null;

  // Show hovered scene info if hovering, otherwise show selected scene info
  const infoScene = hoveredScene ?? selectedScene;

  // Chart sizing
  const headerHeight = 48;
  const hoverBarHeight = (hoveredScene || selectedScene) ? 64 : 0;
  const arcLabelHeight = 28;
  const zoneBarHeight = 48;
  const availableChartHeight = dims.height - headerHeight - hoverBarHeight - arcLabelHeight - zoneBarHeight;
  const chartHeight = Math.max(Math.floor(availableChartHeight / 4), 80);
  const deliveryChartHeight = Math.max(availableChartHeight, 120);

  const hasDrawings = Object.values(drawLines).some((lines) => lines.length > 0);

  return (
    <div className="fixed inset-0 bg-bg-base z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 border-b border-white/5 shrink-0" style={{ height: headerHeight }}>
        <div className="flex items-center gap-4">
          <h1 className="text-[13px] font-semibold text-text-primary tracking-wide">
            Force Tracker
          </h1>
          {narrative && (
            <span className="text-[11px] text-text-dim">
              {narrative.title}
            </span>
          )}
          {stats && (
            <div className="flex items-center gap-3 ml-2">
              <span className="text-[10px] text-text-dim font-mono">
                {slidingWindow !== null && allActiveDataPoints.length > slidingWindow
                  ? `${activeDataPoints.length} of ${stats.totalScenes} scenes (${slidingWindowOffset + 1}–${slidingWindowOffset + activeDataPoints.length})`
                  : `${stats.totalScenes} scenes`}
              </span>
              <span className="text-[10px] text-text-dim opacity-30">/</span>
              <span className="text-[10px] text-text-dim font-mono">{stats.totalArcs} arcs</span>
              <span className="text-[10px] text-text-dim opacity-30">/</span>
              <span className="text-[10px] text-text-dim font-mono">{stats.transitions} corner transitions</span>
            </div>
          )}
          {/* Jump to arc / scene */}
          {stats && stats.totalScenes > 0 && (
            <div className="flex items-center gap-3 ml-2 pl-3 border-l border-white/5">
              <div className="flex items-center gap-1">
                <span className="text-[9px] uppercase tracking-wider text-text-dim">Arc</span>
                <input
                  type="number"
                  min={1}
                  max={stats.totalArcs}
                  placeholder="#"
                  className="w-8 bg-transparent text-center text-[11px] font-mono text-text-primary outline-none border-b border-white/10 focus:border-white/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const n = parseInt((e.target as HTMLInputElement).value, 10);
                      if (n >= 1 && n <= arcRegions.length) {
                        const region = arcRegions[n - 1];
                        handleSelect(region.startIndex);
                        (e.target as HTMLInputElement).blur();
                      }
                    }
                  }}
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] uppercase tracking-wider text-text-dim">Scene</span>
                <input
                  type="number"
                  min={1}
                  max={stats.totalScenes}
                  placeholder="#"
                  className="w-10 bg-transparent text-center text-[11px] font-mono text-text-primary outline-none border-b border-white/10 focus:border-white/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const n = parseInt((e.target as HTMLInputElement).value, 10);
                      if (n >= 1 && n <= stats.totalScenes) {
                        // In windowed mode, the full scene index is n-1
                        setSelectedIndex(n - 1);
                        const sceneId = dataPoints[n - 1]?.sceneId;
                        if (sceneId) {
                          const tlIdx = state.resolvedEntryKeys.indexOf(sceneId);
                          if (tlIdx >= 0) dispatch({ type: 'SET_SCENE_INDEX', index: tlIdx });
                        }
                        (e.target as HTMLInputElement).blur();
                      }
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-full border border-border overflow-hidden">
            {(['forces', 'delivery'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`text-[11px] px-3 py-1.5 transition capitalize ${
                  view === v
                    ? 'bg-white/10 text-text-primary'
                    : 'bg-transparent text-text-dim hover:text-text-secondary'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          {view === 'forces' && <button
            onClick={() => setShowRawForce((v) => !v)}
            className={`text-[11px] px-3.5 py-1.5 rounded-full border transition flex items-center gap-1.5 ${
              showRawForce
                ? 'bg-white/10 border-white/20 text-text-primary'
                : 'bg-transparent border-border text-text-dim hover:text-text-secondary hover:border-white/12'
            }`}
            title="Toggle raw absolute force values (non-normalised)"
          >
            <IconLineChart size={12} />
            Raw
          </button>}
          {/* Sliding window toggle */}
          <div className="flex items-center rounded-full border border-border overflow-hidden">
            <button
              onClick={() => setSlidingWindow(null)}
              className={`text-[11px] px-2.5 py-1.5 transition ${
                slidingWindow === null
                  ? 'bg-white/10 text-text-primary'
                  : 'bg-transparent text-text-dim hover:text-text-secondary'
              }`}
            >
              All
            </button>
            {WINDOW_PRESETS.map((size) => (
              <button
                key={size}
                onClick={() => setSlidingWindow(size)}
                className={`text-[11px] px-2.5 py-1.5 transition font-mono ${
                  slidingWindow === size
                    ? 'bg-white/10 text-text-primary'
                    : 'bg-transparent text-text-dim hover:text-text-secondary'
                }`}
              >
                {size}
              </button>
            ))}
          </div>
          <button
            onClick={() => setDrawing((d) => !d)}
            className={`text-[11px] px-3.5 py-1.5 rounded-full border transition flex items-center gap-1.5 ${
              drawing
                ? 'bg-white/10 border-white/20 text-text-primary'
                : 'bg-transparent border-border text-text-dim hover:text-text-secondary hover:border-white/12'
            }`}
          >
            <IconPencilDraw size={12} />
            {drawing ? 'Drawing' : 'Draw'}
          </button>
          {hasDrawings && (
            <button
              onClick={clearDrawings}
              className="text-[11px] px-3 py-1.5 rounded-full border border-border text-text-dim hover:text-text-secondary hover:border-white/12 transition"
            >
              Clear
            </button>
          )}
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text-primary text-lg leading-none px-2 py-1 rounded hover:bg-white/5 transition-colors"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Charts */}
      <div className="flex-1 flex flex-col min-h-0" ref={containerRef}>
        {activeDataPoints.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-text-dim text-xs tracking-widest uppercase">No scene data</span>
          </div>
        ) : (
          <>
            {view === 'delivery' && (currentCube || localPosition) && (
              <div className="flex items-center gap-4 px-4 py-1.5 border-b border-border/50 shrink-0">
                {currentCube && (
                  <div className="flex items-center gap-2">
                    <svg width="30" height="14" viewBox="0 0 30 14">
                      {(['P','C','K'] as const).map((label, i) => {
                        const isHigh = currentCube.key[i] === 'H';
                        const colors = ['#EF4444','#22C55E','#3B82F6'];
                        const barH = isHigh ? 10 : 5;
                        return (
                          <rect key={label} x={i * 11} y={14 - barH} width={8} height={barH} rx={1} fill={colors[i]} opacity={0.7} />
                        );
                      })}
                    </svg>
                    <span className="text-[11px] text-text-primary font-medium">{currentCube.name}</span>
                  </div>
                )}
                {currentCube && localPosition && <span className="text-white/15 text-xs">|</span>}
                {localPosition && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] uppercase tracking-widest text-text-dim">Local</span>
                    <span className="text-[11px] font-medium" style={{ color: { peak: '#F59E0B', trough: '#3B82F6', rising: '#22C55E', falling: '#EF4444', stable: 'rgba(255,255,255,0.5)' }[localPosition.key] }}>{localPosition.name}</span>
                    <span className="text-[9px] text-text-dim">{localPosition.description}</span>
                  </div>
                )}
              </div>
            )}
            {view === 'delivery' ? (
              <DeliveryChart
                data={activeDataPoints}
                delivery={deliveryData}
                arcRegions={arcRegions}
                hoverIndex={hoverIndex}
                onHover={setHoverIndex}
                selectedIndex={visibleSelIdx}
                onSelect={handleSelect}
                windowRange={windowRange}
                height={deliveryChartHeight}
                width={dims.width}
                dense={arcRegions.length >= DENSE_ARC_THRESHOLD}
                drawing={drawing}
                drawLines={drawLines.delivery}
                onDrawStart={onDrawStart}
                onDrawMove={onDrawMove}
                onDrawEnd={onDrawEnd}
              />
            ) : (
              FORCE_CONFIG.map((cfg) => (
                <ForceChart
                  key={cfg.key}
                  data={activeDataPoints}
                  forceKey={cfg.key}
                  label={cfg.label}
                  color={cfg.color}
                  arcRegions={arcRegions}
                  hoverIndex={hoverIndex}
                  onHover={setHoverIndex}
                  selectedIndex={visibleSelIdx}
                  onSelect={handleSelect}
                  windowRange={windowRange}
                  height={chartHeight}
                  width={dims.width}
                  drawing={drawing}
                  drawLines={drawLines[cfg.key]}
                  onDrawStart={onDrawStart}
                  onDrawMove={onDrawMove}
                  onDrawEnd={onDrawEnd}
                  dense={arcRegions.length >= DENSE_ARC_THRESHOLD}
                />
              ))
            )}
            <ZoneBar
              data={activeDataPoints}
              arcRegions={arcRegions}
              allScenes={visibleScenes}
              hoverIndex={hoverIndex}
              onHover={setHoverIndex}
              selectedIndex={visibleSelIdx}
              onSelect={handleSelect}
              windowRange={windowRange}
              width={dims.width}
              height={zoneBarHeight + MARGIN.top}
              dense={arcRegions.length >= DENSE_ARC_THRESHOLD}
            />
            {arcRegions.length < DENSE_ARC_THRESHOLD && (
              <ArcLabelsBar
                arcRegions={arcRegions}
                dataLength={activeDataPoints.length}
                width={dims.width}
              />
            )}
            {/* Scene info bar */}
            {infoScene && (() => {
              const fullSceneNum = infoScene.index + slidingWindowOffset + 1;
              const arcNum = arcRegions.findIndex((r) => r.arcId === infoScene.arcId) + 1;
              return (
              <div className="px-6 py-2 border-t border-white/5 flex items-center gap-6 shrink-0">
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono text-text-primary font-semibold">Scene {fullSceneNum}</span>
                  <span className="text-white/15">|</span>
                  <span className="text-[11px] font-mono text-text-primary font-semibold">Arc {arcNum > 0 ? arcNum : '?'}</span>
                  <span className="text-[10px] text-text-dim">{infoScene.arcName}</span>
                  <span className="text-white/15">|</span>
                  <span className="text-[10px] text-text-secondary font-medium">{infoScene.corner}</span>
                  <span className="text-[10px] text-text-dim">{infoScene.location}</span>
                </div>
                <p className="text-[11px] text-text-secondary leading-snug flex-1 min-w-0">{infoScene.summary}</p>
                <div className="flex items-center gap-3 shrink-0">
                  <svg width="21" height="12" viewBox="0 0 21 12">
                    {infoScene.cornerKey.split('').map((c, i) => {
                      const isHi = c === 'H';
                      const colors = ['#EF4444', '#22C55E', '#3B82F6'];
                      return (
                        <rect key={i} x={i * 8} y={isHi ? 1 : 6} width={6} height={isHi ? 10 : 5} rx={1}
                          fill={colors[i]} opacity={isHi ? 1 : 0.4} />
                      );
                    })}
                  </svg>
                  <span className="text-[10px] font-mono" style={{ color: '#EF4444' }}>P:{infoScene.forces.payoff >= 0 ? '+' : ''}{infoScene.forces.payoff.toFixed(2)}</span>
                  <span className="text-[10px] font-mono" style={{ color: '#22C55E' }}>C:{infoScene.forces.change >= 0 ? '+' : ''}{infoScene.forces.change.toFixed(2)}</span>
                  <span className="text-[10px] font-mono" style={{ color: '#3B82F6' }}>K:{infoScene.forces.knowledge >= 0 ? '+' : ''}{infoScene.forces.knowledge.toFixed(2)}</span>
                  <span className="text-[10px] font-mono" style={{ color: '#facc15' }}>S:{infoScene.swing.toFixed(2)}</span>
                </div>
              </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
