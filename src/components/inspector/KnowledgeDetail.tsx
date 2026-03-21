'use client';

import { useMemo, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { buildCumulativeWorldKnowledge } from '@/lib/narrative-utils';
import type { WorldKnowledgeNodeType } from '@/types/narrative';
import { CollapsibleSection } from './CollapsibleSection';

type Props = {
  nodeId: string;
};

const TYPE_COLORS: Record<WorldKnowledgeNodeType, string> = {
  law: 'bg-amber-400',
  system: 'bg-sky-400',
  concept: 'bg-violet-400',
  tension: 'bg-rose-400',
};

const TYPE_TEXT: Record<WorldKnowledgeNodeType, string> = {
  law: 'text-amber-400',
  system: 'text-sky-400',
  concept: 'text-violet-400',
  tension: 'text-rose-400',
};

export default function KnowledgeDetail({ nodeId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  if (!narrative) return null;

  const graph = useMemo(() => {
    return buildCumulativeWorldKnowledge(
      narrative.scenes,
      state.resolvedSceneKeys,
      state.currentSceneIndex,
      narrative.worldKnowledge,
      narrative.worldBuilds,
    );
  }, [narrative, state.resolvedSceneKeys, state.currentSceneIndex]);

  const node = graph.nodes[nodeId];
  if (!node) return <p className="text-xs text-text-dim">Node not found</p>;

  // All edges involving this node
  const connections = useMemo(() => {
    return graph.edges
      .filter((e) => e.from === nodeId || e.to === nodeId)
      .map((e) => {
        const otherId = e.from === nodeId ? e.to : e.from;
        const other = graph.nodes[otherId];
        const direction = e.from === nodeId ? 'outgoing' : 'incoming';
        return { otherId, other, relation: e.relation, direction };
      });
  }, [graph, nodeId]);

  // Group connections by the other node
  const grouped = useMemo(() => {
    const map = new Map<string, { other: typeof connections[0]['other']; relations: { relation: string; direction: string }[] }>();
    for (const c of connections) {
      if (!map.has(c.otherId)) {
        map.set(c.otherId, { other: c.other, relations: [] });
      }
      map.get(c.otherId)!.relations.push({ relation: c.relation, direction: c.direction });
    }
    return Array.from(map.entries()).sort((a, b) => b[1].relations.length - a[1].relations.length);
  }, [connections]);

  // Build index: for each knowledge node, which scene indices mention it
  const nodeSceneIndex = useMemo(() => {
    const map = new Map<string, number[]>();
    for (let i = 0; i <= state.currentSceneIndex && i < state.resolvedSceneKeys.length; i++) {
      const key = state.resolvedSceneKeys[i];
      const scene = narrative.scenes[key];
      const wb = narrative.worldBuilds?.[key];
      const wkm = scene?.worldKnowledgeMutations ?? wb?.worldKnowledgeMutations;
      if (!wkm) continue;
      const ids = new Set<string>();
      for (const n of wkm.addedNodes ?? []) ids.add(n.id);
      for (const e of wkm.addedEdges ?? []) { ids.add(e.from); ids.add(e.to); }
      for (const id of ids) {
        if (!map.has(id)) map.set(id, []);
        map.get(id)!.push(i);
      }
    }
    return map;
  }, [narrative, state.resolvedSceneKeys, state.currentSceneIndex]);

  // Navigate to a knowledge node:
  // - Spark mode: jump to the nearest scene that mentions it, then zoom in
  // - Codex mode: just zoom in on the node
  const navigateToNode = useCallback((targetId: string) => {
    if (state.graphViewMode === 'spark') {
      // Find nearest scene that mentions this node
      const sceneIndices = nodeSceneIndex.get(targetId) ?? [];
      if (sceneIndices.length > 0) {
        const current = state.currentSceneIndex;
        let nearest = sceneIndices[0];
        let minDist = Math.abs(current - nearest);
        for (const idx of sceneIndices) {
          const dist = Math.abs(current - idx);
          if (dist < minDist) { nearest = idx; minDist = dist; }
        }
        dispatch({ type: 'SET_SCENE_INDEX', index: nearest });
      }
    }
    dispatch({ type: 'SET_INSPECTOR', context: { type: 'knowledge', nodeId: targetId } });
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('focus-knowledge-node', { detail: { nodeId: targetId } }));
    }, 150);
  }, [nodeSceneIndex, state.graphViewMode, state.currentSceneIndex, dispatch]);

  // Scenes where this node was introduced
  const introScenes = useMemo(() => {
    const scenes: { sceneId: string; sceneTitle: string }[] = [];
    for (let i = 0; i <= state.currentSceneIndex && i < state.resolvedSceneKeys.length; i++) {
      const key = state.resolvedSceneKeys[i];
      const scene = narrative.scenes[key];
      if (!scene?.worldKnowledgeMutations) continue;
      const added = scene.worldKnowledgeMutations.addedNodes ?? [];
      if (added.some((n) => n.id === nodeId)) {
        scenes.push({ sceneId: key, sceneTitle: scene.events?.[0]?.slice(0, 60) ?? key });
      }
    }
    return scenes;
  }, [narrative, state.resolvedSceneKeys, state.currentSceneIndex, nodeId]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${TYPE_COLORS[node.type] ?? 'bg-white/40'}`} />
          <h2 className="text-sm font-semibold text-text-primary">{node.concept}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] uppercase tracking-widest ${TYPE_TEXT[node.type] ?? 'text-text-dim'}`}>
            {node.type}
          </span>
          <span className="text-[10px] text-text-dim font-mono">{nodeId}</span>
        </div>
      </div>

      {/* Connections */}
      {grouped.length > 0 && (
        <CollapsibleSection title="Connections" count={connections.length} defaultOpen>
          <ul className="flex flex-col gap-2">
            {grouped.map(([otherId, { other, relations }]) => (
              <li key={otherId} className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => navigateToNode(otherId)}
                  className="flex items-center gap-2 group"
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${other ? TYPE_COLORS[other.type] ?? 'bg-white/40' : 'bg-white/20'}`} />
                  <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">
                    {other?.concept ?? otherId}
                  </span>
                  {other && (
                    <span className={`text-[9px] ${TYPE_TEXT[other.type] ?? 'text-text-dim'}`}>
                      {other.type}
                    </span>
                  )}
                  {state.graphViewMode === 'spark' && (() => {
                    const indices = nodeSceneIndex.get(otherId);
                    if (!indices || indices.length === 0) return null;
                    const current = state.currentSceneIndex;
                    const nearest = indices.reduce((a, b) => Math.abs(b - current) < Math.abs(a - current) ? b : a);
                    if (nearest === current) return null;
                    const delta = nearest - current;
                    return <span className="text-[8px] text-text-dim/40 ml-auto">{delta > 0 ? '+' : ''}{delta}</span>;
                  })()}
                </button>
                {relations.map((r, i) => (
                  <span key={i} className="text-[10px] text-text-dim ml-4 flex items-center gap-1">
                    <span className="text-text-dim/50">{r.direction === 'outgoing' ? '\u2192' : '\u2190'}</span>
                    {r.relation}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {connections.length === 0 && (
        <p className="text-xs text-text-dim">No connections yet</p>
      )}

      {/* Introduced in */}
      {introScenes.length > 0 && (
        <CollapsibleSection title="Introduced in" count={introScenes.length}>
          <ul className="flex flex-col gap-1">
            {introScenes.map(({ sceneId, sceneTitle }) => (
              <li key={sceneId}>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId } })}
                  className="text-xs text-text-secondary hover:text-text-primary transition-colors"
                >
                  {sceneTitle}
                </button>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}
    </div>
  );
}
