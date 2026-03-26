'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { BUILT_IN_PROFILES, profileToQueue } from '@/lib/planning-profiles';
import { generatePhaseDirection, generateCustomPlan } from '@/lib/planning-engine';
import { expandWorld } from '@/lib/ai';
import { nextId } from '@/lib/narrative-utils';
import { DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import type { PlanningPhase, PlanningProfile, PlanningQueue } from '@/types/narrative';
import { PlanningLoadingModal } from './PlanningLoadingModal';

type Props = {
  onClose: () => void;
  onStartAuto?: () => void;
};

type CreateMode = 'templates' | 'ai' | 'custom';

export function PlanningQueueEditor({ onClose, onStartAuto }: Props) {
  const { state, dispatch } = useStore();
  const branchId = state.activeBranchId;
  const branch = branchId ? state.activeNarrative?.branches[branchId] : null;
  const existingQueue = branch?.planningQueue;

  const [queue, setQueue] = useState<PlanningQueue | null>(existingQueue ?? null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(existingQueue?.profileId ?? null);
  const [planDocument, setPlanDocument] = useState('');
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState<'world' | 'direction' | null>(null);
  const [createMode, setCreateMode] = useState<CreateMode>('templates');

  // ── Actions ─────────────────────────────────────────────────────────────

  async function generateFromDocument(doc: string) {
    const narrative = state.activeNarrative;
    if (!narrative || !doc.trim()) return;
    setGenerating(true);
    try {
      const result = await generateCustomPlan(
        narrative, state.resolvedEntryKeys, state.currentSceneIndex, doc,
      );
      const newQueue: PlanningQueue = {
        profileId: null,
        phases: result.phases.map((p, i) => ({
          id: `phase-${i}`,
          name: p.name,
          objective: p.objective,
          sceneAllocation: p.sceneAllocation,
          scenesCompleted: 0,
          status: i === 0 ? 'active' : 'pending',
          constraints: p.constraints,
          direction: '',
          worldExpansionHints: p.worldExpansionHints,
        })),
        activePhaseIndex: 0,
      };
      setQueue(newQueue);
      setSelectedProfileId('custom');
    } catch (err) {
      console.error('[planning-queue] plan generation failed:', err);
    } finally {
      setGenerating(false);
    }
  }

  async function regenerateWorld(phaseIndex: number) {
    const narrative = state.activeNarrative;
    if (!narrative || !branchId || !queue) return;
    const phase = queue.phases[phaseIndex];
    if (!phase?.worldExpansionHints) return;
    setRegenerating('world');
    try {
      const expansion = await expandWorld(
        narrative, state.resolvedEntryKeys, state.currentSceneIndex,
        phase.worldExpansionHints, 'medium',
      );
      dispatch({
        type: 'EXPAND_WORLD',
        worldBuildId: nextId('WB', Object.keys(narrative.worldBuilds), 3),
        characters: expansion.characters,
        locations: expansion.locations,
        threads: expansion.threads,
        relationships: expansion.relationships,
        worldKnowledgeMutations: expansion.worldKnowledgeMutations,
        artifacts: expansion.artifacts,
        branchId,
      });
      const baseSettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };
      dispatch({ type: 'SET_STORY_SETTINGS', settings: { ...baseSettings, worldFocus: 'latest' } });
    } catch (err) {
      console.error('[planning-queue] regenerate world failed:', err);
    } finally {
      setRegenerating(null);
    }
  }

  async function regenerateDirection(phaseIndex: number) {
    const narrative = state.activeNarrative;
    if (!narrative || !branchId || !queue) return;
    const phase = queue.phases[phaseIndex];
    if (!phase) return;
    setRegenerating('direction');
    try {
      const { direction, constraints } = await generatePhaseDirection(
        narrative, state.resolvedEntryKeys, state.currentSceneIndex, phase, queue,
      );
      dispatch({ type: 'UPDATE_PLANNING_PHASE', branchId, phaseIndex, updates: { direction, constraints: constraints || phase.constraints } });
      const baseSettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };
      dispatch({ type: 'SET_STORY_SETTINGS', settings: { ...baseSettings, storyDirection: direction, storyConstraints: constraints || phase.constraints || baseSettings.storyConstraints } });
    } catch (err) {
      console.error('[planning-queue] regenerate direction failed:', err);
    } finally {
      setRegenerating(null);
    }
  }

  function selectProfile(profile: PlanningProfile) {
    const newQueue = profileToQueue(profile);
    setQueue(newQueue);
    setSelectedProfileId(profile.id);
  }

  function updatePhase(index: number, updates: Partial<PlanningPhase>) {
    if (!queue) return;
    const phases = [...queue.phases];
    phases[index] = { ...phases[index], ...updates };
    setQueue({ ...queue, phases });
    if (existingQueue && branchId) {
      dispatch({ type: 'UPDATE_PLANNING_PHASE', branchId, phaseIndex: index, updates });
    }
  }

  function removePhase(index: number) {
    if (!queue) return;
    const phases = queue.phases.filter((_, i) => i !== index);
    const updated = { ...queue, phases, activePhaseIndex: Math.min(queue.activePhaseIndex, phases.length - 1) };
    setQueue(updated);
    if (existingQueue && branchId) {
      dispatch({ type: 'SET_PLANNING_QUEUE', branchId, queue: updated });
    }
  }

  function addPhase() {
    if (!queue) return;
    const newPhase: PlanningPhase = {
      id: `phase-${queue.phases.length}`,
      name: 'New Phase',
      objective: '',
      sceneAllocation: 4,
      scenesCompleted: 0,
      status: 'pending',
      constraints: '',
      direction: '',
      worldExpansionHints: '',
    };
    const updated = { ...queue, phases: [...queue.phases, newPhase] };
    setQueue(updated);
    if (existingQueue && branchId) {
      dispatch({ type: 'SET_PLANNING_QUEUE', branchId, queue: updated });
    }
  }

  function movePhase(index: number, dir: -1 | 1) {
    if (!queue) return;
    const target = index + dir;
    if (target < 0 || target >= queue.phases.length) return;
    const phases = [...queue.phases];
    [phases[index], phases[target]] = [phases[target], phases[index]];
    const updated = { ...queue, phases };
    setQueue(updated);
    if (existingQueue && branchId) {
      dispatch({ type: 'SET_PLANNING_QUEUE', branchId, queue: updated });
    }
  }

  const [activating, setActivating] = useState(false);
  const [activatingStep, setActivatingStep] = useState<string | null>(null);
  const [showModeChoice, setShowModeChoice] = useState(false);

  /** Save the queue to the store without running any generation */
  function handleSave() {
    if (!branchId || !queue || queue.phases.length === 0) return;
    dispatch({ type: 'SET_PLANNING_QUEUE', branchId, queue });
    setShowModeChoice(true);
  }

  /** Run world expansion + direction generation for the first phase */
  async function initFirstPhase() {
    if (!branchId || !queue) return;
    const narrative = state.activeNarrative;
    if (!narrative) return;

    const firstPhase = queue.phases[0];
    if (!firstPhase || (firstPhase.status === 'active' && firstPhase.direction)) return;

    setActivating(true);
    try {
      const resolvedKeys = state.resolvedEntryKeys;
      const currentIndex = state.currentSceneIndex;

      if (firstPhase.worldExpansionHints) {
        setActivatingStep('Expanding world...');
        const expansion = await expandWorld(narrative, resolvedKeys, currentIndex, firstPhase.worldExpansionHints, 'medium');
        dispatch({
          type: 'EXPAND_WORLD',
          worldBuildId: nextId('WB', Object.keys(narrative.worldBuilds), 3),
          characters: expansion.characters, locations: expansion.locations, threads: expansion.threads,
          relationships: expansion.relationships, worldKnowledgeMutations: expansion.worldKnowledgeMutations,
          artifacts: expansion.artifacts, branchId,
        });
      }

      setActivatingStep('Generating direction...');
      const { direction, constraints } = await generatePhaseDirection(narrative, resolvedKeys, currentIndex, firstPhase, queue);
      dispatch({ type: 'UPDATE_PLANNING_PHASE', branchId, phaseIndex: 0, updates: { direction, constraints: constraints || firstPhase.constraints } });
      const baseSettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };
      dispatch({ type: 'SET_STORY_SETTINGS', settings: { ...baseSettings, storyDirection: direction, storyConstraints: constraints || firstPhase.constraints || baseSettings.storyConstraints, worldFocus: 'latest' } });
    } catch (err) {
      console.error('[planning-queue] first phase init failed:', err);
    } finally {
      setActivating(false);
      setActivatingStep(null);
    }
  }

  async function handleManualGenerate() {
    setShowModeChoice(false);
    await initFirstPhase();
    onClose();
  }

  async function handleAutoMode() {
    setShowModeChoice(false);
    await initFirstPhase();
    onStartAuto?.();
    onClose();
  }

  function handleClear() {
    if (!branchId) return;
    dispatch({ type: 'SET_PLANNING_QUEUE', branchId, queue: undefined });
    setQueue(null);
    setSelectedProfileId(null);
  }

  const totalScenes = queue?.phases.reduce((sum, p) => sum + p.sceneAllocation, 0) ?? 0;

  // ── Loading / Auto prompt states ──────────────────────────────────────

  if (activating) {
    return <PlanningLoadingModal step={activatingStep ?? 'Initializing...'} subtitle="Preparing the first phase" />;
  }

  if (showModeChoice) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
        <div className="glass max-w-md w-full rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-text-primary mb-1">Queue activated</h2>
          <p className="text-[10px] text-text-dim uppercase tracking-wider mb-5">
            Choose how to run the first phase
          </p>

          <div className="flex flex-col gap-2.5">
            <button
              onClick={handleManualGenerate}
              className="w-full text-left rounded-lg border border-white/8 bg-white/3 hover:bg-white/6 hover:border-white/15 p-4 transition-colors group"
            >
              <p className="text-[12px] font-medium text-text-primary group-hover:text-white transition-colors">Manual Generate</p>
              <p className="text-[11px] text-text-dim mt-0.5 leading-relaxed">
                Prepare the world and direction, then generate scenes yourself. You control the pace.
              </p>
            </button>

            <button
              onClick={handleAutoMode}
              className="w-full text-left rounded-lg border border-white/8 bg-white/3 hover:bg-white/6 hover:border-white/15 p-4 transition-colors group"
            >
              <p className="text-[12px] font-medium text-text-primary group-hover:text-white transition-colors">Auto Mode</p>
              <p className="text-[11px] text-text-dim mt-0.5 leading-relaxed">
                Prepare the world and direction, then auto-generate scenes through every phase until complete.
              </p>
            </button>
          </div>

          <div className="flex justify-end mt-4 pt-3 border-t border-white/5">
            <button onClick={onClose} className="text-[10px] px-3 py-1.5 text-text-dim hover:text-text-secondary transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="glass max-w-2xl w-full rounded-2xl relative max-h-[85vh] flex flex-col">
        <button onClick={onClose} className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none z-10">&times;</button>

        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b border-white/6 shrink-0">
          <h2 className="text-sm font-semibold text-text-primary">Planning Queue</h2>
          <p className="text-[10px] text-text-dim mt-0.5">
            {queue ? `${queue.phases.length} phases \u00b7 ${totalScenes} scenes` : 'Choose how to structure your story'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {/* ── Create view ──────────────────────────────────────────── */}
          {!queue && (
            <div className="p-6">
              {/* Mode tabs */}
              <div className="flex items-center gap-0 rounded-lg bg-white/4 p-0.5 mb-5">
                {([
                  { mode: 'templates' as const, label: 'Templates' },
                  { mode: 'ai' as const, label: 'AI Generate' },
                  { mode: 'custom' as const, label: 'Custom' },
                ]).map(({ mode, label }) => (
                  <button
                    key={mode}
                    onClick={() => setCreateMode(mode)}
                    className={`flex-1 py-2 text-[11px] font-medium rounded-md transition-colors ${
                      createMode === mode
                        ? 'bg-white/10 text-text-primary'
                        : 'text-text-dim hover:text-text-secondary'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Templates */}
              {createMode === 'templates' && (
                <div className="space-y-4">
                  {(['complete', 'episodic'] as const).map((cat) => {
                    const profiles = BUILT_IN_PROFILES.filter((p) => p.category === cat);
                    return (
                      <div key={cat}>
                        <span className="text-[9px] uppercase tracking-widest text-text-dim font-mono block mb-2">
                          {cat === 'complete' ? 'Complete Stories' : 'Episodic / Series'}
                        </span>
                        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                          {profiles.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => selectProfile(p)}
                              className={`w-44 shrink-0 text-left rounded-lg border p-3 transition ${
                                selectedProfileId === p.id
                                  ? 'border-white/25 bg-white/8'
                                  : 'border-white/6 bg-white/2 hover:border-white/15 hover:bg-white/4'
                              }`}
                            >
                              <span className="text-[11px] font-semibold text-text-primary block">{p.name}</span>
                              <span className="text-[10px] text-text-dim leading-snug mt-1 block line-clamp-3">{p.description}</span>
                              <span className="text-[9px] text-text-dim mt-1.5 block font-mono">{p.phases.length} phases</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* AI Generate */}
              {createMode === 'ai' && (
                <div className="flex flex-col items-center justify-center py-8 gap-4">
                  <div className="text-center max-w-sm">
                    <p className="text-xs text-text-secondary leading-relaxed">
                      Analyse the current narrative state — characters, threads, world knowledge, and scene history — and design the optimal structure for continuing this story.
                    </p>
                  </div>
                  <button
                    onClick={() => generateFromDocument(
                      'Analyse the current narrative state — characters, threads, world knowledge, and scene history — and design the optimal superstructure for continuing this story. Consider thread maturity, character arcs, and pacing.',
                    )}
                    disabled={generating}
                    className="px-6 py-2.5 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/16 text-text-primary transition disabled:opacity-30"
                  >
                    {generating ? 'Analysing narrative...' : 'Generate Plan'}
                  </button>
                </div>
              )}

              {/* Custom */}
              {createMode === 'custom' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] text-text-dim">
                    Describe your story structure — plot outline, character arcs, key events, pacing preferences.
                  </p>
                  <textarea
                    value={planDocument}
                    onChange={(e) => setPlanDocument(e.target.value)}
                    placeholder="e.g. Three acts: Act 1 establishes the world and central conflict over 10 scenes. Act 2 escalates through betrayal and discovery over 15 scenes. Act 3 resolves everything in a climactic 8-scene finale."
                    className="bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-[11px] text-text-primary w-full h-28 resize-none outline-none placeholder:text-text-dim focus:border-white/16 transition"
                  />
                  <button
                    onClick={() => generateFromDocument(planDocument)}
                    disabled={!planDocument.trim() || generating}
                    className="self-start px-5 py-2 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/16 text-text-primary transition disabled:opacity-30"
                  >
                    {generating ? 'Generating...' : 'Generate Plan'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Phase editor ─────────────────────────────────────────── */}
          {queue && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-3">
                <label className="text-[10px] uppercase tracking-widest text-text-dim">Phases</label>
                <button onClick={addPhase} className="text-[10px] text-text-secondary hover:text-text-primary transition-colors uppercase tracking-wider">+ Add Phase</button>
              </div>

              <div className="flex flex-col gap-2">
                {queue.phases.map((phase, i) => (
                  <div
                    key={phase.id}
                    className={`rounded-lg border p-3 ${
                      phase.status === 'active' ? 'bg-amber-500/5 border-amber-500/20'
                        : phase.status === 'completed' ? 'bg-green-500/5 border-green-500/20 opacity-60'
                        : 'bg-bg-elevated border-border'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] text-text-dim font-mono mt-1 shrink-0 w-4">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <input
                          value={phase.name}
                          onChange={(e) => updatePhase(i, { name: e.target.value })}
                          className="bg-transparent text-xs text-text-primary font-medium w-full outline-none border-b border-transparent focus:border-white/20 pb-0.5"
                          disabled={phase.status === 'completed'}
                        />
                        <textarea
                          value={phase.objective}
                          onChange={(e) => updatePhase(i, { objective: e.target.value })}
                          placeholder="What should this phase achieve?"
                          className="bg-transparent text-[11px] text-text-secondary w-full outline-none resize-none mt-1 placeholder:text-text-dim"
                          rows={2}
                          disabled={phase.status === 'completed'}
                        />
                        <div className="flex items-center gap-3 mt-1.5">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-text-dim">Scenes:</span>
                            <input
                              type="number" min={1} max={50}
                              value={phase.sceneAllocation}
                              onChange={(e) => updatePhase(i, { sceneAllocation: Math.max(1, Number(e.target.value)) })}
                              className="bg-bg-overlay border border-border rounded px-1.5 py-0.5 text-[10px] text-text-primary w-12 outline-none text-center"
                              disabled={phase.status === 'completed'}
                            />
                          </div>
                          {phase.status === 'active' && (
                            <span className="text-[10px] text-amber-400 uppercase tracking-wider">{phase.scenesCompleted}/{phase.sceneAllocation} done</span>
                          )}
                          {phase.status === 'completed' && (
                            <span className="text-[10px] text-green-400 uppercase tracking-wider">Completed</span>
                          )}
                        </div>

                        {phase.status !== 'completed' && (
                          <details className="mt-2" open={phase.status === 'active'}>
                            <summary className="text-[10px] text-text-dim cursor-pointer hover:text-text-secondary">Configuration</summary>
                            <div className="mt-1.5 flex flex-col gap-1.5">
                              <input
                                value={phase.constraints}
                                onChange={(e) => updatePhase(i, { constraints: e.target.value })}
                                placeholder="Phase-specific constraints..."
                                className="bg-bg-overlay border border-border rounded px-2 py-1 text-[10px] text-text-primary w-full outline-none placeholder:text-text-dim"
                              />
                              <input
                                value={phase.worldExpansionHints}
                                onChange={(e) => updatePhase(i, { worldExpansionHints: e.target.value })}
                                placeholder="World expansion hints for this phase..."
                                className="bg-bg-overlay border border-border rounded px-2 py-1 text-[10px] text-text-primary w-full outline-none placeholder:text-text-dim"
                              />
                              {phase.status === 'active' && existingQueue && (
                                <div className="flex gap-2 mt-1">
                                  <button onClick={() => regenerateWorld(i)} disabled={regenerating !== null || !phase.worldExpansionHints}
                                    className="text-[10px] px-2 py-1 rounded bg-white/5 text-text-dim hover:text-text-secondary hover:bg-white/10 transition-colors disabled:opacity-30">
                                    {regenerating === 'world' ? 'Expanding...' : 'Regenerate World'}
                                  </button>
                                  <button onClick={() => regenerateDirection(i)} disabled={regenerating !== null}
                                    className="text-[10px] px-2 py-1 rounded bg-white/5 text-text-dim hover:text-text-secondary hover:bg-white/10 transition-colors disabled:opacity-30">
                                    {regenerating === 'direction' ? 'Generating...' : 'Regenerate Direction'}
                                  </button>
                                </div>
                              )}
                              {phase.direction && (
                                <div className="mt-1 rounded bg-bg-overlay/50 px-2 py-1.5">
                                  <span className="text-[9px] text-text-dim uppercase tracking-wider block mb-0.5">Current Direction</span>
                                  <p className="text-[10px] text-text-secondary leading-relaxed">{phase.direction}</p>
                                </div>
                              )}
                            </div>
                          </details>
                        )}
                      </div>

                      {phase.status !== 'completed' && (
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button onClick={() => movePhase(i, -1)} disabled={i === 0} className="text-text-dim hover:text-text-primary disabled:opacity-20 text-[10px]">&#9650;</button>
                          <button onClick={() => movePhase(i, 1)} disabled={i === queue.phases.length - 1} className="text-text-dim hover:text-text-primary disabled:opacity-20 text-[10px]">&#9660;</button>
                          <button onClick={() => removePhase(i)} className="text-text-dim hover:text-payoff text-[10px] mt-1" title="Remove phase">&times;</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-6 py-4 border-t border-white/6 shrink-0">
          {queue && !existingQueue && (
            <button onClick={() => { setQueue(null); setSelectedProfileId(null); }}
              className="px-4 text-xs font-medium py-2 rounded-lg text-text-dim hover:text-text-secondary hover:bg-white/6 transition-colors">
              Back
            </button>
          )}
          {existingQueue && (
            <button onClick={handleClear}
              className="px-4 text-xs font-medium py-2 rounded-lg text-payoff hover:bg-white/6 transition-colors">
              Remove Queue
            </button>
          )}
          <div className="flex-1" />
          {queue && !existingQueue && (
            <button
              onClick={handleSave}
              disabled={queue.phases.length === 0 || activating}
              className={`px-6 text-xs font-semibold py-2 rounded-lg transition-colors ${
                queue.phases.length === 0 || activating
                  ? 'bg-white/4 text-text-dim cursor-not-allowed'
                  : 'bg-white/12 text-text-primary hover:bg-white/16'
              }`}
            >
              Activate Queue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
