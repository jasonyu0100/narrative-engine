/**
 * Game-Theoretic Extraction Engine
 *
 * Extracts a unified game-theoretic model from the narrative state.
 * Built on a first-principles foundation:
 *
 * 1. Every n-player thread decomposes into n(n-1)/2 pairwise 2×2 games.
 *    The 2×2 game is the atom — all game theory composes from it.
 *
 * 2. A game is defined by its PAYOFF ORDERING, not by a name. We don't
 *    classify into "prisoner's dilemma" or "chicken" — we compute the
 *    structural alignment between each pair of players from:
 *    - Relationship valence (directed, -1 to +1)
 *    - World-graph cross-references (who studies whom)
 *    - World-graph depth ratio (information advantage)
 *    - Goal compatibility (shared vs conflicting objectives)
 *
 * 3. Move attribution: when thread log nodes carry actorIds/targetIds/stance,
 *    moves are attributed to specific players. Without attribution, moves
 *    are classified from primitives alone (lossy but backward-compatible).
 *
 * 4. Single-participant threads are CHALLENGES (player vs environment),
 *    not games. No pairwise decomposition — no strategic opponent.
 *
 * 5. Fate = the sum of all pairwise game outcomes across scenes. Each
 *    scene is a round. Thread lifecycle transitions are game-state
 *    transitions. The narrative IS the game history.
 *
 * Fully deterministic — no LLM calls.
 */

import type {
  NarrativeState,
  PayoffMatrix,
  ThreadLogNode,
  ThreadLogNodeType,
} from '@/types/narrative';

// ── Output types ────────────────────────────────────────────────────────────

export type MoveType = 'invest' | 'advance' | 'block' | 'exploit' | 'reveal' | 'hold' | 'deadlock';

export type GameMove = {
  nodeId: string;
  content: string;
  primitive: ThreadLogNodeType;
  moveType: MoveType;
  actorId: string | null;
  targetId: string | null;
  stance: 'cooperative' | 'competitive' | 'neutral';
  /** Which payoff matrix cell this move falls into — declared by the LLM. */
  matrixCell: 'cc' | 'cd' | 'dc' | 'dd' | null;
  attributed: boolean;
};

export type PlayerProfile = {
  id: string;
  name: string;
  kind: 'character' | 'location' | 'artifact';
  posture: 'strategist' | 'operator' | 'reactive' | 'vulnerable' | 'mixed';
  worldDepth: number;
  composition: { belief: number; capability: number; state: number; trait: number; goal: number; weakness: number };
  beliefs: string[];
  capabilities: string[];
  goals: string[];
};

export type PlayerBond = {
  from: string;
  to: string;
  valence: number;
  type: string;
};

export type InfoAsymmetry = {
  advantaged: string;
  disadvantaged: string;
  forwardRefs: number;
  reverseRefs: number;
  ratio: number;
};

export type Trajectory = 'momentum' | 'contested' | 'stalled' | 'volatile' | 'developing';

/**
 * Derived properties of a 2×2 game computed from payoff rankings.
 * These are the structural features that determine strategic dynamics.
 */
export type GameProperties = {
  /** Does either player have a dominant strategy (always better regardless of opponent)? */
  hasDominantStrategy: boolean;
  /** Which player has the dominant strategy, if any. */
  dominantPlayer: 'A' | 'B' | 'both' | null;
  /** Nash equilibrium cell(s) — outcomes where neither player benefits from unilateral deviation. */
  nashEquilibria: ('cc' | 'cd' | 'dc' | 'dd')[];
  /** Is the game zero-sum? (one player's gain = other's loss in every cell). */
  isZeroSum: boolean;
  /** Is mutual cooperation the best outcome for both? (coordination game). */
  isMutuallyBeneficial: boolean;
  /** Is there a temptation to defect from cooperation? (social dilemma). */
  hasSocialDilemma: boolean;
  /** Pareto optimal cells — no other cell makes both players better off. */
  paretoOptimal: ('cc' | 'cd' | 'dc' | 'dd')[];
};

/**
 * The atom: a pairwise 2×2 game between two participants within a thread.
 */
export type PairwiseGame = {
  playerA: string;
  playerB: string;
  stakeA: string | null;
  stakeB: string | null;
  stakesAvailable: boolean;
  /** The 2×2 payoff matrix — null if not declared by the LLM. */
  matrix: PayoffMatrix | null;
  /** Computed game properties — null if no matrix. */
  properties: GameProperties | null;
  infoAdvantage: number;
  depthRatio: number;
  infoAsymmetry: InfoAsymmetry | null;
};

