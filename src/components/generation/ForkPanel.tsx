'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { resolveEntry } from '@/types/narrative';

export function ForkPanel({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;

  const currentSceneId = state.resolvedSceneKeys[state.currentSceneIndex] ?? null;
  const [selectedSceneId, setSelectedSceneId] = useState(currentSceneId);
  const [branchName, setBranchName] = useState('');

  if (!narrative) return null;

  const selectedScene = selectedSceneId ? resolveEntry(narrative, selectedSceneId) : null;
  const selectedIdx = selectedSceneId ? state.resolvedSceneKeys.indexOf(selectedSceneId) : -1;

  function handleCreate() {
    if (!selectedSceneId || !narrative) return;
    const name = branchName.trim() || `Fork from scene ${selectedIdx + 1}`;
    const branchId = `B-${Date.now()}`;
    dispatch({
      type: 'CREATE_BRANCH',
      branch: {
        id: branchId,
        name,
        parentBranchId: state.activeBranchId,
        forkEntryId: selectedSceneId,
        entryIds: [],
        createdAt: Date.now(),
      },
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="glass max-w-lg w-full rounded-2xl p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none"
        >
          &times;
        </button>

        <h2 className="text-sm font-semibold text-text-primary mb-1">
          Fork Branch
        </h2>
        <p className="text-[10px] text-text-dim uppercase tracking-wider mb-4">
          Create a new timeline diverging from an existing scene
        </p>

        <div className="flex flex-col gap-4">
          {/* Branch Name */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">
              Branch Name
            </label>
            <input
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder={`Fork from scene ${selectedIdx + 1}`}
              className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary w-full outline-none placeholder:text-text-dim"
            />
          </div>

          {/* Fork Point Selector */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-text-dim block mb-1">
              Fork After Scene
            </label>
            <div className="max-h-48 overflow-y-auto bg-bg-elevated border border-border rounded-lg">
              {state.resolvedSceneKeys.map((sceneId, idx) => {
                const scene = resolveEntry(narrative, sceneId);
                if (!scene) return null;
                const isSelected = sceneId === selectedSceneId;
                const arc = Object.values(narrative.arcs).find((a) =>
                  a.sceneIds.includes(sceneId)
                );
                return (
                  <button
                    key={sceneId}
                    onClick={() => setSelectedSceneId(sceneId)}
                    className={`w-full text-left px-3 py-2 transition-colors border-b border-border last:border-b-0 ${
                      isSelected ? 'bg-white/8' : 'hover:bg-white/4'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-text-dim shrink-0 w-6 text-right">
                        {idx + 1}
                      </span>
                      <span className={`text-xs truncate ${isSelected ? 'text-text-primary' : 'text-text-secondary'}`}>
                        {scene.summary ? scene.summary.slice(0, 80) : sceneId}
                        {scene.summary && scene.summary.length > 80 ? '...' : ''}
                      </span>
                    </div>
                    {arc && (
                      <span className="text-[10px] text-text-dim ml-8">{arc.name}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected scene preview */}
          {selectedScene && (
            <div className="bg-bg-elevated rounded-lg px-3 py-2">
              <p className="text-[10px] text-text-dim uppercase tracking-wider mb-1">
                Forking after
              </p>
              <p className="text-xs text-text-secondary leading-relaxed">
                {selectedScene.summary || selectedScene.id}
              </p>
              <p className="text-[10px] text-text-dim mt-1">
                New branch will start empty — use Generate to add scenes.
              </p>
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={!selectedSceneId}
            className="bg-white/10 hover:bg-white/16 text-text-primary font-semibold px-4 py-2.5 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none"
          >
            Create Branch
          </button>
        </div>
      </div>
    </div>
  );
}
