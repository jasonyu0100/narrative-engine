'use client';

import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import type { SlidesData } from '@/lib/slides-data';
import { MOMENT_SPARKLINE_WINDOW } from '@/lib/constants';

const FORCE_COLORS: Record<string, string> = {
  drive: '#EF4444',
  world: '#22C55E',
  system: '#3B82F6',
};

function DeliveryCurve({ data, sceneIdx, isPeak }: { data: SlidesData; sceneIdx: number; isPeak: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (!svgRef.current) return;

    const { width } = svgRef.current.getBoundingClientRect();
    const height = 64;
    const margin = { top: 6, right: 12, bottom: 6, left: 12 };
    const w = width - margin.left - margin.right;
    const h = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const full = data.deliveryCurve;

    // Window: MOMENT_SPARKLINE_WINDOW scenes centered on the moment
    const half = Math.floor(MOMENT_SPARKLINE_WINDOW / 2);
    let winStart = Math.max(0, sceneIdx - half);
    let winEnd = Math.min(full.length - 1, sceneIdx + half);
    if (winEnd - winStart < MOMENT_SPARKLINE_WINDOW - 1) {
      if (winStart === 0) winEnd = Math.min(full.length - 1, MOMENT_SPARKLINE_WINDOW - 1);
      else winStart = Math.max(0, winEnd - MOMENT_SPARKLINE_WINDOW + 1);
    }
    const eng = full.slice(winStart, winEnd + 1);

    const x = d3.scaleLinear().domain([winStart, winEnd]).range([0, w]);
    const maxAbs = Math.max(...eng.map((e) => Math.abs(e.smoothed)), 0.5) * 1.2;
    const y = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([h, 0]);
    const zeroY = y(0);

    // Zero line
    g.append('line').attr('x1', 0).attr('y1', zeroY).attr('x2', w).attr('y2', zeroY)
      .attr('stroke', 'white').attr('stroke-opacity', 0.06);

    // Windowed curve (dim)
    const line = d3.line<typeof full[0]>()
      .x((d) => x(d.index)).y((d) => y(d.smoothed)).curve(d3.curveMonotoneX);
    g.append('path').datum(eng).attr('d', line)
      .attr('fill', 'none').attr('stroke', 'white').attr('stroke-opacity', 0.12).attr('stroke-width', 1);

    // Highlight area around current scene
    const pad = Math.max(3, Math.floor(eng.length * 0.12));
    const regionStart = Math.max(winStart, sceneIdx - pad);
    const regionEnd = Math.min(winEnd, sceneIdx + pad);
    const regionData = full.slice(regionStart, regionEnd + 1);

    const color = isPeak ? '#F59E0B' : '#60A5FA';
    const area = d3.area<typeof full[0]>()
      .x((d) => x(d.index)).y0(zeroY).y1((d) => y(d.smoothed)).curve(d3.curveMonotoneX);
    g.append('path').datum(regionData).attr('d', area)
      .attr('fill', color).attr('fill-opacity', 0.08);
    g.append('path').datum(regionData).attr('d', line)
      .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.5).attr('stroke-opacity', 0.6);

    // Current scene marker
    const cx = x(sceneIdx);
    const cy = y(full[sceneIdx]?.smoothed ?? 0);
    g.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 4)
      .attr('fill', color).attr('stroke', 'white').attr('stroke-width', 1.5);

    // Peak/valley markers within window (dim)
    for (const e of eng.filter((e) => e.isPeak && e.index !== sceneIdx)) {
      g.append('path').attr('d', d3.symbol().type(d3.symbolTriangle).size(16)())
        .attr('transform', `translate(${x(e.index)},${y(e.smoothed) - 4})`).attr('fill', '#FCD34D').attr('opacity', 0.25);
    }
    for (const e of eng.filter((e) => e.isValley && e.index !== sceneIdx)) {
      g.append('path').attr('d', d3.symbol().type(d3.symbolTriangle).size(16)())
        .attr('transform', `translate(${x(e.index)},${y(e.smoothed) + 4}) rotate(180)`).attr('fill', '#93C5FD').attr('opacity', 0.25);
    }
  }, [data, sceneIdx, isPeak]);

  return <svg ref={svgRef} className="w-full" style={{ height: 64 }} />;
}