/** A thread decomposed into its constituent pairwise games. */
export type ThreadGame = {
  threadId: string;
  question: string;
  gameState: 'setup' | 'midgame' | 'committed' | 'endgame' | 'resolved' | 'broken';
  isChallenge: boolean;
  players: PlayerProfile[];
  pairwiseGames: PairwiseGame[];
  moves: GameMove[];
  moveSequence: string;
  trajectory: Trajectory;
  moveBalance: { cooperative: number; competitive: number; neutral: number; total: number };
  momentum: number;
  volatility: number;
  dependencies: string[];
};

export type Coalition = {
  members: { id: string; name: string }[];
  sharedGames: string[];
  avgValence: number;
  hasInternalTension: boolean;
};

export type PlayerPosition = {
  id: string;
  name: string;
  totalGames: number;
  momentumGames: number;
  stalledGames: number;
  contestedGames: number;
  endgameGames: number;
  overallPosture: 'dominant' | 'pressured' | 'embattled' | 'balanced';
};

export type SystemRule = {
  id: string;
  content: string;
  type: string;
  connections: number;
};

export type GameState = {
  threadGames: ThreadGame[];
  coalitions: Coalition[];
  playerPositions: PlayerPosition[];
  systemRules: SystemRule[];
  summary: {
    totalPlayers: number;
    totalGames: number;
    totalPairwiseGames: number;
    activeGames: number;
    challenges: number;
    globalCooperationRatio: number;
    mostConnectedPlayer: { id: string; name: string; gameCount: number } | null;
  };
};

// ── Classification constants ────────────────────────────────────────────────

const PRIMITIVE_TO_MOVE: Record<ThreadLogNodeType, MoveType> = {
  setup: 'invest', escalation: 'advance', transition: 'advance',
  payoff: 'advance', resistance: 'block', twist: 'exploit',
  callback: 'reveal', pulse: 'hold', stall: 'deadlock',
};

const COOPERATIVE_MOVES = new Set<MoveType>(['invest', 'advance']);
const COMPETITIVE_MOVES = new Set<MoveType>(['block', 'exploit']);

