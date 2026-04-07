"use client";

import { generateSceneProse, rewriteSceneProse } from "@/lib/ai";
import { sceneScale } from "@/lib/ai/context";
import { useResolvedProse, useResolvedPlan } from "@/hooks/useResolvedScene";
import { getResolvedPlanVersion } from "@/lib/narrative-utils";
import { useStore } from "@/lib/store";
import type { NarrativeState, Scene } from "@/types/narrative";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePropositionClassification } from "@/hooks/usePropositionClassification";
import { classificationColor, classificationLabel } from "@/lib/proposition-classify";

// Persistent state that survives component unmounts (scene navigation, world commits)
let beatPlanLinkedModePersisted = false;

// Custom hook: useState that persists across component unmounts
function usePersistedState(initialValue: boolean): [boolean, (value: boolean | ((prev: boolean) => boolean)) => void] {
  const [state, setState] = useState(() => beatPlanLinkedModePersisted);

  const setPersistedState = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setState((prev) => {
      const newValue = typeof value === 'function' ? value(prev) : value;
      beatPlanLinkedModePersisted = newValue; // Persist across unmounts
      return newValue;
    });
  }, []);

  return [state, setPersistedState];
}

const FN_COLORS: Record<string, string> = {
  breathe: "#6b7280",
  inform: "#3b82f6",
  advance: "#22c55e",
  bond: "#ec4899",
  turn: "#f59e0b",
  reveal: "#a855f7",
  shift: "#ef4444",
  expand: "#06b6d4",
  foreshadow: "#84cc16",
  resolve: "#14b8a6",
};

const MECH_ICONS: Record<string, string> = {
  dialogue: "\u{1F4AC}",
  thought: "\u{1F4AD}",
  action: "\u26A1",
  environment: "\u{1F30D}",
  narration: "\u{1F4D6}",
  memory: "\u{1F519}",
  document: "\u{1F4C4}",
  comic: "\u{1F604}",
};

