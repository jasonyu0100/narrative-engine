'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { generateNarrative } from '@/lib/ai';

export function PremiseStep() {
  const { dispatch } = useStore();
  const [title, setTitle] = useState('');
  const [premise, setPremise] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleGenerate() {
    if (!title.trim() || !premise.trim()) return;
    setLoading(true);
    setError('');
    try {
      const narrative = await generateNarrative(title, premise);
      dispatch({ type: 'ADD_NARRATIVE', narrative });
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-text-primary">
        Create a New Narrative
      </h2>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Narrative title..."
        className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full outline-none placeholder:text-text-dim"
        disabled={loading}
      />

      <textarea
        value={premise}
        onChange={(e) => setPremise(e.target.value)}
        placeholder="Describe your world, characters, and the central conflict..."
        className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-32 resize-none outline-none placeholder:text-text-dim"
        disabled={loading}
      />

      {error && <p className="text-xs text-pressure">{error}</p>}

      {loading && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-text-secondary">Generating world, characters, threads, and scenes...</p>
          <div className="h-2 w-3/4 bg-white/[0.06] rounded animate-pulse" />
          <div className="h-2 w-1/2 bg-white/[0.06] rounded animate-pulse" />
          <div className="h-2 w-5/6 bg-white/[0.06] rounded animate-pulse" />
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={loading || !title.trim() || !premise.trim()}
        className="mt-2 self-start bg-white/[0.08] hover:bg-white/[0.12] text-text-primary text-xs font-semibold px-4 py-2 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none"
      >
        {loading ? 'Generating...' : 'Generate Narrative'}
      </button>
    </div>
  );
}
