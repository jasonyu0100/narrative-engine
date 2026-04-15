'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { useImageUrl } from '@/hooks/useAssetUrl';
import { getWorldNodesAtScene, getThreadIdsAtScene, getOwnershipAtScene, getTiesAtScene } from '@/lib/scene-filter';
import { CollapsibleSection, Paginator, paginateRecent } from './CollapsibleSection';

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

  const sceneKeysUpToCurrent = state.resolvedEntryKeys.slice(0, state.viewState.currentSceneIndex + 1);

  // Knowledge filtered to current scene (location knowledge uses locationId as characterId
  // in the delta replay — location-specific knowledge nodes aren't changed by scenes,
  // so we pass the locationId and any matching deltas will be respected)
  const worldNodes = getWorldNodesAtScene(
    location.world.nodes,
    locationId,
    narrative.scenes,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
  );

  // Threads filtered to current scene
  const threadIds = getThreadIdsAtScene(
    location.threadIds ?? [],
    narrative.threads,
    state.resolvedEntryKeys,
    state.viewState.currentSceneIndex,
  );

  // Lifecycle: only scenes up to current scene index
  const locationThreadIds = new Set(location.threadIds ?? []);
  const lifecycle = sceneKeysUpToCurrent
    .map((k) => narrative.scenes[k])
    .filter((s) => s && s.locationId === locationId)
    .map((s) => ({
      sceneId: s.id,
      threadDeltas: s.threadDeltas.filter((tm) => locationThreadIds.has(tm.threadId)),
      worldDeltas: s.worldDeltas.filter((km) => km.entityId === locationId),
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

      {/* Spatial connections */}
      {(() => {
        const allLocations = Object.values(narrative.locations);
        const children = allLocations.filter((l) => l.parentId === locationId);
        const siblings = parent
          ? allLocations.filter((l) => l.parentId === parent.id && l.id !== locationId)
          : [];
        if (children.length === 0 && siblings.length === 0) return null;
        return (
          <CollapsibleSection title="Spatial" count={children.length + siblings.length} defaultOpen>
            <div className="flex flex-col gap-2">
              {children.length > 0 && (
                <div>
                  <span className="text-[9px] text-text-dim uppercase tracking-wide">Contains</span>
                  <ul className="flex flex-col gap-1 mt-1">
                    {children.map((child) => (
                      <li key={child.id}>
                        <button
                          type="button"
                          onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'location', locationId: child.id } })}
                          className="text-xs text-text-primary transition-colors hover:underline"
                        >
                          {child.name}
                          <span className="ml-1.5 text-[9px] text-text-dim">{child.prominence}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {siblings.length > 0 && (
                <div>
                  <span className="text-[9px] text-text-dim uppercase tracking-wide">Nearby</span>
                  <ul className="flex flex-col gap-1 mt-1">
                    {siblings.map((sib) => (
                      <li key={sib.id}>
                        <button
                          type="button"
                          onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'location', locationId: sib.id } })}
                          className="text-xs text-text-secondary transition-colors hover:underline"
                        >
                          {sib.name}
                          <span className="ml-1.5 text-[9px] text-text-dim">{sib.prominence}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CollapsibleSection>
        );
      })()}

      {/* Ties — characters with a significant bond to this location (at the current scene) */}
      {(() => {
        const sceneTies = getTiesAtScene(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
        const tiedIds = Array.from(sceneTies.get(locationId) ?? []);
        const tied = tiedIds.map(id => narrative.characters[id]).filter(Boolean);
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
      {worldNodes.length > 0 && (() => {
        const { pageItems, totalPages, safePage } = paginateRecent(worldNodes, continuityPage);
        return (
          <CollapsibleSection title="World" count={worldNodes.length} defaultOpen>
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

      {/* Artifacts at this location (at the current scene) */}
      {(() => {
        const sceneOwnership = getOwnershipAtScene(narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex);
        // Only artifacts already introduced by this scene. No fallback to
        // final parentId — that leaks future state into the present.
        const owned = Object.values(narrative.artifacts ?? {}).filter((a) => {
          if (!sceneOwnership.has(a.id)) return false;
          return sceneOwnership.get(a.id) === locationId;
        });
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
                {pageItems.map(({ sceneId, threadDeltas, worldDeltas, arrivals }) => (
                  <li key={sceneId} className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId } })}
                      className="font-mono text-[10px] text-text-dim transition-colors hover:text-text-secondary"
                    >
                      {sceneId}
                    </button>
                    {threadDeltas.map((tm, tmIdx) => (
                      <span key={`${tm.threadId}-${tmIdx}`} className="text-xs text-text-secondary">
                        {tm.threadId}: {tm.from} &rarr; {tm.to}
                      </span>
                    ))}
                    {worldDeltas.flatMap((km, kmIdx) =>
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
