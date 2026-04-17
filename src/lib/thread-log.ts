/**
 * Thread log utilities — delta application.
 *
 * Mirrors world-graph.ts: each ThreadDelta represents one scene's
 * contribution to a thread's log. New nodes chain sequentially in the order
 * they appear via 'co_occurs' — no edges are created across deltas and
 * LLM-emitted addedEdges are ignored. Node order alone defines the linkage.
 */

import type { ThreadLog, ThreadDelta } from '@/types/narrative';

/** Empty thread log — the canonical "zero value" for thread initialization. */
export const EMPTY_THREAD_LOG: ThreadLog = { nodes: {}, edges: [] };

/**
 * Apply one log delta, returning a new log.
 * New nodes are added in order and chained sequentially via 'co_occurs'.
 */
export function applyThreadDelta(log: ThreadLog, delta: ThreadDelta): ThreadLog {
  const nodes = { ...(log?.nodes ?? {}) };
  const edges = [...(log?.edges ?? [])];

  const newNodeIds: string[] = [];
  for (const n of delta.addedNodes ?? []) {
    if (!n.id || !n.content) continue;
    if (!nodes[n.id]) {
      nodes[n.id] = {
        id: n.id,
        type: n.type || 'pulse',
        content: n.content,
        ...(n.actorId ? { actorId: n.actorId } : {}),
        ...(n.targetId ? { targetId: n.targetId } : {}),
        ...(n.stance ? { stance: n.stance } : {}),
        ...(n.matrixCell ? { matrixCell: n.matrixCell } : {}),
      };
      newNodeIds.push(n.id);
    }
  }

  // Chain new nodes sequentially within this delta — no cross-scene link.
  for (let i = 1; i < newNodeIds.length; i++) {
    edges.push({ from: newNodeIds[i - 1], to: newNodeIds[i], relation: 'co_occurs' });
  }

  return { nodes, edges };
}
