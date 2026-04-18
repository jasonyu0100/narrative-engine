/**
 * Intuitive tooltips for game-theory UI terms.
 *
 * Plain-language explanations aimed at a reader who is not a game theorist.
 * Every string lives here so the vocabulary stays consistent across the scene
 * view, the dashboard, and the export. When adding a new badge or chip in the
 * UI, add a `title={GT_TIPS.x}` from this file rather than inventing copy in
 * place.
 */

export const GT_TIPS = {
  // ── Core concepts ─────────────────────────────────────────────────────
  nashEquilibrium:
    "A stable outcome — neither player would switch their action if they knew the other's choice. Think of it as a resting point the game naturally settles into.",
  nashCell:
    "This cell is a Nash equilibrium: it is self-reinforcing. Any unilateral switch would leave the switcher no better off.",
  realizedCell:
    "The cell the author actually wrote. Shown in amber so you can compare the chosen outcome against the alternatives that were on the table.",
  realizedEqNash:
    "The author's chosen outcome is a Nash equilibrium — the narrative landed on a strategically stable cell.",
  offNash:
    "The realized cell is NOT a Nash equilibrium — someone had a better-for-them option available and didn't take it. Usually signals the author trading local optimality for character arc, identity, or thematic weight.",
  noPureNash:
    "No single cell is self-reinforcing for both sides. The decision has no stable resting point — any outcome leaves at least one player wanting to switch.",

  // ── Payoff / stake ───────────────────────────────────────────────────
  stakeDelta:
    "How much this outcome advances (+) or harms (−) the player's arc-level interests, on a −4 to +4 scale. +4 = ideal outcome, 0 = neutral, −4 = catastrophic.",
  stakeDeltaPair:
    "Stake deltas: (player A) / (player B). Each number is how much this cell helps or hurts that player, from −4 (catastrophic) to +4 (ideal).",
  stakeRank:
    "Where the realized cell sits when all outcomes are ranked by stake delta for this player. Rank 1 = best available, rank N = worst. Shows whether the author gave them an optimal, middling, or bad outcome.",

  // ── ELO / standings ──────────────────────────────────────────────────
  elo:
    "A running score of strategic success across the story. Each game's ELO update uses a continuous margin score — a +4/−4 crush is a full win (max move), a +1/0 marginal edge barely moves the needle, a dead-even cell is neutral. W/L/D is a separate binary tally you read alongside, not what ELO consumes.",
  nashCompliance:
    "% of realized cells that are Nash equilibria. High = the story tends to land on strategically stable outcomes. Low = the author frequently overrides local optimality for narrative reasons (character, theme, irony).",
  trajectorySparkline:
    "The player's ELO over time. A rising line means their realized outcomes are beating counterparts' outcomes; a falling line means they're losing ground.",
  wld:
    "Wins / Losses / Draws — a win is a realized cell where this player's stake delta exceeds the counterpart's. A loss is the reverse. A draw is a tie.",

  // ── Outcome mix ──────────────────────────────────────────────────────
  outcomeMix:
    "Distribution of realized cells by stake sign. Green = positive stake (gain), red = negative (loss). Shows whether the author tends to give this player good or bad outcomes.",
  avgStake:
    "Mean stake delta per realized cell, on the −4..+4 scale. Positive = the author typically gives this player favorable outcomes; negative = they're typically hurt by what happens.",

  // ── Grid structure ───────────────────────────────────────────────────
  gridAxis:
    "All options for one player. Every cell in a row or column pairs this action with every option the other player could have taken.",
  actionAxis:
    "The dimension both players' actions are organised along — the shared trade being negotiated (e.g., trust, disclosure, pressure). Both sides' choices live on this axis.",
  gameType:
    "The classical strategic shape of the beat — coordination, dilemma, zero-sum, etc. Hovering the chip shows the one-line definition.",
  rationaleRealized:
    "One-sentence reading of why the author chose this specific cell over the others on the grid — often the most interesting question, especially when the realized cell is dominated.",

  // ── Strategic style archetypes ───────────────────────────────────────
  coalition:
    "A tight group where every pair cooperates (lands in mutual-gain cells) above a high threshold. Coalitions are stable structural alliances within the cast.",
  rivalry:
    "A pair of players with sustained conflict — many games together, many realized cells where one gains and the other loses.",
  cohesion:
    "A coalition's weakest pairwise bond, as a cooperation rate. High cohesion means even the least-aligned members still cooperate most of the time.",
  intensityScore:
    "Composite rivalry measure: number of games × conflict rate × win asymmetry. A high-intensity rivalry has many games, many conflict outcomes, and a clear winner.",
} as const;

export type GtTipKey = keyof typeof GT_TIPS;
