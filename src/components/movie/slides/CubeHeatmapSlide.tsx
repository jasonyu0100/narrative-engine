'use client';

import React from 'react';
import type { MovieData } from '@/lib/movie-data';
import { NARRATIVE_CUBE, type CubeCornerKey } from '@/types/narrative';

const CORNER_ORDER: CubeCornerKey[] = ['HHH', 'HHL', 'HLH', 'HLL', 'LHH', 'LHL', 'LLH', 'LLL'];

export function CubeHeatmapSlide({ data }: { data: MovieData }) {
  const maxCount = Math.max(...Object.values(data.cubeDistribution), 1);

  return (
    <div className="flex flex-col h-full px-12 py-8">
      <h2 className="text-2xl font-bold text-text-primary mb-2">Narrative Cube</h2>
      <p className="text-sm text-text-secondary mb-6">
        Distribution of scenes across the 8 narrative archetypes. Heat shows frequency.
      </p>

      <div className="flex-1 flex gap-10">
        {/* Heatmap grid */}
        <div className="grid grid-cols-4 gap-3 self-start">
          {CORNER_ORDER.map((key) => {
            const corner = NARRATIVE_CUBE[key];
            const count = data.cubeDistribution[key];
            const intensity = count / maxCount;
            const pct = data.sceneCount > 0 ? Math.round((count / data.sceneCount) * 100) : 0;
            return (
              <div
                key={key}
                className="w-36 h-28 rounded-xl border border-white/10 p-3 flex flex-col justify-between transition-all"
                style={{
                  backgroundColor: `rgba(245, 158, 11, ${intensity * 0.2})`,
                  borderColor: intensity > 0.5 ? 'rgba(245, 158, 11, 0.3)' : undefined,
                }}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-text-dim">{key}</span>
                    <span className="text-lg font-mono font-bold text-text-primary">{count}</span>
                  </div>
                  <span className="text-xs font-semibold text-text-primary">{corner.name}</span>
                </div>
                <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full bg-amber-400/60" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[9px] text-text-dim">{pct}%</span>
              </div>
            );
          })}
        </div>

        {/* Top transitions */}
        <div className="flex-1">
          <h3 className="text-xs uppercase tracking-widest text-text-dim mb-4">Common Transitions</h3>
          <div className="space-y-2">
            {data.cubeTransitions.slice(0, 8).map((t, i) => {
              const fromName = NARRATIVE_CUBE[t.from].name;
              const toName = NARRATIVE_CUBE[t.to].name;
              const barWidth = (t.count / (data.cubeTransitions[0]?.count ?? 1)) * 100;
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-text-secondary w-24 text-right">{fromName}</span>
                  <span className="text-text-dim text-xs">&rarr;</span>
                  <span className="text-xs text-text-primary w-24">{toName}</span>
                  <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full bg-amber-400/40" style={{ width: `${barWidth}%` }} />
                  </div>
                  <span className="text-xs font-mono text-text-dim w-6 text-right">{t.count}</span>
                </div>
              );
            })}
          </div>

          {/* Home corner */}
          {(() => {
            const homeKey = CORNER_ORDER.reduce((a, b) =>
              data.cubeDistribution[a] > data.cubeDistribution[b] ? a : b,
            );
            const home = NARRATIVE_CUBE[homeKey];
            const pct = Math.round((data.cubeDistribution[homeKey] / data.sceneCount) * 100);
            return (
              <div className="mt-6 px-4 py-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.03]">
                <p className="text-xs text-text-dim mb-1">Home Corner</p>
                <p className="text-sm font-semibold text-amber-400">{home.name} ({homeKey})</p>
                <p className="text-xs text-text-dim mt-1">
                  {pct}% of scenes land here. {home.description}
                </p>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
