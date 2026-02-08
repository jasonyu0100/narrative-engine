'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import type { NarrativeState } from '@/types/narrative';
import { ApiLogsModal } from '@/components/debug/ApiLogsModal';
import { StoryReader } from '@/components/story/StoryReader';


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
  const router = useRouter();
  const { state, dispatch } = useStore();
  const narrative = state.activeNarrative;
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [logsOpen, setLogsOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
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
        // Always create a new series with a fresh ID
        const newId = crypto.randomUUID();
        const newNarrative = { ...imported, id: newId };
        dispatch({ type: 'ADD_NARRATIVE', narrative: newNarrative });
        setSelectorOpen(false);
        router.push(`/series/${newId}`);
      } catch {
        alert('Failed to parse narrative file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [dispatch, router]);

  return (
    <div className="flex items-center justify-between h-11 glass-panel border-b border-border px-3">
      {/* Left: home + title + arc breadcrumb */}
      <div className="flex items-center gap-1 text-sm min-w-0">
        {/* Home button */}
        <button
          onClick={() => router.push('/')}
          className="px-2 py-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary"
          title="All series"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" />
          </svg>
        </button>

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
            <div
              className="absolute top-full left-0 mt-1.5 w-72 rounded-xl border border-white/10 z-50 overflow-hidden"
              style={{ background: '#1a1a1a', boxShadow: '0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)' }}
            >
              <div className="max-h-80 overflow-y-auto py-1.5">
                {state.narratives.length === 0 ? (
                  <p className="text-xs text-text-dim px-4 py-4 text-center">No narratives yet</p>
                ) : (
                  state.narratives.map((entry) => {
                    const isActive = state.activeNarrativeId === entry.id;
                    const isDeleting = deletingId === entry.id;
                    return (
                      <div key={entry.id}>
                        <div className={`flex items-center mx-1.5 rounded-lg transition-colors ${
                          isActive ? 'bg-white/8' : 'hover:bg-white/5'
                        }`}>
                          <button
                            onClick={() => {
                              setSelectorOpen(false);
                              router.push(`/series/${entry.id}`);
                            }}
                            className="flex-1 text-left px-3 py-2.5 min-w-0"
                          >
                            <div className="text-[13px] text-text-primary truncate leading-snug">{entry.title}</div>
                            <div className="text-[11px] text-text-dim truncate mt-0.5 leading-snug">{entry.description}</div>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingId(isDeleting ? null : entry.id);
                              setDeleteConfirm('');
                            }}
                            className="px-2.5 py-1 mr-1.5 text-text-dim hover:text-stakes text-xs rounded transition-colors shrink-0 hover:bg-white/5"
                            title="Delete narrative"
                          >
                            &times;
                          </button>
                        </div>
                        {isDeleting && (
                          <div className="mx-1.5 px-3 py-2.5 mb-1 rounded-lg" style={{ background: 'rgba(239,68,68,0.06)' }}>
                            <p className="text-[10px] text-text-dim mb-1.5">
                              Type <span className="text-text-secondary font-medium">{entry.title}</span> to confirm
                            </p>
                            <input
                              type="text"
                              value={deleteConfirm}
                              onChange={(e) => setDeleteConfirm(e.target.value)}
                              placeholder={entry.title}
                              className="bg-white/5 border border-white/8 rounded-md px-2.5 py-1.5 text-xs text-text-primary w-full outline-none placeholder:text-text-dim/30 mb-2 focus:border-white/15 transition-colors"
                              autoFocus
                            />
                            <button
                              onClick={() => {
                                if (deleteConfirm === entry.title) {
                                  dispatch({ type: 'DELETE_NARRATIVE', id: entry.id });
                                  setDeletingId(null);
                                  setDeleteConfirm('');
                                  if (isActive) router.push('/');
                                }
                              }}
                              disabled={deleteConfirm !== entry.title}
                              className="w-full text-xs font-medium py-1.5 rounded-md transition-colors bg-stakes/20 text-stakes hover:bg-stakes/30 disabled:opacity-30 disabled:pointer-events-none"
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
              <div className="border-t border-white/8 py-1.5">
                <button
                  onClick={() => {
                    dispatch({ type: 'OPEN_WIZARD' });
                    setSelectorOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
                >
                  <span className="w-5 h-5 rounded-md bg-white/8 flex items-center justify-center text-xs">+</span>
                  New Narrative
                </button>
                <button
                  onClick={() => {
                    handleImport();
                  }}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
                >
                  <span className="w-5 h-5 rounded-md bg-white/8 flex items-center justify-center text-[10px]">&uarr;</span>
                  Import JSON
                </button>
                {narrative && (
                  <button
                    onClick={() => {
                      exportNarrative(narrative);
                      setSelectorOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
                  >
                    <span className="w-5 h-5 rounded-md bg-white/8 flex items-center justify-center text-[10px]">&darr;</span>
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

      {/* Right: action buttons */}
      <div className="flex items-center gap-1">
        {process.env.NEXT_PUBLIC_USER_API_KEYS === 'true' && (
          <button
            onClick={() => window.dispatchEvent(new Event('open-api-keys'))}
            className="px-2 py-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary flex items-center gap-1.5"
            title="API Keys"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
            <span className="text-[11px]">Keys</span>
          </button>
        )}
        <button
          onClick={() => window.dispatchEvent(new Event('open-rules-panel'))}
          className="px-2 py-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary flex items-center gap-1.5"
          title="World Rules — narrative commandments"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <span className="text-[11px]">Rules</span>
        </button>
        <button
          onClick={() => window.dispatchEvent(new Event('open-force-tracker'))}
          className="px-2 py-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary flex items-center gap-1.5"
          title="Force Tracker — narrative analysis"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M2 20h20" />
            <polyline points="4,16 8,8 12,12 16,4 20,10" />
          </svg>
          <span className="text-[11px]">Analysis</span>
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-cube-viewer'))}
          className="px-2 py-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary flex items-center gap-1.5"
          title="Narrative Cube — 3D force trajectory"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <span className="text-[11px]">Cube</span>
        </button>
        <button
          onClick={() => setStoryOpen(true)}
          className="px-2 py-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary flex items-center gap-1.5"
          title="View full story"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          <span className="text-[11px]">Story</span>
        </button>
        <button
          onClick={() => setLogsOpen(true)}
          className="relative px-2 py-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary flex items-center gap-1.5"
          title="API Logs"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span className="text-[11px]">Logs</span>
          {state.apiLogs.some((l) => l.status === 'pending') && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          )}
          {state.apiLogs.some((l) => l.status === 'error') && !state.apiLogs.some((l) => l.status === 'pending') && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-400" />
          )}
        </button>
      </div>
      {logsOpen && <ApiLogsModal onClose={() => setLogsOpen(false)} />}
      {storyOpen && narrative && (
        <StoryReader
          narrative={narrative}
          resolvedKeys={state.resolvedSceneKeys}
          onClose={() => setStoryOpen(false)}
        />
      )}
    </div>
  );
}

