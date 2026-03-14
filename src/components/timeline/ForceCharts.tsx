'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';
import { computeForceSnapshots, computeWindowedForces, computeRawForcetotals, movingAverage, zScoreNormalize, FORCE_WINDOW_SIZE, computeEngagementCurve, classifyCurrentPosition, detectCubeCorner } from '@/lib/narrative-utils';
import ForceLineChart, { type ChartStyle } from './ForceLineChart';
import { FORCE_CHARTS_WINDOW_DEFAULT } from '@/lib/constants';

const FORCE_CONFIG = [
  { key: 'payoff' as const, label: 'Payoff', color: 'var(--color-payoff)' },
  { key: 'change' as const, label: 'Change', color: 'var(--color-change)' },
  { key: 'knowledge' as const, label: 'Knowledge', color: 'var(--color-knowledge)' },
] as const;

/** Compute swing magnitude: √(ΔP² + ΔC² + ΔV²) between consecutive force snapshots */
function computeSwings(payoff: number[], change: number[], knowledge: number[]): number[] {
  const swings: number[] = [0];
  for (let i = 1; i < payoff.length; i++) {
    const dp = payoff[i] - payoff[i - 1];
    const dc = change[i] - change[i - 1];
    const dv = knowledge[i] - knowledge[i - 1];
    swings.push(Math.sqrt(dp * dp + dc * dc + dv * dv));
  }
  return swings;
}

type Scope = 'global' | 'local';

