'use client';

import { useStore } from '@/lib/store';
import type { CharacterSketch, LocationSketch } from '@/types/narrative';

const GENRES = [
  'Crime / Thriller', 'Sci-Fi', 'Fantasy', 'Drama', 'Horror',
  'Political', 'Legal', 'Medical', 'Comedy-Drama', 'Mystery', 'War', 'Western',
] as const;

const TONES = [
  'Gritty & grounded', 'Darkly comedic', 'Cerebral & slow-burn',
  'Pulpy & fast-paced', 'Atmospheric & moody', 'Satirical', 'Epic & sweeping',
] as const;

const SETTINGS = [
  'Contemporary', 'Near-future', 'Far-future',
  'Historical', 'Alternate history', 'Secondary world',
] as const;

const SCALES = [
  { label: 'Intimate', desc: '4-5 characters, tight focus' },
  { label: 'Ensemble', desc: '6-8 characters, multiple POVs' },
  { label: 'Epic', desc: '9-12 characters, sprawling narrative' },
] as const;

const ROLES: CharacterSketch['role'][] = ['anchor', 'recurring', 'transient'];

function ChipSelect<T extends string>({
  options, selected, onSelect, multi = false,
}: {
  options: readonly T[]; selected: T | T[]; onSelect: (val: T) => void; multi?: boolean;
}) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : [selected]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onSelect(opt)}
          className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
            selectedSet.has(opt)
              ? 'bg-white/12 border-white/20 text-text-primary'
              : 'bg-transparent border-border text-text-dim hover:text-text-secondary hover:border-white/12'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

