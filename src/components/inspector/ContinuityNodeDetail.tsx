'use client';

import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { getContinuityNodesAtScene, getContinuityEdgesAtScene } from '@/lib/scene-filter';
import { CONTINUITY_FILL } from '@/components/canvas/graph-utils';

type Props = { entityId: string; nodeId: string };

const TYPE_TEXT: Record<string, string> = {
  trait: 'text-violet-400', state: 'text-emerald-400', history: 'text-amber-400',
  capability: 'text-blue-400', belief: 'text-pink-300', relation: 'text-purple-400',
  secret: 'text-amber-500', goal: 'text-sky-400', weakness: 'text-red-400',
};

export default function ContinuityNodeDetail({ entityId, nodeId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  if (!narrative) return null;

  const entity = narrative.characters[entityId] ?? narrative.locations[entityId] ?? narrative.artifacts[entityId];
  if (!entity) return <p className="text-xs text-text-dim">Entity not found</p>;

  const entityType = narrative.characters[entityId] ? 'character' : narrative.locations[entityId] ? 'location' : 'artifact';

  const nodes = useMemo(() =>
    getContinuityNodesAtScene(entity.continuity.nodes, entityId, narrative.scenes, state.resolvedEntryKeys, state.currentSceneIndex),
    [entity, entityId, narrative, state.resolvedEntryKeys, state.currentSceneIndex],
  );

  const edges = useMemo(() =>
    getContinuityEdgesAtScene(entity.continuity.edges, entityId, narrative.scenes, state.resolvedEntryKeys, state.currentSceneIndex, entity.continuity.nodes),
    [entity, entityId, narrative, state.resolvedEntryKeys, state.currentSceneIndex],
  );

  const node = nodes.find(n => n.id === nodeId);
  if (!node) return <p className="text-xs text-text-dim">Node not found</p>;

  // All edges involving this node
  const connections = useMemo(() => {
    return edges
      .filter(e => e.from === nodeId || e.to === nodeId)
      .map(e => {
        const otherId = e.from === nodeId ? e.to : e.from;
        const other = nodes.find(n => n.id === otherId);
        const direction = e.from === nodeId ? 'outgoing' : 'incoming';
        return { otherId, other, relation: e.relation, direction };
      });
  }, [edges, nodes, nodeId]);

  // Scenes where this entity gains this node
  const mentionedScenes = useMemo(() => {
    const sceneIndices: number[] = [];
    for (let i = 0; i <= state.currentSceneIndex && i < state.resolvedEntryKeys.length; i++) {
      const key = state.resolvedEntryKeys[i];
      const scene = narrative.scenes[key];
      if (!scene) continue;
      for (const km of scene.continuityMutations) {
        if (km.entityId === entityId && (km.addedNodes ?? []).some(n => n.id === nodeId)) {
          sceneIndices.push(i);
        }
      }
    }
    return sceneIndices;
  }, [narrative, entityId, nodeId, state.resolvedEntryKeys, state.currentSceneIndex]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full shrink-0" style={{ background: CONTINUITY_FILL[node.type] ?? '#888' }} />
          <span className={`text-[10px] uppercase tracking-widest ${TYPE_TEXT[node.type] ?? 'text-text-dim'}`}>{node.type}</span>
        </div>
        <p className="text-sm text-text-primary leading-relaxed">{node.content}</p>
        <span className="font-mono text-[10px] text-text-dim">{nodeId}</span>
      </div>

      {/* Parent entity */}
      <button
        onClick={() => dispatch({
          type: 'SET_INSPECTOR',
          context: entityType === 'character' ? { type: 'character', characterId: entityId }
            : entityType === 'location' ? { type: 'location', locationId: entityId }
            : { type: 'artifact', artifactId: entityId },
        })}
        className="text-xs text-text-secondary hover:text-text-primary transition-colors text-left"
      >
        &larr; {entity.name} <span className="text-text-dim">({entityType})</span>
      </button>

      {/* Connections */}
      {connections.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">
            Connections ({connections.length})
          </h3>
          <ul className="flex flex-col gap-1.5">
            {connections.map((c, i) => (
              <li key={i} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-purple-400/70">
                    {c.direction === 'outgoing' ? '→' : '←'}
                  </span>
                  {c.other ? (
                    <button
                      onClick={() => dispatch({
                        type: 'SET_INSPECTOR',
                        context: { type: 'continuity', entityId, nodeId: c.otherId },
                      })}
                      className="text-xs text-text-secondary hover:text-text-primary transition-colors text-left"
                    >
                      {c.other.content.slice(0, 60)}{c.other.content.length > 60 ? '...' : ''}
                    </button>
                  ) : (
                    <span className="text-xs text-text-dim font-mono">{c.otherId}</span>
                  )}
                </div>
                <span className="text-[10px] text-text-dim pl-4">{c.relation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Scenes where this node was added */}
      {mentionedScenes.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim">Added in</h3>
          <div className="flex flex-wrap gap-1">
            {mentionedScenes.map((idx) => {
              const key = state.resolvedEntryKeys[idx];
              return (
                <button
                  key={idx}
                  onClick={() => {
                    dispatch({ type: 'SET_SCENE_INDEX', index: idx });
                    dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId: key } });
                  }}
                  className="font-mono text-[10px] text-text-dim hover:text-text-secondary transition-colors"
                >
                  S{idx + 1}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
