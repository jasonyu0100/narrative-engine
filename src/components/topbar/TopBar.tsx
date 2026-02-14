'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import type { NarrativeState } from '@/types/narrative';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';
import { computeRawForcetotals, computeBalanceMagnitudes } from '@/lib/narrative-utils';
import { ApiLogsModal } from '@/components/debug/ApiLogsModal';
import { StoryReader } from '@/components/story/StoryReader';


function exportNarrative(narrative: NarrativeState) {
  const json = JSON.stringify(narrative, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${narrative.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TopBar() {
  const router = useRouter();
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [logsOpen, setLogsOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const [scorecardOpen, setScorecardOpen] = useState(false);
  const scorecardRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeArc = narrative
    ? Object.values(narrative.arcs).find((a) =>
        a.sceneIds.includes(
          state.resolvedSceneKeys[state.currentSceneIndex] ?? ''
        )
      )
    : null;

  useEffect(() => {
    if (!selectorOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSelectorOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [selectorOpen]);

  // Close scorecard on outside click
  useEffect(() => {
    if (!scorecardOpen) return;
    function handleClick(e: MouseEvent) {
      if (scorecardRef.current && !scorecardRef.current.contains(e.target as Node)) {
        setScorecardOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [scorecardOpen]);

  // Scorecard data
  const allScenes = useMemo(() => {
    if (!narrative) return [];
    return state.resolvedSceneKeys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => !!e && isScene(e));
  }, [narrative, state.resolvedSceneKeys]);

  const scorecard = useMemo(() => {
    if (allScenes.length === 0 || !narrative) return null;
    const raw = computeRawForcetotals(allScenes);
    const n = raw.payoff.length;
    if (n === 0) return null;

    const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0);
    const avg = (arr: number[]) => sum(arr) / arr.length;
    const max = (arr: number[]) => Math.max(...arr);
    const std = (arr: number[]) => {
      const m = avg(arr);
      return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
    };
    /** Average of top 10% values (at least 1) — rewards multiple peaks, not just one outlier */
    const topAvg = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => b - a);
      const k = Math.max(1, Math.ceil(sorted.length * 0.1));
      return avg(sorted.slice(0, k));
    };

    // Compute balance from raw forces (not z-scored) so absolute force magnitudes
    // differentiate well-crafted narratives from bland AI text
    const rawForces = raw.payoff.map((_, i) => ({
      payoff: raw.payoff[i],
      change: raw.change[i],
      variety: raw.variety[i],
    }));
    const balances = computeBalanceMagnitudes(rawForces);

    const forceStats = (arr: number[]) => ({
      total: sum(arr),
      avg: avg(arr),
      max: max(arr),
      std: std(arr),
    });

    const stats = {
      payoff: forceStats(raw.payoff),
      change: forceStats(raw.change),
      variety: forceStats(raw.variety),
      balance: forceStats(balances),
    };

    // Grade each force 0-25 based on avg using exponential saturation curve
    // 25 * (1 - e^(-avg/midpoint)) — midpoint controls how fast it saturates
    const gradeForce = (avg: number, midpoint: number) =>
      Math.min(25, 25 * (1 - Math.exp(-Math.max(0, avg) / midpoint)));

    const payoffGrade = gradeForce(stats.payoff.avg, 3);   // avg ~3 → ~16, avg ~6 → ~22
    const changeGrade = gradeForce(stats.change.avg, 4);   // avg ~4 → ~16, avg ~8 → ~22
    const varietyGrade = gradeForce(stats.variety.avg, 3);  // avg ~3 → ~16, avg ~6 → ~22
    // Balance uses raw force deltas (not z-scored) with top-peaks weighting —
    // avg of top 10% peaks rewards stories with multiple dramatic moments, not just one outlier
    const balanceEffective = stats.balance.avg * 0.5 + topAvg(balances) * 0.5;
    const balanceGrade = gradeForce(balanceEffective, 8);

    const overallGrade = Math.round(payoffGrade + changeGrade + varietyGrade + balanceGrade);

    const arcCount = Object.keys(narrative.arcs).length;

    // Per-arc scores — map each arc's scenes to force-array indices (same as TimelineStrip)
    const sceneIdToIdx = new Map(allScenes.map((s, i) => [s.id, i]));
    const arcsInOrder = Object.values(narrative.arcs);
    const perArc = arcsInOrder
      .map((arc) => {
        const forceIndices = arc.sceneIds
          .map((sid) => sceneIdToIdx.get(sid))
          .filter((i): i is number => i !== undefined);
        if (forceIndices.length === 0) return null;

        const arcPayoffs = forceIndices.map((i) => raw.payoff[i]);
        const arcChanges = forceIndices.map((i) => raw.change[i]);
        const arcVarieties = forceIndices.map((i) => raw.variety[i]);
        const arcBalanceVals = forceIndices.map((i) => balances[i]);

        const arcPayoffGrade = gradeForce(avg(arcPayoffs), 3);
        const arcChangeGrade = gradeForce(avg(arcChanges), 4);
        const arcVarietyGrade = gradeForce(avg(arcVarieties), 3);
        const arcBalanceEffective = avg(arcBalanceVals) * 0.5 + topAvg(arcBalanceVals) * 0.5;
        const arcBalanceGrade = gradeForce(arcBalanceEffective, 8);

        return {
          name: arc.name,
          scenes: forceIndices.length,
          grades: {
            payoff: Math.round(arcPayoffGrade),
            change: Math.round(arcChangeGrade),
            variety: Math.round(arcVarietyGrade),
            balance: Math.round(arcBalanceGrade),
            overall: Math.round(arcPayoffGrade + arcChangeGrade + arcVarietyGrade + arcBalanceGrade),
          },
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    return {
      title: narrative.title,
      scenes: n,
      arcs: arcCount,
      ...stats,
      grades: {
        payoff: Math.round(payoffGrade),
        change: Math.round(changeGrade),
        variety: Math.round(varietyGrade),
        balance: Math.round(balanceGrade),
        overall: overallGrade,
      },
      perArc,
    };
  }, [allScenes, narrative]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target?.result as string) as NarrativeState;
        if (!imported.id || !imported.scenes || !imported.branches) {
          alert('Invalid narrative file');
          return;
        }
        // Always create a new series with a fresh ID
        const newId = crypto.randomUUID();
        const newNarrative = { ...imported, id: newId };
        dispatch({ type: 'ADD_NARRATIVE', narrative: newNarrative });
        setSelectorOpen(false);
        router.push(`/series/${newId}`);
      } catch {
        alert('Failed to parse narrative file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [dispatch, router]);

  return (
    <div className="flex items-center justify-between h-11 glass-panel border-b border-border px-3">
      {/* Left: home + title + arc breadcrumb */}
      <div className="flex items-center gap-1 text-sm min-w-0">
        {/* Home button */}
        <button
          onClick={() => router.push('/')}
          className="px-2 py-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary"
          title="All series"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" />
          </svg>
        </button>

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setSelectorOpen((o) => !o)}
            className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-bg-elevated transition-colors"
          >
            <span className="text-text-primary truncate max-w-50">
              {narrative ? narrative.title : 'Select Narrative'}
            </span>
            <svg
              className={`w-3 h-3 text-text-dim transition-transform ${selectorOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {selectorOpen && (
            <div
              className="absolute top-full left-0 mt-1.5 w-72 rounded-xl border border-white/10 z-50 overflow-hidden"
              style={{ background: '#1a1a1a', boxShadow: '0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)' }}
            >
              <div className="max-h-80 overflow-y-auto py-1.5">
                {state.narratives.length === 0 ? (
                  <p className="text-xs text-text-dim px-4 py-4 text-center">No narratives yet</p>
                ) : (
                  state.narratives.map((entry) => {
                    const isActive = state.activeNarrativeId === entry.id;
                    const isDeleting = deletingId === entry.id;
                    return (
                      <div key={entry.id}>
                        <div className={`flex items-center mx-1.5 rounded-lg transition-colors ${
                          isActive ? 'bg-white/8' : 'hover:bg-white/5'
                        }`}>
                          <button
                            onClick={() => {
                              setSelectorOpen(false);
                              router.push(`/series/${entry.id}`);
                            }}
                            className="flex-1 text-left px-3 py-2.5 min-w-0"
                          >
                            <div className="text-[13px] text-text-primary truncate leading-snug">{entry.title}</div>
                            <div className="text-[11px] text-text-dim truncate mt-0.5 leading-snug">{entry.description}</div>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingId(isDeleting ? null : entry.id);
                              setDeleteConfirm('');
                            }}
                            className="px-2.5 py-1 mr-1.5 text-text-dim hover:text-payoff text-xs rounded transition-colors shrink-0 hover:bg-white/5"
                            title="Delete narrative"
                          >
                            &times;
                          </button>
                        </div>
                        {isDeleting && (
                          <div className="mx-1.5 px-3 py-2.5 mb-1 rounded-lg" style={{ background: 'rgba(239,68,68,0.06)' }}>
                            <p className="text-[10px] text-text-dim mb-1.5">
                              Type <span className="text-text-secondary font-medium">{entry.title}</span> to confirm
                            </p>
                            <input
                              type="text"
                              value={deleteConfirm}
                              onChange={(e) => setDeleteConfirm(e.target.value)}
                              placeholder={entry.title}
                              className="bg-white/5 border border-white/8 rounded-md px-2.5 py-1.5 text-xs text-text-primary w-full outline-none placeholder:text-text-dim/30 mb-2 focus:border-white/15 transition-colors"
                              autoFocus
                            />
                            <button
                              onClick={() => {
                                if (deleteConfirm === entry.title) {
                                  dispatch({ type: 'DELETE_NARRATIVE', id: entry.id });
                                  setDeletingId(null);
                                  setDeleteConfirm('');
                                  if (isActive) router.push('/');
                                }
                              }}
                              disabled={deleteConfirm !== entry.title}
                              className="w-full text-xs font-medium py-1.5 rounded-md transition-colors bg-payoff/20 text-payoff hover:bg-payoff/30 disabled:opacity-30 disabled:pointer-events-none"
                            >
                              Delete permanently
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="border-t border-white/8 py-1.5">
                <button
                  onClick={() => {
                    dispatch({ type: 'OPEN_WIZARD' });
                    setSelectorOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
                >
                  <span className="w-5 h-5 rounded-md bg-white/8 flex items-center justify-center text-xs">+</span>
                  New Narrative
                </button>
                <button
                  onClick={() => {
                    handleImport();
                  }}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
                >
                  <span className="w-5 h-5 rounded-md bg-white/8 flex items-center justify-center text-[10px]">&uarr;</span>
                  Import JSON
                </button>
                {narrative && (
                  <button
                    onClick={() => {
                      exportNarrative(narrative);
                      setSelectorOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
                  >
                    <span className="w-5 h-5 rounded-md bg-white/8 flex items-center justify-center text-[10px]">&darr;</span>
                    Export JSON
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />

        {activeArc && (
          <>
            <span className="text-text-dim mx-1">&middot;</span>
            <span className="text-text-secondary truncate">{activeArc.name}</span>
          </>
        )}
      </div>

      {/* Right: action buttons */}
      <div className="flex items-center gap-1">
        {process.env.NEXT_PUBLIC_USER_API_KEYS === 'true' && (
          <button
            onClick={() => window.dispatchEvent(new Event('open-api-keys'))}
            className="px-2 py-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary flex items-center gap-1.5"
            title="API Keys"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
            <span className="text-[11px]">Keys</span>
          </button>
        )}
        <button
          onClick={() => window.dispatchEvent(new Event('open-rules-panel'))}
          className="px-2 py-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary flex items-center gap-1.5"
          title="World Rules — narrative commandments"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <span className="text-[11px]">Rules</span>
        </button>
        <div className="relative" ref={scorecardRef}>
          <button
            onClick={() => setScorecardOpen((v) => !v)}
            className={`px-2 py-1 rounded hover:bg-bg-elevated transition-colors flex items-center gap-1.5 ${
              scorecardOpen ? 'text-text-primary bg-bg-elevated' : 'text-text-dim hover:text-text-primary'
            }`}
            title="Force Scorecard — absolute values for cross-series comparison"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="18" rx="2" />
              <path d="M8 7v10M12 7v10M16 7v10" />
            </svg>
            <span className="text-[11px]">Score</span>
          </button>
          {scorecardOpen && scorecard && (
            <div className="absolute top-full right-0 mt-1 z-50 bg-bg-base border border-white/10 rounded-lg shadow-2xl p-5 w-[460px]">
              {/* Series header */}
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-[13px] font-semibold text-text-primary truncate max-w-[280px]">{scorecard.title}</h2>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-[22px] font-bold font-mono leading-none ${
                    scorecard.grades.overall >= 75 ? 'text-green-400' :
                    scorecard.grades.overall >= 50 ? 'text-yellow-400' :
                    scorecard.grades.overall >= 25 ? 'text-orange-400' : 'text-red-400'
                  }`}>{scorecard.grades.overall}</span>
                  <span className="text-[10px] text-text-dim font-mono">/100</span>
                </div>
              </div>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[9px] text-text-dim font-mono">{scorecard.scenes} scenes</span>
                <span className="text-[9px] text-text-dim opacity-30">/</span>
                <span className="text-[9px] text-text-dim font-mono">{scorecard.arcs} arcs</span>
              </div>

              {/* Force table */}
              <div className="grid grid-cols-5 gap-px bg-white/5 rounded overflow-hidden">
                {/* Header row */}
                <div className="bg-bg-base p-2" />
                {['Avg', 'Peak', 'Total', 'Grade'].map((col) => (
                  <div key={col} className="bg-bg-base p-2 text-center">
                    <span className="text-[9px] uppercase tracking-wider text-text-dim font-mono">{col}</span>
                  </div>
                ))}
                {/* Force rows */}
                {([
                  { key: 'payoff' as const, label: 'Payoff', color: '#EF4444' },
                  { key: 'change' as const, label: 'Change', color: '#22C55E' },
                  { key: 'variety' as const, label: 'Variety', color: '#3B82F6' },
                  { key: 'balance' as const, label: 'Swing', color: '#facc15' },
                ]).map((row) => {
                  const s = scorecard[row.key];
                  const grade = scorecard.grades[row.key];
                  return (
                    <React.Fragment key={row.key}>
                      <div className="bg-bg-base p-2 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: row.color }} />
                        <span className="text-[10px] font-medium" style={{ color: row.color }}>{row.label}</span>
                      </div>
                      <div className="bg-bg-base p-2 text-center">
                        <span className="text-[12px] font-mono text-text-primary font-semibold">{s.avg.toFixed(2)}</span>
                      </div>
                      <div className="bg-bg-base p-2 text-center">
                        <span className="text-[12px] font-mono text-text-secondary">{s.max.toFixed(2)}</span>
                      </div>
                      <div className="bg-bg-base p-2 text-center">
                        <span className="text-[12px] font-mono text-text-secondary">{s.total.toFixed(1)}</span>
                      </div>
                      <div className="bg-bg-base p-2 text-center">
                        <span className={`text-[12px] font-mono font-semibold ${
                          grade >= 19 ? 'text-green-400' :
                          grade >= 13 ? 'text-yellow-400' :
                          grade >= 7 ? 'text-orange-400' : 'text-red-400'
                        }`}>{grade}<span className="text-[9px] text-text-dim font-normal">/25</span></span>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Std dev footer */}
              <div className="mt-3 flex items-center gap-4">
                {([
                  { key: 'payoff' as const, label: 'P', color: '#EF4444' },
                  { key: 'change' as const, label: 'C', color: '#22C55E' },
                  { key: 'variety' as const, label: 'V', color: '#3B82F6' },
                  { key: 'balance' as const, label: 'S', color: '#facc15' },
                ]).map((row) => (
                  <div key={row.key} className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono" style={{ color: row.color }}>{row.label}</span>
                    <span className="text-[9px] text-text-dim font-mono">&sigma;{scorecard[row.key].std.toFixed(2)}</span>
                  </div>
                ))}
              </div>

              {/* Per-arc score graph */}
              {scorecard.perArc.length > 1 && (() => {
                const arcs = scorecard.perArc;
                const dense = arcs.length >= 15;
                const W = 420;
                const H = dense ? 80 : 110;
                const PAD = { top: dense ? 8 : 16, right: 12, bottom: dense ? 8 : 28, left: dense ? 8 : 28 };
                const cw = W - PAD.left - PAD.right;
                const ch = H - PAD.top - PAD.bottom;
                const maxScore = 100;
                const xStep = cw / (arcs.length - 1);

                // Score color: red(0) → yellow(50) → green(100)
                const scoreColor = (v: number) => {
                  const t = Math.max(0, Math.min(1, v / maxScore));
                  if (t < 0.5) {
                    const p = t / 0.5;
                    return `rgb(${Math.round(239 + (250 - 239) * p)},${Math.round(68 + (204 - 68) * p)},${Math.round(68 * (1 - p))})`;
                  }
                  const p = (t - 0.5) / 0.5;
                  return `rgb(${Math.round(250 - (250 - 34) * p)},${Math.round(204 + (197 - 204) * p)},${Math.round(34 * p)})`;
                };

                const points = arcs.map((a, i) => ({
                  x: PAD.left + i * xStep,
                  y: PAD.top + ch - (a.grades.overall / maxScore) * ch,
                  score: a.grades.overall,
                  name: a.name,
                }));

                const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

                return (
                  <div className="mt-4 pt-4 border-t border-white/8">
                    <h3 className="text-[9px] uppercase tracking-widest text-text-dim mb-2">Score by Arc</h3>
                    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
                      <defs>
                        {/* Per-segment gradient fills */}
                        {points.slice(0, -1).map((p, i) => {
                          const next = points[i + 1];
                          return (
                            <linearGradient key={i} id={`sc-seg-${i}`} x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor={scoreColor(p.score)} stopOpacity="0.3" />
                              <stop offset="100%" stopColor={scoreColor(next.score)} stopOpacity="0.3" />
                            </linearGradient>
                          );
                        })}
                        {/* Line stroke gradient */}
                        <linearGradient id="sc-line-grad" x1="0" y1="0" x2="1" y2="0">
                          {points.map((p, i) => (
                            <stop key={i} offset={`${(i / (points.length - 1)) * 100}%`} stopColor={scoreColor(p.score)} />
                          ))}
                        </linearGradient>
                      </defs>

                      {/* Grid lines */}
                      {[0, 25, 50, 75, 100].map((v) => {
                        const y = PAD.top + ch - (v / maxScore) * ch;
                        return (
                          <g key={v}>
                            <line x1={PAD.left} y1={y} x2={PAD.left + cw} y2={y} stroke="white" strokeOpacity="0.05" />
                            {!dense && <text x={PAD.left - 4} y={y + 3} textAnchor="end" fill="white" fillOpacity="0.2" fontSize="8" fontFamily="monospace">{v}</text>}
                          </g>
                        );
                      })}

                      {/* Gradient area fills per segment */}
                      {points.slice(0, -1).map((p, i) => {
                        const next = points[i + 1];
                        const baseline = PAD.top + ch;
                        return (
                          <path
                            key={i}
                            d={`M${p.x},${p.y} L${next.x},${next.y} L${next.x},${baseline} L${p.x},${baseline} Z`}
                            fill={`url(#sc-seg-${i})`}
                          />
                        );
                      })}

                      {/* Score line */}
                      <path d={linePath} fill="none" stroke="url(#sc-line-grad)" strokeWidth="2" strokeLinejoin="round" />

                      {/* Dots + score labels */}
                      {points.map((p, i) => (
                        <g key={i}>
                          <circle cx={p.x} cy={p.y} r={dense ? 2 : 3.5} fill={scoreColor(p.score)} />
                          {!dense && <text x={p.x} y={p.y - 8} textAnchor="middle" fill={scoreColor(p.score)} fontSize="9" fontFamily="monospace" fontWeight="600">{p.score}</text>}
                        </g>
                      ))}

                      {/* Arc number labels */}
                      {!dense && points.map((p, i) => (
                        <text key={i} x={p.x} y={H - 4} textAnchor="middle" fill="white" fillOpacity="0.3" fontSize="8" fontFamily="monospace">
                          {i + 1}
                        </text>
                      ))}
                    </svg>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
        <button
          onClick={() => window.dispatchEvent(new Event('open-force-tracker'))}
          className="px-2 py-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary flex items-center gap-1.5"
          title="Force Tracker — narrative analysis"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M2 20h20" />
            <polyline points="4,16 8,8 12,12 16,4 20,10" />
          </svg>
          <span className="text-[11px]">Analysis</span>
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-cube-viewer'))}
          className="px-2 py-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary flex items-center gap-1.5"
          title="Narrative Cube — 3D force trajectory"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <span className="text-[11px]">Cube</span>
        </button>
        <button
          onClick={() => setStoryOpen(true)}
          className="px-2 py-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary flex items-center gap-1.5"
          title="View full story"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          <span className="text-[11px]">Story</span>
        </button>
        <button
          onClick={() => setLogsOpen(true)}
          className="relative px-2 py-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary flex items-center gap-1.5"
          title="API Logs"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span className="text-[11px]">Logs</span>
          {state.apiLogs.some((l) => l.status === 'pending') && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          )}
          {state.apiLogs.some((l) => l.status === 'error') && !state.apiLogs.some((l) => l.status === 'pending') && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-400" />
          )}
        </button>
      </div>
      {logsOpen && <ApiLogsModal onClose={() => setLogsOpen(false)} />}
      {storyOpen && narrative && (
        <StoryReader
          narrative={narrative}
          resolvedKeys={state.resolvedSceneKeys}
          onClose={() => setStoryOpen(false)}
        />
      )}
    </div>
  );
}

