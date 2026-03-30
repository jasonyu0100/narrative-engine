'use client';

import { useState, useCallback, useRef } from 'react';
import { useStore } from '@/lib/store';
import { evaluatePlanQuality } from '@/lib/ai/evaluate';
import { generateScenePlan } from '@/lib/ai/scenes';
import { resolveEntry, isScene } from '@/types/narrative';
import type { PlanEvaluation, PlanVerdict, Scene, Arc } from '@/types/narrative';
import { PLAN_CONCURRENCY } from '@/lib/constants';

// ── Verdict visuals ──────────────────────────────────────────────────────────

const VERDICT_CONFIG: Record<PlanVerdict, { icon: string; color: string; bg: string; label: string }> = {
  ok:   { icon: '✓', color: 'text-emerald-400', bg: 'bg-emerald-500/15', label: 'OK' },
  edit: { icon: '~', color: 'text-amber-400',   bg: 'bg-amber-500/15',  label: 'Edit' },
};

// ── Scene node ───────────────────────────────────────────────────────────────

function PlanNode({
  scene,
  arc,
  verdict,
  issues,
  isLast,
  replanStatus,
  onClick,
}: {
  scene: Scene;
  arc?: Arc;
  verdict: PlanVerdict;
  issues: string[];
  isLast: boolean;
  replanStatus?: 'pending' | 'running' | 'done' | 'error';
  onClick: () => void;
}) {
  const cfg = VERDICT_CONFIG[verdict];
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex gap-0 min-h-0">
      <div className="flex flex-col items-center shrink-0 w-7">
        <div
          className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${cfg.bg} ${cfg.color} shrink-0 border border-current/20 ${replanStatus === 'running' ? 'animate-pulse ring-1 ring-current/40' : ''}`}
        >
          {replanStatus === 'running' ? '◎' : replanStatus === 'done' ? '✓' : cfg.icon}
        </div>
        {!isLast && <div className="w-px flex-1 bg-white/10 min-h-3" />}
      </div>

      <button
        onClick={() => { setExpanded((e) => !e); onClick(); }}
        className="text-left flex-1 pb-2 pl-1.5 min-w-0"
      >
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] bg-white/6 text-text-secondary px-1.5 py-0.5 rounded shrink-0">
            {scene.id}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
            {cfg.label}
          </span>
          {replanStatus && replanStatus !== 'pending' && (
            <span className={`text-[9px] font-mono ${replanStatus === 'done' ? 'text-emerald-400/60' : replanStatus === 'running' ? 'text-white/50 animate-pulse' : replanStatus === 'error' ? 'text-red-400/60' : 'text-white/20'}`}>
              {replanStatus === 'done' ? '✓' : replanStatus === 'running' ? '◎' : replanStatus === 'error' ? '✕' : '·'}
            </span>
          )}
          {issues.length > 0 && (
            <span className="text-[9px] text-amber-400/50">{issues.length} issue{issues.length !== 1 ? 's' : ''}</span>
          )}
          {arc && <span className="text-[10px] text-text-dim truncate">{arc.name}</span>}
        </div>

        <p className="text-xs mt-0.5 leading-snug text-text-secondary truncate">
          {scene.summary}
        </p>

        {expanded && issues.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {issues.map((issue, i) => (
              <li key={i} className="text-[10px] text-amber-400/80 leading-snug pl-2 before:content-['·'] before:mr-1 before:text-amber-400/40">
                {issue}
              </li>
            ))}
          </ul>
        )}
      </button>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function PlanEval() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const resolvedKeys = state.resolvedEntryKeys;
  const branchId = state.activeBranchId;

  const persisted = branchId ? narrative?.planEvaluations?.[branchId] ?? null : null;
  const [evaluation, setEvaluation] = useState<PlanEvaluation | null>(persisted);
  const [loading, setLoading] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [replanStatuses, setReplanStatuses] = useState<Record<string, 'pending' | 'running' | 'done' | 'error'>>({});
  const [replanProgress, setReplanProgress] = useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState('');
  const [showGuidance, setShowGuidance] = useState(false);
  const cancelledRef = useRef(false);

  const lastBranchRef = useRef(branchId);
  if (branchId !== lastBranchRef.current) {
    lastBranchRef.current = branchId;
    setEvaluation(branchId ? narrative?.planEvaluations?.[branchId] ?? null : null);
    setReplanStatuses({});
    setReplanProgress(null);
    setError(null);
  }

  const runEvaluation = useCallback(async () => {
    if (!narrative || !branchId) return;
    setLoading(true);
    setError(null);
    cancelledRef.current = false;

    try {
      const result = await evaluatePlanQuality(narrative, resolvedKeys, branchId, guidance || undefined);
      if (!cancelledRef.current) {
        setEvaluation(result);
        dispatch({ type: 'SET_PLAN_EVALUATION', branchId, evaluation: result });
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err.message : 'Evaluation failed');
      }
    } finally {
      setLoading(false);
    }
  }, [narrative, resolvedKeys, branchId, guidance, dispatch]);

  const runReplans = useCallback(async () => {
    if (!narrative || !evaluation) return;
    const edits = evaluation.sceneEvals.filter((e) => e.verdict === 'edit' && e.issues.length > 0);
    if (edits.length === 0) return;

    setReplanning(true);
    setError(null);
    cancelledRef.current = false;

    const statuses: Record<string, 'pending' | 'running' | 'done' | 'error'> = {};
    for (const e of edits) statuses[e.sceneId] = 'pending';
    setReplanStatuses({ ...statuses });
    setReplanProgress({ completed: 0, total: edits.length });

    let completed = 0;
    let nextIdx = 0;

    const runWorker = async () => {
      while (!cancelledRef.current) {
        const idx = nextIdx++;
        if (idx >= edits.length) break;
        const ev = edits[idx];
        const scene = narrative.scenes[ev.sceneId];
        if (!scene) {
          completed++;
          setReplanStatuses((prev) => ({ ...prev, [ev.sceneId]: 'done' }));
          setReplanProgress({ completed, total: edits.length });
          continue;
        }

        setReplanStatuses((prev) => ({ ...prev, [ev.sceneId]: 'running' }));

        try {
          const newPlan = await generateScenePlan(narrative, scene, resolvedKeys);
          if (!cancelledRef.current) {
            dispatch({ type: 'UPDATE_SCENE', sceneId: ev.sceneId, updates: { plan: newPlan } });
          }
          setReplanStatuses((prev) => ({ ...prev, [ev.sceneId]: 'done' }));
        } catch {
          setReplanStatuses((prev) => ({ ...prev, [ev.sceneId]: 'error' }));
        }
        completed++;
        setReplanProgress({ completed, total: edits.length });
      }
    };

    await Promise.all(Array.from({ length: Math.min(PLAN_CONCURRENCY, edits.length) }, () => runWorker()));
    setReplanning(false);
  }, [narrative, resolvedKeys, evaluation, dispatch]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setLoading(false);
    setReplanning(false);
  }, []);

  // Build lookup
  const verdictMap = new Map<string, { verdict: PlanVerdict; issues: string[] }>();
  if (evaluation) {
    for (const e of evaluation.sceneEvals) {
      verdictMap.set(e.sceneId, { verdict: e.verdict, issues: e.issues });
    }
  }

  // Resolve scenes with plans
  const scenes: { scene: Scene; arc?: Arc }[] = [];
  if (narrative) {
    for (const key of resolvedKeys) {
      const entry = resolveEntry(narrative, key);
      if (entry && isScene(entry) && (entry as Scene).plan?.beats?.length) {
        scenes.push({
          scene: entry as Scene,
          arc: narrative.arcs[(entry as Scene).arcId],
        });
      }
    }
  }

  if (!narrative) {
    return <div className="p-4 text-text-dim text-xs">No narrative loaded.</div>;
  }

  const busy = loading || replanning;
  const hasWork = evaluation && evaluation.sceneEvals.some((e) => e.verdict === 'edit');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-text-primary">Plan Evaluation</h3>
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
                  onClick={() => setShowGuidance(true)}
                  className={`text-[10px] px-2 py-0.5 rounded transition-colors ${guidance ? 'bg-violet-500/15 text-violet-400' : 'bg-white/5 text-text-dim hover:text-text-secondary'}`}
                >
                  {guidance ? '✦ Guided' : '+ Guidance'}
                </button>
                <button
                  onClick={runEvaluation}
                  disabled={scenes.length === 0}
                  className="text-[10px] px-2 py-0.5 rounded bg-white/8 text-text-secondary hover:bg-white/12 transition-colors disabled:opacity-30"
                >
                  {evaluation ? 'Re-evaluate' : 'Evaluate'}
                </button>
                {hasWork && (
                  <button
                    onClick={runReplans}
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
              placeholder="Describe continuity issues to focus on — e.g. 'character positions after the battle', 'who knows about the betrayal'..."
              className="w-full h-20 bg-white/4 border border-white/8 rounded px-2 py-1.5 text-[11px] text-text-secondary placeholder:text-text-dim/50 resize-y focus:outline-none focus:border-violet-500/30"
            />
            {guidance && (
              <button onClick={() => setGuidance('')} className="text-[9px] text-text-dim hover:text-text-secondary mt-0.5">
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
              <span className="text-[10px] text-text-dim shrink-0">Reading {scenes.length} plans...</span>
            </div>
            <style>{`@keyframes eval-sweep { 0% { width: 5%; margin-left: 0; } 50% { width: 40%; margin-left: 30%; } 100% { width: 5%; margin-left: 95%; } }`}</style>
          </div>
        )}

        {replanning && replanProgress && (
          <div className="mt-1.5 space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-text-dim">Regenerating plans...</span>
              <span className="text-text-secondary font-mono">{replanProgress.completed}/{replanProgress.total}</span>
            </div>
            <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300 bg-violet-500/60"
                style={{ width: `${Math.max(2, Math.round((replanProgress.completed / replanProgress.total) * 100))}%` }}
              />
            </div>
          </div>
        )}

        {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}

        {evaluation && !busy && (
          <div className="mt-1.5 flex items-center gap-2 text-[10px] font-mono">
            {(() => {
              const ok = evaluation.sceneEvals.filter((e) => e.verdict === 'ok').length;
              const edit = evaluation.sceneEvals.filter((e) => e.verdict === 'edit').length;
              return (
                <>
                  {ok > 0 && <span className="text-emerald-400 flex items-center gap-0.5"><span className="text-[9px]">✓</span>{ok}</span>}
                  {edit > 0 && <span className="text-amber-400 flex items-center gap-0.5"><span className="text-[9px]">~</span>{edit}</span>}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {evaluation && (
          <div className="mb-3 pb-3 border-b border-white/5">
            <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
              {evaluation.overall}
            </p>

            {evaluation.patterns.length > 0 && (
              <div className="mt-2">
                <span className="text-[10px] text-amber-400 font-medium">Recurring issues:</span>
                <ul className="mt-0.5 space-y-0.5">
                  {evaluation.patterns.map((r, i) => (
                    <li key={i} className="text-[10px] text-text-dim pl-2 before:content-['·'] before:mr-1 before:text-amber-400/50">
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {evaluation ? (
          <div className="flex flex-col">
            {scenes.map(({ scene, arc }, i) => {
              const ev = verdictMap.get(scene.id);
              return (
                <PlanNode
                  key={scene.id}
                  scene={scene}
                  arc={arc}
                  verdict={ev?.verdict ?? 'ok'}
                  issues={ev?.issues ?? []}
                  isLast={i === scenes.length - 1}
                  replanStatus={replanStatuses[scene.id]}
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
            {scenes.length > 0 ? (
              <>
                <p>Run an evaluation to review plan continuity.</p>
                <p className="mt-1 text-[10px]">{scenes.length} scenes with plans</p>
              </>
            ) : (
              <>
                <p>No scenes have beat plans yet.</p>
                <p className="mt-1 text-[10px]">Select a scene and generate a plan from the story reader.</p>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
