'use client';

import { Suspense, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStore } from '@/lib/store';
import { splitCorpusIntoChunks } from '@/lib/text-analysis';
import { analysisRunner } from '@/lib/analysis-runner';
import type { AnalysisJob, AnalysisChunkResult } from '@/types/narrative';
import { ANALYSIS_MAX_CORPUS_WORDS } from '@/lib/constants';

/* ── Word Node type ─────────────────────────────────────────────────────── */

type WordNode = { label: string; type: 'character' | 'location' | 'thread'; count: number; firstSeen: number };

/* ── Job detail panel ─────────────────────────────────────────────────────── */
function JobDetail({ job }: { job: AnalysisJob }) {
  const router = useRouter();
  const { state, dispatch } = useStore();
  const streamRef = useRef<HTMLPreElement>(null);
  const [streamText, setStreamText] = useState(() => analysisRunner.getStreamText(job.id));
  const [selectedChunk, setSelectedChunk] = useState<number | null>(null);
  const [inFlightIndices, setInFlightIndices] = useState<number[]>(() => analysisRunner.getInFlightIndices(job.id));
  const [chunkStreamTexts, setChunkStreamTexts] = useState<Map<number, string>>(new Map());
  const [viewingChunkStream, setViewingChunkStream] = useState<number | null>(null);
  const [assembling, setAssembling] = useState(false);

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
    });

    return Array.from(map.values());
  }, [liveJob.results]);

  // Separate word nodes by type
  const { characters, locations, threads } = useMemo(() => {
    const c: WordNode[] = [];
    const l: WordNode[] = [];
    const t: WordNode[] = [];
    for (const n of wordNodes) {
      if (n.type === 'character') c.push(n);
      else if (n.type === 'location') l.push(n);
      else t.push(n);
    }
    c.sort((a, b) => b.count - a.count);
    l.sort((a, b) => b.count - a.count);
    t.sort((a, b) => b.count - a.count);
    return { characters: c, locations: l, threads: t };
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

  const completedChunks = liveJob.results.filter((r) => r !== null).length;
  const totalChunks = liveJob.chunks.length;
  const isReconciling = completedChunks === totalChunks && liveJob.status === 'running' && !liveJob.narrativeId && streamText.includes('Reconcil');
  const isAssembling = completedChunks === totalChunks && liveJob.status === 'running' && !isReconciling;

  const completed = liveJob.results.filter((r): r is AnalysisChunkResult => r !== null);
  const charCount = new Set(completed.flatMap((r) => r.characters.map((c) => c.name))).size;
  const locCount = new Set(completed.flatMap((r) => r.locations.map((l) => l.name))).size;
  const sceneCount = completed.reduce((sum, r) => sum + (r.scenes?.length ?? 0), 0);
  const threadCount = new Set(completed.flatMap((r) => r.threads.map((t) => t.description))).size;

  // Current chunk stream text for viewing
  const activeChunkStream = viewingChunkStream !== null ? (chunkStreamTexts.get(viewingChunkStream) ?? '') : '';

  const renderNode = (node: WordNode) => {
    const ratio = node.count / maxCount;
    const fontSize = Math.round(13 + ratio * 22);
    const opacity = 0.35 + ratio * 0.65;
    const isHighFreq = ratio > 0.5;

    const styles = {
      character: { cls: 'text-white/90', glow: 'rgba(255,255,255,0.12)' },
      location: { cls: 'text-emerald-400', glow: 'rgba(52,211,153,0.18)' },
      thread: { cls: 'text-sky-400', glow: 'rgba(56,189,248,0.15)' },
    }[node.type];

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
                  router.push(`/series/${liveJob.narrativeId}`);
                } else {
                  setAssembling(true);
                  try {
                    const { assembleNarrative } = await import('@/lib/text-analysis');
                    const completedResults = liveJob.results.filter((r): r is AnalysisChunkResult => r !== null);
                    const narrative = await assembleNarrative(liveJob.title, completedResults);
                    dispatch({ type: 'ADD_NARRATIVE', narrative });
                    dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: liveJob.id, updates: { narrativeId: narrative.id } });
                    router.push(`/series/${narrative.id}`);
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
            </div>
          )}
        </div>

        {/* Right column — chunk stream viewer during extraction, job stream during reconciliation/assembly */}
        {(isRunning || streamText) && (
          <div className="w-80 shrink-0 border-l border-white/6 bg-black/40 flex flex-col min-h-0">
            {/* Header */}
            <div className="px-3 py-2 flex items-center gap-2 border-b border-white/4 shrink-0">
              <div className={`w-1.5 h-1.5 rounded-full ${isReconciling ? 'bg-sky-400' : isAssembling ? 'bg-amber-400' : 'bg-change'} animate-pulse`} />
              <span className="text-[9px] text-white/25 font-mono uppercase tracking-wider">
                {isReconciling ? 'Reconciliation' : isAssembling ? 'Assembly' : `Extraction`}
              </span>
              {!isReconciling && !isAssembling && (
                <span className="text-[9px] text-white/10 font-mono ml-auto">{completedChunks}/{totalChunks}</span>
              )}
            </div>

            {/* Extraction phase: chunk stream tabs + stream viewer */}
            {!isReconciling && !isAssembling ? (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Chunk tabs — scrollable row of in-flight + recently completed */}
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
                        <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
                          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                        </svg>
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
                  /* Compact batch grid when no stream is active */
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
                              <svg className="w-3 h-3 text-change/50 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
                                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                              </svg>
                            ) : done ? (
                              <svg className="w-3 h-3 text-emerald-400/50 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
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

      {/* ── Chunk detail panel — above timeline when a chunk is selected ── */}
      {selectedChunk !== null && (() => {
        const result = liveJob.results[selectedChunk] as AnalysisChunkResult | null;
        if (!result) return null;
        return (
          <div className="shrink-0 border-t border-white/6 bg-black/30 overflow-y-auto max-h-[35vh]" style={{ scrollbarWidth: 'thin' }}>
            <div className="px-8 py-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-white/70">Chunk {selectedChunk + 1}</h3>
                <button onClick={() => setSelectedChunk(null)} className="text-[10px] text-white/20 hover:text-white/50 transition">&times; close</button>
              </div>

              {result.chapterSummary && (
                <p className="text-[11px] text-white/35 leading-relaxed mb-4 italic">{result.chapterSummary}</p>
              )}

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-[9px] uppercase tracking-[0.15em] text-white/20 font-mono mb-2">Characters ({result.characters?.length ?? 0})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {result.characters?.map((c, ci) => (
                      <span key={`${c.name}-${ci}`} className={`text-[10px] px-2 py-0.5 rounded-full ${
                        c.role === 'anchor' ? 'bg-white/8 text-white/60 font-medium' :
                        c.role === 'recurring' ? 'bg-white/5 text-white/40' :
                        'bg-white/3 text-white/25'
                      }`}>
                        {c.name}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[9px] uppercase tracking-[0.15em] text-white/20 font-mono mb-2">Locations ({result.locations?.length ?? 0})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {result.locations?.map((l, li) => (
                      <span key={`${l.name}-${li}`} className="text-[10px] bg-emerald-500/8 text-emerald-400/50 px-2 py-0.5 rounded-full">
                        {l.name}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[9px] uppercase tracking-[0.15em] text-white/20 font-mono mb-2">Threads ({result.threads?.length ?? 0})</div>
                  <div className="space-y-1">
                    {result.threads?.map((t, ti) => (
                      <div key={ti} className="text-[10px] text-sky-400/40 leading-snug">
                        <span className="text-sky-400/20 mr-1">{t.statusAtEnd}</span> {t.description}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[9px] uppercase tracking-[0.15em] text-white/20 font-mono mb-2">Scenes ({result.scenes?.length ?? 0})</div>
                  <div className="space-y-2">
                    {result.scenes?.map((s, si) => (
                      <div key={si} className="text-[10px] leading-snug">
                        <div className="text-white/30 font-medium">{s.locationName} &mdash; {s.povName}</div>
                        <div className="text-white/20 mt-0.5">{s.summary}</div>
                      </div>
                    ))}
                  </div>
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
              { label: 'Extract', active: !isReconciling && !isAssembling, done: completedChunks === totalChunks, color: 'bg-change' },
              { label: 'Reconcile', active: isReconciling, done: isAssembling, color: 'bg-sky-400' },
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
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[9px] text-white/20 font-mono uppercase tracking-wider">Chunks</span>
          <span className="text-[9px] text-white/10 font-mono">{completedChunks} / {totalChunks}</span>
        </div>
        <div className="overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
          <div className="flex items-center gap-1">
            {liveJob.chunks.map((_, i) => {
              const done = liveJob.results[i] !== null;
              const isInFlight = inFlightSet.has(i);
              const isSelected = selectedChunk === i;
              const result = liveJob.results[i] as AnalysisChunkResult | null;
              return (
                <button
                  key={i}
                  onClick={() => {
                    if (done) setSelectedChunk(isSelected ? null : i);
                    else if (isInFlight) setViewingChunkStream(i);
                  }}
                  disabled={!done && !isInFlight}
                  className={`relative w-10 min-w-[2.5rem] h-9 rounded transition-all duration-300 group shrink-0 ${
                    isSelected
                      ? 'bg-white/15 ring-1 ring-white/30 scale-[1.08]'
                      : done
                        ? 'bg-emerald-500/20 hover:bg-emerald-500/35'
                        : isInFlight
                          ? 'bg-change/10 ring-1 ring-change/20 cursor-pointer hover:bg-change/15'
                          : 'bg-white/3'
                  } ${done || isInFlight ? 'cursor-pointer' : 'cursor-default'}`}
                  title={result
                    ? `Chunk ${i + 1}: ${result.characters?.length ?? 0} chars, ${result.scenes?.length ?? 0} scenes, ${result.threads?.length ?? 0} threads`
                    : isInFlight ? `Chunk ${i + 1}: extracting... (click to view stream)` : `Chunk ${i + 1}: pending`}
                >
                  {isInFlight ? (
                    <svg className="absolute inset-0 m-auto w-4 h-4 text-change/60 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.2" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <span className={`text-[10px] font-mono absolute inset-0 flex items-center justify-center transition ${
                      isSelected ? 'text-white/80 font-semibold' : done ? 'text-emerald-400/50 group-hover:text-emerald-400/80' : 'text-white/8'
                    }`}>
                      {i + 1}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Constants ────────────────────────────────────────────────────────────── */
const MAX_CORPUS_WORDS = ANALYSIS_MAX_CORPUS_WORDS;

/* ── Title detection via LLM ─────────────────────────────────────────────── */
async function detectTitleLLM(chunkText: string): Promise<string> {
  const { apiHeaders } = await import('@/lib/api-headers');
  const { logApiCall, updateApiLog } = await import('@/lib/api-logger');

  const prompt = `Here is the first chunk of a text. What is the title of this work? Reply with ONLY the title, nothing else. No quotes, no explanation.\n\n${chunkText}`;
  const systemPrompt = 'You identify book/screenplay/text titles from their content. Reply with only the title in proper title case.';
  const logId = logApiCall('detectTitleLLM', prompt.length + systemPrompt.length, prompt);
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

  const chunks = splitCorpusIntoChunks(sourceText);
  const wordCount = sourceText.split(/\s+/).length;
  const tooLarge = wordCount > MAX_CORPUS_WORDS;

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
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    dispatch({ type: 'ADD_ANALYSIS_JOB', job });
    onCreated(job.id);
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6 relative z-10">
      <div className="max-w-md w-full space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-white/90 mb-1">New Analysis</h2>
          <p className={`text-[10px] uppercase tracking-wider font-mono ${tooLarge ? 'text-red-400/70' : 'text-white/30'}`}>
            {wordCount.toLocaleString()} words &middot; {chunks.length} chunk{chunks.length !== 1 ? 's' : ''} detected
            {tooLarge && ` · max ${MAX_CORPUS_WORDS.toLocaleString()}`}
          </p>
        </div>

        {tooLarge && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
            <p className="text-[11px] text-red-400/80 leading-relaxed">
              This text exceeds the {MAX_CORPUS_WORDS.toLocaleString()} word limit. Analyze a single book or screenplay at a time, not an entire series.
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

        <div className="text-[11px] text-white/25 leading-relaxed">
          The text will be split into {chunks.length} chunks and analyzed in parallel. Each chunk independently extracts characters, locations, threads, scenes, and relationships, then a reconciliation pass merges duplicates and stitches thread continuity.
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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
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
