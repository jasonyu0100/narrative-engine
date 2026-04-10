'use client';

import React, { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import * as d3 from 'd3';
import type { NarrativeState, CubeCornerKey, ForceSnapshot } from '@/types/narrative';
import { NARRATIVE_CUBE, THREAD_TERMINAL_STATUSES } from '@/types/narrative';
import { computeSlidesData, type SlidesData } from '@/lib/slides-data';
import { detectCubeCorner } from '@/lib/narrative-utils';
import { generateReportAnalysis, type ReportAnalysis } from '@/lib/ai/report';
import { MOMENT_SPARKLINE_WINDOW } from '@/lib/constants';
import { IconClose, IconRefresh } from '@/components/icons';
import { usePropositionClassification } from '@/hooks/usePropositionClassification';
import { ALL_PROFILE_LABELS, BASE_COLORS, classificationLabel } from '@/lib/proposition-classify';
import type { PropositionBaseCategory } from '@/types/narrative';

// ── Constants ────────────────────────────────────────────────────────────────

const FORCE_COLORS: Record<string, string> = {
  drive: '#EF4444', world: '#22C55E', system: '#3B82F6', swing: '#FACC15',
};
const FORCE_LABELS: Record<string, string> = {
  drive: 'Drive', world: 'World', system: 'System', swing: 'Swing',
};
const STATUS_COLORS: Record<string, string> = {
  latent: '#475569', seeded: '#FBBF24', active: '#38BDF8',
  critical: '#F87171', resolved: '#34D399', subverted: '#C084FC', abandoned: '#444444',
};
const CORNER_COLORS: Record<CubeCornerKey, string> = {
  HHH: '#f59e0b', HHL: '#ef4444', HLH: '#a855f7', HLL: '#6366f1',
  LHH: '#22d3ee', LHL: '#22c55e', LLH: '#3b82f6', LLL: '#6b7280',
};
const CORNERS: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];

const gradeColor = (v: number, max = 100) => {
  const pct = v / max;
  if (pct >= 0.9) return '#22C55E';
  if (pct >= 0.8) return '#A3E635';
  if (pct >= 0.7) return '#FACC15';
  if (pct >= 0.6) return '#F97316';
  return '#EF4444';
};

const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
const stdDev = (arr: number[]) => { const m = avg(arr); return Math.sqrt(avg(arr.map((v) => (v - m) ** 2))); };

// ── Prose block ──────────────────────────────────────────────────────────────