export function SceneProseView({
  narrative,
  scene,
  resolvedKeys,
}: {
  narrative: NarrativeState;
  scene: Scene;
  resolvedKeys: string[];
}) {
  const { state, dispatch } = useStore();
  const { getClassification } = usePropositionClassification();

  // Resolve prose and plan for current branch
  const { prose: resolvedProse, beatProseMap: resolvedBeatProseMap } = useResolvedProse(scene);
  const resolvedPlan = useResolvedPlan(scene);

  // Get the current resolved plan version for tracking prose generation source
  const currentPlanVersion = useMemo(() => {
    const branches = state.activeNarrative?.branches ?? {};
    const branchId = state.activeBranchId;
    return branchId ? getResolvedPlanVersion(scene, branchId, branches) : undefined;
  }, [scene, state.activeNarrative?.branches, state.activeBranchId]);

  type ProseState = {
    text: string;
    status: "idle" | "loading" | "ready" | "error";
    error?: string;
  };
  const [proseState, setProseState] = useState<ProseState>(() =>
    resolvedProse
      ? { text: resolvedProse, status: "ready" }
      : { text: "", status: "idle" },
  );
  const [isEditing, setIsEditing] = useState(false);
  const [showBeatPlan, setShowBeatPlan] = usePersistedState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const beatRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Sync beat plan toggle state to CanvasTopBar (after render, not during)
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('canvas:beat-plan-toggled', { detail: { value: showBeatPlan } }));
  }, [showBeatPlan]);

  // Sync when scene or resolved prose changes
  useEffect(() => {
    setProseState(
      resolvedProse
        ? { text: resolvedProse, status: "ready" }
        : { text: "", status: "idle" },
    );
    setIsEditing(false);
  }, [scene.id, resolvedProse]);

  // Listen for bulk prose streaming events (from useBulkGenerate)
  useEffect(() => {
    const onStart = (e: Event) => {
      const { sceneId } = (e as CustomEvent).detail;
      if (sceneId !== scene.id) return;
      setProseState({ text: "", status: "loading" });
      setIsEditing(false);
    };
    const onToken = (e: Event) => {
      const { sceneId, token } = (e as CustomEvent).detail;
      if (sceneId !== scene.id) return;
      setProseState((prev) => ({
        text: prev.text + token,
        status: "loading",
      }));
    };
    const onComplete = (e: Event) => {
      const { sceneId } = (e as CustomEvent).detail;
      if (sceneId !== scene.id) return;
      // Final state is set by the store update triggering resolvedProse sync
    };
    window.addEventListener("bulk:prose-start", onStart);
    window.addEventListener("bulk:prose-token", onToken);
    window.addEventListener("bulk:prose-complete", onComplete);
    return () => {
      window.removeEventListener("bulk:prose-start", onStart);
      window.removeEventListener("bulk:prose-token", onToken);
      window.removeEventListener("bulk:prose-complete", onComplete);
    };
  }, [scene.id]);

  const generateProse = useCallback(
    async (guidance?: string) => {
      setProseState({ text: "", status: "loading" });
      setIsEditing(false);
      try {
        const result = await generateSceneProse(
          narrative,
          scene,
          resolvedKeys,
          (token) => {
            setProseState((prev) => ({
              text: prev.text + token,
              status: "loading",
            }));
          },
          guidance,
          resolvedPlan, // Pass resolved plan for versioned scenes
        );
        setProseState({ text: result.prose, status: "ready" });
        dispatch({
          type: "UPDATE_SCENE",
          sceneId: scene.id,
          updates: {
            prose: result.prose,
            beatProseMap: result.beatProseMap,
          },
          versionType: 'generate', // Fresh AI generation creates major version
          sourcePlanVersion: currentPlanVersion, // Track which plan was used
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setProseState((prev) => ({ ...prev, status: "error", error: message }));
      }
    },
    [narrative, scene, resolvedKeys, dispatch, currentPlanVersion, resolvedPlan],
  );

  const rewriteProse = useCallback(
    async (guidance: string) => {
      const currentProse =
        proseState.status === "ready" ? proseState.text : resolvedProse;
      if (!currentProse) return;
      setProseState({ text: "", status: "loading" });
      setIsEditing(false);
      try {
        const { prose } = await rewriteSceneProse(
          narrative,
          scene,
          resolvedKeys,
          currentProse,
          guidance,
          0,
          0,
          undefined,
          (token) => {
            setProseState((prev) => ({
              text: prev.text + token,
              status: "loading",
            }));
          },
        );
        setProseState({ text: prose, status: "ready" });
        dispatch({
          type: "UPDATE_SCENE",
          sceneId: scene.id,
          updates: {
            prose,
            beatProseMap: undefined, // Rewrite invalidates beat mapping
          },
          versionType: 'rewrite', // AI rewrite creates minor version
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setProseState({ text: currentProse, status: "error", error: message });
      }
    },
    [narrative, scene, resolvedKeys, proseState, dispatch, resolvedProse],
  );

  const saveEdit = useCallback(() => {
    if (!textareaRef.current) return;
    const text = textareaRef.current.value;
    setProseState({ text, status: "ready" });
    setIsEditing(false);
    dispatch({
      type: "UPDATE_SCENE",
      sceneId: scene.id,
      updates: {
        prose: text,
        beatProseMap: undefined, // Clear mapping when manually edited
      },
      versionType: 'edit', // Manual edit creates sub-minor version
    });
  }, [scene.id, dispatch]);

  // Listen for palette events
  useEffect(() => {
    function onGenerate(e: Event) {
      const detail = (e as CustomEvent).detail;
      generateProse(detail?.guidance);
    }
    function onClear() {
      setProseState({ text: "", status: "idle" });
      setIsEditing(false);
      dispatch({
        type: "UPDATE_SCENE",
        sceneId: scene.id,
        updates: { prose: undefined },
      });
    }
    function onEdit() {
      if (isEditing) {
        saveEdit();
      } else {
        setIsEditing(true);
        setTimeout(() => textareaRef.current?.focus(), 30);
      }
    }
    function onRewrite(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.guidance) rewriteProse(detail.guidance);
    }
    function onToggleBeatPlan(e: Event) {
      const detail = (e as CustomEvent).detail;
      // If detail.enabled is provided, use that; otherwise toggle
      if (detail?.enabled !== undefined) {
        setShowBeatPlan(detail.enabled);
      } else {
        setShowBeatPlan((prev) => !prev);
      }
    }
    function onScrollToBeat(e: Event) {
      const { beatIndex, propIndex } = (e as CustomEvent).detail;
      const element = beatRefs.current.get(beatIndex);

      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('ring-2', 'ring-amber-400/50');
        setTimeout(() => {
          element.classList.remove('ring-2', 'ring-amber-400/50');
        }, 1500);

        // If targeting specific proposition, highlight it further
        if (propIndex !== undefined) {
          const propElement = element.querySelector(`[data-prop-index="${propIndex}"]`);
          if (propElement) {
            propElement.classList.add('bg-amber-500/20');
            setTimeout(() => propElement.classList.remove('bg-amber-500/20'), 2000);
          }
        }
      }
    }
    window.addEventListener("canvas:generate-prose", onGenerate);
    window.addEventListener("canvas:clear-prose", onClear);
    window.addEventListener("canvas:edit-prose", onEdit);
    window.addEventListener("canvas:rewrite-prose", onRewrite);
    window.addEventListener("canvas:toggle-beat-plan", onToggleBeatPlan);
    window.addEventListener("prose:scroll-to-beat", onScrollToBeat);
    return () => {
      window.removeEventListener("canvas:generate-prose", onGenerate);
      window.removeEventListener("canvas:clear-prose", onClear);
      window.removeEventListener("canvas:edit-prose", onEdit);
      window.removeEventListener("canvas:rewrite-prose", onRewrite);
      window.removeEventListener("canvas:toggle-beat-plan", onToggleBeatPlan);
      window.removeEventListener("prose:scroll-to-beat", onScrollToBeat);
    };
  }, [generateProse, rewriteProse, isEditing, saveEdit, scene.id, dispatch, setShowBeatPlan]);

  // Click outside textarea to save and close editor
  const editorWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isEditing) return;
    function handleClick(e: MouseEvent) {
      if (
        editorWrapRef.current &&
        !editorWrapRef.current.contains(e.target as Node)
      ) {
        saveEdit();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isEditing, saveEdit]);

  const { status, text, error } = proseState;
  const hasProse = status === "ready" && !!text;
  const isLoading = status === "loading";
  const hasError = status === "error";

  // Check if beat-linked view is available
  const hasBeatMapping = !!(
    resolvedPlan &&
    resolvedBeatProseMap &&
    resolvedBeatProseMap.chunks.length === resolvedPlan.beats.length &&
    // Verify all chunk beatIndex values are valid
    resolvedBeatProseMap.chunks.every(chunk =>
      typeof chunk.beatIndex === 'number' &&
      chunk.beatIndex >= 0 &&
      chunk.beatIndex < resolvedPlan!.beats.length
    )
  );

  return (
    <div className="h-full overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      {showBeatPlan && hasBeatMapping ? (
        // Linked view: each beat row has plan on left, prose on right
        <div className="px-6 pt-6 pb-48">
          <div className="space-y-0">
            {resolvedBeatProseMap!.chunks.map((chunk, idx) => {
              const beat = resolvedPlan!.beats[chunk.beatIndex];
              // Skip if beat doesn't exist (data integrity issue)
              if (!beat) {
                console.warn(`[SceneProseView] Beat at index ${chunk.beatIndex} not found in plan.beats`);
                return null;
              }
              return (
                <div
                  ref={(el) => {
                    if (el) beatRefs.current.set(chunk.beatIndex, el);
                  }}
                  key={chunk.beatIndex}
                  className="group relative flex gap-3 py-3 hover:bg-white/2 rounded-lg transition-colors"
                >
                  {/* Timeline indicator */}
                  <div className="flex flex-col items-center shrink-0 w-6">
                    <div
                      className="w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center text-[9px] font-semibold"
                      style={{
                        borderColor: FN_COLORS[beat.fn] ?? "#666",
                        backgroundColor: `${FN_COLORS[beat.fn] ?? "#666"}18`,
                        color: FN_COLORS[beat.fn] ?? "#666",
                      }}
                    >
                      {chunk.beatIndex + 1}
                    </div>
                    {idx < resolvedBeatProseMap!.chunks.length - 1 && (
                      <div className="flex-1 w-px bg-white/8 mt-0.5" />
                    )}
                  </div>

                  {/* Left: Beat plan */}
                  <div className="flex-[0.7] basis-0 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span
                        className="text-[9px] font-semibold uppercase tracking-wider"
                        style={{ color: FN_COLORS[beat.fn] ?? "#666" }}
                      >
                        {beat.fn}
                      </span>
                      <span className="text-[9px] text-text-dim/50">
                        {MECH_ICONS[beat.mechanism]} {beat.mechanism}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-secondary leading-relaxed">
                      {beat.what}
                    </p>
                    {beat.propositions && beat.propositions.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {beat.propositions.map((prop, j) => {
                          const cls = getClassification(scene.id, chunk.beatIndex, j);
                          const profileColor = cls ? classificationColor(cls.base, cls.reach) : undefined;
                          return (
                          <div
                            key={j}
                            className="flex items-start gap-1.5 transition-colors rounded-sm pl-1.5"
                            style={profileColor ? {
                              borderLeft: `2px solid ${profileColor}`,
                              backgroundColor: profileColor + '08',
                            } : undefined}
                            data-prop-index={j}
                            title={cls ? `${cls.reach} ${cls.base}` : undefined}
                          >
                            {cls && (
                              <span
                                className="shrink-0 text-[8px] leading-none font-medium lowercase mt-0.5"
                                style={{ color: profileColor }}
                              >
                                {classificationLabel(cls.base, cls.reach)}
                              </span>
                            )}
                            <p className="text-[11px] text-text-secondary/90 italic leading-relaxed">
                              {prop.content}
                            </p>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Right: Prose */}
                  <div className="flex-[1.3] basis-0 p-3">
                    <div className="prose-content">
                      {chunk.prose.split("\n\n").map((para, paraIdx) => (
                        <p
                          key={paraIdx}
                          className={`text-[13px] text-text-secondary leading-[1.8] mb-5 last:mb-0 ${
                            idx === 0 && paraIdx === 0
                              ? "first-letter:text-2xl first-letter:font-semibold first-letter:text-text-primary first-letter:mr-0.5"
                              : ""
                          }`}
                        >
                          {para}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        // Regular centered prose view
        <div className="max-w-2xl mx-auto px-8 pt-6 pb-48">
          {/* Loading — streaming */}
          {isLoading && (
            <div>
              <div className="flex items-center gap-2 mb-6">
                <div className="w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                <span className="text-[10px] text-text-dim">
                  {text
                    ? "Writing..."
                    : `Generating prose... ~${sceneScale(scene).estWords.toLocaleString()} words`}
                </span>
              </div>
              {text && (
                <div className="prose-content">
                  {text.split("\n\n").map((paragraph, i) => (
                    <p
                      key={i}
                      className="text-[13px] text-text-secondary leading-[1.8] mb-5 first:first-letter:text-2xl first:first-letter:font-semibold first:first-letter:text-text-primary first:first-letter:mr-0.5"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {hasError && (
            <div className="py-12 text-center">
              <p className="text-[11px] text-red-400/80 mb-3">{error}</p>
              <button
                onClick={() => void generateProse()}
                className="text-[10px] px-4 py-1.5 rounded-full border border-white/10 text-text-dim hover:text-text-secondary transition"
              >
                Retry
              </button>
            </div>
          )}

          {/* Prose display / editor */}
          {hasProse &&
            !isLoading &&
            (isEditing ? (
              <div ref={editorWrapRef}>
                <textarea
                  ref={textareaRef}
                  defaultValue={text}
                  className="w-full min-h-[60vh] bg-transparent border border-white/8 rounded-lg p-4 text-[13px] text-text-secondary leading-[1.8] resize-y outline-none focus:border-white/15 transition-colors"
                  style={{ scrollbarWidth: "thin" }}
                />
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={saveEdit}
                    className="text-[10px] px-3 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15 transition"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="text-[10px] px-3 py-1.5 rounded bg-white/5 border border-white/8 text-text-dim hover:text-text-secondary transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              // Regular prose view
              <div className="prose-content">
                {text.split("\n\n").map((paragraph, i) => (
                  <p
                    key={i}
                    className="text-[13px] text-text-secondary leading-[1.8] mb-5 first:first-letter:text-2xl first:first-letter:font-semibold first:first-letter:text-text-primary first:first-letter:mr-0.5"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            ))}

          {/* Empty state */}
          {!hasProse && !isLoading && !hasError && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              {resolvedPlan ? (
                <>
                  <p className="text-[11px] text-text-dim">
                    This scene hasn&apos;t been written yet.
                  </p>
                  <p className="text-[10px] text-text-dim/40">
                    Use the palette below to generate prose.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-text-dim">
                    Create a plan first, then generate prose.
                  </p>
                  <button
                    onClick={() =>
                      dispatch({ type: "SET_GRAPH_VIEW_MODE", mode: "plan" })
                    }
                    className="text-[10px] text-sky-400/80 hover:text-sky-400 transition"
                  >
                    Switch to Plan &rarr;
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
