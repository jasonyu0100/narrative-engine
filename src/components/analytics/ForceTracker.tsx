'use client';

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene, type Scene, type ForceSnapshot, type CubeCornerKey } from '@/types/narrative';
import { computeForceSnapshots, detectCubeCorner, movingAverage, FORCE_WINDOW_SIZE } from '@/lib/narrative-utils';

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
  { key: 'balance', label: 'BALANCE', color: '#facc15' },
];

const MARGIN = { top: 36, right: 16, bottom: 4, left: 48 };

function ForceChart({
  data,
  forceKey,
  label,
  color,
  arcRegions,
  hoverIndex,
  onHover,
  height,
  width,
  drawing,
  drawLines,
  onDrawStart,
  onDrawMove,
  onDrawEnd,
  showMovingAvg,
}: {
  data: SceneDataPoint[];
  forceKey: ForceKey;
  label: string;
  color: string;
  arcRegions: ArcRegion[];
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
  height: number;
  width: number;
  drawing: boolean;
  drawLines: DrawLine[];
  onDrawStart: (forceKey: ForceKey, x: number, y: number) => void;
  onDrawMove: (x: number, y: number) => void;
  onDrawEnd: () => void;
  showMovingAvg: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (data.length === 0 || width <= 0) return;

    const chartWidth = width - MARGIN.left - MARGIN.right;
    const chartHeight = height - MARGIN.top - MARGIN.bottom;

    const g = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

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

      g.append('text')
        .attr('x', -8)
        .attr('y', y)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', 'rgba(255,255,255,0.25)')
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .text(Number.isInteger(v) ? v.toString() : v.toFixed(1));
    });

    // Force label
    g.append('text')
      .attr('x', 6)
      .attr('y', -MARGIN.top + 14)
      .attr('fill', color)
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .attr('letter-spacing', '0.1em')
      .text(label);

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

    // Moving average overlay
    if (showMovingAvg) {
      const maValues = movingAverage(values, FORCE_WINDOW_SIZE);
      const maLine = d3.line<number>()
        .x((_, i) => xScale(i))
        .y((d) => yScale(d))
        .curve(d3.curveMonotoneX);

      clipped.append('path')
        .datum(maValues)
        .attr('d', maLine)
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

      g.append('text')
        .attr('x', chartWidth - 4)
        .attr('y', -MARGIN.top + 14)
        .attr('text-anchor', 'end')
        .attr('fill', color)
        .attr('font-size', '11px')
        .attr('font-family', 'monospace')
        .attr('font-weight', '600')
        .text(values[hoverIndex].toFixed(2));
    }

    // Interaction overlay
    g.append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', chartWidth).attr('height', chartHeight)
      .attr('fill', 'transparent')
      .style('cursor', drawing ? 'crosshair' : 'default')
      .on('mousemove', (event: MouseEvent) => {
        if (drawing) return;
        const [mx] = d3.pointer(event);
        const idx = Math.round(xScale.invert(mx));
        if (idx >= 0 && idx < data.length) onHover(idx);
      })
      .on('mouseleave', () => { if (!drawing) onHover(null); })
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
  }, [data, forceKey, label, color, arcRegions, hoverIndex, onHover, height, width, drawing, drawLines, onDrawStart, onDrawMove, onDrawEnd, showMovingAvg]);

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
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Moving average toggle
  const [showMovingAvg, setShowMovingAvg] = useState(true);

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

  const hoveredScene = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < dataPoints.length
    ? dataPoints[hoverIndex]
    : null;

  // Chart sizing
  const headerHeight = 48;
  const hoverBarHeight = hoveredScene ? 64 : 0;
  const arcLabelHeight = 28;
  const availableChartHeight = dims.height - headerHeight - hoverBarHeight - arcLabelHeight;
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
            onClick={() => setShowMovingAvg((v) => !v)}
            className={`text-[11px] px-3.5 py-1.5 rounded-full border transition flex items-center gap-1.5 ${
              showMovingAvg
                ? 'bg-white/10 border-white/20 text-text-primary'
                : 'bg-transparent border-border text-text-dim hover:text-text-secondary hover:border-white/12'
            }`}
            title="Toggle moving average overlay"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            MA
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
        {dataPoints.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-text-dim text-xs tracking-widest uppercase">No scene data</span>
          </div>
        ) : (
          <>
            {FORCE_CONFIG.map((cfg) => (
              <ForceChart
                key={cfg.key}
                data={dataPoints}
                forceKey={cfg.key}
                label={cfg.label}
                color={cfg.color}
                arcRegions={arcRegions}
                hoverIndex={hoverIndex}
                onHover={setHoverIndex}
                height={chartHeight}
                width={dims.width}
                drawing={drawing}
                drawLines={drawLines[cfg.key]}
                onDrawStart={onDrawStart}
                onDrawMove={onDrawMove}
                onDrawEnd={onDrawEnd}
                showMovingAvg={showMovingAvg}
              />
            ))}
            <ArcLabelsBar
              arcRegions={arcRegions}
              dataLength={dataPoints.length}
              width={dims.width}
            />
            {/* Hover info bar */}
            {hoveredScene && (
              <div className="px-6 py-2 border-t border-white/5 flex items-center gap-6 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-text-dim">#{hoveredScene.index + 1}</span>
                  <span className="text-[10px] text-text-dim uppercase tracking-wider">{hoveredScene.arcName}</span>
                  <span className="text-[10px] text-text-secondary font-medium">{hoveredScene.corner}</span>
                  <span className="text-[10px] text-text-dim">{hoveredScene.location}</span>
                </div>
                <p className="text-[11px] text-text-secondary leading-snug flex-1 min-w-0">{hoveredScene.summary}</p>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[10px] font-mono" style={{ color: '#EF4444' }}>P:{hoveredScene.forces.payoff >= 0 ? '+' : ''}{hoveredScene.forces.payoff.toFixed(2)}</span>
                  <span className="text-[10px] font-mono" style={{ color: '#22C55E' }}>C:{hoveredScene.forces.change >= 0 ? '+' : ''}{hoveredScene.forces.change.toFixed(2)}</span>
                  <span className="text-[10px] font-mono" style={{ color: '#3B82F6' }}>V:{hoveredScene.forces.variety >= 0 ? '+' : ''}{hoveredScene.forces.variety.toFixed(2)}</span>
                  <span className="text-[10px] font-mono" style={{ color: '#facc15' }}>B:{hoveredScene.balance.toFixed(2)}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
