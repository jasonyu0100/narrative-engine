import type {
  ContinuityNode,
  ContinuityEdge,
  RelationshipEdge,
  Scene,
  WorldBuild,
  NarrativeState,
  ThreadLog,
  ThreadLogNode,
  ThreadLogEdge,
} from '@/types/narrative';

// ── Introduced-entity tracking ──────────────────────────────────────────────

/** Collect entity IDs introduced by world builds up to (and including) currentSceneIndex. */
export function getIntroducedIds(
  worldBuilds: Record<string, WorldBuild>,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
): { characterIds: Set<string>; locationIds: Set<string>; threadIds: Set<string>; artifactIds: Set<string> } {
  const characterIds = new Set<string>();
  const locationIds = new Set<string>();
  const threadIds = new Set<string>();
  const artifactIds = new Set<string>();

  for (let i = 0; i <= currentSceneIndex && i < resolvedEntryKeys.length; i++) {
    const wb = worldBuilds[resolvedEntryKeys[i]];
    if (!wb) continue;
    for (const c of wb.expansionManifest.characters) characterIds.add(c.id);
    for (const l of wb.expansionManifest.locations) locationIds.add(l.id);
    for (const t of wb.expansionManifest.threads) threadIds.add(t.id);
    for (const a of wb.expansionManifest.artifacts ?? []) artifactIds.add(a.id);
  }

  return { characterIds, locationIds, threadIds, artifactIds };
}

// ── Knowledge filtering ─────────────────────────────────────────────────────

/**
 * Compute which continuity nodes exist at a given scene index by replaying
 * additive mutations forward. All initial nodes (from world-builds) plus
 * any nodes added by scenes up to currentSceneIndex.
 */
export function getContinuityNodesAtScene(
  allNodes: Record<string, ContinuityNode>,
  entityId: string,
  scenes: Record<string, Scene>,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
): ContinuityNode[] {
  // Collect nodes added by scene mutations up to currentSceneIndex
  const addedByMutations = new Map<string, ContinuityNode>();
  for (let i = 0; i <= currentSceneIndex && i < resolvedEntryKeys.length; i++) {
    const scene = scenes[resolvedEntryKeys[i]];
    if (!scene) continue;
    for (const km of scene.continuityMutations) {
      if (km.entityId !== entityId) continue;
      for (const node of km.addedNodes ?? []) {
        addedByMutations.set(node.id, { id: node.id, type: (node.type || 'trait') as ContinuityNode['type'], content: node.content });
      }
    }
  }

  // Collect ALL node IDs added across the full timeline
  const allMutatedNodeIds = new Set<string>();
  for (const key of resolvedEntryKeys) {
    const scene = scenes[key];
    if (!scene) continue;
    for (const km of scene.continuityMutations) {
      if (km.entityId !== entityId) continue;
      for (const node of km.addedNodes ?? []) allMutatedNodeIds.add(node.id);
    }
  }

  // Initial nodes = those in allNodes but never referenced by any mutation (seeded on world build)
  // These are visible from the start (they existed before any scene)
  const result: ContinuityNode[] = Object.values(allNodes).filter((node) => {
    if (!allMutatedNodeIds.has(node.id)) return true; // initial node — always visible
    return addedByMutations.has(node.id); // scene-added — only if mutation reached
  });

  // Include mutation-added nodes that aren't in allNodes yet (not yet applied to entity graph)
  for (const [id, node] of addedByMutations) {
    if (!allNodes[id]) result.push(node);
  }

  return result;
}

/**
 * Compute which continuity edges exist at a given scene index.
 * Filters the entity's accumulated edges to only those where both
 * endpoints are visible at the current scene index.
 */
export function getContinuityEdgesAtScene(
  allEdges: ContinuityEdge[],
  entityId: string,
  scenes: Record<string, Scene>,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
  allNodes: Record<string, ContinuityNode>,
): ContinuityEdge[] {
  // Get the set of visible node IDs at this point in the timeline
  const visibleNodes = getContinuityNodesAtScene(allNodes, entityId, scenes, resolvedEntryKeys, currentSceneIndex);
  const visibleIds = new Set(visibleNodes.map(n => n.id));
  // Only include edges where both endpoints are visible
  return allEdges.filter(e => visibleIds.has(e.from) && visibleIds.has(e.to));
}

// ── Relationship filtering ──────────────────────────────────────────────────

/**
 * Filter relationships to the state at currentSceneIndex.
 * Works backwards from the final state (narrative.relationships) by:
 *  1. Hiding relationships created by scene mutations that haven't happened yet.
 *  2. Subtracting future mutation deltas to recover the correct valence.
 *  3. Hiding relationships where either character hasn't been introduced yet.
 */
