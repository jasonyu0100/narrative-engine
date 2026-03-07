'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import AppShell from '@/components/layout/AppShell';
import Sidebar from '@/components/sidebar/Sidebar';
import SidePanel from '@/components/inspector/SidePanel';
import WorldGraph from '@/components/canvas/WorldGraph';
import FloatingPalette from '@/components/canvas/FloatingPalette';
import SceneInfoBar from '@/components/canvas/SceneInfoBar';
import TimelineStrip from '@/components/timeline/TimelineStrip';
import ForceCharts from '@/components/timeline/ForceCharts';
import NarrativePanel from '@/components/narrative/NarrativePanel';
import { CreationWizard } from '@/components/wizard/CreationWizard';
import { GeneratePanel } from '@/components/generation/GeneratePanel';
import { BranchModal } from '@/components/generation/BranchModal';
import { AutoSettingsPanel } from '@/components/auto/AutoSettingsPanel';
import { AutoControlBar } from '@/components/auto/AutoControlBar';
import { NarrativeCubeViewer } from '@/components/timeline/NarrativeCubeViewer';
import { useAutoPlay } from '@/hooks/useAutoPlay';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import ApiKeyModal from '@/components/layout/ApiKeyModal';
import { OnboardingGuide } from '@/components/onboarding/OnboardingGuide';
import { ForceTracker } from '@/components/analytics/ForceTracker';
import RulesPanel from '@/components/layout/RulesPanel';
import { MCTSPanel } from '@/components/mcts/MCTSPanel';
import { MCTSControlBar } from '@/components/mcts/MCTSControlBar';
import { useMCTS } from '@/hooks/useMCTS';
import { StorySettingsModal } from '@/components/settings/StorySettingsModal';

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
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [forceTrackerOpen, setForceTrackerOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [mctsOpen, setMctsOpen] = useState(false);
  const [storySettingsOpen, setStorySettingsOpen] = useState(false);
  const autoPlay = useAutoPlay();
  const mcts = useMCTS();
  const access = useFeatureAccess();

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
    function handleOpenApiKeys() { setApiKeysOpen(true); }
    function handleOpenForceTracker() { setForceTrackerOpen(true); }
    function handleOpenRules() { setRulesOpen(true); }
    function handleOpenMcts() { setMctsOpen(true); }
    function handleOpenStorySettings() { setStorySettingsOpen(true); }
    window.addEventListener('open-generate-panel', handleOpenGenerate);
    window.addEventListener('open-branch-modal', handleOpenFork);
    window.addEventListener('open-auto-settings', handleOpenAutoSettings);
    window.addEventListener('open-cube-viewer', handleOpenCubeViewer);
    window.addEventListener('open-api-keys', handleOpenApiKeys);
    window.addEventListener('open-force-tracker', handleOpenForceTracker);
    window.addEventListener('open-rules-panel', handleOpenRules);
    window.addEventListener('open-mcts-panel', handleOpenMcts);
    window.addEventListener('open-story-settings', handleOpenStorySettings);
    return () => {
      window.removeEventListener('open-generate-panel', handleOpenGenerate);
      window.removeEventListener('open-branch-modal', handleOpenFork);
      window.removeEventListener('open-auto-settings', handleOpenAutoSettings);
      window.removeEventListener('open-cube-viewer', handleOpenCubeViewer);
      window.removeEventListener('open-api-keys', handleOpenApiKeys);
      window.removeEventListener('open-force-tracker', handleOpenForceTracker);
      window.removeEventListener('open-rules-panel', handleOpenRules);
      window.removeEventListener('open-mcts-panel', handleOpenMcts);
      window.removeEventListener('open-story-settings', handleOpenStorySettings);
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
  const showMctsBar = mcts.runState.status !== 'idle' || Object.keys(mcts.runState.tree.nodes).length > 0;

  return (
    <>
      <AppShell
        sidebar={<Sidebar />}
        sidepanel={<SidePanel />}
      >
        <div className="relative flex flex-col h-full min-h-0">
          <div className="flex-1 relative overflow-hidden">
            <WorldGraph />
            {showAutoBar && !showMctsBar && (
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
            {showMctsBar && (
              <MCTSControlBar
                runState={mcts.runState}
                onPause={mcts.pause}
                onResume={mcts.resume}
                onStop={mcts.stop}
                onOpenPanel={() => setMctsOpen(true)}
              />
            )}
            {!showAutoBar && !showMctsBar && <SceneInfoBar />}
            <FloatingPalette />
          </div>
          <NarrativePanel />
          <TimelineStrip />
          <ForceCharts />
        </div>
      </AppShell>
      {state.wizardOpen && <CreationWizard />}
      {generateOpen && <GeneratePanel onClose={() => setGenerateOpen(false)} />}
      {forkOpen && <BranchModal onClose={() => setForkOpen(false)} />}
      {autoSettingsOpen && (
        <AutoSettingsPanel
          onClose={() => setAutoSettingsOpen(false)}
          onStart={() => autoPlay.start()}
        />
      )}
      {cubeViewerOpen && (
        <NarrativeCubeViewer onClose={() => setCubeViewerOpen(false)} />
      )}
      {apiKeysOpen && <ApiKeyModal access={access} onClose={() => setApiKeysOpen(false)} />}
      {forceTrackerOpen && <ForceTracker onClose={() => setForceTrackerOpen(false)} />}
      {rulesOpen && <RulesPanel onClose={() => setRulesOpen(false)} />}
      {storySettingsOpen && <StorySettingsModal onClose={() => setStorySettingsOpen(false)} />}
      <MCTSPanel isOpen={mctsOpen} onClose={() => setMctsOpen(false)} mcts={mcts} />
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
