'use client';

import React, { useMemo, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

type Props = { onClose: () => void };

function Tex({ children, display }: { children: string; display?: boolean }) {
  const html = useMemo(() => katex.renderToString(children, {
    displayMode: display ?? false,
    throwOnError: false,
  }), [children, display]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function Block({ tex }: { tex: string }) {
  return (
    <div className="text-center py-2">
      <Tex display>{tex}</Tex>
    </div>
  );
}

function S({ title, analogy, children }: { title: string; analogy: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-[11px] font-semibold text-text-primary uppercase tracking-widest border-b border-border/40 pb-1">{title}</h3>
      <p className="text-[10px] text-text-secondary italic">{analogy}</p>
      {children}
    </div>
  );
}

const tabs = ['Forces', 'Dynamics', 'Scoring'] as const;
type Tab = typeof tabs[number];

function ForcesTab() {
  return (
    <div className="space-y-5">
      <p className="text-[10px] text-text-dim">
        Three forces capture distinct dimensions of narrative intensity. All z-score normalized: <Tex>{'z_i = (x_i - \\mu) \\,/\\, \\sigma'}</Tex>
      </p>

      <S title="Payoff" analogy="Did something permanent happen? A betrayal, a death, a vow — moments that can't be undone.">
        <Block tex="P = \sum_{t} \max\left(0,\ \varphi_{\text{to}} - \varphi_{\text{from}}\right)" />
        <p className="text-[10px] text-text-dim">
          Phase index: dormant(0), active(1), escalating(2), critical(3), resolved/subverted/abandoned(4).
          Transitions score by distance. Same-status mentions earn a 0.25 pulse.
        </p>
      </S>

      <S title="Change" analogy="How intensely did this scene transform? A tight confrontation scores the same as an ensemble with equal total mutations.">
        <Block tex={String.raw`C = \sqrt{\,M_c\,} \;+\; \sqrt{\,|\mathcal{E}|\,} \;+\; \sqrt{\,\textstyle\sum |\Delta v|\,}`} />
        <p className="text-[10px] text-text-dim">
          <Tex>{String.raw`M_c`}</Tex> = continuity mutations, <Tex>{String.raw`|\mathcal{E}|`}</Tex> = events, <Tex>{String.raw`\sum |\Delta v|`}</Tex> = relationship valence intensity. A betrayal (<Tex>{String.raw`|\Delta v|{=}0.5`}</Tex>) weighs more than a polite exchange (<Tex>{String.raw`|\Delta v|{=}0.1`}</Tex>). Cast-blind.
        </p>
      </S>

      <S title="Knowledge" analogy="Is the world growing richer? Revealing a new law of magic expands the world more than linking two known rules.">
        <Block tex={String.raw`K = \Delta N + \sqrt{\Delta E}`} />
        <p className="text-[10px] text-text-dim">
          <Tex>{String.raw`\Delta N`}</Tex> = new world-building nodes (laws, systems, concepts, tensions).{' '}
          <Tex>{String.raw`\Delta E`}</Tex> = new edges between nodes (sqrt — first connections matter more than bulk linking). Fresh ideas outweigh new connections.
        </p>
      </S>
    </div>
  );
}

function DynamicsTab() {
  return (
    <div className="space-y-5">
      <p className="text-[10px] text-text-dim">
        Derived metrics that capture pacing, tension, and the buildup-release cycle.
      </p>

      <S title="Tension" analogy="The coiled spring — energy building without release.">
        <Block tex="T_i = C_i + K_i - P_i" />
        <p className="text-[10px] text-text-dim">
          High when characters change and the world expands but nothing resolves. Drops sharply at payoff scenes.
        </p>
      </S>

      <S title="Delivery" analogy="The dopamine hit — earned resolution lands hardest.">
        <Block tex={String.raw`E_i = w \sum_{f \in \{P,C,K\}} \tanh\!\left(\frac{f_i}{\alpha}\right) + \gamma \cdot \text{contrast}_i`} />
        <Block tex={String.raw`w = 0.3 \qquad \alpha = 1.5 \qquad \gamma = 0.2 \qquad \text{contrast}_i = \max(0,\; T_{i-1} - T_i)`} />
        <p className="text-[10px] text-text-dim">
          All three forces treated symmetrically — same weight, same saturation. tanh compresses extremes while preserving relative ordering. Calibrated across HP, 1984, Gatsby, RI.
        </p>
      </S>

      <S title="Swing" analogy="The story breathing — great stories alternate intensity.">
        <Block tex={String.raw`S_i = \sqrt{\left(\frac{\Delta P}{\mu_P}\right)^{2} + \left(\frac{\Delta C}{\mu_C}\right)^{2} + \left(\frac{\Delta K}{\mu_K}\right)^{2}}`} />
        <p className="text-[10px] text-text-dim">
          Normalized Euclidean distance between consecutive force snapshots. Each delta divided by its reference mean so all three contribute equally.
        </p>
      </S>

      <S title="Peak & Valley Detection" analogy="Where are the climaxes and the breathing room?">
        <Block tex={String.raw`\tilde{E} = \mathcal{G}_{\sigma=1.5} \ast E, \qquad r = \max\!\left(2,\, \lfloor n/25 \rfloor\right)`} />
        <p className="text-[10px] text-text-dim">
          Gaussian-smoothed delivery with adaptive window (wider for longer works). Peaks must rise <Tex>{'\\geq 0.4\\sigma'}</Tex> above their base. Valleys are symmetric.
        </p>
      </S>
    </div>
  );
}

function ScoringTab() {
  return (
    <div className="space-y-5">
      <p className="text-[10px] text-text-dim">
        Forces convert to grades calibrated against literary reference works (HP, Gatsby, Crime &amp; Punishment land at 88&ndash;93).
      </p>

      <S title="Grading" analogy="Exponential curve — steep early, plateaus at high levels.">
        <Block tex={String.raw`g(\tilde{x}) = 25\!\left(1 - e^{-2\tilde{x}}\right) \qquad \text{where} \quad \tilde{x} = \frac{\bar{x}}{\mu_{\text{ref}}}`} />
        <Block tex="\text{Overall} = g(\tilde{P}) + g(\tilde{C}) + g(\tilde{K}) + g(\tilde{S})" />
        <p className="text-[10px] text-text-dim">
          At <Tex>{'\\tilde{x}=1'}</Tex> (matching reference), grade &asymp; 22/25 (88%). Swing is already mean-normalized, graded directly.
        </p>
        <div className="mt-2 flex gap-2 text-[10px]">
          {[
            { label: 'Payoff', value: '1.5', color: '#EF4444' },
            { label: 'Change', value: '4.0', color: '#22C55E' },
            { label: 'Knowledge', value: '3.5', color: '#3B82F6' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 border border-white/8">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-text-dim">{label}</span>
              <span className="font-mono text-text-secondary">{value}</span>
            </div>
          ))}
        </div>
      </S>
    </div>
  );
}

export function FormulaModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('Forces');

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-bg-base border border-white/10 rounded-2xl flex flex-col max-w-2xl w-full"
        style={{ maxHeight: 'calc(100vh - 4rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-1">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  tab === t
                    ? 'bg-bg-elevated text-text-primary'
                    : 'text-text-dim hover:text-text-secondary'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="overflow-auto px-5 py-4">
          {tab === 'Forces' && <ForcesTab />}
          {tab === 'Dynamics' && <DynamicsTab />}
          {tab === 'Scoring' && <ScoringTab />}
        </div>
      </div>
    </div>
  );
}
