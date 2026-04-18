"use client";

import { Modal, ModalBody, ModalHeader } from "@/components/Modal";
import { IconChevronRight, IconDice } from "@/components/icons";
import {
  DEFAULT_EXPANSION_FILTER,
  expandWorld,
  generateExpansionReasoningGraph,
  generateReasoningGraph,
  generateScenes,
  suggestWorldExpansion,
  type CoordinationPlanContext,
  type ExpansionEntityFilter,
  type ExpansionReasoningGraph,
  type ReasoningGraph,
  type WorldExpansionSize,
  type WorldExpansionStrategy,
} from "@/lib/ai";
import {
  buildPlanDirective,
  getArcNode,
  getArcSceneCount,
  isPlanComplete,
} from "@/lib/auto-engine";
import { ReasoningGraphModal } from "./ReasoningGraphModal";
import { nextId } from "@/lib/narrative-utils";
import {
  buildPresetSequence,
  buildSequenceFromModes,
  DEFAULT_TRANSITION_MATRIX,
  detectCurrentMode,
  MATRIX_PRESETS,
  PACING_PRESETS,
  samplePacingSequence,
  type PacingSequence,
} from "@/lib/pacing-profile";
import { useStore } from "@/lib/store";
import { logError } from "@/lib/system-logger";
import type { CubeCornerKey, NarrativeState } from "@/types/narrative";
import {
  DEFAULT_STORY_SETTINGS,
  NARRATIVE_CUBE,
  resolveEntry,
} from "@/types/narrative";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ForcePreference, ReasoningMode } from "@/lib/ai";
import {
  ThinkingSettings,
  type ReasoningSize,
} from "./ForcePreferencePicker";
import { GuidanceFields } from "./GuidanceFields";
import { MarkovGraph } from "./MarkovGraph";
import { CubeBadge, PacingStrip } from "./PacingStrip";

type Mode = "continuation" | "world";

// ── Corner colors ────────────────────────────────────────────────────────────

const CORNER_COLORS: Record<CubeCornerKey, string> = {
  HHH: "#f59e0b",
  HHL: "#ef4444",
  HLH: "#a855f7",
  HLL: "#6366f1",
  LHH: "#22d3ee",
  LHL: "#22c55e",
  LLH: "#3b82f6",
  LLL: "#6b7280",
};

const ALL_CORNERS: CubeCornerKey[] = [
  "HHH",
  "HHL",
  "HLH",
  "HLL",
  "LHH",
  "LHL",
  "LLH",
  "LLL",
];

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

// ── Main Panel ───────────────────────────────────────────────────────────────

