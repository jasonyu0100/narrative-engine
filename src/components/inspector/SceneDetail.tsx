'use client';

import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { useImageUrl } from '@/hooks/useAssetUrl';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';
import { computeForceSnapshots, detectCubeCorner } from '@/lib/narrative-utils';

type Props = {
  sceneId: string;
};

export default function SceneDetail({ sceneId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const forceSnapshot = useMemo(() => {
    if (!narrative) return { drive: 0, world: 0, system: 0 };
    const allScenes = state.resolvedEntryKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
    const forceMap = computeForceSnapshots(allScenes);
    return forceMap[sceneId] ?? { drive: 0, world: 0, system: 0 };
  }, [narrative, state.resolvedEntryKeys, sceneId]);

  // Resolve entry early to determine imageUrl for hook
  const entry = narrative ? resolveEntry(narrative, sceneId) : null;
  const imageUrl = useImageUrl(entry && isScene(entry) ? entry.imageUrl : undefined);

  if (!narrative) return null;
  if (!entry) return null;

  // ── World Build Commit view ─────────────────────────────────────────────
  if (entry.kind === 'world_build') {
    const m = entry.expansionManifest;
    const totalContinuityNodes = (m.continuityMutations ?? []).reduce((acc, cm) => acc + (cm.addedNodes?.length ?? 0), 0);
    const isEmpty =
      m.characters.length === 0 &&
      m.locations.length === 0 &&
      m.threads.length === 0 &&
      (m.artifacts?.length ?? 0) === 0 &&
      (m.relationships?.length ?? 0) === 0 &&
      (m.worldKnowledgeMutations?.addedNodes?.length ?? 0) === 0 &&
      (m.continuityMutations?.length ?? 0) === 0 &&
      (m.relationshipMutations?.length ?? 0) === 0 &&
      (m.ownershipMutations?.length ?? 0) === 0 &&
      (m.tieMutations?.length ?? 0) === 0;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-baseline gap-2">
          <h2 className="font-mono text-xs text-text-dim">{entry.id}</h2>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">
            World Build
          </span>
        </div>

        <p className="text-xs text-text-secondary leading-relaxed">{entry.summary || 'No summary available.'}</p>

        <div className="flex flex-col gap-1.5">
          {isEmpty && (
            <p className="text-[10px] text-text-dim italic">This expansion added nothing new.</p>
          )}
          {m.characters.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Characters</h3>
              <div className="flex flex-wrap gap-1.5">
                {m.characters.map((mc) => {
                  const char = narrative.characters[mc.id];
                  return (
                    <button
                      key={mc.id}
                      type="button"
                      onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'character', characterId: mc.id } })}
                      className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                    >
                      {char?.name ?? mc.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {m.locations.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Locations</h3>
              <div className="flex flex-wrap gap-1.5">
                {m.locations.map((ml) => {
                  const loc = narrative.locations[ml.id];
                  return (
                    <button
                      key={ml.id}
                      type="button"
                      onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'location', locationId: ml.id } })}
                      className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                    >
                      {loc?.name ?? ml.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {m.threads.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Threads</h3>
              <div className="flex flex-wrap gap-1.5">
                {m.threads.map((mt) => {
                  const thread = narrative.threads[mt.id];
                  const depCount = thread?.dependents?.filter((id) => narrative.threads[id]).length ?? 0;
                  return (
                    <button
                      key={mt.id}
                      type="button"
                      onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'thread', threadId: mt.id } })}
                      className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-primary transition-colors hover:bg-white/12"
                    >
                      {thread?.description ?? mt.description}
                      {depCount > 0 && <span className="text-cyan-400/70 ml-1">&#x21C4;{depCount}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {(m.relationships?.length ?? 0) > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">Relationships</span>
              {m.relationships.length} new
            </div>
          )}
          {(m.artifacts?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Artifacts</h3>
              <div className="flex flex-wrap gap-1.5">
                {m.artifacts!.map((ma) => {
                  const art = narrative.artifacts?.[ma.id];
                  return (
                    <button
                      key={ma.id}
                      type="button"
                      onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'artifact', artifactId: ma.id } })}
                      className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                    >
                      {art?.name ?? ma.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {(m.worldKnowledgeMutations?.addedNodes?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">World Knowledge</h3>
              <div className="flex flex-wrap gap-1.5">
                {m.worldKnowledgeMutations!.addedNodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: 'codex' })}
                    className="rounded bg-white/6 px-1.5 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                  >
                    {node.concept}
                    <span className="text-text-dim ml-1">({node.type})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {(m.continuityMutations?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Continuity ({totalContinuityNodes})</h3>
              <div className="flex flex-col gap-0.5">
                {m.continuityMutations!.map((cm, i) => {
                  const char = narrative.characters[cm.entityId];
                  const loc = narrative.locations[cm.entityId];
                  const art = narrative.artifacts?.[cm.entityId];
                  const name = char?.name ?? loc?.name ?? art?.name ?? cm.entityId;
                  const kind = char ? 'character' : loc ? 'location' : art ? 'artifact' : null;
                  return (
                    <button
                      key={`${cm.entityId}-${i}`}
                      type="button"
                      disabled={!kind}
                      onClick={() => {
                        if (kind === 'character') dispatch({ type: 'SET_INSPECTOR', context: { type: 'character', characterId: cm.entityId } });
                        else if (kind === 'location') dispatch({ type: 'SET_INSPECTOR', context: { type: 'location', locationId: cm.entityId } });
                        else if (kind === 'artifact') dispatch({ type: 'SET_INSPECTOR', context: { type: 'artifact', artifactId: cm.entityId } });
                      }}
                      className="text-left text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-60"
                    >
                      <span className="font-mono text-text-dim mr-1">{cm.entityId}</span>
                      {name}
                      <span className="text-text-dim ml-1">+{cm.addedNodes?.length ?? 0} node{(cm.addedNodes?.length ?? 0) === 1 ? '' : 's'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {(m.relationshipMutations?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Relationship Shifts</h3>
              <div className="flex flex-col gap-0.5">
                {m.relationshipMutations!.map((rm, i) => {
                  const from = narrative.characters[rm.from]?.name ?? rm.from;
                  const to = narrative.characters[rm.to]?.name ?? rm.to;
                  const sign = rm.valenceDelta > 0 ? '+' : '';
                  return (
                    <div key={`${rm.from}-${rm.to}-${i}`} className="text-[10px] text-text-secondary">
                      <span className="text-text-primary">{from}</span>
                      <span className="text-text-dim mx-1">&rarr;</span>
                      <span className="text-text-primary">{to}</span>
                      <span className="text-text-dim ml-1">{rm.type}</span>
                      <span className="text-drive ml-1">({sign}{rm.valenceDelta.toFixed(2)})</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {(m.ownershipMutations?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Ownership</h3>
              <div className="flex flex-col gap-0.5">
                {m.ownershipMutations!.map((om, i) => {
                  const art = narrative.artifacts?.[om.artifactId];
                  const fromName = narrative.characters[om.fromId]?.name ?? narrative.locations[om.fromId]?.name ?? om.fromId;
                  const toName = narrative.characters[om.toId]?.name ?? narrative.locations[om.toId]?.name ?? om.toId;
                  return (
                    <div key={`${om.artifactId}-${i}`} className="text-[10px] text-text-secondary">
                      <span className="text-text-primary">{art?.name ?? om.artifactId}</span>
                      <span className="text-text-dim mx-1">:</span>
                      <span>{fromName}</span>
                      <span className="text-text-dim mx-1">&rarr;</span>
                      <span>{toName}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {(m.tieMutations?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Ties</h3>
              <div className="flex flex-col gap-0.5">
                {m.tieMutations!.map((tm, i) => {
                  const loc = narrative.locations[tm.locationId];
                  const char = narrative.characters[tm.characterId];
                  return (
                    <div key={`${tm.locationId}-${tm.characterId}-${i}`} className="text-[10px] text-text-secondary">
                      <span className="text-text-primary">{char?.name ?? tm.characterId}</span>
                      <span className="text-text-dim mx-1">{tm.action === 'add' ? 'joined' : 'left'}</span>
                      <span className="text-text-primary">{loc?.name ?? tm.locationId}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

      </div>
    );
  }

  // ── Scene Commit view ───────────────────────────────────────────────────
  const scene = entry;
  const location = narrative.locations[scene.locationId];
  const effectivePovId = scene.povId || scene.participantIds[0];
  const povCharacter = effectivePovId ? narrative.characters[effectivePovId] : null;

  const { drive, world, system } = forceSnapshot;
  const cubeCorner = detectCubeCorner(forceSnapshot);

  const arc = Object.values(narrative.arcs).find((a) =>
    a.sceneIds.includes(sceneId)
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Scene still */}
      {imageUrl && (
        <img
          src={imageUrl}
          alt={scene.summary}
          className="w-full aspect-[2/3] object-cover rounded-lg border border-border"
        />
      )}

      {/* Scene ID + Arc */}
      <div className="flex items-baseline gap-2">
        <h2 className="font-mono text-xs text-text-dim">{scene.id}</h2>
        {arc && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'arc', arcId: arc.id } })}
            className="text-[10px] text-text-dim uppercase tracking-wider hover:text-text-secondary transition-colors"
          >
            {arc.name}
          </button>
        )}
      </div>

      {/* Location + POV */}
      <div className="flex flex-col gap-1.5">
        {location && (
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: 'SET_INSPECTOR',
                context: { type: 'location', locationId: location.id },
              })
            }
            className="flex items-center gap-1.5 text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            <svg className="w-3.5 h-3.5 shrink-0 text-text-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
            <span className="text-[10px] uppercase tracking-wider text-text-dim mr-1">Location</span>
            {location.name}
          </button>
        )}
        {povCharacter && (
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: 'SET_INSPECTOR',
                context: { type: 'character', characterId: effectivePovId },
              })
            }
            className="flex items-center gap-1.5 text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            <svg className="w-3.5 h-3.5 shrink-0 text-text-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span className="text-[10px] uppercase tracking-wider text-text-dim mr-1">POV</span>
            {povCharacter.name}
          </button>
        )}
      </div>

      {/* Summary */}
      <p className="text-xs text-text-secondary leading-relaxed">
        {scene.summary || 'No summary available.'}
      </p>

      {/* Participants */}
      {scene.participantIds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Participants
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {scene.participantIds.map((cid, cidIdx) => {
              const character = narrative.characters[cid];
              if (!character) return null;
              return (
                <button
                  key={`${cid}-${cidIdx}`}
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: 'SET_INSPECTOR',
                      context: { type: 'character', characterId: cid },
                    })
                  }
                  className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                >
                  {character.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Artifact Usages */}
      {(scene.artifactUsages ?? []).length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Artifacts
          </h3>
          <div className="flex flex-col gap-1.5">
            {(scene.artifactUsages ?? []).map((au, auIdx) => {
              const artifact = narrative.artifacts[au.artifactId];
              const character = au.characterId ? narrative.characters[au.characterId] : null;
              if (!artifact) return null;
              return (
                <div key={`${au.artifactId}-${au.characterId}-${auIdx}`} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: 'SET_INSPECTOR',
                          context: { type: 'artifact', artifactId: au.artifactId },
                        })
                      }
                      className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300 transition-colors hover:bg-amber-400/20"
                    >
                      {artifact.name}
                    </button>
                    {character && <span className="text-[10px] text-text-dim">({character.name})</span>}
                  </div>
                  {au.usage && <span className="text-[10px] text-text-dim pl-2">{au.usage}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Force Snapshot */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <svg width="24" height="12" viewBox="0 0 24 12">
            {cubeCorner.key.split('').map((c, i) => {
              const isHi = c === 'H';
              const colors = ['#EF4444', '#22C55E', '#3B82F6'];
              const barH = isHi ? 10 : 5;
              const barY = isHi ? 1 : 6;
              return (
                <rect key={i} x={i * 9} y={barY} width={7} height={barH} rx={1.5}
                  fill={colors[i]} opacity={isHi ? 1 : 0.4} />
              );
            })}
          </svg>
          <span className="text-[11px] text-text-secondary">{cubeCorner.name}</span>
        </div>
      </div>

      {/* Character Movements */}
      {scene.characterMovements && Object.keys(scene.characterMovements).length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Movements
          </h3>
          {Object.entries(scene.characterMovements).map(([charId, mv]) => {
            const charName = narrative.characters[charId]?.name ?? charId;
            const toLocName = narrative.locations[mv.locationId]?.name ?? mv.locationId;
            return (
              <div key={charId} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: 'SET_INSPECTOR',
                        context: { type: 'character', characterId: charId },
                      })
                    }
                    className="text-text-primary transition-colors hover:underline"
                  >
                    {charName}
                  </button>
                  <span className="text-text-dim">&rarr;</span>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: 'SET_INSPECTOR',
                        context: { type: 'location', locationId: mv.locationId },
                    })
                  }
                  className="text-text-secondary transition-colors hover:text-text-primary"
                >
                  {toLocName}
                </button>
                </div>
                {mv.transition && (
                  <span className="text-[10px] text-text-dim italic ml-3">{mv.transition}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Thread Mutations */}
      {scene.threadMutations.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Thread Mutations
          </h3>
          {scene.threadMutations.map((tm, tmIdx) => {
            const thread = narrative.threads[tm.threadId];
            return (
              <div key={`${tm.threadId}-${tmIdx}`} className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: 'SET_INSPECTOR',
                      context: { type: 'thread', threadId: tm.threadId },
                    })
                  }
                  className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-primary transition-colors hover:bg-white/12 shrink-0"
                >
                  {tm.threadId}
                </button>
                {thread && (
                  <span className="text-text-dim text-[10px] truncate max-w-25">{thread.description}</span>
                )}
                <span className="text-text-dim ml-auto shrink-0">{tm.from} &rarr; {tm.to}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Continuity Mutations */}
      {scene.continuityMutations.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Continuity Mutations
          </h3>
          {scene.continuityMutations.flatMap((km, kmIdx) => {
            const entityName = narrative.characters[km.entityId]?.name ?? narrative.locations[km.entityId]?.name ?? narrative.artifacts[km.entityId]?.name ?? km.entityId;
            const isChar = !!narrative.characters[km.entityId];
            return (km.addedNodes ?? []).map((node, nIdx) => (
              <div key={`${km.entityId}-${node.id}-${kmIdx}-${nIdx}`} className="flex flex-col gap-0.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      isChar && dispatch({
                        type: 'SET_INSPECTOR',
                        context: { type: 'character', characterId: km.entityId },
                      })
                    }
                    className="text-text-primary transition-colors hover:underline"
                  >
                    {entityName}
                  </button>
                  <span className="text-world">+</span>
                  <span className="font-mono text-[10px] text-text-dim">{node.id}</span>
                </div>
                <span className="text-text-secondary pl-2">{node.content}</span>
              </div>
            ));
          })}
        </div>
      )}

      {/* Relationship Mutations */}
      {scene.relationshipMutations.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Relationship Mutations
          </h3>
          {scene.relationshipMutations.map((rm, i) => {
            const fromName = narrative.characters[rm.from]?.name ?? rm.from;
            const toName = narrative.characters[rm.to]?.name ?? rm.to;
            return (
              <div key={`${rm.from}-${rm.to}-${i}`} className="flex flex-col gap-0.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: 'SET_INSPECTOR',
                        context: { type: 'character', characterId: rm.from },
                      })
                    }
                    className="text-text-primary transition-colors hover:underline"
                  >
                    {fromName}
                  </button>
                  <span className="text-text-dim">&harr;</span>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: 'SET_INSPECTOR',
                        context: { type: 'character', characterId: rm.to },
                      })
                    }
                    className="text-text-primary transition-colors hover:underline"
                  >
                    {toName}
                  </button>
                  <span className={rm.valenceDelta >= 0 ? 'text-world' : 'text-drive'}>
                    {rm.valenceDelta > 0 ? '+' : ''}{rm.valenceDelta}
                  </span>
                </div>
                <span className="text-text-secondary pl-2">{rm.type}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Ownership Mutations */}
      {(scene.ownershipMutations?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Artifact Transfers
          </h3>
          {scene.ownershipMutations!.map((om, i) => {
            const artName = narrative.artifacts?.[om.artifactId]?.name ?? om.artifactId;
            const fromName = narrative.characters[om.fromId]?.name ?? narrative.locations[om.fromId]?.name ?? om.fromId;
            const toName = narrative.characters[om.toId]?.name ?? narrative.locations[om.toId]?.name ?? om.toId;
            return (
              <div key={`om-${om.artifactId}-${i}`} className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'artifact', artifactId: om.artifactId } })}
                  className="text-amber-400 transition-colors hover:underline"
                >
                  {artName}
                </button>
                <span className="text-text-dim">{fromName} → {toName}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Ties Mutations */}
      {(scene.tieMutations?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Ties
          </h3>
          {scene.tieMutations!.map((mm, i) => {
            const charName = narrative.characters[mm.characterId]?.name ?? mm.characterId;
            const locName = narrative.locations[mm.locationId]?.name ?? mm.locationId;
            return (
              <div key={`mm-${mm.locationId}-${mm.characterId}-${i}`} className="flex items-center gap-1.5 text-xs">
                <span className={mm.action === 'add' ? 'text-world' : 'text-drive'}>
                  {mm.action === 'add' ? '+' : '−'}
                </span>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'character', characterId: mm.characterId } })}
                  className="text-text-primary transition-colors hover:underline"
                >
                  {charName}
                </button>
                <span className="text-text-dim">{mm.action === 'add' ? 'joins' : 'leaves'}</span>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'location', locationId: mm.locationId } })}
                  className="text-text-primary transition-colors hover:underline"
                >
                  {locName}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* World Knowledge Mutations */}
      {scene.worldKnowledgeMutations && ((scene.worldKnowledgeMutations.addedNodes?.length ?? 0) > 0 || (scene.worldKnowledgeMutations.addedEdges?.length ?? 0) > 0) && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            World Knowledge
          </h3>
          {(scene.worldKnowledgeMutations.addedNodes ?? []).map((node, i) => (
            <div key={`wk-node-${node.id}-${i}`} className="flex items-center gap-1.5 text-xs">
              <span className="text-world">+</span>
              <span className="text-text-primary">{node.concept}</span>
              <span className="text-[10px] text-text-dim">({node.type})</span>
            </div>
          ))}
          {(scene.worldKnowledgeMutations.addedEdges ?? []).map((edge, i) => {
            const fromNode = narrative.worldKnowledge.nodes[edge.from];
            const toNode = narrative.worldKnowledge.nodes[edge.to];
            const shortName = (concept: string) => {
              const dash = concept.indexOf(' — ');
              return dash > 0 ? concept.slice(0, dash) : concept;
            };
            return (
              <div key={`wk-edge-${edge.from}-${edge.to}-${i}`} className="text-xs pl-3 text-text-dim">
                {shortName(fromNode?.concept ?? edge.from ?? '')} <span className="italic text-text-dim">{edge.relation}</span> {shortName(toNode?.concept ?? edge.to ?? '')}
              </div>
            );
          })}
        </div>
      )}

      {/* Events */}
      {scene.events.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Events
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {scene.events.map((evt, evtIdx) => (
              <span key={`${evt}-${evtIdx}`} className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400/80">{evt}</span>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

function ForceBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1">
      <span className="text-[10px] uppercase text-text-dim">{label}</span>
      <div className="h-1.5 w-full rounded-full bg-white/6">
        <div
          className="h-1.5 rounded-full"
          style={{
            width: `${Math.max(0, Math.min(1, value)) * 100}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}
