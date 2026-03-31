'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type { MCTSConfig, MCTSNodeId, MCTSNode, MCTSTree, PendingExpansion } from '@/types/mcts';
import { DEFAULT_MCTS_CONFIG, DEFAULT_BRANCHING } from '@/types/mcts';
import type { useMCTS } from '@/hooks/useMCTS';
import { treeSize, bestPath as computeBestPath } from '@/lib/mcts-engine';
import type { Scene } from '@/types/narrative';
import { computeForceSnapshots, detectCubeCorner, computeDeliveryCurve, classifyCurrentPosition } from '@/lib/narrative-utils';
import { useStore } from '@/lib/store';
import { GuidanceFields } from '@/components/generation/GuidanceFields';

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
  const engPts = computeDeliveryCurve(ordered);
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

const NODE_H = 44;         // row height in px (accommodates direction vector on second line)
const PENDING_H = 28;      // pending expansion row height (single line)
const INDENT = 24;          // horizontal indent per depth level
const DOT_R = 4;            // node dot radius
const LINE_PAD_LEFT = 14;   // left padding to center of first dot

/** Total visible pixel height for a node and its descendants, including pending expansions */
function countVisiblePx(node: MCTSNode, tree: MCTSTree, collapsedSet: Set<MCTSNodeId>, pendingMap?: Map<MCTSNodeId | 'root', PendingExpansion[]>): number {
  if (collapsedSet.has(node.id)) return NODE_H;
  const children = node.childIds.map((id) => tree.nodes[id]).filter(Boolean);
  const pendingCount = pendingMap?.get(node.id)?.length ?? 0;
  return NODE_H + children.reduce((sum, c) => sum + countVisiblePx(c, tree, collapsedSet, pendingMap), 0) + pendingCount * PENDING_H;
}

// ── Tree Node (recursive with SVG connectors) ───────────────────────────────

type TreeSortMode = 'time' | 'value';

function sortChildren(nodes: MCTSNode[], mode: TreeSortMode): MCTSNode[] {
  return [...nodes].sort(mode === 'time'
    ? (a, b) => a.createdAt - b.createdAt
    : (a, b) => b.immediateScore - a.immediateScore,
  );
}

