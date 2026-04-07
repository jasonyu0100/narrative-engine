"use client";

import {
  IconAutoLoop,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconEdit,
  IconFlask,
  IconList,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconTrash,
} from "@/components/icons";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useStore } from "@/lib/store";
import { resolvePlanForBranch, resolveProseForBranch } from "@/lib/narrative-utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type FloatingPaletteProps = {
  isBulkActive?: boolean;
  isBulkAudioActive?: boolean;
  isMctsActive?: boolean;
};

export default function FloatingPalette({
  isBulkActive = false,
  isBulkAudioActive = false,
  isMctsActive = false,
}: FloatingPaletteProps) {
  const { state, dispatch } = useStore();
  const access = useFeatureAccess();
  const narrative = state.activeNarrative;
  const isActive = narrative !== null;

  const totalScenes = state.resolvedEntryKeys.length;
  const isHead = state.currentSceneIndex === totalScenes - 1 && totalScenes > 0;
  const activeBranch =
    narrative && state.activeBranchId
      ? narrative.branches[state.activeBranchId]
      : null;
  const headSceneId = state.resolvedEntryKeys[state.currentSceneIndex];
  const headIsOwned = activeBranch
    ? activeBranch.entryIds.includes(headSceneId)
    : false;
  // Block deletion if this scene is used as a fork point by any other branch
  const headIsForkPoint = narrative
    ? Object.values(narrative.branches).some(
        (b) => b.id !== state.activeBranchId && b.forkEntryId === headSceneId,
      )
    : false;
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const isAutoActive = !!(
    state.autoRunState?.isRunning || state.autoRunState?.isPaused
  );
  const isAnyModeActive =
    isAutoActive || isBulkActive || isBulkAudioActive || isMctsActive;

  const handleDeleteHead = useCallback(() => {
    if (!narrative || !state.activeBranchId || !isHead) return;
    const headSceneId = state.resolvedEntryKeys[state.currentSceneIndex];
    if (!headSceneId) return;

    const branchesWithEntry = Object.values(narrative.branches).filter((b) =>
      b.entryIds.includes(headSceneId),
    );

    if (branchesWithEntry.length <= 1) {
      dispatch({
        type: "DELETE_SCENE",
        sceneId: headSceneId,
        branchId: state.activeBranchId,
      });
    } else {
      dispatch({
        type: "REMOVE_BRANCH_ENTRY",
        entryId: headSceneId,
        branchId: state.activeBranchId,
      });
    }
    setDeleteConfirm(false);
  }, [
    narrative,
    state.activeBranchId,
    state.resolvedEntryKeys,
    state.currentSceneIndex,
    isHead,
    dispatch,
  ]);

  const graphViewMode = state.graphViewMode;
  const isEditingMode =
    graphViewMode === "plan" ||
    graphViewMode === "prose" ||
    graphViewMode === "audio";

  // Branch context for version resolution
  const branchId = state.activeBranchId;
  const branches = useMemo(() => narrative?.branches ?? {}, [narrative?.branches]);

  // Current scene — for checking if rewrite is available
  const currentScene = useMemo(() => {
    if (!narrative) return null;
    const key = state.resolvedEntryKeys[state.currentSceneIndex];
    return key ? (narrative.scenes[key] ?? null) : null;
  }, [narrative, state.resolvedEntryKeys, state.currentSceneIndex]);

  const hasPlan = useMemo(() => {
    if (!currentScene || !branchId) return false;
    return !!resolvePlanForBranch(currentScene, branchId, branches);
  }, [currentScene, branchId, branches]);

  const hasProse = useMemo(() => {
    if (!currentScene || !branchId) return false;
    return !!resolveProseForBranch(currentScene, branchId, branches).prose;
  }, [currentScene, branchId, branches]);

  const hasAudio = !!currentScene?.audioUrl;
  const wrapperClasses = isActive ? "" : "opacity-30 pointer-events-none";
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateText, setGenerateText] = useState("");
  const generateInputRef = useRef<HTMLTextAreaElement>(null);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteText, setRewriteText] = useState("");
  const rewriteInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (generateOpen) setTimeout(() => generateInputRef.current?.focus(), 50);
    else setGenerateText("");
  }, [generateOpen]);

  useEffect(() => {
    if (rewriteOpen) setTimeout(() => rewriteInputRef.current?.focus(), 50);
    else setRewriteText("");
  }, [rewriteOpen]);

  const submitGenerate = useCallback(() => {
    const event =
      graphViewMode === "plan"
        ? "canvas:generate-plan"
        : "canvas:generate-prose";
    window.dispatchEvent(
      new CustomEvent(event, { detail: { guidance: generateText.trim() } }),
    );
    setGenerateOpen(false);
    setGenerateText("");
  }, [generateText, graphViewMode]);

  const submitRewrite = useCallback(() => {
    if (!rewriteText.trim()) return;
    const event =
      graphViewMode === "plan" ? "canvas:rewrite-plan" : "canvas:rewrite-prose";
    window.dispatchEvent(
      new CustomEvent(event, { detail: { guidance: rewriteText.trim() } }),
    );
    setRewriteOpen(false);
    setRewriteText("");
  }, [rewriteText, graphViewMode]);

  // ── Editing mode palette (plan / prose) ───────────────────────────────
  if (isEditingMode) {
    return (
      <>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2">
          {/* Generate guidance overlay */}
          {generateOpen && (
            <div
              className="w-96 flex flex-col rounded-xl border border-white/10 overflow-hidden"
              style={{
                background: "#1a1a1a",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              }}
            >
              <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
                <span
                  className={`text-[10px] uppercase tracking-wider text-emerald-400/70`}
                >
                  Generate {graphViewMode === "plan" ? "Plan" : "Prose"}
                </span>
                <button
                  onClick={() => setGenerateOpen(false)}
                  className="text-[10px] text-text-dim/40 hover:text-text-dim transition"
                >
                  &times;
                </button>
              </div>
              <div className="p-3">
                <textarea
                  ref={generateInputRef}
                  value={generateText}
                  onChange={(e) => setGenerateText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setGenerateOpen(false);
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                      submitGenerate();
                  }}
                  placeholder={
                    graphViewMode === "plan"
                      ? 'Optional direction... e.g. "focus on the power struggle" or "open with a quiet moment"'
                      : 'Optional direction... e.g. "write it sparse and clipped" or "lean into sensory detail"'
                  }
                  className="w-full h-20 bg-black/20 border border-white/5 rounded text-[11px] text-text-secondary p-2 resize-none outline-none focus:border-white/15 placeholder:text-text-dim/30"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[9px] text-text-dim/30">
                    &#x2318;Enter to submit
                  </span>
                  <button
                    onClick={submitGenerate}
                    className={`text-[10px] px-3 py-1 rounded transition bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15`}
                  >
                    Generate
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Rewrite guidance overlay */}
          {rewriteOpen && (
            <div
              className="w-96 flex flex-col rounded-xl border border-white/10 overflow-hidden"
              style={{
                background: "#1a1a1a",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              }}
            >
              <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
                <span
                  className={`text-[10px] uppercase tracking-wider ${
                    graphViewMode === "plan"
                      ? "text-sky-400"
                      : "text-emerald-400"
                  }`}
                >
                  Rewrite {graphViewMode === "plan" ? "Plan" : "Prose"}
                </span>
                <button
                  onClick={() => setRewriteOpen(false)}
                  className="text-[10px] text-text-dim/40 hover:text-text-dim transition"
                >
                  &times;
                </button>
              </div>
              <div className="p-3">
                <textarea
                  ref={rewriteInputRef}
                  value={rewriteText}
                  onChange={(e) => setRewriteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setRewriteOpen(false);
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                      submitRewrite();
                  }}
                  placeholder={
                    graphViewMode === "plan"
                      ? 'Describe what to change... e.g. "add more tension before the reveal" or "swap the dialogue beat for inner monologue"'
                      : 'Describe what to change... e.g. "make the opening more visceral" or "tighten the pacing in the middle section"'
                  }
                  className="w-full h-20 bg-black/20 border border-white/5 rounded text-[11px] text-text-secondary p-2 resize-none outline-none focus:border-white/15 placeholder:text-text-dim/30"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[9px] text-text-dim/30">
                    &#x2318;Enter to submit
                  </span>
                  <button
                    onClick={submitRewrite}
                    disabled={!rewriteText.trim()}
                    className={`text-[10px] px-3 py-1 rounded transition disabled:opacity-30 disabled:cursor-not-allowed ${
                      graphViewMode === "plan"
                        ? "bg-sky-500/10 border border-sky-500/20 text-sky-400 hover:bg-sky-500/15"
                        : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15"
                    }`}
                  >
                    Rewrite
                  </button>
                </div>
              </div>
            </div>
          )}

          <div
            className={`glass-pill px-3 py-1.5 flex items-center gap-2 ${wrapperClasses}`}
          >
            {/* Scene nav */}
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded-md transition-colors"
              onClick={() => dispatch({ type: "PREV_SCENE" })}
              aria-label="Previous scene"
            >
              <IconChevronLeft size={14} />
            </button>
            <button
              type="button"
              className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${state.graphViewMode === 'search' ? "text-text-primary bg-white/10" : "text-text-secondary hover:text-text-primary hover:bg-white/6"}`}
              onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: 'search' })}
              aria-label="Search narrative"
              title="Search narrative"
            >
              <IconSearch size={12} />
            </button>
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded-md transition-colors"
              onClick={() => dispatch({ type: "NEXT_SCENE" })}
              aria-label="Next scene"
            >
              <IconChevronRight size={14} />
            </button>

            {/* Plan/Prose/Audio palette actions — hidden during auto/MCTS/bulk */}
            {!isAnyModeActive && (
              <>
                <div className="w-px h-4 bg-white/12 mx-1" />

                {/* Plan palette actions */}
                {graphViewMode === "plan" && (
                  <>
                    <button
                      type="button"
                      className="text-xs font-semibold px-2 py-1 rounded-md transition-colors uppercase tracking-wider text-change bg-change/10 hover:bg-change/20"
                      onClick={() => {
                        setGenerateOpen((v) => !v);
                        setRewriteOpen(false);
                      }}
                    >
                      Generate
                    </button>
                    {hasPlan && (
                      <button
                        type="button"
                        className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-sky-400 bg-sky-500/10 hover:bg-sky-500/20"
                        onClick={() => {
                          setRewriteOpen((v) => !v);
                          setGenerateOpen(false);
                        }}
                        title="Rewrite with guidance"
                      >
                        <IconRefresh size={14} />
                      </button>
                    )}
                    {hasPlan && (
                      <button
                        type="button"
                        className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-text-dim bg-white/5 hover:bg-white/10 hover:text-text-secondary"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("canvas:clear-plan"),
                          )
                        }
                        title="Clear plan"
                      >
                        <IconClose size={14} />
                      </button>
                    )}
                    <div className="w-px h-4 bg-white/12 mx-0.5" />
                    <button
                      type="button"
                      className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-blue-400 bg-blue-500/10 hover:bg-blue-500/20"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("canvas:open-candidates"),
                        )
                      }
                      title="Generate multiple candidate plans and rank by semantic similarity"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                        <line x1="12" y1="22.08" x2="12" y2="12" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-orange-400 bg-orange-500/10 hover:bg-orange-500/20"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("canvas:check-continuity"),
                        )
                      }
                      title="Check propositions for continuity violations"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        <path d="M9 12l2 2 4-4" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("canvas:bulk-plan"),
                        )
                      }
                      title="Bulk generate all missing plans"
                    >
                      <IconAutoLoop size={14} />
                    </button>
                  </>
                )}

                {/* Prose palette actions */}
                {graphViewMode === "prose" && (
                  <>
                    <button
                      type="button"
                      className={`text-xs font-semibold px-2 py-1 rounded-md transition-colors uppercase tracking-wider ${!hasPlan ? "text-text-dim/30 bg-white/3 cursor-not-allowed" : "text-change bg-change/10 hover:bg-change/20"}`}
                      onClick={() => {
                        if (hasPlan) {
                          setGenerateOpen((v) => !v);
                          setRewriteOpen(false);
                        }
                      }}
                      title={hasPlan ? undefined : "Generate a plan first"}
                    >
                      Generate
                    </button>
                    {hasProse && (
                      <button
                        type="button"
                        className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20"
                        onClick={() => {
                          setRewriteOpen((v) => !v);
                          setGenerateOpen(false);
                        }}
                        title="Rewrite with guidance"
                      >
                        <IconRefresh size={14} />
                      </button>
                    )}
                    {hasProse && (
                      <button
                        type="button"
                        className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("canvas:edit-prose"),
                          )
                        }
                        title="Edit prose"
                      >
                        <IconEdit size={14} />
                      </button>
                    )}
                    {hasProse && (
                      <button
                        type="button"
                        className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-text-dim bg-white/5 hover:bg-white/10 hover:text-text-secondary"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("canvas:clear-prose"),
                          )
                        }
                        title="Clear prose"
                      >
                        <IconClose size={14} />
                      </button>
                    )}
                    <div className="w-px h-4 bg-white/12 mx-0.5" />
                    <button
                      type="button"
                      className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("canvas:bulk-prose"),
                        )
                      }
                      title="Bulk generate all missing prose (requires plans)"
                    >
                      <IconAutoLoop size={14} />
                    </button>
                  </>
                )}

                {/* Audio palette actions */}
                {graphViewMode === "audio" && (
                  <>
                    <button
                      type="button"
                      className={`text-xs font-semibold px-2 py-1 rounded-md transition-colors uppercase tracking-wider ${hasProse ? "text-change bg-change/10 hover:bg-change/20" : "text-text-dim/30 bg-white/3 cursor-not-allowed"}`}
                      onClick={() =>
                        hasProse &&
                        window.dispatchEvent(
                          new CustomEvent("canvas:generate-audio"),
                        )
                      }
                      title={hasProse ? undefined : "Generate prose first"}
                    >
                      Generate
                    </button>
                    {hasAudio && (
                      <button
                        type="button"
                        className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-text-dim bg-white/5 hover:bg-white/10 hover:text-text-secondary"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("canvas:clear-audio"),
                          )
                        }
                        title="Clear audio"
                      >
                        <IconClose size={14} />
                      </button>
                    )}
                    <div className="w-px h-4 bg-white/12 mx-0.5" />
                    <button
                      type="button"
                      className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("canvas:bulk-audio"),
                        )
                      }
                      title="Bulk generate all missing audio (requires prose)"
                    >
                      <IconAutoLoop size={14} />
                    </button>
                  </>
                )}
              </>
            )}

            <div className="w-px h-4 bg-white/12 mx-1" />

            {/* Story Settings — always visible */}
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-text-dim bg-white/5 hover:bg-white/10 hover:text-text-secondary"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("open-story-settings"))
              }
              title="Story settings"
            >
              <IconSettings size={14} />
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2">
      {/* Palette row: bar + delete button side by side */}
      <div className="flex items-center gap-2">
        <div
          className={`glass-pill px-3 py-1.5 flex items-center gap-2 ${wrapperClasses}`}
        >
          {/* Scene navigation — always visible */}
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded-md transition-colors"
            onClick={() => dispatch({ type: "PREV_SCENE" })}
            aria-label="Previous scene"
          >
            <IconChevronLeft size={14} />
          </button>

          {/* Search */}
          <button
            type="button"
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
              state.graphViewMode === 'search'
                ? "text-text-primary bg-white/10"
                : "text-text-secondary hover:text-text-primary hover:bg-white/6"
            }`}
            onClick={() => dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: 'search' })}
            aria-label="Search narrative"
            title="Search narrative"
          >
            <IconSearch size={12} />
          </button>

          {/* Next */}
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded-md transition-colors"
            onClick={() => dispatch({ type: "NEXT_SCENE" })}
            aria-label="Next scene"
          >
            <IconChevronRight size={14} />
          </button>

          {/* Action buttons — hidden during auto/MCTS/bulk */}
          {!isAnyModeActive && (
            <>
              {/* Divider */}
              <div className="w-px h-4 bg-white/12 mx-1" />

              {/* Generate */}
              <button
                type="button"
                className="text-xs font-semibold text-change bg-change/10 px-2 py-1 rounded-md hover:bg-change/20 transition-colors uppercase tracking-wider"
                onClick={() => {
                  if (access.userApiKeys && !access.hasOpenRouterKey) {
                    window.dispatchEvent(new Event("open-api-keys"));
                    return;
                  }
                  window.dispatchEvent(new CustomEvent("open-generate-panel"));
                }}
              >
                Generate
              </button>

              {/* MCTS Explorer */}
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-blue-400 bg-blue-500/10 hover:bg-blue-500/20"
                onClick={() => {
                  if (access.userApiKeys && !access.hasOpenRouterKey) {
                    window.dispatchEvent(new Event("open-api-keys"));
                    return;
                  }
                  window.dispatchEvent(new CustomEvent("open-mcts-panel"));
                }}
                title="MCTS Explorer"
              >
                <IconFlask size={14} />
              </button>

              {/* Auto */}
              <button
                type="button"
                className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                onClick={() => {
                  if (access.userApiKeys && !access.hasOpenRouterKey) {
                    window.dispatchEvent(new Event("open-api-keys"));
                    return;
                  }
                  window.dispatchEvent(new CustomEvent("open-auto-settings"));
                }}
                title="Auto mode"
              >
                <IconAutoLoop size={14} />
              </button>

              {/* Divider */}
              <div className="w-px h-4 bg-white/12 mx-1" />
            </>
          )}

          {/* Planning Queue */}
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-text-dim bg-white/5 hover:bg-white/10 hover:text-text-secondary"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("open-planning-queue"))
            }
            title="Planning queue"
          >
            <IconList size={14} />
          </button>

          {/* Story Settings — always visible */}
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-text-dim bg-white/5 hover:bg-white/10 hover:text-text-secondary"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("open-story-settings"))
            }
            title="Story settings"
          >
            <IconSettings size={14} />
          </button>
        </div>

        {/* Delete head scene button */}
        {isActive &&
          isHead &&
          headIsOwned &&
          (headIsForkPoint ? (
            <button
              type="button"
              disabled
              title="Another branch forks from this scene — delete that branch first"
              className="w-8 h-8 flex items-center justify-center rounded-full glass-pill text-text-dim opacity-30 cursor-not-allowed"
            >
              <IconTrash size={14} />
            </button>
          ) : deleteConfirm ? (
            <div className="glass-pill px-2 py-1.5 flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleDeleteHead}
                className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirm(false)}
                className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-dim hover:text-text-secondary transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDeleteConfirm(true)}
              className="w-8 h-8 flex items-center justify-center rounded-full glass-pill text-text-dim hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Delete head scene"
            >
              <IconTrash size={14} />
            </button>
          ))}
      </div>
    </div>
  );
}
