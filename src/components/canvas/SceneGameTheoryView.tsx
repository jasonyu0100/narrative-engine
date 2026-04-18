"use client";

/**
 * SceneGameTheoryView — scene-level game-theoretic analysis.
 *
 * Renders the scene as a vertical timeline of 2×2 decision matrices derived
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
  aBestResponseKeys,
  aBestResponseTo,
  bBestResponseKeys,
  bBestResponseTo,
  nashEquilibria,
  dominantStrategy,
  classifyGame,
  outcomeKeyFor,
  playedKey,
  playedOutcome,
  resolvePlayerName,
} from "@/lib/game-theory";
import type {
  BeatGame,
  NarrativeState,
  OutcomeKey,
  PlayerMove,
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
  return (
    <div className={`relative flex gap-6 ${isLast ? "" : "pb-10"}`}>
      {/* Timeline spine — continuous vertical line. Starts just below the
          node marker, extends to the bottom of the entry (inside pb) so it
          reaches the next node without a visual break. */}
      {!isLast && (
        <div className="absolute left-[13.5px] top-8 bottom-0 w-px bg-gradient-to-b from-white/15 to-white/5" />
      )}

      {/* Marker + index — clean ring on spine, not a heavy filled circle */}
      <div className="shrink-0 flex flex-col items-start pt-1">
        <div className="relative w-7 h-7 flex items-center justify-center">
          {/* Thin ring outline, hollow centre lets the bg show through */}
          <div className="absolute inset-0 rounded-full border border-white/25" />
          <span className="relative text-[12px] font-mono font-semibold text-text-secondary">
            {index + 1}
          </span>
        </div>
      </div>

      {/* Entry body: matrix + analysis. Matrix is fixed-width; analysis is
          capped at a readable measure so the two columns feel balanced. */}
      <div className="flex-1 flex gap-10 min-w-0">
        {/* Matrix — left column */}
        <div className="shrink-0 w-[400px]">
          <MatrixBoard game={game} />
        </div>

        {/* Analysis prose — right column, capped for readability */}
        <div className="flex-1 min-w-0 max-w-2xl flex flex-col gap-3">
          {/* Primary: player matchup + score, chess-style */}
          <PlayersHeader game={game} />

          {/* Subtitle: beat index + played outcome */}
          <div className="flex items-center gap-2 -mt-1">
            <span className="text-[12px] uppercase tracking-wider text-text-dim/75">
              beat {game.beatIndex + 1}
            </span>
            <span className="text-text-dim/20">·</span>
            <OutcomeChip outcomeKey={playedKey(game)} />
          </div>

          {/* Beat excerpt */}
          {game.beatExcerpt && (
            <p className="text-[12px] text-text-secondary leading-relaxed italic">
              {game.beatExcerpt}
            </p>
          )}

          {/* Rationale — the AI's reading of why this outcome */}
          {game.rationale && (
            <div>
              <div className="text-[12px] uppercase tracking-wider text-text-dim/80 font-semibold mb-1">
                why <span className="font-mono text-text-dim/80">{playedKey(game)}</span>
              </div>
              <p className="text-[12px] text-text-secondary leading-relaxed">
                {game.rationale}
              </p>
            </div>
          )}

          {/* Optimal moves — plain-English best response for each player */}
          <OptimalMoves game={game} />

          {/* Payoff reading */}
          <PayoffReading game={game} />
        </div>
      </div>
    </div>
  );
}

