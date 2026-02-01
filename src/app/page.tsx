'use client';

import { useState, useEffect } from 'react';
import { StoreProvider, useStore } from '@/lib/store';
import AppShell from '@/components/layout/AppShell';
import Sidebar from '@/components/sidebar/Sidebar';
import SidePanel from '@/components/inspector/SidePanel';
import WorldGraph from '@/components/canvas/WorldGraph';
import FloatingPalette from '@/components/canvas/FloatingPalette';
import TimelineStrip from '@/components/timeline/TimelineStrip';
import ForceCharts from '@/components/timeline/ForceCharts';
import NarrativePanel from '@/components/narrative/NarrativePanel';
import { CreationWizard } from '@/components/wizard/CreationWizard';
import { NarrativesScreen } from '@/components/narratives/NarrativesScreen';
import { GeneratePanel } from '@/components/generation/GeneratePanel';
import { ForkPanel } from '@/components/generation/ForkPanel';
import { AutoSettingsPanel } from '@/components/auto/AutoSettingsPanel';
import { AutoControlBar } from '@/components/auto/AutoControlBar';
import { useAutoPlay } from '@/hooks/useAutoPlay';

function NarrativeApp() {
  const { state } = useStore();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [autoSettingsOpen, setAutoSettingsOpen] = useState(false);
  const autoPlay = useAutoPlay();

  useEffect(() => {
    function handleOpenGenerate() { setGenerateOpen(true); }
    function handleOpenFork() { setForkOpen(true); }
    function handleOpenAutoSettings() { setAutoSettingsOpen(true); }
    window.addEventListener('open-generate-panel', handleOpenGenerate);
    window.addEventListener('open-fork-panel', handleOpenFork);
    window.addEventListener('open-auto-settings', handleOpenAutoSettings);
    return () => {
      window.removeEventListener('open-generate-panel', handleOpenGenerate);
      window.removeEventListener('open-fork-panel', handleOpenFork);
      window.removeEventListener('open-auto-settings', handleOpenAutoSettings);
    };
  }, []);

  if (!state.activeNarrativeId) {
    return (
      <>
        <NarrativesScreen />
        {state.wizardOpen && <CreationWizard />}
      </>
    );
  }

  const showAutoBar = state.autoRunState && (state.autoRunState.isRunning || state.autoRunState.isPaused || state.autoRunState.log.length > 0);

  return (
    <>
      <AppShell
        sidebar={<Sidebar />}
        sidepanel={<SidePanel />}
      >
        <div className="relative flex flex-col h-full">
          {/* World Graph Canvas */}
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

          {/* Narrative Panel — prose summary */}
          <NarrativePanel />

          {/* Timeline Strip */}
          <TimelineStrip />

          {/* Force Charts */}
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
    </>
  );
}

export default function Home() {
  return (
    <StoreProvider>
      <NarrativeApp />
    </StoreProvider>
  );
}
