'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { ingestRules } from '@/lib/ai/ingest';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';

type Props = { onClose: () => void };

function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2.5 py-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="flex items-start gap-2.5 animate-pulse">
          <div className="w-4 h-3 rounded bg-white/5 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <div className="h-3 rounded bg-white/5" style={{ width: `${70 + Math.random() * 30}%` }} />
          </div>
        </div>
      ))}
      <p className="text-[10px] text-text-dim/40 text-center pt-1">Extracting rules from text...</p>
    </div>
  );
}

export default function RulesPanel({ onClose }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [rules, setRules] = useState<string[]>(narrative?.rules ?? []);
  const [draft, setDraft] = useState('');
  const [ingestText, setIngestText] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [tab, setTab] = useState<'list' | 'import'>('list');

  function addRule() {
    const text = draft.trim();
    if (!text) return;
    setRules((prev) => [...prev, text]);
    setDraft('');
  }

  function removeRule(index: number) {
    setRules((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleIngest() {
    if (!ingestText.trim() || ingesting) return;
    setIngesting(true);
    try {
      const newRules = await ingestRules(ingestText, rules);
      setRules((prev) => [...prev, ...newRules]);
      setIngestText('');
      setTab('list');
    } catch {
      // user can retry
    } finally {
      setIngesting(false);
    }
  }

  function handleSave() {
    dispatch({ type: 'SET_RULES', rules });
    onClose();
  }

  return (
    <Modal onClose={onClose} size="xl" maxHeight="85vh">
      <ModalHeader onClose={onClose}>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Rules</h2>
          <p className="text-[10px] text-text-dim uppercase tracking-wider">High-level constraints that define the series</p>
        </div>
      </ModalHeader>
      <ModalBody className="p-6 space-y-4">
        {/* Tabs */}
        <div className="flex gap-1 bg-bg-elevated rounded-lg p-0.5 shrink-0">
          <button onClick={() => setTab('list')} className={`flex-1 text-[11px] py-1.5 rounded-md transition-colors ${tab === 'list' ? 'bg-white/10 text-text-primary font-semibold' : 'text-text-dim hover:text-text-secondary'}`}>
            Rules
          </button>
          <button onClick={() => setTab('import')} className={`flex-1 text-[11px] py-1.5 rounded-md transition-colors ${tab === 'import' ? 'bg-white/10 text-text-primary font-semibold' : 'text-text-dim hover:text-text-secondary'}`}>
            Import
          </button>
        </div>

        {tab === 'list' && (
          <div className="space-y-3">
            {rules.length === 0 ? (
              <p className="text-[11px] text-text-dim/50 italic py-6 text-center">No rules defined yet</p>
            ) : (
              <div className="space-y-1">
                {rules.map((rule, i) => (
                  <div key={i} className="flex items-start gap-2.5 group py-1">
                    <span className="text-[10px] font-mono text-text-dim/50 mt-0.5 shrink-0 w-4 text-right">{i + 1}.</span>
                    <p className="text-[11px] text-text-secondary leading-relaxed flex-1">{rule}</p>
                    <button
                      onClick={() => removeRule(i)}
                      className="text-[10px] text-red-400/40 hover:text-red-400 opacity-0 group-hover:opacity-100 transition shrink-0 mt-0.5"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRule(); } }}
                placeholder="Add a rule..."
                className="flex-1 bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-white/20 transition-colors"
              />
              <button
                onClick={addRule}
                disabled={!draft.trim()}
                className="text-[11px] px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-text-secondary hover:text-text-primary hover:border-white/20 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {tab === 'import' && (
          <div className="space-y-3">
            <p className="text-[11px] text-text-dim leading-relaxed">
              Paste an outline, wiki page, or analysis from another AI. Rules will be extracted and added to your list.
            </p>
            {ingesting ? (
              <Skeleton lines={4} />
            ) : (
              <>
                <textarea
                  value={ingestText}
                  onChange={(e) => setIngestText(e.target.value)}
                  rows={8}
                  placeholder="Paste text here..."
                  className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2.5 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-white/20 transition-colors resize-none"
                />
                <div className="flex justify-end">
                  <button
                    onClick={handleIngest}
                    disabled={!ingestText.trim()}
                    className="text-[10px] px-4 py-1.5 rounded-md bg-white/5 border border-white/10 text-text-secondary hover:text-text-primary hover:border-white/20 disabled:opacity-25 disabled:cursor-not-allowed transition-colors font-medium"
                  >
                    Extract Rules
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
