'use client';

import React, { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { SlidesData } from '@/lib/slides-data';

function Tex({ children, display }: { children: string; display?: boolean }) {
  const html = useMemo(() => katex.renderToString(children, {
    displayMode: display ?? false,
    throwOnError: false,
  }), [children, display]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Total methodology pages */
export const METHODOLOGY_PAGES = 3;

// ── Page 1: The Three Forces ─────────────────────────────────────────────────

function ForcesPage({ data }: { data: SlidesData }) {
  return (
    <div className="flex flex-col h-full px-12 py-8 text-center">
      <div className="mb-6">
        <div className="text-[10px] uppercase tracking-widest text-text-dim mb-1 font-mono">Methodology · 1 of {METHODOLOGY_PAGES}</div>
        <h2 className="text-2xl font-bold text-text-primary mb-1">The Three Narrative Forces</h2>
        <p className="text-xs text-text-dim">
          Every scene is measured by three independent forces computed directly from structural mutations in the knowledge graph.
        </p>
      </div>

      <div className="flex-1 flex flex-col justify-evenly">
        {/* Payoff */}
        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-1">Payoff</span>
          <span className="text-[10px] text-text-dim mb-3">Did something permanent happen?</span>
          <div className="space-y-1">
            <Tex display>{String.raw`P = \sum_{t \in \mathcal{T}} \delta(t) \;+\; \sum_{r \in \mathcal{R}} |\Delta v_r|`}</Tex>
            <Tex display>{String.raw`\delta(t) = \begin{cases} 0.25 & \text{from} = \text{to} \\ |\,\phi_{\text{to}} - \phi_{\text{from}}\,| & \text{otherwise} \end{cases}`}</Tex>
          </div>
          <p className="text-[10px] text-text-dim leading-relaxed mt-3 max-w-lg">
            Phase jumps score by distance on the dormant&rarr;terminal ladder. Pulses (same&rarr;same) earn 0.25. Relationship valence shifts add |&Delta;v|.
          </p>
        </div>

        <div className="w-24 mx-auto border-t border-white/5" />

        {/* Change */}
        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-1">Change</span>
          <span className="text-[10px] text-text-dim mb-3">How many lives were touched?</span>
          <Tex display>{String.raw`C = \sum_{c \,\in\, \text{cast}} \log_2(1 + m_c)`}</Tex>
          <p className="text-[10px] text-text-dim leading-relaxed mt-3 max-w-lg">
            <Tex>{'m_c'}</Tex> = continuity + relationship (<Tex>{'|\\Delta v|'}</Tex> weighted) mutations per character. Events contribute as a separate log term. Log scale gives diminishing returns, rewarding breadth — a scene that ripples across many lives scores higher than one focused on a single character.
          </p>
        </div>

        <div className="w-24 mx-auto border-t border-white/5" />

        {/* Knowledge */}
        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-1">Knowledge</span>
          <span className="text-[10px] text-text-dim mb-3">Is the world growing richer?</span>
          <Tex display>{String.raw`K = \Delta N + \tfrac{1}{2}\,\Delta E`}</Tex>
          <p className="text-[10px] text-text-dim leading-relaxed mt-3 max-w-lg">
            <Tex>{String.raw`\Delta N`}</Tex> = new world-building nodes — laws, systems, concepts, or tensions revealed in a scene.{' '}
            <Tex>{String.raw`\Delta E`}</Tex> = new relationships between those nodes (weight &frac12;). Introducing a fresh idea outweighs connecting known ones.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Page 2: Tension, Delivery, Shape & Swing ────────────────────────────────

function DeliveryShapeSwingPage({ data }: { data: SlidesData }) {
  return (
    <div className="flex flex-col h-full px-12 py-8 text-center">
      <div className="mb-6">
        <div className="text-[10px] uppercase tracking-widest text-text-dim mb-1 font-mono">Methodology · 2 of {METHODOLOGY_PAGES}</div>
        <h2 className="text-2xl font-bold text-text-primary mb-1">Tension, Delivery & Shape</h2>
        <p className="text-xs text-text-dim">
          The three forces combine into tension and delivery — the buildup-release cycle that drives narrative dopamine.
        </p>
      </div>

      <div className="flex-1 flex flex-col justify-evenly">
        {/* Tension */}
        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-1">Tension</span>
          <span className="text-[10px] text-text-dim mb-3">How much energy is coiling without release?</span>
          <Tex display>{String.raw`T_i = z_i^C + z_i^K - z_i^P`}</Tex>
          <p className="text-[10px] text-text-dim leading-relaxed mt-3 max-w-lg">
            High when characters change and the world expands but threads don&apos;t resolve. Drops at payoff scenes — the release the audience craves. The contrast between consecutive tension values drives delivery.
          </p>
        </div>

        <div className="w-24 mx-auto border-t border-white/5" />

        {/* Delivery */}
        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-1">Delivery</span>
          <span className="text-[10px] text-text-dim mb-3">How hard does the scene hit?</span>
          <div className="space-y-1">
            <Tex display>{String.raw`E_i = 0.5\,z_i^P + 0.25\,z_i^C + 0.25\,z_i^K + 0.3 \cdot \text{contrast}_i`}</Tex>
            <Tex display>{String.raw`\text{contrast}_i = \max(0,\; T_{i-1} - T_i)`}</Tex>
          </div>
          <p className="text-[10px] text-text-dim leading-relaxed mt-3 max-w-lg">
            Payoff weighted 2&times; because resolution drives satisfaction. The contrast bonus rewards tension-release patterns — a payoff after sustained buildup scores higher than the same payoff in isolation.
          </p>
        </div>

        <div className="w-24 mx-auto border-t border-white/5" />

        {/* Shape */}
        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-1">Narrative Shape</span>
          <span className="text-[10px] text-text-dim mb-3">What is the dopamine trajectory?</span>
          <Tex display>{String.raw`\text{Shape} = f\!\left(E_1, E_2, \ldots, E_n\right)`}</Tex>
          <p className="text-[10px] text-text-dim leading-relaxed mt-3 max-w-lg">
            Classified from the Gaussian-smoothed delivery curve. Delivery captures the full dopamine profile — payoff-weighted force presence plus tension-release contrast — making it a more accurate measure of emotional trajectory than any single force alone.
            {data.shape && <> This series: <span className="text-text-secondary font-medium">{data.shape.name}</span>.</>}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Page 3: Grading ──────────────────────────────────────────────────────────

function GradingPage({ data }: { data: SlidesData }) {
  const n = data.sceneCount;
  const avgP = n > 0 ? data.rawForces.payoff.reduce((s, v) => s + v, 0) / n : 0;
  const avgC = n > 0 ? data.rawForces.change.reduce((s, v) => s + v, 0) / n : 0;
  const avgK = n > 0 ? data.rawForces.knowledge.reduce((s, v) => s + v, 0) / n : 0;

  return (
    <div className="flex flex-col h-full px-12 py-8 text-center">
      <div className="mb-6">
        <div className="text-[10px] uppercase tracking-widest text-text-dim mb-1 font-mono">Methodology · 3 of {METHODOLOGY_PAGES}</div>
        <h2 className="text-2xl font-bold text-text-primary mb-1">Grading</h2>
        <p className="text-xs text-text-dim">
          Scores are calibrated against literary reference works so that Harry Potter, The Great Gatsby, and Crime &amp; Punishment land at 88–93 overall.
        </p>
      </div>

      <div className="flex-1 flex flex-col justify-evenly">
        {/* Grade function */}
        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-1">Grade Function</span>
          <span className="text-[10px] text-text-dim mb-3">How are raw forces mapped to scores?</span>
          <div className="space-y-1">
            <Tex display>{String.raw`\tilde{x} = \frac{\bar{x}}{\mu_{\text{ref}}}`}</Tex>
            <Tex display>{String.raw`g(\tilde{x}) = 25\!\left(1 - e^{-2\tilde{x}}\right)`}</Tex>
          </div>
          <p className="text-[10px] text-text-dim leading-relaxed mt-3 max-w-lg">
            Each force mean is divided by its reference mean, then mapped through a saturating exponential.
            At <Tex>{'\\tilde{x}=1'}</Tex> (matching the reference), grade &asymp; 21.6/25.
          </p>
        </div>

        <div className="w-24 mx-auto border-t border-white/5" />

        {/* Reference means */}
        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-3">Reference Means</span>
          <div className="flex items-center gap-10">
            {[
              { label: 'Payoff', symbol: '\\mu_P', ref: '1.5', actual: avgP },
              { label: 'Change', symbol: '\\mu_C', ref: '7.0', actual: avgC },
              { label: 'Knowledge', symbol: '\\mu_K', ref: '2.5', actual: avgK },
            ].map((f) => (
              <div key={f.label} className="flex flex-col items-center">
                <span className="text-lg font-mono font-bold text-text-primary">{f.ref}</span>
                <span className="text-[10px] text-text-dim mt-0.5"><Tex>{f.symbol}</Tex></span>
                <span className="text-[9px] font-mono text-text-dim/60 mt-1">
                  this series: {f.actual.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-text-dim leading-relaxed mt-3 max-w-lg">
            Calibrated from literary works. A force matching its reference scores ~86% of the available 25 points.
          </p>
        </div>

        <div className="w-24 mx-auto border-t border-white/5" />

        {/* Overall composition */}
        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-3">Overall Score</span>
          <Tex display>{String.raw`\text{Overall} = g(\tilde{P}) + g(\tilde{C}) + g(\tilde{K}) + g(\tilde{S})`}</Tex>
          <div className="flex items-center gap-2 mt-4">
            {[
              { key: 'payoff' as const, label: 'P' },
              { key: 'change' as const, label: 'C' },
              { key: 'knowledge' as const, label: 'K' },
              { key: 'swing' as const, label: 'S' },
            ].map((f, i) => (
              <React.Fragment key={f.key}>
                <div className="px-3 py-1.5 rounded-lg border border-white/6 bg-white/2">
                  <span className="text-[10px] font-mono text-text-dim">{f.label} = </span>
                  <span className="text-sm font-mono font-bold text-text-primary">{data.overallGrades[f.key]}</span>
                </div>
                {i < 3 && <span className="text-text-dim text-xs">+</span>}
              </React.Fragment>
            ))}
            <span className="text-text-dim text-xs">=</span>
            <span className="text-xl font-mono font-bold text-text-primary">{data.overallGrades.overall}<span className="text-xs text-text-dim font-normal">/100</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Exported component ───────────────────────────────────────────────────────

export function MethodologySlide({ data, page }: { data: SlidesData; page: number }) {
  switch (page) {
    case 0: return <ForcesPage data={data} />;
    case 1: return <DeliveryShapeSwingPage data={data} />;
    case 2: return <GradingPage data={data} />;
    default: return <ForcesPage data={data} />;
  }
}
