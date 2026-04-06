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
import { ANALYSIS_CONCURRENCY, ANALYSIS_STAGGER_DELAY_MS, ANALYSIS_MAX_CHUNK_RETRIES, ANALYSIS_PLAN_BACKOFF_ENABLED } from '@/lib/constants';
import { logError, logWarning, logInfo, setSystemLoggerAnalysisId } from '@/lib/system-logger';
import { setLoggerAnalysisId } from '@/lib/api-logger';

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
  private streamListeners = new Set<StreamListener>();
  private chunkStreamListeners = new Set<ChunkStreamListener>();
  private inFlightListeners = new Set<InFlightListener>();
  private planStreamListeners = new Set<PlanStreamListener>();
  private planInFlightListeners = new Set<PlanInFlightListener>();
  private streamTexts = new Map<string, string>();

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
  async start(job: AnalysisJob, dispatch: Dispatch) {
    if (this.running.has(job.id)) {
      logWarning('Analysis job already running', `Job ID: ${job.id}`, {
        source: 'analysis',
        operation: 'start-job',
        details: { jobId: job.id }
      });
      return;
    }

    // Mark as running SYNCHRONOUSLY before any await, so isRunning() returns true immediately.
    const entry: RunningJob = { cancelled: false, inFlightIndices: new Set(), chunkStreams: new Map(), planInFlightKeys: new Set(), planStreams: new Map() };
    this.running.set(job.id, entry);
    this.streamTexts.set(job.id, '');

    // Set analysis ID for API and system logging
    setLoggerAnalysisId(job.id);
    setSystemLoggerAnalysisId(job.id);

    logInfo('Starting analysis job', {
      source: 'analysis',
      operation: 'start-job',
      details: {
        jobId: job.id,
        title: job.title,
        chunkCount: job.chunks.length,
        totalChars: job.chunks.reduce((sum, c) => sum + c.text.length, 0),
      },
    });

    try {
      dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'running', phase: 'extraction' } });

      await this.runPipeline(job, entry, dispatch);
    } catch (err) {
      logError(
        'Analysis job failed with unexpected error',
        err,
        {
          source: 'analysis',
          operation: 'analysis-job',
          details: {
            jobId: job.id,
            title: job.title,
            chunkCount: job.chunks.length,
          },
        }
      );
      // Update status to failed
      dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'failed', error: err instanceof Error ? err.message : String(err) } });
    } finally {
      // Clear analysis ID from API and system loggers
      setLoggerAnalysisId(null);
      setSystemLoggerAnalysisId(null);
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

    let phase1FailedCount = 0;

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
            logWarning(
              `Chunk ${chunkIdx + 1} extraction attempt ${attempt} failed, retrying`,
              error,
              {
                source: 'analysis',
                operation: 'chunk-extraction-retry',
                details: {
                  chunkIdx,
                  attempt,
                  maxRetries: MAX_CHUNK_RETRIES,
                },
              }
            );
            this.emitStream(job.id, `Phase 1: Chunk ${chunkIdx + 1} parse error, retrying (${attempt}/${MAX_CHUNK_RETRIES})...`);
            launchChunk(chunkIdx);
            return; // don't launch from queue or check pool — we re-incremented activeCount
          }
          // Non-retryable or max retries exceeded - log the failure
          logWarning(
            `Chunk extraction failed after ${attempt} attempts`,
            error,
            {
              source: 'analysis',
              operation: 'chunk-extraction',
              details: {
                chunkIdx,
                attempt,
                maxRetries: MAX_CHUNK_RETRIES,
                errorPreview: error.substring(0, 100),
              },
            }
          );
          failedChunks.push({ chunkIdx, error });
          phase1FailedCount++;
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
        const nextChunk = queue.shift();
        if (nextChunk !== undefined) {
          launchChunk(nextChunk);
        }
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
          const nextChunk = retryQueue.shift();
          if (nextChunk !== undefined) {
            launchRetry(nextChunk);
          }
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

    logInfo('Completed Phase 1: Parallel extraction', {
      source: 'analysis',
      operation: 'phase-1-complete',
      details: {
        jobId: job.id,
        chunksProcessed: totalChunks,
        totalChunks,
        failedChunks: phase1FailedCount,
      },
    });

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

      const launchPlan = async (task: ScenePlanTask) => {
        planActive++;
        task.attempts = (task.attempts ?? 0) + 1;

        // Exponential backoff for retries: 2s, 4s, 8s (disabled in tests)
        if (task.attempts > 1 && ANALYSIS_PLAN_BACKOFF_ENABLED) {
          const delayMs = Math.min(2000 * Math.pow(2, task.attempts - 2), 8000);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

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
            const errorMsg = err instanceof Error ? err.message : String(err);
            const wordCount = task.prose.split(/\s+/).length;

            if (task.attempts! < MAX_PLAN_RETRIES) {
              // Re-queue for retry
              planQueue.push(task);
              this.emitStream(job.id, `Phase 2: Scene ${task.chunkIdx + 1}-${task.sceneIdx + 1} failed (${errorMsg.split('\n')[0].substring(0, 60)}), retrying (${task.attempts}/${MAX_PLAN_RETRIES})`);
            } else {
              // Log final failure after all retries
              logWarning(
                `Plan extraction failed for scene ${task.chunkIdx}-${task.sceneIdx}`,
                err,
                {
                  source: 'analysis',
                  operation: 'plan-extraction',
                  details: {
                    chunkIdx: task.chunkIdx,
                    sceneIdx: task.sceneIdx,
                    wordCount,
                    attempts: task.attempts,
                  },
                }
              );
              failedPlans.push(task);
              this.emitStream(job.id, `Phase 2: Scene ${task.chunkIdx + 1}-${task.sceneIdx + 1} failed after ${MAX_PLAN_RETRIES} attempts - ${errorMsg.split('\n')[0].substring(0, 80)}`);
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
      for (let i = 0; i < planBatch; i++) {
        const nextPlan = planQueue.shift();
        if (nextPlan !== undefined) {
          launchPlan(nextPlan);
        }
      }
      await planDone;

      if (failedPlans.length > 0) {
        logWarning(
          `${failedPlans.length} scenes failed plan extraction after all retries`,
          `Failed scenes: ${failedPlans.map(t => `${t.chunkIdx}-${t.sceneIdx}`).join(', ')}`,
          {
            source: 'analysis',
            operation: 'plan-extraction-summary',
            details: {
              jobId: job.id,
              failedCount: failedPlans.length,
              totalPlans: planTasks.length,
            },
          }
        );
      }

      logInfo('Completed Phase 2: Plan extraction', {
        source: 'analysis',
        operation: 'phase-2-complete',
        details: {
          jobId: job.id,
          plansExtracted: plansDone,
          totalPlans: planTasks.length,
          failedPlans: failedPlans.length,
        },
      });
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

      logInfo('Completed Phase 3: Reconciliation', {
        source: 'analysis',
        operation: 'phase-3-complete',
        details: {
          jobId: job.id,
          reconciledResults: reconciledResults.length,
        },
      });
    } catch (err) {
      // Reconciliation failure is non-fatal — continue with unreconciled results
      logWarning(
        'Analysis reconciliation failed (non-fatal)',
        err,
        {
          source: 'analysis',
          operation: 'reconciliation',
          details: {
            jobId: job.id,
            resultCount: results.filter(r => r !== null).length,
          },
        }
      );
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

      logInfo('Completed Phase 4: Finalization', {
        source: 'analysis',
        operation: 'phase-4-complete',
        details: {
          jobId: job.id,
          threadDependencies: Object.keys(threadDependencies).length,
        },
      });
    } catch (err) {
      // Finalization failure is non-fatal — continue without dependencies
      logWarning(
        'Analysis finalization failed (non-fatal)',
        err,
        {
          source: 'analysis',
          operation: 'finalization',
          details: {
            jobId: job.id,
            threadCount: results.filter(r => r !== null).flatMap(r => r.threads ?? []).length,
          },
        }
      );
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

      logInfo('Analysis job completed successfully', {
        source: 'analysis',
        operation: 'job-complete',
        details: {
          jobId: job.id,
          narrativeId: narrative.id,
          title: job.title,
          totalChunks,
          scenesCreated: Object.keys(narrative.scenes).length,
          charactersCreated: Object.keys(narrative.characters).length,
          threadsCreated: Object.keys(narrative.threads).length,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError(
        'Analysis assembly failed',
        err,
        {
          source: 'analysis',
          operation: 'assembly',
          details: {
            jobId: job.id,
            title: job.title,
            resultCount: results.filter(r => r !== null).length,
          },
        }
      );
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
