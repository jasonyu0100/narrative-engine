'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStore, PLAYGROUND_NARRATIVE_IDS, ANALYSIS_NARRATIVE_IDS } from '@/lib/store';
import { ArchetypeIcon } from '@/components/ArchetypeIcon';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { CreationWizard } from '@/components/wizard/CreationWizard';
import ApiKeyModal from '@/components/topbar/ApiKeyModal';
import type { NarrativeEntry } from '@/types/narrative';

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [breakpoint]);
  return isMobile;
}

/* ── Morph text — letters shift through similar glyphs ────────────────────── */
const MORPH_GLYPHS: Record<string, string[]> = {
  e: ['ë', 'ē', 'ę', 'ė', 'ě', 'è', 'é'],
  v: ['ν', 'ʋ', 'ᵥ', 'ṽ'],
  o: ['ö', 'ø', 'ō', 'ő', 'ȯ', 'ò', 'ó'],
  l: ['ł', 'ĺ', 'ḷ', 'ℓ', 'ḻ'],
  t: ['ţ', 'ť', 'ț', 'ƭ', 'ṭ'],
  h: ['ħ', 'ḥ', 'ȟ', 'ḫ'],
  i: ['ï', 'ī', 'į', 'ĭ', 'ì', 'í'],
  n: ['ñ', 'ń', 'ņ', 'ň', 'ṅ'],
  k: ['ķ', 'ƙ', 'ḳ', 'ǩ'],
};

