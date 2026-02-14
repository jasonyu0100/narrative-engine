/**
 * Singleton analysis runner — persists across React component mounts/unmounts.
 * Jobs continue running even when the user navigates away from the analysis page.
 *
 * Two-phase parallel pipeline:
 *   Phase 1 — Parallel extraction: all chunks analyzed simultaneously (no cumulative context)
 *   Phase 2 — Sequential reconciliation: deduplicate characters, stitch threads, merge name variants
 */

import { analyzeChunkParallel, reconcileResults, assembleNarrative } from '@/lib/text-analysis';
import type { AnalysisJob, AnalysisChunkResult } from '@/types/narrative';

type Dispatch = (action: import('@/lib/store').Action) => void;

type StreamListener = (jobId: string, text: string) => void;

type RunningJob = {
  cancelled: boolean;
};

/** Max concurrent LLM calls to avoid rate limits / overload */
const MAX_CONCURRENCY = 10;

class AnalysisRunner {
  private running = new Map<string, RunningJob>();
  private dispatch: Dispatch | null = null;
  private dispatchResolvers: Array<(d: Dispatch) => void> = [];
  private streamListeners = new Set<StreamListener>();
  private streamTexts = new Map<string, string>();

  /** Bind the store dispatch — called once from StoreProvider */
  setDispatch(dispatch: Dispatch) {
    this.dispatch = dispatch;
    // Resolve any pending waiters
    for (const resolve of this.dispatchResolvers) resolve(dispatch);
    this.dispatchResolvers = [];
  }

  /** Wait for dispatch to be available (handles race with StoreProvider mount) */
  private getDispatch(): Promise<Dispatch> {
    if (this.dispatch) return Promise.resolve(this.dispatch);
    return new Promise((resolve) => { this.dispatchResolvers.push(resolve); });
  }

  /** Subscribe to stream text updates. Returns unsubscribe fn. */
  onStream(listener: StreamListener): () => void {
    this.streamListeners.add(listener);
    return () => this.streamListeners.delete(listener);
  }

  /** Get current stream text for a job */
  getStreamText(jobId: string): string {
    return this.streamTexts.get(jobId) ?? '';
  }

  isRunning(jobId: string): boolean {
    return this.running.has(jobId);
  }

  pause(jobId: string) {
    const entry = this.running.get(jobId);
    if (entry) entry.cancelled = true;
  }

