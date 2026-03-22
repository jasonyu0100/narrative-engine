'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { generateScenes, suggestArcDirection, expandWorld, suggestWorldExpansion, type WorldExpansionSize } from '@/lib/ai';
import { resolveEntry, NARRATIVE_CUBE } from '@/types/narrative';
import type { CubeCornerKey } from '@/types/narrative';
import type { DeliveryDirection } from '@/types/mcts';
import { DELIVERY_DIRECTIONS } from '@/types/mcts';
import { nextId } from '@/lib/narrative-utils';

type Mode = 'continuation' | 'world';
type GoalMode = 'none' | 'cube' | 'delivery';

// ── Direction Icons (matching MCTS panel) ────────────────────────────────────

const DELIVERY_COLORS: Record<DeliveryDirection, string> = {
  escalate: '#22C55E',
  release: '#3B82F6',
  surge: '#F59E0B',
  rebound: '#A855F7',
};

const DELIVERY_POINTS: Record<DeliveryDirection, string> = {
  escalate: '0,8 16,2',
  release: '0,2 16,8',
  surge: '0,8 6,2 12,8',
  rebound: '0,2 6,8 12,2',
};

function DeliveryIcon({ dir, size = 16 }: { dir: DeliveryDirection; size?: number }) {
  const h = Math.round(size * 0.625);
  return (
    <svg width={size} height={h} viewBox="0 0 16 10">
      <polyline
        points={DELIVERY_POINTS[dir]}
        fill="none"
        stroke={DELIVERY_COLORS[dir]}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const CORNER_COLORS: Record<CubeCornerKey, string> = {
  HHH: '#f59e0b', HHL: '#ef4444', HLH: '#a855f7', HLL: '#6366f1',
  LHH: '#22d3ee', LHL: '#22c55e', LLH: '#3b82f6', LLL: '#6b7280',
};

function CubeIcon({ corner }: { corner: CubeCornerKey }) {
  return (
    <span className="font-mono text-[9px] font-bold tracking-tight">
      {corner.split('').map((c, i) => (
        <span key={i} style={{ color: CORNER_COLORS[corner], opacity: c === 'H' ? 0.9 : 0.3 }}>{c}</span>
      ))}
    </span>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

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

// ── Constants ────────────────────────────────────────────────────────────────

const ALL_CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];
const ALL_DELIVERY: DeliveryDirection[] = ['escalate', 'release', 'surge', 'rebound'];

// ── Main Panel ───────────────────────────────────────────────────────────────

export function GeneratePanel({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [mode, setMode] = useState<Mode>('continuation');

  // Continuation state
  const [newArc, setNewArc] = useState(true);
  const [arcName, setArcName] = useState('');
  const [direction, setDirection] = useState('');
  const [count, setCount] = useState(3);
  const [goalMode, setGoalMode] = useState<GoalMode>('none');
  const [cubeGoal, setCubeGoal] = useState<CubeCornerKey | null>(null);
  const [deliveryGoal, setDeliveryGoal] = useState<DeliveryDirection | null>(null);
  const [worldBuildFocusId, setWorldBuildFocusId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
          cubeGoal: goalMode === 'cube' ? cubeGoal ?? undefined : undefined,
          deliveryGoal: goalMode === 'delivery' ? deliveryGoal ?? undefined : undefined,
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

  return (
    <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
      <div className="bg-bg-base border border-white/10 max-w-lg w-full rounded-2xl p-6 relative">
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
              onClick={() => { setMode(m.value); setError(''); }}
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

        {loading ? (
          <StreamingOutput label={mode === 'continuation' ? (newArc ? 'Generating arc' : 'Continuing arc') : 'Expanding world'} text={streamText} />
        ) : (
        <div className="flex flex-col gap-4">
          {mode === 'continuation' ? (
            <>
              {/* New Arc / Continue toggle */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={newArc}
                  onChange={(e) => setNewArc(e.target.checked)}
                  disabled={loading}
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
                    disabled={loading}
                    className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full outline-none placeholder:text-text-dim disabled:opacity-50"
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
                    disabled={suggesting || loading}
                    className="text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
                  >
                    {suggesting ? 'Thinking...' : 'Suggest'}
                  </button>
                </div>
                <textarea
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                  placeholder="Describe what this arc should focus on..."
                  disabled={loading}
                  className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-20 resize-none outline-none placeholder:text-text-dim disabled:opacity-50"
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
                      disabled={loading}
                      className={`px-3 py-1.5 rounded text-xs transition ${
                        count === n ? 'bg-white/12 text-text-primary' : 'bg-white/4 text-text-dim hover:bg-white/8'
                      } disabled:opacity-50`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Goal Mode — Cube or Delivery */}
              <div>
                <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1.5">Narrative Goal</label>
                {/* Mode selector */}
                <div className="flex gap-1 mb-2">
                  {([
                    { value: 'none' as GoalMode, label: 'Auto' },
                    { value: 'cube' as GoalMode, label: 'Cube Position' },
                    { value: 'delivery' as GoalMode, label: 'Delivery Shape' },
                  ]).map((g) => (
                    <button
                      key={g.value}
                      onClick={() => { setGoalMode(g.value); }}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                        goalMode === g.value ? 'bg-white/10 text-text-primary' : 'text-text-dim hover:text-text-primary hover:bg-white/5'
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>

                {/* Cube corner picker */}
                {goalMode === 'cube' && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {ALL_CORNERS.map((c) => {
                      const corner = NARRATIVE_CUBE[c];
                      const selected = cubeGoal === c;
                      return (
                        <button
                          key={c}
                          onClick={() => setCubeGoal(selected ? null : c)}
                          className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-center transition-colors border ${
                            selected
                              ? 'border-white/20 bg-white/8'
                              : 'border-transparent hover:bg-white/5'
                          }`}
                        >
                          <CubeIcon corner={c} />
                          <span className="text-[10px] font-medium leading-tight" style={{ color: CORNER_COLORS[c] }}>
                            {corner.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Delivery direction picker */}
                {goalMode === 'delivery' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    {ALL_DELIVERY.map((d) => {
                      const dd = DELIVERY_DIRECTIONS[d];
                      const selected = deliveryGoal === d;
                      return (
                        <button
                          key={d}
                          onClick={() => setDeliveryGoal(selected ? null : d)}
                          className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors border ${
                            selected
                              ? 'border-white/20 bg-white/8'
                              : 'border-transparent hover:bg-white/5'
                          }`}
                        >
                          <DeliveryIcon dir={d} size={20} />
                          <div>
                            <div className="text-[11px] font-medium" style={{ color: DELIVERY_COLORS[d] }}>
                              {dd.name}
                            </div>
                            <div className="text-[9px] text-text-dim leading-snug">
                              {dd.description}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
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
                      <div className="mt-3 space-y-4">
                        <div>
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
                                  disabled={loading}
                                  className={`rounded-lg px-3 py-2 text-left transition disabled:opacity-50 border ${
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
                      </div>
                    )}
                  </div>
                );
              })()}

              <button
                onClick={handleGenerateArc}
                disabled={loading || (!newArc && !currentArc)}
                className="bg-white/10 hover:bg-white/16 text-text-primary font-semibold px-4 py-2.5 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none"
              >
                {loading ? 'Generating...' : newArc ? `Generate Arc (${count} scene${count > 1 ? 's' : ''})` : `Continue Arc (${count} scene${count > 1 ? 's' : ''})`}
              </button>
            </>
          ) : (
            <>
              {/* World mode */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim">Directive</label>
                  <button
                    type="button"
                    onClick={handleSuggestWorld}
                    disabled={suggesting || loading}
                    className="text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
                  >
                    {suggesting ? 'Thinking...' : 'Suggest Expansion'}
                  </button>
                </div>
                <textarea
                  value={worldDirective}
                  onChange={(e) => setWorldDirective(e.target.value)}
                  placeholder="Describe what to add to the world..."
                  disabled={loading}
                  className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-28 resize-none outline-none placeholder:text-text-dim disabled:opacity-50"
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
