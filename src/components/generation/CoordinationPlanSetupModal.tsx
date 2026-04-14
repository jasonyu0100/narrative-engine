"use client";

import { Modal, ModalBody, ModalHeader } from "@/components/Modal";
import { generateCoordinationPlan, type ForcePreference, type PlanGuidance, type ThreadTarget } from "@/lib/ai";
import { useStore } from "@/lib/store";
import { logError } from "@/lib/system-logger";
import type { CoordinationPlan, Thread } from "@/types/narrative";
import { THREAD_ACTIVE_STATUSES } from "@/types/narrative";
import { useCallback, useMemo, useState } from "react";
import { GuidanceFields } from "./GuidanceFields";
import { CoordinationPlanModal } from "./CoordinationPlanModal";
import {
  ForcePreferencePicker,
  ReasoningSizePicker,
  type ReasoningSize,
} from "./ForcePreferencePicker";

// ── Streaming Output ─────────────────────────────────────────────────────────

function StreamingOutput({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <h2 className="text-sm font-semibold text-text-primary">
          {label}&hellip;
        </h2>
      </div>
      {text ? (
        <pre className="text-[11px] text-text-dim font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-white/3 rounded-lg p-3 leading-relaxed">
          {text}
        </pre>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="h-3 w-3/4 bg-white/6 rounded animate-pulse" />
          <div className="h-3 w-1/2 bg-white/6 rounded animate-pulse" />
          <div className="h-3 w-5/6 bg-white/6 rounded animate-pulse" />
        </div>
      )}
    </div>
  );
}

// ── Thread Target Types ─────────────────────────────────────────────────────

type TargetStatus = ThreadTarget["targetStatus"] | "auto";
type TargetTiming = ThreadTarget["timing"] | "any";

type ThreadConfig = {
  status: TargetStatus;
  timing: TargetTiming;
};

const STATUS_OPTIONS: { value: TargetStatus; label: string; color: string }[] = [
  { value: "auto", label: "Auto", color: "text-text-dim" },
  { value: "resolved", label: "Resolve", color: "text-green-400" },
  { value: "subverted", label: "Subvert", color: "text-purple-400" },
  { value: "critical", label: "Critical", color: "text-orange-400" },
  { value: "escalating", label: "Escalate", color: "text-amber-400" },
  { value: "active", label: "Active", color: "text-sky-400" },
  { value: "unanswered", label: "Open", color: "text-zinc-400" },
];

const TIMING_OPTIONS: { value: TargetTiming; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "early", label: "Early" },
  { value: "mid", label: "Mid" },
  { value: "late", label: "Late" },
  { value: "final", label: "Final" },
];

// ── Thread Target Selector ──────────────────────────────────────────────────

