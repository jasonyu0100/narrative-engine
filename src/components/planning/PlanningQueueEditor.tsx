'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { BUILT_IN_PROFILES, profileToQueue } from '@/lib/planning-profiles';
import { generatePhaseDirection, generateCustomPlan, generatePlanDocument } from '@/lib/planning-engine';
import { expandWorld } from '@/lib/ai';
import { nextId } from '@/lib/narrative-utils';
import { DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import type { PlanningPhase, PlanningProfile, PlanningQueue } from '@/types/narrative';
import { PlanningLoadingModal } from './PlanningLoadingModal';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';

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
          structuralRules: p.structuralRules,
          direction: '',
          worldExpansionHints: p.worldExpansionHints,
          sourceText: p.sourceText,
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
        phase.worldExpansionHints, 'medium', undefined, phase.sourceText,
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
        const strategy = narrative.storySettings?.expansionStrategy ?? 'dynamic';
        const expansion = await expandWorld(narrative, resolvedKeys, currentIndex, firstPhase.worldExpansionHints, 'medium', strategy, firstPhase.sourceText);
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

  function handleAutoMode() {
    setShowModeChoice(false);
    // Auto mode skips the blocking world+direction init — the auto loop handles
    // direction via refreshDirection and world expansion via phase transitions.
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
      <Modal onClose={onClose} size="md">
        <ModalHeader onClose={onClose}>
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Queue activated</h2>
            <p className="text-[10px] text-text-dim uppercase tracking-wider">Choose how to run the first phase</p>
          </div>
        </ModalHeader>
        <ModalBody className="p-6">
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
        </ModalBody>
        <ModalFooter>
          <button onClick={onClose} className="text-[10px] px-3 py-1.5 text-text-dim hover:text-text-secondary transition-colors">
            Cancel
          </button>
        </ModalFooter>
      </Modal>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="85vh">
      <ModalHeader onClose={onClose}>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Planning Queue</h2>
          <p className="text-[10px] text-text-dim mt-0.5">
            {queue ? `${queue.phases.length} phases · ${totalScenes} scenes` : 'Choose how to structure your story'}
          </p>
        </div>
      </ModalHeader>
      <ModalBody className="p-0">
        <div className="overflow-y-auto">
          {/* ── Create view ──────────────────────────────────────────── */}
          {!queue && (
            <div className="p-6">
              {/* Mode tabs */}
              <div className="flex items-center gap-0 rounded-lg bg-white/4 p-0.5 mb-5">
                {([
                  { mode: 'templates' as const, label: 'Templates' },
                  { mode: 'ai' as const, label: 'Auto' },
                  { mode: 'custom' as const, label: 'Plan Document' },
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

              {/* Auto */}
              {createMode === 'ai' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] text-text-dim leading-relaxed">
                    Generate a plan from the current story state — characters, threads, tensions, and pacing. The AI writes a detailed plan document, then parses it into phases with source text.
                  </p>
                  {!planDocument ? (
                    <button
                      onClick={async () => {
                        const narrative = state.activeNarrative;
                        if (!narrative) return;
                        setGenerating(true);
                        try {
                          const doc = await generatePlanDocument(narrative, state.resolvedEntryKeys, state.currentSceneIndex);
                          setPlanDocument(doc);
                        } catch (err) {
                          console.error('[planning-queue] plan document generation failed:', err);
                        } finally {
                          setGenerating(false);
                        }
                      }}
                      disabled={generating}
                      className="self-start px-5 py-2 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/16 text-text-primary transition disabled:opacity-30"
                    >
                      {generating ? 'Generating plan...' : 'Generate Plan'}
                    </button>
                  ) : (
                    <>
                      <textarea
                        value={planDocument}
                        onChange={(e) => setPlanDocument(e.target.value)}
                        className="bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-[11px] text-text-primary font-mono w-full h-64 resize-y outline-none focus:border-white/16 transition"
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-text-dim">
                          {planDocument.split(/\n/).length} lines · {Math.round(planDocument.length / 4)} tokens est.
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setPlanDocument('')}
                            className="text-[10px] px-2 py-1 text-text-dim hover:text-text-secondary transition-colors"
                          >
                            Clear
                          </button>
                          <button
                            onClick={() => generateFromDocument(planDocument)}
                            disabled={generating}
                            className="px-5 py-2 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/16 text-text-primary transition disabled:opacity-30"
                          >
                            {generating ? 'Parsing plan...' : 'Generate Queue'}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Plan Document */}
              {createMode === 'custom' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] text-text-dim leading-relaxed">
                    Paste a structured plan document — arc treatments, story bibles, chapter outlines. The AI will map each section to a phase and derive scene allocations from chapter counts.
                  </p>
                  <textarea
                    value={planDocument}
                    onChange={(e) => setPlanDocument(e.target.value)}
                    placeholder={"# Arc One: The Mountain and the Flower\n\n## Part One: The Weight of Five Hundred Years\n### Chapters 1-3 — The Stage, Set Small\n...\n\n## Part Two: The Flower in Another Garden\n### Chapters 4-5 — What Feng Jin Huang Inherited\n..."}
                    className="bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-[11px] text-text-primary font-mono w-full h-64 resize-y outline-none placeholder:text-text-dim/50 focus:border-white/16 transition"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-text-dim">
                      {planDocument.trim() ? `${planDocument.split(/\n/).length} lines · ${Math.round(planDocument.length / 4)} tokens est.` : 'Supports full arc treatments and story bibles'}
                    </span>
                    <button
                      onClick={() => generateFromDocument(planDocument)}
                      disabled={!planDocument.trim() || generating}
                      className="px-5 py-2 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/16 text-text-primary transition disabled:opacity-30"
                    >
                      {generating ? 'Parsing plan...' : 'Generate Queue'}
                    </button>
                  </div>
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
                {queue.phases.map((phase, i) => {
                  const isActive = phase.status === 'active';
                  const isCompleted = phase.status === 'completed';
                  const isPending = phase.status === 'pending';

                  return (
                    <div
                      key={phase.id}
                      className={`rounded-lg border p-3 ${
                        isActive ? 'bg-amber-500/5 border-amber-500/20'
                          : isCompleted ? 'bg-green-500/5 border-green-500/20 opacity-60'
                          : 'bg-bg-elevated border-border'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] text-text-dim font-mono mt-1 shrink-0 w-4">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          {/* Header: name + scenes */}
                          <div className="flex items-center gap-2">
                            <input
                              value={phase.name}
                              onChange={(e) => updatePhase(i, { name: e.target.value })}
                              className="bg-transparent text-xs text-text-primary font-medium flex-1 outline-none border-b border-transparent focus:border-white/20 pb-0.5"
                              disabled={isCompleted}
                            />
                            <div className="flex items-center gap-1.5 shrink-0">
                              <input
                                type="number" min={1} max={50}
                                value={phase.sceneAllocation}
                                onChange={(e) => updatePhase(i, { sceneAllocation: Math.max(1, Number(e.target.value)) })}
                                className="bg-bg-overlay border border-border rounded px-1.5 py-0.5 text-[10px] text-text-primary w-10 outline-none text-center"
                                disabled={isCompleted}
                                title="Scene allocation"
                              />
                              {isActive && <span className="text-[10px] text-amber-400 font-medium">{phase.scenesCompleted}/{phase.sceneAllocation}</span>}
                              {isCompleted && <span className="text-[10px] text-green-400 font-medium">Done</span>}
                            </div>
                          </div>

                          {/* Objective */}
                          <textarea
                            value={phase.objective}
                            onChange={(e) => updatePhase(i, { objective: e.target.value })}
                            placeholder="What should this phase achieve?"
                            className="bg-transparent text-[11px] text-text-secondary w-full outline-none resize-none mt-1 placeholder:text-text-dim leading-relaxed"
                            rows={2}
                            disabled={isCompleted}
                          />

                          {/* Active phase: direction + actions */}
                          {isActive && phase.direction && existingQueue && (
                            <details className="mt-2" open>
                              <summary className="text-[9px] text-amber-400/70 uppercase tracking-wider cursor-pointer hover:text-amber-400">Direction</summary>
                              <p className="mt-1 text-[10px] text-text-secondary leading-relaxed">{phase.direction}</p>
                            </details>
                          )}

                          {/* Expandable fields — only for non-completed */}
                          {!isCompleted && (
                            <details className="mt-2" open={isActive && !phase.direction}>
                              <summary className="text-[10px] text-text-dim cursor-pointer hover:text-text-secondary select-none">
                                {phase.sourceText ? `Source · ${Math.round(phase.sourceText.length / 4)}t` : 'Settings'}
                                {phase.constraints ? ' · constraints' : ''}
                                {phase.worldExpansionHints ? ' · expansion' : ''}
                              </summary>
                              <div className="mt-1.5 flex flex-col gap-2">
                                {/* Source text — prominent when present */}
                                {phase.sourceText && (
                                  <div>
                                    <label className="text-[9px] text-text-dim uppercase tracking-wider block mb-0.5">Source Text</label>
                                    <textarea
                                      value={phase.sourceText}
                                      onChange={(e) => updatePhase(i, { sourceText: e.target.value })}
                                      className="bg-bg-overlay border border-border rounded px-2 py-1.5 text-[10px] text-text-primary font-mono w-full outline-none resize-y leading-relaxed"
                                      rows={8}
                                    />
                                  </div>
                                )}

                                {/* Constraints */}
                                <div>
                                  <label className="text-[9px] text-text-dim uppercase tracking-wider block mb-0.5">Constraints</label>
                                  <textarea
                                    value={phase.constraints}
                                    onChange={(e) => updatePhase(i, { constraints: e.target.value })}
                                    placeholder="What must NOT happen in this phase..."
                                    className="bg-bg-overlay border border-border rounded px-2 py-1.5 text-[10px] text-text-primary w-full outline-none placeholder:text-text-dim resize-none leading-relaxed"
                                    rows={2}
                                  />
                                </div>

                                {/* World expansion + structural rules — single row */}
                                <div>
                                  <label className="text-[9px] text-text-dim uppercase tracking-wider block mb-0.5">World Expansion</label>
                                  <textarea
                                    value={phase.worldExpansionHints}
                                    onChange={(e) => updatePhase(i, { worldExpansionHints: e.target.value })}
                                    placeholder="New characters, locations, or systems to add..."
                                    className="bg-bg-overlay border border-border rounded px-2 py-1.5 text-[10px] text-text-primary w-full outline-none placeholder:text-text-dim resize-none leading-relaxed"
                                    rows={1}
                                  />
                                </div>

                                {phase.structuralRules && (
                                  <div>
                                    <label className="text-[9px] text-text-dim uppercase tracking-wider block mb-0.5">Structural Rules</label>
                                    <textarea
                                      value={phase.structuralRules}
                                      onChange={(e) => updatePhase(i, { structuralRules: e.target.value })}
                                      className="bg-bg-overlay border border-border rounded px-2 py-1.5 text-[10px] text-text-primary w-full outline-none resize-none leading-relaxed"
                                      rows={3}
                                    />
                                  </div>
                                )}

                                {/* Actions for active phase */}
                                {isActive && existingQueue && (
                                  <div className="flex gap-2">
                                    <button onClick={() => regenerateWorld(i)} disabled={regenerating !== null || !phase.worldExpansionHints}
                                      className="text-[10px] px-2 py-1 rounded bg-white/5 text-text-dim hover:text-text-secondary hover:bg-white/10 transition-colors disabled:opacity-30">
                                      {regenerating === 'world' ? 'Expanding...' : 'Re-expand World'}
                                    </button>
                                    <button onClick={() => regenerateDirection(i)} disabled={regenerating !== null}
                                      className="text-[10px] px-2 py-1 rounded bg-white/5 text-text-dim hover:text-text-secondary hover:bg-white/10 transition-colors disabled:opacity-30">
                                      {regenerating === 'direction' ? 'Generating...' : 'Re-generate Direction'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </details>
                          )}

                          {/* Completed phase: completion report */}
                          {isCompleted && phase.completionReport && (
                            <p className="text-[10px] text-text-dim mt-1 leading-relaxed italic">{phase.completionReport}</p>
                          )}
                        </div>

                        {/* Reorder / remove controls */}
                        {isPending && (
                          <div className="flex flex-col gap-0.5 shrink-0">
                            <button onClick={() => movePhase(i, -1)} disabled={i === 0} className="text-text-dim hover:text-text-primary disabled:opacity-20 text-[10px]">&#9650;</button>
                            <button onClick={() => movePhase(i, 1)} disabled={i === queue.phases.length - 1} className="text-text-dim hover:text-text-primary disabled:opacity-20 text-[10px]">&#9660;</button>
                            <button onClick={() => removePhase(i)} className="text-text-dim hover:text-payoff text-[10px] mt-1" title="Remove phase">&times;</button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
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
      </ModalFooter>
    </Modal>
  );
}
