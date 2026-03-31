'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { evaluateBranch } from '@/lib/ai/evaluate';
import { reconstructBranch, type ReconstructionProgress } from '@/lib/ai/reconstruct';
import { resolveEntry, isScene } from '@/types/narrative';
import type { StructureReview, SceneEval, SceneVerdict, Scene, Arc } from '@/types/narrative';
import { IconCheck, IconTilde, IconMerge, IconCross, IconPlus, IconArrowRight, IconRunning, IconDot, IconDash, IconPencil, IconSlashCircle, IconReset, IconSparkle } from '@/components/icons/EvalIcons';
import type { ReactNode } from 'react';

// ── Verdict visuals ──────────────────────────────────────────────────────────

const VERDICT_CONFIG: Record<SceneVerdict, { icon: ReactNode; color: string; bg: string; label: string }> = {
  ok:      { icon: <IconCheck size={10} />,       color: 'text-emerald-400', bg: 'bg-emerald-500/15', label: 'OK' },
  edit:    { icon: <IconTilde size={10} />,       color: 'text-amber-400',   bg: 'bg-amber-500/15',   label: 'Edit' },
  merge:   { icon: <IconMerge size={10} />,       color: 'text-blue-400',    bg: 'bg-blue-500/15',    label: 'Merge' },
  cut:     { icon: <IconCross size={10} />,       color: 'text-white/30',    bg: 'bg-white/5',        label: 'Cut' },
  insert:  { icon: <IconPlus size={10} />,        color: 'text-cyan-400',    bg: 'bg-cyan-500/15',    label: 'Insert' },
  move:    { icon: <IconArrowRight size={10} />,  color: 'text-blue-400',    bg: 'bg-blue-500/15',    label: 'Move' },
};

const STEP_STATUS_ICON: Record<string, ReactNode> = {
  pending: <IconDot size={8} />,
  running: <IconRunning size={8} />,
  done: <IconCheck size={8} />,
  skipped: <IconDash size={8} />,
};

// ── Scene node in the vertical tree ──────────────────────────────────────────

/** Per-scene override: user can change verdict and/or reason text */
type SceneOverride = { verdict?: SceneVerdict; reason?: string };

