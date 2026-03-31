'use client';

import { useState, useMemo, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { generateScenes, generateArcStepwise, expandWorld, suggestWorldExpansion, type WorldExpansionSize, type WorldExpansionStrategy } from '@/lib/ai';
import { resolveEntry, NARRATIVE_CUBE } from '@/types/narrative';
import type { CubeCornerKey } from '@/types/narrative';
import { nextId } from '@/lib/narrative-utils';
import { samplePacingSequence, detectCurrentMode, MATRIX_PRESETS, DEFAULT_TRANSITION_MATRIX, PACING_PRESETS, buildPresetSequence, buildSequenceFromModes, type PacingSequence } from '@/lib/markov';
import { DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { PacingStrip, CubeBadge } from './PacingStrip';
import { MarkovGraph } from './MarkovGraph';
import { GuidanceFields } from './GuidanceFields';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';

type Mode = 'continuation' | 'world';

// ── Corner colors ────────────────────────────────────────────────────────────

const CORNER_COLORS: Record<CubeCornerKey, string> = {
  HHH: '#f59e0b', HHL: '#ef4444', HLH: '#a855f7', HLL: '#6366f1',
  LHH: '#22d3ee', LHL: '#22c55e', LLH: '#3b82f6', LLL: '#6b7280',
};

const ALL_CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];

// ── Streaming Output ─────────────────────────────────────────────────────────

function StreamingOutput({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <h2 className="text-sm font-semibold text-text-primary">{label}&hellip;</h2>
      </div>
      {text ? (
        <pre className="text-[11px] text-text-dim font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-white/3 rounded-lg p-3 leading-relaxed">
          {text}
        </pre>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="h-3 w-3/4 bg-white/6 rounded animate-pulse" />
          <div className="h-3 w-1/2 bg-white/6 rounded animate-pulse" />
          <div className="h-3 w-5/6 bg-white/6 rounded animate-pulse" />
        </div>
      )}
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export function GeneratePanel({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [mode, setMode] = useState<Mode>('continuation');

  // Continuation state
  const [newArc, setNewArc] = useState(true);
  const [arcName, setArcName] = useState('');
  const [direction, setDirection] = useState('');
  const [count, setCount] = useState(5);
  const [worldBuildFocusId, setWorldBuildFocusId] = useState<string | null>(null);
  const [guidanceDirection, setGuidanceDirection] = useState('');
  const [guidanceConstraints, setGuidanceConstraints] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Pacing preview
  const [previewSequence, setPreviewSequence] = useState<PacingSequence | null>(null);
  const [animating, setAnimating] = useState(false);
  const [editingStep, setEditingStep] = useState<number | null>(null);

  // World state
  const [worldDirective, setWorldDirective] = useState('');
  const [worldSize, setWorldSize] = useState<WorldExpansionSize>('medium');
  const [worldStrategy, setWorldStrategy] = useState<WorldExpansionStrategy>(
    state.activeNarrative?.storySettings?.expansionStrategy ?? 'dynamic'
  );

  // Shared
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState('');

  const narrative = state.activeNarrative;
  if (!narrative) return null;


  const headIndex = state.resolvedEntryKeys.length - 1;
  const headKey = state.resolvedEntryKeys[headIndex];
  const headEntry = headKey ? resolveEntry(narrative, headKey) : null;
  const currentArc = headEntry?.kind === 'scene' && narrative.arcs[headEntry.arcId]
    ? narrative.arcs[headEntry.arcId]
    : null;

  const currentMode = useMemo(
    () => detectCurrentMode(narrative, state.resolvedEntryKeys),
    [narrative, state.resolvedEntryKeys],
  );

  const storyMatrix = useMemo(() => {
    const presetKey = narrative.storySettings?.rhythmPreset ?? DEFAULT_STORY_SETTINGS.rhythmPreset;
    return MATRIX_PRESETS.find((p) => p.key === presetKey)?.matrix ?? DEFAULT_TRANSITION_MATRIX;
  }, [narrative.storySettings?.rhythmPreset]);

  const handleSample = useCallback(() => {
    const seq = samplePacingSequence(currentMode, count, storyMatrix);
    setPreviewSequence(seq);
    setAnimating(true);
  }, [currentMode, count, storyMatrix]);

  const handleSetStep = useCallback((index: number, mode: CubeCornerKey) => {
    if (!previewSequence) return;
    const modes = previewSequence.steps.map((s) => s.mode);
    modes[index] = mode;
    setPreviewSequence(buildSequenceFromModes(modes));
    setEditingStep(null);
  }, [previewSequence]);

  const handleAddStep = useCallback(() => {
    if (!previewSequence) return;
    const modes = previewSequence.steps.map((s) => s.mode);
    modes.push('LLL');
    setPreviewSequence(buildSequenceFromModes(modes));
    setCount(modes.length);
  }, [previewSequence]);

  const handleRemoveStep = useCallback((index: number) => {
    if (!previewSequence || previewSequence.steps.length <= 1) return;
    const modes = previewSequence.steps.map((s) => s.mode).filter((_, i) => i !== index);
    setPreviewSequence(buildSequenceFromModes(modes));
    setCount(modes.length);
    setEditingStep(null);
  }, [previewSequence]);


  async function handleGenerateArc() {
    if (!narrative) return;
    if (!newArc && !currentArc) return;
    setLoading(true);
    setStreamText('');
    setError('');
    try {
      // Apply direction/constraints to story settings so branchContext picks them up
      const currentSettings = { ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings };
      if (guidanceDirection !== currentSettings.storyDirection || guidanceConstraints !== currentSettings.storyConstraints) {
        dispatch({
          type: 'SET_STORY_SETTINGS',
          settings: { ...currentSettings, storyDirection: guidanceDirection, storyConstraints: guidanceConstraints },
        });
      }

      const existingArc = !newArc ? currentArc ?? undefined : undefined;
      const worldBuildFocus = worldBuildFocusId ? narrative.worldBuilds[worldBuildFocusId] : undefined;
      const genMode = narrative.storySettings?.generationMode ?? 'batch';

      if (genMode === 'stepwise') {
        await generateArcStepwise(
          narrative, state.resolvedEntryKeys, headIndex, count, direction,
          {
            existingArc,
            pacingSequence: previewSequence ?? undefined,
            worldBuildFocus,
            onReasoning: (token) => setStreamText((prev) => prev + token),
            onScene: (scene, progressArc) => {
              dispatch({ type: 'BULK_ADD_SCENES', scenes: [scene], arc: progressArc, branchId: state.activeBranchId! });
            },
          },
        );
      } else {
        const { scenes, arc } = await generateScenes(
          narrative, state.resolvedEntryKeys, headIndex, count, direction,
          { existingArc, pacingSequence: previewSequence ?? undefined, worldBuildFocus, onReasoning: (token) => setStreamText((prev) => prev + token) },
        );
        dispatch({ type: 'BULK_ADD_SCENES', scenes, arc, branchId: state.activeBranchId! });
      }
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSuggestWorld() {
    if (!narrative) return;
    setSuggesting(true);
    setError('');
    try {
      const suggestion = await suggestWorldExpansion(narrative, state.resolvedEntryKeys, headIndex, worldSize, worldStrategy);
      setWorldDirective(suggestion);
    } catch (err) { setError(String(err)); } finally { setSuggesting(false); }
  }

  async function handleExpandWorld() {
    if (!narrative) return;
    setLoading(true);
    setError('');
    try {
      const expansion = await expandWorld(narrative, state.resolvedEntryKeys, headIndex, worldDirective, worldSize, worldStrategy);
      dispatch({
        type: 'EXPAND_WORLD', worldBuildId: nextId('WB', Object.keys(narrative.worldBuilds), 3),
        characters: expansion.characters, locations: expansion.locations, threads: expansion.threads,
        relationships: expansion.relationships, worldKnowledgeMutations: expansion.worldKnowledgeMutations,
        artifacts: expansion.artifacts, branchId: state.activeBranchId!,
      });
      onClose();
    } catch (err) { setError(String(err)); } finally { setLoading(false); }
  }

  const showPreview = !!previewSequence && mode === 'continuation' && !loading;

  return (
    <Modal onClose={loading ? () => {} : onClose} size="xl" maxHeight="90vh">
      <ModalHeader onClose={loading ? () => {} : onClose}>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Generate</h2>
        </div>
      </ModalHeader>
      <ModalBody className="p-6 space-y-4">
        {/* Mode tabs */}
        <div className="flex gap-1 bg-bg-elevated rounded-lg p-0.5">
          {([
            { label: 'Continuation', value: 'continuation' as Mode },
            { label: 'Expand World', value: 'world' as Mode },
          ]).map((m) => (
            <button
              key={m.value}
              onClick={() => { setMode(m.value); setError(''); setPreviewSequence(null); }}
              disabled={loading}
              className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors rounded-md ${
                mode === m.value ? 'bg-bg-overlay text-text-primary' : 'text-text-dim hover:text-text-secondary'
              } disabled:opacity-50`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {loading ? (
          <StreamingOutput label={mode === 'continuation' ? (newArc ? 'Generating arc' : 'Continuing arc') : 'Expanding world'} text={streamText} />
        ) : showPreview ? (
          /* ── Pacing Preview (editable) ─────────────────────────── */
          <div className="flex flex-col gap-4">
            {/* Graph centered */}
            <div className="flex justify-center">
              <MarkovGraph
                sequence={previewSequence}
                startMode={currentMode}
                animating={animating}
                onAnimationDone={() => setAnimating(false)}
                width={240}
                height={240}
              />
            </div>

            {/* Editable strip — animated on first render, then editable */}
            {animating ? (
              <PacingStrip
                sequence={previewSequence}
                animating={animating}
              />
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center flex-wrap gap-1.5">
                  {previewSequence.steps.map((step, i) => (
                    <div key={i} className="relative flex items-center">
                      {i > 0 && <span className="text-text-dim/30 text-[13px] font-light select-none mx-0.5">→</span>}
                      <button
                        data-step-idx={i}
                        onClick={() => setEditingStep(editingStep === i ? null : i)}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-all ${editingStep === i ? 'ring-1 ring-white/30' : 'hover:ring-1 hover:ring-white/15'}`}
                        style={{ backgroundColor: `${CORNER_COLORS[step.mode]}15` }}
                      >
                        <CubeBadge mode={step.mode} size="sm" />
                        <span className="text-[10px] font-semibold leading-none whitespace-nowrap" style={{ color: CORNER_COLORS[step.mode] }}>
                          {NARRATIVE_CUBE[step.mode].name}
                        </span>
                      </button>
                      {/* Dropdown picker */}
                      {editingStep === i && (() => {
                        // Use a portal-style ref to position the dropdown in fixed space
                        const btn = document.querySelector(`[data-step-idx="${i}"]`);
                        const rect = btn?.getBoundingClientRect();
                        return (
                          <>
                            {/* Backdrop to close on outside click */}
                            <div className="fixed inset-0 z-60" onClick={() => setEditingStep(null)} />
                            <div
                              className="fixed z-61 bg-bg-base border border-white/10 rounded-lg shadow-xl p-1 w-36"
                              style={rect ? { top: rect.bottom + 4, left: rect.left } : undefined}
                            >
                              {ALL_CORNERS.map((corner) => (
                                <button
                                  key={corner}
                                  onClick={() => handleSetStep(i, corner)}
                                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition ${
                                    corner === step.mode ? 'bg-white/10' : 'hover:bg-white/5'
                                  }`}
                                >
                                  <CubeBadge mode={corner} size="sm" />
                                  <span className="text-[10px] font-medium" style={{ color: CORNER_COLORS[corner] }}>
                                    {NARRATIVE_CUBE[corner].name}
                                  </span>
                                </button>
                              ))}
                              {previewSequence.steps.length > 1 && (
                                <>
                                  <div className="h-px bg-white/6 my-1" />
                                  <button
                                    onClick={() => handleRemoveStep(i)}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[10px] text-red-400/70 hover:bg-red-500/10 transition"
                                  >
                                    Remove step
                                  </button>
                                </>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ))}
                  {/* Add step */}
                  <button
                    onClick={handleAddStep}
                    className="w-6 h-6 rounded border border-dashed border-white/15 text-text-dim hover:text-text-primary hover:border-white/30 transition flex items-center justify-center text-[11px]"
                    title="Add step"
                  >
                    +
                  </button>
                </div>
                <p className="text-[10px] text-text-dim leading-snug">
                  {previewSequence.pacingDescription}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setPreviewSequence(null)}
                disabled={animating}
                className="text-[11px] text-text-dim hover:text-text-secondary transition disabled:opacity-30 mr-auto"
              >
                &larr; Back
              </button>
              <button
                onClick={handleSample}
                disabled={animating}
                className="h-9 px-3 rounded-lg border border-white/8 text-text-dim hover:text-text-primary hover:border-white/15 transition disabled:opacity-30 flex items-center gap-1.5 text-[11px]"
                title="Reroll from transition matrix"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" />
                  <circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" />
                  <circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" />
                  <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" />
                  <circle cx="12" cy="12" r="1.2" fill="currentColor" />
                </svg>
                Reroll
              </button>
              <button
                onClick={handleGenerateArc}
                disabled={animating}
                className="h-9 px-5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary font-semibold transition disabled:opacity-30 text-[12px]"
              >
                Generate →
              </button>
            </div>
          </div>
        ) : (
          /* ── Configuration ──────────────────────────────────── */
          <div className="flex flex-col gap-4">
            {mode === 'continuation' ? (
              <>
                {/* Arc toggle */}
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={newArc} onChange={(e) => setNewArc(e.target.checked)} className="accent-white/80" />
                  <span className="text-xs text-text-secondary">New arc</span>
                </label>

                {newArc ? (
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">Arc Name</label>
                    <input
                      type="text" value={arcName} onChange={(e) => setArcName(e.target.value)}
                      placeholder="e.g. The Reckoning"
                      className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full outline-none placeholder:text-text-dim"
                    />
                  </div>
                ) : currentArc ? (
                  <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2">
                    <span className="text-[10px] uppercase tracking-widest text-text-dim">Continuing</span>
                    <p className="text-sm text-text-primary">{currentArc.name}</p>
                  </div>
                ) : null}

                {/* Direction + Constraints */}
                <GuidanceFields
                  direction={guidanceDirection}
                  constraints={guidanceConstraints}
                  onDirectionChange={(v) => { setGuidanceDirection(v); setDirection(v); }}
                  onConstraintsChange={setGuidanceConstraints}
                />

                {/* Scene Count */}
                <div className="flex items-center gap-3">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim shrink-0">Scenes</label>
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="range" min={1} max={16} value={count}
                      onChange={(e) => setCount(Number(e.target.value))}
                      className="flex-1 h-1 appearance-none bg-white/10 rounded-full accent-white/60 cursor-pointer [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white/80 [&::-webkit-slider-thumb]:appearance-none"
                    />
                    <span className="text-xs font-medium text-text-primary w-5 text-center tabular-nums">{count}</span>
                  </div>
                  {/* Current mode pill */}
                  <div className="flex items-center gap-1.5 text-[10px] text-text-dim shrink-0">
                    <CubeBadge mode={currentMode} />
                    <span style={{ color: CORNER_COLORS[currentMode] }}>{NARRATIVE_CUBE[currentMode].name}</span>
                  </div>
                </div>

                {/* Advanced */}
                <div>
                  <button onClick={() => setAdvancedOpen((v) => !v)}
                    className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-text-dim hover:text-text-secondary transition-colors">
                    <svg className={`w-3 h-3 transition-transform ${advancedOpen ? 'rotate-90' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    Advanced
                  </button>
                  {advancedOpen && (
                    <div className="mt-3 flex flex-col gap-3">
                      {/* Pacing presets */}
                      <div>
                        <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1.5">Pacing Presets</label>
                        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                          {PACING_PRESETS.map((preset) => (
                            <button
                              key={preset.key}
                              onClick={() => {
                                setCount(preset.modes.length);
                                const seq = buildPresetSequence(preset);
                                setPreviewSequence(seq);
                                setAnimating(true);
                              }}
                              disabled={!newArc && !currentArc}
                              className="rounded-lg px-3 py-2 text-left transition border border-white/6 bg-white/2 hover:bg-white/6 hover:border-white/12 disabled:opacity-30 flex items-center gap-3"
                            >
                              <div className="flex gap-0.5 shrink-0">
                                {preset.modes.map((m, i) => (
                                  <div key={i} className="w-2 h-2 rounded-sm" style={{ backgroundColor: CORNER_COLORS[m] }} title={NARRATIVE_CUBE[m].name} />
                                ))}
                              </div>
                              <div className="min-w-0">
                                <span className="text-[11px] font-medium text-text-primary">{preset.name}</span>
                                <span className="text-[10px] text-text-dim ml-1.5">{preset.modes.length}s</span>
                                <p className="text-[10px] text-text-dim line-clamp-1">{preset.description}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* World build focus */}
                      {(() => {
                        const resolvedSet = new Set(state.resolvedEntryKeys);
                        const wbEntries = Object.values(narrative.worldBuilds).filter((wb) => resolvedSet.has(wb.id));
                        if (wbEntries.length === 0) return null;
                        return (
                          <div>
                            <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1.5">World Build Focus</label>
                            <div className="flex flex-col gap-1 max-h-24 overflow-y-auto">
                              {wbEntries.map((wb) => {
                                const isSelected = worldBuildFocusId === wb.id;
                                return (
                                  <button key={wb.id} type="button" onClick={() => setWorldBuildFocusId(isSelected ? null : wb.id)}
                                    className={`rounded-lg px-3 py-2 text-left transition border ${
                                      isSelected ? 'bg-amber-500/10 border-amber-500/30' : 'bg-bg-elevated border-border hover:border-white/16'
                                    }`}>
                                    <p className={`text-xs line-clamp-1 ${isSelected ? 'text-amber-300' : 'text-text-primary'}`}>{wb.summary}</p>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={handleGenerateArc}
                    disabled={!newArc && !currentArc}
                    className="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary font-semibold transition disabled:opacity-30 text-[12px]"
                  >
                    Generate
                  </button>
                  <button
                    onClick={handleSample}
                    disabled={!newArc && !currentArc}
                    className="py-2.5 px-4 rounded-lg border border-white/8 hover:bg-white/6 text-text-dim hover:text-text-primary transition disabled:opacity-30 flex items-center justify-center gap-2 text-[12px]"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="3" />
                      <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" />
                      <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" />
                      <circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" />
                      <circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" />
                      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
                    </svg>
                    Roll Route
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* World mode */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase tracking-widest text-text-dim">Directive</label>
                    <button onClick={handleSuggestWorld} disabled={suggesting}
                      className="text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider">
                      {suggesting ? 'Thinking...' : 'Suggest'}
                    </button>
                  </div>
                  <textarea value={worldDirective} onChange={(e) => setWorldDirective(e.target.value)}
                    placeholder="Describe what to add to the world..."
                    className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-28 resize-none outline-none placeholder:text-text-dim" />
                </div>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">Size</label>
                    <div className="flex gap-1.5">
                      {([
                        { value: 'small' as WorldExpansionSize, label: 'Small', desc: '~5' },
                        { value: 'medium' as WorldExpansionSize, label: 'Medium', desc: '~12' },
                        { value: 'large' as WorldExpansionSize, label: 'Large', desc: '~30' },
                      ]).map((opt) => (
                        <button key={opt.value} type="button" onClick={() => setWorldSize(opt.value)}
                          className={`flex-1 px-2 py-2 rounded-lg text-left transition-colors ${
                            worldSize === opt.value ? 'bg-white/10 ring-1 ring-white/20' : 'bg-white/3 hover:bg-white/6'
                          }`}>
                          <div className="text-xs text-text-primary font-medium">{opt.label}</div>
                          <div className="text-[9px] text-text-dim">{opt.desc} entities</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">Strategy</label>
                    <div className="flex gap-1.5">
                      {([
                        { value: 'depth' as WorldExpansionStrategy, label: 'Depth', desc: 'Deepen' },
                        { value: 'breadth' as WorldExpansionStrategy, label: 'Breadth', desc: 'Widen' },
                        { value: 'dynamic' as WorldExpansionStrategy, label: 'Dynamic', desc: 'Auto' },
                      ]).map((opt) => (
                        <button key={opt.value} type="button" onClick={() => setWorldStrategy(opt.value)}
                          className={`flex-1 px-2 py-2 rounded-lg text-left transition-colors ${
                            worldStrategy === opt.value ? 'bg-white/10 ring-1 ring-white/20' : 'bg-white/3 hover:bg-white/6'
                          }`}>
                          <div className="text-xs text-text-primary font-medium">{opt.label}</div>
                          <div className="text-[9px] text-text-dim">{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <button onClick={handleExpandWorld} disabled={loading}
                  className="bg-white/10 hover:bg-white/16 text-text-primary font-semibold px-4 py-2.5 rounded-lg transition disabled:opacity-30">
                  {loading ? 'Expanding...' : 'Expand World'}
                </button>
              </>
            )}

            {error && (
              <div className="bg-payoff/10 border border-payoff/30 rounded-lg px-3 py-2">
                <p className="text-sm text-payoff font-medium">Failed</p>
                <p className="text-xs text-payoff/80 mt-1">{error}</p>
              </div>
            )}
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}
