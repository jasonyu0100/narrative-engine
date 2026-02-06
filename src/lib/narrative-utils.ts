import type { Branch, NarrativeState, Scene, ThreadStatus, ForceSnapshot, CubeCornerKey, CubeCorner } from '@/types/narrative';
import { NARRATIVE_CUBE } from '@/types/narrative';

// ── Sequential ID generation ─────────────────────────────────────────────────

/**
 * Extract the numeric suffix from an entity ID (e.g., "C-01" → 1, "L-12" → 12, "S-003" → 3).
 * Handles various formats: "C-01", "C-1742000000-3", "S-GEN-1742000000-5", etc.
 * Returns the highest trailing number found, or 0 if none.
 */
function extractIdNumber(id: string): number {
  const match = id.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Compute the next sequential ID for a given prefix by scanning existing IDs in the narrative.
 * Returns zero-padded IDs like "C-09", "L-12", "T-08", "S-016", "ARC-04".
 *
 * @param prefix - Entity prefix (e.g., "C", "L", "T", "S", "ARC", "WX", "K")
 * @param existingIds - Array of existing IDs to scan for the highest number
 * @param padWidth - Zero-padding width (default: 2 for most, 3 for scenes)
 */
export function nextId(prefix: string, existingIds: string[], padWidth = 2): string {
  let max = 0;
  for (const id of existingIds) {
    const n = extractIdNumber(id);
    if (n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(padWidth, '0')}`;
}

/**
 * Generate a batch of sequential IDs starting from the next available number.
 */
export function nextIds(prefix: string, existingIds: string[], count: number, padWidth = 2): string[] {
  let max = 0;
  for (const id of existingIds) {
    const n = extractIdNumber(id);
    if (n > max) max = n;
  }
  return Array.from({ length: count }, (_, i) => `${prefix}-${String(max + 1 + i).padStart(padWidth, '0')}`);
}

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

// ── Narrative Cube detection ───────────────────────────────────────────────

/** Euclidean distance between two force snapshots */
function forceDistance(a: ForceSnapshot, b: ForceSnapshot): number {
  return Math.sqrt(
    (a.stakes - b.stakes) ** 2 +
    (a.pacing - b.pacing) ** 2 +
    (a.variety - b.variety) ** 2,
  );
}

/** Detect the nearest cube corner for a given force snapshot */
export function detectCubeCorner(forces: ForceSnapshot): CubeCorner {
  let best: CubeCorner = NARRATIVE_CUBE.LLL;
  let bestDist = Infinity;
  for (const corner of Object.values(NARRATIVE_CUBE)) {
    const d = forceDistance(forces, corner.forces);
    if (d < bestDist) {
      bestDist = d;
      best = corner;
    }
  }
  return best;
}

/** Returns the proximity (0-1) of forces to a specific cube corner. 1 = at the corner, 0 = maximally far. */
export function cubeCornerProximity(forces: ForceSnapshot, cornerKey: CubeCornerKey): number {
  const maxDist = 2 * Math.sqrt(3); // diagonal of cube from -1,-1,-1 to 1,1,1
  const d = forceDistance(forces, NARRATIVE_CUBE[cornerKey].forces);
  return 1 - d / maxDist;
}

// ── Force Computation ────────────────────────────────────────────────────────

/**
 * Min-max normalize an array of numbers to [-1, +1].
 * If all values are equal, returns all zeros.
 */
function minMaxNormalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0);
  return values.map((v) => +((((v - min) / (max - min)) * 2) - 1).toFixed(2));
}

/**
 * Compute raw pacing for a scene: total number of mutations (more = faster pace).
 */
function rawPacing(scene: Scene): number {
  return scene.threadMutations.length
    + scene.knowledgeMutations.length
    + scene.relationshipMutations.length;
}

/**
 * Compute raw variety for a scene given cumulative usage counts.
 * Lower total usage of participants + location = higher variety (newer elements).
 * Returns a value where higher = more variety (inverted from usage).
 */
function rawVariety(scene: Scene, charUsage: Record<string, number>, locUsage: Record<string, number>): number {
  const participantUsage = scene.participantIds.reduce((sum, id) => sum + (charUsage[id] ?? 0), 0);
  const avgParticipantUsage = scene.participantIds.length > 0 ? participantUsage / scene.participantIds.length : 0;
  const locationUsage = locUsage[scene.locationId] ?? 0;
  // Invert: less usage = more variety
  return -1 * (avgParticipantUsage + locationUsage);
}

/**
 * Compute ForceSnapshots for a batch of scenes using min-max normalization.
 *
 * - **Stakes**: AI-provided per scene (0-100 raw), normalized to [-1, +1]
 * - **Pacing**: total mutation count per scene, normalized to [-1, +1]
 * - **Variety**: inversely proportional to character/location usage frequency, normalized to [-1, +1]
 *
 * @param scenes - Ordered list of scenes to compute forces for
 * @param priorScenes - Scenes before this batch (for usage tracking). Empty for initial generation.
 */
export function computeForceSnapshots(
  scenes: Scene[],
  priorScenes: Scene[] = [],
): Record<string, ForceSnapshot> {
  const result: Record<string, ForceSnapshot> = {};
  if (scenes.length === 0) return result;

  // Build cumulative usage counts from prior scenes
  const charUsage: Record<string, number> = {};
  const locUsage: Record<string, number> = {};
  for (const s of priorScenes) {
    for (const pid of s.participantIds) charUsage[pid] = (charUsage[pid] ?? 0) + 1;
    locUsage[s.locationId] = (locUsage[s.locationId] ?? 0) + 1;
  }

  // Compute raw values, updating usage counts as we go
  const rawStakes: number[] = [];
  const rawPacings: number[] = [];
  const rawVarieties: number[] = [];

  for (const scene of scenes) {
    rawStakes.push(scene.stakes ?? 50);
    rawPacings.push(rawPacing(scene));
    rawVarieties.push(rawVariety(scene, charUsage, locUsage));
    // Update usage for subsequent scenes
    for (const pid of scene.participantIds) charUsage[pid] = (charUsage[pid] ?? 0) + 1;
    locUsage[scene.locationId] = (locUsage[scene.locationId] ?? 0) + 1;
  }

  // Min-max normalize each dimension to [-1, +1]
  const normStakes = minMaxNormalize(rawStakes);
  const normPacings = minMaxNormalize(rawPacings);
  const normVarieties = minMaxNormalize(rawVarieties);

  for (let i = 0; i < scenes.length; i++) {
    result[scenes[i].id] = {
      stakes: normStakes[i],
      pacing: normPacings[i],
      variety: normVarieties[i],
    };
  }
  return result;
}
