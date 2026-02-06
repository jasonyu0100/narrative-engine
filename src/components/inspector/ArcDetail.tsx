'use client';

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';

type Props = {
  arcId: string;
};

export default function ArcDetail({ arcId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');

  if (!narrative) return null;

  const arc = narrative.arcs[arcId];
  if (!arc) return null;

  const arcScenes = useMemo(() => {
    const resolvedSet = new Set(state.resolvedSceneKeys);
    return arc.sceneIds
      .filter((sid) => resolvedSet.has(sid))
      .map((sid) => narrative.scenes[sid])
      .filter(Boolean);
  }, [arc, narrative, state.resolvedSceneKeys]);

  function startEdit() {
    setEditName(arc.name);
    setEditing(true);
  }

  function saveEdit() {
    dispatch({ type: 'UPDATE_ARC', arcId, updates: { name: editName } });
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Arc header */}
      <div>
        <h2 className="text-[10px] uppercase tracking-widest text-text-dim">Arc</h2>
        <span className="font-mono text-[10px] text-text-dim">{arcId}</span>
        {editing ? (
          <div className="flex gap-2 mt-0.5">
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="bg-bg-elevated border border-border rounded px-2 py-1 text-sm text-text-primary flex-1 outline-none"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
            />
            <button onClick={saveEdit} className="text-[10px] text-pacing">Save</button>
            <button onClick={() => setEditing(false)} className="text-[10px] text-text-dim">Cancel</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="text-sm text-text-primary font-medium mt-0.5 hover:text-white transition-colors text-left"
          >
            {arc.name}
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-[10px] text-text-dim uppercase tracking-wider">
        <span>{arcScenes.length} scenes</span>
        <span>{arc.activeCharacterIds.length} characters</span>
        <span>{arc.locationIds.length} locations</span>
      </div>

      {/* Threads developed */}
      {arc.develops.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Develops
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {arc.develops.map((threadId) => (
              <button
                key={threadId}
                type="button"
                onClick={() =>
                  dispatch({
                    type: 'SET_INSPECTOR',
                    context: { type: 'thread', threadId },
                  })
                }
                className="rounded bg-white/6 px-1.5 py-0.5 font-mono text-[10px] text-text-primary transition-colors hover:bg-white/12"
              >
                {threadId}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Characters */}
      {arc.activeCharacterIds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Characters
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {arc.activeCharacterIds.map((cid) => {
              const char = narrative.characters[cid];
              if (!char) return null;
              return (
                <button
                  key={cid}
                  type="button"
                  onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'character', characterId: cid } })}
                  className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] text-text-primary transition-colors hover:bg-white/12"
                >
                  {char.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Scene summaries */}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
          Scene Summaries
        </h3>
        <div className="flex flex-col gap-2">
          {arcScenes.map((scene, i) => {
            const sceneIdx = state.resolvedSceneKeys.indexOf(scene.id);
            return (
              <button
                key={scene.id}
                type="button"
                onClick={() => {
                  if (sceneIdx >= 0) {
                    dispatch({ type: 'SET_SCENE_INDEX', index: sceneIdx });
                  }
                  dispatch({
                    type: 'SET_INSPECTOR',
                    context: { type: 'scene', sceneId: scene.id },
                  });
                }}
                className="group flex flex-col gap-1 rounded bg-white/[0.03] p-2 text-left transition-colors hover:bg-white/[0.07]"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-text-dim">
                    {i + 1}
                  </span>
                  {scene.kind === 'scene' && (
                    <span className="text-[10px] text-text-dim">
                      {narrative.locations[scene.locationId]?.name}
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-secondary leading-relaxed group-hover:text-text-primary transition-colors">
                  {scene.summary || 'No summary available.'}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
