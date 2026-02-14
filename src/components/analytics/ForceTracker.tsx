'use client';

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene, type Scene, type ForceSnapshot, type CubeCornerKey } from '@/types/narrative';
import { computeForceSnapshots, computeWindowedForces, computeRawForcetotals, computeBalanceMagnitudes, detectCubeCorner, FORCE_WINDOW_SIZE } from '@/lib/narrative-utils';

type ForceKey = 'payoff' | 'change' | 'variety' | 'balance';

type SceneDataPoint = {
  index: number;
  sceneId: string;
  arcId: string;
  arcName: string;
  summary: string;
  location: string;
  participants: string[];
  forces: ForceSnapshot;
  balance: number;
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

const FORCE_CONFIG: { key: ForceKey; label: string; color: string }[] = [
  { key: 'payoff', label: 'PAYOFF', color: '#EF4444' },
  { key: 'change', label: 'CHANGE', color: '#22C55E' },
  { key: 'variety', label: 'VARIETY', color: '#3B82F6' },
  { key: 'balance', label: 'SWING', color: '#facc15' },
];

const MARGIN = { top: 36, right: 16, bottom: 4, left: 48 };
const MARGIN_DENSE = { top: 36, right: 16, bottom: 4, left: 16 };
/** Arc count threshold above which we hide axis labels for readability */
const DENSE_ARC_THRESHOLD = 15;

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
  forceKey: ForceKey;
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
      .attr('id', `clip-${forceKey}`)
      .append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', chartWidth).attr('height', chartHeight);

    const xScale = d3.scaleLinear().domain([0, Math.max(data.length - 1, 1)]).range([0, chartWidth]);

    // Dynamic symmetric y-domain based on data
    const values = data.map((d) => forceKey === 'balance' ? d.balance : d.forces[forceKey]);
    const isBalance = forceKey === 'balance';
    const maxAbs = Math.max(d3.max(values.map(Math.abs)) ?? 1, 1);
    const yScale = d3.scaleLinear()
      .domain(isBalance ? [0, maxAbs * 1.1] : [-maxAbs, maxAbs])
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

    // Arc boundary lines
    arcRegions.forEach((arc, i) => {
      if (i > 0) {
        const x1 = xScale(arc.startIndex);
        g.append('line')
          .attr('x1', x1).attr('x2', x1)
          .attr('y1', 0).attr('y2', chartHeight)
          .attr('stroke', 'rgba(255,255,255,0.06)')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '4,4');
      }
    });

    // Gridlines — dynamic based on maxAbs
    const gridValues = [0];
    const step = maxAbs <= 2 ? 0.5 : maxAbs <= 5 ? 1 : Math.ceil(maxAbs / 4);
    for (let v = step; v <= maxAbs; v += step) {
      gridValues.push(v, -v);
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

    // Force label
    const labelText = g.append('text')
      .attr('x', 6)
      .attr('y', -m.top + 14)
      .attr('fill', color)
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .attr('letter-spacing', '0.1em')
      .text(label);

    // Window average + full average after label
    const fullAvg = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    const windowSlice = values.slice(-FORCE_WINDOW_SIZE);
    const winAvg = windowSlice.length > 0 ? windowSlice.reduce((s, v) => s + v, 0) / windowSlice.length : 0;
    const labelWidth = (labelText.node() as SVGTextElement)?.getComputedTextLength?.() ?? 40;

    // Window avg (brighter)
    g.append('text')
      .attr('x', 6 + labelWidth + 6)
      .attr('y', -m.top + 14)
      .attr('fill', color)
      .attr('font-size', '9px')
      .attr('font-weight', '600')
      .attr('font-family', 'monospace')
      .attr('opacity', 0.7)
      .text(`w${winAvg >= 0 && !isBalance ? '+' : ''}${winAvg.toFixed(2)}`);

    // Full avg (dimmer)
    g.append('text')
      .attr('x', 6 + labelWidth + 58)
      .attr('y', -m.top + 14)
      .attr('fill', color)
      .attr('font-size', '9px')
      .attr('font-weight', '500')
      .attr('font-family', 'monospace')
      .attr('opacity', 0.35)
      .text(`(${fullAvg >= 0 && !isBalance ? '+' : ''}${fullAvg.toFixed(2)})`);

    // Clipped chart group
    const clipped = g.append('g').attr('clip-path', `url(#clip-${forceKey})`);

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
  }, [data, forceKey, label, color, arcRegions, hoverIndex, onHover, selectedIndex, onSelect, windowRange, height, width, drawing, drawLines, onDrawStart, onDrawMove, onDrawEnd, dense]);

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

