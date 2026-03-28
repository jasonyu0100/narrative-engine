'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { NarrativeState } from '@/types/narrative';
import { computeSlidesData, type SlidesData } from '@/lib/slides-data';
import { TitleSlide } from './TitleSlide';
import { ShapeSlide } from './ShapeSlide';
import { CastSlide } from './CastSlide';
import { ForcesOverviewSlide } from './ForcesOverviewSlide';
import { KeyMomentsSlide } from './KeyMomentsSlide';
import { ForceDecompositionSlide } from './ForceDecompositionSlide';
import { StateMachineSlide } from './StateMachineSlide';
import { ThreadLifecycleSlide } from './ThreadLifecycleSlide';
import { SwingAnalysisSlide } from './SwingAnalysisSlide';
import { ReportCardSlide } from './ReportCardSlide';
import { ClosingSlide } from './ClosingSlide';

// ── Slide Spec ─────────────────────────────────────────────────────────────────

type SlideSpec =
  | { type: 'title' }
  | { type: 'shape' }
  | { type: 'cast' }
  | { type: 'forces' }
  | { type: 'moment'; sceneIdx: number; kind: 'peak' | 'valley' }
  | { type: 'decomposition' }
  | { type: 'state-machine' }
  | { type: 'threads' }
  | { type: 'swing' }
  | { type: 'report' }
  | { type: 'closing' };

function buildSlideList(data: SlidesData): SlideSpec[] {
  const slides: SlideSpec[] = [];

  slides.push({ type: 'title' });

  if (data.sceneCount >= 6) {
    slides.push({ type: 'shape' });
  }

  slides.push({ type: 'cast' });
  slides.push({ type: 'forces' });

  // Key moments — peaks and valleys in chronological order
  const allMoments: { sceneIdx: number; kind: 'peak' | 'valley' }[] = [
    ...data.peaks.map((p) => ({ sceneIdx: p.sceneIdx, kind: 'peak' as const })),
    ...data.troughs.map((t) => ({ sceneIdx: t.sceneIdx, kind: 'valley' as const })),
  ].sort((a, b) => a.sceneIdx - b.sceneIdx);

  for (const m of allMoments) {
    slides.push({ type: 'moment', sceneIdx: m.sceneIdx, kind: m.kind });
  }

  slides.push({ type: 'decomposition' });
  slides.push({ type: 'swing' });
  slides.push({ type: 'state-machine' });

  if (data.threadLifecycles.length > 0) {
    slides.push({ type: 'threads' });
  }

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
    case 'moment': return `${spec.kind === 'peak' ? 'Peak' : 'Valley'} · Scene ${spec.sceneIdx + 1}`;
    case 'decomposition': return 'Decomposition';
    case 'state-machine': return 'State Machine';
    case 'threads': return 'Threads';
    case 'swing': return 'Swing';
    case 'report': return 'Report Card';
    case 'closing': return 'Closing';
  }
}

// ── Slides Player ─────────────────────────────────────────────────────────────

