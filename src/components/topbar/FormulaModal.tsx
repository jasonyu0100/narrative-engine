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

function S({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-[11px] font-semibold text-text-primary uppercase tracking-widest border-b border-border/40 pb-1">{title}</h3>
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
            All raw forces are z-score normalized: <Tex>{'z_i = (x_i - \\mu) \\,/\\, \\sigma'}</Tex>
          </p>

          <S title="Payoff">
            <Block tex="P = \sum_{t \in \mathcal{T}} |\,\phi_{\text{to}} - \phi_{\text{from}}\,| \;+\; \sum_{r \in \mathcal{R}} |\Delta v_r|" />
            <p className="text-[10px] text-text-dim">
              <Tex>{'\\phi'}</Tex>: linear phase index (dormant=0, active=1, escalating=2, critical=3).
              Terminal transitions use <Tex>{'|\\phi| = 4'}</Tex>.
            </p>
          </S>

          <S title="Change">
            <Block tex="C = \sum_{c \,\in\, \text{cast}} \log_2(1 + m_c)" />
            <p className="text-[10px] text-text-dim">
              <Tex>{'m_c'}</Tex>: total mutations (knowledge + relationship + thread) attributed to character <Tex>{'c'}</Tex>.
            </p>
          </S>

          <S title="Variety">
            <Block tex="V = \sum_{c \in A} r(g_c) \;+\; r(g_\ell) \;+\; \bar{J}(A)" />
            <Block tex="r(g) = \frac{g}{1 + g}, \qquad \bar{J}(A) = \frac{1}{n}\sum_{k=1}^{n} d_J(A, A_k)" />
            <p className="text-[10px] text-text-dim">
              Character recency sums over cast (scales with ensemble size).
              Location recency and Jaccard are each <Tex>{'\\in [0,1]'}</Tex>.
            </p>
          </S>

          <S title="Swing">
            <Block tex="S_i = \left\|\, \frac{\mathbf{f}_i - \mathbf{f}_{i-1}}{\boldsymbol{\mu}} \,\right\|_2 = \sqrt{\left(\frac{\Delta P}{\mu_P}\right)^{\!2} + \left(\frac{\Delta C}{\mu_C}\right)^{\!2} + \left(\frac{\Delta V}{\mu_V}\right)^{\!2}}" />
            <p className="text-[10px] text-text-dim">
              Normalized by reference means so each force contributes equally regardless of scale.
            </p>
          </S>

          <S title="Engagement">
            <Block tex="E_i = \frac{P_i + C_i + V_i}{3}" />
            <Block tex="\tilde{E} = \mathcal{G}_{\sigma=1.5} * E, \qquad \hat{E} = \mathcal{G}_{\sigma=4} * E" />
            <p className="text-[10px] text-text-dim">
              <Tex>{'\\tilde{E}'}</Tex>: smoothed beats. <Tex>{'\\hat{E}'}</Tex>: macro trend.
              Peaks: local maxima with prominence <Tex>{'\\geq 0.4\\,\\sigma_{\\tilde{E}}'}</Tex>.
            </p>
          </S>

          <S title="Grading">
            <Block tex="\tilde{x} = \frac{\bar{x}}{\mu_{\text{ref}}}, \qquad g(\tilde{x}) = 20\!\left(1 - e^{-2\tilde{x}}\right)" />
            <p className="text-[10px] text-text-dim">
              Reference means <Tex>{'\\mu'}</Tex>: P=2, C=7, V=4.5, S=1.5.
              At <Tex>{'\\tilde{x}=1'}</Tex> (matching reference), grade <Tex>{'\\approx'}</Tex> 17/20.
            </p>
            <Block tex="\text{Overall} = \begin{cases} \frac{100}{80}\sum_k g_k & \text{per arc} \\[4pt] \sum_k g_k + g_{\text{streak}} & \text{series} \end{cases}" />
          </S>

          <S title="Streak">
            <Block tex="g_{\text{streak}} = 20 \;\cdot\; \bar{\kappa} \;\cdot\; \frac{1}{1 + \pi\,/\,8n}" />
            <Block tex="\kappa(s) = \sigma(0.1(s - 55)), \qquad \pi = \sum_{j} (1 - \kappa_j)\,j" />
            <p className="text-[10px] text-text-dim">
              <Tex>{'\\kappa'}</Tex>: sigmoid credit (arcs above 70 <Tex>{'\\approx'}</Tex> full credit).
              <Tex>{'\\pi'}</Tex>: penalty over consecutive sub-60 arcs; <Tex>{'j'}</Tex> = run position.
            </p>
          </S>
        </div>
      </div>
    </div>
  );
}
