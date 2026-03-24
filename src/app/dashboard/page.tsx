'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStore, SEED_NARRATIVE_IDS } from '@/lib/store';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { CreationWizard } from '@/components/wizard/CreationWizard';
import ApiKeyModal from '@/components/layout/ApiKeyModal';
import { ArchetypeIcon } from '@/components/ArchetypeIcon';
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

function scoreColor(score: number): string {
  if (score >= 80) return '#4ade80';
  if (score >= 60) return '#facc15';
  if (score >= 40) return '#fb923c';
  return '#f87171';
}

const ARCHETYPE_COLORS: Record<string, string> = {
  masterwork: '#f59e0b', epic: '#ef4444', chronicle: '#3b82f6',
  saga: '#8b5cf6', classic: '#10b981', anthology: '#ec4899',
  tome: '#06b6d4', emerging: '#6b7280',
};

function StoryCard({ entry, index }: { entry: NarrativeEntry; index: number }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
    <div
      onClick={() => router.push(`/series/${entry.id}`)}
      className="group relative shrink-0 w-52 cursor-pointer animate-fade-up"
      style={{ animationDelay: `${index * 0.08}s` }}
    >
      <div className="relative h-80 rounded-lg overflow-hidden border border-white/6 bg-transparent transition-all duration-300 group-hover:border-white/15 group-hover:-translate-y-1 group-hover:shadow-[0_8px_30px_-10px_rgba(80,200,160,0.15)]">
        {entry.coverImageUrl && (
          <div className="absolute inset-0">
            <img src={entry.coverImageUrl} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/20" />
          </div>
        )}
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
            <div className="flex items-center gap-2.5">
              {entry.shapeCurve && (
                <div title={entry.shapeName ?? 'Shape'}>
                  <svg width="20" height="10" viewBox="0 0 20 10" className="opacity-70">
                    <polyline
                      points={entry.shapeCurve.map(([x, y]) => `${x * 20},${10 - y * 10}`).join(' ')}
                      fill="none" stroke="#fb923c" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
                    />
                  </svg>
                </div>
              )}
              {entry.archetypeKey && (
                <ArchetypeIcon archetypeKey={entry.archetypeKey} size={11} color={ARCHETYPE_COLORS[entry.archetypeKey] ?? '#6b7280'} />
              )}
              {entry.overallScore !== undefined && (
                <span className="text-[10px] font-mono font-semibold" style={{ color: scoreColor(entry.overallScore) }}>{entry.overallScore}</span>
              )}
            </div>
            <span className="text-[9px] text-white/25 font-mono" suppressHydrationWarning>
              {mounted ? timeAgo(entry.updatedAt) : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { state, dispatch } = useStore();
  const access = useFeatureAccess();
  const { userApiKeys, hasOpenRouterKey } = access;
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [analysisText, setAnalysisText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleOpenApiKeys = () => setApiKeysOpen(true);
    window.addEventListener('open-api-keys', handleOpenApiKeys);
    return () => window.removeEventListener('open-api-keys', handleOpenApiKeys);
  }, []);

  const needsKeys = userApiKeys && !hasOpenRouterKey;

  const openCreate = useCallback((prefill?: string) => {
    if (needsKeys) { setApiKeysOpen(true); return; }
    dispatch({ type: 'OPEN_WIZARD', prefill });
  }, [needsKeys, dispatch]);

  const userSeries = state.narratives.filter((e) => !SEED_NARRATIVE_IDS.has(e.id));

  return (
    <>
      <div className="min-h-screen bg-bg-base flex flex-col">
        {/* Aurora background */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="aurora-container absolute bottom-0 left-0 right-0 h-[75%]">
            <div className="aurora-curtain aurora-curtain-1" />
            <div className="aurora-curtain aurora-curtain-3" />
            <div className="aurora-curtain aurora-curtain-5" />
            <div className="aurora-glow" />
          </div>
        </div>

        <div className="relative z-10 w-full px-4 sm:px-8 pt-8 pb-20">
          {/* Header */}
          <div className="max-w-4xl mx-auto flex items-center justify-between mb-10">
            <h1 className="text-xl font-semibold text-white/90">Dashboard</h1>
            <div className="flex items-center gap-2">
              <button
                onClick={() => openCreate()}
                className="text-[11px] px-4 py-1.5 rounded-md bg-white/8 border border-white/10 text-white/70 hover:text-white hover:border-white/20 transition font-medium"
              >
                New Story
              </button>
            </div>
          </div>

          {/* Analyze corpus */}
          <div className="max-w-4xl mx-auto mb-12">
            <div className="prompt-glow relative rounded-xl border border-white/8 focus-within:border-white/15 transition-colors duration-200 max-w-xl">
              <textarea
                ref={inputRef}
                value={analysisText}
                onChange={(e) => setAnalysisText(e.target.value)}
                rows={4}
                className="w-full bg-transparent text-white text-sm px-4 pt-4 pb-2 resize-none focus:outline-none placeholder:text-white/25"
                placeholder="Paste text to analyze into a narrative..."
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
          </div>

          {/* Your Stories */}
          <div className="max-w-4xl mx-auto mb-12">
            <div className="flex items-center gap-3 mb-5">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono">Your Stories</h2>
              <div className="flex-1 h-px bg-white/6" />
            </div>
            {userSeries.length > 0 ? (
              <div className="flex gap-3 flex-wrap">
                {userSeries.map((entry, i) => (
                  <StoryCard key={entry.id} entry={entry} index={i} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 border border-dashed border-white/8 rounded-lg">
                <p className="text-white/25 text-sm">No stories yet</p>
                <button
                  onClick={() => openCreate()}
                  className="mt-3 text-xs text-white/40 hover:text-white/70 underline underline-offset-2 transition"
                >
                  Create your first narrative
                </button>
              </div>
            )}
          </div>

          {/* Analysis Jobs */}
          {state.analysisJobs.length > 0 && (
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center gap-3 mb-5">
                <h2 className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono">Analysis Jobs</h2>
                <div className="flex-1 h-px bg-white/6" />
              </div>
              <div className="flex flex-col gap-2">
                {state.analysisJobs.map((job) => {
                  const completedChunks = job.results.filter((r) => r !== null).length;
                  const totalChunks = job.chunks.length;
                  const progress = totalChunks > 0 ? Math.round((completedChunks / totalChunks) * 100) : 0;
                  return (
                    <div
                      key={job.id}
                      className="group flex items-center gap-4 border border-white/6 rounded-lg px-4 py-3 hover:border-white/12 transition cursor-pointer"
                      onClick={() => router.push(`/analysis?job=${job.id}`)}
                    >
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        job.status === 'completed' ? 'bg-emerald-400' :
                        job.status === 'failed' ? 'bg-red-400' :
                        job.status === 'running' ? 'bg-change animate-pulse' :
                        job.status === 'paused' ? 'bg-yellow-400/60' : 'bg-white/20'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-white/80 font-medium truncate block">{job.title}</span>
                        <span className="text-[10px] text-white/25 font-mono">{completedChunks}/{totalChunks} chunks &middot; {progress}%</span>
                      </div>
                      <div className="w-24 h-1.5 bg-white/6 rounded-full overflow-hidden shrink-0">
                        <div className={`h-full rounded-full transition-all ${job.status === 'failed' ? 'bg-red-500/60' : job.status === 'completed' ? 'bg-emerald-500/60' : 'bg-change/60'}`} style={{ width: `${progress}%` }} />
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); dispatch({ type: 'DELETE_ANALYSIS_JOB', id: job.id }); }}
                        className="text-white/15 hover:text-white/50 text-sm opacity-0 group-hover:opacity-100 transition shrink-0"
                      >&times;</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {state.wizardOpen && <CreationWizard />}
      {apiKeysOpen && <ApiKeyModal access={access} onClose={() => setApiKeysOpen(false)} />}
    </>
  );
}
