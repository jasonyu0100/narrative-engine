'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { resolveEntry, isScene, type Scene } from '@/types/narrative';

/** Highlight all occurrences of `query` within `text` */
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-400/30 text-text-primary rounded-sm px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export default function FloatingPalette() {
  const { state, dispatch } = useStore();
  const access = useFeatureAccess();
  const narrative = state.activeNarrative;
  const isActive = narrative !== null;

  const totalScenes = state.resolvedSceneKeys.length;
  const isHead = state.currentSceneIndex === totalScenes - 1 && totalScenes > 0;
  const activeBranch = narrative && state.activeBranchId ? narrative.branches[state.activeBranchId] : null;
  const headSceneId = state.resolvedSceneKeys[state.currentSceneIndex];
  const headIsOwned = activeBranch ? activeBranch.entryIds.includes(headSceneId) : false;
  // Block deletion if this scene is used as a fork point by any other branch
  const headIsForkPoint = narrative
    ? Object.values(narrative.branches).some(
        (b) => b.id !== state.activeBranchId && b.forkEntryId === headSceneId,
      )
    : false;
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isAutoActive = !!(state.autoRunState?.isRunning || state.autoRunState?.isPaused);

  // Scene search results
  const searchResults = useMemo(() => {
    if (!searchOpen || !searchQuery.trim() || !narrative) return [];
    const q = searchQuery.toLowerCase().trim();
    const results: { sceneId: string; timelineIndex: number; summary: string; arcName: string; locationName: string; matchSnippet: string | null }[] = [];
    for (let i = 0; i < state.resolvedSceneKeys.length; i++) {
      const entry = resolveEntry(narrative, state.resolvedSceneKeys[i]);
      if (!entry || !isScene(entry)) continue;
      const scene = entry as Scene;
      const arc = Object.values(narrative.arcs).find((a) => a.sceneIds.includes(scene.id));
      const location = narrative.locations[scene.locationId];
      const participants = scene.participantIds.map((pid) => narrative.characters[pid]?.name ?? '').join(' ');
      const events = scene.events.join(' ');
      const haystack = `${scene.summary} ${arc?.name ?? ''} ${location?.name ?? ''} ${participants} ${events}`.toLowerCase();
      if (haystack.includes(q)) {
        // Find a snippet around the match — prefer non-summary sources so the user sees *why* it matched
        let matchSnippet: string | null = null;
        const sources = [
          ...scene.events,
          participants,
          arc?.name ?? '',
          location?.name ?? '',
        ];
        for (const src of sources) {
          const idx = src.toLowerCase().indexOf(q);
          if (idx >= 0 && src.trim()) {
            const snippetStart = Math.max(0, idx - 40);
            const snippetEnd = Math.min(src.length, idx + q.length + 40);
            matchSnippet = (snippetStart > 0 ? '…' : '') + src.slice(snippetStart, snippetEnd).trim() + (snippetEnd < src.length ? '…' : '');
            break;
          }
        }
        // If match is only in summary, no extra snippet needed
        results.push({
          sceneId: scene.id,
          timelineIndex: i,
          summary: scene.summary,
          arcName: arc?.name ?? '',
          locationName: location?.name ?? '',
          matchSnippet,
        });
      }
      if (results.length >= 50) break;
    }
    return results;
  }, [searchOpen, searchQuery, narrative, state.resolvedSceneKeys]);

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearchQuery('');
    }
  }, [searchOpen]);

  const handleDeleteHead = useCallback(() => {
    if (!narrative || !state.activeBranchId || !isHead) return;
    const headSceneId = state.resolvedSceneKeys[state.currentSceneIndex];
    if (!headSceneId) return;

    const branchesWithEntry = Object.values(narrative.branches).filter(
      (b) => b.entryIds.includes(headSceneId)
    );

    if (branchesWithEntry.length <= 1) {
      dispatch({ type: 'DELETE_SCENE', sceneId: headSceneId, branchId: state.activeBranchId });
    } else {
      dispatch({ type: 'REMOVE_BRANCH_ENTRY', entryId: headSceneId, branchId: state.activeBranchId });
    }
    setDeleteConfirm(false);
  }, [narrative, state.activeBranchId, state.resolvedSceneKeys, state.currentSceneIndex, isHead, dispatch]);

  const wrapperClasses = isActive ? '' : 'opacity-30 pointer-events-none';

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2">
      {/* Scene search overlay — above palette */}
      {searchOpen && (
        <div
          className="w-80 max-h-[50vh] flex flex-col rounded-xl border border-white/10 overflow-hidden"
          style={{ background: '#1a1a1a', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
        >
          <div className="px-3 py-2.5 border-b border-white/5 flex items-center gap-2 shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-text-dim shrink-0">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearchOpen(false);
                if (e.key === 'Enter' && searchResults.length > 0) {
                  dispatch({ type: 'SET_SCENE_INDEX', index: searchResults[0].timelineIndex });
                  setSearchOpen(false);
                }
              }}
              placeholder="Search scenes..."
              className="flex-1 bg-transparent text-[12px] text-text-primary placeholder:text-text-dim/40 outline-none"
            />
            {searchQuery && (
              <span className="text-[9px] text-text-dim font-mono shrink-0">{searchResults.length} found</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {searchQuery.trim() && searchResults.length === 0 ? (
              <div className="py-8 text-center text-[11px] text-text-dim">No scenes match</div>
            ) : (
              searchResults.map((r) => (
                <button
                  key={r.sceneId}
                  onClick={() => {
                    dispatch({ type: 'SET_SCENE_INDEX', index: r.timelineIndex });
                    setSearchOpen(false);
                  }}
                  className="w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors border-b border-white/3 last:border-0"
                >
                  <p className="text-[11px] text-text-secondary leading-snug line-clamp-2">
                    <HighlightText text={r.summary} query={searchQuery} />
                  </p>
                  {r.matchSnippet && (
                    <p className="text-[10px] text-text-dim leading-snug mt-1 line-clamp-1">
                      <HighlightText text={r.matchSnippet} query={searchQuery} />
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    {r.arcName && <span className="text-[9px] text-text-dim">{r.arcName}</span>}
                    {r.locationName && (
                      <>
                        <span className="text-[9px] text-text-dim/30">&middot;</span>
                        <span className="text-[9px] text-text-dim">{r.locationName}</span>
                      </>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Palette row: bar + delete button side by side */}
      <div className="flex items-center gap-2">
      <div className={`glass-pill px-3 py-1.5 flex items-center gap-2 ${wrapperClasses}`}>
        {/* Prev */}
        <button
          type="button"
          className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded-md transition-colors"
          onClick={() => dispatch({ type: 'PREV_SCENE' })}
          aria-label="Previous scene"
        >
          &#9664;
        </button>

        {/* Search */}
        <button
          type="button"
          className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
            searchOpen
              ? 'text-text-primary bg-white/10'
              : 'text-text-secondary hover:text-text-primary hover:bg-white/6'
          }`}
          onClick={() => setSearchOpen((v) => !v)}
          aria-label="Search scenes"
          title="Search scenes"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </button>

        {/* Next */}
        <button
          type="button"
          className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/6 rounded-md transition-colors"
          onClick={() => dispatch({ type: 'NEXT_SCENE' })}
          aria-label="Next scene"
        >
          &#9654;
        </button>

        {/* Divider */}
        <div className="w-px h-4 bg-white/[0.12] mx-1" />

        {/* Scene counter */}
        <span className="text-text-dim text-[10px] whitespace-nowrap">
          Scene {state.currentSceneIndex + 1} / {totalScenes}
        </span>

        {/* Divider */}
        <div className="w-px h-4 bg-white/[0.12] mx-1" />

        {/* Generate */}
        <button
          type="button"
          className="text-xs font-semibold text-change bg-change/10 px-2 py-1 rounded-md hover:bg-change/20 transition-colors uppercase tracking-wider"
          onClick={() => {
            if (access.userApiKeys && !access.hasOpenRouterKey) {
              window.dispatchEvent(new Event('open-api-keys'));
              return;
            }
            window.dispatchEvent(new CustomEvent('open-generate-panel'));
          }}
        >
          Generate
        </button>

        {/* MCTS Explorer */}
        <button
          type="button"
          className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-blue-400 bg-blue-500/10 hover:bg-blue-500/20"
          onClick={() => {
            if (access.userApiKeys && !access.hasOpenRouterKey) {
              window.dispatchEvent(new Event('open-api-keys'));
              return;
            }
            window.dispatchEvent(new CustomEvent('open-mcts-panel'));
          }}
          title="MCTS Explorer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 2v6l-5 10a1 1 0 0 0 .9 1.4h14.2a1 1 0 0 0 .9-1.4L15 8V2" />
            <path d="M9 2h6" />
            <path d="M7 16h10" />
          </svg>
        </button>

        {/* Auto */}
        <button
          type="button"
          className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
          onClick={() => {
            if (isAutoActive) {
              dispatch({ type: 'STOP_AUTO_RUN' });
              return;
            }
            if (access.userApiKeys && !access.hasOpenRouterKey) {
              window.dispatchEvent(new Event('open-api-keys'));
              return;
            }
            window.dispatchEvent(new CustomEvent('open-auto-settings'));
          }}
          title={isAutoActive ? 'Stop auto mode' : 'Auto mode'}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className={isAutoActive ? 'animate-spin' : ''}
            style={isAutoActive ? { animationDuration: '2s' } : undefined}
          >
            <path d="M1 8a7 7 0 0 1 12.5-4.3" />
            <path d="M15 8a7 7 0 0 1-12.5 4.3" />
            <polyline points="13.5 1 13.5 4 10.5 4" />
            <polyline points="2.5 15 2.5 12 5.5 12" />
          </svg>
        </button>
      </div>

      {/* Delete head scene button */}
      {isActive && isHead && headIsOwned && (
        headIsForkPoint ? (
          <button
            type="button"
            disabled
            title="Another branch forks from this scene — delete that branch first"
            className="w-8 h-8 flex items-center justify-center rounded-full glass-pill text-text-dim opacity-30 cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        ) : deleteConfirm ? (
          <div className="glass-pill px-2 py-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleDeleteHead}
              className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setDeleteConfirm(false)}
              className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-dim hover:text-text-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDeleteConfirm(true)}
            className="w-8 h-8 flex items-center justify-center rounded-full glass-pill text-text-dim hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete head scene"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        )
      )}
      </div>
    </div>
  );
}
