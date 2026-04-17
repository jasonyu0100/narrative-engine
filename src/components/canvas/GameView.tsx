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
  type ThreadGame,
  type PairwiseGame,
  type GameMove,
  type GameProperties,
} from '@/lib/game-extract';

type Props = { narrative: NarrativeState };

export default function GameView({ narrative }: Props) {
  const { state, dispatch } = useStore();
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [activeMoveIdx, setActiveMoveIdx] = useState(0);

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

  const displayGames = useMemo(() => {
    const all = fullState.threadGames.filter((g) => !g.isChallenge);
    if (!sceneThreadIds) return all;
    return all.filter((g) => sceneThreadIds.has(g.threadId));
  }, [fullState, sceneThreadIds]);

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

  // All moves or just this turn
  const displayMoves = showFullHistory ? (activeGame?.moves ?? []) : turnMoves;

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

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Left: thread list */}
      <div className="w-56 shrink-0 border-r border-border flex flex-col">
        <div className="shrink-0 px-3 py-2 border-b border-border">
          <div className="text-[9px] uppercase tracking-[0.15em] text-text-dim/50 font-semibold">
            {sceneThreadIds ? `Turn · ${currentScene?.id}` : 'All Games'}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {displayGames.map((g) => {
            const active = activeGame?.threadId === g.threadId;
            const moves = g.moves.filter((m) => sceneMoveIds.has(m.nodeId));
            return (
              <button key={g.threadId} onClick={() => { setSelectedGame(g.threadId); setOverridePair(null); setShowFullHistory(false); setActiveMoveIdx(0); }}
                className={`w-full text-left px-3 py-2 border-b border-white/5 transition-colors ${active ? 'bg-white/8' : 'hover:bg-white/3'}`}
              >
                <div className="text-[10px] text-text-secondary leading-snug line-clamp-2">{g.question}</div>
                {moves.length > 0 && (
                  <div className="flex items-center gap-1 mt-1">
                    {moves.map((m, i) => (
                      <span key={i} className={`w-1.5 h-1.5 rounded-full ${m.stance === 'cooperative' ? 'bg-emerald-400' : m.stance === 'competitive' ? 'bg-red-400' : 'bg-white/15'}`} />
                    ))}
                    <span className="text-[8px] text-text-dim/30 ml-auto">{moves.length}</span>
                  </div>
                )}
              </button>
            );
          })}
          {displayGames.length === 0 && <p className="text-[10px] text-text-dim/30 italic p-4 text-center">No games this turn</p>}
        </div>
      </div>

      {/* Main panel */}
      {activeGame && activePw ? (
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
              // Use LLM-declared matrixCell, but normalise to the matrix's A/B ordering.
              // The LLM may write the cell from the actor's perspective (actor's action first),
              // but the matrix is always playerA × playerB. If the actor is playerB, flip cd↔dc.
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
        isPlayed && isNash ? 'bg-emerald-400/10 ring-2 ring-inset ring-emerald-400/30' :
        isPlayed ? 'bg-amber-400/12 ring-2 ring-inset ring-amber-400/40' :
        isNash ? 'bg-sky-400/8 ring-1 ring-inset ring-sky-400/20' :
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