export function WorldStep() {
  const { state, dispatch } = useStore();
  const wd = state.wizardData;

  function update(data: Partial<typeof wd>) {
    dispatch({ type: 'UPDATE_WIZARD_DATA', data });
  }

  function toggleGenre(g: string) {
    const prev = wd.genres;
    const next = prev.includes(g) ? prev.filter((x) => x !== g) : prev.length < 3 ? [...prev, g] : prev;
    update({ genres: next });
  }

  // Character sketches
  function addCharacter() {
    update({ characters: [...wd.characters, { name: '', role: 'recurring', description: '' }] });
  }
  function updateCharacter(i: number, patch: Partial<CharacterSketch>) {
    const chars = [...wd.characters];
    chars[i] = { ...chars[i], ...patch };
    update({ characters: chars });
  }
  function removeCharacter(i: number) {
    update({ characters: wd.characters.filter((_, idx) => idx !== i) });
  }

  // Location sketches
  function addLocation() {
    update({ locations: [...wd.locations, { name: '', description: '' }] });
  }
  function updateLocation(i: number, patch: Partial<LocationSketch>) {
    const locs = [...wd.locations];
    locs[i] = { ...locs[i], ...patch };
    update({ locations: locs });
  }
  function removeLocation(i: number) {
    update({ locations: wd.locations.filter((_, idx) => idx !== i) });
  }

  return (
    <div className="flex flex-col gap-5 max-h-[70vh] overflow-y-auto pr-1">
      <div>
        <h2 className="text-sm font-semibold text-text-primary mb-1">
          Shape the world
        </h2>
        <p className="text-[11px] text-text-dim">
          All fields are optional — the AI will fill in gaps. The more you provide, the more tailored the result.
        </p>
      </div>

      {/* Genre */}
      <div>
        <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">
          Genre <span className="normal-case tracking-normal text-text-dim/60">(up to 3)</span>
        </label>
        <ChipSelect options={GENRES} selected={wd.genres} onSelect={toggleGenre} multi />
      </div>

      {/* Tone */}
      <div>
        <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">Tone</label>
        <ChipSelect options={TONES} selected={wd.tone} onSelect={(t) => update({ tone: wd.tone === t ? '' : t })} />
      </div>

      {/* Setting */}
      <div>
        <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">Setting</label>
        <ChipSelect options={SETTINGS} selected={wd.setting} onSelect={(s) => update({ setting: wd.setting === s ? '' : s })} />
      </div>

      {/* Scale */}
      <div>
        <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">Scale</label>
        <div className="grid grid-cols-3 gap-2">
          {SCALES.map((s) => {
            const active = wd.scale === s.label;
            return (
              <button
                key={s.label}
                type="button"
                onClick={() => update({ scale: active ? '' : s.label })}
                className={`rounded-lg border p-2.5 text-left transition ${
                  active ? 'bg-white/8 border-white/20' : 'bg-transparent border-border hover:border-white/12'
                }`}
              >
                <p className={`text-xs font-medium ${active ? 'text-text-primary' : 'text-text-secondary'}`}>{s.label}</p>
                <p className="text-[10px] text-text-dim mt-0.5">{s.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Character Sketches */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">Characters</label>
          <button type="button" onClick={addCharacter} className="text-[10px] text-text-dim hover:text-text-secondary transition">+ Add</button>
        </div>
        {wd.characters.length === 0 && (
          <p className="text-[11px] text-text-dim/60 italic">No characters defined — the AI will create them from the premise.</p>
        )}
        <div className="flex flex-col gap-2">
          {wd.characters.map((ch, i) => (
            <div key={i} className="flex gap-2 items-start bg-bg-elevated rounded-lg p-2.5 border border-border">
              <div className="flex-1 flex flex-col gap-1.5">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={ch.name}
                    onChange={(e) => updateCharacter(i, { name: e.target.value })}
                    placeholder="Name"
                    className="flex-1 bg-transparent border-b border-border text-xs text-text-primary outline-none placeholder:text-text-dim focus:border-white/20 transition pb-0.5"
                  />
                  <select
                    value={ch.role}
                    onChange={(e) => updateCharacter(i, { role: e.target.value as CharacterSketch['role'] })}
                    className="bg-transparent border-b border-border text-[10px] text-text-dim outline-none pb-0.5"
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <input
                  type="text"
                  value={ch.description}
                  onChange={(e) => updateCharacter(i, { description: e.target.value })}
                  placeholder="Brief description, goals, or traits..."
                  className="bg-transparent border-b border-border text-[10px] text-text-dim outline-none placeholder:text-text-dim/60 focus:border-white/20 transition pb-0.5"
                />
              </div>
              <button type="button" onClick={() => removeCharacter(i)} className="text-text-dim hover:text-text-secondary text-xs mt-0.5">&times;</button>
            </div>
          ))}
        </div>
      </div>

      {/* Location Sketches */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">Locations</label>
          <button type="button" onClick={addLocation} className="text-[10px] text-text-dim hover:text-text-secondary transition">+ Add</button>
        </div>
        {wd.locations.length === 0 && (
          <p className="text-[11px] text-text-dim/60 italic">No locations defined — the AI will create them from the premise.</p>
        )}
        <div className="flex flex-col gap-2">
          {wd.locations.map((loc, i) => (
            <div key={i} className="flex gap-2 items-start bg-bg-elevated rounded-lg p-2.5 border border-border">
              <div className="flex-1 flex flex-col gap-1.5">
                <input
                  type="text"
                  value={loc.name}
                  onChange={(e) => updateLocation(i, { name: e.target.value })}
                  placeholder="Location name"
                  className="bg-transparent border-b border-border text-xs text-text-primary outline-none placeholder:text-text-dim focus:border-white/20 transition pb-0.5"
                />
                <input
                  type="text"
                  value={loc.description}
                  onChange={(e) => updateLocation(i, { description: e.target.value })}
                  placeholder="Description, atmosphere, significance..."
                  className="bg-transparent border-b border-border text-[10px] text-text-dim outline-none placeholder:text-text-dim/60 focus:border-white/20 transition pb-0.5"
                />
              </div>
              <button type="button" onClick={() => removeLocation(i)} className="text-text-dim hover:text-text-secondary text-xs mt-0.5">&times;</button>
            </div>
          ))}
        </div>
      </div>

      {/* Story Direction */}
      <div>
        <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">
          Story Direction
        </label>
        <textarea
          value={wd.storyDirection}
          onChange={(e) => update({ storyDirection: e.target.value })}
          placeholder="How should the story begin? Any key events, twists, or themes to explore early on..."
          className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-20 resize-none outline-none placeholder:text-text-dim focus:border-white/16 transition"
        />
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-1">
        <button
          onClick={() => dispatch({ type: 'SET_WIZARD_STEP', step: 'premise' })}
          className="text-text-dim text-xs hover:text-text-secondary transition"
        >
          &larr; Back
        </button>
        <button
          onClick={() => dispatch({ type: 'SET_WIZARD_STEP', step: 'generate' })}
          className="bg-white/8 hover:bg-white/12 text-text-primary text-xs font-semibold px-5 py-2 rounded-lg transition"
        >
          Generate &rarr;
        </button>
      </div>
    </div>
  );
}