function SceneNode({
  scene,
  arc,
  verdict,
  originalVerdict,
  reason,
  isOverridden,
  moveAfter,
  isLast,
  reconStatus,
  onClick,
  onOverrideVerdict,
  onOverrideReason,
  onReset,
}: {
  scene: Scene;
  arc?: Arc;
  verdict: SceneVerdict;
  originalVerdict: SceneVerdict;
  reason: string;
  isOverridden: boolean;
  moveAfter?: string;
  isLast: boolean;
  reconStatus?: 'pending' | 'running' | 'done' | 'skipped';
  onClick: () => void;
  onOverrideVerdict?: (newVerdict: SceneVerdict) => void;
  onOverrideReason?: (newReason: string) => void;
  onReset?: () => void;
}) {
  const cfg = VERDICT_CONFIG[verdict];
  const [expanded, setExpanded] = useState(false);
  const [editingReason, setEditingReason] = useState(false);
  const [reasonDraft, setReasonDraft] = useState(reason);

  // Available verdicts: ok, edit, cut — plus the original if it's something else (merge, move, insert)
  const verdictOptions = [...new Set(['ok', 'edit', 'cut', originalVerdict])] as SceneVerdict[];

  return (
    <div className="flex gap-0 min-h-0">
      {/* Vertical git line + icon node */}
      <div className="flex flex-col items-center shrink-0 w-7">
        <div
          className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${cfg.bg} ${cfg.color} shrink-0 border border-current/20 ${reconStatus === 'running' ? 'animate-pulse ring-1 ring-current/40' : ''}`}
        >
          {reconStatus === 'running' ? '◎' : reconStatus === 'done' && verdict === 'edit' ? '✎' : reconStatus === 'done' && verdict === 'merge' ? '⊕' : reconStatus === 'done' && verdict === 'cut' ? '⌀' : reconStatus === 'done' && verdict === 'move' ? '→' : cfg.icon}
        </div>
        {!isLast && (
          <div className="w-px flex-1 bg-white/10 min-h-3" />
        )}
      </div>

      {/* Scene content */}
      <div className="flex-1 pb-2 pl-1.5 min-w-0">
        <button
          onClick={() => { setExpanded((e) => !e); onClick(); }}
          className="text-left w-full"
        >
          {/* Top line: scene ID + verdict badge */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[10px] bg-white/6 text-text-secondary px-1.5 py-0.5 rounded shrink-0">
              {scene.id}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
              {cfg.label}
            </span>
            {isOverridden && (
              <span className="text-[9px] text-violet-400/50">overridden</span>
            )}
            {verdict === 'move' && moveAfter && (
              <span className="text-[10px] font-mono text-blue-400/70 flex items-center gap-0.5 shrink-0">
                → after <span className="bg-blue-500/15 px-1 py-0.5 rounded">{moveAfter}</span>
              </span>
            )}
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
          <p className={`text-xs mt-0.5 leading-snug ${verdict === 'cut' ? 'text-text-dim line-through' : verdict === 'move' ? 'text-text-dim/70 italic' : 'text-text-secondary'}`}>
            {scene.summary}
          </p>

          {/* Reason — always visible when present */}
          {reason && (
            <p className={`text-[11px] mt-1 leading-snug ${cfg.color} opacity-80`}>
              {reason}
            </p>
          )}
        </button>

        {/* Expanded: verdict controls + editable reason */}
        {expanded && onOverrideVerdict && (
          <div className="mt-1.5 pt-1.5 border-t border-white/5 space-y-1.5">
            {/* Editable reason */}
            {onOverrideReason && (
              editingReason ? (
                <div className="space-y-1">
                  <textarea
                    value={reasonDraft}
                    onChange={(e) => setReasonDraft(e.target.value)}
                    className="w-full h-16 bg-white/4 border border-white/10 rounded px-2 py-1 text-[11px] text-text-secondary resize-y focus:outline-none focus:border-violet-500/30"
                    autoFocus
                  />
                  <div className="flex gap-1">
                    <button
                      onClick={() => { onOverrideReason(reasonDraft); setEditingReason(false); }}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 hover:brightness-125"
                    >
                      Save reason
                    </button>
                    <button
                      onClick={() => { setReasonDraft(reason); setEditingReason(false); }}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-text-dim hover:text-text-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setReasonDraft(reason); setEditingReason(true); }}
                  className="text-[9px] text-text-dim hover:text-text-secondary transition-colors"
                >
                  Edit reason...
                </button>
              )
            )}

            {/* Change verdict */}
            <div className="space-y-0.5">
              <span className="text-[9px] text-text-dim uppercase tracking-wider">Change verdict</span>
              <div className="flex items-center gap-1 flex-wrap">
                {verdictOptions.filter((v) => v !== verdict).map((v) => {
                  const c = VERDICT_CONFIG[v];
                  return (
                    <button
                      key={v}
                      onClick={() => onOverrideVerdict(v)}
                      className={`text-[9px] px-1.5 py-0.5 rounded ${c.bg} ${c.color} hover:brightness-125 transition-all`}
                    >
                      {c.icon} {c.label}
                    </button>
                  );
                })}
                {isOverridden && onReset && (
                  <button
                    onClick={onReset}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-violet-400/70 hover:text-violet-400 transition-all ml-auto"
                  >
                    ↺ Reset to original
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({ sceneEvals }: { sceneEvals: StructureReview['sceneEvals'] }) {
  const counts: Record<SceneVerdict, number> = { ok: 0, edit: 0, merge: 0, cut: 0, insert: 0, move: 0 };
  for (const e of sceneEvals) counts[e.verdict]++;
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono">
      {(['ok', 'edit', 'merge', 'cut', 'insert', 'move'] as SceneVerdict[]).filter((v) => counts[v] > 0).map((v) => {
        const cfg = VERDICT_CONFIG[v];
        return (
          <span key={v} className={`${cfg.color} flex items-center gap-0.5`}>
            <span className="text-[9px]">{cfg.icon}</span>
            {counts[v]}
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

  // Load persisted evaluation for current branch — this is the immutable LLM result
  const persisted = branchId ? narrative?.structureReviews?.[branchId] ?? null : null;
  const [baseEvaluation, setBaseEvaluation] = useState<StructureReview | null>(persisted);
  // User overrides layer: sceneId → partial overrides (verdict, reason)
  const [overrides, setOverrides] = useState<Map<string, SceneOverride>>(new Map());
  const [loading, setLoading] = useState(false);
  const [reconstructing, setReconstructing] = useState(false);
  const [reconProgress, setReconProgress] = useState<ReconstructionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState('');
  const [showGuidance, setShowGuidance] = useState(false);
  const cancelledRef = useRef(false);

  // Merge base evaluation + overrides into effective evaluation for display and reconstruction
  const evaluation = useMemo<StructureReview | null>(() => {
    if (!baseEvaluation) return null;
    if (overrides.size === 0) return baseEvaluation;
    return {
      ...baseEvaluation,
      sceneEvals: baseEvaluation.sceneEvals.map((e) => {
        const ov = overrides.get(e.sceneId);
        if (!ov) return e;
        return {
          ...e,
          verdict: ov.verdict ?? e.verdict,
          reason: ov.reason ?? e.reason,
          // Clear verdict-specific fields when verdict changes
          mergeInto: (ov.verdict ?? e.verdict) === 'merge' ? e.mergeInto : undefined,
          moveAfter: (ov.verdict ?? e.verdict) === 'move' ? e.moveAfter : undefined,
          insertAfter: (ov.verdict ?? e.verdict) === 'insert' ? e.insertAfter : undefined,
        };
      }),
    };
  }, [baseEvaluation, overrides]);

  // Sync from store when branch changes
  const lastBranchRef = useRef(branchId);
  if (branchId !== lastBranchRef.current) {
    lastBranchRef.current = branchId;
    const restored = branchId ? narrative?.structureReviews?.[branchId] ?? null : null;
    setBaseEvaluation(restored);
    setOverrides(new Map());
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
        setBaseEvaluation(result);
        setOverrides(new Map());
        dispatch({ type: 'SET_STRUCTURE_REVIEW', branchId, evaluation: result });
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err.message : 'Review failed');
      }
    } finally {
      setLoading(false);
    }
  }, [narrative, resolvedKeys, branchId, guidance, dispatch]);

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
        // Commit the finished branch + all scenes + arcs to the store
        dispatch({ type: 'CREATE_BRANCH', branch: result.branch });
        // Use RECONSTRUCT_BRANCH to set arcs with replacement semantics (not append)
        dispatch({
          type: 'RECONSTRUCT_BRANCH',
          branchId: result.branch.id,
          scenes: result.scenes,
          arcs: result.arcs,
        });
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
  const verdictMap = new Map<string, { verdict: SceneVerdict; reason: string; moveAfter?: string }>();
  if (evaluation) {
    for (const e of evaluation.sceneEvals) {
      verdictMap.set(e.sceneId, { verdict: e.verdict, reason: e.reason, moveAfter: e.moveAfter });
    }
  }
  const reconStatusMap = new Map<string, 'pending' | 'running' | 'done' | 'skipped'>();
  if (reconProgress) {
    for (const step of reconProgress.steps) {
      reconStatusMap.set(step.sceneId, step.status);
    }
  }

  // Resolve scenes in timeline order, injecting insert and move placeholders
  const scenes: { scene: Scene; arc?: Arc }[] = [];
  // Build insert-after and move-after lookups from evaluation
  const insertAfterLookup = new Map<string, SceneEval[]>();
  const moveAfterLookup = new Map<string, SceneEval[]>();
  if (evaluation) {
    for (const ev of evaluation.sceneEvals) {
      if (ev.verdict === 'insert' && ev.insertAfter) {
        const list = insertAfterLookup.get(ev.insertAfter) ?? [];
        list.push(ev);
        insertAfterLookup.set(ev.insertAfter, list);
      }
      if (ev.verdict === 'move' && ev.moveAfter) {
        const list = moveAfterLookup.get(ev.moveAfter) ?? [];
        list.push(ev);
        moveAfterLookup.set(ev.moveAfter, list);
      }
    }
  }
  if (narrative) {
    const movedSceneIds = new Set(
      evaluation?.sceneEvals.filter((e) => e.verdict === 'move').map((e) => e.sceneId) ?? []
    );

    const injectInserts = (afterId: string, arcId: string) => {
      const inserts = insertAfterLookup.get(afterId);
      if (!inserts) return;
      for (const ins of inserts) {
        scenes.push({
          scene: { kind: 'scene', id: ins.sceneId, arcId, locationId: '', povId: '', participantIds: [], events: [], threadMutations: [], continuityMutations: [], relationshipMutations: [], summary: ins.reason },
        });
        injectInserts(ins.sceneId, arcId);
      }
    };

    const injectMoves = (afterId: string) => {
      const moves = moveAfterLookup.get(afterId);
      if (!moves) return;
      for (const mv of moves) {
        const movedScene = narrative.scenes[mv.sceneId];
        if (!movedScene) continue;
        scenes.push({ scene: movedScene, arc: narrative.arcs[movedScene.arcId] });
        injectInserts(mv.sceneId, movedScene.arcId);
        // Recursively inject any scenes that want to move after this moved scene
        injectMoves(mv.sceneId);
      }
    };

    for (const key of resolvedKeys) {
      const entry = resolveEntry(narrative, key);
      if (entry && isScene(entry)) {
        // Skip moved scenes at their original position — they appear at their target
        if (movedSceneIds.has(entry.id)) continue;
        scenes.push({ scene: entry, arc: narrative.arcs[entry.arcId] });
        injectMoves(entry.id);
        injectInserts(entry.id, entry.arcId);
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
          <h3 className="text-xs font-medium text-text-primary">Structure Review</h3>
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
                  {evaluation ? 'Re-review' : 'Review'}
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
          <div className="mt-1.5 space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-text-dim">Reviewing {scenes.length} scenes...</span>
            </div>
            <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-white/20 rounded-full animate-[eval-sweep_2s_ease-in-out_infinite]" />
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
          <div className="mt-1.5 flex items-center justify-between">
            <StatsBar sceneEvals={evaluation.sceneEvals} />
            {overrides.size > 0 && (
              <button
                onClick={() => setOverrides(new Map())}
                className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-text-dim hover:text-text-secondary transition-colors"
              >
                Reset {overrides.size} edit{overrides.size > 1 ? 's' : ''}
              </button>
            )}
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
              const baseEv = baseEvaluation?.sceneEvals.find((e: SceneEval) => e.sceneId === scene.id);
              const originalVerdict = baseEv?.verdict ?? 'ok';
              const hasOverride = overrides.has(scene.id);
              return (
                <SceneNode
                  key={scene.id}
                  scene={scene}
                  arc={arc}
                  verdict={ev?.verdict ?? 'ok'}
                  originalVerdict={originalVerdict}
                  reason={ev?.reason ?? ''}
                  isOverridden={hasOverride}
                  moveAfter={ev?.moveAfter}
                  isLast={i === scenes.length - 1}
                  reconStatus={reconStatusMap.get(scene.id)}
                  onClick={() => {
                    const idx = resolvedKeys.indexOf(scene.id);
                    if (idx >= 0) {
                      dispatch({ type: 'SET_SCENE_INDEX', index: idx });
                      dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId: scene.id } });
                    }
                  }}
                  onOverrideVerdict={!reconstructing ? (newVerdict: SceneVerdict) => {
                    setOverrides((prev) => {
                      const next = new Map(prev);
                      const existing = next.get(scene.id) ?? {};
                      next.set(scene.id, { ...existing, verdict: newVerdict });
                      return next;
                    });
                  } : undefined}
                  onOverrideReason={!reconstructing ? (newReason: string) => {
                    setOverrides((prev) => {
                      const next = new Map(prev);
                      const existing = next.get(scene.id) ?? {};
                      next.set(scene.id, { ...existing, reason: newReason });
                      return next;
                    });
                  } : undefined}
                  onReset={!reconstructing && hasOverride ? () => {
                    setOverrides((prev) => {
                      const next = new Map(prev);
                      next.delete(scene.id);
                      return next;
                    });
                  } : undefined}
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
            <p>Run a review to see per-scene verdicts.</p>
            <p className="mt-1 text-[10px]">{scenes.length} scenes on this branch</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
