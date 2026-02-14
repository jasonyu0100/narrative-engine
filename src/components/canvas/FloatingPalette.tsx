'use client';

import { useState, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';

export default function FloatingPalette() {
  const { state, dispatch } = useStore();
  const access = useFeatureAccess();
  const narrative = state.activeNarrative;
  const isActive = narrative !== null;

  const totalScenes = state.resolvedSceneKeys.length;
  const isHead = state.currentSceneIndex === totalScenes - 1 && totalScenes > 0;
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const isAutoActive = !!(state.autoRunState?.isRunning || state.autoRunState?.isPaused);

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
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
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

        {/* Auto */}
        <button
          type="button"
          className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
            isAutoActive
              ? 'text-change hover:text-change/80 hover:bg-change/10'
              : 'text-text-secondary hover:text-text-primary hover:bg-white/6'
          }`}
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
      {isActive && isHead && (
        deleteConfirm ? (
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
  );
}
