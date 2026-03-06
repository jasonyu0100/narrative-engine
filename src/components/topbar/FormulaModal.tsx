'use client';

import React, { useMemo } from 'react';
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

export function FormulaModal({ onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="glass-panel rounded-2xl flex flex-col max-w-xl w-full"
        style={{ maxHeight: 'calc(100vh - 4rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <h2 className="text-sm font-medium text-text-primary">Narrative Forces</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-elevated transition-colors text-text-dim hover:text-text-primary">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="overflow-auto px-5 py-4 space-y-5">
          <p className="text-[10px] text-text-dim">
            Raw forces are z-score normalized: <Tex>{'z_i = (x_i - \\mu) \\,/\\, \\sigma'}</Tex>
          </p>

          <S title="Payoff" analogy="Did something permanent happen? A betrayal, a death, a vow — moments that can't be undone.">
            <Block tex="P = \sum_{t \in \mathcal{T}} |\,\phi_{\text{to}} - \phi_{\text{from}}\,| \;+\; \sum_{r \in \mathcal{R}} |\Delta v_r|^{3/2}" />
            <p className="text-[10px] text-text-dim">
              <Tex>{'\\phi'}</Tex>: phase index (dormant=0, active=1, escalating=2, critical=3).
              Terminal transitions use <Tex>{'|\\phi|=4'}</Tex>.
              Valence shifts use a <Tex>{'\\frac{3}{2}'}</Tex> power — small drifts are dampened; large swings (reversals) contribute near-full weight.
            </p>
          </S>

          <S title="Change" analogy="How many lives were touched? A scene where five characters learn something new ripples wider than one where a single character reflects alone.">
            <Block tex="C = \sum_{c \,\in\, \text{cast}} \log_2(1 + m_c)" />
            <p className="text-[10px] text-text-dim">
              <Tex>{'m_c'}</Tex>: total mutations (knowledge + relationship + thread) for character <Tex>{'c'}</Tex>.
              Log scale: diminishing returns per character, rewards breadth.
            </p>
          </S>

          <S title="Variety" analogy="Is the reader seeing something new? Fresh faces, an unfamiliar setting, a group that's never shared a scene before.">
            <Block tex="V = \sum_{c \in A} r(g_c) \;+\; r(g_\ell) \;+\; \bar{J}(A)" />
            <Block tex="r(g) = \frac{g}{1 + g}, \qquad \bar{J}(A) = \frac{1}{n}\sum_{k=1}^{n} d_J(A, A_k)" />
            <p className="text-[10px] text-text-dim">
              <Tex>{'r'}</Tex>: recency over the full series (1 on first appearance, decays toward 0 for recent repeats).
              <Tex>{'\\bar{J}'}</Tex>: mean Jaccard distance vs all prior casts.
            </p>
          </S>

          <S title="Swing" analogy="Is the story breathing? A quiet scene after an explosion, a tense pause before the climax — great stories alternate intensity.">
            <Block tex="S_i = \left\|\, \frac{\mathbf{f}_i - \mathbf{f}_{i-1}}{\boldsymbol{\mu}} \,\right\|_2 = \sqrt{\left(\frac{\Delta P}{\mu_P}\right)^{\!2} + \left(\frac{\Delta C}{\mu_C}\right)^{\!2} + \left(\frac{\Delta V}{\mu_V}\right)^{\!2}}" />
            <p className="text-[10px] text-text-dim">
              Normalized by reference means so each force contributes equally. High swing = dynamic pacing.
            </p>
          </S>

          <S title="Engagement" analogy="The heartbeat of the story — where peaks are climaxes and valleys are the quiet before the storm.">
            <Block tex="E_i = \frac{P_i + C_i + V_i}{3}" />
            <Block tex="\tilde{E} = \mathcal{G}_{\sigma=1.5} * E, \qquad \hat{E} = \mathcal{G}_{\sigma=4} * E" />
            <p className="text-[10px] text-text-dim">
              <Tex>{'\\tilde{E}'}</Tex>: smoothed beats. <Tex>{'\\hat{E}'}</Tex>: macro trend.
              Peaks detected by local prominence <Tex>{'\\geq 0.4\\,\\sigma_{\\tilde{E}}'}</Tex>.
            </p>
          </S>

          <S title="Grading" analogy="How does this story compare to great literature? Scores are calibrated so HP, Gatsby, and Crime & Punishment land at 88–93.">
            <Block tex="\tilde{x} = \frac{\bar{x}}{\mu_{\text{ref}}}, \qquad g(\tilde{x}) = 20\!\left(1 - e^{-2\tilde{x}}\right)" />
            <Block tex="\text{Overall}_{\text{arc}} = \frac{100}{80}\sum_k g_k, \qquad \text{Overall}_{\text{series}} = \sum_k g_k + g_{\text{streak}}" />
            <p className="text-[10px] text-text-dim">
              Reference means <Tex>{'\\mu'}</Tex>: P=1.75, C=7, V=4.5, S=1.2. Calibrated from literary works.
              At <Tex>{'\\tilde{x}=1'}</Tex> (matching reference), grade <Tex>{'\\approx'}</Tex> 17/20.
            </p>
          </S>

          <S title="Streak" analogy="Consistency over time — a single weak arc is forgiven, but a run of them signals the story losing its way.">
            <Block tex="g_{\text{streak}} = 20 \;\cdot\; \bar{\kappa} \;\cdot\; \frac{1}{1 + \pi\,/\,8n}" />
            <Block tex="\kappa(s) = \sigma(0.1(s - 55)), \qquad \pi = \sum_{j} (1 - \kappa_j)\,j" />
            <p className="text-[10px] text-text-dim">
              <Tex>{'\\kappa'}</Tex>: sigmoid credit (arcs above 70 get near-full credit).
              <Tex>{'\\pi'}</Tex>: penalty over consecutive sub-60 arcs; <Tex>{'j'}</Tex> = run position.
            </p>
          </S>
        </div>
      </div>
    </div>
  );
}