function stanceToMoveType(stance: 'cooperative' | 'competitive' | 'neutral', primitive: ThreadLogNodeType): MoveType {
  if (stance === 'cooperative') return primitive === 'setup' ? 'invest' : 'advance';
  if (stance === 'competitive') return primitive === 'resistance' ? 'block' : 'exploit';
  return PRIMITIVE_TO_MOVE[primitive] ?? 'hold';
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function statusToGameState(status: string): ThreadGame['gameState'] {
  switch (status) {
    case 'latent': case 'seeded': return 'setup';
    case 'active': return 'midgame';
    case 'escalating': return 'committed';
    case 'critical': return 'endgame';
    case 'resolved': return 'resolved';
    case 'subverted': case 'abandoned': return 'broken';
    default: return 'midgame';
  }
}

function classifyPosture(counts: Record<string, number>, total: number): PlayerProfile['posture'] {
  if (total < 3) return 'mixed';
  const beliefPct = (counts.belief ?? 0) / total;
  const capPct = (counts.capability ?? 0) / total;
  const statePct = (counts.state ?? 0) / total;
  const weakPct = (counts.weakness ?? 0) / total;
  if (beliefPct >= capPct && beliefPct > 0.3) return 'strategist';
  if (capPct > beliefPct && capPct > 0.3) return 'operator';
  if (statePct > 0.25) return 'reactive';
  if (weakPct > 0.15) return 'vulnerable';
  return 'mixed';
}

function classifyTrajectory(moves: MoveType[]): Trajectory {
  const total = moves.length;
  if (total === 0) return 'developing';
  const adv = moves.filter((m) => COOPERATIVE_MOVES.has(m)).length;
  const blk = moves.filter((m) => m === 'block').length;
  const exp = moves.filter((m) => m === 'exploit').length;
  const hld = moves.filter((m) => m === 'hold' || m === 'deadlock').length;
  if (adv > hld * 2 && blk === 0) return 'momentum';
  if (blk >= 2) return 'contested';
  if (hld > adv) return 'stalled';
  if (exp >= 2) return 'volatile';
  return 'developing';
}

// ── Game property computation from 2×2 payoff matrix ────────────────────────

function computeGameProperties(matrix: PayoffMatrix, perspectiveA: string): GameProperties {
  // Normalise so playerA in the matrix matches perspectiveA
  const flipped = matrix.playerA !== perspectiveA;
  const pA = (cell: { payoffA: number; payoffB: number }) => flipped ? cell.payoffB : cell.payoffA;
  const pB = (cell: { payoffA: number; payoffB: number }) => flipped ? cell.payoffA : cell.payoffB;

  const cells = { cc: matrix.cc, cd: matrix.cd, dc: matrix.dc, dd: matrix.dd };
  const cellKeys = ['cc', 'cd', 'dc', 'dd'] as const;

  // Dominant strategy: A cooperates dominates if pA(cc) > pA(dc) AND pA(cd) > pA(dd)
  const aCoopDominates = pA(cells.cc) > pA(cells.dc) && pA(cells.cd) > pA(cells.dd);
  const aDefDominates = pA(cells.dc) > pA(cells.cc) && pA(cells.dd) > pA(cells.cd);
  const bCoopDominates = pB(cells.cc) > pB(cells.cd) && pB(cells.dc) > pB(cells.dd);
  const bDefDominates = pB(cells.cd) > pB(cells.cc) && pB(cells.dd) > pB(cells.dc);

  const aDominant = aCoopDominates || aDefDominates;
  const bDominant = bCoopDominates || bDefDominates;
  const dominantPlayer = aDominant && bDominant ? 'both' : aDominant ? 'A' : bDominant ? 'B' : null;

  // Nash equilibria: cells where neither player benefits from unilateral deviation
  const nashEquilibria: ('cc' | 'cd' | 'dc' | 'dd')[] = [];
  // CC is NE if A doesn't gain by switching to D (pA(cc) >= pA(dc)) and B doesn't gain by switching to D (pB(cc) >= pB(cd))
  if (pA(cells.cc) >= pA(cells.dc) && pB(cells.cc) >= pB(cells.cd)) nashEquilibria.push('cc');
  if (pA(cells.cd) >= pA(cells.dd) && pB(cells.cd) >= pB(cells.cc)) nashEquilibria.push('cd');
  if (pA(cells.dc) >= pA(cells.cc) && pB(cells.dc) >= pB(cells.dd)) nashEquilibria.push('dc');
  if (pA(cells.dd) >= pA(cells.cd) && pB(cells.dd) >= pB(cells.dc)) nashEquilibria.push('dd');

  // Zero-sum: payoffs always sum to the same value
  const sums = cellKeys.map((k) => pA(cells[k]) + pB(cells[k]));
  const isZeroSum = sums.every((s) => s === sums[0]);

  // Mutual benefit: CC is the highest-payoff cell for both players
  const maxA = Math.max(pA(cells.cc), pA(cells.cd), pA(cells.dc), pA(cells.dd));
  const maxB = Math.max(pB(cells.cc), pB(cells.cd), pB(cells.dc), pB(cells.dd));
  const isMutuallyBeneficial = pA(cells.cc) === maxA && pB(cells.cc) === maxB;

  // Social dilemma: CC is better for both than DD, but each is tempted to defect
  const hasSocialDilemma = pA(cells.cc) > pA(cells.dd) && pB(cells.cc) > pB(cells.dd) &&
    pA(cells.dc) > pA(cells.cc) && pB(cells.cd) > pB(cells.cc);

  // Pareto optimal: no other cell makes both players strictly better off
  const paretoOptimal: ('cc' | 'cd' | 'dc' | 'dd')[] = [];
  for (const k of cellKeys) {
    const dominated = cellKeys.some(
      (other) => other !== k && pA(cells[other]) >= pA(cells[k]) && pB(cells[other]) >= pB(cells[k]) &&
        (pA(cells[other]) > pA(cells[k]) || pB(cells[other]) > pB(cells[k])),
    );
    if (!dominated) paretoOptimal.push(k);
  }

  return {
    hasDominantStrategy: aDominant || bDominant,
    dominantPlayer,
    nashEquilibria,
    isZeroSum,
    isMutuallyBeneficial,
    hasSocialDilemma,
    paretoOptimal,
  };
}

// ── Main extraction ─────────────────────────────────────────────────────────

export function extractGameState(narrative: NarrativeState): GameState {
  const threads = Object.values(narrative.threads);
  const chars = narrative.characters;
  const locs = narrative.locations;
  const arts = narrative.artifacts;

  // Build a comprehensive name lookup. Thread participants may reference entities
  // that don't exist in the entity maps (LLM-generated phantom IDs). For those,
  // scan thread log content for the entity name pattern.
  const participantNames = new Map<string, string>();
  for (const thread of threads) {
    for (const p of thread.participants) {
      if (!participantNames.has(p.id)) {
        // Try to extract a name from log nodes that mention this ID as actor
        const logNodes = Object.values(thread.threadLog?.nodes ?? {});
        for (const n of logNodes) {
          if (n.actorId === p.id || n.targetId === p.id) {
            // The content often starts with the entity name
            const firstWord = n.content.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
            if (firstWord) {
              participantNames.set(p.id, firstWord[1]);
              break;
            }
          }
        }
      }
    }
  }

  const nameOf = (id: string): string =>
    chars[id]?.name ?? locs[id]?.name ?? arts[id]?.name ?? participantNames.get(id) ?? id;

  const kindOf = (id: string): PlayerProfile['kind'] => {
    if (chars[id]) return 'character';
    if (locs[id]) return 'location';
    return 'artifact';
  };

  // ── Player profiles ─────────────────────────────────────────────────────

  const profileCache = new Map<string, PlayerProfile>();
  const getProfile = (id: string): PlayerProfile => {
    const cached = profileCache.get(id);
    if (cached) return cached;
    const entity = chars[id] ?? locs[id] ?? arts[id];
    const world = entity && 'world' in entity
      ? (entity as { world?: { nodes?: Record<string, { type?: string; content: string }> } }).world
      : undefined;
    const nodes = Object.values(world?.nodes ?? {});
    const total = nodes.length;
    const counts: Record<string, number> = {};
    for (const n of nodes) counts[n.type ?? 'unknown'] = (counts[n.type ?? 'unknown'] ?? 0) + 1;
    const pct = (k: string) => total > 0 ? Math.round(((counts[k] ?? 0) / total) * 100) : 0;
    const profile: PlayerProfile = {
      id, name: nameOf(id), kind: kindOf(id),
      posture: classifyPosture(counts, total),
      worldDepth: total,
      composition: {
        belief: pct('belief'), capability: pct('capability'), state: pct('state'),
        trait: pct('trait'), goal: pct('goal'), weakness: pct('weakness'),
      },
      beliefs: nodes.filter((n) => n.type === 'belief').map((n) => n.content),
      capabilities: nodes.filter((n) => n.type === 'capability').map((n) => n.content),
      goals: nodes.filter((n) => n.type === 'goal').map((n) => n.content),
    };
    profileCache.set(id, profile);
    return profile;
  };

  // ── Bonds ───────────────────────────────────────────────────────────────

  const allBonds: PlayerBond[] = [];
  for (const rel of Object.values(narrative.relationships ?? {})) {
    if (!rel || typeof rel !== 'object') continue;
    const r = rel as { from?: string; fromId?: string; to?: string; toId?: string; valence?: number; type?: string };
    const fromId = r.from ?? r.fromId;
    const toId = r.to ?? r.toId;
    if (fromId && toId) {
      allBonds.push({
        from: fromId, to: toId,
        valence: typeof r.valence === 'number' ? r.valence : 0,
        type: typeof r.type === 'string' ? r.type : 'unknown',
      });
    }
  }

  // ── Cross-reference asymmetries ─────────────────────────────────────────

  const charEntries = Object.entries(chars);
  const globalInfoAsym = new Map<string, InfoAsymmetry>();
  for (const [idA, charA] of charEntries) {
    const nodesA = Object.values((charA as { world?: { nodes?: Record<string, { content: string }> } }).world?.nodes ?? {});
    const textsA = nodesA.map((n) => n.content);
    for (const [idB, charB] of charEntries) {
      if (idA >= idB) continue;
      const nameB = (charB as { name: string }).name;
      const lastB = nameB.split(' ').pop() ?? '';
      const aRefsB = textsA.filter((t) => t.includes(nameB) || (lastB.length > 2 && t.includes(lastB))).length;
      const nodesB = Object.values((charB as { world?: { nodes?: Record<string, { content: string }> } }).world?.nodes ?? {});
      const textsB = nodesB.map((n) => n.content);
      const nameA = (charA as { name: string }).name;
      const lastA = nameA.split(' ').pop() ?? '';
      const bRefsA = textsB.filter((t) => t.includes(nameA) || (lastA.length > 2 && t.includes(lastA))).length;
      if (aRefsB === 0 && bRefsA === 0) continue;
      const [adv, dis, fwd, rev] = aRefsB >= bRefsA ? [idA, idB, aRefsB, bRefsA] : [idB, idA, bRefsA, aRefsB];
      globalInfoAsym.set(`${idA}|${idB}`, {
        advantaged: adv, disadvantaged: dis,
        forwardRefs: fwd, reverseRefs: rev,
        ratio: rev > 0 ? fwd / rev : Infinity,
      });
    }
  }

  // ── Pairwise alignment computation ──────────────────────────────────────

  function computePairwise(aId: string, bId: string, thread: { participants: { id: string; stake?: string }[]; payoffMatrices?: PayoffMatrix[] }): PairwiseGame {
    const profA = getProfile(aId);
    const profB = getProfile(bId);

    // Stakes from thread participants
    const partA = thread.participants.find((p) => p.id === aId);
    const partB = thread.participants.find((p) => p.id === bId);
    const stakeA = partA?.stake?.trim() || null;
    const stakeB = partB?.stake?.trim() || null;

    // Info asymmetry
    const key1 = `${aId}|${bId}`;
    const key2 = `${bId}|${aId}`;
    const infoAsymmetry = globalInfoAsym.get(key1) ?? globalInfoAsym.get(key2) ?? null;

    let infoAdvantage = 0;
    if (infoAsymmetry) {
      infoAdvantage = infoAsymmetry.advantaged === aId
        ? infoAsymmetry.forwardRefs - infoAsymmetry.reverseRefs
        : -(infoAsymmetry.forwardRefs - infoAsymmetry.reverseRefs);
    }

    const dA = profA.worldDepth;
    const dB = profB.worldDepth;
    const depthRatio = Math.min(dA, dB) > 0 ? Math.max(dA, dB) / Math.min(dA, dB) : (Math.max(dA, dB) > 0 ? Infinity : 1);

    // Find payoff matrix — match by player pair (order-independent).
    // First try exact ID match. If that fails, try name-based match to handle
    // phantom IDs where the LLM used a different ID for the same entity.
    const matrices = thread.payoffMatrices ?? [];
    let matrix = matrices.find(
      (m) => (m.playerA === aId && m.playerB === bId) || (m.playerA === bId && m.playerB === aId),
    ) ?? null;
    if (!matrix) {
      const aName = nameOf(aId);
      const bName = nameOf(bId);
      matrix = matrices.find((m) => {
        const mA = nameOf(m.playerA);
        const mB = nameOf(m.playerB);
        return (mA === aName && mB === bName) || (mA === bName && mB === aName);
      }) ?? null;
    }

    const properties = matrix ? computeGameProperties(matrix, aId) : null;

    return { playerA: aId, playerB: bId, stakeA, stakeB, stakesAvailable: !!(stakeA && stakeB), matrix, properties, infoAdvantage, depthRatio, infoAsymmetry };
  }

  // ── Thread games ────────────────────────────────────────────────────────

  const threadGames: ThreadGame[] = [];
  const playerGameCount = new Map<string, number>();
  const playerTrajectories = new Map<string, Trajectory[]>();

  for (const thread of threads) {
    const participantIds = thread.participants.map((p) => p.id);
    const players = participantIds.map(getProfile);
    const isChallenge = players.length <= 1;

    // Pairwise decomposition
    const pairwiseGames: PairwiseGame[] = [];
    for (let i = 0; i < participantIds.length; i++) {
      for (let j = i + 1; j < participantIds.length; j++) {
        pairwiseGames.push(computePairwise(participantIds[i], participantIds[j], thread));
      }
    }

    // Moves
    const logNodes = Object.values(thread.threadLog?.nodes ?? {}) as ThreadLogNode[];
    const moves: GameMove[] = logNodes.map((n) => {
      const actorId = n.actorId ?? null;
      const targetId = n.targetId ?? null;
      const stance = n.stance ?? 'neutral';
      const matrixCell = (n.matrixCell === 'cc' || n.matrixCell === 'cd' || n.matrixCell === 'dc' || n.matrixCell === 'dd') ? n.matrixCell : null;
      return {
        nodeId: n.id, content: n.content, primitive: n.type,
        moveType: n.stance ? stanceToMoveType(n.stance, n.type) : (PRIMITIVE_TO_MOVE[n.type] ?? 'hold'),
        actorId, targetId, stance, matrixCell,
        attributed: !!actorId,
      };
    });
    const moveTypes = moves.map((m) => m.moveType);
    const moveSequence = logNodes.map((n) => n.type[0].toUpperCase()).join('');
    const cooperative = moveTypes.filter((m) => COOPERATIVE_MOVES.has(m)).length;
    const competitive = moveTypes.filter((m) => COMPETITIVE_MOVES.has(m)).length;
    const neutral = moveTypes.length - cooperative - competitive;
    const total = moveTypes.length;
    const trajectory = classifyTrajectory(moveTypes);

    threadGames.push({
      threadId: thread.id,
      question: thread.description,
      gameState: statusToGameState(thread.status),
      isChallenge,
      players,
      pairwiseGames,
      moves,
      moveSequence,
      trajectory,
      moveBalance: { cooperative, competitive, neutral, total },
      momentum: total > 0 ? (cooperative - neutral) / total : 0,
      volatility: total > 0 ? competitive / total : 0,
      dependencies: thread.dependents,
    });

    for (const pid of participantIds) {
      playerGameCount.set(pid, (playerGameCount.get(pid) ?? 0) + 1);
      const trajs = playerTrajectories.get(pid) ?? [];
      trajs.push(trajectory);
      playerTrajectories.set(pid, trajs);
    }
  }

  // ── Coalitions ──────────────────────────────────────────────────────────

  const coalitions: Coalition[] = [];
  const playerIds = Array.from(profileCache.keys());
  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      const a = playerIds[i];
      const b = playerIds[j];
      const shared = threadGames
        .filter((g) => g.players.some((p) => p.id === a) && g.players.some((p) => p.id === b))
        .map((g) => g.threadId);
      if (shared.length < 2) continue;
      const pairBonds = allBonds.filter(
        (bd) => (bd.from === a && bd.to === b) || (bd.from === b && bd.to === a),
      );
      const avgValence = pairBonds.length > 0
        ? pairBonds.reduce((s, bd) => s + bd.valence, 0) / pairBonds.length
        : NaN;
      coalitions.push({
        members: [{ id: a, name: nameOf(a) }, { id: b, name: nameOf(b) }],
        sharedGames: shared,
        avgValence,
        hasInternalTension: pairBonds.some((bd) => bd.valence < -0.2),
      });
    }
  }
  coalitions.sort((a, b) => b.sharedGames.length - a.sharedGames.length);

  // ── Player positions ────────────────────────────────────────────────────

  const playerPositions: PlayerPosition[] = [];
  for (const [id, count] of Array.from(playerGameCount.entries())) {
    const trajs = playerTrajectories.get(id) ?? [];
    const momentumGames = trajs.filter((t) => t === 'momentum').length;
    const stalledGames = trajs.filter((t) => t === 'stalled').length;
    const contestedGames = trajs.filter((t) => t === 'contested' || t === 'volatile').length;
    const endgameGames = threadGames.filter(
      (g) => g.gameState === 'endgame' && g.players.some((p) => p.id === id),
    ).length;
    let overallPosture: PlayerPosition['overallPosture'];
    if (momentumGames > contestedGames + stalledGames) overallPosture = 'dominant';
    else if (stalledGames > momentumGames) overallPosture = 'pressured';
    else if (contestedGames > 2) overallPosture = 'embattled';
    else overallPosture = 'balanced';
    playerPositions.push({
      id, name: nameOf(id), totalGames: count,
      momentumGames, stalledGames, contestedGames, endgameGames, overallPosture,
    });
  }
  playerPositions.sort((a, b) => b.totalGames - a.totalGames);

  // ── System rules ────────────────────────────────────────────────────────

  const sysNodes = Object.values(narrative.systemGraph?.nodes ?? {});
  const sysEdges = narrative.systemGraph?.edges ?? [];
  const connectivity: Record<string, number> = {};
  for (const e of sysEdges) {
    connectivity[e.from] = (connectivity[e.from] ?? 0) + 1;
    connectivity[e.to] = (connectivity[e.to] ?? 0) + 1;
  }
  const systemRules: SystemRule[] = sysNodes.map((n) => ({
    id: n.id, content: n.concept, type: n.type, connections: connectivity[n.id] ?? 0,
  }));
  systemRules.sort((a, b) => b.connections - a.connections);

  // ── Summary ─────────────────────────────────────────────────────────────

  const totalMoves = threadGames.reduce((s, g) => s + g.moveBalance.total, 0);
  const totalCoop = threadGames.reduce((s, g) => s + g.moveBalance.cooperative, 0);
  const active = threadGames.filter((g) => g.gameState !== 'resolved' && g.gameState !== 'broken');
  const challenges = threadGames.filter((g) => g.isChallenge).length;
  const totalPairwise = threadGames.reduce((s, g) => s + g.pairwiseGames.length, 0);

  let mostConnected: GameState['summary']['mostConnectedPlayer'] = null;
  for (const [id, count] of Array.from(playerGameCount.entries())) {
    if (!mostConnected || count > mostConnected.gameCount) {
      mostConnected = { id, name: nameOf(id), gameCount: count };
    }
  }

  return {
    threadGames,
    coalitions,
    playerPositions,
    systemRules,
    summary: {
      totalPlayers: profileCache.size,
      totalGames: threadGames.length,
      totalPairwiseGames: totalPairwise,
      activeGames: active.length,
      challenges,
      globalCooperationRatio: totalMoves > 0 ? totalCoop / totalMoves : 0,
      mostConnectedPlayer: mostConnected,
    },
  };
}

