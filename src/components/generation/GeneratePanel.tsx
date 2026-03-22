'use client';

import { useState, useMemo, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { generateScenes, suggestArcDirection, expandWorld, suggestWorldExpansion, type WorldExpansionSize } from '@/lib/ai';
import { resolveEntry, NARRATIVE_CUBE } from '@/types/narrative';
import type { CubeCornerKey } from '@/types/narrative';
import { nextId } from '@/lib/narrative-utils';
import { samplePacingSequence, optimizeSequence, detectCurrentMode, MATRIX_PRESETS, type PacingSequence } from '@/lib/markov';
import { PacingStrip } from './PacingStrip';

type Mode = 'continuation' | 'world';

// ── Corner colors ────────────────────────────────────────────────────────────

const CORNER_COLORS: Record<CubeCornerKey, string> = {
  HHH: '#f59e0b', HHL: '#ef4444', HLH: '#a855f7', HLL: '#6366f1',
  LHH: '#22d3ee', LHL: '#22c55e', LLH: '#3b82f6', LLL: '#6b7280',
};

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
  const [count, setCount] = useState(3);
  const [selectedPreset, setSelectedPreset] = useState<string>('harry_potter');
  const [worldBuildFocusId, setWorldBuildFocusId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Pacing preview
  const [previewSequence, setPreviewSequence] = useState<PacingSequence | null>(null);
  const [animating, setAnimating] = useState(false);
  const [optimizing, setOptimizing] = useState(false);

  // World state
  const [worldDirective, setWorldDirective] = useState('');
  const [worldSize, setWorldSize] = useState<WorldExpansionSize>('medium');

  // Shared
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState('');

  const narrative = state.activeNarrative;
  if (!narrative) return null;

  const headIndex = state.resolvedSceneKeys.length - 1;
  const headKey = state.resolvedSceneKeys[headIndex];
  const headEntry = headKey ? resolveEntry(narrative, headKey) : null;
  const currentArc = headEntry?.kind === 'scene' && narrative.arcs[headEntry.arcId]
    ? narrative.arcs[headEntry.arcId]
    : null;
  const sceneLabel = headKey
    ? `From head (scene ${headIndex + 1} of ${state.resolvedSceneKeys.length})`
    : '';

  const currentMode = useMemo(
    () => detectCurrentMode(narrative, state.resolvedSceneKeys),
    [narrative, state.resolvedSceneKeys],
  );

  const activePreset = MATRIX_PRESETS.find((p) => p.key === selectedPreset) ?? MATRIX_PRESETS[0];

  const handleSample = useCallback(() => {
    const seq = samplePacingSequence(currentMode, count, activePreset.matrix);
    setPreviewSequence(seq);
    setAnimating(true);
  }, [currentMode, count, activePreset]);

  const handleOptimize = useCallback(async () => {
    if (!direction.trim()) {
      // No direction — just sample randomly
      handleSample();
      return;
    }
    setOptimizing(true);
    try {
      const seq = await optimizeSequence(currentMode, count, direction, activePreset.matrix);
      setPreviewSequence(seq);
      setAnimating(true);
    } catch {
      handleSample(); // fallback
    } finally {
      setOptimizing(false);
    }
  }, [currentMode, count, direction, activePreset, handleSample]);

  async function handleSuggestArc() {
    if (!narrative) return;
    setSuggesting(true);
    setError('');
    try {
      const suggestion = await suggestArcDirection(narrative, state.resolvedSceneKeys, headIndex);
      setArcName(suggestion.arcName);
      setDirection(suggestion.text.includes(':') ? suggestion.text.slice(suggestion.text.indexOf(':') + 1).trim() : suggestion.text);
      setCount(suggestion.suggestedSceneCount);
    } catch (err) {
      setError(String(err));
    } finally {
      setSuggesting(false);
    }
  }

  async function handleGenerateArc() {
    if (!narrative) return;
    if (!newArc && !currentArc) return;
    setLoading(true);
    setStreamText('');
    setError('');
    try {
      const existingArc = !newArc ? currentArc ?? undefined : undefined;
      const worldBuildFocus = worldBuildFocusId ? narrative.worldBuilds[worldBuildFocusId] : undefined;
      const { scenes, arc } = await generateScenes(
        narrative,
        state.resolvedSceneKeys,
        headIndex,
        count,
        direction,
        {
          existingArc,
          pacingSequence: previewSequence ?? undefined,
          transitionMatrix: activePreset.matrix,
          worldBuildFocus,
          onToken: (token) => setStreamText((prev) => prev + token),
        },
      );
      dispatch({
        type: 'BULK_ADD_SCENES',
        scenes,
        arc,
        branchId: state.activeBranchId!,
      });
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
      const suggestion = await suggestWorldExpansion(narrative, state.resolvedSceneKeys, headIndex, worldSize);
      setWorldDirective(suggestion);
    } catch (err) {
      setError(String(err));
    } finally {
      setSuggesting(false);
    }
  }

  async function handleExpandWorld() {
    if (!narrative) return;
    setLoading(true);
    setError('');
    try {
      const expansion = await expandWorld(narrative, state.resolvedSceneKeys, headIndex, worldDirective, worldSize);
      dispatch({
        type: 'EXPAND_WORLD',
        wxId: nextId('WX', Object.keys(narrative.worldBuilds), 3),
        characters: expansion.characters,
        locations: expansion.locations,
        threads: expansion.threads,
        relationships: expansion.relationships,
        worldKnowledgeMutations: expansion.worldKnowledgeMutations,
        branchId: state.activeBranchId!,
      });
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const showPreview = !!previewSequence && mode === 'continuation' && !loading;

  return (
    <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
      <div className="bg-bg-base border border-white/10 max-w-xl w-full rounded-2xl p-6 relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none"
        >
          &times;
        </button>

        <h2 className="text-sm font-semibold text-text-primary mb-1">Generate</h2>
        {sceneLabel && (
          <p className="text-[10px] text-text-dim uppercase tracking-wider mb-3">{sceneLabel}</p>
        )}

        {/* Mode tabs */}
        <div className="flex gap-1 bg-bg-elevated rounded-lg p-0.5 mb-4">
          {([
            { label: 'Continuation', value: 'continuation' as Mode },
            { label: 'Expand World', value: 'world' as Mode },
          ]).map((m) => (
            <button
              key={m.value}
              onClick={() => { setMode(m.value); setError(''); setPreviewSequence(null); }}
              disabled={loading}
              className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors rounded-md ${
                mode === m.value
                  ? 'bg-bg-overlay text-text-primary'
                  : 'text-text-dim hover:text-text-secondary'
              } disabled:opacity-50`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Streaming output while generating */}
        {loading ? (
          <StreamingOutput
            label={mode === 'continuation' ? (newArc ? 'Generating arc' : 'Continuing arc') : 'Expanding world'}
            text={streamText}
          />
        ) : showPreview ? (
          /* ── Pacing Preview ─────────────────────────────────────── */
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] uppercase tracking-widest text-text-dim font-medium">Pacing Sequence</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSample}
                  disabled={animating}
                  className="text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
                >
                  Resample
                </button>
                {direction.trim() && (
                  <button
                    onClick={handleOptimize}
                    disabled={animating || optimizing}
                    className="text-[10px] text-amber-400/70 hover:text-amber-400 transition-colors disabled:opacity-30 uppercase tracking-wider"
                  >
                    {optimizing ? 'Optimizing...' : 'Optimize'}
                  </button>
                )}
              </div>
            </div>

            <PacingStrip
              sequence={previewSequence}
              animating={animating}
              onAnimationDone={() => setAnimating(false)}
            />

            {/* Actions */}
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => setPreviewSequence(null)}
                disabled={animating}
                className="text-[11px] text-text-dim hover:text-text-secondary transition disabled:opacity-30"
              >
                &larr; Back
              </button>
              <button
                onClick={handleGenerateArc}
                disabled={animating}
                className="bg-white/10 hover:bg-white/16 text-text-primary font-semibold px-5 py-2 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none text-[13px]"
              >
                Generate
              </button>
            </div>
          </div>
        ) : (
          /* ── Configuration ──────────────────────────────────────── */
          <div className="flex flex-col gap-4">
            {mode === 'continuation' ? (
              <>
                {/* New Arc / Continue toggle */}
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newArc}
                    onChange={(e) => setNewArc(e.target.checked)}
                    className="accent-white/80"
                  />
                  <span className="text-xs text-text-secondary">New arc</span>
                </label>

                {newArc ? (
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">Arc Name</label>
                    <input
                      type="text"
                      value={arcName}
                      onChange={(e) => setArcName(e.target.value)}
                      placeholder="e.g. The Reckoning"
                      className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full outline-none placeholder:text-text-dim"
                    />
                  </div>
                ) : currentArc ? (
                  <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2">
                    <span className="text-[10px] uppercase tracking-widest text-text-dim">Continuing</span>
                    <p className="text-sm text-text-primary">{currentArc.name}</p>
                    <p className="text-[10px] text-text-dim">{currentArc.sceneIds.length} scenes so far</p>
                  </div>
                ) : (
                  <p className="text-xs text-text-dim">No arc found for the current scene.</p>
                )}

                {/* Direction */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase tracking-widest text-text-dim">Direction / Focus</label>
                    <button
                      type="button"
                      onClick={handleSuggestArc}
                      disabled={suggesting}
                      className="text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
                    >
                      {suggesting ? 'Thinking...' : 'Suggest'}
                    </button>
                  </div>
                  <textarea
                    value={direction}
                    onChange={(e) => setDirection(e.target.value)}
                    placeholder="Describe what this arc should focus on..."
                    className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-20 resize-none outline-none placeholder:text-text-dim"
                  />
                </div>

                {/* Scene Count */}
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">Scenes</label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 5, 8].map((n) => (
                      <button
                        key={n}
                        onClick={() => setCount(n)}
                        className={`px-3 py-1.5 rounded text-xs transition ${
                          count === n ? 'bg-white/12 text-text-primary' : 'bg-white/4 text-text-dim hover:bg-white/8'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Rhythm Profile */}
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1.5">Rhythm Profile</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {MATRIX_PRESETS.map((preset) => (
                      <button
                        key={preset.key}
                        onClick={() => setSelectedPreset(preset.key)}
                        className={`px-3 py-2 rounded-lg text-left transition-colors border ${
                          selectedPreset === preset.key
                            ? 'border-white/15 bg-white/8'
                            : 'border-transparent hover:bg-white/4'
                        }`}
                      >
                        <div className="text-[11px] font-medium text-text-primary">{preset.name}</div>
                        <div className="text-[9px] text-text-dim leading-snug mt-0.5">{preset.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Current mode */}
                <div className="flex items-center gap-2 text-[10px] text-text-dim">
                  <span>Current:</span>
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CORNER_COLORS[currentMode] }} />
                    <span style={{ color: CORNER_COLORS[currentMode] }} className="font-medium">
                      {NARRATIVE_CUBE[currentMode].name}
                    </span>
                  </div>
                </div>

                {/* Advanced section */}
                {(() => {
                  const resolvedSet = new Set(state.resolvedSceneKeys);
                  const worldBuildEntries = Object.values(narrative.worldBuilds).filter((wb) => resolvedSet.has(wb.id));
                  if (worldBuildEntries.length === 0) return null;
                  return (
                    <div>
                      <button
                        onClick={() => setAdvancedOpen((v) => !v)}
                        className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-text-dim hover:text-text-secondary transition-colors"
                      >
                        <svg
                          className={`w-3 h-3 transition-transform ${advancedOpen ? 'rotate-90' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        Advanced
                      </button>
                      {advancedOpen && (
                        <div className="mt-3">
                          <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1.5">World Build Focus</label>
                          <div className="flex flex-col gap-1 max-h-24 overflow-y-auto">
                            {worldBuildEntries.map((wb) => {
                              const manifest = wb.expansionManifest;
                              const parts: string[] = [];
                              if (manifest.characterIds.length > 0) parts.push(`${manifest.characterIds.length} char${manifest.characterIds.length > 1 ? 's' : ''}`);
                              if (manifest.locationIds.length > 0) parts.push(`${manifest.locationIds.length} loc${manifest.locationIds.length > 1 ? 's' : ''}`);
                              if (manifest.threadIds.length > 0) parts.push(`${manifest.threadIds.length} thread${manifest.threadIds.length > 1 ? 's' : ''}`);
                              const isSelected = worldBuildFocusId === wb.id;
                              return (
                                <button
                                  key={wb.id}
                                  type="button"
                                  onClick={() => setWorldBuildFocusId(isSelected ? null : wb.id)}
                                  className={`rounded-lg px-3 py-2 text-left transition border ${
                                    isSelected
                                      ? 'bg-amber-500/10 border-amber-500/30 ring-1 ring-amber-500/20'
                                      : 'bg-bg-elevated border-border hover:border-white/16'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <p className={`text-xs line-clamp-1 ${isSelected ? 'text-amber-300' : 'text-text-primary'}`}>{wb.summary}</p>
                                    {isSelected && <span className="text-[9px] text-amber-400 shrink-0 uppercase tracking-wider">Focus</span>}
                                  </div>
                                  <p className="text-[10px] text-text-dim mt-0.5">{wb.id} &middot; {parts.join(', ')}</p>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Preview Pacing — the main action */}
                <div className="flex gap-2">
                  <button
                    onClick={handleSample}
                    disabled={!newArc && !currentArc}
                    className="flex-1 bg-white/8 hover:bg-white/12 text-text-primary font-semibold px-4 py-2.5 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                    Sample ({count})
                  </button>
                  {direction.trim() && (
                    <button
                      onClick={handleOptimize}
                      disabled={(!newArc && !currentArc) || optimizing}
                      className="flex-1 bg-amber-500/10 hover:bg-amber-500/15 text-amber-400 font-semibold px-4 py-2.5 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none border border-amber-500/20 flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      {optimizing ? 'Optimizing...' : 'Optimize'}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* World mode — unchanged */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase tracking-widest text-text-dim">Directive</label>
                    <button
                      type="button"
                      onClick={handleSuggestWorld}
                      disabled={suggesting}
                      className="text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
                    >
                      {suggesting ? 'Thinking...' : 'Suggest Expansion'}
                    </button>
                  </div>
                  <textarea
                    value={worldDirective}
                    onChange={(e) => setWorldDirective(e.target.value)}
                    placeholder="Describe what to add to the world..."
                    className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-28 resize-none outline-none placeholder:text-text-dim"
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-2">Size</label>
                  <div className="flex gap-1.5">
                    {([
                      { value: 'small' as WorldExpansionSize, label: 'Small', desc: '~5 entities' },
                      { value: 'medium' as WorldExpansionSize, label: 'Medium', desc: '~12 entities' },
                      { value: 'large' as WorldExpansionSize, label: 'Large', desc: '~30 entities' },
                    ]).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setWorldSize(opt.value)}
                        className={`flex-1 px-2 py-2 rounded-lg text-left transition-colors ${
                          worldSize === opt.value ? 'bg-white/10 ring-1 ring-white/20' : 'bg-white/3 hover:bg-white/6'
                        }`}
                      >
                        <div className="text-xs text-text-primary font-medium">{opt.label}</div>
                        <div className="text-[9px] text-text-dim">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleExpandWorld}
                  disabled={loading}
                  className="bg-white/10 hover:bg-white/16 text-text-primary font-semibold px-4 py-2.5 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none"
                >
                  {loading ? 'Expanding...' : 'Expand World'}
                </button>
              </>
            )}

            {error && (
              <div className="bg-payoff/10 border border-payoff/30 rounded-lg px-3 py-2">
                <p className="text-sm text-payoff font-medium">Generation failed</p>
                <p className="text-xs text-payoff/80 mt-1">{error}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
