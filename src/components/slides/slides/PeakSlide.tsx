'use client';

import React from 'react';
import type { SlidesData, PeakInfo } from '@/lib/slides-data';
import { NARRATIVE_CUBE } from '@/types/narrative';

const FORCE_COLORS: Record<string, string> = {
  payoff: '#EF4444',
  change: '#22C55E',
  knowledge: '#3B82F6',
};

export function PeakSlide({ data, peak, rank }: { data: SlidesData; peak: PeakInfo; rank: number }) {
  const forces = ['payoff', 'change', 'knowledge'] as const;
  const maxForce = Math.max(Math.abs(peak.forces.payoff), Math.abs(peak.forces.change), Math.abs(peak.forces.knowledge), 0.5);

  return (
    <div className="flex flex-col h-full px-12 py-8">
      <div className="flex items-center gap-4 mb-2">
        <h2 className="text-2xl font-bold text-amber-400">Peak #{rank}</h2>
        <span className="text-sm text-text-dim font-mono">Scene {peak.sceneIdx + 1}</span>
        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-white/10 bg-white/[0.03]">
          {peak.cubeCorner.name}
        </span>
      </div>
      <p className="text-xs text-text-dim mb-6">{peak.cubeCorner.description}</p>

      <div className="flex-1 grid grid-cols-2 gap-10">
        {/* Left: force decomposition + summary */}
        <div className="flex flex-col gap-6">
          {/* Force bars */}
          <div>
            <h3 className="text-xs uppercase tracking-widest text-text-dim mb-3">Force Decomposition</h3>
            <div className="space-y-3">
              {forces.map((f) => {
                const val = peak.forces[f];
                const pct = Math.abs(val) / maxForce;
                return (
                  <div key={f} className="flex items-center gap-3">
                    <span className="text-xs font-medium w-14 capitalize" style={{ color: FORCE_COLORS[f] }}>{f}</span>
                    <div className="flex-1 h-3 rounded-full bg-white/5 overflow-hidden relative">
                      <div className="absolute left-1/2 top-0 w-px h-full bg-white/10" />
                      {val >= 0 ? (
                        <div
                          className="absolute h-full rounded-full"
                          style={{
                            left: '50%',
                            width: `${pct * 50}%`,
                            backgroundColor: FORCE_COLORS[f],
                            opacity: 0.7,
                          }}
                        />
                      ) : (
                        <div
                          className="absolute h-full rounded-full"
                          style={{
                            right: '50%',
                            width: `${pct * 50}%`,
                            backgroundColor: FORCE_COLORS[f],
                            opacity: 0.7,
                          }}
                        />
                      )}
                    </div>
                    <span className="text-xs font-mono text-text-secondary w-12 text-right">
                      {val >= 0 ? '+' : ''}{val.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          <div className="px-4 py-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.03]">
            <p className="text-sm text-text-secondary leading-relaxed">{peak.scene.summary}</p>
          </div>

          <div className="text-xs text-text-dim">
            Engagement: <span className="text-amber-400 font-mono font-semibold">{peak.engagement.engagement.toFixed(2)}</span>
          </div>
        </div>

        {/* Right: mutations */}
        <div className="flex flex-col gap-6">
          {/* Thread mutations */}
          <div>
            <h3 className="text-xs uppercase tracking-widest text-text-dim mb-3">
              Thread Changes ({peak.threadChanges.length})
            </h3>
            {peak.threadChanges.length === 0 ? (
              <p className="text-xs text-text-dim italic">No thread mutations</p>
            ) : (
              <div className="space-y-2">
                {peak.threadChanges.map((tc, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs px-3 py-1.5 rounded bg-white/[0.03] border border-white/5">
                    <span className="text-text-secondary flex-1">{tc.threadId}</span>
                    <span className="text-text-dim">{tc.from}</span>
                    <span className="text-amber-400">&rarr;</span>
                    <span className="text-text-primary font-medium">{tc.to}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Relationship mutations */}
          <div>
            <h3 className="text-xs uppercase tracking-widest text-text-dim mb-3">
              Relationship Shifts ({peak.relationshipChanges.length})
            </h3>
            {peak.relationshipChanges.length === 0 ? (
              <p className="text-xs text-text-dim italic">No relationship shifts</p>
            ) : (
              <div className="space-y-2">
                {peak.relationshipChanges.slice(0, 5).map((rc, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs px-3 py-1.5 rounded bg-white/[0.03] border border-white/5">
                    <span className="text-text-secondary">{rc.from}</span>
                    <span className="text-text-dim">&harr;</span>
                    <span className="text-text-secondary">{rc.to}</span>
                    <span className="ml-auto font-mono" style={{ color: rc.delta > 0 ? '#22C55E' : '#EF4444' }}>
                      {rc.delta > 0 ? '+' : ''}{rc.delta}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