export function getRelationshipsAtScene(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
): RelationshipEdge[] {
  const { characterIds: introducedChars } = getIntroducedIds(
    narrative.worldBuilds,
    resolvedEntryKeys,
    currentSceneIndex,
  );

  // Detect relationships CREATED (not just modified) by scene mutations.
  // A scene "creates" a relationship when applySceneMutations finds no existing
  // edge for that from-to pair. We detect this by finding pairs whose first-ever
  // scene mutation occurs AFTER currentSceneIndex — those don't exist yet.
  const firstMutationIdx = new Map<string, number>();
  for (let i = 0; i < resolvedEntryKeys.length; i++) {
    const scene = narrative.scenes[resolvedEntryKeys[i]];
    if (!scene) continue;
    for (const rm of scene.relationshipMutations) {
      const pk = `${rm.from}-${rm.to}`;
      if (!firstMutationIdx.has(pk)) firstMutationIdx.set(pk, i);
    }
  }

  // Collect relationships whose from-to pair ONLY exists because a scene created
  // it (i.e., it's NOT from a world build). A pair is world-build-originated if
  // its first mutation modifies rather than creates — but we can't distinguish
  // that from the mutation alone. Instead: if a pair's first scene mutation is
  // after currentSceneIndex AND the pair is not covered by any world build
  // (both characters introduced but the pair has no scene mutation before
  // currentSceneIndex), we assume it was created by that future scene.
  //
  // Simpler heuristic: a relationship is world-build-originated if it has NO
  // scene mutations at all, OR its first mutation is within [0, currentSceneIndex].
  const futureCreatedPairs = new Set<string>();
  for (const rel of narrative.relationships) {
    const pk = `${rel.from}-${rel.to}`;
    const firstIdx = firstMutationIdx.get(pk);
    // If first mutation is after current scene AND there was a mutation at all,
    // this might be scene-created. Check if the pair existed before that mutation.
    // If no mutations reference this pair before the first scene mutation, it was
    // created by that scene.
    if (firstIdx !== undefined && firstIdx > currentSceneIndex) {
      futureCreatedPairs.add(pk);
    }
  }

  // Accumulate future deltas to subtract from final valence
  const futureDeltas = new Map<string, number>();
  for (let i = currentSceneIndex + 1; i < resolvedEntryKeys.length; i++) {
    const scene = narrative.scenes[resolvedEntryKeys[i]];
    if (!scene) continue;
    for (const rm of scene.relationshipMutations) {
      const pk = `${rm.from}-${rm.to}`;
      futureDeltas.set(pk, (futureDeltas.get(pk) ?? 0) + rm.valenceDelta);
    }
  }

  return narrative.relationships
    .filter((rel) => {
      if (!introducedChars.has(rel.from) || !introducedChars.has(rel.to)) return false;
      if (futureCreatedPairs.has(`${rel.from}-${rel.to}`)) return false;
      return true;
    })
    .map((rel) => {
      const fd = futureDeltas.get(`${rel.from}-${rel.to}`);
      if (fd === undefined) return rel;
      return { ...rel, valence: rel.valence - fd };
    });
}

// ── Thread filtering ────────────────────────────────────────────────────────

/**
 * Filter thread IDs to only those introduced (openedAt) at or before currentSceneIndex.
 */
export function getThreadIdsAtScene(
  threadIds: string[],
  threads: NarrativeState['threads'],
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
): string[] {
  const keysUpToCurrent = new Set(resolvedEntryKeys.slice(0, currentSceneIndex + 1));
  return threadIds.filter((tid) => {
    const thread = threads[tid];
    if (!thread) return false;
    return keysUpToCurrent.has(thread.openedAt);
  });
}

/**
 * Progressive reveal for a thread's log: return only the nodes/edges that have
 * been added by scene thread mutations up to (and including) currentSceneIndex.
 *
 * threadLog.nodes are appended sequentially by the store reducer as scenes play,
 * so we count how many entries each scene contributed and take the first N
 * nodes (in insertion order), then keep only edges where both endpoints survive.
 */
export function getThreadLogAtScene(
  threadLog: ThreadLog,
  threadId: string,
  scenes: Record<string, Scene>,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
): { nodes: ThreadLogNode[]; edges: ThreadLogEdge[] } {
  let visibleCount = 0;
  for (let i = 0; i <= currentSceneIndex && i < resolvedEntryKeys.length; i++) {
    const scene = scenes[resolvedEntryKeys[i]];
    if (!scene) continue;
    for (const tm of scene.threadMutations ?? []) {
      if (tm.threadId !== threadId) continue;
      visibleCount += (tm.addedNodes && tm.addedNodes.length > 0) ? tm.addedNodes.length : 1;
    }
  }
  const allNodes = Object.values(threadLog?.nodes ?? {});
  const nodes = allNodes.slice(0, visibleCount);
  const visibleIds = new Set(nodes.map((n) => n.id));
  const edges = (threadLog?.edges ?? []).filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to));
  return { nodes, edges };
}
