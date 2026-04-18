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
  dominantStrategy,
  ELO_INITIAL,
  equilibriumMove,
  gameScoreA,
  isOptimalPlay,
  nashEquilibria,
  outcomeKeyFor,
  playedKey,
  playedOutcome,
  resolvePlayerName,
} from "@/lib/game-theory";
import { resolveEntry, isScene } from "@/types/narrative";
import type {
  BeatGame,
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
  // Playstyle
  advances: number;   // played C
  blocks: number;     // played D
  avgPayoff: number;
  nashMoves: number;      // games where their action matched NE action
  nashAvailable: number;  // games with a uniquely-determined NE action for them
  dominantStrategiesHeld: number;
  // Role preference
  asRoleA: number;
  asRoleB: number;
  // Social
  opponentCounts: Map<string, number>;
  biggestUpset: { opponentName: string; ratingGain: number; sceneIndex: number } | null;
};

/** Pairwise play data — the raw building block for rivalries and coalitions. */
type PairData = {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  games: number;
  // Win/loss/draw from A's perspective
  aWins: number;
  bWins: number;
  draws: number;
  // Outcome counts between this specific pair
  bothAdvance: number;     // both cooperated
  bothBlock: number;       // mutual conflict
  mixed: number;           // one advanced, one blocked (asymmetric clash)
  // Derived rates (0-1)
  cooperationRate: number; // bothAdvance / games
  conflictRate: number;    // (mixed + bothBlock) / games
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
        advances: 0,
        blocks: 0,
        avgPayoff: 0,
        nashMoves: 0,
        nashAvailable: 0,
        dominantStrategiesHeld: 0,
        asRoleA: 0,
        asRoleB: 0,
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

  let totalPayoffA = 0;
  let totalPayoffB = 0;
  let optimalPlays = 0;
  const offEq: GameWithContext[] = [];
  const pairMap = new Map<string, PairData>();
  const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

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

    const outcome = playedOutcome(g);
    pA.avgPayoff += outcome.payoffA;
    pB.avgPayoff += outcome.payoffB;
    totalPayoffA += outcome.payoffA;
    totalPayoffB += outcome.payoffB;

    const scoreA = gameScoreA(g);
    if (scoreA === 1) { pA.wins++; pB.losses++; }
    else if (scoreA === 0) { pA.losses++; pB.wins++; }
    else { pA.draws++; pB.draws++; }

    // Moves played
    if (g.playerAPlayed === "advance") pA.advances++; else pA.blocks++;
    if (g.playerBPlayed === "advance") pB.advances++; else pB.blocks++;

    // Equilibrium-move compliance (per-player, independent of opponent)
    const aEq = equilibriumMove(g, "A");
    if (aEq) {
      pA.nashAvailable++;
      if (aEq === g.playerAPlayed) pA.nashMoves++;
    }
    const bEq = equilibriumMove(g, "B");
    if (bEq) {
      pB.nashAvailable++;
      if (bEq === g.playerBPlayed) pB.nashMoves++;
    }

    // Nash-cell optimality (legacy definition for top-level compliance)
    if (isOptimalPlay(g)) optimalPlays++;
    else offEq.push(ctx);

    // Dominant strategies
    const dom = dominantStrategy(g);
    if (dom.player === "A" || dom.player === "both") pA.dominantStrategiesHeld++;
    if (dom.player === "B" || dom.player === "both") pB.dominantStrategiesHeld++;

    // Opponents
    pA.opponentCounts.set(g.playerBId, (pA.opponentCounts.get(g.playerBId) ?? 0) + 1);
    pB.opponentCounts.set(g.playerAId, (pB.opponentCounts.get(g.playerAId) ?? 0) + 1);

    // Pairwise tracking — feeds both rivalries and coalitions
    const rk = pairKey(g.playerAId, g.playerBId);
    // Orient the pair canonically (aId < bId) so we consistently count from
    // the same perspective regardless of which side was Player A in the game.
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
        bothAdvance: 0,
        bothBlock: 0,
        mixed: 0,
        cooperationRate: 0,
        conflictRate: 0,
        intensityScore: 0,
      };
      pairMap.set(rk, pd);
    }
    pd.games++;

    // Outcome bucket (swap-aware so both orientations agree)
    const outcomeKey = outcomeKeyFor(g.playerAPlayed, g.playerBPlayed);
    if (outcomeKey === "bothAdvance") pd.bothAdvance++;
    else if (outcomeKey === "bothBlock") pd.bothBlock++;
    else pd.mixed++;

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

  // Finalise averages
  for (const p of profiles.values()) {
    if (p.games > 0) p.avgPayoff /= p.games;
  }

  const profileList = Array.from(profiles.values()).sort((a, b) => b.currentElo - a.currentElo);

  // Finalise pair rates + intensity score
  const pairs = Array.from(pairMap.values());
  for (const p of pairs) {
    p.cooperationRate = p.games > 0 ? p.bothAdvance / p.games : 0;
    p.conflictRate = p.games > 0 ? (p.bothBlock + p.mixed) / p.games : 0;
    // Intensity score: games * conflict * (1 + |wins asymmetry|)
    //   — rewards sustained conflict AND win/loss asymmetry
    const totalDecisive = p.aWins + p.bWins;
    const asymmetry = totalDecisive > 0
      ? Math.abs(p.aWins - p.bWins) / totalDecisive
      : 0;
    p.intensityScore = p.games * p.conflictRate * (1 + asymmetry);
  }

  // Meaningful rivalries: ≥2 games, non-trivial conflict rate, sorted by intensity
  const rivalries = pairs
    .filter((p) => p.games >= 2 && p.conflictRate >= 0.33)
    .sort((a, b) => b.intensityScore - a.intensityScore);

  // Coalition detection via union-find on strongly-cooperating pairs
  const coalitions = detectCoalitions(pairs, narrative);

  // Count scenes (not games) that have analyses
  const sceneSet = new Set(ordered.map((o) => o.scene.id));

  return {
    orderedGames: ordered,
    totalDecisions: ordered.length,
    scenesAnalysed: sceneSet.size,
    nashCompliance: ordered.length > 0 ? optimalPlays / ordered.length : 0,
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
      />
      <Stat label="Players" value={agg.profiles.length} sub={`across ${agg.scenesAnalysed} scenes`} />
      <Stat label="Decisions" value={agg.totalDecisions} sub="games recorded" />
      <Stat
        label="Nash compliance"
        value={`${nashPct}%`}
        color={nashColor}
        sub="chose equilibrium cell"
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/3 px-3 py-2.5">
      <div
        className={`text-[18px] font-semibold tabular-nums truncate ${
          color ?? "text-text-primary"
        }`}
        title={String(value)}
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
              <th className="text-right py-2 px-3 font-semibold">ELO</th>
              <th className="text-left py-2 px-3 font-semibold w-40">Trajectory</th>
              <th className="text-right py-2 px-3 font-semibold">W/L/D</th>
              <th className="text-center py-2 px-3 font-semibold">Playstyle</th>
              <th className="text-right py-2 px-3 font-semibold">Payoff</th>
              <th className="text-right py-2 px-3 font-semibold">Nash</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const totalMoves = p.advances + p.blocks;
              const advancePct = totalMoves > 0 ? (p.advances / totalMoves) * 100 : 0;
              const blockPct = totalMoves > 0 ? (p.blocks / totalMoves) * 100 : 0;
              const nashPct = p.nashAvailable > 0 ? (p.nashMoves / p.nashAvailable) * 100 : null;
              const eloDelta = p.currentElo - ELO_INITIAL;

              return (
                <tr key={p.id} className="border-t border-white/5 hover:bg-white/3 transition-colors">
                  <td className="py-2.5 px-3 text-text-dim/50 tabular-nums">{i + 1}</td>
                  <td className="py-2.5 px-3">
                    <div className="text-text-primary font-medium truncate max-w-[180px]" title={p.name}>
                      {p.name}
                    </div>
                    <div className="text-[9px] text-text-dim/50 mt-0.5">
                      {p.games} games · peak {Math.round(p.peakElo)}
                    </div>
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
                        {advancePct > 0 && (
                          <div className="bg-emerald-400/70 h-full" style={{ width: `${advancePct}%` }} />
                        )}
                        {blockPct > 0 && (
                          <div className="bg-red-400/70 h-full" style={{ width: `${blockPct}%` }} />
                        )}
                      </div>
                      <div className="text-[9px] text-text-dim/60">
                        {playstyleLabel(advancePct)}
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-text-secondary">
                    {p.avgPayoff.toFixed(1)}
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
        <span><span className="text-emerald-400/80">advance</span> vs <span className="text-red-400/80">block</span> distribution</span>
        <span>· Payoff: mean 0-4 from chosen cells</span>
        <span>· Nash: % of games where the player&apos;s action matched their equilibrium action</span>
      </div>
    </div>
  );
}

