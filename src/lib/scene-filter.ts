import type {
  WorldNode,
  WorldEdge,
  RelationshipEdge,
  Scene,
  WorldBuild,
  NarrativeState,
  ThreadLog,
  ThreadLogNode,
  ThreadLogEdge,
} from '@/types/narrative';

// ── Introduced-entity tracking ──────────────────────────────────────────────

/** Collect entity IDs introduced by world builds and scenes up to (and including) currentSceneIndex. */
export function getIntroducedIds(
  worldBuilds: Record<string, WorldBuild>,
  scenes: Record<string, Scene>,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
): { characterIds: Set<string>; locationIds: Set<string>; threadIds: Set<string>; artifactIds: Set<string> } {
  const characterIds = new Set<string>();
  const locationIds = new Set<string>();
  const threadIds = new Set<string>();
  const artifactIds = new Set<string>();

  for (let i = 0; i <= currentSceneIndex && i < resolvedEntryKeys.length; i++) {
    const key = resolvedEntryKeys[i];

    // Process world build entities
    const wb = worldBuilds[key];
    if (wb) {
      for (const c of wb.expansionManifest.newCharacters) characterIds.add(c.id);
      for (const l of wb.expansionManifest.newLocations) locationIds.add(l.id);
      for (const t of wb.expansionManifest.newThreads) threadIds.add(t.id);
      for (const a of wb.expansionManifest.newArtifacts ?? []) artifactIds.add(a.id);
    }

    // Process scene-introduced entities
    const scene = scenes[key];
    if (scene) {
      for (const c of scene.newCharacters ?? []) characterIds.add(c.id);
      for (const l of scene.newLocations ?? []) locationIds.add(l.id);
      for (const t of scene.newThreads ?? []) threadIds.add(t.id);
      for (const a of scene.newArtifacts ?? []) artifactIds.add(a.id);
    }
  }

  return { characterIds, locationIds, threadIds, artifactIds };
}

// ── Knowledge filtering ─────────────────────────────────────────────────────

/**
 * Compute which world nodes exist at a given scene index by replaying
 * additive deltas forward. All initial nodes (from world-builds) plus
 * any nodes added by scenes up to currentSceneIndex.
 */
export function getWorldNodesAtScene(
  allNodes: Record<string, WorldNode>,
  entityId: string,
  scenes: Record<string, Scene>,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
): WorldNode[] {
  // Collect nodes added by scene deltas up to currentSceneIndex
  const addedByDeltas = new Map<string, WorldNode>();
  for (let i = 0; i <= currentSceneIndex && i < resolvedEntryKeys.length; i++) {
    const scene = scenes[resolvedEntryKeys[i]];
    if (!scene) continue;
    for (const wd of scene.worldDeltas) {
      if (wd.entityId !== entityId) continue;
      for (const node of wd.addedNodes ?? []) {
        addedByDeltas.set(node.id, { id: node.id, type: (node.type || 'trait') as WorldNode['type'], content: node.content });
      }
    }
  }

  // Collect ALL node IDs added across the full timeline
  const allDeltaNodeIds = new Set<string>();
  for (const key of resolvedEntryKeys) {
    const scene = scenes[key];
    if (!scene) continue;
    for (const wd of scene.worldDeltas) {
      if (wd.entityId !== entityId) continue;
      for (const node of wd.addedNodes ?? []) allDeltaNodeIds.add(node.id);
    }
  }

  // Initial nodes = those in allNodes but never referenced by any delta (seeded on world build)
  // These are visible from the start (they existed before any scene)
  const result: WorldNode[] = Object.values(allNodes).filter((node) => {
    if (!allDeltaNodeIds.has(node.id)) return true; // initial node — always visible
    return addedByDeltas.has(node.id); // scene-added — only if delta reached
  });

  // Include delta-added nodes that aren't in allNodes yet (not yet applied to entity graph)
  for (const [id, node] of addedByDeltas) {
    if (!allNodes[id]) result.push(node);
  }

  return result;
}

/**
 * Compute which world edges exist at a given scene index.
 * Filters the entity's accumulated edges to only those where both
 * endpoints are visible at the current scene index.
 */
export function getWorldEdgesAtScene(
  allEdges: WorldEdge[],
  entityId: string,
  scenes: Record<string, Scene>,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
  allNodes: Record<string, WorldNode>,
): WorldEdge[] {
  // Get the set of visible node IDs at this point in the timeline
  const visibleNodes = getWorldNodesAtScene(allNodes, entityId, scenes, resolvedEntryKeys, currentSceneIndex);
  const visibleIds = new Set(visibleNodes.map(n => n.id));
  // Only include edges where both endpoints are visible
  return allEdges.filter(e => visibleIds.has(e.from) && visibleIds.has(e.to));
}

// ── Relationship filtering ──────────────────────────────────────────────────

/**
 * Filter relationships to the state at currentSceneIndex.
 * Works backwards from the final state (narrative.relationships) by:
 *  1. Hiding relationships created by scene relationship deltas that haven't happened yet.
 *  2. Subtracting future relationship deltas to recover the correct valence.
 *  3. Hiding relationships where either character hasn't been introduced yet.
 */
