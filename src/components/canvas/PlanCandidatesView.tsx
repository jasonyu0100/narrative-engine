'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { NarrativeState, Scene, PlanCandidates } from '@/types/narrative';
import { runPlanCandidates } from '@/lib/ai/candidates';
import { assetManager } from '@/lib/asset-manager';
import { classificationColor } from '@/lib/proposition-classify';

type Props = {
  narrative: NarrativeState;
  scene: Scene;
  resolvedKeys: string[];
  candidateCount: number;
  onClose: () => void;
  onSelectPlan: (candidates: PlanCandidates, candidateId: string) => void;
};

function scoreColorClass(v: number): string {
  if (v >= 0.9) return 'text-green-400 bg-green-500/10';
  if (v >= 0.8) return 'text-lime-400 bg-lime-500/10';
  if (v >= 0.7) return 'text-yellow-400 bg-yellow-500/10';
  if (v >= 0.6) return 'text-orange-400 bg-orange-500/10';
  return 'text-red-400 bg-red-500/10';
}

export function PlanCandidatesView({ narrative, scene, resolvedKeys, candidateCount, onClose, onSelectPlan }: Props) {
  const [candidates, setCandidates] = useState<PlanCandidates | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: candidateCount });
  const [error, setError] = useState<string | null>(null);
  const [committedCandidate, setCommittedCandidate] = useState<string | null>(null);

  const handleRunCandidates = async () => {
    setIsGenerating(true);
    setError(null);
    setProgress({ completed: 0, total: candidateCount });

    try {
      // Ensure AssetManager is initialized for embedding resolution
      await assetManager.init();

      const result = await runPlanCandidates(
        narrative,
        scene,
        resolvedKeys,
        candidateCount,
        (completed, total) => {
          setProgress({ completed, total });
        }
      );
      setCandidates(result);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Candidates failed';
      setError(errorMsg);
    } finally {
      setIsGenerating(false);
    }
  };


  // Auto-start candidates when component mounts (like MCTS does)
  useEffect(() => {
    handleRunCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCommit = () => {
    if (!candidates || !committedCandidate) return;
    onSelectPlan(candidates, committedCandidate);
    onClose();
  };

  const content = (
    <div className="fixed inset-0 bg-black/95 z-999 flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col p-6">
        <button onClick={onClose} className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none z-10">&times;</button>

        {/* Header */}
        <h2 className="text-sm font-semibold text-text-primary mb-1">Plan Candidates</h2>
        <p className="text-[10px] text-text-dim uppercase tracking-wider mb-3">
          {isGenerating
            ? `Generating candidates… ${progress.completed} / ${progress.total}`
            : candidates
              ? `${candidates.candidates.length} candidates generated`
              : `${candidateCount} candidates`}
        </p>

        {/* Progress bar */}
        {isGenerating && (
          <div className="mb-4">
            <div className="h-2 bg-white/6 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500/60 rounded-full transition-all duration-300"
                style={{ width: `${(progress.completed / progress.total) * 100}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-text-dim font-mono">
                {progress.completed} / {progress.total} candidates
              </span>
              <span className="text-[10px] text-text-dim font-mono">
                {((progress.completed / progress.total) * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 min-h-0 overflow-auto">
        {error && (
          <div className="h-full flex items-center justify-center">
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 max-w-md">
              {error}
            </div>
          </div>
        )}

        {/* Skeleton Loading */}
        {isGenerating && !candidates && !error && (
          <div className="h-full flex gap-0 p-6">
            {Array.from({ length: candidateCount }).map((_, i) => (
              <div key={i} className="flex-1 border-r border-white/5 last:border-r-0 min-w-0 px-4 animate-pulse">
                <div className="space-y-3">
                  <div className="h-8 bg-white/10 rounded w-2/3" />
                  <div className="space-y-2">
                    <div className="h-4 bg-white/10 rounded" />
                    <div className="h-4 bg-white/10 rounded" />
                    <div className="h-4 bg-white/10 rounded w-5/6" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {candidates && (
          <div className="h-full flex gap-0">
            {candidates.candidates.map((candidate, index) => {
              const isWinner = candidate.id === candidates.winner;
              const score = candidate.similarityScore;

              return (
                <div key={candidate.id} className="flex-1 flex flex-col border-r border-white/10 last:border-r-0 overflow-y-auto min-w-0">
                  {/* Column Header */}
                  <div className={`sticky top-0 z-10 p-4 border-b border-white/10 ${isWinner ? 'bg-blue-500/10' : 'bg-black/60'} backdrop-blur-sm`}>
                    <div className="flex items-center gap-2 mb-2">
                      {isWinner && (
                        <svg className="w-3.5 h-3.5 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                      )}
                      <div className="text-[10px] font-medium text-text-dim uppercase tracking-wide">
                        Candidate #{index + 1}
                      </div>
                    </div>
                    <div className="flex items-baseline gap-2 mb-3">
                      <div className={`text-xl font-bold font-mono tabular-nums ${scoreColorClass(score)}`}>
                        {(score * 100).toFixed(1)}%
                      </div>
                      {(candidate.continuityViolations?.length ?? 0) > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-medium">
                          {candidate.continuityViolations!.length} violation{candidate.continuityViolations!.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => setCommittedCandidate(candidate.id)}
                      className={`w-full px-3 py-1.5 border text-[10px] rounded font-medium transition-colors uppercase tracking-wider ${
                        committedCandidate === candidate.id
                          ? 'bg-blue-500/30 border-blue-400/60 text-blue-300'
                          : 'bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-500/20'
                      }`}
                    >
                      {committedCandidate === candidate.id ? 'Selected' : 'Select'}
                    </button>
                  </div>

                  {/* Beats List */}
                  <div className="p-3 space-y-2">
                    {candidate.plan.beats.map((beat, beatIndex) => {
                      const beatScore = candidate.beatScores.find(s => s.beatIndex === beatIndex);
                      return (
                        <div key={beatIndex} className="pb-2 border-b border-white/5 last:border-b-0">
                          <div className="flex items-start gap-2 mb-1">
                            <span className="text-text-dim/40 font-mono shrink-0 text-[9px] mt-0.5">
                              {beatIndex + 1}
                            </span>
                            <div className="flex-1 min-w-0 text-[11px] leading-relaxed text-text-secondary">
                              {beat.what}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 ml-5">
                            <span className="text-[8px] text-text-dim/40 uppercase">{beat.fn}</span>
                            <span className="text-[8px] text-text-dim/30">·</span>
                            <span className="text-[8px] text-text-dim/40 capitalize">{beat.mechanism}</span>
                            {beatScore && (
                              <>
                                <div className="flex-1" />
                                <span className={`font-mono text-[8px] tabular-nums px-1 py-0.5 rounded ${scoreColorClass(beatScore.score)}`}>
                                  {(beatScore.score * 100).toFixed(0)}%
                                </span>
                              </>
                            )}
                          </div>
                          {/* Proposition labels + violations */}
                          {beat.propositions && beat.propositions.length > 0 && (
                            <div className="ml-5 mt-1 space-y-0.5">
                              {beat.propositions.map((prop, pi) => {
                                const key = `${beatIndex}:${pi}`;
                                const label = candidate.propositionLabels?.[key];
                                const violation = candidate.continuityViolations?.find(v => v.beatIndex === beatIndex && v.propIndex === pi);
                                return (
                                  <div
                                    key={pi}
                                    className="flex items-start gap-1.5 text-[9px] text-text-dim/50 rounded-sm pl-1"
                                    style={label ? { borderLeft: `2px solid ${classificationColor(violation ? 'Close' : 'Texture', 'Local')}` } : undefined}
                                  >
                                    {label && (
                                      <span className="shrink-0 text-[7px] font-medium lowercase mt-px" style={{ color: classificationColor('Texture', 'Local') }}>
                                        {label}
                                      </span>
                                    )}
                                    {violation && (
                                      <span className="shrink-0 text-[7px] font-medium text-red-400 mt-px" title={violation.explanation}>
                                        ⚠
                                      </span>
                                    )}
                                    <span className="italic truncate">{prop.content}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </div>

        {/* Commit Button - bottom right, similar to MCTS */}
        {!isGenerating && candidates && committedCandidate && (
          <div className="absolute bottom-6 right-6 z-20">
            <button
              onClick={handleCommit}
              className="px-6 py-2.5 bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 rounded-lg text-sm font-semibold transition-colors shadow-lg border border-blue-500/30"
            >
              Commit Plan
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return typeof window !== 'undefined' ? createPortal(content, document.body) : null;
}
