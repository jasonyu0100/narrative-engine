"use client";

/**
 * SceneGameTheoryView — scene-level game-theoretic analysis.
 *
 * Renders the scene as a vertical timeline of NxM decision matrices derived
 * from its beat plan, with analysis prose beside each matrix. Purely additive:
 * reads scene.gameAnalysis, never mutates scene deltas.
 *
 * Generation is controlled from the FloatingPalette (Generate / Clear / Auto),
 * matching the plan/prose pattern. This view listens for palette events.
 */

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { generateSceneGameAnalysis } from "@/lib/ai";
import {
  nashEquilibria,
  outcomeAt,
  realizedIsNash,
  realizedOutcome,
  resolvePlayerName,
  stakeRank,
} from "@/lib/game-theory";
import { GT_TIPS } from "@/lib/game-theory-glossary";
import {
  ACTION_AXIS_LABELS,
  GAME_TYPE_LABELS,
} from "@/types/narrative";
import type {
  BeatGame,
  GameOutcome,
  NarrativeState,
  Scene,
  SceneGameAnalysis,
} from "@/types/narrative";

export function SceneGameTheoryView({
  narrative,
  scene,
}: {
  narrative: NarrativeState;
  scene: Scene;
}) {
  const { state, dispatch } = useStore();
  const analysis = scene.gameAnalysis;
  const [isGenerating, setIsGenerating] = useState(false);
  const [bulkActive, setBulkActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState("");
  const branchId = state.viewState.activeBranchId;

  // Either local Generate or Auto-mode processing this scene counts as streaming.
  const isStreaming = isGenerating || bulkActive;

  // ── Palette events — listen for generate/clear from FloatingPalette ────
  useEffect(() => {
    async function handleGenerate() {
      if (isGenerating) return;
      setIsGenerating(true);
      setError(null);
      setReasoning("");
      try {
        const result = await generateSceneGameAnalysis(
          narrative,
          scene,
          branchId,
          undefined,
          (_token, accumulated) => setReasoning(accumulated),
        );
        dispatch({
          type: "SET_GAME_ANALYSIS",
          sceneId: scene.id,
          analysis: result,
        });
        setReasoning("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsGenerating(false);
      }
    }

    function handleClear() {
      dispatch({ type: "CLEAR_GAME_ANALYSIS", sceneId: scene.id });
      setError(null);
      setReasoning("");
    }

    window.addEventListener("canvas:generate-game", handleGenerate);
    window.addEventListener("canvas:clear-game", handleClear);
    return () => {
      window.removeEventListener("canvas:generate-game", handleGenerate);
      window.removeEventListener("canvas:clear-game", handleClear);
    };
  }, [narrative, scene, branchId, dispatch, isGenerating]);

  // Clear local error/reasoning when scene changes
  useEffect(() => {
    setError(null);
    setReasoning("");
    setBulkActive(false);
  }, [scene.id]);

  // ── Auto-mode (bulk) streaming — mirror the plan/prose pattern ────────
  // When auto mode analyses this scene, surface the same reasoning stream
  // even though generation was triggered from outside this component.
  useEffect(() => {
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sceneId: string };
      if (detail?.sceneId !== scene.id) return;
      setBulkActive(true);
      setReasoning("");
      setError(null);
    };
    const onReasoning = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sceneId: string; token: string };
      if (detail?.sceneId !== scene.id) return;
      setReasoning((prev) => prev + (detail.token ?? ""));
    };
    const onComplete = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sceneId: string };
      if (detail?.sceneId !== scene.id) return;
      setBulkActive(false);
      setReasoning("");
    };
    window.addEventListener("bulk:game-start", onStart);
    window.addEventListener("bulk:game-reasoning", onReasoning);
    window.addEventListener("bulk:game-complete", onComplete);
    return () => {
      window.removeEventListener("bulk:game-start", onStart);
      window.removeEventListener("bulk:game-reasoning", onReasoning);
      window.removeEventListener("bulk:game-complete", onComplete);
    };
  }, [scene.id]);

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="w-full px-10 py-10">
        {isStreaming && !analysis && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 border-2 border-sky-400/30 border-t-sky-400/80 rounded-full animate-spin" />
              <span className="text-[10px] text-text-dim">
                {bulkActive ? "Auto-analysing games..." : "Analysing games..."}
              </span>
            </div>
            {reasoning && (
              <p className="text-[12px] text-text-dim/80 leading-relaxed whitespace-pre-wrap">
                {reasoning}
              </p>
            )}
          </div>
        )}

        {isStreaming && analysis && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 border-2 border-sky-400/30 border-t-sky-400/80 rounded-full animate-spin" />
              <span className="text-[10px] text-text-dim">
                {bulkActive ? "Auto re-analysing..." : "Re-analysing..."}
              </span>
            </div>
            {reasoning && (
              <p className="text-[12px] text-text-dim/80 leading-relaxed whitespace-pre-wrap">
                {reasoning}
              </p>
            )}
          </div>
        )}

        {!analysis && !isStreaming && !error && <EmptyState />}

        {error && !isStreaming && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <p className="text-[12px] text-red-400/80">
              Analysis failed.
            </p>
            <p className="text-[10px] text-text-dim/75 max-w-md text-center leading-relaxed">
              {error}
            </p>
            <p className="text-[10px] text-text-dim/65">
              Use the palette below to retry.
            </p>
          </div>
        )}

        {analysis && <AnalysisTimeline analysis={analysis} narrative={narrative} regenerating={isStreaming} />}
      </div>
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <p className="text-[12px] text-text-dim">
        No game analysis yet for this scene.
      </p>
      <p className="text-[10px] text-text-dim/65">
        Use the palette below to generate one.
      </p>
    </div>
  );
}

