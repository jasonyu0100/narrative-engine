/**
 * Singleton analysis runner — persists across React component mounts/unmounts.
 * Jobs continue running even when the user navigates away from the analysis page.
 */

import { analyzeChunk, assembleNarrative } from '@/lib/text-analysis';
import type { AnalysisJob, AnalysisChunkResult, NarrativeState } from '@/types/narrative';

type Dispatch = (action: import('@/lib/store').Action) => void;

type StreamListener = (jobId: string, text: string) => void;

type RunningJob = {
  cancelled: boolean;
};

class AnalysisRunner {
  private running = new Map<string, RunningJob>();
  private dispatch: Dispatch | null = null;
  private streamListeners = new Set<StreamListener>();
  private streamTexts = new Map<string, string>();

  /** Bind the store dispatch — called once from StoreProvider */
  setDispatch(dispatch: Dispatch) {
    this.dispatch = dispatch;
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

  /** Start or resume analysis for a job */
  async start(job: AnalysisJob) {
    if (!this.dispatch) throw new Error('AnalysisRunner: dispatch not set');
    if (this.running.has(job.id)) return; // already running

    const entry: RunningJob = { cancelled: false };
    this.running.set(job.id, entry);
    this.streamTexts.set(job.id, '');

    const d = this.dispatch;
    d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'running' } });

    const results = [...job.results];
    let startIdx = job.currentChunkIndex;
    while (startIdx < results.length && results[startIdx] !== null) startIdx++;

    for (let i = startIdx; i < job.chunks.length; i++) {
      if (entry.cancelled) {
        d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused', currentChunkIndex: i } });
        this.cleanup(job.id);
        return;
      }

      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { currentChunkIndex: i } });
      this.emitStream(job.id, '');

      try {
        const result = await analyzeChunk(job.chunks[i].text, i, results, (_token, accumulated) => {
          this.emitStream(job.id, accumulated);
        });

        if (entry.cancelled) {
          d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused', currentChunkIndex: i, results: [...results] } });
          this.cleanup(job.id);
          return;
        }

        results[i] = result;
        d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results], currentChunkIndex: i + 1 } });
        this.emitStream(job.id, '');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'failed', error: message, currentChunkIndex: i } });
        this.cleanup(job.id);
        return;
      }
    }

    // Assemble narrative
    d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'running', currentChunkIndex: job.chunks.length } });
    this.emitStream(job.id, '');

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
