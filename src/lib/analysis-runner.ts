/**
 * Singleton analysis runner — persists across React component mounts/unmounts.
 * Jobs continue running even when the user navigates away from the analysis page.
 *
 * Six-phase pipeline:
 *   Phase 1 — Parallel extraction: all chunks analyzed simultaneously (no cumulative context)
 *   Phase 2 — Plan extraction: reverse-engineer beat plans from prose (focused on propositions)
 *   Phase 3 — Mapping: align beats to prose paragraphs (ensures 100% prose coverage)
 *   Phase 4 — Reconciliation: deduplicate characters, stitch threads, merge name variants
 *   Phase 5 — Finalization: thread dependencies, structural analysis
 *   Phase 6 — Assembly: build final NarrativeState from reconciled data
 */

import { analyzeChunkParallel, reconcileResults, analyzeThreading, assembleNarrative } from '@/lib/text-analysis';
import { reverseEngineerScenePlan } from '@/lib/ai/scenes';
import type { AnalysisJob, AnalysisChunkResult } from '@/types/narrative';
import type { Action } from '@/lib/store';
import { ANALYSIS_CONCURRENCY, ANALYSIS_STAGGER_DELAY_MS, ANALYSIS_MAX_CHUNK_RETRIES } from '@/lib/constants';

type Dispatch = (action: Action) => void;

type StreamListener = (jobId: string, text: string) => void;
type ChunkStreamListener = (jobId: string, chunkIndex: number, text: string) => void;
type InFlightListener = (jobId: string, indices: number[]) => void;
type PlanStreamListener = (jobId: string, key: string, text: string) => void;
type PlanInFlightListener = (jobId: string, keys: string[]) => void;

