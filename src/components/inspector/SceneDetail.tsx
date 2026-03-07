'use client';

import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';
import { computeForceSnapshots, detectCubeCorner } from '@/lib/narrative-utils';

type Props = {
  sceneId: string;
};

export default function SceneDetail({ sceneId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const forceSnapshot = useMemo(() => {
    if (!narrative) return { payoff: 0, change: 0, variety: 0 };
    const allScenes = state.resolvedSceneKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
    const forceMap = computeForceSnapshots(allScenes);
    return forceMap[sceneId] ?? { payoff: 0, change: 0, variety: 0 };
  }, [narrative, state.resolvedSceneKeys, sceneId]);

  if (!narrative) return null;

  const entry = resolveEntry(narrative, sceneId);
  if (!entry) return null;

  // ── World Build Commit view ─────────────────────────────────────────────
  if (entry.kind === 'world_build') {
    const m = entry.expansionManifest;
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
          {m.characterIds.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Characters</h3>
              <div className="flex flex-wrap gap-1.5">
                {m.characterIds.map((cid) => {
                  const char = narrative.characters[cid];
                  return (
                    <button
                      key={cid}
                      type="button"
                      onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'character', characterId: cid } })}
                      className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                    >
                      {char?.name ?? cid}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {m.locationIds.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Locations</h3>
              <div className="flex flex-wrap gap-1.5">
                {m.locationIds.map((lid) => {
                  const loc = narrative.locations[lid];
                  return (
                    <button
                      key={lid}
                      type="button"
                      onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'location', locationId: lid } })}
                      className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                    >
                      {loc?.name ?? lid}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {m.threadIds.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Threads</h3>
              <div className="flex flex-wrap gap-1.5">
                {m.threadIds.map((tid) => (
                  <button
                    key={tid}
                    type="button"
                    onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'thread', threadId: tid } })}
                    className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-primary transition-colors hover:bg-white/12"
                  >
                    {narrative.threads[tid]?.description ?? tid}
                  </button>
                ))}
              </div>
            </div>
          )}
          {m.relationshipCount > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">Relationships</span>
              {m.relationshipCount} new
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

  const { payoff, change, variety } = forceSnapshot;
  const cubeCorner = detectCubeCorner(forceSnapshot);

  const arc = Object.values(narrative.arcs).find((a) =>
    a.sceneIds.includes(sceneId)
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Scene still */}
      {scene.imageUrl && (
        <img
          src={scene.imageUrl}
          alt={scene.summary}
          className="w-full aspect-video object-cover rounded-lg border border-border"
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
        <div className="flex gap-3">
          <ForceBar label="Payoff" value={payoff} color="#EF4444" />
          <ForceBar label="Change" value={change} color="#22C55E" />
          <ForceBar label="Variety" value={variety} color="#3B82F6" />
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

      {/* Knowledge Mutations */}
      {scene.knowledgeMutations.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Knowledge Mutations
          </h3>
          {scene.knowledgeMutations.map((km, i) => {
            const charName = narrative.characters[km.characterId]?.name ?? km.characterId;
            return (
              <div key={`${km.characterId}-${km.nodeId}-${i}`} className="flex flex-col gap-0.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        type: 'SET_INSPECTOR',
                        context: { type: 'character', characterId: km.characterId },
                      })
                    }
                    className="text-text-primary transition-colors hover:underline"
                  >
                    {charName}
                  </button>
                  <span className={km.action === 'added' ? 'text-change' : 'text-payoff'}>
                    {km.action === 'added' ? '+' : '\u2212'}
                  </span>
                  <span className="font-mono text-[10px] text-text-dim">{km.nodeId}</span>
                </div>
                <span className="text-text-secondary pl-2">{km.content}</span>
              </div>
            );
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
                  <span className={rm.valenceDelta >= 0 ? 'text-change' : 'text-payoff'}>
                    {rm.valenceDelta > 0 ? '+' : ''}{rm.valenceDelta}
                  </span>
                </div>
                <span className="text-text-secondary pl-2">{rm.type}</span>
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