/** Grade a force average 0-25 using exponential saturation (mirrors scorecard) */
function gradeForce(avg: number, midpoint: number): number {
  return Math.min(25, 25 * (1 - Math.exp(-Math.max(0, avg) / midpoint)));
}

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

  // Compute per-arc grades using raw forces + scorecard grading
  const arcZones = useMemo((): ArcZone[] => {
    if (allScenes.length === 0 || arcRegions.length === 0) return [];

    const raw = computeRawForcetotals(allScenes);
    // Use raw forces for balance so absolute magnitudes differentiate quality
    const rawForces = raw.payoff.map((_, i) => ({
      payoff: raw.payoff[i],
      change: raw.change[i],
      variety: raw.variety[i],
    }));
    const balances = computeBalanceMagnitudes(rawForces);

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
    const topAvg = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => b - a);
      const k = Math.max(1, Math.ceil(sorted.length * 0.1));
      return avg(sorted.slice(0, k));
    };

    return arcRegions.map((arc) => {
      const arcPayoff = raw.payoff.slice(arc.startIndex, arc.endIndex + 1);
      const arcChange = raw.change.slice(arc.startIndex, arc.endIndex + 1);
      const arcVariety = raw.variety.slice(arc.startIndex, arc.endIndex + 1);
      const arcBalance = balances.slice(arc.startIndex, arc.endIndex + 1);

      const arcBalanceEffective = avg(arcBalance) * 0.5 + topAvg(arcBalance) * 0.5;
      const grade = Math.round(
        gradeForce(avg(arcPayoff), 3) +
        gradeForce(avg(arcChange), 4) +
        gradeForce(avg(arcVariety), 3) +
        gradeForce(arcBalanceEffective, 8)
      );

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

      // Color: green for good (>=50), red for danger (<50), intensity by distance from 50
      const zoneColor = zone.grade >= 50
        ? `rgba(34, 197, 94, ${0.08 + (zone.grade - 50) / 50 * 0.30})`
        : `rgba(239, 68, 68, ${0.08 + (50 - zone.grade) / 50 * 0.30})`;

      g.append('rect')
        .attr('x', x1)
        .attr('y', 0)
        .attr('width', w)
        .attr('height', chartHeight)
        .attr('fill', zoneColor);

      // Grade label centered in zone (hide in dense mode)
      if (!dense && w > 24) {
        const gradeColor = zone.grade >= 75 ? '#22C55E'
          : zone.grade >= 50 ? '#a3e635'
          : zone.grade >= 25 ? '#F97316'
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
      const zoneLabel = grade >= 75 ? 'GOOD' : grade >= 50 ? 'OK' : grade >= 25 ? 'WEAK' : 'DANGER';
      const zoneColor = grade >= 75 ? '#22C55E' : grade >= 50 ? '#a3e635' : grade >= 25 ? '#F97316' : '#EF4444';
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

export function ForceTracker({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Raw force toggle (absolute values vs z-score normalised)
  const [showRawForce, setShowRawForce] = useState(false);

  // Drawing state
  const [drawing, setDrawing] = useState(false);
  const [drawLines, setDrawLines] = useState<Record<ForceKey, DrawLine[]>>({
    payoff: [], change: [], variety: [], balance: [],
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
    setDrawLines({ payoff: [], change: [], variety: [], balance: [] });
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
    return state.resolvedSceneKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
  }, [narrative, state.resolvedSceneKeys]);

  const forceMap = useMemo(() => {
    if (allScenes.length === 0) return {};
    return computeForceSnapshots(allScenes);
  }, [allScenes]);

  const dataPoints = useMemo((): SceneDataPoint[] => {
    if (!narrative || allScenes.length === 0) return [];
    const points = allScenes.map((scene, i) => {
      const forces = forceMap[scene.id] ?? { payoff: 0, change: 0, variety: 0 };
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
        balance: 0,
        corner: corner.name,
        cornerKey: corner.key as CubeCornerKey,
        threadChanges: scene.threadMutations.map(
          (tm) => `${narrative.threads[tm.threadId]?.description?.slice(0, 50) ?? tm.threadId}: ${tm.from} → ${tm.to}`
        ),
      };
    });
    // Compute balance magnitudes
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1].forces;
      const curr = points[i].forces;
      const dp = curr.payoff - prev.payoff;
      const dc = curr.change - prev.change;
      const dv = curr.variety - prev.variety;
      points[i].balance = Math.sqrt(dp * dp + dc * dc + dv * dv);
    }
    return points;
  }, [narrative, allScenes, forceMap]);

  // Raw (non-normalised) data points for absolute force view
  const rawDataPoints = useMemo((): SceneDataPoint[] => {
    if (dataPoints.length === 0 || allScenes.length === 0) return [];
    const raw = computeRawForcetotals(allScenes);
    return dataPoints.map((dp, i) => ({
      ...dp,
      forces: {
        payoff: raw.payoff[i] ?? 0,
        change: raw.change[i] ?? 0,
        variety: raw.variety[i] ?? 0,
      },
      balance: i === 0 ? 0 : (() => {
        const dP = raw.payoff[i] - raw.payoff[i - 1];
        const dC = raw.change[i] - raw.change[i - 1];
        const dV = raw.variety[i] - raw.variety[i - 1];
        return Math.sqrt(dP * dP + dC * dC + dV * dV);
      })(),
    }));
  }, [dataPoints, allScenes]);

  const activeDataPoints = showRawForce ? rawDataPoints : dataPoints;

  const arcRegions = useMemo((): ArcRegion[] => {
    if (dataPoints.length === 0) return [];
    const regions: ArcRegion[] = [];
    let current: ArcRegion | null = null;
    for (let i = 0; i < dataPoints.length; i++) {
      const d = dataPoints[i];
      if (!current || current.arcId !== d.arcId) {
        if (current) regions.push(current);
        current = { arcId: d.arcId, name: d.arcName, startIndex: i, endIndex: i };
      } else {
        current.endIndex = i;
      }
    }
    if (current) regions.push(current);
    return regions;
  }, [dataPoints]);

  // Window range for selected scene
  const windowRange = useMemo(() => {
    if (selectedIndex === null || allScenes.length === 0) return null;
    const end = Math.min(selectedIndex, allScenes.length - 1);
    const start = Math.max(0, end - FORCE_WINDOW_SIZE + 1);
    return { start, end };
  }, [selectedIndex, allScenes]);

  // Select a scene: update local selection + dispatch to timeline
  const handleSelect = useCallback((index: number) => {
    setSelectedIndex(index);
    // Map scene-array index to resolvedSceneKeys index
    if (dataPoints.length > 0 && index < dataPoints.length) {
      const sceneId = dataPoints[index].sceneId;
      const tlIdx = state.resolvedSceneKeys.indexOf(sceneId);
      if (tlIdx >= 0) {
        dispatch({ type: 'SET_SCENE_INDEX', index: tlIdx });
      }
    }
  }, [dataPoints, state.resolvedSceneKeys, dispatch]);

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

  const selectedScene = selectedIndex !== null && selectedIndex >= 0 && selectedIndex < activeDataPoints.length
    ? activeDataPoints[selectedIndex]
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
              <span className="text-[10px] text-text-dim font-mono">{stats.totalScenes} scenes</span>
              <span className="text-[10px] text-text-dim opacity-30">/</span>
              <span className="text-[10px] text-text-dim font-mono">{stats.totalArcs} arcs</span>
              <span className="text-[10px] text-text-dim opacity-30">/</span>
              <span className="text-[10px] text-text-dim font-mono">{stats.transitions} corner transitions</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRawForce((v) => !v)}
            className={`text-[11px] px-3.5 py-1.5 rounded-full border transition flex items-center gap-1.5 ${
              showRawForce
                ? 'bg-white/10 border-white/20 text-text-primary'
                : 'bg-transparent border-border text-text-dim hover:text-text-secondary hover:border-white/12'
            }`}
            title="Toggle raw absolute force values (non-normalised)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="M7 16l4-8 4 4 4-10" />
            </svg>
            Raw
          </button>
          <button
            onClick={() => setDrawing((d) => !d)}
            className={`text-[11px] px-3.5 py-1.5 rounded-full border transition flex items-center gap-1.5 ${
              drawing
                ? 'bg-white/10 border-white/20 text-text-primary'
                : 'bg-transparent border-border text-text-dim hover:text-text-secondary hover:border-white/12'
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
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
            {FORCE_CONFIG.map((cfg) => (
              <ForceChart
                key={cfg.key}
                data={activeDataPoints}
                forceKey={cfg.key}
                label={cfg.label}
                color={cfg.color}
                arcRegions={arcRegions}
                hoverIndex={hoverIndex}
                onHover={setHoverIndex}
                selectedIndex={selectedIndex}
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
            ))}
            <ZoneBar
              data={activeDataPoints}
              arcRegions={arcRegions}
              allScenes={allScenes}
              hoverIndex={hoverIndex}
              onHover={setHoverIndex}
              selectedIndex={selectedIndex}
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
            {infoScene && (
              <div className="px-6 py-2 border-t border-white/5 flex items-center gap-6 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-text-dim">#{infoScene.index + 1}</span>
                  <span className="text-[10px] text-text-dim uppercase tracking-wider">{infoScene.arcName}</span>
                  <span className="text-[10px] text-text-secondary font-medium">{infoScene.corner}</span>
                  <span className="text-[10px] text-text-dim">{infoScene.location}</span>
                </div>
                <p className="text-[11px] text-text-secondary leading-snug flex-1 min-w-0">{infoScene.summary}</p>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[10px] font-mono" style={{ color: '#EF4444' }}>P:{infoScene.forces.payoff >= 0 ? '+' : ''}{infoScene.forces.payoff.toFixed(2)}</span>
                  <span className="text-[10px] font-mono" style={{ color: '#22C55E' }}>C:{infoScene.forces.change >= 0 ? '+' : ''}{infoScene.forces.change.toFixed(2)}</span>
                  <span className="text-[10px] font-mono" style={{ color: '#3B82F6' }}>V:{infoScene.forces.variety >= 0 ? '+' : ''}{infoScene.forces.variety.toFixed(2)}</span>
                  <span className="text-[10px] font-mono" style={{ color: '#facc15' }}>B:{infoScene.balance.toFixed(2)}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
