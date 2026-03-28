'use client';

import { useState, useCallback, useRef } from 'react';
import { useStore } from '@/lib/store';
import { evaluateBranch } from '@/lib/ai/evaluate';
import { reconstructBranch, type ReconstructionProgress } from '@/lib/ai/reconstruct';
import { resolveEntry, isScene } from '@/types/narrative';
import type { BranchEvaluation, SceneVerdict, Scene, Arc } from '@/types/narrative';

// ── Verdict visuals ──────────────────────────────────────────────────────────

const VERDICT_CONFIG: Record<SceneVerdict, { icon: string; color: string; bg: string; label: string }> = {
  ok:      { icon: '✓', color: 'text-emerald-400', bg: 'bg-emerald-500/15', label: 'OK' },
  edit:    { icon: '~', color: 'text-amber-400',   bg: 'bg-amber-500/15',   label: 'Edit' },
  merge:   { icon: '⊕', color: 'text-blue-400',    bg: 'bg-blue-500/15',    label: 'Merge' },
  cut:     { icon: '✕', color: 'text-white/30',    bg: 'bg-white/5',        label: 'Cut' },
  defer:   { icon: '→', color: 'text-purple-400',  bg: 'bg-purple-500/15',  label: 'Defer' },
};

const STEP_STATUS_ICON: Record<string, string> = {
  pending: '·',
  running: '◎',
  done: '✓',
  skipped: '–',
};

// ── Scene node in the vertical tree ──────────────────────────────────────────

