/**
 * World knowledge graph utilities — mutation sanitization and application.
 *
 * Mirrors continuity-graph.ts and thread-log.ts: a single source of truth for
 * the invariants that every pipeline (generation, analysis, store derivation)
 * must enforce on world knowledge mutations. Prevents the class of bugs fixed
 * by commit 5eb90f0 from recurring by centralising the rules.
 *
 * Invariants:
 *   - No self-loops (from === to).
 *   - No edges referencing unknown nodes.
 *   - No edges missing from/to/relation.
 *   - No duplicate edges (by from→to→relation key) within the scope of a
 *     single seen-set — callers supply the set so it can span a full pipeline
 *     pass or be reset per scene as needed.
 *   - Nodes must carry concept + type.
 */

import type { WorldKnowledgeMutation, WorldKnowledgeGraph, WorldKnowledgeNode, WorldKnowledgeEdge, WorldKnowledgeNodeType } from '@/types/narrative';

/** Canonical empty WK graph — the "zero value" for narrative initialization. */
export const EMPTY_WORLD_KNOWLEDGE: WorldKnowledgeGraph = { nodes: {}, edges: [] };

/** Build the cross-mutation edge key used for dedup. */
export function wkEdgeKey(edge: { from: string; to: string; relation: string }): string {
  return `${edge.from}→${edge.to}→${edge.relation}`;
}

/**
 * Sanitize a WK mutation in place against a set of valid node IDs and a
 * cross-mutation seen-edges set. Returns the same mutation for convenience.
 *
 * Callers are responsible for assigning stable IDs to nodes BEFORE calling
 * this (e.g. remapping LLM-assigned WK-GEN-* ids to real WK-XX ids). The
 * validIds set should already contain any newly-assigned ids.
 */
export function sanitizeWorldKnowledgeMutation(
  mutation: WorldKnowledgeMutation,
  validIds: Set<string>,
  seenEdgeKeys: Set<string>,
): WorldKnowledgeMutation {
  mutation.addedNodes = (mutation.addedNodes ?? []).filter(
    (n) => n && n.id && n.concept && n.type,
  );
  mutation.addedEdges = (mutation.addedEdges ?? []).filter((edge) => {
    if (!edge || !edge.from || !edge.to || !edge.relation) return false;
    if (edge.from === edge.to) return false;
    if (!validIds.has(edge.from) || !validIds.has(edge.to)) return false;
    const key = wkEdgeKey(edge);
    if (seenEdgeKeys.has(key)) return false;
    seenEdgeKeys.add(key);
    return true;
  });
  return mutation;
}

/**
 * Apply a WK mutation to an accumulating graph. Additive — nodes are inserted
 * if not already present (by id), edges if not already present (by key).
 * Does NOT re-validate — callers should sanitize first. Provided so that
 * pipelines can build the global graph through the same entry point that
 * store derivation uses.
 */
export function applyWorldKnowledgeMutation(
  graph: { nodes: Record<string, WorldKnowledgeNode>; edges: WorldKnowledgeEdge[] },
  mutation: WorldKnowledgeMutation,
): void {
  for (const n of mutation.addedNodes ?? []) {
    if (!graph.nodes[n.id]) {
      graph.nodes[n.id] = { id: n.id, concept: n.concept, type: n.type };
    }
  }
  for (const e of mutation.addedEdges ?? []) {
    if (!graph.edges.some((x) => x.from === e.from && x.to === e.to && x.relation === e.relation)) {
      graph.edges.push({ from: e.from, to: e.to, relation: e.relation });
    }
  }
}

/**
 * Build a fresh "seen edges" set seeded with edges already present in an
 * existing graph. Use this when starting a new pipeline pass that should not
 * re-add edges that already exist in the narrative's WK graph.
 */
export function seenEdgeKeysFromGraph(graph: WorldKnowledgeGraph | undefined): Set<string> {
  const seen = new Set<string>();
  for (const e of graph?.edges ?? []) seen.add(wkEdgeKey(e));
  return seen;
}
