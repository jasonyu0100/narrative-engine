'use client';

import React from 'react';
import type { MovieData } from '@/lib/movie-data';

const STATUS_COLORS: Record<string, string> = {
  dormant: '#6B7280',
  active: '#3B82F6',
  escalating: '#F59E0B',
  critical: '#EF4444',
  resolved: '#22C55E',
  subverted: '#A855F7',
  abandoned: '#6B7280',
};

export function ThreadLifecycleSlide({ data }: { data: MovieData }) {
  const threads = data.threadLifecycles.slice(0, 12);
  const totalScenes = data.sceneCount;

  return (
    <div className="flex flex-col h-full px-12 py-8">
      <h2 className="text-2xl font-bold text-text-primary mb-2">Thread Lifecycle</h2>
      <p className="text-sm text-text-secondary mb-6">
        How narrative threads evolve through the story. Each row shows a thread&apos;s status across scenes.
      </p>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-3">
          {threads.map((thread) => {
            // Build status segments
            const segments: { start: number; end: number; status: string }[] = [];
            let currentStatus = '';
            let segStart = 0;

            for (const s of thread.statuses) {
              if (s.status !== currentStatus) {
                if (currentStatus) {
                  segments.push({ start: segStart, end: s.sceneIdx - 1, status: currentStatus });
                }
                currentStatus = s.status;
                segStart = s.sceneIdx;
              }
            }
            if (currentStatus) {
              segments.push({ start: segStart, end: totalScenes - 1, status: currentStatus });
            }

            const lastStatus = thread.statuses[thread.statuses.length - 1]?.status ?? 'dormant';

            return (
              <div key={thread.threadId} className="flex items-center gap-3">
                <div className="w-48 shrink-0 text-right">
                  <p className="text-xs text-text-secondary">
                    {thread.description}
                  </p>
                </div>
                {/* Gantt bar */}
                <div className="flex-1 h-5 rounded bg-white/[0.03] relative overflow-hidden">
                  {segments.map((seg, i) => {
                    const left = (seg.start / totalScenes) * 100;
                    const width = ((seg.end - seg.start + 1) / totalScenes) * 100;
                    return (
                      <div
                        key={i}
                        className="absolute top-0 h-full rounded-sm"
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(width, 0.5)}%`,
                          backgroundColor: STATUS_COLORS[seg.status] ?? '#6B7280',
                          opacity: 0.6,
                        }}
                        title={`${seg.status} (${seg.start + 1}–${seg.end + 1})`}
                      />
                    );
                  })}
                </div>
                <span
                  className="text-[10px] font-mono w-16 shrink-0 capitalize"
                  style={{ color: STATUS_COLORS[lastStatus] ?? '#6B7280' }}
                >
                  {lastStatus}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 pt-4 border-t border-white/8">
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <span key={status} className="flex items-center gap-1.5 text-[10px] text-text-dim">
            <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: color, opacity: 0.6 }} />
            <span className="capitalize">{status}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
