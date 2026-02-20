'use client';

import { useStore } from '@/lib/store';
import { getKnowledgeNodesAtScene, getThreadIdsAtScene } from '@/lib/scene-filter';
import type { KnowledgeNodeType } from '@/types/narrative';
import { CollapsibleSection } from './CollapsibleSection';

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

  const sceneKeysUpToCurrent = state.resolvedSceneKeys.slice(0, state.currentSceneIndex + 1);

  // Knowledge filtered to current scene (location knowledge uses locationId as characterId
  // in the mutation replay — location-specific knowledge nodes aren't mutated by scenes,
  // so we pass the locationId and any matching mutations will be respected)
  const knowledgeNodes = getKnowledgeNodesAtScene(
    location.knowledge.nodes,
    locationId,
    narrative.scenes,
    state.resolvedSceneKeys,
    state.currentSceneIndex,
  );

  // Total scenes at this location up to current scene
  const totalSceneCount = sceneKeysUpToCurrent
    .filter((k) => narrative.scenes[k]?.locationId === locationId).length;

  // Threads filtered to current scene
  const threadIds = getThreadIdsAtScene(
    location.threadIds,
    narrative.threads,
    state.resolvedSceneKeys,
    state.currentSceneIndex,
  );

  // Lifecycle: only scenes up to current scene index
  const locationThreadIds = new Set(location.threadIds);
  const lifecycle = sceneKeysUpToCurrent
    .map((k) => narrative.scenes[k])
    .filter((s) => s && s.locationId === locationId)
    .map((s) => ({
      sceneId: s.id,
      threadMuts: s.threadMutations.filter((tm) => locationThreadIds.has(tm.threadId)),
      knowledgeMuts: s.knowledgeMutations.filter((km) =>
        km.content.toLowerCase().includes(location.name.toLowerCase()),
      ),
      arrivals: Object.entries(s.characterMovements ?? {})
        .filter(([, locId]) => locId === locationId)
        .map(([charId]) => charId),
    }))
    .filter(({ threadMuts, knowledgeMuts, arrivals }) =>
      threadMuts.length > 0 || knowledgeMuts.length > 0 || arrivals.length > 0,
    );

  return (
    <div className="flex flex-col gap-4">
      {/* Establishing shot */}
      {location.imageUrl && (
        <img
          src={location.imageUrl}
          alt={location.name}
          className="w-full aspect-video object-cover rounded-lg border border-border"
        />
      )}

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
      {knowledgeNodes.length > 0 && (
        <CollapsibleSection title="Knowledge" count={knowledgeNodes.length}>
          <ul className="flex flex-col gap-1">
            {knowledgeNodes.map((node) => (
              <li key={node.id} className="flex items-start gap-2">
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${knowledgeDotColors[node.type] ?? 'bg-white/40'}`}
                />
                <span className="text-xs text-text-primary">{node.content}</span>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {/* Threads */}
      {threadIds.length > 0 && (
        <CollapsibleSection title="Threads" count={threadIds.length}>
          <ul className="flex flex-col gap-1">
            {threadIds.map((tid) => (
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
        </CollapsibleSection>
      )}

      {/* Scenes */}
      {totalSceneCount > 0 && (
        <CollapsibleSection title="Scenes" count={totalSceneCount} defaultOpen>
          {lifecycle.length > 0 && (
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
                        <span className={km.action === 'added' ? 'text-change' : 'text-payoff'}>
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
          )}
        </CollapsibleSection>
      )}
    </div>
  );
}
