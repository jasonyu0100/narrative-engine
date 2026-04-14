'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntityName } from '@/lib/narrative-utils';
import { getWorldNodesAtScene, getThreadIdsAtScene } from '@/lib/scene-filter';
import { CollapsibleSection, Paginator, paginateRecent } from './CollapsibleSection';

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
  const ownerName = isWorldOwned ? 'World' : resolveEntityName(narrative, ownerId);
  const ownerIsCharacter = !isWorldOwned && !!narrative.characters[ownerId];

  const sceneKeysUpToCurrent = state.resolvedEntryKeys.slice(0, state.viewState.currentSceneIndex + 1);

  // Continuity filtered to current scene
  const worldNodes = getWorldNodesAtScene(
    artifact.world.nodes,
    artifactId,
    narrative.scenes,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
  );

  // Threads filtered to current scene
  const threadIds = getThreadIdsAtScene(
    artifact.threadIds ?? [],
    narrative.threads,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
  );

  // Scenes: where artifact was used, had world deltas, ownership transfers, or thread activity
  const artifactThreadIds = new Set(artifact.threadIds ?? []);
  const lifecycle = sceneKeysUpToCurrent
    .map((k) => narrative.scenes[k])
    .filter((s) => {
      if (!s) return false;
      const hasUsage = (s.artifactUsages ?? []).some((au) => au.artifactId === artifactId);
      const hasContinuity = s.worldDeltas.some((km) => km.entityId === artifactId);
      const hasOwnership = (s.ownershipDeltas ?? []).some((om) => om.artifactId === artifactId);
      const hasThreadMut = s.threadDeltas.some((tm) => artifactThreadIds.has(tm.threadId));
      return hasUsage || hasContinuity || hasOwnership || hasThreadMut;
    })
    .map((s) => ({
      sceneId: s.id,
      usages: (s.artifactUsages ?? []).filter((au) => au.artifactId === artifactId),
      worldMuts: s.worldDeltas.filter((km) => km.entityId === artifactId),
      ownershipDeltas: (s.ownershipDeltas ?? []).filter((om) => om.artifactId === artifactId),
      threadDeltas: s.threadDeltas.filter((tm) => artifactThreadIds.has(tm.threadId)),
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
      {worldNodes.length > 0 && (() => {
        const { pageItems, totalPages, safePage } = paginateRecent(worldNodes, continuityPage);
        return (
          <CollapsibleSection title="World" count={worldNodes.length} defaultOpen>
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
              {pageItems.map(({ sceneId, usages, worldMuts, ownershipDeltas, threadDeltas }) => (
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
                  {threadDeltas.map((tm, tmIdx) => (
                    <span key={`${tm.threadId}-${tmIdx}`} className="text-xs text-text-secondary">
                      {tm.threadId}: {tm.from} &rarr; {tm.to}
                    </span>
                  ))}
                  {worldMuts.flatMap((km, kmIdx) =>
                    (km.addedNodes ?? []).map((node, nIdx) => (
                      <span key={`${km.entityId}-${node.id}-${kmIdx}-${nIdx}`} className="text-xs text-text-secondary">
                        <span className="text-world">+</span>{' '}
                        {node.content}
                      </span>
                    ))
                  )}
                  {ownershipDeltas.map((om, omIdx) => {
                    const fromName = resolveEntityName(narrative, om.fromId);
                    const toName = resolveEntityName(narrative, om.toId);
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
