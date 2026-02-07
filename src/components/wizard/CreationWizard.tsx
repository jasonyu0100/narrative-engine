'use client';

import { useStore } from '@/lib/store';
import type { WizardStep } from '@/types/narrative';
import { PremiseStep } from './PremiseStep';
import { WorldStep } from './WorldStep';
import { GenerateStep } from './GenerateStep';

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'premise', label: 'Premise' },
  { key: 'world', label: 'World' },
  { key: 'generate', label: 'Generate' },
];

function Stepper({ current }: { current: WizardStep }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-1 mb-5">
      {STEPS.map((step, i) => {
        const isActive = i === currentIdx;
        const isDone = i < currentIdx;
        return (
          <div key={step.key} className="flex items-center gap-1">
            {i > 0 && (
              <div className={`w-8 h-px ${isDone ? 'bg-white/30' : 'bg-white/8'}`} />
            )}
            <div className="flex items-center gap-1.5">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono transition ${
                isActive
                  ? 'bg-white/15 text-text-primary border border-white/25'
                  : isDone
                    ? 'bg-white/10 text-text-secondary'
                    : 'bg-white/[0.04] text-text-dim'
              }`}>
                {isDone ? '✓' : i + 1}
              </div>
              <span className={`text-[10px] uppercase tracking-wider ${
                isActive ? 'text-text-primary' : 'text-text-dim'
              }`}>
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StepContent({ step }: { step: WizardStep }) {
  switch (step) {
    case 'premise':
      return <PremiseStep />;
    case 'world':
      return <WorldStep />;
    case 'generate':
      return <GenerateStep />;
  }
}

export function CreationWizard() {
  const { state, dispatch } = useStore();

  if (!state.wizardOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="glass max-w-2xl w-full rounded-2xl p-6 relative">
        <button
          onClick={() => dispatch({ type: 'CLOSE_WIZARD' })}
          className="absolute top-4 right-4 text-text-dim hover:text-text-primary text-lg leading-none"
        >
          &times;
        </button>
        <Stepper current={state.wizardStep} />
        <StepContent step={state.wizardStep} />
      </div>
    </div>
  );
}
