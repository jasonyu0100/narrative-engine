'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { BUILT_IN_PROFILES, profileToQueue } from '@/lib/planning-profiles';
import { generatePhaseDirection, generateCustomPlan, generatePlanDocument, generateOutline } from '@/lib/planning-engine';
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

type CreateMode = 'templates' | 'ai-outline' | 'custom-outline' | 'ai-plan' | 'custom-plan';

export function PlanningQueueEditor({ onClose, onStartAuto }: Props) {
  const { state, dispatch } = useStore();
  const branchId = state.activeBranchId;
  const branch = branchId ? state.activeNarrative?.branches[branchId] : null;
  const existingQueue = branch?.planningQueue;

  const [queue, setQueue] = useState<PlanningQueue | null>(existingQueue ?? null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(existingQueue?.profileId ?? null);
  const [planDocument, setPlanDocument] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatingReasoning, setGeneratingReasoning] = useState('');
  const [regenerating, setRegenerating] = useState<'world' | 'direction' | null>(null);
  const [createMode, setCreateMode] = useState<CreateMode>('templates');

  // ── Actions ─────────────────────────────────────────────────────────────

  async function generateFromDocument(doc: string) {
    const narrative = state.activeNarrative;
    if (!narrative || !doc.trim()) return;
    setGenerating(true);
    setGeneratingReasoning('');
    try {
      const result = await generateCustomPlan(
        narrative, state.resolvedEntryKeys, state.currentSceneIndex, doc,
        (token) => setGeneratingReasoning((prev) => prev + token),
      );
      const hasSourceText = result.phases.some((p) => p.sourceText);
      const newQueue: PlanningQueue = {
        profileId: null,
        mode: hasSourceText ? 'plan' : 'outline',
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

  async function generateFromOutlineAI() {
    const narrative = state.activeNarrative;
    if (!narrative) return;
    setGenerating(true);
    setGeneratingReasoning('');
    try {
      const result = await generateOutline(
        narrative, state.resolvedEntryKeys, state.currentSceneIndex,
        (token) => setGeneratingReasoning((prev) => prev + token),
      );
      const newQueue: PlanningQueue = {
        profileId: null,
        mode: 'outline',
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
      setSelectedProfileId('ai-outline');
    } catch (err) {
      console.error('[planning-queue] outline generation failed:', err);
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

      if (queue.expandWorld !== false) {
        setActivatingStep('Expanding world...');
        const strategy = narrative.storySettings?.expansionStrategy ?? 'dynamic';
        const expansion = await expandWorld(narrative, resolvedKeys, currentIndex, firstPhase.worldExpansionHints || '', 'medium', strategy, firstPhase.sourceText);
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
      // Activate the first phase: set status, direction, and activePhaseIndex
      const activatedQueue: PlanningQueue = {
        ...queue,
        activePhaseIndex: 0,
        phases: queue.phases.map((p, i) => i === 0 ? { ...p, status: 'active' as const, direction, constraints: constraints || p.constraints } : p),
      };
      dispatch({ type: 'SET_PLANNING_QUEUE', branchId, queue: activatedQueue });
      setQueue(activatedQueue);
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

  function handleReset() {
    if (!branchId || !existingQueue) return;
    const resetQueue: PlanningQueue = {
      ...existingQueue,
      activePhaseIndex: -1,
      phases: existingQueue.phases.map((p) => ({
        ...p,
        status: 'pending' as const,
        scenesCompleted: 0,
        direction: '',
        completionReport: undefined,
        worldBuildId: undefined,
      })),
    };
    dispatch({ type: 'SET_PLANNING_QUEUE', branchId, queue: resetQueue });
    // Clear direction/constraints that were set by the queue
    const narrative = state.activeNarrative;
    if (narrative) {
      const baseSettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };
      dispatch({ type: 'SET_STORY_SETTINGS', settings: { ...baseSettings, storyDirection: '', storyConstraints: '' } });
    }
    setQueue(resetQueue);
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
            {queue
              ? `${queue.mode === 'plan' ? 'Plan' : 'Outline'} · ${queue.phases.length} phases · ${totalScenes} scenes`
              : 'Choose how to structure your story'}
          </p>
        </div>
      </ModalHeader>
      <ModalBody className="p-0">
        <div className="overflow-y-auto">
          {/* ── Create view ──────────────────────────────────────────── */}
          {!queue && (
            <div className="p-6">
              {/* Paradigm selector */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                {/* Outlines */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] uppercase tracking-widest text-text-dim font-mono">Outlines</span>
                    <span className="text-[9px] text-text-dim leading-snug">Dynamic guidelines with creative freedom</span>
                  </div>
                  {([
                    { mode: 'templates' as const, label: 'Templates', desc: 'Story structure archetypes' },
                    { mode: 'ai-outline' as const, label: 'AI Outline', desc: 'Generated from story state' },
                    { mode: 'custom-outline' as const, label: 'Custom Outline', desc: 'Write your own outline' },
                  ]).map(({ mode, label, desc }) => (
                    <button
                      key={mode}
                      onClick={() => setCreateMode(mode)}
                      className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                        createMode === mode
                          ? 'border-white/20 bg-white/8'
                          : 'border-white/6 bg-white/2 hover:border-white/12 hover:bg-white/4'
                      }`}
                    >
                      <span className="text-[11px] font-medium text-text-primary block">{label}</span>
                      <span className="text-[9px] text-text-dim">{desc}</span>
                    </button>
                  ))}
                </div>
                {/* Plans */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] uppercase tracking-widest text-text-dim font-mono">Plans</span>
                    <span className="text-[9px] text-text-dim leading-snug">Explicit instructions trickled into scenes</span>
                  </div>
                  {([
                    { mode: 'ai-plan' as const, label: 'AI Plan', desc: 'Full treatment from story state' },
                    { mode: 'custom-plan' as const, label: 'Custom Plan', desc: 'Paste a story bible or treatment' },
                  ]).map(({ mode, label, desc }) => (
                    <button
                      key={mode}
                      onClick={() => setCreateMode(mode)}
                      className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                        createMode === mode
                          ? 'border-white/20 bg-white/8'
                          : 'border-white/6 bg-white/2 hover:border-white/12 hover:bg-white/4'
                      }`}
                    >
                      <span className="text-[11px] font-medium text-text-primary block">{label}</span>
                      <span className="text-[9px] text-text-dim">{desc}</span>
                    </button>
                  ))}
                </div>
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

              {/* AI Outline */}
              {createMode === 'ai-outline' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] text-text-dim leading-relaxed">
                    Analyse the current story state and generate a dynamic outline — phase objectives, scene allocations, and constraints. The system has creative freedom within each phase.
                  </p>
                  <button
                    onClick={generateFromOutlineAI}
                    disabled={generating}
                    className="self-start px-5 py-2 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/16 text-text-primary transition disabled:opacity-30"
                  >
                    {generating ? 'Generating outline...' : 'Generate Outline'}
                  </button>
                  {generating && generatingReasoning && (
                    <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-[10px] text-text-dim font-mono max-h-32 overflow-y-auto whitespace-pre-wrap">
                      {generatingReasoning}
                    </div>
                  )}
                </div>
              )}

              {/* Custom Outline */}
              {createMode === 'custom-outline' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] text-text-dim leading-relaxed">
                    Paste a rough outline — phase names, objectives, and scene counts. The system will use these as dynamic guidelines with creative freedom within each phase.
                  </p>
                  <textarea
                    value={planDocument}
                    onChange={(e) => setPlanDocument(e.target.value)}
                    placeholder={"## Phase 1: The Setup (6 scenes)\nIntroduce the protagonist and establish the world...\n\n## Phase 2: Rising Tension (8 scenes)\nEscalate the central conflict..."}
                    className="bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-[11px] text-text-primary font-mono w-full h-48 resize-y outline-none placeholder:text-text-dim/50 focus:border-white/16 transition"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-text-dim">
                      {planDocument.trim() ? `${planDocument.split(/\n/).length} lines` : 'Lightweight structure — objectives and scene counts'}
                    </span>
                    <button
                      onClick={() => generateFromDocument(planDocument)}
                      disabled={!planDocument.trim() || generating}
                      className="px-5 py-2 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/16 text-text-primary transition disabled:opacity-30"
                    >
                      {generating ? 'Parsing...' : 'Generate Queue'}
                    </button>
                  </div>
                </div>
              )}

              {/* AI Plan */}
              {createMode === 'ai-plan' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] text-text-dim leading-relaxed">
                    Generate a detailed narrative treatment from the current story state. The AI writes a full plan document with prose samples, character beats, and structural guidance, then parses it into phases with source text that trickles down into every scene.
                  </p>
                  {!planDocument ? (
                    <button
                      onClick={async () => {
                        const narrative = state.activeNarrative;
                        if (!narrative) return;
                        setGenerating(true);
                        setGeneratingReasoning('');
                        try {
                          const doc = await generatePlanDocument(
                            narrative, state.resolvedEntryKeys, state.currentSceneIndex,
                            (token) => setGeneratingReasoning((prev) => prev + token),
                          );
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
                  {generating && generatingReasoning && (
                    <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-[10px] text-text-dim font-mono max-h-32 overflow-y-auto whitespace-pre-wrap">
                      {generatingReasoning}
                    </div>
                  )}
                </div>
              )}

              {/* Custom Plan */}
              {createMode === 'custom-plan' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] text-text-dim leading-relaxed">
                    Paste a detailed plan document — arc treatments, story bibles, chapter outlines with prose samples and structural guidance. Each section becomes a phase with source text that trickles down into direction, summaries, and prose.
                  </p>
                  <textarea
                    value={planDocument}
                    onChange={(e) => setPlanDocument(e.target.value)}
                    placeholder={"# Arc One: The Mountain and the Flower\n\n## Part One: The Weight of Five Hundred Years\n### Chapters 1-3 — The Stage, Set Small\n\nOpen *in medias res* — not the rebirth, but the instant before it...\n\n## Part Two: The Flower in Another Garden\n### Chapters 4-5 — What Feng Jin Huang Inherited\n..."}
                    className="bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-[11px] text-text-primary font-mono w-full h-64 resize-y outline-none placeholder:text-text-dim/50 focus:border-white/16 transition"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-text-dim">
                      {planDocument.trim() ? `${planDocument.split(/\n/).length} lines · ${Math.round(planDocument.length / 4)} tokens est.` : 'Full arc treatments with prose samples and structural notes'}
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

          {/* ── Phase list ──────────────────────────────────────────── */}
          {queue && (
            <div className="p-4">
              {/* Queue settings */}
              <div className="flex items-center gap-4 mb-3 px-1">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={queue.expandWorld !== false}
                    onChange={(e) => {
                      const updated = { ...queue, expandWorld: e.target.checked };
                      setQueue(updated);
                      if (existingQueue && branchId) {
                        dispatch({ type: 'SET_PLANNING_QUEUE', branchId, queue: updated });
                      }
                    }}
                    className="accent-white/60 w-3 h-3"
                  />
                  <span className="text-[10px] text-text-dim">Expand world at phase boundaries</span>
                </label>
              </div>

              <div className="flex flex-col gap-1.5">
                {queue.phases.map((phase, i) => {
                  const isActive = phase.status === 'active';
                  const isCompleted = phase.status === 'completed';

                  const progress = isActive ? phase.scenesCompleted / phase.sceneAllocation : isCompleted ? 1 : 0;

                  return (
                    <div
                      key={phase.id}
                      className={`rounded-lg border transition-colors ${
                        isActive ? 'bg-amber-500/5 border-amber-500/15'
                          : isCompleted ? 'bg-white/2 border-white/6 opacity-50'
                          : 'bg-white/2 border-white/6'
                      }`}
                    >
                      {/* Compact header — always visible */}
                      <div className="flex items-center gap-2.5 px-3 py-2">
                        <span className={`text-[10px] font-mono shrink-0 w-4 text-center ${isActive ? 'text-amber-400' : 'text-text-dim'}`}>{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] font-medium truncate ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}>{phase.name}</span>
                            <span className="text-[10px] text-text-dim shrink-0">
                              {isActive ? `${phase.scenesCompleted}/${phase.sceneAllocation}` : isCompleted ? 'done' : `${phase.sceneAllocation} scenes`}
                            </span>
                          </div>
                          {/* Progress bar for active phase */}
                          {isActive && (
                            <div className="mt-1 h-0.5 bg-white/6 rounded-full overflow-hidden">
                              <div className="h-full bg-amber-400/50 rounded-full transition-all" style={{ width: `${progress * 100}%` }} />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Expandable detail — objective, direction, settings */}
                      <details className="group">
                        <summary className="px-3 pb-1.5 text-[10px] text-text-dim cursor-pointer hover:text-text-secondary select-none -mt-0.5">
                          {phase.objective.slice(0, 80)}{phase.objective.length > 80 ? '...' : ''}
                        </summary>
                        <div className="px-3 pb-3 pt-1 border-t border-white/4 space-y-2.5">
                          {/* Objective */}
                          <div>
                            <p className="text-[10px] text-text-secondary leading-relaxed">{phase.objective}</p>
                          </div>

                          {/* Direction — active phase only */}
                          {isActive && phase.direction && existingQueue && (
                            <div>
                              <label className="text-[9px] text-amber-400/60 uppercase tracking-wider block mb-0.5">Direction</label>
                              <p className="text-[10px] text-text-secondary leading-relaxed">{phase.direction}</p>
                            </div>
                          )}

                          {/* Completion report — completed phase */}
                          {isCompleted && phase.completionReport && (
                            <div>
                              <label className="text-[9px] text-text-dim uppercase tracking-wider block mb-0.5">Report</label>
                              <p className="text-[10px] text-text-dim leading-relaxed italic">{phase.completionReport}</p>
                            </div>
                          )}

                          {/* Source text */}
                          {phase.sourceText && (
                            <details>
                              <summary className="text-[9px] text-text-dim cursor-pointer hover:text-text-secondary select-none">
                                Source text · {Math.round(phase.sourceText.length / 4)}t
                              </summary>
                              <textarea
                                value={phase.sourceText}
                                onChange={(e) => updatePhase(i, { sourceText: e.target.value })}
                                className="mt-1 bg-bg-overlay border border-border rounded px-2 py-1.5 text-[10px] text-text-primary font-mono w-full outline-none resize-y leading-relaxed"
                                rows={6}
                              />
                            </details>
                          )}

                          {/* Constraints + expansion + rules — collapsed */}
                          {!isCompleted && (
                            <details>
                              <summary className="text-[9px] text-text-dim cursor-pointer hover:text-text-secondary select-none">
                                Settings
                                {phase.constraints ? ' · constraints' : ''}
                                {phase.worldExpansionHints ? ' · expansion hints' : ''}
                              </summary>
                              <div className="mt-1.5 space-y-2">
                                <div>
                                  <label className="text-[9px] text-text-dim uppercase tracking-wider block mb-0.5">Constraints</label>
                                  <textarea
                                    value={phase.constraints}
                                    onChange={(e) => updatePhase(i, { constraints: e.target.value })}
                                    placeholder="What must NOT happen..."
                                    className="bg-bg-overlay border border-border rounded px-2 py-1.5 text-[10px] text-text-primary w-full outline-none placeholder:text-text-dim resize-none leading-relaxed"
                                    rows={2}
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] text-text-dim uppercase tracking-wider block mb-0.5">World Expansion Hints</label>
                                  <textarea
                                    value={phase.worldExpansionHints}
                                    onChange={(e) => updatePhase(i, { worldExpansionHints: e.target.value })}
                                    placeholder="Characters, locations, or systems to introduce..."
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
                                <div>
                                  <label className="text-[9px] text-text-dim uppercase tracking-wider block mb-0.5">Scene Allocation</label>
                                  <input
                                    type="number" min={1} max={50}
                                    value={phase.sceneAllocation}
                                    onChange={(e) => updatePhase(i, { sceneAllocation: Math.max(1, Number(e.target.value)) })}
                                    className="bg-bg-overlay border border-border rounded px-2 py-1 text-[10px] text-text-primary w-16 outline-none"
                                  />
                                </div>
                              </div>
                            </details>
                          )}

                          {/* Actions for active phase */}
                          {isActive && existingQueue && (
                            <div className="flex gap-2 pt-1">
                              <button onClick={() => regenerateWorld(i)} disabled={regenerating !== null}
                                className="text-[10px] px-2 py-1 rounded bg-white/5 text-text-dim hover:text-text-secondary hover:bg-white/8 transition-colors disabled:opacity-30">
                                {regenerating === 'world' ? 'Expanding...' : 'Re-expand World'}
                              </button>
                              <button onClick={() => regenerateDirection(i)} disabled={regenerating !== null}
                                className="text-[10px] px-2 py-1 rounded bg-white/5 text-text-dim hover:text-text-secondary hover:bg-white/8 transition-colors disabled:opacity-30">
                                {regenerating === 'direction' ? 'Generating...' : 'Re-generate Direction'}
                              </button>
                            </div>
                          )}
                        </div>
                      </details>
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
          <>
            <button onClick={handleReset}
              className="px-4 text-xs font-medium py-2 rounded-lg text-text-dim hover:text-text-secondary hover:bg-white/6 transition-colors">
              Reset Progress
            </button>
            <button onClick={handleClear}
              className="px-4 text-xs font-medium py-2 rounded-lg text-payoff hover:bg-white/6 transition-colors">
              Remove Queue
            </button>
          </>
        )}
        <div className="flex-1" />
        {queue && (!existingQueue || (existingQueue.activePhaseIndex === -1 && existingQueue.phases.every((p) => p.status === 'pending'))) && (
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
