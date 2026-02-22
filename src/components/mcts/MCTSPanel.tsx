'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type { MCTSConfig, MCTSNodeId, MCTSNode, MCTSTree } from '@/types/mcts';
import { DEFAULT_MCTS_CONFIG } from '@/types/mcts';
import type { useMCTS } from '@/hooks/useMCTS';
import { treeSize, bestPath as computeBestPath } from '@/lib/mcts-engine';
import { NARRATIVE_CUBE } from '@/types/narrative';
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

// ── Tree Line (recursive chess-style) ────────────────────────────────────────

function TreeLine({
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
  prefix,
  isLast,
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
  prefix: string;
  isLast: boolean;
}) {
  const isBest = bestSet.has(node.id);
  const isSelected = selectedSet.has(node.id);
  const isInspected = inspectedId === node.id;
  const isExp = expandingNodeId === node.id;
  const isCollapsed = collapsedSet.has(node.id);
  const children = node.childIds
    .map((id) => tree.nodes[id])
    .filter(Boolean)
    .sort((a, b) => b.immediateScore - a.immediateScore);
  const hasChildren = children.length > 0;
  const sc = node.immediateScore;

  // Tree branch characters
  const connector = isLast ? '└─' : '├─';
  const childPrefix = prefix + (isLast ? '   ' : '│  ');

  return (
    <>
      {/* This node's line */}
      <button
        onClick={() => onSelect(node.id)}
        className={`flex items-center gap-0 w-full text-left py-0.5 px-2 rounded transition-colors group ${
          isInspected ? 'bg-blue-500/15 ring-1 ring-blue-500/30' : isSelected ? 'bg-blue-500/10' : isBest ? 'bg-green-500/5' : 'hover:bg-white/3'
        } ${isExp ? 'animate-pulse' : ''}`}
      >
        {/* Tree prefix characters */}
        <span className="text-text-dim/30 font-mono text-[11px] whitespace-pre select-none">{prefix}{connector} </span>

        {/* Score */}
        <span className={`font-mono text-[12px] font-bold w-7 text-right mr-2 ${scoreColorClass(sc)}`}>{sc}</span>

        {/* Arc name */}
        <span className={`text-[11px] truncate ${
          isInspected ? 'text-blue-300 font-medium' : isSelected ? 'text-blue-300' : isBest ? 'text-green-300' : 'text-text-primary'
        }`}>
          {node.arc.name}
        </span>

        {/* Metadata */}
        <span className="text-[9px] text-text-dim ml-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {node.scenes.length}s{node.visitCount > 1 ? ` · ${node.visitCount}v` : ''}
        </span>

        {/* Collapse indicator */}
        {hasChildren && (
          <span
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(node.id); }}
            className="ml-1 text-text-dim/40 hover:text-text-dim text-[9px] cursor-pointer shrink-0"
          >
            {isCollapsed ? `[+${children.length}]` : ''}
          </span>
        )}

        {/* Selection dot */}
        {isInspected && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />}
        {isSelected && !isInspected && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400/50 shrink-0" />}
        {isBest && !isSelected && !isInspected && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />}
      </button>

      {/* Children */}
      {hasChildren && !isCollapsed && children.map((child, i) => (
        <TreeLine
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
          prefix={childPrefix}
          isLast={i === children.length - 1}
        />
      ))}
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

  return (
    <div className="overflow-auto p-2 font-mono">
      {rootChildren.map((node, i) => (
        <TreeLine
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
          prefix=""
          isLast={i === rootChildren.length - 1}
        />
      ))}
    </div>
  );
}

// ── Node Inspector ───────────────────────────────────────────────────────────

type InspectorView = 'arc' | number; // 'arc' = summary list, number = scene index