function PlayersHeader({ game }: { game: BeatGame }) {
  const chosen = playedOutcome(game);
  const aWins = chosen.payoffA > chosen.payoffB;
  const bWins = chosen.payoffB > chosen.payoffA;

  const nameClass = (isWinner: boolean, isLoser: boolean): string => {
    if (isWinner) return "text-emerald-300";
    if (isLoser) return "text-red-400/80";
    return "text-text-secondary";
  };

  return (
    <div className="flex items-baseline gap-2 text-[12px]">
      <PlayerLink
        id={game.playerAId}
        name={game.playerAName}
        className={`font-semibold ${nameClass(aWins, bWins)}`}
      />
      <span className="font-mono text-[12px] text-text-dim/80 tabular-nums">
        {chosen.payoffA}&ndash;{chosen.payoffB}
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

// ── Optimal moves — each player's best response, in plain English ──────────
// Uses the semantic vocabulary throughout: a player's move is "advance" or
// "block", the matrix fields playerAAdvance / playerABlock name the actual
// action strings.

function OptimalMoves({ game }: { game: BeatGame }) {
  const aAgainstAdvance = aBestResponseTo(game, "advance");
  const aAgainstBlock = aBestResponseTo(game, "block");
  const bAgainstAdvance = bBestResponseTo(game, "advance");
  const bAgainstBlock = bBestResponseTo(game, "block");

  const aDominant: PlayerMove | null =
    aAgainstAdvance === aAgainstBlock ? aAgainstAdvance : null;
  const bDominant: PlayerMove | null =
    bAgainstAdvance === bAgainstBlock ? bAgainstAdvance : null;

  const labelA = (move: PlayerMove): string =>
    move === "advance" ? game.playerAAdvance : game.playerABlock;
  const labelB = (move: PlayerMove): string =>
    move === "advance" ? game.playerBAdvance : game.playerBBlock;

  // Did the player play optimally?
  //   - Dominant strategy: played === dominant (unconditional)
  //   - Else: played === best response to the OPPONENT'S actual move
  const choseOptimalA = aDominant
    ? game.playerAPlayed === aDominant
    : game.playerAPlayed ===
      (game.playerBPlayed === "advance" ? aAgainstAdvance : aAgainstBlock);
  const choseOptimalB = bDominant
    ? game.playerBPlayed === bDominant
    : game.playerBPlayed ===
      (game.playerAPlayed === "advance" ? bAgainstAdvance : bAgainstBlock);

  return (
    <div>
      <div className="text-[12px] uppercase tracking-wider text-text-dim/80 font-semibold mb-1.5">
        optimal moves
      </div>
      <div className="flex flex-col gap-1.5">
        <OptimalRow
          playerId={game.playerAId}
          playerName={game.playerAName}
          dominant={aDominant}
          againstAdvance={aAgainstAdvance}
          againstBlock={aAgainstBlock}
          opponentName={game.playerBName}
          actionLabel={labelA}
          played={game.playerAPlayed}
          choseOptimal={choseOptimalA}
          side="A"
        />
        <OptimalRow
          playerId={game.playerBId}
          playerName={game.playerBName}
          dominant={bDominant}
          againstAdvance={bAgainstAdvance}
          againstBlock={bAgainstBlock}
          opponentName={game.playerAName}
          actionLabel={labelB}
          played={game.playerBPlayed}
          choseOptimal={choseOptimalB}
          side="B"
        />
      </div>
    </div>
  );
}

function OptimalRow({
  playerId,
  playerName,
  dominant,
  againstAdvance,
  againstBlock,
  opponentName,
  actionLabel,
  played,
  choseOptimal,
  side,
}: {
  playerId: string;
  playerName: string;
  dominant: PlayerMove | null;
  againstAdvance: PlayerMove;
  againstBlock: PlayerMove;
  opponentName: string;
  actionLabel: (m: PlayerMove) => string;
  played: PlayerMove;
  choseOptimal: boolean;
  side: "A" | "B";
}) {
  const nameColor = side === "A" ? "text-white" : "text-sky-200";

  return (
    <div className="flex items-start gap-2 text-[12px]">
      <div className="flex-1">
        <PlayerLink id={playerId} name={playerName} className={`font-semibold ${nameColor}`} />
        <span className="text-text-dim/75"> should </span>
        {dominant ? (
          <>
            <span className="font-semibold text-emerald-300">
              {actionLabel(dominant)}
            </span>
            <span className="text-text-dim/65 text-[10px]"> — dominant strategy</span>
          </>
        ) : (
          <>
            <span className="font-semibold text-emerald-300">
              {actionLabel(againstAdvance)}
            </span>
            <span className="text-text-dim/75"> if {opponentName} advances, </span>
            <span className="font-semibold text-emerald-300">
              {actionLabel(againstBlock)}
            </span>
            <span className="text-text-dim/75"> if {opponentName} blocks</span>
          </>
        )}
        <div className="text-[10px] mt-0.5">
          {choseOptimal ? (
            <span className="text-emerald-400/80">
              ✓ played optimally ({actionLabel(played)})
              {!dominant && (
                <span className="text-text-dim/75"> — best response given {opponentName}&apos;s move</span>
              )}
            </span>
          ) : (
            <span className="text-amber-400/80">
              ✗ played {actionLabel(played)} — off-equilibrium
              {!dominant && (
                <span className="text-text-dim/75"> against {opponentName}&apos;s move</span>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Payoff reading: strategic shape derived from matrix, no narrative labels ──

function PayoffReading({ game }: { game: BeatGame }) {
  const tags = classifyGame(game);
  const dom = dominantStrategy(game);
  const ne = nashEquilibria(game);
  const chosenIsNash = ne.has(playedKey(game));

  return (
    <div>
      <div className="text-[12px] uppercase tracking-wider text-text-dim/80 font-semibold mb-1.5">
        strategic shape
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {tags.map((t, i) => (
          <span
            key={i}
            className={`text-[12px] px-1.5 py-0.5 rounded ${
              t === "zero-sum" ? "bg-red-400/10 text-red-400/80" :
              t === "coordination" ? "bg-emerald-400/10 text-emerald-400/80" :
              t === "social dilemma" ? "bg-amber-400/10 text-amber-400/80" :
              "bg-white/5 text-text-dim/85"
            }`}
          >
            {t}
          </span>
        ))}
        {ne.size > 0 && (
          <span className="text-[12px] px-1.5 py-0.5 rounded bg-sky-400/15 text-sky-300 font-mono uppercase">
            {ne.size === 1 ? "1 nash" : `${ne.size} nash`}
          </span>
        )}
        {dom.player && (
          <span className="text-[12px] px-1.5 py-0.5 rounded bg-white/5 text-white/80">
            {dom.player === "both"
              ? "both have dominant strategies"
              : `${dom.player === "A" ? game.playerAName : game.playerBName} has dominant strategy`}
          </span>
        )}
        {chosenIsNash && (
          <span className="text-[12px] px-1.5 py-0.5 rounded bg-sky-400/10 text-sky-300 border border-sky-400/20">
            chosen ≡ nash
          </span>
        )}
        {!chosenIsNash && ne.size > 0 && (
          <span className="text-[12px] px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-300/80 border border-amber-400/20">
            off-equilibrium play
          </span>
        )}
      </div>
    </div>
  );
}

// ── Matrix board ────────────────────────────────────────────────────────────

function MatrixBoard({ game }: { game: BeatGame }) {
  const nash = useMemo(() => nashEquilibria(game), [game]);
  const { aDominant, bDominant } = useMemo(() => {
    const dom = dominantStrategy(game);
    return {
      aDominant: dom.aMove ?? null,
      bDominant: dom.bMove ?? null,
    };
  }, [game]);
  void aBestResponseKeys; // available for visualisation, unused here
  void bBestResponseKeys;

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
          <th className="px-3 py-2 text-center">
            <AxisLabel
              text={game.playerBAdvance}
              tone="advance"
              optimal={bDominant === "advance"}
            />
          </th>
          <th className="px-3 py-2 text-center">
            <AxisLabel
              text={game.playerBBlock}
              tone="block"
              optimal={bDominant === "block"}
            />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th className="px-2 py-2 text-right align-middle">
            <AxisLabel
              text={game.playerAAdvance}
              tone="advance"
              optimal={aDominant === "advance"}
              align="right"
            />
          </th>
          <Cell game={game} outcomeKey="bothAdvance" isNash={nash.has("bothAdvance")} />
          <Cell game={game} outcomeKey="advanceBlock" isNash={nash.has("advanceBlock")} />
        </tr>
        <tr>
          <th className="px-2 py-2 text-right align-middle">
            <AxisLabel
              text={game.playerABlock}
              tone="block"
              optimal={aDominant === "block"}
              align="right"
            />
          </th>
          <Cell game={game} outcomeKey="blockAdvance" isNash={nash.has("blockAdvance")} />
          <Cell game={game} outcomeKey="bothBlock" isNash={nash.has("bothBlock")} />
        </tr>
      </tbody>
    </table>
  );
}

function AxisLabel({
  text,
  tone,
  optimal,
  align = "center",
}: {
  text: string;
  tone: "advance" | "block";
  optimal: boolean;
  align?: "center" | "right";
}) {
  // Neutral white labels — dominance and best-response are signalled via
  // the Nash badge on cells and the Optimal Moves panel in the analysis column.
  void tone;
  void optimal;
  const justify = align === "right" ? "text-right" : "text-center";
  return (
    <div className={`text-[10px] text-text-primary leading-snug ${justify}`}>
      {text}
    </div>
  );
}

function Cell({
  game,
  outcomeKey,
  isNash,
}: {
  game: BeatGame;
  outcomeKey: OutcomeKey;
  isNash: boolean;
}) {
  const outcome = game[outcomeKey];
  const isChosen = outcomeKeyFor(game.playerAPlayed, game.playerBPlayed) === outcomeKey;

  const cellBg = isChosen
    ? "bg-amber-400/10 ring-1 ring-inset ring-amber-400/40"
    : "bg-white/2";

  return (
    <td className={`relative px-4 py-4 align-top h-32 border-l border-t border-white/10 ${cellBg}`}>
      <div className="absolute top-1.5 right-1.5 flex gap-1">
        {isNash && (
          <span
            className="text-[12px] font-semibold px-1 py-px rounded bg-sky-400/20 text-sky-200 uppercase tracking-wider"
            title="Nash equilibrium — best response for both players"
          >
            nash
          </span>
        )}
        {isChosen && (
          <span
            className="text-[12px] font-semibold px-1 py-px rounded bg-amber-400/25 text-amber-200 uppercase tracking-wider"
            title="The outcome this beat actually landed on"
          >
            played
          </span>
        )}
      </div>

      {/* Payoffs — A in full white, B in dimmed white; separator glyph between */}
      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span className="text-[18px] font-mono font-bold leading-none text-white tabular-nums">
          {outcome.payoffA}
        </span>
        <span className="text-[13px] font-mono text-text-dim/65 leading-none">/</span>
        <span className="text-[18px] font-mono font-bold leading-none text-white/55 tabular-nums">
          {outcome.payoffB}
        </span>
      </div>
      <p className="text-[12px] text-text-dim/85 leading-snug">{outcome.description}</p>
    </td>
  );
}

// ── Outcome chip — small badge showing which outcome the beat landed on ──
// Uses arrow glyphs: ↑ = advance, ↓ = block. First arrow = A, second = B.

const OUTCOME_GLYPHS: Record<OutcomeKey, string> = {
  bothAdvance: "↑↑",
  advanceBlock: "↑↓",
  blockAdvance: "↓↑",
  bothBlock: "↓↓",
};

function OutcomeChip({ outcomeKey }: { outcomeKey: OutcomeKey }) {
  const color =
    outcomeKey === "bothAdvance" ? "bg-emerald-400/20 text-emerald-300" :
    outcomeKey === "bothBlock" ? "bg-red-400/20 text-red-300" :
    "bg-amber-400/20 text-amber-300";
  return (
    <span
      className={`text-[11px] font-mono font-semibold px-1.5 py-px rounded ${color}`}
      title={outcomeKey}
    >
      {OUTCOME_GLYPHS[outcomeKey]}
    </span>
  );
}
