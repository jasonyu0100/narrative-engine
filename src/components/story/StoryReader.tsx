'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { NarrativeState, Scene } from '@/types/narrative';
import { resolveEntry, isScene } from '@/types/narrative';
import { generateSceneProse, analyzeAllProse, rewriteSceneProse, type ProseAnalysis } from '@/lib/ai';
import { useStore } from '@/lib/store';
import { exportEpub } from '@/lib/epub-export';

type ProseCache = Record<string, { text: string; status: 'loading' | 'ready' | 'error'; error?: string }>;

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

  // Map the timeline currentSceneIndex to the index within the filtered scenes array
  const initialIndex = (() => {
    const currentKey = resolvedKeys[currentSceneIndex];
    if (!currentKey) return 0;
    const idx = scenes.findIndex((s) => s.id === currentKey);
    return idx >= 0 ? idx : 0;
  })();

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [proseCache, setProseCache] = useState<ProseCache>({});
  const contentRef = useRef<HTMLDivElement>(null);
  const activeSceneRef = useRef<HTMLButtonElement>(null);
  const [bulkState, setBulkState] = useState<{ running: boolean; completed: number; total: number; errors: number } | null>(null);
  const bulkCancelledRef = useRef(false);
  const [copied, setCopied] = useState(false);

  const scene = scenes[currentIndex];
  const arc = scene ? Object.values(narrative.arcs).find((a) => a.sceneIds.includes(scene.id)) : null;
  const location = scene ? narrative.locations[scene.locationId] : null;
  const pov = scene ? narrative.characters[scene.povId] : null;

  // Find the scene's position in resolvedKeys for context
  const sceneKeyIndex = scene ? resolvedKeys.indexOf(scene.id) : -1;

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

  const bulkGenerate = useCallback(async () => {
    const missing = scenes.filter((s) => !s.prose && proseCache[s.id]?.status !== 'ready');
    if (missing.length === 0) return;

    bulkCancelledRef.current = false;
    setBulkState({ running: true, completed: 0, total: missing.length, errors: 0 });

    let completed = 0;
    let errors = 0;

    // Mark all as loading
    setProseCache((prev) => {
      const next = { ...prev };
      for (const s of missing) next[s.id] = { text: '', status: 'loading' };
      return next;
    });

    // Sliding window pool — keeps CONCURRENCY slots filled continuously
    const CONCURRENCY = 10;
    let nextIdx = 0;

    const processScene = async (s: Scene): Promise<void> => {
      const idx = resolvedKeys.indexOf(s.id);
      try {
        const prose = await generateSceneProse(narrative, s, idx, resolvedKeys, (token) => {
          setProseCache((prev) => {
            const existing = prev[s.id];
            return { ...prev, [s.id]: { text: (existing?.text ?? '') + token, status: 'loading' } };
          });
        });
        setProseCache((prev) => ({ ...prev, [s.id]: { text: prose, status: 'ready' } }));
        dispatch({ type: 'UPDATE_SCENE', sceneId: s.id, updates: { prose } });
        completed++;
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        setProseCache((prev) => ({ ...prev, [s.id]: { text: '', status: 'error', error: msg } }));
      }
      setBulkState({ running: !bulkCancelledRef.current, completed, total: missing.length, errors });
    };

    const runWorker = async (): Promise<void> => {
      while (!bulkCancelledRef.current) {
        const idx = nextIdx++;
        if (idx >= missing.length) break;
        await processScene(missing[idx]);
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, () => runWorker()));

    setBulkState((prev) => prev ? { ...prev, running: false } : null);
  }, [scenes, proseCache, narrative, resolvedKeys, dispatch]);

  const cancelBulk = useCallback(() => {
    bulkCancelledRef.current = true;
    setBulkState((prev) => prev ? { ...prev, running: false } : null);
  }, []);

  // ── Rewrite analysis + parallel rewrite ──────────────────────────────────
  const [rewriteState, setRewriteState] = useState<{
    phase: 'idle' | 'analyzing' | 'rewriting' | 'done';
    analysis: ProseAnalysis | null;
    completed: number;
    total: number;
    errors: number;
  }>({ phase: 'idle', analysis: null, completed: 0, total: 0, errors: 0 });
  const rewriteCancelledRef = useRef(false);
  const [rewritePrompt, setRewritePrompt] = useState('');
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);

  const startRewrite = useCallback(async () => {
    // Build prose map from cache + stored prose
    const proseMap: Record<string, string> = {};
    const sceneOrder: string[] = [];
    for (const s of scenes) {
      const prose = proseCache[s.id]?.status === 'ready' ? proseCache[s.id].text : s.prose;
      if (prose) {
        proseMap[s.id] = prose;
        sceneOrder.push(s.id);
      }
    }
    if (sceneOrder.length === 0) return;

    // Phase 1: Analyze
    rewriteCancelledRef.current = false;
    setRewriteState({ phase: 'analyzing', analysis: null, completed: 0, total: 0, errors: 0 });
    setAnalysisModalOpen(true);

    let analysis: ProseAnalysis;
    try {
      analysis = await analyzeAllProse(narrative, proseMap, sceneOrder, rewritePrompt.trim() || undefined);
    } catch (err) {
      console.error('[rewrite] analysis failed:', err);
      setRewriteState((prev) => ({ ...prev, phase: 'idle' }));
      return;
    }

    if (rewriteCancelledRef.current) { setRewriteState((prev) => ({ ...prev, phase: 'idle' })); return; }

    // Show analysis in modal
    setRewriteState((prev) => ({ ...prev, analysis }));

    // Filter to scenes that actually have issues
    const scenesToRewrite = analysis.sceneIssues.filter((si) => si.issues.length > 0 && proseMap[si.sceneId]);
    if (scenesToRewrite.length === 0) {
      setRewriteState({ phase: 'done', analysis, completed: 0, total: 0, errors: 0 });
      return;
    }

    // Phase 2: Parallel rewrite
    setRewriteState({ phase: 'rewriting', analysis, completed: 0, total: scenesToRewrite.length, errors: 0 });

    let completed = 0;
    let errors = 0;
    const CONCURRENCY = 5;
    let nextIdx = 0;

    // Mark all rewriting scenes as loading
    setProseCache((prev) => {
      const next = { ...prev };
      for (const si of scenesToRewrite) {
        next[si.sceneId] = { text: proseMap[si.sceneId], status: 'loading' };
      }
      return next;
    });

    const processScene = async (si: typeof scenesToRewrite[0]) => {
      const s = scenes.find((sc) => sc.id === si.sceneId);
      if (!s) return;
      try {
        const rewritten = await rewriteSceneProse(
          narrative, s, resolvedKeys, proseMap[si.sceneId],
          si.issues, analysis.globalIssues,
          (token) => {
            setProseCache((prev) => {
              const existing = prev[si.sceneId];
              // Only stream if we haven't finished — show rewrite replacing original
              if (existing?.status === 'loading') {
                return { ...prev, [si.sceneId]: { text: token, status: 'loading' } };
              }
              return prev;
            });
          },
        );
        setProseCache((prev) => ({ ...prev, [si.sceneId]: { text: rewritten, status: 'ready' } }));
        dispatch({ type: 'UPDATE_SCENE', sceneId: si.sceneId, updates: { prose: rewritten } });
        completed++;
      } catch (err) {
        errors++;
        console.error(`[rewrite] failed for ${si.sceneId}:`, err);
        // Restore original prose on error
        setProseCache((prev) => ({ ...prev, [si.sceneId]: { text: proseMap[si.sceneId], status: 'ready' } }));
      }
      setRewriteState((prev) => ({ ...prev, completed, errors }));
    };

    const runWorker = async () => {
      while (!rewriteCancelledRef.current) {
        const idx = nextIdx++;
        if (idx >= scenesToRewrite.length) break;
        await processScene(scenesToRewrite[idx]);
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, scenesToRewrite.length) }, () => runWorker()));
    setRewriteState((prev) => ({ ...prev, phase: 'done' }));
  }, [scenes, proseCache, narrative, resolvedKeys, dispatch]);

  const cancelRewrite = useCallback(() => {
    rewriteCancelledRef.current = true;
    setRewriteState((prev) => ({ ...prev, phase: 'idle' }));
  }, []);

  // Auto-generate prose when navigating to a scene that hasn't been generated
  useEffect(() => {
    if (!scene) return;
    // Use existing prose field if available
    if (scene.prose && !proseCache[scene.id]) {
      setProseCache((prev) => ({ ...prev, [scene.id]: { text: scene.prose!, status: 'ready' } }));
    }
  }, [scene, proseCache]);

  // Scroll sidebar to active scene on mount
  useEffect(() => {
    activeSceneRef.current?.scrollIntoView({ block: 'center' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to top when changing scenes
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [currentIndex]);

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCurrentIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCurrentIndex((i) => Math.min(scenes.length - 1, i + 1));
      } else if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [scenes.length, onClose]);

  if (scenes.length === 0) {
    return (
      <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-dim text-sm">No scenes yet.</p>
          <button onClick={onClose} className="mt-4 text-[11px] text-text-dim hover:text-text-primary transition">
            Close
          </button>
        </div>
      </div>
    );
  }

  const cached = scene ? proseCache[scene.id] : undefined;
  const hasProse = cached?.status === 'ready';
  const isLoading = cached?.status === 'loading';
  const hasError = cached?.status === 'error';

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between shrink-0">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold text-text-primary">{narrative.title}</h2>
          {arc && (
            <span className="text-[11px] text-text-dim">
              {arc.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Bulk generate */}
          {bulkState?.running ? (
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-change rounded-full animate-spin" />
              <span className="text-[10px] text-text-dim font-mono">
                {bulkState.completed}/{bulkState.total}
              </span>
              {bulkState.errors > 0 && (
                <span className="text-[10px] text-red-400/80 font-mono">
                  {bulkState.errors} err
                </span>
              )}
              <button
                onClick={cancelBulk}
                className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-dim hover:text-text-secondary transition"
              >
                Stop
              </button>
            </div>
          ) : (
            (() => {
              const missingCount = scenes.filter((s) => !s.prose && proseCache[s.id]?.status !== 'ready').length;
              return missingCount > 0 ? (
                <button
                  onClick={bulkGenerate}
                  className="text-[10px] px-2.5 py-1 rounded-full border border-white/10 text-text-dim hover:text-text-secondary hover:border-white/15 transition flex items-center gap-1.5"
                  title={`Generate prose for ${missingCount} scene${missingCount !== 1 ? 's' : ''}`}
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                  Write All ({missingCount})
                </button>
              ) : bulkState && !bulkState.running ? (
                <span className="text-[10px] text-emerald-400/60">All written</span>
              ) : null;
            })()
          )}

          {/* Clear all prose */}
          {(() => {
            const writtenCount = scenes.filter((s) => s.prose || proseCache[s.id]?.status === 'ready').length;
            return writtenCount > 0 && !bulkState?.running ? (
              <button
                onClick={() => {
                  setProseCache({});
                  for (const s of scenes) {
                    if (s.prose || proseCache[s.id]?.status === 'ready') {
                      dispatch({ type: 'UPDATE_SCENE', sceneId: s.id, updates: { prose: undefined } });
                    }
                  }
                  setBulkState(null);
                }}
                className="text-[10px] px-2.5 py-1 rounded-full border border-white/10 text-text-dim hover:text-red-400/80 hover:border-red-400/20 transition flex items-center gap-1.5"
                title={`Clear prose for all ${writtenCount} scenes`}
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Clear All ({writtenCount})
              </button>
            ) : null;
          })()}

          {/* Copy all prose */}
          {(() => {
            const allProse = scenes
              .map((s) => proseCache[s.id]?.status === 'ready' ? proseCache[s.id].text : s.prose)
              .filter(Boolean);
            return allProse.length > 0 ? (
              <button
                onClick={() => {
                  const text = scenes
                    .map((s) => {
                      const prose = proseCache[s.id]?.status === 'ready' ? proseCache[s.id].text : s.prose;
                      return prose || null;
                    })
                    .filter(Boolean)
                    .join('\n\n');
                  navigator.clipboard.writeText(text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="text-[10px] px-2.5 py-1 rounded-full border border-white/10 text-text-dim hover:text-text-secondary hover:border-white/15 transition flex items-center gap-1.5"
                title={`Copy all prose (${allProse.length} scenes)`}
              >
                {copied ? (
                  <>
                    <svg className="w-3 h-3 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy All ({allProse.length})
                  </>
                )}
              </button>
            ) : null;
          })()}

          {/* Export EPUB */}
          {(() => {
            const allProse = scenes.filter((s) => proseCache[s.id]?.status === 'ready' || !!s.prose);
            return allProse.length > 0 ? (
              <button
                onClick={() => exportEpub(narrative, resolvedKeys, proseCache)}
                className="text-[10px] px-2.5 py-1 rounded-full border border-white/10 text-text-dim hover:text-text-secondary hover:border-white/15 transition flex items-center gap-1.5"
                title={`Export ${allProse.length} scene${allProse.length !== 1 ? 's' : ''} as EPUB`}
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                EPUB
              </button>
            ) : null;
          })()}

          {/* Rewrite */}
          {(() => {
            const writtenCount = scenes.filter((s) => s.prose || proseCache[s.id]?.status === 'ready').length;
            if (writtenCount < 2) return null;
            if (rewriteState.phase === 'analyzing') {
              return (
                <button onClick={() => setAnalysisModalOpen(true)} className="text-[10px] px-2.5 py-1 rounded-full border border-violet-500/20 text-violet-400/60 flex items-center gap-1.5">
                  <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                    <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Analyzing...
                </button>
              );
            }
            if (rewriteState.phase === 'rewriting') {
              return (
                <button onClick={() => setAnalysisModalOpen(true)} className="text-[10px] px-2.5 py-1 rounded-full border border-violet-500/20 text-violet-400 hover:border-violet-500/40 transition flex items-center gap-1.5">
                  <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                    <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Rewriting {rewriteState.completed}/{rewriteState.total}
                </button>
              );
            }
            return (
              <>
                {rewriteState.analysis && (
                  <button
                    onClick={() => setAnalysisModalOpen(true)}
                    className="text-[10px] px-2.5 py-1 rounded-full border border-violet-500/20 text-violet-400/60 hover:text-violet-400 hover:border-violet-500/30 transition flex items-center gap-1.5"
                    title="View analysis"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                    Analysis
                  </button>
                )}
                <button
                  onClick={() => setAnalysisModalOpen(true)}
                  disabled={!!bulkState?.running}
                  className="text-[10px] px-2.5 py-1 rounded-full border border-white/10 text-text-dim hover:text-violet-400 hover:border-violet-500/20 transition flex items-center gap-1.5 disabled:opacity-30"
                  title={rewriteState.analysis ? 'Re-analyze and rewrite again' : 'Analyze all prose and rewrite scenes with issues'}
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  {rewriteState.analysis ? 'Rewrite Again' : 'Rewrite'}
                </button>
              </>
            );
          })()}

          <span className="text-[10px] text-text-dim font-mono">
            {currentIndex + 1} / {scenes.length}
          </span>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text-primary text-lg leading-none transition"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Analysis modal */}
      {analysisModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center" onClick={() => setAnalysisModalOpen(false)}>
          <div className="bg-bg-base border border-white/10 rounded-2xl shadow-2xl max-w-lg w-full max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/5 shrink-0">
              <h3 className="text-sm font-semibold text-text-primary">Prose Analysis</h3>
              <button onClick={() => setAnalysisModalOpen(false)} className="text-text-dim hover:text-text-primary text-lg leading-none">&times;</button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
              {rewriteState.phase === 'analyzing' && !rewriteState.analysis && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="w-5 h-5 border-2 border-violet-400/30 border-t-violet-400/80 rounded-full animate-spin" />
                  <p className="text-[11px] text-text-dim">Analyzing manuscript...</p>
                </div>
              )}

              {rewriteState.analysis && (
                <>
                  {/* Overall assessment */}
                  <p className="text-xs text-text-secondary leading-relaxed">{rewriteState.analysis.overallAssessment}</p>

                  {/* Global issues */}
                  {rewriteState.analysis.globalIssues.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[9px] uppercase tracking-widest text-text-dim">Global Issues</span>
                      {rewriteState.analysis.globalIssues.map((issue, i) => (
                        <p key={i} className="text-[11px] text-text-dim leading-relaxed pl-2 border-l-2 border-violet-500/20">
                          {issue}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Per-scene issues */}
                  {rewriteState.analysis.sceneIssues.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[9px] uppercase tracking-widest text-text-dim">
                        Scene Issues ({rewriteState.analysis.sceneIssues.length})
                      </span>
                      {rewriteState.analysis.sceneIssues.map((si) => {
                        const s = scenes.find((sc) => sc.id === si.sceneId);
                        const idx = s ? scenes.indexOf(s) : -1;
                        return (
                          <button
                            key={si.sceneId}
                            onClick={() => { if (idx >= 0) { setCurrentIndex(idx); setAnalysisModalOpen(false); } }}
                            className={`text-left rounded-lg px-3 py-2 border transition-colors ${
                              si.priority === 'high' ? 'border-red-500/15 bg-red-500/5 hover:bg-red-500/10'
                              : si.priority === 'medium' ? 'border-amber-500/15 bg-amber-500/5 hover:bg-amber-500/10'
                              : 'border-white/5 bg-white/2 hover:bg-white/5'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-mono text-text-dim">{idx >= 0 ? idx + 1 : si.sceneId}</span>
                              <span className={`text-[9px] uppercase tracking-wider ${
                                si.priority === 'high' ? 'text-red-400' : si.priority === 'medium' ? 'text-amber-400' : 'text-text-dim'
                              }`}>{si.priority}</span>
                            </div>
                            {si.issues.map((issue, j) => (
                              <p key={j} className="text-[10px] text-text-dim leading-relaxed">{issue}</p>
                            ))}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Rewrite status */}
                  {rewriteState.phase === 'rewriting' && (
                    <div className="flex items-center gap-2 text-[10px] text-violet-400/70">
                      <div className="w-3 h-3 border-2 border-violet-400/30 border-t-violet-400/80 rounded-full animate-spin" />
                      Rewriting {rewriteState.completed}/{rewriteState.total}...
                    </div>
                  )}
                  {rewriteState.phase === 'done' && (
                    <p className="text-[10px] text-violet-400/60">
                      Rewrote {rewriteState.completed} scene{rewriteState.completed !== 1 ? 's' : ''}
                      {rewriteState.errors > 0 && <span className="text-red-400/60"> ({rewriteState.errors} failed)</span>}
                      {rewriteState.total === 0 && ' — no issues found'}
                    </p>
                  )}
                </>
              )}

              {/* Custom prompt — only show when idle or done */}
              {(rewriteState.phase === 'idle' || rewriteState.phase === 'done') && (
                <div>
                  <label className="text-[9px] uppercase tracking-widest text-text-dim block mb-1">Additional Guidance (optional)</label>
                  <textarea
                    value={rewritePrompt}
                    onChange={(e) => setRewritePrompt(e.target.value)}
                    placeholder="e.g. Focus on dialogue quality, reduce purple prose, make fight scenes more visceral..."
                    className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-[11px] text-text-primary w-full h-16 resize-none outline-none placeholder:text-text-dim/50"
                  />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-white/5 shrink-0">
              <button onClick={() => setAnalysisModalOpen(false)} className="text-[10px] text-text-dim hover:text-text-secondary transition">
                Close
              </button>
              <button
                onClick={startRewrite}
                disabled={rewriteState.phase === 'analyzing' || rewriteState.phase === 'rewriting'}
                className="text-[10px] font-semibold px-4 py-2 rounded-lg bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 transition disabled:opacity-30 disabled:pointer-events-none"
              >
                {rewriteState.analysis ? 'Re-analyze & Rewrite' : 'Analyze & Rewrite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 overflow-hidden flex">
        {/* Scene list sidebar */}
        <div className="w-56 shrink-0 border-r border-white/5 overflow-y-auto py-2">
          {scenes.map((s, i) => {
            const sArc = Object.values(narrative.arcs).find((a) => a.sceneIds.includes(s.id));
            const hasContent = proseCache[s.id]?.status === 'ready' || !!s.prose;
            const isGenerating = proseCache[s.id]?.status === 'loading';
            const sceneIssue = rewriteState.analysis?.sceneIssues.find((si) => si.sceneId === s.id);
            return (
              <button
                key={s.id}
                ref={i === currentIndex ? activeSceneRef : undefined}
                onClick={() => setCurrentIndex(i)}
                className={`w-full text-left px-4 py-2.5 transition-colors ${
                  i === currentIndex
                    ? 'bg-white/8 text-text-primary'
                    : 'text-text-dim hover:bg-white/4 hover:text-text-secondary'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-text-dim shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-[11px] truncate">
                    {s.summary.slice(0, 60)}{s.summary.length > 60 ? '...' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 ml-5">
                  {sArc && <span className="text-[9px] text-text-dim">{sArc.name}</span>}
                  {isGenerating && (
                    <div className="w-2.5 h-2.5 border border-white/30 border-t-white/70 rounded-full animate-spin shrink-0" />
                  )}
                  {hasContent && !isGenerating && (
                    <span className="text-[8px] text-emerald-400/60">●</span>
                  )}
                  {sceneIssue && (
                    <span className={`text-[8px] ${
                      sceneIssue.priority === 'high' ? 'text-red-400/70' : sceneIssue.priority === 'medium' ? 'text-amber-400/70' : 'text-text-dim/50'
                    }`}>
                      {sceneIssue.issues.length}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Reading pane */}
        <div ref={contentRef} className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8 py-10">
            {/* Scene header */}
            <div className="mb-8 border-b border-white/5 pb-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[10px] font-mono text-text-dim">Scene {currentIndex + 1}</span>
                {arc && (
                  <>
                    <span className="text-text-dim/30">&middot;</span>
                    <span className="text-[10px] text-text-dim uppercase tracking-wider">{arc.name}</span>
                  </>
                )}
              </div>
              <h3 className="text-base text-text-primary font-medium leading-relaxed mb-3">
                {scene.summary}
              </h3>
              <div className="flex items-center gap-4 text-[10px] text-text-dim">
                {location && (
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    {location.name}
                  </span>
                )}
                {pov && (
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    {pov.name}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  {scene.participantIds.map((pid) => narrative.characters[pid]?.name ?? pid).join(', ')}
                </span>
              </div>
            </div>

            {/* Per-scene analysis issues */}
            {(() => {
              const si = rewriteState.analysis?.sceneIssues.find((x) => x.sceneId === scene.id);
              if (!si || si.issues.length === 0) return null;
              return (
                <div className={`mb-6 rounded-lg px-4 py-3 border ${
                  si.priority === 'high' ? 'bg-red-500/5 border-red-500/15'
                  : si.priority === 'medium' ? 'bg-amber-500/5 border-amber-500/15'
                  : 'bg-white/[0.02] border-white/5'
                }`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[9px] uppercase tracking-widest font-medium ${
                      si.priority === 'high' ? 'text-red-400' : si.priority === 'medium' ? 'text-amber-400' : 'text-text-dim'
                    }`}>
                      {si.priority} priority
                    </span>
                    <span className="text-[9px] text-text-dim">{si.issues.length} issue{si.issues.length !== 1 ? 's' : ''}</span>
                  </div>
                  {si.issues.map((issue, j) => (
                    <p key={j} className="text-[11px] text-text-secondary leading-relaxed pl-2 border-l border-white/10 mb-1 last:mb-0">
                      {issue}
                    </p>
                  ))}
                </div>
              );
            })()}

            {/* Prose content */}
            {isLoading && !cached?.text && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                <p className="text-[11px] text-text-dim">Generating prose...</p>
              </div>
            )}

            {isLoading && cached?.text && (
              <div className="prose-content">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                  <span className="text-[9px] text-text-dim">Writing...</span>
                </div>
                {cached.text.split('\n\n').map((paragraph, i) => (
                  <p
                    key={i}
                    className="text-[13px] text-text-secondary leading-[1.8] mb-5 first:first-letter:text-2xl first:first-letter:font-semibold first:first-letter:text-text-primary first:first-letter:mr-0.5"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            )}

            {hasError && (
              <div className="py-12 text-center">
                <p className="text-[11px] text-red-400/80 mb-3">{cached?.error}</p>
                <button
                  onClick={() => generateProse(scene, sceneKeyIndex)}
                  className="text-[10px] px-4 py-1.5 rounded-full border border-white/10 text-text-dim hover:text-text-secondary transition"
                >
                  Retry
                </button>
              </div>
            )}

            {hasProse && (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <button
                    onClick={() => {
                      setProseCache((prev) => { const next = { ...prev }; delete next[scene.id]; return next; });
                      dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { prose: undefined } });
                    }}
                    className="text-[9px] px-2.5 py-1 rounded-full border border-white/8 text-text-dim hover:text-red-400/80 hover:border-red-400/20 transition"
                    title="Clear prose for this scene"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => {
                      dispatch({ type: 'UPDATE_SCENE', sceneId: scene.id, updates: { prose: undefined } });
                      generateProse(scene, sceneKeyIndex);
                    }}
                    className="text-[9px] px-2.5 py-1 rounded-full border border-white/8 text-text-dim hover:text-text-secondary hover:border-white/15 transition"
                    title="Regenerate prose for this scene"
                  >
                    Regenerate
                  </button>
                </div>
                <div className="prose-content">
                  {cached!.text.split('\n\n').map((paragraph, i) => (
                    <p
                      key={i}
                      className="text-[13px] text-text-secondary leading-[1.8] mb-5 first:first-letter:text-2xl first:first-letter:font-semibold first:first-letter:text-text-primary first:first-letter:mr-0.5"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              </>
            )}

            {!hasProse && !isLoading && !hasError && (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <p className="text-[11px] text-text-dim">This scene hasn&apos;t been written yet.</p>
                <button
                  onClick={() => generateProse(scene, sceneKeyIndex)}
                  className="text-[11px] px-5 py-2 rounded-full bg-white/8 border border-white/10 text-text-secondary hover:text-text-primary hover:bg-white/12 transition"
                >
                  Generate Prose
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer navigation */}
      <div className="px-6 py-3 border-t border-white/5 flex items-center justify-between shrink-0">
        <button
          onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          disabled={currentIndex === 0}
          className="text-[10px] px-3.5 py-1.5 rounded-full border border-white/8 text-text-dim hover:text-text-secondary hover:border-white/12 transition disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1.5"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Previous
        </button>
        <div className="text-[9px] text-text-dim/50">
          Arrow keys to navigate &middot; Esc to close
        </div>
        <button
          onClick={() => setCurrentIndex((i) => Math.min(scenes.length - 1, i + 1))}
          disabled={currentIndex === scenes.length - 1}
          className="text-[10px] px-3.5 py-1.5 rounded-full border border-white/8 text-text-dim hover:text-text-secondary hover:border-white/12 transition disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1.5"
        >
          Next
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
