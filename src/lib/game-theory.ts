/**
 * Game-theoretic helpers — derive Nash equilibria, best responses, dominant
 * strategies, and ELO ratings from BeatGame payoff matrices.
 *
 * VOCABULARY: a single coherent language runs through this file. Moves are
 * "advance" or "block". Outcomes are named by both moves explicitly:
 * bothAdvance / advanceBlock / blockAdvance / bothBlock. No cc/cd/dc/dd
 * encoding — the semantic names tell you what each cell represents.
 */

import type {
  BeatGame,
  GameOutcome,
  NarrativeState,
  OutcomeKey,
  PlayerMove,
} from "@/types/narrative";

export const OUTCOME_KEYS: OutcomeKey[] = [
  "bothAdvance",
  "advanceBlock",
  "blockAdvance",
  "bothBlock",
];

// ── Move / outcome translation ─────────────────────────────────────────────

/** Map a pair of moves to the outcome key they produce. */
export function outcomeKeyFor(a: PlayerMove, b: PlayerMove): OutcomeKey {
  if (a === "advance" && b === "advance") return "bothAdvance";
  if (a === "advance" && b === "block") return "advanceBlock";
  if (a === "block" && b === "advance") return "blockAdvance";
  return "bothBlock";
}

/** Moves implied by an outcome key. */
export function movesOf(key: OutcomeKey): { a: PlayerMove; b: PlayerMove } {
  switch (key) {
    case "bothAdvance":   return { a: "advance", b: "advance" };
    case "advanceBlock":  return { a: "advance", b: "block" };
    case "blockAdvance":  return { a: "block",   b: "advance" };
    case "bothBlock":     return { a: "block",   b: "block" };
  }
}

/** The outcome for a specific pair of moves. */
export function outcomeAt(game: BeatGame, a: PlayerMove, b: PlayerMove): GameOutcome {
  return game[outcomeKeyFor(a, b)];
}

/** The outcome that actually happened in this beat. */
export function playedOutcome(game: BeatGame): GameOutcome {
  return outcomeAt(game, game.playerAPlayed, game.playerBPlayed);
}

/** The outcome key for what actually happened. */
export function playedKey(game: BeatGame): OutcomeKey {
  return outcomeKeyFor(game.playerAPlayed, game.playerBPlayed);
}

// ── Nash equilibria ────────────────────────────────────────────────────────

/**
 * An outcome is a Nash equilibrium if neither player would benefit by
 * unilaterally switching to their alternative move.
 */
export function nashEquilibria(game: BeatGame): Set<OutcomeKey> {
  const result = new Set<OutcomeKey>();

  // bothAdvance: A could switch to block → blockAdvance. B could switch to block → advanceBlock.
  if (
    game.bothAdvance.payoffA >= game.blockAdvance.payoffA &&
    game.bothAdvance.payoffB >= game.advanceBlock.payoffB
  ) {
    result.add("bothAdvance");
  }

  // advanceBlock: A could switch to block → bothBlock. B could switch to advance → bothAdvance.
  if (
    game.advanceBlock.payoffA >= game.bothBlock.payoffA &&
    game.advanceBlock.payoffB >= game.bothAdvance.payoffB
  ) {
    result.add("advanceBlock");
  }

  // blockAdvance: A could switch to advance → bothAdvance. B could switch to block → bothBlock.
  if (
    game.blockAdvance.payoffA >= game.bothAdvance.payoffA &&
    game.blockAdvance.payoffB >= game.bothBlock.payoffB
  ) {
    result.add("blockAdvance");
  }

  // bothBlock: A could switch to advance → advanceBlock. B could switch to advance → blockAdvance.
  if (
    game.bothBlock.payoffA >= game.advanceBlock.payoffA &&
    game.bothBlock.payoffB >= game.blockAdvance.payoffB
  ) {
    result.add("bothBlock");
  }

  return result;
}

// ── Best responses ─────────────────────────────────────────────────────────

