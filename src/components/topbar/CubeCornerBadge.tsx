'use client';

import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';
import { detectCubeCorner, computeForceSnapshots } from '@/lib/narrative-utils';

export default function CubeCornerBadge() {
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

  // Cumulative forces at the current scene position
  const forces = useMemo(() => {
    if (!narrative || allScenes.length === 0) return null;
    const forceMap = computeForceSnapshots(allScenes);
    let lastForce = { payoff: 0, change: 0, knowledge: 0 };
    for (let i = 0; i <= currentSceneIndex && i < resolvedSceneKeys.length; i++) {
      const entry = resolveEntry(narrative, resolvedSceneKeys[i]);
      if (entry && isScene(entry)) {
        lastForce = forceMap[entry.id] ?? lastForce;
      }
    }
    return lastForce;
  }, [narrative, allScenes, resolvedSceneKeys, currentSceneIndex]);

  // Previous scene's forces for transition display
  const prevForces = useMemo(() => {
    if (!narrative || allScenes.length === 0 || currentSceneIndex < 1) return null;
    const forceMap = computeForceSnapshots(allScenes);
    let lastForce = { payoff: 0, change: 0, knowledge: 0 };
    for (let i = 0; i < currentSceneIndex && i < resolvedSceneKeys.length; i++) {
      const entry = resolveEntry(narrative, resolvedSceneKeys[i]);
      if (entry && isScene(entry)) {
        lastForce = forceMap[entry.id] ?? lastForce;
      }
    }
    return lastForce;
  }, [narrative, allScenes, resolvedSceneKeys, currentSceneIndex]);

  const cubeCorner = useMemo(() => {
    if (!forces) return null;
    return detectCubeCorner(forces);
  }, [forces]);

  const prevCorner = useMemo(() => {
    if (!prevForces) return null;
    return detectCubeCorner(prevForces);
  }, [prevForces]);

  if (!cubeCorner) return null;

  const hasTransition = prevCorner && prevCorner.key !== cubeCorner.key;

  const BAR_COLORS = ['#EF4444', '#22C55E', '#3B82F6'];

  function CubeBar({ cornerKey }: { cornerKey: string }) {
    return (
      <svg width="18" height="10" viewBox="0 0 18 10">
        {cornerKey.split('').map((c, i) => {
          const isHi = c === 'H';
          const barH = isHi ? 8 : 4;
          const barY = isHi ? 1 : 5;
          return (
            <rect
              key={i}
              x={i * 7}
              y={barY}
              width={5}
              height={barH}
              rx={1}
              fill={BAR_COLORS[i]}
              opacity={isHi ? 1 : 0.4}
            />
          );
        })}
      </svg>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-white/6 bg-white/3">
      <CubeBar cornerKey={cubeCorner.key} />
      <span className="text-[11px] font-semibold text-text-primary leading-tight">
        {hasTransition ? (
          <>
            <span className="text-text-dim font-normal">{prevCorner.name}</span>
            <span className="text-text-dim font-normal mx-0.5">&rarr;</span>
            {cubeCorner.name}
          </>
        ) : (
          cubeCorner.name
        )}
      </span>
    </div>
  );
}