function playstyleLabel(advancePct: number): string {
  if (advancePct >= 80) return "cooperator";
  if (advancePct >= 60) return "lean coop";
  if (advancePct >= 40) return "balanced";
  if (advancePct >= 20) return "lean block";
  return "blocker";
}

// ── Sparkline — inline ELO timeline ────────────────────────────────────────

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
  // Most consistent player = lowest volatility (with at least 5 games)
  const consistent = agg.profiles
    .filter((p) => p.games >= 5)
    .sort((a, b) => a.eloVolatility - b.eloVolatility)[0];

  // Most volatile = highest volatility
  const volatile = agg.profiles
    .filter((p) => p.games >= 5)
    .sort((a, b) => b.eloVolatility - a.eloVolatility)[0];

  // Most aggressive (highest block rate)
  const aggressive = agg.profiles
    .filter((p) => p.advances + p.blocks >= 3)
    .sort((a, b) => {
      const ra = a.blocks / Math.max(a.advances + a.blocks, 1);
      const rb = b.blocks / Math.max(b.advances + b.blocks, 1);
      return rb - ra;
    })[0];

  // Most cooperative
  const cooperative = agg.profiles
    .filter((p) => p.advances + p.blocks >= 3)
    .sort((a, b) => {
      const ra = a.advances / Math.max(a.advances + a.blocks, 1);
      const rb = b.advances / Math.max(b.advances + b.blocks, 1);
      return rb - ra;
    })[0];

  // Best tactician — highest nash-move rate
  const tactician = agg.profiles
    .filter((p) => p.nashAvailable >= 3)
    .sort((a, b) => {
      const ra = a.nashMoves / Math.max(a.nashAvailable, 1);
      const rb = b.nashMoves / Math.max(b.nashAvailable, 1);
      return rb - ra;
    })[0];

  // Top rivalry
  const topRivalry = agg.rivalries[0];

  const cards: Array<{ label: string; value: string; sub?: string; accent: string }> = [];
  if (consistent) {
    cards.push({
      label: "Most consistent",
      value: consistent.name,
      sub: `σ = ${consistent.eloVolatility.toFixed(1)} per game`,
      accent: "text-sky-300",
    });
  }
  if (volatile) {
    cards.push({
      label: "Most volatile",
      value: volatile.name,
      sub: `σ = ${volatile.eloVolatility.toFixed(1)} per game`,
      accent: "text-orange-300",
    });
  }
  if (aggressive) {
    const rate = (aggressive.blocks / Math.max(aggressive.advances + aggressive.blocks, 1)) * 100;
    cards.push({
      label: "Most aggressive",
      value: aggressive.name,
      sub: `blocks ${rate.toFixed(0)}% of moves`,
      accent: "text-red-300",
    });
  }
  if (cooperative) {
    const rate = (cooperative.advances / Math.max(cooperative.advances + cooperative.blocks, 1)) * 100;
    cards.push({
      label: "Most cooperative",
      value: cooperative.name,
      sub: `advances ${rate.toFixed(0)}% of moves`,
      accent: "text-emerald-300",
    });
  }
  if (tactician) {
    const rate = (tactician.nashMoves / Math.max(tactician.nashAvailable, 1)) * 100;
    cards.push({
      label: "Best tactician",
      value: tactician.name,
      sub: `${rate.toFixed(0)}% equilibrium-aligned`,
      accent: "text-amber-300",
    });
  }
  if (topRivalry) {
    cards.push({
      label: "Top rivalry",
      value: `${topRivalry.aName} × ${topRivalry.bName}`,
      sub: `${topRivalry.games} games · ${topRivalry.aWins}-${topRivalry.bWins}`,
      accent: "text-white",
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-[10px] uppercase tracking-[0.15em] text-text-dim/70 font-semibold">
        Narrative Insights
      </h3>

      {/* Insight cards */}
      {cards.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {cards.map((c, i) => (
            <div
              key={i}
              className="rounded-lg border border-white/8 bg-white/3 px-3 py-2.5"
            >
              <div className="text-[9px] uppercase tracking-wider text-text-dim/60 font-semibold mb-1">
                {c.label}
              </div>
              <div className={`text-[13px] font-semibold truncate ${c.accent}`} title={c.value}>
                {c.value}
              </div>
              {c.sub && (
                <div className="text-[9px] text-text-dim/50 mt-0.5">{c.sub}</div>
              )}
            </div>
          ))}
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

// Classify the strategic shape of the rivalry from its outcome mix
function rivalryTag(rivalry: PairData): { label: string; color: string } {
  const totalDecisive = rivalry.aWins + rivalry.bWins;
  const asymmetry = totalDecisive > 0 ? Math.abs(rivalry.aWins - rivalry.bWins) / totalDecisive : 0;
  if (asymmetry >= 0.7 && rivalry.games >= 4) return { label: "one-sided", color: "text-red-400" };
  if (rivalry.bothBlock / Math.max(rivalry.games, 1) >= 0.4) return { label: "mutual hostility", color: "text-red-400" };
  if (rivalry.mixed / Math.max(rivalry.games, 1) >= 0.5) return { label: "asymmetric clash", color: "text-amber-400" };
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
    rivalry.bothBlock > rivalry.mixed
      ? { label: "both block", count: rivalry.bothBlock }
      : { label: "asymmetric clash", count: rivalry.mixed };

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
              title="Conflict rate (bothBlock + mixed outcomes)"
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
          const ideal = ne.size > 0 ? [...ne].join("/") : "—";
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
              <span className="text-[9px] font-mono font-semibold text-amber-300 w-20 shrink-0 truncate" title={playedKey(game)}>
                {playedKey(game)}
              </span>
              <span className="text-[9px] text-text-dim/40 w-12 shrink-0">
                → {ideal}
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