export function KeyMomentsSlide({ data, sceneIdx, kind }: { data: SlidesData; sceneIdx: number; kind: 'peak' | 'valley' }) {
  const isPeak = kind === 'peak';

  const peakInfo = isPeak ? data.peaks.find((p) => p.sceneIdx === sceneIdx) : null;
  const troughInfo = !isPeak ? data.troughs.find((t) => t.sceneIdx === sceneIdx) : null;

  const scene = data.scenes[sceneIdx];
  if (!scene) return null;

  const forces = peakInfo?.forces ?? troughInfo?.forces ?? { drive: 0, world: 0, system: 0 };
  const delivery = peakInfo?.delivery ?? troughInfo?.delivery;
  const cubeCorner = peakInfo?.cubeCorner ?? troughInfo?.cubeCorner;
  const threadChanges = peakInfo?.threadChanges ?? scene.threadMutations?.map((tm) => ({ threadId: tm.threadId, from: tm.from, to: tm.to })) ?? [];
  const relationshipChanges = peakInfo?.relationshipChanges ?? scene.relationshipMutations?.map((rm) => ({ from: rm.from, to: rm.to, type: rm.type, delta: rm.valenceDelta })) ?? [];

  const maxForce = Math.max(Math.abs(forces.drive), Math.abs(forces.world), Math.abs(forces.system), 0.5);
  const povName = data.characterNames[scene.povId] ?? scene.povId;
  const locationName = data.locationNames[scene.locationId] ?? scene.locationId;
  const participants = scene.participantIds
    .filter((id) => id !== scene.povId)
    .map((id) => data.characterNames[id] ?? id);

  const knowledgeGains = (scene.continuityMutations ?? []).flatMap((km) =>
    (km.addedNodes ?? []).map((node) => ({ entityId: km.entityId, content: node.content }))
  );

  const accentText = isPeak ? 'text-amber-400' : 'text-blue-300';

  return (
    <div className="flex flex-col h-full justify-center px-14 py-8 max-w-5xl mx-auto w-full">
      {/* Header row */}
      <div className="flex items-baseline gap-3 mb-1">
        <h2 className={`text-2xl font-bold ${accentText}`}>
          {isPeak ? 'Peak' : 'Valley'}
        </h2>
        <span className="text-xs text-text-dim font-mono">Scene {sceneIdx + 1}</span>
        {cubeCorner && (
          <span className="text-[10px] px-2 py-0.5 rounded border border-white/8 text-text-dim">{cubeCorner.name}</span>
        )}
        <div className="flex-1" />
        {delivery && (
          <span className="text-xs font-mono text-text-dim">
            Delivery <span className={`font-bold ${accentText}`}>{delivery.delivery.toFixed(2)}</span>
          </span>
        )}
      </div>

      {/* Delivery curve sparkline */}
      <div className="mb-4">
        <DeliveryCurve data={data} sceneIdx={sceneIdx} isPeak={isPeak} />
      </div>

      {/* Summary — full width, prominent */}
      <div className={`px-4 py-3 rounded-lg border mb-6 ${isPeak ? 'border-amber-400/12 bg-amber-400/3' : 'border-blue-400/12 bg-blue-400/3'}`}>
        <p className="text-[12.5px] text-text-secondary leading-relaxed">{scene.summary}</p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-10 min-h-0">
        {/* Left: Scene context */}
        <div className="space-y-5">
          {/* POV + participants */}
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-7 h-7 rounded-full bg-white/8 flex items-center justify-center text-[11px] font-bold text-text-primary">
                {povName.charAt(0)}
              </div>
              <div>
                <div className="text-[13px] text-text-primary font-medium">{povName}</div>
                <div className="text-[10px] text-emerald-400/60">{locationName}</div>
              </div>
            </div>
            {participants.length > 0 && (
              <div className="flex flex-wrap gap-1 ml-9">
                {participants.slice(0, 6).map((name) => (
                  <span key={name} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-dim">{name}</span>
                ))}
                {participants.length > 6 && (
                  <span className="text-[10px] text-text-dim">+{participants.length - 6}</span>
                )}
              </div>
            )}
          </div>

          {/* Forces */}
          <div>
            <div className="text-[9px] uppercase tracking-widest text-text-dim mb-2">Forces</div>
            <div className="space-y-1.5">
              {(['drive', 'world', 'system'] as const).map((f) => {
                const val = forces[f];
                const pct = Math.abs(val) / maxForce;
                return (
                  <div key={f} className="flex items-center gap-2">
                    <span className="text-[10px] w-14 capitalize" style={{ color: FORCE_COLORS[f] }}>{f}</span>
                    <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden relative">
                      <div className="absolute left-1/2 top-0 w-px h-full bg-white/8" />
                      <div
                        className="absolute h-full rounded-full"
                        style={{
                          ...(val >= 0 ? { left: '50%' } : { right: '50%' }),
                          width: `${pct * 50}%`,
                          backgroundColor: FORCE_COLORS[f],
                          opacity: 0.65,
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-text-dim w-10 text-right">
                      {val >= 0 ? '+' : ''}{val.toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
            {delivery && (
              <div className="flex items-center gap-4 mt-2 text-[10px] text-text-dim">
                <span>Tension <span className="font-mono text-text-secondary">{delivery.tension.toFixed(2)}</span></span>
              </div>
            )}
          </div>

          {/* Valley recovery */}
          {troughInfo && (
            <div className="flex items-center gap-4 text-[10px] px-3 py-2 rounded-lg bg-white/3 border border-white/6">
              <span className="text-text-dim">Next peak in <span className="font-mono text-text-secondary">{troughInfo.scenesToNextPeak}</span> scenes</span>
              {troughInfo.recoveryForce && (
                <>
                  <span className="text-white/10">|</span>
                  <span className="text-text-dim">Driver: <span className="font-medium capitalize" style={{ color: FORCE_COLORS[troughInfo.recoveryForce] }}>{troughInfo.recoveryForce}</span></span>
                </>
              )}
            </div>
          )}

          {/* Events */}
          {scene.events.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-widest text-text-dim mb-1.5">Events</div>
              <div className="flex flex-wrap gap-1.5">
                {scene.events.map((ev, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-secondary">{ev}</span>
                ))}
              </div>
            </div>
          )}

          {/* Knowledge gains */}
          {knowledgeGains.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-widest text-text-dim mb-1.5">Knowledge Gained</div>
              <div className="space-y-1">
                {knowledgeGains.slice(0, 4).map((kg, i) => (
                  <div key={i} className="text-[10px] flex gap-2">
                    <span className="text-text-primary font-medium shrink-0">{data.characterNames[kg.entityId] ?? kg.entityId}</span>
                    <span className="text-text-dim truncate">{kg.content}</span>
                  </div>
                ))}
                {knowledgeGains.length > 4 && (
                  <span className="text-[9px] text-text-dim">+{knowledgeGains.length - 4} more</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Mutations */}
        <div className="space-y-5">
          {/* Thread mutations */}
          {threadChanges.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-widest text-text-dim mb-2">
                Thread Mutations <span className="text-text-dim/50">({threadChanges.length})</span>
              </div>
              <div className="space-y-1">
                {threadChanges.slice(0, 7).map((tc, i) => {
                  const desc = data.threadDescriptions[tc.threadId];
                  const label = desc ? (desc.length > 55 ? desc.slice(0, 55) + '\u2026' : desc) : tc.threadId;
                  return (
                    <div key={i} className="flex items-center gap-2 text-[10px] px-3 py-1.5 rounded bg-white/3 border border-white/5">
                      <span className="text-text-secondary flex-1 truncate" title={desc}>{label}</span>
                      <span className="text-text-dim shrink-0 font-mono text-[9px]">{tc.from}</span>
                      <span className={`shrink-0 ${accentText} text-[9px]`}>&rarr;</span>
                      <span className="text-text-primary font-medium shrink-0 font-mono text-[9px]">{tc.to}</span>
                    </div>
                  );
                })}
                {threadChanges.length > 7 && (
                  <span className="text-[9px] text-text-dim pl-3">+{threadChanges.length - 7} more</span>
                )}
              </div>
            </div>
          )}

          {/* Relationship mutations */}
          {relationshipChanges.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-widest text-text-dim mb-2">
                Relationship Shifts <span className="text-text-dim/50">({relationshipChanges.length})</span>
              </div>
              <div className="space-y-1">
                {relationshipChanges.slice(0, 5).map((rc, i) => {
                  const fromName = data.characterNames[rc.from] ?? rc.from;
                  const toName = data.characterNames[rc.to] ?? rc.to;
                  return (
                    <div key={i} className="flex items-center gap-2 text-[10px] px-3 py-1.5 rounded bg-white/3 border border-white/5">
                      <span className="text-text-secondary">{fromName}</span>
                      <span className="text-white/15">&harr;</span>
                      <span className="text-text-secondary">{toName}</span>
                      <span className="text-text-dim truncate ml-1 text-[9px]">{rc.type}</span>
                      <span className="ml-auto font-mono shrink-0" style={{ color: rc.delta > 0 ? '#22C55E' : '#EF4444' }}>
                        {rc.delta > 0 ? '+' : ''}{rc.delta.toFixed(1)}
                      </span>
                    </div>
                  );
                })}
                {relationshipChanges.length > 5 && (
                  <span className="text-[9px] text-text-dim pl-3">+{relationshipChanges.length - 5} more</span>
                )}
              </div>
            </div>
          )}

          {threadChanges.length === 0 && relationshipChanges.length === 0 && (
            <div className="flex items-center justify-center h-32">
              <p className="text-[11px] text-text-dim italic">No mutations in this scene</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
