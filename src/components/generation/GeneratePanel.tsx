'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { generateScenes, suggestDirection, expandWorld, suggestWorldExpansion } from '@/lib/ai';
import { resolveEntry, type NarrativeState, type WorldBuildCommit } from '@/types/narrative';
import { nextId } from '@/lib/narrative-utils';

type Mode = 'continuation' | 'world';

/** Build a human-readable seed from a world build entry for injecting into the direction prompt */
function buildWorldBuildSeed(narrative: NarrativeState, wb: WorldBuildCommit): string {
  const parts: string[] = [`Incorporate elements from world build "${wb.summary}":`];

  for (const cid of wb.expansionManifest.characterIds) {
    const c = narrative.characters[cid];
    if (c) parts.push(`- Character: ${c.name} (${c.role})`);
  }
  for (const lid of wb.expansionManifest.locationIds) {
    const l = narrative.locations[lid];
    if (l) parts.push(`- Location: ${l.name}`);
  }
  for (const tid of wb.expansionManifest.threadIds) {
    const t = narrative.threads[tid];
    if (t) parts.push(`- Thread: ${t.description} [${t.status}]`);
  }

  return parts.join('\n');
}

function SkeletonLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-text-primary">{label}&hellip;</h2>
      <div className="flex flex-col gap-3">
        <div className="h-3 w-3/4 bg-white/6 rounded animate-pulse" />
        <div className="h-3 w-1/2 bg-white/6 rounded animate-pulse" />
        <div className="h-3 w-5/6 bg-white/6 rounded animate-pulse" />
        <div className="h-3 w-2/3 bg-white/6 rounded animate-pulse" />
        <div className="h-3 w-3/5 bg-white/6 rounded animate-pulse" />
      </div>
    </div>
  );
}

