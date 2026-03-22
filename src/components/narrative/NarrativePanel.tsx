'use client';

import { useStore } from '@/lib/store';
import { resolveEntry } from '@/types/narrative';

export default function NarrativePanel() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  if (!narrative) return null;

  const currentKey = state.resolvedSceneKeys[state.currentSceneIndex];
  const entry = currentKey ? resolveEntry(narrative, currentKey) : null;

  if (!entry) return null;

  // World build commit view
  if (entry.kind === 'world_build') {
    const m = entry.expansionManifest;
    return (
      <div className="h-[180px] shrink-0 glass-panel border-t border-border overflow-y-auto px-4 py-3">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">
            World Expansion
          </span>
          <span className="font-mono text-[10px] text-text-dim">{entry.id}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {m.characterIds.length > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">Characters</span>
              {m.characterIds.map((id) => narrative.characters[id]?.name ?? id).join(', ')}
            </div>
          )}
          {m.locationIds.length > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">Locations</span>
              {m.locationIds.map((id) => narrative.locations[id]?.name ?? id).join(', ')}
            </div>
          )}
          {m.threadIds.length > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">Threads</span>
              {m.threadIds.map((id) => narrative.threads[id]?.description ?? id).join(', ')}
            </div>
          )}
          {m.relationshipCount > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">Relationships</span>
              {m.relationshipCount} new
            </div>
          )}
        </div>
      </div>
    );
  }

  // Scene commit view — entry is narrowed to Scene after the world_build return
  const scene = entry;
  const location = narrative.locations[scene.locationId];
  const effectivePovId = scene.povId || scene.participantIds[0];
  const povCharacter = effectivePovId ? narrative.characters[effectivePovId] : null;
  const arc = Object.values(narrative.arcs).find((a) =>
    a.sceneIds.includes(scene.id),
  );

  return (
    <div className="h-[180px] shrink-0 glass-panel border-t border-border overflow-y-auto px-4 py-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono text-[10px] text-text-dim">{scene.id}</span>
          {arc && (
            <span className="text-[10px] text-text-dim uppercase tracking-wider">
              {arc.name}
            </span>
          )}
          {location && (
            <>
              <span className="text-text-dim text-[10px]">&middot;</span>
              <button
                type="button"
                onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'location', locationId: location.id } })}
                className="flex items-center gap-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors"
              >
                <svg className="w-3 h-3 text-text-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                  <circle cx="12" cy="9" r="2.5" />
                </svg>
                {location.name}
              </button>
            </>
          )}
          {povCharacter && (
            <>
              <span className="text-text-dim text-[10px]">&middot;</span>
              <button
                type="button"
                onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'character', characterId: effectivePovId } })}
                className="flex items-center gap-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors"
              >
                <svg className="w-3 h-3 text-text-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                {povCharacter.name}
              </button>
            </>
          )}
        </div>
      </div>
      <p className="text-sm leading-relaxed text-text-primary">{scene.summary || 'No summary available.'}</p>
    </div>
  );
}