function MorphText({ text }: { text: string }) {
  const [chars, setChars] = useState(() => text.split(''));

  useEffect(() => {
    const original = text.split('');
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    // Each morphable letter runs its own independent loop
    original.forEach((ch, i) => {
      const glyphs = MORPH_GLYPHS[ch.toLowerCase()];
      if (!glyphs) return;

      function loop() {
        // Rapid burst: cycle through 2-4 glyphs before settling
        const burstLen = 2 + Math.floor(Math.random() * 3);
        let step = 0;

        function tick() {
          if (step < burstLen) {
            const g = glyphs[Math.floor(Math.random() * glyphs.length)];
            setChars((prev) => { const next = [...prev]; next[i] = g; return next; });
            step++;
            timeouts.push(setTimeout(tick, 60 + Math.random() * 40));
          } else {
            // Settle back to original
            setChars((prev) => { const next = [...prev]; next[i] = original[i]; return next; });
            // Wait before next burst — staggered per letter
            timeouts.push(setTimeout(loop, 1200 + Math.random() * 3000));
          }
        }

        // Staggered start per letter
        timeouts.push(setTimeout(tick, 1500 + i * 400 + Math.random() * 1000));
      }

      loop();
    });

    return () => timeouts.forEach(clearTimeout);
  }, [text]);

  return (
    <span className="relative inline-block">
      {/* Invisible original text holds the width */}
      <span className="invisible">{text}</span>
      {/* Morphing overlay */}
      <span className="absolute inset-0">
        {chars.map((ch, i) => {
          const isOriginal = ch === text[i];
          return (
            <span
              key={i}
              style={{
                transition: 'opacity 80ms, filter 80ms',
                opacity: isOriginal ? 1 : 0.6,
                filter: isOriginal ? 'none' : 'blur(0.6px)',
              }}
            >
              {ch}
            </span>
          );
        })}
      </span>
    </span>
  );
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

/* ── Card color helpers ─────────────────────────────────────────────────── */
function scoreColor(score: number): string {
  if (score >= 80) return '#4ade80';
  if (score >= 60) return '#facc15';
  if (score >= 40) return '#fb923c';
  return '#f87171';
}


/* ── Seed vertical cards ─────────────────────────────────────────────────── */

function SeedCard({ entry, index, openSlides, size = 'md' }: { entry: NarrativeEntry; index: number; openSlides?: boolean; size?: 'lg' | 'md' }) {
  const router = useRouter();
  const isLg = size === 'lg';

  return (
    <div
      onClick={() => router.push(`/series/${entry.id}${openSlides ? '?slides=1' : ''}`)}
      className={`group relative shrink-0 cursor-pointer animate-fade-up ${isLg ? 'w-56' : 'w-52'}`}
      style={{ animationDelay: `${0.5 + index * 0.08}s` }}
    >
      <div className={`relative rounded-xl overflow-hidden border border-white/6 bg-transparent transition-all duration-300 group-hover:border-white/15 group-hover:-translate-y-1 group-hover:shadow-[0_8px_30px_-10px_rgba(80,200,160,0.2)] ${isLg ? 'h-96' : 'h-76'}`}>
        {entry.coverImageUrl && (
          <div className="absolute inset-0">
            <img src={entry.coverImageUrl} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-linear-to-t from-black/95 via-black/50 to-black/20" />
          </div>
        )}
        <div className="relative h-full flex flex-col p-4 pt-4">
          <p className="text-[9px] font-mono uppercase tracking-[0.15em] text-white/30">
            {entry.sceneCount} scenes
          </p>
          <div className="mt-auto">
            <h3 className={`font-semibold leading-snug mb-1.5 text-white/90 group-hover:text-white transition-colors ${isLg ? 'text-[15px]' : 'text-[14px]'}`}>
              {entry.title}
            </h3>
            <p className={`text-white/40 leading-relaxed ${isLg ? 'text-[11px] line-clamp-4' : 'text-[11px] line-clamp-3'}`}>
              {entry.coverThread || entry.description}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-white/8 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {entry.shapeCurve && (
                <svg width={isLg ? 22 : 20} height={isLg ? 10 : 9} viewBox={`0 0 ${isLg ? 22 : 20} ${isLg ? 10 : 9}`} className="opacity-70">
                  <polyline
                    points={entry.shapeCurve.map(([x, y]) => `${x * (isLg ? 22 : 20)},${(isLg ? 10 : 9) - y * (isLg ? 10 : 9)}`).join(' ')}
                    fill="none" stroke="#fb923c" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              )}
              {entry.archetypeKey && (
                <ArchetypeIcon archetypeKey={entry.archetypeKey} size={isLg ? 11 : 11} />
              )}
              {entry.overallScore !== undefined && (
                <span className="text-[10px] font-mono font-semibold" style={{ color: scoreColor(entry.overallScore) }}>{entry.overallScore}</span>
              )}
            </div>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="text-white/30 group-hover:text-white/60 transition-colors ml-0.5"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function SeedCarousel({ seeds, openSlides, size = 'md' }: { seeds: NarrativeEntry[]; openSlides?: boolean; size?: 'lg' | 'md' }) {
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

  const scrollAmt = size === 'lg' ? 300 : 240;
  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -scrollAmt : scrollAmt, behavior: 'smooth' });
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
        className="flex gap-5 overflow-x-auto pb-2 px-1"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {seeds.map((entry, i) => (
          <SeedCard key={entry.id} entry={entry} index={i} openSlides={openSlides} size={size} />
        ))}
      </div>
    </div>
  );
}

