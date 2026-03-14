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
    <div className="flex flex-col h-full px-12 py-8">
      <div className="mb-6">
        <div className="text-[10px] uppercase tracking-widest text-text-dim mb-1 font-mono">Methodology · 1 of {METHODOLOGY_PAGES}</div>
        <h2 className="text-2xl font-bold text-text-primary mb-1">The Three Narrative Forces</h2>
        <p className="text-xs text-text-dim max-w-2xl">
          Every scene in the story is measured by three independent forces. These are not opinions — they are computed directly from the structural mutations in each scene.
        </p>
      </div>

      <div className="flex-1 flex flex-col gap-5">
        {/* Payoff */}
        <div className="flex-1 px-6 py-4 rounded-xl border border-red-400/10 bg-red-400/2">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
            <span className="text-sm font-semibold text-red-400">Payoff</span>
            <span className="text-[10px] text-text-dim ml-2">Did something permanent happen?</span>
          </div>
          <div className="flex items-start gap-8">
            <div className="shrink-0">
              <Tex display>{String.raw`P = \sum_{t \in \mathcal{T}} \delta(t) \;+\; \sum_{r \in \mathcal{R}} |\Delta v_r|`}</Tex>
              <div className="mt-2">
                <Tex display>{String.raw`\delta(t) = \begin{cases} 0.25 & \text{from} = \text{to} \;\text{(pulse)} \\ |\,\phi_{\text{to}} - \phi_{\text{from}}\,| & \text{otherwise} \end{cases}`}</Tex>
              </div>
            </div>
            <div className="text-[11px] text-text-dim leading-relaxed pt-1">
              <p className="mb-2">
                <Tex>{'\\phi'}</Tex> maps each thread status to a phase index: <span className="text-text-secondary font-mono">dormant=0, active=1, escalating=2, critical=3, terminal=4</span>.
              </p>
              <p className="mb-2">
                A thread jumping from <em>active</em> to <em>critical</em> scores 2. A thread resolving from <em>escalating</em> scores |4−2| = 2. Backwards transitions (tension easing) also score via absolute distance.
              </p>
              <p>
                <strong className="text-text-secondary">Pulses</strong> — mutations where the status stays the same (e.g. active→active) — earn 0.25, acknowledging the thread is engaged without shifting phase.
              </p>
            </div>
          </div>
        </div>

        {/* Change */}
        <div className="flex-1 px-6 py-4 rounded-xl border border-green-400/10 bg-green-400/2">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
            <span className="text-sm font-semibold text-green-400">Change</span>
            <span className="text-[10px] text-text-dim ml-2">How many lives were touched?</span>
          </div>
          <div className="flex items-start gap-8">
            <div className="shrink-0">
              <Tex display>{String.raw`C = \sum_{c \,\in\, \text{cast}} \log_2(1 + m_c)`}</Tex>
            </div>
            <div className="text-[11px] text-text-dim leading-relaxed pt-1">
              <p className="mb-2">
                <Tex>{'m_c'}</Tex> = continuity mutations (1 each) + relationship mutations (<Tex>{'|\\Delta v|'}</Tex> each, weighted by valence shift magnitude) + thread mutations (1 each). The log scale provides diminishing returns per character, rewarding breadth.
              </p>
              <p>
                This rewards <strong className="text-text-secondary">breadth</strong> over depth: a scene where five characters learn something new ripples wider than one where a single character reflects alone.
              </p>
            </div>
          </div>
        </div>

        {/* Knowledge */}
        <div className="flex-1 px-6 py-4 rounded-xl border border-blue-400/10 bg-blue-400/2">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-400" />
            <span className="text-sm font-semibold text-blue-400">Knowledge</span>
            <span className="text-[10px] text-text-dim ml-2">Is the world growing richer?</span>
          </div>
          <div className="flex items-start gap-8">
            <div className="shrink-0">
              <Tex display>{String.raw`K = \Delta N + \tfrac{1}{2}\,\Delta E`}</Tex>
            </div>
            <div className="text-[11px] text-text-dim leading-relaxed pt-1">
              <p className="mb-2">
                <Tex>{String.raw`\Delta N`}</Tex> = new world concepts (weight 1). <Tex>{String.raw`\Delta E`}</Tex> = new connections (weight ½). New concepts are valued higher than links between existing ones.
              </p>
              <p>
                5 edges scores 11.2, not 5. This rewards worlds where everything is interconnected.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page 2: Engagement & Swing ───────────────────────────────────────────────

