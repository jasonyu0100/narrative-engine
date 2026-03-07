'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { NarrativeState } from '@/types/narrative';
import { isScene, resolveEntry } from '@/types/narrative';
import { computeMovieData, type MovieData } from '@/lib/movie-data';
import { TitleSlide } from './slides/TitleSlide';
import { ShapeSlide } from './slides/ShapeSlide';
import { CastSlide } from './slides/CastSlide';
import { ForcesOverviewSlide } from './slides/ForcesOverviewSlide';
import { SegmentSlide } from './slides/SegmentSlide';
import { PeakSlide } from './slides/PeakSlide';
import { TroughSlide } from './slides/TroughSlide';
import { ForceDecompositionSlide } from './slides/ForceDecompositionSlide';
import { CubeHeatmapSlide } from './slides/CubeHeatmapSlide';
import { ThreadLifecycleSlide } from './slides/ThreadLifecycleSlide';
import { SwingAnalysisSlide } from './slides/SwingAnalysisSlide';
import { ReportCardSlide } from './slides/ReportCardSlide';
import { ClosingSlide } from './slides/ClosingSlide';

// ── Slide Spec ─────────────────────────────────────────────────────────────────

type SlideSpec =
  | { type: 'title' }
  | { type: 'shape' }
  | { type: 'cast' }
  | { type: 'forces' }
  | { type: 'segment'; index: number }
  | { type: 'peak'; index: number }
  | { type: 'trough'; index: number }
  | { type: 'decomposition' }
  | { type: 'cube' }
  | { type: 'threads' }
  | { type: 'swing' }
  | { type: 'report' }
  | { type: 'closing' };

function buildSlideList(data: MovieData): SlideSpec[] {
  const slides: SlideSpec[] = [];

  slides.push({ type: 'title' });

  if (data.sceneCount >= 6) {
    slides.push({ type: 'shape' });
  }

  slides.push({ type: 'cast' });
  slides.push({ type: 'forces' });

  // Segments (cap at 8)
  for (let i = 0; i < Math.min(data.segments.length, 8); i++) {
    slides.push({ type: 'segment', index: i });
  }

  // Peaks (cap at 5)
  for (let i = 0; i < Math.min(data.peaks.length, 5); i++) {
    slides.push({ type: 'peak', index: i });
  }

  // Troughs (cap at 3)
  for (let i = 0; i < Math.min(data.troughs.length, 3); i++) {
    slides.push({ type: 'trough', index: i });
  }

  slides.push({ type: 'decomposition' });
  slides.push({ type: 'cube' });

  if (data.threadLifecycles.length > 0) {
    slides.push({ type: 'threads' });
  }

  slides.push({ type: 'swing' });
  slides.push({ type: 'report' });
  slides.push({ type: 'closing' });

  return slides;
}

function slideLabel(spec: SlideSpec): string {
  switch (spec.type) {
    case 'title': return 'Title';
    case 'shape': return 'Shape';
    case 'cast': return 'Cast';
    case 'forces': return 'Forces';
    case 'segment': return `Segment ${spec.index + 1}`;
    case 'peak': return `Peak ${spec.index + 1}`;
    case 'trough': return `Valley ${spec.index + 1}`;
    case 'decomposition': return 'Decomposition';
    case 'cube': return 'Cube';
    case 'threads': return 'Threads';
    case 'swing': return 'Swing';
    case 'report': return 'Report Card';
    case 'closing': return 'Closing';
  }
}

// ── Movie Player ───────────────────────────────────────────────────────────────

