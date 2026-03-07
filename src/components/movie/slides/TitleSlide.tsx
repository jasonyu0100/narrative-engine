'use client';

import React from 'react';
import type { MovieData } from '@/lib/movie-data';

export function TitleSlide({ data }: { data: MovieData }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-12 text-center">
      {/* Cover image */}
      {data.coverImageUrl && (
        <div className="w-32 h-32 rounded-2xl overflow-hidden mb-8 border border-white/10 shadow-2xl">
          <img src={data.coverImageUrl} alt="" className="w-full h-full object-cover" />
        </div>
      )}

      {/* Title */}
      <h1 className="text-5xl font-bold text-text-primary mb-4 leading-tight max-w-3xl">
        {data.title}
      </h1>

      {data.description && (
        <p className="text-lg text-text-secondary max-w-2xl mb-10 leading-relaxed">
          {data.description}
        </p>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-8">
        {[
          { label: 'Scenes', value: data.sceneCount },
          { label: 'Arcs', value: data.arcCount },
          { label: 'Characters', value: data.characterCount },
          { label: 'Locations', value: data.locationCount },
          { label: 'Threads', value: data.threadCount },
        ].map((stat) => (
          <div key={stat.label} className="flex flex-col items-center">
            <span className="text-3xl font-mono font-bold text-text-primary">{stat.value}</span>
            <span className="text-xs text-text-dim uppercase tracking-widest mt-1">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* Shape badge */}
      <div className="mt-10 flex items-center gap-3 px-5 py-3 rounded-xl border border-white/10 bg-white/[0.03]">
        <svg width="56" height="28" viewBox="0 0 56 28" className="shrink-0">
          <polyline
            points={data.shape.curve
              .map(([x, y]) => `${x * 56},${(1 - y) * 28}`)
              .join(' ')}
            fill="none"
            stroke="#F59E0B"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="text-left">
          <span className="text-sm font-semibold text-amber-400">{data.shape.name}</span>
          <p className="text-xs text-text-dim mt-0.5">{data.shape.description}</p>
        </div>
      </div>
    </div>
  );
}
