'use client';

import { useStore } from '@/lib/store';
import type { CharacterRole, KnowledgeNodeType } from '@/types/narrative';

type Props = {
  characterId: string;
};

const roleClasses: Record<CharacterRole, string> = {
  anchor: 'text-text-primary',
  recurring: 'text-text-secondary',
  transient: 'text-text-dim',
};

const knowledgeDotColors: Record<KnowledgeNodeType, string> = {
  knows: 'bg-white',
  believes: 'bg-white/40',
  secret: 'bg-[#F59E0B]',
  goal: 'bg-[#3B82F6]',
};

export default function CharacterDetail({ characterId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  if (!narrative) return null;

  const character = narrative.characters[characterId];
  if (!character) return null;

  const relationships = narrative.relationships.filter(
    (r) => r.from === characterId || r.to === characterId,
  );

  // Lifecycle: scenes where this character is involved, with their relevant mutations
  const lifecycle = state.resolvedSceneKeys
    .map((k) => narrative.scenes[k])
    .filter((s) => s && s.participantIds.includes(characterId))
    .map((s) => ({
      sceneId: s.id,
      knowledgeMuts: s.knowledgeMutations.filter((km) => km.characterId === characterId),
      relationshipMuts: s.relationshipMutations.filter(
        (rm) => rm.from === characterId || rm.to === characterId,
      ),
      movement: s.characterMovements?.[characterId] ?? null,
    }))
    .filter(
      ({ knowledgeMuts, relationshipMuts, movement }) =>
        knowledgeMuts.length > 0 || relationshipMuts.length > 0 || movement !== null,
    );

  return (
    <div className="flex flex-col gap-4">
      {/* Portrait */}
      {character.imageUrl && (
        <img
          src={character.imageUrl}
          alt={character.name}
          className="w-full aspect-3/4 object-cover rounded-lg border border-border"
        />
      )}

      {/* Name + ID */}
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-text-primary">{character.name}</h2>
        <span className="font-mono text-[10px] text-text-dim">{characterId}</span>
      </div>

      {/* Role badge */}
      <span
        className={`text-[10px] uppercase tracking-widest ${roleClasses[character.role]}`}
      >
        {character.role}
      </span>

      {/* Knowledge */}
      {character.knowledge.nodes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Knowledge
          </h3>
          <ul className="flex flex-col gap-1">
            {character.knowledge.nodes.map((node) => (
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
      {character.threadIds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Threads
          </h3>
          <ul className="flex flex-col gap-1">
            {character.threadIds.map((tid) => (
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

      {/* Relationships */}
      {relationships.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Relationships
          </h3>
          <ul className="flex flex-col gap-1">
            {relationships.map((rel) => {
              const isOutgoing = rel.from === characterId;
              const otherId = isOutgoing ? rel.to : rel.from;
              const other = narrative.characters[otherId];
              const arrow = isOutgoing ? '\u2192' : '\u2190';
              return (
                <li key={`${rel.from}-${rel.to}-${rel.type}`} className="text-xs text-text-primary">
                  {arrow} {other?.name ?? otherId}: {rel.type} ({rel.valence > 0 ? '+' : ''}
                  {rel.valence})
                </li>
              );
            })}
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
            {lifecycle.map(({ sceneId, knowledgeMuts, relationshipMuts, movement }) => (
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
                {knowledgeMuts.map((km) => (
                  <span
                    key={`${km.nodeId}`}
                    className="text-xs text-text-secondary"
                  >
                    <span className={km.action === 'added' ? 'text-change' : 'text-payoff'}>
                      {km.action === 'added' ? '+' : '−'}
                    </span>{' '}
                    {km.content}
                  </span>
                ))}
                {relationshipMuts.map((rm) => {
                  const otherId = rm.from === characterId ? rm.to : rm.from;
                  const otherName = narrative.characters[otherId]?.name ?? otherId;
                  return (
                    <span
                      key={`${rm.from}-${rm.to}`}
                      className="text-xs text-text-secondary"
                    >
                      <span className={rm.valenceDelta >= 0 ? 'text-change' : 'text-payoff'}>
                        {rm.valenceDelta > 0 ? '+' : ''}{rm.valenceDelta}
                      </span>{' '}
                      {otherName}: {rm.type}
                    </span>
                  );
                })}
                {movement && (
                  <span className="text-xs text-text-secondary">
                    &rarr; {narrative.locations[movement]?.name ?? movement}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
