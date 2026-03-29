'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import type { StorySettings, POVMode, WorldFocusMode, ReasoningLevel, NarrativeState } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS, BRANCH_TIME_HORIZON_OPTIONS, REASONING_BUDGETS } from '@/types/narrative';
import { NARRATIVE_CUBE } from '@/types/narrative';
import type { CubeCornerKey } from '@/types/narrative';
import { MATRIX_PRESETS, type TransitionMatrix } from '@/lib/markov';
import { DEFAULT_PROSE_PROFILE, ACTION_PROFILE, INTROSPECTIVE_PROFILE } from '@/lib/beat-profiles';

type Tab = 'direction' | 'style' | 'pov' | 'other';

const TABS: { label: string; value: Tab }[] = [
  { label: 'Direction', value: 'direction' },
  { label: 'Style', value: 'style' },
  { label: 'POV', value: 'pov' },
  { label: 'Other', value: 'other' },
];

const POV_MODES: { value: POVMode; label: string; desc: string }[] = [
  { value: 'single', label: 'Single POV', desc: 'One protagonist drives every scene. Tight interiority, dramatic irony from limited knowledge.' },
  { value: 'pareto', label: 'Pareto', desc: '~80% protagonist, ~20% other perspectives. Tight focus with occasional critical cuts to scenes the protagonist can\'t witness.' },
  { value: 'ensemble', label: 'Ensemble', desc: 'Multiple POV characters rotate. Wider world, more threads, epic scope.' },
  { value: 'free', label: 'Free (Default)', desc: 'Any character can be POV. The engine picks whoever fits the scene best.' },
];

