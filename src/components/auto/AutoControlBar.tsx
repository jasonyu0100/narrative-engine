'use client';

import type { AutoRunLog } from '@/types/narrative';

type Props = {
  isRunning: boolean;
  isPaused: boolean;
  currentCycle: number;
  totalScenes: number;
  statusMessage: string;
  log: AutoRunLog[];
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onOpenSettings: () => void;
  onOpenLog: () => void;
};

const ACTION_LABELS: Record<string, string> = {
  HHH: 'Convergence',
  HHL: 'Climax',
  HLH: 'Twist',
  HLL: 'Closure',
  LHH: 'Discovery',
  LHL: 'Growth',
  LLH: 'Wandering',
  LLL: 'Rest',
};

export function AutoControlBar({
  isRunning,
  isPaused,
  currentCycle,
  totalScenes,
  statusMessage,
  log,
  onPause,
  onResume,
  onStop,
  onOpenSettings,
  onOpenLog,
}: Props) {
  const lastEntry = log[log.length - 1];
  const lastError = lastEntry?.error;
  const stoppedByError = !isRunning && !isPaused && lastError;
  const hasError = !!lastError;

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
      <div className={`glass-pill px-3 py-1.5 flex items-center gap-3 ${stoppedByError ? 'ring-1 ring-red-400/40' : ''}`}>
        {/* Status indicator */}
        <div className="flex items-center gap-1.5">
          {isRunning && hasError ? (
            <div className="w-2.5 h-2.5 rounded-full bg-red-400 animate-pulse" />
          ) : isRunning ? (
            <svg className="w-3.5 h-3.5 text-yellow-400 animate-spin" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
              <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : stoppedByError ? (
            <div className="w-2 h-2 rounded-full bg-red-400" />
          ) : (
            <div className={`w-2 h-2 rounded-full ${isPaused ? 'bg-amber-400' : 'bg-text-dim'}`} />
          )}
          <span className={`text-[10px] uppercase tracking-wider ${stoppedByError ? 'text-red-400' : 'text-text-dim'}`}>
            {stoppedByError ? 'Error' : isRunning && hasError ? 'Retrying' : isRunning ? 'Running' : isPaused ? 'Paused' : 'Stopped'}
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
            className="w-6 h-6 flex items-center justify-center text-yellow-400 hover:bg-white/6 rounded transition-colors"
            title="Resume"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M2 1L9 5L2 9Z" />
            </svg>
          </button>
        ) : null}

        <button
          onClick={onStop}
          className="w-6 h-6 flex items-center justify-center text-text-dim hover:text-payoff hover:bg-white/6 rounded transition-colors"
          title="Stop"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1" y="1" width="8" height="8" rx="1" />
          </svg>
        </button>

        <button
          onClick={onOpenLog}
          className="w-6 h-6 flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-white/6 rounded transition-colors"
          title="View Log"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
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

      </div>

      {/* Contextual status below the pill */}
      {(isRunning || isPaused || stoppedByError) && statusMessage && (
        <div className={`mt-1.5 text-[10px] text-center max-w-96 px-2 ${
          stoppedByError
            ? 'text-red-400'
            : statusMessage.startsWith('Retry')
            ? 'text-amber-400'
            : statusMessage.startsWith('Error')
            ? 'text-red-400/80'
            : 'text-text-dim'
        }`}>
          {stoppedByError ? (
            <span className="flex items-center justify-center gap-1.5">
              <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="truncate">{statusMessage}</span>
              <button onClick={onOpenLog} className="underline hover:text-red-300 transition-colors shrink-0">view logs</button>
            </span>
          ) : statusMessage.startsWith('Retry') ? (
            <span className="flex items-center justify-center gap-1.5">
              <svg className="w-3 h-3 shrink-0 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M1 4v6h6" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              <span className="truncate">{statusMessage}</span>
            </span>
          ) : (
            <span className="truncate block">{statusMessage}</span>
          )}
        </div>
      )}
    </div>
  );
}
