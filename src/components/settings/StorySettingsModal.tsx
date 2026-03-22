'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { apiHeaders } from '@/lib/api-headers';
import type { StorySettings, POVMode } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS, BRANCH_TIME_HORIZON_OPTIONS } from '@/types/narrative';
import { MATRIX_PRESETS } from '@/lib/markov';

type Tab = 'pov' | 'direction' | 'structure' | 'memory' | 'cover';

const TABS: { label: string; value: Tab }[] = [
  { label: 'POV', value: 'pov' },
  { label: 'Direction', value: 'direction' },
  { label: 'Structure', value: 'structure' },
  { label: 'Memory', value: 'memory' },
  { label: 'Cover', value: 'cover' },
];

const POV_MODES: { value: POVMode; label: string; desc: string }[] = [
  { value: 'single', label: 'Single POV', desc: 'One protagonist drives every scene. Tight interiority, dramatic irony from limited knowledge.' },
  { value: 'ensemble', label: 'Ensemble', desc: 'Multiple POV characters rotate. Wider world, more threads, epic scope.' },
  { value: 'free', label: 'Free (Default)', desc: 'Any character can be POV. The engine picks whoever fits the scene best.' },
];

export function StorySettingsModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [tab, setTab] = useState<Tab>('pov');
  const [settings, setSettings] = useState<StorySettings>({
    ...DEFAULT_STORY_SETTINGS,
    ...narrative?.storySettings,
  });

  function update(partial: Partial<StorySettings>) {
    setSettings((s) => ({ ...s, ...partial }));
  }

  const [coverGenerating, setCoverGenerating] = useState(false);
  const [coverError, setCoverError] = useState('');
  const coverUrl = narrative?.coverImageUrl;

  function handleSave() {
    dispatch({ type: 'SET_STORY_SETTINGS', settings });
    onClose();
  }

  async function handleGenerateCover() {
    if (!narrative) return;
    setCoverGenerating(true);
    setCoverError('');
    try {
      const res = await fetch('/api/generate-cover', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          title: narrative.title,
          description: narrative.description,
          rules: narrative.rules,
          imageStyle: narrative.imageStyle,
          coverPrompt: settings.coverPrompt,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Cover generation failed');
      }
      const { imageUrl } = await res.json();
      dispatch({ type: 'SET_COVER_IMAGE', narrativeId: narrative.id, imageUrl });
    } catch (err) {
      setCoverError(err instanceof Error ? err.message : String(err));
    } finally {
      setCoverGenerating(false);
    }
  }

  function handleRemoveCover() {
    if (!narrative) return;
    dispatch({ type: 'SET_COVER_IMAGE', narrativeId: narrative.id, imageUrl: '' });
  }

  const allCharacters = narrative
    ? Object.values(narrative.characters)
    : [];

  const showPovPicker = settings.povMode !== 'free';
  const maxPovChars = settings.povMode === 'single' ? 1 : allCharacters.length;

  function togglePovCharacter(charId: string) {
    const current = settings.povCharacterIds;
    if (current.includes(charId)) {
      update({ povCharacterIds: current.filter((id) => id !== charId) });
    } else if (current.length < maxPovChars) {
      update({ povCharacterIds: [...current, charId] });
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="glass max-w-lg w-full rounded-2xl p-6 relative max-h-[85vh] flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none"
        >
          &times;
        </button>

        <h2 className="text-sm font-semibold text-text-primary mb-1">Story Settings</h2>
        <p className="text-[10px] text-text-dim uppercase tracking-wider mb-3">
          Shape how your narrative is generated
        </p>

        {/* Tabs */}
        <div className="flex gap-1 bg-bg-elevated rounded-lg p-0.5 mb-4 shrink-0">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`flex-1 text-[11px] py-1.5 rounded-md transition-colors ${
                tab === t.value
                  ? 'bg-white/10 text-text-primary font-semibold'
                  : 'text-text-dim hover:text-text-secondary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-1">
          {tab === 'pov' && (
            <>
              {/* POV Mode */}
              <div>
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                  POV Mode
                </label>
                <div className="space-y-1.5">
                  {POV_MODES.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => {
                        update({
                          povMode: m.value,
                          povCharacterIds: m.value === 'free' ? [] : settings.povCharacterIds,
                        });
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                        settings.povMode === m.value
                          ? 'border-blue-500/50 bg-blue-500/10'
                          : 'border-white/5 bg-white/2 hover:bg-white/5'
                      }`}
                    >
                      <span className="text-[11px] font-semibold text-text-primary">{m.label}</span>
                      <p className="text-[10px] text-text-dim mt-0.5 leading-snug">{m.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* POV Character Picker */}
              {showPovPicker && allCharacters.length > 0 && (
                <div>
                  <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                    POV Character{maxPovChars > 1 ? 's' : ''}{maxPovChars < allCharacters.length ? ` (select up to ${maxPovChars})` : ''}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {allCharacters.map((c) => {
                      const selected = settings.povCharacterIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() => togglePovCharacter(c.id)}
                          className={`text-[11px] px-3 py-1.5 rounded-full border transition-colors ${
                            selected
                              ? 'border-blue-500/50 bg-blue-500/15 text-blue-300'
                              : 'border-white/10 text-text-dim hover:text-text-secondary hover:bg-white/5'
                          }`}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                  {settings.povCharacterIds.length === 0 && (
                    <p className="text-[9px] text-amber-400/60 mt-1.5">
                      No anchors selected — engine will choose the most prominent anchor.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {tab === 'direction' && (
            <>
              {/* Story Direction */}
              <div>
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                  Story Direction
                </label>
                <textarea
                  value={settings.storyDirection}
                  onChange={(e) => update({ storyDirection: e.target.value })}
                  placeholder="e.g. &quot;Build toward a confrontation between the two factions, with the protagonist forced to choose sides&quot;..."
                  className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-blue-500/40 resize-none h-24"
                />
                <p className="text-[9px] text-text-dim/50 mt-1">
                  High-level guidance for where the story should go. Steers every arc.
                </p>
              </div>

            </>
          )}

          {tab === 'structure' && (
            <>
              {/* Target Arc Length */}
              <div>
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                  Target Arc Length
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={2}
                    max={8}
                    step={1}
                    value={settings.targetArcLength}
                    onChange={(e) => update({ targetArcLength: Number(e.target.value) })}
                    className="flex-1 accent-blue-500"
                  />
                  <span className="text-[11px] text-text-primary font-mono w-16 text-right">
                    {settings.targetArcLength} scenes
                  </span>
                </div>
              </div>

              {/* Rhythm Preset */}
              <div>
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                  Rhythm Profile
                </label>
                <p className="text-[10px] text-text-dim mb-3 leading-snug">
                  Controls the Markov chain transition matrix used to sequence scene pacing. Each profile produces a different narrative rhythm.
                </p>
                <div className="flex flex-col gap-1.5">
                  {MATRIX_PRESETS.map((preset) => {
                    const isSelected = (settings.rhythmPreset || 'harry_potter') === preset.key;
                    return (
                      <button
                        key={preset.key}
                        onClick={() => update({ rhythmPreset: preset.key })}
                        className={`px-3 py-2.5 rounded-lg text-left transition-colors border ${
                          isSelected
                            ? 'border-blue-500/40 bg-blue-500/10'
                            : 'border-white/6 hover:border-white/12 hover:bg-white/3'
                        }`}
                      >
                        <span className={`text-[11px] font-semibold ${isSelected ? 'text-text-primary' : 'text-text-secondary'}`}>
                          {preset.name}
                        </span>
                        <p className="text-[10px] text-text-dim mt-0.5 leading-snug">{preset.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {tab === 'cover' && (
            <>
              {/* Preview */}
              <div className="flex justify-center">
                <div className="w-36 rounded-lg overflow-hidden border border-white/10">
                  {coverUrl ? (
                    <img src={coverUrl} alt="Cover" className="w-full aspect-3/4 object-cover" />
                  ) : (
                    <div className="w-full aspect-3/4 bg-white/3 flex items-center justify-center">
                      <span className="text-[9px] text-text-dim/30">No cover</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Custom Prompt */}
              <div>
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-1.5">
                  Image Prompt <span className="normal-case tracking-normal text-text-dim/50">(optional)</span>
                </label>
                <textarea
                  value={settings.coverPrompt}
                  onChange={(e) => update({ coverPrompt: e.target.value })}
                  placeholder="e.g. &quot;Dark fantasy oil painting of a lone figure standing before an enormous gate carved into a mountain, storm clouds above, warm light spilling from within&quot;"
                  className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-blue-500/40 resize-none h-20"
                />
                <p className="text-[9px] text-text-dim/50 mt-1">
                  {settings.coverPrompt.trim()
                    ? 'Your custom prompt will be used directly.'
                    : 'Leave empty to auto-generate from title, description, and image style.'}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerateCover}
                  disabled={coverGenerating}
                  className="flex-1 text-[11px] px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
                >
                  {coverGenerating ? 'Generating…' : coverUrl ? 'Regenerate' : 'Generate Cover'}
                </button>

                {coverUrl && (
                  <button
                    onClick={handleRemoveCover}
                    className="text-[10px] px-3 py-2 rounded-lg border border-white/5 text-text-dim hover:text-text-secondary hover:bg-white/5 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>

              {coverError && (
                <p className="text-[10px] text-red-400/80">{coverError}</p>
              )}
            </>
          )}

          {tab === 'memory' && (
            <>
              <div>
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                  Branch Time Horizon
                </label>
                <div className="space-y-1.5">
                  {BRANCH_TIME_HORIZON_OPTIONS.map((v) => (
                    <button
                      key={v}
                      onClick={() => update({ branchTimeHorizon: v })}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                        settings.branchTimeHorizon === v
                          ? 'border-blue-500/50 bg-blue-500/10'
                          : 'border-white/5 bg-white/2 hover:bg-white/5'
                      }`}
                    >
                      <span className="text-[11px] font-semibold text-text-primary">{v} scenes</span>
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-text-dim/50 mt-2">
                  How many recent scenes the AI sees when generating. Lower values reduce cost and keep focus tight. Higher values give the AI more narrative history to draw from.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-white/5 shrink-0">
          <button
            onClick={() => setSettings({ ...DEFAULT_STORY_SETTINGS })}
            className="text-[10px] px-3 py-1.5 rounded-md text-text-dim hover:text-text-secondary transition-colors"
          >
            Reset Defaults
          </button>
          <button
            onClick={onClose}
            className="text-[10px] px-3 py-1.5 rounded-md bg-white/5 text-text-dim hover:text-text-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="text-[10px] px-3 py-1.5 rounded-md bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors font-semibold"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
