'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArchetypeIcon } from '@/components/ArchetypeIcon';
import { scoreColor, timeAgo } from '@/lib/ui-utils';
import type { NarrativeEntry } from '@/types/narrative';

export interface StoryCardProps {
  entry: NarrativeEntry;
  index: number;
  /** Size variant: "md" (default) or "lg" */
  size?: 'md' | 'lg';
  /** Show scale indicator (5-bar chart). Default: true */
  showScale?: boolean;
  /** Show density indicator (5-ring chart). Default: true */
  showDensity?: boolean;
  /** Show relative time instead of play button. Default: false */
  showTimeAgo?: boolean;
  /** Open slides view on click. Default: false */
  openSlides?: boolean;
  /** Base animation delay offset in seconds. Default: 0 */
  animationDelayBase?: number;
}

const SCALE_KEYS = ['short', 'story', 'novel', 'epic', 'serial'] as const;
const DENSITY_KEYS = ['sparse', 'focused', 'developed', 'rich', 'sprawling'] as const;

export function StoryCard({
  entry,
  index,
  size = 'md',
  showScale = true,
  showDensity = true,
  showTimeAgo = false,
  openSlides = false,
  animationDelayBase = 0,
}: StoryCardProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const isLg = size === 'lg';
  const svgSize = isLg ? 22 : 20;
  const svgHeight = isLg ? 10 : 9;

  return (
    <div
      onClick={() => router.push(`/series/${entry.id}${openSlides ? '?slides=1' : ''}`)}
      className={`group relative shrink-0 cursor-pointer animate-fade-up ${isLg ? 'w-56' : 'w-52'}`}
      style={{ animationDelay: `${animationDelayBase + index * 0.08}s` }}
    >
      <div
        className={`relative rounded-xl overflow-hidden border border-white/6 bg-transparent transition-all duration-300 group-hover:border-white/15 group-hover:-translate-y-1 group-hover:shadow-[0_8px_30px_-10px_rgba(80,200,160,0.2)] ${isLg ? 'h-96' : 'h-80'}`}
      >
        {entry.coverImageUrl && (
          <div className="absolute inset-0">
            <img
              src={entry.coverImageUrl}
              alt=""
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-black/20" />
          </div>
        )}
        <div className="relative h-full flex flex-col p-4 pt-4">
          <p className="text-[9px] font-mono uppercase tracking-[0.15em] text-white/30">
            {entry.sceneCount} scenes
          </p>
          <div className="mt-auto">
            <h3
              className={`font-semibold leading-snug mb-1.5 text-white/90 group-hover:text-white transition-colors ${isLg ? 'text-[15px]' : 'text-[14px]'}`}
            >
              {entry.title}
            </h3>
            <p
              className={`text-white/40 leading-relaxed ${isLg ? 'text-[11px] line-clamp-4' : 'text-[11px] line-clamp-3'}`}
            >
              {entry.coverThread || entry.description}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-white/8 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Shape curve sparkline */}
              {entry.shapeCurve && (
                <div title={entry.shapeName ?? 'Shape'}>
                  <svg
                    width={svgSize}
                    height={svgHeight}
                    viewBox={`0 0 ${svgSize} ${svgHeight}`}
                    className="opacity-70"
                  >
                    <polyline
                      points={entry.shapeCurve
                        .map(([x, y]) => `${x * svgSize},${svgHeight - y * svgHeight}`)
                        .join(' ')}
                      fill="none"
                      stroke="#fb923c"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              )}

              {/* Archetype icon */}
              {entry.archetypeKey && (
                <ArchetypeIcon archetypeKey={entry.archetypeKey} size={11} />
              )}

              {/* Scale indicator (5-bar chart) */}
              {showScale && entry.scaleKey && (
                <div title={entry.scaleKey}>
                  <svg width="11" height="11" viewBox="0 0 18 18" className="shrink-0 opacity-70">
                    {[0, 1, 2, 3, 4].map((j) => {
                      const scaleIdx = SCALE_KEYS.indexOf(entry.scaleKey as typeof SCALE_KEYS[number]);
                      return (
                        <rect
                          key={j}
                          x={2 + j * 3}
                          y={14 - (j + 1) * 2.4}
                          width={2}
                          height={(j + 1) * 2.4}
                          rx={0.5}
                          fill={j <= scaleIdx ? '#22D3EE' : '#ffffff10'}
                        />
                      );
                    })}
                  </svg>
                </div>
              )}

              {/* Density indicator (5-ring chart) */}
              {showDensity && entry.densityKey && (
                <div title={entry.densityKey}>
                  <svg width="11" height="11" viewBox="0 0 18 18" className="shrink-0 opacity-70">
                    {[0, 1, 2, 3, 4].map((j) => {
                      const densityIdx = DENSITY_KEYS.indexOf(entry.densityKey as typeof DENSITY_KEYS[number]);
                      return (
                        <circle
                          key={j}
                          cx={9}
                          cy={9}
                          r={2 + j * 1.8}
                          fill="none"
                          stroke={j <= densityIdx ? '#34D399' : '#ffffff10'}
                          strokeWidth={0.8}
                        />
                      );
                    })}
                  </svg>
                </div>
              )}

              {/* Overall score */}
              {entry.overallScore !== undefined && (
                <span
                  className="text-[10px] font-mono font-semibold"
                  style={{ color: scoreColor(entry.overallScore) }}
                >
                  {entry.overallScore}
                </span>
              )}
            </div>

            {/* Right side: time ago or play button */}
            {showTimeAgo ? (
              <span className="text-[9px] text-white/25 font-mono" suppressHydrationWarning>
                {mounted ? timeAgo(entry.updatedAt) : ''}
              </span>
            ) : (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="text-white/30 group-hover:text-white/60 transition-colors ml-0.5"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