function NodeInspector({ node, tree }: { node: MCTSNode; tree: MCTSTree }) {
  const [view, setView] = useState<InspectorView>('arc');
  const cubeLabel = node.cubeGoal ? NARRATIVE_CUBE[node.cubeGoal]?.name ?? null : null;

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

      {/* Cube goal */}
      {node.cubeGoal && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-text-dim">Cube</span>
          <span className="rounded bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] text-violet-400">{node.cubeGoal}</span>
          {cubeLabel && <span className="text-[10px] text-text-secondary">{cubeLabel}</span>}
        </div>
      )}

      {/* Develops */}
      {node.arc.develops.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Develops</h3>
          <div className="flex flex-wrap gap-1.5">
            {node.arc.develops.map((threadId) => (
              <span key={threadId} className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-primary">
                {threadId}
              </span>
            ))}
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
          {node.scenes.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setView(i)}
              className="group flex flex-col gap-1 rounded bg-white/[0.03] p-2 text-left transition-colors hover:bg-white/[0.07]"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-text-dim">{i + 1}</span>
                <span className="text-[10px] text-text-dim">{s.locationId}</span>
                {s.povId && (
                  <span className="text-[10px] text-text-dim ml-auto">POV: {s.povId}</span>
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
          ))}
        </div>
      )}

      {/* Scene detail view */}
      {scene && (
        <div className="flex flex-col gap-4">
          {/* Back button */}
          <button
            onClick={() => setView('arc')}
            className="flex items-center gap-1 text-[10px] text-text-dim hover:text-text-secondary transition-colors self-start"
          >
            <span>←</span> Back to arc
          </button>

          {/* Location + POV */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <svg className="w-3.5 h-3.5 shrink-0 text-text-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
              <span className="text-[10px] uppercase tracking-wider text-text-dim mr-1">Location</span>
              {scene.locationId}
            </div>
            {scene.povId && (
              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                <svg className="w-3.5 h-3.5 shrink-0 text-text-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span className="text-[10px] uppercase tracking-wider text-text-dim mr-1">POV</span>
                {scene.povId}
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
                {scene.participantIds.map((pid) => (
                  <span key={pid} className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary">{pid}</span>
                ))}
              </div>
            </div>
          )}

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
              {scene.threadMutations.map((tm, j) => (
                <div key={j} className="flex items-center gap-1.5 text-xs">
                  <span className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-primary">{tm.threadId}</span>
                  <span className="text-text-dim">{tm.from} → {tm.to}</span>
                </div>
              ))}
            </div>
          )}

          {/* Relationship Mutations */}
          {scene.relationshipMutations.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Relationships</h3>
              {scene.relationshipMutations.map((rm, j) => (
                <div key={j} className="flex items-center gap-1.5 text-xs">
                  <span className="text-text-primary">{rm.from}</span>
                  <span className="text-text-dim">→</span>
                  <span className="text-text-secondary">{rm.to}</span>
                  <span className="text-text-dim">{rm.type}</span>
                  <span className={`font-mono text-[10px] ${rm.valenceDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {rm.valenceDelta >= 0 ? '+' : ''}{rm.valenceDelta.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Knowledge Mutations */}
          {scene.knowledgeMutations.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Knowledge</h3>
              {scene.knowledgeMutations.map((km, j) => (
                <div key={j} className="flex items-start gap-1.5 text-xs">
                  <span className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-cyan-400 shrink-0">{km.characterId}</span>
                  <span className="text-text-secondary leading-relaxed">{km.content}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Config Tab ───────────────────────────────────────────────────────────────

type ConfigTab = 'search' | 'strategy';

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
    : runState.config.totalIterations > 0
      ? Math.round((runState.iterationsCompleted / runState.config.totalIterations) * 100)
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
                        <div className="text-[9px] text-text-dim">Run a fixed number of expansion steps</div>
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
                      <label className="text-[10px] uppercase tracking-widest text-text-dim">Iterations</label>
                      <span className="text-xs font-mono text-text-primary">{config.totalIterations}</span>
                    </div>
                    <input type="range" min={3} max={30} step={1} value={config.totalIterations} onChange={(e) => setConfig((c) => ({ ...c, totalIterations: Number(e.target.value) }))} className="w-full accent-blue-500" />
                    <p className="text-[9px] text-text-dim mt-0.5">Each iteration expands one node, generating {config.branchingFactor} new arcs.</p>
                  </div>
                )}

                <div className="border-t border-border pt-4">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-3">Tree Shape</label>

                  {/* Branching factor */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-text-secondary">Branches per node</span>
                      <span className="text-xs font-mono text-text-primary">{config.branchingFactor}</span>
                    </div>
                    <input type="range" min={2} max={8} step={1} value={config.branchingFactor} onChange={(e) => setConfig((c) => ({ ...c, branchingFactor: Number(e.target.value) }))} className="w-full accent-blue-500" />
                  </div>

                  {/* Max depth */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-text-secondary">Max depth</span>
                      <span className="text-xs font-mono text-text-primary">{config.maxDepth}</span>
                    </div>
                    <input type="range" min={1} max={10} step={1} value={config.maxDepth} onChange={(e) => setConfig((c) => ({ ...c, maxDepth: Number(e.target.value) }))} className="w-full accent-blue-500" />
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
                        <div className="text-[9px] text-text-dim">Focus on the most promising branches. Finds the highest-quality arcs faster but may miss surprising alternatives.</div>
                      </div>
                    </label>
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.searchMode === 'explore' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="searchMode" checked={config.searchMode === 'explore'} onChange={() => setConfig((c) => ({ ...c, searchMode: 'explore' }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Explore</div>
                        <div className="text-[9px] text-text-dim">Aggressively try new branches. Discovers more diverse narrative possibilities but needs more time to converge.</div>
                      </div>
                    </label>
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.searchMode === 'baseline' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="searchMode" checked={config.searchMode === 'baseline'} onChange={() => setConfig((c) => ({ ...c, searchMode: 'baseline' }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Baseline</div>
                        <div className="text-[9px] text-text-dim">Layer-by-layer greedy search. At each depth, keeps generating until an arc meets the target score, then goes deeper. Guarantees minimum quality per layer.</div>
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

                {/* Path selection */}
                <div className="border-t border-border pt-4">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">Path Selection</label>
                  <p className="text-[9px] text-text-dim mb-2">How the recommended &quot;best&quot; path is chosen. You can always override by clicking nodes manually.</p>
                  <div className="flex flex-col gap-1.5">
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.pathStrategy === 'best_score' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="pathStrategy" checked={config.pathStrategy === 'best_score'} onChange={() => setConfig((c) => ({ ...c, pathStrategy: 'best_score' }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Best Average Score</div>
                        <div className="text-[9px] text-text-dim">Pick the path with the highest average arc score. Optimizes for raw narrative quality.</div>
                      </div>
                    </label>
                    <label className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${config.pathStrategy === 'most_explored' ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <input type="radio" name="pathStrategy" checked={config.pathStrategy === 'most_explored'} onChange={() => setConfig((c) => ({ ...c, pathStrategy: 'most_explored' }))} className="accent-blue-500 mt-0.5" />
                      <div>
                        <div className="text-xs text-text-primary font-medium">Most Explored</div>
                        <div className="text-[9px] text-text-dim">Pick the most-visited path. Reflects search confidence — the path MCTS invested the most time exploring.</div>
                      </div>
                    </label>
                  </div>
                </div>
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
              ? `${runState.currentPhase ?? 'searching'}… ${formatTime(elapsed)} / ${formatTime(runState.config.timeLimitSeconds)} · iteration ${runState.iterationsCompleted + 1}`
              : `${runState.currentPhase ?? 'searching'}… iteration ${runState.iterationsCompleted + 1}/${runState.config.totalIterations}`
            : isComplete
              ? `Search complete · ${nodeCount} nodes explored`
              : isPaused
                ? isTimerMode
                  ? `Paused at ${formatTime(elapsed)} · ${runState.iterationsCompleted} iterations`
                  : `Paused at ${runState.iterationsCompleted}/${runState.config.totalIterations}`
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
                : `${runState.iterationsCompleted}/${runState.config.totalIterations} iterations`}
            </span>
            <span className="text-[10px] text-text-dim font-mono">
              {runState.iterationsCompleted} iter · {nodeCount} nodes
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
                <button onClick={() => continueSearch(3)} className="text-xs px-4 py-2 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors">
                  +3 iter ({3 * config.branchingFactor} calls)
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
