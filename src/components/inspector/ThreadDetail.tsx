'use client';

import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { computeThreadStatuses } from '@/lib/narrative-utils';
import type { ThreadStatus } from '@/types/narrative';

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

export default function ThreadDetail({ threadId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  if (!narrative) return null;

  const thread = narrative.threads[threadId];
  if (!thread) return null;

  const currentStatuses = useMemo(
    () => computeThreadStatuses(narrative, state.currentSceneIndex),
    [narrative, state.currentSceneIndex],
  );
  const currentStatus = currentStatuses[threadId] ?? thread.status;

  // Resolve anchor names
  const anchors = (thread.anchors ?? []).map((a) => ({
    ...a,
    name:
      a.type === 'character'
        ? narrative.characters[a.id]?.name ?? a.id
        : narrative.locations[a.id]?.name ?? a.id,
  }));

  // Find scenes on the current branch where this thread was mutated
  const lifecycle = state.resolvedSceneKeys
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

      {/* Dependents */}
      {thread.dependents.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Dependents
          </h3>
          <ul className="flex flex-col gap-1">
            {thread.dependents.map((depId) => (
              <li key={depId}>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: 'SET_INSPECTOR',
                      context: { type: 'thread', threadId: depId },
                    })
                  }
                  className="font-mono text-xs text-text-secondary transition-colors hover:text-text-primary"
                >
                  {depId}
                  {narrative.threads[depId] && (
                    <span className="ml-1.5 font-sans text-text-dim">
                      {narrative.threads[depId].description}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Lifecycle */}
      {lifecycle.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Lifecycle
          </h3>
          <ul className="flex flex-col gap-1.5">
            {lifecycle.map(({ sceneId, mutations }) => (
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
        </div>
      )}
    </div>
  );
}
