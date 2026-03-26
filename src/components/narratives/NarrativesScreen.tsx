'use client';

import { useStore } from '@/lib/store';
import type { NarrativeEntry } from '@/types/narrative';

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function NarrativeCard({ entry }: { entry: NarrativeEntry }) {
  const { dispatch } = useStore();

  return (
    <div
      onClick={() => dispatch({ type: 'SET_ACTIVE_NARRATIVE', id: entry.id })}
      className="bg-bg-panel rounded-xl p-4 border border-border hover:border-white/[0.16] cursor-pointer transition relative group"
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          dispatch({ type: 'DELETE_NARRATIVE', id: entry.id });
        }}
        className="absolute top-3 right-3 text-text-dim hover:text-text-primary text-sm leading-none opacity-0 group-hover:opacity-100 transition"
      >
        &times;
      </button>

      <h3 className="text-sm font-semibold text-text-primary">{entry.title}</h3>
      <p className="text-xs text-text-secondary mt-1 line-clamp-2">{entry.description}</p>

      <div className="flex items-center gap-3 text-[10px] text-text-dim mt-3">
        <span>{entry.sceneCount} scenes</span>
        <span>{timeAgo(entry.updatedAt)}</span>
      </div>
    </div>
  );
}

export function NarrativesScreen() {
  const { state, dispatch } = useStore();
  const narratives = state.narratives;

  return (
    <div className="min-h-screen bg-bg-base flex flex-col items-center pt-20">
      <h1 className="text-lg font-semibold text-text-primary mb-1">InkTide</h1>
      <p className="text-sm text-text-secondary mb-8">Thread-first storytelling</p>

      {narratives.length === 0 ? (
        <div className="flex flex-col items-center gap-4">
          <p className="text-text-dim text-sm">No narratives yet</p>
          <button
            onClick={() => dispatch({ type: 'OPEN_WIZARD' })}
            className="bg-bg-elevated hover:bg-bg-overlay text-text-secondary text-sm px-4 py-2 rounded-lg border border-border transition"
          >
            New Narrative
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl w-full px-4">
            {narratives.map((entry) => (
              <NarrativeCard key={entry.id} entry={entry} />
            ))}
          </div>
          <button
            onClick={() => dispatch({ type: 'OPEN_WIZARD' })}
            className="bg-bg-elevated hover:bg-bg-overlay text-text-secondary text-sm px-4 py-2 rounded-lg border border-border mt-4 transition"
          >
            New Narrative
          </button>
        </>
      )}
    </div>
  );
}
