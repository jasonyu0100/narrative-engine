'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import type { StorySettings, POVMode, WorldFocusMode } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS, BRANCH_TIME_HORIZON_OPTIONS } from '@/types/narrative';
import { NARRATIVE_CUBE } from '@/types/narrative';
import type { CubeCornerKey } from '@/types/narrative';
import { MATRIX_PRESETS, type TransitionMatrix } from '@/lib/markov';

type Tab = 'direction' | 'guidance' | 'constraints' | 'rhythm' | 'pov' | 'other';

const TABS: { label: string; value: Tab }[] = [
  { label: 'Direction', value: 'direction' },
  { label: 'Constraints', value: 'constraints' },
  { label: 'Guidance', value: 'guidance' },
  { label: 'Rhythm', value: 'rhythm' },
  { label: 'POV', value: 'pov' },
  { label: 'Other', value: 'other' },
];

const POV_MODES: { value: POVMode; label: string; desc: string }[] = [
  { value: 'single', label: 'Single POV', desc: 'One protagonist drives every scene. Tight interiority, dramatic irony from limited knowledge.' },
  { value: 'pareto', label: 'Pareto', desc: '~80% protagonist, ~20% other perspectives. Tight focus with occasional critical cuts to scenes the protagonist can\'t witness.' },
  { value: 'ensemble', label: 'Ensemble', desc: 'Multiple POV characters rotate. Wider world, more threads, epic scope.' },
  { value: 'free', label: 'Free (Default)', desc: 'Any character can be POV. The engine picks whoever fits the scene best.' },
];

