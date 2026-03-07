'use client';

import React from 'react';
import type { MovieData } from '@/lib/movie-data';

const gradeColor = (v: number, max: number) => {
  const pct = v / max;
  if (pct >= 0.9) return '#22C55E';
  if (pct >= 0.8) return '#A3E635';
  if (pct >= 0.7) return '#FACC15';
  if (pct >= 0.6) return '#F97316';
  return '#EF4444';
};

export function ReportCardSlide({ data }: { data: MovieData }) {
  const forces = [
    { key: 'payoff' as const, label: 'Payoff', color: '#EF4444' },
    { key: 'change' as const, label: 'Change', color: '#22C55E' },
    { key: 'variety' as const, label: 'Variety', color: '#3B82F6' },
    { key: 'swing' as const, label: 'Swing', color: '#FACC15' },
    { key: 'streak' as const, label: 'Streak', color: '#A78BFA' },
  ];

  // Determine strengths and weaknesses
  const forceGrades = forces.map((f) => ({ ...f, grade: data.overallGrades[f.key] }));
  const sorted = [...forceGrades].sort((a, b) => b.grade - a.grade);
  const strengths = sorted.slice(0, 2);
  const weaknesses = sorted.slice(-2).filter((f) => f.grade < 16);

  return (
    <div className="flex flex-col h-full px-12 py-8">
      <h2 className="text-2xl font-bold text-text-primary mb-6">Report Card</h2>

      <div className="flex-1 grid grid-cols-2 gap-10">
        {/* Left: grades */}
        <div>
          {/* Overall score */}
          <div className="flex items-center gap-4 mb-8">
            <span
              className="text-6xl font-bold font-mono"
              style={{ color: gradeColor(data.overallGrades.overall, 100) }}
            >
              {data.overallGrades.overall}
            </span>
            <div>
              <span className="text-lg text-text-dim">/100</span>
              <p className="text-xs text-text-dim mt-1">Overall Score</p>
            </div>
          </div>

          {/* Force grades */}
          <div className="space-y-3">
            {forces.map((f) => {
              const grade = data.overallGrades[f.key];
              return (
                <div key={f.key} className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: f.color }} />
                  <span className="text-sm w-16" style={{ color: f.color }}>{f.label}</span>
                  <div className="flex-1 h-3 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(grade / 20) * 100}%`,
                        backgroundColor: gradeColor(grade, 20),
                        opacity: 0.7,
                      }}
                    />
                  </div>
                  <span className="text-sm font-mono font-semibold w-10 text-right" style={{ color: gradeColor(grade, 20) }}>
                    {grade}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Arc grades */}
          {data.arcGrades.length > 1 && (
            <div className="mt-6">
              <h3 className="text-xs uppercase tracking-widest text-text-dim mb-3">Arc Scores</h3>
              <div className="flex flex-wrap gap-2">
                {data.arcGrades.map((ag) => (
                  <div
                    key={ag.arcId}
                    className="px-2.5 py-1.5 rounded-lg border border-white/8 text-center"
                    style={{ backgroundColor: gradeColor(ag.grades.overall, 100) + '15' }}
                  >
                    <span className="text-xs font-mono font-semibold" style={{ color: gradeColor(ag.grades.overall, 100) }}>
                      {ag.grades.overall}
                    </span>
                    <p className="text-[9px] text-text-dim mt-0.5">{ag.arcName}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: prose scores + analysis */}
        <div className="flex flex-col gap-6">
          {/* Prose quality */}
          {data.avgProseScore && (
            <div>
              <h3 className="text-xs uppercase tracking-widest text-text-dim mb-3">Prose Quality (Avg)</h3>
              <div className="space-y-2">
                {[
                  { key: 'voice', label: 'Voice' },
                  { key: 'pacing', label: 'Pacing' },
                  { key: 'dialogue', label: 'Dialogue' },
                  { key: 'sensory', label: 'Sensory' },
                  { key: 'mutation_coverage', label: 'Coverage' },
                ].map((dim) => {
                  const val = data.avgProseScore![dim.key as keyof typeof data.avgProseScore] as number;
                  return (
                    <div key={dim.key} className="flex items-center gap-3">
                      <span className="text-xs text-text-secondary w-16">{dim.label}</span>
                      <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-violet-400/50" style={{ width: `${(val / 20) * 100}%` }} />
                      </div>
                      <span className="text-xs font-mono text-text-primary w-8 text-right">{val.toFixed(1)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Strengths */}
          <div>
            <h3 className="text-xs uppercase tracking-widest text-text-dim mb-2">Strengths</h3>
            <div className="space-y-1.5">
              {strengths.map((s) => (
                <div key={s.key} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-400/[0.05] border border-green-400/10">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-xs text-text-primary capitalize">{s.label}</span>
                  <span className="text-xs font-mono ml-auto" style={{ color: gradeColor(s.grade, 20) }}>{s.grade}/20</span>
                </div>
              ))}
            </div>
          </div>

          {/* Weaknesses */}
          {weaknesses.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-widest text-text-dim mb-2">Areas for Improvement</h3>
              <div className="space-y-1.5">
                {weaknesses.map((w) => (
                  <div key={w.key} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-400/[0.05] border border-red-400/10">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: w.color }} />
                    <span className="text-xs text-text-primary capitalize">{w.label}</span>
                    <span className="text-xs font-mono ml-auto" style={{ color: gradeColor(w.grade, 20) }}>{w.grade}/20</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
