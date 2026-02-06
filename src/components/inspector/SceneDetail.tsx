'use client';

import { useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';
import { computeForceSnapshots } from '@/lib/narrative-utils';

type Props = {
  sceneId: string;
};

export default function SceneDetail({ sceneId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [editing, setEditing] = useState(false);
  const [editSummary, setEditSummary] = useState('');

  const forceSnapshot = useMemo(() => {
    if (!narrative) return { stakes: 0, pacing: 0, variety: 0 };
    const allScenes = state.resolvedSceneKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
    const forceMap = computeForceSnapshots(allScenes);
    return forceMap[sceneId] ?? { stakes: 0, pacing: 0, variety: 0 };
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

  const { stakes, pacing, variety } = forceSnapshot;

  const arc = Object.values(narrative.arcs).find((a) =>
    a.sceneIds.includes(sceneId)
  );

  function startEdit() {
    setEditSummary(scene.summary);
    setEditing(true);
  }

  function saveEdit() {
    dispatch({ type: 'UPDATE_SCENE', sceneId, updates: { summary: editSummary } });
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-4">
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

      {/* Location */}
      {location && (
        <button
          type="button"
          onClick={() =>
            dispatch({
              type: 'SET_INSPECTOR',
              context: { type: 'location', locationId: location.id },
            })
          }
          className="text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
        >
          {location.name}
        </button>
      )}

      {/* Summary — editable */}
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={editSummary}
            onChange={(e) => setEditSummary(e.target.value)}
            className="bg-bg-elevated border border-border rounded px-2 py-1.5 text-xs text-text-primary w-full h-24 resize-none outline-none"
          />
          <div className="flex gap-2">
            <button onClick={saveEdit} className="text-[10px] text-pacing hover:underline">Save</button>
            <button onClick={() => setEditing(false)} className="text-[10px] text-text-dim hover:underline">Cancel</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={startEdit}
          className="text-left text-xs text-text-secondary leading-relaxed hover:text-text-primary transition-colors"
        >
          {scene.summary || 'Click to add summary...'}
        </button>
      )}

      {/* Participants */}
      {scene.participantIds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Participants
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {scene.participantIds.map((cid) => {
              const character = narrative.characters[cid];
              if (!character) return null;
              return (
                <button
                  key={cid}
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
      <div>
        <div className="flex gap-3">
          <ForceBar label="Stakes" value={stakes} color="#EF4444" />
          <ForceBar label="Pacing" value={pacing} color="#22C55E" />
          <ForceBar label="Variety" value={variety} color="#3B82F6" />
        </div>
      </div>

      {/* Character Movements */}
      {scene.characterMovements && Object.keys(scene.characterMovements).length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Movements
          </h3>
          {Object.entries(scene.characterMovements).map(([charId, toLocId]) => {
            const charName = narrative.characters[charId]?.name ?? charId;
            const toLocName = narrative.locations[toLocId]?.name ?? toLocId;
            return (
              <div key={charId} className="flex items-center gap-1.5 text-xs">
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
                      context: { type: 'location', locationId: toLocId },
                    })
                  }
                  className="text-text-secondary transition-colors hover:text-text-primary"
                >
                  {toLocName}
                </button>
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
          {scene.threadMutations.map((tm) => (
            <div key={tm.threadId} className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() =>
                  dispatch({
                    type: 'SET_INSPECTOR',
                    context: { type: 'thread', threadId: tm.threadId },
                  })
                }
                className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-primary transition-colors hover:bg-white/12"
              >
                {tm.threadId}
              </button>
              <span className="text-text-dim">
                {tm.from} &rarr; {tm.to}
              </span>
            </div>
          ))}
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
                  <span className={km.action === 'added' ? 'text-pacing' : 'text-stakes'}>
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
          {scene.relationshipMutations.map((rm) => {
            const fromName = narrative.characters[rm.from]?.name ?? rm.from;
            const toName = narrative.characters[rm.to]?.name ?? rm.to;
            return (
              <div key={`${rm.from}-${rm.to}`} className="flex flex-col gap-0.5 text-xs">
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
                  <span className={rm.valenceDelta >= 0 ? 'text-pacing' : 'text-stakes'}>
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
        <div className="flex flex-col gap-1">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Events
          </h3>
          <ul className="flex flex-col gap-0.5">
            {scene.events.map((evt) => (
              <li key={evt} className="text-xs text-text-dim">
                {evt}
              </li>
            ))}
          </ul>
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
      <div className="h-1.5 w-full rounded-full bg-white/[0.06]">
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
