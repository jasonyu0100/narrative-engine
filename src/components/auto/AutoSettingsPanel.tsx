'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import type { AutoConfig, AutoEndCondition, PacingProfile, WorldBuildMode } from '@/types/narrative';

type Tab = 'end' | 'pacing' | 'world' | 'tone';

const TABS: { label: string; value: Tab }[] = [
  { label: 'End', value: 'end' },
  { label: 'Pacing', value: 'pacing' },
  { label: 'World', value: 'world' },
  { label: 'Tone', value: 'tone' },
];

const PACING_PROFILES: { value: PacingProfile; label: string; desc: string }[] = [
  { value: 'deliberate', label: 'Deliberate', desc: 'Slow burn, deep world-building, measured escalation' },
  { value: 'balanced', label: 'Balanced', desc: 'Even mix of action, development, and world-building' },
  { value: 'urgent', label: 'Urgent', desc: 'Fast pace, rapid escalation, minimal downtime' },
  { value: 'chaotic', label: 'Chaotic', desc: 'Unpredictable twists, high flux, constant disruption' },
];

const WORLD_BUILD_MODES: { value: WorldBuildMode; label: string; desc: string }[] = [
  { value: 'off', label: 'Off', desc: 'No world expansion — use only existing elements' },
  { value: 'light', label: 'Light', desc: 'Occasional new locations or characters when needed' },
  { value: 'moderate', label: 'Moderate', desc: 'Regular world growth alongside the story' },
  { value: 'heavy', label: 'Heavy', desc: 'Aggressive expansion — many new elements each run' },
];

