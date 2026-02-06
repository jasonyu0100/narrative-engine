'use client';

import { useStore } from '@/lib/store';
import type { KnowledgeNodeType } from '@/types/narrative';

type Props = {
  locationId: string;
};

const knowledgeDotColors: Record<KnowledgeNodeType, string> = {
  lore: 'bg-[#8B5CF6]',
  secret: 'bg-[#F59E0B]',
  danger: 'bg-[#EF4444]',
  resource: 'bg-[#10B981]',
};

export default function LocationDetail({ locationId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  if (!narrative) return null;

  const location = narrative.locations[locationId];
  if (!location) return null;

  const parent = location.parentId ? narrative.locations[location.parentId] : null;

  // Lifecycle: scenes set at this location, with relevant mutations
  const lifecycle = Object.values(narrative.scenes)
    .filter((s) => s.locationId === locationId)
    .map((s) => ({
      sceneId: s.id,
      threadMuts: s.threadMutations,
      knowledgeMuts: s.knowledgeMutations,
      arrivals: Object.entries(s.characterMovements ?? {})
        .filter(([, locId]) => locId === locationId)
        .map(([charId]) => charId),
    }));

  return (
    <div className="flex flex-col gap-4">
      {/* Name + ID */}
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-text-primary">{location.name}</h2>
        <span className="font-mono text-[10px] text-text-dim">{locationId}</span>
      </div>

      {/* Parent location */}
      {parent && (
        <p className="text-xs text-text-secondary">
          in{' '}
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: 'SET_INSPECTOR',
                context: { type: 'location', locationId: parent.id },
              })
            }
            className="text-text-primary transition-colors hover:underline"
          >
            {parent.name}
          </button>
        </p>
      )}

      {/* Knowledge */}
      {location.knowledge.nodes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Knowledge
          </h3>
          <ul className="flex flex-col gap-1">
            {location.knowledge.nodes.map((node) => (
              <li key={node.id} className="flex items-start gap-2">
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${knowledgeDotColors[node.type] ?? 'bg-white/40'}`}
                />
                <span className="text-xs text-text-primary">{node.content}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Threads */}
      {location.threadIds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Threads
          </h3>
          <ul className="flex flex-col gap-1">
            {location.threadIds.map((tid) => (
              <li key={tid}>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: 'SET_INSPECTOR',
                      context: { type: 'thread', threadId: tid },
                    })
                  }
                  className="font-mono text-xs text-text-secondary transition-colors hover:text-text-primary"
                >
                  {tid}
                  {narrative.threads[tid] && (
                    <span className="ml-1.5 font-sans text-text-dim">
                      {narrative.threads[tid].description}
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
          <ul className="flex flex-col gap-2">
            {lifecycle.map(({ sceneId, threadMuts, knowledgeMuts, arrivals }) => (
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
                {threadMuts.map((tm) => (
                  <span key={tm.threadId} className="text-xs text-text-secondary">
                    {tm.threadId}: {tm.from} &rarr; {tm.to}
                  </span>
                ))}
                {knowledgeMuts.map((km) => {
                  const charName = narrative.characters[km.characterId]?.name ?? km.characterId;
                  return (
                    <span key={`${km.characterId}-${km.nodeId}`} className="text-xs text-text-secondary">
                      <span className={km.action === 'added' ? 'text-pacing' : 'text-stakes'}>
                        {km.action === 'added' ? '+' : '−'}
                      </span>{' '}
                      {charName}: {km.content}
                    </span>
                  );
                })}
                {arrivals.map((charId) => (
                  <span key={charId} className="text-xs text-text-secondary">
                    &rarr; {narrative.characters[charId]?.name ?? charId} arrived
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