export function MoviePlayer({
  narrative,
  resolvedKeys,
  onClose,
}: {
  narrative: NarrativeState;
  resolvedKeys: string[];
  onClose: () => void;
}) {
  const movieData = useMemo(
    () => computeMovieData(narrative, resolvedKeys),
    [narrative, resolvedKeys],
  );

  const slides = useMemo(() => buildSlideList(movieData), [movieData]);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [slideDuration, setSlideDuration] = useState(8000);
  const [transitioning, setTransitioning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const totalSlides = slides.length;
  const currentSlide = slides[currentIdx];

  const goTo = useCallback((idx: number) => {
    if (idx < 0 || idx >= totalSlides) return;
    setTransitioning(true);
    setTimeout(() => {
      setCurrentIdx(idx);
      setTransitioning(false);
    }, 200);
  }, [totalSlides]);

  const next = useCallback(() => {
    if (currentIdx < totalSlides - 1) goTo(currentIdx + 1);
    else setIsPlaying(false);
  }, [currentIdx, totalSlides, goTo]);

  const prev = useCallback(() => {
    if (currentIdx > 0) goTo(currentIdx - 1);
  }, [currentIdx, goTo]);

  // Auto-advance
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setTimeout(next, slideDuration);
      return () => clearTimeout(timerRef.current);
    }
  }, [isPlaying, currentIdx, slideDuration, next]);

  // Keyboard
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setIsPlaying((v) => !v); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [next, prev, onClose]);

  if (movieData.sceneCount === 0) {
    return (
      <div className="fixed inset-0 z-[100] bg-bg-base flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-dim mb-4">No scenes to analyse yet.</p>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/10 text-text-primary text-sm hover:bg-white/15">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="fixed inset-0 z-[100] bg-bg-base flex flex-col outline-none" tabIndex={0} autoFocus>
      {/* Top bar */}
      <div className="flex items-center justify-between h-10 px-4 border-b border-white/8 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text-primary transition-colors text-sm"
            title="Close (Esc)"
          >
            &times;
          </button>
          <span className="text-xs text-text-dim font-mono">
            {currentIdx + 1} / {totalSlides}
          </span>
          <span className="text-xs text-text-secondary">
            {slideLabel(currentSlide)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Speed control */}
          <select
            value={slideDuration}
            onChange={(e) => setSlideDuration(Number(e.target.value))}
            className="bg-transparent border border-white/10 rounded px-2 py-0.5 text-[10px] text-text-dim outline-none"
          >
            <option value={5000}>5s</option>
            <option value={8000}>8s</option>
            <option value={12000}>12s</option>
            <option value={20000}>20s</option>
          </select>
          {/* Play/pause */}
          <button
            onClick={() => setIsPlaying((v) => !v)}
            className="px-2 py-0.5 rounded text-xs text-text-dim hover:text-text-primary border border-white/10 hover:border-white/20 transition-colors"
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
        </div>
      </div>

      {/* Slide content with side navigation arrows */}
      <div className="flex-1 flex items-stretch overflow-hidden relative">
        {/* Left arrow */}
        <button
          onClick={prev}
          disabled={currentIdx === 0}
          className="w-12 shrink-0 flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-white/3 disabled:opacity-0 disabled:pointer-events-none transition-all z-10"
          title="Previous (Left Arrow)"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Slide area — scrollable */}
        <div className={`flex-1 overflow-y-auto transition-opacity duration-200 ${transitioning ? 'opacity-0' : 'opacity-100'}`}>
          {renderSlide(currentSlide, movieData)}
        </div>

        {/* Right arrow */}
        <button
          onClick={next}
          disabled={currentIdx === totalSlides - 1}
          className="w-12 shrink-0 flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-white/3 disabled:opacity-0 disabled:pointer-events-none transition-all z-10"
          title="Next (Right Arrow)"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Bottom progress bar */}
      <div className="h-12 px-4 border-t border-white/8 flex items-center gap-2 shrink-0">
        <button onClick={prev} disabled={currentIdx === 0}
          className="text-text-dim hover:text-text-primary disabled:opacity-20 transition-colors text-sm px-2">
          &larr;
        </button>

        {/* Progress dots */}
        <div className="flex-1 flex items-center gap-1 overflow-x-auto py-1">
          {slides.map((s, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`shrink-0 rounded-full transition-all ${
                i === currentIdx
                  ? 'w-6 h-2 bg-amber-400'
                  : i < currentIdx
                    ? 'w-2 h-2 bg-white/30 hover:bg-white/50'
                    : 'w-2 h-2 bg-white/10 hover:bg-white/20'
              }`}
              title={slideLabel(s)}
            />
          ))}
        </div>

        <button onClick={next} disabled={currentIdx === totalSlides - 1}
          className="text-text-dim hover:text-text-primary disabled:opacity-20 transition-colors text-sm px-2">
          &rarr;
        </button>
      </div>

      {/* Auto-advance progress indicator */}
      {isPlaying && (
        <div className="absolute bottom-12 left-0 right-0 h-0.5 bg-transparent">
          <div
            className="h-full bg-amber-400/60"
            style={{
              animation: `slideProgress ${slideDuration}ms linear`,
            }}
          />
          <style>{`
            @keyframes slideProgress {
              from { width: 0%; }
              to { width: 100%; }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}

function renderSlide(spec: SlideSpec, data: MovieData): React.ReactNode {
  switch (spec.type) {
    case 'title':
      return <TitleSlide data={data} />;
    case 'shape':
      return <ShapeSlide data={data} />;
    case 'cast':
      return <CastSlide data={data} />;
    case 'forces':
      return <ForcesOverviewSlide data={data} />;
    case 'segment':
      return <SegmentSlide data={data} segment={data.segments[spec.index]} />;
    case 'peak':
      return <PeakSlide data={data} peak={data.peaks[spec.index]} rank={spec.index + 1} />;
    case 'trough':
      return <TroughSlide data={data} trough={data.troughs[spec.index]} rank={spec.index + 1} />;
    case 'decomposition':
      return <ForceDecompositionSlide data={data} />;
    case 'cube':
      return <CubeHeatmapSlide data={data} />;
    case 'threads':
      return <ThreadLifecycleSlide data={data} />;
    case 'swing':
      return <SwingAnalysisSlide data={data} />;
    case 'report':
      return <ReportCardSlide data={data} />;
    case 'closing':
      return <ClosingSlide data={data} />;
  }
}
