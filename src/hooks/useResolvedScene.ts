import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { resolveProseForBranch, resolvePlanForBranch } from '@/lib/narrative-utils';
import type { Scene, BeatPlan, BeatProseMap, ProseScore } from '@/types/narrative';

export type ResolvedScene = Scene & {
  /** Resolved prose for the current branch (may differ from scene.prose) */
  resolvedProse?: string;
  /** Resolved beatProseMap for the current branch */
  resolvedBeatProseMap?: BeatProseMap;
  /** Resolved proseScore for the current branch */
  resolvedProseScore?: ProseScore;
  /** Resolved plan for the current branch (may differ from scene.plan) */
  resolvedPlan?: BeatPlan;
};

/**
 * Hook that returns a scene with resolved prose and plan for the current branch.
 * Uses version resolution to ensure branch isolation — each branch sees its own
 * versions of prose/plan without affecting other branches.
 *
 * @param scene - The scene to resolve
 * @returns Scene with resolved prose/plan fields added
 */
export function useResolvedScene(scene: Scene | null | undefined): ResolvedScene | null {
  const { state } = useStore();
  const branches = state.activeNarrative?.branches ?? {};
  const branchId = state.activeBranchId;

  return useMemo(() => {
    if (!scene || !branchId) return null;

    const resolvedProse = resolveProseForBranch(scene, branchId, branches);
    const resolvedPlan = resolvePlanForBranch(scene, branchId, branches);

    return {
      ...scene,
      resolvedProse: resolvedProse.prose,
      resolvedBeatProseMap: resolvedProse.beatProseMap,
      resolvedProseScore: resolvedProse.proseScore,
      resolvedPlan,
    };
  }, [scene, branchId, branches]);
}

/**
 * Hook that resolves prose for a scene without the full scene context.
 * Useful when you only need prose data.
 */
export function useResolvedProse(scene: Scene | null | undefined) {
  const { state } = useStore();
  const branches = state.activeNarrative?.branches ?? {};
  const branchId = state.activeBranchId;

  return useMemo(() => {
    if (!scene || !branchId) return { prose: undefined, beatProseMap: undefined, proseScore: undefined };
    return resolveProseForBranch(scene, branchId, branches);
  }, [scene, branchId, branches]);
}

/**
 * Hook that resolves plan for a scene without the full scene context.
 * Useful when you only need plan data.
 */
export function useResolvedPlan(scene: Scene | null | undefined): BeatPlan | undefined {
  const { state } = useStore();
  const branches = state.activeNarrative?.branches ?? {};
  const branchId = state.activeBranchId;

  return useMemo(() => {
    if (!scene || !branchId) return undefined;
    return resolvePlanForBranch(scene, branchId, branches);
  }, [scene, branchId, branches]);
}
