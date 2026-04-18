"use client";

/**
 * GameTheoryDashboard — a focused, high-level view of the narrative's
 * strategic structure. Surfaces player rankings via ELO (with inline
 * sparklines of each player's rating over time) plus narrative insights
 * like dominant rivalries, biggest upsets, and playstyle profiles.
 */

import { useMemo } from "react";
import { Modal, ModalHeader, ModalBody } from "@/components/Modal";
import {
  computeEloHistories,
  ELO_INITIAL,
  gameScoreA,
  nashEquilibria,
  realizedIsNash,
  realizedOutcome,
  resolvePlayerName,
  stakeRank,
} from "@/lib/game-theory";
import { GT_TIPS } from "@/lib/game-theory-glossary";
import { resolveEntry, isScene } from "@/types/narrative";
import type {
  ActionAxis,
  BeatGame,
  GameType,
  NarrativeState,
  Scene,
  SceneGameAnalysis,
} from "@/types/narrative";

type Props = {
  narrative: NarrativeState;
  resolvedKeys: string[];
  onClose: () => void;
  onSelectScene?: (sceneIndex: number) => void;
};

// ── Aggregation — player profiles + insights ───────────────────────────────

type GameWithContext = {
  game: BeatGame;
  sceneIndex: number;
  scene: Scene;
};

type PlayerProfile = {
  id: string;
  name: string;
  // ELO
  currentElo: number;
  peakElo: number;
  troughElo: number;
  eloHistory: number[];
  eloVolatility: number; // std dev of per-game elo changes
  // Games
  games: number;
  wins: number;
  losses: number;
  draws: number;
  // Playstyle — stake-delta based
  avgStakeDelta: number;        // mean stake delta across realized cells
  avgStakeAdvantage: number;    // mean of (selfDelta − otherDelta) — positive = author writes cells better for them than for the other side
  positiveCells: number;        // cells where this player's stake delta > 0
  negativeCells: number;        // cells where this player's stake delta < 0
  // Relational outcome patterns — realized cells classified by joint sign
  cellsBothGain: number;         // self > 0 && other > 0 — teamwork cells
  cellsBothLose: number;         // self < 0 && other < 0 — mutual loss cells
  cellsSelfGainOtherLose: number; // extract — self > 0 && other < 0
  cellsSelfLoseOtherGain: number; // sacrifice — self < 0 && other > 0
  // Rank distribution — how often author picked a high-rank cell for this player
  sumRealizedRank: number;      // rank 1 is best; sum across games
  sumRealizedRankTotal: number; // sum of grid sizes (for normalising to 0-1)
  // Equilibrium alignment
  realizedNashCount: number;    // games where the realized cell is Nash
  // Role preference
  asRoleA: number;
  asRoleB: number;
  // Game-type / axis participation
  gameTypeCounts: Map<GameType, number>;
  axisCounts: Map<ActionAxis, number>;
  // Temporal arc — games split into the first and second half of their
  // appearance timeline so the classifier can spot redemption / corruption
  // arcs that the aggregate averages hide.
  earlyGames: number;
  lateGames: number;
  earlyStakeSum: number;     // sum of stake deltas in early half
  lateStakeSum: number;      // sum in late half
  // Relational — filled in a post-pass from pair data so we can tag
  // "has nemesis" / "has patron" against their most-lopsided matchup.
  nemesisName: string | null;
  nemesisNetScore: number;   // negative = this player has a bad record vs them
  patronName: string | null;
  patronNetScore: number;    // positive = this player dominates them
  // Social
  opponentCounts: Map<string, number>;
  biggestUpset: { opponentName: string; ratingGain: number; sceneIndex: number } | null;
};

// Archetype palette — richer than winner/loser. Each player collects up to
// four tags across orthogonal axes (outcome shape, trajectory, strategic
// style, role, arena). Each tag carries tone for colour + description for a
// tooltip the reader can hover to understand what the tag means.
export type PlayerArchetype = {
  id: string;
  label: string;
  description: string;
  tone:
    | "win"
    | "loss"
    | "cooperation"
    | "conflict"
    | "moral"
    | "strategic"
    | "neutral";
};

/** Pairwise play data — the raw building block for rivalries and coalitions.
 *  Outcome classification is by STAKE SIGN on the realized cell:
 *    bothPositive  — mutual benefit (both deltas > 0)
 *    bothNegative  — mutual harm (both deltas < 0)
 *    conflict      — deltas have opposite signs (one winner, one loser)
 *    neutral       — at least one side is exactly zero
 */
type PairData = {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  games: number;
  // Win/loss/draw from canonical A's perspective (via gameScoreA)
  aWins: number;
  bWins: number;
  draws: number;
  // Realized-cell stake-sign counts for this pair
  bothPositive: number;
  bothNegative: number;
  conflict: number;
  neutral: number;
  // Derived rates (0-1)
  cooperationRate: number; // bothPositive / games
  conflictRate: number;    // conflict / games (zero-sum-style outcomes)
  // Composite "rivalry intensity" — for sorting meaningful rivalries
  intensityScore: number;
};

type Coalition = {
  memberIds: string[];
  memberNames: string[];
  /** Number of games played between members of this coalition. */
  internalGames: number;
  /** Average cooperation rate across all member pairs. */
  cooperationRate: number;
  /** Minimum cooperation rate among member pairs — the "weakest link". */
  cohesion: number;
  /** Number of scene-spanning bonds — how many pairs are in this coalition. */
  bondCount: number;
};

type Aggregate = {
  orderedGames: GameWithContext[];
  totalDecisions: number;
  scenesAnalysed: number;
  nashCompliance: number;
  profiles: PlayerProfile[];
  pairs: PairData[];
  rivalries: PairData[];
  coalitions: Coalition[];
  offEquilibriumGames: GameWithContext[];
  biggestSingleUpset: {
    gameCtx: GameWithContext;
    swinger: string;
    ratingGain: number;
  } | null;
};

// ── Archetype classifier ─────────────────────────────────────────────────
// Reads a fully-aggregated PlayerProfile and emits orthogonal tags. Tags
// are grouped so at most one fires per group — the dashboard shows up to
// four tags per player, covering outcome shape, trajectory, strategic
// style, role bias and arena affinity.
//
// Thresholds are intentionally conservative: below ~3 games of signal the
// classifier stays quiet rather than crown a player after one beat.

const ARCHETYPE_MIN_GAMES = 3;
const GAMETYPE_AFFINITY_THRESHOLD = 0.5;   // share of a player's games
const AXIS_AFFINITY_THRESHOLD = 0.5;

function topEntry<K>(m: Map<K, number>): { key: K; count: number } | null {
  let best: { key: K; count: number } | null = null;
  for (const [k, v] of m) {
    if (!best || v > best.count) best = { key: k, count: v };
  }
  return best;
}

// Pattern-match the signal bundle into ONE evocative narrative role. These
// are deliberately cross-genre: Harry Potter, Hermione, Fang Yuan, Varys,
// Frodo and Gatsby should all find themselves in one of these buckets. Each
// role is a *pattern* over the mechanical signals, not a redescription of
// them. Emitted as the first tag so it leads the reader's reading.
type Signals = {
  rankFrac: number;
  eloDelta: number;
  nashRate: number;
  teamRate: number;
  extractRate: number;
  sacrificeRate: number;
  mutualLossRate: number;
  asymmetry: number;
  arcShift: number;   // lateStake − earlyStake (normalized by games)
  hasArc: boolean;    // true if enough games to compute a split
  infoShare: number;
  powerShare: number;
  conflictShare: number;
  coopShare: number;
  aShare: number;
  volatility: number;
};

