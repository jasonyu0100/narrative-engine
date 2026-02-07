'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { generateNarrative } from '@/lib/ai';

export function GenerateStep() {
  const router = useRouter();
  const { state, dispatch } = useStore();
  const wd = state.wizardData;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const started = useRef(false);

  function buildEnhancedPremise() {
    const parts: string[] = [wd.premise];
    const details: string[] = [];

    if (wd.genres.length > 0) details.push(`Genre: ${wd.genres.join(', ')}`);
    if (wd.tone) details.push(`Tone: ${wd.tone}`);
    if (wd.setting) details.push(`Setting era: ${wd.setting}`);
    if (wd.scale) details.push(`Scale: ${wd.scale}`);

    if (wd.characters.length > 0) {
      const charLines = wd.characters
        .filter((c) => c.name.trim())
        .map((c) => `  - ${c.name} (${c.role})${c.description ? `: ${c.description}` : ''}`);
      if (charLines.length > 0) {
        details.push(`Key characters:\n${charLines.join('\n')}`);
      }
    }

    if (wd.locations.length > 0) {
      const locLines = wd.locations
        .filter((l) => l.name.trim())
        .map((l) => `  - ${l.name}${l.description ? `: ${l.description}` : ''}`);
      if (locLines.length > 0) {
        details.push(`Key locations:\n${locLines.join('\n')}`);
      }
    }

    if (wd.storyDirection.trim()) {
      details.push(`Story direction: ${wd.storyDirection.trim()}`);
    }

    if (details.length > 0) {
      parts.push('', ...details);
    }

    return parts.join('\n');
  }

  async function handleGenerate() {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const narrative = await generateNarrative(wd.title, buildEnhancedPremise());
      dispatch({ type: 'ADD_NARRATIVE', narrative });
      router.push(`/series/${narrative.id}`);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  }

  // Auto-start generation on mount
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      handleGenerate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-sm font-semibold text-text-primary mb-1">
          {loading ? 'Generating your world...' : error ? 'Generation failed' : 'Ready'}
        </h2>
        {loading && (
          <p className="text-[11px] text-text-dim">
            Creating characters, locations, threads, relationships, and scenes. This may take a moment.
          </p>
        )}
      </div>

      {loading && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            {['Building characters & relationships...', 'Crafting locations & world lore...', 'Weaving narrative threads...', 'Generating opening scenes...'].map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <div
                  className="h-1.5 flex-1 bg-white/[0.06] rounded-full overflow-hidden"
                >
                  <div
                    className="h-full bg-white/20 rounded-full animate-pulse"
                    style={{ width: '60%', animationDelay: `${i * 0.3}s` }}
                  />
                </div>
                <span className="text-[10px] text-text-dim w-48 shrink-0">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-stakes/10 border border-stakes/30 rounded-lg px-3 py-2">
          <p className="text-xs text-stakes/80 mt-1">{error}</p>
        </div>
      )}

      <div className="flex items-center justify-between mt-1">
        <button
          onClick={() => dispatch({ type: 'SET_WIZARD_STEP', step: 'world' })}
          disabled={loading}
          className="text-text-dim text-xs hover:text-text-secondary transition disabled:opacity-30 disabled:pointer-events-none"
        >
          &larr; Back
        </button>
        {error && (
          <button
            onClick={handleGenerate}
            className="bg-white/8 hover:bg-white/12 text-text-primary text-xs font-semibold px-5 py-2 rounded-lg transition"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