function AdvancedSection({ settings, update, narrative, resolvedEntryKeys }: {
  settings: StorySettings;
  update: (patch: Partial<StorySettings>) => void;
  narrative: NarrativeState | null;
  resolvedEntryKeys: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[10px] text-text-dim hover:text-text-secondary transition-colors cursor-pointer"
      >
        <svg
          width="10" height="10" viewBox="0 0 12 12"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M3 4.5L6 7.5L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="uppercase tracking-wider">Advanced</span>
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {/* Generation Mode */}
          <div>
            <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
              Generation Mode
            </label>
            <div className="space-y-1.5">
              {([
                { value: 'batch' as const, label: 'Batch', desc: 'Generate all scenes at once — fast, single LLM call per arc' },
                { value: 'stepwise' as const, label: 'Stepwise', desc: 'Generate one scene at a time — slower, but each scene sees full context of prior scenes' },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => update({ generationMode: opt.value })}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                    settings.generationMode === opt.value
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
              const worldBuilds = Object.values(narrative.worldBuilds).filter((wb) => resolvedEntryKeys.has(wb.id));
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
        </div>
      )}
    </div>
  );
}

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

  const showPovPicker = true;
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

              <div>
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                  Constraints
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

              <div>
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                  Narrative Guidance
                </label>
                <textarea
                  value={settings.narrativeGuidance}
                  onChange={(e) => update({ narrativeGuidance: e.target.value })}
                  placeholder={"e.g. \"Keep the opening scope local — academy, village, immediate survival. Don't sprawl into multi-faction politics until the first arc has paid off.\n\nThe protagonist wins through knowledge and shamelessness, not hidden power.\""}
                  className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-blue-500/40 resize-none h-32"
                />
                <p className="text-[9px] text-text-dim/50 mt-1">
                  Editorial principles — scope discipline, reveal pacing, tonal rules. These override default generation instincts.
                </p>
              </div>
            </>
          )}

          {tab === 'style' && (() => {
            const CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];
            const COLORS: Record<CubeCornerKey, string> = {
              HHH: '#f59e0b', HHL: '#ef4444', HLH: '#a855f7', HLL: '#6366f1',
              LHH: '#22d3ee', LHL: '#22c55e', LLH: '#3b82f6', LLL: '#6b7280',
            };
            const resolvedPacingKey = settings.rhythmPreset || 'storyteller';
            const activePacingPreset = MATRIX_PRESETS.find((p) => p.key === resolvedPacingKey);
            const pacingMatrix: TransitionMatrix | null = activePacingPreset?.matrix ?? null;

            const FN_COLORS: Record<string, string> = {
              breathe: '#6b7280', inform: '#3b82f6', advance: '#22c55e', bond: '#ec4899',
              turn: '#f59e0b', reveal: '#a855f7', shift: '#ef4444', expand: '#06b6d4',
              foreshadow: '#84cc16', resolve: '#14b8a6',
            };
            const BEAT_FNS: string[] = ['breathe', 'inform', 'advance', 'bond', 'turn', 'reveal', 'shift', 'expand', 'foreshadow', 'resolve'];

            // Resolve beat profile
            const beatPresets = [
              { key: '', label: 'Storyteller', desc: 'Balanced fiction — derived from 10 published works' },
              { key: 'action', label: 'Action', desc: 'Fast pacing, high advance/turn — thrillers, xianxia' },
              { key: 'introspective', label: 'Introspective', desc: 'Slow pacing, thought-heavy — literary fiction' },
              { key: 'self', label: 'This Story', desc: 'Use this story\'s own analysed profile' },
              { key: 'harry_potter', label: 'Harry Potter', desc: 'Conversational, comic escalation' },
              { key: 'reverend_insanity', label: 'Reverend Insanity', desc: 'Raw, strategic introspection' },
              { key: 'nineteen_eighty_four', label: '1984', desc: 'Clinical, ironic understatement' },
              { key: 'the_great_gatsby', label: 'Gatsby', desc: 'Literary, sardonic first person' },
              { key: 'a_tale_of_two_cities', label: 'Dickens', desc: 'Omniscient ironic, anaphora' },
              { key: 'romeo_and_juliet', label: 'Shakespeare', desc: 'Detached observer, dialogue-heavy' },
            ];

            return (
              <>
                {/* ── PACING CHAIN (Cube Corners) ── */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-[10px] text-text-dim uppercase tracking-wider">Pacing Chain</label>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.usePacingChain}
                      onClick={() => update({ usePacingChain: !settings.usePacingChain })}
                      className={`w-7 h-4 rounded-full transition-colors relative ${settings.usePacingChain ? 'bg-white/25' : 'bg-white/8'}`}
                    >
                      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${settings.usePacingChain ? 'left-3.5' : 'left-0.5'}`} />
                    </button>
                  </div>

                  {settings.usePacingChain && (
                    <>
                      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 mb-3">
                        {MATRIX_PRESETS.map((preset) => {
                          const isSelected = preset.key === resolvedPacingKey;
                          return (
                            <button
                              key={preset.key}
                              onClick={() => update({ rhythmPreset: preset.key })}
                              className={`shrink-0 w-32 rounded-xl text-left transition-all border p-2.5 flex flex-col gap-1 ${
                                isSelected ? 'border-blue-500/40 bg-blue-500/8 ring-1 ring-blue-500/20' : 'border-white/6 hover:border-white/15 hover:bg-white/3'
                              }`}
                            >
                              <span className={`text-[11px] font-semibold leading-tight ${isSelected ? 'text-text-primary' : 'text-text-secondary'}`}>{preset.name}</span>
                              <p className="text-[8px] text-text-dim leading-snug flex-1">{preset.description}</p>
                              {isSelected && <span className="text-[7px] text-blue-400 uppercase tracking-wider font-medium">Active</span>}
                            </button>
                          );
                        })}
                      </div>

                      {pacingMatrix && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[9px] border-collapse">
                            <thead>
                              <tr>
                                <th className="p-1 text-left text-text-dim font-medium w-16">From ↓</th>
                                {CORNERS.map((c) => (
                                  <th key={c} className="p-1 text-center font-medium" style={{ color: COLORS[c] }}>{NARRATIVE_CUBE[c].name.slice(0, 4)}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {CORNERS.map((from) => {
                                const row = pacingMatrix[from];
                                return (
                                  <tr key={from} className="border-t border-white/5">
                                    <td className="p-1 font-medium" style={{ color: COLORS[from] }}>{NARRATIVE_CUBE[from].name.slice(0, 4)}</td>
                                    {CORNERS.map((to) => {
                                      const prob = row[to] ?? 0;
                                      return (
                                        <td key={to} className="p-1 text-center tabular-nums" style={{
                                          backgroundColor: prob > 0 ? `rgba(52,211,153,${Math.min(prob * 1.2, 1)})` : 'transparent',
                                          color: prob >= 0.25 ? '#fff' : prob > 0.05 ? '#d1d5db' : '#4b5563',
                                        }}>
                                          {prob > 0 ? Math.round(prob * 100) : '·'}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* ── BEAT CHAIN (Beat Functions) ── */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-[10px] text-text-dim uppercase tracking-wider">Beat Chain</label>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.useBeatChain}
                      onClick={() => update({ useBeatChain: !settings.useBeatChain })}
                      className={`w-7 h-4 rounded-full transition-colors relative ${settings.useBeatChain ? 'bg-white/25' : 'bg-white/8'}`}
                    >
                      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${settings.useBeatChain ? 'left-3.5' : 'left-0.5'}`} />
                    </button>
                  </div>

                  {settings.useBeatChain && (
                    <>
                      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 mb-3">
                        {beatPresets.filter((p) => p.key !== 'self' || narrative?.proseProfile).map((preset) => {
                          const isSelected = (settings.beatProfilePreset || '') === preset.key;
                          return (
                            <button
                              key={preset.key || '_default'}
                              onClick={() => update({ beatProfilePreset: preset.key })}
                              className={`shrink-0 w-32 rounded-xl text-left transition-all border p-2.5 flex flex-col gap-1 ${
                                isSelected ? 'border-violet-500/40 bg-violet-500/8 ring-1 ring-violet-500/20' : 'border-white/6 hover:border-white/15 hover:bg-white/3'
                              }`}
                            >
                              <span className={`text-[11px] font-semibold leading-tight ${isSelected ? 'text-text-primary' : 'text-text-secondary'}`}>{preset.label}</span>
                              <p className="text-[8px] text-text-dim leading-snug flex-1">{preset.desc}</p>
                              {isSelected && <span className="text-[7px] text-violet-400 uppercase tracking-wider font-medium">Active</span>}
                            </button>
                          );
                        })}
                      </div>

                      {/* Beat transition matrix + mechanism distribution */}
                      {(() => {
                        // Resolve the active beat profile
                        const presetKey = settings.beatProfilePreset || '';
                        const activeProfile = presetKey === 'self' ? narrative?.proseProfile
                          : presetKey === 'action' ? ACTION_PROFILE
                          : presetKey === 'introspective' ? INTROSPECTIVE_PROFILE
                          : presetKey && narrative?.proseProfile ? narrative.proseProfile
                          : DEFAULT_PROSE_PROFILE;
                        const markov = (activeProfile?.markov ?? {}) as Record<string, Record<string, number>>;
                        const mechDist = activeProfile?.mechanismDistribution ?? {};

                        const MECH_COLORS: Record<string, string> = {
                          dialogue: '#3b82f6', thought: '#a855f7', action: '#22c55e', environment: '#06b6d4',
                          narration: '#f59e0b', memory: '#ec4899', document: '#84cc16', comic: '#ef4444',
                        };

                        return (
                          <>
                            <div className="overflow-x-auto mb-4">
                              <table className="w-full text-[9px] border-collapse">
                                <thead>
                                  <tr>
                                    <th className="p-1 text-left text-text-dim font-medium w-16">From ↓</th>
                                    {BEAT_FNS.map((fn) => (
                                      <th key={fn} className="p-1 text-center font-medium" style={{ color: FN_COLORS[fn] }}>{fn.slice(0, 4)}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {BEAT_FNS.map((from) => {
                                    const row = markov[from] ?? {};
                                    return (
                                      <tr key={from} className="border-t border-white/5">
                                        <td className="p-1 font-medium" style={{ color: FN_COLORS[from] }}>{from.slice(0, 4)}</td>
                                        {BEAT_FNS.map((to) => {
                                          const prob = row[to] ?? 0;
                                          return (
                                            <td key={to} className="p-1 text-center tabular-nums" style={{
                                              backgroundColor: prob > 0 ? `rgba(167,139,250,${Math.min(prob * 1.5, 1)})` : 'transparent',
                                              color: prob >= 0.25 ? '#fff' : prob > 0.05 ? '#d1d5db' : '#4b5563',
                                            }}>
                                              {prob > 0 ? Math.round(prob * 100) : '·'}
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">Mechanism Distribution</label>
                            <div className="space-y-1">
                              {Object.entries(mechDist)
                                .filter(([, v]) => v && v > 0)
                                .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
                                .map(([mech, pct]) => (
                                  <div key={mech} className="flex items-center gap-2">
                                    <span className="text-[9px] font-mono w-16 shrink-0" style={{ color: MECH_COLORS[mech] || '#888' }}>{mech}</span>
                                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                                      <div className="h-full rounded-full" style={{ width: `${(pct ?? 0) * 100}%`, backgroundColor: MECH_COLORS[mech] || '#888', opacity: 0.7 }} />
                                    </div>
                                    <span className="text-[9px] text-text-dim font-mono w-8 text-right">{Math.round((pct ?? 0) * 100)}%</span>
                                  </div>
                                ))}
                            </div>
                          </>
                        );
                      })()}
                    </>
                  )}
                </div>
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
                    {settings.povMode === 'free' ? 'Preferred POV Characters' : `POV Character${maxPovChars > 1 ? 's' : ''}`}{maxPovChars < allCharacters.length ? ` (select up to ${maxPovChars})` : ''}
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
                  {settings.povCharacterIds.length === 0 && settings.povMode !== 'free' && (
                    <p className="text-[9px] text-amber-400/60 mt-1.5">
                      No anchors selected — engine will choose the most prominent anchor.
                    </p>
                  )}
                  {settings.povMode === 'free' && (
                    <p className="text-[9px] text-text-dim/60 mt-1.5">
                      {settings.povCharacterIds.length === 0
                        ? 'No preferences — engine picks freely.'
                        : 'Engine will favour these characters but may still use others when the scene calls for it.'}
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

              {/* Reasoning Level */}
              <div>
                <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                  Reasoning Level
                </label>
                <div className="space-y-1.5">
                  {([
                    { value: 'none' as ReasoningLevel, label: 'None', desc: 'No thinking tokens — fastest, cheapest. Structured extraction only.' },
                    { value: 'low' as ReasoningLevel, label: 'Low', desc: `~${(REASONING_BUDGETS.low / 1024).toFixed(0)}k thinking tokens — light reasoning for basic structural checks` },
                    { value: 'medium' as ReasoningLevel, label: 'Medium', desc: `~${(REASONING_BUDGETS.medium / 1024).toFixed(0)}k thinking tokens — traces causality, checks agency patterns, validates convergence` },
                    { value: 'high' as ReasoningLevel, label: 'High', desc: `~${(REASONING_BUDGETS.high / 1024).toFixed(0)}k thinking tokens — deep reasoning for complex world states. Slowest, highest quality.` },
                  ]).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => update({ reasoningLevel: opt.value })}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                        (settings.reasoningLevel ?? 'low') === opt.value
                          ? 'border-blue-500/50 bg-blue-500/10'
                          : 'border-white/5 bg-white/2 hover:bg-white/5'
                      }`}
                    >
                      <span className="text-[11px] font-semibold text-text-primary">{opt.label}</span>
                      <span className="text-[10px] text-text-dim ml-2">{opt.desc}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-text-dim/50 mt-2">
                  Applies to structural calls (scene skeletons, direction, evaluation, planning) — not prose. Reasoning tokens are billed as output tokens.
                </p>
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

              {/* Advanced */}
              <AdvancedSection settings={settings} update={update} narrative={narrative} resolvedEntryKeys={new Set(state.resolvedEntryKeys)} />
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