function narrativeRole(p: PlayerProfile, s: Signals): PlayerArchetype | null {
  // Ordered by specificity — more-distinctive patterns checked first.
  // PROTAGONIST — the "main character force" is visibly acting on them:
  // ELO climbs, outcomes land above expectation, they drive scenes.
  if (s.eloDelta >= 80 && s.aShare >= 0.5 && p.avgStakeDelta >= 0.8 && s.nashRate <= 0.5) {
    return {
      id: "role-protagonist",
      label: "protagonist",
      description: "Ascendant ELO, leads scenes, repeatedly lands above what the strategic grid predicts. The narrative is bending around them — the main-character force is active.",
      tone: "win",
    };
  }
  // ANTAGONIST — extracts or takes the biggest slice, dominates the grid,
  // participates in conflict or power-framing games.
  if ((s.extractRate >= 0.3 || (s.teamRate >= 0.3 && s.asymmetry >= 1)) && p.avgStakeDelta >= 0.5 && (s.conflictShare >= 0.3 || s.powerShare >= 0.3)) {
    return {
      id: "role-antagonist",
      label: "antagonist",
      description: "Dominates grids at others' expense — extracts stake, takes the lion's share of cooperation, and lives in conflict or power-framing games. Structurally opposed to the protagonist's trajectory.",
      tone: "conflict",
    };
  }
  // TRAGIC FIGURE — absorbs cost for others, ELO declines, yet they're
  // central (initiator or significant participation). The sacrifice is
  // seen, not rewarded.
  if (s.sacrificeRate >= 0.25 && s.eloDelta <= -40 && p.games >= 4) {
    return {
      id: "role-tragic",
      label: "tragic figure",
      description: "Absorbs losses while others gain, and pays for it across the arc — ELO declines even as they carry the sacrifice. The cost is visible but not redeemed within the window.",
      tone: "moral",
    };
  }
  // MENTOR — genuine teammate shape, steady ELO, trust-centric axis, and
  // asymmetry TILTED AWAY from them (they give more than they take).
  if (s.teamRate >= 0.5 && s.asymmetry <= -0.3 && s.volatility <= 10) {
    return {
      id: "role-mentor",
      label: "mentor",
      description: "Cooperative shape, steady ELO, and on average gives more stake than they take — the character others learn from or lean on. Quiet weight rather than ascendant climb.",
      tone: "cooperation",
    };
  }
  // SURVIVOR — arc shifts upward (negative early → positive late) AND net
  // ascendant. Redemption / growth arc.
  if (s.hasArc && s.arcShift >= 1.2 && s.eloDelta >= 0) {
    return {
      id: "role-survivor",
      label: "survivor",
      description: "Arc shifts visibly upward — their later outcomes are better than their early ones. Growth or redemption arc — they start beneath the water line and climb.",
      tone: "win",
    };
  }
  // FALLEN — arc shifts downward, ELO declines. Corruption / decline arc.
  if (s.hasArc && s.arcShift <= -1.2 && s.eloDelta <= 0) {
    return {
      id: "role-fallen",
      label: "fallen",
      description: "Arc shifts visibly downward — started stronger than they end. Corruption, decline, or defeat arc — the story is watching them lose ground.",
      tone: "loss",
    };
  }
  // TRICKSTER — info-heavy games + volatile + mostly ahead. Thrives on
  // manipulation of what's shown vs hidden, swings big either way.
  if (s.infoShare >= 0.35 && s.volatility >= 12 && p.avgStakeDelta >= 0) {
    return {
      id: "role-trickster",
      label: "trickster",
      description: "Thrives in information-asymmetric games (signaling, cheap-talk, principal-agent), high variance in outcomes, mostly ends ahead. Moves through the story by controlling what others know.",
      tone: "strategic",
    };
  }
  // FOIL — locked to responder role in conflict frames, near-zero net
  // trajectory. Exists to push against someone else's motion.
  if (s.aShare <= 0.3 && s.conflictShare >= 0.3 && Math.abs(s.eloDelta) < 50) {
    return {
      id: "role-foil",
      label: "foil",
      description: "Almost always responding, almost always in conflict, ELO stays near baseline. Their narrative function is to push against someone else's motion rather than drive their own.",
      tone: "neutral",
    };
  }
  // ANCHOR — high participation, near-baseline ELO, broadly cooperative.
  // The stable presence — supporting cast, not driving the arc.
  if (p.games >= 6 && Math.abs(s.eloDelta) < 40 && s.teamRate >= 0.35 && s.extractRate < 0.2) {
    return {
      id: "role-anchor",
      label: "anchor",
      description: "Recurring, cooperative, near-baseline ELO. A stable presence whose role is to be there — the ground other arcs push against.",
      tone: "cooperation",
    };
  }
  return null;
}

function classifyPlayer(p: PlayerProfile): PlayerArchetype[] {
  const tags: PlayerArchetype[] = [];
  if (p.games < ARCHETYPE_MIN_GAMES) return tags;

  const rankFrac =
    p.sumRealizedRankTotal > 0
      ? (p.sumRealizedRank - p.games) /
        Math.max(1, p.sumRealizedRankTotal - p.games) // 0 = always best cell, 1 = always worst
      : 0.5;
  const eloDelta = p.currentElo - ELO_INITIAL;
  const nashRate = p.realizedNashCount / p.games;
  const teamRate = p.cellsBothGain / p.games;
  const extractRate = p.cellsSelfGainOtherLose / p.games;
  const sacrificeRate = p.cellsSelfLoseOtherGain / p.games;
  const mutualLossRate = p.cellsBothLose / p.games;
  const asymmetry = p.avgStakeAdvantage; // positive = I take more stake than counterparts

  // Arc shift — late-half average stake minus early-half average stake.
  // Only meaningful with ≥4 games split into halves.
  const hasArc = p.earlyGames >= 2 && p.lateGames >= 2;
  const arcShift = hasArc
    ? (p.lateStakeSum / p.lateGames) - (p.earlyStakeSum / p.earlyGames)
    : 0;

  // Game-type participation shares used by multiple tag groups.
  const gtCounts = p.gameTypeCounts;
  const infoShare = ((gtCounts.get("signaling") ?? 0) + (gtCounts.get("principal-agent") ?? 0) + (gtCounts.get("cheap-talk") ?? 0)) / p.games;
  const powerShare = ((gtCounts.get("stackelberg") ?? 0) + (gtCounts.get("commitment-game") ?? 0) + (gtCounts.get("bargaining") ?? 0)) / p.games;
  const conflictShare = ((gtCounts.get("zero-sum") ?? 0) + (gtCounts.get("pure-opposition") ?? 0) + (gtCounts.get("chicken") ?? 0) + (gtCounts.get("anti-coordination") ?? 0)) / p.games;
  const coopShare = ((gtCounts.get("coordination") ?? 0) + (gtCounts.get("stag-hunt") ?? 0) + (gtCounts.get("collective-action") ?? 0) + (gtCounts.get("battle-of-sexes") ?? 0)) / p.games;

  const roleTotalGames = p.asRoleA + p.asRoleB;
  const aShare = roleTotalGames > 0 ? p.asRoleA / roleTotalGames : 0;

  const signals: Signals = {
    rankFrac,
    eloDelta,
    nashRate,
    teamRate,
    extractRate,
    sacrificeRate,
    mutualLossRate,
    asymmetry,
    arcShift,
    hasArc,
    infoShare,
    powerShare,
    conflictShare,
    coopShare,
    aShare,
    volatility: p.eloVolatility,
  };

  // Group 0 — NARRATIVE ROLE headline. One tag max. Leads the display so
  // the reader gets an evocative summary before the mechanical tags.
  const role = narrativeRole(p, signals);
  if (role) tags.push(role);

  // Group 1 — RELATIONAL OUTCOME SHAPE. Mutually exclusive. Priority is
  // deliberately skewed toward character-revealing signals: we prefer to say
  // "lopsided" over "teammate" when a player's cooperation is really an
  // asymmetric extraction. The old classifier made Fang Yuan look like a
  // teammate; this one will correctly flag the uneven slice.
  if (extractRate >= 0.3) {
    tags.push({
      id: "extractor",
      label: "extractor",
      description: "Often lands in cells where they gain stake while the counterpart loses. Wins at someone's expense.",
      tone: "conflict",
    });
  } else if (sacrificeRate >= 0.3) {
    tags.push({
      id: "sacrificial",
      label: "sacrificial",
      description: "Often lands in cells where they lose stake while the counterpart gains. Absorbs cost for others.",
      tone: "moral",
    });
  } else if (mutualLossRate >= 0.3) {
    tags.push({
      id: "destructive",
      label: "destructive",
      description: "Often lands in mutual-loss cells — no-win confrontations, spoiled alliances.",
      tone: "conflict",
    });
  } else if (teamRate >= 0.4 && asymmetry >= 1.0) {
    tags.push({
      id: "lopsided",
      label: "lopsided cooperator",
      description: "Cooperation cells are stacked in their favor — both sides gain, but they gain much more. The alliance benefits them disproportionately.",
      tone: "conflict",
    });
  } else if (teamRate >= 0.5 && Math.abs(asymmetry) < 0.7) {
    tags.push({
      id: "teammate",
      label: "teammate",
      description: "Most realized cells leave both parties with roughly-equal gains. Genuine cooperative trajectory.",
      tone: "cooperation",
    });
  }

  // Group 2 — TRAJECTORY. At most one.
  if (rankFrac <= 0.33 && p.avgStakeDelta > 0.5) {
    tags.push({
      id: "dominant",
      label: "dominant",
      description: "Realized cells skew to the top of each grid. The author routinely gives them the best available outcome.",
      tone: "win",
    });
  } else if (eloDelta >= 80) {
    tags.push({
      id: "ascendant",
      label: "ascendant",
      description: "ELO climbed sharply across the narrative. Gained ground through the arc.",
      tone: "win",
    });
  } else if (eloDelta <= -80) {
    tags.push({
      id: "fading",
      label: "fading",
      description: "ELO eroded across the narrative. Stake delivery weakened over time.",
      tone: "loss",
    });
  } else if (p.eloVolatility >= 18) {
    tags.push({
      id: "volatile",
      label: "volatile",
      description: "Big ELO swings between games. High-variance outcomes — wins big, loses big.",
      tone: "strategic",
    });
  } else if (p.eloVolatility <= 6 && p.games >= 5) {
    tags.push({
      id: "steady",
      label: "steady",
      description: "Low ELO volatility across many games. Consistent, even outcomes.",
      tone: "strategic",
    });
  }

  // Group 3 — STRATEGIC STYLE. Up to one of mastermind / off-script /
  // arc-breaker. Arc-breaker is the 'main-character' signal: the player
  // keeps landing on off-Nash cells AND keeps winning from them — the
  // author overrides strategic stability to grant them stake. Fang Yuan
  // should fire this tag strongly.
  if (nashRate <= 0.35 && eloDelta >= 50 && p.avgStakeDelta >= 1) {
    tags.push({
      id: "arc-breaker",
      label: "arc-breaker",
      description: "Keeps landing on off-Nash cells AND coming out ahead. Author overrides strategic equilibrium to grant them wins — the 'main-character force' is visibly acting on them.",
      tone: "strategic",
    });
  } else if (nashRate >= 0.75 && p.avgStakeDelta >= 0) {
    tags.push({
      id: "mastermind",
      label: "mastermind",
      description: "Most realized cells sit on a Nash equilibrium. Outcomes line up with strategic stability — plays like someone who sees the grid clearly.",
      tone: "strategic",
    });
  } else if (nashRate <= 0.2 && p.games >= 5) {
    tags.push({
      id: "off-script",
      label: "off-script",
      description: "Realized cells rarely coincide with Nash. Author systematically overrides strategic expectation in their scenes.",
      tone: "strategic",
    });
  }

  // Group 4 — STRATEGIC AGENCY from game-type participation. These fire
  // independently of outcome shape because they reveal HOW a player plays
  // rather than how they end up. Generalisable across genres: Dumbledore
  // fires schemer + power-broker; Hermione fires coordinator; Voldemort
  // fires power-broker + combatant; Fang Yuan fires schemer.
  if (infoShare >= 0.35 && p.avgStakeDelta > 0.3) {
    tags.push({
      id: "schemer",
      label: "schemer",
      description: "Thrives in information-asymmetric games (signaling, principal-agent, cheap-talk) while coming out ahead. Wields what is shown and hidden to structure outcomes in their favor.",
      tone: "strategic",
    });
  }
  if (powerShare >= 0.35 && aShare >= 0.55) {
    tags.push({
      id: "power-broker",
      label: "power-broker",
      description: "Frequently the first mover in stackelberg / commitment / bargaining beats. Sets the terms others respond to — controls the frame of the interaction.",
      tone: "strategic",
    });
  }
  if (conflictShare >= 0.4) {
    tags.push({
      id: "combatant",
      label: "combatant",
      description: "Most decisions sit inside zero-sum, chicken, or pure-opposition games. A conflict-driven player — their arc runs through direct collisions.",
      tone: "conflict",
    });
  }
  if (coopShare >= 0.5 && asymmetry < 0.7) {
    tags.push({
      id: "coordinator",
      label: "coordinator",
      description: "Most appearances are coordination, stag-hunt, or collective-action games — alignment problems rather than collisions. Their strategic work is building shared action.",
      tone: "cooperation",
    });
  }

  // Group 4b — ARC SHIFT. Redemption / decline / plateau based on the
  // early-vs-late stake split. Fires independently of outcome shape so
  // Snape (late-positive after early-negative) reads as redemption-arc
  // even though his overall average might be neutral.
  if (hasArc) {
    if (arcShift >= 1.5) {
      tags.push({
        id: "arc-rising",
        label: "redemption arc",
        description: "Late-game outcomes are substantially better than early ones. The arc moves upward over the story — growth, redemption, or belated recognition.",
        tone: "win",
      });
    } else if (arcShift <= -1.5) {
      tags.push({
        id: "arc-falling",
        label: "decline arc",
        description: "Late-game outcomes are substantially worse than early ones. The arc moves downward — corruption, loss of footing, or defeat.",
        tone: "loss",
      });
    }
  }

  // Group 4c — RELATIONAL. Nemesis / patron signals — only fires when a
  // single opposing relationship accounts for much of their record.
  if (p.nemesisName && p.nemesisNetScore <= -2) {
    tags.push({
      id: "has-nemesis",
      label: `nemesis: ${p.nemesisName}`,
      description: `Losing record concentrated against ${p.nemesisName}. This relationship shapes their trajectory more than any other — they cannot win against this counterpart.`,
      tone: "conflict",
    });
  }
  if (p.patronName && p.patronNetScore >= 2) {
    tags.push({
      id: "has-patron",
      label: `dominates: ${p.patronName}`,
      description: `Winning record concentrated against ${p.patronName}. This counterpart is where this character routinely comes out ahead — a relationship they master.`,
      tone: "win",
    });
  }

  // Group 5 — ROLE bias. Only fires at strong splits.
  if (roleTotalGames >= 4) {
    if (aShare >= 0.8) {
      tags.push({
        id: "initiator",
        label: "initiator",
        description: "Almost always the prime mover (Player A). Scenes revolve around their choices — others react to what they decide.",
        tone: "neutral",
      });
    } else if (aShare <= 0.2) {
      tags.push({
        id: "responder",
        label: "responder",
        description: "Almost always reacting (Player B). Their narrative role is to answer others' gambits rather than set them.",
        tone: "neutral",
      });
    }
  }

  // Group 6 — AXIS affinity. Reveals their characteristic dimension of
  // action (trust, disclosure, pressure, etc.). Only surfaces when the
  // player's decisions concentrate on one axis.
  const topAxis = topEntry(p.axisCounts);
  if (topAxis && topAxis.count / p.games >= AXIS_AFFINITY_THRESHOLD) {
    tags.push({
      id: `axis-${topAxis.key}`,
      label: `axis: ${topAxis.key}`,
      description: `The axis most of their choices trade on is ${topAxis.key}. This is their characteristic dimension of action — the thing they're always negotiating.`,
      tone: "neutral",
    });
  }

  // Drop game-type-heavy tag if a more specific agency tag already covered
  // it (schemer, power-broker, combatant, coordinator all capture
  // game-type concentration). Otherwise emit as a generic arena affinity.
  const agencyTagIds = new Set(["schemer", "power-broker", "combatant", "coordinator"]);
  const hasAgencyTag = tags.some((t) => agencyTagIds.has(t.id));
  if (!hasAgencyTag) {
    const topGT = topEntry(p.gameTypeCounts);
    if (topGT && topGT.count / p.games >= GAMETYPE_AFFINITY_THRESHOLD) {
      tags.push({
        id: `arena-${topGT.key}`,
        label: `${topGT.key}-heavy`,
        description: `Most of their decisions sit inside ${topGT.key} games — that's the structural frame they inhabit.`,
        tone: "neutral",
      });
    }
  }

  return tags;
}

