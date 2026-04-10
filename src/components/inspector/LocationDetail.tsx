'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { useImageUrl } from '@/hooks/useAssetUrl';
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
  locationId: string;
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

export default function LocationDetail({ locationId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [continuityPage, setContinuityPage] = useState(0);
  const [threadPage, setThreadPage] = useState(0);
  const [scenesPage, setScenesPage] = useState(0);
  if (!narrative) return null;

  const location = narrative.locations[locationId];
  if (!location) return null;

  const imageUrl = useImageUrl(location.imageUrl);

  const parent = location.parentId ? narrative.locations[location.parentId] : null;

  const sceneKeysUpToCurrent = state.resolvedEntryKeys.slice(0, state.currentSceneIndex + 1);

  // Knowledge filtered to current scene (location knowledge uses locationId as characterId
  // in the mutation replay — location-specific knowledge nodes aren't mutated by scenes,
  // so we pass the locationId and any matching mutations will be respected)
  const continuityNodes = getContinuityNodesAtScene(
    location.continuity.nodes,
    locationId,
    narrative.scenes,
    state.resolvedEntryKeys,
    state.currentSceneIndex,
  );

  // Threads filtered to current scene
  const threadIds = getThreadIdsAtScene(
    location.threadIds,
    narrative.threads,
    state.resolvedEntryKeys,
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
      continuityMuts: s.continuityMutations.filter((km) => km.entityId === locationId),
      arrivals: Object.entries(s.characterMovements ?? {})
        .filter(([, mv]) => mv.locationId === locationId)
        .map(([charId]) => charId),
    }));

  return (
    <div className="flex flex-col gap-4">
      {/* Establishing shot */}
      {imageUrl && (
        <img
          src={imageUrl}
          alt={location.name}
          className="w-full aspect-video object-cover rounded-lg border border-border"
        />
      )}

      {/* Name + ID */}
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-text-primary">{location.name}</h2>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-text-dim">{locationId}</span>
          {location.prominence && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-text-dim">{location.prominence}</span>
          )}
        </div>
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

      {/* Ties — characters with a significant bond to this location */}
      {(location.tiedCharacterIds ?? []).length > 0 && (() => {
        const tied = (location.tiedCharacterIds ?? []).map(id => narrative.characters[id]).filter(Boolean);
        if (tied.length === 0) return null;
        return (
          <CollapsibleSection title="Ties" count={tied.length} defaultOpen>
            <ul className="flex flex-col gap-1">
              {tied.map((char) => (
                <li key={char.id}>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'character', characterId: char.id } })}
                    className="text-xs text-text-primary transition-colors hover:underline"
                  >
                    {char.name}
                    <span className="ml-1.5 text-[9px] text-text-dim">{char.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        );
      })()}

      {/* Image prompt */}
      {location.imagePrompt && (
        <p className="text-[10px] text-text-dim italic leading-relaxed">{location.imagePrompt}</p>
      )}

      {/* Continuity — paginated, most recent first */}
      {continuityNodes.length > 0 && (() => {
        const { pageItems, totalPages, safePage } = paginateRecent(continuityNodes, continuityPage);
        return (
          <CollapsibleSection title="Continuity" count={continuityNodes.length} defaultOpen>
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
          <CollapsibleSection title="Threads" count={threadIds.length} defaultOpen>
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

      {/* Artifacts at this location */}
      {(() => {
        const owned = Object.values(narrative.artifacts ?? {}).filter((a) => a.parentId === locationId);
        if (owned.length === 0) return null;
        return (
          <CollapsibleSection title="Artifacts" count={owned.length}>
            <ul className="flex flex-col gap-1">
              {owned.map((art) => (
                <li key={art.id}>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'artifact', artifactId: art.id } })}
                    className="text-xs text-amber-400 transition-colors hover:underline"
                  >
                    {art.name}
                    <span className="ml-1.5 text-text-dim">({art.significance})</span>
                  </button>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        );
      })()}

      {/* Scenes — paginated, most recent first */}
      {lifecycle.length > 0 && (() => {
        const { pageItems, totalPages, safePage } = paginateRecent(lifecycle, scenesPage);
        return (
          <CollapsibleSection title="Scenes" count={lifecycle.length} defaultOpen>
            {pageItems.length > 0 && (
              <ul className="flex flex-col gap-2">
                {pageItems.map(({ sceneId, threadMuts, continuityMuts, arrivals }) => (
                  <li key={sceneId} className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId } })}
                      className="font-mono text-[10px] text-text-dim transition-colors hover:text-text-secondary"
                    >
                      {sceneId}
                    </button>
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
                    {arrivals.map((charId, arrIdx) => (
                      <span key={`${charId}-${arrIdx}`} className="text-xs text-text-secondary">
                        &rarr; {narrative.characters[charId]?.name ?? charId} arrived
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            <Paginator page={safePage} totalPages={totalPages} onPage={setScenesPage} />
          </CollapsibleSection>
        );
      })()}
    </div>
  );
}
