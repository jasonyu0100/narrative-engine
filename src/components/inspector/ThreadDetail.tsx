'use client';

import { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { computeThreadStatuses } from '@/lib/narrative-utils';
import type { Thread, NarrativeState } from '@/types/narrative';
import { CollapsibleSection } from './CollapsibleSection';
import { INSPECTOR_PAGE_SIZE } from '@/lib/constants';

const PAGE_SIZE = INSPECTOR_PAGE_SIZE;

function paginateRecent<T>(items: T[], page: number): { pageItems: T[]; totalPages: number; safePage: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const startFromEnd = safePage * PAGE_SIZE;
  const pageItems = items.slice(
    Math.max(0, items.length - startFromEnd - PAGE_SIZE),
    items.length - startFromEnd,
  ).reverse();
  return { pageItems, totalPages, safePage };
}

function Paginator({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between mt-2">
      <button type="button" disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)}
        className="text-[9px] text-text-dim hover:text-text-secondary disabled:opacity-20 transition-colors">
        &lsaquo; Older
      </button>
      <span className="text-[9px] text-text-dim font-mono">{page + 1} / {totalPages}</span>
      <button type="button" disabled={page <= 0} onClick={() => onPage(page - 1)}
        className="text-[9px] text-text-dim hover:text-text-secondary disabled:opacity-20 transition-colors">
        Newer &rsaquo;
      </button>
    </div>
  );
}

type Props = {
  threadId: string;
};

const statusClasses: Record<string, string> = {
  dormant: 'text-text-dim',
  active: 'text-text-secondary',
  escalating: 'text-payoff',
  critical: 'text-payoff',
  resolved: 'text-change',
  subverted: 'text-text-dim',
  abandoned: 'text-text-dim',
};

const STATUS_FILLS: Record<string, string> = {
  dormant: '#555',
  active: '#3b82f6',
  escalating: '#f59e0b',
  critical: '#ef4444',
  resolved: '#10b981',
  subverted: '#8b5cf6',
  abandoned: '#444',
};

// ── Thread convergence graph ─────────────────────────────────────────────────

type GraphNode = { id: string; label: string; status: string; isFocus: boolean };
type GraphEdge = { from: string; to: string };

function buildConvergenceGraph(
  focusId: string,
  narrative: NarrativeState,
  statuses: Record<string, string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } | null {
  const focusThread = narrative.threads[focusId];
  if (!focusThread) return null;

  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const addNode = (t: Thread, isFocus: boolean) => {
    if (!nodeMap.has(t.id)) {
      const status = statuses[t.id] ?? t.status;
      // Truncate description for label
      const label = t.description.length > 30 ? t.description.slice(0, 28) + '…' : t.description;
      nodeMap.set(t.id, { id: t.id, label, status, isFocus });
    }
  };

  addNode(focusThread, true);

  // Direct dependents (focus → dep)
  for (const depId of focusThread.dependents) {
    const dep = narrative.threads[depId];
    if (dep) {
      addNode(dep, false);
      edges.push({ from: focusId, to: depId });
    }
  }

  // Reverse links (other → focus)
  for (const t of Object.values(narrative.threads)) {
    if (t.id !== focusId && t.dependents.includes(focusId)) {
      addNode(t, false);
      edges.push({ from: t.id, to: focusId });
    }
  }

  // Also show edges between neighbors (not through focus)
  for (const [id] of nodeMap) {
    if (id === focusId) continue;
    const t = narrative.threads[id];
    if (!t) continue;
    for (const depId of t.dependents) {
      if (depId !== focusId && nodeMap.has(depId) && !edges.some((e) => e.from === id && e.to === depId)) {
        edges.push({ from: id, to: depId });
      }
    }
  }

  if (nodeMap.size <= 1) return null;
  return { nodes: Array.from(nodeMap.values()), edges };
}

