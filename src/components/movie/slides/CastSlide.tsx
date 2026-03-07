'use client';

import React from 'react';
import type { MovieData } from '@/lib/movie-data';

export function CastSlide({ data }: { data: MovieData }) {
  const maxCount = data.topCharacters[0]?.sceneCount ?? 1;

  return (
    <div className="flex flex-col h-full px-12 py-8">
      <h2 className="text-2xl font-bold text-text-primary mb-2">Cast & Stage</h2>
      <p className="text-sm text-text-secondary mb-8">
        Top characters by scene participation and most-visited locations.
      </p>

      <div className="flex-1 grid grid-cols-2 gap-10">
        {/* Characters */}
        <div>
          <h3 className="text-xs uppercase tracking-widest text-text-dim mb-4">Characters</h3>
          <div className="space-y-2.5">
            {data.topCharacters.slice(0, 8).map((c, i) => (
              <div key={c.character.id} className="flex items-center gap-3">
                <span className="text-xs text-text-dim font-mono w-5 text-right">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-text-primary">{c.character.name}</span>
                    <span className="text-xs text-text-dim font-mono">{c.sceneCount}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-1000"
                      style={{
                        width: `${(c.sceneCount / maxCount) * 100}%`,
                        backgroundColor: c.character.role === 'anchor' ? '#F59E0B' : c.character.role === 'recurring' ? '#3B82F6' : '#6B7280',
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-4 text-[10px] text-text-dim">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Anchor</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> Recurring</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-500" /> Transient</span>
          </div>
        </div>

        {/* Locations */}
        <div>
          <h3 className="text-xs uppercase tracking-widest text-text-dim mb-4">Locations</h3>
          <div className="space-y-2.5">
            {data.topLocations.slice(0, 6).map((l, i) => (
              <div key={l.location.id} className="flex items-center gap-3">
                <span className="text-xs text-text-dim font-mono w-5 text-right">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-text-primary">{l.location.name}</span>
                    <span className="text-xs text-text-dim font-mono">{l.sceneCount}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500/60 transition-all duration-1000"
                      style={{ width: `${(l.sceneCount / (data.topLocations[0]?.sceneCount ?? 1)) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Thread portfolio */}
          <div className="mt-8">
            <h3 className="text-xs uppercase tracking-widest text-text-dim mb-3">Thread Portfolio</h3>
            {(() => {
              const active = data.threadLifecycles.filter((t) => {
                const last = t.statuses[t.statuses.length - 1];
                return last && !['resolved', 'subverted', 'abandoned'].includes(last.status);
              }).length;
              const terminal = data.threadLifecycles.filter((t) => {
                const last = t.statuses[t.statuses.length - 1];
                return last && ['resolved', 'subverted', 'abandoned'].includes(last.status);
              }).length;
              const total = data.threadCount;
              return (
                <div className="flex items-center gap-6">
                  <div className="flex flex-col items-center">
                    <span className="text-2xl font-mono font-bold text-green-400">{active}</span>
                    <span className="text-[10px] text-text-dim">Active</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-2xl font-mono font-bold text-text-secondary">{terminal}</span>
                    <span className="text-[10px] text-text-dim">Resolved</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-2xl font-mono font-bold text-text-dim">{total}</span>
                    <span className="text-[10px] text-text-dim">Total</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