// ── Timeline — vertical sequence of matrices with analysis prose beside ────

function AnalysisTimeline({
  analysis,
  narrative,
  regenerating,
}: {
  analysis: SceneGameAnalysis;
  narrative: NarrativeState;
  regenerating: boolean;
}) {
  // Wrap each stored game with freshly-resolved player names so the timeline
  // always shows the current entity display names rather than the snapshot
  // taken at analysis time. Falls back to the stored name if the entity has
  // been deleted since.
  const games = analysis.games.map<BeatGame>((g) => ({
    ...g,
    playerAName: resolvePlayerName(narrative, g.playerAId, g.playerAName),
    playerBName: resolvePlayerName(narrative, g.playerBId, g.playerBName),
  }));
  return (
    <div>
      {/* Header */}
      <div className="border-b border-white/8 pb-4 mb-8">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[12px] uppercase tracking-[0.2em] text-text-dim/80 font-semibold">
            strategic decomposition
          </span>
          {regenerating && (
            <span className="text-[12px] text-sky-400/70 animate-pulse">
              regenerating…
            </span>
          )}
          <span className="text-[12px] text-text-dim/65 ml-auto tabular-nums">
            {games.length} {games.length === 1 ? "decision" : "decisions"}
          </span>
        </div>
        {analysis.summary && (
          <p className="text-[13px] text-text-secondary leading-relaxed">
            {analysis.summary}
          </p>
        )}
      </div>

      {/* Empty timeline */}
      {games.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <p className="text-[12px] text-text-dim/80">
            No decision beats found in this scene.
          </p>
          <p className="text-[10px] text-text-dim/65 max-w-md text-center leading-relaxed">
            Strategic analysis looks for beats where participants make meaningful
            choices. This scene's beats may be pure atmosphere or exposition.
          </p>
        </div>
      )}

      {/* Vertical timeline — entries stack directly with internal pb so the
          spine drawn inside each entry reaches the next node without a gap. */}
      <div className="flex flex-col">
        {games.map((game, i) => (
          <TimelineEntry
            key={`${game.beatIndex}-${i}`}
            game={game}
            index={i}
            isLast={i === games.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

// ── Single timeline entry: matrix on the left, analysis on the right ───────

function TimelineEntry({
  game,
  index,
  isLast,
}: {
  game: BeatGame;
  index: number;
  isLast: boolean;
}) {
  const cols = game.playerBActions.length;
  // Matrix width scales with column count so big grids stay legible.
  const matrixWidthPx = Math.max(420, 140 + cols * 150);

  return (
    <div className={`relative flex gap-6 ${isLast ? "" : "pb-10"}`}>
      {!isLast && (
        <div className="absolute left-[13.5px] top-8 bottom-0 w-px bg-gradient-to-b from-white/15 to-white/5" />
      )}

      {/* Marker + index */}
      <div className="shrink-0 flex flex-col items-start pt-1">
        <div className="relative w-7 h-7 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border border-white/25" />
          <span className="relative text-[12px] font-mono font-semibold text-text-secondary">
            {index + 1}
          </span>
        </div>
      </div>

      {/* Entry body: matrix + analysis. Analysis is vertically centered
          relative to the matrix so big grids stay legible beside short
          analysis blocks. */}
      <div className="flex-1 flex gap-10 min-w-0 items-center">
        {/* Matrix — scales with menu size */}
        <div className="shrink-0" style={{ width: matrixWidthPx }}>
          <MatrixBoard game={game} />
        </div>

        {/* Analysis prose */}
        <div className="flex-1 min-w-0 max-w-2xl flex flex-col gap-3">
          <PlayersHeader game={game} />

          {/* Subtitle: beat index + game type + axis (hover for dichotomy) */}
          <div className="flex items-center gap-2 -mt-1 flex-wrap">
            <span className="text-[12px] uppercase tracking-wider text-text-dim/75">
              beat {game.beatIndex + 1}
            </span>
            <span className="text-text-dim/20">·</span>
            <span
              className="text-[11px] font-mono font-medium text-sky-300/90 bg-sky-400/10 px-1.5 py-px rounded"
              title={GAME_TYPE_LABELS[game.gameType] ?? ""}
            >
              {game.gameType}
            </span>
            <span
              className="text-[11px] font-mono font-medium text-text-dim/75 bg-white/5 px-1.5 py-px rounded"
              title={ACTION_AXIS_LABELS[game.actionAxis] ?? ""}
            >
              {game.actionAxis}
            </span>
          </div>

          {/* One-line copy explaining the strategic frame — names live in the
              pills above; only the descriptions go here to avoid repetition. */}
          <p className="text-[11px] text-text-dim/65 leading-snug -mt-2">
            <span>{GAME_TYPE_LABELS[game.gameType] ?? ""}</span>
            <span className="text-text-dim/30"> · </span>
            <span>{ACTION_AXIS_LABELS[game.actionAxis] ?? game.actionAxis}</span>
          </p>

          {game.beatExcerpt && (
            <p className="text-[12px] text-text-secondary leading-relaxed italic">
              {game.beatExcerpt}
            </p>
          )}

          {game.rationale && (
            <div title={GT_TIPS.rationaleRealized}>
              <div className="text-[12px] uppercase tracking-wider text-text-dim/80 font-semibold mb-1">
                why the author picked this cell
              </div>
              <p className="text-[12px] text-text-secondary leading-relaxed">
                {game.rationale}
              </p>
            </div>
          )}

          <StrategicShape game={game} />
        </div>
      </div>
    </div>
  );
}

function PlayersHeader({ game }: { game: BeatGame }) {
  const cell = realizedOutcome(game);
  const deltaA = cell?.stakeDeltaA ?? 0;
  const deltaB = cell?.stakeDeltaB ?? 0;
  const aWins = deltaA > deltaB;
  const bWins = deltaB > deltaA;

  const nameClass = (winner: boolean, loser: boolean): string => {
    if (winner) return "text-emerald-300";
    if (loser) return "text-red-400/80";
    return "text-text-secondary";
  };

  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  return (
    <div className="flex items-baseline gap-2 text-[13px]">
      <PlayerLink
        id={game.playerAId}
        name={game.playerAName}
        className={`font-semibold ${nameClass(aWins, bWins)}`}
      />
      <span
        className="font-mono text-[12px] text-text-dim/80 tabular-nums"
        title={GT_TIPS.stakeDeltaPair}
      >
        {fmt(deltaA)}&nbsp;/&nbsp;{fmt(deltaB)}
      </span>
      <PlayerLink
        id={game.playerBId}
        name={game.playerBName}
        className={`font-semibold ${nameClass(bWins, aWins)}`}
      />
    </div>
  );
}

/**
 * Clickable player name — opens the entity in the inspector panel.
 * Resolves kind (character/location/artifact) from the narrative registry;
 * falls back to plain text if the entity isn't in the registry (deleted).
 */
function PlayerLink({
  id,
  name,
  className,
}: {
  id: string;
  name: string;
  className?: string;
}) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  const context = useMemo(() => {
    if (!narrative) return null;
    if (narrative.characters[id]) return { type: "character" as const, characterId: id };
    if (narrative.locations[id]) return { type: "location" as const, locationId: id };
    if (narrative.artifacts[id]) return { type: "artifact" as const, artifactId: id };
    return null;
  }, [narrative, id]);

  if (!context) {
    // Entity deleted or phantom — render as plain text, not a button
    return <span className={className}>{name}</span>;
  }

  return (
    <button
      type="button"
      onClick={() => dispatch({ type: "SET_INSPECTOR", context })}
      className={`${className ?? ""} hover:underline underline-offset-[3px] decoration-1 cursor-pointer`}
      title={`Open ${name} in inspector`}
    >
      {name}
    </button>
  );
}

// ── Strategic shape — Nash count + realized-rank per player ────────────────
// Descriptive only. The realized cell can be off-Nash or low-rank; that is
// signal, not error — it's the author trading stake for arc.

function StrategicShape({ game }: { game: BeatGame }) {
  const ne = useMemo(() => nashEquilibria(game), [game]);
  const isRealizedNash = realizedIsNash(game);
  const rankA = stakeRank(game, "A");
  const rankB = stakeRank(game, "B");

  return (
    <div>
      <div className="text-[12px] uppercase tracking-wider text-text-dim/80 font-semibold mb-1.5">
        strategic shape
      </div>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {ne.length > 0 ? (
          <span
            className="text-[11px] px-1.5 py-0.5 rounded bg-sky-400/15 text-sky-300 font-mono uppercase"
            title={GT_TIPS.nashEquilibrium}
          >
            {ne.length === 1 ? "1 nash" : `${ne.length} nash`}
          </span>
        ) : (
          <span
            className="text-[11px] px-1.5 py-0.5 rounded bg-white/5 text-text-dim/75 font-mono uppercase"
            title={GT_TIPS.noPureNash}
          >
            no pure nash
          </span>
        )}
        {isRealizedNash && (
          <span
            className="text-[11px] px-1.5 py-0.5 rounded bg-sky-400/10 text-sky-300 border border-sky-400/20"
            title={GT_TIPS.realizedEqNash}
          >
            realized ≡ nash
          </span>
        )}
        {!isRealizedNash && ne.length > 0 && (
          <span
            className="text-[11px] px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-300/80 border border-amber-400/20"
            title={GT_TIPS.offNash}
          >
            off-nash cell
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 text-[12px] text-text-dim/85">
        {rankA && (
          <div title={GT_TIPS.stakeRank}>
            <PlayerLink id={game.playerAId} name={game.playerAName} className="text-white font-medium" />
            <span className="text-text-dim/75">: realized is rank {rankA.rank}/{rankA.total} by stake</span>
          </div>
        )}
        {rankB && (
          <div title={GT_TIPS.stakeRank}>
            <PlayerLink id={game.playerBId} name={game.playerBName} className="text-sky-200 font-medium" />
            <span className="text-text-dim/75">: realized is rank {rankB.rank}/{rankB.total} by stake</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Matrix board — dynamic NxM grid ────────────────────────────────────────

function MatrixBoard({ game }: { game: BeatGame }) {
  const nash = useMemo(() => {
    const set = new Set<string>();
    for (const p of nashEquilibria(game)) {
      set.add(`${p.aActionName}::${p.bActionName}`);
    }
    return set;
  }, [game]);

  return (
    <table
      className="border-collapse w-full rounded-lg overflow-hidden"
      style={{ borderSpacing: 0 }}
    >
      <thead>
        <tr>
          {/* Diagonal corner cell: B top-right, A bottom-left */}
          <th className="relative px-3 py-3 w-24 overflow-hidden">
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "linear-gradient(to top right, transparent calc(50% - 0.5px), rgba(255,255,255,0.10) calc(50% - 0.5px), rgba(255,255,255,0.10) calc(50% + 0.5px), transparent calc(50% + 0.5px))",
              }}
            />
            <div className="relative flex flex-col items-end gap-2">
              <PlayerLink
                id={game.playerBId}
                name={game.playerBName}
                className="text-[12px] font-medium text-text-primary"
              />
              <div className="self-start">
                <PlayerLink
                  id={game.playerAId}
                  name={game.playerAName}
                  className="text-[12px] font-medium text-text-secondary"
                />
              </div>
            </div>
          </th>
          {game.playerBActions.map((action, i) => (
            <th key={`bh-${i}`} className="px-3 py-2 text-center">
              <AxisLabel text={action.name} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {game.playerAActions.map((aAction, aIdx) => (
          <tr key={`row-${aIdx}`}>
            <th className="px-2 py-2 text-right align-middle">
              <AxisLabel text={aAction.name} align="right" />
            </th>
            {game.playerBActions.map((bAction, bIdx) => {
              const outcome = outcomeAt(game, aAction.name, bAction.name);
              const key = `${aAction.name}::${bAction.name}`;
              const isNash = nash.has(key);
              const isRealized =
                aAction.name === game.realizedAAction &&
                bAction.name === game.realizedBAction;
              return (
                <Cell
                  key={`cell-${aIdx}-${bIdx}`}
                  outcome={outcome}
                  isNash={isNash}
                  isRealized={isRealized}
                />
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AxisLabel({
  text,
  align = "center",
}: {
  text: string;
  align?: "center" | "right";
}) {
  const justify = align === "right" ? "text-right" : "text-center";
  return (
    <div className={`text-[10px] text-text-primary leading-snug ${justify}`}>
      {text}
    </div>
  );
}

function Cell({
  outcome,
  isNash,
  isRealized,
}: {
  outcome: GameOutcome | null;
  isNash: boolean;
  isRealized: boolean;
}) {
  const cellBg = isRealized
    ? "bg-amber-400/10 ring-1 ring-inset ring-amber-400/40"
    : "bg-white/2";

  if (!outcome) {
    return (
      <td className={`relative px-4 py-4 align-top h-32 border-l border-t border-white/10 ${cellBg}`}>
        <p className="text-[11px] text-text-dim/50 italic">(outcome missing)</p>
      </td>
    );
  }

  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const deltaColor = (n: number) => {
    if (n > 0) return "text-emerald-300";
    if (n < 0) return "text-red-400/80";
    return "text-text-dim/70";
  };

  return (
    <td className={`relative px-4 py-4 align-top h-32 border-l border-t border-white/10 ${cellBg}`}>
      <div className="absolute top-1.5 right-1.5 flex gap-1">
        {isNash && (
          <span
            className="text-[10px] font-semibold px-1 py-px rounded bg-sky-400/20 text-sky-200 uppercase tracking-wider"
            title={GT_TIPS.nashCell}
          >
            nash
          </span>
        )}
        {isRealized && (
          <span
            className="text-[10px] font-semibold px-1 py-px rounded bg-amber-400/25 text-amber-200 uppercase tracking-wider"
            title={GT_TIPS.realizedCell}
          >
            realized
          </span>
        )}
      </div>

      {/* Stake deltas — signed, colored by sign. A first, B second. */}
      <div
        className="flex items-baseline gap-1.5 mb-1.5"
        title={GT_TIPS.stakeDeltaPair}
      >
        <span className={`text-[16px] font-mono font-bold leading-none tabular-nums ${deltaColor(outcome.stakeDeltaA)}`}>
          {fmt(outcome.stakeDeltaA)}
        </span>
        <span className="text-[12px] font-mono text-text-dim/65 leading-none">/</span>
        <span className={`text-[16px] font-mono font-bold leading-none tabular-nums ${deltaColor(outcome.stakeDeltaB)}`}>
          {fmt(outcome.stakeDeltaB)}
        </span>
      </div>
      <p className="text-[12px] text-text-dim/85 leading-snug">{outcome.description}</p>
    </td>
  );
}
