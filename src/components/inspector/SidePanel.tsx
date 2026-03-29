'use client';

import { useState } from 'react';
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
import ChatPanel from '@/components/sidebar/ChatPanel';
import NotesPanel from '@/components/sidebar/NotesPanel';
import BranchEval from '@/components/timeline/BranchEval';
import { isScene, type TimelineEntry } from '@/types/narrative';

type Tab = 'inspector' | 'chat' | 'notes' | 'eval';

const TAB_LABELS: Record<Tab, string> = {
  inspector: 'Inspector',
  chat: 'Chat',
  notes: 'Notes',
  eval: 'Eval',
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
  const { state } = useStore();
  const ctx = state.inspectorContext ?? getDefaultContext(state);
  const [tab, setTab] = useState<Tab>('inspector');

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
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            {renderInspector()}
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
          <div className="flex-1 min-h-0">
            <BranchEval />
          </div>
        )}
      </div>
    </aside>
  );
}
