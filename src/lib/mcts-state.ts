import type { NarrativeState, Scene } from '@/types/narrative';
import { resolveEntry, isScene } from '@/types/narrative';
import type { MCTSNode } from '@/types/mcts';
import { computeRawForceTotals, computeSwingMagnitudes, gradeForces, FORCE_REFERENCE_MEANS } from '@/lib/narrative-utils';
import { applyContinuityMutation } from '@/lib/continuity-graph';

/**
 * Apply scene mutations (relationship + knowledge + thread) to a narrative state.
 * Duplicated from store.tsx to avoid importing React-heavy store module.
 */
function applySceneMutations(n: NarrativeState, scenes: Scene[]): NarrativeState {
  let relationships = [...n.relationships];
  const characters = { ...n.characters };
  const locations = { ...n.locations };
  const artifacts = { ...n.artifacts };
  const threads = { ...n.threads };
  const systemGraph = { nodes: { ...n.systemGraph?.nodes }, edges: [...(n.systemGraph?.edges ?? [])] };

  for (const scene of scenes) {
    for (const rm of scene.relationshipMutations) {
      const idx = relationships.findIndex((r) => r.from === rm.from && r.to === rm.to);
      if (idx >= 0) {
        const existing = relationships[idx];
        relationships = [
          ...relationships.slice(0, idx),
          { ...existing, type: rm.type, valence: Math.max(-1, Math.min(1, existing.valence + rm.valenceDelta)) },
          ...relationships.slice(idx + 1),
        ];
      } else {
        relationships.push({ from: rm.from, to: rm.to, type: rm.type, valence: Math.max(-1, Math.min(1, rm.valenceDelta)) });
      }
    }
    for (const km of scene.continuityMutations) {
      const char = characters[km.entityId];
      const loc = locations[km.entityId];
      const art = artifacts[km.entityId];
      if (char) characters[km.entityId] = { ...char, continuity: applyContinuityMutation(char.continuity, km) };
      else if (loc) locations[km.entityId] = { ...loc, continuity: applyContinuityMutation(loc.continuity, km) };
      else if (art) artifacts[km.entityId] = { ...art, continuity: applyContinuityMutation(art.continuity, km) };
    }
    for (const tm of scene.threadMutations) {
      const thread = threads[tm.threadId];
      if (thread) threads[tm.threadId] = { ...thread, status: tm.to };
    }
    const wkm = scene.systemMutations;
    if (wkm) {
      for (const node of wkm.addedNodes ?? []) {
        if (!systemGraph.nodes[node.id]) {
          systemGraph.nodes[node.id] = { id: node.id, concept: node.concept, type: node.type };
        }
      }
      for (const edge of wkm.addedEdges ?? []) {
        if (!systemGraph.edges.some((e: { from: string; to: string; relation: string }) => e.from === edge.from && e.to === edge.to && e.relation === edge.relation)) {
          systemGraph.edges.push({ from: edge.from, to: edge.to, relation: edge.relation });
        }
      }
    }
  }

  return { ...n, relationships, characters, locations, artifacts, threads, systemGraph };
}

// ── Virtual State Construction ───────────────────────────────────────────────

export type VirtualState = {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentIndex: number;
};

/**
 * Build a virtual NarrativeState by applying a chain of MCTS ancestor nodes
 * on top of the root narrative. Each node's scenes/arc are added, mutations applied,
 * and branch entryIds extended — producing the state as if those arcs were committed.
 */
