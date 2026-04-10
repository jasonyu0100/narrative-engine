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

/**
 * Normalize a WK concept string for case-insensitive identity matching.
 * Mirrors text-analysis.ts getWkId(): lowercase + trim. Two concepts that
 * normalize to the same key are treated as the same node.
 */
export function normalizeWkConcept(concept: string): string {
  return concept.trim().toLowerCase();
}

/**
 * Create a closure that yields unique sequential WK-XX ids starting after
 * the max number already present in seedIds. Each call returns a fresh id
 * and increments the internal counter — safe to use across multiple resolve
 * passes without manually tracking which ids have been allocated.
 */
export function makeWkIdAllocator(seedIds: Iterable<string>): () => string {
  let counter = 0;
  for (const id of seedIds) {
    const m = /^WK-(\d+)$/.exec(id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > counter) counter = n;
    }
  }
  return () => {
    counter++;
    return `WK-${String(counter).padStart(2, '0')}`;
  };
}

/**
 * Resolve LLM-proposed WK node ids against an existing graph. Collapses
 * concepts that already exist (case-insensitive exact match) to their
 * existing id, and collapses within-batch duplicates to a single fresh id.
 * Mirrors text-analysis.ts getWkId() so that generation and analysis
 * pipelines produce comparable System scores — a concept seen before (in
 * the existing graph or earlier in this batch) does not earn a new node.
 *
 * Returns:
 *   idMap   — raw id → final canonical id for every resolved input node
 *   newNodes — only the nodes that are genuinely new and need to be added
 *              to the graph (existing-concept and within-batch-duplicate
 *              inputs are excluded)
 *
 * Callers use idMap to remap edge endpoints, then replace addedNodes with
 * newNodes so that downstream scoring only counts truly new concepts.
 */
export function resolveWkConceptIds(
  rawNodes: { id: string; concept: string; type: WorldKnowledgeNodeType }[],
  existingNodes: Record<string, WorldKnowledgeNode>,
  allocateFreshId: () => string,
): {
  idMap: Record<string, string>;
  newNodes: { id: string; concept: string; type: WorldKnowledgeNodeType }[];
} {
  // Index existing graph by normalized concept. If the graph ever grows a
  // node with the same concept under different ids (shouldn't happen post-
  // this helper being used everywhere, but historical data might), the first
  // one wins — stable resolution.
  const existingByConcept = new Map<string, string>();
  for (const node of Object.values(existingNodes)) {
    if (!node?.concept) continue;
    const key = normalizeWkConcept(node.concept);
    if (!existingByConcept.has(key)) existingByConcept.set(key, node.id);
  }

  const idMap: Record<string, string> = {};
  const newNodes: { id: string; concept: string; type: WorldKnowledgeNodeType }[] = [];
  const batchByConcept = new Map<string, string>();

  for (const raw of rawNodes) {
    if (!raw?.id || !raw.concept || !raw.type) continue;
    const key = normalizeWkConcept(raw.concept);
    if (!key) continue;

    // 1. Existing graph wins — re-mentioned concepts collapse to their id.
    const existingId = existingByConcept.get(key);
    if (existingId) {
      idMap[raw.id] = existingId;
      continue;
    }

    // 2. Earlier-in-batch occurrence wins — within-batch duplicates collapse.
    const batchId = batchByConcept.get(key);
    if (batchId) {
      idMap[raw.id] = batchId;
      continue;
    }

    // 3. Genuinely new concept — allocate a fresh id.
    const freshId = allocateFreshId();
    idMap[raw.id] = freshId;
    batchByConcept.set(key, freshId);
    newNodes.push({ id: freshId, concept: raw.concept, type: raw.type });
  }

  return { idMap, newNodes };
}
