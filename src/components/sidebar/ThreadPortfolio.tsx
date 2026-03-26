'use client';

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { computeThreadStatuses } from '@/lib/narrative-utils';
import type { Thread, ThreadStatus, NarrativeState, ThreadResolutionSpeed } from '@/types/narrative';
import { THREAD_ACTIVE_STATUSES, THREAD_TERMINAL_STATUSES, DEFAULT_STORY_SETTINGS } from '@/types/narrative';

// Display order: active statuses (reversed so highest-tension first), then terminal
const STATUS_ORDER: ThreadStatus[] = [
  ...([...THREAD_ACTIVE_STATUSES].reverse()),
  ...THREAD_TERMINAL_STATUSES,
];

const CLOSED_STATUSES = new Set<string>(THREAD_TERMINAL_STATUSES);

const PHASE_INDEX: Record<string, number> = { dormant: 0, active: 1, escalating: 2, critical: 3, resolved: 4, subverted: 4, abandoned: 4 };

const SPEED_BENCHMARKS: Record<ThreadResolutionSpeed, number> = { slow: 10, moderate: 6, fast: 4 };

const STATUS_COLORS: Record<string, string> = {
  dormant: 'bg-white/10 text-white/40',
  active: 'bg-blue-500/15 text-blue-400',
  escalating: 'bg-amber-500/15 text-amber-400',
  critical: 'bg-red-500/15 text-red-400',
  resolved: 'bg-emerald-500/15 text-emerald-400',
  subverted: 'bg-violet-500/15 text-violet-400',
  abandoned: 'bg-white/5 text-white/30',
};

// ── Thread metrics computation ──────────────────────────────────────────────

type ThreadMetrics = {
  age: number;
  transitions: number;
  pulses: number;
  totalMutations: number;
  scenesSinceLastTransition: number;
  pulseRatio: number;
  velocity: number; // transitions per 10 scenes
};

function computeThreadMetrics(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): Record<string, ThreadMetrics> {
  const metrics: Record<string, { transitions: number; pulses: number; total: number; sinceLast: number; firstSeen: number }> = {};
  let sceneCount = 0;

  for (let i = 0; i <= currentIndex && i < resolvedKeys.length; i++) {
    const scene = narrative.scenes[resolvedKeys[i]];
    if (!scene) continue;
    sceneCount++;

    for (const tm of scene.threadMutations) {
      if (!metrics[tm.threadId]) {
        metrics[tm.threadId] = { transitions: 0, pulses: 0, total: 0, sinceLast: 0, firstSeen: sceneCount };
      }
      const m = metrics[tm.threadId];
      m.total++;
      if (tm.from === tm.to) {
        m.pulses++;
      } else {
        m.transitions++;
        m.sinceLast = 0;
      }
    }

    for (const m of Object.values(metrics)) {
      m.sinceLast++;
    }
  }

  const result: Record<string, ThreadMetrics> = {};
  for (const [id, m] of Object.entries(metrics)) {
    const age = sceneCount - m.firstSeen + 1;
    result[id] = {
      age,
      transitions: m.transitions,
      pulses: m.pulses,
      totalMutations: m.total,
      scenesSinceLastTransition: m.sinceLast,
      pulseRatio: m.total > 0 ? m.pulses / m.total : 0,
      velocity: age > 0 ? (m.transitions / age) * 10 : 0,
    };
  }
  return result;
}

// ── Thread item ─────────────────────────────────────────────────────────────

