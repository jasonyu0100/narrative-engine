'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/store';
import type { NarrativeState } from '@/types/narrative';

function exportNarrative(narrative: NarrativeState) {
  const json = JSON.stringify(narrative, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${narrative.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TopBar() {
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeArc = narrative
    ? Object.values(narrative.arcs).find((a) =>
        a.sceneIds.includes(
          state.resolvedSceneKeys[state.currentSceneIndex] ?? ''
        )
      )
    : null;

  useEffect(() => {
    if (!selectorOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSelectorOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [selectorOpen]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target?.result as string) as NarrativeState;
        if (!imported.id || !imported.scenes || !imported.branches) {
          alert('Invalid narrative file');
          return;
        }
        dispatch({ type: 'REPLACE_NARRATIVE', narrative: imported });
        setSelectorOpen(false);
      } catch {
        alert('Failed to parse narrative file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [dispatch]);

  return (
    <div className="flex items-center justify-between h-11 bg-bg-panel border-b border-border px-3">
      {/* Left: series selector + arc breadcrumb */}
      <div className="flex items-center gap-1 text-sm min-w-0">
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setSelectorOpen((o) => !o)}
            className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-bg-elevated transition-colors"
          >
            <span className="text-text-primary truncate max-w-50">
              {narrative ? narrative.title : 'Select Narrative'}
            </span>
            <svg
              className={`w-3 h-3 text-text-dim transition-transform ${selectorOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {selectorOpen && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-bg-panel border border-border rounded-lg shadow-lg z-50 overflow-hidden">
              <div className="max-h-75 overflow-y-auto py-1">
                {state.narratives.length === 0 ? (
                  <p className="text-xs text-text-dim px-3 py-3">No narratives yet</p>
                ) : (
                  state.narratives.map((entry) => {
                    const isActive = state.activeNarrativeId === entry.id;
                    const isDeleting = deletingId === entry.id;
                    return (
                      <div key={entry.id}>
                        <div className={`flex items-center transition-colors ${
                          isActive ? 'bg-bg-overlay' : 'hover:bg-bg-elevated'
                        }`}>
                          <button
                            onClick={() => {
                              dispatch({ type: 'SET_ACTIVE_NARRATIVE', id: entry.id });
                              setSelectorOpen(false);
                            }}
                            className="flex-1 text-left px-3 py-2 min-w-0"
                          >
                            <div className="text-sm text-text-primary truncate">{entry.title}</div>
                            <div className="text-xs text-text-dim truncate">{entry.description}</div>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingId(isDeleting ? null : entry.id);
                              setDeleteConfirm('');
                            }}
                            className="px-2 py-1 mr-1 text-text-dim hover:text-pressure text-xs transition-colors shrink-0"
                            title="Delete narrative"
                          >
                            &times;
                          </button>
                        </div>
                        {isDeleting && (
                          <div className="px-3 py-2 bg-bg-elevated border-t border-border">
                            <p className="text-[10px] text-text-dim mb-1.5">
                              Type <span className="text-text-secondary font-medium">{entry.title}</span> to confirm
                            </p>
                            <input
                              type="text"
                              value={deleteConfirm}
                              onChange={(e) => setDeleteConfirm(e.target.value)}
                              placeholder={entry.title}
                              className="bg-bg-panel border border-border rounded px-2 py-1 text-xs text-text-primary w-full outline-none placeholder:text-text-dim/30 mb-1.5"
                              autoFocus
                            />
                            <button
                              onClick={() => {
                                if (deleteConfirm === entry.title) {
                                  dispatch({ type: 'DELETE_NARRATIVE', id: entry.id });
                                  setDeletingId(null);
                                  setDeleteConfirm('');
                                }
                              }}
                              disabled={deleteConfirm !== entry.title}
                              className="w-full text-xs font-medium py-1 rounded transition-colors bg-pressure/20 text-pressure hover:bg-pressure/30 disabled:opacity-30 disabled:pointer-events-none"
                            >
                              Delete permanently
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="border-t border-border flex flex-col">
                <button
                  onClick={() => {
                    dispatch({ type: 'OPEN_WIZARD' });
                    setSelectorOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-bg-elevated transition-colors"
                >
                  <span className="w-5 h-5 rounded bg-bg-elevated flex items-center justify-center text-xs">+</span>
                  New Narrative
                </button>
                <button
                  onClick={() => {
                    handleImport();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-bg-elevated transition-colors"
                >
                  <span className="w-5 h-5 rounded bg-bg-elevated flex items-center justify-center text-[10px]">&uarr;</span>
                  Import JSON
                </button>
                {narrative && (
                  <button
                    onClick={() => {
                      exportNarrative(narrative);
                      setSelectorOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-bg-elevated transition-colors"
                  >
                    <span className="w-5 h-5 rounded bg-bg-elevated flex items-center justify-center text-[10px]">&darr;</span>
                    Export JSON
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />

        {activeArc && (
          <>
            <span className="text-text-dim mx-1">&middot;</span>
            <span className="text-text-secondary truncate">{activeArc.name}</span>
          </>
        )}
      </div>

      {/* Right spacer */}
      <div />
    </div>
  );
}
