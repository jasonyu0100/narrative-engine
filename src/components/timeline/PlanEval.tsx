'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { reviewPlanQuality } from '@/lib/ai/review';
import { editScenePlan } from '@/lib/ai/scenes';
import { resolveEntry, isScene } from '@/types/narrative';
import type { PlanEvaluation, PlanSceneEval, PlanVerdict, Scene, Arc } from '@/types/narrative';
import { resolvePlanForBranch } from '@/lib/narrative-utils';
import { PLAN_CONCURRENCY } from '@/lib/constants';
import { IconCheck, IconTilde, IconRunning, IconCross, IconDot, IconReset, IconSparkle, IconPlus } from '@/components/icons/EvalIcons';
import SceneRangeSelector, { filterKeysBySceneRange, type SceneRange } from './SceneRangeSelector';
import type { ReactNode } from 'react';

// ── Verdict visuals ──────────────────────────────────────────────────────────

const VERDICT_CONFIG: Record<PlanVerdict, { icon: ReactNode; color: string; bg: string; label: string }> = {
  ok:   { icon: <IconCheck size={10} />, color: 'text-emerald-400', bg: 'bg-emerald-500/15', label: 'OK' },
  edit: { icon: <IconTilde size={10} />, color: 'text-amber-400',   bg: 'bg-amber-500/15',  label: 'Edit' },
};

type PlanOverride = { verdict?: PlanVerdict; issues?: string[] };

// ── Scene node ───────────────────────────────────────────────────────────────

