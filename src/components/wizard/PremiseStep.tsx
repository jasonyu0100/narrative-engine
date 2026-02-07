'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';

export function PremiseStep() {
  const { state, dispatch } = useStore();
  const wd = state.wizardData;
  const [suggesting, setSuggesting] = useState(false);

  const isDuplicate = wd.title.trim() !== '' && state.narratives.some(
    (n) => n.title.toLowerCase() === wd.title.trim().toLowerCase()
  );

  function update(data: Partial<typeof wd>) {
    dispatch({ type: 'UPDATE_WIZARD_DATA', data });
  }

  async function handleSuggest() {
    if (suggesting) return;
    setSuggesting(true);
    try {
      const res = await fetch('/api/suggest-premise', { method: 'POST' });
      const data = await res.json();
      if (data.title || data.premise) {
        update({ title: data.title ?? '', premise: data.premise ?? '' });
      }
    } catch {
      // silently fail
    } finally {
      setSuggesting(false);
    }
  }

  const canContinue = wd.title.trim() && wd.premise.trim() && !isDuplicate;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text-primary mb-1">
            What&apos;s the story?
          </h2>
          <p className="text-[11px] text-text-dim">
            Start with a title and premise. You&apos;ll refine the details next.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSuggest}
          disabled={suggesting}
          className="shrink-0 flex items-center gap-1.5 text-[11px] text-text-dim hover:text-text-secondary border border-border hover:border-white/12 rounded-full px-3 py-1 transition disabled:opacity-40 disabled:pointer-events-none"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          {suggesting ? 'Suggesting...' : 'Suggest'}
        </button>
      </div>

      {/* Title */}
      <div>
        <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">
          Title
        </label>
        <input
          type="text"
          value={wd.title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="e.g. The Gilded Cage"
          className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full outline-none placeholder:text-text-dim focus:border-white/16 transition"
        />
        {isDuplicate && (
          <p className="text-[11px] text-stakes mt-1">A series with this name already exists.</p>
        )}
      </div>

      {/* Premise */}
      <div>
        <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">
          Premise
        </label>
        <textarea
          value={wd.premise}
          onChange={(e) => update({ premise: e.target.value })}
          placeholder="Describe your world, characters, and the central conflict..."
          className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-28 resize-none outline-none placeholder:text-text-dim focus:border-white/16 transition"
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => dispatch({ type: 'SET_WIZARD_STEP', step: 'world' })}
          disabled={!canContinue}
          className="bg-white/[0.08] hover:bg-white/[0.12] text-text-primary text-xs font-semibold px-5 py-2 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none"
        >
          Next &rarr;
        </button>
      </div>
    </div>
  );
}
