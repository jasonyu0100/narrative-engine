'use client';

/**
 * GameView — scene-by-scene game analysis.
 *
 * Simple flow:
 *   1. Left panel lists threads active this turn
 *   2. Select a thread → see the 2×2 matrix for the key pair
 *   3. Below the matrix: the log entries for this turn
 *   4. Toggle thread/entity view for full history
 *
 * One game. One matrix. One log stream.
 */

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import type { NarrativeState, PayoffMatrix, Scene } from '@/types/narrative';
import {
  extractGameState,
  computePlayerGTO,
  computeThreatMap,
  computeBetrayals,
  computeTrustPairs,
  type GameState,
  type ThreadGame,
  type PairwiseGame,
  type GameMove,
  type GameProperties,
  type PlayerGTO,
} from '@/lib/game-extract';

type Props = { narrative: NarrativeState };
type ViewMode = 'turn' | 'thread' | 'entity' | 'dashboard';

export default function GameView({ narrative }: Props) {
  const { state, dispatch } = useStore();
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [activeMoveIdx, setActiveMoveIdx] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('turn');
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);

  const currentScene: Scene | null = useMemo(() => {
    const key = state.resolvedEntryKeys[state.viewState.currentSceneIndex];
    return key ? narrative.scenes[key] ?? null : null;
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex]);

  const fullState = useMemo(() => extractGameState(narrative), [narrative]);

  const sceneThreadIds = useMemo(() => {
    if (!currentScene) return null;
    return new Set(currentScene.threadDeltas.map((td) => td.threadId));
  }, [currentScene]);

  const sceneMoveIds = useMemo(() => {
    if (!currentScene) return new Set<string>();
    const ids = new Set<string>();
    for (const td of currentScene.threadDeltas) for (const n of td.addedNodes ?? []) if (n.id) ids.add(n.id);
    return ids;
  }, [currentScene]);

  const nameOf = useMemo(() => {
    const cache = new Map<string, string>();
    return (id: string): string => {
      if (cache.has(id)) return cache.get(id)!;
      let name = narrative.characters[id]?.name ?? narrative.locations[id]?.name ?? narrative.artifacts[id]?.name ?? null;
      if (!name) {
        outer: for (const t of Object.values(narrative.threads)) {
          for (const n of Object.values(t.threadLog?.nodes ?? {})) {
            if ((n.actorId === id || n.targetId === id) && n.content) {
              const m = n.content.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
              if (m) { name = m[1]; break outer; }
            }
          }
        }
      }
      cache.set(id, name ?? id);
      return name ?? id;
    };
  }, [narrative]);

  // All entities for entity view — only real entities (exist in character/location/artifact maps)
  const entities = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; games: number }>();
    for (const g of fullState.threadGames) {
      for (const p of g.players) {
        if (!narrative.characters[p.id] && !narrative.locations[p.id] && !narrative.artifacts[p.id]) continue;
        const e = seen.get(p.id);
        if (e) e.games++;
        else seen.set(p.id, { id: p.id, name: nameOf(p.id), games: 1 });
      }
    }
    return Array.from(seen.values()).sort((a, b) => b.games - a.games);
  }, [fullState, nameOf, narrative]);

  // Games depend on view mode
  const displayGames = useMemo(() => {
    const all = fullState.threadGames.filter((g: ThreadGame) => !g.isChallenge);
    if (viewMode === 'turn' && sceneThreadIds) return all.filter((g: ThreadGame) => sceneThreadIds.has(g.threadId));
    if (viewMode === 'entity' && selectedEntity) return all.filter((g: ThreadGame) => g.players.some((p) => p.id === selectedEntity));
    return all;
  }, [fullState, viewMode, sceneThreadIds, selectedEntity]);

  const activeGame = selectedGame ? displayGames.find((g) => g.threadId === selectedGame) ?? displayGames[0] : displayGames[0];

  // This turn's moves for the active game
  const turnMoves = useMemo(() => {
    if (!activeGame) return [];
    return activeGame.moves.filter((m) => sceneMoveIds.has(m.nodeId));
  }, [activeGame, sceneMoveIds]);

  // Auto-select the best pairwise game: the one whose players appear in this turn's moves
  const bestPair = useMemo((): PairwiseGame | null => {
    if (!activeGame) return null;
    const moveActors = new Set(turnMoves.flatMap((m) => [m.actorId, m.targetId].filter(Boolean)));
    // First: pair with matrix whose players are in this turn's moves
    const active = activeGame.pairwiseGames.find((pw) => pw.matrix && (moveActors.has(pw.playerA) || moveActors.has(pw.playerB)));
    if (active) return active;
    // Second: any pair with matrix
    const withMatrix = activeGame.pairwiseGames.find((pw) => pw.matrix);
    if (withMatrix) return withMatrix;
    // Third: pair whose players are in moves
    const fromMoves = activeGame.pairwiseGames.find((pw) => moveActors.has(pw.playerA) || moveActors.has(pw.playerB));
    return fromMoves ?? activeGame.pairwiseGames[0] ?? null;
  }, [activeGame, turnMoves]);

  // Moves depend on view mode
  const displayMoves = useMemo(() => {
    if (!activeGame) return [];
    if (viewMode === 'turn' && !showFullHistory) return turnMoves;
    if (viewMode === 'entity' && selectedEntity && !showFullHistory) {
      return activeGame.moves.filter((m: GameMove) => m.actorId === selectedEntity || m.targetId === selectedEntity);
    }
    return activeGame.moves; // thread mode or showFullHistory = everything
  }, [activeGame, viewMode, showFullHistory, turnMoves, selectedEntity]);

  // Other matrices available (for subtle toggle)
  const otherMatrices = useMemo(() => {
    if (!activeGame || !bestPair) return [];
    return activeGame.pairwiseGames.filter((pw) => pw.matrix && pw !== bestPair);
  }, [activeGame, bestPair]);

  const [overridePair, setOverridePair] = useState<number | null>(null);
  const activePw = overridePair !== null ? activeGame?.pairwiseGames[overridePair] ?? bestPair : bestPair;

  // Reset override when game changes
  const activeGameId = activeGame?.threadId;
  useMemo(() => { setOverridePair(null); setShowFullHistory(false); setActiveMoveIdx(0); }, [activeGameId]);

  // Dashboard data (computed lazily) — filter out phantom IDs from rankings
  const dashboardData = useMemo(() => {
    if (viewMode !== 'dashboard') return null;
    const gto = computePlayerGTO(fullState).filter((p) =>
      narrative.characters[p.id] || narrative.locations[p.id] || narrative.artifacts[p.id]
    );
    return {
      playerGTO: gto,
      threats: computeThreatMap(fullState),
      betrayals: computeBetrayals(fullState),
      trustPairs: computeTrustPairs(fullState),
    };
  }, [viewMode, fullState, narrative]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Left panel */}
      <div className="w-56 shrink-0 border-r border-border flex flex-col">
        {/* View mode tabs */}
        <div className="shrink-0 flex border-b border-border">
          {(['turn', 'thread', 'entity', 'dashboard'] as const).map((m) => (
            <button key={m} onClick={() => setViewMode(m)}
              className={`flex-1 py-1.5 text-[8px] font-semibold uppercase tracking-wider transition-colors ${viewMode === m ? 'text-text-primary bg-white/5' : 'text-text-dim/30 hover:text-text-dim/50'}`}
            >{m === 'dashboard' ? 'Dash' : m}</button>
          ))}
        </div>
        <div className="shrink-0 px-3 py-2 border-b border-border">
          <div className="text-[9px] uppercase tracking-[0.15em] text-text-dim/50 font-semibold">
            {viewMode === 'dashboard' ? 'Overview' :
             viewMode === 'turn' && sceneThreadIds ? `Turn · ${currentScene?.id}` :
             viewMode === 'entity' ? 'Select Entity' :
             `${displayGames.length} threads`}
          </div>
        </div>

        {/* Entity selector — shown in entity mode */}
        {viewMode === 'entity' && (
          <div className="shrink-0 border-b border-border max-h-36 overflow-y-auto">
            {entities.map((e) => (
              <button key={e.id} onClick={() => { setSelectedEntity(e.id); setSelectedGame(null); dispatch({ type: 'SET_INSPECTOR', context: narrative.characters[e.id] ? { type: 'character', characterId: e.id } : narrative.locations[e.id] ? { type: 'location', locationId: e.id } : { type: 'artifact', artifactId: e.id } }); }}
                className={`w-full text-left px-3 py-1.5 text-[10px] transition-colors ${selectedEntity === e.id ? 'bg-white/8 text-text-primary' : 'text-text-dim/50 hover:bg-white/3'}`}
              >{e.name} <span className="text-text-dim/25">({e.games})</span></button>
            ))}
          </div>
        )}

        {/* Game list */}
        <div className="flex-1 overflow-y-auto">
          {viewMode !== 'dashboard' && displayGames.map((g) => {
            const active = activeGame?.threadId === g.threadId;
            const movesForDots = viewMode === 'turn' ? g.moves.filter((m: GameMove) => sceneMoveIds.has(m.nodeId)) : g.moves;
            return (
              <button key={g.threadId} onClick={() => { setSelectedGame(g.threadId); setOverridePair(null); setShowFullHistory(false); setActiveMoveIdx(0); dispatch({ type: 'SET_INSPECTOR', context: { type: 'thread', threadId: g.threadId } }); }}
                className={`w-full text-left px-3 py-2 border-b border-white/5 transition-colors ${active ? 'bg-white/8' : 'hover:bg-white/3'}`}
              >
                <div className="text-[10px] text-text-secondary leading-snug line-clamp-2">{g.question}</div>
                {movesForDots.length > 0 && (
                  <div className="flex items-center gap-1 mt-1">
                    {movesForDots.slice(-8).map((m: GameMove, i: number) => (
                      <span key={i} className={`w-1.5 h-1.5 rounded-full ${m.stance === 'cooperative' ? 'bg-emerald-400' : m.stance === 'competitive' ? 'bg-red-400' : 'bg-white/15'}`} />
                    ))}
                    <span className="text-[8px] text-text-dim/30 ml-auto">{movesForDots.length}</span>
                  </div>
                )}
              </button>
            );
          })}
          {viewMode !== 'dashboard' && displayGames.length === 0 && (
            <p className="text-[10px] text-text-dim/30 italic p-4 text-center">
              {viewMode === 'turn' ? 'No games this turn' : viewMode === 'entity' && !selectedEntity ? 'Select an entity above' : 'No games'}
            </p>
          )}
        </div>
      </div>

      {/* Main panel */}
      {viewMode === 'dashboard' && dashboardData ? (
        <DashboardPanel data={dashboardData} state={fullState} nameOf={nameOf} dispatch={dispatch} />
      ) : activeGame && activePw ? (
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-xl mx-auto px-6 py-5 flex flex-col gap-4">

            {/* Move stepper — navigate through this turn's moves */}
            {displayMoves.length > 0 && (() => {
              const idx = Math.min(activeMoveIdx, displayMoves.length - 1);
              const m = displayMoves[idx];
              return (
                <div>
                  {/* Move navigation */}
                  {displayMoves.length > 1 && (
                    <div className="flex items-center gap-2 mb-2">
                      <button
                        onClick={() => setActiveMoveIdx(Math.max(0, idx - 1))}
                        disabled={idx === 0}
                        className="text-[10px] text-text-dim/40 hover:text-text-dim/60 disabled:opacity-20 transition-colors"
                      >&larr;</button>
                      <span className="text-[9px] text-text-dim/40 tabular-nums">{idx + 1} / {displayMoves.length}</span>
                      <button
                        onClick={() => setActiveMoveIdx(Math.min(displayMoves.length - 1, idx + 1))}
                        disabled={idx >= displayMoves.length - 1}
                        className="text-[10px] text-text-dim/40 hover:text-text-dim/60 disabled:opacity-20 transition-colors"
                      >&rarr;</button>
                      {m.matrixCell && (
                        <span className="text-[8px] font-mono text-text-dim/30 ml-1 uppercase">{m.matrixCell}</span>
                      )}
                    </div>
                  )}
                  {/* The move */}
                  <p className="text-[15px] text-text-primary leading-snug">{m.content}</p>
                  {m.attributed && (
                    <div className="flex items-center gap-1.5 mt-1 text-[10px]">
                      <span className="text-text-dim/50">{nameOf(m.actorId!)}</span>
                      {m.targetId && <><span className="text-text-dim/20">→</span><span className="text-text-dim/50">{nameOf(m.targetId)}</span></>}
                      <span className={m.stance === 'cooperative' ? 'text-emerald-400/60' : m.stance === 'competitive' ? 'text-red-400/60' : 'text-text-dim/30'}>{m.stance}</span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Thread context — small */}
            <p className="text-[9px] text-text-dim/40 leading-snug">{activeGame.question}</p>

            {/* THE MATRIX */}
            {activePw.matrix && activePw.properties && (() => {
              const idx = Math.min(activeMoveIdx, displayMoves.length - 1);
              const activeMove = displayMoves[idx];
              // Only use LLM-declared matrixCell — no inference.
              // Normalise actor-relative cell to matrix A/B ordering.
              let playedCell: 'cc' | 'cd' | 'dc' | 'dd' | null = null;
              const raw = activeMove?.matrixCell;
              if (raw === 'cc' || raw === 'cd' || raw === 'dc' || raw === 'dd') {
                const actorIsB = activeMove?.actorId === activePw.playerB;
                if (actorIsB && raw === 'dc') playedCell = 'cd';
                else if (actorIsB && raw === 'cd') playedCell = 'dc';
                else playedCell = raw;
              }
              return (
                <Board
                  matrix={activePw.matrix!}
                  props={activePw.properties!}
                  aName={nameOf(activePw.playerA)}
                  bName={nameOf(activePw.playerB)}
                  perspectiveA={activePw.playerA}
                  playedCell={playedCell}
                  stakeA={activePw.stakeA}
                  stakeB={activePw.stakeB}
                />
              );
            })(
            )}

            {/* Analysis */}
            {activePw.properties && <AnalysisBlock props={activePw.properties} aName={nameOf(activePw.playerA)} bName={nameOf(activePw.playerB)} />}

            {/* Other matrices — subtle toggle */}
            {otherMatrices.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                <span className="text-[8px] text-text-dim/25 self-center mr-1">also:</span>
                {otherMatrices.map((pw) => {
                  const idx = activeGame.pairwiseGames.indexOf(pw);
                  return (
                    <button key={idx} onClick={() => setOverridePair(overridePair === idx ? null : idx)}
                      className={`text-[8px] px-1.5 py-0.5 rounded transition-colors ${
                        overridePair === idx ? 'bg-white/10 text-text-secondary' : 'text-text-dim/30 hover:text-text-dim/50'
                      }`}
                    >{nameOf(pw.playerA)} vs {nameOf(pw.playerB)}</button>
                  );
                })}
              </div>
            )}

            {/* Move log */}
            {displayMoves.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[8px] uppercase tracking-wider text-text-dim/30 font-semibold">
                    {showFullHistory ? 'Full History' : 'This Turn'} · {displayMoves.length}
                  </span>
                  <button
                    onClick={() => setShowFullHistory(!showFullHistory)}
                    className="text-[8px] text-text-dim/30 hover:text-text-dim/50 transition-colors"
                  >
                    {showFullHistory ? 'show turn only' : 'show full history'}
                  </button>
                </div>
                {displayMoves.map((m, i) => (
                  <MoveRow key={m.nodeId} move={m} index={i} nameOf={nameOf} pairwise={activePw} />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[11px] text-text-dim/25 italic">Select a game</p>
        </div>
      )}
    </div>
  );
}

// ── Board ────────────────────────────────────────────────────────────────────

function Board({ matrix, props, aName, bName, perspectiveA, playedCell, stakeA, stakeB }: {
  matrix: PayoffMatrix; props: GameProperties; aName: string; bName: string; perspectiveA: string;
  playedCell: 'cc' | 'cd' | 'dc' | 'dd' | null;
  stakeA: string | null; stakeB: string | null;
}) {
  const flipped = matrix.playerA !== perspectiveA;
  const pA = (c: { payoffA: number; payoffB: number }) => flipped ? c.payoffB : c.payoffA;
  const pB = (c: { payoffA: number; payoffB: number }) => flipped ? c.payoffA : c.payoffB;
  const nashSet = new Set(props.nashEquilibria);

  // Axis labels: action descriptions > stakes > generic
  const coopA = (flipped ? matrix.actionB : matrix.actionA) ?? (stakeA ? `advances ${stakeA}` : 'cooperates');
  const defA = (flipped ? matrix.defectB : matrix.defectA) ?? (stakeA ? `blocks ${stakeA}` : 'defects');
  const coopB = (flipped ? matrix.actionA : matrix.actionB) ?? (stakeB ? `advances ${stakeB}` : 'cooperates');
  const defB = (flipped ? matrix.defectA : matrix.defectB) ?? (stakeB ? `blocks ${stakeB}` : 'defects');

  const Cell = ({ cell, cellKey, row, col }: { cell: PayoffMatrix['cc']; cellKey: 'cc' | 'cd' | 'dc' | 'dd'; row: number; col: number }) => {
    const isNash = nashSet.has(cellKey);
    const isPlayed = playedCell === cellKey;
    const isLight = (row + col) % 2 === 0;

    return (
      <td className={`relative p-4 ${
        isPlayed ? 'bg-amber-400/12 ring-2 ring-inset ring-amber-400/40' :
        isLight ? 'bg-white/4' : 'bg-black/15'
      }`}>
        {/* Badges — top right */}
        <div className="absolute top-1 right-1 flex gap-0.5">
          {isPlayed && isNash && <span className="text-[6px] font-bold px-1 rounded bg-emerald-400/20 text-emerald-400">NASH · PLAYED</span>}
          {isPlayed && !isNash && <span className="text-[6px] font-bold px-1 rounded bg-amber-400/20 text-amber-400">PLAYED</span>}
          {isNash && !isPlayed && <span className="text-[6px] font-bold px-1 rounded bg-sky-400/15 text-sky-400/80">NASH</span>}
        </div>
        {/* Payoffs */}
        <div className="flex items-center gap-3 mb-1.5">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-white shadow-sm" />
            <span className="text-[20px] font-mono font-bold text-white leading-none">{pA(cell)}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-neutral-900 border border-white/25" />
            <span className="text-[20px] font-mono font-bold text-white/55 leading-none">{pB(cell)}</span>
          </div>
        </div>
        {/* Outcome */}
        <p className="text-[9px] text-text-dim/50 leading-snug">{cell.outcome}</p>
      </td>
    );
  };

  return (
    <div>
      <table className="border-collapse border border-white/8 rounded-lg overflow-hidden w-full">
        <thead>
          <tr>
            <th className="bg-white/3 p-2 w-28" />
            <th className="bg-white/3 p-2 border-l border-white/5 text-center">
              <span className="flex items-center justify-center gap-1 mb-0.5">
                <span className="w-2.5 h-2.5 rounded bg-neutral-900 border border-white/25" />
                <span className="text-[9px] font-semibold text-white/45 uppercase tracking-wider">{bName}</span>
              </span>
              <span className="text-[8px] text-emerald-400/40">{coopB}</span>
            </th>
            <th className="bg-white/3 p-2 border-l border-white/5 text-center">
              <span className="flex items-center justify-center gap-1 mb-0.5">
                <span className="w-2.5 h-2.5 rounded bg-neutral-900 border border-white/25" />
                <span className="text-[9px] font-semibold text-white/45 uppercase tracking-wider">{bName}</span>
              </span>
              <span className="text-[8px] text-red-400/40">{defB}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-white/5">
            <th className="bg-white/3 p-2 text-right border-r border-white/5">
              <span className="flex items-center justify-end gap-1 mb-0.5">
                <span className="w-2.5 h-2.5 rounded bg-white shadow-sm" />
                <span className="text-[9px] font-semibold text-white/45 uppercase tracking-wider">{aName}</span>
              </span>
              <span className="text-[8px] text-emerald-400/40">{coopA}</span>
            </th>
            <Cell cell={matrix.cc} cellKey="cc" row={0} col={0} />
            <Cell cell={matrix.cd} cellKey="cd" row={0} col={1} />
          </tr>
          <tr className="border-t border-white/5">
            <th className="bg-white/3 p-2 text-right border-r border-white/5">
              <span className="flex items-center justify-end gap-1 mb-0.5">
                <span className="w-2.5 h-2.5 rounded bg-white shadow-sm" />
                <span className="text-[9px] font-semibold text-white/45 uppercase tracking-wider">{aName}</span>
              </span>
              <span className="text-[8px] text-red-400/40">{defA}</span>
            </th>
            <Cell cell={matrix.dc} cellKey="dc" row={1} col={0} />
            <Cell cell={matrix.dd} cellKey="dd" row={1} col={1} />
          </tr>
        </tbody>
      </table>
      <div className="flex items-center gap-3 mt-1.5 text-[7px] text-text-dim/25">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-white" /> {aName}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-neutral-900 border border-white/15" /> {bName}</span>
        <span>4=max 0=none</span>
      </div>
    </div>
  );
}

// ── Analysis ────────────────────────────────────────────────────────────────

function AnalysisBlock({ props, aName, bName }: { props: GameProperties; aName: string; bName: string }) {
  const lines: string[] = [];
  if (props.hasSocialDilemma) lines.push('Social dilemma — cooperation optimal but defection tempting.');
  if (props.isZeroSum) lines.push('Zero-sum — one gains, the other loses.');
  if (props.isMutuallyBeneficial) lines.push('Mutual cooperation is optimal for both.');
  if (props.hasDominantStrategy) {
    const who = props.dominantPlayer === 'A' ? aName : props.dominantPlayer === 'B' ? bName : 'Both';
    lines.push(`${who} has a dominant strategy.`);
  }
  if (props.nashEquilibria.length === 0) lines.push('No pure Nash equilibrium.');
  if (props.nashEquilibria.length > 1) lines.push(`${props.nashEquilibria.length} equilibria.`);
  const inefficient = props.nashEquilibria.filter((ne) => !new Set(props.paretoOptimal).has(ne));
  if (inefficient.length > 0) lines.push('Equilibrium is Pareto-inefficient.');
  if (lines.length === 0) return null;
  return (
    <div className="rounded border border-white/6 bg-white/2 px-3 py-2">
      {lines.map((l, i) => <p key={i} className="text-[9px] text-text-dim/50 leading-snug">{l}</p>)}
    </div>
  );
}

// ── Move row ────────────────────────────────────────────────────────────────

function MoveRow({ move, index, nameOf, pairwise }: { move: GameMove; index: number; nameOf: (id: string) => string; pairwise: PairwiseGame }) {
  const ne = pairwise.properties?.nashEquilibria[0] ?? null;
  const isA = move.actorId === pairwise.playerA;
  const isB = move.actorId === pairwise.playerB;
  let gto: 'cooperative' | 'competitive' | null = null;
  if (ne && isA) gto = ne[0] === 'c' ? 'cooperative' : 'competitive';
  if (ne && isB) gto = ne[1] === 'c' ? 'cooperative' : 'competitive';
  const optimal = gto && move.stance === gto;
  const blunder = gto && move.stance !== gto && move.stance !== 'neutral';

  return (
    <div className={`flex items-start gap-2 py-1.5 border-b border-white/4 last:border-0 ${blunder ? 'bg-red-400/5 -mx-2 px-2 rounded' : ''}`}>
      {isA ? <div className="w-2.5 h-2.5 rounded bg-white mt-1 shrink-0" /> :
       isB ? <div className="w-2.5 h-2.5 rounded bg-neutral-900 border border-white/20 mt-1 shrink-0" /> :
       <div className="w-2.5 h-2.5 rounded bg-white/10 mt-1 shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-text-secondary/70 leading-snug">{move.content}</p>
        <div className="flex items-center gap-1 mt-0.5 text-[8px]">
          <span className="text-text-dim/35">{move.attributed ? nameOf(move.actorId!) : '?'}</span>
          {move.targetId && <><span className="text-text-dim/15">→</span><span className="text-text-dim/35">{nameOf(move.targetId)}</span></>}
          <span className={move.stance === 'cooperative' ? 'text-emerald-400/50' : move.stance === 'competitive' ? 'text-red-400/50' : 'text-text-dim/20'}>{move.stance}</span>
          {optimal && <span className="font-bold px-0.5 rounded bg-emerald-400/15 text-emerald-400 text-[6px]">!</span>}
          {blunder && <span className="font-bold px-0.5 rounded bg-red-400/15 text-red-400 text-[6px]">?!</span>}
        </div>
      </div>
    </div>
  );
}

// ── Dashboard panel ─────────────────────────────────────────────────────────

type DashboardData = {
  playerGTO: PlayerGTO[];
  threats: ReturnType<typeof computeThreatMap>;
  betrayals: ReturnType<typeof computeBetrayals>;
  trustPairs: ReturnType<typeof computeTrustPairs>;
};

function DashboardPanel({ data, state, nameOf, dispatch }: {
  data: DashboardData; state: GameState; nameOf: (id: string) => string;
  dispatch: ReturnType<typeof useStore>['dispatch'];
}) {
  const s = state.summary;
  const totalMoves = state.threadGames.reduce((n, g) => n + g.moveBalance.total, 0);
  const totalComp = state.threadGames.reduce((n, g) => n + g.moveBalance.competitive, 0);
  const temperature = totalMoves > 0 ? totalComp / totalMoves : 0;
  const endgameCount = state.threadGames.filter((g) => g.gameState === 'endgame' || g.gameState === 'committed').length;
  const avgGTO = data.playerGTO.filter((p) => p.declaredMoves > 0).length > 0
    ? data.playerGTO.filter((p) => p.declaredMoves > 0).reduce((n, p) => n + p.gtoRate, 0) / data.playerGTO.filter((p) => p.declaredMoves > 0).length
    : 0;

  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-5 flex flex-col gap-6">
        {/* Headline metrics */}
        <div className="grid grid-cols-3 gap-3">
          <DashStat label="Temperature" value={`${(temperature * 100).toFixed(0)}%`} sub={`${totalComp} competitive of ${totalMoves} moves`} color={temperature > 0.5 ? 'text-red-400' : temperature > 0.3 ? 'text-amber-400' : 'text-emerald-400'} />
          <DashStat label="Nash Compliance" value={`${(avgGTO * 100).toFixed(0)}%`} sub="average across all players" color={avgGTO > 0.7 ? 'text-emerald-400' : avgGTO > 0.4 ? 'text-amber-400' : 'text-red-400'} />
          <DashStat label="Pressure" value={`${endgameCount} / ${s.activeGames}`} sub="endgame+committed of active" color={endgameCount > 3 ? 'text-red-400' : undefined} />
        </div>

        {/* Player rankings */}
        <div>
          <h3 className="text-[10px] uppercase tracking-[0.15em] text-text-dim/50 font-semibold mb-2">Player Rankings</h3>
          <div className="rounded-lg border border-white/8 overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-white/3 text-text-dim/50 text-[9px] uppercase tracking-wider">
                  <th className="text-left py-2 px-3 font-medium w-8">#</th>
                  <th className="text-left py-2 px-3 font-medium">Player</th>
                  <th className="text-right py-2 px-3 font-medium">Moves</th>
                  <th className="text-right py-2 px-3 font-medium">Nash</th>
                  <th className="text-right py-2 px-3 font-medium">Advance</th>
                  <th className="text-right py-2 px-3 font-medium">Exploit</th>
                </tr>
              </thead>
              <tbody>
                {data.playerGTO.slice(0, 12).map((p, i) => {
                  const nashPct = p.declaredMoves > 0 ? (p.gtoRate * 100).toFixed(0) : '—';
                  const coopPct = p.declaredMoves > 0 ? (p.coopRate * 100).toFixed(0) : '—';
                  return (
                    <tr key={p.id}
                      className="border-t border-white/5 hover:bg-white/3 transition-colors cursor-pointer"
                      onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'character', characterId: p.id } })}
                    >
                      <td className="py-2 px-3 text-text-dim/30 tabular-nums">{i + 1}</td>
                      <td className="py-2 px-3">
                        <div className="text-text-primary font-medium">{p.name}</div>
                        <div className={`text-[9px] ${
                          p.overallPosture === 'dominant' ? 'text-emerald-400/70' :
                          p.overallPosture === 'embattled' ? 'text-amber-400/70' :
                          p.overallPosture === 'pressured' ? 'text-red-400/70' :
                          'text-text-dim/40'
                        }`}>{p.overallPosture} · {p.posture}</div>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-text-secondary">{p.totalMoves}</td>
                      <td className={`py-2 px-3 text-right tabular-nums font-medium ${
                        nashPct === '—' ? 'text-text-dim/30' :
                        Number(nashPct) > 70 ? 'text-emerald-400' :
                        Number(nashPct) > 40 ? 'text-amber-400' :
                        'text-red-400'
                      }`}>{nashPct}{nashPct !== '—' ? '%' : ''}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-text-secondary">{coopPct}{coopPct !== '—' ? '%' : ''}</td>
                      <td className={`py-2 px-3 text-right tabular-nums font-medium ${
                        p.netExploitation > 0 ? 'text-emerald-400' :
                        p.netExploitation < 0 ? 'text-red-400' :
                        'text-text-dim/30'
                      }`}>{p.netExploitation > 0 ? '+' : ''}{p.netExploitation}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Hottest games + Trust */}
        <div className="grid grid-cols-2 gap-5">
          <div>
            <h3 className="text-[10px] uppercase tracking-[0.15em] text-text-dim/50 font-semibold mb-2">Hottest Games</h3>
            <div className="flex flex-col gap-1.5">
              {data.threats.slice(0, 5).map((t) => (
                <button key={t.threadId} onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'thread', threadId: t.threadId } })}
                  className="text-left p-2.5 rounded-lg border border-white/5 hover:bg-white/3 transition-colors"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`text-[9px] font-semibold ${t.gameState === 'endgame' ? 'text-fate' : t.gameState === 'committed' ? 'text-orange-400' : 'text-text-dim/40'}`}>{t.gameState}</span>
                    <span className={`text-[9px] ${t.trajectory === 'volatile' ? 'text-orange-400' : t.trajectory === 'contested' ? 'text-amber-400' : 'text-text-dim/30'}`}>{t.trajectory}</span>
                    <div className="flex gap-px ml-auto">
                      {Array.from({ length: Math.round(t.heatScore * 5) }).map((_, j) => (
                        <span key={j} className="w-1.5 h-3 rounded-sm bg-red-400/60" />
                      ))}
                      {Array.from({ length: 5 - Math.round(t.heatScore * 5) }).map((_, j) => (
                        <span key={j} className="w-1.5 h-3 rounded-sm bg-white/5" />
                      ))}
                    </div>
                  </div>
                  <p className="text-[10px] text-text-secondary leading-snug line-clamp-2">{t.question}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-[10px] uppercase tracking-[0.15em] text-text-dim/50 font-semibold mb-2">Trust & Betrayal</h3>
            {data.trustPairs.filter((t) => t.ccCount > 0).length > 0 && (
              <div className="mb-4">
                <div className="text-[9px] text-text-dim/40 mb-1.5">Strongest alliances</div>
                {data.trustPairs.filter((t) => t.ccCount > 0).slice(0, 4).map((t, i) => (
                  <div key={i} className="flex items-center justify-between py-1 text-[10px]">
                    <span className="text-text-secondary">{t.nameA} × {t.nameB}</span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-16 h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full bg-emerald-400/60 rounded-full" style={{ width: `${(t.ccCount / Math.max(t.totalMoves, 1)) * 100}%` }} />
                      </div>
                      <span className="text-[9px] text-text-dim/40 tabular-nums w-8 text-right">{t.ccCount}/{t.totalMoves}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {data.betrayals.length > 0 && (
              <div>
                <div className="text-[9px] text-text-dim/40 mb-1.5">Betrayal moments</div>
                {data.betrayals.slice(0, 3).map((b, i) => (
                  <div key={i} className="py-1.5 border-b border-white/5 last:border-0">
                    <div className="text-[10px]"><span className="text-red-400 font-medium">{b.betrayerName}</span> <span className="text-text-dim/30">broke cooperation</span></div>
                    <p className="text-[9px] text-text-dim/40 leading-snug mt-0.5">{b.afterContent.slice(0, 70)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DashStat({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/3 px-3 py-2.5">
      <div className={`text-[20px] font-mono font-bold tabular-nums ${color ?? 'text-text-primary'}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-text-dim/40 mt-1">{label}</div>
      {sub && <div className="text-[8px] text-text-dim/25 mt-0.5">{sub}</div>}
    </div>
  );
}
