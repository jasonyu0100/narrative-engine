/**
 * Singleton analysis runner — persists across React component mounts/unmounts.
 * Jobs continue running even when the user navigates away from the analysis page.
 *
 * Scene-first pipeline (bottom-up):
 *   Phase 1 — Plans: extract beat plans + embeddings per scene (parallel)
 *   Phase 2 — Structure: extract entities + mutations per scene from prose + plan (parallel)
 *   Phase 3 — Arcs: group every 4 scenes, name each arc
 *   Phase 4 — Reconciliation: deduplicate entities, stitch threads, merge name variants
 *   Phase 5 — Finalization: thread dependencies
 *   Phase 6 — Assembly: build final NarrativeState from reconciled data
 */

import { reconcileResults, analyzeThreading, assembleNarrative, extractSceneStructure, groupScenesIntoArcs } from '@/lib/text-analysis';
import { reverseEngineerScenePlan } from '@/lib/ai/scenes';
import type { AnalysisJob, AnalysisChunkResult } from '@/types/narrative';
import type { Action } from '@/lib/store';
import { ANALYSIS_CONCURRENCY, ANALYSIS_STAGGER_DELAY_MS } from '@/lib/constants';
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

  onStream(listener: StreamListener): () => void { this.streamListeners.add(listener); return () => this.streamListeners.delete(listener); }
  onChunkStream(listener: ChunkStreamListener): () => void { this.chunkStreamListeners.add(listener); return () => this.chunkStreamListeners.delete(listener); }
  onInFlightChange(listener: InFlightListener): () => void { this.inFlightListeners.add(listener); return () => this.inFlightListeners.delete(listener); }
  onPlanStream(listener: PlanStreamListener): () => void { this.planStreamListeners.add(listener); return () => this.planStreamListeners.delete(listener); }
  onPlanInFlightChange(listener: PlanInFlightListener): () => void { this.planInFlightListeners.add(listener); return () => this.planInFlightListeners.delete(listener); }

  getStreamText(jobId: string): string { return this.streamTexts.get(jobId) ?? ''; }
  getChunkStreamText(jobId: string, chunkIndex: number): string { return this.running.get(jobId)?.chunkStreams.get(chunkIndex) ?? ''; }
  getInFlightIndices(jobId: string): number[] { const e = this.running.get(jobId); return e ? [...e.inFlightIndices] : []; }
  getPlanStreamText(jobId: string, key: string): string { return this.running.get(jobId)?.planStreams.get(key) ?? ''; }
  getPlanInFlightKeys(jobId: string): string[] { const e = this.running.get(jobId); return e ? [...e.planInFlightKeys] : []; }
  isRunning(jobId: string): boolean { return this.running.has(jobId); }
  pause(jobId: string) { const e = this.running.get(jobId); if (e) e.cancelled = true; }

  async start(job: AnalysisJob, dispatch: Dispatch) {
    if (this.running.has(job.id)) { logWarning('Analysis job already running', `Job ID: ${job.id}`, { source: 'analysis', operation: 'start-job', details: { jobId: job.id } }); return; }

    const entry: RunningJob = { cancelled: false, inFlightIndices: new Set(), chunkStreams: new Map(), planInFlightKeys: new Set(), planStreams: new Map() };
    this.running.set(job.id, entry);
    this.streamTexts.set(job.id, '');
    setLoggerAnalysisId(job.id);
    setSystemLoggerAnalysisId(job.id);

    logInfo('Starting analysis job', { source: 'analysis', operation: 'start-job', details: { jobId: job.id, title: job.title, chunkCount: job.chunks.length } });

    try {
      dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'running', phase: 'plans' } });
      await this.runPipeline(job, entry, dispatch);
    } catch (err) {
      logError('Analysis job failed', err, { source: 'analysis', operation: 'analysis-job', details: { jobId: job.id, title: job.title } });
      dispatch({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'failed', error: err instanceof Error ? err.message : String(err) } });
    } finally {
      setLoggerAnalysisId(null);
      setSystemLoggerAnalysisId(null);
      this.cleanup(job.id);
    }
  }

  // ── Pipeline ───────────────────────────────────────────────────────────────

  private async runPipeline(job: AnalysisJob, entry: RunningJob, d: Dispatch) {
    // Each job.chunks entry is a scene-sized prose segment (~1200 words).
    // Results are 1:1 with chunks — one AnalysisChunkResult per scene.
    const results: (AnalysisChunkResult | null)[] = [...job.results];
    const total = job.chunks.length;

    // Helper: run tasks with concurrency limit
    const runParallel = async <T>(tasks: T[], fn: (task: T) => Promise<void>, label: string) => {
      if (tasks.length === 0) return;
      let done = 0;
      const queue = [...tasks];
      let active = 0;
      let resolve!: () => void;
      const promise = new Promise<void>((r) => { resolve = r; });

      const launch = async (task: T) => {
        active++;
        try { await fn(task); } catch { /* handled inside fn */ }
        done++;
        active--;
        d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results], currentChunkIndex: done } });
        this.emitStream(job.id, `${label}: ${done}/${tasks.length}`);
        if (queue.length > 0 && !entry.cancelled) {
          launch(queue.shift()!);
        } else if (active === 0) {
          resolve();
        }
      };

      const batch = Math.min(MAX_CONCURRENCY, queue.length);
      for (let i = 0; i < batch; i++) launch(queue.shift()!);
      await promise;
    };

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 1: PLANS + EMBEDDINGS — beat plans per scene (parallel)
    // ═════════════════════════════════════════════════════════════════════════
    const planPending = job.chunks.map((_, i) => i).filter(i => !results[i]?.scenes?.[0]?.plan);

    if (planPending.length > 0) {
      this.emitStream(job.id, `Plans: ${planPending.length} scenes...`);

      await runParallel(planPending, async (idx) => {
        const chunk = job.chunks[idx];
        try {
          const { plan, beatProseMap } = await reverseEngineerScenePlan(
            chunk.text,
            `Scene ${idx + 1}`,
            (_token, acc) => { entry.planStreams.set(String(idx), acc); this.emitPlanStream(job.id, String(idx), acc); },
          );

          // Initialize result with scene containing plan + prose
          results[idx] = {
            chapterSummary: '',
            characters: [],
            locations: [],
            threads: [],
            scenes: [{
              locationName: '', povName: '', participantNames: [], events: [],
              summary: `Scene ${idx + 1}`,
              sections: [],
              prose: chunk.text,
              plan,
              beatProseMap: beatProseMap ?? undefined,
              threadMutations: [],
              continuityMutations: [],
              relationshipMutations: [],
            }],
            relationships: [],
          };

          // Embed propositions immediately after plan extraction
          try {
            const { embedPropositions, computeCentroid } = await import('@/lib/embeddings');
            const { assetManager } = await import('@/lib/asset-manager');

            const allProps = plan.beats.flatMap((beat, bi) => beat.propositions.map((p, pi) => ({ ...p, bi, pi })));
            if (allProps.length > 0) {
              const embedded = await embedPropositions(allProps.map(p => ({ content: p.content, type: p.type })), job.id);
              allProps.forEach((p, i) => { plan.beats[p.bi].propositions[p.pi] = embedded[i]; });

              // Beat centroids
              for (const beat of plan.beats) {
                const refs = beat.propositions.filter(p => p.embedding).map(p => p.embedding!);
                if (refs.length > 0) {
                  const vectors: number[][] = [];
                  for (const ref of refs) { const v = await assetManager.getEmbedding(ref); if (v) vectors.push(v); }
                  if (vectors.length > 0) beat.embeddingCentroid = await assetManager.storeEmbedding(computeCentroid(vectors), 'text-embedding-3-small');
                }
              }
            }
          } catch (embErr) {
            logWarning('Embedding failed for scene plan (non-fatal)', embErr, { source: 'analysis', operation: 'plan-embed', details: { sceneIdx: idx } });
          }
        } catch (err) {
          logWarning('Plan extraction failed for scene', err, { source: 'analysis', operation: 'plan-extraction', details: { jobId: job.id, sceneIdx: idx } });
        }
      }, 'Plans');

      this.emitStream(job.id, `[OK] Plans + embeddings done`);
    }

    if (entry.cancelled) { d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused', results: [...results] } }); return; }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 2: STRUCTURE — entities + mutations per scene (parallel)
    // ═════════════════════════════════════════════════════════════════════════
    d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'structure' } });

    const structPending = results.map((r, i) => i).filter(i => {
      const r = results[i];
      return r?.scenes?.[0]?.plan && r?.scenes?.[0]?.prose && !r?.chapterSummary;
    });

    if (structPending.length > 0) {
      this.emitStream(job.id, `Structure: ${structPending.length} scenes...`);

      await runParallel(structPending, async (idx) => {
        const r = results[idx];
        const scene = r?.scenes?.[0];
        if (!scene?.prose || !scene?.plan) return;

        try {
          const s = await extractSceneStructure(scene.prose, scene.plan, () => {
            this.emitStream(job.id, `Structure: scene ${idx + 1}...`);
          });

          // Populate scene mutations
          scene.povName = s.povName || scene.povName;
          scene.locationName = s.locationName || scene.locationName;
          scene.participantNames = s.participantNames.length > 0 ? s.participantNames : scene.participantNames;
          scene.events = s.events.length > 0 ? s.events : scene.events;
          scene.summary = s.summary || scene.summary;
          scene.threadMutations = s.threadMutations;
          scene.continuityMutations = s.continuityMutations;
          scene.relationshipMutations = s.relationshipMutations;
          scene.artifactUsages = s.artifactUsages;
          scene.ownershipMutations = s.ownershipMutations;
          scene.tieMutations = s.tieMutations;
          scene.characterMovements = s.characterMovements;
          scene.worldKnowledgeMutations = s.worldKnowledgeMutations;

          // Populate chunk-level entities
          r!.chapterSummary = s.summary;
          r!.characters = s.characters;
          r!.locations = s.locations;
          r!.artifacts = s.artifacts;
          r!.threads = s.threads;
          r!.relationships = s.relationships;
        } catch (err) {
          logWarning('Structure extraction failed for scene', err, { source: 'analysis', operation: 'scene-structure', details: { jobId: job.id, sceneIdx: idx } });
        }
      }, 'Structure');

      // Generate summary + prose embeddings now that summaries exist
      try {
        const { generateEmbeddingsBatch } = await import('@/lib/embeddings');
        const { assetManager } = await import('@/lib/asset-manager');
        const allScenes = results.filter((r): r is AnalysisChunkResult => !!r).flatMap(r => r.scenes);

        const summaries = allScenes.map(s => s.summary);
        if (summaries.length > 0) {
          const embs = await generateEmbeddingsBatch(summaries, job.id);
          for (let i = 0; i < allScenes.length; i++) {
            (allScenes[i] as any).summaryEmbedding = await assetManager.storeEmbedding(embs[i], 'text-embedding-3-small');
          }
        }

        const withProse = allScenes.filter(s => s.prose);
        if (withProse.length > 0) {
          const proseEmbs = await generateEmbeddingsBatch(withProse.map(s => s.prose!), job.id);
          for (let i = 0; i < withProse.length; i++) {
            (withProse[i] as any).proseEmbedding = await assetManager.storeEmbedding(proseEmbs[i], 'text-embedding-3-small');
          }
        }
      } catch (embErr) {
        logWarning('Summary/prose embedding failed (non-fatal)', embErr, { source: 'analysis', operation: 'summary-embed' });
      }

      this.emitStream(job.id, `[OK] Structure extracted`);
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results] } });
    }

    if (entry.cancelled) { d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused', results: [...results] } }); return; }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 3: ARCS — group every 4 scenes, name each arc
    // ═════════════════════════════════════════════════════════════════════════
    d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'arcs' } });

    const sceneSummaries = results
      .map((r, i) => ({ index: i, summary: r?.scenes?.[0]?.summary ?? `Scene ${i + 1}` }))
      .filter((_, i) => results[i] !== null);

    let arcGroups: { name: string; sceneIndices: number[] }[] = [];
    if (sceneSummaries.length > 0) {
      try {
        this.emitStream(job.id, `Arcs: grouping ${sceneSummaries.length} scenes...`);
        arcGroups = await groupScenesIntoArcs(sceneSummaries, (_token, acc) => {
          this.emitStream(job.id, `Arcs: naming...\n${acc}`);
        });
        this.emitStream(job.id, `[OK] ${arcGroups.length} arcs`);
      } catch (err) {
        logWarning('Arc grouping failed (non-fatal)', err, { source: 'analysis', operation: 'arc-grouping' });
        for (let i = 0; i < sceneSummaries.length; i += 4) {
          const slice = sceneSummaries.slice(i, i + 4);
          arcGroups.push({ name: `Arc ${Math.floor(i / 4) + 1}`, sceneIndices: slice.map(s => s.index) });
        }
      }
    }
    (job as any).arcGroups = arcGroups;

    if (entry.cancelled) { d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused', results: [...results] } }); return; }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 4: RECONCILIATION
    // ═════════════════════════════════════════════════════════════════════════
    d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'reconciliation', currentChunkIndex: total } });
    this.emitStream(job.id, 'Reconciling entities...');

    try {
      const raw = results.filter((r): r is AnalysisChunkResult => r !== null);
      const reconciled = await reconcileResults(raw, (_token, acc) => { this.emitStream(job.id, `Reconciling...\n${acc}`); });

      if (entry.cancelled) { d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused' } }); return; }

      let ri = 0;
      for (let i = 0; i < results.length; i++) { if (results[i] !== null) results[i] = reconciled[ri++]; }
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { results: [...results] } });
    } catch (err) {
      logWarning('Reconciliation failed (non-fatal)', err, { source: 'analysis', operation: 'reconciliation' });
      this.emitStream(job.id, 'Reconciliation failed (non-fatal), using raw results...');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 5: FINALIZATION — thread dependencies
    // ═════════════════════════════════════════════════════════════════════════
    d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'finalization' } });
    let threadDependencies: Record<string, string[]> = {};
    try {
      const completed = results.filter((r): r is AnalysisChunkResult => r !== null);
      const threads = [...new Set(completed.flatMap(r => (r.threads ?? []).map(t => t.description)))];
      if (threads.length >= 2) {
        this.emitStream(job.id, 'Finalizing...');
        threadDependencies = await analyzeThreading(threads, (_token, acc) => { this.emitStream(job.id, `Finalizing...\n${acc}`); });
      }
      if (entry.cancelled) { d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'paused' } }); return; }
    } catch (err) {
      logWarning('Finalization failed (non-fatal)', err, { source: 'analysis', operation: 'finalization' });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 6: ASSEMBLY — build NarrativeState
    // ═════════════════════════════════════════════════════════════════════════
    d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { phase: 'assembly' } });
    this.emitStream(job.id, 'Assembling narrative...');

    try {
      const completed = results.filter((r): r is AnalysisChunkResult => r !== null);
      const narrative = await assembleNarrative(job.title, completed, threadDependencies, (_token, acc) => {
        this.emitStream(job.id, `Assembling...\n${acc}`);
      });

      d({ type: 'ADD_NARRATIVE', narrative });
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'completed', narrativeId: narrative.id } });

      logInfo('Analysis completed', { source: 'analysis', operation: 'job-complete', details: {
        jobId: job.id, narrativeId: narrative.id, title: job.title,
        scenes: Object.keys(narrative.scenes).length, characters: Object.keys(narrative.characters).length,
      } });
    } catch (err) {
      logError('Assembly failed', err, { source: 'analysis', operation: 'assembly', details: { jobId: job.id } });
      d({ type: 'UPDATE_ANALYSIS_JOB', id: job.id, updates: { status: 'failed', error: err instanceof Error ? err.message : String(err) } });
    }
  }

  // ── Emit helpers ───────────────────────────────────────────────────────────

  private emitStream(jobId: string, text: string) {
    this.streamTexts.set(jobId, text);
    for (const listener of this.streamListeners) listener(jobId, text);
  }

  private emitChunkStream(jobId: string, chunkIndex: number, text: string) {
    for (const listener of this.chunkStreamListeners) listener(jobId, chunkIndex, text);
  }

  private emitInFlight(jobId: string, indices: number[]) {
    for (const listener of this.inFlightListeners) listener(jobId, indices);
  }

  private emitPlanStream(jobId: string, key: string, text: string) {
    for (const listener of this.planStreamListeners) listener(jobId, key, text);
  }

  private emitPlanInFlight(jobId: string, keys: string[]) {
    for (const listener of this.planInFlightListeners) listener(jobId, keys);
  }

  private cleanup(jobId: string) {
    this.running.delete(jobId);
    this.streamTexts.delete(jobId);
  }
}

/** Singleton instance */
export const analysisRunner = new AnalysisRunner();
