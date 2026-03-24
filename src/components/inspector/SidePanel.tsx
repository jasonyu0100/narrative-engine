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

type Tab = 'inspector' | 'chat';

export default function SidePanel() {
  const { state } = useStore();
  const ctx = state.inspectorContext;
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
        <button
          onClick={() => setTab('inspector')}
          className={`flex-1 px-3 py-2 text-[11px] font-medium transition-colors ${
            tab === 'inspector'
              ? 'text-text-primary border-b border-accent'
              : 'text-text-dim hover:text-text-secondary'
          }`}
        >
          Inspector
        </button>
        <button
          onClick={() => setTab('chat')}
          className={`flex-1 px-3 py-2 text-[11px] font-medium transition-colors ${
            tab === 'chat'
              ? 'text-text-primary border-b border-accent'
              : 'text-text-dim hover:text-text-secondary'
          }`}
        >
          Chat
        </button>
      </div>

      {/* Content */}
      {tab === 'inspector' ? (
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {renderInspector()}
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <ChatPanel />
        </div>
      )}
    </aside>
  );
}
