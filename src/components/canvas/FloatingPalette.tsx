'use client';

import { useStore } from '@/lib/store';

export default function FloatingPalette() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const isActive = narrative !== null;

  const totalScenes = state.resolvedSceneKeys.length;

  const wrapperClasses = isActive ? '' : 'opacity-30 pointer-events-none';

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
      <div className={`glass-pill px-3 py-1.5 flex items-center gap-2 ${wrapperClasses}`}>
        {/* Prev */}
        <button
          type="button"
          className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/[0.06] rounded-md transition-colors"
          onClick={() => dispatch({ type: 'PREV_SCENE' })}
          aria-label="Previous scene"
        >
          &#9664;
        </button>

        {/* Next */}
        <button
          type="button"
          className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-white/[0.06] rounded-md transition-colors"
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
          className="text-xs font-semibold text-text-primary bg-white/[0.08] px-2 py-1 rounded-md hover:bg-white/[0.12] transition-colors uppercase tracking-wider"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('open-generate-panel'));
          }}
        >
          Generate
        </button>

        {/* Auto */}
        <button
          type="button"
          className="text-xs font-semibold text-text-secondary bg-white/[0.08] px-2 py-1 rounded-md hover:bg-white/[0.12] hover:text-text-primary transition-colors uppercase tracking-wider"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('open-auto-settings'));
          }}
        >
          Auto
        </button>
      </div>
    </div>
  );
}
