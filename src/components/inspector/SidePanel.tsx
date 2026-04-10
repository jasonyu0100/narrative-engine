'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/lib/store';
import type { WorldBuild } from '@/types/narrative';
import EmptyState from './EmptyState';
import SceneDetail from './SceneDetail';
import CharacterDetail from './CharacterDetail';
import LocationDetail from './LocationDetail';
import ThreadDetail from './ThreadDetail';
import ArcDetail from './ArcDetail';
import KnowledgeDetail from './KnowledgeDetail';
import ArtifactDetail from './ArtifactDetail';
import ContinuityNodeDetail from './ContinuityNodeDetail';
import ThreadLogNodeDetail from './ThreadLogNodeDetail';
import ChatPanel from '@/components/sidebar/ChatPanel';
import NotesPanel from '@/components/sidebar/NotesPanel';
import BranchEval from '@/components/timeline/BranchEval';
import ProseEval from '@/components/timeline/ProseEval';
import PlanEval from '@/components/timeline/PlanEval';
import ContinuityEval from '@/components/timeline/ContinuityEval';
import { type SceneRange } from '@/components/timeline/SceneRangeSelector';
import { isScene, type TimelineEntry } from '@/types/narrative';

type Tab = 'inspector' | 'chat' | 'notes' | 'eval';

const TAB_LABELS: Record<Tab, string> = {
  inspector: 'Inspector',
  chat: 'Chat',
  notes: 'Notes',
  eval: 'Review',
};

function getDefaultContext(state: ReturnType<typeof useStore>['state']) {
  const narrative = state.activeNarrative;
  if (!narrative) return null;

  // Use the current timeline entry to surface its most prominent node
  const currentKey = state.resolvedEntryKeys[state.currentSceneIndex];
  const entry: TimelineEntry | null = currentKey
    ? (narrative.scenes[currentKey] ?? narrative.worldBuilds?.[currentKey] ?? null)
    : null;

  if (entry && isScene(entry)) {
    const firstParticipant = entry.participantIds?.[0];
    if (firstParticipant && narrative.characters[firstParticipant]) {
      return { type: 'character' as const, characterId: firstParticipant };
    }
    if (entry.locationId && narrative.locations[entry.locationId]) {
      return { type: 'location' as const, locationId: entry.locationId };
    }
  } else if (entry) {
    const wb = entry as WorldBuild;
    const firstChar = wb.expansionManifest?.characters?.[0]?.id;
    if (firstChar && narrative.characters[firstChar]) {
      return { type: 'character' as const, characterId: firstChar };
    }
    const firstLoc = wb.expansionManifest?.locations?.[0]?.id;
    if (firstLoc && narrative.locations[firstLoc]) {
      return { type: 'location' as const, locationId: firstLoc };
    }
  }

  // Fallback: most prominent character across all scenes
  const characters = Object.values(narrative.characters ?? {});
  const locations = Object.values(narrative.locations ?? {});
  if (characters.length === 0 && locations.length === 0) return null;

  const charScores: Record<string, number> = {};
  for (const ch of characters) charScores[ch.id] = 0;
  for (const scene of Object.values(narrative.scenes ?? {})) {
    for (const id of scene.participantIds ?? []) {
      if (id in charScores) charScores[id]++;
    }
  }

  const topChar = characters
    .filter(c => c.role === 'anchor')
    .concat(characters.filter(c => c.role !== 'anchor'))
    .sort((a, b) => (charScores[b.id] ?? 0) - (charScores[a.id] ?? 0))[0];
  if (topChar) return { type: 'character' as const, characterId: topChar.id };

  if (locations.length > 0) return { type: 'location' as const, locationId: locations[0].id };

  return null;
}