export function AutoSettingsPanel({ onClose, onStart }: { onClose: () => void; onStart: () => void }) {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<Tab>('end');
  const [config, setConfig] = useState<AutoConfig>({ ...state.autoConfig });

  function update(partial: Partial<AutoConfig>) {
    setConfig((c) => ({ ...c, ...partial }));
  }

  function handleSave() {
    dispatch({ type: 'SET_AUTO_CONFIG', config });
  }

  function handleStart() {
    // Enforce at least one end condition
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
      // Don't allow removing if it's the last one
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
              <p className="text-[10px] text-text-dim leading-relaxed">
                At least one end condition is required. You can always stop manually.
              </p>

              {/* Scene count */}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={hasEndCondition('scene_count')}
                  onChange={() => toggleEndCondition('scene_count', { type: 'scene_count', target: 50 })}
                  className="accent-text-primary"
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
                  className="accent-text-primary"
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

              {/* All threads resolved */}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={hasEndCondition('all_threads_resolved')}
                  onChange={() => toggleEndCondition('all_threads_resolved', { type: 'all_threads_resolved' })}
                  className="accent-text-primary"
                />
                <span className="text-xs text-text-secondary">Stop when all threads resolved</span>
              </label>

              {/* Manual stop (always available) */}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={hasEndCondition('manual_stop')}
                  onChange={() => toggleEndCondition('manual_stop', { type: 'manual_stop' })}
                  className="accent-text-primary"
                />
                <span className="text-xs text-text-secondary">Manual stop only</span>
              </label>
            </>
          )}

          {tab === 'pacing' && (
            <>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">
                  Pacing Profile
                </label>
                <div className="flex flex-col gap-2">
                  {PACING_PROFILES.map((p) => (
                    <label
                      key={p.value}
                      className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                        config.pacingProfile === p.value ? 'bg-white/8' : 'hover:bg-white/4'
                      }`}
                    >
                      <input
                        type="radio"
                        name="pacing"
                        checked={config.pacingProfile === p.value}
                        onChange={() => update({ pacingProfile: p.value })}
                        className="accent-text-primary mt-0.5"
                      />
                      <div>
                        <div className="text-xs text-text-primary font-medium">{p.label}</div>
                        <div className="text-[10px] text-text-dim">{p.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">Min Arc Length</label>
                  <input
                    type="number" min={1} max={10}
                    value={config.minArcLength}
                    onChange={(e) => update({ minArcLength: Number(e.target.value) })}
                    className="bg-bg-elevated border border-border rounded px-2 py-1 text-xs text-text-primary w-full outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">Max Arc Length</label>
                  <input
                    type="number" min={1} max={12}
                    value={config.maxArcLength}
                    onChange={(e) => update({ maxArcLength: Number(e.target.value) })}
                    className="bg-bg-elevated border border-border rounded px-2 py-1 text-xs text-text-primary w-full outline-none"
                  />
                </div>
              </div>
            </>
          )}

          {tab === 'world' && (
            <>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">
                  World Building
                </label>
                <div className="flex flex-col gap-2">
                  {WORLD_BUILD_MODES.map((m) => (
                    <label
                      key={m.value}
                      className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                        config.worldBuildMode === m.value ? 'bg-white/8' : 'hover:bg-white/4'
                      }`}
                    >
                      <input
                        type="radio"
                        name="worldBuild"
                        checked={config.worldBuildMode === m.value}
                        onChange={() => update({ worldBuildMode: m.value })}
                        className="accent-text-primary mt-0.5"
                      />
                      <div>
                        <div className="text-xs text-text-primary font-medium">{m.label}</div>
                        <div className="text-[10px] text-text-dim">{m.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">Max Active Threads</label>
                  <input
                    type="number" min={2} max={15}
                    value={config.maxActiveThreads}
                    onChange={(e) => update({ maxActiveThreads: Number(e.target.value) })}
                    className="bg-bg-elevated border border-border rounded px-2 py-1 text-xs text-text-primary w-full outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">Stagnation Threshold</label>
                  <input
                    type="number" min={2} max={20}
                    value={config.threadStagnationThreshold}
                    onChange={(e) => update({ threadStagnationThreshold: Number(e.target.value) })}
                    className="bg-bg-elevated border border-border rounded px-2 py-1 text-xs text-text-primary w-full outline-none"
                  />
                  <span className="text-[10px] text-text-dim mt-0.5 block">scenes without mutation</span>
                </div>
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.characterRotationEnabled}
                  onChange={(e) => update({ characterRotationEnabled: e.target.checked })}
                  className="accent-text-primary"
                />
                <span className="text-xs text-text-secondary">Rotate anchor characters</span>
              </label>

              {config.characterRotationEnabled && (
                <div className="ml-6">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">
                    Min scenes between focus
                  </label>
                  <input
                    type="number" min={1} max={10}
                    value={config.minScenesBetweenCharacterFocus}
                    onChange={(e) => update({ minScenesBetweenCharacterFocus: Number(e.target.value) })}
                    className="bg-bg-elevated border border-border rounded px-2 py-1 text-xs text-text-primary w-20 outline-none"
                  />
                </div>
              )}
            </>
          )}

          {tab === 'tone' && (
            <>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">
                  Tone Guidance
                </label>
                <input
                  type="text"
                  value={config.toneGuidance}
                  onChange={(e) => update({ toneGuidance: e.target.value })}
                  placeholder="e.g. dark fantasy, political thriller, hopeful sci-fi"
                  className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full outline-none placeholder:text-text-dim"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">
                  General Direction Prompt
                </label>
                <textarea
                  value={config.arcDirectionPrompt}
                  onChange={(e) => update({ arcDirectionPrompt: e.target.value })}
                  placeholder="Injected into every arc generation — guide the overall story direction..."
                  className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-24 resize-none outline-none placeholder:text-text-dim"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">
                  Narrative Constraints
                </label>
                <textarea
                  value={config.narrativeConstraints}
                  onChange={(e) => update({ narrativeConstraints: e.target.value })}
                  placeholder="Things to avoid or ensure — e.g. 'no character deaths in first 10 scenes', 'maintain mystery around X'"
                  className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-24 resize-none outline-none placeholder:text-text-dim"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 pt-4 mt-4 border-t border-border shrink-0">
          <button
            onClick={handleSave}
            className="flex-1 text-xs font-medium py-2 rounded-lg bg-white/6 text-text-secondary hover:bg-white/10 transition-colors"
          >
            Save Settings
          </button>
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
