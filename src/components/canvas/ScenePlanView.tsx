"use client";

import { IconClose, IconPlus } from "@/components/icons";
import { generateScenePlan, rewriteScenePlan } from "@/lib/ai";
import { useResolvedPlan } from "@/hooks/useResolvedScene";
import { useStore } from "@/lib/store";
import type {
  Beat,
  BeatFn,
  BeatMechanism,
  BeatPlan,
  NarrativeState,
  Scene,
  PlanCandidates,
} from "@/types/narrative";
import { BEAT_FN_LIST, BEAT_MECHANISM_LIST } from "@/types/narrative";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlanCandidatesModal } from "./PlanCandidatesModal";
import { usePropositionClassification } from "@/hooks/usePropositionClassification";
import { classificationColor, classificationLabel } from "@/lib/proposition-classify";
import type { ContinuityViolation } from "@/types/narrative";
import { ContinuityCheckModal } from "./ContinuityCheckModal";

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

export function ScenePlanView({
  narrative,
  scene,
  resolvedKeys,
}: {
  narrative: NarrativeState;
  scene: Scene;
  resolvedKeys: string[];
}) {
  const { dispatch } = useStore();
  const { getClassification } = usePropositionClassification();

  // Resolve plan for current branch
  const resolvedPlan = useResolvedPlan(scene);

  const [planCache, setPlanCache] = useState<{
    plan: BeatPlan | null;
    status: "idle" | "loading" | "ready" | "error";
    error?: string;
  }>(() =>
    resolvedPlan
      ? { plan: resolvedPlan, status: "ready" }
      : { plan: null, status: "idle" },
  );
  const [reasoning, setReasoning] = useState("");
  const [meta, setMeta] = useState<{
    targetBeats: number;
    estWords: number;
  } | null>(null);
  const [showCandidates, setShowCandidates] = useState(false);
  const [violations, setViolations] = useState<ContinuityViolation[]>([]);
  const [checkingContinuity, setCheckingContinuity] = useState(false);
  const beatRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Sync when scene or resolved plan changes
  useEffect(() => {
    setPlanCache(
      resolvedPlan
        ? { plan: resolvedPlan, status: "ready" }
        : { plan: null, status: "idle" },
    );
    setReasoning("");
    setMeta(null);
    setViolations([]);
  }, [scene.id, resolvedPlan]);

  // Listen for candidates open event from FloatingPalette
  useEffect(() => {
    const handleOpenCandidates = () => setShowCandidates(true);
    window.addEventListener("canvas:open-candidates", handleOpenCandidates);
    return () => window.removeEventListener("canvas:open-candidates", handleOpenCandidates);
  }, []);

  const [showContinuityModal, setShowContinuityModal] = useState(false);

  // Listen for bulk plan streaming events (from useBulkGenerate)
  useEffect(() => {
    const onStart = (e: Event) => {
      const { sceneId } = (e as CustomEvent).detail;
      if (sceneId !== scene.id) return;
      setPlanCache({ plan: null, status: "loading" });
      setReasoning("");
      setMeta(null);
    };
    const onReasoning = (e: Event) => {
      const { sceneId, token } = (e as CustomEvent).detail;
      if (sceneId !== scene.id) return;
      setReasoning((prev) => prev + token);
    };
    const onComplete = (e: Event) => {
      const { sceneId } = (e as CustomEvent).detail;
      if (sceneId !== scene.id) return;
      setReasoning("");
    };
    window.addEventListener("bulk:plan-start", onStart);
    window.addEventListener("bulk:plan-reasoning", onReasoning);
    window.addEventListener("bulk:plan-complete", onComplete);
    return () => {
      window.removeEventListener("bulk:plan-start", onStart);
      window.removeEventListener("bulk:plan-reasoning", onReasoning);
      window.removeEventListener("bulk:plan-complete", onComplete);
    };
  }, [scene.id]);

  // Listen for continuity check event from FloatingPalette
  useEffect(() => {
    const handleCheckContinuity = () => {
      if (planCache.plan) setShowContinuityModal(true);
    };
    window.addEventListener("canvas:check-continuity", handleCheckContinuity);
    return () => window.removeEventListener("canvas:check-continuity", handleCheckContinuity);
  }, [planCache.plan]);

  // Listen for scroll-to-beat event from search
  useEffect(() => {
    const handleScrollToBeat = (e: Event) => {
      const { beatIndex } = (e as CustomEvent).detail;
      const element = beatRefs.current.get(beatIndex);

      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('ring-2', 'ring-amber-400/50');
        setTimeout(() => {
          element.classList.remove('ring-2', 'ring-amber-400/50');
        }, 1500);
      }
    };

    window.addEventListener('prose:scroll-to-beat', handleScrollToBeat);
    return () => window.removeEventListener('prose:scroll-to-beat', handleScrollToBeat);
  }, []);

  const generatePlan = useCallback(
    async (guidance?: string) => {
      setPlanCache({ plan: null, status: "loading" });
      setReasoning("");
      setMeta(null);
      try {
        const plan = await generateScenePlan(
          narrative,
          scene,
          resolvedKeys,
          (token) => setReasoning((prev) => prev + token),
          (m) => setMeta(m),
          guidance || undefined,
        );
        setPlanCache({ plan, status: "ready" });
        setReasoning("");
        setMeta(null);
        dispatch({
          type: "UPDATE_SCENE",
          sceneId: scene.id,
          updates: { plan },
          versionType: 'generate', // Fresh AI generation creates major version
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setPlanCache({ plan: null, status: "error", error: message });
        setReasoning("");
        setMeta(null);
      }
    },
    [narrative, scene, resolvedKeys, dispatch],
  );

  const rewritePlan = useCallback(
    async (guidance: string) => {
      const currentPlan = planCache.plan ?? resolvedPlan;
      if (!currentPlan) return;
      setPlanCache({ plan: null, status: "loading" });
      setReasoning("");
      try {
        const plan = await rewriteScenePlan(
          narrative,
          scene,
          resolvedKeys,
          currentPlan,
          guidance,
          (token) => setReasoning((prev) => prev + token),
        );
        setPlanCache({ plan, status: "ready" });
        setReasoning("");
        dispatch({
          type: "UPDATE_SCENE",
          sceneId: scene.id,
          updates: { plan },
          versionType: 'rewrite', // AI rewrite creates minor version
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setPlanCache({ plan: currentPlan, status: "error", error: message });
        setReasoning("");
      }
    },
    [narrative, scene, resolvedKeys, planCache.plan, dispatch, resolvedPlan],
  );

  // Listen for palette events
  useEffect(() => {
    function onGenerate(e: Event) {
      const detail = (e as CustomEvent).detail;
      generatePlan(detail?.guidance);
    }
    function onClear() {
      setPlanCache({ plan: null, status: "idle" });
      dispatch({
        type: "UPDATE_SCENE",
        sceneId: scene.id,
        updates: { plan: undefined },
      });
    }
    function onRewrite(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.guidance) rewritePlan(detail.guidance);
    }
    window.addEventListener("canvas:generate-plan", onGenerate);
    window.addEventListener("canvas:clear-plan", onClear);
    window.addEventListener("canvas:rewrite-plan", onRewrite);
    return () => {
      window.removeEventListener("canvas:generate-plan", onGenerate);
      window.removeEventListener("canvas:clear-plan", onClear);
      window.removeEventListener("canvas:rewrite-plan", onRewrite);
    };
  }, [generatePlan, rewritePlan, scene.id, dispatch]);

  const activePlan: BeatPlan | null =
    planCache.plan && Array.isArray(planCache.plan.beats)
      ? planCache.plan
      : null;

  const updateBeat = useCallback(
    (beatIdx: number, updates: Partial<Beat>) => {
      if (!activePlan) return;
      const newBeats = activePlan.beats.map((b, i) =>
        i === beatIdx ? { ...b, ...updates } : b,
      );
      const newPlan: BeatPlan = { ...activePlan, beats: newBeats };
      setPlanCache({ plan: newPlan, status: "ready" });
      dispatch({
        type: "UPDATE_SCENE",
        sceneId: scene.id,
        updates: { plan: newPlan },
        versionType: 'edit', // Manual edit creates sub-minor version
      });
    },
    [activePlan, scene.id, dispatch],
  );

  const deleteBeat = useCallback(
    (beatIdx: number) => {
      if (!activePlan) return;
      const newBeats = activePlan.beats.filter((_, i) => i !== beatIdx);
      const newPlan: BeatPlan = { ...activePlan, beats: newBeats };
      setPlanCache({ plan: newPlan, status: "ready" });
      dispatch({
        type: "UPDATE_SCENE",
        sceneId: scene.id,
        updates: { plan: newPlan },
        versionType: 'edit',
      });
    },
    [activePlan, scene.id, dispatch],
  );

  const insertBeat = useCallback(
    (afterIdx: number) => {
      if (!activePlan) return;
      const newBeat: Beat = {
        fn: "advance",
        mechanism: "action",
        what: "",
        propositions: [],
      };
      const newBeats = [...activePlan.beats];
      newBeats.splice(afterIdx + 1, 0, newBeat);
      const newPlan: BeatPlan = { ...activePlan, beats: newBeats };
      setPlanCache({ plan: newPlan, status: "ready" });
      dispatch({
        type: "UPDATE_SCENE",
        sceneId: scene.id,
        updates: { plan: newPlan },
        versionType: 'edit',
      });
    },
    [activePlan, scene.id, dispatch],
  );

  const addBeatProposition = useCallback(
    (beatIdx: number) => {
      if (!activePlan) return;
      const newBeats = activePlan.beats.map((b, i) =>
        i === beatIdx
          ? { ...b, propositions: [...b.propositions, { content: "" }] }
          : b,
      );
      const newPlan: BeatPlan = { ...activePlan, beats: newBeats };
      setPlanCache({ plan: newPlan, status: "ready" });
      dispatch({
        type: "UPDATE_SCENE",
        sceneId: scene.id,
        updates: { plan: newPlan },
        versionType: 'edit',
      });
    },
    [activePlan, scene.id, dispatch],
  );

  const updateBeatProposition = useCallback(
    (beatIdx: number, propIdx: number, updates: { content?: string; type?: string }) => {
      if (!activePlan) return;
      const newBeats = activePlan.beats.map((b, i) =>
        i === beatIdx
          ? {
              ...b,
              propositions: b.propositions.map((p, j) =>
                j === propIdx ? { ...p, ...updates, type: updates.type?.trim() || undefined } : p,
              ),
            }
          : b,
      );
      const newPlan: BeatPlan = { ...activePlan, beats: newBeats };
      setPlanCache({ plan: newPlan, status: "ready" });
      dispatch({
        type: "UPDATE_SCENE",
        sceneId: scene.id,
        updates: { plan: newPlan },
        versionType: 'edit',
      });
    },
    [activePlan, scene.id, dispatch],
  );

  const deleteBeatProposition = useCallback(
    (beatIdx: number, propIdx: number) => {
      if (!activePlan) return;
      const newBeats = activePlan.beats.map((b, i) =>
        i === beatIdx
          ? { ...b, propositions: b.propositions.filter((_, j) => j !== propIdx) }
          : b,
      );
      const newPlan: BeatPlan = { ...activePlan, beats: newBeats };
      setPlanCache({ plan: newPlan, status: "ready" });
      dispatch({
        type: "UPDATE_SCENE",
        sceneId: scene.id,
        updates: { plan: newPlan },
        versionType: 'edit',
      });
    },
    [activePlan, scene.id, dispatch],
  );

  const addSceneProposition = useCallback(() => {
    if (!activePlan) return;
    const currentProps = activePlan.propositions ?? [];
    const newPlan: BeatPlan = {
      ...activePlan,
      propositions: [...currentProps, { content: "" }],
    };
    setPlanCache({ plan: newPlan, status: "ready" });
    dispatch({
      type: "UPDATE_SCENE",
      sceneId: scene.id,
      updates: { plan: newPlan },
      versionType: 'edit',
    });
  }, [activePlan, scene.id, dispatch]);

  const updateSceneProposition = useCallback(
    (propIdx: number, updates: { content?: string; type?: string }) => {
      if (!activePlan) return;
      const currentProps = activePlan.propositions ?? [];
      const newProps = currentProps.map((p, i) =>
        i === propIdx ? { ...p, ...updates, type: updates.type?.trim() || undefined } : p,
      );
      const newPlan: BeatPlan = { ...activePlan, propositions: newProps };
      setPlanCache({ plan: newPlan, status: "ready" });
      dispatch({
        type: "UPDATE_SCENE",
        sceneId: scene.id,
        updates: { plan: newPlan },
        versionType: 'edit',
      });
    },
    [activePlan, scene.id, dispatch],
  );

  const deleteSceneProposition = useCallback(
    (propIdx: number) => {
      if (!activePlan) return;
      const currentProps = activePlan.propositions ?? [];
      const newProps = currentProps.filter((_, i) => i !== propIdx);
      const newPlan: BeatPlan = {
        ...activePlan,
        propositions: newProps.length > 0 ? newProps : undefined,
      };
      setPlanCache({ plan: newPlan, status: "ready" });
      dispatch({
        type: "UPDATE_SCENE",
        sceneId: scene.id,
        updates: { plan: newPlan },
        versionType: 'edit',
      });
    },
    [activePlan, scene.id, dispatch],
  );

  const handleSelectPlan = useCallback(
    (result: PlanCandidates, candidateId: string) => {
      const candidate = result.candidates.find(c => c.id === candidateId);
      if (!candidate) return;

      const selectedPlan = candidate.plan;
      setPlanCache({ plan: selectedPlan, status: "ready" });
      dispatch({
        type: "UPDATE_SCENE",
        sceneId: scene.id,
        updates: { plan: selectedPlan },
        versionType: 'generate', // Candidates selection is like generation
      });
    },
    [scene.id, dispatch],
  );

  const isLoading = planCache.status === "loading";
  const hasError = planCache.status === "error";

  return (
    <div className="h-full overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      <div className="max-w-2xl mx-auto px-8 pt-6 pb-32">
        {/* Loading */}
        {isLoading && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 border-2 border-sky-400/30 border-t-sky-400/80 rounded-full animate-spin" />
              <span className="text-[10px] text-text-dim">
                Generating plan...
              </span>
              {meta && (
                <span className="text-[10px] text-text-dim/40">
                  {meta.targetBeats} beats &middot; ~
                  {meta.estWords.toLocaleString()} words
                </span>
              )}
            </div>
            {reasoning && (
              <p className="text-[11px] text-text-dim/60 leading-relaxed whitespace-pre-wrap">
                {reasoning}
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {hasError && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <p className="text-[11px] text-red-400/80">{planCache.error}</p>
            <button
              onClick={() => void generatePlan()}
              className="text-[11px] px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-text-secondary hover:text-text-primary hover:bg-white/8 transition"
            >
              Retry
            </button>
          </div>
        )}

        {/* Plan editor */}
        {activePlan && !isLoading && !hasError && (
          <div className="space-y-3">
            {/* Beat timeline */}
            {activePlan.beats.length > 0 && (
              <div className="space-y-0">
                {activePlan.beats.map((beat, i) => (
                  <div
                    ref={(el) => {
                      if (el) beatRefs.current.set(i, el);
                    }}
                    key={i}
                    className="group relative flex gap-3 py-2.5 px-1 hover:bg-white/2 rounded-lg transition-colors"
                  >
                    <div className="flex flex-col items-center shrink-0 w-6">
                      <div
                        className="w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center text-[9px] font-semibold"
                        style={{
                          borderColor: FN_COLORS[beat.fn] ?? "#666",
                          backgroundColor: `${FN_COLORS[beat.fn] ?? "#666"}18`,
                          color: FN_COLORS[beat.fn] ?? "#666",
                        }}
                      >
                        {i + 1}
                      </div>
                      {i < activePlan.beats.length - 1 && (
                        <div className="flex-1 w-px bg-white/8 mt-0.5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 -mt-0.5">
                      <div className="flex items-center gap-2 mb-1">
                        <select
                          value={beat.fn}
                          onChange={(e) =>
                            updateBeat(i, { fn: e.target.value as BeatFn })
                          }
                          className="text-[9px] font-semibold uppercase tracking-wider bg-transparent border-none outline-none cursor-pointer appearance-none pr-3"
                          style={{ color: FN_COLORS[beat.fn] ?? "#666" }}
                        >
                          {BEAT_FN_LIST.map((fn) => (
                            <option
                              key={fn}
                              value={fn}
                              className="bg-bg-panel text-text-primary"
                            >
                              {fn}
                            </option>
                          ))}
                        </select>
                        <select
                          value={beat.mechanism}
                          onChange={(e) =>
                            updateBeat(i, {
                              mechanism: e.target.value as BeatMechanism,
                            })
                          }
                          className="text-[9px] text-text-dim/50 bg-transparent border-none outline-none cursor-pointer appearance-none pr-3"
                        >
                          {BEAT_MECHANISM_LIST.map((m) => (
                            <option
                              key={m}
                              value={m}
                              className="bg-bg-panel text-text-primary"
                            >
                              {(MECH_ICONS[m] ?? "\u2022") + " " + m}
                            </option>
                          ))}
                        </select>
                        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => insertBeat(i)}
                            className="w-5 h-5 flex items-center justify-center rounded hover:bg-emerald-500/15 text-text-dim/40 hover:text-emerald-400 transition-all"
                            title="Insert beat after"
                          >
                            <IconPlus size={10} />
                          </button>
                          <button
                            onClick={() => deleteBeat(i)}
                            className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/15 text-text-dim/40 hover:text-red-400 transition-all"
                            title="Delete beat"
                          >
                            <IconClose size={10} />
                          </button>
                          <span className="text-[8px] text-text-dim/30 font-mono ml-0.5">
                            {i + 1}/{activePlan.beats.length}
                          </span>
                        </div>
                      </div>
                      <p
                        contentEditable
                        suppressContentEditableWarning
                        className="text-[11px] text-text-secondary leading-relaxed outline-none focus:bg-white/3 rounded px-1 -mx-1"
                        onBlur={(e) => {
                          const text = e.currentTarget.textContent ?? "";
                          if (text !== beat.what) updateBeat(i, { what: text });
                        }}
                      >
                        {beat.what}
                      </p>
                      {/* Propositions for this beat */}
                      <div className="mt-1.5 space-y-1.5">
                        {beat.propositions.map((prop, j) => {
                          const cls = getClassification(scene.id, i, j);
                          const profileColor = cls ? classificationColor(cls.base, cls.reach) : undefined;
                          return (
                          <div
                            key={j}
                            className="group/prop flex items-start gap-1.5 rounded-sm pl-1.5"
                            style={profileColor ? {
                              borderLeft: `2px solid ${profileColor}`,
                              backgroundColor: profileColor + '08',
                            } : undefined}
                            title={cls ? `${cls.reach} ${cls.base}\nBackward: ${cls.backward.toFixed(3)}  Forward: ${cls.forward.toFixed(3)}\nReach: ←${cls.backReach.toFixed(0)} →${cls.fwdReach.toFixed(0)} scenes` : undefined}
                          >
                            {cls && (
                              <span
                                className="shrink-0 text-[8px] leading-none font-medium lowercase mt-0.5"
                                style={{ color: profileColor }}
                              >
                                {classificationLabel(cls.base, cls.reach)}
                              </span>
                            )}
                            {violations.some(v => v.beatIndex === i && v.propIndex === j) && (
                              <span
                                className="shrink-0 text-[8px] leading-none font-medium text-red-400 mt-0.5"
                                title={violations.find(v => v.beatIndex === i && v.propIndex === j)?.explanation}
                              >
                                ⚠ violation
                              </span>
                            )}
                            <p
                              contentEditable
                              suppressContentEditableWarning
                              className="flex-1 text-[11px] text-text-secondary/90 italic outline-none focus:bg-white/3 rounded px-1 -mx-1"
                              onBlur={(e) => {
                                const text = e.currentTarget.textContent ?? "";
                                if (text !== prop.content)
                                  updateBeatProposition(i, j, { content: text });
                              }}
                            >
                              {prop.content}
                            </p>
                            <span
                              contentEditable
                              suppressContentEditableWarning
                              className="shrink-0 text-[8px] px-1 py-0.5 rounded bg-white/5 text-text-dim/40 font-mono outline-none focus:bg-white/10 focus:text-text-secondary/80 opacity-0 group-hover/prop:opacity-100 transition-opacity min-w-[2ch] mt-0.5"
                              onBlur={(e) => {
                                const text = e.currentTarget.textContent ?? "";
                                if (text !== (prop.type ?? ""))
                                  updateBeatProposition(i, j, { type: text });
                              }}
                              title="Proposition type"
                            >
                              {prop.type || ""}
                            </span>
                            <button
                              onClick={() => deleteBeatProposition(i, j)}
                              className="text-[9px] text-text-dim/20 hover:text-red-400 opacity-0 group-hover/prop:opacity-100 transition-all shrink-0 mt-0.5"
                            >
                              ✕
                            </button>
                          </div>
                          );
                        })}
                        <button
                          onClick={() => addBeatProposition(i)}
                          className="text-[9px] text-text-dim/30 hover:text-emerald-400/50 transition-colors"
                        >
                          + proposition
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => insertBeat(activePlan.beats.length - 1)}
              className="text-[9px] text-text-dim/40 hover:text-emerald-400/60 transition-colors w-full text-center py-1"
            >
              + Add beat
            </button>

            {/* Scene-level propositions */}
            <div className="mt-2 pt-3 border-t border-white/5">
              <h4 className="text-[9px] uppercase tracking-widest text-amber-400/60 mb-2">
                Scene Propositions
              </h4>
              <div className="space-y-2">
                {activePlan.propositions?.map((p, i) => (
                  <div
                    key={i}
                    className="group/sceneprop pl-3 border-l-2 border-amber-400/40 flex items-start gap-1.5"
                  >
                    <span
                      contentEditable
                      suppressContentEditableWarning
                      className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-300/80 font-mono outline-none focus:bg-amber-400/25 min-w-[2ch]"
                      onBlur={(e) => {
                        const text = e.currentTarget.textContent ?? "";
                        if (text !== (p.type ?? ""))
                          updateSceneProposition(i, { type: text });
                      }}
                      title="Proposition type"
                    >
                      {p.type || ""}
                    </span>
                    <p
                      contentEditable
                      suppressContentEditableWarning
                      className="flex-1 text-[12px] text-amber-200/90 leading-relaxed italic outline-none focus:bg-white/3 rounded px-1 -mx-1"
                      onBlur={(e) => {
                        const text = e.currentTarget.textContent ?? "";
                        if (text !== p.content) updateSceneProposition(i, { content: text });
                      }}
                    >
                      {p.content}
                    </p>
                    <button
                      onClick={() => deleteSceneProposition(i)}
                      className="text-[9px] text-text-dim/20 hover:text-red-400 opacity-0 group-hover/sceneprop:opacity-100 transition-all shrink-0 mt-0.5"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={addSceneProposition}
                  className="text-[9px] text-amber-400/30 hover:text-amber-400/60 transition-colors"
                >
                  + Add scene proposition
                </button>
              </div>
            </div>

            {activePlan.beats.length === 0 &&
              (!activePlan.propositions || activePlan.propositions.length === 0) && (
                <p className="text-[11px] text-text-dim py-8 text-center">
                  Plan is empty.
                </p>
              )}
          </div>
        )}

        {/* Empty state */}
        {!activePlan && !isLoading && !hasError && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <p className="text-[11px] text-text-dim">
              No plan yet for this scene.
            </p>
            <p className="text-[10px] text-text-dim/40">
              Use the palette below to generate one.
            </p>
          </div>
        )}
      </div>

      {/* Plan Candidates Modal */}
      {showCandidates && (
        <PlanCandidatesModal
          narrative={narrative}
          scene={scene}
          resolvedKeys={resolvedKeys}
          onClose={() => setShowCandidates(false)}
          onSelectPlan={handleSelectPlan}
        />
      )}

      {/* Continuity Check Modal */}
      {showContinuityModal && planCache.plan && (
        <ContinuityCheckModal
          narrative={narrative}
          resolvedKeys={resolvedKeys}
          plan={planCache.plan}
          onClose={() => setShowContinuityModal(false)}
          onViolationsFound={(v) => setViolations(v)}
        />
      )}
    </div>
  );
}
