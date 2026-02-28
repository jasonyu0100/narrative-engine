'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type { MCTSConfig, MCTSNodeId, MCTSNode, MCTSTree } from '@/types/mcts';
import { DEFAULT_MCTS_CONFIG, DEFAULT_BRANCHING, BEAT_DIRECTIONS } from '@/types/mcts';
import type { useMCTS } from '@/hooks/useMCTS';
import { treeSize, bestPath as computeBestPath } from '@/lib/mcts-engine';
import { NARRATIVE_CUBE, type Scene } from '@/types/narrative';
import { computeForceSnapshots, detectCubeCorner, computeEngagementCurve, classifyCurrentPosition } from '@/lib/narrative-utils';
import { useStore } from '@/lib/store';

/** Hook that ticks every second while active, returning elapsed seconds since startedAt */
function useElapsedSeconds(startedAt: number | null, isActive: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isActive || !startedAt) { setElapsed(0); return; }
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt, isActive]);
  return elapsed;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreColorClass(v: number): string {
  if (v >= 90) return 'text-green-400';
  if (v >= 80) return 'text-lime-400';
  if (v >= 70) return 'text-yellow-400';
  if (v >= 60) return 'text-orange-400';
  return 'text-red-400';
}

function scoreBgClass(v: number): string {
  if (v >= 90) return 'bg-green-500/10 border-green-500/20';
  if (v >= 80) return 'bg-lime-500/10 border-lime-500/20';
  if (v >= 70) return 'bg-yellow-500/10 border-yellow-500/20';
  if (v >= 60) return 'bg-orange-500/10 border-orange-500/20';
  return 'bg-red-500/10 border-red-500/20';
}

/** Compute a sparkline from this node's own scenes only — unique shape per arc */
function nodeSparkline(node: MCTSNode): { points: number[]; position: string; positionKey: string } {
  if (node.scenes.length === 0) return { points: [], position: 'Stable', positionKey: 'stable' };
  const forceMap = computeForceSnapshots(node.scenes);
  const ordered = node.scenes.map((s) => forceMap[s.id]).filter(Boolean);
  const engPts = computeEngagementCurve(ordered);
  const raw = engPts.map((p) => p.smoothed);
  if (raw.length === 0) return { points: [], position: 'Stable', positionKey: 'stable' };
  const min = Math.min(...raw);
  const max = Math.max(...raw);
  const range = Math.max(max - min, 0.05);
  const pos = classifyCurrentPosition(engPts);
  return { points: raw.map((v) => (v - min) / range), position: pos.name, positionKey: pos.key };
}

const POSITION_COLORS: Record<string, string> = {
  peak:    '#F59E0B',
  trough:  '#3B82F6',
  rising:  '#22C55E',
  falling: '#EF4444',
  stable:  'rgba(255,255,255,0.3)',
};

// ── Tree constants ───────────────────────────────────────────────────────────

const NODE_H = 28;         // row height in px
const INDENT = 24;          // horizontal indent per depth level
const DOT_R = 4;            // node dot radius
const LINE_PAD_LEFT = 14;   // left padding to center of first dot

/** Count visible descendant nodes (for SVG sizing) */
function countVisible(node: MCTSNode, tree: MCTSTree, collapsedSet: Set<MCTSNodeId>): number {
  if (collapsedSet.has(node.id)) return 1;
  const children = node.childIds.map((id) => tree.nodes[id]).filter(Boolean);
  return 1 + children.reduce((sum, c) => sum + countVisible(c, tree, collapsedSet), 0);
}

// ── Tree Node (recursive with SVG connectors) ───────────────────────────────

function TreeNode({
  node,
  tree,
  depth,
  bestSet,
  selectedSet,
  inspectedId,
  expandingNodeId,
  onSelect,
  collapsedSet,
  onToggleCollapse,
  yOffset,
}: {
  node: MCTSNode;
  tree: MCTSTree;
  depth: number;
  bestSet: Set<MCTSNodeId>;
  selectedSet: Set<MCTSNodeId>;
  inspectedId: MCTSNodeId | null;
  expandingNodeId: MCTSNodeId | null;
  onSelect: (id: MCTSNodeId) => void;
  collapsedSet: Set<MCTSNodeId>;
  onToggleCollapse: (id: MCTSNodeId) => void;
  yOffset: number;
}) {
  const isBest = bestSet.has(node.id);
  const isSelected = selectedSet.has(node.id);
  const isInspected = inspectedId === node.id;
  const isExp = expandingNodeId === node.id;
  const isCollapsed = collapsedSet.has(node.id);
  const spark = useMemo(() => nodeSparkline(node), [node]);
  const children = node.childIds
    .map((id) => tree.nodes[id])
    .filter(Boolean)
    .sort((a, b) => b.immediateScore - a.immediateScore);
  const hasChildren = children.length > 0;
  const sc = node.immediateScore;

  // Determine connector line color
  const lineColor = isSelected ? 'rgba(96,165,250,0.4)'
    : isBest ? 'rgba(34,197,94,0.25)'
    : 'rgba(255,255,255,0.07)';

  // Dot color
  const dotColor = isInspected ? '#60a5fa'
    : isSelected ? 'rgba(96,165,250,0.6)'
    : isBest ? 'rgba(34,197,94,0.5)'
    : 'rgba(255,255,255,0.15)';

  const x = LINE_PAD_LEFT + depth * INDENT;
  const cy = yOffset * NODE_H + NODE_H / 2;

  // Build child rows + SVG lines
  let childOffset = yOffset + 1;
  const childElements: React.ReactNode[] = [];
  const svgLines: React.ReactNode[] = [];

  if (hasChildren && !isCollapsed) {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childCy = childOffset * NODE_H + NODE_H / 2;
      const childX = LINE_PAD_LEFT + (depth + 1) * INDENT;
      const childIsBest = bestSet.has(child.id);
      const childIsSelected = selectedSet.has(child.id);
      const childLineColor = childIsSelected ? 'rgba(96,165,250,0.4)'
        : childIsBest ? 'rgba(34,197,94,0.25)'
        : 'rgba(255,255,255,0.07)';

      // Vertical line from parent down + horizontal to child
      svgLines.push(
        <g key={`line-${child.id}`}>
          {/* Vertical segment */}
          <line x1={x} y1={cy + DOT_R + 1} x2={x} y2={childCy} stroke={childLineColor} strokeWidth={1.5} />
          {/* Horizontal segment */}
          <line x1={x} y1={childCy} x2={childX - DOT_R - 2} y2={childCy} stroke={childLineColor} strokeWidth={1.5} />
        </g>,
      );

      const childVisibleCount = countVisible(child, tree, collapsedSet);
      childElements.push(
        <TreeNode
          key={child.id}
          node={child}
          tree={tree}
          depth={depth + 1}
          bestSet={bestSet}
          selectedSet={selectedSet}
          inspectedId={inspectedId}
          expandingNodeId={expandingNodeId}
          onSelect={onSelect}
          collapsedSet={collapsedSet}
          onToggleCollapse={onToggleCollapse}
          yOffset={childOffset}
        />,
      );
      childOffset += childVisibleCount;
    }
  }

  return (
    <>
      {/* SVG connector lines (rendered in the shared SVG layer) */}
      {svgLines}

      {/* Node dot */}
      <circle cx={x} cy={cy} r={DOT_R} fill={dotColor} className={isExp ? 'animate-pulse' : ''} />

      {/* Collapse/expand toggle on dot for nodes with children */}
      {hasChildren && (
        <circle
          cx={x} cy={cy} r={DOT_R + 4}
          fill="transparent"
          className="cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(node.id); }}
        />
      )}

      {/* HTML overlay: score + arc name (positioned absolutely in the foreignObject) */}
      <foreignObject x={x + DOT_R + 6} y={yOffset * NODE_H} width="calc(100% - 60px)" height={NODE_H}>
        <button
          onClick={() => onSelect(node.id)}
          className={`flex items-center gap-1.5 w-full h-full text-left px-1.5 rounded transition-colors group ${
            isInspected ? 'bg-blue-500/15' : isSelected ? 'bg-blue-500/8' : isBest ? 'bg-green-500/5' : 'hover:bg-white/3'
          }`}
        >
          <span className={`font-mono text-[12px] font-bold w-7 text-right shrink-0 ${scoreColorClass(sc)}`}>{sc}</span>
          <span className={`text-[11px] truncate flex-1 ${
            isInspected ? 'text-blue-300 font-medium' : isSelected ? 'text-blue-300' : isBest ? 'text-green-300' : 'text-text-primary'
          }`}>
            {node.arc.name}
          </span>
          {spark.points.length > 1 && (() => {
            const W = Math.min(80, Math.max(24, spark.points.length * 3));
            return (
              <svg width={W} height="14" viewBox={`0 0 ${W} 14`} className="shrink-0">
                <polyline
                  points={spark.points.map((v, i) => `${(i / (spark.points.length - 1)) * W},${14 - v * 12}`).join(' ')}
                  fill="none"
                  stroke="#F59E0B"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            );
          })()}
          <span className="text-[9px] text-text-dim shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {node.scenes.length}s{node.visitCount > 1 ? ` · ${node.visitCount}v` : ''}
          </span>
          {isCollapsed && hasChildren && (
            <span className="text-[9px] text-text-dim/50 shrink-0">+{children.length}</span>
          )}
        </button>
      </foreignObject>

      {childElements}
    </>
  );
}