/** A's best response when B plays a given move. */
export function aBestResponseTo(game: BeatGame, b: PlayerMove): PlayerMove {
  const ifAdvance = b === "advance" ? game.bothAdvance.payoffA : game.advanceBlock.payoffA;
  const ifBlock   = b === "advance" ? game.blockAdvance.payoffA : game.bothBlock.payoffA;
  return ifAdvance >= ifBlock ? "advance" : "block";
}

/** B's best response when A plays a given move. */
export function bBestResponseTo(game: BeatGame, a: PlayerMove): PlayerMove {
  const ifAdvance = a === "advance" ? game.bothAdvance.payoffB : game.blockAdvance.payoffB;
  const ifBlock   = a === "advance" ? game.advanceBlock.payoffB : game.bothBlock.payoffB;
  return ifAdvance >= ifBlock ? "advance" : "block";
}

/** Outcome keys that represent A's best responses (for cell highlighting). */
export function aBestResponseKeys(game: BeatGame): Set<OutcomeKey> {
  const out = new Set<OutcomeKey>();
  // When B plays advance → A's options are bothAdvance vs blockAdvance
  if (game.bothAdvance.payoffA >= game.blockAdvance.payoffA) out.add("bothAdvance");
  if (game.blockAdvance.payoffA >= game.bothAdvance.payoffA) out.add("blockAdvance");
  // When B plays block → A's options are advanceBlock vs bothBlock
  if (game.advanceBlock.payoffA >= game.bothBlock.payoffA) out.add("advanceBlock");
  if (game.bothBlock.payoffA >= game.advanceBlock.payoffA) out.add("bothBlock");
  return out;
}

/** Outcome keys that represent B's best responses. */
export function bBestResponseKeys(game: BeatGame): Set<OutcomeKey> {
  const out = new Set<OutcomeKey>();
  // When A plays advance → B's options are bothAdvance vs advanceBlock
  if (game.bothAdvance.payoffB >= game.advanceBlock.payoffB) out.add("bothAdvance");
  if (game.advanceBlock.payoffB >= game.bothAdvance.payoffB) out.add("advanceBlock");
  // When A plays block → B's options are blockAdvance vs bothBlock
  if (game.blockAdvance.payoffB >= game.bothBlock.payoffB) out.add("blockAdvance");
  if (game.bothBlock.payoffB >= game.blockAdvance.payoffB) out.add("bothBlock");
  return out;
}

// ── Dominant strategy ──────────────────────────────────────────────────────

export type DominantSide = "A" | "B" | "both" | null;

export type DominantResult = {
  player: DominantSide;
  /** A's dominant move if they have one. */
  aMove?: PlayerMove;
  /** B's dominant move if they have one. */
  bMove?: PlayerMove;
};

/** Which players have a move that's best regardless of the opponent. */
export function dominantStrategy(game: BeatGame): DominantResult {
  const aAgainstAdvance = aBestResponseTo(game, "advance");
  const aAgainstBlock   = aBestResponseTo(game, "block");
  const bAgainstAdvance = bBestResponseTo(game, "advance");
  const bAgainstBlock   = bBestResponseTo(game, "block");

  const aHas = aAgainstAdvance === aAgainstBlock;
  const bHas = bAgainstAdvance === bAgainstBlock;

  return {
    player: aHas && bHas ? "both" : aHas ? "A" : bHas ? "B" : null,
    aMove: aHas ? aAgainstAdvance : undefined,
    bMove: bHas ? bAgainstAdvance : undefined,
  };
}

// ── Game classification ────────────────────────────────────────────────────

