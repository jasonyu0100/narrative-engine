/**
 * Thread log utilities — mutation application.
 *
 * Mirrors continuity-graph.ts: each threadMutation represents one scene's
 * contribution to a thread's log. Nodes added by a single mutation chain
 * together sequentially via 'co_occurs'. No edges are created across
 * mutations/scenes — each scene's contribution is a self-contained cluster.
 */

import type { ThreadLog, ThreadMutation } from '@/types/narrative';

/** Empty thread log — the canonical "zero value" for thread initialization. */
export const EMPTY_THREAD_LOG: ThreadLog = { nodes: {}, edges: [] };

/**
 * Apply one thread mutation, returning a new log.
 * New nodes are added and chained sequentially via 'co_occurs'. Any explicit
 * edges from the mutation are filtered for self-loops, orphans, and duplicates.
 */
export function applyThreadMutation(log: ThreadLog, mutation: ThreadMutation): ThreadLog {
  const nodes = { ...(log?.nodes ?? {}) };
  const edges = [...(log?.edges ?? [])];

  const newNodeIds: string[] = [];
  for (const n of mutation.addedNodes ?? []) {
    if (!n.id || !n.content) continue;
    if (!nodes[n.id]) {
      nodes[n.id] = { id: n.id, type: n.type || 'pulse', content: n.content };
      newNodeIds.push(n.id);
    }
  }

  // Chain new nodes sequentially within this mutation — no cross-scene link.
  for (let i = 1; i < newNodeIds.length; i++) {
    edges.push({ from: newNodeIds[i - 1], to: newNodeIds[i], relation: 'co_occurs' });
  }

  // Explicit edges from the mutation — filter self-loops, orphans, duplicates.
  for (const e of mutation.addedEdges ?? []) {
    if (!e.from || !e.to || !e.relation) continue;
    if (e.from === e.to) continue;
    if (!nodes[e.from] || !nodes[e.to]) continue;
    if (!edges.some(x => x.from === e.from && x.to === e.to && x.relation === e.relation)) {
      edges.push({ from: e.from, to: e.to, relation: e.relation });
    }
  }

  return { nodes, edges };
}
