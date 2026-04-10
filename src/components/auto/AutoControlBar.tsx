'use client';

import { IconSpinner, IconPause, IconPlay, IconStop, IconDocument, IconSettings, IconWarning, IconRefresh } from '@/components/icons';
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
            <IconSpinner size={14} className="text-yellow-400 animate-spin" />
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
            <IconPause size={10} />
          </button>
        ) : isPaused ? (
          <button
            onClick={onResume}
            className="w-6 h-6 flex items-center justify-center text-yellow-400 hover:bg-white/6 rounded transition-colors"
            title="Resume"
          >
            <IconPlay size={10} />
          </button>
        ) : null}

        <button
          onClick={onStop}
          className="w-6 h-6 flex items-center justify-center text-text-dim hover:text-drive hover:bg-white/6 rounded transition-colors"
          title="Stop"
        >
          <IconStop size={10} />
        </button>

        <button
          onClick={onOpenLog}
          className="w-6 h-6 flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-white/6 rounded transition-colors"
          title="View Log"
        >
          <IconDocument size={12} />
        </button>

        <button
          onClick={onOpenSettings}
          className="w-6 h-6 flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-white/6 rounded transition-colors"
          title="Settings"
        >
          <IconSettings size={12} />
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
              <IconWarning size={12} className="shrink-0" />
              <span className="truncate">{statusMessage}</span>
              <button onClick={onOpenLog} className="underline hover:text-red-300 transition-colors shrink-0">view logs</button>
            </span>
          ) : statusMessage.startsWith('Retry') ? (
            <span className="flex items-center justify-center gap-1.5">
              <IconRefresh size={12} className="shrink-0 animate-pulse" />
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