// ── Serialization ───────────────────────────────────────────────────────────

export function formatThreadGame(g: ThreadGame): string {
  const lines: string[] = [];
  const type = g.isChallenge ? 'challenge' : `${g.pairwiseGames.length} pairwise`;
  lines.push(`THREAD: ${g.threadId} [${g.gameState}] [${g.trajectory}] (${type})`);
  lines.push(`  Q: ${g.question}`);
  lines.push(`  Players: ${g.players.map((p) => `${p.name} (${p.posture}, depth ${p.worldDepth})`).join(', ')}`);

  // Pairwise games — the real strategic structure
  for (const pw of g.pairwiseGames) {
    const aName = g.players.find((p) => p.id === pw.playerA)?.name ?? pw.playerA;
    const bName = g.players.find((p) => p.id === pw.playerB)?.name ?? pw.playerB;
    const stakeLabel = pw.stakesAvailable ? `"${pw.stakeA}" vs "${pw.stakeB}"` : 'stakes unknown';
    const infoLabel = pw.infoAdvantage > 0 ? `${aName} +${pw.infoAdvantage}` : pw.infoAdvantage < 0 ? `${bName} +${-pw.infoAdvantage}` : 'symmetric';
    const depthLabel = pw.depthRatio === Infinity ? '∞' : pw.depthRatio > 1.5 ? pw.depthRatio.toFixed(1) : '~1';
    lines.push(`  ${aName} × ${bName}: ${stakeLabel} | info=${infoLabel} depth=${depthLabel}:1`);
  }

  const { cooperative: c, competitive: x, neutral: n, total: t } = g.moveBalance;
  if (t > 0) {
    lines.push(`  Moves: ${t} (${c} coop, ${x} comp, ${n} neut) momentum=${(g.momentum * 100).toFixed(0)}% volatility=${(g.volatility * 100).toFixed(0)}%`);
    if (g.moveSequence) lines.push(`  Sequence: ${g.moveSequence}`);
  }

  if (g.dependencies.length > 0) lines.push(`  Depends: ${g.dependencies.join(', ')}`);
  return lines.join('\n');
}

