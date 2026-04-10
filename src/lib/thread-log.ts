/**
 * Thread log utilities — mutation application.
 *
 * Mirrors continuity-graph.ts: each ThreadMutation represents one scene's
 * contribution to a thread's log. New nodes chain sequentially in the order
 * they appear via 'co_occurs' — no edges are created across mutations and
 * LLM-emitted addedEdges are ignored. Node order alone defines the linkage.
 */

import type { ThreadLog, ThreadMutation } from '@/types/narrative';

/** Empty thread log — the canonical "zero value" for thread initialization. */
export const EMPTY_THREAD_LOG: ThreadLog = { nodes: {}, edges: [] };

/**
 * Apply one log mutation, returning a new log.
 * New nodes are added in order and chained sequentially via 'co_occurs'.
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

  return { nodes, edges };
}
