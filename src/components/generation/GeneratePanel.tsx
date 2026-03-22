'use client';

import { useState, useMemo, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { generateScenes, suggestArcDirection, expandWorld, suggestWorldExpansion, type WorldExpansionSize } from '@/lib/ai';
import { resolveEntry, NARRATIVE_CUBE } from '@/types/narrative';
import type { CubeCornerKey } from '@/types/narrative';
import { nextId } from '@/lib/narrative-utils';
import { samplePacingSequence, optimizeSequence, detectCurrentMode, MATRIX_PRESETS, DEFAULT_TRANSITION_MATRIX, type PacingSequence } from '@/lib/markov';
import { DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { PacingStrip, CubeBadge } from './PacingStrip';
import { MarkovGraph } from './MarkovGraph';

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
  const [count, setCount] = useState(5);
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

  const currentMode = useMemo(
    () => detectCurrentMode(narrative, state.resolvedSceneKeys),
    [narrative, state.resolvedSceneKeys],
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

  const handleOptimize = useCallback(async () => {
    setOptimizing(true);
    try {
      const seq = await optimizeSequence(currentMode, count, direction || 'Continue the narrative naturally based on unresolved threads and character tensions.', storyMatrix);
      setPreviewSequence(seq);
      setAnimating(true);
    } catch {
      const seq = samplePacingSequence(currentMode, count, storyMatrix);
      setPreviewSequence(seq);
      setAnimating(true);
    } finally {
      setOptimizing(false);
    }
  }, [currentMode, count, direction, handleSample]);

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
        narrative, state.resolvedSceneKeys, headIndex, count, direction,
        { existingArc, pacingSequence: previewSequence ?? undefined, worldBuildFocus, onToken: (token) => setStreamText((prev) => prev + token) },
      );
      dispatch({ type: 'BULK_ADD_SCENES', scenes, arc, branchId: state.activeBranchId! });
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
    } catch (err) { setError(String(err)); } finally { setSuggesting(false); }
  }

  async function handleExpandWorld() {
    if (!narrative) return;
    setLoading(true);
    setError('');
    try {
      const expansion = await expandWorld(narrative, state.resolvedSceneKeys, headIndex, worldDirective, worldSize);
      dispatch({
        type: 'EXPAND_WORLD', wxId: nextId('WX', Object.keys(narrative.worldBuilds), 3),
        characters: expansion.characters, locations: expansion.locations, threads: expansion.threads,
        relationships: expansion.relationships, worldKnowledgeMutations: expansion.worldKnowledgeMutations,
        branchId: state.activeBranchId!,
      });
      onClose();
    } catch (err) { setError(String(err)); } finally { setLoading(false); }
  }

  const showPreview = !!previewSequence && mode === 'continuation' && !loading;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="bg-bg-base border border-white/10 max-w-xl w-full rounded-2xl p-6 relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none">&times;</button>

        <h2 className="text-sm font-semibold text-text-primary mb-1">Generate</h2>

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
          /* ── Pacing Preview ───────────────────────────────────── */
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

            {/* Strip below */}
            <PacingStrip
              sequence={previewSequence}
              animating={animating}
            />

            {/* Actions */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => setPreviewSequence(null)}
                disabled={animating || optimizing}
                className="text-[11px] text-text-dim hover:text-text-secondary transition disabled:opacity-30"
              >
                &larr; Back
              </button>
              <div className="flex items-center gap-1.5">
                {/* Resample */}
                <button
                  onClick={handleSample}
                  disabled={animating || optimizing}
                  className="text-[10px] px-2.5 py-1.5 rounded-lg border border-white/8 text-text-dim hover:text-text-primary hover:border-white/15 transition disabled:opacity-30 flex items-center gap-1"
                  title="Random sample from transition matrix"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    <circle cx="8.5" cy="8.5" r="1" fill="currentColor" />
                    <circle cx="15.5" cy="8.5" r="1" fill="currentColor" />
                    <circle cx="8.5" cy="15.5" r="1" fill="currentColor" />
                    <circle cx="15.5" cy="15.5" r="1" fill="currentColor" />
                    <circle cx="12" cy="12" r="1" fill="currentColor" />
                  </svg>
                  Reroll
                </button>
                {/* AI Suggest */}
                <button
                  onClick={handleOptimize}
                  disabled={animating || optimizing}
                  className="text-[10px] px-2.5 py-1.5 rounded-lg border border-amber-500/20 text-amber-400/70 hover:text-amber-400 hover:border-amber-500/30 hover:bg-amber-500/5 transition disabled:opacity-30 flex items-center gap-1"
                  title="AI picks the best route for your direction"
                >
                  {optimizing ? (
                    <div className="w-3 h-3 border-2 border-amber-400/20 border-t-amber-400/70 rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
                    </svg>
                  )}
                  Suggest Route
                </button>
                {/* Generate */}
                <button
                  onClick={handleGenerateArc}
                  disabled={animating || optimizing}
                  className="text-[11px] px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary font-semibold transition disabled:opacity-30"
                >
                  Generate
                </button>
              </div>
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

                {/* Direction */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase tracking-widest text-text-dim">Direction</label>
                    <button onClick={handleSuggestArc} disabled={suggesting}
                      className="text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider">
                      {suggesting ? 'Thinking...' : 'Suggest'}
                    </button>
                  </div>
                  <textarea
                    value={direction} onChange={(e) => setDirection(e.target.value)}
                    placeholder="What should this arc focus on?"
                    className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-16 resize-none outline-none placeholder:text-text-dim"
                  />
                </div>

                {/* Scene Count */}
                <div className="flex items-center gap-3">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim">Scenes</label>
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 5, 8].map((n) => (
                      <button key={n} onClick={() => setCount(n)}
                        className={`w-8 h-8 rounded-lg text-xs font-medium transition ${
                          count === n ? 'bg-white/12 text-text-primary' : 'bg-white/4 text-text-dim hover:bg-white/8'
                        }`}
                      >{n}</button>
                    ))}
                  </div>
                  {/* Current mode pill */}
                  <div className="ml-auto flex items-center gap-1.5 text-[10px] text-text-dim">
                    <CubeBadge mode={currentMode} />
                    <span style={{ color: CORNER_COLORS[currentMode] }}>{NARRATIVE_CUBE[currentMode].name}</span>
                  </div>
                </div>

                {/* Advanced */}
                {(() => {
                  const resolvedSet = new Set(state.resolvedSceneKeys);
                  const wbEntries = Object.values(narrative.worldBuilds).filter((wb) => resolvedSet.has(wb.id));
                  if (wbEntries.length === 0) return null;
                  return (
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
                        <div className="mt-3 flex flex-col gap-1 max-h-24 overflow-y-auto">
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
                      )}
                    </div>
                  );
                })()}

                {/* Action buttons */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleSample}
                    disabled={!newArc && !currentArc}
                    className="flex-1 py-2.5 rounded-lg border border-white/8 hover:border-white/15 text-text-secondary hover:text-text-primary font-medium transition disabled:opacity-30 flex items-center justify-center gap-2 text-[12px]"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="3" />
                      <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" />
                      <circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" />
                      <circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" />
                      <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" />
                      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
                    </svg>
                    Roll Route
                  </button>
                  <button
                    onClick={handleOptimize}
                    disabled={(!newArc && !currentArc) || optimizing}
                    className="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary font-semibold transition disabled:opacity-30 flex items-center justify-center gap-2 text-[12px]"
                  >
                    {optimizing ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
                        Planning...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
                        </svg>
                        Suggest Route
                      </>
                    )}
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
                <div>
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
      </div>
    </div>
  );
}
