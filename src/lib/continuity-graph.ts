/**
 * Continuity graph utilities — mutation application.
 *
 * Parallels the WorldKnowledgeGraph architecture: typed nodes in a Record,
 * typed edges between them. Mutations are additive (no removal).
 *
 * Edges are deterministic: nodes added in the same mutation are chained
 * sequentially, creating scene-by-scene clusters of knowledge.
 */

import type { Continuity, ContinuityMutation } from '@/types/narrative';

/** Empty continuity graph — the canonical "zero value" for entity initialization. */
export const EMPTY_CONTINUITY: Continuity = { nodes: {}, edges: [] };

/**
 * Apply a single additive continuity mutation to a graph, returning a new graph.
 * Nodes are added, then chained sequentially with 'co_occurs' edges to form
 * scene-level clusters. Any explicit edges from the mutation are also added.
 */
export function applyContinuityMutation(graph: Continuity, mutation: ContinuityMutation): Continuity {
  const nodes = { ...graph.nodes };
  const edges = [...graph.edges];

  // Collect newly added node IDs (in order) for sequential chaining
  const newNodeIds: string[] = [];

  for (const n of mutation.addedNodes ?? []) {
    if (!n.id || !n.content) continue;
    if (!nodes[n.id]) {
      nodes[n.id] = { id: n.id, type: n.type || 'trait', content: n.content };
      newNodeIds.push(n.id);
    }
  }

  // Deterministic: chain new nodes sequentially for scene-level clustering
  for (let i = 1; i < newNodeIds.length; i++) {
    edges.push({ from: newNodeIds[i - 1], to: newNodeIds[i], relation: 'co_occurs' });
  }

  // Also apply any explicit edges from the mutation
  for (const e of mutation.addedEdges ?? []) {
    if (!e.from || !e.to || !e.relation) continue;
    if (!edges.some(x => x.from === e.from && x.to === e.to && x.relation === e.relation)) {
      edges.push({ from: e.from, to: e.to, relation: e.relation });
    }
  }

  return { nodes, edges };
}