function TreeNode({
  node,
  tree,
  depth,
  bestSet,
  selectedSet,
  inspectedId,
  expandingSet,
  pendingMap,
  onSelect,
  onSelectPending,
  collapsedSet,
  onToggleCollapse,
  yOffset,
  sortMode,
}: {
  node: MCTSNode;
  tree: MCTSTree;
  depth: number;
  bestSet: Set<MCTSNodeId>;
  selectedSet: Set<MCTSNodeId>;
  inspectedId: MCTSNodeId | null;
  expandingSet: Set<MCTSNodeId>;
  pendingMap: Map<MCTSNodeId | 'root', PendingExpansion[]>;
  onSelect: (id: MCTSNodeId) => void;
  onSelectPending: (id: string) => void;
  collapsedSet: Set<MCTSNodeId>;
  onToggleCollapse: (id: MCTSNodeId) => void;
  yOffset: number;
  sortMode: TreeSortMode;
}) {
  const isBest = bestSet.has(node.id);
  const isSelected = selectedSet.has(node.id);
  const isInspected = inspectedId === node.id;
  const isExp = expandingSet.has(node.id);
  const isCollapsed = collapsedSet.has(node.id);
  const pendingForNode = pendingMap.get(node.id) ?? [];
  const spark = useMemo(() => nodeSparkline(node), [node]);
  const children = sortChildren(
    node.childIds.map((id) => tree.nodes[id]).filter(Boolean),
    sortMode,
  );
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

  const thisH = NODE_H;
  const x = LINE_PAD_LEFT + depth * INDENT;
  const cy = yOffset + thisH / 2;

  // Build child rows + SVG lines
  let childOffset = yOffset + thisH;
  const childElements: React.ReactNode[] = [];
  const svgLines: React.ReactNode[] = [];

  if (hasChildren && !isCollapsed) {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childH = NODE_H;
      const childCy = childOffset + childH / 2;
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

      const childVisiblePx = countVisiblePx(child, tree, collapsedSet, pendingMap);
      childElements.push(
        <TreeNode
          key={child.id}
          node={child}
          tree={tree}
          depth={depth + 1}
          bestSet={bestSet}
          selectedSet={selectedSet}
          inspectedId={inspectedId}
          expandingSet={expandingSet}
          pendingMap={pendingMap}
          onSelect={onSelect}
          onSelectPending={onSelectPending}
          collapsedSet={collapsedSet}
          onToggleCollapse={onToggleCollapse}
          yOffset={childOffset}
          sortMode={sortMode}
        />,
      );
      childOffset += childVisiblePx;
    }
  }

  // Pending expansion rows (in-flight LLM generations for this node)
  const pendingElements: React.ReactNode[] = [];
  if (!isCollapsed && pendingForNode.length > 0) {
    for (const pending of pendingForNode) {
      const pendCy = childOffset + PENDING_H / 2;
      const pendX = LINE_PAD_LEFT + (depth + 1) * INDENT;
      svgLines.push(
        <g key={`line-pending-${pending.id}`}>
          <line x1={x} y1={cy + DOT_R + 1} x2={x} y2={pendCy} stroke="rgba(245,158,11,0.2)" strokeWidth={1.5} strokeDasharray="3 2" />
          <line x1={x} y1={pendCy} x2={pendX - DOT_R - 2} y2={pendCy} stroke="rgba(245,158,11,0.2)" strokeWidth={1.5} strokeDasharray="3 2" />
        </g>,
      );
      pendingElements.push(
        <React.Fragment key={`pending-${pending.id}`}>
          <circle cx={pendX} cy={pendCy} r={DOT_R} fill="rgba(245,158,11,0.5)" className="animate-pulse" />
          <foreignObject x={pendX + DOT_R + 6} y={childOffset} width={`calc(100% - ${pendX + DOT_R + 6}px)`} height={PENDING_H}>
            <button
              onClick={() => onSelectPending(pending.id)}
              className="flex items-center gap-1.5 w-full h-full text-left px-1.5 pr-2 rounded transition-colors hover:bg-amber-500/8"
            >
              {/* Markov indicator */}
              <span className="w-7 shrink-0 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-amber-500/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" />
                  <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" />
                  <circle cx="12" cy="12" r="1.2" fill="currentColor" />
                </svg>
              </span>
              <span className="font-mono text-[12px] font-bold w-7 text-right shrink-0 text-amber-500/50">···</span>
              <span className="text-[11px] text-amber-400/70 truncate flex-1 animate-pulse">
                Generating...
              </span>
              {/* Fixed-width columns matching completed node rows */}
              <span className="w-16 text-right text-[9px] text-amber-500/40 shrink-0">
                {pending.streamText.length > 0 ? `${Math.round(pending.streamText.length / 4)} tok` : 'starting…'}
              </span>
              <span className="w-5 shrink-0" />
              <span className="w-10 shrink-0" />
              <span className="w-4 shrink-0" />
            </button>
          </foreignObject>
        </React.Fragment>,
      );
      childOffset += PENDING_H;
    }
  }

  return (
    <>
      {/* SVG connector lines (rendered in the shared SVG layer) */}
      {svgLines}

      {/* Node dot */}
      <circle cx={x} cy={cy} r={DOT_R} fill={dotColor} className={isExp ? 'animate-pulse' : ''} />

      {/* Collapse/expand toggle on dot for nodes with children */}
      {(hasChildren || pendingForNode.length > 0) && (
        <circle
          cx={x} cy={cy} r={DOT_R + 4}
          fill="transparent"
          className="cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(node.id); }}
        />
      )}

      {/* HTML overlay: score + arc name (positioned absolutely in the foreignObject) */}
      <foreignObject x={x + DOT_R + 6} y={yOffset} width={`calc(100% - ${x + DOT_R + 6}px)`} height={thisH}>
        <button
          onClick={() => onSelect(node.id)}
          className={`flex flex-col justify-center w-full h-full text-left px-1.5 pr-2 rounded transition-colors group ${
            isInspected ? 'bg-blue-500/15' : isSelected ? 'bg-blue-500/8' : isBest ? 'bg-green-500/5' : 'hover:bg-white/3'
          }`}
        >
          {/* Row 1: score + arc name + meta */}
          <span className="flex items-center gap-1.5 w-full">
            {/* Markov indicator */}
            <span className="w-7 shrink-0 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-text-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" />
                <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" />
                <circle cx="12" cy="12" r="1.2" fill="currentColor" />
              </svg>
            </span>
            <span className={`font-mono text-[12px] font-bold w-7 text-right shrink-0 ${scoreColorClass(sc)}`}>{sc}</span>
            <span className={`text-[11px] truncate flex-1 ${
              isInspected ? 'text-blue-300 font-medium' : isSelected ? 'text-blue-300' : isBest ? 'text-green-300' : 'text-text-primary'
            }`}>
              {node.arc.name}
            </span>
            {/* Move type label — fixed width for alignment */}
            {/* Compact cube sequence for scenes */}
            <span className="w-20 flex items-center justify-end gap-px shrink-0">
              {node.scenes.slice(0, 6).map((s, si) => {
                const forceMap = computeForceSnapshots(node.scenes);
                const forces = forceMap[s.id];
                if (!forces) return null;
                const corner = detectCubeCorner(forces);
                const COLORS: Record<string, string> = {
                  HHH: '#f59e0b', HHL: '#ef4444', HLH: '#a855f7', HLL: '#6366f1',
                  LHH: '#22d3ee', LHL: '#22c55e', LLH: '#3b82f6', LLL: '#6b7280',
                };
                return (
                  <div key={si} className="w-2 h-2 rounded-sm" style={{ backgroundColor: COLORS[corner.key] ?? '#6b7280' }} title={corner.name} />
                );
              })}
            </span>
            {/* Scene count — fixed width for alignment */}
            <span className="w-5 text-right text-[9px] text-text-dim shrink-0">{node.scenes.length}s</span>
            {/* Sparkline — fixed narrow container for alignment */}
            <span className="w-10 shrink-0 flex items-center justify-end">
              {spark.points.length > 1 && (() => {
                const W = 36;
                return (
                  <svg width={W} height="14" viewBox={`0 0 ${W} 14`}>
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
            </span>
            <span className="w-4 text-[9px] text-text-dim shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-right">
              {node.visitCount > 1 ? `${node.visitCount}v` : ''}
            </span>
            {isCollapsed && (hasChildren || pendingForNode.length > 0) && (
              <span className="text-[9px] text-text-dim/50 shrink-0">+{children.length + pendingForNode.length}</span>
            )}
          </span>
          {/* Row 2: scene summary (scene moves) or direction vector (arc moves) */}
          {node.moveType === 'scene' && node.scenes.length === 1 ? (
            <span className="text-[10px] text-text-dim leading-tight pl-15.5 pr-1 truncate">
              {node.scenes[0].summary}
            </span>
          ) : node.arc.directionVector && (
            <span className="text-[10px] text-text-dim leading-tight pl-15.5 pr-1">
              {node.arc.directionVector}
            </span>
          )}
        </button>
      </foreignObject>

      {childElements}
      {pendingElements}
    </>
  );
}

// ── Tree View ────────────────────────────────────────────────────────────────

function MCTSTreeView({
  tree,
  bestPath,
  selectedPath,
  inspectedId,
  expandingNodeIds,
  pendingExpansions,
  onSelectNode,
  onSelectPending,
}: {
  tree: MCTSTree;
  bestPath: MCTSNodeId[] | null;
  selectedPath: MCTSNodeId[] | null;
  inspectedId: MCTSNodeId | null;
  expandingNodeIds: MCTSNodeId[];
  pendingExpansions: Record<string, PendingExpansion>;
  onSelectNode: (nodeId: MCTSNodeId) => void;
  onSelectPending: (id: string) => void;
}) {
  const bestSet = useMemo(() => new Set(bestPath ?? []), [bestPath]);
  const selectedSet = useMemo(() => new Set(selectedPath ?? []), [selectedPath]);
  const expandingSet = useMemo(() => new Set(expandingNodeIds), [expandingNodeIds]);
  const [collapsedSet, setCollapsedSet] = useState<Set<MCTSNodeId>>(new Set());
  const [sortMode, setSortMode] = useState<TreeSortMode>('time');

  // Group pending expansions by parent node
  const pendingMap = useMemo(() => {
    const map = new Map<MCTSNodeId | 'root', PendingExpansion[]>();
    for (const p of Object.values(pendingExpansions)) {
      const list = map.get(p.parentId) ?? [];
      list.push(p);
      map.set(p.parentId, list);
    }
    return map;
  }, [pendingExpansions]);

  const handleToggleCollapse = useCallback((id: MCTSNodeId) => {
    setCollapsedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const rootChildren = sortChildren(
    tree.rootChildIds.map((id) => tree.nodes[id]).filter(Boolean),
    sortMode,
  );
  const rootPending = pendingMap.get('root') ?? [];

  if (rootChildren.length === 0 && rootPending.length === 0) return null;

  // Count total visible pixel height for SVG sizing
  const totalPx = rootChildren.reduce(
    (sum, node) => sum + countVisiblePx(node, tree, collapsedSet, pendingMap), 0,
  ) + rootPending.length * PENDING_H;
  const svgHeight = totalPx + 8;

  // Build root-level nodes with pixel offsets
  let pxOffset = 0;
  const nodeElements = rootChildren.map((node) => {
    const offset = pxOffset;
    pxOffset += countVisiblePx(node, tree, collapsedSet, pendingMap);
    return (
      <TreeNode
        key={node.id}
        node={node}
        tree={tree}
        depth={0}
        bestSet={bestSet}
        selectedSet={selectedSet}
        inspectedId={inspectedId}
        expandingSet={expandingSet}
        pendingMap={pendingMap}
        onSelect={onSelectNode}
        onSelectPending={onSelectPending}
        collapsedSet={collapsedSet}
        onToggleCollapse={handleToggleCollapse}
        yOffset={offset}
        sortMode={sortMode}
      />
    );
  });

  // Render root-level pending expansions
  const rootPendingElements = rootPending.map((pending) => {
    const cy = pxOffset + PENDING_H / 2;
    const px = LINE_PAD_LEFT;
    const el = (
      <React.Fragment key={`pending-root-${pending.id}`}>
        <circle cx={px} cy={cy} r={DOT_R} fill="rgba(245,158,11,0.5)" className="animate-pulse" />
        <foreignObject x={px + DOT_R + 6} y={pxOffset} width={`calc(100% - ${px + DOT_R + 6}px)`} height={PENDING_H}>
          <button
            onClick={() => onSelectPending(pending.id)}
            className="flex items-center gap-1.5 w-full h-full text-left px-1.5 pr-2 rounded transition-colors hover:bg-amber-500/8"
          >
            {/* Markov indicator */}
            <span className="w-7 shrink-0 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-amber-500/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" />
                <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" />
                <circle cx="12" cy="12" r="1.2" fill="currentColor" />
              </svg>
            </span>
            <span className="font-mono text-[12px] font-bold w-7 text-right shrink-0 text-amber-500/50">···</span>
            <span className="text-[11px] text-amber-400/70 truncate flex-1 animate-pulse">
              Generating...
            </span>
            {/* Fixed-width columns matching completed node rows */}
            <span className="w-16 text-right text-[9px] text-amber-500/40 shrink-0">
              {pending.streamText.length > 0 ? `${Math.round(pending.streamText.length / 4)} tok` : 'starting…'}
            </span>
            <span className="w-5 shrink-0" />
            <span className="w-10 shrink-0" />
            <span className="w-4 shrink-0" />
          </button>
        </foreignObject>
      </React.Fragment>
    );
    pxOffset += PENDING_H;
    return el;
  });

  return (
    <div className="overflow-auto p-1">
      {/* Sort toggle */}
      <div className="flex items-center gap-1 px-1 pb-1 mb-1 border-b border-border">
        <span className="text-[9px] uppercase tracking-widest text-text-dim mr-1">Sort</span>
        <button
          onClick={() => setSortMode('time')}
          className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${sortMode === 'time' ? 'text-text-primary bg-white/8' : 'text-text-dim hover:text-text-secondary'}`}
        >
          Time
        </button>
        <button
          onClick={() => setSortMode('value')}
          className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${sortMode === 'value' ? 'text-text-primary bg-white/8' : 'text-text-dim hover:text-text-secondary'}`}
        >
          Score
        </button>
      </div>
      <svg width="100%" height={svgHeight} className="block">
        {nodeElements}
        {rootPendingElements}
      </svg>
    </div>
  );
}

// ── Pending Expansion Inspector (LLM stream) ────────────────────────────────

function PendingInspector({ pending }: { pending: PendingExpansion }) {
  const streamRef = React.useRef<HTMLPreElement>(null);

  // Auto-scroll to bottom as stream grows
  React.useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [pending.streamText]);

  const elapsed = Math.round((Date.now() - pending.startedAt) / 1000);

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-[10px] uppercase tracking-widest text-amber-400/70">Generating</h2>
          <span className="animate-pulse text-amber-400">●</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <svg className="w-4 h-4 text-amber-500/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" />
            <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" />
            <circle cx="12" cy="12" r="1.2" fill="currentColor" />
          </svg>
          <span className="text-sm text-text-primary font-medium">Markov sequence</span>
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-[10px] text-text-dim uppercase tracking-wider">
        <span>{elapsed}s elapsed</span>
        <span>{pending.streamText.length > 0 ? `${Math.round(pending.streamText.length / 4)} tokens` : 'waiting…'}</span>
        <span>parent: {pending.parentId === 'root' ? 'root' : pending.parentId}</span>
      </div>

      {/* Stream output */}
      <div className="flex-1 min-h-0 flex flex-col">
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim mb-1">LLM Stream</h3>
        <pre
          ref={streamRef}
          className="flex-1 min-h-0 overflow-auto rounded bg-black/40 border border-border p-3 text-[11px] text-text-secondary font-mono leading-relaxed whitespace-pre-wrap wrap-break-word"
        >
          {pending.streamText || <span className="text-text-dim italic">Waiting for first tokens…</span>}
        </pre>
      </div>
    </div>
  );
}

// ── Node Inspector ───────────────────────────────────────────────────────────

type InspectorView = 'arc' | number; // 'arc' = summary list, number = scene index

function NodeInspector({ node, tree }: { node: MCTSNode; tree: MCTSTree }) {
  const [view, setView] = useState<InspectorView>('arc');

  // For scene moves, find the root ancestor and collect all scenes down the path
  const { displayNode, allPathScenes } = useMemo(() => {
    if (node.moveType !== 'scene') return { displayNode: node, allPathScenes: node.scenes };
    // Walk up to find the root ancestor (depth 0)
    let rootAncestor = node;
    let currentId: string | null = node.parentId;
    while (currentId) {
      const parent = tree.nodes[currentId];
      if (!parent) break;
      rootAncestor = parent;
      currentId = parent.parentId;
    }
    // Walk down from root ancestor to this node, collecting all scenes
    const scenes: Scene[] = [];
    const pathIds: MCTSNodeId[] = [];
    let walkId: MCTSNodeId | null = node.id;
    while (walkId) {
      pathIds.unshift(walkId);
      walkId = tree.nodes[walkId]?.parentId ?? null;
    }
    for (const id of pathIds) {
      const n = tree.nodes[id];
      if (n) scenes.push(...n.scenes);
    }
    return { displayNode: rootAncestor, allPathScenes: scenes };
  }, [node, tree]);


  // Full-path delivery curve for this node
  const pathDelivery = useMemo(() => {
    const allScenes = node.virtualResolvedKeys
      .map((k) => node.virtualNarrative.scenes[k])
      .filter((s): s is Scene => !!s);
    if (allScenes.length === 0) return { pts: [], position: null, arcStart: 0, nodeStart: 0 };
    const forceMap = computeForceSnapshots(allScenes);
    const ordered = allScenes.map((s) => forceMap[s.id]).filter(Boolean);
    const pts = computeDeliveryCurve(ordered);
    const position = pts.length > 0 ? classifyCurrentPosition(pts) : null;
    // Where the arc's scenes start (for background highlight)
    const arcStart = allScenes.length - allPathScenes.length;
    // Where this specific node's scene(s) start (for bright highlight)
    const nodeStart = allScenes.length - node.scenes.length;
    return { pts, position, arcStart, nodeStart };
  }, [node, allPathScenes]);

  // Reset to arc view when node changes
  const [prevNodeId, setPrevNodeId] = useState(node.id);
  if (node.id !== prevNodeId) {
    setPrevNodeId(node.id);
    setView('arc');
  }

  const scene = typeof view === 'number' ? allPathScenes[view] : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <div className="flex items-baseline gap-2">
          <h2 className="text-[10px] uppercase tracking-widest text-text-dim">Arc</h2>
          <span className="font-mono text-[10px] text-text-dim">{displayNode.arc.id}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`font-mono text-sm font-bold ${scoreColorClass(node.immediateScore)}`}>
            {node.immediateScore}
          </span>
          <span className="text-sm text-text-primary font-medium">{displayNode.arc.name}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-[10px] text-text-dim uppercase tracking-wider">
        <span>{allPathScenes.length} scenes</span>
        <span>depth {node.depth}</span>
        <span>{node.visitCount} visits</span>
        {node.childIds.length > 0 && <span>{node.childIds.length} children</span>}
      </div>

      {/* Cube sequence — shows the actual scene transitions */}
      {allPathScenes.length > 0 && (() => {
        const vScenes = node.virtualResolvedKeys
          .map((k) => node.virtualNarrative.scenes[k])
          .filter((s): s is Scene => !!s);
        const fMap = computeForceSnapshots(vScenes);
        const CC: Record<string, string> = {
          HHH: '#f59e0b', HHL: '#ef4444', HLH: '#a855f7', HLL: '#6366f1',
          LHH: '#22d3ee', LHL: '#22c55e', LLH: '#3b82f6', LLL: '#6b7280',
        };
        return (
          <div>
            <span className="text-[10px] uppercase tracking-wider text-text-dim block mb-1.5">Sequence</span>
            <div className="flex items-center flex-wrap gap-y-1">
              {allPathScenes.map((s, i) => {
                const f = fMap[s.id];
                const c = f ? detectCubeCorner(f) : null;
                return (
                  <span key={s.id} className="flex items-center">
                    {i > 0 && <span className="text-text-dim/25 text-[11px] mx-0.5">→</span>}
                    <span className="flex items-center gap-0.5 px-1 py-0.5 rounded" style={{ backgroundColor: c ? `${CC[c.key]}15` : 'transparent' }}>
                      {c && (
                        <svg width="15" height="8" viewBox="0 0 15 8">
                          {['P','C','K'].map((_, fi) => {
                            const isHi = c.key[fi] === 'H';
                            const cols = ['#EF4444', '#22C55E', '#3B82F6'];
                            return <rect key={fi} x={fi * 5.5} y={isHi ? 0 : 4} width={4} height={isHi ? 7 : 3} rx={0.8} fill={cols[fi]} opacity={isHi ? 0.8 : 0.2} />;
                          })}
                        </svg>
                      )}
                      <span className="text-[9px] font-medium" style={{ color: c ? CC[c.key] : '#6b7280' }}>
                        {c?.name ?? '?'}
                      </span>
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Delivery chart */}
      {pathDelivery.pts.length > 1 && (() => {
        const { pts, position, arcStart, nodeStart } = pathDelivery;
        const n = pts.length;
        const W = 260, H = 48;
        const smoothed = pts.map((p) => p.smoothed);
        const min = Math.min(...smoothed);
        const max = Math.max(...smoothed);
        const range = max - min || 1;
        const toY = (v: number) => H - ((v - min) / range) * (H - 4) - 2;
        const allPts = smoothed.map((v, i) => `${(i / (n - 1)) * W},${toY(v)}`).join(' ');
        // Arc range (dim) + node's specific scenes (bright)
        const arcPts = smoothed.slice(arcStart).map((v, i) =>
          `${((arcStart + i) / (n - 1)) * W},${toY(v)}`
        ).join(' ');
        const nodePts = smoothed.slice(nodeStart).map((v, i) =>
          `${((nodeStart + i) / (n - 1)) * W},${toY(v)}`
        ).join(' ');
        const arcX1 = (arcStart / (n - 1)) * W;
        const nodeX1 = (nodeStart / (n - 1)) * W;
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase tracking-widest text-text-dim">Delivery</span>
              {position && (
                <span className="text-[9px] font-medium" style={{ color: POSITION_COLORS[position.key] ?? 'white' }}>
                  {position.name}
                </span>
              )}
            </div>
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="rounded bg-white/2">
              {/* Arc range background */}
              <rect x={arcX1} y={0} width={W - arcX1} height={H} fill="rgba(245,158,11,0.04)" />
              {/* Node's scene highlight */}
              <rect x={nodeX1} y={0} width={W - nodeX1} height={H} fill="rgba(245,158,11,0.08)" />
              {/* Prior path */}
              <polyline points={allPts} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeLinejoin="round" />
              {/* Arc's scenes (dim) */}
              {arcPts && <polyline points={arcPts} fill="none" stroke="rgba(245,158,11,0.4)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />}
              {/* Selected node's scene (bright) */}
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
      {displayNode.arc.develops.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Develops</h3>
          <div className="flex flex-col gap-1">
            {displayNode.arc.develops.map((threadId) => {
              const thread = node.virtualNarrative.threads[threadId];
              // Collect all transitions for this thread across path scenes
              const transitions = allPathScenes.flatMap((s) =>
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
          Scenes ({allPathScenes.length})
        </button>
        {scene && (
          <span className="text-[10px] text-text-dim mx-1">›</span>
        )}
        {scene && (
          <span className="text-[10px] text-blue-400">Scene {(view as number) + 1}</span>
        )}
      </div>

      {/* Arc view — scene summary list with cube positions */}
      {view === 'arc' && (() => {
        // Compute forces for all scenes so we can classify each
        const allVirtualScenes = node.virtualResolvedKeys
          .map((k) => node.virtualNarrative.scenes[k])
          .filter((s): s is Scene => !!s);
        const forceMap = computeForceSnapshots(allVirtualScenes);
        const CCOLORS: Record<string, string> = {
          HHH: '#f59e0b', HHL: '#ef4444', HLH: '#a855f7', HLL: '#6366f1',
          LHH: '#22d3ee', LHL: '#22c55e', LLH: '#3b82f6', LLL: '#6b7280',
        };

        return (
          <div className="flex flex-col gap-2">
            {allPathScenes.map((s, i) => {
              const loc = node.virtualNarrative.locations[s.locationId];
              const pov = s.povId ? node.virtualNarrative.characters[s.povId] : null;
              const forces = forceMap[s.id];
              const sceneCorner = forces ? detectCubeCorner(forces) : null;
              return (
              <button
                key={s.id}
                type="button"
                onClick={() => setView(i)}
                className="group flex flex-col gap-1 rounded bg-white/3 p-2 text-left transition-colors hover:bg-white/[0.07]"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-text-dim">{i + 1}</span>
                  {/* Cube position badge */}
                  {sceneCorner && (
                    <span className="flex items-center gap-1">
                      <svg width="18" height="10" viewBox="0 0 18 10">
                        {['P','C','K'].map((label, fi) => {
                          const isHi = sceneCorner.key[fi] === 'H';
                          const colors = ['#EF4444', '#22C55E', '#3B82F6'];
                          return <rect key={fi} x={fi * 6.5} y={isHi ? 1 : 5} width={5} height={isHi ? 8 : 4} rx={1} fill={colors[fi]} opacity={isHi ? 0.8 : 0.25} />;
                        })}
                      </svg>
                      <span className="text-[9px] font-medium" style={{ color: CCOLORS[sceneCorner.key] }}>
                        {sceneCorner.name}
                      </span>
                    </span>
                  )}
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
        );
      })()}

      {/* Scene detail view */}
      {scene && (() => {
        // Build the full scene timeline: all resolved scenes from the virtual narrative
        // (which includes real commits + ancestor MCTS nodes + this node's scenes)
        const allScenes = node.virtualResolvedKeys
          .map((k) => node.virtualNarrative.scenes[k])
          .filter((s): s is Scene => !!s);
        const forceMap = computeForceSnapshots(allScenes);
        const forces = forceMap[scene.id] ?? { payoff: 0, change: 0, knowledge: 0 };
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
            <span className="text-[10px] text-text-dim uppercase tracking-wider">{displayNode.arc.name}</span>
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
                { label: 'Knowledge', value: forces.knowledge, color: '#3B82F6' },
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

          {/* Continuity Mutations */}
          {scene.continuityMutations.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Continuity</h3>
              {scene.continuityMutations.map((km, j) => {
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

          {/* World Knowledge Mutations */}
          {scene.worldKnowledgeMutations && (scene.worldKnowledgeMutations.addedNodes?.length > 0 || scene.worldKnowledgeMutations.addedEdges?.length > 0) && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">World Knowledge</h3>
              {scene.worldKnowledgeMutations.addedNodes?.map((wkn, j) => (
                <div key={`wkn-${j}`} className="flex items-center gap-1.5 text-xs">
                  <span className="text-change">+</span>
                  <span className="text-text-primary">{wkn.concept}</span>
                  <span className="text-[10px] text-text-dim">({wkn.type})</span>
                </div>
              ))}
              {scene.worldKnowledgeMutations.addedEdges?.map((wke, j) => {
                const fromNode = node.virtualNarrative.worldKnowledge?.nodes?.[wke.from];
                const toNode = node.virtualNarrative.worldKnowledge?.nodes?.[wke.to];
                const shortName = (concept: string) => { const d = concept.indexOf(' — '); return d > 0 ? concept.slice(0, d) : concept; };
                return (
                  <div key={`wke-${j}`} className="text-xs pl-3 text-text-dim">
                    {shortName(fromNode?.concept ?? wke.from)} <span className="italic">{wke.relation}</span> {shortName(toNode?.concept ?? wke.to)}
                  </div>
                );
              })}
            </div>
          )}

          {/* Character Movements */}
          {scene.characterMovements && Object.keys(scene.characterMovements).length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Movements</h3>
              {Object.entries(scene.characterMovements).map(([charId, mv]) => {
                const charName = node.virtualNarrative.characters[charId]?.name ?? charId;
                const locName = node.virtualNarrative.locations[mv.locationId]?.name ?? mv.locationId;
                return (
                  <div key={charId} className="flex flex-col gap-0.5 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-text-primary">{charName}</span>
                      <span className="text-text-dim">&rarr;</span>
                      <span className="text-text-secondary">{locName}</span>
                    </div>
                    {mv.transition && <span className="text-[10px] text-text-dim italic pl-2">{mv.transition}</span>}
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

type ConfigTab = 'search' | 'move' | 'strategy' | 'direction';


// ── Main Panel ───────────────────────────────────────────────────────────────

type MCTSHook = ReturnType<typeof useMCTS>;

export function MCTSPanel({ isOpen, onClose, mcts }: { isOpen: boolean; onClose: () => void; mcts: MCTSHook }) {
  const { state } = useStore();
  const { runState, start, pause, resume, stop, selectPath, commitPath, continueSearch } = mcts;

  // Initialize config, prepopulating north star from story settings direction
  const [config, setConfig] = useState<MCTSConfig>(() => {
    const storyDir = state.activeNarrative?.storySettings?.storyDirection?.trim();
    const storyCon = state.activeNarrative?.storySettings?.storyConstraints?.trim();
    return {
      ...DEFAULT_MCTS_CONFIG,
      ...(storyDir ? { direction: storyDir } : {}),
      ...(storyCon ? { constraintsPrompt: storyCon } : {}),
    };
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
  const [inspectedPendingId, setInspectedPendingId] = useState<string | null>(null);
  const inspectedNode = inspectedNodeId ? runState.tree.nodes[inspectedNodeId] ?? null : null;
  const inspectedPending = inspectedPendingId ? runState.pendingExpansions[inspectedPendingId] ?? null : null;

  const handleSelectPending = useCallback((pendingId: string) => {
    setInspectedPendingId(pendingId);
    setInspectedNodeId(null);
  }, []);

  const handleSelectNode = useCallback((nodeId: MCTSNodeId) => {
    // Always inspect the clicked node
    setInspectedNodeId(nodeId);
    setInspectedPendingId(null);
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
    stop();
    onClose();
  }, [commitPath, stop, onClose]);

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
              { label: 'Move', value: 'move' as ConfigTab },
              { label: 'Strategy', value: 'strategy' as ConfigTab },
              { label: 'Direction', value: 'direction' as ConfigTab },
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
                        <div className="text-[9px] text-text-dim">Generate a fixed total number of {config.moveType === 'scene' ? 'scenes' : 'arcs'} (LLM calls)</div>
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
                    <input type="range" min={15} max={300} step={15} value={config.timeLimitSeconds} onChange={(e) => setConfig((c) => ({ ...c, timeLimitSeconds: Number(e.target.value) }))} className="w-full h-1 appearance-none bg-white/10 rounded-full accent-white/60 cursor-pointer [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white/80 [&::-webkit-slider-thumb]:appearance-none" />
                    <p className="text-[9px] text-text-dim mt-0.5">Search runs until this time elapses. More time = more nodes explored.</p>
                  </div>
                )}

                {/* Iterations slider */}
                {config.stopMode === 'iterations' && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] uppercase tracking-widest text-text-dim">Max {config.moveType === 'scene' ? 'Scenes' : 'Arcs'} (LLM calls)</label>
                      <span className="text-xs font-mono text-text-primary">{config.maxNodes}</span>
                    </div>
                    <input type="range" min={5} max={200} step={5} value={config.maxNodes} onChange={(e) => setConfig((c) => ({ ...c, maxNodes: Number(e.target.value) }))} className="w-full h-1 appearance-none bg-white/10 rounded-full accent-white/60 cursor-pointer [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white/80 [&::-webkit-slider-thumb]:appearance-none" />
                    <p className="text-[9px] text-text-dim mt-0.5">Total {config.moveType === 'scene' ? 'scenes' : 'arcs'} to generate across the whole tree. Each {config.moveType === 'scene' ? 'scene' : 'arc'} = one LLM call. With {config.parallelism} parallel workers, expect ~{Math.ceil(config.maxNodes / config.parallelism)} rounds of generation.</p>
                  </div>
                )}

                <div className="border-t border-border pt-4">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-3">Parallelism &amp; Branching</label>

                  {/* Parallelism */}
                  <div className="mb-3">
                    <span className="text-[10px] text-text-secondary block mb-1.5">Parallel workers</span>
                    <div className="flex gap-1.5">
                      {[1, 2, 4, 6, 8, 10, 12].map((v) => (
                        <button
                          key={v}
                          onClick={() => setConfig((c) => ({ ...c, parallelism: v }))}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-mono transition-colors ${
                            config.parallelism === v
                              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                              : 'bg-white/4 text-text-dim hover:bg-white/8 border border-transparent'
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                    <p className="text-[9px] text-text-dim mt-1.5">How many {config.moveType === 'scene' ? 'scenes' : 'arcs'} are generated simultaneously.</p>
                  </div>

                  {/* Branching factor */}
                  <div>
                    <span className="text-[10px] text-text-secondary block mb-1.5">Branching factor</span>
                    <div className="flex gap-1.5">
                      {[1, 2, 4, 6, 8, 10, 12].map((v) => (
                        <button
                          key={v}
                          onClick={() => setConfig((c) => ({ ...c, branchingFactor: v }))}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-mono transition-colors ${
                            config.branchingFactor === v
                              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                              : 'bg-white/4 text-text-dim hover:bg-white/8 border border-transparent'
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                    <p className="text-[9px] text-text-dim mt-1.5">Max children per node. Lower values force deeper exploration.</p>
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
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.searchMode === 'constrained' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="searchMode" checked={config.searchMode === 'constrained'} onChange={() => setConfig((c) => ({ ...c, searchMode: 'constrained', branchingFactor: DEFAULT_BRANCHING[c.directionMode] }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Constrained</div>
                        <div className="text-[9px] text-text-dim">Complete tree. Every node at each depth gets exactly {config.directionMode === 'delivery' ? '4' : '8'} children ({config.directionMode === 'delivery' ? 'all delivery directions' : 'all cube corners'}) before going deeper. Branching factor {DEFAULT_BRANCHING[config.directionMode]}. Depth grows until time or iteration limit is reached.</div>
                      </div>
                    </label>
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.searchMode === 'freedom' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="searchMode" checked={config.searchMode === 'freedom'} onChange={() => setConfig((c) => ({ ...c, searchMode: 'freedom', branchingFactor: DEFAULT_BRANCHING[c.directionMode] }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Freedom</div>
                        <div className="text-[9px] text-text-dim">Dynamic allocation. UCB1 decides which branches to grow — promising paths get more children, dead ends are abandoned. Tree shape is organic.</div>
                      </div>
                    </label>
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.searchMode === 'baseline' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="searchMode" checked={config.searchMode === 'baseline'} onChange={() => setConfig((c) => ({ ...c, searchMode: 'baseline' }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Baseline</div>
                        <div className="text-[9px] text-text-dim">Quality gating. At each depth, keep generating until one meets the target score, then descend and repeat. No child limit — directions can be retried.</div>
                      </div>
                    </label>
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.searchMode === 'greedy' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="searchMode" checked={config.searchMode === 'greedy'} onChange={() => setConfig((c) => ({ ...c, searchMode: 'greedy' }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Greedy</div>
                        <div className="text-[9px] text-text-dim">Depth-first. Generate {config.branchingFactor} children at each level, pick the best, descend immediately. Produces a single deep path — maximises depth with minimal branching.</div>
                      </div>
                    </label>
                  </div>
                  {config.searchMode === 'baseline' && (
                    <div className="mt-3 pl-6">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-text-secondary">Target score per layer</span>
                        <span className="text-xs font-mono text-text-primary">{config.baselineScore}</span>
                      </div>
                      <input type="range" min={50} max={90} step={5} value={config.baselineScore} onChange={(e) => setConfig((c) => ({ ...c, baselineScore: Number(e.target.value) }))} className="w-full h-1 appearance-none bg-white/10 rounded-full accent-white/60 cursor-pointer [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white/80 [&::-webkit-slider-thumb]:appearance-none" />
                      <p className="text-[9px] text-text-dim mt-0.5">Search continues at each depth until an arc scores at least this value. Higher = pickier but slower.</p>
                    </div>
                  )}
                </div>

              </>
            )}

            {configTab === 'move' && (
              <>
                {/* Move type */}
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">Move Type</label>
                  <div className="flex flex-col gap-1.5">
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.moveType === 'arc' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="moveType" checked={config.moveType === 'arc'} onChange={() => setConfig((c) => ({ ...c, moveType: 'arc' }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Arc Moves</div>
                        <div className="text-[9px] text-text-dim">Each move generates a full arc (multiple scenes).</div>
                      </div>
                    </label>
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.moveType === 'scene' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="moveType" checked={config.moveType === 'scene'} onChange={() => setConfig((c) => ({ ...c, moveType: 'scene' }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Scene Moves</div>
                        <div className="text-[9px] text-text-dim">Each move generates a single scene with a new arc.</div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Pacing info */}
                <div className="border-t border-border pt-4">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">Pacing</label>
                  <p className="text-[10px] text-text-dim leading-snug">
                    Scene pacing is automatically sequenced using the Markov chain rhythm profile set in Story Settings. Each expansion samples a probabilistic route from the transition matrix, ensuring varied force profiles across scenes.
                  </p>
                </div>
              </>
            )}

            {configTab === 'direction' && (
              <>
                <GuidanceFields
                  direction={config.direction ?? ''}
                  constraints={config.constraintsPrompt ?? ''}
                  onDirectionChange={(v) => setConfig((c) => ({ ...c, direction: v || undefined }))}
                  onConstraintsChange={(v) => setConfig((c) => ({ ...c, constraintsPrompt: v || undefined }))}
                />

                {/* World Build Focus */}
                {(() => {
                  const narrative = state.activeNarrative;
                  const resolvedSet = new Set(state.resolvedEntryKeys);
                  const worldBuildEntries = narrative
                    ? Object.values(narrative.worldBuilds).filter((wb) => resolvedSet.has(wb.id))
                    : [];
                  if (worldBuildEntries.length === 0) return null;
                  return (
                    <div className="border-t border-border pt-4">
                      <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1.5">World Build Focus</label>
                      <div className="flex flex-col gap-1 max-h-24 overflow-y-auto">
                        {worldBuildEntries.map((wb) => {
                          const manifest = wb.expansionManifest;
                          const parts: string[] = [];
                          if (manifest.characters.length > 0) parts.push(`${manifest.characters.length} char${manifest.characters.length > 1 ? 's' : ''}`);
                          if (manifest.locations.length > 0) parts.push(`${manifest.locations.length} loc${manifest.locations.length > 1 ? 's' : ''}`);
                          if (manifest.threads.length > 0) parts.push(`${manifest.threads.length} thread${manifest.threads.length > 1 ? 's' : ''}`);
                          const isSelected = config.worldBuildFocusId === wb.id;
                          return (
                            <button
                              key={wb.id}
                              type="button"
                              onClick={() => setConfig((c) => ({ ...c, worldBuildFocusId: isSelected ? undefined : wb.id }))}
                              className={`rounded-lg px-3 py-2 text-left transition border ${
                                isSelected
                                  ? 'bg-amber-500/10 border-amber-500/30'
                                  : 'bg-bg-elevated border-border hover:border-white/16'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className={`text-xs line-clamp-1 ${isSelected ? 'text-amber-300' : 'text-text-primary'}`}>{wb.summary}</p>
                                {isSelected && <span className="text-[9px] text-amber-400 shrink-0 uppercase tracking-wider">Focus</span>}
                              </div>
                              <p className="text-[10px] text-text-dim mt-0.5">{parts.join(', ')}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}

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
              expandingNodeIds={runState.expandingNodeIds}
              pendingExpansions={runState.pendingExpansions}
              onSelectNode={handleSelectNode}
              onSelectPending={handleSelectPending}
            />
          </div>

          {/* Inspector */}
          <div className="w-105 shrink-0 overflow-auto border border-border rounded-lg bg-bg-elevated/50 p-4">
            {inspectedPending ? (
              <PendingInspector pending={inspectedPending} />
            ) : inspectedNode ? (
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
                  Commit {activePath?.length ?? 0} {runState.config.moveType === 'scene' ? 'Scene' : 'Arc'}{(activePath?.length ?? 0) !== 1 ? 's' : ''}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