function PlanNode({
  scene,
  arc,
  verdict,
  originalVerdict,
  issues,
  isOverridden,
  isLast,
  replanStatus,
  onClick,
  onOverrideVerdict,
  onReset,
}: {
  scene: Scene;
  arc?: Arc;
  verdict: PlanVerdict;
  originalVerdict: PlanVerdict;
  issues: string[];
  isOverridden: boolean;
  isLast: boolean;
  replanStatus?: 'pending' | 'running' | 'done' | 'error';
  onClick: () => void;
  onOverrideVerdict?: (v: PlanVerdict) => void;
  onReset?: () => void;
}) {
  const cfg = VERDICT_CONFIG[verdict];
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex gap-0 min-h-0">
      <div className="flex flex-col items-center shrink-0 w-7">
        <div
          className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${cfg.bg} ${cfg.color} shrink-0 border border-current/20 ${replanStatus === 'running' ? 'animate-pulse ring-1 ring-current/40' : ''}`}
        >
          {replanStatus === 'running' ? <IconRunning size={10} /> : replanStatus === 'done' ? <IconCheck size={10} /> : cfg.icon}
        </div>
        {!isLast && <div className="w-px flex-1 bg-white/10 min-h-3" />}
      </div>

      <div className="flex-1 pb-2 pl-1.5 min-w-0">
        <button
          onClick={() => { setExpanded((e) => !e); onClick(); }}
          className="text-left w-full"
        >
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] bg-white/6 text-text-secondary px-1.5 py-0.5 rounded shrink-0">
              {scene.id}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
              {cfg.label}
            </span>
            {isOverridden && (
              <span className="text-[9px] text-violet-400/50">overridden</span>
            )}
            {replanStatus && replanStatus !== 'pending' && (
              <span className={`text-[9px] font-mono ${replanStatus === 'done' ? 'text-emerald-400/60' : replanStatus === 'running' ? 'text-white/50 animate-pulse' : replanStatus === 'error' ? 'text-red-400/60' : 'text-white/20'}`}>
                {replanStatus === 'done' ? <IconCheck size={8} /> : replanStatus === 'running' ? <IconRunning size={8} /> : replanStatus === 'error' ? <IconCross size={8} /> : <IconDot size={8} />}
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

          {/* Issues — always visible */}
          {issues.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {issues.map((issue, i) => (
                <li key={i} className="text-[10px] text-amber-400/80 leading-snug pl-2 before:content-['·'] before:mr-1 before:text-amber-400/40">
                  {issue}
                </li>
              ))}
            </ul>
          )}
        </button>

        {/* Expanded: verdict controls */}
        {expanded && onOverrideVerdict && (
          <div className="mt-1.5 pt-1.5 border-t border-white/5">
            <div className="space-y-0.5">
              <span className="text-[9px] text-text-dim uppercase tracking-wider">Change verdict</span>
              <div className="flex items-center gap-1 flex-wrap">
                {(['ok', 'edit'] as PlanVerdict[]).filter((v) => v !== verdict).map((v) => {
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
                    <IconReset size={9} /> Reset to original
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

// ── Main component ───────────────────────────────────────────────────────────

export default function PlanEval({ sceneRange, onRangeChange }: { sceneRange?: SceneRange; onRangeChange?: (r: SceneRange) => void }) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const resolvedKeys = state.resolvedEntryKeys;
  const branchId = state.activeBranchId;

  const filteredKeys = useMemo(
    () => filterKeysBySceneRange(resolvedKeys, narrative, sceneRange ?? null),
    [resolvedKeys, narrative, sceneRange],
  );

  const persisted = branchId ? narrative?.planEvaluations?.[branchId] ?? null : null;
  const [baseEvaluation, setBaseEvaluation] = useState<PlanEvaluation | null>(persisted);
  const [overrides, setOverrides] = useState<Map<string, PlanOverride>>(new Map());
  const [loading, setLoading] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [replanStatuses, setReplanStatuses] = useState<Record<string, 'pending' | 'running' | 'done' | 'error'>>({});
  const [replanProgress, setReplanProgress] = useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState('');
  const [showGuidance, setShowGuidance] = useState(false);
  const [reasoning, setReasoning] = useState('');
  const cancelledRef = useRef(false);

  // Merge base + overrides
  const evaluation = useMemo<PlanEvaluation | null>(() => {
    if (!baseEvaluation) return null;
    if (overrides.size === 0) return baseEvaluation;
    return {
      ...baseEvaluation,
      sceneEvals: baseEvaluation.sceneEvals.map((e) => {
        const ov = overrides.get(e.sceneId);
        if (!ov) return e;
        return { ...e, verdict: ov.verdict ?? e.verdict, issues: ov.issues ?? e.issues };
      }),
    };
  }, [baseEvaluation, overrides]);

  const lastBranchRef = useRef(branchId);
  if (branchId !== lastBranchRef.current) {
    lastBranchRef.current = branchId;
    setBaseEvaluation(branchId ? narrative?.planEvaluations?.[branchId] ?? null : null);
    setOverrides(new Map());
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
      setReasoning('');
      const result = await reviewPlanQuality(narrative, filteredKeys, branchId, guidance || undefined, (token) => {
        setReasoning((prev) => prev + token);
      });
      if (!cancelledRef.current) {
        setBaseEvaluation(result);
        setOverrides(new Map());
        dispatch({ type: 'SET_PLAN_EVALUATION', branchId, evaluation: result });
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err.message : 'Review failed');
      }
    } finally {
      setLoading(false);
    }
  }, [narrative, filteredKeys, branchId, guidance, dispatch]);

  const runReplans = useCallback(async () => {
    if (!narrative || !evaluation || !branchId) return;
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

        // Resolve plan for current branch
        const resolvedPlan = resolvePlanForBranch(scene, branchId, narrative.branches);
        if (!resolvedPlan) {
          completed++;
          setReplanStatuses((prev) => ({ ...prev, [ev.sceneId]: 'done' }));
          setReplanProgress({ completed, total: edits.length });
          continue;
        }

        setReplanStatuses((prev) => ({ ...prev, [ev.sceneId]: 'running' }));

        try {
          const newPlan = await editScenePlan(narrative, scene, filteredKeys, ev.issues, resolvedPlan);
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
  }, [narrative, filteredKeys, evaluation, dispatch, branchId]);

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
    for (const key of filteredKeys) {
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
          <h3 className="text-xs font-medium text-text-primary">Plan Review</h3>
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
                  {guidance ? <><IconSparkle size={9} /> Guided</> : <><IconPlus size={9} /> Guidance</>}
                </button>
                <button
                  onClick={runEvaluation}
                  disabled={scenes.length === 0}
                  className="text-[10px] px-2 py-0.5 rounded bg-white/8 text-text-secondary hover:bg-white/12 transition-colors disabled:opacity-30"
                >
                  {evaluation ? 'Re-review' : 'Review'}
                </button>
                {hasWork && (
                  <button
                    onClick={runReplans}
                    className="text-[10px] px-2 py-0.5 rounded bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 transition-colors"
                  >
                    Rewrite Plans
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
          <div className="mt-1.5 space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-text-dim">Reviewing {scenes.length} plans...</span>
            </div>
            <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-white/20 rounded-full animate-[eval-sweep_2s_ease-in-out_infinite]" />
            </div>
            <style>{`@keyframes eval-sweep { 0% { width: 5%; margin-left: 0; } 50% { width: 40%; margin-left: 30%; } 100% { width: 5%; margin-left: 95%; } }`}</style>
            {reasoning && (
              <p className="text-[10px] text-text-dim/60 leading-relaxed mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap">{reasoning}</p>
            )}
          </div>
        )}

        {replanning && replanProgress && (() => {
          const pct = replanProgress.total > 0 ? Math.round((replanProgress.completed / replanProgress.total) * 100) : 0;
          return (
            <div className="mt-1.5 space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-text-dim">Rewriting plans...</span>
                <span className="text-text-secondary font-mono">{replanProgress.completed}/{replanProgress.total} ({pct}%)</span>
              </div>
              <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300 bg-white/30"
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
              </div>
            </div>
          );
        })()}

        {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}

        {!busy && (
          <div className="mt-1.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {onRangeChange && <SceneRangeSelector range={sceneRange ?? null} onChange={onRangeChange} />}
              {evaluation && (() => {
                const ok = evaluation.sceneEvals.filter((e) => e.verdict === 'ok').length;
                const edit = evaluation.sceneEvals.filter((e) => e.verdict === 'edit').length;
                return (
                  <div className="flex items-center gap-2 text-[10px] font-mono">
                    {ok > 0 && <span className="text-emerald-400 flex items-center gap-0.5"><IconCheck size={9} />{ok}</span>}
                    {edit > 0 && <span className="text-amber-400 flex items-center gap-0.5"><IconTilde size={9} />{edit}</span>}
                  </div>
                );
              })()}
            </div>
            {evaluation && overrides.size > 0 && (
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
        {evaluation && (
          <div className="mb-3 pb-3 border-b border-white/5">
            <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
              {evaluation.overall}
            </p>

            {evaluation.patterns.length > 0 && (
              <div className="mt-2">
                <span className="text-[10px] text-amber-400 font-medium">Recurring issues:</span>
                <ul className="mt-0.5 space-y-0.5">
                  {evaluation.patterns.map((r: string, i: number) => (
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
              const baseEv = baseEvaluation?.sceneEvals.find((e: PlanSceneEval) => e.sceneId === scene.id);
              return (
                <PlanNode
                  key={scene.id}
                  scene={scene}
                  arc={arc}
                  verdict={ev?.verdict ?? 'ok'}
                  originalVerdict={baseEv?.verdict ?? 'ok'}
                  issues={ev?.issues ?? []}
                  isOverridden={overrides.has(scene.id)}
                  isLast={i === scenes.length - 1}
                  replanStatus={replanStatuses[scene.id]}
                  onClick={() => {
                    const idx = resolvedKeys.indexOf(scene.id);
                    if (idx >= 0) {
                      dispatch({ type: 'SET_SCENE_INDEX', index: idx });
                      dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId: scene.id } });
                    }
                  }}
                  onOverrideVerdict={!replanning ? (v: PlanVerdict) => {
                    setOverrides((prev) => {
                      const next = new Map(prev);
                      next.set(scene.id, { ...next.get(scene.id), verdict: v });
                      return next;
                    });
                  } : undefined}
                  onReset={!replanning && overrides.has(scene.id) ? () => {
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
                <p>Run a review to check plan continuity.</p>
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
