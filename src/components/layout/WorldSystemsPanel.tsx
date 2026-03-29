'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import type { WorldSystem } from '@/types/narrative';
import { ingestSystems } from '@/lib/ai/ingest';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';

type Props = { onClose: () => void };

function Skeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2 py-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border border-white/6 rounded-lg p-3 animate-pulse space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-3.5 rounded bg-white/5" style={{ width: `${30 + Math.random() * 20}%` }} />
            <div className="h-2.5 rounded bg-white/3 flex-1" />
          </div>
          <div className="space-y-1.5 pl-0.5">
            <div className="h-2.5 rounded bg-white/3" style={{ width: `${60 + Math.random() * 30}%` }} />
            <div className="h-2.5 rounded bg-white/3" style={{ width: `${50 + Math.random() * 30}%` }} />
          </div>
        </div>
      ))}
      <p className="text-[10px] text-text-dim/40 text-center pt-1">Extracting systems from text...</p>
    </div>
  );
}

let _nextId = 1;
function localId() { return `ws_${Date.now()}_${_nextId++}`; }

function emptySystem(): WorldSystem {
  return { id: localId(), name: '', description: '', principles: [], constraints: [], interactions: [] };
}

type ListFieldKey = 'principles' | 'constraints' | 'interactions';
const LIST_FIELDS: { key: ListFieldKey; label: string; placeholder: string }[] = [
  { key: 'principles', label: 'Principles', placeholder: 'How this system works...' },
  { key: 'constraints', label: 'Constraints', placeholder: 'Hard limits, costs, scarcity rules...' },
  { key: 'interactions', label: 'Interactions', placeholder: 'How this connects to other systems...' },
];

