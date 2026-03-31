'use client';

import { useEffect, useRef } from 'react';
import { Modal } from '@/components/Modal';

/**
 * Loading modal for planning queue operations.
 * Shows streaming reasoning output when available, otherwise a minimal status indicator.
 */
export function PlanningLoadingModal({ step, subtitle, reasoning }: { step: string; subtitle?: string; reasoning?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [reasoning]);

  return (
    <Modal onClose={() => {}} size={reasoning ? 'lg' : 'xs'}>
      <div className={reasoning ? 'px-6 py-5' : 'px-6 py-5 text-center'}>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <p className="text-xs text-text-primary font-medium">{step}</p>
        </div>
        {subtitle && <p className="text-[10px] text-text-dim mt-0.5 ml-4">{subtitle}</p>}
        {reasoning && (
          <div
            ref={scrollRef}
            className="mt-3 bg-bg-elevated border border-border rounded-lg px-3 py-2 text-[10px] text-text-dim font-mono max-h-64 overflow-y-auto whitespace-pre-wrap"
          >
            {reasoning}
          </div>
        )}
      </div>
    </Modal>
  );
}
