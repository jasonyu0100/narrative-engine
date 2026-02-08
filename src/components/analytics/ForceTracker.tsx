'use client';

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import { useStore } from '@/lib/store';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { resolveEntry, isScene, type Scene, type ForceSnapshot, type CubeCornerKey } from '@/types/narrative';
import { computeForceSnapshots, detectCubeCorner } from '@/lib/narrative-utils';
import { generateChartAnnotations, type ChartAnnotation } from '@/lib/ai';

type ForceKey = 'stakes' | 'pacing' | 'variety';

type SceneDataPoint = {
  index: number;
  sceneId: string;
  arcId: string;
  arcName: string;
  summary: string;
  location: string;
  participants: string[];
  forces: ForceSnapshot;
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

const FORCE_CONFIG: { key: ForceKey; label: string; color: string }[] = [
  { key: 'stakes', label: 'STAKES', color: '#EF4444' },
  { key: 'pacing', label: 'PACING', color: '#22C55E' },
  { key: 'variety', label: 'VARIETY', color: '#3B82F6' },
];

const MARGIN = { top: 36, right: 16, bottom: 4, left: 48 };
const MIN_ANNOTATION_GAP = 60;

/** Filter annotations to avoid pixel overlap, keeping earlier ones */
function filterOverlapping(annotations: ChartAnnotation[], data: SceneDataPoint[], forceKey: ForceKey, xScale: d3.ScaleLinear<number, number>): ChartAnnotation[] {
  const forAnnotations = annotations.filter((a) => a.force === forceKey);
  const filtered: ChartAnnotation[] = [];
  for (const a of forAnnotations) {
    if (a.sceneIndex < 0 || a.sceneIndex >= data.length) continue;
    const cx = xScale(a.sceneIndex);
    const tooClose = filtered.some((f) => Math.abs(xScale(f.sceneIndex) - cx) < MIN_ANNOTATION_GAP);
    if (!tooClose) filtered.push(a);
  }
  return filtered;
}

function ForceChart({
  data,
  forceKey,
  label,
  color,
  arcRegions,
  annotations,
  hoverIndex,
  onHover,
  height,
  width,
}: {
  data: SceneDataPoint[];
  forceKey: ForceKey;
  label: string;
  color: string;
  arcRegions: ArcRegion[];
  annotations: ChartAnnotation[];
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
  height: number;
  width: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (data.length === 0 || width <= 0) return;

    const chartWidth = width - MARGIN.left - MARGIN.right;
    const chartHeight = height - MARGIN.top - MARGIN.bottom;

    const g = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

    const xScale = d3.scaleLinear().domain([0, Math.max(data.length - 1, 1)]).range([0, chartWidth]);
    const yScale = d3.scaleLinear().domain([-1, 1]).range([chartHeight, 0]);

    // Arc boundary lines (no background fills)
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

    // Gridlines
    [-1, -0.5, 0, 0.5, 1].forEach((v) => {
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
        .text(v.toFixed(1));
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

    const values = data.map((d) => d.forces[forceKey]);

    // Area fill
    const area = d3.area<number>()
      .x((_, i) => xScale(i))
      .y0(yScale(0))
      .y1((d) => yScale(d))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(values)
      .attr('d', area)
      .attr('fill', color)
      .attr('opacity', 0.08);

    // Line
    const line = d3.line<number>()
      .x((_, i) => xScale(i))
      .y((d) => yScale(d))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(values)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('opacity', 0.9);

    // LLM annotations
    const filtered = filterOverlapping(annotations, data, forceKey, xScale);
    for (const ann of filtered) {
      const idx = ann.sceneIndex;
      const val = values[idx];
      if (val === undefined) continue;

      const cx = xScale(idx);
      const cy = yScale(val);
      const isPeak = val >= 0;

      // Dot
      g.append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', 3)
        .attr('fill', color)
        .attr('stroke', '#111')
        .attr('stroke-width', 1.5);

      // Connector
      const connectorLen = 16;
      const endY = isPeak ? cy - connectorLen : cy + connectorLen;
      g.append('line')
        .attr('x1', cx).attr('x2', cx)
        .attr('y1', cy + (isPeak ? -4 : 4))
        .attr('y2', endY)
        .attr('stroke', 'rgba(255,255,255,0.2)')
        .attr('stroke-width', 0.5);

      // Label
      const labelText = ann.label.length > 30 ? ann.label.slice(0, 28) + '...' : ann.label;
      g.append('text')
        .attr('x', cx)
        .attr('y', isPeak ? endY - 3 : endY + 10)
        .attr('text-anchor', 'middle')
        .attr('fill', 'rgba(255,255,255,0.55)')
        .attr('font-size', '8px')
        .attr('font-family', 'system-ui, sans-serif')
        .text(labelText);
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

      g.append('circle')
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

    // Hover overlay
    g.append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', chartWidth).attr('height', chartHeight)
      .attr('fill', 'transparent')
      .on('mousemove', (event: MouseEvent) => {
        const [mx] = d3.pointer(event);
        const idx = Math.round(xScale.invert(mx));
        if (idx >= 0 && idx < data.length) onHover(idx);
      })
      .on('mouseleave', () => onHover(null));
  }, [data, forceKey, label, color, arcRegions, annotations, hoverIndex, onHover, height, width]);

  return (
    <svg ref={svgRef} width={width} height={height} className="block" style={{ overflow: 'visible' }} />
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
  const access = useFeatureAccess();
  const narrative = state.activeNarrative;
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [annotations, setAnnotations] = useState<ChartAnnotation[]>([]);
  const [annotating, setAnnotating] = useState(false);
  const [annotateError, setAnnotateError] = useState<string | null>(null);

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
    return allScenes.map((scene, i) => {
      const forces = forceMap[scene.id] ?? { stakes: 0, pacing: 0, variety: 0 };
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
        corner: corner.name,
        cornerKey: corner.key as CubeCornerKey,
        threadChanges: scene.threadMutations.map(
          (tm) => `${narrative.threads[tm.threadId]?.description?.slice(0, 50) ?? tm.threadId}: ${tm.from} → ${tm.to}`
        ),
      };
    });
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

  // LLM annotation generation
  const runAnnotate = useCallback(async () => {
    if (!narrative || dataPoints.length === 0) return;
    if (access.userApiKeys && !access.hasOpenRouterKey) {
      window.dispatchEvent(new Event('open-api-keys'));
      return;
    }
    setAnnotating(true);
    setAnnotateError(null);
    try {
      const result = await generateChartAnnotations(
        narrative,
        dataPoints.map((d) => ({
          sceneIndex: d.index,
          sceneId: d.sceneId,
          arcName: d.arcName,
          forces: d.forces,
          corner: d.corner,
          summary: d.summary,
          threadChanges: d.threadChanges,
          location: d.location,
          participants: d.participants,
        })),
      );
      setAnnotations(result);
    } catch (e) {
      setAnnotateError(e instanceof Error ? e.message : 'Annotation failed');
    } finally {
      setAnnotating(false);
    }
  }, [narrative, dataPoints, access]);

  // Chart sizing
  const headerHeight = 48;
  const hoverBarHeight = hoveredScene ? 64 : 0;
  const arcLabelHeight = 28;
  const availableChartHeight = dims.height - headerHeight - hoverBarHeight - arcLabelHeight;
  const chartHeight = Math.max(Math.floor(availableChartHeight / 3), 100);

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
          {annotateError && (
            <span className="text-[10px] text-stakes mr-2">{annotateError}</span>
          )}
          <button
            onClick={runAnnotate}
            disabled={annotating || dataPoints.length === 0}
            className={`text-[11px] px-3.5 py-1.5 rounded-full border transition disabled:opacity-40 flex items-center gap-1.5 ${
              annotations.length > 0
                ? 'bg-white/10 border-white/20 text-text-primary'
                : 'bg-transparent border-border text-text-dim hover:text-text-secondary hover:border-white/12'
            }`}
          >
            {annotating ? (
              <>
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                  <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Annotating...
              </>
            ) : annotations.length > 0 ? (
              <>Re-annotate ({annotations.length})</>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                Annotate
              </>
            )}
          </button>
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
                annotations={annotations}
                hoverIndex={hoverIndex}
                onHover={setHoverIndex}
                height={chartHeight}
                width={dims.width}
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
                  <span className="text-[10px] font-mono" style={{ color: '#EF4444' }}>S:{hoveredScene.forces.stakes >= 0 ? '+' : ''}{hoveredScene.forces.stakes.toFixed(2)}</span>
                  <span className="text-[10px] font-mono" style={{ color: '#22C55E' }}>P:{hoveredScene.forces.pacing >= 0 ? '+' : ''}{hoveredScene.forces.pacing.toFixed(2)}</span>
                  <span className="text-[10px] font-mono" style={{ color: '#3B82F6' }}>V:{hoveredScene.forces.variety >= 0 ? '+' : ''}{hoveredScene.forces.variety.toFixed(2)}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
