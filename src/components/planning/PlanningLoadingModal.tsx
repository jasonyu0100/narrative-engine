'use client';

import { Modal } from '@/components/Modal';

/**
 * Minimal centered loading modal for planning queue operations.
 * Used during queue activation and phase transitions.
 */
export function PlanningLoadingModal({ step, subtitle }: { step: string; subtitle?: string }) {
  return (
    <Modal onClose={() => {}} size="xs">
      <div className="px-6 py-5 text-center">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse mx-auto mb-3" />
        <p className="text-xs text-text-primary font-medium">{step}</p>
        {subtitle && <p className="text-[10px] text-text-dim mt-1">{subtitle}</p>}
      </div>
    </Modal>
  );
}
