'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { generateNarrative } from '@/lib/ai';
import { logApiCall, updateApiLog } from '@/lib/api-logger';
import { DEFAULT_MODEL } from '@/lib/constants';
import type { CharacterSketch, LocationSketch, ThreadSketch, WorldSystemSketch } from '@/types/narrative';

const ROLES: CharacterSketch['role'][] = ['anchor', 'recurring', 'transient'];

export function CreationWizard() {
  const router = useRouter();
  const { state, dispatch } = useStore();
  const wd = state.wizardData;
  const isGenerating = state.wizardStep === 'generate';
  const isDetails = state.wizardStep === 'details';

  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState('');
  const [ruleDraft, setRuleDraft] = useState('');
  const [addingRule, setAddingRule] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const started = useRef(false);

  const isDuplicate =
    wd.title.trim() !== '' &&
    state.narratives.some(
      (n) => n.title.toLowerCase() === wd.title.trim().toLowerCase(),
    );

  const canGenerate = !!wd.title.trim() && !!wd.premise.trim() && !isDuplicate;

  function update(data: Partial<typeof wd>) {
    dispatch({ type: 'UPDATE_WIZARD_DATA', data });
  }

  // ── Characters ───────────────────────────────────────────────────────
  function addCharacter() {
    update({ characters: [...wd.characters, { name: '', role: 'recurring', description: '' }] });
  }
  function updateCharacter(i: number, patch: Partial<CharacterSketch>) {
    const chars = [...wd.characters];
    chars[i] = { ...chars[i], ...patch };
    update({ characters: chars });
  }
  function removeCharacter(i: number) {
    update({ characters: wd.characters.filter((_, idx) => idx !== i) });
  }

  // ── Locations ────────────────────────────────────────────────────────
  function addLocation() {
    update({ locations: [...wd.locations, { name: '', description: '' }] });
  }
  function updateLocation(i: number, patch: Partial<LocationSketch>) {
    const locs = [...wd.locations];
    locs[i] = { ...locs[i], ...patch };
    update({ locations: locs });
  }
  function removeLocation(i: number) {
    update({ locations: wd.locations.filter((_, idx) => idx !== i) });
  }

  // ── Threads ─────────────────────────────────────────────────────────
  function addThread() {
    update({ threads: [...wd.threads, { description: '', participantNames: [] }] });
  }
  function updateThread(i: number, patch: Partial<ThreadSketch>) {
    const t = [...wd.threads];
    t[i] = { ...t[i], ...patch };
    update({ threads: t });
  }
  function removeThread(i: number) {
    update({ threads: wd.threads.filter((_, idx) => idx !== i) });
  }

  // ── Rules ────────────────────────────────────────────────────────────
  function addRule() {
    const text = ruleDraft.trim();
    if (!text) return;
    update({ rules: [...wd.rules, text] });
    setRuleDraft('');
    setAddingRule(false);
  }
  function removeRule(i: number) {
    update({ rules: wd.rules.filter((_, idx) => idx !== i) });
  }

  // ── World Systems ──────────────────────────────────────────────────
  const [addingSystem, setAddingSystem] = useState(false);
  const [systemDraft, setSystemDraft] = useState({ name: '', description: '' });
  const [expandedSystem, setExpandedSystem] = useState<number | null>(null);
  const [sysPropDrafts, setSysPropDrafts] = useState<Record<number, Record<string, string>>>({});

  function addSystem() {
    if (!systemDraft.name.trim()) return;
    const sys: WorldSystemSketch = { name: systemDraft.name.trim(), description: systemDraft.description.trim(), principles: [], constraints: [], interactions: [] };
    update({ worldSystems: [...wd.worldSystems, sys] });
    setSystemDraft({ name: '', description: '' });
    setAddingSystem(false);
    setExpandedSystem(wd.worldSystems.length);
  }
  function removeSystem(i: number) {
    update({ worldSystems: wd.worldSystems.filter((_, idx) => idx !== i) });
    if (expandedSystem === i) setExpandedSystem(null);
  }
  function addSysProp(i: number, field: 'principles' | 'constraints' | 'interactions') {
    const text = sysPropDrafts[i]?.[field]?.trim();
    if (!text) return;
    const sys = { ...wd.worldSystems[i], [field]: [...wd.worldSystems[i][field], text] };
    const systems = [...wd.worldSystems];
    systems[i] = sys;
    update({ worldSystems: systems });
    setSysPropDrafts(prev => ({ ...prev, [i]: { ...prev[i], [field]: '' } }));
  }
  function removeSysProp(i: number, field: 'principles' | 'constraints' | 'interactions', j: number) {
    const sys = { ...wd.worldSystems[i], [field]: wd.worldSystems[i][field].filter((_: string, idx: number) => idx !== j) };
    const systems = [...wd.worldSystems];
    systems[i] = sys;
    update({ worldSystems: systems });
  }
  function getSysDraft(i: number, field: string) { return sysPropDrafts[i]?.[field] ?? ''; }
  function setSysDraft(i: number, field: string, value: string) { setSysPropDrafts(prev => ({ ...prev, [i]: { ...prev[i], [field]: value } })); }

  // ── Suggest ──────────────────────────────────────────────────────────
  async function handleSuggest() {
    if (suggesting) return;
    setSuggesting(true);
    const logId = logApiCall('CreationWizard.suggest', 0, 'suggest-premise', DEFAULT_MODEL);
    const start = performance.now();
    try {
      const res = await fetch('/api/suggest-premise', { method: 'POST' });
      const data = await res.json();
      const content = JSON.stringify(data);
      updateApiLog(logId, { status: 'success', durationMs: Math.round(performance.now() - start), responseLength: content.length, responsePreview: content });
      if (data.title || data.premise) {
        update({ title: data.title ?? '', premise: data.premise ?? '' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
    } finally {
      setSuggesting(false);
    }
  }

  // ── Generate ─────────────────────────────────────────────────────────
  function buildEnhancedPremise() {
    const parts: string[] = [wd.premise];
    const details: string[] = [];

    if (wd.characters.length > 0) {
      const charLines = wd.characters
        .filter((c) => c.name.trim())
        .map((c) => `  - ${c.name} (${c.role})${c.description ? `: ${c.description}` : ''}`);
      if (charLines.length > 0) {
        details.push(`Key characters:\n${charLines.join('\n')}`);
      }
    }

    if (wd.locations.length > 0) {
      const locLines = wd.locations
        .filter((l) => l.name.trim())
        .map((l) => `  - ${l.name}${l.description ? `: ${l.description}` : ''}`);
      if (locLines.length > 0) {
        details.push(`Key locations:\n${locLines.join('\n')}`);
      }
    }

    if (wd.threads.length > 0) {
      const threadLines = wd.threads
        .filter((t) => t.description.trim())
        .map((t) => `  - ${t.description}${t.participantNames.length > 0 ? ` (involves: ${t.participantNames.join(', ')})` : ''}`);
      if (threadLines.length > 0) {
        details.push(`Narrative threads:\n${threadLines.join('\n')}`);
      }
    }

    if (wd.rules.length > 0) {
      details.push(`World rules (absolute constraints the narrative must obey):\n${wd.rules.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}`);
    }

    if (wd.worldSystems.length > 0) {
      details.push(`World systems:\n${wd.worldSystems.map(s => {
        const lines = [`  - ${s.name}: ${s.description}`];
        if (s.principles.length) lines.push(`    Principles: ${s.principles.join('; ')}`);
        if (s.constraints.length) lines.push(`    Constraints: ${s.constraints.join('; ')}`);
        if (s.interactions.length) lines.push(`    Interactions: ${s.interactions.join('; ')}`);
        return lines.join('\n');
      }).join('\n')}`);
    }

    if (details.length > 0) {
      parts.push('', ...details);
    }

    return parts.join('\n');
  }

  async function handleGenerate() {
    if (loading) return;
    setLoading(true);
    setStreamText('');
    setError('');
    try {
      const narrative = await generateNarrative(
        wd.title, buildEnhancedPremise(), wd.rules, wd.worldSystems,
        undefined,
        (reasoning) => setStreamText((prev) => prev + reasoning),
      );
      dispatch({ type: 'ADD_NARRATIVE', narrative });
      router.push(`/series/${narrative.id}`);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  }

  // Auto-start generation when stepping to generate
  useEffect(() => {
    if (isGenerating && !started.current) {
      started.current = true;
      handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating]);

  if (!state.wizardOpen) return null;

  // ── Generate view ────────────────────────────────────────────────────
  if (isGenerating) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
        <div className="glass max-w-2xl w-full rounded-2xl p-6 relative">
          <div className="flex flex-col gap-5">
            {loading ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <h2 className="text-sm font-semibold text-text-primary">Generating world&hellip;</h2>
                </div>
                {streamText ? (
                  <pre className="text-[11px] text-text-dim font-mono whitespace-pre-wrap max-h-72 overflow-y-auto bg-white/3 rounded-lg p-3 leading-relaxed">
                    {streamText}
                  </pre>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="h-3 w-3/4 bg-white/6 rounded animate-pulse" />
                    <div className="h-3 w-1/2 bg-white/6 rounded animate-pulse" />
                    <div className="h-3 w-5/6 bg-white/6 rounded animate-pulse" />
                  </div>
                )}
              </div>
            ) : (
              <h2 className="text-sm font-semibold text-text-primary">Generation failed</h2>
            )}

            {error && (
              <div className="bg-payoff/10 border border-payoff/30 rounded-lg px-3 py-2">
                <p className="text-xs text-payoff/80 mt-1">{error}</p>
              </div>
            )}

            <div className="flex items-center justify-between mt-1">
              <button
                onClick={() => {
                  started.current = false;
                  dispatch({ type: 'SET_WIZARD_STEP', step: 'form' });
                }}
                disabled={loading}
                className="text-text-dim text-xs hover:text-text-secondary transition disabled:opacity-30 disabled:pointer-events-none"
              >
                &larr; Back
              </button>
              {error && (
                <button
                  onClick={handleGenerate}
                  className="bg-white/8 hover:bg-white/12 text-text-primary text-xs font-semibold px-5 py-2 rounded-lg transition"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }


  // ── Step 2: Details view ───────────────────────────────────────────
  if (isDetails) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
        <div className="glass max-w-2xl w-full rounded-2xl p-6 relative">
          <button
            onClick={() => dispatch({ type: 'CLOSE_WIZARD' })}
            className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none"
          >
            &times;
          </button>

          <div className="flex flex-col gap-5 max-h-[75vh] overflow-y-auto pr-1">
            {/* Header */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono text-text-dim">Step 2 of 2</span>
              </div>
              <h2 className="text-sm font-semibold text-text-primary mb-1">Details (Optional)</h2>
              <p className="text-[11px] text-text-dim">
                Add characters, locations, threads, rules, or systems — or skip and let the AI fill in everything.
              </p>
            </div>

            {/* Character Sketches */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">Characters</label>
                <button type="button" onClick={addCharacter} className="text-[10px] text-text-dim hover:text-text-secondary transition">+ Add</button>
              </div>
              {wd.characters.length === 0 && (
                <p className="text-[11px] text-text-dim/60 italic">No characters defined — the AI will create them from the premise.</p>
              )}
              <div className="flex flex-col gap-2">
                {wd.characters.map((ch, i) => (
                  <div key={i} className="flex gap-2 items-start bg-bg-elevated rounded-lg p-2.5 border border-border">
                    <div className="flex-1 flex flex-col gap-1.5">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={ch.name}
                          onChange={(e) => updateCharacter(i, { name: e.target.value })}
                          placeholder="Name"
                          className="flex-1 bg-transparent border-b border-border text-xs text-text-primary outline-none placeholder:text-text-dim focus:border-white/20 transition pb-0.5"
                        />
                        <select
                          value={ch.role}
                          onChange={(e) => updateCharacter(i, { role: e.target.value as CharacterSketch['role'] })}
                          className="bg-transparent border-b border-border text-[10px] text-text-dim outline-none pb-0.5"
                        >
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <input
                        type="text"
                        value={ch.description}
                        onChange={(e) => updateCharacter(i, { description: e.target.value })}
                        placeholder="Brief description, goals, or traits..."
                        className="bg-transparent border-b border-border text-[10px] text-text-dim outline-none placeholder:text-text-dim/60 focus:border-white/20 transition pb-0.5"
                      />
                    </div>
                    <button type="button" onClick={() => removeCharacter(i)} className="text-text-dim hover:text-text-secondary text-xs mt-0.5">&times;</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Location Sketches */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">Locations</label>
                <button type="button" onClick={addLocation} className="text-[10px] text-text-dim hover:text-text-secondary transition">+ Add</button>
              </div>
              {wd.locations.length === 0 && (
                <p className="text-[11px] text-text-dim/60 italic">No locations defined — the AI will create them from the premise.</p>
              )}
              <div className="flex flex-col gap-2">
                {wd.locations.map((loc, i) => (
                  <div key={i} className="flex gap-2 items-start bg-bg-elevated rounded-lg p-2.5 border border-border">
                    <div className="flex-1 flex flex-col gap-1.5">
                      <input
                        type="text"
                        value={loc.name}
                        onChange={(e) => updateLocation(i, { name: e.target.value })}
                        placeholder="Location name"
                        className="flex-1 bg-transparent border-b border-border text-xs text-text-primary outline-none placeholder:text-text-dim focus:border-white/20 transition pb-0.5"
                      />
                      <input
                        type="text"
                        value={loc.description}
                        onChange={(e) => updateLocation(i, { description: e.target.value })}
                        placeholder="Description, atmosphere, significance..."
                        className="bg-transparent border-b border-border text-[10px] text-text-dim outline-none placeholder:text-text-dim/60 focus:border-white/20 transition pb-0.5"
                      />
                    </div>
                    <button type="button" onClick={() => removeLocation(i)} className="text-text-dim hover:text-text-secondary text-xs mt-0.5">&times;</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Threads */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">Threads</label>
                <button type="button" onClick={addThread} className="text-[10px] text-text-dim hover:text-text-secondary transition">+ Add</button>
              </div>
              {wd.threads.length === 0 && (
                <p className="text-[11px] text-text-dim/60 italic">No threads defined — the AI will generate narrative tensions from the premise.</p>
              )}
              <div className="flex flex-col gap-2">
                {wd.threads.map((th, i) => (
                  <div key={i} className="flex gap-2 items-start bg-bg-elevated rounded-lg p-2.5 border border-border">
                    <div className="flex-1 flex flex-col gap-1.5">
                      <input
                        type="text"
                        value={th.description}
                        onChange={(e) => updateThread(i, { description: e.target.value })}
                        placeholder="Describe the tension, conflict, or open question..."
                        className="flex-1 bg-transparent border-b border-border text-xs text-text-primary outline-none placeholder:text-text-dim focus:border-white/20 transition pb-0.5"
                      />
                      <input
                        type="text"
                        value={th.participantNames.join(', ')}
                        onChange={(e) => updateThread(i, { participantNames: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                        placeholder="Participants (comma-separated names)..."
                        className="bg-transparent border-b border-border text-[10px] text-text-dim outline-none placeholder:text-text-dim/60 focus:border-white/20 transition pb-0.5"
                      />
                    </div>
                    <button type="button" onClick={() => removeThread(i)} className="text-text-dim hover:text-text-secondary text-xs mt-0.5">&times;</button>
                  </div>
                ))}
              </div>
            </div>

            {/* World Rules */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">Rules</label>
                <button type="button" onClick={() => { setAddingRule(true); setRuleDraft(''); }} className="text-[10px] text-text-dim hover:text-text-secondary transition">+ Add</button>
              </div>
              {wd.rules.length === 0 && !addingRule && (
                <p className="text-[11px] text-text-dim/60 italic">No rules defined — the AI will generate rules from the premise.</p>
              )}
              <div className="flex flex-col gap-2">
                {wd.rules.map((rule, i) => (
                  <div key={i} className="flex gap-2 items-start bg-bg-elevated rounded-lg p-2.5 border border-border">
                    <span className="text-[10px] font-mono text-text-dim mt-0.5 shrink-0 w-4 text-right">{i + 1}.</span>
                    <p className="text-xs text-text-secondary leading-relaxed flex-1">{rule}</p>
                    <button type="button" onClick={() => removeRule(i)} className="text-text-dim hover:text-text-secondary text-xs mt-0.5">&times;</button>
                  </div>
                ))}
                {addingRule && (
                  <div className="flex gap-2 items-center bg-bg-elevated rounded-lg p-2.5 border border-border">
                    <input
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                      type="text"
                      value={ruleDraft}
                      onChange={(e) => setRuleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); addRule(); }
                        if (e.key === 'Escape') { setAddingRule(false); setRuleDraft(''); }
                      }}
                      placeholder="Describe the rule..."
                      className="flex-1 bg-transparent border-b border-border text-xs text-text-primary outline-none placeholder:text-text-dim focus:border-white/20 transition pb-0.5"
                    />
                    <button type="button" onClick={addRule} disabled={!ruleDraft.trim()} className="text-[10px] text-text-dim hover:text-text-secondary disabled:opacity-30 transition shrink-0">Add</button>
                    <button type="button" onClick={() => { setAddingRule(false); setRuleDraft(''); }} className="text-text-dim hover:text-text-secondary text-xs">&times;</button>
                  </div>
                )}
              </div>
            </div>

            {/* World Systems */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">Systems</label>
                <button type="button" onClick={() => { setAddingSystem(true); setSystemDraft({ name: '', description: '' }); }} className="text-[10px] text-text-dim hover:text-text-secondary transition">+ Add</button>
              </div>
              {wd.worldSystems.length === 0 && !addingSystem && (
                <p className="text-[11px] text-text-dim/60 italic">No systems defined — the AI will generate systems from the premise.</p>
              )}
              <div className="flex flex-col gap-2">
                {wd.worldSystems.map((sys, i) => {
                  const isExpanded = expandedSystem === i;
                  const entryCount = sys.principles.length + sys.constraints.length + sys.interactions.length;
                  return (
                    <div key={i} className="bg-bg-elevated rounded-lg border border-border overflow-hidden">
                      <div className="flex gap-2 items-center p-2.5 cursor-pointer" onClick={() => setExpandedSystem(isExpanded ? null : i)}>
                        <span className="text-[10px] text-text-dim">{isExpanded ? '▾' : '▸'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-text-primary">{sys.name}</p>
                          {sys.description && <p className="text-[10px] text-text-dim truncate">{sys.description}</p>}
                        </div>
                        {!isExpanded && entryCount > 0 && <span className="text-[10px] text-text-dim">{entryCount}</span>}
                        <button type="button" onClick={(e) => { e.stopPropagation(); removeSystem(i); }} className="text-text-dim hover:text-text-secondary text-xs">&times;</button>
                      </div>
                      {isExpanded && (
                        <div className="px-2.5 pb-2.5 space-y-2 border-t border-border/50">
                          {(['principles', 'constraints', 'interactions'] as const).map(field => (
                            <div key={field} className="pt-1.5">
                              <label className="text-[9px] uppercase tracking-wider text-text-dim/60 font-mono mb-0.5 block">
                                {field === 'principles' ? 'Principles' : field === 'constraints' ? 'Constraints' : 'Interactions'}
                              </label>
                              {sys[field].map((item: string, j: number) => (
                                <div key={j} className="flex items-start gap-1 group">
                                  <span className="text-[9px] text-text-dim mt-0.5">•</span>
                                  <span className="text-[11px] text-text-secondary leading-snug flex-1">{item}</span>
                                  <button type="button" onClick={() => removeSysProp(i, field, j)} className="text-[9px] text-red-400/40 hover:text-red-400 opacity-0 group-hover:opacity-100 transition">&times;</button>
                                </div>
                              ))}
                              <div className="flex gap-1 mt-0.5">
                                <input
                                  type="text"
                                  value={getSysDraft(i, field)}
                                  onChange={(e) => setSysDraft(i, field, e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSysProp(i, field); } }}
                                  placeholder={field === 'principles' ? 'How it works...' : field === 'constraints' ? 'Hard limits...' : 'Cross-system connections...'}
                                  className="flex-1 bg-transparent border-b border-border/50 text-[10px] text-text-primary outline-none placeholder:text-text-dim/40 focus:border-white/15 transition pb-0.5"
                                />
                                <button type="button" onClick={() => addSysProp(i, field)} disabled={!getSysDraft(i, field).trim()} className="text-[9px] text-text-dim hover:text-text-secondary disabled:opacity-20 transition">+</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {addingSystem && (
                  <div className="bg-bg-elevated rounded-lg p-2.5 border border-border space-y-2">
                    <input
                      autoFocus
                      type="text"
                      value={systemDraft.name}
                      onChange={(e) => setSystemDraft(prev => ({ ...prev, name: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); addSystem(); }
                        if (e.key === 'Escape') { setAddingSystem(false); }
                      }}
                      placeholder="System name..."
                      className="w-full bg-transparent border-b border-border text-xs text-text-primary outline-none placeholder:text-text-dim focus:border-white/20 transition pb-0.5"
                    />
                    <input
                      type="text"
                      value={systemDraft.description}
                      onChange={(e) => setSystemDraft(prev => ({ ...prev, description: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); addSystem(); }
                        if (e.key === 'Escape') { setAddingSystem(false); }
                      }}
                      placeholder="One-line description..."
                      className="w-full bg-transparent border-b border-border text-[10px] text-text-dim outline-none placeholder:text-text-dim/40 focus:border-white/20 transition pb-0.5"
                    />
                    <div className="flex gap-2">
                      <button type="button" onClick={addSystem} disabled={!systemDraft.name.trim()} className="text-[10px] text-text-dim hover:text-text-secondary disabled:opacity-30 transition">Add</button>
                      <button type="button" onClick={() => setAddingSystem(false)} className="text-text-dim hover:text-text-secondary text-xs">&times;</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => dispatch({ type: 'SET_WIZARD_STEP', step: 'form' })}
                className="text-text-dim text-xs hover:text-text-secondary transition"
              >
                &larr; Back
              </button>
              <button
                onClick={() => dispatch({ type: 'SET_WIZARD_STEP', step: 'generate' })}
                className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-semibold px-5 py-2 rounded-lg transition"
              >
                Generate
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 1: Title & Premise ────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="glass max-w-2xl w-full rounded-2xl p-6 relative">
        <button
          onClick={() => dispatch({ type: 'CLOSE_WIZARD' })}
          className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none"
        >
          &times;
        </button>

        <div className="flex flex-col gap-5 max-h-[75vh] overflow-y-auto pr-1">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono text-text-dim">Step 1 of 2</span>
            </div>
            <h2 className="text-sm font-semibold text-text-primary mb-1">New Series</h2>
            <p className="text-[11px] text-text-dim">
              Give your series a title and describe the premise.
            </p>
          </div>

          {/* Title */}
          <div>
            <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">
              Title
            </label>
            <input
              type="text"
              value={wd.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="e.g. The Gilded Cage"
              className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full outline-none placeholder:text-text-dim focus:border-white/16 transition"
            />
            {isDuplicate && (
              <p className="text-[11px] text-payoff mt-1">A series with this name already exists.</p>
            )}
          </div>

          {/* Premise */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim font-mono">
                Premise
              </label>
              <button
                type="button"
                onClick={handleSuggest}
                disabled={suggesting}
                className="text-[10px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-30 uppercase tracking-wider"
              >
                {suggesting ? 'Thinking...' : 'Suggest'}
              </button>
            </div>
            <textarea
              value={wd.premise}
              onChange={(e) => update({ premise: e.target.value })}
              placeholder="Describe your world, characters, and the central conflict..."
              className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full h-28 resize-none outline-none placeholder:text-text-dim focus:border-white/16 transition"
            />
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => dispatch({ type: 'SET_WIZARD_STEP', step: 'details' })}
              disabled={!canGenerate}
              className="text-text-dim text-xs hover:text-text-secondary transition disabled:opacity-30 disabled:pointer-events-none"
            >
              Add details &rarr;
            </button>
            <button
              onClick={() => dispatch({ type: 'SET_WIZARD_STEP', step: 'generate' })}
              disabled={!canGenerate}
              className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-semibold px-5 py-2 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none"
            >
              Generate
            </button>
          </div>

          {/* Premise builder nudge */}
          {!wd.premise.trim() && (
            <button
              onClick={() => {
                dispatch({ type: 'CLOSE_WIZARD' });
                router.push('/discover');
              }}
              className="flex items-center gap-3 w-full rounded-lg border border-dashed border-white/8 hover:border-white/16 px-4 py-3 transition group"
            >
              <svg className="w-4 h-4 text-white/20 group-hover:text-white/40 transition shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <div className="text-left">
                <p className="text-[11px] text-white/50 group-hover:text-white/70 transition font-medium">Not sure where to start?</p>
                <p className="text-[10px] text-white/25 group-hover:text-white/35 transition">Answer a few questions to discover and refine your world first.</p>
              </div>
              <svg className="w-3.5 h-3.5 text-white/15 group-hover:text-white/35 transition ml-auto shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
