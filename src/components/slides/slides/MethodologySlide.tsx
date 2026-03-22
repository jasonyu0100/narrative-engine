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

function ForcesPage() {
  return (
    <div className="flex flex-col h-full px-12 py-8 text-center">
      <div className="mb-6">
        <div className="text-[10px] uppercase tracking-widest text-text-dim mb-1 font-mono">Methodology · 1 of {METHODOLOGY_PAGES}</div>
        <h2 className="text-2xl font-bold text-text-primary mb-1">The Three Forces</h2>
        <p className="text-xs text-text-dim">
          Each scene is measured by three independent forces computed from structural mutations in the knowledge graph.
        </p>
      </div>

      <div className="flex-1 flex flex-col justify-evenly">
        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-1">Payoff</span>
          <span className="text-[10px] text-text-dim mb-3">Did something permanent happen?</span>
          <Tex display>{String.raw`P = \sum_{t} \left| \varphi_{\text{to}} - \varphi_{\text{from}} \right| + \sum_{r} \left| \Delta v_r \right|`}</Tex>
          <p className="text-[10px] text-text-dim leading-relaxed mt-3 max-w-lg">
            Thread phase transitions scored by distance (dormant&rarr;active&rarr;escalating&rarr;critical&rarr;resolved). Same-status mentions earn a 0.25 pulse. Relationship valence shifts add |&Delta;v|.
          </p>
        </div>

        <div className="w-24 mx-auto border-t border-white/5" />

        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-1">Change</span>
          <span className="text-[10px] text-text-dim mb-3">How many lives were touched?</span>
          <Tex display>{String.raw`C = \sum_{c} \log_2(1 + m_c) + \log_2(1 + |\text{events}|)`}</Tex>
          <p className="text-[10px] text-text-dim leading-relaxed mt-3 max-w-lg">
            <Tex>{'m_c'}</Tex> = continuity + relationship (<Tex>{'|\\Delta v|'}</Tex> weighted) mutations per character. Log scale rewards breadth&mdash;a scene rippling across many lives scores higher than one focused on a single character.
          </p>
        </div>

        <div className="w-24 mx-auto border-t border-white/5" />

        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-1">Knowledge</span>
          <span className="text-[10px] text-text-dim mb-3">Is the world growing richer?</span>
          <Tex display>{String.raw`K = \Delta N + 0.5 \cdot \Delta E`}</Tex>
          <p className="text-[10px] text-text-dim leading-relaxed mt-3 max-w-lg">
            <Tex>{String.raw`\Delta N`}</Tex> = new world-building nodes (laws, systems, concepts, tensions).{' '}
            <Tex>{String.raw`\Delta E`}</Tex> = new edges between nodes (weight 0.5). Fresh ideas outweigh new connections.
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
          Forces combine into the buildup-release cycle that drives narrative dopamine.
        </p>
      </div>

      <div className="flex-1 flex flex-col justify-evenly">
        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-1">Tension</span>
          <span className="text-[10px] text-text-dim mb-3">The coiled spring&mdash;energy building without release.</span>
          <Tex display>{String.raw`T_i = C_i + K_i - P_i`}</Tex>
          <p className="text-[10px] text-text-dim leading-relaxed mt-3 max-w-lg">
            High when characters change and the world expands but nothing resolves. Drops sharply at payoff scenes.
          </p>
        </div>

        <div className="w-24 mx-auto border-t border-white/5" />

        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-1">Delivery</span>
          <span className="text-[10px] text-text-dim mb-3">The dopamine hit&mdash;earned resolution lands hardest.</span>
          <div className="space-y-1">
            <Tex display>{String.raw`E_i = 0.5 P_i + 0.25 C_i + 0.25 K_i + 0.3 \cdot \text{contrast}_i`}</Tex>
            <Tex display>{String.raw`\text{contrast}_i = \max(0,\; T_{i-1} - T_i)`}</Tex>
          </div>
          <p className="text-[10px] text-text-dim leading-relaxed mt-3 max-w-lg">
            Payoff weighted 2&times;. The contrast bonus rewards tension-release: a payoff after buildup scores higher than the same payoff in isolation.
          </p>
        </div>

        <div className="w-24 mx-auto border-t border-white/5" />

        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-1">Narrative Shape</span>
          <span className="text-[10px] text-text-dim mb-3">The delivery trajectory classified into an archetype.</span>
          <Tex display>{String.raw`\text{Shape} = f\!\left(E_1, E_2, \ldots, E_n\right)`}</Tex>
          <p className="text-[10px] text-text-dim leading-relaxed mt-3 max-w-lg">
            Classified from the Gaussian-smoothed delivery curve using peak detection, slope analysis, and variance thresholds.
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
          Calibrated so HP, Gatsby, and Crime &amp; Punishment land at 88&ndash;93 overall.
        </p>
      </div>

      <div className="flex-1 flex flex-col justify-evenly">
        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-1">Grade Function</span>
          <span className="text-[10px] text-text-dim mb-3">Exponential curve&mdash;steep early, plateaus at high levels.</span>
          <div className="space-y-1">
            <Tex display>{String.raw`g(\tilde{x}) = 25\!\left(1 - e^{-2\tilde{x}}\right) \qquad \text{where} \quad \tilde{x} = \frac{\bar{x}}{\mu_{\text{ref}}}`}</Tex>
          </div>
          <p className="text-[10px] text-text-dim leading-relaxed mt-3 max-w-lg">
            At <Tex>{'\\tilde{x}=1'}</Tex> (matching reference), grade &asymp; 22/25 (88%).
          </p>
        </div>

        <div className="w-24 mx-auto border-t border-white/5" />

        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-semibold text-text-primary mb-3">Reference Means</span>
          <div className="flex items-center gap-10">
            {[
              { label: 'Payoff', symbol: '\\mu_P', ref: '1.5', actual: avgP },
              { label: 'Change', symbol: '\\mu_C', ref: '4.5', actual: avgC },
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
        </div>

        <div className="w-24 mx-auto border-t border-white/5" />

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
    case 0: return <ForcesPage />;
    case 1: return <DeliveryShapeSwingPage data={data} />;
    case 2: return <GradingPage data={data} />;
    default: return <ForcesPage />;
  }
}