type RunningJob = {
  cancelled: boolean;
  inFlightIndices: Set<number>;
  chunkStreams: Map<number, string>;
  planInFlightKeys: Set<string>;
  planStreams: Map<string, string>;
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
  private planStreamListeners = new Set<PlanStreamListener>();
  private planInFlightListeners = new Set<PlanInFlightListener>();
  private streamTexts = new Map<string, string>();

  /** Bind the store dispatch — called once from StoreProvider */
  setDispatch(dispatch: Dispatch) {
    this.dispatch = dispatch;
    // Resolve any pending waiters
    for (const resolve of this.dispatchResolvers) resolve(dispatch);
    this.dispatchResolvers = [];
  }

  /** Wait for dispatch to be available (handles race with StoreProvider mount) */
  private getDispatch(timeoutMs = 5000): Promise<Dispatch> {
    if (this.dispatch) return Promise.resolve(this.dispatch);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove from resolvers list
        const idx = this.dispatchResolvers.indexOf(resolve);
        if (idx >= 0) this.dispatchResolvers.splice(idx, 1);
        reject(new Error('Dispatch not available after timeout - StoreProvider may not be mounted'));
      }, timeoutMs);

      this.dispatchResolvers.push((d) => {
        clearTimeout(timeout);
        resolve(d);
      });
    });
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

  /** Subscribe to per-scene plan stream text updates. Returns unsubscribe fn. */
  onPlanStream(listener: PlanStreamListener): () => void {
    this.planStreamListeners.add(listener);
    return () => this.planStreamListeners.delete(listener);
  }

  /** Subscribe to plan in-flight key changes. Returns unsubscribe fn. */
  onPlanInFlightChange(listener: PlanInFlightListener): () => void {
    this.planInFlightListeners.add(listener);
    return () => this.planInFlightListeners.delete(listener);
  }

  /** Get current plan stream text for a specific scene key ("chunkIdx-sceneIdx") */
  getPlanStreamText(jobId: string, key: string): string {
    return this.running.get(jobId)?.planStreams.get(key) ?? '';
  }

  /** Get currently in-flight plan scene keys for a job */
  getPlanInFlightKeys(jobId: string): string[] {
    const entry = this.running.get(jobId);
    return entry ? [...entry.planInFlightKeys] : [];
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

    // Mark as running SYNCHRONOUSLY before any await, so isRunning() returns true immediately.
    // This prevents race conditions where the UI switches views before start() has awaited dispatch.
    const entry: RunningJob = { cancelled: false, inFlightIndices: new Set(), chunkStreams: new Map(), planInFlightKeys: new Set(), planStreams: new Map() };
    this.running.set(job.id, entry);
    this.streamTexts.set(job.id, '');

    try {
      const d = await this.getDispatch();
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'running', phase: 'extraction' } });

      await this.runPipeline(job, entry, d);
    } catch (err) {
      console.error('[AnalysisRunner] Unexpected error:', err);
      // Try to update status if dispatch is available
      if (this.dispatch) {
        this.dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'failed', error: err instanceof Error ? err.message : String(err) } });
      }
    } finally {
      this.cleanup(job.id);
    }
  }

  private async runPipeline(job: AnalysisJob, entry: RunningJob, d: Dispatch) {
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
          return;
        }
      }
    }

    if (entry.cancelled) {
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused', results: [...results] } });
      return;
    }

    // ── Phase 2: Plan extraction ──────────────────────────────────────────
    // Reverse-engineer beat plans from scene prose in parallel with retry logic
    // Extract beat plans (propositions) — paragraph mapping happens in Phase 3
    type ScenePlanTask = { chunkIdx: number; sceneIdx: number; prose: string; summary: string; attempts?: number };
    const planTasks: ScenePlanTask[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r) continue;
      for (let j = 0; j < (r.scenes ?? []).length; j++) {
        const s = r.scenes[j];
        // Extract plan if missing
        if (s.prose && !s.plan) {
          planTasks.push({ chunkIdx: i, sceneIdx: j, prose: s.prose, summary: s.summary, attempts: 0 });
        }
      }
    }

    if (planTasks.length > 0) {
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'plans' } });
      this.emitStream(job.id, `Phase 2: Extracting beat plans from ${planTasks.length} scenes...`);
      let plansDone = 0;
      const planQueue = [...planTasks];
      let planActive = 0;
      let planResolve!: () => void;
      const planDone = new Promise<void>((resolve) => { planResolve = resolve; });
      const failedPlans: ScenePlanTask[] = [];
      const MAX_PLAN_RETRIES = 3;

      const launchPlan = (task: ScenePlanTask) => {
        planActive++;
        task.attempts = (task.attempts ?? 0) + 1;
        const key = `${task.chunkIdx}-${task.sceneIdx}`;
        entry.planInFlightKeys.add(key);
        entry.planStreams.set(key, '');
        this.emitPlanInFlight(job.id, [...entry.planInFlightKeys]);

        reverseEngineerScenePlan(task.prose, task.summary, (_token, accumulated) => {
          entry.planStreams.set(key, accumulated);
          this.emitPlanStream(job.id, key, accumulated);
        })
          .then(({ plan, beatProseMap }) => {
            const r = results[task.chunkIdx];
            if (r?.scenes[task.sceneIdx]) {
              r.scenes[task.sceneIdx].plan = plan;
              if (beatProseMap) {
                r.scenes[task.sceneIdx].beatProseMap = beatProseMap;
              }
            }
            plansDone++;
            this.emitStream(job.id, `Phase 2: ${plansDone}/${planTasks.length} beat plans extracted and mapped`);
            d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results] } });
          })
          .catch((err) => {
            console.warn(`[AnalysisRunner] Plan extraction failed for scene ${task.chunkIdx}-${task.sceneIdx}:`, err);
            if (task.attempts! < MAX_PLAN_RETRIES) {
              // Re-queue for retry
              planQueue.push(task);
              this.emitStream(job.id, `Phase 2: Scene ${task.chunkIdx + 1}-${task.sceneIdx + 1} failed, will retry (${task.attempts}/${MAX_PLAN_RETRIES})`);
            } else {
              failedPlans.push(task);
              this.emitStream(job.id, `Phase 2: Scene ${task.chunkIdx + 1}-${task.sceneIdx + 1} failed after ${MAX_PLAN_RETRIES} attempts`);
            }
          })
          .finally(() => {
            entry.planInFlightKeys.delete(key);
            planActive--;
            this.emitPlanInFlight(job.id, [...entry.planInFlightKeys]);
            if (!entry.cancelled && planQueue.length > 0) launchPlan(planQueue.shift()!);
            if (planActive === 0 && (planQueue.length === 0 || entry.cancelled)) planResolve();
          });
      };

      const planBatch = Math.min(MAX_CONCURRENCY, planQueue.length);
      for (let i = 0; i < planBatch; i++) launchPlan(planQueue.shift()!);
      await planDone;

      if (failedPlans.length > 0) {
        console.warn(`[AnalysisRunner] ${failedPlans.length} scenes failed plan extraction after retries`);
      }
    }

    // Phase 3 removed - mapping now done atomically in Phase 2

    if (entry.cancelled) {
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused', results: [...results] } });
      return;
    }

    // ── Phase 3: Reconciliation ───────────────────────────────────────────
    d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'reconciliation', currentChunkIndex: totalChunks } });
    this.emitStream(job.id, 'Phase 3: Reconciling entities...');

    try {
      const rawResults = results.filter((r): r is AnalysisChunkResult => r !== null);
      const reconciledResults = await reconcileResults(rawResults, (_token, accumulated) => {
        this.emitStream(job.id, `Phase 3: Reconciling...\n${accumulated}`);
      });

      if (entry.cancelled) {
        d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused' } });
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
      this.emitStream(job.id, 'Phase 3: Reconciliation failed (non-fatal), using raw results...');
    }

    // ── Phase 3: Finalization (thread dependencies, future analysis) ─────
    d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'finalization' } });
    let threadDependencies: Record<string, string[]> = {};
    try {
      const completedResults = results.filter((r): r is AnalysisChunkResult => r !== null);
      // Extract canonical thread descriptions (deduplicated)
      const canonicalThreads = [...new Set(completedResults.flatMap((r) => (r.threads ?? []).map((t) => t.description)))];

      if (canonicalThreads.length >= 2) {
        this.emitStream(job.id, 'Phase 3: Finalizing...');
        threadDependencies = await analyzeThreading(canonicalThreads, (_token, accumulated) => {
          this.emitStream(job.id, `Phase 3: Finalizing...\n${accumulated}`);
        });
      }

      if (entry.cancelled) {
        d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused' } });
        return;
      }
    } catch (err) {
      // Finalization failure is non-fatal — continue without dependencies
      console.warn('[AnalysisRunner] Finalization failed:', err);
      this.emitStream(job.id, 'Phase 3: Finalization failed (non-fatal), continuing...');
    }

    // ── Phase 3: Assemble narrative ───────────────────────────────────────
    d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'assembly' } });
    this.emitStream(job.id, 'Phase 3: Assembling narrative...');

    try {
      const completedResults = results.filter((r): r is AnalysisChunkResult => r !== null);
      const narrative = await assembleNarrative(job.title, completedResults, threadDependencies, (_token, accumulated) => {
        this.emitStream(job.id, `Phase 3: Assembling...\n${accumulated}`);
      });

      d({ type: 'ADD_NARRATIVE', narrative });
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'completed', narrativeId: narrative.id } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'failed', error: message } });
    }
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

  private emitPlanStream(jobId: string, key: string, text: string) {
    for (const listener of this.planStreamListeners) {
      listener(jobId, key, text);
    }
  }

  private emitPlanInFlight(jobId: string, keys: string[]) {
    for (const listener of this.planInFlightListeners) {
      listener(jobId, keys);
    }
  }

  private cleanup(jobId: string) {
    this.running.delete(jobId);
    this.streamTexts.delete(jobId);
  }
}

/** Singleton instance */
export const analysisRunner = new AnalysisRunner();
