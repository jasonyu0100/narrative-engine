'use client';

import { useRef, useEffect, useMemo, useCallback } from 'react';
import { useStore } from '@/lib/store';
import type { Arc, Scene } from '@/types/narrative';
import { resolveEntry, isScene } from '@/types/narrative';
import { computeRawForceTotals, computeSwingMagnitudes, gradeForces, FORCE_REFERENCE_MEANS } from '@/lib/narrative-utils';
import { IconChevronDown, IconFork } from '@/components/icons';

const NODE_RADIUS = 8;
const NODE_SPACING = 50;
const PADDING_LEFT = 32;
const PADDING_TOP = 28;
const BAND_Y = 4;
const BAND_HEIGHT = 56;

const ARC_TINTS = [
  'rgba(255,255,255,0.03)',
  'rgba(255,255,255,0.05)',
  'rgba(255,255,255,0.04)',
  'rgba(255,255,255,0.06)',
  'rgba(255,255,255,0.035)',
];

export default function TimelineStrip() {
  const { state, dispatch } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const narrative = state.activeNarrative;

  const sceneKeys = state.resolvedEntryKeys;

  const scenes = useMemo(
    () => (narrative ? sceneKeys.map((k) => resolveEntry(narrative, k)).filter((e): e is NonNullable<typeof e> => e != null) : []),
    [narrative, sceneKeys],
  );

  // Group scenes by arc
  const arcBands = useMemo(() => {
    if (!narrative) return [];
    const bands: {
      arc: Arc;
      startIdx: number;
      endIdx: number;
      tintIdx: number;
    }[] = [];
    const arcList = Object.values(narrative.arcs);
    // Only use scene positions for arc bands — skip world builds between scenes
    const sceneOnlyIndices = new Set(sceneKeys.map((k, i) => narrative.scenes[k] ? i : -1).filter(i => i >= 0));
    arcList.forEach((arc, ai) => {
      const indices = arc.sceneIds
        .map((sid) => sceneKeys.indexOf(sid))
        .filter((i) => i >= 0 && sceneOnlyIndices.has(i))
        .sort((a, b) => a - b);
      if (indices.length > 0) {
        bands.push({
          arc,
          startIdx: indices[0],
          endIdx: indices[indices.length - 1],
          tintIdx: ai % ARC_TINTS.length,
        });
      }
    });
    return bands;
  }, [narrative, sceneKeys]);

  const allScenes = useMemo(() => {
    if (!narrative) return [];
    return sceneKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
  }, [narrative, sceneKeys]);

  const arcGrades = useMemo(() => {
    if (allScenes.length === 0 || arcBands.length === 0) return new Map<string, number>();

    const raw = computeRawForceTotals(allScenes);
    // Swing from mean-normalised raw forces (preserves cross-series differences)
    const rawForces = raw.drive.map((_, i) => ({
      drive: raw.drive[i],
      world: raw.world[i],
      system: raw.system[i],
    }));
    const swings = computeSwingMagnitudes(rawForces, FORCE_REFERENCE_MEANS);

    const sceneIdToForceIdx = new Map(allScenes.map((s, i) => [s.id, i]));

    const grades = new Map<string, number>();
    for (const band of arcBands) {
      const forceIndices = band.arc.sceneIds
        .map((sid) => sceneIdToForceIdx.get(sid))
        .filter((i): i is number => i !== undefined);
      if (forceIndices.length === 0) continue;
      const arcDrives = forceIndices.map((i) => raw.drive[i]);
      const arcWorlds = forceIndices.map((i) => raw.world[i]);
      const arcSystem = forceIndices.map((i) => raw.system[i]);
      const arcSwingVals = forceIndices.map((i, idx) => idx === 0 ? 0 : swings[i]);
      const { overall } = gradeForces(arcDrives, arcWorlds, arcSystem, arcSwingVals);
      grades.set(band.arc.id, overall);
    }
    return grades;
  }, [allScenes, arcBands]);

  const svgWidth = PADDING_LEFT + sceneKeys.length * NODE_SPACING + 24;

  const xOf = useCallback(
    (i: number) => PADDING_LEFT + i * NODE_SPACING,
    [],
  );

  // Auto-scroll selected node into view
  useEffect(() => {
    if (!scrollRef.current || sceneKeys.length === 0) return;
    const x = xOf(state.currentSceneIndex);
    const container = scrollRef.current;
    const left = x - container.clientWidth / 2;
    container.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [state.currentSceneIndex, sceneKeys.length, xOf]);

  const branchList = useMemo(
    () => (narrative ? Object.values(narrative.branches) : []),
    [narrative],
  );
  const activeBranch = narrative && state.activeBranchId
    ? narrative.branches[state.activeBranchId]
    : null;

  // Find fork point index in resolved keys for visual indicator
  const forkPointIdx = useMemo(() => {
    if (!activeBranch?.forkEntryId) return -1;
    return sceneKeys.indexOf(activeBranch.forkEntryId);
  }, [activeBranch, sceneKeys]);

  if (!narrative) {
    return (
      <div className="flex items-center justify-center h-18 shrink-0 glass-panel border-t border-border">
        <span className="text-text-dim text-xs tracking-widest uppercase">
          No narrative loaded
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-18 shrink-0 glass-panel border-t border-border flex">
      {/* Branch selector */}
      {branchList.length > 1 && (
        <div className="flex items-center px-2 border-r border-border shrink-0 w-36">
          <select
            value={state.activeBranchId ?? ''}
            onChange={(e) => dispatch({ type: 'SWITCH_BRANCH', branchId: e.target.value })}
            className="bg-transparent text-[10px] text-text-secondary uppercase tracking-wider cursor-pointer outline-none appearance-none pr-3 w-full truncate"
            style={{ backgroundImage: 'none' }}
          >
            {branchList.map((b) => (
              <option key={b.id} value={b.id} className="bg-bg-panel text-text-primary">
                {b.name}
              </option>
            ))}
          </select>
          <IconChevronDown size={8} className="-ml-2 pointer-events-none text-text-dim" />
        </div>
      )}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-hidden"
      >
      <svg
        width={svgWidth}
        height={72}
        className="block"
        style={{ minWidth: svgWidth }}
      >
        {/* Arc background bands */}
        {arcBands.map((band, bandIdx) => {
          const x1 = xOf(band.startIdx) - NODE_RADIUS - 8;
          const x2 = xOf(band.endIdx) + NODE_RADIUS + 8;
          return (
            <g
              key={`${band.arc.id}-${bandIdx}`}
              className="cursor-pointer"
              onClick={() =>
                dispatch({
                  type: 'SET_INSPECTOR',
                  context: { type: 'arc', arcId: band.arc.id },
                })
              }
            >
              {(() => {
                const grade = arcGrades.get(band.arc.id) ?? 0;
                const zoneFill = grade >= 90
                  ? `rgba(34, 197, 94, ${0.08 + (grade - 90) / 10 * 0.25})`
                  : grade >= 80
                  ? `rgba(163, 230, 53, ${0.06 + (grade - 80) / 10 * 0.12})`
                  : grade >= 70
                  ? `rgba(250, 204, 21, ${0.05 + (grade - 70) / 10 * 0.10})`
                  : grade >= 60
                  ? `rgba(249, 115, 22, ${0.06 + (grade - 60) / 10 * 0.12})`
                  : `rgba(239, 68, 68, ${0.08 + (60 - grade) / 60 * 0.25})`;
                const gradeColor = grade >= 90 ? '#22C55E'
                  : grade >= 80 ? '#a3e635'
                  : grade >= 70 ? '#FACC15'
                  : grade >= 60 ? '#F97316'
                  : '#EF4444';
                const bandWidth = x2 - x1;
                const clipId = `arc-clip-${band.arc.id}`;
                return (
                  <>
                    <clipPath id={clipId}>
                      <rect x={x1} y={BAND_Y} width={bandWidth} height={BAND_HEIGHT} />
                    </clipPath>
                    <rect
                      x={x1}
                      y={BAND_Y}
                      width={bandWidth}
                      height={BAND_HEIGHT}
                      rx={4}
                      fill={zoneFill}
                      className="transition-all hover:brightness-150"
                    />
                    <text
                      x={x1 + 4}
                      y={BAND_Y + 10}
                      className="fill-text-dim"
                      fontSize={9}
                      textAnchor="start"
                      clipPath={`url(#${clipId})`}
                      style={{
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                      }}
                    >
                      {band.arc.name}
                    </text>
                    <text
                      x={x2 - 4}
                      y={BAND_Y + 10}
                      textAnchor="end"
                      fill={gradeColor}
                      fontSize={9}
                      fontFamily="monospace"
                      fontWeight={600}
                      opacity={0.7}
                    >
                      {grade}
                    </text>
                  </>
                );
              })()}
            </g>
          );
        })}

        {/* Fork point indicator */}
        {forkPointIdx >= 0 && (
          <g>
            <line
              x1={xOf(forkPointIdx)}
              y1={PADDING_TOP + 8 - NODE_RADIUS - 6}
              x2={xOf(forkPointIdx)}
              y2={PADDING_TOP + 8 + NODE_RADIUS + 6}
              stroke="#F59E0B"
              strokeWidth={1.5}
              strokeDasharray="2 2"
            />
            <text
              x={xOf(forkPointIdx)}
              y={PADDING_TOP + 8 + NODE_RADIUS + 16}
              textAnchor="middle"
              fontSize={7}
              fill="#F59E0B"
              style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              fork
            </text>
          </g>
        )}

        {/* Connecting lines between scene nodes */}
        {scenes.map((_, i) => {
          if (i === 0) return null;
          const isForkBoundary = forkPointIdx >= 0 && i === forkPointIdx + 1;
          return (
            <line
              key={`line-${i}`}
              x1={xOf(i - 1)}
              y1={PADDING_TOP + 8}
              x2={xOf(i)}
              y2={PADDING_TOP + 8}
              stroke={isForkBoundary ? '#F59E0B' : '#333333'}
              strokeWidth={isForkBoundary ? 1.5 : 1}
              strokeDasharray={isForkBoundary ? '3 3' : undefined}
            />
          );
        })}

        {/* Scene nodes */}
        {scenes.map((scene, i) => {
          const x = xOf(i);
          const y = PADDING_TOP + 8;
          const isSelected = i === state.currentSceneIndex;
          const isExpansion = scene.kind === 'world_build';

          return (
            <g
              key={scene.id}
              className="cursor-pointer"
              onClick={() => {
                dispatch({ type: 'SET_SCENE_INDEX', index: i });
                dispatch({
                  type: 'SET_INSPECTOR',
                  context: { type: 'scene', sceneId: scene.id },
                });
              }}
            >
              {/* Selected ring */}
              {isSelected && !isExpansion && (
                <circle
                  cx={x}
                  cy={y}
                  r={NODE_RADIUS + 3}
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth={2}
                />
              )}
              {isSelected && isExpansion && (
                <rect
                  x={x - NODE_RADIUS - 3}
                  y={y - NODE_RADIUS - 3}
                  width={(NODE_RADIUS + 3) * 2}
                  height={(NODE_RADIUS + 3) * 2}
                  rx={2}
                  fill="none"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  transform={`rotate(45 ${x} ${y})`}
                />
              )}
              {/* Node shape — diamond for expansion, circle for normal */}
              {isExpansion ? (
                <rect
                  x={x - NODE_RADIUS + 1}
                  y={y - NODE_RADIUS + 1}
                  width={(NODE_RADIUS - 1) * 2}
                  height={(NODE_RADIUS - 1) * 2}
                  rx={2}
                  fill={isSelected ? '#F59E0B' : '#92600A'}
                  transform={`rotate(45 ${x} ${y})`}
                />
              ) : (
                <circle
                  cx={x}
                  cy={y}
                  r={NODE_RADIUS}
                  fill={isSelected ? '#E8E8E8' : '#444444'}
                />
              )}
            </g>
          );
        })}
      </svg>
      </div>

      {/* Fork button */}
      <div className="flex items-center justify-center px-2 border-l border-border shrink-0 w-9">
        <button
          type="button"
          title="Fork branch from current scene"
          onClick={() => window.dispatchEvent(new CustomEvent('open-branch-modal'))}
          className="w-7 h-7 flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-white/6 rounded-md transition-colors"
        >
          <IconFork size={14} />
        </button>
      </div>
    </div>
  );
}
