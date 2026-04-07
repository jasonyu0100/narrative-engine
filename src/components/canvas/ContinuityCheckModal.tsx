'use client';

import { useState, useEffect } from 'react';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import { classifyCandidatePlan, checkContinuityViolations, type CandidateClassification } from '@/lib/continuity-check';
import { classificationColor } from '@/lib/proposition-classify';
import type { NarrativeState, BeatPlan, ContinuityViolation } from '@/types/narrative';

type Props = {
  narrative: NarrativeState;
  resolvedKeys: string[];
  plan: BeatPlan;
  onClose: () => void;
  onViolationsFound: (violations: ContinuityViolation[]) => void;
};

type Stage = 'classifying' | 'checking' | 'done';

export function ContinuityCheckModal({ narrative, resolvedKeys, plan, onClose, onViolationsFound }: Props) {
  const [stage, setStage] = useState<Stage>('classifying');
  const [classifications, setClassifications] = useState<CandidateClassification[]>([]);
  const [violations, setViolations] = useState<ContinuityViolation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [propsChecked, setPropsChecked] = useState(0);
  const [totalToCheck, setTotalToCheck] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Stage 1: Classify
        setStage('classifying');
        const { classifications: cls } = await classifyCandidatePlan(narrative, resolvedKeys, plan);
        if (cancelled) return;
        setClassifications(cls);

        // Count how many need LLM check
        const checkLabels = new Set(['anchor', 'foundation', 'close', 'ending']);
        const toCheck = cls.filter(c => checkLabels.has(c.label) && c.topPriors.length > 0);
        setTotalToCheck(toCheck.length);

        if (toCheck.length === 0) {
          setStage('done');
          setViolations([]);
          onViolationsFound([]);
          return;
        }

        // Stage 2: Check violations
        setStage('checking');
        const found = await checkContinuityViolations(cls);
        if (cancelled) return;

        // Fill in content
        for (const v of found) {
          const beat = plan.beats[v.beatIndex];
          const prop = beat?.propositions?.[v.propIndex];
          if (prop) v.candidateContent = prop.content;
        }

        setViolations(found);
        setPropsChecked(toCheck.length);
        onViolationsFound(found);
        setStage('done');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalProps = classifications.length;

  return (
    <Modal onClose={onClose} size="lg">
      <ModalHeader onClose={onClose}>
        <h2 className="text-[13px] font-semibold text-text-primary">Continuity Check</h2>
      </ModalHeader>
      <ModalBody className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">

        {/* Progress / skeleton */}
        {stage !== 'done' && !error && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-[11px] text-text-secondary">
                {stage === 'classifying'
                  ? 'Classifying propositions against prior narrative...'
                  : `Checking ${totalToCheck} high-value propositions for contradictions...`
                }
              </span>
            </div>

            {/* Skeleton cards */}
            <div className="space-y-2">
              {[1, 2, 3, 4].map(i => (
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

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-[10px] text-red-400">{error}</p>
          </div>
        )}

        {/* Results */}
        {stage === 'done' && (
          <div className="space-y-4">
            {/* Summary */}
            <div className={`p-4 rounded-lg border ${violations.length === 0 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
              <div className="flex items-center gap-2 mb-1">
                {violations.length === 0 ? (
                  <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                )}
                <span className={`text-[12px] font-semibold ${violations.length === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {violations.length === 0
                    ? 'No continuity violations detected'
                    : `${violations.length} violation${violations.length !== 1 ? 's' : ''} found`
                  }
                </span>
              </div>
              <p className="text-[10px] text-text-dim ml-6">
                {totalProps} propositions classified, {propsChecked || totalToCheck} high-value checked via LLM
              </p>
            </div>

            {/* Classification overview */}
            {classifications.length > 0 && (
              <div>
                <h3 className="text-[10px] font-semibold text-text-dim uppercase tracking-widest mb-2">
                  Proposition Classifications
                </h3>
                <div className="space-y-1">
                  {classifications.map((c, i) => {
                    const violation = violations.find(v => v.beatIndex === c.beatIndex && v.propIndex === c.propIndex);
                    const beat = plan.beats[c.beatIndex];
                    const prop = beat?.propositions?.[c.propIndex];
                    if (!prop) return null;

                    return (
                      <div
                        key={i}
                        className={`flex items-start gap-2 rounded-md p-2 ${violation ? 'bg-red-500/5 border border-red-500/20' : 'hover:bg-white/3'}`}
                        style={{ borderLeft: `2px solid ${c.color}` }}
                      >
                        <span className="shrink-0 text-[8px] font-medium mt-0.5" style={{ color: c.color }}>
                          {c.label}
                        </span>
                        {violation && (
                          <span className="shrink-0 text-[8px] font-medium text-red-400 mt-0.5">⚠</span>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-text-secondary italic truncate">{prop.content}</p>
                          {violation && (
                            <p className="text-[9px] text-red-400/80 mt-1">{violation.explanation}</p>
                          )}
                          {violation && violation.priorContent.length > 0 && (
                            <p className="text-[8px] text-text-dim/50 mt-0.5">
                              Conflicts with: &ldquo;{violation.priorContent[0].slice(0, 80)}...&rdquo;
                            </p>
                          )}
                        </div>
                        <span className="text-[7px] font-mono text-text-dim/30 shrink-0 mt-0.5">
                          B{c.beatIndex + 1}:P{c.propIndex + 1}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}
