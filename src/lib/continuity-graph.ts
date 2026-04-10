/**
 * Continuity graph utilities — mutation application.
 *
 * Mirrors thread-log.ts: each continuityMutation represents one commit's
 * contribution (a world build or a scene) for a single entity. New nodes
 * chain sequentially in the order they appear via 'co_occurs' — no edges
 * are created across mutations and LLM-emitted addedEdges are ignored.
 * Node order alone defines the linkage.
 */

import type { Continuity, ContinuityMutation } from '@/types/narrative';

/** Empty continuity graph — the canonical "zero value" for entity initialization. */
export const EMPTY_CONTINUITY: Continuity = { nodes: {}, edges: [] };

/**
 * Apply one additive continuity mutation, returning a new graph.
 * New nodes are added in order and chained sequentially via 'co_occurs'.
 */
export function applyContinuityMutation(graph: Continuity, mutation: ContinuityMutation): Continuity {
  const nodes = { ...(graph.nodes ?? {}) };
  const edges = [...(graph.edges ?? [])];

  const newNodeIds: string[] = [];
  for (const n of mutation.addedNodes ?? []) {
    if (!n.id || !n.content) continue;
    if (!nodes[n.id]) {
      nodes[n.id] = { id: n.id, type: n.type || 'trait', content: n.content };
      newNodeIds.push(n.id);
    }
  }

  // Chain new nodes sequentially within this mutation — no cross-commit link.
  for (let i = 1; i < newNodeIds.length; i++) {
    edges.push({ from: newNodeIds[i - 1], to: newNodeIds[i], relation: 'co_occurs' });
  }

  return { nodes, edges };
}
