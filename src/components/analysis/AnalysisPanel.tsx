'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { splitCorpusIntoChunks, analyzeChunk, assembleNarrative } from '@/lib/text-analysis';
import type { AnalysisJob, AnalysisChunkResult } from '@/types/narrative';

type Props = {
  /** If provided, resume this job instead of starting fresh */
  jobId?: string;
  sourceText?: string;
  title?: string;
  onClose: () => void;
};

export function AnalysisPanel({ jobId, sourceText, title: initialTitle, onClose }: Props) {
  const router = useRouter();
  const { state, dispatch } = useStore();
  const cancelledRef = useRef(false);

  // Find existing job or prepare to create one
  const existingJob = jobId ? state.analysisJobs.find((j) => j.id === jobId) : null;

  const [title, setTitle] = useState(existingJob?.title ?? initialTitle ?? '');
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState('');
  const [currentJob, setCurrentJob] = useState<AnalysisJob | null>(existingJob ?? null);

  // Sync job from store
  useEffect(() => {
    if (currentJob?.id) {
      const updated = state.analysisJobs.find((j) => j.id === currentJob.id);
      if (updated) setCurrentJob(updated);
    }
  }, [state.analysisJobs, currentJob?.id]);

  // Auto-open narrative when the runner finishes assembly
  useEffect(() => {
    if (currentJob?.status === 'completed' && currentJob.narrativeId) {
      dispatch({ type: 'SET_ACTIVE_NARRATIVE', id: currentJob.narrativeId });
      router.push(`/series/${currentJob.narrativeId}`);
      onClose();
    }
  }, [currentJob?.status, currentJob?.narrativeId, dispatch, router, onClose]);

  const runAnalysis = useCallback(async (job: AnalysisJob) => {
    cancelledRef.current = false;
    setIsRunning(true);
    setError('');

    dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'running' } });

    const results = [...job.results];
    let startIdx = job.currentChunkIndex;

    // Find first unprocessed chunk
    while (startIdx < results.length && results[startIdx] !== null) startIdx++;

    for (let i = startIdx; i < job.chunks.length; i++) {
      if (cancelledRef.current) {
        dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused', currentChunkIndex: i } });
        setIsRunning(false);
        return;
      }

      dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { currentChunkIndex: i } });

      try {
        const result = await analyzeChunk(job.chunks[i].text, i, results);
        if (cancelledRef.current) {
          dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused', currentChunkIndex: i, results: [...results] } });
          setIsRunning(false);
          return;
        }
        results[i] = result;
        dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results], currentChunkIndex: i + 1 } });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Chunk ${i + 1} failed: ${message}`);
        dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'failed', error: message, currentChunkIndex: i } });
        setIsRunning(false);
        return;
      }
    }

    // All chunks processed — assemble
    dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'running', currentChunkIndex: job.chunks.length } });

    try {
      const completedResults = results.filter((r): r is AnalysisChunkResult => r !== null);
      const narrative = await assembleNarrative(job.title, completedResults, {});

      dispatch({ type: 'ADD_NARRATIVE', narrative });
      dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'completed', narrativeId: narrative.id } });

      setIsRunning(false);
      router.push(`/series/${narrative.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Assembly failed: ${message}`);
      dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'failed', error: message } });
      setIsRunning(false);
    }
  }, [dispatch, router]);

  const handleStart = useCallback(() => {
    if (!title.trim() || !sourceText) return;

    const chunks = splitCorpusIntoChunks(sourceText);
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
    setCurrentJob(job);
    runAnalysis(job);
  }, [title, sourceText, dispatch, runAnalysis]);

  const handleResume = useCallback(() => {
    if (!currentJob) return;
    runAnalysis(currentJob);
  }, [currentJob, runAnalysis]);

  const handlePause = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  const handleRetry = useCallback(() => {
    if (!currentJob) return;
    setError('');
    runAnalysis(currentJob);
  }, [currentJob, runAnalysis]);

  // Pre-start view
  if (!currentJob) {
    const wordCount = sourceText ? sourceText.split(/\s+/).length : 0;
    const previewChunks = sourceText ? splitCorpusIntoChunks(sourceText) : [];

    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
        <div className="glass max-w-lg w-full rounded-2xl p-6 relative">
          <button onClick={onClose} className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none">&times;</button>

          <h2 className="text-sm font-semibold text-text-primary mb-1">Analyze Text</h2>
          <p className="text-[10px] text-text-dim uppercase tracking-wider mb-4">
            {wordCount.toLocaleString()} words &middot; {previewChunks.length} chunk{previewChunks.length !== 1 ? 's' : ''} detected
          </p>

          <div className="flex flex-col gap-4">
            <div>
              <label className="text-[10px] uppercase tracking-[0.15em] text-text-dim mb-1.5 block font-mono">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. The Great Gatsby"
                className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full outline-none placeholder:text-text-dim focus:border-white/16 transition"
              />
            </div>

            <div className="text-[10px] text-text-dim leading-relaxed">
              The text will be split into {previewChunks.length} chunks and analyzed sequentially. Each chunk extracts characters, locations, threads, scenes, relationships, and prose. The final result is a complete narrative state with rules and image style.
            </div>

            <button
              onClick={handleStart}
              disabled={!title.trim()}
              className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-semibold px-5 py-2.5 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none w-full"
            >
              Start Analysis
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Progress view
  const completedChunks = currentJob.results.filter((r) => r !== null).length;
  const totalChunks = currentJob.chunks.length;
  const isAssembling = completedChunks === totalChunks && currentJob.status === 'running';
  const progress = isAssembling ? 100 : totalChunks > 0 ? Math.round((completedChunks / totalChunks) * 100) : 0;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="glass max-w-lg w-full rounded-2xl p-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none">&times;</button>

        <h2 className="text-sm font-semibold text-text-primary mb-1">{currentJob.title}</h2>
        <p className="text-[10px] text-text-dim uppercase tracking-wider mb-4">
          {isAssembling
            ? 'Assembling narrative...'
            : currentJob.status === 'completed'
              ? 'Analysis complete'
              : currentJob.status === 'failed'
                ? 'Analysis failed'
                : currentJob.status === 'paused'
                  ? 'Paused'
                  : `Analyzing chunk ${Math.min(currentJob.currentChunkIndex + 1, totalChunks)} of ${totalChunks}`}
        </p>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="h-2 bg-white/6 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                currentJob.status === 'failed' ? 'bg-red-500/60' :
                currentJob.status === 'completed' ? 'bg-emerald-500/60' :
                'bg-change/60'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[10px] text-text-dim font-mono">{completedChunks}/{totalChunks} chunks</span>
            <span className="text-[10px] text-text-dim font-mono">{progress}%</span>
          </div>
        </div>

        {/* Chunk status grid */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {currentJob.chunks.map((_, i) => {
            const result = currentJob.results[i];
            const isCurrent = i === currentJob.currentChunkIndex && isRunning;
            return (
              <div
                key={i}
                className={`w-6 h-6 rounded text-[9px] font-mono flex items-center justify-center transition-all ${
                  result !== null
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : isCurrent
                      ? 'bg-change/20 text-change animate-pulse'
                      : 'bg-white/5 text-text-dim'
                }`}
                title={result ? `Chunk ${i + 1}: ${(result as AnalysisChunkResult).scenes?.length ?? 0} scenes` : `Chunk ${i + 1}`}
              >
                {i + 1}
              </div>
            );
          })}
        </div>

        {/* Stats for completed chunks */}
        {completedChunks > 0 && (
          <div className="grid grid-cols-5 gap-2 mb-4">
            {(() => {
              const completed = currentJob.results.filter((r): r is AnalysisChunkResult => r !== null);
              const chars = new Set(completed.flatMap((r) => r.characters.map((c) => c.name)));
              const locs = new Set(completed.flatMap((r) => r.locations.map((l) => l.name)));
              const sceneCount = completed.reduce((sum, r) => sum + (r.scenes?.length ?? 0), 0);
              const threadCount = new Set(completed.flatMap((r) => r.threads.map((t) => t.description))).size;
              const artCount = new Set(completed.flatMap((r) => (r.artifacts ?? []).map((a) => a.name))).size;
              return [
                { label: 'Characters', value: chars.size },
                { label: 'Locations', value: locs.size },
                { label: 'Scenes', value: sceneCount },
                { label: 'Threads', value: threadCount },
                { label: 'Artifacts', value: artCount },
              ].map((s) => (
                <div key={s.label} className="text-center">
                  <div className="text-sm font-semibold text-text-primary">{s.value}</div>
                  <div className="text-[9px] text-text-dim uppercase tracking-wider">{s.label}</div>
                </div>
              ));
            })()}
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-4">
            <p className="text-xs text-red-400/80">{error}</p>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-between">
          {currentJob.status === 'completed' ? (
            <button
              onClick={async () => {
                if (currentJob.narrativeId) {
                  // Already assembled by the runner — just navigate
                  dispatch({ type: 'SET_ACTIVE_NARRATIVE', id: currentJob.narrativeId });
                  router.push(`/series/${currentJob.narrativeId}`);
                } else {
                  // Fallback: assemble if runner didn't (e.g. old paused job)
                  const completedResults = currentJob.results.filter((r): r is AnalysisChunkResult => r !== null);
                  const narrative = await assembleNarrative(currentJob.title, completedResults, {});
                  dispatch({ type: 'ADD_NARRATIVE', narrative });
                  dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: currentJob.id, updates: { narrativeId: narrative.id } });
                  router.push(`/series/${narrative.id}`);
                }
              }}
              className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-semibold px-5 py-2 rounded-lg transition w-full"
            >
              {currentJob.narrativeId ? 'Open Narrative' : 'Create Narrative'}
            </button>
          ) : (
            <>
              <button onClick={onClose} className="text-text-dim text-xs hover:text-text-secondary transition">
                {isRunning ? 'Background' : 'Close'}
              </button>
              <div className="flex gap-2">
                {isRunning && (
                  <button
                    onClick={handlePause}
                    className="text-xs px-4 py-2 rounded-lg bg-white/5 text-text-secondary hover:text-text-primary transition"
                  >
                    Pause
                  </button>
                )}
                {(currentJob.status === 'paused' || currentJob.status === 'failed') && (
                  <button
                    onClick={currentJob.status === 'failed' ? handleRetry : handleResume}
                    className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-semibold px-5 py-2 rounded-lg transition"
                  >
                    {currentJob.status === 'failed' ? 'Retry' : 'Resume'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
