'use client';

import React, { useMemo, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';

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

      <S title="Drive" analogy="How much narrative fate has been earned? Long-running threads that resolve pay off superlinearly.">
        <Block tex={String.raw`D = \sum_{t} \text{activeArcs}(t)^{1.3} \times w(t)`} />
        <p className="text-[10px] text-text-dim">
          Lifecycle: latent→seeded→active→critical→resolved/subverted. Weights: pulse=0.25, latent→seeded=0.5, seeded→active=1.0, active→critical=2.0, critical→resolved/subverted=4.0.
          Threads earn fate through sustained bandwidth — activeArcs counts arcs where the thread received attention.
        </p>
      </S>

      <S title="World" analogy="How much did we learn about the entities? Mirrors System but for inner worlds — characters, locations, artifacts.">
        <Block tex={String.raw`C = \Delta N_c + \sqrt{\Delta E_c}`} />
        <p className="text-[10px] text-text-dim">
          <Tex>{String.raw`\Delta N_c`}</Tex> = continuity nodes added to entity inner worlds (traits, beliefs, goals, secrets, capabilities, states).{' '}
          <Tex>{String.raw`\Delta E_c`}</Tex> = continuity edges (causal connections between inner-world facts).{' '}
          Same structure as System — nodes linear, edges sqrt — but spanning every entity rather than one world graph.
        </p>
      </S>

      <S title="System" analogy="Is the world growing richer? Revealing a new principle expands the world more than linking two known concepts.">
        <Block tex={String.raw`K = \Delta N + \sqrt{\Delta E}`} />
        <p className="text-[10px] text-text-dim">
          <Tex>{String.raw`\Delta N`}</Tex> = new world-building nodes (principles, systems, concepts, tensions, events, structures).{' '}
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
          High when characters change and the world expands but nothing resolves. Drops sharply at drive scenes.
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

      <S title="Grading" analogy="Single exponential — floor 8, dominance at reference, cap 25.">
        <Block tex={String.raw`g(\tilde{x}) = 25 - 17\,e^{-k\tilde{x}} \qquad k = \ln\!\tfrac{17}{4} \qquad \tilde{x} = \frac{\bar{x}}{\mu_{\text{ref}}}`} />
        <Block tex="\text{Overall} = g(\tilde{P}) + g(\tilde{C}) + g(\tilde{K}) + g(\tilde{S})" />
        <p className="text-[10px] text-text-dim">
          At <Tex>{'\\tilde{x}=1'}</Tex> (matching reference), grade = 21/25 (dominance threshold). Floor of 8, cap of 25. Swing graded directly.
        </p>
        <div className="mt-2 flex gap-2 text-[10px]">
          {[
            { label: 'Drive', value: '3', color: '#EF4444' },
            { label: 'World', value: '7', color: '#22C55E' },
            { label: 'System', value: '4', color: '#3B82F6' },
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
    <Modal onClose={onClose} size="2xl">
      <ModalHeader onClose={onClose}>
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
      </ModalHeader>
      <ModalBody className="px-5 py-4">
        {tab === 'Forces' && <ForcesTab />}
        {tab === 'Dynamics' && <DynamicsTab />}
        {tab === 'Scoring' && <ScoringTab />}
      </ModalBody>
    </Modal>
  );
}
