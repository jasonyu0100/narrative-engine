'use client';

import { Suspense, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStore } from '@/lib/store';
import { splitCorpusIntoChunks } from '@/lib/text-analysis';
import { analysisRunner } from '@/lib/analysis-runner';
import type { AnalysisJob, AnalysisChunkResult } from '@/types/narrative';
import { BEAT_FN_LIST } from '@/types/narrative';
import { ANALYSIS_MAX_CORPUS_WORDS, DEFAULT_MODEL } from '@/lib/constants';
import { IconSpinner, IconChevronLeft } from '@/components/icons';
import { IconCheck } from '@/components/icons/EvalIcons';

/* ── Word Node type ─────────────────────────────────────────────────────── */

type WordNode = { label: string; type: 'character' | 'location' | 'thread' | 'knowledge' | 'artifact'; count: number; firstSeen: number; knowledgeType?: string; significance?: string };

/* ── Job detail panel ─────────────────────────────────────────────────────── */
function JobDetail({ job }: { job: AnalysisJob }) {
  const router = useRouter();
  const { state, dispatch } = useStore();
  const streamRef = useRef<HTMLPreElement>(null);
  const [streamText, setStreamText] = useState(() => analysisRunner.getStreamText(job.id));
  const [selectedChunk, setSelectedChunk] = useState<number | null>(null);
  const [chunkPanelHeight, setChunkPanelHeight] = useState(35);
  const [inFlightIndices, setInFlightIndices] = useState<number[]>(() => analysisRunner.getInFlightIndices(job.id));
  const [chunkStreamTexts, setChunkStreamTexts] = useState<Map<number, string>>(new Map());
  const [viewingChunkStream, setViewingChunkStream] = useState<number | null>(null);
  const [assembling, setAssembling] = useState(false);
  const [selectedPlanKey, setSelectedPlanKey] = useState<string | null>(null);
  const [planInFlightKeys, setPlanInFlightKeys] = useState<string[]>(() => analysisRunner.getPlanInFlightKeys(job.id));
  const [planStreamTexts, setPlanStreamTexts] = useState<Map<string, string>>(new Map());

  const liveJob = state.analysisJobs.find((j) => j.id === job.id) ?? job;
  const isRunning = analysisRunner.isRunning(job.id) || liveJob.status === 'running';
  const error = liveJob.error ?? '';

  // Subscribe to job-level stream text
  useEffect(() => {
    return analysisRunner.onStream((id, text) => {
      if (id === job.id) setStreamText(text);
    });
  }, [job.id]);

  // Subscribe to per-chunk stream text
  useEffect(() => {
    return analysisRunner.onChunkStream((id, chunkIndex, text) => {
      if (id === job.id) {
        setChunkStreamTexts((prev) => {
          const next = new Map(prev);
          next.set(chunkIndex, text);
          return next;
        });
      }
    });
  }, [job.id]);

  // Subscribe to in-flight changes
  useEffect(() => {
    return analysisRunner.onInFlightChange((id, indices) => {
      if (id === job.id) setInFlightIndices(indices);
    });
  }, [job.id]);

  const inFlightSet = useMemo(() => new Set(inFlightIndices), [inFlightIndices]);

  // Subscribe to plan in-flight + stream events
  useEffect(() => {
    return analysisRunner.onPlanInFlightChange((id, keys) => {
      if (id === job.id) setPlanInFlightKeys(keys);
    });
  }, [job.id]);

  useEffect(() => {
    return analysisRunner.onPlanStream((id, key, text) => {
      if (id === job.id) {
        setPlanStreamTexts((prev) => {
          const next = new Map(prev);
          next.set(key, text);
          return next;
        });
      }
    });
  }, [job.id]);

  const planInFlightSet = useMemo(() => new Set(planInFlightKeys), [planInFlightKeys]);

  // Build word map from completed results
  const wordNodes = useMemo(() => {
    const completed = liveJob.results.filter((r): r is AnalysisChunkResult => r !== null);
    const map = new Map<string, WordNode>();

    completed.forEach((result, chunkIdx) => {
      for (const c of result.characters) {
        const key = `character-${c.name}`;
        const existing = map.get(key);
        if (existing) { existing.count++; }
        else { map.set(key, { label: c.name, type: 'character', count: 1, firstSeen: chunkIdx }); }
      }
      for (const l of result.locations) {
        const key = `location-${l.name}`;
        const existing = map.get(key);
        if (existing) { existing.count++; }
        else { map.set(key, { label: l.name, type: 'location', count: 1, firstSeen: chunkIdx }); }
      }
      for (const t of result.threads) {
        const key = `thread-${t.description}`;
        const existing = map.get(key);
        if (existing) { existing.count++; }
        else { map.set(key, { label: t.description, type: 'thread', count: 1, firstSeen: chunkIdx }); }
      }
      for (const a of result.artifacts ?? []) {
        const key = `artifact-${a.name}`;
        const existing = map.get(key);
        if (existing) { existing.count++; }
        else { map.set(key, { label: a.name, type: 'artifact', count: 1, firstSeen: chunkIdx, significance: a.significance }); }
      }
      for (const s of result.scenes ?? []) {
        for (const n of s.worldKnowledgeMutations?.addedNodes ?? []) {
          const shortConcept = n.concept.includes(' — ') ? n.concept.split(' — ')[0] : n.concept;
          const key = `knowledge-${shortConcept}`;
          const existing = map.get(key);
          if (existing) { existing.count++; }
          else { map.set(key, { label: shortConcept, type: 'knowledge', count: 1, firstSeen: chunkIdx, knowledgeType: n.type }); }
        }
      }
    });

    return Array.from(map.values());
  }, [liveJob.results]);

  // Separate word nodes by type
  const { characters, locations, threads, knowledge, artifacts } = useMemo(() => {
    const c: WordNode[] = [];
    const l: WordNode[] = [];
    const t: WordNode[] = [];
    const k: WordNode[] = [];
    const a: WordNode[] = [];
    for (const n of wordNodes) {
      if (n.type === 'character') c.push(n);
      else if (n.type === 'location') l.push(n);
      else if (n.type === 'knowledge') k.push(n);
      else if (n.type === 'artifact') a.push(n);
      else t.push(n);
    }
    c.sort((a, b) => b.count - a.count);
    l.sort((a, b) => b.count - a.count);
    t.sort((a, b) => b.count - a.count);
    k.sort((a, b) => b.count - a.count);
    a.sort((x, y) => y.count - x.count);
    return { characters: c, locations: l, threads: t, knowledge: k, artifacts: a };
  }, [wordNodes]);

  const maxCount = Math.max(1, ...wordNodes.map((n) => n.count));

  // Auto-scroll stream
  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [streamText, chunkStreamTexts, viewingChunkStream]);

  const handlePause = useCallback(() => { analysisRunner.pause(job.id); }, [job.id]);
  const handleStart = useCallback((j: AnalysisJob) => {
    analysisRunner.start(j).catch((err) => {
      console.error('[analysis] start failed:', err);
    });
  }, []);

  // Beat function colors — 10 distinct hues
  const BEAT_FN_COLORS: Record<string, string> = {
    breathe: '#2dd4bf', inform: '#38bdf8', advance: '#34d399', bond: '#f472b6',
    turn: '#fb923c', reveal: '#fbbf24', shift: '#f87171', expand: '#a78bfa',
    foreshadow: '#818cf8', resolve: '#a3e635',
  };

  const completedChunks = liveJob.results.filter((r) => r !== null).length;
  const totalChunks = liveJob.chunks.length;
  const isReconciling = completedChunks === totalChunks && liveJob.status === 'running' && !liveJob.narrativeId && streamText.includes('Reconcil');
  const isPlanExtracting = completedChunks === totalChunks && liveJob.status === 'running' && !liveJob.narrativeId && streamText.includes('Phase 2');
  const isAssembling = completedChunks === totalChunks && liveJob.status === 'running' && !liveJob.narrativeId && streamText.includes('Assembl');

  const completed = liveJob.results.filter((r): r is AnalysisChunkResult => r !== null);
  const assembledNarrative = liveJob.narrativeId && state.activeNarrative?.id === liveJob.narrativeId
    ? state.activeNarrative
    : null;
  const beatStats = useMemo(() => {
    const fnCounts: Record<string, number> = {};
    for (const fn of BEAT_FN_LIST) fnCounts[fn] = 0;
    let planCount = 0;

    // Prefer assembled narrative scenes (covers pre-existing works + post-assembly plans)
    const narrativeScenes = assembledNarrative ? Object.values(assembledNarrative.scenes) : [];
    if (narrativeScenes.some((s) => s.plan)) {
      for (const s of narrativeScenes) {
        if (!s.plan) continue;
        planCount++;
        for (const b of s.plan.beats) fnCounts[b.fn] = (fnCounts[b.fn] ?? 0) + 1;
      }
    } else {
      // Fall back to chunk results (mid-run or pre-assembly)
      for (const r of completed) {
        for (const s of r.scenes ?? []) {
          if (!s.plan) continue;
          planCount++;
          for (const b of s.plan.beats) fnCounts[b.fn] = (fnCounts[b.fn] ?? 0) + 1;
        }
      }
    }

    const totalBeats = Object.values(fnCounts).reduce((a, b) => a + b, 0);
    return { fnCounts, totalBeats, planCount };
  }, [completed, assembledNarrative]);

  const charCount = new Set(completed.flatMap((r) => r.characters.map((c) => c.name))).size;
  const locCount = new Set(completed.flatMap((r) => r.locations.map((l) => l.name))).size;
  const sceneCount = completed.reduce((sum, r) => sum + (r.scenes?.length ?? 0), 0);
  const threadCount = new Set(completed.flatMap((r) => r.threads.map((t) => t.description))).size;
  const knowledgeCount = new Set(completed.flatMap((r) => (r.scenes ?? []).flatMap((s) => (s.worldKnowledgeMutations?.addedNodes ?? []).map((n) => n.concept)))).size;
  const artifactCount = new Set(completed.flatMap((r) => (r.artifacts ?? []).map((a) => a.name))).size;

  // Current chunk stream text for viewing
  const activeChunkStream = viewingChunkStream !== null ? (chunkStreamTexts.get(viewingChunkStream) ?? '') : '';

  // All scenes extracted so far (for Plans phase display)
  const allExtractedScenes = useMemo(() =>
    completed.flatMap((r, ci) =>
      (r.scenes ?? []).map((s, si) => ({
        key: `${ci}-${si}`, chunkIdx: ci, sceneIdx: si,
        summary: s.summary, povName: s.povName, plan: s.plan,
      }))
    ), [completed]);

  const activePlanStream = selectedPlanKey !== null ? (planStreamTexts.get(selectedPlanKey) ?? '') : '';

  const renderNode = (node: WordNode) => {
    const ratio = node.count / maxCount;
    const fontSize = Math.round(13 + ratio * 22);
    const opacity = 0.35 + ratio * 0.65;
    const isHighFreq = ratio > 0.5;

    const styleMap: Record<string, { cls: string; glow: string }> = {
      character: { cls: 'text-white/90', glow: 'rgba(255,255,255,0.12)' },
      location: { cls: 'text-emerald-400', glow: 'rgba(52,211,153,0.18)' },
      thread: { cls: 'text-sky-400', glow: 'rgba(56,189,248,0.15)' },
      knowledge: { cls: node.knowledgeType === 'law' ? 'text-yellow-300' : node.knowledgeType === 'system' ? 'text-teal-400' : node.knowledgeType === 'tension' ? 'text-rose-400' : 'text-violet-400', glow: node.knowledgeType === 'law' ? 'rgba(253,224,71,0.18)' : node.knowledgeType === 'system' ? 'rgba(45,212,191,0.15)' : node.knowledgeType === 'tension' ? 'rgba(251,113,133,0.18)' : 'rgba(167,139,250,0.18)' },
      artifact: { cls: node.significance === 'key' ? 'text-orange-300' : node.significance === 'notable' ? 'text-orange-400' : 'text-orange-600', glow: 'rgba(251,146,60,0.18)' },
    };
    const styles = styleMap[node.type];

    return (
      <span
        key={`${node.type}-${node.label}`}
        className={`${styles.cls} inline-block transition-all duration-500 cursor-default`}
        style={{
          fontSize: `${fontSize}px`,
          opacity,
          fontWeight: ratio > 0.3 ? 600 : 400,
          textShadow: isHighFreq ? `0 0 24px ${styles.glow}, 0 0 48px ${styles.glow}` : undefined,
          lineHeight: 1.4,
        }}
        title={`${node.label} (${node.count}x)`}
      >
        {node.label}
      </span>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* ── Top bar: title + controls ── */}
      <div className="shrink-0 px-6 py-2.5 flex items-center gap-4 border-b border-white/4 bg-black/20">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-white/90 truncate">{liveJob.title}</h2>
            <span className="text-[9px] text-white/20 font-mono shrink-0">
              {isAssembling ? 'assembling...'
                : isReconciling ? 'reconciling...'
                : isPlanExtracting ? `plans ${beatStats.planCount}/${sceneCount}`
                : liveJob.status === 'completed' ? 'complete'
                : liveJob.status === 'failed' ? 'failed'
                : liveJob.status === 'paused' ? 'paused'
                : isRunning ? `extracting ${completedChunks}/${totalChunks}`
                : 'pending'}
            </span>
          </div>
        </div>
        {/* Stats inline */}
        {completedChunks > 0 && (
          <div className="flex items-center gap-5 shrink-0">
            {[
              { value: charCount, color: 'text-white/60', dot: 'bg-white/30', label: 'chr' },
              { value: locCount, color: 'text-emerald-400/60', dot: 'bg-emerald-400/40', label: 'loc' },
              { value: sceneCount, color: 'text-white/35', dot: 'bg-white/20', label: 'scn' },
              { value: threadCount, color: 'text-sky-400/50', dot: 'bg-sky-400/30', label: 'thr' },
              { value: knowledgeCount, color: 'text-violet-400/60', dot: 'bg-violet-400/40', label: 'wk' },
              { value: artifactCount, color: 'text-orange-400/60', dot: 'bg-orange-400/40', label: 'art' },
              ...(beatStats.planCount > 0 ? [{ value: beatStats.planCount, color: 'text-indigo-400/60', dot: 'bg-indigo-400/40', label: 'pln' }] : []),
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-1.5">
                <div className={`w-1 h-1 rounded-full ${s.dot}`} />
                <span className={`text-sm font-bold tabular-nums ${s.color}`}>{s.value}</span>
                <span className="text-[8px] text-white/15 font-mono uppercase">{s.label}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 shrink-0">
          {isRunning && (
            <button onClick={handlePause} className="text-[10px] px-3 py-1 rounded bg-white/5 text-white/40 hover:text-white/70 transition">
              Pause
            </button>
          )}
          {(liveJob.status === 'paused' || liveJob.status === 'failed' || liveJob.status === 'pending') && (
            <button
              onClick={() => handleStart(liveJob)}
              className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-[10px] font-semibold px-4 py-1 rounded transition"
            >
              {liveJob.status === 'failed' ? 'Retry' : liveJob.status === 'pending' ? 'Start' : 'Resume'}
            </button>
          )}
          {liveJob.status === 'completed' && (
            <button
              disabled={assembling}
              onClick={async () => {
                if (liveJob.narrativeId) {
                  dispatch({ type: 'SET_ACTIVE_NARRATIVE', id: liveJob.narrativeId });
                  router.push(`/series/${liveJob.narrativeId}?slides=1`);
                } else {
                  setAssembling(true);
                  try {
                    const { assembleNarrative } = await import('@/lib/text-analysis');
                    const completedResults = liveJob.results.filter((r): r is AnalysisChunkResult => r !== null);
                    const narrative = await assembleNarrative(liveJob.title, completedResults);
                    dispatch({ type: 'ADD_NARRATIVE', narrative });
                    dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: liveJob.id, updates: { narrativeId: narrative.id } });
                    router.push(`/series/${narrative.id}?slides=1`);
                  } catch (err) {
                    console.error('[analysis] assembly failed:', err);
                  } finally {
                    setAssembling(false);
                  }
                }
              }}
              className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-[10px] font-semibold px-4 py-1 rounded transition disabled:opacity-50"
            >
              {assembling ? 'Assembling...' : liveJob.narrativeId ? 'Open Narrative' : 'Create Narrative'}
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-2 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2 shrink-0">
          <p className="text-[10px] text-red-400/80">{error}</p>
        </div>
      )}

      {/* ── Middle: Entity cloud (left) + Stream sidebar (right column) ── */}
      <div className="flex-1 min-h-0 flex">
        {/* Entity cloud — main hero */}
        <div className="flex-1 min-w-0 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          {wordNodes.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center space-y-3">
                {isRunning ? (
                  <>
                    <div className="flex items-center justify-center gap-1.5">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="w-2 h-2 rounded-full bg-change/30" style={{ animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite` }} />
                      ))}
                    </div>
                    <p className="text-white/12 text-xs font-mono">
                      {isReconciling ? 'Reconciling entities...' : isAssembling ? 'Assembling narrative...' : 'Extracting entities in parallel...'}
                    </p>
                  </>
                ) : liveJob.status === 'completed' ? (
                  <p className="text-white/20 text-sm">Analysis complete — no entities extracted</p>
                ) : (
                  <div className="max-w-sm space-y-4">
                    <p className="text-white/40 text-sm font-medium">Ready to analyze</p>
                    <p className="text-white/20 text-[11px] leading-relaxed">
                      The text has been split into {totalChunks} chunk{totalChunks !== 1 ? 's' : ''} that will be analyzed in parallel. Each chunk independently extracts characters, locations, threads, and scenes. A reconciliation pass then merges duplicates and stitches continuity across chunks.
                    </p>
                    <div className="grid grid-cols-3 gap-3 pt-1">
                      {[
                        { label: 'Extract', desc: 'Parse entities from each chunk' },
                        { label: 'Reconcile', desc: 'Merge duplicates across chunks' },
                        { label: 'Assemble', desc: 'Build the narrative structure' },
                      ].map((phase) => (
                        <div key={phase.label} className="bg-white/3 rounded-lg px-3 py-2.5">
                          <div className="text-[9px] uppercase tracking-[0.15em] text-white/30 font-mono mb-1">{phase.label}</div>
                          <div className="text-[10px] text-white/15 leading-snug">{phase.desc}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-white/10 text-[10px] font-mono">Press Start above to begin</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="px-8 py-6 space-y-8">
              {/* Characters */}
              {characters.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/40" />
                    <span className="text-[9px] uppercase tracking-[0.2em] text-white/20 font-mono">Characters ({characters.length})</span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
                    {characters.map(renderNode)}
                  </div>
                </div>
              )}

              {/* Locations */}
              {locations.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/50" />
                    <span className="text-[9px] uppercase tracking-[0.2em] text-white/20 font-mono">Locations ({locations.length})</span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
                    {locations.map(renderNode)}
                  </div>
                </div>
              )}

              {/* Threads */}
              {threads.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-sky-400/40" />
                    <span className="text-[9px] uppercase tracking-[0.2em] text-white/20 font-mono">Threads ({threads.length})</span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                    {threads.map(renderNode)}
                  </div>
                </div>
              )}

              {/* Artifacts */}
              {artifacts.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange-400/50" />
                    <span className="text-[9px] uppercase tracking-[0.2em] text-white/20 font-mono">Artifacts ({artifacts.length})</span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
                    {artifacts.map(renderNode)}
                  </div>
                </div>
              )}

              {/* World Knowledge */}
              {knowledge.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-400/50" />
                    <span className="text-[9px] uppercase tracking-[0.2em] text-white/20 font-mono">World Knowledge ({knowledge.length})</span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
                    {knowledge.map(renderNode)}
                  </div>
                </div>
              )}

              {/* Beat Distribution */}
              {beatStats.planCount > 0 && (() => {
                const maxBeatCount = Math.max(1, ...BEAT_FN_LIST.map((fn) => beatStats.fnCounts[fn]));
                return (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-400/50" />
                      <span className="text-[9px] uppercase tracking-[0.2em] text-white/20 font-mono">
                        Beat Structure — {beatStats.totalBeats} beats · {beatStats.planCount} scenes
                      </span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
                      {BEAT_FN_LIST.filter((fn) => beatStats.fnCounts[fn] > 0).map((fn) => {
                        const ratio = beatStats.fnCounts[fn] / maxBeatCount;
                        const fontSize = Math.round(12 + ratio * 20);
                        const opacity = 0.35 + ratio * 0.65;
                        const isHighFreq = ratio > 0.5;
                        const color = BEAT_FN_COLORS[fn];
                        return (
                          <span
                            key={fn}
                            className="inline-block transition-all duration-500 cursor-default"
                            style={{
                              fontSize: `${fontSize}px`,
                              opacity,
                              fontWeight: ratio > 0.3 ? 600 : 400,
                              color,
                              textShadow: isHighFreq ? `0 0 20px ${color}55, 0 0 40px ${color}33` : undefined,
                              lineHeight: 1.4,
                            }}
                            title={`${fn}: ${beatStats.fnCounts[fn]}`}
                          >
                            {fn}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Right column — chunk stream viewer during extraction, job stream during reconciliation/assembly */}
        {(isRunning || streamText) && (
          <div className="w-80 shrink-0 border-l border-white/6 bg-black/40 flex flex-col min-h-0">
            {/* Header */}
            <div className="px-3 py-2 flex items-center gap-2 border-b border-white/4 shrink-0">
              <div className={`w-1.5 h-1.5 rounded-full ${isReconciling ? 'bg-sky-400' : isAssembling ? 'bg-amber-400' : isPlanExtracting ? 'bg-indigo-400' : 'bg-change'} animate-pulse`} />
              <span className="text-[9px] text-white/25 font-mono uppercase tracking-wider">
                {isReconciling ? 'Reconciliation' : isAssembling ? 'Assembly' : isPlanExtracting ? 'Beat Plans' : 'Extraction'}
              </span>
              {isPlanExtracting && (
                <span className="text-[9px] text-indigo-400/40 font-mono ml-auto">{beatStats.planCount}/{sceneCount}</span>
              )}
              {!isReconciling && !isAssembling && !isPlanExtracting && (
                <span className="text-[9px] text-white/10 font-mono ml-auto">{completedChunks}/{totalChunks}</span>
              )}
            </div>

            {/* Plans phase — mirrors extraction layout exactly */}
            {isPlanExtracting ? (
              <div className="flex-1 flex flex-col min-h-0">
                {/* In-flight scene tabs */}
                {planInFlightKeys.length > 0 && (
                  <div className="shrink-0 px-2 py-1.5 border-b border-white/4 flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
                    {planInFlightKeys.map((key) => {
                      const si = allExtractedScenes.findIndex((s) => s.key === key);
                      return (
                        <button
                          key={key}
                          onClick={() => setSelectedPlanKey(key)}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono transition shrink-0 ${
                            selectedPlanKey === key
                              ? 'bg-indigo-400/15 text-indigo-400/70 ring-1 ring-indigo-400/20'
                              : 'bg-white/3 text-white/25 hover:text-white/40'
                          }`}
                        >
                          <IconSpinner size={10} className="animate-spin" />
                          {si + 1}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Stream output for selected scene */}
                {selectedPlanKey !== null && activePlanStream ? (
                  <pre
                    ref={streamRef}
                    className="flex-1 text-[10px] text-white/20 font-mono px-3 py-2 overflow-y-auto leading-relaxed whitespace-pre-wrap break-all"
                    style={{ scrollbarWidth: 'thin' }}
                  >
                    <span className="text-white/8 select-none">scene {(allExtractedScenes.findIndex((s) => s.key === selectedPlanKey) + 1)} &gt; </span>
                    {activePlanStream}
                  </pre>
                ) : (
                  /* Grid of all scenes */
                  <div className="flex-1 overflow-y-auto px-3 py-3" style={{ scrollbarWidth: 'thin' }}>
                    <div className="grid grid-cols-2 gap-1.5">
                      {allExtractedScenes.map((scene, si) => {
                        const isInFlight = planInFlightSet.has(scene.key);
                        const hasPlan = !!scene.plan;
                        return (
                          <div
                            key={scene.key}
                            onClick={() => isInFlight ? setSelectedPlanKey(scene.key) : undefined}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-mono transition-all ${
                              hasPlan ? 'bg-indigo-500/8' : isInFlight ? 'bg-indigo-400/8 cursor-pointer hover:bg-indigo-400/12' : 'bg-white/2'
                            }`}
                          >
                            {isInFlight ? (
                              <IconSpinner size={12} className="text-indigo-400/50 animate-spin shrink-0" />
                            ) : hasPlan ? (
                              <IconCheck size={12} className="text-indigo-400/50 shrink-0" />
                            ) : (
                              <div className="w-3 h-3 rounded-full border border-white/8 shrink-0" />
                            )}
                            <span className={hasPlan ? 'text-indigo-400/40' : isInFlight ? 'text-indigo-400/40' : 'text-white/10'}>
                              {si + 1}
                            </span>
                            {hasPlan && (
                              <span className="text-white/15 ml-auto text-[8px]">
                                {scene.plan!.beats.length}b
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : !isReconciling && !isAssembling ? (
              /* Extraction phase: chunk stream tabs + stream viewer */
              <div className="flex-1 flex flex-col min-h-0">
                {/* In-flight chunk tabs */}
                {inFlightIndices.length > 0 && (
                  <div className="shrink-0 px-2 py-1.5 border-b border-white/4 flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
                    {inFlightIndices.map((idx) => (
                      <button
                        key={idx}
                        onClick={() => setViewingChunkStream(idx)}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono transition shrink-0 ${
                          viewingChunkStream === idx
                            ? 'bg-change/15 text-change/70 ring-1 ring-change/20'
                            : 'bg-white/3 text-white/25 hover:text-white/40'
                        }`}
                      >
                        <IconSpinner size={10} className="animate-spin" />
                        {idx + 1}
                      </button>
                    ))}
                  </div>
                )}

                {/* Stream output for selected chunk */}
                {viewingChunkStream !== null && activeChunkStream ? (
                  <pre
                    ref={streamRef}
                    className="flex-1 text-[10px] text-white/20 font-mono px-3 py-2 overflow-y-auto leading-relaxed whitespace-pre-wrap break-all"
                    style={{ scrollbarWidth: 'thin' }}
                  >
                    <span className="text-white/8 select-none">chunk {viewingChunkStream + 1} &gt; </span>
                    {activeChunkStream}
                  </pre>
                ) : (
                  /* Grid of all chunks */
                  <div className="flex-1 overflow-y-auto px-3 py-3" style={{ scrollbarWidth: 'thin' }}>
                    <div className="grid grid-cols-2 gap-1.5">
                      {liveJob.chunks.map((_, i) => {
                        const done = liveJob.results[i] !== null;
                        const isInFlight = inFlightSet.has(i);
                        const result = liveJob.results[i] as AnalysisChunkResult | null;
                        return (
                          <div
                            key={i}
                            onClick={() => isInFlight ? setViewingChunkStream(i) : undefined}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-mono transition-all ${
                              done ? 'bg-emerald-500/8' : isInFlight ? 'bg-change/8 cursor-pointer hover:bg-change/12' : 'bg-white/2'
                            }`}
                          >
                            {isInFlight ? (
                              <IconSpinner size={12} className="text-change/50 animate-spin shrink-0" />
                            ) : done ? (
                              <IconCheck size={12} className="text-emerald-400/50 shrink-0" />
                            ) : (
                              <div className="w-3 h-3 rounded-full border border-white/8 shrink-0" />
                            )}
                            <span className={done ? 'text-emerald-400/40' : isInFlight ? 'text-change/40' : 'text-white/10'}>
                              {i + 1}
                            </span>
                            {done && result && (
                              <span className="text-white/15 ml-auto text-[8px]">
                                {result.characters?.length ?? 0}c {result.scenes?.length ?? 0}s
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Reconciliation / Assembly phase: show LLM stream */
              <pre
                ref={streamRef}
                className="flex-1 text-[10px] text-white/20 font-mono px-3 py-2 overflow-y-auto leading-relaxed whitespace-pre-wrap break-all"
                style={{ scrollbarWidth: 'thin' }}
              >
                {streamText}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* ── Plan detail panel — shown when a scene is selected during plan phase ── */}
      {selectedPlanKey !== null && (() => {
        const scene = allExtractedScenes.find((s) => s.key === selectedPlanKey);
        if (!scene?.plan) return null;
        const { beats, anchors } = scene.plan;
        return (
          <div className="shrink-0 border-t border-white/8 flex flex-col" style={{ height: `${chunkPanelHeight}vh` }}>
            <div
              className="h-2 cursor-ns-resize flex items-center justify-center hover:bg-white/4 transition-colors shrink-0"
              onMouseDown={(e) => {
                e.preventDefault();
                const startY = e.clientY;
                const startH = chunkPanelHeight;
                const onMove = (ev: MouseEvent) => {
                  const delta = startY - ev.clientY;
                  setChunkPanelHeight(Math.max(15, Math.min(80, startH + (delta / window.innerHeight) * 100)));
                };
                const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
            >
              <div className="w-10 h-0.5 rounded-full bg-white/15" />
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-4" style={{ scrollbarWidth: 'thin' }}>
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-text-primary">{scene.povName}</span>
                  <span className="text-[10px] text-indigo-400/50 font-mono">{beats.length} beats</span>
                </div>
                <button onClick={() => setSelectedPlanKey(null)} className="text-xs text-text-dim hover:text-text-secondary transition px-2 py-1 rounded hover:bg-white/5">&times;</button>
              </div>
              {scene.summary && (
                <p className="text-[11px] text-text-secondary leading-relaxed mb-4 italic">{scene.summary}</p>
              )}
              <div className="grid grid-cols-2 gap-6">
                {/* Beat list */}
                <div>
                  <div className="text-[9px] uppercase tracking-[0.15em] text-text-dim font-mono mb-3">Beat Sequence</div>
                  <div className="space-y-2">
                    {beats.map((beat, bi) => (
                      <div key={bi} className="flex items-start gap-3">
                        <span
                          className="text-[9px] font-mono font-semibold shrink-0 mt-0.5 w-16 text-right"
                          style={{ color: BEAT_FN_COLORS[beat.fn] ?? '#ffffff44' }}
                        >
                          {beat.fn}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] text-text-secondary leading-snug">{beat.what}</div>
                          {beat.mechanism && (
                            <div className="text-[9px] text-text-dim font-mono mt-0.5 opacity-60">{beat.mechanism}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Anchors */}
                {anchors.length > 0 && (
                  <div>
                    <div className="text-[9px] uppercase tracking-[0.15em] text-text-dim font-mono mb-3">Anchors</div>
                    <div className="space-y-1.5">
                      {anchors.map((a, ai) => (
                        <div key={ai} className="text-[10px] text-text-secondary leading-snug flex items-start gap-2">
                          <span className="text-indigo-400/30 shrink-0 mt-0.5">—</span>
                          <span>{a}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Chunk detail panel — resizable ── */}
      {selectedChunk !== null && !isPlanExtracting && (() => {
        const result = liveJob.results[selectedChunk] as AnalysisChunkResult | null;
        if (!result) return null;
        const wkNodes = (result.scenes ?? []).flatMap((s) => s.worldKnowledgeMutations?.addedNodes ?? []);
        const wkEdges = (result.scenes ?? []).flatMap((s) => s.worldKnowledgeMutations?.addedEdges ?? []);
        const wkTypeColors: Record<string, string> = { law: 'text-amber-400', system: 'text-sky-400', concept: 'text-violet-400', tension: 'text-rose-400' };
        return (
          <div className="shrink-0 border-t border-white/8 flex flex-col" style={{ height: `${chunkPanelHeight}vh` }}>
            {/* Drag handle */}
            <div
              className="h-2 cursor-ns-resize flex items-center justify-center hover:bg-white/4 transition-colors shrink-0"
              onMouseDown={(e) => {
                e.preventDefault();
                const startY = e.clientY;
                const startH = chunkPanelHeight;
                const onMove = (ev: MouseEvent) => {
                  const delta = startY - ev.clientY;
                  setChunkPanelHeight(Math.max(15, Math.min(80, startH + (delta / window.innerHeight) * 100)));
                };
                const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
            >
              <div className="w-10 h-0.5 rounded-full bg-white/15" />
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 pb-4" style={{ scrollbarWidth: 'thin' }}>
              {/* Header */}
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-text-primary">Chunk {selectedChunk + 1}</span>
                  <div className="flex items-center gap-2 text-[10px] text-text-dim">
                    <span>{result.characters?.length ?? 0} chars</span>
                    <span className="text-white/10">·</span>
                    <span>{result.locations?.length ?? 0} locs</span>
                    <span className="text-white/10">·</span>
                    <span>{result.scenes?.length ?? 0} scenes</span>
                    <span className="text-white/10">·</span>
                    <span>{result.threads?.length ?? 0} threads</span>
                    {wkNodes.length > 0 && <>
                      <span className="text-white/10">·</span>
                      <span className="text-violet-400/70">{wkNodes.length} knowledge</span>
                    </>}
                  </div>
                </div>
                <button onClick={() => setSelectedChunk(null)} className="text-xs text-text-dim hover:text-text-secondary transition px-2 py-1 rounded hover:bg-white/5">&times;</button>
              </div>

              {/* Summary */}
              {result.chapterSummary && (
                <p className="text-[11px] text-text-secondary leading-relaxed mb-5 italic">{result.chapterSummary}</p>
              )}

              {/* Three-column grid: entities | scenes | knowledge */}
              <div className="grid grid-cols-3 gap-6">
                {/* Column 1: Characters + Locations + Threads */}
                <div className="space-y-5">
                  <div>
                    <div className="text-[9px] uppercase tracking-[0.15em] text-text-dim font-mono mb-2">Characters</div>
                    <div className="flex flex-wrap gap-1.5">
                      {result.characters?.map((c, ci) => (
                        <span key={`${c.name}-${ci}`} className={`text-[10px] px-2.5 py-1 rounded-md ${
                          c.role === 'anchor' ? 'bg-white/10 text-text-primary font-medium' :
                          c.role === 'recurring' ? 'bg-white/6 text-text-secondary' :
                          'bg-white/3 text-text-dim'
                        }`}>
                          {c.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[9px] uppercase tracking-[0.15em] text-text-dim font-mono mb-2">Locations</div>
                    <div className="flex flex-wrap gap-1.5">
                      {result.locations?.map((l, li) => (
                        <span key={`${l.name}-${li}`} className="text-[10px] bg-emerald-500/10 text-emerald-400/70 px-2.5 py-1 rounded-md">
                          {l.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[9px] uppercase tracking-[0.15em] text-text-dim font-mono mb-2">Threads</div>
                    <div className="space-y-1.5">
                      {result.threads?.map((t, ti) => (
                        <div key={ti} className="text-[10px] leading-snug flex items-start gap-2">
                          <span className="text-[9px] text-sky-400/50 font-mono shrink-0 mt-0.5">{t.statusAtEnd}</span>
                          <span className="text-text-secondary">{t.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Column 2: Scenes */}
                <div>
                  <div className="text-[9px] uppercase tracking-[0.15em] text-text-dim font-mono mb-2">Scenes</div>
                  <div className="space-y-3">
                    {result.scenes?.map((s, si) => (
                      <div key={si} className="border-l-2 border-white/6 pl-3">
                        <div className="text-[10px] text-text-primary font-medium">{s.locationName} — {s.povName}</div>
                        <div className="text-[10px] text-text-dim mt-1 leading-relaxed">{s.summary}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Column 3: World Knowledge */}
                <div>
                  <div className="text-[9px] uppercase tracking-[0.15em] text-text-dim font-mono mb-2">World Knowledge</div>
                  {wkNodes.length > 0 ? (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        {wkNodes.map((n, ni) => (
                          <div key={ni} className="flex items-start gap-2">
                            <span className={`text-[9px] font-mono shrink-0 mt-0.5 ${wkTypeColors[n.type] ?? 'text-text-dim'}`}>{n.type}</span>
                            <span className="text-[10px] text-text-secondary">{n.concept.includes(' — ') ? n.concept.split(' — ')[0] : n.concept}</span>
                          </div>
                        ))}
                      </div>
                      {wkEdges.length > 0 && (
                        <div className="space-y-1 border-t border-white/5 pt-3">
                          <div className="text-[9px] uppercase tracking-[0.15em] text-text-dim font-mono mb-1.5">Connections</div>
                          {wkEdges.map((e, ei) => (
                            <div key={ei} className="text-[10px] text-text-dim">
                              <span className="text-text-secondary">{e.fromConcept}</span>
                              {' '}<span className="italic text-text-dim">{e.relation}</span>{' '}
                              <span className="text-text-secondary">{e.toConcept}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-[10px] text-text-dim italic">No world knowledge in this chunk</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Bottom: Phase indicator + Chunk timeline — always visible ── */}
      <div className="shrink-0 border-t border-white/6 bg-black/25 px-6 py-3">
        {/* Phase progress bar */}
        {isRunning && (
          <div className="flex items-center gap-3 mb-2.5">
            {[
              { label: 'Extract', active: !isPlanExtracting && !isReconciling && !isAssembling, done: completedChunks === totalChunks, color: 'bg-change' },
              ...(liveJob.extractPlans ? [{ label: 'Plans', active: isPlanExtracting, done: isReconciling || isAssembling || liveJob.status === 'completed', color: 'bg-indigo-400' }] : []),
              { label: 'Reconcile', active: isReconciling, done: isAssembling || liveJob.status === 'completed', color: 'bg-sky-400' },
              { label: 'Assemble', active: isAssembling, done: liveJob.status === 'completed', color: 'bg-amber-400' },
            ].map((phase, pi) => (
              <div key={phase.label} className="flex items-center gap-1.5">
                {pi > 0 && <div className="w-4 h-px bg-white/6" />}
                <div className={`w-1.5 h-1.5 rounded-full transition-all ${
                  phase.active ? `${phase.color} animate-pulse` : phase.done ? 'bg-emerald-400' : 'bg-white/8'
                }`} />
                <span className={`text-[9px] font-mono uppercase tracking-wider transition ${
                  phase.active ? 'text-white/50' : phase.done ? 'text-emerald-400/40' : 'text-white/10'
                }`}>
                  {phase.label}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-4 mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full bg-change/50" />
            <span className="text-[9px] text-white/20 font-mono uppercase tracking-wider">Chunks</span>
            <span className="text-[9px] text-white/10 font-mono">{completedChunks} / {totalChunks}</span>
          </div>
          {liveJob.extractPlans && beatStats.planCount > 0 && (
            <div className="flex items-center gap-1.5">
              <div className={`w-1 h-1 rounded-full ${isPlanExtracting ? 'bg-indigo-400/70 animate-pulse' : 'bg-indigo-400/40'}`} />
              <span className="text-[9px] text-white/20 font-mono uppercase tracking-wider">Plans</span>
              <span className="text-[9px] text-indigo-400/30 font-mono">{beatStats.planCount} / {sceneCount}</span>
            </div>
          )}
        </div>
        <div className="overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
          {isPlanExtracting ? (
            /* Plans phase — scene tiles */
            <div className="flex items-center gap-1">
              {allExtractedScenes.map((scene, si) => {
                const isInFlight = planInFlightSet.has(scene.key);
                const hasPlan = !!scene.plan;
                const isSelected = selectedPlanKey === scene.key;
                return (
                  <button
                    key={scene.key}
                    onClick={() => setSelectedPlanKey(isSelected ? null : scene.key)}
                    disabled={!hasPlan && !isInFlight}
                    className={`relative w-10 min-w-10 h-10 rounded transition-all duration-300 group shrink-0 ${
                      isSelected
                        ? 'bg-white/15 ring-1 ring-white/30 scale-[1.08]'
                        : hasPlan
                          ? 'bg-indigo-500/15 ring-1 ring-indigo-400/20 hover:bg-indigo-500/25'
                          : isInFlight
                            ? 'bg-indigo-400/8 ring-1 ring-indigo-400/15'
                            : 'bg-white/3'
                    } ${hasPlan || isInFlight ? 'cursor-pointer' : 'cursor-default'}`}
                    title={scene.povName ? `${scene.povName}${scene.summary ? ': ' + scene.summary.slice(0, 60) : ''}` : `Scene ${si + 1}`}
                  >
                    {isInFlight ? (
                      <IconSpinner size={16} className="absolute inset-0 m-auto text-indigo-400/50 animate-spin" />
                    ) : (
                      <span className={`text-[9px] font-mono absolute top-1.5 inset-x-0 flex items-center justify-center transition ${
                        isSelected ? 'text-white/80 font-semibold'
                        : hasPlan ? 'text-indigo-400/60 group-hover:text-indigo-400/80'
                        : 'text-white/12'
                      }`}>
                        {si + 1}
                      </span>
                    )}
                    {!isInFlight && (
                      <div className="absolute bottom-1.5 inset-x-0 flex items-center justify-center">
                        <div className={`w-1 h-1 rounded-full transition-all duration-500 ${hasPlan ? 'bg-indigo-400/60' : 'bg-white/8'}`} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            /* Extract phase — chunk tiles */
            <div className="flex items-center gap-1">
              {liveJob.chunks.map((_, i) => {
                const extracted = liveJob.results[i] !== null;
                const isInFlight = inFlightSet.has(i);
                const isSelected = selectedChunk === i;
                const result = liveJob.results[i] as AnalysisChunkResult | null;
                const proseScenesCount = result?.scenes?.filter((s) => s.prose).length ?? 0;
                const plannedCount = result?.scenes?.filter((s) => s.plan).length ?? 0;
                const allPlanned = extracted && (proseScenesCount === 0 || plannedCount >= proseScenesCount);
                const partiallyPlanned = extracted && plannedCount > 0 && !allPlanned;
                const awaitingPlans = isPlanExtracting && extracted && plannedCount === 0;
                return (
                  <button
                    key={i}
                    onClick={() => {
                      if (extracted) setSelectedChunk(isSelected ? null : i);
                      else if (isInFlight) setViewingChunkStream(i);
                    }}
                    disabled={!extracted && !isInFlight}
                    className={`relative w-10 min-w-10 h-10 rounded transition-all duration-300 group shrink-0 ${
                      isSelected
                        ? 'bg-white/15 ring-1 ring-white/30 scale-[1.08]'
                        : allPlanned
                          ? 'bg-emerald-500/20 ring-1 ring-indigo-400/20 hover:bg-emerald-500/30'
                          : partiallyPlanned
                            ? 'bg-emerald-500/15 ring-1 ring-indigo-400/10'
                            : awaitingPlans
                              ? 'bg-emerald-500/10'
                              : extracted
                                ? 'bg-emerald-500/12 hover:bg-emerald-500/20'
                                : isInFlight
                                  ? 'bg-change/10 ring-1 ring-change/20'
                                  : 'bg-white/3'
                    } ${extracted || isInFlight ? 'cursor-pointer' : 'cursor-default'}`}
                    title={result
                      ? `Chunk ${i + 1}: ${result.characters?.length ?? 0} chars, ${result.scenes?.length ?? 0} scenes${plannedCount > 0 ? `, ${plannedCount} plans` : ''}`
                      : isInFlight ? `Chunk ${i + 1}: extracting...` : `Chunk ${i + 1}: pending`}
                  >
                    {isInFlight ? (
                      <IconSpinner size={16} className="absolute inset-0 m-auto text-change/60 animate-spin" />
                    ) : (
                      <span className={`text-[10px] font-mono absolute top-1.5 inset-x-0 flex items-center justify-center transition ${
                        isSelected ? 'text-white/80 font-semibold'
                        : allPlanned ? 'text-emerald-400/70 group-hover:text-emerald-400/90'
                        : extracted ? 'text-emerald-400/40 group-hover:text-emerald-400/60'
                        : 'text-white/8'
                      }`}>
                        {i + 1}
                      </span>
                    )}
                    {!isInFlight && (
                      <div className="absolute bottom-1.5 inset-x-0 flex items-center justify-center gap-1">
                        <div className={`w-1 h-1 rounded-full transition-all duration-500 ${extracted ? 'bg-emerald-400/60' : 'bg-white/8'}`} />
                        {liveJob.extractPlans && (
                          <div className={`w-1 h-1 rounded-full transition-all duration-500 ${
                            allPlanned ? 'bg-indigo-400/70'
                            : partiallyPlanned ? 'bg-indigo-400/35'
                            : awaitingPlans ? 'bg-indigo-400/15 animate-pulse'
                            : 'bg-white/5'
                          }`} />
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Title detection via LLM ─────────────────────────────────────────────── */
async function detectTitleLLM(chunkText: string): Promise<string> {
  const { apiHeaders } = await import('@/lib/api-headers');
  const { logApiCall, updateApiLog } = await import('@/lib/api-logger');

  const prompt = `Here is the first chunk of a text. What is the title of this work? Reply with ONLY the title, nothing else. No quotes, no explanation.\n\n${chunkText}`;
  const systemPrompt = 'You identify book/screenplay/text titles from their content. Reply with only the title in proper title case.';
  const logId = logApiCall('detectTitleLLM', prompt.length + systemPrompt.length, prompt, DEFAULT_MODEL);
  const start = performance.now();

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ prompt, systemPrompt, maxTokens: 50 }),
    });
    if (!res.ok) {
      updateApiLog(logId, { status: 'error', error: `HTTP ${res.status}`, durationMs: Math.round(performance.now() - start) });
      return '';
    }
    const data = await res.json();
    const title = (data.content ?? '').trim().replace(/^["']|["']$/g, '');
    updateApiLog(logId, { status: 'success', durationMs: Math.round(performance.now() - start), responseLength: title.length, responsePreview: title });
    return title.length > 0 && title.length < 100 ? title : '';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
    return '';
  }
}

/* ── New job setup ────────────────────────────────────────────────────────── */
function NewJobSetup({ sourceText, onCreated }: { sourceText: string; onCreated: (jobId: string) => void }) {
  const { dispatch } = useStore();
  const [title, setTitle] = useState('');
  const [detecting, setDetecting] = useState(true);
  const [extractPlans, setExtractPlans] = useState(false);

  const chunks = splitCorpusIntoChunks(sourceText);

  // Auto-detect title via LLM using first chunk
  useEffect(() => {
    let cancelled = false;
    const firstChunkText = chunks.length > 0 ? chunks[0].text : sourceText.slice(0, 4000);
    detectTitleLLM(firstChunkText).then((detected) => {
      if (!cancelled && detected) setTitle(detected);
    }).finally(() => {
      if (!cancelled) setDetecting(false);
    });
    return () => { cancelled = true; };
  }, [sourceText]);
  const wordCount = sourceText.split(/\s+/).length;
  const tooLarge = wordCount > ANALYSIS_MAX_CORPUS_WORDS;

  const handleStart = () => {
    if (!title.trim() || tooLarge) return;
    const job: AnalysisJob = {
      id: `AJ-${Date.now().toString(36)}`,
      title: title.trim(),
      sourceText,
      chunks,
      results: new Array(chunks.length).fill(null),
      status: 'pending',
      currentChunkIndex: 0,
      extractPlans,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    dispatch({ type: 'ADD_ANALYSIS_JOB', job });
    onCreated(job.id);
    // Auto-start the analysis runner immediately
    analysisRunner.start(job).catch((err) => {
      console.error('[analysis] auto-start failed:', err);
    });
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6 relative z-10">
      <div className="max-w-md w-full space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-white/90 mb-1">New Analysis</h2>
          <p className={`text-[10px] uppercase tracking-wider font-mono ${tooLarge ? 'text-red-400/70' : 'text-white/30'}`}>
            {wordCount.toLocaleString()} words &middot; {chunks.length} chunk{chunks.length !== 1 ? 's' : ''} detected
            {tooLarge && ` · max ${ANALYSIS_MAX_CORPUS_WORDS.toLocaleString()}`}
          </p>
        </div>

        {tooLarge && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
            <p className="text-[11px] text-red-400/80 leading-relaxed">
              This text exceeds the {ANALYSIS_MAX_CORPUS_WORDS.toLocaleString()} word limit. Analyze a single book or screenplay at a time, not an entire series.
            </p>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] uppercase tracking-[0.15em] text-white/30 font-mono">Title</label>
            {detecting && (
              <span className="text-[9px] text-change/60 font-mono flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-change/60 animate-pulse" />
                detecting...
              </span>
            )}
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleStart(); }}
            placeholder={detecting ? 'Detecting title...' : 'e.g. The Great Gatsby'}
            className="bg-white/5 border border-white/8 rounded-lg px-3 py-2.5 text-sm text-white w-full outline-none placeholder:text-white/20 focus:border-white/16 transition"
            autoFocus
          />
        </div>

        {/* Beat plan toggle */}
        <label className="flex items-center gap-2.5 cursor-pointer group">
          <div
            onClick={() => setExtractPlans((v) => !v)}
            className={`w-3.5 h-3.5 rounded-sm border transition shrink-0 flex items-center justify-center ${
              extractPlans ? 'bg-indigo-500/50 border-indigo-400/60' : 'bg-white/4 border-white/15 group-hover:border-white/25'
            }`}
          >
            {extractPlans && (
              <IconCheck size={10} className="text-indigo-300" />
            )}
          </div>
          <span className={`text-[11px] transition select-none ${extractPlans ? 'text-white/60' : 'text-white/30 group-hover:text-white/45'}`}>
            Extract beat plans <span className="text-white/20">· +1 LLM call per scene</span>
          </span>
        </label>

        <div className="text-[11px] text-white/20 leading-relaxed">
          {chunks.length} chunks analyzed in parallel — extracts characters, locations, threads, scenes, and world knowledge, then reconciles and assembles.
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => window.history.back()}
            className="text-xs text-white/30 hover:text-white/60 px-4 py-2.5 transition"
          >
            Back
          </button>
          <button
            onClick={handleStart}
            disabled={!title.trim() || tooLarge}
            className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-semibold px-5 py-2.5 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none"
          >
            Start Analysis
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Jobs list (sidebar) ──────────────────────────────────────────────────── */
function JobsList({ jobs, selectedId, onSelect }: { jobs: AnalysisJob[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { dispatch } = useStore();
  const router = useRouter();

  if (jobs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-white/20 text-[11px] mb-2">No analysis jobs</p>
          <button
            onClick={() => router.push('/')}
            className="text-[10px] text-white/30 hover:text-white/60 underline underline-offset-2 transition"
          >
            Paste text to start
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {jobs.map((job) => {
        const completedChunks = job.results.filter((r) => r !== null).length;
        const totalChunks = job.chunks.length;
        const progress = totalChunks > 0 ? Math.round((completedChunks / totalChunks) * 100) : 0;
        const isSelected = job.id === selectedId;

        return (
          <div
            key={job.id}
            onClick={() => onSelect(job.id)}
            className={`group flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-white/4 transition ${
              isSelected ? 'bg-white/5' : 'hover:bg-white/3'
            }`}
          >
            <div className={`w-2 h-2 rounded-full shrink-0 ${
              job.status === 'completed' ? 'bg-emerald-400' :
              job.status === 'failed' ? 'bg-red-400' :
              job.status === 'running' ? 'bg-change animate-pulse' :
              job.status === 'paused' ? 'bg-yellow-400/60' :
              'bg-white/20'
            }`} />

            <div className="flex-1 min-w-0">
              <div className="text-xs text-white/70 font-medium truncate">{job.title}</div>
              <div className="text-[10px] text-white/25 font-mono mt-0.5">
                {completedChunks}/{totalChunks} &middot; {progress}%
              </div>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: 'DELETE_ANALYSIS_JOB', id: job.id });
              }}
              className="text-white/10 hover:text-white/50 text-sm opacity-0 group-hover:opacity-100 transition shrink-0"
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ── Analysis dashboard page ──────────────────────────────────────────────── */
export default function AnalysisPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-bg-base" />}>
      <AnalysisPageInner />
    </Suspense>
  );
}

function AnalysisPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state } = useStore();

  const isNew = searchParams.get('new') === '1';
  const initialJobId = searchParams.get('job');

  const [sourceText, setSourceText] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(initialJobId);
  const [showNewSetup, setShowNewSetup] = useState(isNew && !initialJobId);

  // Load source text from IndexedDB for new analysis jobs
  useEffect(() => {
    if (!isNew || initialJobId) return;
    import('@/lib/analysis-transfer').then(({ getAnalysisSource }) =>
      getAnalysisSource().then((text) => {
        if (text) {
          setSourceText(text);
        } else {
          // No source text found — fall back to showing jobs list
          setShowNewSetup(false);
        }
      })
    );
  }, [isNew, initialJobId]);

  const selectedJob = selectedJobId ? state.analysisJobs.find((j) => j.id === selectedJobId) ?? null : null;

  return (
    <div className="h-screen bg-bg-base flex relative overflow-hidden">
      {/* Aurora background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="aurora-container aurora-workspace absolute bottom-0 left-0 right-0 h-full" style={{ opacity: 0.25 }}>
          <div className="aurora-curtain aurora-curtain-1" />
          <div className="aurora-curtain aurora-curtain-3" />
          <div className="aurora-curtain aurora-curtain-5" />
          <div className="aurora-wisp aurora-wisp-2" />
          <div className="aurora-wisp aurora-wisp-4" />
          <div className="aurora-glow" />
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-56 border-r border-white/6 flex flex-col shrink-0 bg-black/20 backdrop-blur-sm relative z-10">
        <div className="px-4 py-4 border-b border-white/6 flex items-center justify-between">
          <button
            onClick={() => router.push('/')}
            className="text-[10px] uppercase tracking-[0.15em] text-white/30 font-mono hover:text-white/60 transition flex items-center gap-1.5"
          >
            <IconChevronLeft size={12} />
            Home
          </button>
          <h1 className="text-[10px] uppercase tracking-[0.15em] text-white/40 font-mono">Analysis</h1>
        </div>
        <JobsList
          jobs={state.analysisJobs}
          selectedId={selectedJobId}
          onSelect={(id) => {
            setSelectedJobId(id);
            setShowNewSetup(false);
          }}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative z-10">
        {showNewSetup && sourceText ? (
          <NewJobSetup
            sourceText={sourceText}
            onCreated={(id) => {
              setSelectedJobId(id);
              setShowNewSetup(false);
              import('@/lib/analysis-transfer').then(({ removeAnalysisSource }) => removeAnalysisSource());
            }}
          />
        ) : showNewSetup && !sourceText ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-white/20 text-sm">Loading text...</span>
          </div>
        ) : selectedJob ? (
          <JobDetail
            key={selectedJob.id}
            job={selectedJob}
          />
        ) : state.analysisJobs.length === 0 ? (
          <div className="flex-1 flex items-center justify-center relative z-10">
            <div className="text-center">
              <p className="text-white/20 text-sm">No analysis jobs yet</p>
              <button
                onClick={() => router.push('/')}
                className="mt-3 text-[11px] text-white/40 hover:text-white/70 underline underline-offset-2 transition"
              >
                Paste text on home page to start
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
