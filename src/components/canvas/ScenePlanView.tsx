"use client";

import { IconClose, IconPlus } from "@/components/icons";
import { generateScenePlan, rewriteScenePlan } from "@/lib/ai";
import { useStore } from "@/lib/store";
import type {
  Beat,
  BeatFn,
  BeatMechanism,
  BeatPlan,
  NarrativeState,
  Scene,
} from "@/types/narrative";
import { BEAT_FN_LIST, BEAT_MECHANISM_LIST } from "@/types/narrative";
import { useCallback, useEffect, useState } from "react";

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

  const [planCache, setPlanCache] = useState<{
    plan: BeatPlan | null;
    status: "idle" | "loading" | "ready" | "error";
    error?: string;
  }>(() =>
    scene.plan
      ? { plan: scene.plan, status: "ready" }
      : { plan: null, status: "idle" },
  );
  const [reasoning, setReasoning] = useState("");
  const [meta, setMeta] = useState<{
    targetBeats: number;
    estWords: number;
  } | null>(null);

  // Sync when scene changes
  useEffect(() => {
    setPlanCache(
      scene.plan
        ? { plan: scene.plan, status: "ready" }
        : { plan: null, status: "idle" },
    );
    setReasoning("");
    setMeta(null);
  }, [scene.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const currentPlan = planCache.plan ?? scene.plan;
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
        );
        setPlanCache({ plan, status: "ready" });
        dispatch({
          type: "UPDATE_SCENE",
          sceneId: scene.id,
          updates: { plan },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setPlanCache({ plan: currentPlan, status: "error", error: message });
      }
    },
    [narrative, scene, resolvedKeys, planCache.plan, dispatch],
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
        anchor: "",
      };
      const newBeats = [...activePlan.beats];
      newBeats.splice(afterIdx + 1, 0, newBeat);
      const newPlan: BeatPlan = { ...activePlan, beats: newBeats };
      setPlanCache({ plan: newPlan, status: "ready" });
      dispatch({
        type: "UPDATE_SCENE",
        sceneId: scene.id,
        updates: { plan: newPlan },
      });
    },
    [activePlan, scene.id, dispatch],
  );

  const updateAnchor = useCallback(
    (anchorIdx: number, value: string) => {
      if (!activePlan) return;
      const newAnchors = activePlan.anchors.map((a, i) =>
        i === anchorIdx ? value : a,
      );
      const newPlan: BeatPlan = { ...activePlan, anchors: newAnchors };
      setPlanCache({ plan: newPlan, status: "ready" });
      dispatch({
        type: "UPDATE_SCENE",
        sceneId: scene.id,
        updates: { plan: newPlan },
      });
    },
    [activePlan, scene.id, dispatch],
  );

  const deleteAnchor = useCallback(
    (anchorIdx: number) => {
      if (!activePlan) return;
      const newAnchors = activePlan.anchors.filter((_, i) => i !== anchorIdx);
      const newPlan: BeatPlan = { ...activePlan, anchors: newAnchors };
      setPlanCache({ plan: newPlan, status: "ready" });
      dispatch({
        type: "UPDATE_SCENE",
        sceneId: scene.id,
        updates: { plan: newPlan },
      });
    },
    [activePlan, scene.id, dispatch],
  );

  const addAnchor = useCallback(() => {
    if (!activePlan) return;
    const newPlan: BeatPlan = {
      ...activePlan,
      anchors: [...activePlan.anchors, ""],
    };
    setPlanCache({ plan: newPlan, status: "ready" });
    dispatch({
      type: "UPDATE_SCENE",
      sceneId: scene.id,
      updates: { plan: newPlan },
    });
  }, [activePlan, scene.id, dispatch]);

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
                    key={i}
                    className="group relative flex gap-3 py-2.5 px-1 hover:bg-white/2 rounded-lg transition-colors"
                  >
                    <div className="flex flex-col items-center shrink-0 w-6">
                      <div
                        className="w-2.5 h-2.5 rounded-full border-2 shrink-0"
                        style={{
                          borderColor: FN_COLORS[beat.fn] ?? "#666",
                          backgroundColor: `${FN_COLORS[beat.fn] ?? "#666"}33`,
                        }}
                      />
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
                      <p
                        contentEditable
                        suppressContentEditableWarning
                        className="text-[10px] text-text-dim/60 mt-0.5 italic outline-none focus:bg-white/3 rounded px-1 -mx-1"
                        onBlur={(e) => {
                          const text = e.currentTarget.textContent ?? "";
                          if (text !== beat.anchor)
                            updateBeat(i, { anchor: text });
                        }}
                      >
                        {beat.anchor}
                      </p>
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

            {/* Anchor lines */}
            <div className="mt-2 pt-3 border-t border-white/5">
              <h4 className="text-[9px] uppercase tracking-widest text-amber-400/50 mb-2">
                Anchor Lines
              </h4>
              <div className="space-y-2">
                {activePlan.anchors?.map((a, i) => (
                  <div
                    key={i}
                    className="group/anchor pl-3 border-l-2 border-amber-400/30 flex items-start gap-1"
                  >
                    <p
                      contentEditable
                      suppressContentEditableWarning
                      className="flex-1 text-[11px] text-amber-300/80 leading-relaxed italic outline-none focus:bg-white/3 rounded px-1 -mx-1"
                      onBlur={(e) => {
                        const text = e.currentTarget.textContent ?? "";
                        if (text !== a) updateAnchor(i, text);
                      }}
                    >
                      {a}
                    </p>
                    <button
                      onClick={() => deleteAnchor(i)}
                      className="text-[9px] text-text-dim/20 hover:text-red-400 opacity-0 group-hover/anchor:opacity-100 transition-all shrink-0 mt-0.5"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={addAnchor}
                  className="text-[9px] text-amber-400/30 hover:text-amber-400/60 transition-colors"
                >
                  + Add anchor line
                </button>
              </div>
            </div>

            {activePlan.beats.length === 0 &&
              activePlan.anchors.length === 0 && (
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
    </div>
  );
}
