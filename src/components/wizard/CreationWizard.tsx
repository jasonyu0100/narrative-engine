"use client";

import { generateNarrative, suggestPremise } from "@/lib/ai";
import { useStore } from "@/lib/store";
import { useWizard } from "@/lib/wizard-context";
import type {
  CharacterSketch,
  LocationSketch,
  ThreadSketch,
} from "@/types/narrative";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const ROLES: CharacterSketch["role"][] = ["anchor", "recurring", "transient"];

export function CreationWizard() {
  const router = useRouter();
  const { state, dispatch } = useStore();
  const { state: wizardState, dispatch: wizardDispatch } = useWizard();
  const wd = wizardState.data;
  const isGenerating = wizardState.step === "generate";
  const isDetails = wizardState.step === "details";

  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const started = useRef(false);

  const isDuplicate =
    wd.title.trim() !== "" &&
    state.narratives.some(
      (n) => n.title.toLowerCase() === wd.title.trim().toLowerCase(),
    );

  const canGenerate = !!wd.title.trim() && !!wd.premise.trim() && !isDuplicate;

  function update(data: Partial<typeof wd>) {
    wizardDispatch({ type: "UPDATE_DATA", data });
  }

  // ── Characters ───────────────────────────────────────────────────────
  function addCharacter() {
    update({
      characters: [
        ...wd.characters,
        { name: "", role: "recurring", description: "" },
      ],
    });
  }
  function updateCharacter(i: number, patch: Partial<CharacterSketch>) {
    const chars = [...wd.characters];
    chars[i] = { ...chars[i], ...patch };
    update({ characters: chars });
  }
  function removeCharacter(i: number) {
    update({ characters: wd.characters.filter((_, idx) => idx !== i) });
  }

  // ── Locations ────────────────────────────────────────────────────────
  function addLocation() {
    update({ locations: [...wd.locations, { name: "", description: "" }] });
  }
  function updateLocation(i: number, patch: Partial<LocationSketch>) {
    const locs = [...wd.locations];
    locs[i] = { ...locs[i], ...patch };
    update({ locations: locs });
  }
  function removeLocation(i: number) {
    update({ locations: wd.locations.filter((_, idx) => idx !== i) });
  }

  // ── Threads ─────────────────────────────────────────────────────────
  function addThread() {
    update({
      threads: [...wd.threads, { description: "", participantNames: [] }],
    });
  }
  function updateThread(i: number, patch: Partial<ThreadSketch>) {
    const t = [...wd.threads];
    t[i] = { ...t[i], ...patch };
    update({ threads: t });
  }
  function removeThread(i: number) {
    update({ threads: wd.threads.filter((_, idx) => idx !== i) });
  }

  // ── Suggest ──────────────────────────────────────────────────────────
  async function handleSuggest() {
    if (suggesting) return;
    setSuggesting(true);
    try {
      const data = await suggestPremise();
      if (data.title || data.premise) {
        update({ title: data.title ?? "", premise: data.premise ?? "" });
      }
    } catch {
      // logged by callGenerate
    } finally {
      setSuggesting(false);
    }
  }

  // ── Generate ─────────────────────────────────────────────────────────
  function buildEnhancedPremise() {
    const parts: string[] = [wd.premise];
    const details: string[] = [];

    if (wd.characters.length > 0) {
      const charLines = wd.characters
        .filter((c) => c.name.trim())
        .map(
          (c) =>
            `  - ${c.name} (${c.role})${c.description ? `: ${c.description}` : ""}`,
        );
      if (charLines.length > 0) {
        details.push(`Key characters:\n${charLines.join("\n")}`);
      }
    }

    if (wd.locations.length > 0) {
      const locLines = wd.locations
        .filter((l) => l.name.trim())
        .map(
          (l) => `  - ${l.name}${l.description ? `: ${l.description}` : ""}`,
        );
      if (locLines.length > 0) {
        details.push(`Key locations:\n${locLines.join("\n")}`);
      }
    }

    if (wd.threads.length > 0) {
      const threadLines = wd.threads
        .filter((t) => t.description.trim())
        .map(
          (t) =>
            `  - ${t.description}${t.participantNames.length > 0 ? ` (involves: ${t.participantNames.join(", ")})` : ""}`,
        );
      if (threadLines.length > 0) {
        details.push(`Narrative threads:\n${threadLines.join("\n")}`);
      }
    }

    if (details.length > 0) {
      parts.push("", ...details);
    }

    return parts.join("\n");
  }

  async function handleGenerate() {
    if (loading) return;
    setLoading(true);
    setStreamText("");
    setError("");
    try {
      const narrative = await generateNarrative(
        wd.title,
        buildEnhancedPremise(),
        (reasoning) => setStreamText((prev) => prev + reasoning),
        wd.worldOnly ?? false,
      );
      dispatch({ type: "ADD_NARRATIVE", narrative });
      router.push(`/series/${narrative.id}`);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  }

  // Auto-start generation when stepping to generate
  useEffect(() => {
    if (isGenerating && !started.current) {
      started.current = true;
      handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating]);

  if (!wizardState.isOpen) return null;

  // ── Generate view ────────────────────────────────────────────────────
  if (isGenerating) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
        <div className="glass max-w-2xl w-full rounded-2xl p-6 relative">
          <div className="flex flex-col gap-5">
            {loading ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <h2 className="text-sm font-semibold text-text-primary">
                    Generating world&hellip;
                  </h2>
                </div>
                {streamText ? (
                  <pre className="text-[11px] text-text-dim font-mono whitespace-pre-wrap max-h-72 overflow-y-auto bg-white/3 rounded-lg p-3 leading-relaxed">
                    {streamText}
                  </pre>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="h-3 w-3/4 bg-white/6 rounded animate-pulse" />
                    <div className="h-3 w-1/2 bg-white/6 rounded animate-pulse" />
                    <div className="h-3 w-5/6 bg-white/6 rounded animate-pulse" />
                  </div>
                )}
              </div>
            ) : (
              <h2 className="text-sm font-semibold text-text-primary">
                Generation failed
              </h2>
            )}

            {error && (
              <div className="bg-fate/10 border border-fate/30 rounded-lg px-3 py-2">
                <p className="text-xs text-fate/80 mt-1">{error}</p>
              </div>
            )}

            <div className="flex items-center justify-between mt-1">
              <button
                onClick={() => {
                  started.current = false;
                  wizardDispatch({ type: "SET_STEP", step: "form" });
                }}
                disabled={loading}
                className="text-text-dim text-xs hover:text-text-secondary transition disabled:opacity-30 disabled:pointer-events-none"
              >
                &larr; Back
              </button>
              {error && (
                <button
                  onClick={handleGenerate}
                  className="bg-white/8 hover:bg-white/12 text-text-primary text-xs font-semibold px-5 py-2 rounded-lg transition"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 2: Details view ───────────────────────────────────────────
  if (isDetails) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
        <div className="glass max-w-2xl w-full rounded-2xl p-6 relative">
          <button
            onClick={() => wizardDispatch({ type: "CLOSE" })}
            className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none"
          >
            &times;
          </button>

          <div className="flex flex-col gap-5 max-h-[75vh] overflow-y-auto pr-1">
            {/* Header */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono text-text-dim">
                  Step 2 of 2
                </span>
              </div>
              <h2 className="text-sm font-semibold text-text-primary mb-1">
                Details (Optional)
              </h2>
              <p className="text-[11px] text-text-dim">
                Add characters, locations, threads, rules, or systems — or skip
                and let the AI fill in everything.
              </p>
            </div>

            {/* Character Sketches */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">
                  Characters
                </label>
                <button
                  type="button"
                  onClick={addCharacter}
                  className="text-[10px] text-text-dim hover:text-text-secondary transition"
                >
                  + Add
                </button>
              </div>
              {wd.characters.length === 0 && (
                <p className="text-[11px] text-text-dim/60 italic">
                  No characters defined — the AI will create them from the
                  premise.
                </p>
              )}
              <div className="flex flex-col gap-2">
                {wd.characters.map((ch, i) => (
                  <div
                    key={i}
                    className="flex gap-2 items-start bg-bg-elevated rounded-lg p-2.5 border border-border"
                  >
                    <div className="flex-1 flex flex-col gap-1.5">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={ch.name}
                          onChange={(e) =>
                            updateCharacter(i, { name: e.target.value })
                          }
                          placeholder="Name"
                          className="flex-1 bg-transparent border-b border-border text-xs text-text-primary outline-none placeholder:text-text-dim focus:border-white/20 transition pb-0.5"
                        />
                        <select
                          value={ch.role}
                          onChange={(e) =>
                            updateCharacter(i, {
                              role: e.target.value as CharacterSketch["role"],
                            })
                          }
                          className="bg-transparent border-b border-border text-[10px] text-text-dim outline-none pb-0.5"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </div>
                      <input
                        type="text"
                        value={ch.description}
                        onChange={(e) =>
                          updateCharacter(i, { description: e.target.value })
                        }
                        placeholder="Brief description, goals, or traits..."
                        className="bg-transparent border-b border-border text-[10px] text-text-dim outline-none placeholder:text-text-dim/60 focus:border-white/20 transition pb-0.5"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeCharacter(i)}
                      className="text-text-dim hover:text-text-secondary text-xs mt-0.5"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Location Sketches */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">
                  Locations
                </label>
                <button
                  type="button"
                  onClick={addLocation}
                  className="text-[10px] text-text-dim hover:text-text-secondary transition"
                >
                  + Add
                </button>
              </div>
              {wd.locations.length === 0 && (
                <p className="text-[11px] text-text-dim/60 italic">
                  No locations defined — the AI will create them from the
                  premise.
                </p>
              )}
              <div className="flex flex-col gap-2">
                {wd.locations.map((loc, i) => (
                  <div
                    key={i}
                    className="flex gap-2 items-start bg-bg-elevated rounded-lg p-2.5 border border-border"
                  >
                    <div className="flex-1 flex flex-col gap-1.5">
                      <input
                        type="text"
                        value={loc.name}
                        onChange={(e) =>
                          updateLocation(i, { name: e.target.value })
                        }
                        placeholder="Location name"
                        className="flex-1 bg-transparent border-b border-border text-xs text-text-primary outline-none placeholder:text-text-dim focus:border-white/20 transition pb-0.5"
                      />
                      <input
                        type="text"
                        value={loc.description}
                        onChange={(e) =>
                          updateLocation(i, { description: e.target.value })
                        }
                        placeholder="Description, atmosphere, significance..."
                        className="bg-transparent border-b border-border text-[10px] text-text-dim outline-none placeholder:text-text-dim/60 focus:border-white/20 transition pb-0.5"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLocation(i)}
                      className="text-text-dim hover:text-text-secondary text-xs mt-0.5"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Threads */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">
                  Threads
                </label>
                <button
                  type="button"
                  onClick={addThread}
                  className="text-[10px] text-text-dim hover:text-text-secondary transition"
                >
                  + Add
                </button>
              </div>
              {wd.threads.length === 0 && (
                <p className="text-[11px] text-text-dim/60 italic">
                  No threads defined — the AI will generate narrative tensions
                  from the premise.
                </p>
              )}
              <div className="flex flex-col gap-2">
                {wd.threads.map((th, i) => (
                  <div
                    key={i}
                    className="flex gap-2 items-start bg-bg-elevated rounded-lg p-2.5 border border-border"
                  >
                    <div className="flex-1 flex flex-col gap-1.5">
                      <input
                        type="text"
                        value={th.description}
                        onChange={(e) =>
                          updateThread(i, { description: e.target.value })
                        }
                        placeholder="Describe the tension, conflict, or open question..."
                        className="flex-1 bg-transparent border-b border-border text-xs text-text-primary outline-none placeholder:text-text-dim focus:border-white/20 transition pb-0.5"
                      />
                      <input
                        type="text"
                        value={th.participantNames.join(", ")}
                        onChange={(e) =>
                          updateThread(i, {
                            participantNames: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="Participants (comma-separated names)..."
                        className="bg-transparent border-b border-border text-[10px] text-text-dim outline-none placeholder:text-text-dim/60 focus:border-white/20 transition pb-0.5"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeThread(i)}
                      className="text-text-dim hover:text-text-secondary text-xs mt-0.5"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* World-only toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                checked={wd.worldOnly ?? false}
                onChange={(e) => update({ worldOnly: e.target.checked })}
                className="accent-emerald-400 w-3.5 h-3.5"
              />
              <span className="text-xs text-text-dim">
                World only — skip introduction arc
                <span className="ml-1 text-text-dim/60">
                  (use premise as story plan, generate entities only)
                </span>
              </span>
            </label>

            {/* Navigation */}
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() =>
                  wizardDispatch({ type: "SET_STEP", step: "form" })
                }
                className="text-text-dim text-xs hover:text-text-secondary transition"
              >
                &larr; Back
              </button>
              <button
                onClick={() =>
                  wizardDispatch({ type: "SET_STEP", step: "generate" })
                }
                className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-semibold px-5 py-2 rounded-lg transition"
              >
                Generate
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 1: Title & Premise ────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="glass max-w-2xl w-full rounded-2xl p-6 relative">
        <button
          onClick={() => wizardDispatch({ type: "CLOSE" })}
          className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none"
        >
          &times;
        </button>

        <div className="flex flex-col gap-5 max-h-[75vh] overflow-y-auto pr-1">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono text-text-dim">
                Step 1 of 2
              </span>
            </div>
            <h2 className="text-sm font-semibold text-text-primary mb-1">
              New Series
            </h2>
            <p className="text-[11px] text-text-dim">
              Give your series a title and describe the premise.
            </p>
          </div>

          {/* Title */}
          <div>
            <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">
              Title
            </label>
            <input
              type="text"
              value={wd.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="e.g. The Gilded Cage"
              className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full outline-none placeholder:text-text-dim focus:border-white/16 transition"
            />
            {isDuplicate && (
              <p className="text-[11px] text-fate mt-1">
                A series with this name already exists.
              </p>
            )}
          </div>

          {/* Premise */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">
                Premise
              </label>
              <button
                type="button"
                onClick={handleSuggest}
                disabled={suggesting}
                className="text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
              >
                {suggesting ? "Thinking..." : "Suggest"}
              </button>
            </div>
            <textarea
              value={wd.premise}
              onChange={(e) => update({ premise: e.target.value })}
              placeholder="Describe your world, characters, and the central conflict..."
              className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-28 resize-none outline-none placeholder:text-text-dim focus:border-white/16 transition"
            />
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() =>
                wizardDispatch({ type: "SET_STEP", step: "details" })
              }
              disabled={!canGenerate}
              className="text-text-dim text-xs hover:text-text-secondary transition disabled:opacity-30 disabled:pointer-events-none"
            >
              Add details &rarr;
            </button>
            <button
              onClick={() =>
                wizardDispatch({ type: "SET_STEP", step: "generate" })
              }
              disabled={!canGenerate}
              className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-semibold px-5 py-2 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none"
            >
              Generate
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