// Tailwind palette per archetype tone.
function archetypeToneClasses(tone: PlayerArchetype["tone"]): string {
  switch (tone) {
    case "win":           return "bg-emerald-400/15 text-emerald-300 border-emerald-400/25";
    case "loss":          return "bg-red-400/15 text-red-300 border-red-400/25";
    case "cooperation":   return "bg-sky-400/15 text-sky-300 border-sky-400/25";
    case "conflict":      return "bg-orange-400/15 text-orange-300 border-orange-400/25";
    case "moral":         return "bg-purple-400/15 text-purple-300 border-purple-400/25";
    case "strategic":     return "bg-amber-400/15 text-amber-300 border-amber-400/25";
    case "neutral":
    default:              return "bg-white/8 text-text-secondary border-white/15";
  }
}

function aggregate(
  narrative: NarrativeState,
  resolvedKeys: string[],
): Aggregate {
  // Collect games in narrative order
  const ordered: GameWithContext[] = [];
  resolvedKeys.forEach((key, i) => {
    const entry = resolveEntry(narrative, key);
    if (!entry || !isScene(entry)) return;
    const scene = entry;
    const analysis: SceneGameAnalysis | undefined = scene.gameAnalysis;
    if (!analysis) return;
    for (const g of analysis.games) {
      ordered.push({ game: g, sceneIndex: i, scene });
    }
  });

  const histories = computeEloHistories(ordered.map((o) => o.game));

  // Pass 2 — fill player profiles using histories and game state
  const profiles = new Map<string, PlayerProfile>();
  const ensure = (id: string, name: string): PlayerProfile => {
    let p = profiles.get(id);
    if (!p) {
      const h = histories.get(id);
      const ratings = h?.ratings ?? [ELO_INITIAL];
      p = {
        id,
        name,
        currentElo: ratings[ratings.length - 1] ?? ELO_INITIAL,
        peakElo: Math.max(...ratings),
        troughElo: Math.min(...ratings),
        eloHistory: ratings,
        eloVolatility: 0,
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        avgStakeDelta: 0,
        avgStakeAdvantage: 0,
        positiveCells: 0,
        negativeCells: 0,
        cellsBothGain: 0,
        cellsBothLose: 0,
        cellsSelfGainOtherLose: 0,
        cellsSelfLoseOtherGain: 0,
        sumRealizedRank: 0,
        sumRealizedRankTotal: 0,
        realizedNashCount: 0,
        asRoleA: 0,
        asRoleB: 0,
        gameTypeCounts: new Map(),
        axisCounts: new Map(),
        earlyGames: 0,
        lateGames: 0,
        earlyStakeSum: 0,
        lateStakeSum: 0,
        nemesisName: null,
        nemesisNetScore: 0,
        patronName: null,
        patronNetScore: 0,
        opponentCounts: new Map(),
        biggestUpset: null,
      };
      // Compute volatility = std-dev of per-step rating changes
      if (ratings.length > 1) {
        const deltas: number[] = [];
        for (let i = 1; i < ratings.length; i++) deltas.push(ratings[i] - ratings[i - 1]);
        const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
        const variance = deltas.reduce((s, d) => s + (d - mean) ** 2, 0) / deltas.length;
        p.eloVolatility = Math.sqrt(variance);
      }
      profiles.set(id, p);
    }
    return p;
  };

  let nashRealizedCount = 0;
  const offEq: GameWithContext[] = [];
  const pairMap = new Map<string, PairData>();
  const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  // Per-player stake history in narrative order — used after the main loop
  // to split each player's games into early / late halves relative to their
  // own timeline (so late-arriving characters still get a proper arc split).
  const stakeHistory = new Map<string, number[]>();

  // Track biggest single ELO swing
  let biggestSwing: Aggregate["biggestSingleUpset"] = null;
  const runningElo = new Map<string, number>();

  ordered.forEach((ctx, idx) => {
    const g = ctx.game;
    const pA = ensure(g.playerAId, resolvePlayerName(narrative, g.playerAId, g.playerAName));
    const pB = ensure(g.playerBId, resolvePlayerName(narrative, g.playerBId, g.playerBName));
    pA.games++;
    pB.games++;
    pA.asRoleA++;
    pB.asRoleB++;

    const realized = realizedOutcome(g);
    const deltaA = realized?.stakeDeltaA ?? 0;
    const deltaB = realized?.stakeDeltaB ?? 0;
    pA.avgStakeDelta += deltaA;
    pB.avgStakeDelta += deltaB;
    // Stake advantage — how much better (or worse) this realized cell is for
    // me vs for the counterpart. Lets the classifier separate balanced
    // mutual-gain (teammate) from lopsided mutual-gain where I take the big
    // slice (schemer / lopsided cooperator).
    pA.avgStakeAdvantage += deltaA - deltaB;
    pB.avgStakeAdvantage += deltaB - deltaA;

    // Per-player stake history — order of appearance, used to split into
    // early / late halves after the loop for arc-shift detection.
    if (!stakeHistory.has(g.playerAId)) stakeHistory.set(g.playerAId, []);
    if (!stakeHistory.has(g.playerBId)) stakeHistory.set(g.playerBId, []);
    stakeHistory.get(g.playerAId)!.push(deltaA);
    stakeHistory.get(g.playerBId)!.push(deltaB);
    if (deltaA > 0) pA.positiveCells++;
    else if (deltaA < 0) pA.negativeCells++;
    if (deltaB > 0) pB.positiveCells++;
    else if (deltaB < 0) pB.negativeCells++;

    // Relational outcome — mirror the pair-level classification onto each
    // player individually so the archetype classifier can read "how often
    // does this player land in extractor / sacrificial / team cells?".
    if (deltaA > 0 && deltaB > 0) { pA.cellsBothGain++; pB.cellsBothGain++; }
    else if (deltaA < 0 && deltaB < 0) { pA.cellsBothLose++; pB.cellsBothLose++; }
    else if (deltaA > 0 && deltaB < 0) { pA.cellsSelfGainOtherLose++; pB.cellsSelfLoseOtherGain++; }
    else if (deltaA < 0 && deltaB > 0) { pA.cellsSelfLoseOtherGain++; pB.cellsSelfGainOtherLose++; }

    // Game-type / axis participation tallies
    pA.gameTypeCounts.set(g.gameType, (pA.gameTypeCounts.get(g.gameType) ?? 0) + 1);
    pB.gameTypeCounts.set(g.gameType, (pB.gameTypeCounts.get(g.gameType) ?? 0) + 1);
    pA.axisCounts.set(g.actionAxis, (pA.axisCounts.get(g.actionAxis) ?? 0) + 1);
    pB.axisCounts.set(g.actionAxis, (pB.axisCounts.get(g.actionAxis) ?? 0) + 1);

    // Realized-cell rank for each player
    const rA = stakeRank(g, "A");
    if (rA) {
      pA.sumRealizedRank += rA.rank;
      pA.sumRealizedRankTotal += rA.total;
    }
    const rB = stakeRank(g, "B");
    if (rB) {
      pB.sumRealizedRank += rB.rank;
      pB.sumRealizedRankTotal += rB.total;
    }

    const scoreA = gameScoreA(g);
    if (scoreA === 1) { pA.wins++; pB.losses++; }
    else if (scoreA === 0) { pA.losses++; pB.wins++; }
    else { pA.draws++; pB.draws++; }

    // Nash compliance — is the realized cell a Nash equilibrium?
    const isNash = realizedIsNash(g);
    if (isNash) {
      pA.realizedNashCount++;
      pB.realizedNashCount++;
      nashRealizedCount++;
    } else {
      offEq.push(ctx);
    }

    // Opponents
    pA.opponentCounts.set(g.playerBId, (pA.opponentCounts.get(g.playerBId) ?? 0) + 1);
    pB.opponentCounts.set(g.playerAId, (pB.opponentCounts.get(g.playerAId) ?? 0) + 1);

    // Pairwise tracking — feeds both rivalries and coalitions
    const rk = pairKey(g.playerAId, g.playerBId);
    const [canonAId, canonBId] = g.playerAId < g.playerBId
      ? [g.playerAId, g.playerBId]
      : [g.playerBId, g.playerAId];
    const swapped = canonAId !== g.playerAId;

    let pd = pairMap.get(rk);
    if (!pd) {
      pd = {
        aId: canonAId,
        bId: canonBId,
        aName: resolvePlayerName(narrative, canonAId, swapped ? g.playerBName : g.playerAName),
        bName: resolvePlayerName(narrative, canonBId, swapped ? g.playerAName : g.playerBName),
        games: 0,
        aWins: 0,
        bWins: 0,
        draws: 0,
        bothPositive: 0,
        bothNegative: 0,
        conflict: 0,
        neutral: 0,
        cooperationRate: 0,
        conflictRate: 0,
        intensityScore: 0,
      };
      pairMap.set(rk, pd);
    }
    pd.games++;

    // Stake-sign outcome bucket (orientation-invariant)
    if (deltaA > 0 && deltaB > 0) pd.bothPositive++;
    else if (deltaA < 0 && deltaB < 0) pd.bothNegative++;
    else if ((deltaA > 0 && deltaB < 0) || (deltaA < 0 && deltaB > 0)) pd.conflict++;
    else pd.neutral++;

    // Win/loss/draw tracked from the canonical aId's perspective
    if (scoreA === 0.5) pd.draws++;
    else if ((scoreA === 1 && !swapped) || (scoreA === 0 && swapped)) pd.aWins++;
    else pd.bWins++;

    // Single-game ELO swing tracking
    const prevA = runningElo.get(g.playerAId) ?? ELO_INITIAL;
    const prevB = runningElo.get(g.playerBId) ?? ELO_INITIAL;
    const histA = histories.get(g.playerAId);
    const histB = histories.get(g.playerBId);
    // Find this game's post-rating in each history by game index alignment
    const idxA = histA?.games.indexOf(idx);
    const idxB = histB?.games.indexOf(idx);
    const postA = idxA !== undefined && idxA >= 0 ? histA!.ratings[idxA + 1] : prevA;
    const postB = idxB !== undefined && idxB >= 0 ? histB!.ratings[idxB + 1] : prevB;
    const swingA = postA - prevA;
    const swingB = postB - prevB;
    runningElo.set(g.playerAId, postA);
    runningElo.set(g.playerBId, postB);

    const bigger = Math.abs(swingA) > Math.abs(swingB)
      ? { id: g.playerAId, name: resolvePlayerName(narrative, g.playerAId, g.playerAName), swing: swingA }
      : { id: g.playerBId, name: resolvePlayerName(narrative, g.playerBId, g.playerBName), swing: swingB };
    if (!biggestSwing || Math.abs(bigger.swing) > Math.abs(biggestSwing.ratingGain)) {
      biggestSwing = {
        gameCtx: ctx,
        swinger: bigger.name,
        ratingGain: bigger.swing,
      };
    }

    // Per-player biggest upset (single-game positive gain)
    const updatePlayerUpset = (p: PlayerProfile, swing: number, opponentName: string) => {
      if (swing <= 0) return;
      if (!p.biggestUpset || swing > p.biggestUpset.ratingGain) {
        p.biggestUpset = { opponentName, ratingGain: swing, sceneIndex: ctx.sceneIndex };
      }
    };
    updatePlayerUpset(pA, swingA, resolvePlayerName(narrative, g.playerBId, g.playerBName));
    updatePlayerUpset(pB, swingB, resolvePlayerName(narrative, g.playerAId, g.playerAName));
  });

  // Finalise averages + temporal arc (early vs late stake)
  for (const p of profiles.values()) {
    if (p.games > 0) {
      p.avgStakeDelta /= p.games;
      p.avgStakeAdvantage /= p.games;
    }
    const history = stakeHistory.get(p.id) ?? [];
    if (history.length >= 4) {
      const half = Math.floor(history.length / 2);
      const early = history.slice(0, half);
      const late = history.slice(half);
      p.earlyGames = early.length;
      p.lateGames = late.length;
      p.earlyStakeSum = early.reduce((s, n) => s + n, 0);
      p.lateStakeSum = late.reduce((s, n) => s + n, 0);
    }
  }

  const profileList = Array.from(profiles.values()).sort((a, b) => b.currentElo - a.currentElo);

  // Finalise pair rates + intensity score
  const pairs = Array.from(pairMap.values());
  for (const p of pairs) {
    p.cooperationRate = p.games > 0 ? p.bothPositive / p.games : 0;
    p.conflictRate = p.games > 0 ? p.conflict / p.games : 0;
    // Intensity score: games * conflict * (1 + |wins asymmetry|)
    //   — rewards sustained conflict AND win/loss asymmetry
    const totalDecisive = p.aWins + p.bWins;
    const asymmetry = totalDecisive > 0
      ? Math.abs(p.aWins - p.bWins) / totalDecisive
      : 0;
    p.intensityScore = p.games * p.conflictRate * (1 + asymmetry);
  }

  // Nemesis / patron per player — scan pairs and tag each player's most
  // lopsided matchup (≥3 games) in both directions. Used by the classifier
  // to surface "has nemesis" / "has patron" when a player's identity is
  // shaped by a specific opposing or dominating relationship.
  for (const pd of pairs) {
    if (pd.games < 3) continue;
    const aProfile = profiles.get(pd.aId);
    const bProfile = profiles.get(pd.bId);
    const aNet = pd.aWins - pd.bWins; // + = A dominates
    const bNet = -aNet;
    if (aProfile) {
      if (aNet < aProfile.nemesisNetScore) {
        aProfile.nemesisNetScore = aNet;
        aProfile.nemesisName = pd.bName;
      }
      if (aNet > aProfile.patronNetScore) {
        aProfile.patronNetScore = aNet;
        aProfile.patronName = pd.bName;
      }
    }
    if (bProfile) {
      if (bNet < bProfile.nemesisNetScore) {
        bProfile.nemesisNetScore = bNet;
        bProfile.nemesisName = pd.aName;
      }
      if (bNet > bProfile.patronNetScore) {
        bProfile.patronNetScore = bNet;
        bProfile.patronName = pd.aName;
      }
    }
  }

  // Meaningful rivalries: ≥2 games, non-trivial conflict rate, sorted by intensity
  const rivalries = pairs
    .filter((p) => p.games >= 2 && p.conflictRate >= 0.33)
    .sort((a, b) => b.intensityScore - a.intensityScore);

  // Coalition detection via clique enumeration on strongly-cooperating pairs
  const coalitions = detectCoalitions(pairs, narrative);

  // Count scenes (not games) that have analyses
  const sceneSet = new Set(ordered.map((o) => o.scene.id));

  return {
    orderedGames: ordered,
    totalDecisions: ordered.length,
    scenesAnalysed: sceneSet.size,
    nashCompliance: ordered.length > 0 ? nashRealizedCount / ordered.length : 0,
    profiles: profileList,
    pairs,
    rivalries,
    coalitions,
    offEquilibriumGames: offEq,
    biggestSingleUpset: biggestSwing,
  };
}

