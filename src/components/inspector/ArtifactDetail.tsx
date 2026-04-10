'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { getContinuityNodesAtScene, getThreadIdsAtScene } from '@/lib/scene-filter';
import type { ContinuityNodeType } from '@/types/narrative';
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
  artifactId: string;
};

const significanceClasses: Record<string, string> = {
  key: 'text-amber-400',
  notable: 'text-amber-300/70',
  minor: 'text-text-secondary',
};

const continuityDotColors: Record<string, string> = {
  trait: 'bg-violet-400',
  state: 'bg-emerald-400',
  history: 'bg-amber-400',
  capability: 'bg-blue-400',
  belief: 'bg-pink-300',
  relation: 'bg-purple-400',
  secret: 'bg-amber-500',
  goal: 'bg-sky-400',
  weakness: 'bg-red-400',
};

export default function ArtifactDetail({ artifactId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [continuityPage, setContinuityPage] = useState(0);
  const [threadPage, setThreadPage] = useState(0);
  const [scenesPage, setScenesPage] = useState(0);
  if (!narrative) return null;

  const artifact = narrative.artifacts[artifactId];
  if (!artifact) return <p className="p-4 text-xs text-text-dim">Artifact not found.</p>;

  const isWorldOwned = !artifact.parentId;
  const ownerId = artifact.parentId ?? '';
  const ownerName = isWorldOwned ? 'World' : (
    narrative.characters[ownerId]?.name
    ?? narrative.locations[ownerId]?.name
    ?? ownerId
  );
  const ownerIsCharacter = !isWorldOwned && !!narrative.characters[ownerId];

  const sceneKeysUpToCurrent = state.resolvedEntryKeys.slice(0, state.currentSceneIndex + 1);

  // Continuity filtered to current scene
  const continuityNodes = getContinuityNodesAtScene(
    artifact.continuity.nodes,
    artifactId,
    narrative.scenes,
    state.resolvedEntryKeys,
    state.currentSceneIndex,
  );

  // Threads filtered to current scene
  const threadIds = getThreadIdsAtScene(
    artifact.threadIds,
    narrative.threads,
    state.resolvedEntryKeys,
    state.currentSceneIndex,
  );

  // Scenes: where artifact was used, had continuity mutations, ownership transfers, or thread activity
  const artifactThreadIds = new Set(artifact.threadIds);
  const lifecycle = sceneKeysUpToCurrent
    .map((k) => narrative.scenes[k])
    .filter((s) => {
      if (!s) return false;
      const hasUsage = (s.artifactUsages ?? []).some((au) => au.artifactId === artifactId);
      const hasContinuity = s.continuityMutations.some((km) => km.entityId === artifactId);
      const hasOwnership = (s.ownershipMutations ?? []).some((om) => om.artifactId === artifactId);
      const hasThreadMut = s.threadMutations.some((tm) => artifactThreadIds.has(tm.threadId));
      return hasUsage || hasContinuity || hasOwnership || hasThreadMut;
    })
    .map((s) => ({
      sceneId: s.id,
      usages: (s.artifactUsages ?? []).filter((au) => au.artifactId === artifactId),
      continuityMuts: s.continuityMutations.filter((km) => km.entityId === artifactId),
      ownershipMuts: (s.ownershipMutations ?? []).filter((om) => om.artifactId === artifactId),
      threadMuts: s.threadMutations.filter((tm) => artifactThreadIds.has(tm.threadId)),
    }));

  return (
    <div className="flex flex-col gap-4">
      {/* Name + ID */}
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-text-primary">{artifact.name}</h2>
        <span className="font-mono text-[10px] text-text-dim">{artifactId}</span>
        <span className={`text-[10px] uppercase tracking-widest ${significanceClasses[artifact.significance] ?? 'text-text-dim'}`}>
          {artifact.significance}
        </span>
      </div>

      {/* Image prompt */}
      {artifact.imagePrompt && (
        <p className="text-[10px] text-text-dim italic leading-relaxed">{artifact.imagePrompt}</p>
      )}

      {/* Current owner */}
      <p className="text-xs text-text-secondary">
        {isWorldOwned ? (
          <span className="text-text-dim">world-owned</span>
        ) : (
          <>
            owned by{' '}
            <button
              type="button"
              onClick={() => dispatch({
                type: 'SET_INSPECTOR',
                context: ownerIsCharacter
                  ? { type: 'character', characterId: artifact.parentId! }
                  : { type: 'location', locationId: artifact.parentId! },
              })}
              className="text-text-primary hover:underline transition-colors"
            >
              {ownerName}
            </button>
          </>
        )}
      </p>

      {/* Continuity — paginated, most recent first */}
      {continuityNodes.length > 0 && (() => {
        const { pageItems, totalPages, safePage } = paginateRecent(continuityNodes, continuityPage);
        return (
          <CollapsibleSection title="Continuity" count={continuityNodes.length} defaultOpen>
            <ul className="flex flex-col gap-1">
              {pageItems.map((node, i) => (
                <li key={`${node.id}-${i}`} className="flex items-start gap-2">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${continuityDotColors[node.type] ?? 'bg-white/40'}`} />
                  <div className="flex flex-col">
                    <span className="text-xs text-text-primary">{node.content}</span>
                    <span className="text-[10px] text-text-dim">{node.type}</span>
                  </div>
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

      {/* Scenes — paginated, most recent first */}
      {lifecycle.length > 0 && (() => {
        const { pageItems, totalPages, safePage } = paginateRecent(lifecycle, scenesPage);
        return (
          <CollapsibleSection title="Scenes" count={lifecycle.length} defaultOpen>
            <ul className="flex flex-col gap-2">
              {pageItems.map(({ sceneId, usages, continuityMuts, ownershipMuts, threadMuts }) => (
                <li key={sceneId} className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId } })}
                    className="font-mono text-[10px] text-text-dim transition-colors hover:text-text-secondary"
                  >
                    {sceneId}
                  </button>
                  {usages.map((au, auIdx) => (
                    <div key={`usage-${au.characterId ?? 'unattributed'}-${auIdx}`} className="flex flex-col">
                      <span className="text-xs text-amber-300/80">
                        {au.characterId
                          ? narrative.characters[au.characterId]?.name ?? au.characterId
                          : 'unattributed'}
                      </span>
                      {au.usage && <span className="text-[10px] text-text-dim">{au.usage}</span>}
                    </div>
                  ))}
                  {threadMuts.map((tm, tmIdx) => (
                    <span key={`${tm.threadId}-${tmIdx}`} className="text-xs text-text-secondary">
                      {tm.threadId}: {tm.from} &rarr; {tm.to}
                    </span>
                  ))}
                  {continuityMuts.flatMap((km, kmIdx) =>
                    (km.addedNodes ?? []).map((node, nIdx) => (
                      <span key={`${km.entityId}-${node.id}-${kmIdx}-${nIdx}`} className="text-xs text-text-secondary">
                        <span className="text-world">+</span>{' '}
                        {node.content}
                      </span>
                    ))
                  )}
                  {ownershipMuts.map((om, omIdx) => {
                    const fromName = narrative.characters[om.fromId]?.name ?? narrative.locations[om.fromId]?.name ?? om.fromId;
                    const toName = narrative.characters[om.toId]?.name ?? narrative.locations[om.toId]?.name ?? om.toId;
                    return (
                      <span key={`transfer-${omIdx}`} className="text-xs text-text-secondary">
                        {fromName} &rarr; {toName}
                      </span>
                    );
                  })}
                </li>
              ))}
            </ul>
            <Paginator page={safePage} totalPages={totalPages} onPage={setScenesPage} />
          </CollapsibleSection>
        );
      })()}
    </div>
  );
}
