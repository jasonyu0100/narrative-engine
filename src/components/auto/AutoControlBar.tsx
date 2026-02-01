'use client';

import { useState } from 'react';
import type { AutoRunLog } from '@/types/narrative';

type Props = {
  isRunning: boolean;
  isPaused: boolean;
  currentCycle: number;
  totalScenes: number;
  log: AutoRunLog[];
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onOpenSettings: () => void;
};

const ACTION_LABELS: Record<string, string> = {
  generate_arc: 'New Arc',
  expand_world: 'World Expansion',
  resolve_thread: 'Thread Resolution',
  escalate_toward_climax: 'Escalation',
  introduce_complication: 'Complication',
  quiet_interlude: 'Interlude',
};

export function AutoControlBar({
  isRunning,
  isPaused,
  currentCycle,
  totalScenes,
  log,
  onPause,
  onResume,
  onStop,
  onOpenSettings,
}: Props) {
  const [logExpanded, setLogExpanded] = useState(false);
  const lastEntry = log[log.length - 1];

  return (
    <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20">
      <div className="glass-pill px-3 py-1.5 flex items-center gap-3">
        {/* Status indicator */}
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-momentum animate-pulse' : isPaused ? 'bg-amber-400' : 'bg-text-dim'}`} />
          <span className="text-[10px] text-text-dim uppercase tracking-wider">
            {isRunning ? 'Running' : isPaused ? 'Paused' : 'Stopped'}
          </span>
        </div>

        <div className="w-px h-4 bg-white/12" />

        {/* Cycle counter */}
        <span className="text-[10px] text-text-dim whitespace-nowrap">
          Cycle {currentCycle}
        </span>

        <div className="w-px h-4 bg-white/12" />

        {/* Scenes generated */}
        <span className="text-[10px] text-text-dim whitespace-nowrap">
          {totalScenes} scenes
        </span>

        <div className="w-px h-4 bg-white/12" />

        {/* Last action */}
        {lastEntry && (
          <>
            <span className="text-[10px] text-text-secondary truncate max-w-32">
              {ACTION_LABELS[lastEntry.action] ?? lastEntry.action}
            </span>
            <div className="w-px h-4 bg-white/12" />
          </>
        )}

        {/* Controls */}
        {isRunning ? (
          <button
            onClick={onPause}
            className="w-6 h-6 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded transition-colors"
            title="Pause"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <rect x="1" y="1" width="3" height="8" rx="0.5" />
              <rect x="6" y="1" width="3" height="8" rx="0.5" />
            </svg>
          </button>
        ) : isPaused ? (
          <button
            onClick={onResume}
            className="w-6 h-6 flex items-center justify-center text-momentum hover:bg-white/6 rounded transition-colors"
            title="Resume"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M2 1L9 5L2 9Z" />
            </svg>
          </button>
        ) : null}

        <button
          onClick={onStop}
          className="w-6 h-6 flex items-center justify-center text-text-dim hover:text-pressure hover:bg-white/6 rounded transition-colors"
          title="Stop"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1" y="1" width="8" height="8" rx="1" />
          </svg>
        </button>

        <button
          onClick={onOpenSettings}
          className="w-6 h-6 flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-white/6 rounded transition-colors"
          title="Settings"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {/* Log toggle */}
        {log.length > 0 && (
          <button
            onClick={() => setLogExpanded((v) => !v)}
            className="text-[10px] text-text-dim hover:text-text-secondary uppercase tracking-wider"
          >
            Log
          </button>
        )}
      </div>

      {/* Expanded log */}
      {logExpanded && log.length > 0 && (
        <div className="glass mt-1 rounded-lg p-3 max-h-48 overflow-y-auto w-80">
          {log.slice().reverse().map((entry, i) => (
            <div key={i} className="flex flex-col gap-0.5 py-1.5 border-b border-white/6 last:border-b-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-text-dim">#{entry.cycle}</span>
                <span className="text-[10px] text-text-secondary font-medium">
                  {ACTION_LABELS[entry.action] ?? entry.action}
                </span>
                {entry.scenesGenerated > 0 && (
                  <span className="text-[10px] text-text-dim">+{entry.scenesGenerated} scenes</span>
                )}
                {entry.worldExpanded && (
                  <span className="text-[10px] text-flux">+world</span>
                )}
              </div>
              <span className="text-[10px] text-text-dim truncate">{entry.reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
