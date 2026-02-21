'use client';

import { useState, useEffect } from 'react';
import type { MCTSRunState } from '@/types/mcts';

type Props = {
  runState: MCTSRunState;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onOpenPanel: () => void;
};

function scoreColorClass(v: number): string {
  if (v >= 90) return 'text-green-400';
  if (v >= 80) return 'text-lime-400';
  if (v >= 70) return 'text-yellow-400';
  if (v >= 60) return 'text-orange-400';
  return 'text-red-400';
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

export function MCTSControlBar({ runState, onPause, onResume, onStop, onOpenPanel }: Props) {
  const { status, iterationsCompleted, config, currentPhase, bestPath, tree, startedAt } = runState;
  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isComplete = status === 'complete';
  const isTimerMode = config.stopMode === 'timer';
  const nodeCount = Object.keys(tree.nodes).length;

  // Ticking elapsed timer
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isRunning || !startedAt) { setElapsed(0); return; }
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt, isRunning]);

  // Top score across all nodes
  const topScore = Object.values(tree.nodes).reduce((max, n) => Math.max(max, n.immediateScore), 0);
  // Best arc name (first node in best path)
  const bestArcName = bestPath?.[0] ? tree.nodes[bestPath[0]]?.arc.name : null;

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20">
      <div className="glass-pill px-3 py-1.5 flex items-center gap-3">
        {/* Status indicator */}
        <div className="flex items-center gap-1.5">
          {isRunning ? (
            <svg className="w-3.5 h-3.5 text-blue-400 animate-spin" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
              <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <div className={`w-2 h-2 rounded-full ${
              isComplete ? 'bg-green-400' : isPaused ? 'bg-amber-400' : 'bg-text-dim'
            }`} />
          )}
          <span className="text-[10px] text-text-dim uppercase tracking-wider">MCTS</span>
          {config.searchMode === 'baseline' && (
            <span className={`text-[10px] font-mono ${runState.effectiveBaseline != null && runState.effectiveBaseline < config.baselineScore ? 'text-amber-400/70' : 'text-violet-400/70'}`}>
              &ge;{runState.effectiveBaseline != null && runState.effectiveBaseline < config.baselineScore ? runState.effectiveBaseline : config.baselineScore}
            </span>
          )}
        </div>

        <div className="w-px h-4 bg-white/12" />

        {/* Progress: timer or iterations */}
        <span className="text-[10px] text-text-dim whitespace-nowrap font-mono">
          {isTimerMode
            ? `${formatTime(elapsed)} / ${formatTime(config.timeLimitSeconds)}`
            : `${iterationsCompleted}/${config.totalIterations}`}
        </span>

        <div className="w-px h-4 bg-white/12" />

        {/* Node count */}
        <span className="text-[10px] text-text-dim whitespace-nowrap">{nodeCount} nodes</span>

        {/* Top score */}
        {topScore > 0 && (
          <>
            <div className="w-px h-4 bg-white/12" />
            <span className={`text-[10px] font-mono font-semibold ${scoreColorClass(topScore)}`}>
              {topScore}
            </span>
          </>
        )}

        {/* Best arc name */}
        {bestArcName && (
          <>
            <div className="w-px h-4 bg-white/12" />
            <span className="text-[10px] text-text-secondary truncate max-w-32">{bestArcName}</span>
          </>
        )}

        {/* Current phase while running */}
        {isRunning && currentPhase && (
          <>
            <div className="w-px h-4 bg-white/12" />
            <span className="text-[10px] text-blue-400/70 capitalize">{currentPhase}</span>
          </>
        )}

        <div className="w-px h-4 bg-white/12" />

        {/* Controls */}
        {isRunning && (
          <button onClick={onPause} className="w-6 h-6 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded transition-colors" title="Pause">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <rect x="1" y="1" width="3" height="8" rx="0.5" />
              <rect x="6" y="1" width="3" height="8" rx="0.5" />
            </svg>
          </button>
        )}
        {isPaused && (
          <button onClick={onResume} className="w-6 h-6 flex items-center justify-center text-blue-400 hover:bg-white/6 rounded transition-colors" title="Resume">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M2 1L9 5L2 9Z" />
            </svg>
          </button>
        )}

        <button onClick={onStop} className="w-6 h-6 flex items-center justify-center text-text-dim hover:text-payoff hover:bg-white/6 rounded transition-colors" title="Stop">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1" y="1" width="8" height="8" rx="1" />
          </svg>
        </button>

        <button onClick={onOpenPanel} className="w-6 h-6 flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-white/6 rounded transition-colors" title="Open MCTS panel">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6" />
            <path d="M9 21H3v-6" />
            <path d="M21 3l-7 7" />
            <path d="M3 21l7-7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
