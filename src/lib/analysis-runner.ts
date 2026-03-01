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
import { ANALYSIS_CONCURRENCY, ANALYSIS_STAGGER_DELAY_MS, ANALYSIS_MAX_CHUNK_RETRIES } from '@/lib/constants';

type Dispatch = (action: import('@/lib/store').Action) => void;

type StreamListener = (jobId: string, text: string) => void;
type ChunkStreamListener = (jobId: string, chunkIndex: number, text: string) => void;
type InFlightListener = (jobId: string, indices: number[]) => void;

type RunningJob = {
  cancelled: boolean;
  inFlightIndices: Set<number>;
  chunkStreams: Map<number, string>;
};

const MAX_CONCURRENCY = ANALYSIS_CONCURRENCY;
const STAGGER_DELAY_MS = ANALYSIS_STAGGER_DELAY_MS;

class AnalysisRunner {
  private running = new Map<string, RunningJob>();
  private dispatch: Dispatch | null = null;
  private dispatchResolvers: Array<(d: Dispatch) => void> = [];
  private streamListeners = new Set<StreamListener>();
  private chunkStreamListeners = new Set<ChunkStreamListener>();
  private inFlightListeners = new Set<InFlightListener>();
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

  /** Subscribe to job-level stream text updates. Returns unsubscribe fn. */
  onStream(listener: StreamListener): () => void {
    this.streamListeners.add(listener);
    return () => this.streamListeners.delete(listener);
  }

  /** Subscribe to per-chunk stream text updates. Returns unsubscribe fn. */
  onChunkStream(listener: ChunkStreamListener): () => void {
    this.chunkStreamListeners.add(listener);
    return () => this.chunkStreamListeners.delete(listener);
  }

  /** Subscribe to in-flight index changes. Returns unsubscribe fn. */
  onInFlightChange(listener: InFlightListener): () => void {
    this.inFlightListeners.add(listener);
    return () => this.inFlightListeners.delete(listener);
  }

  /** Get current stream text for a job */
  getStreamText(jobId: string): string {
    return this.streamTexts.get(jobId) ?? '';
  }

  /** Get current stream text for a specific chunk */
  getChunkStreamText(jobId: string, chunkIndex: number): string {
    return this.running.get(jobId)?.chunkStreams.get(chunkIndex) ?? '';
  }

