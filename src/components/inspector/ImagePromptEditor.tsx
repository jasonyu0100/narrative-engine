'use client';

import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { suggestImagePrompt, type ImagePromptEntityKind } from '@/lib/ai';
import { IconSparkle, IconSpinner } from '@/components/icons';

type Props = {
  kind: ImagePromptEntityKind;
  entityId: string;
  value: string | undefined;
};

const ACTION_BY_KIND: Record<ImagePromptEntityKind, string> = {
  character: 'SET_CHARACTER_IMAGE_PROMPT',
  location: 'SET_LOCATION_IMAGE_PROMPT',
  artifact: 'SET_ARTIFACT_IMAGE_PROMPT',
};

const ID_FIELD_BY_KIND: Record<ImagePromptEntityKind, string> = {
  character: 'characterId',
  location: 'locationId',
  artifact: 'artifactId',
};

export default function ImagePromptEditor({ kind, entityId, value }: Props) {
  const { state, dispatch } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      const el = textareaRef.current;
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const persist = (imagePrompt: string) => {
    dispatch({
      type: ACTION_BY_KIND[kind],
      [ID_FIELD_BY_KIND[kind]]: entityId,
      imagePrompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  };

  const handleSave = () => {
    persist(draft.trim());
    setEditing(false);
    setError(null);
  };

  const handleCancel = () => {
    setDraft(value ?? '');
    setEditing(false);
    setError(null);
  };

  const handleSuggest = async () => {
    if (!state.activeNarrative || suggesting) return;
    setSuggesting(true);
    setError(null);
    try {
      const out = await suggestImagePrompt(kind, state.activeNarrative, entityId);
      setDraft(out);
      setEditing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Suggest failed');
    } finally {
      setSuggesting(false);
    }
  };

  const header = (
    <div className="flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-widest text-text-dim">Image Prompt</span>
      <button
        type="button"
        onClick={handleSuggest}
        disabled={suggesting}
        title="Rewrite using entity continuity, world summary, and image style"
        className={`flex items-center gap-1 text-[10px] transition-colors disabled:opacity-80 ${
          suggesting
            ? 'text-text-secondary animate-pulse'
            : 'text-text-dim hover:text-text-primary'
        }`}
      >
        {suggesting ? (
          <IconSpinner size={10} className="animate-spin" />
        ) : (
          <IconSparkle size={10} />
        )}
        {suggesting ? 'Thinking…' : 'Suggest'}
      </button>
    </div>
  );

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5 rounded-md border border-white/10 bg-white/3 p-2">
        {header}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSave();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              handleCancel();
            }
          }}
          rows={4}
          placeholder="Literal visual description — concrete physical traits, no metaphors."
          className="w-full text-[11px] text-text-primary bg-transparent border border-white/10 rounded px-2 py-1.5 leading-relaxed resize-y focus:outline-none focus:border-white/30 placeholder:text-text-dim/40"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] text-text-dim/60">
            ⌘/Ctrl+Enter to save · Esc to cancel
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCancel}
              className="px-2 py-0.5 text-[10px] text-text-dim hover:text-text-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-2 py-0.5 text-[10px] text-text-primary bg-white/10 hover:bg-white/15 rounded transition-colors"
            >
              Save
            </button>
          </div>
        </div>
        {error && <p className="text-[10px] text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {header}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-left rounded-md border border-transparent hover:border-white/10 hover:bg-white/3 px-2 py-1.5 -mx-2 transition-colors"
      >
        {value ? (
          <span className="text-[11px] text-text-secondary italic leading-relaxed">
            {value}
          </span>
        ) : (
          <span className="text-[11px] text-text-dim/50 leading-relaxed">
            Click to write a prompt, or use Suggest above to generate one from this entity's continuity.
          </span>
        )}
      </button>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
