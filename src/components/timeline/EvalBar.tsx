'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';
import { computeForceSnapshots, computeDeliveryCurve } from '@/lib/narrative-utils';

/**
 * Floating vertical evaluation bar for narrative Delivery.
 * White fill from bottom encodes delivery magnitude.
 * Spring animation on scene change.
 */
export default function EvalBar() {
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const resolvedSceneKeys = state.resolvedSceneKeys;
  const currentSceneIndex = state.currentSceneIndex;

  const allScenes = useMemo(() => {
    if (!narrative) return [];
    return resolvedSceneKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
  }, [narrative, resolvedSceneKeys]);

  const deliveryCurve = useMemo(() => {
    if (allScenes.length === 0) return [];
    const snapshots = Object.values(computeForceSnapshots(allScenes));
    return computeDeliveryCurve(snapshots);
  }, [allScenes]);

  const currentDelivery = useMemo(() => {
    if (!narrative || allScenes.length === 0 || deliveryCurve.length === 0) return null;
    const sceneIdx = Math.min(
      allScenes.length - 1,
      resolvedSceneKeys.slice(0, currentSceneIndex + 1)
        .filter((k) => resolveEntry(narrative, k)?.kind === 'scene').length - 1,
    );
    if (sceneIdx < 0 || sceneIdx >= deliveryCurve.length) return null;
    return deliveryCurve[sceneIdx];
  }, [narrative, allScenes, deliveryCurve, currentSceneIndex, resolvedSceneKeys]);

  // Sigmoid: delivery z-score → 0..100%
  const targetPct = useMemo(() => {
    if (!currentDelivery) return 50;
    const d = currentDelivery.smoothed;
    return 100 / (1 + Math.exp(-d * 1.2));
  }, [currentDelivery]);

  // Spring animation
  const [displayPct, setDisplayPct] = useState(targetPct);
  const [calibrating, setCalibrating] = useState(false);
  const prevTarget = useRef(targetPct);
  const animFrame = useRef<number>(0);

  useEffect(() => {
    if (prevTarget.current === targetPct) return;
    const from = prevTarget.current;
    const to = targetPct;
    const delta = to - from;
    prevTarget.current = to;

    setCalibrating(true);
    const start = performance.now();
    const duration = 600;

    const spring = (t: number) => {
      const decay = Math.exp(-5 * t);
      return 1 - decay * Math.cos(8 * t);
    };

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      setDisplayPct(from + delta * spring(t));
      if (t < 1) {
        animFrame.current = requestAnimationFrame(tick);
      } else {
        setDisplayPct(to);
        setCalibrating(false);
      }
    };

    cancelAnimationFrame(animFrame.current);
    animFrame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrame.current);
  }, [targetPct]);

  const displayValue = currentDelivery
    ? (currentDelivery.smoothed >= 0 ? '+' : '') + currentDelivery.smoothed.toFixed(1)
    : '—';

  const tag = currentDelivery?.isPeak ? 'PEAK' : currentDelivery?.isValley ? 'VALLEY' : null;

  return (
    <div className="absolute left-6 top-1/2 -translate-y-1/2 z-20 select-none"
      style={{ height: '60%' }}
      title={`Delivery: ${displayValue}${tag ? ` · ${tag}` : ''}`}
    >
      {/* Bar track */}
      <div className="w-4 h-full rounded-full overflow-hidden shadow-lg">
        <div className="relative w-full h-full bg-neutral-900/80 backdrop-blur-sm">
          {/* White fill from bottom */}
          <div
            className="absolute inset-x-0 bottom-0 bg-white"
            style={{ height: `${displayPct}%` }}
          />
          {/* Shimmer during calibration */}
          {calibrating && (
            <div
              className="absolute inset-x-0 h-4 animate-pulse"
              style={{
                bottom: `calc(${displayPct}% - 8px)`,
                background: 'linear-gradient(to top, transparent, rgba(255,255,255,0.4), transparent)',
              }}
            />
          )}
          {/* Center tick (zero line) */}
          <div className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
        </div>
      </div>

      {/* Label — to the right of the bar at fill edge */}
      <div
        className="absolute left-full pointer-events-none"
        style={{ bottom: `${displayPct}%`, transform: 'translateY(50%)' }}
      >
        <span className={`ml-1.5 text-[10px] font-mono font-semibold whitespace-nowrap drop-shadow-md ${calibrating ? 'text-white/40' : 'text-white/80'}`}>
          {displayValue}
        </span>
        {tag && (
          <span className="ml-1 text-[9px] font-bold text-white/60 drop-shadow-md">
            {tag}
          </span>
        )}
      </div>
    </div>
  );
}