export function GeneratePanel({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [mode, setMode] = useState<Mode>('continuation');

  // Continuation mode state
  const [newArc, setNewArc] = useState(true);
  const [arcName, setArcName] = useState('');
  const [direction, setDirection] = useState('');
  const [count, setCount] = useState(3);

  // World mode state
  const [worldDirective, setWorldDirective] = useState('');

  // Shared state
  const [loading, setLoading] = useState(false);
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

  // ── Arc mode handlers ──────────────────────────────────────────────────
  async function handleSuggestArc() {
    if (!narrative) return;
    setSuggesting(true);
    setError('');
    try {
      const suggestion = await suggestDirection(
        narrative,
        state.resolvedSceneKeys,
        headIndex,
      );
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
    if (!direction.trim() || !narrative) return;
    if (!newArc && !currentArc) return;
    setLoading(true);
    setError('');
    try {
      const existingArc = !newArc ? currentArc ?? undefined : undefined;
      const { scenes, arc } = await generateScenes(
        narrative,
        state.resolvedSceneKeys,
        headIndex,
        count,
        direction,
        existingArc,
        undefined,
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

  // ── World mode handlers ────────────────────────────────────────────────
  async function handleSuggestWorld() {
    if (!narrative) return;
    setSuggesting(true);
    setError('');
    try {
      const suggestion = await suggestWorldExpansion(
        narrative,
        state.resolvedSceneKeys,
        headIndex,
      );
      setWorldDirective(suggestion);
    } catch (err) {
      setError(String(err));
    } finally {
      setSuggesting(false);
    }
  }

  async function handleExpandWorld() {
    if (!worldDirective.trim() || !narrative) return;
    setLoading(true);
    setError('');
    try {
      const expansion = await expandWorld(
        narrative,
        state.resolvedSceneKeys,
        headIndex,
        worldDirective,
      );
      dispatch({
        type: 'EXPAND_WORLD',
        wxId: nextId('WX', Object.keys(narrative.worldBuilds), 3),
        characters: expansion.characters,
        locations: expansion.locations,
        threads: expansion.threads,
        relationships: expansion.relationships,
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
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="glass max-w-lg w-full rounded-2xl p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none"
        >
          &times;
        </button>

        <h2 className="text-sm font-semibold text-text-primary mb-1">
          Generate
        </h2>
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
          <SkeletonLoading label={mode === 'continuation' ? (newArc ? 'Generating arc' : 'Continuing arc') : 'Expanding world'} />
        ) : (
        <div className="flex flex-col gap-4">
          {mode === 'continuation' ? (
            <>
              {/* New Arc / Continue Existing toggle */}
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
                /* Arc Name (new arc only) */
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">
                    Arc Name
                  </label>
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
                /* Show which arc will be continued */
                <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2">
                  <span className="text-[10px] uppercase tracking-widest text-text-dim">Continuing</span>
                  <p className="text-sm text-text-primary">{currentArc.name}</p>
                  <p className="text-[10px] text-text-dim">{currentArc.sceneIds.length} scenes so far</p>
                </div>
              ) : (
                <p className="text-xs text-text-dim">No arc found for the current scene. Navigate to a scene within an arc to continue it.</p>
              )}

              {/* Direction */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim">
                    Direction / Focus
                  </label>
                  <button
                    type="button"
                    onClick={handleSuggestArc}
                    disabled={suggesting || loading}
                    className="text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
                  >
                    {suggesting ? 'Thinking...' : 'Suggest Arc'}
                  </button>
                </div>
                <textarea
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                  placeholder="Describe what this arc should focus on..."
                  disabled={loading}
                  className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-28 resize-none outline-none placeholder:text-text-dim disabled:opacity-50"
                />
              </div>

              {/* Scene Count */}
              <div>
                <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">
                  Scenes
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3, 5, 8].map((n) => (
                    <button
                      key={n}
                      onClick={() => setCount(n)}
                      disabled={loading}
                      className={`px-3 py-1.5 rounded text-xs transition ${
                        count === n
                          ? 'bg-white/12 text-text-primary'
                          : 'bg-white/4 text-text-dim hover:bg-white/8'
                      } disabled:opacity-50`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Advanced options */}
              <details className="group">
                <summary className="text-[10px] uppercase tracking-widest text-text-dim cursor-pointer select-none flex items-center gap-1.5 hover:text-text-secondary transition">
                  <span className="transition-transform group-open:rotate-90">&#9656;</span>
                  Advanced
                </summary>
                <div className="flex flex-col gap-4 mt-3">
                  {/* World Building Seeds */}
                  {(() => {
                    const worldBuildEntries = Object.values(narrative.worldBuilds);
                    if (worldBuildEntries.length === 0) return null;

                    return (
                      <div>
                        <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1.5">
                          Use World Building
                        </label>
                        <div className="flex flex-col gap-1 max-h-28 overflow-y-auto">
                          {worldBuildEntries.map((wb) => {
                            const manifest = wb.expansionManifest;
                            const parts: string[] = [];
                            if (manifest.characterIds.length > 0)
                              parts.push(`${manifest.characterIds.length} char${manifest.characterIds.length > 1 ? 's' : ''}`);
                            if (manifest.locationIds.length > 0)
                              parts.push(`${manifest.locationIds.length} loc${manifest.locationIds.length > 1 ? 's' : ''}`);
                            if (manifest.threadIds.length > 0)
                              parts.push(`${manifest.threadIds.length} thread${manifest.threadIds.length > 1 ? 's' : ''}`);

                            const seedText = buildWorldBuildSeed(narrative, wb);

                            return (
                              <button
                                key={wb.id}
                                type="button"
                                onClick={() => {
                                  setDirection((prev) =>
                                    prev ? `${prev}\n\n${seedText}` : seedText,
                                  );
                                }}
                                disabled={loading}
                                className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-left hover:border-white/16 transition disabled:opacity-50"
                              >
                                <p className="text-xs text-text-primary line-clamp-1">{wb.summary}</p>
                                <p className="text-[10px] text-text-dim mt-0.5">
                                  {wb.id} &middot; {parts.join(', ')}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[9px] text-text-dim mt-1">Click to inject into direction above</p>
                      </div>
                    );
                  })()}
                </div>
              </details>

              <button
                onClick={handleGenerateArc}
                disabled={loading || !direction.trim() || (!newArc && !currentArc)}
                className="bg-white/10 hover:bg-white/16 text-text-primary font-semibold px-4 py-2.5 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none"
              >
                {loading ? 'Generating...' : newArc ? `Generate Arc (${count} scene${count > 1 ? 's' : ''})` : `Continue Arc (${count} scene${count > 1 ? 's' : ''})`}
              </button>
            </>
          ) : (
            <>
              {/* World Directive */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] uppercase tracking-widest text-text-dim">
                    Directive
                  </label>
                  <button
                    type="button"
                    onClick={handleSuggestWorld}
                    disabled={suggesting || loading}
                    className="text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
                  >
                    {suggesting ? 'Thinking...' : 'Suggest'}
                  </button>
                </div>
                <textarea
                  value={worldDirective}
                  onChange={(e) => setWorldDirective(e.target.value)}
                  placeholder="Describe what to add to the world — new characters, locations, threads, factions..."
                  disabled={loading}
                  className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-28 resize-none outline-none placeholder:text-text-dim disabled:opacity-50"
                />
              </div>

              {/* Summary of what will be generated */}
              <p className="text-[10px] text-text-dim leading-relaxed">
                Generates new characters, locations, threads, and relationships that merge into your existing world.
              </p>

              <button
                onClick={handleExpandWorld}
                disabled={loading || !worldDirective.trim()}
                className="bg-white/10 hover:bg-white/16 text-text-primary font-semibold px-4 py-2.5 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none"
              >
                {loading ? 'Expanding...' : 'Expand World'}
              </button>
            </>
          )}

          {error && (
            <div className="bg-stakes/10 border border-stakes/30 rounded-lg px-3 py-2">
              <p className="text-sm text-stakes font-medium">Generation failed</p>
              <p className="text-xs text-stakes/80 mt-1">{error}</p>
            </div>
          )}

        </div>
        )}
      </div>
    </div>
  );
}