  /** Start or resume analysis for a job — uses parallel pipeline */
  async start(job: AnalysisJob) {
    if (this.running.has(job.id)) return; // already running

    const d = await this.getDispatch();

    const entry: RunningJob = { cancelled: false };
    this.running.set(job.id, entry);
    this.streamTexts.set(job.id, '');
    d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'running' } });

    const results: (AnalysisChunkResult | null)[] = [...job.results];
    const totalChunks = job.chunks.length;

    // ── Phase 1: Parallel extraction ──────────────────────────────────────
    // Find chunks that still need processing
    const pendingIndices: number[] = [];
    for (let i = 0; i < totalChunks; i++) {
      if (results[i] === null) pendingIndices.push(i);
    }

    if (pendingIndices.length > 0) {
      this.emitStream(job.id, `Phase 1: Extracting ${pendingIndices.length} chunks in parallel...`);

      // Process in batches of MAX_CONCURRENCY
      let completedCount = totalChunks - pendingIndices.length;
      for (let batchStart = 0; batchStart < pendingIndices.length; batchStart += MAX_CONCURRENCY) {
        if (entry.cancelled) {
          d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused', results: [...results], currentChunkIndex: completedCount } });
          this.cleanup(job.id);
          return;
        }

        const batchIndices = pendingIndices.slice(batchStart, batchStart + MAX_CONCURRENCY);
        this.emitStream(job.id, `Phase 1: Processing chunks ${batchIndices.map((i) => i + 1).join(', ')} of ${totalChunks}...`);

        const batchPromises = batchIndices.map((chunkIdx) =>
          analyzeChunkParallel(job.chunks[chunkIdx].text, chunkIdx, totalChunks)
            .then((result) => ({ chunkIdx, result, error: null as string | null }))
            .catch((err) => ({ chunkIdx, result: null as AnalysisChunkResult | null, error: err instanceof Error ? err.message : String(err) })),
        );

        const batchResults = await Promise.all(batchPromises);

        if (entry.cancelled) {
          // Save whatever we got before cancel
          for (const br of batchResults) {
            if (br.result) results[br.chunkIdx] = br.result;
          }
          d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused', results: [...results], currentChunkIndex: completedCount } });
          this.cleanup(job.id);
          return;
        }

        // Store successful results
        for (const br of batchResults) {
          if (br.result) results[br.chunkIdx] = br.result;
        }

        // Retry failed chunks once
        const errors = batchResults.filter((br) => br.error);
        if (errors.length > 0) {
          this.emitStream(job.id, `Phase 1: Retrying ${errors.length} failed chunk(s)...`);
          const retryPromises = errors.map((e) =>
            analyzeChunkParallel(job.chunks[e.chunkIdx].text, e.chunkIdx, totalChunks)
              .then((result) => ({ chunkIdx: e.chunkIdx, result, error: null as string | null }))
              .catch((err) => ({ chunkIdx: e.chunkIdx, result: null as AnalysisChunkResult | null, error: err instanceof Error ? err.message : String(err) })),
          );
          const retryResults = await Promise.all(retryPromises);
          for (const rr of retryResults) {
            if (rr.result) results[rr.chunkIdx] = rr.result;
          }
          const stillFailed = retryResults.filter((rr) => rr.error);
          if (stillFailed.length > 0) {
            d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results] } });
            const failedChunks = stillFailed.map((e) => `Chunk ${e.chunkIdx + 1}: ${e.error}`).join('; ');
            d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'failed', error: `Extraction failed after retry: ${failedChunks}` } });
            this.cleanup(job.id);
            return;
          }
        }
        completedCount += batchIndices.length;
        d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results], currentChunkIndex: completedCount } });
        this.emitStream(job.id, `Phase 1: ${completedCount}/${totalChunks} chunks extracted`);
      }
    }

    if (entry.cancelled) {
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused', results: [...results] } });
      this.cleanup(job.id);
      return;
    }

    // ── Phase 2: Reconciliation ───────────────────────────────────────────
    this.emitStream(job.id, 'Phase 2: Reconciling entities across chunks...');
    d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { currentChunkIndex: totalChunks } });

    try {
      const rawResults = results.filter((r): r is AnalysisChunkResult => r !== null);
      const reconciledResults = await reconcileResults(rawResults, (_token, accumulated) => {
        this.emitStream(job.id, `Phase 2: Reconciling...\n${accumulated}`);
      });

      if (entry.cancelled) {
        d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused' } });
        this.cleanup(job.id);
        return;
      }

      // Update results with reconciled versions
      let reconIdx = 0;
      for (let i = 0; i < results.length; i++) {
        if (results[i] !== null) {
          results[i] = reconciledResults[reconIdx++];
        }
      }
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results] } });
    } catch (err) {
      // Reconciliation failure is non-fatal — continue with unreconciled results
      console.warn('[AnalysisRunner] Reconciliation failed, using raw results:', err);
      this.emitStream(job.id, 'Phase 2: Reconciliation failed (non-fatal), using raw results...');
    }

    // ── Phase 3: Assemble narrative ───────────────────────────────────────
    this.emitStream(job.id, 'Assembling narrative...');

    try {
      const completedResults = results.filter((r): r is AnalysisChunkResult => r !== null);
      const narrative = await assembleNarrative(job.title, completedResults);

      d({ type: 'ADD_NARRATIVE', narrative });
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'completed', narrativeId: narrative.id } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'failed', error: message } });
    }

    this.cleanup(job.id);
  }

  private emitStream(jobId: string, text: string) {
    this.streamTexts.set(jobId, text);
    for (const listener of this.streamListeners) {
      listener(jobId, text);
    }
  }

  private cleanup(jobId: string) {
    this.running.delete(jobId);
    this.streamTexts.delete(jobId);
  }
}

/** Singleton instance */
export const analysisRunner = new AnalysisRunner();
