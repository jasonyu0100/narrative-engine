'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import AppShell from '@/components/layout/AppShell';
import Sidebar from '@/components/sidebar/Sidebar';
import SidePanel from '@/components/inspector/SidePanel';
import WorldGraph from '@/components/canvas/WorldGraph';
import FloatingPalette from '@/components/canvas/FloatingPalette';
import TimelineStrip from '@/components/timeline/TimelineStrip';
import ForceCharts from '@/components/timeline/ForceCharts';
import NarrativePanel from '@/components/narrative/NarrativePanel';
import { CreationWizard } from '@/components/wizard/CreationWizard';
import { GeneratePanel } from '@/components/generation/GeneratePanel';
import { ForkPanel } from '@/components/generation/ForkPanel';
import { AutoSettingsPanel } from '@/components/auto/AutoSettingsPanel';
import { AutoControlBar } from '@/components/auto/AutoControlBar';
import { NarrativeCubeViewer } from '@/components/timeline/NarrativeCubeViewer';
import { useAutoPlay } from '@/hooks/useAutoPlay';
import { OnboardingGuide } from '@/components/onboarding/OnboardingGuide';

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

export default function SeriesPage() {
  const params = useParams();
  const router = useRouter();
  const { state, dispatch } = useStore();
  const isMobile = useIsMobile();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [autoSettingsOpen, setAutoSettingsOpen] = useState(false);
  const [cubeViewerOpen, setCubeViewerOpen] = useState(false);
  const autoPlay = useAutoPlay();

  const id = params.id as string;

  // Activate narrative from URL param
  useEffect(() => {
    if (id && state.activeNarrativeId !== id) {
      const exists = state.narratives.some((n) => n.id === id);
      if (exists) {
        dispatch({ type: 'SET_ACTIVE_NARRATIVE', id });
      } else {
        router.replace('/');
      }
    }
  }, [id, state.activeNarrativeId, state.narratives, dispatch, router]);

  // Custom event listeners for opening panels
  useEffect(() => {
    function handleOpenGenerate() { setGenerateOpen(true); }
    function handleOpenFork() { setForkOpen(true); }
    function handleOpenAutoSettings() { setAutoSettingsOpen(true); }
    function handleOpenCubeViewer() { setCubeViewerOpen(true); }
    window.addEventListener('open-generate-panel', handleOpenGenerate);
    window.addEventListener('open-fork-panel', handleOpenFork);
    window.addEventListener('open-auto-settings', handleOpenAutoSettings);
    window.addEventListener('open-cube-viewer', handleOpenCubeViewer);
    return () => {
      window.removeEventListener('open-generate-panel', handleOpenGenerate);
      window.removeEventListener('open-fork-panel', handleOpenFork);
      window.removeEventListener('open-auto-settings', handleOpenAutoSettings);
      window.removeEventListener('open-cube-viewer', handleOpenCubeViewer);
    };
  }, []);

  if (!state.activeNarrative) {
    return (
      <div className="h-screen flex items-center justify-center">
        <span className="text-text-dim text-sm">Loading narrative...</span>
      </div>
    );
  }

  const showAutoBar = state.autoRunState && (state.autoRunState.isRunning || state.autoRunState.isPaused || state.autoRunState.log.length > 0);

  return (
    <>
      <AppShell
        sidebar={<Sidebar />}
        sidepanel={<SidePanel />}
      >
        <div className="relative flex flex-col h-full min-h-0">
          <div className="flex-1 relative overflow-hidden">
            <WorldGraph />
            {showAutoBar && (
              <AutoControlBar
                isRunning={autoPlay.isRunning}
                isPaused={autoPlay.isPaused}
                currentCycle={autoPlay.currentCycle}
                totalScenes={state.autoRunState?.totalScenesGenerated ?? 0}
                log={autoPlay.log}
                onPause={autoPlay.pause}
                onResume={autoPlay.resume}
                onStop={autoPlay.stop}
                onOpenSettings={() => setAutoSettingsOpen(true)}
              />
            )}
            <FloatingPalette />
          </div>
          <NarrativePanel />
          <TimelineStrip />
          <ForceCharts />
        </div>
      </AppShell>
      {state.wizardOpen && <CreationWizard />}
      {generateOpen && <GeneratePanel onClose={() => setGenerateOpen(false)} />}
      {forkOpen && <ForkPanel onClose={() => setForkOpen(false)} />}
      {autoSettingsOpen && (
        <AutoSettingsPanel
          onClose={() => setAutoSettingsOpen(false)}
          onStart={() => autoPlay.start()}
        />
      )}
      {cubeViewerOpen && (
        <NarrativeCubeViewer onClose={() => setCubeViewerOpen(false)} />
      )}
      <OnboardingGuide narrativeId={id} />
      {isMobile && (
        <div className="fixed inset-0 z-9999 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center px-6 text-center">
          <p className="text-white/90 text-lg font-semibold mb-2">Desktop Only</p>
          <p className="text-white/40 text-sm leading-relaxed max-w-xs mb-6">
            Narrative Engine is designed for desktop browsers. Please visit on a larger screen.
          </p>
          <button
            onClick={() => router.push('/')}
            className="text-xs text-white/50 hover:text-white/80 underline underline-offset-2 transition"
          >
            Back to home
          </button>
        </div>
      )}
    </>
  );
}