export default function SidePanel() {
  const { state, dispatch } = useStore();
  const ctx = state.inspectorContext ?? getDefaultContext(state);
  const [tab, setTab] = useState<Tab>('inspector');

  // Auto-switch to inspector tab when a new inspector context is set
  useEffect(() => {
    if (state.inspectorContext) setTab('inspector');
  }, [state.inspectorContext]);
  const [evalMode, setEvalMode] = useState<'branch' | 'prose' | 'plan' | 'continuity'>('branch');
  const [evalRange, setEvalRange] = useState<SceneRange>(null);

  function renderInspector() {
    if (!ctx) return <EmptyState />;

    switch (ctx.type) {
      case 'scene':
        return <SceneDetail sceneId={ctx.sceneId} />;
      case 'character':
        return <CharacterDetail characterId={ctx.characterId} />;
      case 'location':
        return <LocationDetail locationId={ctx.locationId} />;
      case 'thread':
        return <ThreadDetail threadId={ctx.threadId} />;
      case 'arc':
        return <ArcDetail arcId={ctx.arcId} />;
      case 'knowledge':
        return <KnowledgeDetail nodeId={ctx.nodeId} />;
      case 'artifact':
        return <ArtifactDetail artifactId={ctx.artifactId} />;
      case 'continuity':
        return <ContinuityNodeDetail entityId={ctx.entityId} nodeId={ctx.nodeId} />;
      case 'threadLog':
        return <ThreadLogNodeDetail threadId={ctx.threadId} nodeId={ctx.nodeId} />;
      default:
        return <EmptyState />;
    }
  }

  return (
    <aside className="h-full flex flex-row border-l border-border glass-panel">
      {/* Vertical tab rail */}
      <div className="shrink-0 flex flex-col items-center py-2 w-7 border-r border-border">
        {(['inspector', 'chat', 'notes', 'eval'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`py-3 w-full flex items-center justify-center transition-colors relative ${
              tab === t
                ? 'text-text-primary border-r border-accent'
                : 'text-text-dim hover:text-text-secondary'
            }`}
          >
            <span
              className="text-[10px] font-medium tracking-wider uppercase"
              style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)' }}
            >
              {TAB_LABELS[t]}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {tab === 'inspector' && (
          <div className="flex-1 overflow-y-auto min-h-0">
            {state.inspectorHistory.length > 0 && (
              <div className="sticky top-0 z-10 flex items-center gap-1 px-3 py-1.5 border-b border-border bg-bg-base/90 backdrop-blur-sm">
                <button
                  onClick={() => dispatch({ type: 'INSPECTOR_BACK' })}
                  className="text-[10px] text-text-dim hover:text-text-secondary transition-colors flex items-center gap-1"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
                  Back
                </button>
              </div>
            )}
            <div className="p-4">
              {renderInspector()}
            </div>
          </div>
        )}
        {tab === 'chat' && (
          <div className="flex-1 min-h-0">
            <ChatPanel />
          </div>
        )}
        {tab === 'notes' && (
          <div className="flex-1 min-h-0 flex flex-col">
            <NotesPanel />
          </div>
        )}
        {tab === 'eval' && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="shrink-0 flex border-b border-white/5">
              {(['branch', 'plan', 'prose', 'continuity'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setEvalMode(m)}
                  className={`flex-1 text-[10px] py-1.5 font-medium transition-colors ${evalMode === m ? 'text-text-primary border-b border-accent' : 'text-text-dim hover:text-text-secondary'}`}
                >
                  {{ branch: 'Structure', plan: 'Plan', prose: 'Prose', continuity: 'Continuity' }[m]}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0 relative">
              <div className={`absolute inset-0 ${evalMode === 'branch' ? '' : 'hidden'}`}><BranchEval sceneRange={evalRange} onRangeChange={setEvalRange} /></div>
              <div className={`absolute inset-0 ${evalMode === 'plan' ? '' : 'hidden'}`}><PlanEval sceneRange={evalRange} onRangeChange={setEvalRange} /></div>
              <div className={`absolute inset-0 ${evalMode === 'prose' ? '' : 'hidden'}`}><ProseEval sceneRange={evalRange} onRangeChange={setEvalRange} /></div>
              <div className={`absolute inset-0 ${evalMode === 'continuity' ? '' : 'hidden'}`}><ContinuityEval sceneRange={evalRange} onRangeChange={setEvalRange} /></div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
