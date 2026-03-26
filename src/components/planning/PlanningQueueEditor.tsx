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

export function PlanningQueueEditor({ onClose, onStartAuto }: Props) {
  const { state, dispatch } = useStore();
  const branchId = state.activeBranchId;
  const branch = branchId ? state.activeNarrative?.branches[branchId] : null;
  const existingQueue = branch?.planningQueue;

  const [queue, setQueue] = useState<PlanningQueue | null>(existingQueue ?? null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(existingQueue?.profileId ?? null);
  const [planDocument, setPlanDocument] = useState('');
  const [generating, setGenerating] = useState(false);
  const [showCustomPlan, setShowCustomPlan] = useState(false);
  const [regenerating, setRegenerating] = useState<'world' | 'direction' | null>(null);
  const [showAutoPrompt, setShowAutoPrompt] = useState(false);

  async function generateFromDocument() {
    const narrative = state.activeNarrative;
    if (!narrative || !planDocument.trim()) return;
    setGenerating(true);
    try {
      const result = await generateCustomPlan(
        narrative, state.resolvedEntryKeys, state.currentSceneIndex, planDocument,
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
      console.error('[planning-queue] custom plan generation failed:', err);
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
      // Update world focus to latest
      const baseSettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };
      dispatch({
        type: 'SET_STORY_SETTINGS',
        settings: { ...baseSettings, worldFocus: 'latest' },
      });
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
      // Update the phase
      dispatch({
        type: 'UPDATE_PLANNING_PHASE',
        branchId,
        phaseIndex,
        updates: { direction, constraints: constraints || phase.constraints },
      });
      // Write to story settings
      const baseSettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };
      dispatch({
        type: 'SET_STORY_SETTINGS',
        settings: {
          ...baseSettings,
          storyDirection: direction,
          storyConstraints: constraints || phase.constraints || baseSettings.storyConstraints,
        },
      });
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
    const updated = { ...queue, phases };
    setQueue(updated);
    // Live-save to store if queue already exists
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

  async function handleSave() {
    if (!branchId || !queue || queue.phases.length === 0) return;
    const narrative = state.activeNarrative;
    if (!narrative) return;

    // Save the queue immediately
    dispatch({ type: 'SET_PLANNING_QUEUE', branchId, queue });

    // Initialize the first phase — world expansion + direction/constraints
    const firstPhase = queue.phases[0];
    if (firstPhase.status === 'active' && !firstPhase.direction) {
      setActivating(true);
      try {
        const resolvedKeys = state.resolvedEntryKeys;
        const currentIndex = state.currentSceneIndex;

        // World expansion for first phase
        if (firstPhase.worldExpansionHints) {
          setActivatingStep('Expanding world...');
          const expansion = await expandWorld(narrative, resolvedKeys, currentIndex, firstPhase.worldExpansionHints, 'medium');
          dispatch({
            type: 'EXPAND_WORLD',
            worldBuildId: nextId('WB', Object.keys(narrative.worldBuilds), 3),
            characters: expansion.characters,
            locations: expansion.locations,
            threads: expansion.threads,
            relationships: expansion.relationships,
            worldKnowledgeMutations: expansion.worldKnowledgeMutations,
            branchId,
          });
        }

        // Generate direction and constraints
        setActivatingStep('Generating direction...');
        const { direction, constraints } = await generatePhaseDirection(
          narrative, resolvedKeys, currentIndex, firstPhase, queue,
        );

        // Update phase with generated direction/constraints
        dispatch({
          type: 'UPDATE_PLANNING_PHASE',
          branchId,
          phaseIndex: 0,
          updates: { direction, constraints: constraints || firstPhase.constraints },
        });

        // Write to story settings (use defaults if settings don't exist yet)
        const baseSettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };
        dispatch({
          type: 'SET_STORY_SETTINGS',
          settings: {
            ...baseSettings,
            storyDirection: direction,
            storyConstraints: constraints || firstPhase.constraints || baseSettings.storyConstraints,
            worldFocus: 'latest',
          },
        });
      } catch (err) {
        console.error('[planning-queue] first phase init failed:', err);
      } finally {
        setActivating(false);
        setActivatingStep(null);
      }
    }

    if (onStartAuto) {
      setShowAutoPrompt(true);
    } else {
      onClose();
    }
  }

  function handleClear() {
    if (!branchId) return;
    dispatch({ type: 'SET_PLANNING_QUEUE', branchId, queue: undefined });
    setQueue(null);
    setSelectedProfileId(null);
  }

  const totalScenes = queue?.phases.reduce((sum, p) => sum + p.sceneAllocation, 0) ?? 0;

  if (activating) {
    return <PlanningLoadingModal step={activatingStep ?? 'Initializing...'} subtitle="Preparing the first phase" />;
  }

  if (showAutoPrompt) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
        <div className="glass max-w-sm w-full rounded-2xl p-5 text-center">
          <p className="text-sm text-text-primary font-medium mb-1">Queue activated</p>
          <p className="text-[11px] text-text-dim mb-4">Run auto mode to complete the plan?</p>
          <div className="flex gap-2 justify-center">
            <button onClick={onClose}
              className="px-4 py-2 text-xs text-text-dim hover:text-text-secondary transition">
              Not now
            </button>
            <button onClick={() => { onStartAuto?.(); onClose(); }}
              className="px-5 py-2 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/16 text-text-primary transition">
              Start Auto Mode
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="glass max-w-2xl w-full rounded-2xl p-6 relative max-h-[85vh] flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none"
        >
          &times;
        </button>

        <h2 className="text-sm font-semibold text-text-primary mb-1">Planning Queue</h2>
        <p className="text-[10px] text-text-dim uppercase tracking-wider mb-4">
          {queue ? `${queue.phases.length} phases \u00b7 ${totalScenes} scenes allocated` : 'Select a profile to populate the queue'}
        </p>

        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-4">
          {/* Selection view — only when no queue is chosen yet */}
          {!queue && (
            <>
              {/* Profile selector — horizontal carousel */}
              <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                {(['complete', 'episodic'] as const).map((cat, catIdx) => {
                  const profiles = BUILT_IN_PROFILES.filter((p) => p.category === cat);
                  return (
                    <div key={cat} className="flex gap-2 shrink-0">
                      {catIdx > 0 && (
                        <div className="flex flex-col items-center justify-center px-1 shrink-0">
                          <div className="h-full w-px bg-white/8" />
                        </div>
                      )}
                      <div className="flex flex-col gap-1 shrink-0">
                        <span className="text-[9px] uppercase tracking-widest text-text-dim font-mono px-0.5">
                          {cat === 'complete' ? 'Complete' : 'Episodic'}
                        </span>
                        <div className="flex gap-2">
                          {profiles.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => selectProfile(p)}
                              className={`w-36 h-40 shrink-0 text-left rounded-xl border p-3 transition flex flex-col ${
                                selectedProfileId === p.id
                                  ? 'border-white/25 bg-white/8'
                                  : 'border-white/6 bg-white/2 hover:border-white/15 hover:bg-white/4'
                              }`}
                            >
                              <span className="text-[11px] font-semibold text-text-primary leading-tight">{p.name}</span>
                              <span className="text-[10px] text-text-dim leading-snug mt-1.5">{p.description}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Custom / AI plan */}
              <div className="border-t border-white/6 pt-4">
                <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">
                  Or generate a plan
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const autoPrompt = 'Analyse the current narrative state — characters, threads, world knowledge, and scene history — and design the optimal superstructure for continuing this story. Consider thread maturity, character arcs, and pacing.';
                      setPlanDocument(autoPrompt);
                      generateFromDocument();
                    }}
                    disabled={generating}
                    className="flex-1 py-2 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 hover:border-white/12 text-xs text-text-secondary transition disabled:opacity-30"
                  >
                    {generating && !planDocument.trim() ? 'Generating...' : 'AI from branch'}
                  </button>
                  <button
                    onClick={() => setShowCustomPlan((v) => !v)}
                    className="flex-1 py-2 rounded-lg border border-white/6 bg-white/2 hover:bg-white/5 hover:border-white/12 text-xs text-text-secondary transition"
                  >
                    Custom plan
                  </button>
                </div>
                {showCustomPlan && (
                  <div className="mt-2">
                    <textarea
                      value={planDocument}
                      onChange={(e) => setPlanDocument(e.target.value)}
                      placeholder="Describe your story structure — plot outline, character arcs, key events..."
                      className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-[11px] text-text-primary w-full h-20 resize-none outline-none placeholder:text-text-dim focus:border-white/16 transition"
                    />
                    <button
                      onClick={generateFromDocument}
                      disabled={!planDocument.trim() || generating}
                      className="mt-1.5 text-[10px] font-medium px-4 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 text-text-primary transition disabled:opacity-30"
                    >
                      {generating ? 'Generating...' : 'Generate'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Phase editor — shown when queue is populated */}
          {queue && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] uppercase tracking-widest text-text-dim">
                  Phases
                </label>
                <button
                  onClick={addPhase}
                  className="text-[10px] text-text-secondary hover:text-text-primary transition-colors uppercase tracking-wider"
                >
                  + Add Phase
                </button>
              </div>

              <div className="flex flex-col gap-2">
                {queue.phases.map((phase, i) => (
                  <div
                    key={phase.id}
                    className={`rounded-lg border p-3 ${
                      phase.status === 'active'
                        ? 'bg-amber-500/5 border-amber-500/20'
                        : phase.status === 'completed'
                        ? 'bg-green-500/5 border-green-500/20 opacity-60'
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
                              type="number"
                              min={1}
                              max={50}
                              value={phase.sceneAllocation}
                              onChange={(e) => updatePhase(i, { sceneAllocation: Math.max(1, Number(e.target.value)) })}
                              className="bg-bg-overlay border border-border rounded px-1.5 py-0.5 text-[10px] text-text-primary w-12 outline-none text-center"
                              disabled={phase.status === 'completed'}
                            />
                          </div>

                          {phase.status === 'active' && (
                            <span className="text-[10px] text-amber-400 uppercase tracking-wider">
                              {phase.scenesCompleted}/{phase.sceneAllocation} done
                            </span>
                          )}

                          {phase.status === 'completed' && (
                            <span className="text-[10px] text-green-400 uppercase tracking-wider">
                              Completed
                            </span>
                          )}
                        </div>

                        {/* Constraints & config (collapsible) */}
                        {phase.status !== 'completed' && (
                          <details className="mt-2" open={phase.status === 'active'}>
                            <summary className="text-[10px] text-text-dim cursor-pointer hover:text-text-secondary">
                              Configuration
                            </summary>
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
                              {/* Regenerate actions — only on active phase with existing queue */}
                              {phase.status === 'active' && existingQueue && (
                                <div className="flex gap-2 mt-1">
                                  <button
                                    onClick={() => regenerateWorld(i)}
                                    disabled={regenerating !== null || !phase.worldExpansionHints}
                                    className="text-[10px] px-2 py-1 rounded bg-white/5 text-text-dim hover:text-text-secondary hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                  >
                                    {regenerating === 'world' ? 'Expanding...' : 'Regenerate World'}
                                  </button>
                                  <button
                                    onClick={() => regenerateDirection(i)}
                                    disabled={regenerating !== null}
                                    className="text-[10px] px-2 py-1 rounded bg-white/5 text-text-dim hover:text-text-secondary hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                  >
                                    {regenerating === 'direction' ? 'Generating...' : 'Regenerate Direction'}
                                  </button>
                                </div>
                              )}
                              {/* Show current direction/constraints if set */}
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

                      {/* Phase controls */}
                      {phase.status !== 'completed' && (
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button
                            onClick={() => movePhase(i, -1)}
                            disabled={i === 0}
                            className="text-text-dim hover:text-text-primary disabled:opacity-20 text-[10px]"
                          >
                            &#9650;
                          </button>
                          <button
                            onClick={() => movePhase(i, 1)}
                            disabled={i === queue.phases.length - 1}
                            className="text-text-dim hover:text-text-primary disabled:opacity-20 text-[10px]"
                          >
                            &#9660;
                          </button>
                          <button
                            onClick={() => removePhase(i)}
                            className="text-text-dim hover:text-payoff text-[10px] mt-1"
                            title="Remove phase"
                          >
                            &times;
                          </button>
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
        <div className="flex gap-2 pt-4 mt-4 border-t border-border shrink-0">
          {queue && !existingQueue && (
            <button
              onClick={() => { setQueue(null); setSelectedProfileId(null); }}
              className="px-4 text-xs font-medium py-2 rounded-lg text-text-dim hover:text-text-secondary hover:bg-white/6 transition-colors"
            >
              Change Plan
            </button>
          )}
          {existingQueue && (
            <button
              onClick={handleClear}
              className="px-4 text-xs font-medium py-2 rounded-lg text-payoff hover:bg-white/6 transition-colors"
            >
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
              {activating ? (activatingStep ?? 'Initializing...') : 'Activate Queue'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
