'use client';

import { useStore } from '@/lib/store';
import { resolveEntry } from '@/types/narrative';
import { IconLocationPin, IconEye } from '@/components/icons';

export default function NarrativePanel() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  if (!narrative) return null;

  const currentKey = state.resolvedEntryKeys[state.currentSceneIndex];
  const entry = currentKey ? resolveEntry(narrative, currentKey) : null;

  if (!entry) return null;

  // Compute positional label (Scene 3, World 2, etc.)
  let sceneNum = 0;
  let worldNum = 0;
  let positionLabel = '';
  for (let i = 0; i <= state.currentSceneIndex && i < state.resolvedEntryKeys.length; i++) {
    const k = state.resolvedEntryKeys[i];
    if (narrative.scenes[k]) { sceneNum++; if (i === state.currentSceneIndex) positionLabel = `Scene ${sceneNum}`; }
    else if (narrative.worldBuilds[k]) { worldNum++; if (i === state.currentSceneIndex) positionLabel = `World ${worldNum}`; }
  }

  // World build commit view
  if (entry.kind === 'world_build') {
    const m = entry.expansionManifest;
    return (
      <div className="h-[180px] shrink-0 glass-panel border-t border-border overflow-y-auto px-4 py-3">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">
            {positionLabel || 'World Expansion'}
          </span>
          <span className="font-mono text-[10px] text-text-dim">{entry.id}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {m.characters.length > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">Characters</span>
              {m.characters.map((c) => narrative.characters[c.id]?.name ?? c.name).join(', ')}
            </div>
          )}
          {m.locations.length > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">Locations</span>
              {m.locations.map((l) => narrative.locations[l.id]?.name ?? l.name).join(', ')}
            </div>
          )}
          {m.threads.length > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">Threads</span>
              {m.threads.map((t) => narrative.threads[t.id]?.description ?? t.description).join(', ')}
            </div>
          )}
          {(m.relationships?.length ?? 0) > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">Relationships</span>
              {m.relationships.length} new
            </div>
          )}
          {(m.artifacts?.length ?? 0) > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">Artifacts</span>
              {m.artifacts!.map((a) => narrative.artifacts?.[a.id]?.name ?? a.name).join(', ')}
            </div>
          )}
          {(m.systemMutations?.addedNodes?.length ?? 0) > 0 && (
            <div className="text-xs text-text-secondary">
              <span className="text-text-dim uppercase text-[10px] tracking-wider mr-2">World Knowledge</span>
              {m.systemMutations.addedNodes.map((n) => n.concept).join(', ')}
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
          <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">
            {positionLabel}
          </span>
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
                <IconLocationPin size={12} className="text-text-dim" />
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
                <IconEye size={12} className="text-text-dim" />
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
