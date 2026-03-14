'use client';

import React from 'react';
import type { SlidesData, TroughInfo } from '@/lib/slides-data';

const FORCE_COLORS: Record<string, string> = {
  payoff: '#EF4444',
  change: '#22C55E',
  knowledge: '#3B82F6',
};

export function TroughSlide({ data, trough, rank }: { data: SlidesData; trough: TroughInfo; rank: number }) {
  const forces = ['payoff', 'change', 'knowledge'] as const;
  const maxForce = Math.max(...forces.map((f) => Math.abs(trough.forces[f])), 0.5);

  return (
    <div className="flex flex-col h-full px-12 py-8">
      <div className="flex items-center gap-4 mb-2">
        <h2 className="text-2xl font-bold text-blue-300">Valley #{rank}</h2>
        <span className="text-sm text-text-dim font-mono">Scene {trough.sceneIdx + 1}</span>
        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-white/10 bg-white/[0.03]">
          {trough.cubeCorner.name}
        </span>
      </div>
      <p className="text-xs text-text-dim mb-6">{trough.cubeCorner.description}</p>

      <div className="flex-1 grid grid-cols-2 gap-10">
        <div className="flex flex-col gap-6">
          {/* Force bars */}
          <div>
            <h3 className="text-xs uppercase tracking-widest text-text-dim mb-3">Why Engagement Dropped</h3>
            <div className="space-y-3">
              {forces.map((f) => {
                const val = trough.forces[f];
                const pct = Math.abs(val) / maxForce;
                return (
                  <div key={f} className="flex items-center gap-3">
                    <span className="text-xs font-medium w-14 capitalize" style={{ color: FORCE_COLORS[f] }}>{f}</span>
                    <div className="flex-1 h-3 rounded-full bg-white/5 overflow-hidden relative">
                      <div className="absolute left-1/2 top-0 w-px h-full bg-white/10" />
                      {val >= 0 ? (
                        <div className="absolute h-full rounded-full" style={{ left: '50%', width: `${pct * 50}%`, backgroundColor: FORCE_COLORS[f], opacity: 0.7 }} />
                      ) : (
                        <div className="absolute h-full rounded-full" style={{ right: '50%', width: `${pct * 50}%`, backgroundColor: FORCE_COLORS[f], opacity: 0.7 }} />
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
          <div className="px-4 py-3 rounded-lg border border-blue-400/20 bg-blue-400/[0.03]">
            <p className="text-sm text-text-secondary leading-relaxed">{trough.scene.summary}</p>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          {/* Recovery mechanics */}
          <div className="px-4 py-4 rounded-lg border border-white/8 bg-white/[0.02]">
            <h3 className="text-xs uppercase tracking-widest text-text-dim mb-3">Recovery</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-dim">Scenes to next peak</span>
                <span className="text-sm font-mono font-semibold text-text-primary">{trough.scenesToNextPeak}</span>
              </div>
              {trough.recoveryForce && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-dim">Recovery driver</span>
                  <span className="text-sm font-medium capitalize" style={{ color: FORCE_COLORS[trough.recoveryForce] }}>
                    {trough.recoveryForce}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-dim">Engagement at trough</span>
                <span className="text-sm font-mono text-blue-300">{trough.engagement.engagement.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-dim">Tension level</span>
                <span className="text-sm font-mono text-text-secondary">{trough.engagement.tension.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Narrative purpose */}
          <div className="px-4 py-3 rounded-lg border border-white/5 bg-white/[0.02]">
            <p className="text-xs text-text-dim mb-1">Narrative Purpose</p>
            <p className="text-sm text-text-secondary leading-relaxed">
              {trough.cubeCorner.key === 'LLL'
                ? 'Recovery beat — breathing room before the next escalation. Seeds may be planted for future threads.'
                : trough.cubeCorner.key === 'LLH'
                  ? 'Transition beat — the story moves to unfamiliar territory, setting up new possibilities.'
                  : trough.cubeCorner.key === 'LHL'
                    ? 'Internal development — characters grow quietly without thread advancement.'
                    : 'A moment of reduced intensity that lets the reader recalibrate before the next surge.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
