'use client';

import { useRef, useEffect } from 'react';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';
import type { AutoRunLog } from '@/types/narrative';

const ACTION_LABELS: Record<string, string> = {
  HHH: 'Convergence', HHL: 'Climax', HLH: 'Twist', HLL: 'Closure',
  LHH: 'Discovery', LHL: 'Growth', LLH: 'Wandering', LLL: 'Rest',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function AutoLogModal({ log, onClose }: { log: AutoRunLog[]; onClose: () => void }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when log updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.length]);

  return (
    <Modal onClose={onClose} size="2xl" maxHeight="80vh">
      <ModalHeader onClose={onClose}>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Auto Mode Log</h2>
          <p className="text-[10px] text-text-dim uppercase tracking-wider">{log.length} cycles</p>
        </div>
      </ModalHeader>
      <ModalBody className="p-5 font-mono text-[11px] space-y-3">
          {log.length === 0 && (
            <p className="text-text-dim text-center py-8">No cycles logged yet</p>
          )}
          {log.map((entry, i) => (
            <div key={i} className={`rounded-lg border p-3 ${entry.error ? 'border-red-500/20 bg-red-500/5' : 'border-white/6 bg-white/[0.02]'}`}>
              {/* Header */}
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-text-dim">{formatTime(entry.timestamp)}</span>
                <span className="text-text-primary font-semibold">Cycle {entry.cycle}</span>
                <span className="text-amber-400/80">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                {entry.scenesGenerated > 0 && (
                  <span className="text-emerald-400/70">{entry.scenesGenerated} scenes</span>
                )}
                {entry.worldExpanded && (
                  <span className="text-change/70">+world</span>
                )}
              </div>

              {/* Arc name */}
              {entry.arcName && (
                <p className="text-text-secondary"><span className="text-text-dim">Arc:</span> {entry.arcName}</p>
              )}

              {/* Phase info */}
              {entry.phaseName && (
                <p className="text-text-dim">Phase: {entry.phaseName} ({entry.phaseProgress})</p>
              )}

              {/* Reason */}
              <p className="text-text-dim mt-1">{entry.reason}</p>

              {/* Direction used */}
              {entry.direction && (
                <div className="mt-2 pt-2 border-t border-white/5">
                  <p className="text-text-dim text-[10px] uppercase tracking-wider mb-0.5">Direction</p>
                  <p className="text-text-secondary leading-snug">{entry.direction}</p>
                </div>
              )}

              {/* Constraints used */}
              {entry.constraints && (
                <div className="mt-1">
                  <p className="text-text-dim text-[10px] uppercase tracking-wider mb-0.5">Constraints</p>
                  <p className="text-text-dim leading-snug">{entry.constraints}</p>
                </div>
              )}

              {/* Course correction */}
              {entry.courseCorrection && (
                <div className="mt-2 pt-2 border-t border-amber-500/15">
                  <p className="text-amber-400/70 text-[10px] uppercase tracking-wider mb-0.5">Course Correction</p>
                  <p className="text-text-secondary leading-snug">{entry.courseCorrection.direction}</p>
                  {entry.courseCorrection.constraints && (
                    <p className="text-text-dim leading-snug mt-0.5">{entry.courseCorrection.constraints}</p>
                  )}
                </div>
              )}

              {/* Error */}
              {entry.error && (
                <p className="text-red-400/80 mt-1">{entry.error}</p>
              )}

              {/* End condition */}
              {entry.endConditionMet && (
                <p className="text-amber-400 mt-1">End condition: {entry.endConditionMet.type}</p>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
      </ModalBody>
    </Modal>
  );
}