function ThreadConvergenceGraph({
  focusId,
  narrative,
  statuses,
  onSelectThread,
}: {
  focusId: string;
  narrative: NarrativeState;
  statuses: Record<string, string>;
  onSelectThread: (id: string) => void;
}) {
  const graph = useMemo(
    () => buildConvergenceGraph(focusId, narrative, statuses),
    [focusId, narrative, statuses],
  );

  if (!graph) return null;

  // Layout: focus in center, neighbors in a circle
  const W = 280;
  const H = Math.max(120, graph.nodes.length * 28);
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(cx - 40, cy - 30);

  const neighbors = graph.nodes.filter((n) => !n.isFocus);
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(focusId, { x: cx, y: cy });

  neighbors.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / neighbors.length - Math.PI / 2;
    positions.set(n.id, {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  });

  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
        Convergence Graph
      </h3>
      <svg width={W} height={H} className="rounded bg-white/[0.02]">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#666" />
          </marker>
        </defs>
        {/* Edges */}
        {graph.edges.map((e, i) => {
          const from = positions.get(e.from);
          const to = positions.get(e.to);
          if (!from || !to) return null;
          return (
            <line
              key={i}
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke="#555" strokeWidth={1} markerEnd="url(#arrow)"
              opacity={0.6}
            />
          );
        })}
        {/* Nodes */}
        {graph.nodes.map((n) => {
          const pos = positions.get(n.id);
          if (!pos) return null;
          const fill = STATUS_FILLS[n.status] ?? '#555';
          return (
            <g
              key={n.id}
              onClick={() => onSelectThread(n.id)}
              className="cursor-pointer"
            >
              <circle
                cx={pos.x} cy={pos.y} r={n.isFocus ? 10 : 7}
                fill={fill}
                stroke={n.isFocus ? '#fff' : 'transparent'}
                strokeWidth={n.isFocus ? 1.5 : 0}
                opacity={0.9}
              />
              <text
                x={pos.x} y={pos.y + (n.isFocus ? 18 : 15)}
                textAnchor="middle"
                className="text-[8px] fill-[#999] select-none pointer-events-none"
              >
                {n.id}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function ThreadDetail({ threadId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [lifecyclePage, setLifecyclePage] = useState(0);
  if (!narrative) return null;

  const thread = narrative.threads[threadId];
  if (!thread) return null;

  const currentStatuses = useMemo(
    () => computeThreadStatuses(narrative, state.currentSceneIndex),
    [narrative, state.currentSceneIndex],
  );
  const currentStatus = currentStatuses[threadId] ?? thread.status;

  // Resolve anchor names
  const anchors = (thread.participants ?? []).map((a) => ({
    ...a,
    name:
      a.type === 'character'
        ? narrative.characters[a.id]?.name ?? a.id
        : narrative.locations[a.id]?.name ?? a.id,
  }));

  // Find scenes up to current index where this thread was mutated
  const sceneKeysUpToCurrent = state.resolvedEntryKeys.slice(0, state.currentSceneIndex + 1);
  const lifecycle = sceneKeysUpToCurrent
    .map((k) => narrative.scenes[k])
    .filter((s) => s && s.threadMutations.some((tm) => tm.threadId === threadId))
    .map((s) => ({
      sceneId: s.id,
      mutations: s.threadMutations.filter((tm) => tm.threadId === threadId),
    }));

  return (
    <div className="flex flex-col gap-4">
      {/* Thread ID badge + description */}
      <div className="flex flex-col gap-1">
        <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-text-dim self-start">
          {thread.id}
        </span>
        <p className="text-sm text-text-primary">{thread.description}</p>
      </div>

      {/* Status chip */}
      <span
        className={`text-[10px] uppercase tracking-widest ${statusClasses[currentStatus] ?? 'text-text-secondary'}`}
      >
        {currentStatus}
      </span>

      {/* Anchors */}
      <div className="flex flex-col gap-1">
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
          {anchors.length === 0 ? 'General Thread' : 'Anchors'}
        </h3>
        {anchors.map((a, i) => (
          <button
            key={`${a.id}-${i}`}
            type="button"
            onClick={() =>
              dispatch({
                type: 'SET_INSPECTOR',
                context:
                  a.type === 'character'
                    ? { type: 'character', characterId: a.id }
                    : { type: 'location', locationId: a.id },
              })
            }
            className="text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            <span className="text-[10px] text-text-dim mr-1">{a.type}</span>
            {a.name}
          </button>
        ))}
      </div>

      {/* Connected Threads — bidirectional: what this thread converges with + what depends on it */}
      {(() => {
        const convergesWith = thread.dependents.filter((id) => narrative.threads[id]);
        const dependedOnBy = Object.values(narrative.threads).filter(
          (t) => t.id !== threadId && t.dependents.includes(threadId),
        );
        if (convergesWith.length === 0 && dependedOnBy.length === 0) return null;
        return (
          <div className="flex flex-col gap-2">
            {convergesWith.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                  Converges With
                </h3>
                <ul className="flex flex-col gap-1">
                  {convergesWith.map((depId) => (
                    <li key={depId}>
                      <button
                        type="button"
                        onClick={() =>
                          dispatch({
                            type: 'SET_INSPECTOR',
                            context: { type: 'thread', threadId: depId },
                          })
                        }
                        className="text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
                      >
                        <span className="font-mono text-[10px] text-text-dim mr-1">{depId}</span>
                        {narrative.threads[depId]?.description}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {dependedOnBy.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
                  Connected From
                </h3>
                <ul className="flex flex-col gap-1">
                  {dependedOnBy.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() =>
                          dispatch({
                            type: 'SET_INSPECTOR',
                            context: { type: 'thread', threadId: t.id },
                          })
                        }
                        className="text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
                      >
                        <span className="font-mono text-[10px] text-text-dim mr-1">{t.id}</span>
                        {t.description}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })()}

      {/* Convergence graph */}
      <ThreadConvergenceGraph
        focusId={threadId}
        narrative={narrative}
        statuses={currentStatuses}
        onSelectThread={(id) => dispatch({ type: 'SET_INSPECTOR', context: { type: 'thread', threadId: id } })}
      />

      {/* Lifecycle — paginated, most recent first */}
      {lifecycle.length > 0 && (() => {
        const { pageItems, totalPages, safePage } = paginateRecent(lifecycle, lifecyclePage);
        return (
          <CollapsibleSection title="Lifecycle" count={lifecycle.length} defaultOpen>
            <ul className="flex flex-col gap-1.5">
              {pageItems.map(({ sceneId, mutations }) => (
                <li key={sceneId} className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: 'SET_INSPECTOR',
                        context: { type: 'scene', sceneId },
                      })
                    }
                    className="font-mono text-[10px] text-text-dim transition-colors hover:text-text-secondary"
                  >
                    {sceneId}
                  </button>
                  {mutations.map((tm, tmIdx) => (
                    <span
                      key={`${tm.from}-${tm.to}-${tmIdx}`}
                      className="text-xs text-text-secondary"
                    >
                      {tm.from} &rarr; {tm.to}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            <Paginator page={safePage} totalPages={totalPages} onPage={setLifecyclePage} />
          </CollapsibleSection>
        );
      })()}
    </div>
  );
}
