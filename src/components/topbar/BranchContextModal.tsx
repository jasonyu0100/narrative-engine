'use client';

import React, { useMemo, useState } from 'react';
import type { NarrativeState } from '@/types/narrative';
import { resolveEntry, isScene } from '@/types/narrative';
import { branchContext, sceneContext } from '@/lib/ai';

type ContextView = 'branch' | 'scene';

type Props = {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentSceneIndex: number;
  onClose: () => void;
};

export function BranchContextModal({ narrative, resolvedKeys, currentSceneIndex, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<ContextView>('branch');

  const branchCtx = useMemo(
    () => branchContext(narrative, resolvedKeys, currentSceneIndex),
    [narrative, resolvedKeys, currentSceneIndex],
  );

  const currentKey = resolvedKeys[currentSceneIndex];
  const currentEntry = currentKey ? resolveEntry(narrative, currentKey) : null;
  const currentScene = currentEntry && isScene(currentEntry) ? currentEntry : null;

  const sceneCtx = useMemo(
    () => currentScene ? sceneContext(narrative, currentScene) : null,
    [narrative, currentScene],
  );

  const context = view === 'scene' && sceneCtx ? sceneCtx : branchCtx;

  const wordCount = useMemo(() => context.split(/\s+/).length, [context]);
  const estimatedTokens = Math.round(context.length / 4);
  const tokenLabel = estimatedTokens >= 1000
    ? `~${(estimatedTokens / 1000).toFixed(1)}k`
    : `~${estimatedTokens}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(context);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="glass-panel rounded-2xl flex flex-col max-w-4xl w-full"
        style={{ maxHeight: 'calc(100vh - 4rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            {/* View toggle */}
            <div className="flex items-center rounded bg-bg-elevated text-[11px] leading-none">
              <button
                className={`px-2.5 py-1.5 rounded-l transition-colors ${
                  view === 'branch' ? 'text-accent-cta' : 'text-text-dim hover:text-text-default'
                }`}
                onClick={() => setView('branch')}
              >
                Branch
              </button>
              <div className="w-px h-3.5 bg-border" />
              <button
                className={`px-2.5 py-1.5 rounded-r transition-colors ${
                  view === 'scene' ? 'text-accent-cta' : 'text-text-dim hover:text-text-default'
                } ${!sceneCtx ? 'opacity-30 pointer-events-none' : ''}`}
                onClick={() => setView('scene')}
                disabled={!sceneCtx}
              >
                Scene
              </button>
            </div>
            <span className="text-[11px] text-text-dim px-2 py-0.5 rounded bg-bg-elevated">
              {wordCount.toLocaleString()} words
            </span>
            <span className="text-[11px] text-text-dim px-2 py-0.5 rounded bg-bg-elevated">
              {tokenLabel} tokens
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="px-3 py-1 rounded text-[11px] font-medium transition-colors bg-bg-elevated hover:bg-accent/20 text-text-dim hover:text-text-primary"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-auto p-5">
          <pre className="text-[11px] leading-relaxed text-text-dim whitespace-pre-wrap font-mono">
            {context}
          </pre>
        </div>
      </div>
    </div>
  );
}
