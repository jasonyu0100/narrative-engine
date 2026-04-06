'use client';

import { useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { runPlanTournament } from '@/lib/ai/tournament';
import type { NarrativeState, Scene, PlanTournament } from '@/types/narrative';
import { PLAN_TOURNAMENT_CANDIDATES } from '@/lib/constants';

type Props = {
  narrative: NarrativeState;
  scene: Scene;
  resolvedKeys: string[];
  onClose: () => void;
  onSelectPlan: (tournament: PlanTournament, candidateId: string) => void;
};

export function PlanTournamentModal({ narrative, scene, resolvedKeys, onClose, onSelectPlan }: Props) {
  const [tournament, setTournament] = useState<PlanTournament | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: PLAN_TOURNAMENT_CANDIDATES });
  const [error, setError] = useState<string | null>(null);

  const handleRunTournament = async () => {
    setIsGenerating(true);
    setError(null);
    setProgress({ completed: 0, total: PLAN_TOURNAMENT_CANDIDATES });

    try {
      const result = await runPlanTournament(
        narrative,
        scene,
        resolvedKeys,
        PLAN_TOURNAMENT_CANDIDATES,
        (completed, total) => {
          setProgress({ completed, total });
        }
      );
      setTournament(result);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Tournament failed';
      setError(errorMsg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSelectCandidate = (candidateId: string) => {
    if (tournament) {
      onSelectPlan(tournament, candidateId);
      onClose();
    }
  };

  const formatScore = (score: number) => {
    return `${(score * 100).toFixed(1)}%`;
  };

  const scoreColorClass = (v: number) => {
    if (v >= 0.9) return 'text-green-400';
    if (v >= 0.8) return 'text-lime-400';
    if (v >= 0.7) return 'text-yellow-400';
    if (v >= 0.6) return 'text-orange-400';
    return 'text-red-400';
  };

  const scoreBgClass = (v: number) => {
    if (v >= 0.9) return 'bg-green-500/10 border-green-500/20';
    if (v >= 0.8) return 'bg-lime-500/10 border-lime-500/20';
    if (v >= 0.7) return 'bg-yellow-500/10 border-yellow-500/20';
    if (v >= 0.6) return 'bg-orange-500/10 border-orange-500/20';
    return 'bg-red-500/10 border-red-500/20';
  };

  return (
    <Modal onClose={onClose} size="4xl">
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          <span className="font-semibold text-sm text-text-primary">Plan Tournament</span>
        </div>
      </ModalHeader>

      <ModalBody className="space-y-6 px-6 py-5">
        {/* Description */}
        <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg text-xs text-text-secondary leading-relaxed">
          <p>
            Generate {PLAN_TOURNAMENT_CANDIDATES} candidate plans in parallel and rank them by semantic similarity to the scene summary.
            The plan with the highest similarity score wins.
          </p>
        </div>

        {/* Run Tournament Button */}
        {!tournament && !isGenerating && (
          <div className="flex justify-center py-12">
            <button
              onClick={handleRunTournament}
              className="px-8 py-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-lg font-medium hover:bg-blue-500/20 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              Run Tournament
            </button>
          </div>
        )}

        {/* Progress */}
        {isGenerating && (
          <div className="py-8">
            <div className="text-center mb-4">
              <div className="text-xs text-text-dim mb-2 uppercase tracking-wider">
                Generating candidates
              </div>
              <div className="text-3xl font-bold text-blue-400 font-mono tabular-nums">
                {progress.completed} / {progress.total}
              </div>
            </div>
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-linear-to-r from-blue-500 to-blue-400 transition-all duration-300"
                style={{ width: `${(progress.completed / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
            {error}
          </div>
        )}

        {/* Results */}
        {tournament && (
          <div className="space-y-3">
            <div className="text-[10px] font-semibold text-text-dim uppercase tracking-widest">
              Candidates (ranked by similarity)
            </div>
            {tournament.candidates.map((candidate, index) => {
              const isWinner = candidate.id === tournament.winner;
              const score = candidate.similarityScore;
              return (
                <div
                  key={candidate.id}
                  className={`p-4 border rounded-lg transition-all ${
                    isWinner
                      ? 'bg-blue-500/5 border-blue-500/30'
                      : 'bg-white/[0.02] border-white/5 hover:border-white/10'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2.5">
                    <div className="flex items-center gap-2.5">
                      {isWinner && (
                        <svg className="w-3.5 h-3.5 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                      )}
                      <div>
                        <div className="text-[9px] font-medium text-text-dim uppercase tracking-wide">
                          #{index + 1}
                        </div>
                        <div className={`text-base font-bold font-mono tabular-nums ${scoreColorClass(score)}`}>
                          {formatScore(score)}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleSelectCandidate(candidate.id)}
                      className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] rounded font-medium hover:bg-blue-500/20 transition-colors uppercase tracking-wider"
                    >
                      Select
                    </button>
                  </div>

                  {/* Beat List */}
                  <div className="space-y-1">
                    {candidate.plan.beats.map((beat, beatIndex) => {
                      const beatScore = candidate.beatScores.find(s => s.beatIndex === beatIndex);
                      return (
                        <div
                          key={beatIndex}
                          className="flex items-start gap-2 text-[10px] leading-relaxed"
                        >
                          <span className="text-text-dim/40 font-mono shrink-0 mt-0.5">
                            {beatIndex + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="text-text-secondary">{beat.what}</span>
                            <span className="ml-1.5 text-text-dim/50 text-[9px]">
                              {beat.fn}·{beat.mechanism}
                            </span>
                          </div>
                          {beatScore && (
                            <span className={`font-mono text-[9px] shrink-0 tabular-nums ${scoreColorClass(beatScore.score)}`}>
                              {formatScore(beatScore.score)}
                            </span>
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
      </ModalBody>

      <ModalFooter>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded text-sm transition-colors"
        >
          Close
        </button>
      </ModalFooter>
    </Modal>
  );
}
