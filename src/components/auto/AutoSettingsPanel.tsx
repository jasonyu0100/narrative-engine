'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { suggestStoryDirection } from '@/lib/ai';
import type { AutoConfig, AutoEndCondition, AutoObjective } from '@/types/narrative';

type Tab = 'end' | 'objective' | 'direction';

const TABS: { label: string; value: Tab }[] = [
  { label: 'End', value: 'end' },
  { label: 'Objective', value: 'objective' },
  { label: 'Direction', value: 'direction' },
];

const OBJECTIVES: { value: AutoObjective; label: string; desc: string; worldBuilding: boolean }[] = [
  { value: 'resolve_threads', label: 'Resolve Threads', desc: 'Drive all threads toward resolution and bring the story to a satisfying conclusion. No world building.', worldBuilding: false },
  { value: 'explore_and_resolve', label: 'Explore & Resolve', desc: 'Balance world-building exploration with thread resolution. World building enabled.', worldBuilding: true },
  { value: 'open_ended', label: 'Open Ended', desc: 'Keep the story evolving with new complications and world expansion, rarely resolving threads.', worldBuilding: true },
];


export function AutoSettingsPanel({ onClose, onStart }: { onClose: () => void; onStart: () => void }) {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<Tab>('end');
  const [config, setConfig] = useState<AutoConfig>({ ...state.autoConfig });
  const [suggesting, setSuggesting] = useState(false);

  function update(partial: Partial<AutoConfig>) {
    setConfig((c) => ({ ...c, ...partial }));
  }

  function handleStart() {
    if (config.endConditions.length === 0) return;
    dispatch({ type: 'SET_AUTO_CONFIG', config });
    onStart();
    onClose();
  }

  // End condition helpers
  const hasEndCondition = (type: string) => config.endConditions.some((c) => c.type === type);
  const getEndCondition = (type: string) => config.endConditions.find((c) => c.type === type);

  function toggleEndCondition(type: string, defaultCond: AutoEndCondition) {
    if (hasEndCondition(type)) {
      if (config.endConditions.length <= 1) return;
      update({ endConditions: config.endConditions.filter((c) => c.type !== type) });
    } else {
      update({ endConditions: [...config.endConditions, defaultCond] });
    }
  }

  function updateEndCondition(type: string, updater: (c: AutoEndCondition) => AutoEndCondition) {
    update({
      endConditions: config.endConditions.map((c) => (c.type === type ? updater(c) : c)),
    });
  }

  const noEndConditions = config.endConditions.length === 0;
  const selectedObjective = OBJECTIVES.find((o) => o.value === config.objective);
  const worldBuildingEnabled = selectedObjective?.worldBuilding ?? false;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="glass max-w-lg w-full rounded-2xl p-6 relative max-h-[85vh] flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none"
        >
          &times;
        </button>

        <h2 className="text-sm font-semibold text-text-primary mb-1">Auto Mode Settings</h2>
        <p className="text-[10px] text-text-dim uppercase tracking-wider mb-3">
          Configure autonomous narrative generation
        </p>

        {/* Tabs */}
        <div className="flex gap-1 bg-bg-elevated rounded-lg p-0.5 mb-4 shrink-0">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`flex-1 px-2 py-1.5 text-[10px] font-medium transition-colors rounded-md uppercase tracking-wider ${
                tab === t.value
                  ? 'bg-bg-overlay text-text-primary'
                  : 'text-text-dim hover:text-text-secondary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-4 min-h-0">
          {tab === 'end' && (
            <>
              {!hasEndCondition('manual_stop') && (
                <>
                  <p className="text-[10px] text-text-dim leading-relaxed">
                    At least one end condition is required. You can always stop manually.
                  </p>

                  {/* Scene count */}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={hasEndCondition('scene_count')}
                      onChange={() => toggleEndCondition('scene_count', { type: 'scene_count', target: 50 })}
                      className="accent-yellow-500"
                    />
                    <span className="text-xs text-text-secondary">Stop at scene count</span>
                  </label>
                  {hasEndCondition('scene_count') && (
                    <div className="ml-6">
                      <input
                        type="number"
                        min={5}
                        max={500}
                        value={(getEndCondition('scene_count') as { type: 'scene_count'; target: number })?.target ?? 50}
                        onChange={(e) =>
                          updateEndCondition('scene_count', () => ({ type: 'scene_count', target: Number(e.target.value) }))
                        }
                        className="bg-bg-elevated border border-border rounded px-2 py-1 text-xs text-text-primary w-20 outline-none"
                      />
                      <span className="text-[10px] text-text-dim ml-2">scenes</span>
                    </div>
                  )}

                  {/* Arc count */}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={hasEndCondition('arc_count')}
                      onChange={() => toggleEndCondition('arc_count', { type: 'arc_count', target: 10 })}
                      className="accent-yellow-500"
                    />
                    <span className="text-xs text-text-secondary">Stop at arc count</span>
                  </label>
                  {hasEndCondition('arc_count') && (
                    <div className="ml-6">
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={(getEndCondition('arc_count') as { type: 'arc_count'; target: number })?.target ?? 10}
                        onChange={(e) =>
                          updateEndCondition('arc_count', () => ({ type: 'arc_count', target: Number(e.target.value) }))
                        }
                        className="bg-bg-elevated border border-border rounded px-2 py-1 text-xs text-text-primary w-20 outline-none"
                      />
                      <span className="text-[10px] text-text-dim ml-2">arcs</span>
                    </div>
                  )}
                </>
              )}

              {/* Manual stop — warning zone */}
              <div className={`border border-amber-500/30 rounded-lg p-3 bg-amber-500/5 ${hasEndCondition('manual_stop') ? '' : 'mt-4'}`}>
                <p className="text-[10px] text-amber-400/80 uppercase tracking-widest font-semibold mb-2">Warning</p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasEndCondition('manual_stop')}
                    onChange={() => {
                      if (hasEndCondition('manual_stop')) {
                        // Turning off manual stop — restore a default end condition
                        update({ endConditions: [{ type: 'scene_count', target: 50 }] });
                      } else {
                        // Turning on manual stop — clear all other conditions
                        update({ endConditions: [{ type: 'manual_stop' }] });
                      }
                    }}
                    className="accent-amber-500"
                  />
                  <span className="text-xs text-text-secondary">Manual stop only</span>
                </label>
                <p className="text-[10px] text-text-dim leading-relaxed mt-1 ml-6">
                  {hasEndCondition('manual_stop')
                    ? 'All automatic end conditions are disabled. Generation runs indefinitely until you manually stop it.'
                    : 'No automatic stopping — generation runs indefinitely until you manually stop it.'}
                </p>
              </div>
            </>
          )}

          {tab === 'objective' && (
            <>
              {/* Objective selector */}
              <div>
                <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">
                  Story Objective
                </label>
                <div className="flex flex-col gap-2">
                  {OBJECTIVES.map((o) => (
                    <label
                      key={o.value}
                      className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                        config.objective === o.value ? 'bg-white/8' : 'hover:bg-white/4'
                      }`}
                    >
                      <input
                        type="radio"
                        name="objective"
                        checked={config.objective === o.value}
                        onChange={() => update({
                          objective: o.value,
                          worldBuildInterval: o.worldBuilding ? (config.worldBuildInterval || 3) : 0,
                        })}
                        className="accent-yellow-500 mt-0.5"
                      />
                      <div>
                        <div className="text-xs text-text-primary font-medium">{o.label}</div>
                        <div className="text-[10px] text-text-dim">{o.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Prose generation */}
              <div className="border-t border-border pt-4">
                <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-3">
                  Prose
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={config.includeProse}
                    onChange={(e) => update({ includeProse: e.target.checked })}
                    className="accent-yellow-500"
                  />
                  <span className="text-xs text-text-secondary">Generate prose for each scene</span>
                </label>
                <p className="text-[10px] text-text-dim leading-relaxed ml-6 mt-1">
                  {config.includeProse
                    ? 'Each scene will be written as literary prose after generation. This adds an extra LLM call per scene and increases generation time.'
                    : 'Only structural scene data is generated. Prose can be added later from the Story reader.'}
                </p>
              </div>

              {/* World building settings — only when objective supports it */}
              {worldBuildingEnabled && (
                <div className="border-t border-border pt-4">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-3">
                    World Building
                  </label>

                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs text-text-secondary">Expand every</span>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={config.worldBuildInterval}
                      onChange={(e) => update({ worldBuildInterval: Math.max(1, Number(e.target.value)) })}
                      className="bg-bg-elevated border border-border rounded px-2 py-1 text-xs text-text-primary w-16 outline-none text-center"
                    />
                    <span className="text-xs text-text-secondary">arc{config.worldBuildInterval !== 1 ? 's' : ''}</span>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={config.enforceWorldBuildUsage}
                      onChange={(e) => update({ enforceWorldBuildUsage: e.target.checked })}
                      className="accent-yellow-500"
                    />
                    <span className="text-xs text-text-secondary">Enforce usage of new elements</span>
                  </label>
                  <p className="text-[10px] text-text-dim leading-relaxed ml-6 mt-1">
                    {config.enforceWorldBuildUsage
                      ? 'New arcs must incorporate unused world-building characters, locations, or threads.'
                      : 'New arcs will follow the natural flow of the story using existing elements.'}
                  </p>
                </div>
              )}
            </>
          )}

          {tab === 'direction' && (
            <>
              <p className="text-[10px] text-text-dim leading-relaxed">
                The north star for your story. Auto mode will constantly steer the narrative toward this direction across every arc it generates.
              </p>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim">
                    Story Direction
                  </label>
                  {state.activeNarrative && Object.keys(state.activeNarrative.scenes).length > 0 && (
                    <button
                      type="button"
                      disabled={suggesting}
                      onClick={async () => {
                        if (!state.activeNarrative) return;
                        setSuggesting(true);
                        try {
                          const direction = await suggestStoryDirection(
                            state.activeNarrative,
                            state.resolvedSceneKeys,
                            state.currentSceneIndex,
                          );
                          update({ storyDirectionPrompt: direction });
                        } catch (err) {
                          console.error('[auto-settings] suggest direction failed:', err);
                        } finally {
                          setSuggesting(false);
                        }
                      }}
                      className="text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
                    >
                      {suggesting ? 'Thinking...' : 'Suggest Story'}
                    </button>
                  )}
                </div>
                <textarea
                  value={config.storyDirectionPrompt}
                  onChange={(e) => update({ storyDirectionPrompt: e.target.value })}
                  placeholder="e.g. The protagonist should slowly uncover the truth about their past while alliances shift around them. Build toward a betrayal that redefines the central conflict..."
                  className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-32 resize-none outline-none placeholder:text-text-dim"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 pt-4 mt-4 border-t border-border shrink-0">
          <button
            onClick={handleStart}
            disabled={noEndConditions}
            className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-colors ${
              noEndConditions
                ? 'bg-white/4 text-text-dim cursor-not-allowed'
                : 'bg-white/12 text-text-primary hover:bg-white/16'
            }`}
          >
            Start Auto Mode
          </button>
        </div>
      </div>
    </div>
  );
}