function SceneNode({
  scene,
  arc,
  verdict,
  reason,
  isLast,
  reconStatus,
  onClick,
}: {
  scene: Scene;
  arc?: Arc;
  verdict: SceneVerdict;
  reason: string;
  isLast: boolean;
  reconStatus?: 'pending' | 'running' | 'done' | 'skipped';
  onClick: () => void;
}) {
  const cfg = VERDICT_CONFIG[verdict];
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex gap-0 min-h-0">
      {/* Vertical git line + icon node */}
      <div className="flex flex-col items-center shrink-0 w-7">
        <div
          className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${cfg.bg} ${cfg.color} shrink-0 border border-current/20 ${reconStatus === 'running' ? 'animate-pulse ring-1 ring-current/40' : ''}`}
        >
          {reconStatus === 'running' ? '◎' : reconStatus === 'done' && verdict === 'edit' ? '✎' : reconStatus === 'done' && verdict === 'merge' ? '⊕' : reconStatus === 'done' && verdict === 'cut' ? '⌀' : reconStatus === 'done' && verdict === 'defer' ? '→' : cfg.icon}
        </div>
        {!isLast && (
          <div className="w-px flex-1 bg-white/10 min-h-3" />
        )}
      </div>

      {/* Scene content */}
      <button
        onClick={() => { setExpanded((e) => !e); onClick(); }}
        className="text-left flex-1 pb-2 pl-1.5 min-w-0"
      >
        {/* Top line: scene ID + verdict badge */}
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] bg-white/6 text-text-secondary px-1.5 py-0.5 rounded shrink-0">
            {scene.id}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
            {cfg.label}
          </span>
          {reconStatus && reconStatus !== 'skipped' && (
            <span className={`text-[9px] font-mono ${reconStatus === 'done' ? 'text-emerald-400/60' : reconStatus === 'running' ? 'text-white/50 animate-pulse' : 'text-white/20'}`}>
              {STEP_STATUS_ICON[reconStatus]}
            </span>
          )}
          {arc && (
            <span className="text-[10px] text-text-dim truncate">
              {arc.name}
            </span>
          )}
        </div>

        {/* Summary */}
        <p className={`text-xs mt-0.5 leading-snug ${verdict === 'cut' ? 'text-text-dim line-through' : 'text-text-secondary'}`}>
          {scene.summary}
        </p>

        {/* Reason (expandable) */}
        {expanded && reason && (
          <p className={`text-[11px] mt-1 leading-snug ${cfg.color} opacity-80`}>
            {reason}
          </p>
        )}
      </button>
    </div>
  );
}

// ── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({ sceneEvals }: { sceneEvals: BranchEvaluation['sceneEvals'] }) {
  const counts: Record<SceneVerdict, number> = { ok: 0, edit: 0, merge: 0, cut: 0, defer: 0 };
  for (const e of sceneEvals) counts[e.verdict]++;
  const total = sceneEvals.length || 1;

  return (
    <div className="flex items-center gap-3 text-[10px] font-mono">
      {(['ok', 'edit', 'merge', 'cut', 'defer'] as SceneVerdict[]).map((v) => {
        const cfg = VERDICT_CONFIG[v];
        const pct = Math.round((counts[v] / total) * 100);
        return (
          <span key={v} className={`${cfg.color} flex items-center gap-1`}>
            <span className={`w-4 h-4 rounded-full flex items-center justify-center ${cfg.bg} text-[9px] font-bold`}>
              {cfg.icon}
            </span>
            {counts[v]} ({pct}%)
          </span>
        );
      })}
    </div>
  );
}

// ── Reconstruction progress bar ──────────────────────────────────────────────

function ReconProgress({ progress }: { progress: ReconstructionProgress }) {
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const phaseLabels: Record<string, string> = {
    preparing: 'Preparing...',
    restructuring: 'Copying ok scenes...',
    editing: 'Editing scenes...',
    rewriting: 'Rewriting scenes...',
    done: 'Done',
  };

  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-text-dim">{phaseLabels[progress.phase] ?? progress.phase}</span>
        <span className="text-text-secondary font-mono">{progress.completed}/{progress.total} ({pct}%)</span>
      </div>
      <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${progress.phase === 'done' ? 'bg-emerald-500/60' : 'bg-white/30'}`}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function BranchEval() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const resolvedKeys = state.resolvedEntryKeys;
  const branchId = state.activeBranchId;

  // Load persisted evaluation for current branch
  const persisted = branchId ? narrative?.branchEvaluations?.[branchId] ?? null : null;
  const [evaluation, setEvaluation] = useState<BranchEvaluation | null>(persisted);
  const [loading, setLoading] = useState(false);
  const [reconstructing, setReconstructing] = useState(false);
  const [reconProgress, setReconProgress] = useState<ReconstructionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState('');
  const [showGuidance, setShowGuidance] = useState(false);
  const cancelledRef = useRef(false);

  // Sync from store when branch changes
  const lastBranchRef = useRef(branchId);
  if (branchId !== lastBranchRef.current) {
    lastBranchRef.current = branchId;
    setEvaluation(branchId ? narrative?.branchEvaluations?.[branchId] ?? null : null);
    setReconProgress(null);
    setError(null);
  }

  const runEvaluation = useCallback(async () => {
    if (!narrative || !branchId) return;
    setLoading(true);
    setError(null);
    cancelledRef.current = false;

    try {
      const result = await evaluateBranch(narrative, resolvedKeys, branchId, guidance || undefined);
      if (!cancelledRef.current) {
        setEvaluation(result);
        dispatch({ type: 'SET_BRANCH_EVALUATION', branchId, evaluation: result });
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err.message : 'Evaluation failed');
      }
    } finally {
      setLoading(false);
    }
  }, [narrative, resolvedKeys, branchId]);

  const runReconstruction = useCallback(async () => {
    if (!narrative || !branchId || !evaluation) return;
    setReconstructing(true);
    setError(null);
    cancelledRef.current = false;

    try {
      // All work happens in memory — nothing touches the store until done.
      const result = await reconstructBranch(
        narrative,
        resolvedKeys,
        evaluation,
        {
          onProgress: (p) => {
            if (!cancelledRef.current) setReconProgress({ ...p });
          },
          onSceneReady: () => {}, // no-op — we commit everything at the end
          onBranchCreated: () => {}, // no-op — we commit everything at the end
        },
        cancelledRef,
      );

      if (!cancelledRef.current) {
        // Commit the finished branch + all scenes to the store in one shot
        dispatch({ type: 'CREATE_BRANCH', branch: result.branch });
        const seenArcs = new Set<string>();
        for (const scene of result.scenes) {
          if (!seenArcs.has(scene.arcId)) {
            seenArcs.add(scene.arcId);
            const arc = result.arcs[scene.arcId];
            if (arc) {
              dispatch({ type: 'BULK_ADD_SCENES', scenes: result.scenes.filter((s) => s.arcId === arc.id), arc, branchId: result.branch.id });
            }
          }
        }
        // Now switch — the branch has fully processed scenes
        dispatch({ type: 'SWITCH_BRANCH', branchId: result.branch.id });
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err.message : 'Reconstruction failed');
      }
    } finally {
      setReconstructing(false);
    }
  }, [narrative, resolvedKeys, branchId, evaluation, dispatch]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setLoading(false);
    setReconstructing(false);
  }, []);

  // Build verdict + reconstruction status lookups
  const verdictMap = new Map<string, { verdict: SceneVerdict; reason: string }>();
  if (evaluation) {
    for (const e of evaluation.sceneEvals) {
      verdictMap.set(e.sceneId, { verdict: e.verdict, reason: e.reason });
    }
  }
  const reconStatusMap = new Map<string, 'pending' | 'running' | 'done' | 'skipped'>();
  if (reconProgress) {
    for (const step of reconProgress.steps) {
      reconStatusMap.set(step.sceneId, step.status);
    }
  }

  // Resolve scenes in timeline order
  const scenes: { scene: Scene; arc?: Arc }[] = [];
  if (narrative) {
    for (const key of resolvedKeys) {
      const entry = resolveEntry(narrative, key);
      if (entry && isScene(entry)) {
        scenes.push({
          scene: entry,
          arc: narrative.arcs[entry.arcId],
        });
      }
    }
  }

  if (!narrative) {
    return (
      <div className="p-4 text-text-dim text-xs">No narrative loaded.</div>
    );
  }

  const busy = loading || reconstructing;
  const hasWork = evaluation && evaluation.sceneEvals.some((e) => e.verdict !== 'ok');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-text-primary">Branch Evaluation</h3>
          <div className="flex items-center gap-1.5">
            {busy ? (
              <button
                onClick={cancel}
                className="text-[10px] px-2 py-0.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
              >
                Cancel
              </button>
            ) : (
              <>
                <button
                  onClick={() => { setShowGuidance(true); }}
                  className={`text-[10px] px-2 py-0.5 rounded transition-colors ${guidance ? 'bg-violet-500/15 text-violet-400' : 'bg-white/5 text-text-dim hover:text-text-secondary'}`}
                  title="Add external guidance before evaluating"
                >
                  {guidance ? '✦ Guided' : '+ Guidance'}
                </button>
                <button
                  onClick={runEvaluation}
                  className="text-[10px] px-2 py-0.5 rounded bg-white/8 text-text-secondary hover:bg-white/12 transition-colors"
                >
                  {evaluation ? 'Re-evaluate' : 'Evaluate'}
                </button>
                {hasWork && (
                  <button
                    onClick={runReconstruction}
                    className="text-[10px] px-2 py-0.5 rounded bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 transition-colors"
                  >
                    Reconstruct
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {showGuidance && !busy && (
          <div className="mt-1.5">
            <textarea
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              placeholder="Paste external feedback, ChatGPT analysis, or specific focus areas..."
              className="w-full h-20 bg-white/4 border border-white/8 rounded px-2 py-1.5 text-[11px] text-text-secondary placeholder:text-text-dim/50 resize-y focus:outline-none focus:border-violet-500/30"
            />
            {guidance && (
              <button
                onClick={() => setGuidance('')}
                className="text-[9px] text-text-dim hover:text-text-secondary mt-0.5"
              >
                Clear guidance
              </button>
            )}
          </div>
        )}

        {loading && (
          <div className="mt-1.5">
            <div className="flex items-center gap-2">
              <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-white/20 rounded-full animate-[eval-sweep_2s_ease-in-out_infinite]" />
              </div>
              <span className="text-[10px] text-text-dim shrink-0">Reading {scenes.length} scenes...</span>
            </div>
            <style>{`@keyframes eval-sweep { 0% { width: 5%; margin-left: 0; } 50% { width: 40%; margin-left: 30%; } 100% { width: 5%; margin-left: 95%; } }`}</style>
          </div>
        )}

        {reconProgress && reconstructing && (
          <ReconProgress progress={reconProgress} />
        )}

        {error && (
          <p className="mt-1 text-[10px] text-red-400">{error}</p>
        )}

        {evaluation && !busy && (
          <div className="mt-1.5">
            <StatsBar sceneEvals={evaluation.sceneEvals} />
          </div>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {/* Overall analysis */}
        {evaluation && (
          <div className="mb-3 pb-3 border-b border-white/5">
            <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
              {evaluation.overall}
            </p>

            {evaluation.repetitions.length > 0 && (
              <div className="mt-2">
                <span className="text-[10px] text-amber-400 font-medium">Repetitive patterns:</span>
                <ul className="mt-0.5 space-y-0.5">
                  {evaluation.repetitions.map((r, i) => (
                    <li key={i} className="text-[10px] text-text-dim pl-2 before:content-['·'] before:mr-1 before:text-amber-400/50">
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {evaluation.thematicQuestion && (
              <p className="mt-2 text-[11px] text-violet-400/80 italic">
                &ldquo;{evaluation.thematicQuestion}&rdquo;
              </p>
            )}
          </div>
        )}

        {/* Vertical git tree */}
        {evaluation ? (
          <div className="flex flex-col">
            {scenes.map(({ scene, arc }, i) => {
              const ev = verdictMap.get(scene.id);
              return (
                <SceneNode
                  key={scene.id}
                  scene={scene}
                  arc={arc}
                  verdict={ev?.verdict ?? 'ok'}
                  reason={ev?.reason ?? ''}
                  isLast={i === scenes.length - 1}
                  reconStatus={reconStatusMap.get(scene.id)}
                  onClick={() => {
                    const idx = resolvedKeys.indexOf(scene.id);
                    if (idx >= 0) {
                      dispatch({ type: 'SET_SCENE_INDEX', index: idx });
                      dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId: scene.id } });
                    }
                  }}
                />
              );
            })}
          </div>
        ) : loading ? (
          /* Skeleton tree while evaluation runs */
          <div className="flex flex-col opacity-40">
            {scenes.map(({ scene }, i) => (
              <div key={scene.id} className="flex gap-0 min-h-0">
                <div className="flex flex-col items-center shrink-0 w-7">
                  <div className="w-5 h-5 rounded-full bg-white/5 shrink-0 animate-pulse" />
                  {i < scenes.length - 1 && <div className="w-px flex-1 bg-white/5 min-h-3" />}
                </div>
                <div className="flex-1 pb-2 pl-1.5 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] bg-white/4 text-transparent px-1.5 py-0.5 rounded shrink-0">{scene.id}</span>
                    <div className="h-3 w-8 bg-white/4 rounded-full" />
                  </div>
                  <div className="mt-1 h-3 bg-white/3 rounded w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ) : !busy ? (
          <div className="text-center py-8 text-text-dim text-xs">
            <p>Run an evaluation to see per-scene verdicts.</p>
            <p className="mt-1 text-[10px]">{scenes.length} scenes on this branch</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