export function GeneratePanel({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [mode, setMode] = useState<Mode>("continuation");

  // Continuation state
  const [newArc, setNewArc] = useState(true);
  const [arcName, setArcName] = useState("");
  const [direction, setDirection] = useState("");
  const [directionCount, setDirectionCount] = useState(4); // Number of scenes to generate
  const [worldBuildFocusId, setWorldBuildFocusId] = useState<string | null>(
    null,
  );
  const [guidanceDirection, setGuidanceDirection] = useState("");
  const [guidanceConstraints, setGuidanceConstraints] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Pacing preview
  const [previewSequence, setPreviewSequence] = useState<PacingSequence | null>(
    null,
  );
  const [animating, setAnimating] = useState(false);
  const [editingStep, setEditingStep] = useState<number | null>(null);

  // World state
  const [worldDirective, setWorldDirective] = useState("");
  const [worldSize, setWorldSize] = useState<WorldExpansionSize>("exact");
  const [worldStrategy, setWorldStrategy] = useState<WorldExpansionStrategy>(
    state.activeNarrative?.storySettings?.expansionStrategy ?? "dynamic",
  );
  const [entityFilter, setEntityFilter] = useState<ExpansionEntityFilter>({
    ...DEFAULT_EXPANSION_FILTER,
  });

  // Reasoning graph state (for scene generation)
  const [reasoningGraph, setReasoningGraph] = useState<ReasoningGraph | null>(null);
  const [showReasoningModal, setShowReasoningModal] = useState(false);
  const [generatingGraph, setGeneratingGraph] = useState(false);
  // Arc reasoning options — initialized from story-level defaults so the
  // user doesn't have to re-pick their preferred thinking style each time.
  const thinkingDefaults = state.activeNarrative?.storySettings;
  const [forcePreference, setForcePreference] = useState<ForcePreference>(
    thinkingDefaults?.defaultForcePreference ?? "freeform",
  );
  const [reasoningSize, setReasoningSize] = useState<ReasoningSize>(
    thinkingDefaults?.defaultReasoningSize ?? "medium",
  );
  const [reasoningMode, setReasoningMode] = useState<ReasoningMode>(
    thinkingDefaults?.defaultReasoningMode ?? "divergent",
  );

  // Expansion reasoning graph state (for world expansion)
  const [expansionReasoningGraph, setExpansionReasoningGraph] = useState<ExpansionReasoningGraph | null>(null);
  const [showExpansionReasoningModal, setShowExpansionReasoningModal] = useState(false);

  // Shared
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState("");

  const narrative = state.activeNarrative;
  if (!narrative) return null;

  const headIndex = state.resolvedEntryKeys.length - 1;
  const headKey = state.resolvedEntryKeys[headIndex];
  const headEntry = headKey ? resolveEntry(narrative, headKey) : null;
  const currentArc =
    headEntry?.kind === "scene" && narrative.arcs[headEntry.arcId]
      ? narrative.arcs[headEntry.arcId]
      : null;

  // ── Coordination Plan Detection ─────────────────────────────────────────────
  const activeBranchId = state.viewState.activeBranchId;
  const branchPlan = activeBranchId
    ? narrative.branches[activeBranchId]?.coordinationPlan
    : null;
  const hasActivePlan = branchPlan && !isPlanComplete(branchPlan);
  const coordPlan = hasActivePlan ? branchPlan.plan : null;

  // Pre-compute plan values for current arc (arc indices are 1-based, currentArc=0 means "about to start arc 1")
  const planArcIndex = coordPlan ? (coordPlan.currentArc === 0 ? 1 : coordPlan.currentArc) : 0;
  const planArcNode = coordPlan ? getArcNode(coordPlan, planArcIndex) : null;
  const planArcName = planArcNode?.label ?? "";
  const planSceneCount = coordPlan ? getArcSceneCount(coordPlan, planArcIndex, 4) : 4;
  const planDirective = coordPlan ? buildPlanDirective(narrative, coordPlan, planArcIndex) : "";

  // Build coordination plan context for direct injection into generation
  const coordinationPlanContext: CoordinationPlanContext | undefined = useMemo(() => {
    if (!hasActivePlan || !coordPlan) return undefined;
    return {
      arcIndex: planArcIndex,
      arcCount: coordPlan.arcCount,
      arcLabel: planArcName || `Arc ${planArcIndex}`,
      sceneCount: planSceneCount,
      forceMode: planArcNode?.forceMode,
      directive: planDirective,
    };
  }, [hasActivePlan, coordPlan, planArcIndex, planArcName, planSceneCount, planArcNode?.forceMode, planDirective]);

  // Pre-fill form from coordination plan on mount (arc name and scene count only — direction flows in directly)
  const initializedFromPlan = useRef(false);
  useEffect(() => {
    if (hasActivePlan && !initializedFromPlan.current) {
      initializedFromPlan.current = true;
      // Pre-fill arc name from plan
      if (planArcName) {
        setArcName(planArcName);
      }
      // Pre-fill scene count from plan
      if (planSceneCount > 0) {
        setDirectionCount(planSceneCount);
      }
      // Direction is NOT pre-filled — it flows directly via coordinationPlanContext
    }
  }, [hasActivePlan, planArcName, planSceneCount]);

  const currentMode = useMemo(
    () => detectCurrentMode(narrative, state.resolvedEntryKeys),
    [narrative, state.resolvedEntryKeys],
  );

  const storyMatrix = useMemo(() => {
    const presetKey =
      narrative.storySettings?.rhythmPreset ??
      DEFAULT_STORY_SETTINGS.rhythmPreset;
    return (
      MATRIX_PRESETS.find((p) => p.key === presetKey)?.matrix ??
      DEFAULT_TRANSITION_MATRIX
    );
  }, [narrative.storySettings?.rhythmPreset]);

  const handleSample = useCallback(() => {
    const seq = samplePacingSequence(currentMode, directionCount, storyMatrix);
    setPreviewSequence(seq);
    setAnimating(true);
  }, [currentMode, directionCount, storyMatrix]);

  const handleSetStep = useCallback(
    (index: number, mode: CubeCornerKey) => {
      if (!previewSequence) return;
      const modes = previewSequence.steps.map((s) => s.mode);
      modes[index] = mode;
      setPreviewSequence(buildSequenceFromModes(modes));
      setEditingStep(null);
    },
    [previewSequence],
  );

  const handleAddStep = useCallback(() => {
    if (!previewSequence) return;
    const modes = previewSequence.steps.map((s) => s.mode);
    modes.push("LLL");
    setPreviewSequence(buildSequenceFromModes(modes));
    setDirectionCount(modes.length);
  }, [previewSequence]);

  const handleRemoveStep = useCallback(
    (index: number) => {
      if (!previewSequence || previewSequence.steps.length <= 1) return;
      const modes = previewSequence.steps
        .map((s) => s.mode)
        .filter((_, i) => i !== index);
      setPreviewSequence(buildSequenceFromModes(modes));
      setDirectionCount(modes.length);
      setEditingStep(null);
    },
    [previewSequence],
  );

  async function handleGenerateReasoningGraph(additionalPrompt?: string) {
    if (!narrative) return;
    setGeneratingGraph(true);
    setStreamText("");
    setError("");
    try {
      const finalArcName = newArc ? (arcName.trim() || "New Arc") : (currentArc?.name ?? "Continuation");
      const baseDirection = direction || guidanceDirection;
      const fullDirection = additionalPrompt
        ? `${baseDirection}\n\nAdditional guidance: ${additionalPrompt}`
        : baseDirection;

      // Build coordination plan context for reasoning graph generation
      const reasoningPlanContext: CoordinationPlanContext | undefined =
        hasActivePlan && coordPlan ? {
          arcIndex: planArcIndex,
          arcCount: coordPlan.arcCount,
          arcLabel: planArcName || `Arc ${planArcIndex}`,
          sceneCount: planSceneCount,
          forceMode: planArcNode?.forceMode,
          directive: planDirective,
        } : undefined;

      const graph = await generateReasoningGraph(
        narrative,
        state.resolvedEntryKeys,
        headIndex,
        directionCount,
        fullDirection,
        finalArcName,
        (token) => setStreamText((prev) => prev + token),
        reasoningPlanContext,
        { forcePreference, reasoningLevel: reasoningSize, reasoningMode },
      );
      setReasoningGraph(graph);
      setShowReasoningModal(true);
    } catch (err) {
      logError("Reasoning graph generation failed", err, {
        source: "manual-generation",
        operation: "generate-reasoning-graph",
        details: { sceneCount: directionCount },
      });
      setError(String(err));
    } finally {
      setGeneratingGraph(false);
    }
  }

  async function handleConfirmReasoningGraph() {
    if (!narrative || !reasoningGraph) return;
    setShowReasoningModal(false);
    setLoading(true);
    setStreamText("");
    setError("");
    try {
      // Guidance direction/constraints are PER-GENERATION overrides — they
      // must NOT be persisted to story settings. Construct a transient
      // narrative clone whose storySettings carry the guidance for this one
      // call; buildStorySettingsBlock downstream picks them up from the
      // clone while the real narrative stays clean.
      const currentSettings = {
        ...DEFAULT_STORY_SETTINGS,
        ...narrative.storySettings,
      };
      const narrativeForRun: NarrativeState = {
        ...narrative,
        storySettings: {
          ...currentSettings,
          storyDirection: guidanceDirection,
          storyConstraints: guidanceConstraints,
        },
      };

      const existingArc = !newArc ? (currentArc ?? undefined) : undefined;
      const worldBuildFocus = worldBuildFocusId
        ? narrative.worldBuilds[worldBuildFocusId]
        : undefined;

      const { scenes, arc } = await generateScenes(
        narrativeForRun,
        state.resolvedEntryKeys,
        headIndex,
        reasoningGraph.sceneCount,
        "", // Direction is embedded in reasoning graph
        {
          existingArc,
          pacingSequence: previewSequence ?? undefined,
          worldBuildFocus,
          reasoningGraph,
          onReasoning: (token) => setStreamText((prev) => prev + token),
        },
      );
      dispatch({
        type: "BULK_ADD_SCENES",
        scenes,
        arc,
        branchId: state.viewState.activeBranchId!,
      });
      // Store the reasoning graph on the arc for canvas viewing
      dispatch({
        type: "SET_ARC_REASONING_GRAPH",
        arcId: arc.id,
        reasoningGraph: {
          nodes: reasoningGraph.nodes,
          edges: reasoningGraph.edges,
          arcName: reasoningGraph.arcName,
          sceneCount: reasoningGraph.sceneCount,
          summary: reasoningGraph.summary,
        },
      });
      // Advance coordination plan if active (regardless of whether settings were changed)
      if (hasActivePlan && activeBranchId) {
        dispatch({ type: "ADVANCE_COORDINATION_PLAN", branchId: activeBranchId });
      }
      onClose();
    } catch (err) {
      logError("Scene generation from reasoning graph failed", err, {
        source: "manual-generation",
        operation: "generate-scenes-from-graph",
        details: { sceneCount: reasoningGraph.sceneCount },
      });
      setError(String(err));
    } finally {
      setLoading(false);
      setReasoningGraph(null);
    }
  }

  async function handleGenerateArc() {
    if (!narrative) return;
    if (!newArc && !currentArc) return;
    setLoading(true);
    setStreamText("");
    setError("");
    try {
      // Guidance direction/constraints are PER-GENERATION overrides — they
      // must NOT be persisted to story settings. Use a transient narrative
      // clone (same pattern as handleConfirmReasoningGraph).
      const currentSettings = {
        ...DEFAULT_STORY_SETTINGS,
        ...narrative.storySettings,
      };
      const narrativeForRun: NarrativeState = {
        ...narrative,
        storySettings: {
          ...currentSettings,
          storyDirection: guidanceDirection,
          storyConstraints: guidanceConstraints,
        },
      };

      const existingArc = !newArc ? (currentArc ?? undefined) : undefined;
      const worldBuildFocus = worldBuildFocusId
        ? narrative.worldBuilds[worldBuildFocusId]
        : undefined;

      const { scenes, arc } = await generateScenes(
        narrativeForRun,
        state.resolvedEntryKeys,
        headIndex,
        directionCount, // Use directionCount for legacy path
        direction,
        {
          existingArc,
          pacingSequence: previewSequence ?? undefined,
          worldBuildFocus,
          coordinationPlanContext,
          onReasoning: (token) => setStreamText((prev) => prev + token),
        },
      );
      dispatch({
        type: "BULK_ADD_SCENES",
        scenes,
        arc,
        branchId: state.viewState.activeBranchId!,
      });
      // Advance coordination plan if active (regardless of whether settings were changed)
      if (hasActivePlan && activeBranchId) {
        dispatch({ type: "ADVANCE_COORDINATION_PLAN", branchId: activeBranchId });
      }
      onClose();
    } catch (err) {
      logError("Manual scene generation failed", err, {
        source: "manual-generation",
        operation: "generate-scenes",
        details: {
          sceneCount: directionCount,
          newArc,
        },
      });
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSuggestWorld() {
    if (!narrative) return;
    setSuggesting(true);
    setError("");
    try {
      const suggestion = await suggestWorldExpansion(
        narrative,
        state.resolvedEntryKeys,
        headIndex,
        worldSize,
        worldStrategy,
      );
      setWorldDirective(suggestion);
    } catch (err) {
      logError("World expansion suggestion failed", err, {
        source: "world-expansion",
        operation: "suggest-expansion",
        details: { worldSize, worldStrategy },
      });
      setError(String(err));
    } finally {
      setSuggesting(false);
    }
  }

  // Generate expansion reasoning graph (similar to scene reasoning)
  async function handleGenerateExpansionReasoningGraph() {
    if (!narrative) return;
    setGeneratingGraph(true);
    setStreamText("");
    setError("");
    try {
      const graph = await generateExpansionReasoningGraph(
        narrative,
        state.resolvedEntryKeys,
        headIndex,
        worldDirective,
        worldSize,
        worldStrategy,
        (token) => setStreamText((prev) => prev + token),
        { forcePreference, reasoningLevel: reasoningSize, reasoningMode },
      );
      setExpansionReasoningGraph(graph);
      setShowExpansionReasoningModal(true);
    } catch (err) {
      logError("Expansion reasoning graph generation failed", err, {
        source: "world-expansion",
        operation: "generate-expansion-reasoning-graph",
        details: { worldSize, worldStrategy },
      });
      setError(String(err));
    } finally {
      setGeneratingGraph(false);
    }
  }

  // Confirm expansion reasoning graph and execute expansion
  async function handleConfirmExpansionReasoningGraph() {
    if (!narrative || !expansionReasoningGraph) return;
    setShowExpansionReasoningModal(false);
    setLoading(true);
    setStreamText("");
    setError("");
    try {
      const expansion = await expandWorld(
        narrative,
        state.resolvedEntryKeys,
        headIndex,
        worldDirective,
        worldSize,
        worldStrategy,
        {
          onReasoning: (token) => setStreamText((prev) => prev + token),
          entityFilter,
          reasoningGraph: expansionReasoningGraph, // Pass pre-generated reasoning graph
        },
      );
      dispatch({
        type: "EXPAND_WORLD",
        worldBuildId: nextId("WB", Object.keys(narrative.worldBuilds), 3),
        branchId: state.viewState.activeBranchId!,
        characters: expansion.characters,
        locations: expansion.locations,
        artifacts: expansion.artifacts,
        threads: expansion.threads,
        threadDeltas: expansion.threadDeltas,
        worldDeltas: expansion.worldDeltas,
        systemDeltas: expansion.systemDeltas,
        relationshipDeltas: expansion.relationshipDeltas,
        ownershipDeltas: expansion.ownershipDeltas,
        tieDeltas: expansion.tieDeltas,
        reasoningGraph: expansion.reasoningGraph,
      });
      setExpansionReasoningGraph(null);
      onClose();
    } catch (err) {
      logError("World expansion with reasoning failed", err, {
        source: "world-expansion",
        operation: "expand-world-with-reasoning",
        details: { worldSize, worldStrategy },
      });
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  // Quick expand without reasoning (for exact size or when user skips planning)
  async function handleExpandWorld() {
    if (!narrative) return;
    setLoading(true);
    setStreamText("");
    setError("");
    try {
      const expansion = await expandWorld(
        narrative,
        state.resolvedEntryKeys,
        headIndex,
        worldDirective,
        worldSize,
        worldStrategy,
        {
          onReasoning: (token) => setStreamText((prev) => prev + token),
          entityFilter,
          useReasoning: false,
        },
      );
      dispatch({
        type: "EXPAND_WORLD",
        worldBuildId: nextId("WB", Object.keys(narrative.worldBuilds), 3),
        branchId: state.viewState.activeBranchId!,
        characters: expansion.characters,
        locations: expansion.locations,
        artifacts: expansion.artifacts,
        threads: expansion.threads,
        threadDeltas: expansion.threadDeltas,
        worldDeltas: expansion.worldDeltas,
        systemDeltas: expansion.systemDeltas,
        relationshipDeltas: expansion.relationshipDeltas,
        ownershipDeltas: expansion.ownershipDeltas,
        tieDeltas: expansion.tieDeltas,
      });
      onClose();
    } catch (err) {
      logError("World expansion generation failed", err, {
        source: "world-expansion",
        operation: "expand-world",
        details: {
          worldSize,
          worldStrategy,
          directiveLength: worldDirective.length,
        },
      });
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const showPreview = !!previewSequence && mode === "continuation" && !loading && narrative.storySettings?.usePacingChain;

  return (
    <Modal onClose={loading || generatingGraph ? () => {} : onClose} size="xl" maxHeight="90vh">
      <ModalHeader onClose={onClose} hideClose={loading}>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Generate</h2>
        </div>
      </ModalHeader>
      <ModalBody className="p-6 space-y-4">
        {/* Mode tabs */}
        <div className="flex gap-1 bg-bg-elevated rounded-lg p-0.5">
          {[
            { label: "Continuation", value: "continuation" as Mode },
            { label: "Expand World", value: "world" as Mode },
          ].map((m) => (
            <button
              key={m.value}
              onClick={() => {
                setMode(m.value);
                setError("");
                setPreviewSequence(null);
              }}
              disabled={loading}
              className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors rounded-md ${
                mode === m.value
                  ? "bg-bg-overlay text-text-primary"
                  : "text-text-dim hover:text-text-secondary"
              } disabled:opacity-50`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {loading || generatingGraph ? (
          <StreamingOutput
            label={
              generatingGraph
                ? "Planning arc"
                : mode === "continuation"
                  ? newArc
                    ? "Generating arc"
                    : "Continuing arc"
                  : "Expanding world"
            }
            text={streamText}
          />
        ) : showPreview ? (
          /* ── Pacing Preview (editable) ─────────────────────────── */
          <div className="flex flex-col gap-4">
            {/* Graph centered */}
            <div className="flex justify-center">
              <MarkovGraph
                sequence={previewSequence}
                startMode={currentMode}
                animating={animating}
                onAnimationDone={() => setAnimating(false)}
                width={240}
                height={240}
              />
            </div>

            {/* Editable strip — animated on first render, then editable */}
            {animating ? (
              <PacingStrip sequence={previewSequence} animating={animating} />
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center flex-wrap gap-1.5">
                  {previewSequence.steps.map((step, i) => (
                    <div key={i} className="relative flex items-center">
                      {i > 0 && (
                        <span className="text-text-dim/30 text-[13px] font-light select-none mx-0.5">
                          →
                        </span>
                      )}
                      <button
                        data-step-idx={i}
                        onClick={() =>
                          setEditingStep(editingStep === i ? null : i)
                        }
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-all ${editingStep === i ? "ring-1 ring-white/30" : "hover:ring-1 hover:ring-white/15"}`}
                        style={{
                          backgroundColor: `${CORNER_COLORS[step.mode]}15`,
                        }}
                      >
                        <CubeBadge mode={step.mode} size="sm" />
                        <span
                          className="text-[10px] font-semibold leading-none whitespace-nowrap"
                          style={{ color: CORNER_COLORS[step.mode] }}
                        >
                          {NARRATIVE_CUBE[step.mode].name}
                        </span>
                      </button>
                      {/* Dropdown picker */}
                      {editingStep === i &&
                        (() => {
                          // Use a portal-style ref to position the dropdown in fixed space
                          const btn = document.querySelector(
                            `[data-step-idx="${i}"]`,
                          );
                          const rect = btn?.getBoundingClientRect();
                          return (
                            <>
                              {/* Backdrop to close on outside click */}
                              <div
                                className="fixed inset-0 z-60"
                                onClick={() => setEditingStep(null)}
                              />
                              <div
                                className="fixed z-61 bg-bg-base border border-white/10 rounded-lg shadow-xl p-1 w-36"
                                style={
                                  rect
                                    ? { top: rect.bottom + 4, left: rect.left }
                                    : undefined
                                }
                              >
                                {ALL_CORNERS.map((corner) => (
                                  <button
                                    key={corner}
                                    onClick={() => handleSetStep(i, corner)}
                                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition ${
                                      corner === step.mode
                                        ? "bg-white/10"
                                        : "hover:bg-white/5"
                                    }`}
                                  >
                                    <CubeBadge mode={corner} size="sm" />
                                    <span
                                      className="text-[10px] font-medium"
                                      style={{ color: CORNER_COLORS[corner] }}
                                    >
                                      {NARRATIVE_CUBE[corner].name}
                                    </span>
                                  </button>
                                ))}
                                {previewSequence.steps.length > 1 && (
                                  <>
                                    <div className="h-px bg-white/6 my-1" />
                                    <button
                                      onClick={() => handleRemoveStep(i)}
                                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[10px] text-red-400/70 hover:bg-red-500/10 transition"
                                    >
                                      Remove step
                                    </button>
                                  </>
                                )}
                              </div>
                            </>
                          );
                        })()}
                    </div>
                  ))}
                  {/* Add step */}
                  <button
                    onClick={handleAddStep}
                    className="w-6 h-6 rounded border border-dashed border-white/15 text-text-dim hover:text-text-primary hover:border-white/30 transition flex items-center justify-center text-[11px]"
                    title="Add step"
                  >
                    +
                  </button>
                </div>
                <p className="text-[10px] text-text-dim leading-snug">
                  {previewSequence.pacingDescription}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setPreviewSequence(null)}
                disabled={animating}
                className="text-[11px] text-text-dim hover:text-text-secondary transition disabled:opacity-30 mr-auto"
              >
                &larr; Back
              </button>
              <button
                onClick={handleSample}
                disabled={animating}
                className="h-9 px-3 rounded-lg border border-white/8 text-text-dim hover:text-text-primary hover:border-white/15 transition disabled:opacity-30 flex items-center gap-1.5 text-[11px]"
                title="Reroll from transition matrix"
              >
                <IconDice size={14} />
                Reroll
              </button>
              <button
                onClick={handleGenerateArc}
                disabled={animating}
                className="h-9 px-5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary font-semibold transition disabled:opacity-30 text-[12px]"
              >
                Generate →
              </button>
            </div>
          </div>
        ) : (
          /* ── Configuration ──────────────────────────────────── */
          <div className="flex flex-col gap-4">
            {mode === "continuation" ? (
              <>
                {/* Coordination plan indicator */}
                {hasActivePlan && coordPlan && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/20">
                    <div className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                    <span className="text-[11px] text-sky-300 font-medium">
                      Arc {planArcIndex}/{coordPlan.arcCount}
                    </span>
                    <span className="text-[10px] text-sky-300/60">
                      Plan context active — your direction adds to the plan
                    </span>
                  </div>
                )}

                {/* Arc toggle */}
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newArc}
                    onChange={(e) => setNewArc(e.target.checked)}
                    className="accent-white/80"
                  />
                  <span className="text-xs text-text-secondary">New arc</span>
                </label>

                {newArc ? (
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">
                      Arc Name
                    </label>
                    <input
                      type="text"
                      value={arcName}
                      onChange={(e) => setArcName(e.target.value)}
                      placeholder="e.g. The Reckoning"
                      className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full outline-none placeholder:text-text-dim"
                    />
                  </div>
                ) : currentArc ? (
                  <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2">
                    <span className="text-[10px] uppercase tracking-widest text-text-dim">
                      Continuing
                    </span>
                    <p className="text-sm text-text-primary">
                      {currentArc.name}
                    </p>
                  </div>
                ) : null}

                {/* Direction + Constraints */}
                <GuidanceFields
                  direction={guidanceDirection}
                  constraints={guidanceConstraints}
                  onDirectionChange={(v) => {
                    setGuidanceDirection(v);
                    setDirection(v);
                  }}
                  onConstraintsChange={setGuidanceConstraints}
                />

                {/* Scene Count */}
                <div className="flex items-center gap-3">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim shrink-0">
                    Scenes
                  </label>
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="range"
                      min={1}
                      max={12}
                      value={directionCount}
                      onChange={(e) => setDirectionCount(Number(e.target.value))}
                      className="flex-1 h-1 appearance-none bg-white/10 rounded-full accent-white/60 cursor-pointer [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white/80 [&::-webkit-slider-thumb]:appearance-none"
                    />
                    <span className="text-xs font-medium text-text-primary w-5 text-center tabular-nums">
                      {directionCount}
                    </span>
                  </div>
                  {/* Current mode pill */}
                  <div className="flex items-center gap-1.5 text-[10px] text-text-dim shrink-0">
                    <CubeBadge mode={currentMode} />
                    <span style={{ color: CORNER_COLORS[currentMode] }}>
                      {NARRATIVE_CUBE[currentMode].name}
                    </span>
                  </div>
                </div>

                {/* Advanced */}
                <div>
                  <button
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-text-dim hover:text-text-secondary transition-colors"
                  >
                    <IconChevronRight
                      size={12}
                      className={`transition-transform ${advancedOpen ? "rotate-90" : ""}`}
                    />
                    Advanced
                  </button>
                  {advancedOpen && (
                    <div className="mt-3 flex flex-col gap-3">
                      {/* Thinking settings — mode, force, density */}
                      <ThinkingSettings
                        mode={reasoningMode}
                        onModeChange={setReasoningMode}
                        force={forcePreference}
                        onForceChange={setForcePreference}
                        size={reasoningSize}
                        onSizeChange={setReasoningSize}
                      />

                      {/* Pacing presets — only shown when Markov pacing is enabled */}
                      {narrative.storySettings?.usePacingChain && (
                        <div>
                          <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1.5">
                            Pacing Presets
                          </label>
                          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                            {PACING_PRESETS.map((preset) => (
                              <button
                                key={preset.key}
                                onClick={() => {
                                  setDirectionCount(preset.modes.length);
                                  const seq = buildPresetSequence(preset);
                                  setPreviewSequence(seq);
                                  setAnimating(true);
                                }}
                                disabled={!newArc && !currentArc}
                                className="rounded-lg px-3 py-2 text-left transition border border-white/6 bg-white/2 hover:bg-white/6 hover:border-white/12 disabled:opacity-30 flex items-center gap-3"
                              >
                                <div className="flex gap-0.5 shrink-0">
                                  {preset.modes.map((m, i) => (
                                    <div
                                      key={i}
                                      className="w-2 h-2 rounded-sm"
                                      style={{
                                        backgroundColor: CORNER_COLORS[m],
                                      }}
                                      title={NARRATIVE_CUBE[m].name}
                                    />
                                  ))}
                                </div>
                                <div className="min-w-0">
                                  <span className="text-[11px] font-medium text-text-primary">
                                    {preset.name}
                                  </span>
                                  <span className="text-[10px] text-text-dim ml-1.5">
                                    {preset.modes.length}s
                                  </span>
                                  <p className="text-[10px] text-text-dim line-clamp-1">
                                    {preset.description}
                                  </p>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* World build focus */}
                      {(() => {
                        const resolvedSet = new Set(state.resolvedEntryKeys);
                        const wbEntries = Object.values(
                          narrative.worldBuilds,
                        ).filter((wb) => resolvedSet.has(wb.id));
                        if (wbEntries.length === 0) return null;
                        return (
                          <div>
                            <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1.5">
                              World Build Focus
                            </label>
                            <div className="flex flex-col gap-1 max-h-24 overflow-y-auto">
                              {wbEntries.map((wb) => {
                                const isSelected = worldBuildFocusId === wb.id;
                                return (
                                  <button
                                    key={wb.id}
                                    type="button"
                                    onClick={() =>
                                      setWorldBuildFocusId(
                                        isSelected ? null : wb.id,
                                      )
                                    }
                                    className={`rounded-lg px-3 py-2 text-left transition border ${
                                      isSelected
                                        ? "bg-amber-500/10 border-amber-500/30"
                                        : "bg-bg-elevated border-border hover:border-white/16"
                                    }`}
                                  >
                                    <p
                                      className={`text-xs line-clamp-1 ${isSelected ? "text-amber-300" : "text-text-primary"}`}
                                    >
                                      {wb.summary}
                                    </p>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleGenerateReasoningGraph()}
                    disabled={loading || generatingGraph || (!newArc && !currentArc)}
                    className="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary font-semibold transition disabled:opacity-30"
                  >
                    {generatingGraph ? "Planning..." : "Plan Arc"}
                  </button>
                  <button
                    onClick={handleGenerateArc}
                    disabled={loading || generatingGraph || (!newArc && !currentArc)}
                    className="py-2.5 px-4 rounded-lg border border-white/8 hover:bg-white/6 text-text-dim hover:text-text-primary transition disabled:opacity-30 text-[12px]"
                    title="Skip planning and generate directly"
                  >
                    Quick
                  </button>
                  {narrative.storySettings?.usePacingChain && (
                    <button
                      onClick={handleSample}
                      disabled={!newArc && !currentArc}
                      className="py-2.5 px-4 rounded-lg border border-white/8 hover:bg-white/6 text-text-dim hover:text-text-primary transition disabled:opacity-30 flex items-center justify-center gap-2 text-[12px]"
                      title="MCTS multi-arc generation"
                    >
                      <IconDice size={16} />
                      MCTS
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* World mode */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase tracking-widest text-text-dim">
                      Directive
                    </label>
                    <button
                      onClick={handleSuggestWorld}
                      disabled={suggesting}
                      className="text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
                    >
                      {suggesting ? "Thinking..." : "Suggest"}
                    </button>
                  </div>
                  <textarea
                    value={worldDirective}
                    onChange={(e) => setWorldDirective(e.target.value)}
                    placeholder="Describe what to add to the world..."
                    className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-28 resize-none outline-none placeholder:text-text-dim"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">
                    Size
                  </label>
                  <div className="flex gap-1.5">
                    {[
                      {
                        value: "exact" as WorldExpansionSize,
                        label: "Exact",
                        desc: "As described",
                      },
                      {
                        value: "small" as WorldExpansionSize,
                        label: "Small",
                        desc: "~5 entities",
                      },
                      {
                        value: "medium" as WorldExpansionSize,
                        label: "Medium",
                        desc: "~12 entities",
                      },
                      {
                        value: "large" as WorldExpansionSize,
                        label: "Large",
                        desc: "~30 entities",
                      },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setWorldSize(opt.value)}
                        className={`flex-1 px-2 py-2 rounded-lg text-left transition-colors ${
                          worldSize === opt.value
                            ? "bg-white/10 ring-1 ring-white/20"
                            : "bg-white/3 hover:bg-white/6"
                        }`}
                      >
                        <div className="text-xs text-text-primary font-medium">
                          {opt.label}
                        </div>
                        <div className="text-[9px] text-text-dim">
                          {opt.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <details className="group">
                  <summary className="text-[10px] uppercase tracking-widest text-text-dim cursor-pointer select-none flex items-center gap-1 hover:text-text-secondary transition-colors">
                    <svg
                      className="w-3 h-3 transition-transform group-open:rotate-90"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                    >
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                    Advanced
                  </summary>
                  <div className="mt-2 space-y-3">
                    <ThinkingSettings
                      mode={reasoningMode}
                      onModeChange={setReasoningMode}
                      force={forcePreference}
                      onForceChange={setForcePreference}
                      size={reasoningSize}
                      onSizeChange={setReasoningSize}
                    />
                    <div>
                      <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">
                        Strategy
                      </label>
                      <div className="flex gap-1.5">
                        {[
                          {
                            value: "depth" as WorldExpansionStrategy,
                            label: "Depth",
                            desc: "Deepen",
                          },
                          {
                            value: "breadth" as WorldExpansionStrategy,
                            label: "Breadth",
                            desc: "Widen",
                          },
                          {
                            value: "dynamic" as WorldExpansionStrategy,
                            label: "Dynamic",
                            desc: "Auto",
                          },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setWorldStrategy(opt.value)}
                            className={`flex-1 px-2 py-2 rounded-lg text-left transition-colors ${
                              worldStrategy === opt.value
                                ? "bg-white/10 ring-1 ring-white/20"
                                : "bg-white/3 hover:bg-white/6"
                            }`}
                          >
                            <div className="text-xs text-text-primary font-medium">
                              {opt.label}
                            </div>
                            <div className="text-[9px] text-text-dim">
                              {opt.desc}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">
                        Entity Types
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { key: "characters" as const, label: "Characters" },
                          { key: "locations" as const, label: "Locations" },
                          { key: "artifacts" as const, label: "Artifacts" },
                          { key: "threads" as const, label: "Threads" },
                          {
                            key: "threadDeltas" as const,
                            label: "Thread Delta",
                          },
                          {
                            key: "worldDeltas" as const,
                            label: "World Delta",
                          },
                          { key: "systemDeltas" as const, label: "System Delta" },
                          {
                            key: "relationshipDeltas" as const,
                            label: "Relationship Delta",
                          },
                          {
                            key: "ownershipDeltas" as const,
                            label: "Ownership Delta",
                          },
                          { key: "tieDeltas" as const, label: "Tie Delta" },
                        ].map((opt) => (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() =>
                              setEntityFilter((prev) => ({
                                ...prev,
                                [opt.key]: !prev[opt.key],
                              }))
                            }
                            className={`px-2.5 py-1.5 rounded-lg text-[10px] transition-colors ${
                              entityFilter[opt.key]
                                ? "bg-white/10 text-text-primary ring-1 ring-white/20"
                                : "bg-white/3 text-text-dim/50 line-through"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </details>
                {/* For non-exact sizes, show Plan and Quick buttons */}
                {worldSize !== "exact" ? (
                  <div className="flex gap-2">
                    <button
                      onClick={handleGenerateExpansionReasoningGraph}
                      disabled={loading || generatingGraph}
                      className="flex-1 bg-white/10 hover:bg-white/16 text-text-primary font-semibold px-4 py-2.5 rounded-lg transition disabled:opacity-30"
                    >
                      {generatingGraph ? "Planning..." : "Plan Expansion"}
                    </button>
                    <button
                      onClick={handleExpandWorld}
                      disabled={loading || generatingGraph}
                      className="flex-1 bg-white/6 hover:bg-white/10 text-text-secondary font-medium px-4 py-2.5 rounded-lg transition disabled:opacity-30"
                    >
                      {loading ? "Expanding..." : "Quick"}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleExpandWorld}
                    disabled={loading}
                    className="bg-white/10 hover:bg-white/16 text-text-primary font-semibold px-4 py-2.5 rounded-lg transition disabled:opacity-30"
                  >
                    {loading ? "Expanding..." : "Expand World"}
                  </button>
                )}
              </>
            )}

            {error && (
              <div className="bg-fate/10 border border-fate/30 rounded-lg px-3 py-2">
                <p className="text-sm text-fate font-medium">Failed</p>
                <p className="text-xs text-fate/80 mt-1">{error}</p>
              </div>
            )}
          </div>
        )}
      </ModalBody>

      {/* Reasoning Graph Modal (for scene generation) */}
      {showReasoningModal && reasoningGraph && (
        <ReasoningGraphModal
          graph={reasoningGraph}
          isLoading={generatingGraph}
          onRegenerate={handleGenerateReasoningGraph}
          onConfirm={handleConfirmReasoningGraph}
          onClose={() => {
            setShowReasoningModal(false);
            setReasoningGraph(null);
          }}
        />
      )}

      {/* Expansion Reasoning Graph Modal (for world expansion) */}
      {showExpansionReasoningModal && expansionReasoningGraph && (
        <ReasoningGraphModal
          graph={{
            ...expansionReasoningGraph,
            arcName: expansionReasoningGraph.expansionName,
            sceneCount: 0,
          }}
          isLoading={generatingGraph}
          onRegenerate={handleGenerateExpansionReasoningGraph}
          onConfirm={handleConfirmExpansionReasoningGraph}
          onClose={() => {
            setShowExpansionReasoningModal(false);
            setExpansionReasoningGraph(null);
          }}
          confirmLabel="Expand World"
        />
      )}
    </Modal>
  );
}
