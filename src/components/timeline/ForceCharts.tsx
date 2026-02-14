'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';
import { computeForceSnapshots, computeWindowedForces, movingAverage, FORCE_WINDOW_SIZE } from '@/lib/narrative-utils';
import ForceLineChart, { type ChartStyle } from './ForceLineChart';

const FORCE_CONFIG = [
  { key: 'payoff' as const, label: 'Payoff', color: 'var(--color-payoff)' },
  { key: 'change' as const, label: 'Change', color: 'var(--color-change)' },
  { key: 'variety' as const, label: 'Variety', color: 'var(--color-variety)' },
] as const;

/** Compute balance magnitude: √(ΔP² + ΔC² + ΔV²) between consecutive force snapshots */
function computeBalances(payoff: number[], change: number[], variety: number[]): number[] {
  const balances: number[] = [0];
  for (let i = 1; i < payoff.length; i++) {
    const dp = payoff[i] - payoff[i - 1];
    const dc = change[i] - change[i - 1];
    const dv = variety[i] - variety[i - 1];
    balances.push(Math.sqrt(dp * dp + dc * dc + dv * dv));
  }
  return balances;
}

type Scope = 'global' | 'local';

export default function ForceCharts() {
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const resolvedSceneKeys = state.resolvedSceneKeys;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scope, setScope] = useState<Scope>('global');
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

  // Full-history forces
  const globalForceData = useMemo(() => {
    if (!narrative) return { payoff: [] as number[], change: [] as number[], variety: [] as number[], balance: [] as number[] };
    const payoff: number[] = [];
    const change: number[] = [];
    const variety: number[] = [];
    const forceMap = computeForceSnapshots(allScenes);
    let lastForce = { payoff: 0, change: 0, variety: 0 };
    for (const k of resolvedSceneKeys) {
      const entry = resolveEntry(narrative, k);
      if (entry && isScene(entry)) {
        lastForce = forceMap[entry.id] ?? lastForce;
      }
      payoff.push(lastForce.payoff);
      change.push(lastForce.change);
      variety.push(lastForce.variety);
    }
    return { payoff, change, variety, balance: computeBalances(payoff, change, variety) };
  }, [narrative, allScenes, resolvedSceneKeys]);

  // Window-only forces for local scope
  const localForceData = useMemo(() => {
    if (!windowed || !narrative) return { payoff: [] as number[], change: [] as number[], variety: [] as number[], balance: [] as number[] };
    const payoff: number[] = [];
    const change: number[] = [];
    const variety: number[] = [];
    const windowScenes = allScenes.slice(windowed.windowStart, windowed.windowEnd + 1);
    let lastForce = { payoff: 0, change: 0, variety: 0 };
    for (const s of windowScenes) {
      lastForce = windowed.forceMap[s.id] ?? lastForce;
      payoff.push(lastForce.payoff);
      change.push(lastForce.change);
      variety.push(lastForce.variety);
    }
    return { payoff, change, variety, balance: computeBalances(payoff, change, variety) };
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
  const chartData = isLocal ? localForceData : globalForceData;

  // Moving averages for each force + balance
  const chartMA = useMemo(() => ({
    payoff: movingAverage(chartData.payoff, FORCE_WINDOW_SIZE),
    change: movingAverage(chartData.change, FORCE_WINDOW_SIZE),
    variety: movingAverage(chartData.variety, FORCE_WINDOW_SIZE),
    balance: movingAverage(chartData.balance, FORCE_WINDOW_SIZE),
  }), [chartData]);

  // Window averages — average z-score within the current normalization window
  const chartAvg = useMemo(() => {
    const avg = (arr: number[]) => arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
    if (isLocal) {
      // In local mode, chartData is already the window
      return {
        payoff: avg(chartData.payoff),
        change: avg(chartData.change),
        variety: avg(chartData.variety),
        balance: avg(chartData.balance),
      };
    }
    // In global mode, slice the window range from global data
    const ws = windowTimelineRange?.start ?? 0;
    const we = (windowTimelineRange?.end ?? chartData.payoff.length - 1) + 1;
    return {
      payoff: avg(chartData.payoff.slice(ws, we)),
      change: avg(chartData.change.slice(ws, we)),
      variety: avg(chartData.variety.slice(ws, we)),
      balance: avg(chartData.balance.slice(ws, we)),
    };
  }, [chartData, isLocal, windowTimelineRange]);

  const chartCurrentIndex = isLocal
    ? (localForceData.payoff.length - 1)
    : state.currentSceneIndex;

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
      {/* Settings gear */}
      <div className="relative flex items-center px-1.5 border-r border-border shrink-0" ref={popRef}>
        <button
          type="button"
          onClick={() => setSettingsOpen((o) => !o)}
          className={`w-6 h-6 flex items-center justify-center rounded-md transition-colors ${
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
            className="absolute bottom-full left-0 mb-2 w-48 rounded-lg border border-white/10 py-2 px-2.5 z-50"
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
            <label className="flex items-center justify-between cursor-pointer">
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
          </div>
        )}
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
            windowStart={!isLocal ? windowTimelineRange?.start : undefined}
            windowEnd={!isLocal ? windowTimelineRange?.end : undefined}
            style={chartStyle}
            movingAvg={chartMA[cfg.key]}
            average={chartAvg[cfg.key]}
          />
        </div>
      ))}

      {/* Balance magnitude chart */}
      <div className="flex-1 min-w-0">
        <ForceLineChart
          data={chartData.balance}
          color="#facc15"
          label="Swing"
          currentIndex={chartCurrentIndex}
          windowStart={!isLocal ? windowTimelineRange?.start : undefined}
          windowEnd={!isLocal ? windowTimelineRange?.end : undefined}
          positive
          style={chartStyle}
          movingAvg={chartMA.balance}
          average={chartAvg.balance}
        />
      </div>
    </div>
  );
}