function EngagementSwingPage() {
  return (
    <div className="flex flex-col h-full px-12 py-8">
      <div className="mb-6">
        <div className="text-[10px] uppercase tracking-widest text-text-dim mb-1 font-mono">Methodology · 2 of {METHODOLOGY_PAGES}</div>
        <h2 className="text-2xl font-bold text-text-primary mb-1">Engagement & Swing</h2>
        <p className="text-xs text-text-dim max-w-2xl">
          The three forces combine into an engagement signal. Swing measures how dynamically the story shifts between consecutive scenes.
        </p>
      </div>

      <div className="flex-1 flex flex-col gap-6">
        {/* Engagement */}
        <div className="flex-1 px-6 py-5 rounded-xl border border-amber-400/10 bg-amber-400/2">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="text-sm font-semibold text-amber-400">Engagement</span>
            <span className="text-[10px] text-text-dim ml-2">The heartbeat of the story</span>
          </div>
          <div className="flex items-start gap-10">
            <div className="shrink-0 space-y-3">
              <Tex display>{String.raw`z_i^{(k)} = \frac{x_i^{(k)} - \bar{x}^{(k)}}{\sigma^{(k)}}`}</Tex>
              <Tex display>{String.raw`E_i = \frac{z_i^P + z_i^C + z_i^K}{3}`}</Tex>
            </div>
            <div className="text-[11px] text-text-dim leading-relaxed pt-1">
              <p className="mb-2">
                Each raw force is first z-score normalized across all scenes — this puts payoff, change, and knowledge on a common scale regardless of their different natural magnitudes.
              </p>
              <p className="mb-2">
                Engagement <Tex>{'E_i'}</Tex> is then the equal-weighted mean of the three normalized forces. A scene with <Tex>{'E > 0'}</Tex> is above average intensity; <Tex>{'E < 0'}</Tex> is below. The engagement curve is Gaussian-smoothed (σ=1.5) for display and peak/valley detection.
              </p>
              <p>
                This is the primary diagnostic: it tells you where the story is working and where it loses the reader.
              </p>
            </div>
          </div>
        </div>

        {/* Peak & Valley Detection */}
        <div className="flex-1 px-6 py-4 rounded-xl border border-amber-400/10 bg-amber-400/2">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400/60" />
            <span className="text-sm font-semibold text-amber-400/80">Peak & Valley Detection</span>
            <span className="text-[10px] text-text-dim ml-2">Where are the climaxes and breathing room?</span>
          </div>
          <div className="flex items-start gap-10">
            <div className="shrink-0 space-y-2">
              <Tex display>{String.raw`\tilde{E} = \mathcal{G}_{\sigma=1.5} \ast E, \quad r = \max(2,\, \lfloor n/25 \rfloor)`}</Tex>
              <Tex display>{String.raw`\text{peak} \iff \tilde{E}_i = \max_{[i-r,\, i+r]} \tilde{E} \;\wedge\; \tilde{E}_i - \text{base}_i \geq 0.4\sigma_{\tilde{E}}`}</Tex>
            </div>
            <div className="text-[11px] text-text-dim leading-relaxed pt-1">
              <p className="mb-1">
                Engagement is Gaussian-smoothed, then local maxima within an adaptive window (wider for longer stories) are tested for <strong className="text-text-secondary">prominence</strong> — height above the nearest valley on either side.
              </p>
              <p>
                Only peaks rising ≥ 0.4σ above their base qualify. Valleys are detected symmetrically.
              </p>
            </div>
          </div>
        </div>

        {/* Swing */}
        <div className="flex-1 px-6 py-4 rounded-xl border border-yellow-400/10 bg-yellow-400/2">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
            <span className="text-sm font-semibold text-yellow-400">Swing</span>
            <span className="text-[10px] text-text-dim ml-2">Is the story breathing?</span>
          </div>
          <div className="flex items-start gap-10">
            <div className="shrink-0 space-y-2">
              <Tex display>{String.raw`S_i = \left\|\, \frac{\mathbf{f}_i - \mathbf{f}_{i-1}}{\boldsymbol{\mu}} \,\right\|_2 = \sqrt{\left(\frac{\Delta P}{\mu_P}\right)^{\!2} + \left(\frac{\Delta C}{\mu_C}\right)^{\!2} + \left(\frac{\Delta K}{\mu_K}\right)^{\!2}}`}</Tex>
            </div>
            <div className="text-[11px] text-text-dim leading-relaxed pt-1">
              <p className="mb-1">
                Euclidean distance between consecutive force vectors, normalized by reference means. <strong className="text-text-secondary">High swing</strong> = the story alternates scene types (action → reflection → revelation).
              </p>
              <p>
                <strong className="text-text-secondary">Low swing</strong> = consecutive scenes feel mechanically similar. The reader's attention may fatigue.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page 3: Grading ──────────────────────────────────────────────────────────

function GradingPage() {
  return (
    <div className="flex flex-col h-full px-12 py-8">
      <div className="mb-6">
        <div className="text-[10px] uppercase tracking-widest text-text-dim mb-1 font-mono">Methodology · 3 of {METHODOLOGY_PAGES}</div>
        <h2 className="text-2xl font-bold text-text-primary mb-1">Grading</h2>
        <p className="text-xs text-text-dim max-w-2xl">
          Scores are calibrated against literary reference works so that Harry Potter, The Great Gatsby, and Crime &amp; Punishment land at 88–93 overall.
        </p>
      </div>

      <div className="flex-1 flex flex-col gap-6">
        {/* Grade function */}
        <div className="px-6 py-5 rounded-xl border border-violet-400/10 bg-violet-400/2">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2.5 h-2.5 rounded-full bg-violet-400" />
            <span className="text-sm font-semibold text-violet-400">Grade Function</span>
          </div>
          <div className="flex items-start gap-10">
            <div className="shrink-0 space-y-3">
              <Tex display>{String.raw`\tilde{x} = \frac{\bar{x}}{\mu_{\text{ref}}}`}</Tex>
              <Tex display>{String.raw`g(\tilde{x}) = 25\!\left(1 - e^{-2\tilde{x}}\right)`}</Tex>
            </div>
            <div className="text-[11px] text-text-dim leading-relaxed pt-1">
              <p className="mb-2">
                Each force's mean value is divided by its literary reference mean to produce a normalized ratio <Tex>{'\\tilde{x}'}</Tex>. This is then mapped through a saturating exponential that grades 0–25.
              </p>
              <p className="mb-2">
                At <Tex>{'\\tilde{x}=1'}</Tex> (matching the reference), the grade is ≈ <strong className="text-text-secondary">21.6/25</strong>. Exceeding the reference yields diminishing returns — you can't brute-force your way to a perfect score.
              </p>
            </div>
          </div>
        </div>

        {/* Reference means */}
        <div className="px-6 py-4 rounded-xl border border-white/6 bg-white/2">
          <div className="text-[10px] uppercase tracking-widest text-text-dim mb-3">Reference Means (calibrated from literary works)</div>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Payoff', symbol: '\\mu_P', value: '1.5', color: '#EF4444' },
              { label: 'Change', symbol: '\\mu_C', value: '7.0', color: '#22C55E' },
              { label: 'Knowledge', symbol: '\\mu_K', value: '2.5', color: '#38BDF8' },
              { label: 'Swing', symbol: '\\mu_S', value: '1.5', color: '#FACC15' },
            ].map((ref) => (
              <div key={ref.label} className="text-center">
                <div className="text-lg font-mono font-bold" style={{ color: ref.color }}>{ref.value}</div>
                <div className="text-[10px] text-text-dim mt-0.5"><Tex>{ref.symbol}</Tex> · {ref.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Overall composition */}
        <div className="px-6 py-5 rounded-xl border border-white/6 bg-white/2">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm font-semibold text-text-primary">Overall Score</span>
          </div>
          <div className="flex items-start gap-10">
            <div className="shrink-0 space-y-2">
              <Tex display>{String.raw`\text{Overall} = g_P + g_C + g_K + g_S`}</Tex>
            </div>
            <div className="text-[11px] text-text-dim leading-relaxed pt-1">
              <p>
                Four sub-grades (Payoff, Change, Knowledge, Swing) each score 0–25, summing to a maximum of 100.
              </p>
            </div>
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
    case 1: return <EngagementSwingPage />;
    case 2: return <GradingPage />;
    default: return <ForcesPage />;
  }
}