export function formatGameSummary(state: GameState): string {
  const lines: string[] = [];
  const s = state.summary;
  lines.push(`GAME STATE — ${s.totalPlayers} players, ${s.totalGames} threads (${s.totalPairwiseGames} pairwise games, ${s.challenges} challenges)`);
  lines.push(`Active: ${s.activeGames} | Cooperation: ${(s.globalCooperationRatio * 100).toFixed(0)}%`);
  if (s.mostConnectedPlayer) lines.push(`Hub: ${s.mostConnectedPlayer.name} (${s.mostConnectedPlayer.gameCount} threads)`);
  lines.push('');

  lines.push('PLAYERS:');
  for (const p of state.playerPositions.slice(0, 10)) {
    lines.push(`  ${p.name} — ${p.overallPosture} (${p.totalGames} threads, ${p.momentumGames} momentum, ${p.stalledGames} stalled, ${p.endgameGames} endgame)`);
  }
  lines.push('');

  const byState = new Map<string, ThreadGame[]>();
  for (const g of state.threadGames) {
    const list = byState.get(g.gameState) ?? [];
    list.push(g);
    byState.set(g.gameState, list);
  }

  for (const gameState of ['endgame', 'committed', 'midgame', 'setup', 'broken', 'resolved']) {
    const games = byState.get(gameState);
    if (!games || games.length === 0) continue;
    lines.push(`── ${gameState.toUpperCase()} (${games.length}) ──`);
    for (const g of games) {
      lines.push(formatThreadGame(g));
      lines.push('');
    }
  }

  if (state.coalitions.length > 0) {
    lines.push('── COALITIONS ──');
    for (const c of state.coalitions.slice(0, 10)) {
      const names = c.members.map((m) => m.name).join(' × ');
      const val = isNaN(c.avgValence) ? 'no bond data' : `valence ${c.avgValence.toFixed(2)}`;
      const tension = c.hasInternalTension ? ' [TENSION]' : '';
      lines.push(`  ${names} — ${c.sharedGames.length} shared (${val})${tension}`);
    }
    lines.push('');
  }

  const hubs = state.systemRules.filter((r) => r.connections >= 2);
  if (hubs.length > 0) {
    lines.push('── RULE HUBS ──');
    for (const r of hubs.slice(0, 8)) {
      lines.push(`  [${r.id}] ${r.type}: ${r.content.slice(0, 100)} (${r.connections} connections)`);
    }
  }

  return lines.join('\n');
}

