'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { apiHeaders } from '@/lib/api-headers';
import { assetManager } from '@/lib/asset-manager';
import { useImageUrl } from '@/hooks/useAssetUrl';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import type { NarrativeEntry } from '@/types/narrative';

export function NarrativeEditModal({ entry, onClose }: { entry: NarrativeEntry; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const narrative = state.narratives.find((n) => n.id === entry.id);

  const [title, setTitle] = useState(entry.title);
  const [description, setDescription] = useState(entry.description ?? '');
  const [coverPrompt, setCoverPrompt] = useState('');
  const [coverGenerating, setCoverGenerating] = useState(false);
  const [coverError, setCoverError] = useState('');
  const coverImageRef = narrative?.coverImageUrl ?? entry.coverImageUrl;
  const coverUrl = useImageUrl(coverImageRef);

  function handleSave() {
    dispatch({
      type: 'UPDATE_NARRATIVE_META',
      narrativeId: entry.id,
      title: title.trim() || entry.title,
      description: description.trim(),
    });
    onClose();
  }

  async function handleGenerateCover() {
    setCoverGenerating(true);
    setCoverError('');
    try {
      const res = await fetch('/api/generate-cover', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          title,
          description,
          coverPrompt: coverPrompt.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Cover generation failed');
      }
      const { imageUrl } = await res.json();

      // Download image and store in AssetManager
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error('Failed to download cover image');

      const blob = await imgRes.blob();
      const assetId = await assetManager.storeImage(blob, blob.type, undefined, entry.id);

      dispatch({ type: 'SET_COVER_IMAGE', narrativeId: entry.id, imageUrl: assetId });
    } catch (err) {
      setCoverError(err instanceof Error ? err.message : String(err));
    } finally {
      setCoverGenerating(false);
    }
  }

  function handleRemoveCover() {
    dispatch({ type: 'SET_COVER_IMAGE', narrativeId: entry.id, imageUrl: '' });
  }

  return (
    <Modal onClose={onClose} size="lg">
      <ModalHeader onClose={onClose}>
        <h2 className="text-[13px] font-semibold text-text-primary">Edit Story</h2>
      </ModalHeader>
      <ModalBody className="p-5 space-y-5">
          {/* Cover */}
          <div>
            <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">Cover</label>
            <div className="flex gap-4 items-start">
              <div className="w-28 shrink-0 rounded-lg overflow-hidden border border-white/10">
                {coverUrl ? (
                  <img src={coverUrl} alt="Cover" className="w-full aspect-3/4 object-cover" />
                ) : (
                  <div className="w-full aspect-3/4 bg-white/3 flex items-center justify-center">
                    <span className="text-[9px] text-text-dim/30">No cover</span>
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-2.5">
                <textarea
                  value={coverPrompt}
                  onChange={(e) => setCoverPrompt(e.target.value)}
                  placeholder="Image prompt (optional — leave empty to auto-generate)"
                  className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2.5 text-[11px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-white/20 resize-none h-20 transition-colors"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleGenerateCover}
                    disabled={coverGenerating}
                    className="flex-1 text-[11px] px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                  >
                    {coverGenerating ? 'Generating…' : coverUrl ? 'Regenerate' : 'Generate Cover'}
                  </button>
                  {coverUrl && (
                    <button
                      onClick={handleRemoveCover}
                      className="text-[11px] px-3 py-2 rounded-lg border border-white/5 text-text-dim hover:text-text-secondary hover:bg-white/5 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {coverError && <p className="text-[10px] text-red-400/80 mt-1">{coverError}</p>}
              </div>
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2.5 text-[13px] text-text-primary outline-none focus:border-white/20 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-[10px] text-text-dim uppercase tracking-wider block mb-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-text-primary placeholder:text-text-dim/40 outline-none focus:border-white/20 resize-none transition-colors"
            />
          </div>
      </ModalBody>
      <ModalFooter>
        <button
          onClick={onClose}
          className="text-[11px] px-3 py-1.5 rounded-md bg-white/5 text-text-dim hover:text-text-secondary transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="text-[11px] px-3 py-1.5 rounded-md bg-white/10 text-text-primary hover:bg-white/15 transition-colors font-medium"
        >
          Save
        </button>
      </ModalFooter>
    </Modal>
  );
}
