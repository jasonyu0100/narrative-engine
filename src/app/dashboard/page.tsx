'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStore, SEED_NARRATIVE_IDS } from '@/lib/store';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { CreationWizard } from '@/components/wizard/CreationWizard';
import ApiKeyModal from '@/components/topbar/ApiKeyModal';
import { StoryCard } from '@/components/cards/StoryCard';
import { timeAgo } from '@/lib/ui-utils';
import type { DiscoveryInquiry } from '@/types/narrative';
import { loadDiscoveryInquiries, deleteDiscoveryInquiry } from '@/lib/persistence';

export default function DashboardPage() {
  const router = useRouter();
  const { state, dispatch } = useStore();
  const access = useFeatureAccess();
  const { userApiKeys, hasOpenRouterKey } = access;
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [analysisText, setAnalysisText] = useState('');
  const [inquiries, setInquiries] = useState<DiscoveryInquiry[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load saved discovery inquiries
  useEffect(() => {
    loadDiscoveryInquiries().then(setInquiries);
  }, []);

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
          <div className="aurora-container absolute bottom-0 left-0 right-0 h-full">
            <div className="aurora-curtain aurora-curtain-1" />
            <div className="aurora-curtain aurora-curtain-2" />
            <div className="aurora-curtain aurora-curtain-3" />
            <div className="aurora-glow" />
          </div>
        </div>

        <div className="relative z-10 w-full px-4 sm:px-8 pt-8 pb-20">
          {/* Header */}
          <div className="max-w-4xl mx-auto mb-8">
            <h1 className="text-xl font-semibold text-white/90">Dashboard</h1>
          </div>

          {/* Quick Actions */}
          <div className="max-w-4xl mx-auto mb-6 flex items-center gap-2">
            <button
              onClick={() => openCreate()}
              className="flex items-center gap-2 text-xs text-white/50 hover:text-white/90 px-3 py-1.5 rounded-lg border border-white/8 hover:border-white/15 hover:bg-white/4 transition"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Create
            </button>
            <button
              onClick={() => router.push('/discover')}
              className="flex items-center gap-2 text-xs text-white/50 hover:text-white/90 px-3 py-1.5 rounded-lg border border-white/8 hover:border-white/15 hover:bg-white/4 transition"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              Discover
            </button>
          </div>

          {/* Analysis Input */}
          <div className="max-w-4xl mx-auto mb-12">
            <div className="rounded-xl border border-white/8 bg-white/2 focus-within:border-white/12 transition">
              <textarea
                ref={inputRef}
                value={analysisText}
                onChange={(e) => setAnalysisText(e.target.value)}
                rows={4}
                className="w-full bg-transparent text-white text-sm px-4 pt-4 pb-2 resize-none focus:outline-none placeholder:text-white/25"
                placeholder="Paste text to analyze into a narrative..."
              />
              <div className="flex items-center justify-between px-4 pb-3">
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
                  className="text-white/60 hover:text-white border border-white/10 hover:border-white/20 disabled:opacity-20 text-xs font-medium px-4 py-1.5 rounded-md transition"
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
                  <StoryCard key={entry.id} entry={entry} index={i} showTimeAgo />
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

          {/* Discovery Inquiries */}
          {inquiries.length > 0 && (
            <div className="max-w-4xl mx-auto mb-12">
              <div className="flex items-center gap-3 mb-5">
                <h2 className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono">Discovery Inquiries</h2>
                <div className="flex-1 h-px bg-white/6" />
              </div>
              <div className="flex flex-col gap-2">
                {inquiries.map((inq) => (
                  <div
                    key={inq.id}
                    className="group flex items-center gap-4 border border-white/6 rounded-lg px-4 py-3 hover:border-white/12 transition cursor-pointer"
                    onClick={() => router.push(`/discover?id=${inq.id}`)}
                  >
                    <div className="w-2 h-2 rounded-full shrink-0 bg-cyan-400/60" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-white/80 font-medium truncate block">
                        {inq.state.title || 'Untitled Inquiry'}
                      </span>
                      <span className="text-[10px] text-white/25 font-mono">
                        {inq.state.decisions.length} decisions &middot; {inq.state.entities.length} entities &middot; {inq.state.systems.length} systems
                      </span>
                    </div>
                    <span className="text-[9px] text-white/20 font-mono shrink-0" suppressHydrationWarning>
                      {timeAgo(inq.updatedAt)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDiscoveryInquiry(inq.id).then(() =>
                          setInquiries((prev) => prev.filter((i) => i.id !== inq.id))
                        );
                      }}
                      className="text-white/15 hover:text-white/50 text-sm opacity-0 group-hover:opacity-100 transition shrink-0"
                    >&times;</button>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                        job.status === 'running' ? 'bg-world animate-pulse' :
                        job.status === 'paused' ? 'bg-yellow-400/60' : 'bg-white/20'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-white/80 font-medium truncate block">{job.title}</span>
                        <span className="text-[10px] text-white/25 font-mono">{completedChunks}/{totalChunks} chunks &middot; {progress}%</span>
                      </div>
                      <div className="w-24 h-1.5 bg-white/6 rounded-full overflow-hidden shrink-0">
                        <div className={`h-full rounded-full transition-all ${job.status === 'failed' ? 'bg-red-500/60' : job.status === 'completed' ? 'bg-emerald-500/60' : 'bg-world/60'}`} style={{ width: `${progress}%` }} />
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