/* ── Home page ───────────────────────────────────────────────────────────── */
export default function HomePage() {
  const router = useRouter();
  const { state, dispatch } = useStore();
  const access = useFeatureAccess();
  const { userApiKeys, hasOpenRouterKey } = access;
  const isMobile = useIsMobile();
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [analysisText, setAnalysisText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleOpenApiKeys = () => setApiKeysOpen(true);
    window.addEventListener('open-api-keys', handleOpenApiKeys);
    return () => window.removeEventListener('open-api-keys', handleOpenApiKeys);
  }, []);

  const needsKeys = userApiKeys && !hasOpenRouterKey;

  const openCreate = (prefill?: string) => {
    if (needsKeys) { setApiKeysOpen(true); return; }
    if (isMobile) return;
    dispatch({ type: 'OPEN_WIZARD', prefill });
  };

  const playgrounds = state.narratives.filter((e) => PLAYGROUND_NARRATIVE_IDS.has(e.id));
  const analysisSeeds = state.narratives.filter((e) => ANALYSIS_NARRATIVE_IDS.has(e.id));

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
            InkTide
          </p>

          <h1 className="animate-fade-up-delay-1 text-5xl sm:text-7xl font-bold tracking-[-0.03em] text-center leading-[1.05] max-w-160">
            <span className="text-white">Stories that </span>
            <span className="glitch-wrapper text-white italic whitespace-nowrap" data-text="breathe."><MorphText text="breathe" />.</span>
          </h1>

          <p className="animate-fade-up-delay-2 text-[15px] text-white/40 mt-6 max-w-lg text-center leading-relaxed">
            Where narrative forces ebb and flow like tides. Tension builds, payoff lands, the story breathes.
            Three forces measure the rhythm—and guide what happens next.
          </p>

          {/* ── Analyze Corpus ─────────────────────────────────────────── */}
          <div className="animate-fade-up-delay-3 mt-10 w-full max-w-xl">
            {isMobile ? (
              <div className="text-center py-8 border border-dashed border-white/8 rounded-xl">
                <p className="text-white/30 text-sm">Series creation is available on desktop</p>
              </div>
            ) : (
              <>
                <div className="prompt-glow relative rounded-xl border border-white/8 focus-within:border-white/15 transition-colors duration-200">
                  <textarea
                    ref={inputRef}
                    value={analysisText}
                    onChange={(e) => setAnalysisText(e.target.value)}
                    rows={5}
                    className="w-full bg-transparent text-white text-sm px-4 pt-4 pb-2 resize-none focus:outline-none placeholder:text-white/25"
                    placeholder="Paste a book, screenplay, or any long-form text to analyze into a narrative..."
                  />
                  <div className="flex items-center justify-between px-3 pb-3">
                    <span className="text-[10px] text-white/20 font-mono">
                      {analysisText.trim() ? `${analysisText.trim().split(/\s+/).length.toLocaleString()} words` : 'text analysis'}
                    </span>
                    <button
                      onClick={() => {
                        if (!analysisText.trim()) return;
                        if (needsKeys) { setApiKeysOpen(true); return; }
                        import('@/lib/analysis-transfer').then(({ setAnalysisSource }) =>
                          setAnalysisSource(analysisText).then(() => router.push('/analysis?new=1'))
                        );
                      }}
                      disabled={!analysisText.trim()}
                      className="text-white/70 hover:text-white border border-white/10 hover:border-white/20 disabled:opacity-20 text-xs font-medium px-4 py-1.5 rounded-md transition"
                    >
                      Analyze
                    </button>
                  </div>
                </div>

                <p className="text-center text-[11px] text-white/25 mt-3">
                  or{' '}
                  <button
                    onClick={() => openCreate()}
                    className="text-white/40 hover:text-white/70 underline underline-offset-2 transition"
                  >
                    create a new world
                  </button>
                  {' '}from a premise
                </p>
              </>
            )}
          </div>
        </div>

        {/* ── Open source book analysis ─────────────────────────────── */}
        {analysisSeeds.length > 0 && (
          <div className="relative px-4 sm:px-10 pb-16 mt-16">
            <div className="max-w-5xl mx-auto">
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono whitespace-nowrap">
                  Analyzed Works
                </h2>
                <div className="flex-1 h-px bg-white/6" />
              </div>
              <p className="text-[13px] text-white/40 leading-relaxed mb-8 max-w-lg">
                We ran the formulas on the books that shaped a generation. See where the tension actually peaks — and whether it matches what you remember feeling.
              </p>
              <SeedCarousel seeds={analysisSeeds} openSlides />
            </div>
          </div>
        )}

        {/* ── Playground seeds ────────────────────────────────────────── */}
        {playgrounds.length > 0 && (
          <div className="relative px-4 sm:px-10 pb-16 mt-16">
            <div className="max-w-5xl mx-auto">
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono whitespace-nowrap">
                  AI Playgrounds
                </h2>
                <div className="flex-1 h-px bg-white/6" />
              </div>
              <p className="text-[13px] text-white/40 leading-relaxed mb-5 max-w-lg">
                What if the story went differently? These are AI-generated alternate realities — same worlds, different paths. Branch timelines, stress-test arcs, and watch the force curves shift.
              </p>
              <SeedCarousel seeds={playgrounds} />
            </div>
          </div>
        )}

        {/* ── Q&A ───────────────────────────────────────────────────── */}
        <div className="relative px-4 sm:px-8 pb-20 mt-4">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-3 mb-8">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono whitespace-nowrap">
                Questions
              </h2>
              <div className="flex-1 h-px bg-white/6" />
            </div>
            <div className="space-y-6">
              {[
                {
                  q: 'What can I do with this?',
                  a: 'Create stories with a knowledge graph underneath. The engine tracks your characters, threads, relationships, and world-building as structured data — then uses that graph to generate scenes, grade pacing, and find the strongest story paths. You can also paste in existing text (novels, screenplays, fanfiction) and the analysis pipeline will extract the graph and show you where the peaks and valleys land.',
                },
                {
                  q: 'How do I start a story?',
                  a: 'Click "New Story" and describe your premise. The engine builds out an initial cast, locations, threads, and world knowledge. From there you can generate scenes, edit anything by hand, branch into alternate timelines, or let the auto-engine run and build arcs for you. Everything is editable — the AI proposes, you decide.',
                },
                {
                  q: 'What is the commit tree?',
                  a: 'Your story has a git-like timeline. Every scene is a commit. You can fork at any point to explore a different path — what if the villain won? What if two characters never met? Branches share history up to the fork, then diverge. You can compare them side by side, keep the best, or merge ideas across branches.',
                },
                {
                  q: 'What do the force charts show me?',
                  a: 'Three scores per scene: Payoff (did threads resolve?), Change (how much happened?), and Knowledge (did the world get richer?). The delivery curve combines them into a single line — peaks are your big moments, valleys are your buildup. If the curve is flat, your story might need more contrast between quiet scenes and dramatic ones.',
                },
                {
                  q: 'What does MCTS do?',
                  a: 'It searches for the best next arc. The engine generates multiple possible directions, scores each one, and expands the most promising branches — like a chess engine, but for story paths. You pick a rhythm profile (pacing inspired by a published work) and MCTS finds scenes that hit those beats. The result is a set of candidate arcs ranked by narrative force.',
                },
                {
                  q: 'Can I analyse existing books?',
                  a: 'Yes. Go to the analysis page and paste in any text — up to 500K words. The engine chunks it, extracts characters, threads, and world knowledge, then computes force curves and a grade. You can see exactly where a novel peaks, what archetype it fits, and how its pacing compares to other works in the system.',
                },
                {
                  q: 'What does it cost?',
                  a: 'InkTide is free and open source. You bring your own API key (OpenRouter) which gives you access to any LLM — Gemini, GPT, Claude, Llama, and others. You pay only for the tokens you use at the provider\'s rates. No subscription, no platform fee.',
                },
              ].map(({ q, a }, i) => (
                <details key={i} className="group">
                  <summary className="flex items-center justify-between cursor-pointer list-none py-2">
                    <span className="text-[13px] text-white/70 group-hover:text-white/90 transition font-medium">{q}</span>
                    <svg className="w-3.5 h-3.5 text-white/20 group-open:rotate-90 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
                  </summary>
                  <p className="text-[12px] text-white/35 leading-relaxed pb-2 pl-0">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="relative px-4 sm:px-10 py-8 border-t border-white/6">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <p className="text-[11px] font-mono text-white/20 uppercase tracking-[0.2em]">InkTide</p>
            <div className="flex items-center gap-5">
              <a
                href="https://x.com/_jason_y_"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/25 hover:text-white/60 transition-colors"
                aria-label="X / Twitter"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a
                href="https://github.com/jasonyu0100/narrative-engine"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/25 hover:text-white/60 transition-colors"
                aria-label="GitHub"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>

      {state.wizardOpen && <CreationWizard />}
      {apiKeysOpen && <ApiKeyModal access={access} onClose={() => setApiKeysOpen(false)} />}
    </>
  );
}