export function getRelationshipsAtScene(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
): RelationshipEdge[] {
  const { characterIds: introducedChars } = getIntroducedIds(
    narrative.worldBuilds,
    narrative.scenes,
    resolvedEntryKeys,
    currentSceneIndex,
  );

  // Detect relationships CREATED (not just modified) by scene deltas.
  // A scene "creates" a relationship when applySceneDeltas finds no existing
  // edge for that from-to pair. We detect this by finding pairs whose first-ever
  // scene delta occurs AFTER currentSceneIndex — those don't exist yet.
  const firstDeltaIdx = new Map<string, number>();
  for (let i = 0; i < resolvedEntryKeys.length; i++) {
    const scene = narrative.scenes[resolvedEntryKeys[i]];
    if (!scene) continue;
    for (const rm of scene.relationshipDeltas) {
      const pk = `${rm.from}-${rm.to}`;
      if (!firstDeltaIdx.has(pk)) firstDeltaIdx.set(pk, i);
    }
  }

  // Collect relationships whose from-to pair ONLY exists because a scene created
  // it (i.e., it's NOT from a world build). A pair is world-build-originated if
  // its first delta modifies rather than creates — but we can't distinguish
  // that from the delta alone. Instead: if a pair's first scene delta is
  // after currentSceneIndex AND the pair is not covered by any world build
  // (both characters introduced but the pair has no scene delta before
  // currentSceneIndex), we assume it was created by that future scene.
  //
  // Simpler heuristic: a relationship is world-build-originated if it has NO
  // scene deltas at all, OR its first delta is within [0, currentSceneIndex].
  const futureCreatedPairs = new Set<string>();
  for (const rel of narrative.relationships) {
    const pk = `${rel.from}-${rel.to}`;
    const firstIdx = firstDeltaIdx.get(pk);
    // If first delta is after current scene AND there was a delta at all,
    // this might be scene-created. Check if the pair existed before that delta.
    // If no deltas reference this pair before the first scene delta, it was
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
    for (const rm of scene.relationshipDeltas) {
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

// ── Ownership filtering ──────────────────────────────────────────────────────

/**
 * Compute artifact ownership at a given scene index.
 * Replays ownershipDeltas from world builds and scenes up to currentSceneIndex.
 * Returns a map of artifactId → parentId (owner ID or null for world-owned).
 */
export function getOwnershipAtScene(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
): Map<string, string | null> {
  const ownership = new Map<string, string | null>();

  // Process world builds and scenes in timeline order up to currentSceneIndex
  for (let i = 0; i <= currentSceneIndex && i < resolvedEntryKeys.length; i++) {
    const key = resolvedEntryKeys[i];

    // Check if it's a world build
    const wb = narrative.worldBuilds[key];
    if (wb) {
      // Add initial artifacts from this world build
      for (const art of wb.expansionManifest.newArtifacts ?? []) {
        ownership.set(art.id, art.parentId ?? null);
      }
      // Apply ownership deltas from world build
      for (const om of wb.expansionManifest.ownershipDeltas ?? []) {
        ownership.set(om.artifactId, om.toId);
      }
    }

    // Check if it's a scene
    const scene = narrative.scenes[key];
    if (scene) {
      // Add artifacts introduced by this scene
      for (const art of scene.newArtifacts ?? []) {
        ownership.set(art.id, art.parentId ?? null);
      }
      // Apply ownership deltas from scene
      for (const om of scene.ownershipDeltas ?? []) {
        ownership.set(om.artifactId, om.toId);
      }
    }
  }

  return ownership;
}

// ── Tie filtering ────────────────────────────────────────────────────────────

/**
 * Compute character-location ties at a given scene index.
 * Replays tieDeltas from world builds and scenes up to currentSceneIndex.
 * Returns a map of locationId → Set of characterIds tied to that location.
 */
export function getTiesAtScene(
  narrative: NarrativeState,
  resolvedEntryKeys: string[],
  currentSceneIndex: number,
): Map<string, Set<string>> {
  const ties = new Map<string, Set<string>>();

  // Process world builds and scenes in timeline order up to currentSceneIndex
  for (let i = 0; i <= currentSceneIndex && i < resolvedEntryKeys.length; i++) {
    const key = resolvedEntryKeys[i];

    // Check if it's a world build
    const wb = narrative.worldBuilds[key];
    if (wb) {
      // Add initial locations with their tied characters
      for (const loc of wb.expansionManifest.newLocations ?? []) {
        const existing = ties.get(loc.id) ?? new Set<string>();
        for (const charId of loc.tiedCharacterIds ?? []) {
          existing.add(charId);
        }
        ties.set(loc.id, existing);
      }
      // Apply tie deltas from world build
      for (const tm of wb.expansionManifest.tieDeltas ?? []) {
        const existing = ties.get(tm.locationId) ?? new Set<string>();
        if (tm.action === 'add') {
          existing.add(tm.characterId);
        } else {
          existing.delete(tm.characterId);
        }
        ties.set(tm.locationId, existing);
      }
    }

    // Check if it's a scene
    const scene = narrative.scenes[key];
    if (scene) {
      // Add locations introduced by this scene with their tied characters
      for (const loc of scene.newLocations ?? []) {
        const existing = ties.get(loc.id) ?? new Set<string>();
        for (const charId of loc.tiedCharacterIds ?? []) {
          existing.add(charId);
        }
        ties.set(loc.id, existing);
      }
      // Apply tie deltas from scene
      for (const tm of scene.tieDeltas ?? []) {
        const existing = ties.get(tm.locationId) ?? new Set<string>();
        if (tm.action === 'add') {
          existing.add(tm.characterId);
        } else {
          existing.delete(tm.characterId);
        }
        ties.set(tm.locationId, existing);
      }
    }
  }

  return ties;
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
 * been added by scene thread deltas up to (and including) currentSceneIndex.
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
    for (const tm of scene.threadDeltas ?? []) {
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
