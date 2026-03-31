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
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { AutoSettingsPanel } from '@/components/auto/AutoSettingsPanel';
import { AutoControlBar } from '@/components/auto/AutoControlBar';
import { AutoLogModal } from '@/components/auto/AutoLogModal';
import { NarrativeCubeViewer } from '@/components/timeline/NarrativeCubeViewer';
import { useAutoPlay } from '@/hooks/useAutoPlay';
import { ForceAnalytics } from '@/components/analytics/ForceAnalytics';
import { CastAnalytics } from '@/components/analytics/CastAnalytics';
import RulesPanel from '@/components/layout/RulesPanel';
import WorldSystemsPanel from '@/components/layout/WorldSystemsPanel';
import ProseProfilePanel from '@/components/layout/ProseProfilePanel';
import { MCTSPanel } from '@/components/mcts/MCTSPanel';
import { MCTSControlBar } from '@/components/mcts/MCTSControlBar';
import { useMCTS } from '@/hooks/useMCTS';
import { StorySettingsModal } from '@/components/settings/StorySettingsModal';
import { PlanningIndicator } from '@/components/planning/PlanningIndicator';
import { PlanningQueueEditor } from '@/components/planning/PlanningQueueEditor';
import { usePlanningQueue } from '@/hooks/usePlanningQueue';

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
  const [autoLogOpen, setAutoLogOpen] = useState(false);
  const [cubeViewerOpen, setCubeViewerOpen] = useState(false);
  const [forceAnalyticsOpen, setForceAnalyticsOpen] = useState(false);
  const [castAnalyticsOpen, setCastAnalyticsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [worldSystemsOpen, setWorldSystemsOpen] = useState(false);
  const [proseProfileOpen, setProseProfileOpen] = useState(false);
  const [mctsOpen, setMctsOpen] = useState(false);
  const [storySettingsOpen, setStorySettingsOpen] = useState(false);
  const [planningQueueOpen, setPlanningQueueOpen] = useState(false);
  const autoPlay = useAutoPlay();
  const mcts = useMCTS();
  const planning = usePlanningQueue();
  const id = params.id as string;

  // Activate narrative from URL param
  useEffect(() => {
    if (id && state.activeNarrativeId !== id) {
      const exists = state.narratives.some((n) => n.id === id);
      if (exists) {
        dispatch({ type: 'SET_ACTIVE_NARRATIVE', id });
      } else if (state.narratives.length > 0) {
        // Only redirect after hydration — empty list means narratives haven't loaded yet
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
    function handleOpenForceAnalytics() { setForceAnalyticsOpen(true); }
    function handleOpenCastAnalytics() { setCastAnalyticsOpen(true); }
    function handleOpenRules() { setRulesOpen(true); }
    function handleOpenWorldSystems() { setWorldSystemsOpen(true); }
    function handleOpenProseProfile() { setProseProfileOpen(true); }
    function handleOpenMcts() { setMctsOpen(true); }
    function handleOpenStorySettings() { setStorySettingsOpen(true); }
    function handleOpenPlanningQueue() { setPlanningQueueOpen(true); }
    window.addEventListener('open-generate-panel', handleOpenGenerate);
    window.addEventListener('open-branch-modal', handleOpenFork);
    window.addEventListener('open-auto-settings', handleOpenAutoSettings);
    window.addEventListener('open-cube-viewer', handleOpenCubeViewer);
    window.addEventListener('open-force-analytics', handleOpenForceAnalytics);
    window.addEventListener('open-cast-analytics', handleOpenCastAnalytics);
    window.addEventListener('open-rules-panel', handleOpenRules);
    window.addEventListener('open-world-systems-panel', handleOpenWorldSystems);
    window.addEventListener('open-prose-profile', handleOpenProseProfile);
    window.addEventListener('open-mcts-panel', handleOpenMcts);
    window.addEventListener('open-story-settings', handleOpenStorySettings);
    window.addEventListener('open-planning-queue', handleOpenPlanningQueue);
    return () => {
      window.removeEventListener('open-generate-panel', handleOpenGenerate);
      window.removeEventListener('open-branch-modal', handleOpenFork);
      window.removeEventListener('open-auto-settings', handleOpenAutoSettings);
      window.removeEventListener('open-cube-viewer', handleOpenCubeViewer);
      window.removeEventListener('open-force-analytics', handleOpenForceAnalytics);
      window.removeEventListener('open-cast-analytics', handleOpenCastAnalytics);
      window.removeEventListener('open-rules-panel', handleOpenRules);
      window.removeEventListener('open-world-systems-panel', handleOpenWorldSystems);
      window.removeEventListener('open-prose-profile', handleOpenProseProfile);
      window.removeEventListener('open-mcts-panel', handleOpenMcts);
      window.removeEventListener('open-story-settings', handleOpenStorySettings);
      window.removeEventListener('open-planning-queue', handleOpenPlanningQueue);
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
                statusMessage={state.autoRunState?.statusMessage ?? ''}
                log={autoPlay.log}
                onPause={autoPlay.pause}
                onResume={autoPlay.resume}
                onStop={autoPlay.stop}
                onOpenSettings={() => setAutoSettingsOpen(true)}
                onOpenLog={() => setAutoLogOpen(true)}
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
            {planning.queue && (
              <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10">
                <PlanningIndicator queue={planning.queue} onClick={() => setPlanningQueueOpen(true)} />
              </div>
            )}
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
      {autoLogOpen && (
        <AutoLogModal
          log={autoPlay.log}
          onClose={() => setAutoLogOpen(false)}
        />
      )}
      {cubeViewerOpen && (
        <NarrativeCubeViewer onClose={() => setCubeViewerOpen(false)} />
      )}
      {forceAnalyticsOpen && <ForceAnalytics onClose={() => setForceAnalyticsOpen(false)} />}
      {castAnalyticsOpen && <CastAnalytics onClose={() => setCastAnalyticsOpen(false)} />}
      {rulesOpen && <RulesPanel onClose={() => setRulesOpen(false)} />}
      {worldSystemsOpen && <WorldSystemsPanel onClose={() => setWorldSystemsOpen(false)} />}
      {proseProfileOpen && <ProseProfilePanel onClose={() => setProseProfileOpen(false)} />}
      {storySettingsOpen && <StorySettingsModal onClose={() => setStorySettingsOpen(false)} />}
      {planningQueueOpen && (
        <PlanningQueueEditor
          onClose={() => setPlanningQueueOpen(false)}
          onStartAuto={() => {
            // When starting from planning queue, use planning_complete as the sole end condition
            dispatch({
              type: 'SET_AUTO_CONFIG',
              config: { ...state.autoConfig, endConditions: [{ type: 'planning_complete' }] },
            });
            autoPlay.start();
          }}
        />
      )}
      {planning.phaseJustCompleted && (
        <Modal onClose={planning.dismissCompletion} size="sm">
          <ModalHeader onClose={planning.dismissCompletion}>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Phase Complete</h2>
              <p className="text-[10px] text-text-dim mt-0.5">{planning.phaseJustCompleted.name}</p>
            </div>
          </ModalHeader>
          <ModalBody>
            <p className="text-[11px] text-text-secondary leading-relaxed">{planning.phaseJustCompleted.summary}</p>
            {planning.phaseJustCompleted.nextPhaseName && (
              <div className="mt-4 rounded-lg border border-white/8 bg-white/3 p-3">
                <p className="text-[10px] text-text-dim uppercase tracking-wider mb-1">Next Phase</p>
                <p className="text-xs text-text-primary font-medium">{planning.phaseJustCompleted.nextPhaseName}</p>
                <p className="text-[10px] text-text-dim mt-1">Generate world and direction for the next phase, or skip to generate scenes with existing settings.</p>
              </div>
            )}
            {!planning.phaseJustCompleted.nextPhaseName && (
              <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <p className="text-xs text-emerald-400 font-medium">All phases complete</p>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <button onClick={planning.dismissCompletion}
              className="px-4 text-xs font-medium py-2 rounded-lg text-text-dim hover:text-text-secondary hover:bg-white/6 transition-colors">
              Skip
            </button>
            {planning.phaseJustCompleted.nextPhaseName && (
              <button onClick={() => { planning.dismissCompletion(); setPlanningQueueOpen(true); }}
                className="px-4 text-xs font-semibold py-2 rounded-lg bg-white/12 text-text-primary hover:bg-white/16 transition-colors">
                Set Up Next Phase
              </button>
            )}
          </ModalFooter>
        </Modal>
      )}
      <MCTSPanel isOpen={mctsOpen} onClose={() => setMctsOpen(false)} mcts={mcts} />
      {isMobile && (
        <div className="fixed inset-0 z-9999 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center px-6 text-center">
          <p className="text-white/90 text-lg font-semibold mb-2">Desktop Only</p>
          <p className="text-white/40 text-sm leading-relaxed max-w-xs mb-6">
            InkTide is designed for desktop browsers. Please visit on a larger screen.
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