export function SlidesPlayer({
  narrative,
  resolvedKeys,
  onClose,
}: {
  narrative: NarrativeState;
  resolvedKeys: string[];
  onClose: () => void;
}) {
  const slidesData = useMemo(
    () => computeSlidesData(narrative, resolvedKeys),
    [narrative, resolvedKeys],
  );

  const slides = useMemo(() => buildSlideList(slidesData), [slidesData]);

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

  // Keyboard — use capture phase to intercept before other handlers
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); prev(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); e.stopPropagation(); setIsPlaying((v) => !v); }
    }
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [next, prev, onClose]);

  // Force focus on mount
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  if (slidesData.sceneCount === 0) {
    return (
      <div className="fixed inset-0 z-100 bg-bg-base flex items-center justify-center">
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
    <div ref={containerRef} className="fixed inset-0 z-100 bg-bg-base flex flex-col outline-none" tabIndex={0}>
      {/* Aurora background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/3 -left-1/4 w-2/3 h-2/3 rounded-full bg-red-500/[0.04] blur-[120px] animate-[aurora-drift_25s_ease-in-out_infinite]" />
        <div className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 rounded-full bg-blue-500/[0.04] blur-[120px] animate-[aurora-drift_30s_ease-in-out_infinite_reverse]" />
        <div className="absolute top-1/3 left-1/3 w-1/3 h-1/3 rounded-full bg-green-500/[0.03] blur-[100px] animate-[aurora-drift_20s_ease-in-out_infinite_2s]" />
        <div className="absolute bottom-1/3 right-1/3 w-1/4 h-1/4 rounded-full bg-amber-500/[0.03] blur-[100px] animate-[aurora-drift_22s_ease-in-out_infinite_reverse_4s]" />
      </div>
      {/* Top bar */}
      <div className="flex items-center justify-between h-10 px-4 shrink-0 relative z-10">
        {/* Left: close + slide label */}
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center bg-red-500/10 text-red-400/70 hover:bg-red-500/20 hover:text-red-400 border border-red-500/15 hover:border-red-500/30 transition-all"
            title="Close (Esc)"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <span className="text-[11px] text-white/40">
            {slideLabel(currentSlide)}
          </span>
        </div>

        {/* Right: play/pause + speed */}
        <div className="flex items-center gap-2">
          <select
            value={slideDuration}
            onChange={(e) => setSlideDuration(Number(e.target.value))}
            className="bg-transparent border border-white/8 rounded-full px-2.5 py-1 text-[10px] text-white/30 hover:text-white/50 hover:border-white/15 outline-none transition-colors cursor-pointer"
          >
            <option value={5000}>5s</option>
            <option value={8000}>8s</option>
            <option value={12000}>12s</option>
            <option value={20000}>20s</option>
          </select>
          <button
            onClick={() => setIsPlaying((v) => !v)}
            className={`w-7 h-7 rounded-full flex items-center justify-center border transition-all ${
              isPlaying
                ? 'bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30'
                : 'bg-green-500/10 text-green-400/70 border-green-500/15 hover:bg-green-500/20 hover:text-green-400'
            }`}
            title={isPlaying ? 'Pause (P)' : 'Play (P)'}
          >
            {isPlaying ? (
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg className="w-3 h-3 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6,3 20,12 6,21" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Slide content with tap zones */}
      <div className="flex-1 overflow-hidden relative">
        {/* Slide area — scrollable */}
        <div className={`h-full overflow-y-auto transition-opacity duration-200 ${transitioning ? 'opacity-0' : 'opacity-100'}`}>
          {renderSlide(currentSlide, slidesData, onClose)}
        </div>

        {/* Tap zones — left half goes back, right half goes forward */}
        {currentIdx > 0 && (
          <div onClick={prev} className="absolute inset-y-0 left-0 w-1/2 z-10 cursor-w-resize" role="button" aria-label="Previous slide" />
        )}
        {currentIdx < totalSlides - 1 && (
          <div onClick={next} className="absolute inset-y-0 right-0 w-1/2 z-10 cursor-e-resize" role="button" aria-label="Next slide" />
        )}
      </div>

      {/* Bottom progress bar */}
      <div className="h-12 px-4 border-t border-white/8 flex items-center justify-between shrink-0">
        {/* Left nav */}
        <button
          onClick={prev}
          disabled={currentIdx === 0}
          className="w-7 h-7 rounded-full flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5 disabled:opacity-0 disabled:pointer-events-none transition-all"
          title="Previous"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Center: page number + progress dots */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-text-dim">
            {currentIdx + 1}/{totalSlides}
          </span>
          <div className="flex items-center gap-1 overflow-x-auto py-1 max-w-[50vw]">
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
        </div>

        {/* Right nav */}
        <button
          onClick={next}
          disabled={currentIdx === totalSlides - 1}
          className="w-7 h-7 rounded-full flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5 disabled:opacity-0 disabled:pointer-events-none transition-all"
          title="Next"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
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

function renderSlide(spec: SlideSpec, data: SlidesData, onClose: () => void): React.ReactNode {
  switch (spec.type) {
    case 'title':
      return <TitleSlide data={data} />;
    case 'shape':
      return <ShapeSlide data={data} />;
    case 'cast':
      return <CastSlide data={data} />;
    case 'forces':
      return <ForcesOverviewSlide data={data} />;
    case 'moment':
      return <KeyMomentsSlide data={data} sceneIdx={spec.sceneIdx} kind={spec.kind} />;
    case 'decomposition':
      return <ForceDecompositionSlide data={data} />;
    case 'state-machine':
      return <StateMachineSlide data={data} />;
    case 'threads':
      return <ThreadLifecycleSlide data={data} />;
    case 'swing':
      return <SwingAnalysisSlide data={data} />;
    case 'report':
      return <ReportCardSlide data={data} />;
    case 'closing':
      return <ClosingSlide data={data} onClose={onClose} />;
  }
}