export default function ForceCharts() {
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const resolvedSceneKeys = state.resolvedSceneKeys;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scope, setScope] = useState<Scope>('global');
  const [showRaw, setShowRaw] = useState(true);

  // Global view window: cap how many scenes are rendered in the chart at once
  const [globalWindow, setGlobalWindow] = useState<number | null>(FORCE_CHARTS_WINDOW_DEFAULT);
  const [chartStyle, setChartStyle] = useState<ChartStyle>({
    showArea: true,
    showWindow: true,
    showMovingAvg: true,
    curve: 'smooth',
  });
  const popRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [settingsOpen]);

  // All scenes in timeline order
  const allScenes = useMemo(() => {
    if (!narrative) return [];
    return resolvedSceneKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
  }, [narrative, resolvedSceneKeys]);

  // Map current timeline index → scene-array index
  const currentSceneIdx = useMemo(() => {
    if (allScenes.length === 0 || !narrative) return -1;
    return Math.min(
      allScenes.length - 1,
      resolvedSceneKeys.slice(0, state.currentSceneIndex + 1)
        .filter((k) => resolveEntry(narrative, k)?.kind === 'scene').length - 1,
    );
  }, [allScenes, state.currentSceneIndex, resolvedSceneKeys, narrative]);

  // Windowed forces
  const windowed = useMemo(() => {
    if (currentSceneIdx < 0) return null;
    return computeWindowedForces(allScenes, currentSceneIdx);
  }, [allScenes, currentSceneIdx]);

  // Full-history forces (normalized)
  const globalForceData = useMemo(() => {
    if (!narrative) return { payoff: [] as number[], change: [] as number[], knowledge: [] as number[], swing: [] as number[] };
    const payoff: number[] = [];
    const change: number[] = [];
    const knowledge: number[] = [];
    const forceMap = computeForceSnapshots(allScenes);
    let lastForce = { payoff: 0, change: 0, knowledge: 0 };
    for (const k of resolvedSceneKeys) {
      const entry = resolveEntry(narrative, k);
      if (entry && isScene(entry)) {
        lastForce = forceMap[entry.id] ?? lastForce;
      }
      payoff.push(lastForce.payoff);
      change.push(lastForce.change);
      knowledge.push(lastForce.knowledge);
    }
    return { payoff, change, knowledge, swing: zScoreNormalize(computeSwings(payoff, change, knowledge)) };
  }, [narrative, allScenes, resolvedSceneKeys]);

  // Full-history forces (raw)
  const globalRawForceData = useMemo(() => {
    if (!narrative) return { payoff: [] as number[], change: [] as number[], knowledge: [] as number[], swing: [] as number[] };
    const raw = computeRawForcetotals(allScenes);
    const rawMap: Record<string, { payoff: number; change: number; knowledge: number }> = {};
    allScenes.forEach((s, i) => { rawMap[s.id] = { payoff: raw.payoff[i], change: raw.change[i], knowledge: raw.knowledge[i] }; });
    const payoff: number[] = [];
    const change: number[] = [];
    const knowledge: number[] = [];
    let lastForce = { payoff: 0, change: 0, knowledge: 0 };
    for (const k of resolvedSceneKeys) {
      const entry = resolveEntry(narrative, k);
      if (entry && isScene(entry)) {
        lastForce = rawMap[entry.id] ?? lastForce;
      }
      payoff.push(lastForce.payoff);
      change.push(lastForce.change);
      knowledge.push(lastForce.knowledge);
    }
    return { payoff, change, knowledge, swing: computeSwings(payoff, change, knowledge) };
  }, [narrative, allScenes, resolvedSceneKeys]);

  // Window-only forces for local scope (normalized)
  const localForceData = useMemo(() => {
    if (!windowed || !narrative) return { payoff: [] as number[], change: [] as number[], knowledge: [] as number[], swing: [] as number[] };
    const payoff: number[] = [];
    const change: number[] = [];
    const knowledge: number[] = [];
    const windowScenes = allScenes.slice(windowed.windowStart, windowed.windowEnd + 1);
    let lastForce = { payoff: 0, change: 0, knowledge: 0 };
    for (const s of windowScenes) {
      lastForce = windowed.forceMap[s.id] ?? lastForce;
      payoff.push(lastForce.payoff);
      change.push(lastForce.change);
      knowledge.push(lastForce.knowledge);
    }
    return { payoff, change, knowledge, swing: zScoreNormalize(computeSwings(payoff, change, knowledge)) };
  }, [windowed, allScenes, narrative]);

  // Window-only forces for local scope (raw)
  const localRawForceData = useMemo(() => {
    if (!windowed || !narrative) return { payoff: [] as number[], change: [] as number[], knowledge: [] as number[], swing: [] as number[] };
    const windowScenes = allScenes.slice(windowed.windowStart, windowed.windowEnd + 1);
    const raw = computeRawForcetotals(windowScenes);
    const rawMap: Record<string, { payoff: number; change: number; knowledge: number }> = {};
    windowScenes.forEach((s, i) => { rawMap[s.id] = { payoff: raw.payoff[i], change: raw.change[i], knowledge: raw.knowledge[i] }; });
    const payoff: number[] = [];
    const change: number[] = [];
    const knowledge: number[] = [];
    let lastForce = { payoff: 0, change: 0, knowledge: 0 };
    for (const s of windowScenes) {
      lastForce = rawMap[s.id] ?? lastForce;
      payoff.push(lastForce.payoff);
      change.push(lastForce.change);
      knowledge.push(lastForce.knowledge);
    }
    return { payoff, change, knowledge, swing: computeSwings(payoff, change, knowledge) };
  }, [windowed, allScenes, narrative]);

  // Map window scene-indices back to timeline indices for chart highlight
  const windowTimelineRange = useMemo(() => {
    if (!windowed || !narrative) return undefined;
    const windowStartId = allScenes[windowed.windowStart]?.id;
    const windowEndId = allScenes[windowed.windowEnd]?.id;
    let tlStart = 0;
    let tlEnd = resolvedSceneKeys.length - 1;
    for (let i = 0; i < resolvedSceneKeys.length; i++) {
      if (resolvedSceneKeys[i] === windowStartId) { tlStart = i; break; }
    }
    for (let i = resolvedSceneKeys.length - 1; i >= 0; i--) {
      if (resolvedSceneKeys[i] === windowEndId) { tlEnd = i; break; }
    }
    return { start: tlStart, end: tlEnd };
  }, [windowed, allScenes, resolvedSceneKeys, narrative]);

  const isLocal = scope === 'local';
  const fullChartData = isLocal
    ? (showRaw ? localRawForceData : localForceData)
    : (showRaw ? globalRawForceData : globalForceData);

  // Apply global window: slice around currentSceneIndex when in global scope
  const { chartData, globalWindowOffset } = useMemo(() => {
    if (isLocal || globalWindow === null || fullChartData.payoff.length <= globalWindow) {
      return { chartData: fullChartData, globalWindowOffset: 0 };
    }
    const anchor = state.currentSceneIndex;
    const half = Math.floor(globalWindow / 2);
    let start = anchor - half;
    let end = start + globalWindow;
    if (start < 0) { start = 0; end = globalWindow; }
    if (end > fullChartData.payoff.length) { end = fullChartData.payoff.length; start = end - globalWindow; }
    start = Math.max(0, start);
    return {
      chartData: {
        payoff: fullChartData.payoff.slice(start, end),
        change: fullChartData.change.slice(start, end),
        knowledge: fullChartData.knowledge.slice(start, end),
        swing: fullChartData.swing.slice(start, end),
      },
      globalWindowOffset: start,
    };
  }, [isLocal, globalWindow, fullChartData, state.currentSceneIndex]);

  // Moving averages for each force + swing
  const chartMA = useMemo(() => ({
    payoff: movingAverage(chartData.payoff, FORCE_WINDOW_SIZE),
    change: movingAverage(chartData.change, FORCE_WINDOW_SIZE),
    knowledge: movingAverage(chartData.knowledge, FORCE_WINDOW_SIZE),
    swing: movingAverage(chartData.swing, FORCE_WINDOW_SIZE),
  }), [chartData]);

  // Window averages — average z-score within the current normalization window
  const chartAvg = useMemo(() => {
    const avg = (arr: number[]) => arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
    if (isLocal) {
      return {
        payoff: avg(chartData.payoff),
        change: avg(chartData.change),
        knowledge: avg(chartData.knowledge),
        swing: avg(chartData.swing),
      };
    }
    // In global mode, translate windowTimelineRange into visible-data coords
    const ws = Math.max(0, (windowTimelineRange?.start ?? 0) - globalWindowOffset);
    const we = Math.min(chartData.payoff.length, ((windowTimelineRange?.end ?? chartData.payoff.length - 1) + 1) - globalWindowOffset);
    return {
      payoff: avg(chartData.payoff.slice(ws, we)),
      change: avg(chartData.change.slice(ws, we)),
      knowledge: avg(chartData.knowledge.slice(ws, we)),
      swing: avg(chartData.swing.slice(ws, we)),
    };
  }, [chartData, isLocal, windowTimelineRange, globalWindowOffset]);

  const chartCurrentIndex = isLocal
    ? (localForceData.payoff.length - 1)
    : state.currentSceneIndex - globalWindowOffset;

  // Local position + recent engagement sparkline from the trailing window
  const { currentPosition, recentSparkline } = useMemo(() => {
    if (allScenes.length === 0) return { currentPosition: null, recentSparkline: [] };
    const scenes = windowed
      ? allScenes.slice(windowed.windowStart, windowed.windowEnd + 1)
      : allScenes;
    const snapshotMap = computeForceSnapshots(scenes);
    const ordered = scenes.map((s) => snapshotMap[s.id]).filter(Boolean);
    const pts = computeEngagementCurve(ordered);
    const position = ordered.length > 0 ? classifyCurrentPosition(pts) : null;
    // Last ~12 smoothed values for the mini sparkline
    const spark = pts.slice(-12).map((p) => p.smoothed);
    return { currentPosition: position, recentSparkline: spark };
  }, [windowed, allScenes]);

  // Cube corner at current scene (normalized forces)
  const cubeCorner = useMemo(() => {
    const idx = Math.min(state.currentSceneIndex, globalForceData.payoff.length - 1);
    if (idx < 0 || globalForceData.payoff.length === 0) return null;
    return detectCubeCorner({
      payoff: globalForceData.payoff[idx],
      change: globalForceData.change[idx],
      knowledge: globalForceData.knowledge[idx],
    });
  }, [globalForceData, state.currentSceneIndex]);

  if (!narrative) {
    return (
      <div className="flex items-center justify-center h-25 shrink-0 glass-panel border-t border-border">
        <span className="text-text-dim text-xs tracking-widest uppercase">
          No force data
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-25 shrink-0 glass-panel border-t border-border">
      {/* Left: shape + cube panel */}
      <div className="flex flex-col justify-center border-r border-border shrink-0 w-36">
        {/* Position row */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50">
          {currentPosition && recentSparkline.length > 1 ? (
            <>
              <svg width="36" height="18" viewBox="0 0 36 18" className="shrink-0">
                {(() => {
                  const n = recentSparkline.length;
                  const min = Math.min(...recentSparkline);
                  const max = Math.max(...recentSparkline);
                  const range = max - min || 1;
                  const pts = recentSparkline.map((v, i) =>
                    `${(i / (n - 1)) * 36},${18 - ((v - min) / range) * 18}`
                  ).join(' ');
                  return <polyline points={pts} fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />;
                })()}
              </svg>
              <div className="flex flex-col min-w-0">
                <span className="text-[8px] uppercase tracking-widest text-text-dim">Local</span>
                <span className="text-[11px] font-medium text-text-primary truncate">{currentPosition.name}</span>
              </div>
            </>
          ) : (
            <span className="text-[9px] text-text-dim">—</span>
          )}
        </div>
        {/* Cube row */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          {cubeCorner ? (
            <>
              <svg width="36" height="18" viewBox="0 0 36 18" className="shrink-0">
                {(['P','C','V'] as const).map((label, i) => {
                  const isHigh = cubeCorner.key[i] === 'H';
                  const colors = ['#EF4444', '#22C55E', '#3B82F6'];
                  const barH = isHigh ? 14 : 6;
                  const x = i * 13;
                  return (
                    <g key={label}>
                      <rect x={x} y={18 - barH} width={10} height={barH} rx={1.5} fill={colors[i]} opacity={0.7} />
                      <text x={x + 5} y={17} textAnchor="middle" fontSize="4.5" fill="rgba(255,255,255,0.45)" fontFamily="monospace">{label}</text>
                    </g>
                  );
                })}
              </svg>
              <div className="flex flex-col min-w-0">
                <span className="text-[8px] uppercase tracking-widest text-text-dim">Cube</span>
                <span className="text-[11px] font-medium text-text-primary truncate">{cubeCorner.name}</span>
              </div>
            </>
          ) : (
            <span className="text-[9px] text-text-dim">—</span>
          )}
        </div>
      </div>

      {/* Force line charts */}
      {FORCE_CONFIG.map((cfg) => (
        <div
          key={cfg.key}
          className="flex-1 min-w-0 border-r border-border"
        >
          <ForceLineChart
            data={chartData[cfg.key]}
            color={cfg.color}
            label={cfg.label}
            currentIndex={chartCurrentIndex}
            windowStart={!isLocal ? (windowTimelineRange ? windowTimelineRange.start - globalWindowOffset : undefined) : undefined}
            windowEnd={!isLocal ? (windowTimelineRange ? windowTimelineRange.end - globalWindowOffset : undefined) : undefined}
            positive={showRaw}
            raw={showRaw}
            style={chartStyle}
            movingAvg={chartMA[cfg.key]}
            average={chartAvg[cfg.key]}
          />
        </div>
      ))}

      {/* Swing magnitude chart */}
      <div className="flex-1 min-w-0 border-r border-border">
        <ForceLineChart
          data={chartData.swing}
          color="#facc15"
          label="Swing"
          currentIndex={chartCurrentIndex}
          windowStart={!isLocal ? (windowTimelineRange ? windowTimelineRange.start - globalWindowOffset : undefined) : undefined}
          windowEnd={!isLocal ? (windowTimelineRange ? windowTimelineRange.end - globalWindowOffset : undefined) : undefined}
          positive={showRaw}
          raw={showRaw}
          style={chartStyle}
          movingAvg={chartMA.swing}
          average={chartAvg.swing}
        />
      </div>

      {/* Right: Settings gear */}
      <div className="relative flex items-center justify-center px-2 border-l border-border shrink-0 w-9" ref={popRef}>
        <button
          type="button"
          onClick={() => setSettingsOpen((o) => !o)}
          className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
            settingsOpen ? 'text-text-primary bg-white/8' : 'text-text-dim hover:text-text-primary hover:bg-white/6'
          }`}
          title="Force graph settings"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {settingsOpen && (
          <div
            className="absolute bottom-full right-0 mb-2 w-48 rounded-lg border border-white/10 py-2 px-2.5 z-50"
            style={{ background: '#1a1a1a', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
          >
            <span className="text-[9px] uppercase tracking-widest text-text-dim block mb-2">
              Graph Settings
            </span>

            {/* Scope toggle */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-text-secondary">Scope</span>
              <div className="flex rounded-md overflow-hidden border border-white/10">
                {(['global', 'local'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    className={`px-2 py-0.5 text-[10px] capitalize transition-colors ${
                      scope === s
                        ? 'bg-white/12 text-text-primary'
                        : 'text-text-dim hover:text-text-secondary'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Global window size */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-text-secondary">Window</span>
              <div className="flex rounded-md overflow-hidden border border-white/10">
                {([50, 100, 200, null] as const).map((w) => (
                  <button
                    key={w ?? 'all'}
                    type="button"
                    onClick={() => setGlobalWindow(w)}
                    className={`px-2 py-0.5 text-[10px] font-mono transition-colors ${
                      globalWindow === w
                        ? 'bg-white/12 text-text-primary'
                        : 'text-text-dim hover:text-text-secondary'
                    }`}
                  >
                    {w ?? 'All'}
                  </button>
                ))}
              </div>
            </div>

            {/* Curve style */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-text-secondary">Curve</span>
              <div className="flex rounded-md overflow-hidden border border-white/10">
                {(['smooth', 'linear', 'step'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setChartStyle((prev) => ({ ...prev, curve: c }))}
                    className={`px-2 py-0.5 text-[10px] capitalize transition-colors ${
                      chartStyle.curve === c
                        ? 'bg-white/12 text-text-primary'
                        : 'text-text-dim hover:text-text-secondary'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Show area fill */}
            <label className="flex items-center justify-between mb-1.5 cursor-pointer">
              <span className="text-[11px] text-text-secondary">Area fill</span>
              <button
                type="button"
                role="switch"
                aria-checked={chartStyle.showArea}
                onClick={() => setChartStyle((prev) => ({ ...prev, showArea: !prev.showArea }))}
                className={`w-7 h-4 rounded-full transition-colors relative ${
                  chartStyle.showArea ? 'bg-white/25' : 'bg-white/8'
                }`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                  chartStyle.showArea ? 'left-3.5' : 'left-0.5'
                }`} />
              </button>
            </label>

            {/* Show window highlight */}
            <label className="flex items-center justify-between mb-1.5 cursor-pointer">
              <span className="text-[11px] text-text-secondary">Window highlight</span>
              <button
                type="button"
                role="switch"
                aria-checked={chartStyle.showWindow}
                onClick={() => setChartStyle((prev) => ({ ...prev, showWindow: !prev.showWindow }))}
                className={`w-7 h-4 rounded-full transition-colors relative ${
                  chartStyle.showWindow ? 'bg-white/25' : 'bg-white/8'
                }`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                  chartStyle.showWindow ? 'left-3.5' : 'left-0.5'
                }`} />
              </button>
            </label>

            {/* Show moving average */}
            <label className="flex items-center justify-between mb-1.5 cursor-pointer">
              <span className="text-[11px] text-text-secondary">Moving average</span>
              <button
                type="button"
                role="switch"
                aria-checked={chartStyle.showMovingAvg}
                onClick={() => setChartStyle((prev) => ({ ...prev, showMovingAvg: !prev.showMovingAvg }))}
                className={`w-7 h-4 rounded-full transition-colors relative ${
                  chartStyle.showMovingAvg ? 'bg-white/25' : 'bg-white/8'
                }`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                  chartStyle.showMovingAvg ? 'left-3.5' : 'left-0.5'
                }`} />
              </button>
            </label>

            {/* Raw scores */}
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-[11px] text-text-secondary">Raw scores</span>
              <button
                type="button"
                role="switch"
                aria-checked={showRaw}
                onClick={() => setShowRaw((v) => !v)}
                className={`w-7 h-4 rounded-full transition-colors relative ${
                  showRaw ? 'bg-white/25' : 'bg-white/8'
                }`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                  showRaw ? 'left-3.5' : 'left-0.5'
                }`} />
              </button>
            </label>
          </div>
        )}
      </div>

    </div>
  );
}
