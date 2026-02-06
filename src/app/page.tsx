'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStore, SEED_NARRATIVE_IDS } from '@/lib/store';
import { CreationWizard } from '@/components/wizard/CreationWizard';
import type { NarrativeEntry } from '@/types/narrative';

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ── Animated thread SVG that draws on mount ─────────────────────────────── */
function ThreadLine() {
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${len}`;
    requestAnimationFrame(() => {
      path.style.transition = 'stroke-dashoffset 2s ease-out';
      path.style.strokeDashoffset = '0';
    });
  }, []);

  return (
    <svg
      className="absolute left-1/2 -translate-x-1/2 top-0 h-full w-[2px] pointer-events-none"
      viewBox="0 0 2 600"
      preserveAspectRatio="none"
    >
      <path
        ref={pathRef}
        d="M1 0 L1 600"
        stroke="url(#thread-grad)"
        strokeWidth="1"
        fill="none"
      />
      <defs>
        <linearGradient id="thread-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0)" />
          <stop offset="30%" stopColor="rgba(255,255,255,0.08)" />
          <stop offset="70%" stopColor="rgba(255,255,255,0.04)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ── Seed vertical cards ─────────────────────────────────────────────────── */
function SeedCard({ entry, index }: { entry: NarrativeEntry; index: number }) {
  const router = useRouter();

  return (
    <div
      onClick={() => router.push(`/series/${entry.id}`)}
      className="group relative shrink-0 w-52 cursor-pointer animate-fade-up"
      style={{ animationDelay: `${0.5 + index * 0.1}s` }}
    >
      <div className="relative h-80 rounded-lg overflow-hidden border border-white/6 bg-transparent transition-all duration-300 group-hover:border-white/15 group-hover:-translate-y-1 group-hover:shadow-[0_8px_30px_-10px_rgba(80,200,160,0.15)]">
        {/* Cover image background */}
        {entry.coverImageUrl && (
          <div className="absolute inset-0">
            <img src={entry.coverImageUrl} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/20" />
          </div>
        )}
        {/* Content */}
        <div className="relative h-full flex flex-col p-4 pt-5">
          <p className="text-[9px] font-mono uppercase tracking-[0.15em] text-white/30">
            {entry.sceneCount} scenes
          </p>

          <div className="mt-auto">
            <h3 className="text-[15px] font-semibold leading-snug mb-2 text-white/90 group-hover:text-white transition-colors">
              {entry.title}
            </h3>
            <p className="text-[11px] text-white/40 leading-relaxed line-clamp-4">
              {entry.coverThread || entry.description}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-white/6 flex items-center justify-between">
            <span className="text-[9px] text-white/25 font-mono">seed</span>
            <span className="flex items-center gap-1 text-[10px] text-white/30 group-hover:text-white/70 transition-colors font-medium">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              Play
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SeedCarousel({ seeds }: { seeds: NarrativeEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener('scroll', checkScroll, { passive: true });
      window.addEventListener('resize', checkScroll);
    }
    return () => {
      el?.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [checkScroll]);

  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -240 : 240, behavior: 'smooth' });
  };

  return (
    <div className="relative group/carousel">
      {canScrollLeft && (
        <button
          onClick={() => scroll('left')}
          className="absolute left-1 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full border border-white/10 bg-black/40 backdrop-blur-sm flex items-center justify-center text-white/30 hover:text-white/70 hover:border-white/20 transition opacity-0 group-hover/carousel:opacity-100"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
      )}
      {canScrollRight && (
        <button
          onClick={() => scroll('right')}
          className="absolute right-1 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full border border-white/10 bg-black/40 backdrop-blur-sm flex items-center justify-center text-white/30 hover:text-white/70 hover:border-white/20 transition opacity-0 group-hover/carousel:opacity-100"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      )}

      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto pb-2 px-1"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {seeds.map((entry, i) => (
          <SeedCard key={entry.id} entry={entry} index={i} />
        ))}
      </div>
    </div>
  );
}

/* ── User series card — same style as SeedCard ─────────────────────────── */
function UserSeriesCard({ entry, index }: { entry: NarrativeEntry; index: number }) {
  const router = useRouter();
  const { dispatch } = useStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
    <div
      onClick={() => router.push(`/series/${entry.id}`)}
      className="group relative shrink-0 w-52 cursor-pointer animate-fade-up"
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      <div className="relative h-80 rounded-lg overflow-hidden border border-white/6 bg-transparent transition-all duration-300 group-hover:border-white/15 group-hover:-translate-y-1 group-hover:shadow-[0_8px_30px_-10px_rgba(80,200,160,0.15)]">
        {/* Cover image background */}
        {entry.coverImageUrl && (
          <div className="absolute inset-0">
            <img src={entry.coverImageUrl} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/20" />
          </div>
        )}
        {/* Content */}
        <div className="relative h-full flex flex-col p-4 pt-5">
          <p className="text-[9px] font-mono uppercase tracking-[0.15em] text-white/30">
            {entry.sceneCount} scenes
          </p>

          <div className="mt-auto">
            <h3 className="text-[15px] font-semibold leading-snug mb-2 text-white/90 group-hover:text-white transition-colors">
              {entry.title}
            </h3>
            <p className="text-[11px] text-white/40 leading-relaxed line-clamp-4">
              {entry.coverThread || entry.description}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-white/6 flex items-center justify-between">
            <span className="text-[9px] text-white/25 font-mono" suppressHydrationWarning>
              {mounted ? timeAgo(entry.updatedAt) : ''}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: 'DELETE_NARRATIVE', id: entry.id });
              }}
              className="text-[10px] text-white/20 hover:text-white/60 opacity-0 group-hover:opacity-100 transition"
            >
              &times;
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Home page ───────────────────────────────────────────────────────────── */
export default function HomePage() {
  const { state, dispatch } = useStore();
  const [prompt, setPrompt] = useState('');
  const [rolling, setRolling] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (!prompt.trim()) return;
    dispatch({ type: 'OPEN_WIZARD', prefill: prompt.trim() });
    setPrompt('');
  };

  const handleRandomIdea = async () => {
    if (rolling) return;
    setRolling(true);
    try {
      const res = await fetch('/api/random-idea', { method: 'POST' });
      const data = await res.json();
      if (data.idea) {
        inputRef.current?.focus();
        // Typewriter effect
        setPrompt('');
        const text = data.idea as string;
        let i = 0;
        const type = () => {
          if (i < text.length) {
            setPrompt(text.slice(0, i + 1));
            i++;
            setTimeout(type, 18 + Math.random() * 22);
          }
        };
        type();
      }
    } catch {
      // silently fail
    } finally {
      setRolling(false);
    }
  };

  const seeds = state.narratives.filter((e) => SEED_NARRATIVE_IDS.has(e.id));
  const userSeries = state.narratives.filter((e) => !SEED_NARRATIVE_IDS.has(e.id));

  return (
    <>
      <div className="min-h-screen bg-bg-base flex flex-col">
        {/* Cinematic background — aurora effect */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="aurora-container absolute bottom-0 left-0 right-0 h-[75%]">
            <div className="aurora-curtain aurora-curtain-1" />
            <div className="aurora-curtain aurora-curtain-2" />
            <div className="aurora-curtain aurora-curtain-3" />
            <div className="aurora-curtain aurora-curtain-4" />
            <div className="aurora-curtain aurora-curtain-5" />
            <div className="aurora-wisp aurora-wisp-1" />
            <div className="aurora-wisp aurora-wisp-2" />
            <div className="aurora-wisp aurora-wisp-3" />
            <div className="aurora-wisp aurora-wisp-4" />
            <div className="aurora-glow" />
          </div>
        </div>

        {/* Thread line */}
        <ThreadLine />

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <div className="relative flex flex-col items-center pt-24 sm:pt-32 pb-10 px-4">
          <p className="animate-fade-up text-[10px] uppercase tracking-[0.3em] text-white/30 font-mono mb-8">
            Narrative Engine
          </p>

          <h1 className="animate-fade-up-delay-1 text-5xl sm:text-7xl font-bold tracking-[-0.03em] text-center leading-[1.05] max-w-160">
            <span className="text-white">Stories that </span>
            <span className="text-white italic">evolve.</span>
          </h1>

          <p className="animate-fade-up-delay-2 text-[15px] text-white/40 mt-6 max-w-md text-center leading-relaxed">
            Drop in a premise. Watch characters collide, alliances shift, and worlds
            reshape themselves — one scene at a time.
          </p>

          <div className="animate-fade-up-delay-3 flex items-center gap-2 mt-5">
            {['Branching plots', 'Living characters', 'Knowledge graphs'].map((label) => (
              <span
                key={label}
                className="text-[10px] font-mono text-white/30 border border-white/8 rounded-full px-2.5 py-1 tracking-wide"
              >
                {label}
              </span>
            ))}
          </div>

          {/* ── Input ────────────────────────────────────────────────────── */}
          <div className="animate-fade-up-delay-3 mt-10 w-full max-w-xl">
            <div className="prompt-glow relative rounded-xl border border-white/8 focus-within:border-white/15 transition-colors duration-200">
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                rows={3}
                className="w-full bg-transparent text-white text-sm px-4 pt-4 pb-2 resize-none focus:outline-none placeholder:text-white/25"
                placeholder="A dying empire where three siblings each claim the throne..."
              />
              <div className="flex items-center justify-between px-3 pb-3">
                <button
                  onClick={handleRandomIdea}
                  disabled={rolling}
                  className="text-white/25 hover:text-white/50 transition disabled:opacity-40 text-[11px] font-mono flex items-center gap-1.5"
                >
                  <span className={rolling ? 'animate-spin inline-block' : ''}>&#127922;</span>
                  {rolling ? 'thinking...' : 'surprise me'}
                </button>
                <div className="flex items-center gap-2">
                  {prompt.trim() && (
                    <span className="text-[10px] text-white/20 font-mono">
                      ↵ enter
                    </span>
                  )}
                  <button
                    onClick={handleSubmit}
                    disabled={!prompt.trim()}
                    className="text-white/70 hover:text-white border border-white/10 hover:border-white/20 disabled:opacity-20 text-xs font-medium px-4 py-1.5 rounded-md transition"
                  >
                    Create
                  </button>
                </div>
              </div>
            </div>

            <p className="text-center text-[11px] text-white/25 mt-2.5">
              or{' '}
              <button
                onClick={() => dispatch({ type: 'OPEN_WIZARD' })}
                className="text-white/40 hover:text-white/70 underline underline-offset-2 transition"
              >
                open the wizard
              </button>
            </p>
          </div>
        </div>

        {/* ── Seed carousel ────────────────────────────────────────────── */}
        {seeds.length > 0 && (
          <div className="relative px-4 sm:px-8 pb-14 mt-4">
            <div className="max-w-240 mx-auto">
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono whitespace-nowrap">
                  Living Worlds
                </h2>
                <div className="flex-1 h-px bg-white/6" />
              </div>
              <SeedCarousel seeds={seeds} />
            </div>
          </div>
        )}

        {/* ── User series ──────────────────────────────────────────────── */}
        <div className="relative flex-1 px-4 sm:px-8 pb-16">
          <div className="max-w-240 mx-auto">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono">
                Your Stories
              </h2>
              <div className="flex-1 h-px bg-white/6" />
            </div>
            {userSeries.length > 0 ? (
              <div className="flex gap-3 flex-wrap">
                {userSeries.map((entry, i) => (
                  <UserSeriesCard key={entry.id} entry={entry} index={i} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 border border-dashed border-white/8 rounded-lg">
                <p className="text-white/25 text-sm">No stories yet</p>
                <button
                  onClick={() => dispatch({ type: 'OPEN_WIZARD' })}
                  className="mt-3 text-xs text-white/40 hover:text-white/70 underline underline-offset-2 transition"
                >
                  Create your first narrative
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {state.wizardOpen && <CreationWizard />}
    </>
  );
}
