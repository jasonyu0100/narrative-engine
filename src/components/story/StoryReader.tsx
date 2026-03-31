'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { NarrativeState, Scene, StorySettings, BeatPlan, Beat, BeatFn, BeatMechanism } from '@/types/narrative';
import { resolveEntry, isScene, DEFAULT_STORY_SETTINGS, BEAT_FN_LIST, BEAT_MECHANISM_LIST } from '@/types/narrative';
import { generateScenePlan, generateSceneProse, rewriteSceneProse } from '@/lib/ai';
import { useStore } from '@/lib/store';
import { exportEpub } from '@/lib/epub-export';
import { PROSE_CONCURRENCY, PLAN_CONCURRENCY } from '@/lib/constants';
import { sceneScale } from '@/lib/ai/context';

type ContentCache = Record<string, { text: string; status: 'loading' | 'ready' | 'error'; error?: string }>;
type BulkState = { running: boolean; completed: number; total: number; errors: number } | null;

function scoreColor(score: number): string {
  if (score >= 7.5) return 'text-emerald-400';
  if (score >= 5) return 'text-amber-400';
  return 'text-red-400';
}


export function StoryReader({
  narrative,
  resolvedKeys,
  currentSceneIndex,
  onClose,
}: {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentSceneIndex: number;
  onClose: () => void;
}) {
  const { dispatch } = useStore();
  const scenes = resolvedKeys
    .map((k) => resolveEntry(narrative, k))
    .filter((e): e is Scene => !!e && isScene(e));

  const initialIndex = (() => {
    const currentKey = resolvedKeys[currentSceneIndex];
    if (!currentKey) return 0;
    const idx = scenes.findIndex((s) => s.id === currentKey);
    return idx >= 0 ? idx : 0;
  })();

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [viewMode, setViewMode] = useState<'summary' | 'plan' | 'prose'>('summary');
  const [proseCache, setProseCache] = useState<ContentCache>({});
  const [planCache, setPlanCache] = useState<Record<string, { plan: BeatPlan | null; status: 'loading' | 'ready' | 'error'; error?: string }>>({});
  const [planReasoning, setPlanReasoning] = useState<Record<string, string>>({});
  const [planMeta, setPlanMeta] = useState<Record<string, { targetBeats: number; estWords: number }>>({});
  const contentRef = useRef<HTMLDivElement>(null);
  const activeSceneRef = useRef<HTMLButtonElement>(null);
  const [proseBulk, setProseBulk] = useState<BulkState>(null);
  const [planBulk, setPlanBulk] = useState<BulkState>(null);
  const bulkCancelledRef = useRef(false);
  const [copied, setCopied] = useState<string | false>(false);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const copyMenuRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [clearAllConfirm, setClearAllConfirm] = useState('');
  const [settingsDraft, setSettingsDraft] = useState<StorySettings>({
    ...DEFAULT_STORY_SETTINGS,
    ...narrative.storySettings,
  });
  const [settingsTab, setSettingsTab] = useState<'prose' | 'plan'>('prose');

  const scene = scenes[currentIndex];
  const arc = scene ? Object.values(narrative.arcs).find((a) => a.sceneIds.includes(scene.id)) : null;
  const location = scene ? narrative.locations[scene.locationId] : null;
  const pov = scene ? narrative.characters[scene.povId] : null;


  // ── Plan generation ──────────────────────────────────────────────────
  const generatePlan = useCallback(async (s: Scene) => {
    setPlanCache((prev) => ({ ...prev, [s.id]: { plan: null, status: 'loading' } }));
    setPlanReasoning((prev) => ({ ...prev, [s.id]: '' }));
    try {
      const plan = await generateScenePlan(narrative, s, resolvedKeys, (token) => {
        setPlanReasoning((prev) => ({ ...prev, [s.id]: (prev[s.id] ?? '') + token }));
      }, (meta) => {
        setPlanMeta((prev) => ({ ...prev, [s.id]: meta }));
      });
      setPlanCache((prev) => ({ ...prev, [s.id]: { plan, status: 'ready' } }));
      setPlanReasoning((prev) => { const next = { ...prev }; delete next[s.id]; return next; });
      setPlanMeta((prev) => { const next = { ...prev }; delete next[s.id]; return next; });
      dispatch({ type: 'UPDATE_SCENE', sceneId: s.id, updates: { plan } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPlanCache((prev) => ({ ...prev, [s.id]: { plan: null, status: 'error', error: message } }));
      setPlanReasoning((prev) => { const next = { ...prev }; delete next[s.id]; return next; });
      setPlanMeta((prev) => { const next = { ...prev }; delete next[s.id]; return next; });
    }
  }, [narrative, resolvedKeys, dispatch]);

  // ── Prose generation ─────────────────────────────────────────────────
  const generateProse = useCallback(async (s: Scene) => {
    setProseCache((prev) => ({ ...prev, [s.id]: { text: '', status: 'loading' } }));
    try {
      const prose = await generateSceneProse(narrative, s, resolvedKeys, (token) => {
        setProseCache((prev) => {
          const existing = prev[s.id];
          return { ...prev, [s.id]: { text: (existing?.text ?? '') + token, status: 'loading' } };
        });
      });
      setProseCache((prev) => ({ ...prev, [s.id]: { text: prose, status: 'ready' } }));
      dispatch({ type: 'UPDATE_SCENE', sceneId: s.id, updates: { prose } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setProseCache((prev) => ({ ...prev, [s.id]: { text: '', status: 'error', error: message } }));
    }
  }, [narrative, resolvedKeys, dispatch]);

  const [rewriteAnalysis, setRewriteAnalysis] = useState('');
  const [showRewrite, setShowRewrite] = useState(false);
  const [contextPast, setContextPast] = useState(0);
  const [contextFuture, setContextFuture] = useState(0);
  const [referenceSceneIds, setReferenceSceneIds] = useState<string[]>([]);
  const [refPickerOpen, setRefPickerOpen] = useState(false);
  const [rewriteChangelogs, setRewriteChangelogs] = useState<Record<string, string>>({});

  // ── Rewrite ────────────────────────────────────────────────────────
  const rewriteScene = useCallback(async (s: Scene, analysis: string, past = 0, future = 0, refIds?: string[]) => {
    const currentProse = proseCache[s.id]?.status === 'ready' ? proseCache[s.id].text : s.prose;
    if (!currentProse) return;
    setProseCache((prev) => ({ ...prev, [s.id]: { text: '', status: 'loading' } }));
    try {
      const { prose, changelog } = await rewriteSceneProse(narrative, s, resolvedKeys, currentProse, analysis, past, future, refIds, (token) => {
        setProseCache((prev) => {
          const existing = prev[s.id];
          return { ...prev, [s.id]: { text: (existing?.text ?? '') + token, status: 'loading' } };
        });
      });
      setProseCache((prev) => ({ ...prev, [s.id]: { text: prose, status: 'ready' } }));
      if (changelog) setRewriteChangelogs((prev) => ({ ...prev, [s.id]: changelog }));
      dispatch({ type: 'UPDATE_SCENE', sceneId: s.id, updates: { prose, proseScore: undefined } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setProseCache((prev) => ({ ...prev, [s.id]: { text: currentProse, status: 'error', error: message } }));
    }
  }, [narrative, resolvedKeys, proseCache, dispatch]);

  // ── Rewrite plan ──────────────────────────────────────────────────────
  // TODO: Plan rewrite disabled — will be updated to work with BeatPlan format

  // ── Bulk helpers ─────────────────────────────────────────────────────
  const runBulk = useCallback(async (
    items: Scene[],
    concurrency: number,
    process: (s: Scene) => Promise<void>,
    setState: (s: BulkState) => void,
  ) => {
    if (items.length === 0) return;
    bulkCancelledRef.current = false;
    setState({ running: true, completed: 0, total: items.length, errors: 0 });
    let completed = 0;
    let errors = 0;
    let nextIdx = 0;

    const runWorker = async () => {
      while (!bulkCancelledRef.current) {
        const idx = nextIdx++;
        if (idx >= items.length) break;
        try {
          await process(items[idx]);
          completed++;
        } catch {
          errors++;
        }
        setState({ running: !bulkCancelledRef.current, completed, total: items.length, errors });
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
    setState({ running: false, completed, total: items.length, errors });
  }, []);

  const bulkPlan = useCallback(() => {
    const missing = scenes.filter((s) => !s.plan && planCache[s.id]?.status !== 'ready');
    runBulk(missing, PLAN_CONCURRENCY, (s) => generatePlan(s), setPlanBulk);
  }, [scenes, planCache, generatePlan, runBulk]);

  const bulkProse = useCallback(() => {
    // Only generate prose for scenes that have plans but no prose yet
    const missing = scenes.filter((s) =>
      (s.plan || planCache[s.id]?.status === 'ready') &&
      !s.prose && proseCache[s.id]?.status !== 'ready'
    );
    runBulk(missing, PROSE_CONCURRENCY, (s) => generateProse(s), setProseBulk);
  }, [scenes, planCache, proseCache, resolvedKeys, generateProse, runBulk]);


  const cancelBulk = useCallback(() => {
    bulkCancelledRef.current = true;
    setProseBulk((prev) => prev ? { ...prev, running: false } : null);
    setPlanBulk((prev) => prev ? { ...prev, running: false } : null);
  }, []);

  // ── Sync cached plan/prose from scene data ───────────────────────────
  useEffect(() => {
    if (!scene) return;
    if (scene.prose && !proseCache[scene.id]) {
      setProseCache((prev) => ({ ...prev, [scene.id]: { text: scene.prose!, status: 'ready' } }));
    }
    if (scene.plan && !planCache[scene.id]) {
      setPlanCache((prev) => ({ ...prev, [scene.id]: { plan: scene.plan!, status: 'ready' as const } }));
    }
  }, [scene, proseCache, planCache]);

  // Reset state when changing scenes
  useEffect(() => { setShowRewrite(false); setRewriteAnalysis(''); }, [currentIndex]);

  useEffect(() => { activeSceneRef.current?.scrollIntoView({ block: 'center' }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!copyMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (copyMenuRef.current && !copyMenuRef.current.contains(e.target as Node)) setCopyMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [copyMenuOpen]);
  useEffect(() => { contentRef.current?.scrollTo(0, 0); }, [currentIndex, viewMode]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setCurrentIndex((i) => Math.max(0, i - 1)); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setCurrentIndex((i) => Math.min(scenes.length - 1, i + 1)); }
      else if (e.key === 'Escape') { onClose(); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [scenes.length, onClose]);

  if (scenes.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-dim text-sm">No scenes yet.</p>
          <button onClick={onClose} className="mt-4 text-[11px] text-text-dim hover:text-text-primary transition">Close</button>
        </div>
      </div>
    );
  }

  const proseCached = scene ? proseCache[scene.id] : undefined;
  const planCached = scene ? planCache[scene.id] : undefined;
  const hasProse = proseCached?.status === 'ready';
  const hasPlan = planCached?.status === 'ready' || !!scene?.plan;
  const isProseLoading = proseCached?.status === 'loading';
  const isPlanLoading = planCached?.status === 'loading';
  const hasProseError = proseCached?.status === 'error';
  const hasPlanError = planCached?.status === 'error';

  const isAnyBulkRunning = !!(proseBulk?.running || planBulk?.running);
  const activeBulk = proseBulk?.running ? proseBulk : planBulk?.running ? planBulk : null;

  const rawPlan = planCached?.plan ?? scene?.plan ?? null;
  const activePlan: BeatPlan | null = rawPlan && Array.isArray(rawPlan.beats) ? rawPlan : null;

  return (
    <div className="fixed inset-0 bg-bg-base z-50 flex flex-col">
      {/* Aurora background — dimmed for reading */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="aurora-workspace absolute inset-0">
          <div className="aurora-curtain aurora-curtain-1" />
          <div className="aurora-curtain aurora-curtain-3" />
          <div className="aurora-curtain aurora-curtain-5" />
          <div className="aurora-glow" />
        </div>
      </div>

      {/* Header */}
      <div className="relative z-20 px-6 py-4 border-b border-white/8 bg-black/40 backdrop-blur-sm flex items-center justify-between shrink-0 overflow-visible">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold text-text-primary">{narrative.title}</h2>
          {arc && <span className="text-[11px] text-text-dim">{arc.name}</span>}
        </div>
        <div className="flex items-center gap-3">
          {/* Bulk progress */}
          {activeBulk && (
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-change rounded-full animate-spin" />
              <span className="text-[10px] text-text-dim font-mono">{activeBulk.completed}/{activeBulk.total}</span>
              {activeBulk.errors > 0 && <span className="text-[10px] text-red-400/80 font-mono">{activeBulk.errors} err</span>}
              <button onClick={cancelBulk} className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-dim hover:text-text-secondary transition">Stop</button>
            </div>
          )}

          {!isAnyBulkRunning && (
            <>
              {/* Plan All */}
              {(() => {
                const missingPlans = scenes.filter((s) => !s.plan && planCache[s.id]?.status !== 'ready').length;
                return missingPlans > 0 ? (
                  <button onClick={bulkPlan} className="text-[10px] px-2.5 py-1 rounded-full border border-white/10 text-text-dim hover:text-sky-400 hover:border-sky-400/20 transition flex items-center gap-1.5" title={`Generate plans for ${missingPlans} scenes`}>
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                    Plan All ({missingPlans})
                  </button>
                ) : null;
              })()}


              {/* Write All — only available when all scenes have plans */}
              {(() => {
                const missingProse = scenes.filter((s) => !s.prose && proseCache[s.id]?.status !== 'ready').length;
                const missingPlans = scenes.filter((s) => !s.plan && planCache[s.id]?.status !== 'ready').length;
                if (missingProse === 0) return null;
                if (missingPlans > 0) return (
                  <span className="text-[10px] text-text-dim/40 px-2" title={`${missingPlans} scenes still need plans before prose can be generated`}>
                    Write All (plan first)
                  </span>
                );
                return (
                  <button onClick={bulkProse} className="text-[10px] px-2.5 py-1 rounded-full border border-white/10 text-text-dim hover:text-text-secondary hover:border-white/15 transition flex items-center gap-1.5" title={`Generate prose for ${missingProse} scenes`}>
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                    Write All ({missingProse})
                  </button>
                );
              })()}

              {/* Copy dropdown */}
              {(() => {
                const hasSummaries = scenes.some((s) => s.summary);
                const hasPlans = scenes.some((s) => s.plan || planCache[s.id]?.status === 'ready');
                const hasProse = scenes.some((s) => s.prose || proseCache[s.id]?.status === 'ready');
                if (!hasSummaries && !hasPlans && !hasProse) return null;

                function doCopy(type: string) {
                  let text = '';
                  if (type === 'summaries') {
                    text = scenes.map((s, i) => `Scene ${i + 1}: ${s.summary || '(no summary)'}`).join('\n\n');
                  } else if (type === 'plans') {
                    text = scenes.map((s, i) => {
                      const plan = planCache[s.id]?.status === 'ready' ? planCache[s.id].plan : s.plan;
                      if (!plan) return null;
                      const beatLines = plan.beats.map((b, bi) => `  ${bi + 1}. [${b.fn}:${b.mechanism}] ${b.what} | ${b.anchor}`).join('\n');
                      const anchorLines = plan.anchors.length > 0 ? `\n  Anchors: ${plan.anchors.map(a => `"${a}"`).join(', ')}` : '';
                      return `Scene ${i + 1}:\n${beatLines}${anchorLines}`;
                    }).filter(Boolean).join('\n\n---\n\n');
                  } else {
                    text = scenes.map((s) => proseCache[s.id]?.status === 'ready' ? proseCache[s.id].text : s.prose).filter(Boolean).join('\n\n');
                  }
                  navigator.clipboard.writeText(text);
                  setCopied(type);
                  setCopyMenuOpen(false);
                  setTimeout(() => setCopied(false), 2000);
                }

                return (
                  <div className="relative" ref={copyMenuRef}>
                    <button
                      onClick={() => setCopyMenuOpen((v) => !v)}
                      className="text-[10px] px-2.5 py-1 rounded-full border border-white/10 text-text-dim hover:text-text-secondary hover:border-white/15 transition flex items-center gap-1.5"
                    >
                      {copied ? <span className="text-emerald-400">Copied {copied}</span> : 'Copy'}
                    </button>
                    {copyMenuOpen && (
                      <div
                        className="absolute top-full mt-1 left-0 rounded-lg border border-white/10 py-1 z-50 min-w-[140px]"
                        style={{ background: '#1a1a1a', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
                      >
                        {hasSummaries && (
                          <button onClick={() => doCopy('summaries')} className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-white/5 transition">
                            Summaries ({scenes.filter((s) => s.summary).length})
                          </button>
                        )}
                        {hasPlans && (
                          <button onClick={() => doCopy('plans')} className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-white/5 transition">
                            Plans ({scenes.filter((s) => s.plan || planCache[s.id]?.status === 'ready').length})
                          </button>
                        )}
                        {hasProse && (
                          <button onClick={() => doCopy('prose')} className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-white/5 transition">
                            Prose ({scenes.filter((s) => s.prose || proseCache[s.id]?.status === 'ready').length})
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* EPUB */}
              {(() => {
                const allProse = scenes.filter((s) => proseCache[s.id]?.status === 'ready' || !!s.prose);
                return allProse.length > 0 ? (
                  <button onClick={() => exportEpub(narrative, resolvedKeys, proseCache)} className="text-[10px] px-2.5 py-1 rounded-full border border-white/10 text-text-dim hover:text-text-secondary hover:border-white/15 transition">
                    EPUB
                  </button>
                ) : null;
              })()}

              {/* Clear All */}
              <div className="relative">
                <button
                  onClick={() => { setClearAllOpen((v) => !v); setClearAllConfirm(''); }}
                  className="text-[10px] px-2.5 py-1 rounded-full border border-white/10 text-text-dim hover:text-red-400 hover:border-red-400/20 transition"
                >
                  Clear All
                </button>
                {clearAllOpen && (
                  <div
                    className="absolute top-full mt-1 right-0 rounded-lg border border-red-500/20 p-3 z-50 w-64"
                    style={{ background: '#1a1a1a', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
                  >
                    <p className="text-[10px] text-text-dim mb-1.5">
                      Type <span className="text-red-400 font-medium">{narrative.title}</span> to clear all plans and prose
                    </p>
                    <input
                      type="text"
                      value={clearAllConfirm}
                      onChange={(e) => setClearAllConfirm(e.target.value)}
                      placeholder={narrative.title}
                      className="bg-white/5 border border-white/8 rounded-md px-2.5 py-1.5 text-[11px] text-text-primary w-full outline-none placeholder:text-text-dim/30 mb-2 focus:border-red-500/30 transition-colors"
                      autoFocus
                    />
                    <button
                      onClick={() => {
                        if (clearAllConfirm === narrative.title) {
                          for (const s of scenes) {
                            dispatch({ type: 'UPDATE_SCENE', sceneId: s.id, updates: { plan: undefined, prose: undefined, proseScore: undefined, locked: false } });
                          }
                          setPlanCache({});
                          setProseCache({});
                          setClearAllOpen(false);
                          setClearAllConfirm('');
                        }
                      }}
                      disabled={clearAllConfirm !== narrative.title}
                      className="w-full text-[10px] font-medium py-1.5 rounded-md transition-colors bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-30 disabled:pointer-events-none"
                    >
                      Clear all plans & prose
                    </button>
                  </div>
                )}
              </div>

            </>
          )}

          <span className="text-[10px] text-text-dim font-mono">{currentIndex + 1} / {scenes.length}</span>
          <button
            onClick={() => {
              setSettingsDraft({ ...DEFAULT_STORY_SETTINGS, ...narrative.storySettings });
              setSettingsTab('prose');
              setSettingsOpen(true);
            }}
            className="px-2 py-1 rounded hover:bg-white/10 transition-colors text-text-dim hover:text-text-primary flex items-center gap-1"
            title="Prose & Plan settings"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span className="text-[10px]">Settings</span>
          </button>
          <button onClick={onClose} className="text-text-dim hover:text-text-primary text-lg leading-none transition">&times;</button>
        </div>
      </div>

      {/* Main content area */}
      <div className="relative z-10 flex-1 overflow-hidden flex">
        {/* Scene list sidebar */}
        <div className="w-56 shrink-0 border-r border-white/8 bg-black/30 backdrop-blur-sm overflow-y-auto py-2">
          {scenes.map((s, i) => {
            const sArc = Object.values(narrative.arcs).find((a) => a.sceneIds.includes(s.id));
            const hasPlanDot = planCache[s.id]?.status === 'ready' || !!s.plan;
            const hasProseDot = proseCache[s.id]?.status === 'ready' || !!s.prose;
            const isGen = proseCache[s.id]?.status === 'loading' || planCache[s.id]?.status === 'loading';
            const score = s.proseScore;
            return (
              <button
                key={s.id}
                ref={i === currentIndex ? activeSceneRef : undefined}
                onClick={() => setCurrentIndex(i)}
                className={`w-full text-left px-4 py-2.5 transition-colors ${
                  i === currentIndex ? 'bg-white/8 text-text-primary' : 'text-text-dim hover:bg-white/4 hover:text-text-secondary'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-text-dim shrink-0">{i + 1}</span>
                  <span className="text-[11px] truncate">{s.summary.slice(0, 60)}{s.summary.length > 60 ? '...' : ''}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 ml-5">
                  {sArc && <span className="text-[9px] text-text-dim">{sArc.name}</span>}
                  {isGen && <div className="w-2.5 h-2.5 border border-white/30 border-t-white/70 rounded-full animate-spin shrink-0" />}
                  {!isGen && hasPlanDot && <span className="text-[8px] text-sky-400/60">●</span>}
                  {!isGen && hasProseDot && <span className="text-[8px] text-emerald-400/60">●</span>}
                  {score && typeof score.overall === 'number' && <span className={`text-[9px] font-mono ${scoreColor(score.overall)}`}>{score.overall}</span>}
                  {s.locked && (
                    <span className="text-[8px] text-text-dim/40" title="Locked — skipped by bulk operations">&#128274;</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Reading pane */}
        <div ref={contentRef} className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8 py-10">
            {/* Scene identifier */}
            <div className="flex items-center gap-3 mb-2">
              <span className="text-[10px] font-mono text-text-dim">Scene {currentIndex + 1}</span>
              {arc && (
                <>
                  <span className="text-text-dim/20">&middot;</span>
                  <span className="text-[10px] text-text-dim">{arc.name}</span>
                </>
              )}
            </div>

            {/* ── Tab bar ────────────────────────────────────────────── */}
            <div className="flex items-center border-b border-white/5 mb-8">
              {(['summary', 'plan', 'prose'] as const).map((tab) => {
                const isActive = viewMode === tab;
                const hasContent = tab === 'summary' || (tab === 'plan' && hasPlan) || (tab === 'prose' && hasProse);
                return (
                  <button
                    key={tab}
                    onClick={() => setViewMode(tab)}
                    className={`relative px-4 py-3 text-[11px] tracking-wide transition ${
                      isActive
                        ? 'text-text-primary'
                        : hasContent
                          ? 'text-text-dim hover:text-text-secondary'
                          : 'text-text-dim/40 hover:text-text-dim'
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    {isActive && <span className="absolute bottom-0 left-4 right-4 h-px bg-text-primary" />}
                    {!isActive && hasContent && tab !== 'summary' && (
                      <span className={`ml-1.5 inline-block w-1 h-1 rounded-full ${tab === 'plan' ? 'bg-sky-400/60' : 'bg-emerald-400/60'}`} />
                    )}
                  </button>
                );
              })}

              {/* Context actions — shown in tab bar, right-aligned */}
              {viewMode === 'plan' && hasPlan && !isPlanLoading && (
                <div className="ml-auto flex items-center gap-1.5">
                  {!scene.locked && (
                    <>
                      <button
                        onClick={() => {
                          setViewMode('prose');
                          if (!hasProse) generateProse(scene);
                        }}
                        className="text-[9px] px-2 py-1 rounded text-sky-400/80 hover:text-sky-400 hover:bg-sky-500/10 transition"
                      >
                        Write Prose &rarr;
                      </button>
                      <button
                        onClick={() => {
                          dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { plan: undefined } });
                          setPlanCache((prev) => { const next = { ...prev }; delete next[scene.id]; return next; });
                        }}
                        className="text-[9px] px-2 py-1 rounded text-text-dim/50 hover:text-red-400/80 hover:bg-red-500/5 transition"
                      >
                        Clear
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { locked: !scene.locked } })}
                    className={`text-[9px] px-2 py-1 rounded transition ${scene.locked ? 'text-amber-400 bg-amber-500/10' : 'text-text-dim/40 hover:text-text-dim hover:bg-white/5'}`}
                    title={scene.locked ? 'Unlock — allow editing' : 'Lock — prevent changes'}
                  >
                    {scene.locked ? 'Locked' : 'Lock'}
                  </button>
                </div>
              )}
              {viewMode === 'prose' && hasProse && !isProseLoading && (
                <div className="ml-auto flex items-center gap-1.5">
                  {!scene.locked && (
                    <>
                      <button
                        onClick={() => setShowRewrite((v: boolean) => !v)}
                        className={`text-[9px] px-2 py-1 rounded transition ${showRewrite ? 'text-cyan-400 bg-cyan-500/10' : 'text-cyan-400/60 hover:text-cyan-400 hover:bg-cyan-500/10'}`}
                      >
                        Rewrite
                      </button>
                      <button
                        onClick={() => { dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { prose: undefined, proseScore: undefined } }); generateProse(scene); }}
                        className="text-[9px] px-2 py-1 rounded text-text-dim hover:text-text-secondary hover:bg-white/5 transition"
                      >
                        Regenerate
                      </button>
                      <button
                        onClick={() => { setProseCache((prev) => { const next = { ...prev }; delete next[scene.id]; return next; }); dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { prose: undefined, proseScore: undefined } }); }}
                        className="text-[9px] px-2 py-1 rounded text-text-dim/50 hover:text-red-400/80 hover:bg-red-500/5 transition"
                      >
                        Clear
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => { setShowRewrite(false); dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { locked: !scene.locked } }); }}
                    className={`text-[9px] px-2 py-1 rounded transition ${scene.locked ? 'text-amber-400 bg-amber-500/10' : 'text-text-dim/40 hover:text-text-dim hover:bg-white/5'}`}
                    title={scene.locked ? 'Unlock — allow editing' : 'Lock — prevent changes'}
                  >
                    {scene.locked ? 'Locked' : 'Lock'}
                  </button>
                </div>
              )}
            </div>

            {/* ── Rewrite input ──────────────────────────────────── */}
            {viewMode === 'prose' && showRewrite && hasProse && !isProseLoading && (
              <div className="mx-0 mb-4 px-4 py-3 rounded-lg bg-cyan-500/5 border border-cyan-500/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] uppercase tracking-widest text-cyan-400/60">Rewrite</span>
                  <button onClick={() => setShowRewrite(false)} className="text-[9px] text-text-dim/40 hover:text-text-dim transition">&times;</button>
                </div>
                <textarea
                  value={rewriteAnalysis}
                  onChange={(e) => setRewriteAnalysis(e.target.value)}
                  placeholder="Paste 3rd-party analysis or write your own critique to guide the rewrite..."
                  className="w-full h-24 bg-black/20 border border-white/5 rounded text-[11px] text-text-secondary p-2 resize-y outline-none focus:border-cyan-500/20 placeholder:text-text-dim/30"
                />
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-text-dim/60">Past</span>
                      {[0, 1, 3, 5].map((n) => (
                        <button
                          key={n}
                          onClick={() => setContextPast(n)}
                          className={`text-[9px] w-5 h-5 rounded transition ${
                            contextPast === n
                              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                              : 'text-text-dim/50 hover:text-text-dim border border-white/5 hover:border-white/10'
                          }`}
                          title={n === 0 ? 'Last paragraph only' : `${n} scene${n > 1 ? 's' : ''} before`}
                        >
                          {n || '—'}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-text-dim/60">Future</span>
                      {[0, 1, 3, 5].map((n) => (
                        <button
                          key={n}
                          onClick={() => setContextFuture(n)}
                          className={`text-[9px] w-5 h-5 rounded transition ${
                            contextFuture === n
                              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                              : 'text-text-dim/50 hover:text-text-dim border border-white/5 hover:border-white/10'
                          }`}
                          title={n === 0 ? 'First paragraph only' : `${n} scene${n > 1 ? 's' : ''} after`}
                        >
                          {n || '—'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => { rewriteScene(scene, rewriteAnalysis, contextPast, contextFuture, referenceSceneIds.length > 0 ? referenceSceneIds : undefined); setShowRewrite(false); setRewriteAnalysis(''); setReferenceSceneIds([]); }}
                    disabled={!rewriteAnalysis.trim()}
                    className="text-[9px] px-3 py-1 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/15 transition disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Rewrite
                  </button>
                </div>
                {/* Reference chapters link */}
                <div className="mt-2 pt-2 border-t border-white/5 flex items-center gap-2">
                  <button
                    onClick={() => setRefPickerOpen(true)}
                    className="text-[9px] text-text-dim/60 hover:text-cyan-400 transition"
                  >
                    {referenceSceneIds.length > 0
                      ? `${referenceSceneIds.length} pinned chapter${referenceSceneIds.length > 1 ? 's' : ''}`
                      : 'Pin reference chapters...'}
                  </button>
                  {referenceSceneIds.length > 0 && (
                    <button onClick={() => setReferenceSceneIds([])} className="text-[9px] text-text-dim/30 hover:text-text-dim transition">clear</button>
                  )}
                </div>
              </div>
            )}

            {/* ── Rewrite changelog (shown after custom analysis rewrite) ── */}
            {rewriteChangelogs[scene.id] && (
              <div className="mx-0 mb-4 px-4 py-3 rounded-lg bg-cyan-500/5 border border-cyan-500/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] uppercase tracking-widest text-cyan-400/60">Rewrite Summary</span>
                  <button
                    onClick={() => setRewriteChangelogs((prev) => { const next = { ...prev }; delete next[scene.id]; return next; })}
                    className="text-[9px] text-text-dim/40 hover:text-text-dim transition"
                  >
                    &times;
                  </button>
                </div>
                <p className="text-[11px] text-text-secondary leading-relaxed whitespace-pre-wrap">{rewriteChangelogs[scene.id]}</p>
              </div>
            )}

            {/* ── SUMMARY VIEW ───────────────────────────────────────── */}
            {viewMode === 'summary' && (
              <div>
                <h3 className="text-base text-text-primary font-medium leading-relaxed mb-6">{scene.summary}</h3>
                <div className="flex items-center gap-4 text-[10px] text-text-dim mb-8">
                  {location && (
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                      {location.name}
                    </span>
                  )}
                  {pov && (
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                      {pov.name}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                    {scene.participantIds.map((pid) => narrative.characters[pid]?.name ?? pid).join(', ')}
                  </span>
                </div>

                {/* Events */}
                {scene.events.length > 0 && (
                  <div className="mb-6">
                    <h4 className="text-[9px] uppercase tracking-widest text-text-dim mb-2">Events</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {scene.events.map((e, i) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-text-dim">{e}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mutations summary */}
                {(scene.threadMutations.length > 0 || scene.continuityMutations.length > 0 || scene.relationshipMutations.length > 0 || (scene.worldKnowledgeMutations && (scene.worldKnowledgeMutations.addedNodes.length > 0 || scene.worldKnowledgeMutations.addedEdges.length > 0))) && (
                  <div className="space-y-4">
                    {scene.threadMutations.length > 0 && (
                      <div>
                        <h4 className="text-[9px] uppercase tracking-widest text-text-dim mb-2">Thread Shifts</h4>
                        {scene.threadMutations.map((tm, i) => {
                          const thread = narrative.threads[tm.threadId];
                          return <p key={i} className="text-[11px] text-text-secondary leading-relaxed">{thread?.description ?? tm.threadId}: {tm.from} &rarr; {tm.to}</p>;
                        })}
                      </div>
                    )}
                    {scene.continuityMutations.length > 0 && (
                      <div>
                        <h4 className="text-[9px] uppercase tracking-widest text-text-dim mb-2">Knowledge Changes</h4>
                        {scene.continuityMutations.map((km, i) => {
                          const char = narrative.characters[km.characterId];
                          return <p key={i} className="text-[11px] text-text-secondary leading-relaxed">{char?.name ?? km.characterId} {km.action === 'added' ? 'learns' : 'loses'}: {km.content}</p>;
                        })}
                      </div>
                    )}
                    {scene.relationshipMutations.length > 0 && (
                      <div>
                        <h4 className="text-[9px] uppercase tracking-widest text-text-dim mb-2">Relationship Shifts</h4>
                        {scene.relationshipMutations.map((rm, i) => {
                          const fromName = narrative.characters[rm.from]?.name ?? rm.from;
                          const toName = narrative.characters[rm.to]?.name ?? rm.to;
                          return <p key={i} className="text-[11px] text-text-secondary leading-relaxed">{fromName} &rarr; {toName}: {rm.type} ({rm.valenceDelta >= 0 ? '+' : ''}{Math.round(rm.valenceDelta * 100) / 100})</p>;
                        })}
                      </div>
                    )}
                    {scene.worldKnowledgeMutations && (scene.worldKnowledgeMutations.addedNodes.length > 0 || scene.worldKnowledgeMutations.addedEdges.length > 0) && (
                      <div>
                        <h4 className="text-[9px] uppercase tracking-widest text-text-dim mb-2">World Knowledge</h4>
                        {scene.worldKnowledgeMutations.addedNodes.map((n, i) => (
                          <p key={`n${i}`} className="text-[11px] text-text-secondary leading-relaxed">{n.type}: {n.concept}</p>
                        ))}
                        {scene.worldKnowledgeMutations.addedEdges.map((e, i) => {
                          const fromNode = scene.worldKnowledgeMutations!.addedNodes.find((n) => n.id === e.from) ?? narrative.worldKnowledge.nodes[e.from];
                          const toNode = scene.worldKnowledgeMutations!.addedNodes.find((n) => n.id === e.to) ?? narrative.worldKnowledge.nodes[e.to];
                          const fromLabel = fromNode?.concept ?? e.from;
                          const toLabel = toNode?.concept ?? e.to;
                          return <p key={`e${i}`} className="text-[11px] text-text-secondary leading-relaxed">{fromLabel} &rarr; {toLabel}: {e.relation}</p>;
                        })}
                      </div>
                    )}
                    {scene.characterMovements && Object.keys(scene.characterMovements).length > 0 && (
                      <div>
                        <h4 className="text-[9px] uppercase tracking-widest text-text-dim mb-2">Movements</h4>
                        {Object.entries(scene.characterMovements).map(([charId, movement], i) => {
                          const char = narrative.characters[charId];
                          const locId = typeof movement === 'string' ? movement : movement.locationId;
                          const loc = narrative.locations[locId];
                          const transition = typeof movement === 'object' && movement.transition ? ` — ${movement.transition}` : '';
                          return <p key={i} className="text-[11px] text-text-secondary leading-relaxed">{char?.name ?? charId} &rarr; {loc?.name ?? locId}{transition}</p>;
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* CTA to next step */}
                <div className="mt-10 pt-6 border-t border-white/5">
                  {hasPlan ? (
                    <button onClick={() => setViewMode('plan')} className="text-[11px] text-sky-400/80 hover:text-sky-400 transition">
                      View Plan &rarr;
                    </button>
                  ) : (
                    <button
                      onClick={() => setViewMode('plan')}
                      className="text-[11px] text-sky-400/80 hover:text-sky-400 transition"
                    >
                      Generate Plan &rarr;
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── PLAN VIEW ──────────────────────────────────────────── */}
            {viewMode === 'plan' && (
              <>
                {isPlanLoading && !planCached?.plan && (() => {
                  const reasoning = scene ? planReasoning[scene.id] : '';
                  const meta = scene ? planMeta[scene.id] : undefined;
                  return (
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-3 h-3 border-2 border-sky-400/30 border-t-sky-400/80 rounded-full animate-spin" />
                        <span className="text-[9px] text-text-dim">Generating plan...</span>
                        {meta && (
                          <span className="text-[9px] text-text-dim/40">
                            {meta.targetBeats} beats &middot; ~{meta.estWords.toLocaleString()} words
                          </span>
                        )}
                      </div>
                      {reasoning && (
                        <p className="text-[11px] text-text-dim/60 leading-relaxed whitespace-pre-wrap">{reasoning}</p>
                      )}
                    </div>
                  );
                })()}

                {hasPlanError && (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <p className="text-[11px] text-red-400/80">{planCached?.error}</p>
                    <button
                      onClick={() => generatePlan(scene)}
                      className="text-[11px] px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-text-secondary hover:text-text-primary hover:bg-white/8 transition"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {hasPlan && !isPlanLoading && !hasPlanError && activePlan && (() => {
                  const FN_COLORS: Record<string, string> = {
                    breathe: '#6b7280', inform: '#3b82f6', advance: '#22c55e', bond: '#ec4899',
                    turn: '#f59e0b', reveal: '#a855f7', shift: '#ef4444', expand: '#06b6d4',
                    foreshadow: '#84cc16', resolve: '#14b8a6',
                  };
                  const MECH_ICONS: Record<string, string> = {
                    dialogue: '💬', thought: '💭', action: '⚡', environment: '🌍',
                    narration: '📖', memory: '🔙', document: '📄', comic: '😄',
                  };

                  const updateBeat = (beatIdx: number, updates: Partial<Beat>) => {
                    const newBeats = activePlan.beats.map((b, i) => i === beatIdx ? { ...b, ...updates } : b);
                    const newPlan: BeatPlan = { ...activePlan, beats: newBeats };
                    setPlanCache((prev) => ({ ...prev, [scene.id]: { plan: newPlan, status: 'ready' } }));
                    dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { plan: newPlan } });
                  };
                  const deleteBeat = (beatIdx: number) => {
                    const newBeats = activePlan.beats.filter((_, i) => i !== beatIdx);
                    const newPlan: BeatPlan = { ...activePlan, beats: newBeats };
                    setPlanCache((prev) => ({ ...prev, [scene.id]: { plan: newPlan, status: 'ready' } }));
                    dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { plan: newPlan } });
                  };
                  const insertBeat = (afterIdx: number) => {
                    const newBeat: Beat = { fn: 'advance', mechanism: 'action', what: '', anchor: '' };
                    const newBeats = [...activePlan.beats];
                    newBeats.splice(afterIdx + 1, 0, newBeat);
                    const newPlan: BeatPlan = { ...activePlan, beats: newBeats };
                    setPlanCache((prev) => ({ ...prev, [scene.id]: { plan: newPlan, status: 'ready' } }));
                    dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { plan: newPlan } });
                  };
                  /* cycleFn / cycleMechanism removed — using dropdowns instead */
                  const updateAnchor = (anchorIdx: number, value: string) => {
                    const newAnchors = activePlan.anchors.map((a, i) => i === anchorIdx ? value : a);
                    const newPlan: BeatPlan = { ...activePlan, anchors: newAnchors };
                    setPlanCache((prev) => ({ ...prev, [scene.id]: { plan: newPlan, status: 'ready' } }));
                    dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { plan: newPlan } });
                  };
                  const deleteAnchor = (anchorIdx: number) => {
                    const newAnchors = activePlan.anchors.filter((_, i) => i !== anchorIdx);
                    const newPlan: BeatPlan = { ...activePlan, anchors: newAnchors };
                    setPlanCache((prev) => ({ ...prev, [scene.id]: { plan: newPlan, status: 'ready' } }));
                    dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { plan: newPlan } });
                  };
                  const addAnchor = () => {
                    const newPlan: BeatPlan = { ...activePlan, anchors: [...activePlan.anchors, ''] };
                    setPlanCache((prev) => ({ ...prev, [scene.id]: { plan: newPlan, status: 'ready' } }));
                    dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { plan: newPlan } });
                  };

                  return (
                    <div className="space-y-3">
                      {/* Beat timeline */}
                      {activePlan.beats.length > 0 && (
                        <div className="space-y-0">
                          {activePlan.beats.map((beat, i) => (
                            <div key={i} className="group relative flex gap-3 py-2.5 px-1 hover:bg-white/2 rounded-lg transition-colors">
                              {/* Timeline connector */}
                              <div className="flex flex-col items-center shrink-0 w-6">
                                <div className="w-2.5 h-2.5 rounded-full border-2 shrink-0" style={{ borderColor: FN_COLORS[beat.fn] ?? '#666', backgroundColor: `${FN_COLORS[beat.fn] ?? '#666'}33` }} />
                                {i < activePlan.beats.length - 1 && <div className="flex-1 w-px bg-white/8 mt-0.5" />}
                              </div>

                              {/* Beat content — editable */}
                              <div className="flex-1 min-w-0 -mt-0.5">
                                <div className="flex items-center gap-2 mb-1">
                                  <select
                                    value={beat.fn}
                                    onChange={(e) => updateBeat(i, { fn: e.target.value as BeatFn })}
                                    className="text-[9px] font-semibold uppercase tracking-wider bg-transparent border-none outline-none cursor-pointer appearance-none pr-3"
                                    style={{ color: FN_COLORS[beat.fn] ?? '#666' }}
                                  >
                                    {BEAT_FN_LIST.map((fn) => (
                                      <option key={fn} value={fn} className="bg-bg-panel text-text-primary">{fn}</option>
                                    ))}
                                  </select>
                                  <select
                                    value={beat.mechanism}
                                    onChange={(e) => updateBeat(i, { mechanism: e.target.value as BeatMechanism })}
                                    className="text-[9px] text-text-dim/50 bg-transparent border-none outline-none cursor-pointer appearance-none pr-3"
                                  >
                                    {BEAT_MECHANISM_LIST.map((m) => (
                                      <option key={m} value={m} className="bg-bg-panel text-text-primary">{(MECH_ICONS[m] ?? '•') + ' ' + m}</option>
                                    ))}
                                  </select>
                                  <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => insertBeat(i)}
                                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-emerald-500/15 text-text-dim/40 hover:text-emerald-400 transition-all"
                                      title="Insert beat after"
                                    >
                                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="5" y1="1" x2="5" y2="9"/><line x1="1" y1="5" x2="9" y2="5"/></svg>
                                    </button>
                                    <button
                                      onClick={() => deleteBeat(i)}
                                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/15 text-text-dim/40 hover:text-red-400 transition-all"
                                      title="Delete beat"
                                    >
                                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/></svg>
                                    </button>
                                    <span className="text-[8px] text-text-dim/30 font-mono ml-0.5">{i + 1}/{activePlan.beats.length}</span>
                                  </div>
                                </div>
                                <p
                                  contentEditable
                                  suppressContentEditableWarning
                                  className="text-[11px] text-text-secondary leading-relaxed outline-none focus:bg-white/3 rounded px-1 -mx-1"
                                  onBlur={(e) => {
                                    const text = e.currentTarget.textContent ?? '';
                                    if (text !== beat.what) updateBeat(i, { what: text });
                                  }}
                                >
                                  {beat.what}
                                </p>
                                <p
                                  contentEditable
                                  suppressContentEditableWarning
                                  className="text-[10px] text-text-dim/60 mt-0.5 italic outline-none focus:bg-white/3 rounded px-1 -mx-1"
                                  onBlur={(e) => {
                                    const text = e.currentTarget.textContent ?? '';
                                    if (text !== beat.anchor) updateBeat(i, { anchor: text });
                                  }}
                                  data-placeholder="anchor..."
                                >
                                  {beat.anchor}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add beat button */}
                      <button
                        onClick={() => insertBeat(activePlan.beats.length - 1)}
                        className="text-[9px] text-text-dim/40 hover:text-emerald-400/60 transition-colors w-full text-center py-1"
                      >
                        + Add beat
                      </button>

                      {/* Anchors — editable */}
                      {(activePlan.anchors.length > 0 || true) && (
                        <div className="mt-2 pt-3 border-t border-white/5">
                          <h4 className="text-[9px] uppercase tracking-widest text-amber-400/50 mb-2">Anchor Lines</h4>
                          <div className="space-y-2">
                            {activePlan.anchors.map((a, i) => (
                              <div key={i} className="group/anchor pl-3 border-l-2 border-amber-400/30 flex items-start gap-1">
                                <p
                                  contentEditable
                                  suppressContentEditableWarning
                                  className="flex-1 text-[11px] text-amber-300/80 leading-relaxed italic outline-none focus:bg-white/3 rounded px-1 -mx-1"
                                  onBlur={(e) => {
                                    const text = e.currentTarget.textContent ?? '';
                                    if (text !== a) updateAnchor(i, text);
                                  }}
                                >
                                  {a}
                                </p>
                                <button
                                  onClick={() => deleteAnchor(i)}
                                  className="text-[9px] text-text-dim/20 hover:text-red-400 opacity-0 group-hover/anchor:opacity-100 transition-all shrink-0 mt-0.5"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={addAnchor}
                              className="text-[9px] text-amber-400/30 hover:text-amber-400/60 transition-colors"
                            >
                              + Add anchor line
                            </button>
                          </div>
                        </div>
                      )}

                      {activePlan.beats.length === 0 && activePlan.anchors.length === 0 && (
                        <p className="text-[11px] text-text-dim py-8 text-center">Plan is empty.</p>
                      )}
                    </div>
                  );
                })()}

                {!hasPlan && !isPlanLoading && !hasPlanError && (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <p className="text-[11px] text-text-dim">No plan yet for this scene.</p>
                    <button
                      onClick={() => generatePlan(scene)}
                      className="text-[11px] px-5 py-2 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 hover:bg-sky-500/15 transition"
                    >
                      Generate Plan
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── PROSE VIEW ─────────────────────────────────────────── */}
            {viewMode === 'prose' && (
              <>
                {isProseLoading && !proseCached?.text && (() => {
                  const est = scene ? sceneScale(scene).estWords : undefined;
                  return (
                    <div className="flex items-center gap-2 mb-6">
                      <div className="w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                      <span className="text-[9px] text-text-dim">Generating prose...</span>
                      {est && (
                        <span className="text-[9px] text-text-dim/40">~{est.toLocaleString()} words</span>
                      )}
                    </div>
                  );
                })()}

                {isProseLoading && proseCached?.text && (
                  <div className="prose-content">
                    <div className="flex items-center gap-2 mb-6">
                      <div className="w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                      <span className="text-[9px] text-text-dim">Writing...</span>
                    </div>
                    {proseCached.text.split('\n\n').map((paragraph, i) => (
                      <p key={i} className="text-[13px] text-text-secondary leading-[1.8] mb-5 first:first-letter:text-2xl first:first-letter:font-semibold first:first-letter:text-text-primary first:first-letter:mr-0.5">{paragraph}</p>
                    ))}
                  </div>
                )}

                {hasProseError && (
                  <div className="py-12 text-center">
                    <p className="text-[11px] text-red-400/80 mb-3">{proseCached?.error}</p>
                    <button onClick={() => generateProse(scene)} className="text-[10px] px-4 py-1.5 rounded-full border border-white/10 text-text-dim hover:text-text-secondary transition">Retry</button>
                  </div>
                )}

                {hasProse && !isProseLoading && (
                  <div className="prose-content">
                    {proseCached!.text.split('\n\n').map((paragraph, i) => (
                      <p key={i} className="text-[13px] text-text-secondary leading-[1.8] mb-5 first:first-letter:text-2xl first:first-letter:font-semibold first:first-letter:text-text-primary first:first-letter:mr-0.5">{paragraph}</p>
                    ))}
                  </div>
                )}

                {!hasProse && !isProseLoading && !hasProseError && (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    {hasPlan ? (
                      <>
                        <p className="text-[11px] text-text-dim">This scene hasn&apos;t been written yet.</p>
                        <button
                          onClick={() => generateProse(scene)}
                          className="text-[11px] px-5 py-2 rounded-full bg-white/8 border border-white/10 text-text-secondary hover:text-text-primary hover:bg-white/12 transition"
                        >
                          Generate Prose
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-[11px] text-text-dim">Create a plan first, then generate prose.</p>
                        <button
                          onClick={() => setViewMode('plan')}
                          className="text-[11px] text-sky-400/80 hover:text-sky-400 transition"
                        >
                          Go to Plan &rarr;
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Footer navigation */}
      <div className="relative z-10 px-6 py-3 border-t border-white/8 bg-black/40 backdrop-blur-sm flex items-center justify-between shrink-0">
        <button
          onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          disabled={currentIndex === 0}
          className="text-[10px] px-3.5 py-1.5 rounded-full border border-white/8 text-text-dim hover:text-text-secondary hover:border-white/12 transition disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1.5"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          Previous
        </button>
        <div className="text-[9px] text-text-dim/50">Arrow keys to navigate &middot; Esc to close</div>
        <button
          onClick={() => setCurrentIndex((i) => Math.min(scenes.length - 1, i + 1))}
          disabled={currentIndex === scenes.length - 1}
          className="text-[10px] px-3.5 py-1.5 rounded-full border border-white/8 text-text-dim hover:text-text-secondary hover:border-white/12 transition disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1.5"
        >
          Next
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>

      {/* Reference chapter picker modal */}
      {refPickerOpen && (
        <div className="fixed inset-0 bg-black/80 z-60 flex items-center justify-center" onClick={() => setRefPickerOpen(false)}>
          <div className="glass max-w-lg w-full rounded-2xl p-6 relative max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setRefPickerOpen(false)} className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none">&times;</button>
            <h2 className="text-sm font-semibold text-text-primary mb-1">Pin Reference Chapters</h2>
            <p className="text-[10px] text-text-dim mb-3">Select chapters whose prose the rewriter should see as context.</p>
            <div className="flex-1 overflow-y-auto min-h-0 space-y-0.5 pr-1">
              {scenes.map((s, i) => {
                if (s.id === scene.id) return null;
                if (!s.prose) return null;
                const selected = referenceSceneIds.includes(s.id);
                const sArc = Object.values(narrative.arcs).find((a) => a.sceneIds.includes(s.id));
                return (
                  <button
                    key={s.id}
                    onClick={() => setReferenceSceneIds((prev) =>
                      selected ? prev.filter((id) => id !== s.id) : [...prev, s.id]
                    )}
                    className={`w-full text-left px-3 py-2 rounded-lg transition flex items-center gap-3 ${
                      selected ? 'bg-cyan-500/10 border border-cyan-500/20' : 'hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <span className={`text-[10px] font-mono w-6 shrink-0 ${selected ? 'text-cyan-400' : 'text-text-dim/50'}`}>{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[11px] truncate ${selected ? 'text-text-primary' : 'text-text-secondary'}`}>{s.summary.slice(0, 80)}</p>
                      {sArc && <p className="text-[9px] text-text-dim/50">{sArc.name}</p>}
                    </div>
                    {selected && <span className="text-[9px] text-cyan-400 shrink-0">pinned</span>}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between items-center mt-4 pt-3 border-t border-white/5 shrink-0">
              <span className="text-[10px] text-text-dim">{referenceSceneIds.length} selected</span>
              <button onClick={() => setRefPickerOpen(false)} className="text-[10px] px-3 py-1.5 rounded-md bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition font-semibold">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings modal (nested inside StoryReader) */}
      {settingsOpen && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center" onClick={() => setSettingsOpen(false)}>
          <div className="glass max-w-md w-full rounded-2xl p-6 relative max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setSettingsOpen(false)}
              className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none"
            >
              &times;
            </button>

            <h2 className="text-sm font-semibold text-text-primary mb-1">Prose & Plan Settings</h2>
            <p className="text-[10px] text-text-dim uppercase tracking-wider mb-3">
              Shape how prose and plans are generated
            </p>

            {/* Tabs */}
            <div className="flex gap-1 bg-bg-elevated rounded-lg p-0.5 mb-4 shrink-0">
              {(['prose', 'plan'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setSettingsTab(t)}
                  className={`flex-1 text-[11px] py-1.5 rounded-md transition-colors capitalize ${
                    settingsTab === t
                      ? 'bg-white/10 text-text-primary font-semibold'
                      : 'text-text-dim hover:text-text-secondary'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-1">
              {settingsTab === 'prose' && (
                <div>
                  <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                    Voice & Style
                  </label>
                  <textarea
                    value={settingsDraft.proseVoice}
                    onChange={(e) => setSettingsDraft((s) => ({ ...s, proseVoice: e.target.value }))}
                    placeholder='e.g. "Terse, Hemingway-esque. Short declarative sentences. Sparse dialogue. Emotion through physical action, never named. Dry humour buried in understatement."'
                    className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-blue-500/40 resize-none h-32"
                  />
                  <p className="text-[9px] text-text-dim/50 mt-1">
                    Describe the prose voice you want the AI to mimic. This shapes all prose generation and rewrites.
                  </p>
                </div>
              )}

              {settingsTab === 'plan' && (
                <div>
                  <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">
                    Plan Guidance
                  </label>
                  <textarea
                    value={settingsDraft.planGuidance}
                    onChange={(e) => setSettingsDraft((s) => ({ ...s, planGuidance: e.target.value }))}
                    placeholder='e.g. "Plans should emphasize character interiority over plot mechanics. Include specific dialogue seeds. Each delivery should have a clear emotional shift."'
                    className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-blue-500/40 resize-none h-32"
                  />
                  <p className="text-[9px] text-text-dim/50 mt-1">
                    Shape how scene plans are structured. Plans are delivery-by-delivery blueprints that guide prose generation.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-white/5 shrink-0">
              <button
                onClick={() => setSettingsOpen(false)}
                className="text-[10px] px-3 py-1.5 rounded-md bg-white/5 text-text-dim hover:text-text-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  dispatch({ type: 'SET_STORY_SETTINGS', settings: settingsDraft });
                  setSettingsOpen(false);
                }}
                className="text-[10px] px-3 py-1.5 rounded-md bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors font-semibold"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