// ── Coalition detection ────────────────────────────────────────────────────
// Find TIGHT groups where every pair has sustained cooperation — not just
// chains of "A cooperates with B, B cooperates with C". We use the classic
// Bron-Kerbosch algorithm to enumerate maximal cliques in a graph whose
// edges are strong cooperative bonds. Each clique is a coalition where
// EVERY member cooperates strongly with EVERY other member.
//
// The cohesion metric (weakest-link pair) is now non-trivially bounded from
// below by the threshold, so "0% cohesion" coalitions are impossible.

const COOPERATION_THRESHOLD = 0.6;   // ≥60% bothAdvance rate
const MIN_BOND_GAMES = 2;            // per-pair minimum
const MAX_COALITIONS_SHOWN = 10;

function pairLookupKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function detectCoalitions(
  pairs: PairData[],
  narrative: NarrativeState,
): Coalition[] {
  // Build the cooperation graph: vertex = player, edge = strong bond
  const neighbors = new Map<string, Set<string>>();
  const pairByKey = new Map<string, PairData>();
  for (const p of pairs) {
    pairByKey.set(pairLookupKey(p.aId, p.bId), p);
    if (p.games < MIN_BOND_GAMES || p.cooperationRate < COOPERATION_THRESHOLD) continue;
    if (!neighbors.has(p.aId)) neighbors.set(p.aId, new Set());
    if (!neighbors.has(p.bId)) neighbors.set(p.bId, new Set());
    neighbors.get(p.aId)!.add(p.bId);
    neighbors.get(p.bId)!.add(p.aId);
  }

  if (neighbors.size === 0) return [];

  // Bron-Kerbosch maximal clique enumeration (with pivoting).
  // Finds every set where all pairs are mutually connected — no loose chains.
  const cliques: string[][] = [];

  function bronKerbosch(r: Set<string>, p: Set<string>, x: Set<string>): void {
    if (p.size === 0 && x.size === 0) {
      if (r.size >= 2) cliques.push(Array.from(r));
      return;
    }
    // Pick a pivot from P ∪ X with maximum neighbours in P — standard
    // heuristic that dramatically prunes the search tree.
    const pUnionX = new Set([...p, ...x]);
    let pivot: string | null = null;
    let pivotScore = -1;
    for (const u of pUnionX) {
      const nu = neighbors.get(u) ?? new Set();
      let count = 0;
      for (const v of p) if (nu.has(v)) count++;
      if (count > pivotScore) {
        pivotScore = count;
        pivot = u;
      }
    }
    const pivotNeighbors = pivot ? neighbors.get(pivot) ?? new Set() : new Set<string>();
    const candidates = Array.from(p).filter((v) => !pivotNeighbors.has(v));
    for (const v of candidates) {
      const nv = neighbors.get(v) ?? new Set();
      const newR = new Set(r);
      newR.add(v);
      const newP = new Set<string>();
      const newX = new Set<string>();
      for (const u of p) if (nv.has(u)) newP.add(u);
      for (const u of x) if (nv.has(u)) newX.add(u);
      bronKerbosch(newR, newP, newX);
      p.delete(v);
      x.add(v);
    }
  }

  bronKerbosch(new Set(), new Set(neighbors.keys()), new Set());

  // Convert each clique to a Coalition with real stats, drop any clique where
  // we can't recover pair data (defensive), then rank.
  const coalitions: Coalition[] = [];
  for (const members of cliques) {
    let totalGames = 0;
    let totalCoop = 0;
    let minCoop = 1;
    let pairCount = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const pd = pairByKey.get(pairLookupKey(members[i], members[j]));
        if (!pd) continue;
        totalGames += pd.games;
        totalCoop += pd.cooperationRate;
        minCoop = Math.min(minCoop, pd.cooperationRate);
        pairCount++;
      }
    }
    if (pairCount === 0) continue;
    coalitions.push({
      memberIds: members,
      memberNames: members.map((id) => resolvePlayerName(narrative, id)),
      internalGames: totalGames,
      cooperationRate: totalCoop / pairCount,
      cohesion: minCoop,
      bondCount: pairCount,
    });
  }

  // Ranking: reward size, cohesion, and sustained play. log(games+1) keeps
  // a 40-game coalition from dominating over a 4-game one by 10×.
  coalitions.sort((a, b) => {
    const scoreA = a.memberIds.length * a.cohesion * Math.log(a.internalGames + 1);
    const scoreB = b.memberIds.length * b.cohesion * Math.log(b.internalGames + 1);
    return scoreB - scoreA;
  });

  return coalitions.slice(0, MAX_COALITIONS_SHOWN);
}

