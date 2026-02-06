'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { generateNarrative } from '@/lib/ai';

const GENRES = [
  'Crime / Thriller',
  'Sci-Fi',
  'Fantasy',
  'Drama',
  'Horror',
  'Political',
  'Legal',
  'Medical',
  'Comedy-Drama',
  'Mystery',
  'War',
  'Western',
] as const;

const TONES = [
  'Gritty & grounded',
  'Darkly comedic',
  'Cerebral & slow-burn',
  'Pulpy & fast-paced',
  'Atmospheric & moody',
  'Satirical',
  'Epic & sweeping',
] as const;

const SETTINGS = [
  'Contemporary',
  'Near-future',
  'Far-future',
  'Historical',
  'Alternate history',
  'Secondary world',
] as const;

const SCALES = [
  { label: 'Intimate', desc: '4-5 characters, tight focus', characters: '4-5', threads: '3-4' },
  { label: 'Ensemble', desc: '6-8 characters, multiple POVs', characters: '6-8', threads: '5-7' },
  { label: 'Epic', desc: '9-12 characters, sprawling narrative', characters: '9-12', threads: '7-10' },
] as const;

function ChipSelect<T extends string>({
  options,
  selected,
  onSelect,
  multi = false,
}: {
  options: readonly T[];
  selected: T | T[];
  onSelect: (val: T) => void;
  multi?: boolean;
}) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : [selected]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = selectedSet.has(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(opt)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
              active
                ? 'bg-white/12 border-white/20 text-text-primary'
                : 'bg-transparent border-border text-text-dim hover:text-text-secondary hover:border-white/12'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function PremiseStep() {
  const router = useRouter();
  const { state, dispatch } = useStore();
  const [title, setTitle] = useState('');
  const [premise, setPremise] = useState(state.wizardPrefill || '');
  const [genres, setGenres] = useState<string[]>([]);
  const [tone, setTone] = useState('');
  const [setting, setSetting] = useState('');
  const [scale, setScale] = useState<(typeof SCALES)[number] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isDuplicate = title.trim() !== '' && state.narratives.some(
    (n) => n.title.toLowerCase() === title.trim().toLowerCase()
  );

  function toggleGenre(g: string) {
    setGenres((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : prev.length < 3 ? [...prev, g] : prev,
    );
  }

  function buildEnhancedPremise() {
    let enhanced = premise;
    const details: string[] = [];
    if (genres.length > 0) details.push(`Genre: ${genres.join(', ')}`);
    if (tone) details.push(`Tone: ${tone}`);
    if (setting) details.push(`Setting era: ${setting}`);
    if (scale) details.push(`Scale: ${scale.label} (${scale.characters} characters, ${scale.threads} threads)`);
    if (details.length > 0) {
      enhanced += '\n\n' + details.join('\n');
    }
    return enhanced;
  }

  async function handleGenerate() {
    if (!title.trim() || !premise.trim() || isDuplicate) return;
    setLoading(true);
    setError('');
    try {
      const narrative = await generateNarrative(title, buildEnhancedPremise());
      dispatch({ type: 'ADD_NARRATIVE', narrative });
      router.push(`/series/${narrative.id}`);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 max-h-[80vh] overflow-y-auto pr-1">
      <div>
        <h2 className="text-sm font-semibold text-text-primary mb-1">
          Create a New Narrative
        </h2>
        <p className="text-[11px] text-text-dim">
          The more detail you provide, the richer the generated world.
        </p>
      </div>

      {/* Title */}
      <div>
        <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. The Gilded Cage"
          className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full outline-none placeholder:text-text-dim focus:border-white/16 transition"
          disabled={loading}
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
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          placeholder="Describe your world, characters, and the central conflict..."
          className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-24 resize-none outline-none placeholder:text-text-dim focus:border-white/16 transition"
          disabled={loading}
        />
      </div>

      {/* Genre */}
      <div>
        <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">
          Genre <span className="normal-case tracking-normal text-text-dim/60">(up to 3)</span>
        </label>
        <ChipSelect options={GENRES} selected={genres} onSelect={toggleGenre} multi />
      </div>

      {/* Tone */}
      <div>
        <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">
          Tone
        </label>
        <ChipSelect
          options={TONES}
          selected={tone}
          onSelect={(t) => setTone(tone === t ? '' : t)}
        />
      </div>

      {/* Setting era */}
      <div>
        <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">
          Setting
        </label>
        <ChipSelect
          options={SETTINGS}
          selected={setting}
          onSelect={(s) => setSetting(setting === s ? '' : s)}
        />
      </div>

      {/* Scale */}
      <div>
        <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">
          Scale
        </label>
        <div className="grid grid-cols-3 gap-2">
          {SCALES.map((s) => {
            const active = scale?.label === s.label;
            return (
              <button
                key={s.label}
                type="button"
                onClick={() => setScale(active ? null : s)}
                className={`rounded-lg border p-2.5 text-left transition ${
                  active
                    ? 'bg-white/8 border-white/20'
                    : 'bg-transparent border-border hover:border-white/12'
                }`}
              >
                <p className={`text-xs font-medium ${active ? 'text-text-primary' : 'text-text-secondary'}`}>
                  {s.label}
                </p>
                <p className="text-[10px] text-text-dim mt-0.5">{s.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="bg-stakes/10 border border-stakes/30 rounded-lg px-3 py-2">
          <p className="text-sm text-stakes font-medium">Generation failed</p>
          <p className="text-xs text-stakes/80 mt-1">{error}</p>
        </div>
      )}

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
        disabled={loading || !title.trim() || !premise.trim() || isDuplicate}
        className="mt-1 self-end bg-white/[0.08] hover:bg-white/[0.12] text-text-primary text-xs font-semibold px-5 py-2 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none"
      >
        {loading ? 'Generating...' : 'Generate Narrative'}
      </button>
    </div>
  );
}