// ── Dashboard computation ───────────────────────────────────────────────────

export type PlayerGTO = {
  id: string;
  name: string;
  totalMoves: number;
  declaredMoves: number;
  gtoMoves: number;
  gtoRate: number;
  coopRate: number;
  initiated: number;
  targeted: number;
  initiativeRatio: number;
  exploitations: number;
  exploited: number;
  netExploitation: number;
  posture: string;
  overallPosture: string;
};

export function computePlayerGTO(state: GameState): PlayerGTO[] {
  const stats = new Map<string, PlayerGTO>();

  const ensure = (id: string) => {
    if (stats.has(id)) return stats.get(id)!;
    const pos = state.playerPositions.find((p) => p.id === id);
    const prof = state.threadGames.flatMap((g) => g.players).find((p) => p.id === id);
    const s: PlayerGTO = {
      id, name: pos?.name ?? id,
      totalMoves: 0, declaredMoves: 0, gtoMoves: 0, gtoRate: 0, coopRate: 0,
      initiated: 0, targeted: 0, initiativeRatio: 0,
      exploitations: 0, exploited: 0, netExploitation: 0,
      posture: prof?.posture ?? 'mixed',
      overallPosture: pos?.overallPosture ?? 'balanced',
    };
    stats.set(id, s);
    return s;
  };

  for (const g of state.threadGames) {
    for (const m of g.moves) {
      if (m.actorId) {
        const s = ensure(m.actorId);
        s.totalMoves++;
        s.initiated++;
        if (m.matrixCell) {
          s.declaredMoves++;
          if (m.matrixCell === 'dc') s.exploitations++;
          if (m.matrixCell === 'cd') s.exploited++;
          for (const pw of g.pairwiseGames) {
            if (!pw.properties?.nashEquilibria.length) continue;
            const ne = pw.properties.nashEquilibria[0];
            const isA = m.actorId === pw.playerA;
            const isB = m.actorId === pw.playerB;
            if (!isA && !isB) continue;
            const gtoAction = isA ? ne[0] : ne[1];
            if (m.matrixCell[0] === gtoAction) s.gtoMoves++;
            break;
          }
          if (m.matrixCell[0] === 'c') s.coopRate++;
        }
      }
      if (m.targetId) ensure(m.targetId).targeted++;
    }
  }

  const result: PlayerGTO[] = [];
  for (const s of stats.values()) {
    s.gtoRate = s.declaredMoves > 0 ? s.gtoMoves / s.declaredMoves : 0;
    s.coopRate = s.declaredMoves > 0 ? s.coopRate / s.declaredMoves : 0;
    s.initiativeRatio = s.targeted > 0 ? s.initiated / s.targeted : s.initiated > 0 ? Infinity : 0;
    s.netExploitation = s.exploitations - s.exploited;
    result.push(s);
  }
  result.sort((a, b) => b.totalMoves - a.totalMoves);
  return result;
}

