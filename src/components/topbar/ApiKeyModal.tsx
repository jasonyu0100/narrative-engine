'use client';

import { useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import type { FeatureAccess } from '@/hooks/useFeatureAccess';

type Props = {
  access: FeatureAccess;
  onClose: () => void;
};

export default function ApiKeyModal({ access, onClose }: Props) {
  const [orKey, setOrKey] = useState(access.openRouterKey);
  const [repKey, setRepKey] = useState(access.replicateKey);
  const [oaiKey, setOaiKey] = useState(access.openAiKey);
  const [showAdvanced, setShowAdvanced] = useState(!!access.replicateKey || !!access.openAiKey);

  function handleSave() {
    access.setOpenRouterKey(orKey.trim());
    access.setReplicateKey(repKey.trim());
    access.setOpenAiKey(oaiKey.trim());
    onClose();
  }

  return (
    <Modal onClose={onClose} size="sm">
      <ModalHeader onClose={onClose}>
        <h2 className="text-sm font-semibold text-text-primary">API Keys</h2>
      </ModalHeader>
      <ModalBody>
        <p className="text-[11px] text-text-dim mb-3 -mt-1">
          InkTide uses AI models via OpenRouter to analyze, generate, and refine stories. You&apos;ll need an OpenRouter API key to get started.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-medium text-text-secondary mb-1">
              OpenRouter <span className="text-red-400">*</span>
            </label>
            <input
              type="password"
              value={orKey}
              onChange={(e) => setOrKey(e.target.value)}
              placeholder="sk-or-..."
              className="w-full bg-white/5 border border-border rounded px-3 py-2 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-white/20 transition-colors"
            />
            {!orKey.trim() && (
              <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-[9px] text-text-dim hover:text-text-secondary mt-1 inline-block transition-colors">
                Get a key &rarr;
              </a>
            )}
          </div>

          <button
            onClick={() => setShowAdvanced((s) => !s)}
            className="text-[10px] text-text-dim hover:text-text-secondary transition-colors"
          >
            {showAdvanced ? '- Advanced' : '+ Advanced'}
          </button>

          {showAdvanced && (
            <div className="border-t border-white/5 pt-2 space-y-3">
              <div>
                <label className="block text-[10px] font-medium text-text-secondary mb-1">
                  Replicate <span className="text-text-dim/60">optional</span>
                </label>
                <input
                  type="password"
                  value={repKey}
                  onChange={(e) => setRepKey(e.target.value)}
                  placeholder="r8_..."
                  className="w-full bg-white/5 border border-border rounded px-3 py-2 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-white/20 transition-colors"
                />
                <p className="text-[9px] text-text-dim mt-0.5">Image generation</p>
              </div>

              <div>
                <label className="block text-[10px] font-medium text-text-secondary mb-1">
                  OpenAI <span className="text-text-dim/60">optional</span>
                </label>
                <input
                  type="password"
                  value={oaiKey}
                  onChange={(e) => setOaiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full bg-white/5 border border-border rounded px-3 py-2 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-white/20 transition-colors"
                />
                <p className="text-[9px] text-text-dim mt-0.5">Audiobook TTS</p>
              </div>
            </div>
          )}
        </div>

      </ModalBody>
      <ModalFooter>
        {(access.hasOpenRouterKey || access.hasReplicateKey || access.hasOpenAiKey) && (
          <button
            onClick={() => { access.clearKeys(); setOrKey(''); setRepKey(''); setOaiKey(''); }}
            className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors mr-auto"
          >
            Clear
          </button>
        )}
        <button
          onClick={onClose}
          className="text-[11px] px-3 py-1.5 rounded text-text-dim hover:text-text-secondary transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!orKey.trim()}
          className="text-[11px] px-3 py-1.5 rounded bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Save
        </button>
      </ModalFooter>
    </Modal>
  );
}
