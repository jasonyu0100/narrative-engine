'use client';

import React, { useState } from 'react';
import { useStore } from '@/lib/store';
import {
  getContinuityNodesAtScene,
  getRelationshipsAtScene,
  getThreadIdsAtScene,
} from '@/lib/scene-filter';
import type { CharacterRole, ContinuityNodeType } from '@/types/narrative';
import { CollapsibleSection } from './CollapsibleSection';
import { INSPECTOR_PAGE_SIZE } from '@/lib/constants';

type Props = {
  characterId: string;
};

const roleClasses: Record<CharacterRole, string> = {
  anchor: 'text-text-primary',
  recurring: 'text-text-secondary',
  transient: 'text-text-dim',
};

const continuityDotColors: Record<ContinuityNodeType, string> = {
  knows: 'bg-white',
  believes: 'bg-white/40',
  secret: 'bg-[#F59E0B]',
  goal: 'bg-[#3B82F6]',
};

const PAGE_SIZE = INSPECTOR_PAGE_SIZE;

/** Paginator: page 0 = most recent. Returns reversed slice so newest items show first. */
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

export default function CharacterDetail({ characterId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [continuityPage, setContinuityPage] = useState(0);
  const [threadPage, setThreadPage] = useState(0);
  const [relPage, setRelPage] = useState(0);
  const [lifecyclePage, setLifecyclePage] = useState(0);
  if (!narrative) return null;

  const character = narrative.characters[characterId];
  if (!character) return null;

  const sceneKeysUpToCurrent = state.resolvedSceneKeys.slice(0, state.currentSceneIndex + 1);

  // Knowledge filtered to current scene
  const continuityNodes = getContinuityNodesAtScene(
    character.continuity.nodes,
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

  // Current scene mutations for this character
  const currentSceneKey = state.resolvedSceneKeys[state.currentSceneIndex];
  const currentScene = currentSceneKey ? narrative.scenes[currentSceneKey] : null;
  const recentContinuityMuts = currentScene
    ? currentScene.continuityMutations.filter((m) => m.characterId === characterId)
    : [];
  const recentRelationshipMuts = currentScene
    ? currentScene.relationshipMutations.filter((rm) => rm.from === characterId || rm.to === characterId)
    : [];
  const recentThreadMuts = currentScene
    ? currentScene.threadMutations.filter((tm) => narrative.threads[tm.threadId]?.anchors?.some((a) => a.id === characterId))
    : [];
  const recentMovement = currentScene?.characterMovements?.[characterId] ?? null;
  const recentEvents = currentScene && currentScene.participantIds.includes(characterId)
    ? currentScene.events
    : [];
  const hasRecentActivity = recentContinuityMuts.length > 0 || recentRelationshipMuts.length > 0 ||
    recentThreadMuts.length > 0 || recentMovement !== null || recentEvents.length > 0;

  // Lifecycle: only scenes up to current scene index
  const lifecycle = sceneKeysUpToCurrent
    .map((k) => narrative.scenes[k])
    .filter((s) => s && s.participantIds.includes(characterId))
    .map((s) => ({
      sceneId: s.id,
      continuityMuts: s.continuityMutations.filter((km) => km.characterId === characterId),
      relationshipMuts: s.relationshipMutations.filter(
        (rm) => rm.from === characterId || rm.to === characterId,
      ),
      movement: s.characterMovements?.[characterId] ?? null,
    }))
    .filter(
      ({ continuityMuts, relationshipMuts, movement }) =>
        continuityMuts.length > 0 || relationshipMuts.length > 0 || movement !== null,
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

      {/* Image prompt */}
      {character.imagePrompt && (
        <p className="text-[10px] text-text-dim italic leading-relaxed">{character.imagePrompt}</p>
      )}

      {/* Recent — current scene mutations, open by default */}
      {hasRecentActivity && currentScene && (() => {
        const totalCount = recentContinuityMuts.length + recentRelationshipMuts.length + recentThreadMuts.length + (recentMovement ? 1 : 0);
        const groups: React.ReactNode[] = [];

        if (recentEvents.length > 0) {
          groups.push(
            <ul key="events" className="flex flex-col gap-0.5">
              {recentEvents.map((ev, i) => (
                <li key={i} className="text-xs text-text-dim italic">{ev}</li>
              ))}
            </ul>
          );
        }
        if (recentThreadMuts.length > 0) {
          groups.push(
            <ul key="threads" className="flex flex-col gap-0.5">
              {recentThreadMuts.map((tm, i) => (
                <li key={i} className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'thread', threadId: tm.threadId } })}
                    className="font-mono text-[10px] text-text-dim transition-colors hover:text-text-secondary text-left"
                  >
                    {tm.threadId}
                    {narrative.threads[tm.threadId] && (
                      <span className="ml-1.5 font-sans text-text-dim">{narrative.threads[tm.threadId].description}</span>
                    )}
                  </button>
                  <span className="text-xs text-text-secondary">
                    <span className="text-text-dim">{tm.from}</span>
                    {' \u2192 '}
                    <span className="text-payoff">{tm.to}</span>
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        if (recentContinuityMuts.length > 0) {
          groups.push(
            <ul key="continuity" className="flex flex-col gap-0.5">
              {recentContinuityMuts.map((km, kmIdx) => (
                <li key={`${km.nodeId}-${kmIdx}`} className="flex items-start gap-1">
                  <span className={`shrink-0 ${km.action === 'added' ? 'text-change' : 'text-payoff'}`}>
                    {km.action === 'added' ? '+' : '\u2212'}
                  </span>
                  <span className="text-xs text-text-secondary">{km.content}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (recentRelationshipMuts.length > 0) {
          groups.push(
            <ul key="relationships" className="flex flex-col gap-0.5">
              {recentRelationshipMuts.map((rm, rmIdx) => {
                const otherId = rm.from === characterId ? rm.to : rm.from;
                const otherName = narrative.characters[otherId]?.name ?? otherId;
                return (
                  <li key={`${rm.from}-${rm.to}-${rmIdx}`} className="text-xs text-text-secondary">
                    <span className={rm.valenceDelta >= 0 ? 'text-change' : 'text-payoff'}>
                      {rm.valenceDelta > 0 ? '+' : ''}{rm.valenceDelta}
                    </span>{' '}
                    {otherName}: {rm.type}
                  </li>
                );
              })}
            </ul>
          );
        }
        if (recentMovement) {
          groups.push(
            <span key="movement" className="text-xs text-text-secondary">
              &rarr; {narrative.locations[recentMovement.locationId]?.name ?? recentMovement.locationId}
              {recentMovement.transition && <span className="text-text-dim italic"> — {recentMovement.transition}</span>}
            </span>
          );
        }

        return (
          <CollapsibleSection title="Recent" count={totalCount} defaultOpen>
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId: currentScene.id } })}
                className="font-mono text-[10px] text-text-dim transition-colors hover:text-text-secondary text-left mb-1"
              >
                {currentScene.id}
              </button>
              {groups.map((group, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <div className="border-t border-white/5 my-1" />}
                  {group}
                </React.Fragment>
              ))}
            </div>
          </CollapsibleSection>
        );
      })()}

      {/* Knowledge — paginated, most recent first */}
      {continuityNodes.length > 0 && (() => {
        const { pageItems, totalPages, safePage } = paginateRecent(continuityNodes, continuityPage);
        return (
          <CollapsibleSection title="Knowledge" count={continuityNodes.length}>
            <ul className="flex flex-col gap-1">
              {pageItems.map((node, i) => (
                <li key={`${node.id}-${i}`} className="flex items-start gap-2">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${continuityDotColors[node.type] ?? 'bg-white/40'}`} />
                  <span className="text-xs text-text-primary">{node.content}</span>
                </li>
              ))}
            </ul>
            <Paginator page={safePage} totalPages={totalPages} onPage={setContinuityPage} />
          </CollapsibleSection>
        );
      })()}

      {/* Threads — paginated, most recent first */}
      {threadIds.length > 0 && (() => {
        const { pageItems, totalPages, safePage } = paginateRecent(threadIds, threadPage);
        return (
          <CollapsibleSection title="Threads" count={threadIds.length}>
            <ul className="flex flex-col gap-1">
              {pageItems.map((tid, i) => (
                <li key={`${tid}-${i}`}>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'thread', threadId: tid } })}
                    className="font-mono text-xs text-text-secondary transition-colors hover:text-text-primary"
                  >
                    {tid}
                    {narrative.threads[tid] && (
                      <span className="ml-1.5 font-sans text-text-dim">{narrative.threads[tid].description}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <Paginator page={safePage} totalPages={totalPages} onPage={setThreadPage} />
          </CollapsibleSection>
        );
      })()}

      {/* Relationships — paginated, most recent first */}
      {relationships.length > 0 && (() => {
        const { pageItems, totalPages, safePage } = paginateRecent(relationships, relPage);
        return (
          <CollapsibleSection title="Relationships" count={relationships.length}>
            <ul className="flex flex-col gap-2">
              {pageItems.map((rel, relIdx) => {
                const isOutgoing = rel.from === characterId;
                const otherId = isOutgoing ? rel.to : rel.from;
                const other = narrative.characters[otherId];
                const arrow = isOutgoing ? '\u2192' : '\u2190';
                const clamped = Math.max(-1, Math.min(1, rel.valence));
                const pct = Math.abs(clamped) * 100;
                const isPositive = rel.valence > 0;
                const isNegative = rel.valence < 0;
                return (
                  <li key={`${rel.from}-${rel.to}-${rel.type}-${relIdx}`} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-primary flex items-center gap-1">
                        <span className="text-text-dim">{arrow}</span>
                        {other?.name ?? otherId}
                      </span>
                      <span className="text-[10px] text-text-dim">{rel.type}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden relative">
                        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10" />
                        {isPositive && (
                          <div className="absolute top-0 bottom-0 left-1/2 rounded-r-full" style={{ width: `${pct / 2}%`, backgroundColor: '#22C55E' }} />
                        )}
                        {isNegative && (
                          <div className="absolute top-0 bottom-0 rounded-l-full" style={{ width: `${pct / 2}%`, right: '50%', backgroundColor: '#EF4444' }} />
                        )}
                      </div>
                      <span className={`text-[10px] font-mono w-6 text-right ${isPositive ? 'text-change' : isNegative ? 'text-payoff' : 'text-text-dim'}`}>
                        {rel.valence > 0 ? '+' : ''}{Number(rel.valence.toFixed(2))}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Paginator page={safePage} totalPages={totalPages} onPage={setRelPage} />
          </CollapsibleSection>
        );
      })()}

      {/* Lifecycle — paginated, most recent first */}
      {lifecycle.length > 0 && (() => {
        const { pageItems, totalPages, safePage } = paginateRecent(lifecycle, lifecyclePage);
        return (
          <CollapsibleSection title="Lifecycle" count={lifecycle.length}>
            <ul className="flex flex-col gap-2">
              {pageItems.map(({ sceneId, continuityMuts, relationshipMuts, movement }) => (
                <li key={sceneId} className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId } })}
                    className="font-mono text-[10px] text-text-dim transition-colors hover:text-text-secondary"
                  >
                    {sceneId}
                  </button>
                  {continuityMuts.map((km, kmIdx) => (
                    <span key={`${km.nodeId}-${kmIdx}`} className="text-xs text-text-secondary">
                      <span className={km.action === 'added' ? 'text-change' : 'text-payoff'}>
                        {km.action === 'added' ? '+' : '−'}
                      </span>{' '}
                      {km.content}
                    </span>
                  ))}
                  {relationshipMuts.map((rm, rmIdx) => {
                    const otherId = rm.from === characterId ? rm.to : rm.from;
                    const otherName = narrative.characters[otherId]?.name ?? otherId;
                    return (
                      <span key={`${rm.from}-${rm.to}-${rmIdx}`} className="text-xs text-text-secondary">
                        <span className={rm.valenceDelta >= 0 ? 'text-change' : 'text-payoff'}>
                          {rm.valenceDelta > 0 ? '+' : ''}{rm.valenceDelta}
                        </span>{' '}
                        {otherName}: {rm.type}
                      </span>
                    );
                  })}
                  {movement && (
                    <span className="text-xs text-text-secondary">
                      &rarr; {narrative.locations[movement.locationId]?.name ?? movement.locationId}
                      {movement.transition && <span className="text-text-dim italic"> — {movement.transition}</span>}
                    </span>
                  )}
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