/** Tag a game with the structural shapes it exhibits. */
export function classifyGame(game: BeatGame): string[] {
  const tags: string[] = [];

  const sums = [
    game.bothAdvance.payoffA + game.bothAdvance.payoffB,
    game.advanceBlock.payoffA + game.advanceBlock.payoffB,
    game.blockAdvance.payoffA + game.blockAdvance.payoffB,
    game.bothBlock.payoffA + game.bothBlock.payoffB,
  ];
  if (sums.every((s) => s === sums[0])) tags.push("zero-sum");

  const ccBestA = game.bothAdvance.payoffA >= Math.max(
    game.advanceBlock.payoffA,
    game.blockAdvance.payoffA,
    game.bothBlock.payoffA,
  );
  const ccBestB = game.bothAdvance.payoffB >= Math.max(
    game.advanceBlock.payoffB,
    game.blockAdvance.payoffB,
    game.bothBlock.payoffB,
  );
  if (ccBestA && ccBestB) tags.push("coordination");

  const ne = nashEquilibria(game);
  const ddOnlyNash = ne.has("bothBlock") && !ne.has("bothAdvance");
  if (ccBestA && ccBestB && ddOnlyNash) tags.push("social dilemma");

  if (tags.length === 0) tags.push("mixed");
  return tags;
}

// ── Optimality judgements ──────────────────────────────────────────────────

/** Did the actual played outcome match a Nash equilibrium? */
export function isOptimalPlay(game: BeatGame): boolean {
  return nashEquilibria(game).has(playedKey(game));
}

/**
 * Given a player, which move would align with Nash equilibrium? Returns null
 * when the equilibrium move is ambiguous (multiple NEs with conflicting moves).
 */
export function equilibriumMove(
  game: BeatGame,
  player: "A" | "B",
): PlayerMove | null {
  const ne = nashEquilibria(game);
  if (ne.size === 0) return null;
  const moves = new Set<PlayerMove>();
  for (const key of ne) {
    const { a, b } = movesOf(key);
    moves.add(player === "A" ? a : b);
  }
  return moves.size === 1 ? [...moves][0] : null;
}

// ── ELO rating ─────────────────────────────────────────────────────────────

export const ELO_INITIAL = 1500;
export const ELO_K = 32;

/** A's score from a game's played outcome: 1 win / 0.5 draw / 0 loss. */
export function gameScoreA(game: BeatGame): number {
  const outcome = playedOutcome(game);
  if (outcome.payoffA > outcome.payoffB) return 1;
  if (outcome.payoffA < outcome.payoffB) return 0;
  return 0.5;
}

export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

export function eloUpdate(
  ra: number,
  rb: number,
  scoreA: number,
  k: number = ELO_K,
): [number, number] {
  const expectedA = expectedScore(ra, rb);
  const newRa = ra + k * (scoreA - expectedA);
  const newRb = rb + k * (1 - scoreA - (1 - expectedA));
  return [newRa, newRb];
}

/** Per-player ELO history across a sequence of games in narrative order. */
export function computeEloHistories(
  games: BeatGame[],
): Map<string, { ratings: number[]; games: number[] }> {
  const current = new Map<string, number>();
  const histories = new Map<string, { ratings: number[]; games: number[] }>();

  const ensure = (id: string): void => {
    if (!current.has(id)) {
      current.set(id, ELO_INITIAL);
      histories.set(id, { ratings: [ELO_INITIAL], games: [] });
    }
  };

  games.forEach((g, idx) => {
    ensure(g.playerAId);
    ensure(g.playerBId);
    const ra = current.get(g.playerAId)!;
    const rb = current.get(g.playerBId)!;
    const [newRa, newRb] = eloUpdate(ra, rb, gameScoreA(g));
    current.set(g.playerAId, newRa);
    current.set(g.playerBId, newRb);

    const ha = histories.get(g.playerAId)!;
    ha.ratings.push(newRa);
    ha.games.push(idx);

    const hb = histories.get(g.playerBId)!;
    hb.ratings.push(newRb);
    hb.games.push(idx);
  });

  return histories;
}

// ── Player name resolution (display layer) ────────────────────────────────

/**
 * Resolve a player ID to its current display name. Reads from the narrative
 * registry so renames propagate live; falls back to the stored name if the
 * entity was deleted since analysis.
 */
export function resolvePlayerName(
  narrative: NarrativeState,
  id: string,
  storedFallback?: string,
): string {
  return (
    narrative.characters[id]?.name ??
    narrative.locations[id]?.name ??
    narrative.artifacts[id]?.name ??
    storedFallback ??
    id
  );
}
