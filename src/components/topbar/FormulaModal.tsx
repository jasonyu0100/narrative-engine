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
        Three raw forces capture distinct dimensions of narrative intensity. Each is z-score normalized: <Tex>{'z_i = (x_i - \\mu) \\,/\\, \\sigma'}</Tex>
      </p>

      <S title="Payoff" analogy="Did something permanent happen? A betrayal, a death, a vow — moments that can't be undone.">
        <Block tex="P = \sum_{t \in \mathcal{T}} \delta(t) \;+\; \sum_{r \in \mathcal{R}} |\Delta v_r|" />
        <Block tex={String.raw`\delta(t) = \begin{cases} 0.25 & \text{from} = \text{to} \;\text{(pulse)} \\ |\,\phi_{\text{to}} - \phi_{\text{from}}\,| & \text{otherwise} \end{cases}`} />
        <p className="text-[10px] text-text-dim">
          <Tex>{'\\phi'}</Tex>: phase index (dormant=0, active=1, escalating=2, critical=3, resolved/subverted/abandoned=4).
          Same-status pulses earn 0.25. All transitions use absolute distance.
          Valence deltas contribute linearly.
        </p>
      </S>

      <S title="Change" analogy="How many lives were touched? A scene where five characters learn something new ripples wider than one where a single character reflects alone.">
        <Block tex="C = \sum_{c \,\in\, \text{cast}} \log_2(1 + m_c)" />
        <p className="text-[10px] text-text-dim">
          <Tex>{'m_c'}</Tex>: total mutations (knowledge + relationship + thread) for character <Tex>{'c'}</Tex>.
          Log scale: diminishing returns per character, rewards breadth.
        </p>
      </S>

      <S title="Variety" analogy="Is the reader seeing something new? Fresh faces, an unfamiliar setting.">
        <Block tex="V = \sum_{c \in A} r(g_c) \;+\; r(g_\ell)" />
        <Block tex="r(g) = \frac{g}{1 + g}" />
        <p className="text-[10px] text-text-dim">
          <Tex>{'r'}</Tex>: recency over the full series (1 on first appearance, decays toward 0 for recent repeats).
        </p>
      </S>
    </div>
  );
}

function DynamicsTab() {
  return (
    <div className="space-y-5">
      <p className="text-[10px] text-text-dim">
        Derived signals that measure pacing and structure across the scene sequence.
      </p>

      <S title="Engagement" analogy="The heartbeat of the story — where peaks are climaxes and valleys are the quiet before the storm.">
        <Block tex="z_i^{(k)} = \frac{x_i^{(k)} - \bar{x}^{(k)}}{\sigma^{(k)}}, \qquad E_i = \frac{z_i^P + z_i^C + z_i^V}{3}" />
        <p className="text-[10px] text-text-dim">
          Each force is z-score normalized, then engagement is their mean.
          Gaussian-smoothed (σ=1.5) for display.
        </p>
      </S>

      <S title="Swing" analogy="Is the story breathing? A quiet scene after an explosion, a tense pause before the climax — great stories alternate intensity.">
        <Block tex="S_i = \left\|\, \frac{\mathbf{f}_i - \mathbf{f}_{i-1}}{\boldsymbol{\mu}} \,\right\|_2 = \sqrt{\left(\frac{\Delta P}{\mu_P}\right)^{\!2} + \left(\frac{\Delta C}{\mu_C}\right)^{\!2} + \left(\frac{\Delta V}{\mu_V}\right)^{\!2}}" />
        <p className="text-[10px] text-text-dim">
          Normalized by reference means so each force contributes equally. High swing = dynamic pacing.
        </p>
      </S>

      <S title="Peak & Valley Detection" analogy="Where are the climaxes and the breathing room? Peaks are moments that tower above their surroundings.">
        <Block tex={String.raw`\tilde{E} = \mathcal{G}_{\sigma=1.5} \ast E, \qquad r = \max\!\left(2,\, \lfloor n/25 \rfloor\right)`} />
        <Block tex={String.raw`\text{peak at } i \iff \tilde{E}_i = \max_{j \in [i-r,\, i+r]} \tilde{E}_j \;\wedge\; \tilde{E}_i - \text{base}_i \geq 0.4\,\sigma_{\tilde{E}}`} />
        <p className="text-[10px] text-text-dim">
          Local maximum within an adaptive window (wider for longer books).
          Prominence = height above the nearest valley on either side.
          Only peaks rising <Tex>{'\\geq 0.4\\sigma'}</Tex> above their base qualify. Valleys are symmetric.
        </p>
      </S>
    </div>
  );
}

function ScoringTab() {
  return (
    <div className="space-y-5">
      <p className="text-[10px] text-text-dim">
        Forces and dynamics are converted to grades calibrated against literary reference works.
      </p>

      <S title="Grading" analogy="How does this story compare to great literature? Scores are calibrated so HP, Gatsby, and Crime & Punishment land at 88–93.">
        <Block tex="\tilde{x} = \frac{\bar{x}}{\mu_{\text{ref}}}, \qquad g(\tilde{x}) = 20\!\left(1 - e^{-2\tilde{x}}\right)" />
        <Block tex="\text{Overall}_{\text{arc}} = \frac{100}{80}\sum_k g_k, \qquad \text{Overall}_{\text{series}} = \sum_k g_k + g_{\text{streak}}" />
        <p className="text-[10px] text-text-dim">
          Reference means <Tex>{'\\mu'}</Tex>: P=1.75, C=7, V=4.5, S=1.2. Calibrated from literary works.
          At <Tex>{'\\tilde{x}=1'}</Tex> (matching reference), grade <Tex>{'\\approx'}</Tex> 17/20.
        </p>
      </S>

      <S title="Streak" analogy="Consistency over time — a single weak arc is forgiven, but a run of them signals the story losing its way.">
        <Block tex="g_{\text{streak}} = 20 \;\cdot\; \bar{\kappa} \;\cdot\; \frac{1}{1 + \pi\,/\,15n}" />
        <Block tex="\pi = \sum_{\text{runs}} \sum_{j=1}^{L} w_j \cdot \sqrt{j}" />
        <p className="text-[10px] text-text-dim">
          <Tex>{'\\kappa'}</Tex>: zone credit per arc — <span className="text-green-400">green</span>=1, <span className="text-lime-400">lime</span>=0.9, <span className="text-yellow-400">yellow</span>=0.7, <span className="text-orange-400">orange</span>=0.5, <span className="text-red-400">red</span>=0.3.
          {' '}<Tex>{'\\pi'}</Tex>: streak penalty — consecutive sub-80 arcs compound by zone weight (<Tex>{'w'}</Tex>: yellow=1×, orange=2×, red=3×) × <Tex>{'\\sqrt{\\text{position}}'}</Tex>.
        </p>
      </S>
    </div>
  );
}

export function FormulaModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('Forces');

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="glass-panel rounded-2xl flex flex-col max-w-2xl w-full"
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