  /** Get currently in-flight chunk indices for a job */
  getInFlightIndices(jobId: string): number[] {
    const entry = this.running.get(jobId);
    return entry ? [...entry.inFlightIndices] : [];
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
    if (this.running.has(job.id)) {
      console.warn('[AnalysisRunner] Job already running:', job.id);
      return;
    }

    const d = await this.getDispatch();

    const entry: RunningJob = { cancelled: false, inFlightIndices: new Set(), chunkStreams: new Map() };
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

      let completedCount = totalChunks - pendingIndices.length;
      const failedChunks: { chunkIdx: number; error: string }[] = [];

      // Sliding window: always keep MAX_CONCURRENCY calls in flight
      const queue = [...pendingIndices]; // chunks waiting to start
      let activeCount = 0;

      const chunkAttempts = new Map<number, number>(); // track retries per chunk

      const launchChunk = (chunkIdx: number) => {
        activeCount++;
        entry.inFlightIndices.add(chunkIdx);
        entry.chunkStreams.set(chunkIdx, '');
        chunkAttempts.set(chunkIdx, (chunkAttempts.get(chunkIdx) ?? 0) + 1);
        this.emitInFlight(job.id, [...entry.inFlightIndices]);

        analyzeChunkParallel(job.chunks[chunkIdx].text, chunkIdx, totalChunks, (_token, accumulated) => {
          entry.chunkStreams.set(chunkIdx, accumulated);
          this.emitChunkStream(job.id, chunkIdx, accumulated);
        })
          .then((result) => onChunkDone(chunkIdx, result, null))
          .catch((err) => onChunkDone(chunkIdx, null, err instanceof Error ? err.message : String(err)));
      };

      const MAX_CHUNK_RETRIES = ANALYSIS_MAX_CHUNK_RETRIES;

      const isParseOrTypeError = (error: string) =>
        /json|parse|type|unexpected token|syntax/i.test(error);

      const onChunkDone = (chunkIdx: number, result: AnalysisChunkResult | null, error: string | null) => {
        activeCount--;
        entry.inFlightIndices.delete(chunkIdx);

        if (result) {
          results[chunkIdx] = result;
          completedCount++;
          d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results], currentChunkIndex: completedCount } });
          this.emitStream(job.id, `Phase 1: ${completedCount}/${totalChunks} chunks extracted`);
        } else if (error) {
          const attempt = chunkAttempts.get(chunkIdx) ?? 1;
          if (isParseOrTypeError(error) && attempt < MAX_CHUNK_RETRIES && !entry.cancelled) {
            // Auto-retry parse/type errors inline
            console.warn(`[AnalysisRunner] Chunk ${chunkIdx + 1} attempt ${attempt}/${MAX_CHUNK_RETRIES} failed:`, error);
            this.emitStream(job.id, `Phase 1: Chunk ${chunkIdx + 1} parse error, retrying (${attempt}/${MAX_CHUNK_RETRIES})...`);
            launchChunk(chunkIdx);
            return; // don't launch from queue or check pool — we re-incremented activeCount
          }
          // Non-retryable or max retries exceeded
          failedChunks.push({ chunkIdx, error });
        }

        this.emitInFlight(job.id, [...entry.inFlightIndices]);

        // Launch next from queue if not cancelled
        if (!entry.cancelled && queue.length > 0) {
          launchChunk(queue.shift()!);
        }

        // When all done, resolve the pool promise
        if (activeCount === 0 && queue.length === 0) {
          poolResolve();
        }
      };

      // Pool completion promise
      let poolResolve: () => void;
      const poolDone = new Promise<void>((resolve) => { poolResolve = resolve; });

      // Seed the pool with initial batch, staggering launches to avoid thundering herd
      const initialBatch = Math.min(MAX_CONCURRENCY, queue.length);
      for (let i = 0; i < initialBatch; i++) {
        launchChunk(queue.shift()!);
        if (i < initialBatch - 1 && STAGGER_DELAY_MS > 0) {
          await new Promise((r) => setTimeout(r, STAGGER_DELAY_MS));
        }
      }

      // Wait for all chunks to complete
      await poolDone;

      // Handle cancellation
      if (entry.cancelled) {
        d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused', results: [...results], currentChunkIndex: completedCount } });
        this.cleanup(job.id);
        return;
      }

      // Retry failed chunks once (also using sliding window)
      if (failedChunks.length > 0) {
        this.emitStream(job.id, `Phase 1: Retrying ${failedChunks.length} failed chunk(s)...`);
        const retryQueue = failedChunks.map((f) => f.chunkIdx);
        const stillFailed: { chunkIdx: number; error: string }[] = [];

        let retryResolve: () => void;
        const retryDone = new Promise<void>((resolve) => { retryResolve = resolve; });

        const launchRetry = (chunkIdx: number) => {
          activeCount++;
          entry.inFlightIndices.add(chunkIdx);
          entry.chunkStreams.set(chunkIdx, '');
          this.emitInFlight(job.id, [...entry.inFlightIndices]);

          analyzeChunkParallel(job.chunks[chunkIdx].text, chunkIdx, totalChunks, (_token, accumulated) => {
            entry.chunkStreams.set(chunkIdx, accumulated);
            this.emitChunkStream(job.id, chunkIdx, accumulated);
          })
            .then((result) => {
              activeCount--;
              entry.inFlightIndices.delete(chunkIdx);
              results[chunkIdx] = result;
              completedCount++;
              d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results], currentChunkIndex: completedCount } });
              this.emitInFlight(job.id, [...entry.inFlightIndices]);
              if (retryQueue.length > 0) launchRetry(retryQueue.shift()!);
              if (activeCount === 0 && retryQueue.length === 0) retryResolve();
            })
            .catch((err) => {
              activeCount--;
              entry.inFlightIndices.delete(chunkIdx);
              stillFailed.push({ chunkIdx, error: err instanceof Error ? err.message : String(err) });
              this.emitInFlight(job.id, [...entry.inFlightIndices]);
              if (retryQueue.length > 0) launchRetry(retryQueue.shift()!);
              if (activeCount === 0 && retryQueue.length === 0) retryResolve();
            });
        };

        const retryBatch = Math.min(MAX_CONCURRENCY, retryQueue.length);
        for (let i = 0; i < retryBatch; i++) {
          launchRetry(retryQueue.shift()!);
        }
        await retryDone;

        if (stillFailed.length > 0) {
          d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results] } });
          const failedMsg = stillFailed.map((e) => `Chunk ${e.chunkIdx + 1}: ${e.error}`).join('; ');
          d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'failed', error: `Extraction failed after retry: ${failedMsg}` } });
          this.cleanup(job.id);
          return;
        }
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
      const narrative = await assembleNarrative(job.title, completedResults, (_token, accumulated) => {
        this.emitStream(job.id, `Assembling narrative...\n${accumulated}`);
      });

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

  private emitChunkStream(jobId: string, chunkIndex: number, text: string) {
    for (const listener of this.chunkStreamListeners) {
      listener(jobId, chunkIndex, text);
    }
  }

  private emitInFlight(jobId: string, indices: number[]) {
    for (const listener of this.inFlightListeners) {
      listener(jobId, indices);
    }
  }

  private cleanup(jobId: string) {
    this.running.delete(jobId);
    this.streamTexts.delete(jobId);
  }
}

/** Singleton instance */
export const analysisRunner = new AnalysisRunner();
