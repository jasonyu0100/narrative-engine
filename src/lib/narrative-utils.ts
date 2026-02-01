import type { Branch, NarrativeState, ThreadStatus } from '@/types/narrative';

/**
 * Resolve the full entry sequence for a branch by walking up to root.
 * Root branch returns its own entryIds.
 * Child branch returns parent's resolved sequence up to forkEntryId (inclusive) + own entryIds.
 */
export function resolveSceneSequence(
  branches: Record<string, Branch>,
  branchId: string,
): string[] {
  const branch = branches[branchId];
  if (!branch) return [];

  // Root branch — just its own entries
  if (!branch.parentBranchId) return branch.entryIds;

  // Recursively resolve parent
  const parentSequence = resolveSceneSequence(branches, branch.parentBranchId);

  // Find the fork point in the parent sequence
  if (branch.forkEntryId) {
    const forkIdx = parentSequence.indexOf(branch.forkEntryId);
    if (forkIdx >= 0) {
      return [...parentSequence.slice(0, forkIdx + 1), ...branch.entryIds];
    }
  }

  // Fallback: append after full parent sequence
  return [...parentSequence, ...branch.entryIds];
}

/**
 * Compute thread statuses at a given scene index by replaying threadMutations.
 * Returns a map of threadId → current status.
 */
export function computeThreadStatuses(
  narrative: NarrativeState,
  sceneIndex: number,
  resolvedSceneKeys?: string[],
): Record<string, ThreadStatus> {
  // Start with the base statuses from thread definitions
  const statuses: Record<string, ThreadStatus> = {};
  for (const [id, thread] of Object.entries(narrative.threads)) {
    statuses[id] = thread.status;
  }

  // Replay mutations up to and including the current scene (skip world builds)
  const sceneKeys = resolvedSceneKeys ?? Object.keys(narrative.scenes);
  for (let i = 0; i <= sceneIndex && i < sceneKeys.length; i++) {
    const scene = narrative.scenes[sceneKeys[i]];
    if (!scene) continue;
    for (const tm of scene.threadMutations) {
      statuses[tm.threadId] = tm.to;
    }
  }

  return statuses;
}