// ── Tree View ────────────────────────────────────────────────────────────────

function MCTSTreeView({
  tree,
  bestPath,
  selectedPath,
  inspectedId,
  expandingNodeId,
  onSelectNode,
}: {
  tree: MCTSTree;
  bestPath: MCTSNodeId[] | null;
  selectedPath: MCTSNodeId[] | null;
  inspectedId: MCTSNodeId | null;
  expandingNodeId: MCTSNodeId | null;
  onSelectNode: (nodeId: MCTSNodeId) => void;
}) {
  const bestSet = useMemo(() => new Set(bestPath ?? []), [bestPath]);
  const selectedSet = useMemo(() => new Set(selectedPath ?? []), [selectedPath]);
  const [collapsedSet, setCollapsedSet] = useState<Set<MCTSNodeId>>(new Set());

  const handleToggleCollapse = useCallback((id: MCTSNodeId) => {
    setCollapsedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const rootChildren = tree.rootChildIds
    .map((id) => tree.nodes[id])
    .filter(Boolean)
    .sort((a, b) => b.immediateScore - a.immediateScore);

  if (rootChildren.length === 0) return null;

  // Count total visible rows for SVG height
  const totalRows = rootChildren.reduce(
    (sum, node) => sum + countVisible(node, tree, collapsedSet), 0,
  );
  const svgHeight = totalRows * NODE_H + 8;

  // Build root-level nodes with offsets
  let rowOffset = 0;
  const nodeElements = rootChildren.map((node) => {
    const offset = rowOffset;
    rowOffset += countVisible(node, tree, collapsedSet);
    return (
      <TreeNode
        key={node.id}
        node={node}
        tree={tree}
        depth={0}
        bestSet={bestSet}
        selectedSet={selectedSet}
        inspectedId={inspectedId}
        expandingNodeId={expandingNodeId}
        onSelect={onSelectNode}
        collapsedSet={collapsedSet}
        onToggleCollapse={handleToggleCollapse}
        yOffset={offset}
      />
    );
  });

  return (
    <div className="overflow-auto p-1">
      <svg width="100%" height={svgHeight} className="block">
        {nodeElements}
      </svg>
    </div>
  );
}

// ── Node Inspector ───────────────────────────────────────────────────────────

type InspectorView = 'arc' | number; // 'arc' = summary list, number = scene index

function NodeInspector({ node, tree }: { node: MCTSNode; tree: MCTSTree }) {
  const [view, setView] = useState<InspectorView>('arc');
  const cubeLabel = node.cubeGoal ? NARRATIVE_CUBE[node.cubeGoal]?.name ?? null : null;

  // Full-path engagement curve for this node
  const pathEngagement = useMemo(() => {
    const allScenes = node.virtualResolvedKeys
      .map((k) => node.virtualNarrative.scenes[k])
      .filter((s): s is Scene => !!s);
    if (allScenes.length === 0) return { pts: [], position: null, nodeStart: 0 };
    const forceMap = computeForceSnapshots(allScenes);
    const ordered = allScenes.map((s) => forceMap[s.id]).filter(Boolean);
    const pts = computeEngagementCurve(ordered);
    const position = pts.length > 0 ? classifyCurrentPosition(pts) : null;
    // Where this node's scenes start in the full path
    const nodeStart = allScenes.length - node.scenes.length;
    return { pts, position, nodeStart };
  }, [node]);

  // Reset to arc view when node changes
  const [prevNodeId, setPrevNodeId] = useState(node.id);
  if (node.id !== prevNodeId) {
    setPrevNodeId(node.id);
    setView('arc');
  }

  const scene = typeof view === 'number' ? node.scenes[view] : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <div className="flex items-baseline gap-2">
          <h2 className="text-[10px] uppercase tracking-widest text-text-dim">Arc</h2>
          <span className="font-mono text-[10px] text-text-dim">{node.arc.id}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`font-mono text-sm font-bold ${scoreColorClass(node.immediateScore)}`}>
            {node.immediateScore}
          </span>
          <span className="text-sm text-text-primary font-medium">{node.arc.name}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-[10px] text-text-dim uppercase tracking-wider">
        <span>{node.scenes.length} scenes</span>
        <span>depth {node.depth}</span>
        <span>{node.visitCount} visits</span>
        {node.childIds.length > 0 && <span>{node.childIds.length} children</span>}
      </div>

      {/* Direction goal */}
      {(node.cubeGoal || node.beatGoal) && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-text-dim">{node.beatGoal ? 'Beat' : 'Direction'}</span>
          {node.cubeGoal && (
            <>
              <svg width="21" height="12" viewBox="0 0 21 12">
                {node.cubeGoal.split('').map((c, i) => {
                  const isHi = c === 'H';
                  const colors = ['#EF4444', '#22C55E', '#3B82F6'];
                  return <rect key={i} x={i * 8} y={isHi ? 1 : 6} width={6} height={isHi ? 10 : 5} rx={1} fill={colors[i]} opacity={isHi ? 1 : 0.4} />;
                })}
              </svg>
              <span className="font-mono text-[10px] text-violet-400">{node.cubeGoal}</span>
              {cubeLabel && <span className="text-[10px] text-text-secondary">{cubeLabel}</span>}
            </>
          )}
          {node.beatGoal && (() => {
            const engDir = BEAT_DIRECTIONS[node.beatGoal];
            const strokeColor = node.beatGoal === 'escalate' ? '#22C55E'
              : node.beatGoal === 'release' ? '#3B82F6'
              : node.beatGoal === 'surge' ? '#F59E0B'
              : '#A855F7';
            const points = node.beatGoal === 'escalate' ? '0,10 24,2'
              : node.beatGoal === 'release' ? '0,2 24,10'
              : node.beatGoal === 'surge' ? '0,10 9,2 18,10'
              : '0,2 9,10 18,2';
            return (
              <>
                <svg width="24" height="12" viewBox="0 0 24 12">
                  <polyline points={points} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-[10px] text-text-secondary">{engDir.name}</span>
              </>
            );
          })()}
        </div>
      )}

      {/* Engagement chart */}
      {pathEngagement.pts.length > 1 && (() => {
        const { pts, position, nodeStart } = pathEngagement;
        const n = pts.length;
        const W = 260, H = 48;
        const smoothed = pts.map((p) => p.smoothed);
        const min = Math.min(...smoothed);
        const max = Math.max(...smoothed);
        const range = max - min || 1;
        const toY = (v: number) => H - ((v - min) / range) * (H - 4) - 2;
        const allPts = smoothed.map((v, i) => `${(i / (n - 1)) * W},${toY(v)}`).join(' ');
        const nodePts = smoothed.slice(nodeStart).map((v, i) =>
          `${((nodeStart + i) / (n - 1)) * W},${toY(v)}`
        ).join(' ');
        const nodeX1 = (nodeStart / (n - 1)) * W;
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase tracking-widest text-text-dim">Engagement</span>
              {position && (
                <span className="text-[9px] font-medium" style={{ color: POSITION_COLORS[position.key] ?? 'white' }}>
                  {position.name}
                </span>
              )}
            </div>
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="rounded bg-white/2">
              {/* Node range highlight */}
              <rect x={nodeX1} y={0} width={W - nodeX1} height={H} fill="rgba(245,158,11,0.06)" />
              {/* Prior path */}
              <polyline points={allPts} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeLinejoin="round" />
              {/* This node's scenes */}
              {nodePts && <polyline points={nodePts} fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
              {/* Peak/valley markers */}
              {pts.map((p, i) => {
                if (!p.isPeak && !p.isValley) return null;
                const cx = (i / (n - 1)) * W;
                const cy = toY(p.smoothed);
                return p.isPeak
                  ? <polygon key={i} points={`${cx},${cy - 6} ${cx - 3.5},${cy} ${cx + 3.5},${cy}`} fill="#F59E0B" opacity="0.8" />
                  : <polygon key={i} points={`${cx},${cy + 6} ${cx - 3.5},${cy} ${cx + 3.5},${cy}`} fill="#3B82F6" opacity="0.8" />;
              })}
            </svg>
          </div>
        );
      })()}

      {/* Develops */}
      {node.arc.develops.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Develops</h3>
          <div className="flex flex-col gap-1">
            {node.arc.develops.map((threadId) => {
              const thread = node.virtualNarrative.threads[threadId];
              // Collect all transitions for this thread across the arc's scenes
              const transitions = node.scenes.flatMap((s) =>
                s.threadMutations.filter((tm) => tm.threadId === threadId)
              );
              return (
                <div key={threadId} className="flex flex-col gap-1 rounded bg-white/3 px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-text-dim shrink-0">{threadId}</span>
                    <span className="text-[10px] text-text-secondary leading-relaxed">
                      {thread?.description ?? threadId}
                    </span>
                  </div>
                  {transitions.length > 0 && (
                    <div className="flex items-center gap-1 pl-9 font-mono text-[9px]">
                      <span className="text-text-dim">{transitions[0].from}</span>
                      {transitions.map((tm, i) => (
                        <span key={i} className="flex items-center gap-1">
                          <span className="text-text-dim/50">→</span>
                          <span className="text-amber-400">{tm.to}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* View toggle */}
      <div className="flex items-center gap-1 border-b border-border pb-1">
        <button
          onClick={() => setView('arc')}
          className={`px-2 py-1 text-[10px] rounded-t transition-colors ${
            view === 'arc' ? 'text-text-primary bg-white/6' : 'text-text-dim hover:text-text-secondary'
          }`}
        >
          Scenes ({node.scenes.length})
        </button>
        {scene && (
          <span className="text-[10px] text-text-dim mx-1">›</span>
        )}
        {scene && (
          <span className="text-[10px] text-blue-400">Scene {(view as number) + 1}</span>
        )}
      </div>

      {/* Arc view — scene summary list */}
      {view === 'arc' && (
        <div className="flex flex-col gap-2">
          {node.scenes.map((s, i) => {
            const loc = node.virtualNarrative.locations[s.locationId];
            const pov = s.povId ? node.virtualNarrative.characters[s.povId] : null;
            return (
            <button
              key={s.id}
              type="button"
              onClick={() => setView(i)}
              className="group flex flex-col gap-1 rounded bg-white/3 p-2 text-left transition-colors hover:bg-white/[0.07]"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-text-dim">{i + 1}</span>
                <span className="text-[10px] text-text-dim">{loc?.name ?? s.locationId}</span>
                {(pov || s.povId) && (
                  <span className="text-[10px] text-text-dim ml-auto">POV: {pov?.name ?? s.povId}</span>
                )}
              </div>
              <p className="text-xs text-text-secondary leading-relaxed group-hover:text-text-primary transition-colors">
                {s.summary || 'No summary available.'}
              </p>
              {s.events.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {s.events.map((ev, j) => (
                    <span key={j} className="text-[9px] bg-amber-500/10 text-amber-400/80 rounded px-1.5 py-0.5">{ev}</span>
                  ))}
                </div>
              )}
            </button>
            );
          })}
        </div>
      )}

      {/* Scene detail view */}
      {scene && (() => {
        // Build the full scene timeline: all resolved scenes from the virtual narrative
        // (which includes real commits + ancestor MCTS nodes + this node's scenes)
        const allScenes = node.virtualResolvedKeys
          .map((k) => node.virtualNarrative.scenes[k])
          .filter((s): s is Scene => !!s);
        const forceMap = computeForceSnapshots(allScenes);
        const forces = forceMap[scene.id] ?? { payoff: 0, change: 0, variety: 0 };
        const corner = detectCubeCorner(forces);
        const loc = node.virtualNarrative.locations[scene.locationId];
        const pov = scene.povId ? node.virtualNarrative.characters[scene.povId] : null;

        return (
        <div className="flex flex-col gap-4">
          {/* Back button */}
          <button
            onClick={() => setView('arc')}
            className="flex items-center gap-1 text-[10px] text-text-dim hover:text-text-secondary transition-colors self-start"
          >
            <span>←</span> Back to arc
          </button>

          {/* Scene ID + arc */}
          <div className="flex items-baseline gap-2">
            <h2 className="font-mono text-xs text-text-dim">{scene.id}</h2>
            <span className="text-[10px] text-text-dim uppercase tracking-wider">{node.arc.name}</span>
          </div>

          {/* Location + POV */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <svg className="w-3.5 h-3.5 shrink-0 text-text-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
              <span className="text-[10px] uppercase tracking-wider text-text-dim mr-1">Location</span>
              {loc?.name ?? scene.locationId}
            </div>
            {(pov || scene.povId) && (
              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                <svg className="w-3.5 h-3.5 shrink-0 text-text-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span className="text-[10px] uppercase tracking-wider text-text-dim mr-1">POV</span>
                {pov?.name ?? scene.povId}
              </div>
            )}
          </div>

          {/* Summary */}
          <p className="text-xs text-text-secondary leading-relaxed">
            {scene.summary || 'No summary available.'}
          </p>

          {/* Participants */}
          {scene.participantIds.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Participants</h3>
              <div className="flex flex-wrap gap-1.5">
                {scene.participantIds.map((pid, pidIdx) => {
                  const char = node.virtualNarrative.characters[pid];
                  return (
                    <span key={`${pid}-${pidIdx}`} className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary">
                      {char?.name ?? pid}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Force Snapshot */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <svg width="24" height="12" viewBox="0 0 24 12">
                {corner.key.split('').map((c, i) => {
                  const isHi = c === 'H';
                  const colors = ['#EF4444', '#22C55E', '#3B82F6'];
                  return <rect key={i} x={i * 9} y={isHi ? 1 : 6} width={7} height={isHi ? 10 : 5} rx={1.5} fill={colors[i]} opacity={isHi ? 1 : 0.4} />;
                })}
              </svg>
              <span className="text-[11px] text-text-secondary">{corner.name}</span>
            </div>
            <div className="flex gap-3">
              {([
                { label: 'Payoff', value: forces.payoff, color: '#EF4444' },
                { label: 'Change', value: forces.change, color: '#22C55E' },
                { label: 'Variety', value: forces.variety, color: '#3B82F6' },
              ] as const).map(({ label, value, color }) => (
                <div key={label} className="flex flex-1 flex-col gap-1">
                  <span className="text-[10px] uppercase text-text-dim">{label}</span>
                  <div className="h-1.5 w-full rounded-full bg-white/6">
                    <div className="h-1.5 rounded-full" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Events */}
          {scene.events.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Events</h3>
              <div className="flex flex-wrap gap-1.5">
                {scene.events.map((ev, j) => (
                  <span key={j} className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400/80">{ev}</span>
                ))}
              </div>
            </div>
          )}

          {/* Thread Mutations */}
          {scene.threadMutations.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Thread Mutations</h3>
              {scene.threadMutations.map((tm, j) => {
                const thread = node.virtualNarrative.threads[tm.threadId];
                return (
                  <div key={j} className="flex items-center gap-1.5 text-xs">
                    <span className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-primary shrink-0">{tm.threadId}</span>
                    {thread && <span className="text-text-dim text-[10px] truncate max-w-25">{thread.description}</span>}
                    <span className="text-text-dim ml-auto shrink-0">{tm.from} → {tm.to}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Relationship Mutations */}
          {scene.relationshipMutations.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Relationships</h3>
              {scene.relationshipMutations.map((rm, j) => {
                const fromName = node.virtualNarrative.characters[rm.from]?.name ?? rm.from;
                const toName = node.virtualNarrative.characters[rm.to]?.name ?? rm.to;
                return (
                  <div key={j} className="flex flex-col gap-0.5 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-text-primary">{fromName}</span>
                      <span className="text-text-dim">&harr;</span>
                      <span className="text-text-primary">{toName}</span>
                      <span className={`font-mono text-[10px] ml-auto ${rm.valenceDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {rm.valenceDelta > 0 ? '+' : ''}{rm.valenceDelta}
                      </span>
                    </div>
                    <span className="text-text-secondary pl-2 text-[10px]">{rm.type}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Knowledge Mutations */}
          {scene.knowledgeMutations.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Knowledge</h3>
              {scene.knowledgeMutations.map((km, j) => {
                const charName = node.virtualNarrative.characters[km.characterId]?.name ?? km.characterId;
                return (
                  <div key={j} className="flex flex-col gap-0.5 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-text-primary">{charName}</span>
                      <span className={km.action === 'added' ? 'text-change' : 'text-payoff'}>
                        {km.action === 'added' ? '+' : '−'}
                      </span>
                      <span className="font-mono text-[10px] text-text-dim">{km.nodeId}</span>
                    </div>
                    <span className="text-text-secondary pl-2">{km.content}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        );
      })()}
    </div>
  );
}

// ── Config Tab ───────────────────────────────────────────────────────────────

type ConfigTab = 'search' | 'strategy' | 'other' | 'world';

// ── Main Panel ───────────────────────────────────────────────────────────────

type MCTSHook = ReturnType<typeof useMCTS>;

export function MCTSPanel({ isOpen, onClose, mcts }: { isOpen: boolean; onClose: () => void; mcts: MCTSHook }) {
  const { state } = useStore();
  const { runState, start, pause, resume, stop, selectPath, commitPath, continueSearch } = mcts;

  // Initialize config with dynamic suggestion from narrative context
  const [config, setConfig] = useState<MCTSConfig>(() => {
    return { ...DEFAULT_MCTS_CONFIG };
  });
  const [configTab, setConfigTab] = useState<ConfigTab>('search');

  const isRunning = runState.status === 'running';
  const isPaused = runState.status === 'paused';
  const isComplete = runState.status === 'complete';
  const isIdle = runState.status === 'idle';
  const isTimerMode = runState.config.stopMode === 'timer';
  const activePath = runState.selectedPath ?? runState.bestPath;
  const hasPath = (activePath?.length ?? 0) > 0;
  const nodeCount = treeSize(runState.tree);
  const hasTree = nodeCount > 0;
  const elapsed = useElapsedSeconds(runState.startedAt, isRunning);
  const [inspectedNodeId, setInspectedNodeId] = useState<MCTSNodeId | null>(null);
  const inspectedNode = inspectedNodeId ? runState.tree.nodes[inspectedNodeId] ?? null : null;

  const handleSelectNode = useCallback((nodeId: MCTSNodeId) => {
    // Always inspect the clicked node
    setInspectedNodeId(nodeId);
    // Build path from root to this node
    const current = runState.selectedPath ?? [];
    if (current.includes(nodeId)) {
      selectPath(current.slice(0, current.indexOf(nodeId)));
    } else {
      const path: MCTSNodeId[] = [];
      let id: MCTSNodeId | null = nodeId;
      while (id) {
        path.unshift(id);
        id = runState.tree.nodes[id]?.parentId ?? null;
      }
      selectPath(path);
    }
  }, [runState.selectedPath, runState.tree.nodes, selectPath]);

  const handleCommit = useCallback(() => {
    commitPath();
    onClose();
  }, [commitPath, onClose]);

  const handleStop = useCallback(() => {
    stop();
    onClose();
  }, [stop, onClose]);

  const progress = isTimerMode
    ? Math.min(100, Math.round((elapsed / runState.config.timeLimitSeconds) * 100))
    : runState.config.maxNodes > 0
      ? Math.round((runState.iterationsCompleted / runState.config.maxNodes) * 100)
      : 0;

  if (!isOpen) return null;

  // ── Config modal (pre-start, no tree yet) ──────────────────────────────────

  if (isIdle && !hasTree) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
        <div className="glass max-w-lg w-full rounded-2xl p-6 relative max-h-[85vh] flex flex-col">
          <button onClick={onClose} className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none">&times;</button>

          <h2 className="text-sm font-semibold text-text-primary mb-1">MCTS Explorer</h2>
          <p className="text-[10px] text-text-dim uppercase tracking-wider mb-3">
            Monte Carlo Tree Search
          </p>

          {/* Tabs */}
          <div className="flex gap-1 bg-bg-elevated rounded-lg p-0.5 mb-4 shrink-0">
            {([
              { label: 'Search', value: 'search' as ConfigTab },
              { label: 'Strategy', value: 'strategy' as ConfigTab },
              { label: 'World', value: 'world' as ConfigTab },
              { label: 'Other', value: 'other' as ConfigTab },
            ]).map((t) => (
              <button
                key={t.value}
                onClick={() => setConfigTab(t.value)}
                className={`flex-1 px-2 py-1.5 text-[10px] font-medium transition-colors rounded-md uppercase tracking-wider ${
                  configTab === t.value
                    ? 'bg-bg-overlay text-text-primary'
                    : 'text-text-dim hover:text-text-secondary'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto flex flex-col gap-4 min-h-0">
            {configTab === 'search' && (
              <>
                {/* Stop mode */}
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">Stop Condition</label>
                  <div className="flex flex-col gap-1.5">
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.stopMode === 'timer' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="stopMode" checked={config.stopMode === 'timer'} onChange={() => setConfig((c) => ({ ...c, stopMode: 'timer' }))} className="accent-blue-500 mt-0.5" />
                      <div className="flex-1">
                        <div className="text-xs text-text-primary font-medium">Time limit</div>
                        <div className="text-[9px] text-text-dim">Search for a fixed duration, like a chess clock</div>
                      </div>
                    </label>
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.stopMode === 'iterations' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="stopMode" checked={config.stopMode === 'iterations'} onChange={() => setConfig((c) => ({ ...c, stopMode: 'iterations' }))} className="accent-blue-500 mt-0.5" />
                      <div className="flex-1">
                        <div className="text-xs text-text-primary font-medium">Iterations</div>
                        <div className="text-[9px] text-text-dim">Generate a fixed total number of arcs (LLM calls)</div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Time limit slider */}
                {config.stopMode === 'timer' && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] uppercase tracking-widest text-text-dim">Time budget</label>
                      <span className="text-xs font-mono text-text-primary">{config.timeLimitSeconds}s</span>
                    </div>
                    <input type="range" min={15} max={300} step={15} value={config.timeLimitSeconds} onChange={(e) => setConfig((c) => ({ ...c, timeLimitSeconds: Number(e.target.value) }))} className="w-full accent-blue-500" />
                    <p className="text-[9px] text-text-dim mt-0.5">Search runs until this time elapses. More time = more nodes explored.</p>
                  </div>
                )}

                {/* Iterations slider */}
                {config.stopMode === 'iterations' && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] uppercase tracking-widest text-text-dim">Max Arcs (LLM calls)</label>
                      <span className="text-xs font-mono text-text-primary">{config.maxNodes}</span>
                    </div>
                    <input type="range" min={5} max={200} step={5} value={config.maxNodes} onChange={(e) => setConfig((c) => ({ ...c, maxNodes: Number(e.target.value) }))} className="w-full accent-blue-500" />
                    <p className="text-[9px] text-text-dim mt-0.5">Total arcs to generate across the whole tree. Each arc = one LLM call. With {config.parallelism} parallel workers, expect ~{Math.ceil(config.maxNodes / config.parallelism)} rounds of generation.</p>
                  </div>
                )}

                <div className="border-t border-border pt-4">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-3">Parallelism &amp; Depth</label>

                  {/* Parallelism */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-text-secondary">Parallel workers</span>
                      <span className="text-xs font-mono text-text-primary">{config.parallelism}</span>
                    </div>
                    <input type="range" min={1} max={8} step={1} value={config.parallelism} onChange={(e) => setConfig((c) => ({ ...c, parallelism: Number(e.target.value) }))} className="w-full accent-blue-500" />
                    <p className="text-[9px] text-text-dim mt-0.5">How many arcs are generated simultaneously. Each worker picks an unexplored node via UCB1 and generates one arc. When it finishes, a new one starts immediately — keeping all workers busy.</p>
                  </div>

                  {/* Max depth */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-text-secondary">Max depth</span>
                      <span className="text-xs font-mono text-text-primary">{config.maxDepth}</span>
                    </div>
                    <input type="range" min={1} max={10} step={1} value={config.maxDepth} onChange={(e) => setConfig((c) => ({ ...c, maxDepth: Number(e.target.value) }))} className="w-full accent-blue-500" />
                    <p className="text-[9px] text-text-dim mt-0.5">Max arcs-deep the tree can grow. Each depth level is a new arc after the previous one — deeper = longer narrative chains.</p>
                  </div>

                </div>
              </>
            )}

            {configTab === 'strategy' && (
              <>
                {/* Search strategy */}
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">Strategy</label>
                  <div className="flex flex-col gap-1.5">
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.searchMode === 'exploit' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="searchMode" checked={config.searchMode === 'exploit'} onChange={() => setConfig((c) => ({ ...c, searchMode: 'exploit' }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Exploit</div>
                        <div className="text-[9px] text-text-dim">Follow the best path. Workers concentrate on the most promising nodes (low UCB1 exploration constant). Use when you want quality fast and trust early results.</div>
                      </div>
                    </label>
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.searchMode === 'explore' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="searchMode" checked={config.searchMode === 'explore'} onChange={() => setConfig((c) => ({ ...c, searchMode: 'explore' }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Explore</div>
                        <div className="text-[9px] text-text-dim">Spread wide. Workers aggressively try untested nodes (high UCB1 exploration constant). Use when you want to discover surprising narrative directions.</div>
                      </div>
                    </label>
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.searchMode === 'baseline' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="searchMode" checked={config.searchMode === 'baseline'} onChange={() => setConfig((c) => ({ ...c, searchMode: 'baseline', fullTree: false }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Baseline</div>
                        <div className="text-[9px] text-text-dim">Quality gating. At each depth, keep generating arcs until one meets the target score, then go deeper. No child limit — cube positions can be retried. Workers run sequentially for precise layer control.</div>
                      </div>
                    </label>
                  </div>
                  {config.searchMode === 'baseline' && (
                    <div className="mt-3 pl-6">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-text-secondary">Target score per layer</span>
                        <span className="text-xs font-mono text-text-primary">{config.baselineScore}</span>
                      </div>
                      <input type="range" min={50} max={90} step={5} value={config.baselineScore} onChange={(e) => setConfig((c) => ({ ...c, baselineScore: Number(e.target.value) }))} className="w-full accent-blue-500" />
                      <p className="text-[9px] text-text-dim mt-0.5">Search continues at each depth until an arc scores at least this value. Higher = pickier but slower.</p>
                    </div>
                  )}
                </div>

                {/* Tree shape: Freedom vs Constrained — hidden when baseline (always freedom) */}
                {config.searchMode !== 'baseline' && (
                  <div className="border-t border-border pt-4">
                    <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">Tree Shape</label>
                    <div className="flex flex-col gap-1.5">
                      <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${!config.fullTree ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                        <input type="radio" name="treeShape" checked={!config.fullTree} onChange={() => setConfig((c) => ({ ...c, fullTree: false, branchingFactor: DEFAULT_BRANCHING[c.directionMode] }))} className="accent-blue-500 mt-0.5" />
                        <div>
                          <div className="text-xs text-text-primary font-medium">Freedom</div>
                          <div className="text-[9px] text-text-dim">UCB1 decides which branches to grow. Tree shape is organic — promising paths get more children, dead ends are abandoned. Width capped at {config.directionMode === 'beats' ? '4' : '8'} (all {config.directionMode === 'beats' ? 'beat directions' : 'cube corners'}).</div>
                        </div>
                      </label>
                      <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.fullTree ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                        <input type="radio" name="treeShape" checked={config.fullTree} onChange={() => setConfig((c) => ({ ...c, fullTree: true, branchingFactor: DEFAULT_BRANCHING[c.directionMode] }))} className="accent-blue-500 mt-0.5" />
                        <div>
                          <div className="text-xs text-text-primary font-medium">Constrained</div>
                          <div className="text-[9px] text-text-dim">Build a complete tree — every node at each depth gets exactly the branching factor number of children before going deeper. Defaults to {config.directionMode === 'beats' ? '4 (beat directions)' : '8 (cube corners)'}.</div>
                        </div>
                      </label>
                    </div>

                    {/* Branching factor — only in constrained mode */}
                    {config.fullTree && (
                      <div className="mt-3 pl-6">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-text-secondary">Branching factor</span>
                          <span className="text-xs font-mono text-text-primary">{config.branchingFactor}</span>
                        </div>
                        <input type="range" min={1} max={config.directionMode === 'cube' ? 8 : 4} step={1} value={config.branchingFactor} onChange={(e) => setConfig((c) => ({ ...c, branchingFactor: Number(e.target.value) }))} className="w-full accent-blue-500" />
                        <p className="text-[9px] text-text-dim mt-0.5">
                          Children per node — override the default if you want a narrower tree.
                          {' '}Generates {(() => { let total = 0; for (let d = 0; d < config.maxDepth; d++) total += Math.pow(config.branchingFactor, d + 1); return total; })()} total arcs for a {config.branchingFactor}×{config.maxDepth} tree.
                        </p>
                      </div>
                    )}
                  </div>
                )}

              </>
            )}

            {configTab === 'other' && (
              <>
                {/* Direction Mode */}
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">Direction Mode</label>
                  <div className="flex flex-col gap-1.5">
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.directionMode === 'beats' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="directionMode" checked={config.directionMode === 'beats'} onChange={() => setConfig((c) => ({ ...c, directionMode: 'beats', branchingFactor: c.fullTree ? DEFAULT_BRANCHING.beats : c.branchingFactor }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Beat Directions</div>
                        <div className="text-[9px] text-text-dim">4 moves per node targeting the beat curve directly — <span className="text-green-400">Escalate</span> (rising), <span className="text-blue-400">Release</span> (falling), <span className="text-amber-400">Surge</span> (peak then still), <span className="text-purple-400">Rebound</span> (still then rising). The four fundamental curve shapes.</div>
                      </div>
                    </label>
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.directionMode === 'cube' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="directionMode" checked={config.directionMode === 'cube'} onChange={() => setConfig((c) => ({ ...c, directionMode: 'cube', branchingFactor: c.fullTree ? DEFAULT_BRANCHING.cube : c.branchingFactor }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Cube Positions</div>
                        <div className="text-[9px] text-text-dim">8 moves per node — every combination of <span style={{color:'#EF4444'}}>Payoff</span>, <span style={{color:'#22C55E'}}>Change</span>, and <span style={{color:'#3B82F6'}}>Variety</span> at high or low. Derived from the narrative cube model.</div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Direction Order */}
                <div className="border-t border-border pt-4">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">Direction Order</label>
                  <p className="text-[9px] text-text-dim mb-2">{config.directionMode === 'cube' ? 'Which cube corner each worker explores next. The 8 cube positions are the available moves from any node — like pieces on a board.' : 'Which beat direction each worker explores next. The 4 beat curves are the available moves from any node.'}</p>
                  <div className="flex flex-col gap-1.5">
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${!config.randomDirections ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="directionOrder" checked={!config.randomDirections} onChange={() => setConfig((c) => ({ ...c, randomDirections: false }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Deterministic</div>
                        <div className="text-[9px] text-text-dim">{config.directionMode === 'cube' ? (config.searchMode === 'exploit' ? 'Closest cube corners tried first — steers toward narrative continuity with the parent.' : 'Most diverse corners tried first — maximises spread across all 8 cube positions.') : 'Cycle through beat directions in canonical order — Escalate, Release, Surge, Rebound.'}</div>
                      </div>
                    </label>
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.randomDirections ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="directionOrder" checked={config.randomDirections} onChange={() => setConfig((c) => ({ ...c, randomDirections: true }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Random</div>
                        <div className="text-[9px] text-text-dim">{config.directionMode === 'cube' ? 'Workers pick a random unused cube corner each time. Results vary across runs — good for open-ended creative exploration.' : 'Workers pick a random unused beat direction each time. Results vary across runs — good for open-ended creative exploration.'}</div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Path Selection */}
                <div className="border-t border-border pt-4">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">Path Selection</label>
                  <p className="text-[9px] text-text-dim mb-2">How the recommended path is highlighted after search. You can always override by clicking nodes manually.</p>
                  <div className="flex flex-col gap-1.5">
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.pathStrategy === 'best_score' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="pathStrategy" checked={config.pathStrategy === 'best_score'} onChange={() => setConfig((c) => ({ ...c, pathStrategy: 'best_score' }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Best Score</div>
                        <div className="text-[9px] text-text-dim">Recommend the path with the highest average arc score. Best for short searches where raw quality is the signal.</div>
                      </div>
                    </label>
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.pathStrategy === 'most_explored' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="pathStrategy" checked={config.pathStrategy === 'most_explored'} onChange={() => setConfig((c) => ({ ...c, pathStrategy: 'most_explored' }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Most Explored</div>
                        <div className="text-[9px] text-text-dim">Recommend the most-visited path. MCTS naturally invests more workers in promising paths, so visit count reflects search confidence. Best for longer searches.</div>
                      </div>
                    </label>
                  </div>
                </div>

              </>
            )}

            {configTab === 'world' && (() => {
              const narrative = state.activeNarrative;
              const resolvedSet = new Set(state.resolvedSceneKeys);
              const worldBuildEntries = narrative
                ? Object.values(narrative.worldBuilds).filter((wb) => resolvedSet.has(wb.id))
                : [];
              return (
                <>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">World Build Focus</label>
                    <p className="text-[9px] text-text-dim mb-3">Select a world build to seed every generation in this search. The model will prioritise those characters, locations, and dormant threads across all arcs explored.</p>
                    {worldBuildEntries.length === 0 ? (
                      <p className="text-[10px] text-text-dim italic">No world builds yet. Use Expand World in the Generate panel to introduce new entities.</p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {worldBuildEntries.map((wb) => {
                          const manifest = wb.expansionManifest;
                          const chars = manifest.characterIds.map((id) => narrative!.characters[id]?.name).filter(Boolean);
                          const locs = manifest.locationIds.map((id) => narrative!.locations[id]?.name).filter(Boolean);
                          const threads = manifest.threadIds.map((id) => narrative!.threads[id]?.description).filter(Boolean);
                          const isSelected = config.worldBuildFocusId === wb.id;
                          return (
                            <button
                              key={wb.id}
                              type="button"
                              onClick={() => setConfig((c) => ({ ...c, worldBuildFocusId: isSelected ? undefined : wb.id }))}
                              className={`rounded-lg px-3 py-2.5 text-left transition border ${
                                isSelected
                                  ? 'bg-amber-500/10 border-amber-500/30 ring-1 ring-amber-500/20'
                                  : 'bg-bg-elevated border-border hover:border-white/16'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <p className={`text-xs font-medium line-clamp-1 ${isSelected ? 'text-amber-300' : 'text-text-primary'}`}>{wb.summary}</p>
                                {isSelected
                                  ? <span className="text-[9px] text-amber-400 shrink-0 uppercase tracking-wider font-medium">Active</span>
                                  : <span className="text-[9px] text-text-dim shrink-0">{wb.id}</span>
                                }
                              </div>
                              {chars.length > 0 && <p className="text-[9px] text-text-dim">Characters: {chars.join(', ')}</p>}
                              {locs.length > 0 && <p className="text-[9px] text-text-dim">Locations: {locs.join(', ')}</p>}
                              {threads.length > 0 && <p className="text-[9px] text-text-dim">Threads: {threads.join('; ')}</p>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

          </div>

          {/* Footer */}
          <div className="flex gap-2 pt-4 mt-4 border-t border-border shrink-0">
            <button
              onClick={() => start(config)}
              className="flex-1 text-xs font-semibold py-2 rounded-lg bg-white/12 text-text-primary hover:bg-white/16 transition-colors"
            >
              Start Search
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Tree view (running / complete / paused) ────────────────────────────────

  return (
    <div className="fixed inset-0 bg-black/95 z-50 flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col p-6">
        <button onClick={onClose} className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none z-10">&times;</button>

        <h2 className="text-sm font-semibold text-text-primary mb-1">
          MCTS Explorer
          {runState.config.searchMode === 'baseline' && (
            <span className="ml-2 text-[10px] font-mono text-violet-400/80 font-normal">
              baseline &ge;{runState.effectiveBaseline != null && runState.effectiveBaseline < runState.config.baselineScore
                ? <>{runState.effectiveBaseline} <span className="text-amber-400/70 line-through">{runState.config.baselineScore}</span></>
                : runState.config.baselineScore}
            </span>
          )}
        </h2>
        <p className="text-[10px] text-text-dim uppercase tracking-wider mb-3">
          {isRunning
            ? isTimerMode
              ? `${runState.currentPhase ?? 'searching'}… ${formatTime(elapsed)} / ${formatTime(runState.config.timeLimitSeconds)} · ${runState.iterationsCompleted + 1} arcs generated`
              : `${runState.currentPhase ?? 'searching'}… ${runState.iterationsCompleted + 1} arcs generated`
            : isComplete
              ? `Search complete · ${nodeCount} nodes explored`
              : isPaused
                ? isTimerMode
                  ? `Paused at ${formatTime(elapsed)} · ${runState.iterationsCompleted} arcs`
                  : `Paused at ${runState.iterationsCompleted} arcs`
                : `${nodeCount} nodes`}
        </p>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="h-2 bg-white/6 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isComplete ? 'bg-blue-400/60' : isPaused ? 'bg-yellow-500/60' : 'bg-blue-500/60'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[10px] text-text-dim font-mono">
              {isTimerMode
                ? `${formatTime(elapsed)} / ${formatTime(runState.config.timeLimitSeconds)}`
                : `${runState.iterationsCompleted} / ${runState.config.maxNodes} arcs`}
            </span>
            <span className="text-[10px] text-text-dim font-mono">
              {runState.iterationsCompleted} arcs · {nodeCount} nodes
            </span>
          </div>
        </div>

        {/* Baseline relaxation notice */}
        {runState.effectiveBaseline != null && runState.effectiveBaseline < runState.config.baselineScore && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/15">
            <span className="text-amber-400 text-[11px] shrink-0">&#9888;</span>
            <span className="text-[10px] text-amber-300/90">
              Baseline lowered from {runState.config.baselineScore} to {runState.effectiveBaseline} — no new arcs exceeded the target after repeated attempts.
            </span>
          </div>
        )}

        {/* Path selection + breadcrumbs */}
        {nodeCount > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            {/* Path strategy buttons */}
            <button
              onClick={() => { const p = computeBestPath(runState.tree, 'best_score'); selectPath(p); if (p.length > 0) setInspectedNodeId(p[p.length - 1]); }}
              className={`text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded transition-colors ${
                !runState.selectedPath || activePath === runState.bestPath
                  ? 'text-text-primary bg-white/8'
                  : 'text-text-dim hover:text-text-secondary'
              }`}
            >
              Best Score
            </button>
            <button
              onClick={() => { const p = computeBestPath(runState.tree, 'most_explored'); selectPath(p); if (p.length > 0) setInspectedNodeId(p[p.length - 1]); }}
              className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded text-text-dim hover:text-text-secondary transition-colors"
            >
              Most Explored
            </button>

            {/* Breadcrumb trail */}
            {hasPath && (
              <>
                <span className="text-text-dim/30 mx-1">|</span>
                {(activePath ?? []).map((id, i) => {
                  const node = runState.tree.nodes[id];
                  if (!node) return null;
                  return (
                    <React.Fragment key={id}>
                      {i > 0 && <span className="text-text-dim text-[10px]">→</span>}
                      <span className={`text-[10px] rounded px-1.5 py-0.5 border ${scoreBgClass(node.immediateScore)}`}>
                        <span className="text-text-secondary">{node.arc.name}</span>
                        {' '}
                        <span className={`font-mono font-semibold ${scoreColorClass(node.immediateScore)}`}>{node.immediateScore}</span>
                      </span>
                    </React.Fragment>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* Two-column: Tree + Inspector */}
        <div className="flex-1 min-h-0 flex gap-4">
          {/* Tree */}
          <div className="flex-1 min-w-0 overflow-auto border border-border rounded-lg bg-bg-elevated/50">
            <MCTSTreeView
              tree={runState.tree}
              bestPath={runState.bestPath}
              selectedPath={runState.selectedPath}
              inspectedId={inspectedNodeId}
              expandingNodeId={runState.expandingNodeId}
              onSelectNode={handleSelectNode}
            />
          </div>

          {/* Inspector */}
          <div className="w-105 shrink-0 overflow-auto border border-border rounded-lg bg-bg-elevated/50 p-4">
            {inspectedNode ? (
              <NodeInspector node={inspectedNode} tree={runState.tree} />
            ) : (
              <div className="flex items-center justify-center h-full text-text-dim text-[11px]">
                Click a node to inspect
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-border shrink-0">
          <button onClick={onClose} className="text-text-dim text-xs hover:text-text-secondary transition">
            {isRunning ? 'Background' : 'Close'}
          </button>

          <div className="flex gap-2">
            {isRunning && (
              <button onClick={pause} className="text-xs px-4 py-2 rounded-lg bg-white/4 text-text-secondary hover:bg-white/8 transition-colors">
                Pause
              </button>
            )}
            {isPaused && (
              <>
                <button onClick={handleStop} className="text-xs px-3 py-2 rounded-lg bg-white/4 text-text-dim hover:text-text-primary transition-colors">
                  Stop
                </button>
                <button onClick={resume} className="text-xs font-semibold px-4 py-2 rounded-lg bg-white/12 text-text-primary hover:bg-white/16 transition-colors">
                  Resume
                </button>
              </>
            )}
            {(isComplete || (isIdle && hasTree)) && (
              <>
                <button onClick={() => continueSearch(12)} className="text-xs px-4 py-2 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors">
                  +12 nodes
                </button>
                <button onClick={() => start(config)} className="text-xs px-4 py-2 rounded-lg bg-white/4 text-text-secondary hover:bg-white/8 transition-colors">
                  Restart
                </button>
                <button
                  onClick={handleCommit}
                  disabled={!hasPath}
                  className={`text-xs font-semibold px-5 py-2 rounded-lg transition-colors ${
                    hasPath ? 'bg-white/12 text-text-primary hover:bg-white/16' : 'bg-white/4 text-text-dim cursor-not-allowed'
                  }`}
                >
                  Commit {activePath?.length ?? 0} Arc{(activePath?.length ?? 0) !== 1 ? 's' : ''}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
