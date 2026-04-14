"use client";

import type { BranchPlan } from "@/types/narrative";

type Props = {
  branchPlan: BranchPlan;
  onClick: () => void;
};

/**
 * Minimal pill indicator showing coordination plan progress.
 * Appears at the bottom of the canvas when a plan is active.
 * Matches the ModeControlBar design language.
 */
export function CoordinationPlanIndicator({ branchPlan, onClick }: Props) {
  const { plan } = branchPlan;
  // Arc indices are 1-based, but currentArc starts at 0 when plan is created
  const displayArc = plan.currentArc === 0 ? 1 : plan.currentArc;
  const totalArcs = plan.arcCount;
  const isComplete = plan.currentArc >= totalArcs && plan.completedArcs.length >= totalArcs;

  // Find arc-anchor nodes — one peak or valley per arc carries arcIndex
  const arcAnchorNodes = plan.nodes.filter(
    n => (n.type === "peak" || n.type === "valley") && n.arcIndex !== undefined,
  );
  const currentArcNode = arcAnchorNodes.find(n => n.arcIndex === displayArc);
  const arcLabel = currentArcNode?.label ?? `Arc ${displayArc}`;
  const totalScenes = arcAnchorNodes.reduce((sum, n) => sum + (n.sceneCount ?? 4), 0);

  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-base/80 backdrop-blur-md border border-white/8 shadow-lg shadow-black/20 hover:border-white/16 transition-all cursor-pointer"
    >
      {/* Status dot */}
      <div className="flex items-center gap-1.5">
        {isComplete ? (
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
        ) : (
          <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
        )}
        <span className="text-[9px] font-medium uppercase tracking-wider text-sky-400">
          Plan
        </span>
      </div>

      <div className="w-px h-3 bg-white/10" />

      {/* Progress */}
      <span className="text-[10px] text-text-secondary font-mono tabular-nums">
        {displayArc}/{totalArcs}
      </span>

      <div className="w-px h-3 bg-white/10" />

      {/* Arc label or completion status */}
      <span className="text-[9px] text-text-dim truncate max-w-32">
        {isComplete ? "Complete" : arcLabel}
      </span>

      {/* Scene count */}
      <span className="text-[9px] text-text-dim/50">
        ~{totalScenes}
      </span>

      {/* Expand chevron */}
      <svg
        className="w-3 h-3 text-text-dim/40 group-hover:text-text-dim transition-colors"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}
