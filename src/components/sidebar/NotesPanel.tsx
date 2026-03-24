'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/store';
import type { Note } from '@/types/narrative';

function noteGroups(notes: Note[]): { label: string; items: Note[] }[] {
  const now = Date.now();
  const DAY = 86_400_000;
  const today: Note[] = [];
  const yesterday: Note[] = [];
  const thisWeek: Note[] = [];
  const older: Note[] = [];

  for (const n of notes) {
    const age = now - n.updatedAt;
    if (age < DAY) today.push(n);
    else if (age < 2 * DAY) yesterday.push(n);
    else if (age < 7 * DAY) thisWeek.push(n);
    else older.push(n);
  }

  return [
    { label: 'Today', items: today },
    { label: 'Yesterday', items: yesterday },
    { label: 'This Week', items: thisWeek },
    { label: 'Older', items: older },
  ].filter((g) => g.items.length > 0);
}

export default function NotesPanel() {
  const { state, dispatch } = useStore();
  const [view, setView] = useState<'list' | 'edit'>('list');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const narrative = state.activeNarrative;
  const notes = narrative?.notes ?? {};
  const activeNote = state.activeNoteId ? notes[state.activeNoteId] ?? null : null;

  const sorted = Object.values(notes).sort((a, b) => b.updatedAt - a.updatedAt);
  const groups = noteGroups(sorted);

  // Auto-focus textarea when entering edit view
  useEffect(() => {
    if (view === 'edit' && contentRef.current) {
      contentRef.current.focus();
      const len = contentRef.current.value.length;
      contentRef.current.setSelectionRange(len, len);
    }
  }, [view, state.activeNoteId]);

  // Focus rename input when it opens
  useEffect(() => {
    if (renamingId && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renamingId]);

  const createNote = useCallback(() => {
    const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const note: Note = { id, title: 'Untitled', content: '', createdAt: now, updatedAt: now };
    dispatch({ type: 'CREATE_NOTE', note });
    setView('edit');
  }, [dispatch]);

  const openNote = useCallback((id: string) => {
    dispatch({ type: 'SET_ACTIVE_NOTE', noteId: id });
    setView('edit');
  }, [dispatch]);

  const deleteNote = useCallback((id: string) => {
    dispatch({ type: 'DELETE_NOTE', noteId: id });
    if (state.activeNoteId === id) setView('list');
  }, [dispatch, state.activeNoteId]);

  const commitRename = useCallback(() => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (trimmed) dispatch({ type: 'UPDATE_NOTE', noteId: renamingId, title: trimmed });
    setRenamingId(null);
  }, [dispatch, renamingId, renameValue]);

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!activeNote) return;
    dispatch({ type: 'UPDATE_NOTE', noteId: activeNote.id, content: e.target.value });
  }, [dispatch, activeNote]);

  if (!narrative) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-dim text-xs p-4 text-center">
        No story open
      </div>
    );
  }

  // ── Edit view ──────────────────────────────────────────────────────────────
  if (view === 'edit' && activeNote) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border">
          <button
            onClick={() => setView('list')}
            className="p-1 text-text-dim hover:text-text-secondary transition-colors"
            title="Back to notes"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {renamingId === activeNote.id ? (
            <input
              ref={renameRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenamingId(null);
              }}
              className="flex-1 bg-transparent text-[11px] font-medium text-text-primary border-b border-accent outline-none"
            />
          ) : (
            <button
              onClick={() => { setRenamingId(activeNote.id); setRenameValue(activeNote.title); }}
              className="flex-1 text-left text-[11px] font-medium text-text-primary truncate hover:text-accent transition-colors"
              title="Click to rename"
            >
              {activeNote.title}
            </button>
          )}
          <button
            onClick={() => deleteNote(activeNote.id)}
            className="p-1 text-text-dim hover:text-red-400 transition-colors"
            title="Delete note"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 3h8M5 3V2h2v1M4 3v6h4V3H4z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Content editor */}
        <textarea
          ref={contentRef}
          value={activeNote.content}
          onChange={handleContentChange}
          placeholder="Start writing…"
          className="flex-1 min-h-0 w-full bg-transparent resize-none text-[12px] text-text-primary placeholder:text-text-dim/40 outline-none p-3 font-mono leading-relaxed"
        />
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="text-[11px] font-medium text-text-dim uppercase tracking-wide">Notes</span>
        <button
          onClick={createNote}
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-text-dim hover:text-text-primary transition-colors"
          title="New note"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          New
        </button>
      </div>

      {/* Note list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="text-text-dim/40">
              <rect x="5" y="4" width="18" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M9 10h10M9 14h10M9 18h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <p className="text-[11px] text-text-dim">No notes yet</p>
            <button
              onClick={createNote}
              className="text-[11px] text-accent hover:underline"
            >
              Create your first note
            </button>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div className="px-3 pt-3 pb-1 text-[9px] font-semibold uppercase tracking-widest text-text-dim/60">
                {group.label}
              </div>
              {group.items.map((note) => (
                <div
                  key={note.id}
                  className={`group flex items-center gap-1 px-3 py-2 cursor-pointer transition-colors ${
                    state.activeNoteId === note.id
                      ? 'bg-white/5 text-text-primary'
                      : 'hover:bg-white/3 text-text-secondary'
                  }`}
                  onClick={() => openNote(note.id)}
                >
                  {renamingId === note.id ? (
                    <input
                      ref={renameRef}
                      value={renameValue}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      className="flex-1 bg-transparent text-[11px] text-text-primary border-b border-accent outline-none"
                    />
                  ) : (
                    <span className="flex-1 text-[11px] truncate">{note.title}</span>
                  )}
                  <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenamingId(note.id); setRenameValue(note.title); }}
                      className="p-1 text-text-dim hover:text-text-secondary transition-colors"
                      title="Rename"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M1 9l2-2 5-5L7 1 2 6 1 9z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }}
                      className="p-1 text-text-dim hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 2.5h6M4 2.5V2h2v.5M3.5 2.5v5h3v-5h-3z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                  {renamingId !== note.id && (
                    <span className="shrink-0 text-[9px] text-text-dim/50 group-hover:hidden">
                      {new Date(note.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
