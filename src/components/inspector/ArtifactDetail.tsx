'use client';

import React from 'react';
import { useStore } from '@/lib/store';
import { CollapsibleSection } from './CollapsibleSection';

type Props = {
  artifactId: string;
};

const significanceClasses: Record<string, string> = {
  key: 'text-amber-400',
  notable: 'text-amber-300/70',
  minor: 'text-text-secondary',
};

export default function ArtifactDetail({ artifactId }: Props) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  if (!narrative) return null;

  const artifact = narrative.artifacts[artifactId];
  if (!artifact) return <p className="p-4 text-xs text-text-dim">Artifact not found.</p>;

  const ownerName = narrative.characters[artifact.parentId]?.name
    ?? narrative.locations[artifact.parentId]?.name
    ?? artifact.parentId;
  const ownerIsCharacter = !!narrative.characters[artifact.parentId];

  // Ownership history — scan scenes for transfers involving this artifact
  const ownershipHistory: { sceneId: string; fromName: string; toName: string }[] = [];
  for (const key of state.resolvedEntryKeys) {
    const scene = narrative.scenes[key];
    if (!scene) continue;
    for (const om of scene.ownershipMutations ?? []) {
      if (om.artifactId !== artifactId) continue;
      const fromName = narrative.characters[om.fromId]?.name ?? narrative.locations[om.fromId]?.name ?? om.fromId;
      const toName = narrative.characters[om.toId]?.name ?? narrative.locations[om.toId]?.name ?? om.toId;
      ownershipHistory.push({ sceneId: key, fromName, toName });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Name + ID */}
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-text-primary">{artifact.name}</h2>
        <span className="font-mono text-[10px] text-text-dim">{artifactId}</span>
        <span className={`text-[10px] uppercase tracking-widest ${significanceClasses[artifact.significance] ?? 'text-text-dim'}`}>
          {artifact.significance}
        </span>
      </div>

      {/* Current owner */}
      <p className="text-xs text-text-secondary">
        owned by{' '}
        <button
          type="button"
          onClick={() => dispatch({
            type: 'SET_INSPECTOR',
            context: ownerIsCharacter
              ? { type: 'character', characterId: artifact.parentId }
              : { type: 'location', locationId: artifact.parentId },
          })}
          className="text-text-primary hover:underline transition-colors"
        >
          {ownerName}
        </button>
      </p>

      {/* Continuity — lore, properties, history */}
      {artifact.continuity.nodes.length > 0 && (
        <CollapsibleSection title="Continuity" count={artifact.continuity.nodes.length} defaultOpen>
          <ul className="flex flex-col gap-1">
            {artifact.continuity.nodes.map((node, i) => (
              <li key={`${node.id}-${i}`} className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-400/50" />
                <div className="flex flex-col">
                  <span className="text-xs text-text-primary">{node.content}</span>
                  <span className="text-[10px] text-text-dim">{node.type}</span>
                </div>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {/* Ownership history */}
      {ownershipHistory.length > 0 && (
        <CollapsibleSection title="Transfer History" count={ownershipHistory.length}>
          <ul className="flex flex-col gap-1">
            {ownershipHistory.map((entry, i) => (
              <li key={`transfer-${i}`} className="flex items-center gap-1.5 text-xs">
                <span className="text-text-dim">{entry.fromName}</span>
                <span className="text-text-dim">→</span>
                <span className="text-text-primary">{entry.toName}</span>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}
    </div>
  );
}