export type ThreatEntry = {
  threadId: string;
  question: string;
  gameState: string;
  trajectory: string;
  heatScore: number;
  players: string[];
  moveBalance: ThreadGame['moveBalance'];
};

export function computeThreatMap(state: GameState): ThreatEntry[] {
  return state.threadGames
    .filter((g) => !g.isChallenge && g.gameState !== 'resolved')
    .map((g) => ({
      threadId: g.threadId,
      question: g.question,
      gameState: g.gameState,
      trajectory: g.trajectory,
      heatScore:
        g.volatility * 0.4 +
        (g.moveBalance.total > 0 ? g.moveBalance.competitive / g.moveBalance.total : 0) * 0.3 +
        (g.gameState === 'endgame' ? 0.3 : g.gameState === 'committed' ? 0.15 : 0),
      players: g.players.map((p) => p.name),
      moveBalance: g.moveBalance,
    }))
    .sort((a, b) => b.heatScore - a.heatScore);
}

export type BetrayalMoment = {
  threadId: string;
  beforeContent: string;
  afterContent: string;
  betrayerName: string;
};

export function computeBetrayals(state: GameState): BetrayalMoment[] {
  const betrayals: BetrayalMoment[] = [];
  for (const g of state.threadGames) {
    const cellMoves = g.moves.filter((m) => m.matrixCell);
    for (let i = 1; i < cellMoves.length; i++) {
      const prev = cellMoves[i - 1].matrixCell!;
      const curr = cellMoves[i].matrixCell!;
      if (prev === 'cc' && (curr === 'dc' || curr === 'cd')) {
        const betrayerId = curr === 'dc' ? cellMoves[i].actorId : cellMoves[i].targetId;
        const betrayerName = g.players.find((p) => p.id === betrayerId)?.name ?? betrayerId ?? '?';
        betrayals.push({
          threadId: g.threadId,
          beforeContent: cellMoves[i - 1].content,
          afterContent: cellMoves[i].content,
          betrayerName,
        });
      }
    }
  }
  return betrayals;
}

export type TrustPair = {
  nameA: string;
  nameB: string;
  ccCount: number;
  totalMoves: number;
};

export function computeTrustPairs(state: GameState): TrustPair[] {
  const pairs = new Map<string, TrustPair>();
  for (const g of state.threadGames) {
    for (const m of g.moves) {
      if (!m.actorId || !m.targetId || !m.matrixCell) continue;
      const key = [m.actorId, m.targetId].sort().join('|');
      if (!pairs.has(key)) {
        const [a, b] = key.split('|');
        const nameA = g.players.find((p) => p.id === a)?.name ?? a;
        const nameB = g.players.find((p) => p.id === b)?.name ?? b;
        pairs.set(key, { nameA, nameB, ccCount: 0, totalMoves: 0 });
      }
      const p = pairs.get(key)!;
      p.totalMoves++;
      if (m.matrixCell === 'cc') p.ccCount++;
    }
  }
  return Array.from(pairs.values()).sort((a, b) => b.ccCount - a.ccCount);
}
