'use client';

import { useState, useEffect, useMemo } from 'react';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { checkContinuityViolations, type CandidateClassification } from '@/lib/continuity-check';
import { usePropositionClassification } from '@/hooks/usePropositionClassification';
import { classificationColor, classificationLabel, BASE_COLORS } from '@/lib/proposition-classify';
import { resolveEmbeddingsBatch } from '@/lib/embeddings';
import { resolveEntry, isScene } from '@/types/narrative';
import type { NarrativeState, BeatPlan, ContinuityViolation, EmbeddingRef, PropositionBaseCategory } from '@/types/narrative';

type Props = {
  narrative: NarrativeState;
  resolvedKeys: string[];
  plan: BeatPlan;
  onClose: () => void;
  onViolationsFound: (violations: ContinuityViolation[]) => void;
};

type Stage = 'classifying' | 'checking' | 'done';

const TOP_K = 5;
const CHECK_LABELS = new Set(['anchor', 'foundation', 'close', 'ending']);
const DIMS = 1536;

export function ContinuityCheckModal({ narrative, resolvedKeys, plan, onClose, onViolationsFound }: Props) {
  const { getClassification } = usePropositionClassification();
  const [stage, setStage] = useState<Stage>('classifying');
  const [classifications, setClassifications] = useState<CandidateClassification[]>([]);
  const [violations, setViolations] = useState<ContinuityViolation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [totalToCheck, setTotalToCheck] = useState(0);

  const sceneId = useMemo(() => {
    for (const [id, scene] of Object.entries(narrative.scenes)) {
      const p = scene.planVersions?.[scene.planVersions.length - 1]?.plan;
      if (p === plan) return id;
    }
    return null;
  }, [narrative, plan]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setStage('classifying');
        const t0 = performance.now();

        // 1. Get classifications from context (instant)
        const propEntries: { bi: number; pi: number; content: string; embRef: EmbeddingRef | undefined; label: string; color: string; base: PropositionBaseCategory; reach: 'Local' | 'Global'; backward: number }[] = [];

        for (let bi = 0; bi < plan.beats.length; bi++) {
          const beat = plan.beats[bi];
          if (!beat.propositions) continue;
          for (let pi = 0; pi < beat.propositions.length; pi++) {
            const cls = sceneId ? getClassification(sceneId, bi, pi) : null;
            if (cls) {
              propEntries.push({
                bi, pi,
                content: beat.propositions[pi].content,
                embRef: beat.propositions[pi].embedding,
                label: classificationLabel(cls.base, cls.reach),
                color: classificationColor(cls.base, cls.reach),
                base: cls.base,
                reach: cls.reach,
                backward: cls.backward,
              });
            }
          }
        }

        // 2. Find which propositions need checking
        const needsCheck = propEntries.filter(e => CHECK_LABELS.has(e.label));
        setTotalToCheck(needsCheck.length);

        if (needsCheck.length === 0) {
          // Build classifications without priors
          setClassifications(propEntries.map(e => ({
            beatIndex: e.bi, propIndex: e.pi, label: e.label, color: e.color,
            base: e.base, reach: e.reach, backwardScore: e.backward, topPriors: [],
          })));
          setStage('done');
          setViolations([]);
          onViolationsFound([]);
          return;
        }

        // 3. Gather prior propositions + embeddings (batch resolve)
        const priorData: { sceneId: string; content: string; embRef: EmbeddingRef }[] = [];
        for (const key of resolvedKeys) {
          const entry = resolveEntry(narrative, key);
          if (!entry || !isScene(entry) || entry.id === sceneId) continue;
          const p = entry.planVersions?.[entry.planVersions.length - 1]?.plan;
          if (!p?.beats) continue;
          for (const beat of p.beats) {
            if (!beat.propositions) continue;
            for (const prop of beat.propositions) {
              if (prop.embedding) priorData.push({ sceneId: entry.id, content: prop.content, embRef: prop.embedding });
            }
          }
        }

        // Batch resolve: priors + checked propositions
        const allRefs: (EmbeddingRef | undefined)[] = [
          ...priorData.map(p => p.embRef),
          ...needsCheck.map(e => e.embRef),
        ];
        const allEmbs = await resolveEmbeddingsBatch(allRefs);

        // 4. Use TF.js matMul: checked props (M) × priors (N) → M×N similarity matrix
        const tf = await import('@tensorflow/tfjs');

        const priorCount = priorData.length;
        const checkCount = needsCheck.length;

        // Build normalized matrices
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

        // matMul: [checkCount × DIMS] × [DIMS × priorCount] = [checkCount × priorCount]
        const checkMat = tf.tensor2d(checkFlat, [checkCount, DIMS]);
        const priorMat = tf.tensor2d(priorFlat, [priorCount, DIMS]);
        const simMat = tf.matMul(checkMat, priorMat, false, true);
        const simData = new Float32Array(await simMat.data());
        simMat.dispose(); checkMat.dispose(); priorMat.dispose();

        const t1 = performance.now();
        console.log(`[ContinuityCheck] Similarity matrix (${checkCount}×${priorCount}) in ${(t1 - t0).toFixed(0)}ms`);

        if (cancelled) return;

        // 5. Extract top-k priors per checked proposition
        const cls: CandidateClassification[] = [];

        // First add non-checked entries (no priors)
        for (const e of propEntries) {
          if (!CHECK_LABELS.has(e.label)) {
            cls.push({ beatIndex: e.bi, propIndex: e.pi, label: e.label, color: e.color, base: e.base, reach: e.reach, backwardScore: e.backward, topPriors: [] });
          }
        }

        // Then add checked entries with top priors
        for (let ci = 0; ci < checkCount; ci++) {
          const e = needsCheck[ci];
          const rowOffset = ci * priorCount;

          // Find top-k
          const sims: { sim: number; idx: number }[] = [];
          for (let j = 0; j < priorCount; j++) sims.push({ sim: simData[rowOffset + j], idx: j });
          sims.sort((a, b) => b.sim - a.sim);
          const topk = sims.slice(0, TOP_K);

          cls.push({
            beatIndex: e.bi, propIndex: e.pi, label: e.label, color: e.color,
            base: e.base, reach: e.reach, backwardScore: e.backward,
            topPriors: topk.map(x => ({
              sceneId: priorData[x.idx].sceneId,
              content: priorData[x.idx].content,
              similarity: x.sim,
            })),
          });
        }

        // Sort by beat/prop order
        cls.sort((a, b) => a.beatIndex * 100 + a.propIndex - (b.beatIndex * 100 + b.propIndex));
        setClassifications(cls);

        // 6. LLM violation check — single batched call
        setStage('checking');
        const candidateContents: Record<string, string> = {};
        for (const e of propEntries) {
          candidateContents[`${e.bi}:${e.pi}`] = e.content;
        }
        const found = await checkContinuityViolations(cls, candidateContents);
        if (cancelled) return;

        for (const v of found) {
          const beat = plan.beats[v.beatIndex];
          const prop = beat?.propositions?.[v.propIndex];
          if (prop) v.candidateContent = prop.content;
        }

        setViolations(found);
        onViolationsFound(found);
        setStage('done');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal onClose={onClose} size="lg">
      <ModalHeader onClose={onClose}>
        <h2 className="text-[13px] font-semibold text-text-primary">Continuity Check</h2>
      </ModalHeader>
      <ModalBody className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
        {/* Progress */}
        {stage !== 'done' && !error && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-[11px] text-text-secondary">
                {stage === 'classifying'
                  ? 'Computing similarity against prior propositions...'
                  : `Checking ${totalToCheck} high-value propositions for contradictions...`
                }
              </span>
            </div>
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="rounded-lg border border-white/5 p-3 animate-pulse">
                  <div className="flex gap-3">
                    <div className="w-16 h-3 bg-white/5 rounded" />
                    <div className="flex-1 h-3 bg-white/5 rounded" />
                  </div>
                  <div className="mt-2 h-3 bg-white/3 rounded w-3/4" />
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-[10px] text-red-400">{error}</p>
          </div>
        )}

        {stage === 'done' && (
          <div className="space-y-4">
            {/* Summary */}
            <div className={`p-4 rounded-lg border ${violations.length === 0 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
              <div className="flex items-center gap-2 mb-1">
                {violations.length === 0 ? (
                  <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
                ) : (
                  <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                )}
                <span className={`text-[12px] font-semibold ${violations.length === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {violations.length === 0 ? 'No continuity violations detected' : `${violations.length} violation${violations.length !== 1 ? 's' : ''} found`}
                </span>
              </div>
              <p className="text-[10px] text-text-dim ml-6">
                {classifications.length} propositions reviewed, {totalToCheck} high-value checked
              </p>
            </div>

            {/* Per-proposition results */}
            <div className="space-y-1">
              {classifications.map((c, i) => {
                const violation = violations.find(v => v.beatIndex === c.beatIndex && v.propIndex === c.propIndex);
                const prop = plan.beats[c.beatIndex]?.propositions?.[c.propIndex];
                if (!prop) return null;

                return (
                  <div
                    key={i}
                    className={`flex items-start gap-2 rounded-md p-2 ${violation ? 'bg-red-500/5 border border-red-500/20' : 'hover:bg-white/3'}`}
                    style={{ borderLeft: `2px solid ${c.color}` }}
                  >
                    <span className="shrink-0 text-[8px] font-medium mt-0.5" style={{ color: c.color }}>{c.label}</span>
                    {violation && <span className="shrink-0 text-[8px] font-medium text-red-400 mt-0.5">⚠</span>}
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-text-secondary italic">{prop.content}</p>
                      {violation && <p className="text-[9px] text-red-400/80 mt-1">{violation.explanation}</p>}
                      {violation && violation.priorContent.length > 0 && (
                        <p className="text-[8px] text-text-dim/50 mt-0.5">Conflicts with: &ldquo;{violation.priorContent[0].slice(0, 100)}&rdquo;</p>
                      )}
                    </div>
                    <span className="text-[7px] font-mono text-text-dim/30 shrink-0 mt-0.5">B{c.beatIndex + 1}:P{c.propIndex + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}
