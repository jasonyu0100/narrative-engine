'use client';

import { useState } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/Modal';
import { PlanCandidatesView } from './PlanCandidatesView';
import type { NarrativeState, Scene, PlanCandidates } from '@/types/narrative';

type Props = {
  narrative: NarrativeState;
  scene: Scene;
  resolvedKeys: string[];
  onClose: () => void;
  onSelectPlan: (candidates: PlanCandidates, candidateId: string) => void;
};

export function PlanCandidatesModal({ narrative, scene, resolvedKeys, onClose, onSelectPlan }: Props) {
  const [candidateCount, setCandidateCount] = useState(5);
  const [showCandidates, setShowCandidates] = useState(false);

  if (showCandidates) {
    return (
      <PlanCandidatesView
        narrative={narrative}
        scene={scene}
        resolvedKeys={resolvedKeys}
        candidateCount={candidateCount}
        onClose={onClose}
        onSelectPlan={onSelectPlan}
      />
    );
  }

  return (
    <Modal onClose={onClose} size="md">
      <ModalHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          <span className="font-semibold text-sm text-text-primary">Plan Candidates Setup</span>
        </div>
      </ModalHeader>

      <ModalBody className="space-y-6 px-6 py-5">
        <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg text-xs text-text-secondary leading-relaxed">
          <p>
            Generate multiple candidate plans in parallel and compare them side-by-side.
            Plans are ranked by semantic similarity to the scene summary.
          </p>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-text-primary uppercase tracking-wider">
              Number of Candidates
            </span>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="range"
                min="3"
                max="10"
                value={candidateCount}
                onChange={(e) => setCandidateCount(parseInt(e.target.value, 10))}
                className="flex-1"
              />
              <span className="text-2xl font-bold text-blue-400 font-mono tabular-nums w-12 text-right">
                {candidateCount}
              </span>
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-text-dim/60 font-mono">
              <span>3</span>
              <span>10</span>
            </div>
          </label>

          <div className="text-[10px] text-text-dim/60 leading-relaxed">
            More candidates = better exploration but longer generation time.
            Recommended: 5-7 for balanced results.
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => setShowCandidates(true)}
          className="px-6 py-2 bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 rounded text-sm font-medium transition-colors"
        >
          Start Candidates
        </button>
      </ModalFooter>
    </Modal>
  );
}
