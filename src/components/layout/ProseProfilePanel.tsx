'use client';

import { useState, useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { ingestProseProfile, deriveProseProfile } from '@/lib/ai/ingest';
import type { BeatProfilePreset, ProseProfile } from '@/types/narrative';

type Props = { onClose: () => void };

// ── Derive suggestions from presets (no hardcoding) ───────────────────────────

type StringField = 'register' | 'stance' | 'tense' | 'sentenceRhythm' | 'interiority' | 'dialogueWeight';
const STRING_FIELDS: StringField[] = ['register', 'stance', 'tense', 'sentenceRhythm', 'interiority', 'dialogueWeight'];

/** For a given string field, returns unique values and the preset names that use each. */
function deriveOptions(presets: BeatProfilePreset[], field: StringField): { value: string; sources: string[] }[] {
  const map = new Map<string, string[]>();
  for (const p of presets) {
    const v = p.profile[field];
    if (typeof v === 'string' && v.trim()) {
      const entry = map.get(v) ?? [];
      entry.push(p.name);
      map.set(v, entry);
    }
  }
  // Sort by frequency (most common first), then alphabetically
  return [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([value, sources]) => ({ value, sources }));
}

/** Collect all device strings used across presets. */
function deriveDeviceOptions(presets: BeatProfilePreset[]): { value: string; sources: string[] }[] {
  const map = new Map<string, string[]>();
  for (const p of presets) {
    for (const d of p.profile.devices ?? []) {
      if (d.trim()) {
        const entry = map.get(d) ?? [];
        entry.push(p.name);
        map.set(d, entry);
      }
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([value, sources]) => ({ value, sources }));
}

/** Collect all rule strings used across presets. */
function deriveRuleTemplates(presets: BeatProfilePreset[]): string[] {
  const seen = new Set<string>();
  for (const p of presets) {
    for (const r of p.profile.rules ?? []) {
      if (r.trim()) seen.add(r);
    }
  }
  return [...seen];
}

/** Collect all anti-pattern strings used across presets. */
function deriveAntiPatternTemplates(presets: BeatProfilePreset[]): string[] {
  const seen = new Set<string>();
  for (const p of presets) {
    for (const a of p.profile.antiPatterns ?? []) {
      if (a.trim()) seen.add(a);
    }
  }
  return [...seen];
}

const FIELD_LABELS: Record<StringField, string> = {
  register:       'Register',
  stance:         'Stance',
  tense:          'Tense',
  sentenceRhythm: 'Sentence rhythm',
  interiority:    'Interiority',
  dialogueWeight: 'Dialogue weight',
};

// ── Profile matching ─────────────────────────────────────────────────────────

/** Check if a draft exactly matches a preset's profile (ignoring undefined/empty fields). */
function profileMatchesPreset(draft: Partial<ProseProfile>, preset: ProseProfile): boolean {
  for (const f of STRING_FIELDS) {
    const dv = (draft[f] ?? '').toString().trim();
    const pv = (preset[f] ?? '').toString().trim();
    if (dv !== pv) return false;
  }
  const dd = [...(draft.devices ?? [])].sort();
  const pd = [...(preset.devices ?? [])].sort();
  if (dd.length !== pd.length || dd.some((v, i) => v !== pd[i])) return false;
  const dr = [...(draft.rules ?? [])].sort();
  const pr = [...(preset.rules ?? [])].sort();
  if (dr.length !== pr.length || dr.some((v, i) => v !== pr[i])) return false;
  const da = [...(draft.antiPatterns ?? [])].sort();
  const pa = [...(preset.antiPatterns ?? [])].sort();
  if (da.length !== pa.length || da.some((v, i) => v !== pa[i])) return false;
  return true;
}

function detectPresetKey(profile: Partial<ProseProfile> | undefined, presets: BeatProfilePreset[]): string | null {
  if (!profile) return null;
  for (const p of presets) {
    if (profileMatchesPreset(profile, p.profile)) return p.key;
  }
  return null;
}

// ── Draft ─────────────────────────────────────────────────────────────────────

type Draft = {
  register: string; stance: string; tense: string;
  sentenceRhythm: string; interiority: string; dialogueWeight: string;
  devices: string[]; rules: string[]; antiPatterns: string[];
};

function toDraft(p: Partial<ProseProfile>): Draft {
  return {
    register:       p.register       ?? '',
    stance:         p.stance         ?? '',
    tense:          p.tense          ?? '',
    sentenceRhythm: p.sentenceRhythm ?? '',
    interiority:    p.interiority    ?? '',
    dialogueWeight: p.dialogueWeight ?? '',
    devices:        p.devices        ? [...p.devices] : [],
    rules:          p.rules          ? [...p.rules]   : [],
    antiPatterns:   p.antiPatterns   ? [...p.antiPatterns] : [],
  };
}

// ── Ingest skeleton ──────────────────────────────────────────────────────────

function IngestSkeleton() {
  return (
    <div className="space-y-5 py-4 animate-pulse">
      {['Register', 'Stance', 'Rhythm', 'Devices', 'Rules'].map((label) => (
        <div key={label} className="space-y-1.5">
          <div className="h-2.5 w-16 rounded bg-white/5" />
          <div className="h-3 rounded bg-white/5" style={{ width: `${50 + Math.random() * 40}%` }} />
        </div>
      ))}
      <p className="text-[10px] text-text-dim/40 text-center pt-2">Extracting profile from text…</p>
    </div>
  );
}

// ── Template for external LLM extraction ──────────────────────────────────────

const PROSE_PROFILE_TEMPLATE = `Analyze the prose sample below and fill in this JSON template:

{
  "register": "[FILL: tonal register — e.g. 'literary', 'conversational', 'clinical detached observer', 'lyrical', 'terse hardboiled']",
  "stance": "[FILL: narrator distance — e.g. 'close third', 'omniscient', 'deep first', 'distant third']",
  "tense": "[FILL: grammatical tense — e.g. 'past', 'present', 'mixed']",
  "sentenceRhythm": "[FILL: structural cadence — e.g. 'varied with short punches', 'long flowing periods', 'staccato', 'balanced']",
  "interiority": "[FILL: depth into character thoughts — e.g. 'deep immersion', 'surface observations', 'occasional glimpses', 'none']",
  "dialogueWeight": "[FILL: proportion of dialogue — e.g. 'dialogue-heavy', 'balanced', 'narration-dominant', 'sparse']",
  "devices": [
    "[FILL: rhetorical/narrative devices — e.g. 'repetition for emphasis', 'sentence fragments', 'free indirect discourse', 'unreliable narrator']"
  ],
  "rules": [
    "[FILL: show-don't-tell constraints — e.g. 'Never name emotions directly', 'Use concrete sensory detail over abstract description', 'Avoid adverbs']"
  ],
  "antiPatterns": [
    "[FILL: specific prose failures to avoid — e.g. 'Purple prose', 'Excessive adjectives', 'Telling reader how to feel']"
  ]
}

PROSE SAMPLE:
---
[PASTE YOUR PROSE SAMPLE HERE]
---

Instructions:
1. Replace each [FILL: ...] with an appropriate value based on the prose sample
2. For arrays (devices, rules, antiPatterns), add 2-5 relevant items
3. Return ONLY the filled JSON — no explanation needed`;

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProseProfilePanel({ onClose }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const current = narrative?.proseProfile;
  const presets = state.beatProfilePresets ?? [];

  const [draft, setDraft] = useState<Draft>(() => toDraft(current ?? {}));
  const [appliedKey, setAppliedKey] = useState<string | null>(() => detectPresetKey(current, presets));
  const [newRule, setNewRule] = useState('');
  const [newAntiPattern, setNewAntiPattern] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [showAntiPatternTemplates, setShowAntiPatternTemplates] = useState(false);
  const [tab, setTab] = useState<'edit' | 'import'>('edit');
  const [ingestText, setIngestText] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [deriving, setDeriving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setDraft(toDraft(current ?? {})); }, [narrative?.id]); // eslint-disable-line

  if (!narrative) return null;

  function set<K extends keyof Draft>(key: K, val: Draft[K]) {
    setDraft((d) => {
      const next = { ...d, [key]: val };
      setAppliedKey(detectPresetKey(next, presets));
      return next;
    });
  }

  function applyPreset(key: string, profile: ProseProfile) {
    setDraft(toDraft(profile));
    setAppliedKey(key);
  }

  function addRule(text: string) {
    const t = text.trim();
    if (t && !draft.rules.includes(t)) setDraft((d) => ({ ...d, rules: [...d.rules, t] }));
    setNewRule('');
  }

  const deviceOptions = deriveDeviceOptions(presets);
  const ruleTemplates = deriveRuleTemplates(presets);
  const antiPatternTemplates = deriveAntiPatternTemplates(presets);

  async function handleIngest() {
    if (!ingestText.trim() || ingesting) return;
    setIngesting(true);
    try {
      const profile = await ingestProseProfile(ingestText, draft);
      setDraft(toDraft(profile));
      setAppliedKey(detectPresetKey(profile, presets));
      setIngestText('');
      setTab('edit');
    } catch {
      // user can retry
    } finally {
      setIngesting(false);
    }
  }

  async function handleDerive() {
    if (!narrative || deriving) return;
    setDeriving(true);
    try {
      const profile = await deriveProseProfile(narrative);
      setDraft(toDraft(profile));
      setAppliedKey(detectPresetKey(profile, presets));
      setTab('edit');
    } catch {
      // user can retry
    } finally {
      setDeriving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="4xl" maxHeight="90vh">
      <ModalHeader onClose={onClose}>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Prose Profile</h2>
          <p className="text-[10px] text-text-dim">Voice and style applied to all prose generation</p>
        </div>
      </ModalHeader>
      <ModalBody className="p-0">
        <div className="flex min-h-0" style={{ minHeight: 520 }}>

          {/* ── Presets sidebar ── */}
          <div className="w-52 shrink-0 border-r border-white/6 p-3 flex flex-col gap-1 overflow-y-auto">
            <span className="text-[9px] uppercase tracking-widest text-text-dim px-1 mb-1">Presets</span>
            {presets.map((p) => {
              const active = appliedKey === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => { applyPreset(p.key, p.profile); setTab('edit'); }}
                  className={`w-full text-left rounded-lg px-2.5 py-2 transition-all flex flex-col gap-0.5 ${
                    active ? 'bg-violet-500/10 border border-violet-500/30' : 'border border-transparent hover:bg-white/4'
                  }`}
                >
                  <span className={`text-[11px] font-medium leading-tight ${active ? 'text-violet-300' : 'text-text-secondary'}`}>{p.name}</span>
                  <span className="text-[9px] text-text-dim leading-snug">{p.description}</span>
                </button>
              );
            })}

            <div className="border-t border-white/6 mt-2 pt-2 flex flex-col gap-1">
              <button
                onClick={handleDerive}
                disabled={deriving}
                className={`w-full text-left rounded-lg px-2.5 py-2 transition-all flex flex-col gap-0.5 ${
                  deriving ? 'bg-violet-500/10 border border-violet-500/30' : 'border border-transparent hover:bg-white/4'
                }`}
              >
                <span className={`text-[11px] font-medium leading-tight ${deriving ? 'text-violet-300' : 'text-text-secondary'}`}>
                  {deriving ? 'Deriving…' : 'Derive from story'}
                </span>
                <span className="text-[9px] text-text-dim leading-snug">Auto-generate from narrative context</span>
              </button>
              <button
                onClick={() => setTab('import')}
                className={`w-full text-left rounded-lg px-2.5 py-2 transition-all flex flex-col gap-0.5 ${
                  tab === 'import' ? 'bg-violet-500/10 border border-violet-500/30' : 'border border-transparent hover:bg-white/4'
                }`}
              >
                <span className={`text-[11px] font-medium leading-tight ${tab === 'import' ? 'text-violet-300' : 'text-text-secondary'}`}>Import from text</span>
                <span className="text-[9px] text-text-dim leading-snug">Extract profile from prose or notes</span>
              </button>
            </div>
          </div>

          {/* ── Fields ── */}
          {tab === 'edit' && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="grid grid-cols-2 gap-x-8 gap-y-5">

              {/* 6 string fields */}
              {STRING_FIELDS.map((field) => (
                <SuggestionField
                  key={field}
                  label={FIELD_LABELS[field]}
                  value={draft[field]}
                  options={deriveOptions(presets, field)}
                  onChange={(v) => set(field, v)}
                />
              ))}

              {/* Devices */}
              <div className="col-span-2">
                <span className="text-[9px] uppercase tracking-widest text-text-dim block mb-2">Devices</span>
                <TagField
                  values={draft.devices}
                  options={deviceOptions}
                  placeholder="Add device…"
                  onChange={(v) => set('devices', v)}
                />
              </div>

              {/* Rules */}
              <div className="col-span-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] uppercase tracking-widest text-text-dim">Rules</span>
                  {ruleTemplates.length > 0 && (
                    <button onClick={() => setShowTemplates((v) => !v)} className="text-[9px] text-text-dim hover:text-text-secondary transition-colors">
                      {showTemplates ? 'Hide templates' : 'From works'}
                    </button>
                  )}
                </div>

                {showTemplates && (
                  <div className="flex flex-col gap-1 mb-3 p-3 rounded-lg bg-white/2 border border-white/5 max-h-36 overflow-y-auto">
                    {ruleTemplates.filter((t) => !draft.rules.includes(t)).map((t) => (
                      <button key={t} onClick={() => setDraft((d) => ({ ...d, rules: [...d.rules, t] }))}
                        className="text-left text-[9px] text-text-dim hover:text-text-secondary transition-colors py-0.5">
                        + {t}
                      </button>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5 mb-2">
                  {draft.rules.length === 0
                    ? <p className="text-[10px] text-text-dim italic">No rules set</p>
                    : draft.rules.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 group">
                        <span className="flex-1 text-[10px] text-text-secondary leading-snug pl-2.5 border-l border-violet-500/30 py-0.5">{r}</span>
                        <button onClick={() => set('rules', draft.rules.filter((_, j) => j !== i))}
                          className="opacity-0 group-hover:opacity-100 text-text-dim hover:text-text-primary transition-opacity mt-0.5 shrink-0">×</button>
                      </div>
                    ))
                  }
                </div>

                <div className="flex gap-2">
                  <input value={newRule} onChange={(e) => setNewRule(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addRule(newRule); }}
                    placeholder="Add rule…"
                    className="flex-1 bg-white/4 border border-white/8 rounded-lg px-3 py-1.5 text-[10px] text-text-primary placeholder:text-text-dim focus:outline-none focus:border-white/20" />
                  <button onClick={() => addRule(newRule)} className="px-3 rounded-lg border border-white/10 text-[10px] text-text-secondary hover:text-text-primary transition-all">Add</button>
                </div>
              </div>

              {/* Anti-patterns */}
              <div className="col-span-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] uppercase tracking-widest text-text-dim">Anti-patterns</span>
                  {antiPatternTemplates.length > 0 && (
                    <button onClick={() => setShowAntiPatternTemplates((v) => !v)} className="text-[9px] text-text-dim hover:text-text-secondary transition-colors">
                      {showAntiPatternTemplates ? 'Hide templates' : 'From presets'}
                    </button>
                  )}
                </div>

                {showAntiPatternTemplates && (
                  <div className="flex flex-col gap-1 mb-3 p-3 rounded-lg bg-white/2 border border-white/5 max-h-36 overflow-y-auto">
                    {antiPatternTemplates.filter((t) => !draft.antiPatterns.includes(t)).map((t) => (
                      <button key={t} onClick={() => setDraft((d) => ({ ...d, antiPatterns: [...d.antiPatterns, t] }))}
                        className="text-left text-[9px] text-text-dim hover:text-text-secondary transition-colors py-0.5">
                        + {t}
                      </button>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5 mb-2">
                  {draft.antiPatterns.length === 0
                    ? <p className="text-[10px] text-text-dim italic">No anti-patterns set</p>
                    : draft.antiPatterns.map((a, i) => (
                      <div key={i} className="flex items-start gap-2 group">
                        <span className="flex-1 text-[10px] text-text-secondary leading-snug pl-2.5 border-l border-red-500/30 py-0.5">{a}</span>
                        <button onClick={() => set('antiPatterns', draft.antiPatterns.filter((_, j) => j !== i))}
                          className="opacity-0 group-hover:opacity-100 text-text-dim hover:text-text-primary transition-opacity mt-0.5 shrink-0">×</button>
                      </div>
                    ))
                  }
                </div>

                <div className="flex gap-2">
                  <input value={newAntiPattern} onChange={(e) => setNewAntiPattern(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && newAntiPattern.trim()) { set('antiPatterns', [...draft.antiPatterns, newAntiPattern.trim()]); setNewAntiPattern(''); } }}
                    placeholder="Add anti-pattern…"
                    className="flex-1 bg-white/4 border border-white/8 rounded-lg px-3 py-1.5 text-[10px] text-text-primary placeholder:text-text-dim focus:outline-none focus:border-white/20" />
                  <button onClick={() => { if (newAntiPattern.trim()) { set('antiPatterns', [...draft.antiPatterns, newAntiPattern.trim()]); setNewAntiPattern(''); } }}
                    className="px-3 rounded-lg border border-white/10 text-[10px] text-text-secondary hover:text-text-primary transition-all">Add</button>
                </div>
              </div>

            </div>
          </div>
          )}

          {/* ── Import tab ── */}
          {tab === 'import' && (
          <div className="flex-1 overflow-y-auto p-5 flex flex-col">
            <div className="flex items-start justify-between gap-4 mb-4">
              <p className="text-[11px] text-text-dim leading-relaxed">
                Paste a prose sample, style guide, editorial notes, or author analysis. A profile will be extracted and loaded into the editor for review before saving.
              </p>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(PROSE_PROFILE_TEMPLATE);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="shrink-0 text-[10px] px-3 py-1.5 rounded-lg border border-white/10 text-text-dim hover:text-text-secondary hover:border-white/20 transition-all"
              >
                {copied ? 'Copied!' : 'Copy Template'}
              </button>
            </div>
            {ingesting ? (
              <IngestSkeleton />
            ) : (
              <>
                <textarea
                  value={ingestText}
                  onChange={(e) => setIngestText(e.target.value)}
                  rows={14}
                  placeholder="Paste text here…"
                  className="w-full flex-1 bg-white/3 border border-white/8 rounded-lg px-4 py-3 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-white/20 transition-colors resize-none leading-relaxed"
                />
                <div className="flex justify-end mt-3">
                  <button
                    onClick={handleIngest}
                    disabled={!ingestText.trim()}
                    className="text-[10px] px-5 py-1.5 rounded-lg bg-violet-600/80 hover:bg-violet-500/80 text-white font-medium disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                  >
                    Extract Profile
                  </button>
                </div>
              </>
            )}
          </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/6 flex justify-end">
          <button onClick={() => { dispatch({ type: 'SET_PROSE_PROFILE', profile: { ...draft } }); onClose(); }}
            className="px-5 py-1.5 rounded-lg bg-violet-600/80 hover:bg-violet-500/80 text-[11px] text-white font-medium transition-colors">
            Save profile
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ── SuggestionField ───────────────────────────────────────────────────────────

function SuggestionField({
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: { value: string; sources: string[] }[];
  onChange: (v: string) => void;
}) {
  const [custom, setCustom] = useState('');
  const isKnown = options.some((o) => o.value === value);
  const selectedSources = options.find((o) => o.value === value)?.sources ?? [];

  useEffect(() => { if (isKnown) setCustom(''); }, [isKnown, value]);

  return (
    <div>
      <span className="text-[9px] uppercase tracking-widest text-text-dim block mb-2">{label}</span>

      <div className="flex flex-wrap gap-1.5 mb-2">
        {!isKnown && value.trim() && (
          <span className="px-2.5 py-1 rounded-full text-[10px] border border-violet-500/50 bg-violet-500/10 text-violet-300 leading-none">
            {value.replace(/_/g, ' ')}
          </span>
        )}
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => { onChange(o.value); setCustom(''); }}
            title={o.sources.join(', ')}
            className={`px-2.5 py-1 rounded-full text-[10px] border transition-all leading-none ${
              value === o.value
                ? 'border-violet-500/50 bg-violet-500/10 text-violet-300'
                : 'border-white/8 text-text-dim hover:border-white/20 hover:text-text-secondary'
            }`}
          >
            {o.value.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={isKnown ? '' : (custom || value)}
        onChange={(e) => { setCustom(e.target.value); if (e.target.value.trim()) onChange(e.target.value.trim()); }}
        onBlur={() => { if (!custom.trim()) setCustom(''); }}
        placeholder={isKnown ? `${value.replace(/_/g, ' ')} — or type to override` : 'Custom value…'}
        className={`w-full rounded-lg px-3 py-1.5 text-[10px] border focus:outline-none transition-colors ${
          !isKnown && value
            ? 'bg-violet-500/5 border-violet-500/30 text-violet-300 placeholder:text-violet-400/40 focus:border-violet-500/50'
            : 'bg-white/3 border-white/6 text-text-dim placeholder:text-text-dim/40 focus:border-white/15 focus:text-text-secondary'
        }`}
      />

      {isKnown && selectedSources.length > 0 && (
        <p className="text-[9px] text-text-dim mt-1 pl-0.5">{selectedSources.join(', ')}</p>
      )}
    </div>
  );
}

// ── TagField ──────────────────────────────────────────────────────────────────

function TagField({
  values, options, placeholder, onChange,
}: {
  values: string[];
  options: { value: string; sources: string[] }[];
  placeholder: string;
  onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  function add(v: string) {
    const t = v.trim();
    if (t && !values.includes(t)) onChange([...values, t]);
    setInput('');
  }

  const unselected = options.filter((o) => !values.includes(o.value));

  return (
    <div ref={ref}>
      {/* Selected chips */}
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-violet-500/40 bg-violet-500/8 text-[10px] text-violet-300">
              {v.replace(/_/g, ' ')}
              <button onClick={() => onChange(values.filter((x) => x !== v))} className="opacity-60 hover:opacity-100 leading-none ml-0.5">×</button>
            </span>
          ))}
        </div>
      )}

      {/* Suggestions from presets */}
      {unselected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {unselected.map((o) => (
            <button
              key={o.value}
              onClick={() => add(o.value)}
              title={o.sources.join(', ')}
              className="px-2.5 py-1 rounded-full text-[10px] border border-white/8 text-text-dim hover:border-white/20 hover:text-text-secondary transition-all"
            >
              + {o.value.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}

      {/* Custom input */}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(input); }}
        placeholder={placeholder}
        className="w-full bg-white/4 border border-white/8 rounded-lg px-3 py-1.5 text-[10px] text-text-primary placeholder:text-text-dim focus:outline-none focus:border-white/20"
      />
    </div>
  );
}
