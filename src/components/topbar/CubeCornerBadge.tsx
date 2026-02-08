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
    let lastForce = { payoff: 0, change: 0, variety: 0 };
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
    let lastForce = { payoff: 0, change: 0, variety: 0 };
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

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-white/6 bg-white/3">
      <span className="text-[9px] uppercase tracking-widest text-text-dim">
        {cubeCorner.key.split('').map((c: string, i: number) => {
          const labels = ['P', 'C', 'V'];
          return `${labels[i]}:${c === 'H' ? 'Hi' : 'Lo'}`;
        }).join(' ')}
      </span>
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