function ThreadItem({
  thread,
  statusLabel,
  metrics,
  benchmark,
  dimmed,
  onClick,
}: {
  thread: Thread;
  statusLabel: string;
  metrics?: ThreadMetrics;
  benchmark: number;
  dimmed?: boolean;
  onClick: () => void;
}) {
  const phase = PHASE_INDEX[statusLabel] ?? 0;
  const isOverBenchmark = metrics && metrics.scenesSinceLastTransition > benchmark;
  const isHighPulse = metrics && metrics.pulseRatio > 0.8 && metrics.totalMutations > 2;

  return (
    <button
      onClick={onClick}
      className={`text-left rounded px-1.5 py-1.5 hover:bg-bg-elevated transition-colors flex flex-col gap-1${dimmed ? ' opacity-50' : ''}`}
    >
      {/* Top row: ID + description */}
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] bg-white/6 text-text-secondary px-1.5 py-0.5 rounded shrink-0">
          {thread.id}
        </span>
        <span className="text-xs text-text-primary truncate">
          {thread.description}
        </span>
      </div>

      {/* Status + phase bar */}
      <div className="flex items-center gap-2">
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_COLORS[statusLabel] ?? 'bg-white/6 text-text-secondary'}`}>
          {statusLabel}
        </span>
        {/* Phase progress dots */}
        <div className="flex items-center gap-0.5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full ${
                i < phase ? 'bg-white/40' : i === phase ? 'bg-white/70' : 'bg-white/10'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Metrics row */}
      {metrics && metrics.age > 0 && (
        <div className="flex items-center gap-2 text-[9px] text-text-dim font-mono">
          <span>{metrics.age}s</span>
          <span className="text-white/10">|</span>
          <span>{metrics.transitions}↑ {metrics.pulses}~</span>
          <span className="text-white/10">|</span>
          <span className={isOverBenchmark ? 'text-amber-400' : ''}>
            {metrics.scenesSinceLastTransition}s ago
          </span>
          {isHighPulse && (
            <>
              <span className="text-white/10">|</span>
              <span className="text-amber-400/70">high pulse</span>
            </>
          )}
        </div>
      )}
    </button>
  );
}

// ── Collapsible section ─────────────────────────────────────────────────────

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

// ── Main component ──────────────────────────────────────────────────────────

export default function ThreadPortfolio() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  const currentStatuses = useMemo(() => {
    if (!narrative) return {};
    return computeThreadStatuses(narrative, state.currentSceneIndex);
  }, [narrative, state.currentSceneIndex]);

  const threadMetrics = useMemo(() => {
    if (!narrative) return {};
    return computeThreadMetrics(narrative, state.resolvedEntryKeys, state.currentSceneIndex);
  }, [narrative, state.resolvedEntryKeys, state.currentSceneIndex]);

  const speed = narrative?.storySettings?.threadResolutionSpeed ?? DEFAULT_STORY_SETTINGS.threadResolutionSpeed;
  const benchmark = SPEED_BENCHMARKS[speed];

  type ThreadWithStatus = Thread & { currentStatus: ThreadStatus };
  const emptyList: ThreadWithStatus[] = [];

  const { opened, closed, unopened } = useMemo(() => {
    if (!narrative) return { opened: emptyList, closed: emptyList, unopened: emptyList };

    const visibleKeys = new Set(state.resolvedEntryKeys.slice(0, state.currentSceneIndex + 1));
    const allThreads = Object.values(narrative.threads);

    const sceneKeys = new Set(
      state.resolvedEntryKeys.slice(0, state.currentSceneIndex + 1).filter((k) => narrative.scenes[k])
    );
    const mutatedThreadIds = new Set(
      Array.from(sceneKeys).flatMap((k) => {
        const scene = narrative.scenes[k];
        return scene ? scene.threadMutations.map((tm) => tm.threadId) : [];
      })
    );

    const active: ThreadWithStatus[] = [];
    const terminal: ThreadWithStatus[] = [];
    const unopenedThreads: ThreadWithStatus[] = [];

    for (const t of allThreads) {
      const isVisible = mutatedThreadIds.has(t.id) || (visibleKeys.has(t.openedAt) && !!narrative.scenes[t.openedAt]);
      const status = (isVisible ? (currentStatuses[t.id] ?? t.status) : t.status) as ThreadStatus;
      const entry = { ...t, currentStatus: status };

      if (!isVisible) {
        unopenedThreads.push(entry);
      } else if (CLOSED_STATUSES.has(status)) {
        terminal.push(entry);
      } else {
        active.push(entry);
      }
    }

    // Sort by status order
    const statusIdx = (s: string) => { const i = STATUS_ORDER.indexOf(s); return i < 0 ? STATUS_ORDER.length : i; };
    active.sort((a, b) => statusIdx(a.currentStatus) - statusIdx(b.currentStatus));
    terminal.sort((a, b) => statusIdx(a.currentStatus) - statusIdx(b.currentStatus));
    unopenedThreads.sort((a, b) => statusIdx(a.currentStatus) - statusIdx(b.currentStatus));

    return { opened: active, closed: terminal, unopened: unopenedThreads };
  }, [narrative, currentStatuses, state.resolvedEntryKeys, state.currentSceneIndex]);

  if (!narrative) {
    return (
      <div className="flex-1 flex items-center justify-center px-3">
        <p className="text-xs text-text-dim text-center">
          Select a narrative to view threads
        </p>
      </div>
    );
  }

  if (opened.length === 0 && closed.length === 0 && unopened.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-3">
        <p className="text-xs text-text-dim text-center">No threads yet</p>
      </div>
    );
  }

  const renderThreads = (threads: (Thread & { currentStatus: ThreadStatus })[], dimmed?: boolean) =>
    threads.map((thread) => (
      <ThreadItem
        key={thread.id}
        thread={thread}
        statusLabel={thread.currentStatus}
        metrics={threadMetrics[thread.id]}
        benchmark={benchmark}
        dimmed={dimmed}
        onClick={() =>
          dispatch({
            type: 'SET_INSPECTOR',
            context: { type: 'thread', threadId: thread.id },
          })
        }
      />
    ));

  // Resolution summary
  const totalThreads = opened.length + closed.length + unopened.length;

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-2">
      {/* Resolution summary bar */}
      <div className="flex items-center gap-2 px-1 py-1.5 mb-1">
        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden flex">
          {closed.length > 0 && (
            <div
              className="h-full bg-emerald-400/50 rounded-l-full"
              style={{ width: `${(closed.length / totalThreads) * 100}%` }}
            />
          )}
          {opened.length > 0 && (
            <div
              className="h-full bg-amber-400/40"
              style={{ width: `${(opened.length / totalThreads) * 100}%` }}
            />
          )}
        </div>
        <span className="text-[9px] text-text-dim font-mono shrink-0">
          {closed.length}/{totalThreads}
        </span>
      </div>

      {opened.length > 0 && (
        <CollapsibleSection title="Opened" count={opened.length} defaultOpen>
          {renderThreads(opened)}
        </CollapsibleSection>
      )}

      {closed.length > 0 && (
        <CollapsibleSection title="Closed" count={closed.length} defaultOpen={false}>
          {renderThreads(closed, true)}
        </CollapsibleSection>
      )}

      {unopened.length > 0 && (
        <CollapsibleSection title="Unopened" count={unopened.length} defaultOpen={false}>
          {renderThreads(unopened, true)}
        </CollapsibleSection>
      )}
    </div>
  );
}