export default function WorldSystemsPanel({ onClose }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [systems, setSystems] = useState<WorldSystem[]>(narrative?.worldSystems ?? []);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [tab, setTab] = useState<'list' | 'ingest'>('list');
  const [ingestText, setIngestText] = useState('');
  const [ingesting, setIngesting] = useState(false);

  async function handleIngest() {
    if (!ingestText.trim() || ingesting) return;
    setIngesting(true);
    try {
      const newSystems = await ingestSystems(ingestText, systems);
      setSystems((prev) => [...prev, ...newSystems]);
      setIngestText('');
      setTab('list');
    } catch {
      // user can retry
    } finally {
      setIngesting(false);
    }
  }

  function addSystem() {
    const sys = emptySystem();
    setSystems((prev) => [...prev, sys]);
    setExpandedId(sys.id);
  }

  function removeSystem(id: string) {
    setSystems((prev) => prev.filter((s) => s.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  function updateSystem(id: string, updates: Partial<WorldSystem>) {
    setSystems((prev) => prev.map((s) => s.id === id ? { ...s, ...updates } : s));
  }

  function addListItem(systemId: string, field: ListFieldKey) {
    const draft = drafts[systemId]?.[field]?.trim();
    if (!draft) return;
    setSystems((prev) => prev.map((s) =>
      s.id === systemId ? { ...s, [field]: [...s[field], draft] } : s
    ));
    setDrafts((prev) => ({ ...prev, [systemId]: { ...prev[systemId], [field]: '' } }));
  }

  function removeListItem(systemId: string, field: ListFieldKey, index: number) {
    setSystems((prev) => prev.map((s) =>
      s.id === systemId ? { ...s, [field]: s[field].filter((_: string, i: number) => i !== index) } : s
    ));
  }

  function getDraft(systemId: string, field: string) {
    return drafts[systemId]?.[field] ?? '';
  }

  function setDraft(systemId: string, field: string, value: string) {
    setDrafts((prev) => ({ ...prev, [systemId]: { ...prev[systemId], [field]: value } }));
  }

  function handleSave() {
    const valid = systems.filter((s) => s.name.trim());
    dispatch({ type: 'SET_WORLD_SYSTEMS', systems: valid });
    onClose();
  }

  const totalSystems = systems.filter((s) => s.name.trim()).length;
  const totalEntries = systems.reduce((sum, s) => sum + s.principles.length + s.constraints.length + s.interactions.length, 0);

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="85vh">
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Systems</h2>
            <p className="text-[10px] text-text-dim uppercase tracking-wider">Structured mechanics that define how this world works</p>
          </div>
          {totalSystems > 0 && (
            <span className="text-[10px] text-text-dim/50 ml-auto mr-6">{totalSystems} system{totalSystems !== 1 ? 's' : ''} &middot; {totalEntries} entries</span>
          )}
        </div>
      </ModalHeader>
      <ModalBody className="p-6 space-y-4">
        {/* Tabs */}
        <div className="flex gap-1 bg-bg-elevated rounded-lg p-0.5 shrink-0">
          <button onClick={() => setTab('list')} className={`flex-1 text-[11px] py-1.5 rounded-md transition-colors ${tab === 'list' ? 'bg-white/10 text-text-primary font-semibold' : 'text-text-dim hover:text-text-secondary'}`}>
            Systems
          </button>
          <button onClick={() => setTab('ingest')} className={`flex-1 text-[11px] py-1.5 rounded-md transition-colors ${tab === 'ingest' ? 'bg-white/10 text-text-primary font-semibold' : 'text-text-dim hover:text-text-secondary'}`}>
            Import
          </button>
        </div>

        {tab === 'list' && (
            <div className="space-y-2">
              {systems.length === 0 ? (
                <p className="text-[11px] text-text-dim/50 italic py-6 text-center">No systems defined yet</p>
              ) : systems.map((sys) => {
                const isExpanded = expandedId === sys.id;
                const entryCount = sys.principles.length + sys.constraints.length + sys.interactions.length;
                return (
                  <div key={sys.id} className="border border-white/6 rounded-lg overflow-hidden">
                    {/* Header */}
                    <div
                      className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-white/3 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : sys.id)}
                    >
                      <span className="text-[10px] text-text-dim/50">{isExpanded ? '▾' : '▸'}</span>
                      <div className="flex-1 min-w-0">
                        {isExpanded ? (
                          <input
                            type="text"
                            value={sys.name}
                            onChange={(e) => updateSystem(sys.id, { name: e.target.value })}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="System name..."
                            className="w-full bg-transparent text-[12px] font-medium text-text-primary placeholder:text-text-dim/40 focus:outline-none"
                            autoFocus={!sys.name}
                          />
                        ) : (
                          <div className="flex items-baseline gap-2">
                            <span className="text-[12px] font-medium text-text-primary">{sys.name || <span className="italic text-text-dim/40">Unnamed</span>}</span>
                            {sys.description && (
                              <span className="text-[10px] text-text-dim/50 truncate">{sys.description}</span>
                            )}
                          </div>
                        )}
                      </div>
                      {!isExpanded && entryCount > 0 && (
                        <span className="text-[9px] text-text-dim/40 bg-white/5 rounded px-1.5 py-0.5">{entryCount}</span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeSystem(sys.id); }}
                        className="text-[10px] text-red-400/30 hover:text-red-400 transition-colors shrink-0"
                      >
                        &times;
                      </button>
                    </div>

                    {/* Expanded */}
                    {isExpanded && (
                      <div className="px-3 pb-3 space-y-3 border-t border-white/5">
                        {/* Description */}
                        <div className="pt-2.5">
                          <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-1.5">Description</label>
                          <input
                            type="text"
                            value={sys.description}
                            onChange={(e) => updateSystem(sys.id, { description: e.target.value })}
                            placeholder="One-line summary..."
                            className="w-full bg-bg-elevated border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-white/20 transition-colors"
                          />
                        </div>

                        {/* Principles / Constraints / Interactions */}
                        {LIST_FIELDS.map(({ key, label, placeholder }) => (
                          <div key={key}>
                            <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-1.5">{label}</label>
                            {sys[key].length > 0 && (
                              <div className="space-y-0.5 mb-1.5">
                                {sys[key].map((item: string, i: number) => (
                                  <div key={i} className="flex items-start gap-2 group py-0.5">
                                    <span className="text-[9px] text-text-dim/40 mt-0.5 shrink-0">•</span>
                                    <span className="text-[11px] text-text-secondary leading-relaxed flex-1">{item}</span>
                                    <button
                                      onClick={() => removeListItem(sys.id, key, i)}
                                      className="text-[9px] text-red-400/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition shrink-0 mt-0.5"
                                    >
                                      &times;
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                value={getDraft(sys.id, key)}
                                onChange={(e) => setDraft(sys.id, key, e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addListItem(sys.id, key); } }}
                                placeholder={placeholder}
                                className="flex-1 bg-bg-elevated border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-white/20 transition-colors"
                              />
                              <button
                                onClick={() => addListItem(sys.id, key)}
                                disabled={!getDraft(sys.id, key).trim()}
                                className="text-[10px] px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-text-dim hover:text-text-secondary disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add system button */}
              <button
                onClick={addSystem}
                className="w-full py-2.5 rounded-lg border border-dashed border-white/10 text-[11px] text-text-dim hover:text-text-secondary hover:border-white/20 transition-colors"
              >
                + Add System
              </button>
            </div>
          )}

        {tab === 'ingest' && (
          <div className="space-y-3">
            <p className="text-[11px] text-text-dim leading-relaxed">
              Paste an outline, wiki page, or analysis from another AI. Systems will be extracted with principles, constraints, and interactions.
            </p>
            {ingesting ? (
              <Skeleton count={3} />
            ) : (
              <>
                <textarea
                  value={ingestText}
                  onChange={(e) => setIngestText(e.target.value)}
                  rows={10}
                  placeholder="Paste text here..."
                  className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2.5 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-white/20 transition-colors resize-none"
                />
                <div className="flex justify-end">
                  <button
                    onClick={handleIngest}
                    disabled={!ingestText.trim()}
                    className="text-[10px] px-4 py-1.5 rounded-md bg-white/5 border border-white/10 text-text-secondary hover:text-text-primary hover:border-white/20 disabled:opacity-25 disabled:cursor-not-allowed transition-colors font-medium"
                  >
                    Extract Systems
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <button onClick={onClose} className="text-[10px] px-3 py-1.5 rounded-md bg-white/5 text-text-dim hover:text-text-secondary transition-colors">
          Cancel
        </button>
        <button onClick={handleSave} className="text-[10px] px-4 py-1.5 rounded-md bg-accent/20 text-accent hover:bg-accent/30 transition-colors font-semibold">
          Save
        </button>
      </ModalFooter>
    </Modal>
  );
}