function ThreadTargetSelector({
  threads,
  configs,
  onConfigChange,
}: {
  threads: Thread[];
  configs: Record<string, ThreadConfig>;
  onConfigChange: (threadId: string, config: ThreadConfig) => void;
}) {
  if (threads.length === 0) {
    return (
      <p className="text-xs text-text-dim italic">No active threads to configure.</p>
    );
  }

  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto">
      {threads.map((thread) => {
        const config = configs[thread.id] ?? { status: "auto", timing: "any" };
        const statusOption = STATUS_OPTIONS.find(o => o.value === config.status);

        return (
          <div
            key={thread.id}
            className="flex items-center gap-2 p-2 rounded-lg bg-white/3 hover:bg-white/5 transition"
          >
            {/* Thread info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-text-primary truncate">{thread.description}</p>
              <p className="text-[10px] text-text-dim">{thread.status}</p>
            </div>

            {/* Target status */}
            <select
              value={config.status}
              onChange={(e) => onConfigChange(thread.id, { ...config, status: e.target.value as TargetStatus })}
              className={`text-[10px] px-2 py-1 rounded bg-white/5 border border-border focus:outline-none ${statusOption?.color ?? "text-text-primary"}`}
            >
              {STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {/* Timing (only show if not auto) */}
            {config.status !== "auto" && (
              <select
                value={config.timing}
                onChange={(e) => onConfigChange(thread.id, { ...config, timing: e.target.value as TargetTiming })}
                className="text-[10px] px-2 py-1 rounded bg-white/5 border border-border text-text-secondary focus:outline-none"
              >
                {TIMING_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

type Props = {
  onClose: () => void;
  onPlanCreated?: (plan: CoordinationPlan) => void;
};

type Tab = "general" | "threads" | "advanced";

export function CoordinationPlanSetupModal({ onClose, onPlanCreated }: Props) {
  const { state, dispatch } = useStore();

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>("general");

  // Setup form state
  const [direction, setDirection] = useState("");
  const [constraints, setConstraints] = useState("");
  const [arcTarget, setArcTarget] = useState(3);
  const [threadConfigs, setThreadConfigs] = useState<Record<string, ThreadConfig>>({});
  const [forcePreference, setForcePreference] = useState<ForcePreference>("balanced");
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningSize>("medium");

  // Generation state
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState("");

  // Plan state
  const [plan, setPlan] = useState<CoordinationPlan | null>(null);
  const [showPlanModal, setShowPlanModal] = useState(false);

  const narrative = state.activeNarrative;
  if (!narrative) return null;

  const headIndex = state.resolvedEntryKeys.length - 1;

  // Get active threads for configuration
  const activeStatuses = new Set(THREAD_ACTIVE_STATUSES);
  const activeThreads = useMemo(
    () =>
      Object.values(narrative.threads).filter(
        (t) => activeStatuses.has(t.status as typeof THREAD_ACTIVE_STATUSES[number])
      ),
    [narrative.threads]
  );

  const handleConfigChange = useCallback((threadId: string, config: ThreadConfig) => {
    setThreadConfigs((prev) => ({ ...prev, [threadId]: config }));
  }, []);

  // Build guidance from form state
  const buildGuidance = useCallback((): PlanGuidance => {
    // Convert thread configs to ThreadTarget array
    const threadTargets: ThreadTarget[] = Object.entries(threadConfigs)
      .filter(([, config]) => config.status !== "auto")
      .map(([threadId, config]) => ({
        threadId,
        targetStatus: config.status as ThreadTarget["targetStatus"],
        timing: config.timing !== "any" ? config.timing as ThreadTarget["timing"] : undefined,
      }));

    return {
      threadTargets: threadTargets.length > 0 ? threadTargets : undefined,
      arcTarget,
      direction: direction.trim() || undefined,
      constraints: constraints.trim() || undefined,
      forcePreference,
      reasoningLevel,
    };
  }, [threadConfigs, arcTarget, direction, constraints, forcePreference, reasoningLevel]);

  async function handleGeneratePlan(additionalPrompt?: string) {
    if (!narrative) return;
    setLoading(true);
    setStreamText("");
    setError("");

    try {
      const guidance = buildGuidance();
      if (additionalPrompt) {
        guidance.direction = guidance.direction
          ? `${guidance.direction}\n\nAdditional guidance: ${additionalPrompt}`
          : additionalPrompt;
      }

      const generatedPlan = await generateCoordinationPlan(
        narrative,
        state.resolvedEntryKeys,
        headIndex,
        guidance,
        (token) => setStreamText((prev) => prev + token),
      );

      // Save plan immediately so it persists even if modal is closed
      dispatch({
        type: "SET_COORDINATION_PLAN",
        branchId: state.viewState.activeBranchId!,
        plan: {
          plan: generatedPlan,
          autoExecute: true,
        },
      });

      setPlan(generatedPlan);
      setShowPlanModal(true);
    } catch (err) {
      logError("Coordination plan generation failed", err, {
        source: "plan-generation",
        operation: "generate-plan",
        details: { arcTarget },
      });
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmPlan() {
    if (!plan || !narrative) return;

    // Plan is already saved to store when generated
    // Close the modal and notify parent
    setShowPlanModal(false);
    onPlanCreated?.(plan);
    onClose();
  }

  function handleClearPlan() {
    setPlan(null);
    setShowPlanModal(false);
    // Clear from branch if already saved
    if (state.viewState.activeBranchId) {
      dispatch({
        type: "CLEAR_COORDINATION_PLAN",
        branchId: state.viewState.activeBranchId,
      });
    }
  }

  function handleRestartPlan() {
    if (!state.viewState.activeBranchId) return;
    dispatch({
      type: "RESET_COORDINATION_PLAN",
      branchId: state.viewState.activeBranchId,
    });
    // Mirror the rewound pointer in the local plan so the fullscreen
    // modal re-renders with progress cleared.
    setPlan((prev) =>
      prev ? { ...prev, currentArc: 0, completedArcs: [] } : prev,
    );
  }

  return (
    <>
      <Modal onClose={loading ? () => {} : onClose} size="lg" maxHeight="85vh">
        <ModalHeader onClose={onClose} hideClose={loading}>
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Create Coordination Plan</h2>
            <p className="text-[10px] text-text-dim mt-0.5">
              Plan the trajectory of multiple arcs using backward induction
            </p>
          </div>
        </ModalHeader>
        <ModalBody className="p-6 space-y-5">
          {loading ? (
            <StreamingOutput label="Planning narrative trajectory" text={streamText} />
          ) : (
            <>
              {/* Tab buttons */}
              <div className="flex gap-1 p-1 rounded-lg bg-white/5">
                {[
                  { label: "General", value: "general" as Tab },
                  { label: "Threads", value: "threads" as Tab, count: Object.values(threadConfigs).filter(c => c.status !== "auto").length },
                  { label: "Advanced", value: "advanced" as Tab },
                ].map((tab) => (
                  <button
                    key={tab.value}
                    onClick={() => setActiveTab(tab.value)}
                    className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                      activeTab === tab.value
                        ? "bg-bg-overlay text-text-primary"
                        : "text-text-dim hover:text-text-secondary"
                    }`}
                  >
                    {tab.label}
                    {tab.count !== undefined && tab.count > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-white/10 text-[10px] tabular-nums">
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* General tab */}
              {activeTab === "general" && (
                <div className="space-y-5">
                  {/* Direction & Constraints */}
                  <GuidanceFields
                    direction={direction}
                    constraints={constraints}
                    onDirectionChange={setDirection}
                    onConstraintsChange={setConstraints}
                  />

                  {/* Arc Target */}
                  <div className="flex items-center gap-3">
                    <label className="text-[10px] uppercase tracking-widest text-text-dim shrink-0">
                      Arc Target
                    </label>
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="range"
                        min={1}
                        max={25}
                        value={arcTarget}
                        onChange={(e) => setArcTarget(Number(e.target.value))}
                        className="flex-1 h-1 appearance-none bg-white/10 rounded-full accent-white/60 cursor-pointer [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white/80 [&::-webkit-slider-thumb]:appearance-none"
                      />
                      <span className="text-xs font-medium text-text-primary w-6 text-center tabular-nums">
                        {arcTarget}
                      </span>
                    </div>
                    <span className="text-[9px] text-text-dim/60">arcs</span>
                  </div>
                </div>
              )}

              {/* Advanced tab */}
              {activeTab === "advanced" && (
                <div className="space-y-4">
                  <ForcePreferencePicker
                    value={forcePreference}
                    onChange={setForcePreference}
                  />
                  <ReasoningSizePicker
                    value={reasoningLevel}
                    onChange={setReasoningLevel}
                  />
                </div>
              )}

              {/* Threads tab */}
              {activeTab === "threads" && (
                <div className="space-y-4">
                  <p className="text-[10px] text-text-dim/70">
                    Set target status and timing for each thread. Auto lets the AI decide.
                  </p>
                  <ThreadTargetSelector
                    threads={activeThreads}
                    configs={threadConfigs}
                    onConfigChange={handleConfigChange}
                  />

                  {/* Summary badges */}
                  {(() => {
                    const configured = Object.entries(threadConfigs).filter(([, c]) => c.status !== "auto");
                    if (configured.length === 0) return null;

                    const byStatus = configured.reduce((acc, [, c]) => {
                      acc[c.status] = (acc[c.status] ?? 0) + 1;
                      return acc;
                    }, {} as Record<string, number>);

                    return (
                      <div className="flex flex-wrap gap-2 text-[10px] pt-2 border-t border-white/5">
                        {byStatus.resolved && (
                          <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-400">
                            {byStatus.resolved} resolve
                          </span>
                        )}
                        {byStatus.subverted && (
                          <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-400">
                            {byStatus.subverted} subvert
                          </span>
                        )}
                        {byStatus.critical && (
                          <span className="px-2 py-0.5 rounded bg-orange-500/10 text-orange-400">
                            {byStatus.critical} critical
                          </span>
                        )}
                        {byStatus.escalating && (
                          <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400">
                            {byStatus.escalating} escalate
                          </span>
                        )}
                        {byStatus.active && (
                          <span className="px-2 py-0.5 rounded bg-sky-500/10 text-sky-400">
                            {byStatus.active} active
                          </span>
                        )}
                        {byStatus.unanswered && (
                          <span className="px-2 py-0.5 rounded bg-zinc-500/10 text-zinc-400">
                            {byStatus.unanswered} open
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => handleGeneratePlan()}
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary font-semibold transition disabled:opacity-30"
                >
                  Generate Plan
                </button>
              </div>

              {error && (
                <div className="bg-fate/10 border border-fate/30 rounded-lg px-3 py-2">
                  <p className="text-sm text-fate font-medium">Failed</p>
                  <p className="text-xs text-fate/80 mt-1">{error}</p>
                </div>
              )}
            </>
          )}
        </ModalBody>
      </Modal>

      {/* Fullscreen Plan Modal */}
      {showPlanModal && plan && (
        <CoordinationPlanModal
          plan={plan}
          isLoading={loading}
          onRegenerate={handleGeneratePlan}
          onConfirm={handleConfirmPlan}
          onRestart={handleRestartPlan}
          onClose={() => {
            setShowPlanModal(false);
            setPlan(null);
          }}
          onClear={handleClearPlan}
        />
      )}
    </>
  );
}