export function buildVirtualState(
  rootNarrative: NarrativeState,
  rootResolvedKeys: string[],
  rootCurrentIndex: number,
  ancestorNodes: Pick<MCTSNode, 'scenes' | 'arc'>[],
  activeBranchId: string,
): VirtualState {
  // Deep clone the root to avoid mutation
  let narrative: NarrativeState = JSON.parse(JSON.stringify(rootNarrative));
  let resolvedKeys = [...rootResolvedKeys];
  let currentIndex = rootCurrentIndex;

  for (const node of ancestorNodes) {
    // Add scenes to the narrative
    for (const scene of node.scenes) {
      narrative.scenes[scene.id] = scene;
    }

    // Add or update the arc
    if (!narrative.arcs[node.arc.id]) {
      narrative.arcs[node.arc.id] = node.arc;
    } else {
      const existing = narrative.arcs[node.arc.id];
      const existingSet = new Set(existing.sceneIds);
      const deduped = node.arc.sceneIds.filter((id) => !existingSet.has(id));
      narrative.arcs[node.arc.id] = { ...existing, sceneIds: [...existing.sceneIds, ...deduped] };
    }

    // Extend branch entryIds
    const branch = narrative.branches[activeBranchId];
    if (branch) {
      const existingSet = new Set(branch.entryIds);
      const newEntries = node.scenes.map((s) => s.id).filter((id) => !existingSet.has(id));
      narrative.branches[activeBranchId] = {
        ...branch,
        entryIds: [...branch.entryIds, ...newEntries],
      };
    }

    // Apply mutations (relationships, knowledge, threads)
    narrative = applySceneMutations(narrative, node.scenes);

    // Update resolved keys and index
    const newKeys = node.scenes.map((s) => s.id).filter((id) => !resolvedKeys.includes(id));
    resolvedKeys = [...resolvedKeys, ...newKeys];
    currentIndex = resolvedKeys.length - 1;
  }

  return { narrative, resolvedKeys, currentIndex };
}

// ── Arc Scoring ──────────────────────────────────────────────────────────────

/**
 * Score a generated arc's scenes using the force grading system.
 * Raw forces for drive/change/knowledge (normalised by reference means in gradeForces).
 * Swing from mean-normalised raw forces (single normalisation, preserves absolute magnitude).
 *
 * @param arcScenes - The scenes in this arc
 * @param priorScenes - All scenes before this arc (unused, retained for API compatibility)
 */
export function scoreArc(arcScenes: Scene[], priorScenes: Scene[]): number {
  if (arcScenes.length === 0) return 0;

  const raw = computeRawForceTotals(arcScenes);
  const forces = raw.drive.map((_, i) => ({
    drive: raw.drive[i],
    world: raw.world[i],
    system: raw.system[i],
  }));
  const swings = computeSwingMagnitudes(forces, FORCE_REFERENCE_MEANS);

  const grades = gradeForces(raw.drive, raw.world, raw.system, swings);
  return grades.overall;
}

// ── Scene Scoring ────────────────────────────────────────────────────────────

/**
 * Score a single scene using the force grading system.
 * For a single scene there's no swing (no consecutive pair), so the score is
 * out of 75 (P + C + K) rescaled to 0-100 for consistency with arc scoring.
 *
 * @param scene - The scene to score
 * @param priorScenes - Prior scenes for swing context (last scene used for swing calc)
 */
export function scoreScene(scene: Scene, priorScenes: Scene[]): number {
  const raw = computeRawForceTotals([scene]);

  // If we have prior scenes, compute swing against the last one for a meaningful swing grade
  let swings: number[];
  if (priorScenes.length > 0) {
    const lastScene = priorScenes[priorScenes.length - 1];
    const combined = computeRawForceTotals([lastScene, scene]);
    const combinedForces = combined.drive.map((_, i) => ({
      drive: combined.drive[i],
      world: combined.world[i],
      system: combined.system[i],
    }));
    const allSwings = computeSwingMagnitudes(combinedForces, FORCE_REFERENCE_MEANS);
    swings = [allSwings[allSwings.length - 1] ?? 0];
  } else {
    swings = [0];
  }

  const grades = gradeForces(raw.drive, raw.world, raw.system, swings);
  return grades.overall;
}

/**
 * Extract all scenes in order from a virtual narrative state (for use as priorScenes).
 */
export function extractOrderedScenes(
  narrative: NarrativeState,
  resolvedKeys: string[],
): Scene[] {
  const scenes: Scene[] = [];
  for (const key of resolvedKeys) {
    const entry = resolveEntry(narrative, key);
    if (entry && isScene(entry)) {
      scenes.push(entry as Scene);
    }
  }
  return scenes;
}