function Prose({ text, loading }: { text: string; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2.5 my-5 print:hidden">
        {[100, 92, 78, 100, 65].map((w, i) => (
          <div key={i} className="h-3.5 rounded bg-white/[0.03] animate-pulse" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  if (!text) return null;
  const paragraphs = text.split('\n\n').filter(Boolean);
  return (
    <div className="my-5 space-y-4">
      {paragraphs.map((p, i) => (
        <p key={i} className="text-[13.5px] text-white/55 leading-[1.8] tracking-[0.01em]">{p}</p>
      ))}
    </div>
  );
}

// ── Section wrapper ──────────────────────────────────────────────────────────

let sectionCounter = 0;

function Section({ title, number, children }: { title: string; number: number; children: React.ReactNode }) {
  return (
    <section className="mb-16 scroll-mt-8 report-section">
      <div className="flex items-baseline gap-3 mb-5">
        <span className="text-[11px] font-mono text-white/20 tabular-nums">{String(number).padStart(2, '0')}</span>
        <h2 className="text-[15px] font-semibold text-white/80 uppercase tracking-[0.15em]">{title}</h2>
        <div className="flex-1 border-b border-white/[0.06] ml-2 translate-y-[-3px]" />
      </div>
      {children}
    </section>
  );
}

// ── Figure wrapper ───────────────────────────────────────────────────────────

function Figure({ caption, children }: { caption?: string; children: React.ReactNode }) {
  return (
    <figure className="my-6 report-figure">
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4 overflow-hidden">
        {children}
      </div>
      {caption && (
        <figcaption className="text-[10px] text-white/25 mt-2 italic tracking-wide">{caption}</figcaption>
      )}
    </figure>
  );
}

// ── Stat row ─────────────────────────────────────────────────────────────────

function StatRow({ items }: { items: { label: string; value: string; accent?: string }[] }) {
  return (
    <div className="flex items-stretch gap-px rounded-lg overflow-hidden border border-white/[0.06] my-5">
      {items.map((item, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-center py-3 bg-white/[0.015]">
          <span className={`text-sm font-mono font-semibold ${item.accent ?? 'text-white/70'}`}>{item.value}</span>
          <span className="text-[9px] text-white/25 uppercase tracking-[0.12em] mt-0.5">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Charts ───────────────────────────────────────────────────────────────────

function DeliveryCurveChart({ data }: { data: SlidesData }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;
    const { width } = svgRef.current.getBoundingClientRect();
    const height = 180;
    const margin = { top: 16, right: 20, bottom: 28, left: 36 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;
    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const eng = data.deliveryCurve;
    const x = d3.scaleLinear().domain([0, eng.length - 1]).range([0, w]);
    const maxAbs = Math.max(...eng.map((e) => Math.abs(e.smoothed)), 0.5) * 1.2;
    const y = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([h, 0]);
    const zeroY = y(0);
    g.append('line').attr('x1', 0).attr('y1', zeroY).attr('x2', w).attr('y2', zeroY).attr('stroke', 'white').attr('stroke-opacity', 0.08);
    const posArea = d3.area<typeof eng[0]>().x((d) => x(d.index)).y0(zeroY).y1((d) => Math.min(y(d.smoothed), zeroY)).curve(d3.curveMonotoneX);
    g.append('path').datum(eng).attr('d', posArea).attr('fill', '#F59E0B').attr('fill-opacity', 0.08);
    const negArea = d3.area<typeof eng[0]>().x((d) => x(d.index)).y0(zeroY).y1((d) => Math.max(y(d.smoothed), zeroY)).curve(d3.curveMonotoneX);
    g.append('path').datum(eng).attr('d', negArea).attr('fill', '#93C5FD').attr('fill-opacity', 0.04);
    const trendLine = d3.line<typeof eng[0]>().x((d) => x(d.index)).y((d) => y(d.macroTrend)).curve(d3.curveMonotoneX);
    g.append('path').datum(eng).attr('d', trendLine).attr('fill', 'none').attr('stroke', 'white').attr('stroke-opacity', 0.15).attr('stroke-width', 1).attr('stroke-dasharray', '4,3');
    const line = d3.line<typeof eng[0]>().x((d) => x(d.index)).y((d) => y(d.smoothed)).curve(d3.curveMonotoneX);
    g.append('path').datum(eng).attr('d', line).attr('fill', 'none').attr('stroke', '#F59E0B').attr('stroke-width', 1.5);
    for (const p of eng.filter((e) => e.isPeak)) g.append('path').attr('d', d3.symbol().type(d3.symbolTriangle).size(28)()).attr('transform', `translate(${x(p.index)},${y(p.smoothed) - 6})`).attr('fill', '#FCD34D');
    for (const v of eng.filter((e) => e.isValley)) g.append('path').attr('d', d3.symbol().type(d3.symbolTriangle).size(28)()).attr('transform', `translate(${x(v.index)},${y(v.smoothed) + 6}) rotate(180)`).attr('fill', '#93C5FD').attr('opacity', 0.6);
    const step = Math.max(1, Math.floor(eng.length / Math.min(10, eng.length)));
    for (let i = 0; i < eng.length; i += step) g.append('text').attr('x', x(i)).attr('y', h + 18).attr('text-anchor', 'middle').attr('fill', 'white').attr('fill-opacity', 0.2).attr('font-size', 8).attr('font-family', 'monospace').text(i + 1);
  }, [data]);
  return <svg ref={svgRef} className="w-full" style={{ height: 180 }} />;
}

function ForceDecompositionChart({ data }: { data: SlidesData }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;
    const { width } = svgRef.current.getBoundingClientRect();
    const height = 180;
    const margin = { top: 12, right: 20, bottom: 28, left: 36 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;
    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const n = data.sceneCount;
    const raw = data.rawForces;
    const x = d3.scaleLinear().domain([0, n - 1]).range([0, w]);
    const maxVal = Math.max(...raw.drive, ...raw.world, ...raw.system, 1);
    const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([h, 0]);
    for (const f of [{ data: raw.system, color: '#3B82F6' }, { data: raw.world, color: '#22C55E' }, { data: raw.drive, color: '#EF4444' }]) {
      const area = d3.area<number>().x((_, i) => x(i)).y0(h).y1((d) => y(d)).curve(d3.curveMonotoneX);
      g.append('path').datum(f.data).attr('d', area).attr('fill', f.color).attr('fill-opacity', 0.04);
      const line = d3.line<number>().x((_, i) => x(i)).y((d) => y(d)).curve(d3.curveMonotoneX);
      g.append('path').datum(f.data).attr('d', line).attr('fill', 'none').attr('stroke', f.color).attr('stroke-width', 1.5).attr('stroke-opacity', 0.7);
    }
    const step = Math.max(1, Math.floor(n / Math.min(10, n)));
    for (let i = 0; i < n; i += step) g.append('text').attr('x', x(i)).attr('y', h + 18).attr('text-anchor', 'middle').attr('fill', 'white').attr('fill-opacity', 0.2).attr('font-size', 8).attr('font-family', 'monospace').text(i + 1);
  }, [data]);
  return <svg ref={svgRef} className="w-full" style={{ height: 180 }} />;
}

function SwingChart({ data }: { data: SlidesData }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;
    const { width } = svgRef.current.getBoundingClientRect();
    const height = 140;
    const margin = { top: 12, right: 20, bottom: 28, left: 36 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;
    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const swings = data.swings;
    const x = d3.scaleLinear().domain([0, swings.length - 1]).range([0, w]);
    const maxSwing = Math.max(...swings, 0.5) * 1.1;
    const y = d3.scaleLinear().domain([0, maxSwing]).range([h, 0]);
    const area = d3.area<number>().x((_, i) => x(i)).y0(h).y1((d) => y(d)).curve(d3.curveMonotoneX);
    g.append('path').datum(swings).attr('d', area).attr('fill', '#facc15').attr('fill-opacity', 0.04);
    const line = d3.line<number>().x((_, i) => x(i)).y((d) => y(d)).curve(d3.curveMonotoneX);
    g.append('path').datum(swings).attr('d', line).attr('fill', 'none').attr('stroke', '#facc15').attr('stroke-width', 1.5);
    const windowSize = Math.max(3, Math.floor(swings.length / 10));
    const ma: number[] = [];
    for (let i = 0; i < swings.length; i++) { const start = Math.max(0, i - windowSize + 1); ma.push(swings.slice(start, i + 1).reduce((s, v) => s + v, 0) / (i - start + 1)); }
    g.append('path').datum(ma).attr('d', line).attr('fill', 'none').attr('stroke', '#facc15').attr('stroke-width', 1.5).attr('stroke-opacity', 0.3).attr('stroke-dasharray', '4,3');
  }, [data]);
  return <svg ref={svgRef} className="w-full" style={{ height: 140 }} />;
}

function RadarChart({ data }: { data: SlidesData }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;
    const size = 180;
    const center = size / 2;
    const maxR = size / 2 - 26;
    svg.attr('viewBox', `0 0 ${size} ${size}`);
    const g = svg.append('g').attr('transform', `translate(${center},${center})`);
    const axes = [
      { key: 'drive' as const, label: 'P', angle: -Math.PI / 2 },
      { key: 'world' as const, label: 'W', angle: 0 },
      { key: 'system' as const, label: 'S', angle: Math.PI / 2 },
      { key: 'swing' as const, label: 'S', angle: Math.PI },
    ];
    for (let r = 0.25; r <= 1; r += 0.25) {
      const points = axes.map((a) => [Math.cos(a.angle) * maxR * r, Math.sin(a.angle) * maxR * r]);
      g.append('polygon').attr('points', points.map((p) => p.join(',')).join(' ')).attr('fill', 'none').attr('stroke', 'white').attr('stroke-opacity', 0.06);
    }
    for (const a of axes) {
      g.append('line').attr('x1', 0).attr('y1', 0).attr('x2', Math.cos(a.angle) * maxR).attr('y2', Math.sin(a.angle) * maxR).attr('stroke', 'white').attr('stroke-opacity', 0.08);
      g.append('text').attr('x', Math.cos(a.angle) * (maxR + 14)).attr('y', Math.sin(a.angle) * (maxR + 14)).attr('text-anchor', 'middle').attr('dominant-baseline', 'middle').attr('fill', FORCE_COLORS[a.key]).attr('font-size', 9).attr('font-weight', 600).text(a.label);
    }
    const values = { drive: data.overallGrades.drive / 25, world: data.overallGrades.world / 25, system: data.overallGrades.system / 25, swing: data.overallGrades.swing / 25 };
    const dataPoints = axes.map((a) => [Math.cos(a.angle) * maxR * values[a.key], Math.sin(a.angle) * maxR * values[a.key]]);
    g.append('polygon').attr('points', dataPoints.map((p) => p.join(',')).join(' ')).attr('fill', '#F59E0B').attr('fill-opacity', 0.12).attr('stroke', '#F59E0B').attr('stroke-width', 1.5).attr('stroke-opacity', 0.5);
    for (let i = 0; i < axes.length; i++) g.append('circle').attr('cx', dataPoints[i][0]).attr('cy', dataPoints[i][1]).attr('r', 2.5).attr('fill', FORCE_COLORS[axes[i].key]);
  }, [data]);
  return <svg ref={svgRef} className="w-[180px] h-[180px]" />;
}

function ArcScoreChart({ data }: { data: SlidesData }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current || data.arcGrades.length < 2) return;
    const { width } = svgRef.current.getBoundingClientRect();
    const height = 200;
    const margin = { top: 8, right: 8, bottom: 20, left: 24 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;
    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const scores = data.arcGrades.map((a) => a.grades.overall);
    const x = d3.scaleBand<number>().domain(scores.map((_, i) => i)).range([0, w]).padding(0.2);
    const y = d3.scaleLinear().domain([0, 100]).range([h, 0]);
    // Grid lines
    for (const tick of [25, 50, 75, 100]) {
      g.append('line').attr('x1', 0).attr('y1', y(tick)).attr('x2', w).attr('y2', y(tick)).attr('stroke', 'white').attr('stroke-opacity', 0.04);
      g.append('text').attr('x', -6).attr('y', y(tick) + 3).attr('text-anchor', 'end').attr('fill', 'white').attr('fill-opacity', 0.15).attr('font-size', 8).attr('font-family', 'monospace').text(tick);
    }
    scores.forEach((s, i) => {
      g.append('rect').attr('x', x(i)!).attr('y', y(s)).attr('width', x.bandwidth()).attr('height', h - y(s)).attr('fill', gradeColor(s)).attr('fill-opacity', 0.5).attr('rx', 2);
      g.append('text').attr('x', x(i)! + x.bandwidth() / 2).attr('y', y(s) - 5).attr('text-anchor', 'middle').attr('fill', 'white').attr('fill-opacity', 0.3).attr('font-size', 9).attr('font-family', 'monospace').text(s);
    });
  }, [data]);
  if (data.arcGrades.length < 2) return null;
  return <svg ref={svgRef} className="w-full" style={{ height: 200 }} />;
}

// ── Moment Sparkline ─────────────────────────────────────────────────────

function MomentSparkline({ data, sceneIdx, isPeak }: { data: SlidesData; sceneIdx: number; isPeak: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;
    const { width } = svgRef.current.getBoundingClientRect();
    const height = 48;
    const margin = { top: 4, right: 8, bottom: 4, left: 8 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;
    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const full = data.deliveryCurve;
    // Window: 50 scenes centered on the moment
    const half = Math.floor(MOMENT_SPARKLINE_WINDOW / 2);
    let winStart = Math.max(0, sceneIdx - half);
    let winEnd = Math.min(full.length - 1, sceneIdx + half);
    // Clamp to keep window size consistent
    if (winEnd - winStart < MOMENT_SPARKLINE_WINDOW - 1) {
      if (winStart === 0) winEnd = Math.min(full.length - 1, MOMENT_SPARKLINE_WINDOW - 1);
      else winStart = Math.max(0, winEnd - MOMENT_SPARKLINE_WINDOW + 1);
    }
    const eng = full.slice(winStart, winEnd + 1);

    const x = d3.scaleLinear().domain([winStart, winEnd]).range([0, w]);
    const maxAbs = Math.max(...eng.map((e) => Math.abs(e.smoothed)), 0.5) * 1.2;
    const y = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([h, 0]);
    const zeroY = y(0);

    g.append('line').attr('x1', 0).attr('y1', zeroY).attr('x2', w).attr('y2', zeroY).attr('stroke', 'white').attr('stroke-opacity', 0.04);

    // Windowed curve (dim)
    const line = d3.line<typeof full[0]>().x((d) => x(d.index)).y((d) => y(d.smoothed)).curve(d3.curveMonotoneX);
    g.append('path').datum(eng).attr('d', line).attr('fill', 'none').attr('stroke', 'white').attr('stroke-opacity', 0.1).attr('stroke-width', 1);

    // Highlighted region around the moment
    const pad = Math.max(3, Math.floor(eng.length * 0.12));
    const regionStart = Math.max(winStart, sceneIdx - pad);
    const regionEnd = Math.min(winEnd, sceneIdx + pad);
    const regionData = full.slice(regionStart, regionEnd + 1);
    const color = isPeak ? '#F59E0B' : '#60A5FA';
    const area = d3.area<typeof full[0]>().x((d) => x(d.index)).y0(zeroY).y1((d) => y(d.smoothed)).curve(d3.curveMonotoneX);
    g.append('path').datum(regionData).attr('d', area).attr('fill', color).attr('fill-opacity', 0.06);
    g.append('path').datum(regionData).attr('d', line).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.5).attr('stroke-opacity', 0.5);

    // Current scene marker
    g.append('circle').attr('cx', x(sceneIdx)).attr('cy', y(full[sceneIdx]?.smoothed ?? 0)).attr('r', 3).attr('fill', color).attr('stroke', 'white').attr('stroke-width', 1);

    // Other peaks/valleys within window (dim)
    for (const e of eng.filter((e) => e.isPeak && e.index !== sceneIdx)) g.append('path').attr('d', d3.symbol().type(d3.symbolTriangle).size(12)()).attr('transform', `translate(${x(e.index)},${y(e.smoothed) - 3})`).attr('fill', '#FCD34D').attr('opacity', 0.15);
    for (const e of eng.filter((e) => e.isValley && e.index !== sceneIdx)) g.append('path').attr('d', d3.symbol().type(d3.symbolTriangle).size(12)()).attr('transform', `translate(${x(e.index)},${y(e.smoothed) + 3}) rotate(180)`).attr('fill', '#93C5FD').attr('opacity', 0.15);
  }, [data, sceneIdx, isPeak]);
  return <svg ref={svgRef} className="w-full" style={{ height: 48 }} />;
}

// ── Pacing Profile Graph ─────────────────────────────────────────────────

type TransitionMatrix = Record<CubeCornerKey, Record<CubeCornerKey, number>>;

function buildMatrix(snapshots: ForceSnapshot[]): TransitionMatrix {
  const counts = {} as TransitionMatrix;
  for (const from of CORNERS) { counts[from] = {} as Record<CubeCornerKey, number>; for (const to of CORNERS) counts[from][to] = 0; }
  for (let i = 0; i < snapshots.length - 1; i++) {
    const f = detectCubeCorner(snapshots[i]).key;
    const t = detectCubeCorner(snapshots[i + 1]).key;
    counts[f][t]++;
  }
  return counts;
}

function StateMachineGraph({ data }: { data: SlidesData }) {
  const { matrix, visitCounts, maxCount } = useMemo(() => {
    const m = buildMatrix(data.forceSnapshots);
    const seq = data.forceSnapshots.map((s) => detectCubeCorner(s).key);
    const visits = {} as Record<CubeCornerKey, number>;
    for (const c of CORNERS) visits[c] = 0;
    for (const c of seq) visits[c]++;
    let mc = 0;
    for (const from of CORNERS) for (const to of CORNERS) if (from !== to && m[from][to] > mc) mc = m[from][to];
    return { matrix: m, visitCounts: visits, maxCount: Math.max(mc, 1) };
  }, [data.forceSnapshots]);

  const maxVisits = Math.max(...Object.values(visitCounts), 1);
  const currentMode = data.forceSnapshots.length > 0 ? detectCubeCorner(data.forceSnapshots[data.forceSnapshots.length - 1]).key : null;

  const GW = 520;
  const GH = 440;
  const gcx = GW / 2;
  const gcy = GH / 2;
  const gr = GW * 0.34;
  const baseR = 22;
  const maxExtraR = 10;

  const positions = useMemo(() => {
    const p = {} as Record<CubeCornerKey, { x: number; y: number }>;
    CORNERS.forEach((c, i) => {
      const angle = (i / CORNERS.length) * Math.PI * 2 - Math.PI / 2;
      p[c] = { x: gcx + gr * Math.cos(angle), y: gcy + gr * Math.sin(angle) };
    });
    return p;
  }, []);

  return (
    <svg viewBox={`0 0 ${GW} ${GH}`} className="w-full" style={{ height: 400 }}>
      <defs>
        <marker id="rpt-arrow" viewBox="0 0 10 6" refX="9" refY="3" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 3 L 0 6 z" fill="rgba(52, 211, 153, 0.7)" />
        </marker>
      </defs>

      {/* Edges */}
      {CORNERS.map((from) =>
        CORNERS.filter((to) => to !== from && matrix[from][to] > 0).map((to) => {
          const count = matrix[from][to];
          const p1 = positions[from];
          const p2 = positions[to];
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const nx = -dy / len;
          const ny = dx / len;
          const toR = baseR + (visitCounts[to] / maxVisits) * maxExtraR;
          const fromR = baseR + (visitCounts[from] / maxVisits) * maxExtraR;
          const sx = p1.x + dx * Math.min(1, (fromR + 8) / len) + 5 * nx;
          const sy = p1.y + dy * Math.min(1, (fromR + 8) / len) + 5 * ny;
          const ex = p1.x + dx * Math.max(0, (len - toR - 8) / len) + 5 * nx;
          const ey = p1.y + dy * Math.max(0, (len - toR - 8) / len) + 5 * ny;
          const opacity = 0.08 + 0.7 * (count / maxCount);
          return (
            <line key={`${from}-${to}`}
              x1={sx} y1={sy} x2={ex} y2={ey}
              stroke="rgba(52, 211, 153, 1)" strokeWidth={1 + 3 * (count / maxCount)}
              opacity={opacity} markerEnd="url(#rpt-arrow)"
            />
          );
        }),
      )}

      {/* Nodes */}
      {CORNERS.map((c) => {
        const pos = positions[c];
        const visits = visitCounts[c];
        const r = baseR + (visits / maxVisits) * maxExtraR;
        const hasVisits = visits > 0;
        const isCurrent = currentMode === c;
        return (
          <g key={c} opacity={hasVisits ? 1 : 0.2}>
            {isCurrent && (
              <circle cx={pos.x} cy={pos.y} r={r + 6} fill="none" stroke={CORNER_COLORS[c]} strokeWidth={1.5} opacity={0.3} />
            )}
            <circle cx={pos.x} cy={pos.y} r={r} fill={CORNER_COLORS[c]} opacity={hasVisits ? 0.85 : 0.15} />
            <text x={pos.x} y={pos.y + 1} fill="#fff" fontSize="11" fontWeight="600"
              textAnchor="middle" dominantBaseline="middle" className="select-none"
              opacity={hasVisits ? 0.95 : 0.3}>
              {NARRATIVE_CUBE[c].name}
            </text>
            <text x={pos.x} y={pos.y + r + 14} fill="#9ca3af" fontSize="10" fontFamily="monospace"
              textAnchor="middle" className="select-none">
              {visits > 0 ? `${visits}\u00d7` : '\u2014'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Proposition Arc Trajectory ────────────────────────────────────────────────

const PROP_BASE_ORDER: PropositionBaseCategory[] = ['Anchor', 'Seed', 'Close', 'Texture'];

function ReportArcTrajectory({ data, sceneProfiles }: { data: SlidesData; sceneProfiles: Map<string, Record<PropositionBaseCategory, number>> | null }) {
  if (!sceneProfiles || sceneProfiles.size === 0) return null;

  // Group scenes by arc
  const arcMap = new Map<string, string[]>();
  for (const scene of data.scenes) {
    const arcId = scene.arcId ?? '_ungrouped';
    if (!arcMap.has(arcId)) arcMap.set(arcId, []);
    arcMap.get(arcId)!.push(scene.id);
  }

  if (arcMap.size < 2) return null;

  const perCategory: Record<PropositionBaseCategory, number[]> = { Anchor: [], Seed: [], Close: [], Texture: [] };

  for (const [, sceneIds] of arcMap) {
    let total = 0;
    const counts: Record<PropositionBaseCategory, number> = { Anchor: 0, Seed: 0, Close: 0, Texture: 0 };
    for (const sid of sceneIds) {
      const dist = sceneProfiles.get(sid);
      if (!dist) continue;
      for (const b of PROP_BASE_ORDER) { counts[b] += dist[b]; total += dist[b]; }
    }
    for (const b of PROP_BASE_ORDER) {
      perCategory[b].push(total > 0 ? (counts[b] / total) * 100 : 0);
    }
  }

  return (
    <div className="grid grid-cols-4 gap-3 mb-6">
      {PROP_BASE_ORDER.map((base) => {
        const values = perCategory[base];
        const maxVal = Math.max(...values, 1);
        const trend = values[values.length - 1] - values[0];

        return (
          <div key={base} className="rounded-lg p-3 border border-white/6 bg-white/2">
            <div className="text-[9px] font-medium mb-2 lowercase" style={{ color: BASE_COLORS[base] }}>{base}</div>
            <div className="flex items-end gap-0.5 h-12">
              {values.map((v, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-sm"
                  style={{
                    height: `${Math.max(4, (v / maxVal) * 100)}%`,
                    backgroundColor: BASE_COLORS[base],
                    opacity: 0.35 + (i / values.length) * 0.65,
                  }}
                />
              ))}
            </div>
            <div className="text-[8px] font-mono text-white/25 mt-1.5">
              {trend >= 0 ? '\u2191' : '\u2193'} {Math.abs(trend).toFixed(1)}% across arcs
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Report ──────────────────────────────────────────────────────────────

export function NarrativeReport({
  narrative,
  resolvedKeys,
  onClose,
}: {
  narrative: NarrativeState;
  resolvedKeys: string[];
  onClose: () => void;
}) {
  const data = useMemo(() => computeSlidesData(narrative, resolvedKeys), [narrative, resolvedKeys]);
  const { sceneProfiles, getClassification } = usePropositionClassification();

  // Compute 8-label counts from classification
  const labelCounts = useMemo(() => {
    const lc: Record<string, number> = {};
    for (const p of ALL_PROFILE_LABELS) lc[p.label] = 0;
    if (!sceneProfiles) return lc;
    for (const scene of data.scenes) {
      const plan = scene.planVersions?.[scene.planVersions.length - 1]?.plan;
      if (!plan?.beats) continue;
      for (let bi = 0; bi < plan.beats.length; bi++) {
        const beat = plan.beats[bi];
        if (!beat.propositions) continue;
        for (let pi = 0; pi < beat.propositions.length; pi++) {
          const cls = getClassification(scene.id, bi, pi);
          if (cls) lc[classificationLabel(cls.base, cls.reach)] = (lc[classificationLabel(cls.base, cls.reach)] ?? 0) + 1;
        }
      }
    }
    return lc;
  }, [sceneProfiles, data.scenes, getClassification]);

  const [analysis, setAnalysis] = useState<ReportAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const handlePrint = useCallback(() => { window.print(); }, []);
  const handleGenerate = useCallback(() => {
    setAnalysisError(null);
    setAnalysisLoading(true);
    generateReportAnalysis(narrative, data, resolvedKeys)
      .then((result) => { setAnalysis(result); setAnalysisLoading(false); })
      .catch((err) => { setAnalysisError(err.message); setAnalysisLoading(false); });
  }, [narrative, data, resolvedKeys]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    }
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [onClose]);

  const prose = (key: Exclude<keyof ReportAnalysis, 'segments'>) => (
    <Prose text={(analysis?.[key] as string) ?? ''} loading={analysisLoading} />
  );

  if (data.sceneCount === 0) {
    return createPortal(
      <div className="fixed inset-0 z-100 bg-bg-base flex items-center justify-center report-shell">
        <p className="text-white/30 text-sm">No scenes to analyse.</p>
      </div>,
      document.body,
    );
  }

  const forces = ['drive', 'world', 'system', 'swing'] as const;
  const dominant = (['drive', 'world', 'system'] as const).reduce((a, b) => data.overallGrades[a] > data.overallGrades[b] ? a : b);
  const raw = data.rawForces;
  const n = data.sceneCount;
  const stats = {
    drive: { avg: avg(raw.drive), peak: Math.max(...raw.drive), total: raw.drive.reduce((s, v) => s + v, 0), sd: stdDev(raw.drive) },
    world: { avg: avg(raw.world), peak: Math.max(...raw.world), total: raw.world.reduce((s, v) => s + v, 0), sd: stdDev(raw.world) },
    system: { avg: avg(raw.system), peak: Math.max(...raw.system), total: raw.system.reduce((s, v) => s + v, 0), sd: stdDev(raw.system) },
    swing: { avg: avg(data.swings), peak: Math.max(...data.swings), total: data.swings.reduce((s, v) => s + v, 0), sd: stdDev(data.swings) },
  };
  const avgSwing = avg(data.swings);
  const swingVar = stdDev(data.swings);
  const pacingType = swingVar < avgSwing * 0.5 ? 'Steady' : swingVar > avgSwing * 1.2 ? 'Erratic' : 'Varied';
  const sequence = data.forceSnapshots.map((s) => detectCubeCorner(s).key);
  const visitCounts = {} as Record<CubeCornerKey, number>;
  for (const c of CORNERS) visitCounts[c] = 0;
  for (const c of sequence) visitCounts[c]++;
  let selfLoops = 0;
  for (let i = 1; i < sequence.length; i++) if (sequence[i] === sequence[i - 1]) selfLoops++;
  const selfLoopRate = selfLoops / Math.max(sequence.length - 1, 1);
  const activeThreads = data.threadLifecycles.filter((t) => { const last = t.statuses[t.statuses.length - 1]; return last && !['resolved', 'subverted', 'abandoned'].includes(last.status); }).length;
  const resolvedThreads = data.threadLifecycles.filter((t) => { const last = t.statuses[t.statuses.length - 1]; return last && ['resolved', 'subverted', 'abandoned'].includes(last.status); }).length;

  let sec = 0;

  const reportContent = (
    <div className="fixed inset-0 z-100 bg-[#0d0d0f] flex flex-col report-shell">
      {/* ── Toolbar ── */}
      <div className="report-toolbar flex items-center justify-between h-11 px-5 shrink-0 border-b border-white/[0.06] bg-white/[0.01]">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="w-7 h-7 rounded flex items-center justify-center text-white/25 hover:text-white/50 hover:bg-white/5 transition-all" title="Close (Esc)">
            <IconClose size={16} />
          </button>
          <div className="w-px h-4 bg-white/[0.06]" />
          <span className="text-[11px] text-white/30 tracking-wide">Analysis Report</span>
          {analysisLoading && <span className="text-[10px] text-amber-400/50 flex items-center gap-1.5 ml-2"><span className="w-1 h-1 rounded-full bg-amber-400/80 animate-pulse" />Writing...</span>}
          {analysisError && <span className="text-[10px] text-red-400/60 ml-2">Failed <button onClick={handleGenerate} className="underline ml-1 hover:text-red-300">retry</button></span>}
        </div>
        <div className="flex items-center gap-1.5">
          {!analysis && !analysisLoading && (
            <button onClick={handleGenerate} className="h-7 px-3 rounded text-[11px] font-medium text-amber-400/80 hover:text-amber-300 border border-amber-400/15 hover:border-amber-400/30 bg-amber-400/[0.04] hover:bg-amber-400/[0.08] transition-all flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              Enrich with AI
            </button>
          )}
          {analysis && !analysisLoading && (
            <button onClick={handleGenerate} className="h-7 px-2.5 rounded text-[11px] text-white/25 hover:text-white/40 hover:bg-white/[0.04] transition-all flex items-center gap-1.5">
              <IconRefresh size={12} />
              Regenerate
            </button>
          )}
          <button onClick={handlePrint} className="h-7 px-2.5 rounded text-[11px] text-white/30 hover:text-white/50 hover:bg-white/[0.04] transition-all flex items-center gap-1.5" title="Print / Save as PDF">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
            Print
          </button>
        </div>
      </div>

      {/* ── Document ── */}
      <div className="flex-1 overflow-y-auto report-scroll">
        <div className="max-w-[680px] mx-auto px-6 py-14 report-body">

          {/* ── Cover ── */}
          <header className="mb-20 text-center report-cover">
            <div className="inline-block mb-8">
              <div className="w-12 h-px bg-white/10 mx-auto mb-6" />
              <p className="text-[10px] uppercase tracking-[0.3em] text-white/20 mb-6">Structural Analysis Report</p>
              <h1 className="text-[28px] font-light text-white/90 leading-tight tracking-tight mb-5">{data.title}</h1>
              <p className="text-[15px] text-white/40 italic max-w-lg mx-auto leading-relaxed">
                {'\u201C'}A <span className="text-emerald-400/80 font-medium">{data.density.name}</span>
                {', '}<span className="text-amber-400/80 font-medium">{data.shape.name}</span>
                {' '}<span className="text-cyan-400/80 font-medium">{data.scale.name}</span>
                {' of '}<span className="text-violet-400/80 font-medium">{data.archetype.name}</span>
                {' archetype.'}{'\u201D'}
              </p>
              <div className="w-12 h-px bg-white/10 mx-auto mt-6" />
            </div>

            {/* Headline metrics */}
            <div className="flex items-center justify-center gap-8 mt-8">
              <div className="text-center">
                <div className="text-[42px] font-light font-mono tracking-tight" style={{ color: gradeColor(data.overallGrades.overall) }}>
                  {data.overallGrades.overall}
                </div>
                <div className="text-[9px] uppercase tracking-[0.2em] text-white/20 mt-1">Overall Score</div>
              </div>
              <div className="w-px h-14 bg-white/[0.06]" />
              <div className="flex flex-col gap-1.5 text-left">
                {forces.map((f) => (
                  <div key={f} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: FORCE_COLORS[f], opacity: 0.7 }} />
                    <span className="text-[10px] w-14 text-white/30">{FORCE_LABELS[f]}</span>
                    <div className="w-16 h-1 rounded-full bg-white/[0.04] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(data.overallGrades[f] / 25) * 100}%`, backgroundColor: FORCE_COLORS[f], opacity: 0.5 }} />
                    </div>
                    <span className="text-[10px] font-mono text-white/35 w-6 text-right">{data.overallGrades[f]}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div className="flex items-center justify-center gap-2 mt-8">
              <span className="text-[10px] px-2.5 py-1 rounded border border-white/[0.06] text-cyan-400/40">{data.scale.name}</span>
              <span className="text-[10px] px-2.5 py-1 rounded border border-white/[0.06] text-white/35">{data.shape.name}</span>
              <span className="text-[10px] px-2.5 py-1 rounded border border-white/[0.06] text-white/35">{data.archetype.name}</span>
              <span className="text-[10px] px-2.5 py-1 rounded border border-white/[0.06] text-emerald-400/40">{data.density.name}</span>
            </div>
            <div className="flex items-center justify-center gap-4 mt-4 text-[10px] text-white/20 font-mono">
              <span>{n} scenes</span><span>{data.arcCount} arcs</span><span>{data.characterCount} characters</span><span>{data.threadCount} threads</span>
            </div>
          </header>

          {/* ── 01 Executive Summary ── */}
          <Section title="Executive Summary" number={++sec}>
            {prose('story_intro')}
            <div className="flex items-start gap-6 mt-4">
              <RadarChart data={data} />
              <div className="flex-1 pt-2">
                <div className="space-y-1.5">
                  {forces.map((f) => (
                    <div key={f} className="flex items-center gap-2.5">
                      <span className="text-[10px] w-16 text-white/30">{FORCE_LABELS[f]}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(data.overallGrades[f] / 25) * 100}%`, backgroundColor: FORCE_COLORS[f], opacity: 0.6 }} />
                      </div>
                      <span className="text-[10px] font-mono text-white/40 w-12 text-right">{data.overallGrades[f]}<span className="text-white/15">/25</span></span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {prose('verdict')}
          </Section>

          {/* ── 02 Delivery Curve ── */}
          <Section title="Delivery Curve" number={++sec}>
            <Figure caption={`Narrative delivery across ${n} scenes. Triangles mark peaks and valleys.`}>
              <DeliveryCurveChart data={data} />
            </Figure>
            <StatRow items={[
              { label: 'Peaks', value: String(data.peaks.length), accent: 'text-amber-400/70' },
              { label: 'Valleys', value: String(data.troughs.length), accent: 'text-blue-300/70' },
              { label: 'Shape', value: data.shape.name, accent: 'text-white/60' },
              { label: 'Scale', value: data.scale.name, accent: 'text-cyan-400/70' },
              { label: 'Density', value: `${data.density.name} (${data.density.density}/s)`, accent: 'text-emerald-400/70' },
            ]} />
            {prose('delivery')}
          </Section>

          {/* ── 03 Force Analysis ── */}
          <Section title="Force Analysis" number={++sec}>
            <div className="overflow-x-auto my-5 report-table">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="text-left py-2.5 pr-4 w-24" />
                    {['Avg', '\u03C3', 'Peak', 'Total', 'Grade'].map((h) => (
                      <th key={h} className="text-right py-2.5 px-2.5 text-[9px] uppercase tracking-[0.15em] text-white/20 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {forces.map((f) => {
                    const s = stats[f];
                    return (
                      <tr key={f} className="border-b border-white/[0.03]">
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: FORCE_COLORS[f] }} />
                            <span className="text-[12px] font-medium" style={{ color: FORCE_COLORS[f] + 'CC' }}>{FORCE_LABELS[f]}</span>
                          </div>
                        </td>
                        <td className="text-right py-3 px-2.5 text-[12px] font-mono text-white/50">{s.avg.toFixed(2)}</td>
                        <td className="text-right py-3 px-2.5 text-[12px] font-mono text-white/25">{s.sd.toFixed(2)}</td>
                        <td className="text-right py-3 px-2.5 text-[12px] font-mono text-white/40">{s.peak.toFixed(2)}</td>
                        <td className="text-right py-3 px-2.5 text-[12px] font-mono text-white/40">{s.total.toFixed(1)}</td>
                        <td className="text-right py-3 px-2.5">
                          <span className="text-[13px] font-semibold font-mono" style={{ color: gradeColor(data.overallGrades[f], 25) }}>{data.overallGrades[f]}</span>
                          <span className="text-[10px] text-white/15">/25</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {prose('forces')}
            <Figure caption="Raw force decomposition over time.">
              <ForceDecompositionChart data={data} />
              <div className="flex items-center gap-4 mt-3 px-1">
                {(['Drive', 'World', 'System'] as const).map((l) => (
                  <span key={l} className="flex items-center gap-1.5 text-[9px] text-white/25">
                    <span className="w-3 h-[1.5px] rounded" style={{ backgroundColor: FORCE_COLORS[l.toLowerCase()], opacity: 0.7 }} />
                    {l}
                  </span>
                ))}
              </div>
            </Figure>
            {prose('forces_over_time')}
          </Section>

          {/* ── Proposition Structure ── */}
          {data.propositionCount > 0 && (
            <Section title="Proposition Structure" number={++sec}>
              {/* 4 base category cards */}
              <div className="grid grid-cols-4 gap-3 mb-6">
                {(['Anchor', 'Seed', 'Close', 'Texture'] as const).map(base => {
                  const count = data.propositionTotals[base];
                  const pct = data.propositionCount > 0 ? (count / data.propositionCount) * 100 : 0;
                  return (
                    <div key={base} className="text-center py-3 rounded-lg border border-white/6 bg-white/2">
                      <div className="text-[18px] font-bold font-mono" style={{ color: BASE_COLORS[base] }}>{pct.toFixed(0)}%</div>
                      <div className="text-[9px] font-medium mt-0.5 lowercase" style={{ color: BASE_COLORS[base] }}>{base}</div>
                      <div className="text-[8px] text-white/20 mt-0.5">{count}</div>
                    </div>
                  );
                })}
              </div>

              {/* 8-label distribution bars */}
              {Object.values(labelCounts).some(v => v > 0) && (
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mb-6">
                  {ALL_PROFILE_LABELS.map(({ label, color }) => {
                    const count = labelCounts[label] ?? 0;
                    const maxLabel = Math.max(...Object.values(labelCounts), 1);
                    const barPct = (count / maxLabel) * 100;
                    return (
                      <div key={label} className="flex items-center gap-2">
                        <span className="text-[9px] w-20 text-right font-medium" style={{ color }}>{label}</span>
                        <div className="flex-1 h-2.5 bg-white/3 rounded-sm overflow-hidden">
                          <div className="h-full rounded-sm" style={{ width: `${barPct}%`, backgroundColor: color, opacity: 0.7 }} />
                        </div>
                        <span className="text-[8px] font-mono text-white/20 w-8">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Arc trajectory sparklines */}
              <ReportArcTrajectory data={data} sceneProfiles={sceneProfiles} />

              {prose('propositions')}
            </Section>
          )}

          {/* ── Swing Analysis ── */}
          <Section title="Swing Analysis" number={++sec}>
            <Figure caption="Scene-to-scene volatility in force space. Dashed line shows moving average.">
              <SwingChart data={data} />
            </Figure>
            <StatRow items={[
              { label: 'Avg Swing', value: avgSwing.toFixed(2), accent: 'text-yellow-400/70' },
              { label: 'Peak', value: stats.swing.peak.toFixed(2), accent: 'text-white/50' },
              { label: '\u03C3', value: swingVar.toFixed(2), accent: 'text-white/35' },
              { label: 'Pacing', value: pacingType, accent: 'text-amber-400/70' },
            ]} />
            {prose('swing')}
          </Section>

          {/* ── 05 Narrative Walkthrough ── */}
          <Section title="Narrative Walkthrough" number={++sec}>
            {data.segments.map((seg, segIdx) => {
              // Collect peaks and valleys in this segment
              const segMoments = [
                ...data.peaks.filter((p) => p.sceneIdx >= seg.startIdx && p.sceneIdx <= seg.endIdx)
                  .map((p) => ({ kind: 'peak' as const, sceneIdx: p.sceneIdx, peak: p, trough: null as typeof data.troughs[0] | null })),
                ...data.troughs.filter((t) => t.sceneIdx >= seg.startIdx && t.sceneIdx <= seg.endIdx)
                  .map((t) => ({ kind: 'valley' as const, sceneIdx: t.sceneIdx, peak: null as typeof data.peaks[0] | null, trough: t })),
              ].sort((a, b) => a.sceneIdx - b.sceneIdx);

              return (
                <div key={segIdx} className={segIdx > 0 ? 'mt-10' : 'mt-2'}>
                  {/* Segment header */}
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-[10px] font-mono text-white/20">Scenes {seg.startIdx + 1}&ndash;{seg.endIdx + 1}</span>
                    <span className="text-[9px] px-2 py-0.5 rounded capitalize" style={{ color: FORCE_COLORS[seg.dominantForce] + 'AA', backgroundColor: FORCE_COLORS[seg.dominantForce] + '10' }}>
                      {seg.dominantForce}-led
                    </span>
                    <span className="text-[10px] text-white/15 font-mono">D={seg.avgDelivery.toFixed(2)}</span>
                  </div>

                  {/* Per-segment AI prose */}
                  {analysis?.segments?.[segIdx] && (
                    <p className="text-[13.5px] text-white/55 leading-[1.8] tracking-[0.01em] mb-4">{analysis.segments[segIdx]}</p>
                  )}
                  {analysisLoading && (
                    <div className="space-y-2 mb-4">
                      <div className="h-3.5 rounded bg-white/[0.03] animate-pulse w-full" />
                      <div className="h-3.5 rounded bg-white/[0.03] animate-pulse w-4/5" />
                    </div>
                  )}

                  {/* Peak/valley cards for this segment */}
                  {segMoments.length > 0 && (
                    <div className="space-y-2">
                      {segMoments.map((m) => {
                        const isPeak = m.kind === 'peak';
                        const scene = isPeak ? m.peak!.scene : m.trough!.scene;
                        const povName = data.characterNames[scene.povId] ?? scene.povId;
                        const locName = data.locationNames[scene.locationId] ?? scene.locationId;
                        const cubeCorner = isPeak ? m.peak!.cubeCorner : m.trough!.cubeCorner;
                        const delivery = isPeak ? m.peak!.delivery : m.trough!.delivery;
                        return (
                          <div key={`${m.kind}-${m.sceneIdx}`} className="rounded-lg border border-white/[0.05] bg-white/[0.01] overflow-hidden report-moment">
                            <div className={`flex items-center gap-3 px-4 py-2 ${isPeak ? 'bg-amber-400/[0.03] border-b border-amber-400/[0.06]' : 'bg-blue-400/[0.03] border-b border-blue-400/[0.06]'}`}>
                              <span className={`text-[9px] font-semibold uppercase tracking-[0.15em] ${isPeak ? 'text-amber-400/60' : 'text-blue-300/60'}`}>
                                {isPeak ? 'Peak' : 'Valley'}
                              </span>
                              <span className={`text-[11px] font-mono font-medium ${isPeak ? 'text-amber-400/70' : 'text-blue-300/70'}`}>Scene {m.sceneIdx + 1}</span>
                              <span className="text-[10px] text-white/20">{cubeCorner.name}</span>
                              <div className="flex-1" />
                              <span className="text-[10px] text-white/20">{povName}</span>
                              <span className="text-[10px] text-white/12">at</span>
                              <span className="text-[10px] text-white/20">{locName}</span>
                              <span className={`text-[10px] font-mono ${isPeak ? 'text-amber-400/50' : 'text-blue-300/50'}`}>{delivery.delivery.toFixed(2)}</span>
                            </div>
                            <div className="px-4 pt-1 pb-0">
                              <MomentSparkline data={data} sceneIdx={m.sceneIdx} isPeak={isPeak} />
                            </div>
                            <div className="px-4 pb-3">
                              <p className="text-[12px] text-white/45 leading-relaxed">{scene.summary}</p>
                              {!isPeak && m.trough && (
                                <div className="flex items-center gap-3 mt-2 text-[10px] text-white/20">
                                  <span>Recovery in <span className="font-mono text-white/35">{m.trough.scenesToNextPeak}</span> scenes</span>
                                  {m.trough.recoveryForce && (
                                    <span>via <span className="capitalize" style={{ color: FORCE_COLORS[m.trough.recoveryForce] + '80' }}>{m.trough.recoveryForce}</span></span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </Section>

          {/* ── 06 Cast, Locations & Artefacts ── */}
          <Section title="Cast, Locations & Artefacts" number={++sec}>
            <div className="grid grid-cols-2 gap-10 mt-5">
              <div>
                <h3 className="text-[9px] uppercase tracking-[0.15em] text-white/20 mb-3">Characters</h3>
                <div className="space-y-2.5">
                  {data.topCharacters.slice(0, 8).map((c, i) => {
                    const maxCount = data.topCharacters[0]?.sceneCount ?? 1;
                    return (
                      <div key={c.character.id} className="flex items-center gap-2">
                        <span className="text-[10px] text-white/15 font-mono w-4 text-right">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[11px] text-white/55">{c.character.name}</span>
                            <span className="text-[9px] text-white/20 font-mono">{c.sceneCount}</span>
                          </div>
                          <div className="h-[3px] rounded-full bg-white/[0.03] overflow-hidden">
                            <div className="h-full rounded-full" style={{
                              width: `${(c.sceneCount / maxCount) * 100}%`,
                              backgroundColor: c.character.role === 'anchor' ? '#F59E0B' : c.character.role === 'recurring' ? '#3B82F6' : '#6B7280',
                              opacity: 0.4,
                            }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <h3 className="text-[9px] uppercase tracking-[0.15em] text-white/20 mb-3">Locations</h3>
                <div className="space-y-2.5">
                  {data.topLocations.slice(0, 6).map((l, i) => {
                    const tiedNames = l.location.tiedCharacterIds
                      .map((id) => narrative.characters[id]?.name)
                      .filter(Boolean);
                    return (
                      <div key={l.location.id} className="flex items-center gap-2">
                        <span className="text-[10px] text-white/15 font-mono w-4 text-right">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[11px] text-white/55">{l.location.name}</span>
                            <span className="text-[9px] text-white/20 font-mono">{l.sceneCount}</span>
                          </div>
                          <div className="h-[3px] rounded-full bg-white/[0.03] overflow-hidden">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(l.sceneCount / (data.topLocations[0]?.sceneCount ?? 1)) * 100}%`, opacity: 0.3 }} />
                          </div>
                          {tiedNames.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {tiedNames.map((name) => (
                                <span key={name} className="text-[8px] text-white/25 bg-white/3 rounded px-1 py-px">{name}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            {data.topArtifacts.length > 0 && (() => {
              const maxUsage = data.topArtifacts[0]?.usageCount ?? 1;
              return (
                <div className="mt-6">
                  <h3 className="text-[9px] uppercase tracking-[0.15em] text-white/20 mb-3">Artefacts</h3>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
                    {data.topArtifacts.slice(0, 8).map((a, i) => {
                      const owner = a.artifact.parentId
                        ? (narrative.characters[a.artifact.parentId]?.name ?? narrative.locations[a.artifact.parentId]?.name ?? null)
                        : null;
                      return (
                        <div key={a.artifact.id} className="flex items-center gap-2">
                          <span className="text-[10px] text-white/15 font-mono w-4 text-right">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[11px] text-white/55">{a.artifact.name}</span>
                              <span className="text-[9px] text-white/20 font-mono">{a.usageCount}</span>
                            </div>
                            <div className="h-[3px] rounded-full bg-white/[0.03] overflow-hidden">
                              <div className="h-full rounded-full bg-violet-500" style={{ width: `${maxUsage > 0 ? (a.usageCount / maxUsage) * 100 : 0}%`, opacity: 0.35 }} />
                            </div>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              <span className="text-[8px] text-white/25 bg-white/3 rounded px-1 py-px">{owner ?? 'world'}</span>
                              {a.artifact.significance !== 'minor' && (
                                <span className="text-[8px] text-white/25 bg-white/3 rounded px-1 py-px">{a.artifact.significance}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            {prose('cast')}
            {prose('locations')}
          </Section>

          {/* ── 07 Thread Portfolio ── */}
          {data.threadLifecycles.length > 0 && (
            <Section title="Thread Portfolio" number={++sec}>
              <StatRow items={[
                { label: 'Active', value: String(activeThreads), accent: 'text-green-400/70' },
                { label: 'Resolved', value: String(resolvedThreads), accent: 'text-white/40' },
                { label: 'Total', value: String(data.threadCount), accent: 'text-white/25' },
              ]} />
              {prose('threads')}
              <div className="mt-5 space-y-px rounded-lg overflow-hidden border border-white/[0.05]">
                {data.threadLifecycles.slice(0, 12).map((tl, i) => {
                  const endStatus = tl.statuses[tl.statuses.length - 1]?.status ?? 'latent';
                  const isTerminal = (THREAD_TERMINAL_STATUSES as readonly string[]).includes(endStatus);
                  const firstScene = tl.statuses[0]?.sceneIdx ?? 0;
                  const lastScene = tl.statuses[tl.statuses.length - 1]?.sceneIdx ?? 0;
                  return (
                    <div key={tl.threadId} className={`flex items-center gap-3 px-4 py-2 ${i % 2 === 0 ? 'bg-white/[0.01]' : 'bg-transparent'}`}>
                      <span className={`text-[11px] flex-1 min-w-0 truncate ${isTerminal ? 'text-white/25' : 'text-white/45'}`}>{tl.description}</span>
                      <span className="text-[9px] font-mono text-white/15 shrink-0">{firstScene + 1}&ndash;{lastScene + 1}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded capitalize shrink-0 font-medium" style={{ color: STATUS_COLORS[endStatus] ?? '#475569', opacity: 0.7 }}>{endStatus}</span>
                    </div>
                  );
                })}
              </div>
              {data.threadLifecycles.length > 12 && <p className="text-[10px] text-white/15 mt-2 pl-4">+{data.threadLifecycles.length - 12} additional threads</p>}
            </Section>
          )}

          {/* ── 08 Pacing Profile ── */}
          <Section title="Pacing Profile" number={++sec}>
            <Figure caption="Cube mode transition graph. Node size reflects visit frequency, edge weight reflects transition count.">
              <StateMachineGraph data={data} />
            </Figure>
            <div className="grid grid-cols-4 gap-1.5 mt-5">
              {[...CORNERS].sort((a, b) => visitCounts[b] - visitCounts[a]).map((c) => {
                const count = visitCounts[c];
                const pct = n > 0 ? ((count / n) * 100).toFixed(0) : '0';
                return (
                  <div key={c} className="flex items-center gap-2 px-3 py-2.5 rounded border border-white/[0.04] bg-white/[0.01]">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CORNER_COLORS[c], opacity: count > 0 ? 0.7 : 0.15 }} />
                    <div className="min-w-0">
                      <div className="text-[10px] text-white/45 font-medium truncate">{NARRATIVE_CUBE[c].name}</div>
                      <div className="text-[9px] text-white/15 font-mono">{count > 0 ? `${count}x (${pct}%)` : '\u2014'}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-4 text-[10px] text-white/20">
              <span>Self-loop rate <span className="font-mono text-white/35">{(selfLoopRate * 100).toFixed(0)}%</span></span>
            </div>
            {data.cubeTransitions.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {data.cubeTransitions.slice(0, 8).map((t, i) => (
                  <span key={i} className="text-[9px] px-2 py-1 rounded bg-white/[0.02] border border-white/[0.04] text-white/25 font-mono">
                    <span style={{ color: CORNER_COLORS[t.from] + '99' }}>{NARRATIVE_CUBE[t.from].name}</span>
                    <span className="text-white/10 mx-0.5">{'\u2192'}</span>
                    <span style={{ color: CORNER_COLORS[t.to] + '99' }}>{NARRATIVE_CUBE[t.to].name}</span>
                    <span className="text-white/15 ml-1">{t.count}x</span>
                  </span>
                ))}
              </div>
            )}
            {prose('modes')}
          </Section>

          {/* ── 09 Arc Progression ── */}
          {data.arcGrades.length > 0 && (
            <Section title="Arc Progression" number={++sec}>
              <Figure caption="Overall score by arc.">
                <ArcScoreChart data={data} />
              </Figure>
              <div className="overflow-x-auto report-table">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="text-left py-2 text-[9px] uppercase tracking-[0.15em] text-white/20 font-normal">Arc</th>
                      <th className="text-right py-2 text-[9px] uppercase tracking-[0.15em] text-white/20 font-normal w-12">Sc.</th>
                      {['P', 'W', 'S', 'Sw'].map((h, i) => (
                        <th key={h} className="text-right py-2 text-[9px] font-normal w-10" style={{ color: [FORCE_COLORS.drive, FORCE_COLORS.world, FORCE_COLORS.system, FORCE_COLORS.swing][i] + '66' }}>{h}</th>
                      ))}
                      <th className="text-right py-2 text-[9px] uppercase tracking-[0.15em] text-white/20 font-normal w-14">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.arcGrades.map((arc, i) => (
                      <tr key={arc.arcId} className={`border-b border-white/[0.03] ${i % 2 === 0 ? 'bg-white/[0.01]' : ''}`}>
                        <td className="py-2.5 text-[11px] text-white/40">{arc.arcName}</td>
                        <td className="text-right py-2.5 text-[11px] font-mono text-white/20">{arc.sceneCount}</td>
                        <td className="text-right py-2.5 text-[11px] font-mono text-white/30">{arc.grades.drive}</td>
                        <td className="text-right py-2.5 text-[11px] font-mono text-white/30">{arc.grades.world}</td>
                        <td className="text-right py-2.5 text-[11px] font-mono text-white/30">{arc.grades.system}</td>
                        <td className="text-right py-2.5 text-[11px] font-mono text-white/30">{arc.grades.swing}</td>
                        <td className="text-right py-2.5"><span className="text-[12px] font-semibold font-mono" style={{ color: gradeColor(arc.grades.overall) + 'CC' }}>{arc.grades.overall}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {prose('arcs')}
            </Section>
          )}



          {/* ── Conclusion ── */}
          <Section title="Conclusion & Recommendations" number={++sec}>
            {prose('closing')}
          </Section>

          {/* ── Footer ── */}
          <footer className="text-center pt-12 pb-6">
            <div className="w-8 h-px bg-white/[0.06] mx-auto mb-4" />
            <p className="text-[9px] text-white/15 tracking-[0.15em] uppercase">InkTide Narrative Analysis Engine</p>
          </footer>

        </div>
      </div>
    </div>
  );

  return createPortal(reportContent, document.body);
}
