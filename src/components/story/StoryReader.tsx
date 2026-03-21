'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { NarrativeState, Scene, StorySettings } from '@/types/narrative';
import { resolveEntry, isScene, DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { generateSceneProse, generateScenePlan, reconcileScenePlans, scoreSceneProse, rewriteSceneProse, type ReconcileRevision } from '@/lib/ai';
import { useStore } from '@/lib/store';
import { exportEpub } from '@/lib/epub-export';
import { PROSE_CONCURRENCY, PLAN_CONCURRENCY } from '@/lib/constants';

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
  const [planCache, setPlanCache] = useState<ContentCache>({});
  const [editedPlan, setEditedPlan] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const activeSceneRef = useRef<HTMLButtonElement>(null);
  const [proseBulk, setProseBulk] = useState<BulkState>(null);
  const [planBulk, setPlanBulk] = useState<BulkState>(null);
  const [reconcileState, setReconcileState] = useState<'idle' | 'running' | 'done'>('idle');
  const [reconcileResults, setReconcileResults] = useState<{ sceneId: string; reason: string }[]>([]);
  const bulkCancelledRef = useRef(false);
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<StorySettings>({
    ...DEFAULT_STORY_SETTINGS,
    ...narrative.storySettings,
  });
  const [settingsTab, setSettingsTab] = useState<'prose' | 'plan'>('prose');

  const scene = scenes[currentIndex];
  const arc = scene ? Object.values(narrative.arcs).find((a) => a.sceneIds.includes(scene.id)) : null;
  const location = scene ? narrative.locations[scene.locationId] : null;
  const pov = scene ? narrative.characters[scene.povId] : null;
  const sceneKeyIndex = scene ? resolvedKeys.indexOf(scene.id) : -1;

  // ── Plan generation ──────────────────────────────────────────────────
  const generatePlan = useCallback(async (s: Scene, idx: number) => {
    setPlanCache((prev) => ({ ...prev, [s.id]: { text: '', status: 'loading' } }));
    try {
      const plan = await generateScenePlan(narrative, s, idx, resolvedKeys, (token) => {
        setPlanCache((prev) => {
          const existing = prev[s.id];
          return { ...prev, [s.id]: { text: (existing?.text ?? '') + token, status: 'loading' } };
        });
      });
      setPlanCache((prev) => ({ ...prev, [s.id]: { text: plan, status: 'ready' } }));
      dispatch({ type: 'UPDATE_SCENE', sceneId: s.id, updates: { plan } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPlanCache((prev) => ({ ...prev, [s.id]: { text: '', status: 'error', error: message } }));
    }
  }, [narrative, resolvedKeys, dispatch]);

  // ── Prose generation ─────────────────────────────────────────────────
  const generateProse = useCallback(async (s: Scene, idx: number) => {
    setProseCache((prev) => ({ ...prev, [s.id]: { text: '', status: 'loading' } }));
    try {
      const prose = await generateSceneProse(narrative, s, idx, resolvedKeys, (token) => {
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

  // ── Grade (score only) ──────────────────────────────────────────────
  const [grading, setGrading] = useState<string | null>(null); // sceneId currently grading
  const [customAnalysis, setCustomAnalysis] = useState('');
  const [showCustomAnalysis, setShowCustomAnalysis] = useState(false);

  const gradeScene = useCallback(async (s: Scene) => {
    const currentProse = proseCache[s.id]?.status === 'ready' ? proseCache[s.id].text : s.prose;
    if (!currentProse) return;
    setGrading(s.id);
    try {
      const score = await scoreSceneProse(narrative, s, currentProse);
      dispatch({ type: 'UPDATE_SCENE', sceneId: s.id, updates: { proseScore: score } });
    } catch {
      // Grade failure is non-destructive — prose is unchanged
    } finally {
      setGrading(null);
    }
  }, [narrative, proseCache, dispatch]);

  // ── Rewrite (using grade critique or custom analysis) ──────────────
  const rewriteScene = useCallback(async (s: Scene, analysis: string) => {
    const currentProse = proseCache[s.id]?.status === 'ready' ? proseCache[s.id].text : s.prose;
    if (!currentProse) return;
    setProseCache((prev) => ({ ...prev, [s.id]: { text: currentProse, status: 'loading' } }));
    try {
      const prose = await rewriteSceneProse(narrative, s, resolvedKeys, currentProse, analysis);
      setProseCache((prev) => ({ ...prev, [s.id]: { text: prose, status: 'ready' } }));
      dispatch({ type: 'UPDATE_SCENE', sceneId: s.id, updates: { prose, proseScore: undefined } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setProseCache((prev) => ({ ...prev, [s.id]: { text: currentProse, status: 'error', error: message } }));
    }
  }, [narrative, resolvedKeys, proseCache, dispatch]);

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
    runBulk(missing, PLAN_CONCURRENCY, async (s) => {
      const idx = resolvedKeys.indexOf(s.id);
      await generatePlan(s, idx);
    }, setPlanBulk);
  }, [scenes, planCache, resolvedKeys, generatePlan, runBulk]);

  const bulkProse = useCallback(() => {
    // Only generate prose for scenes that have plans but no prose yet
    const missing = scenes.filter((s) =>
      (s.plan || planCache[s.id]?.status === 'ready') &&
      !s.prose && proseCache[s.id]?.status !== 'ready'
    );
    runBulk(missing, PROSE_CONCURRENCY, async (s) => {
      const idx = resolvedKeys.indexOf(s.id);
      await generateProse(s, idx);
    }, setProseBulk);
  }, [scenes, planCache, proseCache, resolvedKeys, generateProse, runBulk]);

  const reconcile = useCallback(async () => {
    const plans: { sceneId: string; plan: string }[] = [];
    for (const s of scenes) {
      const plan = planCache[s.id]?.status === 'ready' ? planCache[s.id].text : s.plan;
      if (plan) plans.push({ sceneId: s.id, plan });
    }
    if (plans.length < 2) return;
    setReconcileState('running');
    setReconcileResults([]);
    try {
      const revised = await reconcileScenePlans(narrative, plans);
      const results: { sceneId: string; reason: string }[] = [];
      for (const [sceneId, rev] of Object.entries(revised)) {
        setPlanCache((prev) => ({ ...prev, [sceneId]: { text: rev.plan, status: 'ready' } }));
        dispatch({ type: 'UPDATE_SCENE', sceneId, updates: { plan: rev.plan } });
        results.push({ sceneId, reason: rev.reason });
      }
      setReconcileResults(results);
      setReconcileState('done');
    } catch (err) {
      console.error('[reconcile] failed:', err);
      setReconcileState('idle');
    }
  }, [scenes, planCache, narrative, dispatch]);

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
      setPlanCache((prev) => ({ ...prev, [scene.id]: { text: scene.plan!, status: 'ready' } }));
    }
  }, [scene, proseCache, planCache]);

  // Reset edited plan when changing scenes
  useEffect(() => { setEditedPlan(null); setShowCustomAnalysis(false); setCustomAnalysis(''); }, [currentIndex]);

  useEffect(() => { activeSceneRef.current?.scrollIntoView({ block: 'center' }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
      <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
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
  const sceneScore = scene?.proseScore && typeof scene.proseScore.overall === 'number' ? scene.proseScore : undefined;

  // Score averages for header
  const scoredScenes = scenes.filter((s) => s.proseScore);
  const avgScore = scoredScenes.length > 0
    ? Math.round(scoredScenes.reduce((sum, s) => sum + (s.proseScore?.overall ?? 0), 0) / scoredScenes.length * 10) / 10
    : null;

  const isAnyBulkRunning = !!(proseBulk?.running || planBulk?.running);
  const activeBulk = proseBulk?.running ? proseBulk : planBulk?.running ? planBulk : null;

  const planText = editedPlan ?? planCached?.text ?? scene?.plan ?? '';

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
      <div className="relative z-10 px-6 py-4 border-b border-white/8 bg-black/40 backdrop-blur-sm flex items-center justify-between shrink-0">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold text-text-primary">{narrative.title}</h2>
          {arc && <span className="text-[11px] text-text-dim">{arc.name}</span>}
          {avgScore !== null && (
            <span className={`text-[10px] font-mono ${scoreColor(avgScore)}`} title="Average prose score">
              Avg: {avgScore}
            </span>
          )}
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

              {/* Reconcile */}
              {(() => {
                const plannedCount = scenes.filter((s) => s.plan || planCache[s.id]?.status === 'ready').length;
                if (plannedCount < 2) return null;

                if (reconcileState === 'done' && reconcileResults.length > 0) {
                  return (
                    <div className="relative flex items-center gap-2">
                      <span className="text-[10px] text-sky-400/70">{reconcileResults.length} plan{reconcileResults.length !== 1 ? 's' : ''} revised</span>
                      <button
                        onClick={() => setReconcileState('idle')}
                        className="text-[9px] text-text-dim hover:text-text-secondary transition"
                        title="Dismiss"
                      >
                        &times;
                      </button>
                    </div>
                  );
                }
                if (reconcileState === 'done' && reconcileResults.length === 0) {
                  return (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-emerald-400/60">Plans are coherent</span>
                      <button onClick={() => setReconcileState('idle')} className="text-[9px] text-text-dim hover:text-text-secondary transition">&times;</button>
                    </div>
                  );
                }

                return (
                  <button
                    onClick={reconcile}
                    disabled={reconcileState === 'running'}
                    className="text-[10px] px-2.5 py-1 rounded-full border border-white/10 text-text-dim hover:text-sky-400 hover:border-sky-400/20 transition flex items-center gap-1.5 disabled:opacity-30"
                    title="Reconcile plans for cross-scene coherence"
                  >
                    {reconcileState === 'running' ? (
                      <div className="w-3 h-3 border-2 border-sky-400/30 border-t-sky-400/80 rounded-full animate-spin" />
                    ) : (
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></svg>
                    )}
                    Reconcile
                  </button>
                );
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

              {/* Copy All */}
              {(() => {
                const allProse = scenes.filter((s) => proseCache[s.id]?.status === 'ready' || !!s.prose);
                return allProse.length > 0 ? (
                  <button
                    onClick={() => {
                      const text = scenes.map((s) => proseCache[s.id]?.status === 'ready' ? proseCache[s.id].text : s.prose).filter(Boolean).join('\n\n');
                      navigator.clipboard.writeText(text);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="text-[10px] px-2.5 py-1 rounded-full border border-white/10 text-text-dim hover:text-text-secondary hover:border-white/15 transition flex items-center gap-1.5"
                  >
                    {copied ? <span className="text-emerald-400">Copied</span> : <>Copy ({allProse.length})</>}
                  </button>
                ) : null;
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

              {/* Score indicator — small dot in tab bar when grade exists */}
              {sceneScore && viewMode === 'prose' && (
                <span className={`ml-auto text-[9px] font-mono ${scoreColor(sceneScore.overall)}`}>{String(sceneScore.overall)}</span>
              )}

              {/* Context actions — shown in tab bar, right-aligned */}
              {viewMode === 'plan' && hasPlan && !isPlanLoading && (
                <div className="ml-auto flex items-center gap-1.5">
                  {editedPlan !== null && (
                    <button
                      onClick={() => {
                        dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { plan: editedPlan } });
                        setPlanCache((prev) => ({ ...prev, [scene.id]: { text: editedPlan, status: 'ready' } }));
                        setEditedPlan(null);
                      }}
                      className="text-[9px] px-2 py-1 rounded text-sky-400 hover:bg-sky-500/10 transition"
                    >
                      Save
                    </button>
                  )}
                  <button
                    onClick={() => {
                      dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { plan: undefined, prose: undefined, proseScore: undefined } });
                      setPlanCache((prev) => { const next = { ...prev }; delete next[scene.id]; return next; });
                      setProseCache((prev) => { const next = { ...prev }; delete next[scene.id]; return next; });
                      setEditedPlan(null);
                      generatePlan(scene, sceneKeyIndex);
                    }}
                    className="text-[9px] px-2 py-1 rounded text-text-dim hover:text-text-secondary hover:bg-white/5 transition"
                  >
                    Regenerate
                  </button>
                  <button
                    onClick={() => {
                      // Save any unsaved edits first
                      if (editedPlan !== null) {
                        dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { plan: editedPlan } });
                        setPlanCache((prev) => ({ ...prev, [scene.id]: { text: editedPlan, status: 'ready' } }));
                        setEditedPlan(null);
                      }
                      setViewMode('prose');
                      if (!hasProse) generateProse(scene, sceneKeyIndex);
                    }}
                    className="text-[9px] px-2 py-1 rounded text-sky-400/80 hover:text-sky-400 hover:bg-sky-500/10 transition"
                  >
                    Write Prose &rarr;
                  </button>
                  <button
                    onClick={() => {
                      dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { plan: undefined, prose: undefined, proseScore: undefined } });
                      setPlanCache((prev) => { const next = { ...prev }; delete next[scene.id]; return next; });
                      setProseCache((prev) => { const next = { ...prev }; delete next[scene.id]; return next; });
                      setEditedPlan(null);
                    }}
                    className="text-[9px] px-2 py-1 rounded text-text-dim/50 hover:text-red-400/80 hover:bg-red-500/5 transition"
                  >
                    Clear
                  </button>
                </div>
              )}
              {viewMode === 'prose' && hasProse && !isProseLoading && (
                <div className={`${sceneScore ? '' : 'ml-auto'} flex items-center gap-1.5 ${sceneScore ? 'ml-2' : ''}`}>
                  <button
                    onClick={() => gradeScene(scene)}
                    disabled={grading === scene.id}
                    className="text-[9px] px-2 py-1 rounded text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/10 transition disabled:opacity-50"
                  >
                    {grading === scene.id ? 'Grading...' : 'Grade'}
                  </button>
                  <button
                    onClick={() => rewriteScene(scene, sceneScore?.critique ?? '')}
                    disabled={!sceneScore}
                    title={!sceneScore ? 'Grade the scene first' : 'Rewrite using grade critique'}
                    className="text-[9px] px-2 py-1 rounded text-violet-400/80 hover:text-violet-400 hover:bg-violet-500/10 transition disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Rewrite
                  </button>
                  <button
                    onClick={() => setShowCustomAnalysis((v) => !v)}
                    title="Rewrite using custom analysis"
                    className={`text-[9px] px-2 py-1 rounded transition ${showCustomAnalysis ? 'text-cyan-400 bg-cyan-500/10' : 'text-cyan-400/60 hover:text-cyan-400 hover:bg-cyan-500/10'}`}
                  >
                    Custom
                  </button>
                  <button
                    onClick={() => { dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { prose: undefined, proseScore: undefined } }); generateProse(scene, sceneKeyIndex); }}
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
                </div>
              )}
            </div>

            {/* ── Grade panel — always visible when score exists ──── */}
            {viewMode === 'prose' && sceneScore && (
              <div className="mx-0 mb-4 px-4 py-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[9px] uppercase tracking-widest text-amber-400/60">Grade</span>
                  <div className="flex items-center gap-2 text-[9px] font-mono">
                    <span className={scoreColor(sceneScore.overall)}>{String(sceneScore.overall)}</span>
                    <span className="text-text-dim/30">|</span>
                    <span title="Voice" className="text-text-dim">V:{String(sceneScore.voice)}</span>
                    <span title="Pacing" className="text-text-dim">P:{String(sceneScore.pacing)}</span>
                    <span title="Dialogue" className="text-text-dim">D:{String(sceneScore.dialogue)}</span>
                    <span title="Sensory" className="text-text-dim">S:{String(sceneScore.sensory)}</span>
                    <span title="Coverage" className="text-text-dim">M:{String(sceneScore.mutation_coverage)}</span>
                  </div>
                </div>
                {sceneScore.critique && (
                  <p className="text-[11px] text-text-secondary leading-relaxed whitespace-pre-wrap">{sceneScore.critique}</p>
                )}
              </div>
            )}

            {/* ── Custom analysis input ────────────────────────────── */}
            {viewMode === 'prose' && showCustomAnalysis && hasProse && !isProseLoading && (
              <div className="mx-0 mb-4 px-4 py-3 rounded-lg bg-cyan-500/5 border border-cyan-500/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] uppercase tracking-widest text-cyan-400/60">Custom Analysis</span>
                  <button onClick={() => setShowCustomAnalysis(false)} className="text-[9px] text-text-dim/40 hover:text-text-dim transition">&times;</button>
                </div>
                <textarea
                  value={customAnalysis}
                  onChange={(e) => setCustomAnalysis(e.target.value)}
                  placeholder="Paste 3rd-party analysis or write your own critique to guide the rewrite..."
                  className="w-full h-24 bg-black/20 border border-white/5 rounded text-[11px] text-text-secondary p-2 resize-y outline-none focus:border-cyan-500/20 placeholder:text-text-dim/30"
                />
                <div className="flex justify-end mt-2">
                  <button
                    onClick={() => { rewriteScene(scene, customAnalysis); setShowCustomAnalysis(false); setCustomAnalysis(''); }}
                    disabled={!customAnalysis.trim()}
                    className="text-[9px] px-3 py-1 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/15 transition disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Rewrite with Analysis
                  </button>
                </div>
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
                {(scene.threadMutations.length > 0 || scene.continuityMutations.length > 0 || scene.relationshipMutations.length > 0) && (
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
                      onClick={() => { setViewMode('plan'); generatePlan(scene, sceneKeyIndex); }}
                      className="text-[11px] px-5 py-2 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 hover:bg-sky-500/15 transition"
                    >
                      Generate Plan
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── PLAN VIEW ──────────────────────────────────────────── */}
            {viewMode === 'plan' && (
              <>
                {isPlanLoading && !planCached?.text && (
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <div className="w-5 h-5 border-2 border-sky-400/30 border-t-sky-400/80 rounded-full animate-spin" />
                    <p className="text-[11px] text-text-dim">Generating plan...</p>
                  </div>
                )}

                {isPlanLoading && planCached?.text && (
                  <div>
                    <div className="flex items-center gap-2 mb-6">
                      <div className="w-3 h-3 border-2 border-sky-400/30 border-t-sky-400/80 rounded-full animate-spin" />
                      <span className="text-[9px] text-text-dim">Planning...</span>
                    </div>
                    {planCached.text.split('\n\n').map((block, i) => (
                      <p key={i} className="text-[13px] text-text-secondary leading-[1.8] mb-5">{block}</p>
                    ))}
                  </div>
                )}

                {hasPlanError && (
                  <div className="py-12 text-center">
                    <p className="text-[11px] text-red-400/80 mb-3">{planCached?.error}</p>
                    <button onClick={() => generatePlan(scene, sceneKeyIndex)} className="text-[10px] px-4 py-1.5 rounded-full border border-white/10 text-text-dim hover:text-text-secondary transition">Retry</button>
                  </div>
                )}

                {hasPlan && !isPlanLoading && !hasPlanError && (
                  <>
                  {/* Reconciliation note */}
                  {(() => {
                    const rev = reconcileResults.find((r) => r.sceneId === scene.id);
                    if (!rev) return null;
                    return (
                      <div className="mb-6 px-4 py-3 rounded-lg bg-sky-500/5 border border-sky-500/10">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[9px] uppercase tracking-widest text-sky-400/60">Reconciled</span>
                        </div>
                        <p className="text-[11px] text-text-secondary leading-relaxed">{rev.reason}</p>
                      </div>
                    );
                  })()}
                  <div
                    className="text-[13px] text-text-secondary leading-[1.8] whitespace-pre-wrap outline-none"
                    contentEditable
                    suppressContentEditableWarning
                    onInput={(e) => setEditedPlan((e.target as HTMLDivElement).innerText)}
                    onBlur={(e) => {
                      const text = (e.target as HTMLDivElement).innerText;
                      if (text !== planText) setEditedPlan(text);
                    }}
                    dangerouslySetInnerHTML={{ __html: planText.replace(/\n/g, '<br>') }}
                  />
                  </>
                )}

                {!hasPlan && !isPlanLoading && !hasPlanError && (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <p className="text-[11px] text-text-dim">No plan yet for this scene.</p>
                    <button
                      onClick={() => generatePlan(scene, sceneKeyIndex)}
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
                {isProseLoading && !proseCached?.text && (
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                    <p className="text-[11px] text-text-dim">Generating prose...</p>
                  </div>
                )}

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
                    <button onClick={() => generateProse(scene, sceneKeyIndex)} className="text-[10px] px-4 py-1.5 rounded-full border border-white/10 text-text-dim hover:text-text-secondary transition">Retry</button>
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
                          onClick={() => generateProse(scene, sceneKeyIndex)}
                          className="text-[11px] px-5 py-2 rounded-full bg-white/8 border border-white/10 text-text-secondary hover:text-text-primary hover:bg-white/12 transition"
                        >
                          Generate Prose
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-[11px] text-text-dim">Create a plan first, then generate prose.</p>
                        <button
                          onClick={() => { setViewMode('plan'); generatePlan(scene, sceneKeyIndex); }}
                          className="text-[11px] px-5 py-2 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 hover:bg-sky-500/15 transition"
                        >
                          Generate Plan
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

      {/* Settings modal (nested inside StoryReader) */}
      {settingsOpen && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center" onClick={() => setSettingsOpen(false)}>
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