// ── Main component ──────────────────────────────────────────────────────────

export function GameTheoryDashboard({ narrative, resolvedKeys, onClose, onSelectScene }: Props) {
  const agg = useMemo(() => aggregate(narrative, resolvedKeys), [narrative, resolvedKeys]);

  return (
    <Modal onClose={onClose} size="6xl">
      <ModalHeader onClose={onClose}>
        <div className="flex items-baseline gap-3">
          <h2 className="text-[13px] font-semibold text-text-primary">
            Game Theory Dashboard
          </h2>
          <span className="text-[10px] text-text-dim/60">
            player ratings + narrative insights
          </span>
        </div>
      </ModalHeader>
      <ModalBody className="p-0">
        {agg.totalDecisions === 0 ? (
          <EmptyDashboard />
        ) : (
          <div className="p-6 flex flex-col gap-8">
            <KeyMetrics agg={agg} />
            <PlayerRankings
              agg={agg}
              onClose={onClose}
              onSelectScene={onSelectScene}
            />
            <div className="grid grid-cols-2 gap-6">
              <CoalitionsSection agg={agg} />
              <RivalriesSection agg={agg} />
            </div>
            <NarrativeInsights agg={agg} narrative={narrative} onClose={onClose} onSelectScene={onSelectScene} />
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────

function EmptyDashboard() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <p className="text-[12px] text-text-dim">No game analyses yet.</p>
      <p className="text-[10px] text-text-dim/50 max-w-md text-center leading-relaxed">
        Analyse one or more scenes from the{" "}
        <span className="font-mono text-text-dim/80">Game</span> scene mode, or
        use the palette&apos;s Auto button to analyse every scene at once.
      </p>
    </div>
  );
}

// ── Header metrics ──────────────────────────────────────────────────────────

function KeyMetrics({ agg }: { agg: Aggregate }) {
  const top = agg.profiles[0];
  const nashPct = (agg.nashCompliance * 100).toFixed(0);
  const nashColor =
    agg.nashCompliance > 0.7 ? "text-emerald-400" :
    agg.nashCompliance > 0.4 ? "text-amber-400" :
    "text-red-400";

  return (
    <div className="grid grid-cols-4 gap-3">
      <Stat
        label="Top player"
        value={top?.name ?? "—"}
        sub={top ? `${Math.round(top.currentElo)} ELO` : undefined}
        color="text-emerald-300"
        tip={GT_TIPS.elo}
      />
      <Stat label="Players" value={agg.profiles.length} sub={`across ${agg.scenesAnalysed} scenes`} />
      <Stat label="Decisions" value={agg.totalDecisions} sub="games recorded" />
      <Stat
        label="Nash compliance"
        value={`${nashPct}%`}
        color={nashColor}
        sub="chose equilibrium cell"
        tip={GT_TIPS.nashCompliance}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  color,
  tip,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  tip?: string;
}) {
  return (
    <div
      className="rounded-lg border border-white/8 bg-white/3 px-3 py-2.5"
      title={tip}
    >
      <div
        className={`text-[18px] font-semibold tabular-nums truncate ${
          color ?? "text-text-primary"
        }`}
        title={tip ?? String(value)}
      >
        {value}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-text-dim/60 font-semibold mt-1">
        {label}
      </div>
      {sub && <div className="text-[9px] text-text-dim/50 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Player rankings table ──────────────────────────────────────────────────

function PlayerRankings({
  agg,
  onClose,
  onSelectScene,
}: {
  agg: Aggregate;
  onClose: () => void;
  onSelectScene?: (sceneIndex: number) => void;
}) {
  const rows = agg.profiles;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-[10px] uppercase tracking-[0.15em] text-text-dim/70 font-semibold">
          Player Rankings
        </h3>
        <span className="text-[9px] text-text-dim/50">ELO starts at {ELO_INITIAL}</span>
      </div>
      <div className="rounded-lg border border-white/8 overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-white/3 text-text-dim/70 text-[9px] uppercase tracking-wider">
              <th className="text-left py-2 px-3 font-semibold w-8">#</th>
              <th className="text-left py-2 px-3 font-semibold">Player</th>
              <th className="text-right py-2 px-3 font-semibold" title={GT_TIPS.elo}>ELO</th>
              <th className="text-left py-2 px-3 font-semibold w-40" title={GT_TIPS.trajectorySparkline}>Trajectory</th>
              <th className="text-right py-2 px-3 font-semibold" title={GT_TIPS.wld}>W/L/D</th>
              <th className="text-center py-2 px-3 font-semibold" title={GT_TIPS.outcomeMix}>Outcome mix</th>
              <th className="text-right py-2 px-3 font-semibold" title={GT_TIPS.avgStake}>Avg stake</th>
              <th className="text-right py-2 px-3 font-semibold" title={GT_TIPS.nashCompliance}>Nash</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const totalCells = p.positiveCells + p.negativeCells;
              const posPct = totalCells > 0 ? (p.positiveCells / totalCells) * 100 : 0;
              const negPct = totalCells > 0 ? (p.negativeCells / totalCells) * 100 : 0;
              const nashPct = p.games > 0 ? (p.realizedNashCount / p.games) * 100 : null;
              const eloDelta = p.currentElo - ELO_INITIAL;

              return (
                <tr key={p.id} className="border-t border-white/5 hover:bg-white/3 transition-colors">
                  <td className="py-2.5 px-3 text-text-dim/50 tabular-nums">{i + 1}</td>
                  <td className="py-2.5 px-3">
                    <div className="text-text-primary font-medium truncate max-w-[220px]" title={p.name}>
                      {p.name}
                    </div>
                    <div className="text-[9px] text-text-dim/50 mt-0.5">
                      {p.games} games · peak {Math.round(p.peakElo)}
                    </div>
                    <ArchetypeTags tags={classifyPlayer(p)} />
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className={`font-semibold tabular-nums ${
                      eloDelta > 50 ? "text-emerald-400" :
                      eloDelta < -50 ? "text-red-400" :
                      "text-text-primary"
                    }`}>
                      {Math.round(p.currentElo)}
                    </div>
                    <div className={`text-[9px] tabular-nums ${
                      eloDelta > 0 ? "text-emerald-400/70" :
                      eloDelta < 0 ? "text-red-400/70" :
                      "text-text-dim/50"
                    }`}>
                      {eloDelta > 0 ? "+" : ""}{Math.round(eloDelta)}
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <Sparkline values={p.eloHistory} width={140} height={28} />
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums">
                    <span className="text-emerald-400/80">{p.wins}</span>
                    <span className="text-text-dim/40 mx-0.5">/</span>
                    <span className="text-red-400/80">{p.losses}</span>
                    <span className="text-text-dim/40 mx-0.5">/</span>
                    <span className="text-text-dim/60">{p.draws}</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="flex gap-px h-1.5 rounded-full overflow-hidden bg-white/5 w-32">
                        {posPct > 0 && (
                          <div className="bg-emerald-400/70 h-full" style={{ width: `${posPct}%` }} title="Realized cells with positive stake delta" />
                        )}
                        {negPct > 0 && (
                          <div className="bg-red-400/70 h-full" style={{ width: `${negPct}%` }} title="Realized cells with negative stake delta" />
                        )}
                      </div>
                      <div className="text-[9px] text-text-dim/60">
                        {outcomeMixLabel(posPct)}
                      </div>
                    </div>
                  </td>
                  <td className={`py-2.5 px-3 text-right tabular-nums ${
                    p.avgStakeDelta > 0.5 ? "text-emerald-300" :
                    p.avgStakeDelta < -0.5 ? "text-red-400/80" :
                    "text-text-secondary"
                  }`}>
                    {p.avgStakeDelta >= 0 ? "+" : ""}{p.avgStakeDelta.toFixed(1)}
                  </td>
                  <td className={`py-2.5 px-3 text-right tabular-nums font-medium ${
                    nashPct === null ? "text-text-dim/40" :
                    nashPct > 70 ? "text-emerald-400" :
                    nashPct > 40 ? "text-amber-400" :
                    "text-red-400"
                  }`}>
                    {nashPct === null ? "—" : `${nashPct.toFixed(0)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Column explanations */}
      <div className="flex items-center gap-4 mt-3 text-[9px] text-text-dim/50">
        <span>Outcome mix: <span className="text-emerald-400/80">gains</span> vs <span className="text-red-400/80">losses</span> in realized cells</span>
        <span>· Avg stake: mean stake delta per realized cell (-4..+4)</span>
        <span>· Nash: % of realized cells that are Nash equilibria</span>
      </div>
    </div>
  );
}

function outcomeMixLabel(posPct: number): string {
  if (posPct >= 80) return "winner";
  if (posPct >= 60) return "net gain";
  if (posPct >= 40) return "balanced";
  if (posPct >= 20) return "net loss";
  return "loser";
}

// ── Sparkline — inline ELO timeline ────────────────────────────────────────

// ── Archetype tag chips ────────────────────────────────────────────────────
// Capped at four chips; earlier entries are the more-distinctive tags since
// classifyPlayer emits them in priority order (outcome > trajectory >
// strategic > role > arena).

function ArchetypeTags({ tags }: { tags: PlayerArchetype[] }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, 4);
  return (
    <div className="flex items-center gap-1 flex-wrap mt-1">
      {shown.map((t) => (
        <span
          key={t.id}
          title={t.description}
          className={`text-[9px] px-1.5 py-px rounded-full border leading-none ${archetypeToneClasses(t.tone)}`}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
}

function Sparkline({
  values,
  width = 96,
  height = 24,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return (
      <div
        className="flex items-center text-[9px] text-text-dim/40"
        style={{ width, height }}
      >
        no change
      </div>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * step;
    const y = pad + h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = values[values.length - 1];
  const first = values[0];
  const up = last >= first;
  const color = up ? "rgb(52, 211, 153)" : "rgb(248, 113, 113)"; // emerald-400 / red-400

  // Last-point marker
  const [lastX, lastY] = points[points.length - 1].split(",").map(Number);

  return (
    <svg width={width} height={height} className="overflow-visible">
      {/* Baseline at initial rating for reference */}
      <line
        x1={pad}
        x2={width - pad}
        y1={pad + h - ((ELO_INITIAL - min) / range) * h}
        y2={pad + h - ((ELO_INITIAL - min) / range) * h}
        stroke="rgba(255,255,255,0.12)"
        strokeDasharray="2,2"
      />
      {/* Line */}
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Endpoint dot */}
      <circle cx={lastX} cy={lastY} r={2} fill={color} />
    </svg>
  );
}

// ── Narrative insights — callout cards ─────────────────────────────────────

function NarrativeInsights({
  agg,
  narrative,
  onClose,
  onSelectScene,
}: {
  agg: Aggregate;
  narrative: NarrativeState;
  onClose: () => void;
  onSelectScene?: (sceneIndex: number) => void;
}) {
  // Archetype exemplars — for each interesting archetype id, pick the
  // player who expresses it most strongly and surface them as a card. The
  // ranking metric per archetype is the same rate the classifier thresholds
  // on, so exemplars and tag chips stay consistent.
  const eligible = agg.profiles.filter((p) => p.games >= ARCHETYPE_MIN_GAMES);
  const pickTop = (
    score: (p: PlayerProfile) => number,
    minScore = 0,
  ): { player: PlayerProfile; score: number } | null => {
    let best: { player: PlayerProfile; score: number } | null = null;
    for (const p of eligible) {
      const s = score(p);
      if (s <= minScore) continue;
      if (!best || s > best.score) best = { player: p, score: s };
    }
    return best;
  };

  const extractor = pickTop((p) => p.cellsSelfGainOtherLose / p.games, 0.35);
  const sacrificer = pickTop((p) => p.cellsSelfLoseOtherGain / p.games, 0.25);
  const teammate = pickTop((p) => p.cellsBothGain / p.games, 0.4);
  const destroyer = pickTop((p) => p.cellsBothLose / p.games, 0.25);
  const mastermind = pickTop(
    (p) => (p.realizedNashCount / p.games) * (p.avgStakeDelta > 0 ? 1 : 0.5),
    0.5,
  );
  const offScript = pickTop(
    (p) => (p.games >= 5 && p.realizedNashCount / p.games <= 0.2 ? 1 - p.realizedNashCount / p.games : 0),
    0,
  );
  const ascendant = pickTop((p) => p.currentElo - ELO_INITIAL, 60);
  const fading = pickTop((p) => ELO_INITIAL - p.currentElo, 60);

  type Card = {
    label: string;
    name: string;
    sub: string;
    tone: PlayerArchetype["tone"];
  };
  const cards: Card[] = [];
  const push = (
    slot: ReturnType<typeof pickTop>,
    label: string,
    sub: (p: PlayerProfile, score: number) => string,
    tone: PlayerArchetype["tone"],
  ) => {
    if (!slot) return;
    cards.push({ label, name: slot.player.name, sub: sub(slot.player, slot.score), tone });
  };

  push(extractor, "extractor", (p, r) => `gains at cost ${(r * 100).toFixed(0)}% of the time (${p.cellsSelfGainOtherLose}/${p.games})`, "conflict");
  push(sacrificer, "sacrificial", (p, r) => `absorbs loss for others ${(r * 100).toFixed(0)}% of games`, "moral");
  push(teammate, "teammate", (p, r) => `mutual-gain in ${(r * 100).toFixed(0)}% of realized cells`, "cooperation");
  push(destroyer, "destructive", (p, r) => `mutual-loss in ${(r * 100).toFixed(0)}% of games`, "conflict");
  push(mastermind, "mastermind", (p) => `${((p.realizedNashCount / p.games) * 100).toFixed(0)}% of realized cells are Nash`, "strategic");
  push(offScript, "off-script", (p) => `only ${((p.realizedNashCount / p.games) * 100).toFixed(0)}% Nash-aligned across ${p.games} games`, "strategic");
  push(ascendant, "ascendant", (p) => `ELO +${Math.round(p.currentElo - ELO_INITIAL)} across ${p.games} games`, "win");
  push(fading, "fading", (p) => `ELO ${Math.round(p.currentElo - ELO_INITIAL)} across ${p.games} games`, "loss");

  // Top rivalry gets its own spot so the pair-level signal isn't lost.
  const topRivalry = agg.rivalries[0];

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-[10px] uppercase tracking-[0.15em] text-text-dim/70 font-semibold">
        Narrative Insights
      </h3>

      {/* Archetype exemplar cards — one card per characterising pattern */}
      {cards.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {cards.map((c, i) => (
            <div
              key={i}
              className={`rounded-lg border px-3 py-2.5 ${archetypeToneClasses(c.tone)}`}
            >
              <div className="text-[9px] uppercase tracking-wider opacity-70 font-semibold mb-1">
                {c.label}
              </div>
              <div className="text-[13px] font-semibold truncate text-text-primary" title={c.name}>
                {c.name}
              </div>
              <div className="text-[9px] text-text-dim/60 mt-0.5">{c.sub}</div>
            </div>
          ))}
          {topRivalry && (
            <div className="rounded-lg border border-white/15 bg-white/5 px-3 py-2.5">
              <div className="text-[9px] uppercase tracking-wider opacity-70 font-semibold mb-1">
                top rivalry
              </div>
              <div className="text-[13px] font-semibold truncate text-text-primary" title={`${topRivalry.aName} × ${topRivalry.bName}`}>
                {topRivalry.aName} × {topRivalry.bName}
              </div>
              <div className="text-[9px] text-text-dim/60 mt-0.5">
                {topRivalry.games} games · {topRivalry.aWins}-{topRivalry.bWins}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Biggest upset — single clickable callout */}
      {agg.biggestSingleUpset && (
        <BiggestUpset
          upset={agg.biggestSingleUpset}
          onClose={onClose}
          onSelectScene={onSelectScene}
        />
      )}

      {/* Off-equilibrium moments — condensed */}
      {agg.offEquilibriumGames.length > 0 && (
        <OffEquilibrium
          games={agg.offEquilibriumGames}
          narrative={narrative}
          onClose={onClose}
          onSelectScene={onSelectScene}
        />
      )}
    </div>
  );
}

// ── Coalitions section ────────────────────────────────────────────────────

function CoalitionsSection({ agg }: { agg: Aggregate }) {
  const coalitions = agg.coalitions;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-[10px] uppercase tracking-[0.15em] text-text-dim/70 font-semibold">
          Coalitions
        </h3>
        <span className="text-[9px] text-text-dim/50">
          tight cliques · every pair cooperates {">"}60%
        </span>
      </div>
      <div className="rounded-lg border border-white/8 overflow-hidden">
        {coalitions.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[11px] text-text-dim/70">No meaningful coalitions detected.</p>
          </div>
        ) : (
          coalitions.slice(0, 6).map((c, i) => (
            <CoalitionRow key={i} coalition={c} rank={i + 1} pairs={agg.pairs} isFirst={i === 0} />
          ))
        )}
      </div>
    </div>
  );
}

// Natural-language cohesion label
function cohesionTier(cohesion: number): { label: string; color: string } {
  if (cohesion >= 0.85) return { label: "ironclad", color: "text-emerald-400" };
  if (cohesion >= 0.75) return { label: "tight", color: "text-emerald-400" };
  if (cohesion >= 0.65) return { label: "strong", color: "text-emerald-400/80" };
  return { label: "loose", color: "text-amber-400" };
}

function CoalitionRow({
  coalition,
  rank,
  pairs,
  isFirst,
}: {
  coalition: Coalition;
  rank: number;
  pairs: PairData[];
  isFirst: boolean;
}) {
  const cohesionPct = Math.round(coalition.cohesion * 100);
  const coopPct = Math.round(coalition.cooperationRate * 100);
  const tier = cohesionTier(coalition.cohesion);

  // Strongest pair within the coalition
  const members = new Set(coalition.memberIds);
  const flagship = pairs
    .filter((p) => members.has(p.aId) && members.has(p.bId) && p.games > 0)
    .slice()
    .sort((a, b) => b.cooperationRate * b.games - a.cooperationRate * a.games)[0];

  return (
    <div
      className={`px-3 py-3 hover:bg-white/3 transition-colors ${
        isFirst ? "" : "border-t border-white/5"
      }`}
    >
      {/* Top row: rank · tier · meta · cohesion */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[11px] text-text-dim/50 tabular-nums w-4 shrink-0 text-right">
          {rank}
        </span>
        <span className={`text-[10px] uppercase tracking-wider font-semibold ${tier.color}`}>
          {tier.label}
        </span>
        <span className="text-[10px] text-text-dim/60 tabular-nums">
          {coalition.memberIds.length} members · {coalition.bondCount} bonds · {coalition.internalGames} games
        </span>
        {/* Cohesion bar + value — primary metric */}
        <div className="flex items-center gap-2 ml-auto min-w-0">
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden w-24 shrink-0">
            <div
              className="h-full rounded-full bg-emerald-400/80"
              style={{ width: `${cohesionPct}%` }}
              title="Weakest-link cooperation rate"
            />
          </div>
          <span
            className={`text-[11px] font-medium tabular-nums w-10 text-right ${
              cohesionPct >= 75 ? "text-emerald-400" :
              cohesionPct >= 65 ? "text-emerald-400/80" :
              "text-amber-400"
            }`}
          >
            {cohesionPct}%
          </span>
        </div>
      </div>

      {/* Members — monochrome, aligned with left padding matching rank column */}
      <div className="flex items-center gap-1.5 flex-wrap pl-7 mb-1.5">
        {coalition.memberNames.map((name, i) => (
          <span
            key={i}
            className="text-[11px] text-text-primary bg-white/5 border border-white/8 px-1.5 py-px rounded"
          >
            {name}
          </span>
        ))}
      </div>

      {/* Flagship pair — subtle bottom line */}
      {flagship && (
        <div className="flex items-baseline gap-2 pl-7 text-[9px] text-text-dim/55 tabular-nums">
          <span className="uppercase tracking-wider">strongest</span>
          <span className="text-text-secondary">{flagship.aName}</span>
          <span className="text-text-dim/40">×</span>
          <span className="text-text-secondary">{flagship.bName}</span>
          <span>— {Math.round(flagship.cooperationRate * 100)}% over {flagship.games} games</span>
          <span className="ml-auto">avg coop {coopPct}%</span>
        </div>
      )}
    </div>
  );
}

// ── Rivalries section ─────────────────────────────────────────────────────

function RivalriesSection({ agg }: { agg: Aggregate }) {
  const rivalries = agg.rivalries;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-[10px] uppercase tracking-[0.15em] text-text-dim/70 font-semibold">
          Rivalries
        </h3>
        <span className="text-[9px] text-text-dim/50">
          pairs with sustained conflict ≥33%
        </span>
      </div>
      <div className="rounded-lg border border-white/8 overflow-hidden">
        {rivalries.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[11px] text-text-dim/70">No meaningful rivalries detected.</p>
          </div>
        ) : (
          rivalries.slice(0, 6).map((r, i) => (
            <RivalryRow key={i} rivalry={r} rank={i + 1} isFirst={i === 0} />
          ))
        )}
      </div>
    </div>
  );
}

// Classify the strategic shape of the rivalry from its stake-sign outcome mix
function rivalryTag(rivalry: PairData): { label: string; color: string } {
  const totalDecisive = rivalry.aWins + rivalry.bWins;
  const asymmetry = totalDecisive > 0 ? Math.abs(rivalry.aWins - rivalry.bWins) / totalDecisive : 0;
  if (asymmetry >= 0.7 && rivalry.games >= 4) return { label: "one-sided", color: "text-red-400" };
  if (rivalry.bothNegative / Math.max(rivalry.games, 1) >= 0.4) return { label: "mutual loss", color: "text-red-400" };
  if (rivalry.conflict / Math.max(rivalry.games, 1) >= 0.5) return { label: "zero-sum clash", color: "text-amber-400" };
  if (asymmetry <= 0.2 && rivalry.games >= 4) return { label: "even match", color: "text-amber-400" };
  return { label: "contested", color: "text-red-400/80" };
}

function RivalryRow({
  rivalry,
  rank,
  isFirst,
}: {
  rivalry: PairData;
  rank: number;
  isFirst: boolean;
}) {
  const conflictPct = Math.round(rivalry.conflictRate * 100);
  const totalDecisive = rivalry.aWins + rivalry.bWins;
  const tag = rivalryTag(rivalry);

  // Leader + margin
  const leaderName = rivalry.aWins >= rivalry.bWins ? rivalry.aName : rivalry.bName;
  const margin = Math.abs(rivalry.aWins - rivalry.bWins);

  // Dominant outcome mode
  const dominantOutcome =
    rivalry.bothNegative > rivalry.conflict
      ? { label: "mutual loss", count: rivalry.bothNegative }
      : { label: "zero-sum clash", count: rivalry.conflict };

  return (
    <div
      className={`px-3 py-3 hover:bg-white/3 transition-colors ${
        isFirst ? "" : "border-t border-white/5"
      }`}
    >
      {/* Top row: rank · tag · games · conflict% */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[11px] text-text-dim/50 tabular-nums w-4 shrink-0 text-right">
          {rank}
        </span>
        <span className={`text-[10px] uppercase tracking-wider font-semibold ${tag.color}`}>
          {tag.label}
        </span>
        <span className="text-[10px] text-text-dim/60 tabular-nums">
          {rivalry.games} games
          {rivalry.draws > 0 && ` · ${rivalry.draws}d`}
        </span>
        {/* Conflict bar — primary metric */}
        <div className="flex items-center gap-2 ml-auto min-w-0">
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden w-24 shrink-0">
            <div
              className="h-full rounded-full bg-red-400/80"
              style={{ width: `${conflictPct}%` }}
              title="Conflict rate — zero-sum-style realized cells"
            />
          </div>
          <span
            className={`text-[11px] font-medium tabular-nums w-10 text-right ${
              conflictPct >= 70 ? "text-red-400" :
              conflictPct >= 50 ? "text-red-400/80" :
              "text-amber-400"
            }`}
          >
            {conflictPct}%
          </span>
        </div>
      </div>

      {/* Matchup + head-to-head record */}
      <div className="flex items-center gap-3 pl-7 mb-1.5 text-[12px]">
        <span className="text-text-primary font-medium truncate">{rivalry.aName}</span>
        <span className="text-[10px] tabular-nums font-mono shrink-0">
          <span className={rivalry.aWins > rivalry.bWins ? "text-emerald-400" : rivalry.aWins < rivalry.bWins ? "text-red-400/80" : "text-text-secondary"}>
            {rivalry.aWins}
          </span>
          <span className="text-text-dim/40 mx-1">–</span>
          <span className={rivalry.bWins > rivalry.aWins ? "text-emerald-400" : rivalry.bWins < rivalry.aWins ? "text-red-400/80" : "text-text-secondary"}>
            {rivalry.bWins}
          </span>
        </span>
        <span className="text-text-primary font-medium truncate">{rivalry.bName}</span>
        {/* Mini record bar */}
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden flex ml-auto w-20 shrink-0">
          {rivalry.aWins > 0 && (
            <div
              className="h-full bg-white/70"
              style={{ width: `${totalDecisive > 0 ? (rivalry.aWins / totalDecisive) * 100 : 0}%` }}
            />
          )}
          {rivalry.bWins > 0 && (
            <div
              className="h-full bg-red-400/70"
              style={{ width: `${totalDecisive > 0 ? (rivalry.bWins / totalDecisive) * 100 : 0}%` }}
            />
          )}
        </div>
      </div>

      {/* Context line: who leads + signature mode + intensity */}
      <div className="flex items-baseline gap-2 pl-7 text-[9px] text-text-dim/55 tabular-nums">
        {margin === 0 ? (
          <span>tied — neither leads</span>
        ) : (
          <span>
            <span className="text-text-secondary">{leaderName}</span> leads by {margin}
          </span>
        )}
        <span className="text-text-dim/30">·</span>
        <span>
          signature <span className="text-text-secondary">{dominantOutcome.label}</span> ({dominantOutcome.count}/{rivalry.games})
        </span>
        <span
          className="ml-auto font-mono text-amber-400/80"
          title="Composite intensity: games × conflict × win asymmetry"
        >
          intensity {rivalry.intensityScore.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

function BiggestUpset({
  upset,
  onClose,
  onSelectScene,
}: {
  upset: NonNullable<Aggregate["biggestSingleUpset"]>;
  onClose: () => void;
  onSelectScene?: (sceneIndex: number) => void;
}) {
  const gain = upset.ratingGain;
  const up = gain >= 0;
  return (
    <button
      onClick={() => {
        onSelectScene?.(upset.gameCtx.sceneIndex);
        onClose();
      }}
      className="text-left rounded-lg border border-white/8 bg-white/3 px-3 py-2.5 hover:bg-white/5 transition-colors"
    >
      <div className="text-[9px] uppercase tracking-wider text-text-dim/60 font-semibold mb-1">
        Biggest ELO swing
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold text-text-primary">
          {upset.swinger}
        </span>
        <span className={`text-[12px] font-mono font-semibold ${up ? "text-emerald-400" : "text-red-400"}`}>
          {up ? "+" : ""}{Math.round(gain)} ELO
        </span>
        <span className="text-[9px] text-text-dim/50 ml-auto">
          scene {upset.gameCtx.sceneIndex + 1}
        </span>
      </div>
      <div className="text-[10px] text-text-dim/60 mt-1 truncate">
        {upset.gameCtx.game.beatExcerpt || upset.gameCtx.game.rationale}
      </div>
    </button>
  );
}

// ── Off-equilibrium list ───────────────────────────────────────────────────

function OffEquilibrium({
  games,
  narrative,
  onClose,
  onSelectScene,
}: {
  games: GameWithContext[];
  narrative: NarrativeState;
  onClose: () => void;
  onSelectScene?: (sceneIndex: number) => void;
}) {
  const top = games.slice(0, 5);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="text-[9px] uppercase tracking-[0.15em] text-text-dim/60 font-semibold">
          Off-equilibrium moments
        </h4>
        <span className="text-[9px] text-text-dim/40">
          {games.length} total · chosen cell ≠ Nash
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {top.map(({ game, sceneIndex }, i) => {
          const ne = nashEquilibria(game);
          const idealLabel =
            ne.length > 0
              ? ne
                  .map((p) => `${p.aActionName} × ${p.bActionName}`)
                  .join(" · ")
              : "—";
          const realizedLabel = `${game.realizedAAction} × ${game.realizedBAction}`;
          const aName = resolvePlayerName(narrative, game.playerAId, game.playerAName);
          const bName = resolvePlayerName(narrative, game.playerBId, game.playerBName);
          return (
            <button
              key={i}
              onClick={() => {
                onSelectScene?.(sceneIndex);
                onClose();
              }}
              className="text-left flex items-center gap-3 px-3 py-2 rounded-md border border-white/5 hover:bg-white/3 transition-colors"
            >
              <span className="text-[9px] font-mono tabular-nums text-text-dim/50 w-10 shrink-0">
                S{sceneIndex + 1}
              </span>
              <span
                className="text-[9px] font-mono font-semibold text-amber-300 w-32 shrink-0 truncate"
                title={`realized: ${realizedLabel}`}
              >
                {realizedLabel}
              </span>
              <span
                className="text-[9px] text-text-dim/40 w-28 shrink-0 truncate"
                title={`nash: ${idealLabel}`}
              >
                → {idealLabel}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-text-secondary truncate">
                  {aName} × {bName}
                </div>
                {game.rationale && (
                  <div className="text-[9px] text-text-dim/60 truncate mt-0.5">
                    {game.rationale}
                  </div>
                )}
              </div>
            </button>
          );
        })}
        {games.length > top.length && (
          <div className="text-[9px] text-text-dim/50 italic pl-3 pt-1">
            +{games.length - top.length} more
          </div>
        )}
      </div>
    </div>
  );
}
