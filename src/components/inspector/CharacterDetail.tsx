'use client';

import { useStore } from '@/lib/store';
import {
  getKnowledgeNodesAtScene,
  getRelationshipsAtScene,
  getThreadIdsAtScene,
} from '@/lib/scene-filter';
import type { CharacterRole, KnowledgeNodeType } from '@/types/narrative';
import { CollapsibleSection } from './CollapsibleSection';

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

  const sceneKeysUpToCurrent = state.resolvedSceneKeys.slice(0, state.currentSceneIndex + 1);

  // Knowledge filtered to current scene
  const knowledgeNodes = getKnowledgeNodesAtScene(
    character.knowledge.nodes,
    characterId,
    narrative.scenes,
    state.resolvedSceneKeys,
    state.currentSceneIndex,
  );

  // Threads filtered to current scene
  const threadIds = getThreadIdsAtScene(
    character.threadIds,
    narrative.threads,
    state.resolvedSceneKeys,
    state.currentSceneIndex,
  );

  // Relationships filtered + valence adjusted to current scene
  const relationships = getRelationshipsAtScene(
    narrative,
    state.resolvedSceneKeys,
    state.currentSceneIndex,
  ).filter((r) => r.from === characterId || r.to === characterId);

  // Lifecycle: only scenes up to current scene index
  const lifecycle = sceneKeysUpToCurrent
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

      {/* Relationships */}
      {relationships.length > 0 && (
        <CollapsibleSection title="Relationships" count={relationships.length}>
          <ul className="flex flex-col gap-2">
            {relationships.map((rel) => {
              const isOutgoing = rel.from === characterId;
              const otherId = isOutgoing ? rel.to : rel.from;
              const other = narrative.characters[otherId];
              const arrow = isOutgoing ? '\u2192' : '\u2190';
              const clamped = Math.max(-1, Math.min(1, rel.valence));
              const pct = Math.abs(clamped) * 100; // 0–100%
              const isPositive = rel.valence > 0;
              const isNegative = rel.valence < 0;
              return (
                <li key={`${rel.from}-${rel.to}-${rel.type}`} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-primary flex items-center gap-1">
                      <span className="text-text-dim">{arrow}</span>
                      {other?.name ?? otherId}
                    </span>
                    <span className="text-[10px] text-text-dim">{rel.type}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden relative">
                      {/* Center line */}
                      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10" />
                      {isPositive && (
                        <div
                          className="absolute top-0 bottom-0 left-1/2 rounded-r-full"
                          style={{ width: `${pct / 2}%`, backgroundColor: '#22C55E' }}
                        />
                      )}
                      {isNegative && (
                        <div
                          className="absolute top-0 bottom-0 rounded-l-full"
                          style={{ width: `${pct / 2}%`, right: '50%', backgroundColor: '#EF4444' }}
                        />
                      )}
                    </div>
                    <span className={`text-[10px] font-mono w-6 text-right ${isPositive ? 'text-change' : isNegative ? 'text-payoff' : 'text-text-dim'}`}>
                      {rel.valence > 0 ? '+' : ''}{rel.valence}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </CollapsibleSection>
      )}

      {/* Lifecycle */}
      {lifecycle.length > 0 && (
        <CollapsibleSection title="Lifecycle" count={lifecycle.length} defaultOpen>
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
        </CollapsibleSection>
      )}
    </div>
  );
}
