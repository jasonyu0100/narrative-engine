import type { NarrativeState, Scene } from '@/types/narrative';
import { resolveEntry, isScene } from '@/types/narrative';
import type { MCTSNode } from '@/types/mcts';
import { computeRawForcetotals, computeSwingMagnitudes, gradeForces, FORCE_REFERENCE_MEANS } from '@/lib/narrative-utils';

/**
 * Apply scene mutations (relationship + knowledge + thread) to a narrative state.
 * Duplicated from store.tsx to avoid importing React-heavy store module.
 */
function applySceneMutations(n: NarrativeState, scenes: Scene[]): NarrativeState {
  let relationships = [...n.relationships];
  const characters = { ...n.characters };
  const threads = { ...n.threads };
  const worldKnowledge = { nodes: { ...n.worldKnowledge?.nodes }, edges: [...(n.worldKnowledge?.edges ?? [])] };

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
      const char = characters[km.characterId];
      if (!char) continue;
      if (km.action === 'added') {
        if (!char.continuity.nodes.some((kn) => kn.id === km.nodeId)) {
          characters[km.characterId] = { ...char, continuity: { ...char.continuity, nodes: [...char.continuity.nodes, { id: km.nodeId, type: km.nodeType ?? 'learned', content: km.content }] } };
        }
      } else if (km.action === 'removed') {
        characters[km.characterId] = { ...char, continuity: { ...char.continuity, nodes: char.continuity.nodes.filter((kn) => kn.id !== km.nodeId) } };
      }
    }
    for (const tm of scene.threadMutations) {
      const thread = threads[tm.threadId];
      if (thread) threads[tm.threadId] = { ...thread, status: tm.to };
    }
    const wkm = scene.worldKnowledgeMutations;
    if (wkm) {
      for (const node of wkm.addedNodes ?? []) {
        if (!worldKnowledge.nodes[node.id]) {
          worldKnowledge.nodes[node.id] = { id: node.id, concept: node.concept, type: node.type };
        }
      }
      for (const edge of wkm.addedEdges ?? []) {
        if (!worldKnowledge.edges.some((e: { from: string; to: string; relation: string }) => e.from === edge.from && e.to === edge.to && e.relation === edge.relation)) {
          worldKnowledge.edges.push({ from: edge.from, to: edge.to, relation: edge.relation });
        }
      }
    }
  }

  return { ...n, relationships, characters, threads, worldKnowledge };
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
  ancestorNodes: MCTSNode[],
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
 * Returns the per-arc overall score (0-100, from 4 force metrics scaled up).
 *
 * @param arcScenes - The scenes in this arc
 * @param priorScenes - All scenes before this arc (for knowledge/recency context)
 */
export function scoreArc(arcScenes: Scene[], priorScenes: Scene[]): number {
  if (arcScenes.length === 0) return 0;

  const raw = computeRawForcetotals(arcScenes);
  const forces = raw.payoff.map((_, i) => ({
    payoff: raw.payoff[i],
    change: raw.change[i],
    knowledge: raw.knowledge[i],
  }));
  const swings = computeSwingMagnitudes(forces, FORCE_REFERENCE_MEANS);

  // Grade 4 forces → 0-100
  const grades = gradeForces(raw.payoff, raw.change, raw.knowledge, swings);
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
