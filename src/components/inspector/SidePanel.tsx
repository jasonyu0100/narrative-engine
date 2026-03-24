'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import EmptyState from './EmptyState';
import SceneDetail from './SceneDetail';
import CharacterDetail from './CharacterDetail';
import LocationDetail from './LocationDetail';
import ThreadDetail from './ThreadDetail';
import ArcDetail from './ArcDetail';
import KnowledgeDetail from './KnowledgeDetail';
import ChatPanel from '@/components/sidebar/ChatPanel';
import NotesPanel from '@/components/sidebar/NotesPanel';
import { isScene, isWorldBuild, type TimelineEntry } from '@/types/narrative';

type Tab = 'inspector' | 'chat' | 'notes';

function getDefaultContext(state: ReturnType<typeof useStore>['state']) {
  const narrative = state.activeNarrative;
  if (!narrative) return null;

  // Use the current timeline entry to surface its most prominent node
  const currentKey = state.resolvedSceneKeys[state.currentSceneIndex];
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
  }

  if (entry && isWorldBuild(entry)) {
    const firstChar = entry.expansionManifest.characterIds[0];
    if (firstChar && narrative.characters[firstChar]) {
      return { type: 'character' as const, characterId: firstChar };
    }
    const firstLoc = entry.expansionManifest.locationIds[0];
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
      default:
        return <EmptyState />;
    }
  }

  return (
    <aside className="h-full flex flex-col border-l border-border glass-panel">
      {/* Tab bar */}
      <div className="shrink-0 flex border-b border-border">
        {(['inspector', 'chat', 'notes'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-2 text-[11px] font-medium transition-colors capitalize ${
              tab === t
                ? 'text-text-primary border-b border-accent'
                : 'text-text-dim hover:text-text-secondary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
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
    </aside>
  );
}