export function StorySettingsModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [tab, setTab] = useState<Tab>('direction');
  const [settings, setSettings] = useState<StorySettings>({
    ...DEFAULT_STORY_SETTINGS,
    ...narrative?.storySettings,
  });

  function update(partial: Partial<StorySettings>) {
    setSettings((s) => ({ ...s, ...partial }));
  }

  function handleSave() {
    dispatch({ type: 'SET_STORY_SETTINGS', settings });
    onClose();
  }

  const allCharacters = narrative
    ? Object.values(narrative.characters)
    : [];

  const showPovPicker = settings.povMode !== 'free';
  const maxPovChars = settings.povMode === 'single' || settings.povMode === 'pareto' ? 1 : allCharacters.length;

  function togglePovCharacter(charId: string) {
    const current = settings.povCharacterIds;
    if (current.includes(charId)) {
      update({ povCharacterIds: current.filter((id) => id !== charId) });
    } else if (current.length < maxPovChars) {
      update({ povCharacterIds: [...current, charId] });
    }
  }

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="85vh">
      <ModalHeader onClose={onClose}>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Story Settings</h2>
          <p className="text-[10px] text-text-dim uppercase tracking-wider">
            Shape how your narrative is generated
          </p>
        </div>
      </ModalHeader>
      <ModalBody className="p-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-bg-elevated rounded-lg p-0.5 mb-4">
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
          {tab === 'direction' && (
            <>
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

          {tab === 'guidance' && (
            <>
              <div>
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                  Narrative Guidance
                </label>
                <textarea
                  value={settings.narrativeGuidance}
                  onChange={(e) => update({ narrativeGuidance: e.target.value })}
                  placeholder={"e.g. \"Keep the opening scope local — academy, village, immediate survival. Don't sprawl into multi-faction politics until the first arc has paid off.\n\nReveal only what is locally actionable. Keep the larger world latent.\n\nThe protagonist wins through knowledge and shamelessness, not hidden power.\n\nPolitics should appear as differential access, not speeches and coups.\n\nInheritances are strategic exploit nodes, not dungeon crawls.\""}
                  className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-blue-500/40 resize-none h-48"
                />
                <p className="text-[9px] text-text-dim/50 mt-1">
                  Editorial principles that govern how the story is told — scope discipline, reveal pacing, tonal rules, structural philosophy. Paste feedback from another AI or write your own. These override default generation instincts.
                </p>
              </div>

            </>
          )}

          {tab === 'constraints' && (
            <>
              <div>
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                  Story Constraints
                </label>
                <textarea
                  value={settings.storyConstraints}
                  onChange={(e) => update({ storyConstraints: e.target.value })}
                  placeholder="e.g. &quot;No deus ex machina resolutions. Don't kill off the protagonist's mentor yet. Avoid romance subplots between the leads&quot;..."
                  className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-blue-500/40 resize-none h-24"
                />
                <p className="text-[9px] text-text-dim/50 mt-1">
                  What the AI should avoid. Negative guardrails that steer generation away from unwanted directions.
                </p>
              </div>
            </>
          )}

          {tab === 'rhythm' && (() => {
            const CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];
            const COLORS: Record<CubeCornerKey, string> = {
              HHH: '#f59e0b', HHL: '#ef4444', HLH: '#a855f7', HLL: '#6366f1',
              LHH: '#22d3ee', LHL: '#22c55e', LLH: '#3b82f6', LLL: '#6b7280',
            };
            const resolvedKey = settings.rhythmPreset || 'storyteller';
            const activePreset = MATRIX_PRESETS.find((p) => p.key === resolvedKey);
            const matrix: TransitionMatrix | null = activePreset?.matrix ?? null;

            return (
              <>
                {/* Preset cards */}
                <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 mb-4">
                  {MATRIX_PRESETS.map((preset) => {
                    const isSelected = preset.key === resolvedKey;
                    return (
                      <button
                        key={preset.key}
                        onClick={() => update({ rhythmPreset: preset.key })}
                        className={`shrink-0 w-36 rounded-xl text-left transition-all border p-3 flex flex-col gap-1.5 ${
                          isSelected
                            ? 'border-blue-500/40 bg-blue-500/8 ring-1 ring-blue-500/20'
                            : 'border-white/6 hover:border-white/15 hover:bg-white/3'
                        }`}
                      >
                        <span className={`text-[12px] font-semibold leading-tight ${isSelected ? 'text-text-primary' : 'text-text-secondary'}`}>
                          {preset.name}
                        </span>
                        <p className="text-[9px] text-text-dim leading-snug flex-1">{preset.description}</p>
                        {isSelected && (
                          <span className="text-[8px] text-blue-400 uppercase tracking-wider font-medium">Active</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Transition matrix visualization */}
                {matrix && (
                  <div>
                    <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                      Transition Matrix — {activePreset?.name}
                    </label>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[10px] border-collapse">
                        <thead>
                          <tr>
                            <th className="p-1.5 text-left text-text-dim font-medium w-20">From ↓ To →</th>
                            {CORNERS.map((c) => (
                              <th key={c} className="p-1.5 text-center font-medium" style={{ color: COLORS[c] }}>
                                {NARRATIVE_CUBE[c].name.slice(0, 5)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {CORNERS.map((from) => {
                            const row = matrix[from];
                            const total = CORNERS.reduce((s, to) => s + (row[to] ?? 0), 0);
                            return (
                              <tr key={from} className="border-t border-white/5">
                                <td className="p-1.5 font-medium" style={{ color: COLORS[from] }}>
                                  {NARRATIVE_CUBE[from].name.slice(0, 5)}
                                </td>
                                {CORNERS.map((to) => {
                                  const prob = row[to] ?? 0;
                                  const intensity = Math.round(20 + prob * 80);
                                  return (
                                    <td
                                      key={to}
                                      className="p-1.5 text-center tabular-nums"
                                      style={{
                                        backgroundColor: prob > 0 ? `rgba(52, 211, 153, ${intensity / 100})` : 'transparent',
                                        color: prob >= 0.25 ? '#fff' : prob > 0.05 ? '#d1d5db' : '#4b5563',
                                      }}
                                    >
                                      {total > 0 && prob > 0 ? `${Math.round(prob * 100)}` : total > 0 ? '·' : '–'}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-[9px] text-text-dim">
                      <span>Probability:</span>
                      <div className="flex items-center gap-1">
                        <div className="w-10 h-2 rounded-sm" style={{ background: 'linear-gradient(to right, rgba(52,211,153,0.05), rgba(52,211,153,0.9))' }} />
                        <span>0%</span>
                        <span className="ml-6">100%</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            );
          })()}

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

          {tab === 'other' && (
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

              {/* Thread Resolution Speed */}
              <div>
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                  Thread Resolution Speed
                </label>
                <div className="space-y-1.5">
                  {([
                    { value: 'slow' as const, label: 'Slow Burn', desc: '~10 scenes between transitions — threads develop gradually with room to breathe' },
                    { value: 'moderate' as const, label: 'Balanced', desc: '~6 scenes between transitions — steady progression matching published literature' },
                    { value: 'fast' as const, label: 'Fast Paced', desc: '~4 scenes between transitions — threads escalate and resolve quickly, every arc must advance the plot' },
                  ]).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => update({ threadResolutionSpeed: opt.value })}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                        (settings.threadResolutionSpeed ?? 'moderate') === opt.value
                          ? 'border-blue-500/50 bg-blue-500/10'
                          : 'border-white/5 bg-white/2 hover:bg-white/5'
                      }`}
                    >
                      <span className="text-[11px] font-semibold text-text-primary">{opt.label}</span>
                      <span className="text-[10px] text-text-dim ml-2">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* World Focus */}
              <div>
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                  World Focus
                </label>
                <div className="space-y-1.5">
                  {([
                    { value: 'none' as WorldFocusMode, label: 'None', desc: 'No world build seeded into generation' },
                    { value: 'latest' as WorldFocusMode, label: 'Latest', desc: 'Always seed with the most recent world commit' },
                    { value: 'custom' as WorldFocusMode, label: 'Custom', desc: 'Pick a specific world commit to focus on' },
                  ]).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => update({ worldFocus: opt.value })}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                        settings.worldFocus === opt.value
                          ? 'border-blue-500/50 bg-blue-500/10'
                          : 'border-white/5 bg-white/2 hover:bg-white/5'
                      }`}
                    >
                      <span className="text-[11px] font-semibold text-text-primary">{opt.label}</span>
                      <span className="text-[10px] text-text-dim ml-2">{opt.desc}</span>
                    </button>
                  ))}
                </div>
                {settings.worldFocus === 'custom' && narrative && (() => {
                  const resolvedSet = new Set(state.resolvedEntryKeys);
                  const worldBuilds = Object.values(narrative.worldBuilds).filter((wb) => resolvedSet.has(wb.id));
                  if (worldBuilds.length === 0) return <p className="text-[10px] text-text-dim mt-2">No world commits available</p>;
                  return (
                    <div className="mt-2 flex flex-col gap-1 max-h-24 overflow-y-auto">
                      {worldBuilds.map((wb) => (
                        <button
                          key={wb.id}
                          onClick={() => update({ worldFocusId: wb.id })}
                          className={`text-left rounded px-2 py-1.5 text-[10px] transition border ${
                            settings.worldFocusId === wb.id
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                              : 'bg-bg-elevated border-border text-text-secondary hover:border-white/16'
                          }`}
                        >
                          {wb.summary}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Expansion Strategy */}
              <div>
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                  Expansion Strategy
                </label>
                <div className="space-y-1.5">
                  {([
                    { value: 'dynamic' as const, label: 'Dynamic', desc: 'Auto-selects based on cast staleness, location concentration, and knowledge density' },
                    { value: 'depth' as const, label: 'Depth', desc: 'Deepen the existing sandbox — more detail, not more map' },
                    { value: 'breadth' as const, label: 'Breadth', desc: 'Widen the world — new regions, factions, conflicts' },
                  ]).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => update({ expansionStrategy: opt.value })}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                        settings.expansionStrategy === opt.value
                          ? 'border-blue-500/50 bg-blue-500/10'
                          : 'border-white/5 bg-white/2 hover:bg-white/5'
                      }`}
                    >
                      <span className="text-[11px] font-semibold text-text-primary">{opt.label}</span>
                      <span className="text-[10px] text-text-dim ml-2">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Branch Time Horizon */}
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

      </ModalBody>
      <ModalFooter>
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
      </ModalFooter>
    </Modal>
  );
}
