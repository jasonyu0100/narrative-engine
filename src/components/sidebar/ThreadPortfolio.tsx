'use client';

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { computeThreadStatuses } from '@/lib/narrative-utils';
import type { Thread, ThreadStatus } from '@/types/narrative';

const STATUS_ORDER: ThreadStatus[] = [
  'escalating',
  'threatened',
  'surfacing',
  'dormant',
  'done',
  'subverted',
];

function ThreadItem({
  thread,
  statusLabel,
  dimmed,
  onClick,
}: {
  thread: Thread;
  statusLabel: string;
  dimmed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded px-1.5 py-1 hover:bg-bg-elevated transition-colors flex flex-col gap-0.5${dimmed ? ' opacity-50' : ''}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] bg-white/[0.06] text-text-secondary px-1.5 py-0.5 rounded shrink-0">
          {thread.id}
        </span>
        <span className="text-xs text-text-primary truncate">
          {thread.description}
        </span>
      </div>
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-text-secondary self-start">
        {statusLabel}
      </span>
    </button>
  );
}

function CollapsibleSection({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full px-1 py-1 hover:bg-bg-elevated rounded transition-colors"
      >
        <span className="text-[10px] text-text-dim transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ▶
        </span>
        <span className="text-[10px] font-semibold text-text-dim uppercase tracking-widest">
          {title}
        </span>
        <span className="text-[10px] text-text-dim ml-auto tabular-nums">
          {count}
        </span>
      </button>
      {open && <div className="flex flex-col gap-0.5 mt-0.5">{children}</div>}
    </div>
  );
}

export default function ThreadPortfolio() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  const currentStatuses = useMemo(() => {
    if (!narrative) return {};
    return computeThreadStatuses(narrative, state.currentSceneIndex);
  }, [narrative, state.currentSceneIndex]);

  const { grouped, unopened } = useMemo(() => {
    if (!narrative) return { grouped: new Map<ThreadStatus, (Thread & { currentStatus: ThreadStatus })[]>(), unopened: [] as Thread[] };

    const visibleKeys = new Set(state.resolvedSceneKeys.slice(0, state.currentSceneIndex + 1));
    const allThreads = Object.values(narrative.threads);
    const opened = allThreads.filter((t) => visibleKeys.has(t.openedAt));
    const unopenedThreads = allThreads.filter((t) => !visibleKeys.has(t.openedAt));

    const threads = opened.map((t) => ({
      ...t,
      currentStatus: currentStatuses[t.id] ?? t.status,
    }));
    const map = new Map<ThreadStatus, (Thread & { currentStatus: ThreadStatus })[]>();

    const knownStatuses = new Set<string>(STATUS_ORDER);

    for (const status of STATUS_ORDER) {
      const matching = threads.filter((t) => t.currentStatus === status);
      if (matching.length > 0) {
        map.set(status, matching);
      }
    }

    // Collect threads with statuses not in the predefined order
    const unknown = threads.filter((t) => !knownStatuses.has(t.currentStatus));
    if (unknown.length > 0) {
      const unknownGroups = new Map<ThreadStatus, (Thread & { currentStatus: ThreadStatus })[]>();
      for (const t of unknown) {
        const list = unknownGroups.get(t.currentStatus) ?? [];
        list.push(t);
        unknownGroups.set(t.currentStatus, list);
      }
      for (const [status, list] of unknownGroups) {
        map.set(status, list);
      }
    }

    return { grouped: map, unopened: unopenedThreads };
  }, [narrative, currentStatuses, state.resolvedSceneKeys, state.currentSceneIndex]);

  const openedCount = useMemo(() => {
    let count = 0;
    for (const threads of grouped.values()) count += threads.length;
    return count;
  }, [grouped]);

  if (!narrative) {
    return (
      <div className="flex-1 flex items-center justify-center px-3">
        <p className="text-xs text-text-dim text-center">
          Select a narrative to view threads
        </p>
      </div>
    );
  }

  if (grouped.size === 0 && unopened.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-3">
        <p className="text-xs text-text-dim text-center">No threads yet</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-2">
      {grouped.size > 0 && (
        <CollapsibleSection title="Active" count={openedCount} defaultOpen>
          {Array.from(grouped.entries()).map(([status, threads]) => (
            <div key={status} className="mb-2">
              <h4 className="text-[10px] font-semibold text-text-dim uppercase tracking-widest px-1 mb-0.5">
                {status}
              </h4>
              {threads.map((thread) => (
                <ThreadItem
                  key={thread.id}
                  thread={thread}
                  statusLabel={thread.currentStatus}
                  onClick={() =>
                    dispatch({
                      type: 'SET_INSPECTOR',
                      context: { type: 'thread', threadId: thread.id },
                    })
                  }
                />
              ))}
            </div>
          ))}
        </CollapsibleSection>
      )}

      {unopened.length > 0 && (
        <CollapsibleSection title="Unopened" count={unopened.length} defaultOpen={false}>
          {unopened.map((thread) => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              statusLabel={thread.status}
              dimmed
              onClick={() =>
                dispatch({
                  type: 'SET_INSPECTOR',
                  context: { type: 'thread', threadId: thread.id },
                })
              }
            />
          ))}
        </CollapsibleSection>
      )}
    </div>
  );
}
