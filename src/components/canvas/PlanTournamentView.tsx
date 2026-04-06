'use client';

import { useState, useMemo } from 'react';
import type { NarrativeState, Scene, PlanTournament, PlanCandidate, Beat } from '@/types/narrative';
import { BEAT_FN_LIST, BEAT_MECHANISM_LIST } from '@/types/narrative';
import { runPlanTournament } from '@/lib/ai/tournament';

type Props = {
  narrative: NarrativeState;
  scene: Scene;
  resolvedKeys: string[];
  candidateCount: number;
  onClose: () => void;
  onSelectPlan: (tournament: PlanTournament, candidateId: string) => void;
};

type ViewMode = 'list' | 'compare';

function BeatFunctionChart({ beats }: { beats: Beat[] }) {
  const distribution = useMemo(() => {
    const counts: Record<string, number> = {};
    BEAT_FN_LIST.forEach(fn => { counts[fn] = 0; });
    beats.forEach(b => { counts[b.fn] = (counts[b.fn] || 0) + 1; });
    const max = Math.max(...Object.values(counts), 1);
    return { counts, max };
  }, [beats]);

  return (
    <div className="space-y-1">
      {BEAT_FN_LIST.map(fn => {
        const count = distribution.counts[fn];
        const pct = (count / distribution.max) * 100;
        return (
          <div key={fn} className="flex items-center gap-2">
            <span className="text-[8px] text-text-dim w-16 uppercase tracking-wide">{fn}</span>
            <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-blue-400/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[8px] text-text-dim/60 font-mono w-6 text-right">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

function MechanismChart({ beats }: { beats: Beat[] }) {
  const distribution = useMemo(() => {
    const counts: Record<string, number> = {};
    BEAT_MECHANISM_LIST.forEach(m => { counts[m] = 0; });
    beats.forEach(b => { counts[b.mechanism] = (counts[b.mechanism] || 0) + 1; });
    return counts;
  }, [beats]);

  const total = beats.length;

  return (
    <div className="space-y-1">
      {BEAT_MECHANISM_LIST.map(mech => {
        const count = distribution[mech];
        const pct = total > 0 ? (count / total) * 100 : 0;
        return (
          <div key={mech} className="flex items-center gap-2">
            <span className="text-[8px] text-text-dim w-20 capitalize">{mech}</span>
            <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-purple-400/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[8px] text-text-dim/60 font-mono w-8 text-right">{pct.toFixed(0)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function scoreColorClass(v: number): string {
  if (v >= 0.9) return 'text-green-400 bg-green-500/10';
  if (v >= 0.8) return 'text-lime-400 bg-lime-500/10';
  if (v >= 0.7) return 'text-yellow-400 bg-yellow-500/10';
  if (v >= 0.6) return 'text-orange-400 bg-orange-500/10';
  return 'text-red-400 bg-red-500/10';
}

function scoreBarClass(v: number): string {
  if (v >= 0.9) return 'bg-green-400';
  if (v >= 0.8) return 'bg-lime-400';
  if (v >= 0.7) return 'text-yellow-400';
  if (v >= 0.6) return 'bg-orange-400';
  return 'bg-red-400';
}

export function PlanTournamentView({ narrative, scene, resolvedKeys, candidateCount, onClose, onSelectPlan }: Props) {
  const [tournament, setTournament] = useState<PlanTournament | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: candidateCount });
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());

  const handleRunTournament = async () => {
    setIsGenerating(true);
    setError(null);
    setProgress({ completed: 0, total: candidateCount });

    try {
      const result = await runPlanTournament(
        narrative,
        scene,
        resolvedKeys,
        candidateCount,
        (completed, total) => {
          setProgress({ completed, total });
        }
      );
      setTournament(result);
      // Auto-select top 3 for comparison
      const topThree = result.candidates.slice(0, Math.min(3, result.candidates.length));
      setSelectedCandidates(new Set(topThree.map(c => c.id)));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Tournament failed';
      setError(errorMsg);
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleCandidateSelection = (id: string) => {
    const newSet = new Set(selectedCandidates);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      if (newSet.size >= 4) return; // Max 4 columns for comparison
      newSet.add(id);
    }
    setSelectedCandidates(newSet);
  };

  const selectedCandidateList = useMemo(() => {
    if (!tournament) return [];
    return tournament.candidates.filter(c => selectedCandidates.has(c.id));
  }, [tournament, selectedCandidates]);

  return (
    <div className="fixed inset-0 z-50 bg-bg-primary flex flex-col">
      {/* Top Bar */}
      <div className="h-12 shrink-0 flex items-center px-4 gap-4 border-b border-border bg-black/20">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          <span className="font-semibold text-sm text-text-primary">Plan Tournament</span>
          <span className="text-[9px] text-text-dim/60 font-mono">({candidateCount} candidates)</span>
        </div>

        {tournament && (
          <>
            <div className="w-px h-4 bg-border" />
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('list')}
                className={`px-2 py-1 text-[10px] rounded transition-colors ${
                  viewMode === 'list' ? 'bg-white/10 text-text-primary' : 'text-text-dim hover:text-text-secondary'
                }`}
              >
                List
              </button>
              <button
                onClick={() => setViewMode('compare')}
                className={`px-2 py-1 text-[10px] rounded transition-colors ${
                  viewMode === 'compare' ? 'bg-white/10 text-text-primary' : 'text-text-dim hover:text-text-secondary'
                }`}
                disabled={selectedCandidates.size < 2}
              >
                Compare ({selectedCandidates.size})
              </button>
            </div>
          </>
        )}

        <div className="flex-1" />

        <button
          onClick={onClose}
          className="px-3 py-1.5 text-[10px] text-text-dim hover:text-text-primary transition-colors"
        >
          Close
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {!tournament && !isGenerating && (
          <div className="h-full flex items-center justify-center">
            <button
              onClick={handleRunTournament}
              className="px-8 py-4 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-lg font-medium hover:bg-blue-500/20 transition-colors flex items-center gap-3"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              <span className="text-base">Run Tournament</span>
            </button>
          </div>
        )}

        {isGenerating && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-4 max-w-md">
              <div className="text-xs text-text-dim uppercase tracking-wider">
                Generating candidates
              </div>
              <div className="text-4xl font-bold text-blue-400 font-mono tabular-nums">
                {progress.completed} / {progress.total}
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300"
                  style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="h-full flex items-center justify-center">
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 max-w-md">
              {error}
            </div>
          </div>
        )}

        {tournament && viewMode === 'list' && (
          <div className="h-full overflow-y-auto p-6">
            <div className="max-w-7xl mx-auto space-y-3">
              {tournament.candidates.map((candidate, index) => {
                const isWinner = candidate.id === tournament.winner;
                const isSelected = selectedCandidates.has(candidate.id);
                const score = candidate.similarityScore;

                return (
                  <div
                    key={candidate.id}
                    className={`border rounded-lg transition-all ${
                      isWinner
                        ? 'bg-blue-500/5 border-blue-500/30'
                        : isSelected
                          ? 'bg-white/[0.04] border-white/20'
                          : 'bg-white/[0.02] border-white/5 hover:border-white/10'
                    }`}
                  >
                    <div className="p-4">
                      {/* Header */}
                      <div className="flex items-start gap-4 mb-4">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleCandidateSelection(candidate.id)}
                            className="w-4 h-4 rounded border-white/20 bg-white/5"
                          />
                          {isWinner && (
                            <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
                          )}
                          <div>
                            <div className="text-[10px] font-medium text-text-dim uppercase tracking-wide">
                              Candidate #{index + 1}
                            </div>
                            <div className={`text-lg font-bold font-mono tabular-nums ${scoreColorClass(score)}`}>
                              {(score * 100).toFixed(1)}%
                            </div>
                          </div>
                        </div>

                        <div className="flex-1" />

                        <button
                          onClick={() => {
                            onSelectPlan(tournament, candidate.id);
                            onClose();
                          }}
                          className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] rounded font-medium hover:bg-blue-500/20 transition-colors uppercase tracking-wider"
                        >
                          Select
                        </button>
                      </div>

                      {/* Stats Row */}
                      <div className="grid grid-cols-3 gap-4 mb-4">
                        <div className="space-y-2">
                          <div className="text-[9px] text-text-dim uppercase tracking-wider font-medium">Beat Functions</div>
                          <BeatFunctionChart beats={candidate.plan.beats} />
                        </div>
                        <div className="space-y-2">
                          <div className="text-[9px] text-text-dim uppercase tracking-wider font-medium">Mechanisms</div>
                          <MechanismChart beats={candidate.plan.beats} />
                        </div>
                        <div className="space-y-2">
                          <div className="text-[9px] text-text-dim uppercase tracking-wider font-medium">Beat Similarity</div>
                          <div className="space-y-1">
                            {candidate.beatScores.map(({ beatIndex, score: beatScore }) => (
                              <div key={beatIndex} className="flex items-center gap-2">
                                <span className="text-[8px] text-text-dim/40 font-mono w-6">#{beatIndex + 1}</span>
                                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full ${scoreBarClass(beatScore)} rounded-full transition-all`}
                                    style={{ width: `${beatScore * 100}%` }}
                                  />
                                </div>
                                <span className="text-[8px] text-text-dim/60 font-mono w-8 text-right tabular-nums">
                                  {(beatScore * 100).toFixed(0)}%
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Beats List */}
                      <div className="space-y-1">
                        {candidate.plan.beats.map((beat, beatIndex) => {
                          const beatScore = candidate.beatScores.find(s => s.beatIndex === beatIndex);
                          return (
                            <div
                              key={beatIndex}
                              className="flex items-start gap-2 text-[11px] leading-relaxed py-1"
                            >
                              <span className="text-text-dim/40 font-mono shrink-0 mt-0.5 text-[9px]">
                                {beatIndex + 1}
                              </span>
                              <div className="flex-1 min-w-0">
                                <span className="text-text-secondary">{beat.what}</span>
                                <span className="ml-2 text-text-dim/50 text-[9px]">
                                  {beat.fn}·{beat.mechanism}
                                </span>
                              </div>
                              {beatScore && (
                                <span className={`font-mono text-[9px] shrink-0 tabular-nums px-1.5 py-0.5 rounded ${scoreColorClass(beatScore.score)}`}>
                                  {(beatScore.score * 100).toFixed(0)}%
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tournament && viewMode === 'compare' && selectedCandidateList.length >= 2 && (
          <div className="h-full overflow-auto p-6">
            <div className="text-xs text-text-dim mb-4 uppercase tracking-wider">
              Comparing {selectedCandidateList.length} candidates side-by-side
            </div>
            {/* TODO: Implement side-by-side comparison with diff highlighting */}
            <div className="text-text-dim/60">Column comparison view coming next...</div>
          </div>
        )}
      </div>
    </div>
  );
}
