'use client';

import { useState, useCallback, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry, isScene } from '@/types/narrative';
import type { Scene, ContinuityViolation, PropositionBaseCategory, EmbeddingRef } from '@/types/narrative';
import { usePropositionClassification } from '@/hooks/usePropositionClassification';
import { classificationColor, classificationLabel, BASE_COLORS } from '@/lib/proposition-classify';
import { resolveEmbeddingsBatch } from '@/lib/embeddings';
import { checkContinuityViolations, type CandidateClassification } from '@/lib/continuity-check';
import SceneRangeSelector, { filterKeysBySceneRange, type SceneRange } from './SceneRangeSelector';

const TOP_K = 5;
const CHECK_LABELS = new Set(['anchor', 'foundation', 'close', 'ending']);

type Props = {
  sceneRange: SceneRange;
  onRangeChange: (range: SceneRange) => void;
};

type ViolationResult = ContinuityViolation & {
  sceneId: string;
  sceneSummary: string;
};

export default function ContinuityEval({ sceneRange, onRangeChange }: Props) {
  const { state } = useStore();
  const narrative = state.activeNarrative;
  const resolvedKeys = state.resolvedEntryKeys;
  const { getClassification } = usePropositionClassification();

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ViolationResult[] | null>(null);
  const [totalChecked, setTotalChecked] = useState(0);
  const [totalProps, setTotalProps] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const filteredKeys = useMemo(() =>
    filterKeysBySceneRange(resolvedKeys, narrative, sceneRange),
    [resolvedKeys, narrative, sceneRange]
  );

  const sceneCount = useMemo(() => {
    if (!narrative) return 0;
    return filteredKeys.filter(k => narrative.scenes[k]).length;
  }, [narrative, filteredKeys]);

  const cancel = useCallback(() => {
    setLoading(false);
  }, []);

  const runCheck = useCallback(async () => {
    if (!narrative || loading) return;
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      // 1. Gather ALL propositions from the entire narrative as priors pool
      //    (every proposition can serve as a prior for propositions that come after it)
      const allProps: { sceneId: string; content: string; embRef: EmbeddingRef; sceneOrder: number }[] = [];
      let sceneOrder = 0;
      for (const key of resolvedKeys) {
        const entry = resolveEntry(narrative, key);
        if (!entry || !isScene(entry)) continue;
        const plan = entry.planVersions?.[entry.planVersions.length - 1]?.plan;
        if (!plan?.beats) { sceneOrder++; continue; }
        for (const beat of plan.beats) {
          if (!beat.propositions) continue;
          for (const prop of beat.propositions) {
            if (prop.embedding) allProps.push({ sceneId: entry.id, content: prop.content, embRef: prop.embedding, sceneOrder });
          }
        }
        sceneOrder++;
      }

      // 2. Gather check-worthy propositions in the filtered range
      type CheckEntry = { sceneId: string; sceneSummary: string; beatIndex: number; propIndex: number; content: string; embRef: EmbeddingRef; label: string; color: string; base: PropositionBaseCategory; reach: 'Local' | 'Global'; backward: number; sceneOrder: number };
      const checkEntries: CheckEntry[] = [];
      let propsTotal = 0;
      const filteredSet = new Set(filteredKeys);

      sceneOrder = 0;
      for (const key of resolvedKeys) {
        const entry = resolveEntry(narrative, key);
        if (!entry || !isScene(entry)) { continue; }
        if (!filteredSet.has(key)) { sceneOrder++; continue; }
        const plan = entry.planVersions?.[entry.planVersions.length - 1]?.plan;
        if (!plan?.beats) { sceneOrder++; continue; }

        for (let bi = 0; bi < plan.beats.length; bi++) {
          const beat = plan.beats[bi];
          if (!beat.propositions) continue;
          for (let pi = 0; pi < beat.propositions.length; pi++) {
            propsTotal++;
            const cls = getClassification(entry.id, bi, pi);
            if (!cls) continue;
            const label = classificationLabel(cls.base, cls.reach);
            if (CHECK_LABELS.has(label) && beat.propositions[pi].embedding) {
              checkEntries.push({
                sceneId: entry.id, sceneSummary: entry.summary?.slice(0, 80) ?? '',
                beatIndex: bi, propIndex: pi, content: beat.propositions[pi].content,
                embRef: beat.propositions[pi].embedding!,
                label, color: classificationColor(cls.base, cls.reach),
                base: cls.base, reach: cls.reach, backward: cls.backward, sceneOrder,
              });
            }
          }
        }
        sceneOrder++;
      }

      if (checkEntries.length === 0) {
        setResults([]);
        setTotalChecked(0);
        setTotalProps(propsTotal);
        return;
      }

      // Filter priors: only propositions from scenes BEFORE each check entry's scene
      // We'll use the full allProps pool and filter per-entry after matMul
      const priorEntries = allProps;

      // 3. Batch resolve ALL embeddings at once
      const allRefs = [...priorEntries.map(p => p.embRef), ...checkEntries.map(c => c.embRef)];
      const allEmbs = await resolveEmbeddingsBatch(allRefs);

      // 4. TF.js matMul: [checkCount × DIMS] × [DIMS × priorCount] → similarity matrix
      const DIMS = 1536;
      const priorCount = priorEntries.length;
      const checkCount = checkEntries.length;

      const priorFlat = new Float32Array(priorCount * DIMS);
      const checkFlat = new Float32Array(checkCount * DIMS);

      for (let i = 0; i < priorCount; i++) {
        const vec = allEmbs.get(i);
        if (!vec) continue;
        const off = i * DIMS;
        let norm = 0;
        for (let d = 0; d < DIMS; d++) { priorFlat[off + d] = vec[d]; norm += vec[d] * vec[d]; }
        norm = Math.sqrt(norm);
        if (norm > 0) for (let d = 0; d < DIMS; d++) priorFlat[off + d] /= norm;
      }
      for (let i = 0; i < checkCount; i++) {
        const vec = allEmbs.get(priorCount + i);
        if (!vec) continue;
        const off = i * DIMS;
        let norm = 0;
        for (let d = 0; d < DIMS; d++) { checkFlat[off + d] = vec[d]; norm += vec[d] * vec[d]; }
        norm = Math.sqrt(norm);
        if (norm > 0) for (let d = 0; d < DIMS; d++) checkFlat[off + d] /= norm;
      }

      const tf = await import('@tensorflow/tfjs');
      const checkMat = tf.tensor2d(checkFlat, [checkCount, DIMS]);
      const priorMat = tf.tensor2d(priorFlat, [priorCount, DIMS]);
      const simMat = tf.matMul(checkMat, priorMat, false, true);
      const simData = new Float32Array(await simMat.data());
      simMat.dispose(); checkMat.dispose(); priorMat.dispose();

      // 5. Extract top-k priors per check entry → build CandidateClassification[]
      const allCls: (CandidateClassification & { sceneId: string; sceneSummary: string; content: string })[] = [];

      for (let ci = 0; ci < checkCount; ci++) {
        const e = checkEntries[ci];
        const rowOff = ci * priorCount;
        // Only consider priors from scenes BEFORE this check entry's scene
        const sims: { sim: number; idx: number }[] = [];
        for (let j = 0; j < priorCount; j++) {
          if (priorEntries[j].sceneOrder < e.sceneOrder) {
            sims.push({ sim: simData[rowOff + j], idx: j });
          }
        }
        sims.sort((a, b) => b.sim - a.sim);
        const topk = sims.slice(0, TOP_K);

        if (topk.length === 0) continue; // No priors before this scene (e.g., first scene)

        allCls.push({
          ...e,
          backwardScore: e.backward,
          topPriors: topk.map(x => ({ sceneId: priorEntries[x.idx].sceneId, content: priorEntries[x.idx].content, similarity: x.sim })),
        });
      }

      // 6. ONE batched LLM call for all check entries
      const propContents: Record<string, string> = {};
      for (const c of allCls) propContents[`${c.beatIndex}:${c.propIndex}`] = c.content;

      const found = await checkContinuityViolations(allCls, propContents);

      // 7. Map violations back to scenes
      const allViolations: ViolationResult[] = found.map(v => {
        const match = allCls.find(c => c.beatIndex === v.beatIndex && c.propIndex === v.propIndex);
        return {
          ...v,
          candidateContent: match?.content ?? v.candidateContent,
          sceneId: match?.sceneId ?? '',
          sceneSummary: match?.sceneSummary ?? '',
        };
      });

      setResults(allViolations);
      setTotalChecked(checkCount);
      setTotalProps(propsTotal);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [narrative, resolvedKeys, filteredKeys, loading, getClassification]);

  if (!narrative) {
    return <div className="p-4 text-text-dim text-xs">No narrative loaded.</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-text-primary">Continuity Check</h3>
          <div className="flex items-center gap-1.5">
            {loading ? (
              <button
                onClick={cancel}
                className="text-[10px] px-2 py-0.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
              >
                Cancel
              </button>
            ) : (
              <button
                onClick={runCheck}
                className="text-[10px] px-2 py-0.5 rounded bg-white/8 text-text-secondary hover:bg-white/12 transition-colors"
              >
                {results ? 'Re-check' : 'Check'}
              </button>
            )}
          </div>
        </div>

        {loading && (
          <div className="mt-1.5 space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-text-dim">Checking {sceneCount} scenes...</span>
            </div>
            <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-orange-400/30 rounded-full animate-[eval-sweep_2s_ease-in-out_infinite]" />
            </div>
            <style>{`@keyframes eval-sweep { 0% { width: 5%; margin-left: 0; } 50% { width: 40%; margin-left: 30%; } 100% { width: 5%; margin-left: 95%; } }`}</style>
          </div>
        )}

        {error && (
          <p className="mt-1 text-[10px] text-red-400">{error}</p>
        )}

        {!loading && (
          <div className="mt-1.5 flex items-center gap-2">
            {onRangeChange && <SceneRangeSelector range={sceneRange ?? null} onChange={onRangeChange} />}
            {results && (
              <span className="text-[9px] text-text-dim">
                {totalProps} props · {totalChecked} checked · {results.length} issues
              </span>
            )}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {!results && !loading && (
          <div className="p-4 text-center">
            <p className="text-[11px] text-text-dim">
              Check propositions across scenes for continuity violations.
            </p>
            <p className="text-[10px] text-text-dim/50 mt-1">
              High-value propositions (anchors, foundations, closes, endings) are checked against prior content via LLM.
            </p>
          </div>
        )}

        {results && results.length === 0 && (
          <div className="p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
              <span className="text-[12px] font-semibold text-emerald-400">No violations</span>
            </div>
            <p className="text-[10px] text-text-dim">
              All {totalChecked} high-value propositions are consistent with prior narrative content.
            </p>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="p-2 space-y-1">
            {results.map((v, i) => {
              const sceneLabel = narrative.scenes[v.sceneId]
                ? `Scene ${resolvedKeys.filter(k => narrative.scenes[k]).indexOf(v.sceneId) + 1}`
                : v.sceneId;

              return (
                <div
                  key={i}
                  className="rounded-md p-2.5 bg-red-500/5 border border-red-500/15"
                >
                  {/* Location */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <svg className="w-3 h-3 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span className="text-[9px] font-mono text-text-dim">{sceneLabel} · B{v.beatIndex + 1}:P{v.propIndex + 1}</span>
                    <span className="text-[8px] font-medium" style={{ color: classificationColor(v.label.includes('anchor') || v.label.includes('foundation') ? 'Anchor' : 'Close', v.label.includes('foundation') || v.label.includes('ending') ? 'Global' : 'Local') }}>
                      {v.label}
                    </span>
                  </div>

                  {/* Candidate content */}
                  <p className="text-[10px] text-text-secondary italic mb-1.5">
                    {v.candidateContent || 'Unknown proposition'}
                  </p>

                  {/* Explanation */}
                  <p className="text-[9px] text-red-400/80 mb-1">
                    {v.explanation}
                  </p>

                  {/* Prior */}
                  {v.priorContent.length > 0 && (
                    <div className="text-[8px] text-text-dim/50 border-l-2 border-white/10 pl-2">
                      Conflicts with: &ldquo;{v.priorContent[0].slice(0, 120)}&rdquo;
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
