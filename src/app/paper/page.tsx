'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { ArchetypeIcon } from '@/components/ArchetypeIcon';

/* ── LaTeX helpers ───────────────────────────────────────────────────────── */

function Tex({ children, display }: { children: string; display?: boolean }) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    setHtml(katex.renderToString(children, {
      displayMode: display ?? false,
      throwOnError: false,
    }));
  }, [children, display]);
  if (!html) return null;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function Eq({ tex, label }: { tex: string; label?: string }) {
  return (
    <div className="my-5 px-5 py-4 rounded-lg bg-white/[0.03] border border-white/6 overflow-x-auto">
      {label && <span className="text-[10px] uppercase tracking-wider text-white/20 block mb-2 font-mono">{label}</span>}
      <div className="text-center">
        <Tex display>{tex}</Tex>
      </div>
    </div>
  );
}

/* ── Section divider ─────────────────────────────────────────────────────── */

function Section({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-mono shrink-0">{label}</h2>
        <div className="flex-1 h-px bg-white/6" />
      </div>
      {children}
    </section>
  );
}

/* ── Prose helpers ───────────────────────────────────────────────────────── */

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-white/50 leading-[1.85] mt-3 first:mt-0">{children}</p>;
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="text-white/70">{children}</strong>;
}

/* ── Shape mini-curve ────────────────────────────────────────────────────── */

function ShapeCurve({ curve, color }: { curve: [number, number][]; color: string }) {
  const points = curve.map(([x, y]) => `${x * 32},${16 - y * 14}`).join(' ');
  return (
    <svg width="32" height="16" viewBox="0 0 32 16" className="shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Data ────────────────────────────────────────────────────────────────── */

const ARCHETYPES = [
  { key: 'masterwork', name: 'Masterwork', desc: 'All three balanced', color: '#f59e0b' },
  { key: 'epic', name: 'Epic', desc: 'Payoff + Change', color: '#ef4444' },
  { key: 'chronicle', name: 'Chronicle', desc: 'Payoff + Knowledge', color: '#3b82f6' },
  { key: 'saga', name: 'Saga', desc: 'Change + Knowledge', color: '#8b5cf6' },
  { key: 'classic', name: 'Classic', desc: 'Payoff-driven', color: '#10b981' },
  { key: 'anthology', name: 'Anthology', desc: 'Change-driven', color: '#ec4899' },
  { key: 'tome', name: 'Tome', desc: 'Knowledge-driven', color: '#06b6d4' },
  { key: 'emerging', name: 'Emerging', desc: 'Finding its voice', color: '#6b7280' },
] as const;

const SHAPES = [
  { name: 'Climactic', desc: 'Build, climax, release', curve: [[0,0.2],[0.25,0.5],[0.45,0.8],[0.5,1],[0.55,0.8],[0.75,0.5],[1,0.25]] as [number,number][] },
  { name: 'Episodic', desc: 'Multiple equal peaks', curve: [[0,0.3],[0.1,0.7],[0.2,0.3],[0.35,0.75],[0.5,0.25],[0.65,0.8],[0.8,0.3],[0.9,0.7],[1,0.35]] as [number,number][] },
  { name: 'Rebounding', desc: 'Dip then recovery', curve: [[0,0.6],[0.2,0.35],[0.4,0.1],[0.6,0.3],[0.8,0.65],[1,0.9]] as [number,number][] },
  { name: 'Peaking', desc: 'Early peak, trails off', curve: [[0,0.4],[0.2,0.85],[0.35,1],[0.55,0.65],[0.75,0.35],[1,0.15]] as [number,number][] },
  { name: 'Escalating', desc: 'Rising toward the end', curve: [[0,0.1],[0.2,0.2],[0.4,0.35],[0.6,0.55],[0.8,0.8],[1,1]] as [number,number][] },
  { name: 'Flat', desc: 'Little variation', curve: [[0,0.5],[0.25,0.52],[0.5,0.48],[0.75,0.51],[1,0.5]] as [number,number][] },
] as const;

/* ── Navigation items ────────────────────────────────────────────────────── */

const NAV = [
  { id: 'abstract', label: 'Abstract' },
  { id: 'problem', label: 'The Problem' },
  { id: 'approach', label: 'Approach' },
  { id: 'forces', label: 'Forces' },
  { id: 'validation', label: 'Validation' },
  { id: 'derived', label: 'Derived Metrics' },
  { id: 'grading', label: 'Grading' },
  { id: 'markov', label: 'Markov Chains' },
  { id: 'mcts', label: 'MCTS' },
  { id: 'classification', label: 'Classification' },
  { id: 'open-source', label: 'Open Source' },
];

/* ── Side timeline nav ───────────────────────────────────────────────────── */

function TimelineNav({ activeId }: { activeId: string }) {
  return (
    <nav className="hidden xl:flex flex-col gap-0 fixed top-1/2 -translate-y-1/2 left-[max(2rem,calc((100vw-56rem)/2-14rem))]">
      {NAV.map(({ id, label }, i) => {
        const active = id === activeId;
        return (
          <a
            key={id}
            href={`#${id}`}
            className="group flex items-center gap-3 py-2.5 transition-colors"
          >
            {/* Dot + line */}
            <div className="relative flex flex-col items-center w-2">
              <div className={`w-1.5 h-1.5 rounded-full transition-all duration-200 ${
                active ? 'bg-white/70 scale-125' : 'bg-white/15 group-hover:bg-white/30'
              }`} />
              {i < NAV.length - 1 && (
                <div className="w-px h-6 bg-white/8 mt-0.5" />
              )}
            </div>
            {/* Label */}
            <span className={`text-[11px] font-mono transition-colors duration-200 whitespace-nowrap ${
              active ? 'text-white/60' : 'text-white/15 group-hover:text-white/35'
            }`}>
              {label}
            </span>
          </a>
        );
      })}
    </nav>
  );
}

/* ── Active section hook ─────────────────────────────────────────────────── */

function useActiveSection(ids: string[]) {
  const [activeId, setActiveId] = useState(ids[0]);

  useEffect(() => {
    function update() {
      const threshold = window.innerHeight * 0.35;
      let best = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= threshold) best = id;
      }
      setActiveId(best);
    }

    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [ids]);

  return activeId;
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function PaperPage() {
  const activeId = useActiveSection(NAV.map((n) => n.id));

  return (
    <div className="min-h-screen bg-bg-base">
      <TimelineNav activeId={activeId} />

      <div className="max-w-4xl mx-auto px-4 sm:px-8 pt-20 pb-32">

        {/* Title */}
        <div className="mb-16 animate-fade-up">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/25 mb-4">White Paper</p>
          <h1 className="text-4xl sm:text-5xl font-bold leading-tight text-white/90 mb-4">
            Quantifying Narrative Force
          </h1>
          <p className="text-[15px] text-white/40 leading-relaxed max-w-xl">
            A framework for measuring what stories do to readers, derived from knowledge graph mutations across scenes.
          </p>
          <p className="text-[11px] text-white/20 font-mono mt-3">~11 min read</p>
        </div>

        <div className="space-y-16">

          {/* ── Abstract ──────────────────────────────────────────────── */}
          <Section id="abstract" label="Abstract">
            <P>
              A chapter lands. A reveal reframes everything before it. A quiet scene holds more weight than the battle it follows. Readers recognise these moments instantly, yet no existing metric captures why they work. Sentiment arcs miss structure. Topic models miss momentum. The patterns that make stories feel inevitable — threads converging, knowledge compounding, relationships shifting at exactly the right moment — have remained beyond the reach of computation.
            </P>
            <P>
              This paper introduces a framework that makes them computable. We model a narrative as a <B>knowledge graph that mutates scene by scene</B>, then derive three orthogonal forces — Payoff, Change, and Knowledge — from those mutations alone. The formulas are deterministic, z-score normalised, and genre-agnostic. They compose into higher-order metrics — Tension, Delivery, Swing — that trace the shape of a story. Applied to <em>Harry Potter and the Sorcerer&apos;s Stone</em>, the delivery curve peaks at the Sorting Hat, the troll fight, and the Quirrell confrontation. No human labeled those peaks. The math found them.
            </P>
            <P>
              Below we describe the formulas, the extraction pipeline, and a grading system calibrated against published literature. The framework is open source, every constant is tunable, and the whole thing was written to be forked.
            </P>
          </Section>

          {/* ── The Problem ───────────────────────────────────────────── */}
          <Section id="problem" label="The Problem">
            <P>
              Sentiment analysis sees that a chapter is &ldquo;positive.&rdquo; It misses that the warmth comes from an unreliable narrator, and that the scene&apos;s structural role is the opposite of its surface tone. Topic modeling sees that a chapter mentions &ldquo;war.&rdquo; It cannot distinguish a thread that just escalated from dormant to critical from one that resolved three scenes ago — where this mention is merely an echo.
            </P>
            <P>
              The gap is not incremental. What readers actually experience — tension coiling across chapters, threads paying off in unexpected combinations, a world clicking into focus one rule at a time — arises from <B>structural mutations</B>. Which threads changed status. How relationships shifted. What new knowledge entered the world. Sentiment and topic frequencies are shadows cast by these deeper movements. We needed formulas that operate on the mutations themselves, not on the words that happen to describe them.
            </P>
          </Section>

          {/* ── Approach ──────────────────────────────────────────────── */}
          <Section id="approach" label="Approach">
            <P>
              A scene does not merely contain words. It <em>does</em> things — escalates a rivalry, reveals a secret, shifts an alliance, introduces a law of physics. We model every scene as producing mutations across three structural layers:
            </P>
            <ul className="mt-3 space-y-2 text-[13px] text-white/50 leading-[1.85]">
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">1.</span>
                <span><B>Threads</B> — narrative tensions (a rivalry, a secret, a quest) that move through lifecycle phases: dormant, active, escalating, critical, resolved/subverted/abandoned. A thread is the unit of dramatic promise.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">2.</span>
                <span><B>Characters</B> — continuity mutations (what someone learns, loses, or becomes) and relationship valence shifts. The social fabric of the story, tracked edge by edge.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">3.</span>
                <span><B>World knowledge</B> — a graph of laws, systems, concepts, and tensions. Nodes are ideas; edges are the connections between them. When a reader says a world &ldquo;feels deep,&rdquo; this graph is what they are sensing.</span>
              </li>
            </ul>
            <P>
              An LLM reads each scene and records these mutations as structured data. Then deterministic formulas — no LLM in the loop — compute forces from the mutations. The separation matters. The model handles comprehension; the math handles measurement. Every formula in this paper is auditable. If you disagree with a weight, change it. The science is in the math, not the model.
            </P>
          </Section>

          {/* ── The Three Forces ──────────────────────────────────────── */}
          <Section id="forces" label="The Three Forces">

            <div className="mb-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">Payoff</h3>
              <P>
                Did something permanent happen? Payoff measures thread phase transitions — moments the story can&apos;t take back.
              </P>
              <Eq tex="P = \sum_{t} \max\left(0,\ \varphi_{\text{to}} - \varphi_{\text{from}}\right)"/>
              <P>
                Threads carry a phase index: dormant (0), active (1), escalating (2), critical (3), resolved/subverted/abandoned (4). A thread jumping from active to critical contributes <Tex>{'|3 - 1| = 2'}</Tex>. Threads mentioned without transitioning earn a pulse of 0.25 — enough to stay visible without inflating the score.
              </P>
            </div>

            <div className="mb-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">Change</h3>
              <P>
                How intensely did this scene transform? A tight two-character confrontation scores the same as a ten-character ensemble with equal total mutations — the formula is cast-blind.
              </P>
              <Eq tex={String.raw`C = \sqrt{\,M_c\,} \;+\; \sqrt{\,|\mathcal{E}|\,}`} />
              <P>
                <Tex>{String.raw`M_c`}</Tex> is the number of continuity mutations (what characters learn, lose, or become) and <Tex>{String.raw`|\mathcal{E}|`}</Tex> is the event count. Square root scaling gives diminishing returns while preserving meaningful spikes — a dense confrontation with 8 mutations scores 2.8&times; a quiet scene with 1 mutation, producing visible peaks and valleys in the force graph.
              </P>
            </div>

            <div>
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">Knowledge</h3>
              <P>
                Is the world getting richer? Knowledge tracks expansion of the world-building graph. Revealing a new law of magic contributes more than linking two rules the reader already knows.
              </P>
              <Eq tex={String.raw`K = \Delta N + \sqrt{\Delta E}`} />
              <P>
                <Tex>{'\\Delta N'}</Tex> counts new nodes (laws, systems, concepts, tensions). <Tex>{'\\Delta E'}</Tex> counts new edges. Nodes contribute linearly — each new concept is genuinely new information. Edges use square root scaling — the first few connections between concepts matter more than the tenth, preventing bulk edge additions from inflating Knowledge. This applies to every genre — fantasy magic systems, literary class structures, crime world hierarchies.
              </P>
            </div>
          </Section>

          {/* ── Validation ──────────────────────────────────────────── */}
          <Section id="validation" label="Validation">
            <P>
              Do the formulas capture what readers actually feel? We tested against <em>Harry Potter and the Sorcerer&apos;s Stone</em> — a novel whose dramatic peaks are well-established in popular memory. The delivery curve below is computed entirely from structural mutations with no human annotation.
            </P>

            {/* Annotated Delivery Curve — computed from /works/harry_potter JSON via the same formulas used in the app */}
            {(() => {
              // Smoothed delivery values computed from the actual works JSON:
              // raw forces → z-score normalise → delivery formula → Gaussian smooth (σ=1.5)
              const delivery = [1.067,0.858,0.558,0.392,0.471,0.626,0.614,0.402,0.174,0.115,0.224,0.335,0.288,0.081,-0.155,-0.299,-0.325,-0.255,-0.097,0.109,0.263,0.266,0.129,-0.018,-0.041,0.097,0.325,0.553,0.756,0.933,1.022,0.946,0.775,0.68,0.656,0.534,0.273,0.016,-0.118,-0.144,-0.123,-0.078,0.011,0.189,0.477,0.78,0.905,0.79,0.613,0.523,0.449,0.284,0.066,-0.077,-0.082,-0.035,-0.059,-0.114,-0.087,-0.018,-0.04,-0.179,-0.327,-0.334,-0.16,0.076,0.248,0.308,0.242,0.097,0.023,0.07,0.064,-0.147,-0.437,-0.574,-0.469,-0.212,-0.007,-0.033,-0.241,-0.387,-0.313,-0.065,0.24,0.504,0.662,0.687,0.582,0.406,0.238];
              const n = delivery.length;
              const W = 620, H = 200;
              const PAD = { top: 30, right: 20, bottom: 40, left: 40 };
              const cw = W - PAD.left - PAD.right;
              const ch = H - PAD.top - PAD.bottom;
              const dMin = Math.min(...delivery);
              const dMax = Math.max(...delivery);
              const range = dMax - dMin;
              const toX = (i: number) => PAD.left + (i / (n - 1)) * cw;
              const toY = (v: number) => PAD.top + ch - ((v - dMin) / range) * ch;
              const zeroY = toY(0);

              const points = delivery.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');

              const annotations = [
                { scene: 1, label: 'Dursleys\' ordinary day', side: 'above' as const },
                { scene: 12, label: 'Hagrid reveals truth', side: 'above' as const },
                { scene: 17, label: 'Diagon Alley', side: 'below' as const },
                { scene: 31, label: 'Sorting Hat', side: 'above' as const },
                { scene: 47, label: 'Troll fight', side: 'above' as const },
                { scene: 51, label: 'First Quidditch', side: 'above' as const },
                { scene: 64, label: 'Snape in the forest', side: 'below' as const },
                { scene: 73, label: 'Forbidden Forest', side: 'above' as const },
                { scene: 76, label: 'Quiet before storm', side: 'below' as const },
                { scene: 86, label: 'Quirrell confrontation', side: 'above' as const },
                { scene: 88, label: 'Dumbledore reveals truth', side: 'above' as const },
              ];

              return (
                <div className="my-8">
                  <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
                    {/* Grid lines */}
                    {[-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1.0].map((v) => (
                      <g key={v}>
                        <line x1={PAD.left} y1={toY(v)} x2={PAD.left + cw} y2={toY(v)} stroke="white" strokeOpacity={v === 0 ? 0.15 : 0.05} />
                        <text x={PAD.left - 6} y={toY(v) + 3} textAnchor="end" fill="white" fillOpacity="0.2" fontSize="8" fontFamily="monospace">{v.toFixed(1)}</text>
                      </g>
                    ))}

                    {/* Positive fill */}
                    <path
                      d={`M${toX(0)},${zeroY} ${delivery.map((v, i) => `L${toX(i)},${Math.min(toY(v), zeroY)}`).join(' ')} L${toX(n - 1)},${zeroY} Z`}
                      fill="#F59E0B" fillOpacity="0.08"
                    />
                    {/* Negative fill */}
                    <path
                      d={`M${toX(0)},${zeroY} ${delivery.map((v, i) => `L${toX(i)},${Math.max(toY(v), zeroY)}`).join(' ')} L${toX(n - 1)},${zeroY} Z`}
                      fill="#3B82F6" fillOpacity="0.06"
                    />
                    {/* Delivery line */}
                    <polyline points={points} fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinejoin="round" />

                    {/* Annotations */}
                    {annotations.map(({ scene, label, side }) => {
                      const i = scene - 1;
                      const x = toX(i);
                      const y = toY(delivery[i]);
                      const above = side === 'above';
                      return (
                        <g key={scene}>
                          <line x1={x} y1={y} x2={x} y2={above ? y - 16 : y + 16} stroke="white" strokeOpacity="0.2" strokeDasharray="2 2" />
                          <circle cx={x} cy={y} r={3} fill={delivery[i] > 0 ? '#FCD34D' : '#93C5FD'} opacity="0.9" />
                          <text
                            x={x} y={above ? y - 20 : y + 24}
                            textAnchor="middle" fill="white" fillOpacity="0.5" fontSize="7"
                            fontFamily="system-ui"
                          >
                            {label}
                          </text>
                        </g>
                      );
                    })}

                    {/* X axis label */}
                    <text x={PAD.left + cw / 2} y={H - 5} textAnchor="middle" fill="white" fillOpacity="0.2" fontSize="9" fontFamily="system-ui">
                      Scene (1&ndash;{n})
                    </text>
                    <text x={8} y={PAD.top + ch / 2} textAnchor="middle" fill="white" fillOpacity="0.2" fontSize="9" fontFamily="system-ui" transform={`rotate(-90, 8, ${PAD.top + ch / 2})`}>
                      Delivery
                    </text>
                  </svg>
                  <p className="text-[10px] text-white/30 text-center mt-2">
                    Harry Potter and the Sorcerer&apos;s Stone  —  smoothed delivery curve with annotated peaks.
                    <br />Computed from structural mutations in <code className="text-white/40">works/harry_potter_and_the_sorcerer_s_stone.json</code>.
                  </p>
                </div>
              );
            })()}

            <P>
              The peaks correspond to moments any reader would identify: the Sorting Hat ceremony (entry into the magical world), the troll fight (the friendship-forging trial), the first Quidditch match, and the climactic confrontation with Quirrell followed by Dumbledore&apos;s revelations. The valleys — the journey to Diagon Alley, Snape&apos;s suspicious forest encounter, and the quiet dread before the finale — are exactly the buildup scenes that make the peaks feel earned.
            </P>
            <P>
              This is the core claim: <B>deterministic formulas applied to structural mutations recover the dramatic shape of a narrative without reading the prose</B>. The formulas don&apos;t know that Hagrid is a beloved character or that the Sorting Hat is a moment of belonging. They see thread transitions, relationship shifts, and knowledge graph expansion. The dramatic shape emerges from the mathematics.
            </P>
            <P>
              The same formulas, applied to AI-generated narratives, reveal a consistent structural gap. Published literature scores 90+ with varied delivery curves — visible peaks and valleys. AI-generated text typically scores 70&ndash;80 with flatter curves: the mutations are structurally valid but uniformly dense, lacking the contrast between buildup and payoff that creates memorable moments. This gap motivated the Markov chain pacing system described below.
            </P>
          </Section>

          {/* ── Derived Metrics ───────────────────────────────────────── */}
          <Section id="derived" label="Derived Metrics">
            <P>
              The three forces combine into higher-order metrics that capture dynamics readers actually feel.
            </P>

            <div className="mt-6 mb-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">Tension</h3>
              <Eq tex="T_i = C_i + K_i - P_i" />
              <P>
                The coiled spring. High when characters change and the world expands but nothing resolves. Drops sharply at payoff scenes. A story that builds tension for ten scenes and releases it in one produces the classic earned climax.
              </P>
            </div>

            <div className="mb-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">Delivery</h3>
              <Eq tex="E_i = 0.5 P_i + 0.5 \tanh\!\left(\tfrac{C_i}{2}\right) + 0.5 \tanh\!\left(\tfrac{K_i}{2}\right) + 0.3 \cdot \text{contrast}_i" />
              <P>
                The dopamine hit. Payoff is linear — high payoff IS the climax signal and should not be dampened. Change and Knowledge pass through <Tex>{'\\tanh(x/2)'}</Tex>, which smoothly saturates toward &plusmn;1, preventing ensemble scenes from inflating delivery through sheer breadth. The contrast term, <Tex>{'\\text{contrast}_i = \\max(0,\\; T_{i-1} - T_i)'}</Tex>, rewards tension-release patterns: the same payoff lands harder after buildup than it does in isolation.
              </P>
            </div>

            <div>
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">Swing</h3>
              <Eq tex="S_i = \sqrt{\left(\frac{\Delta P}{\mu_P}\right)^2 + \left(\frac{\Delta C}{\mu_C}\right)^2 + \left(\frac{\Delta K}{\mu_K}\right)^2}" />
              <P>
                The story breathing. Normalized Euclidean distance between consecutive force snapshots. High swing means dynamic pacing; low swing means consecutive scenes land at similar intensities. Each delta is divided by its reference mean so all three forces contribute equally.
              </P>
            </div>
          </Section>

          {/* ── Grading ───────────────────────────────────────────────── */}
          <Section id="grading" label="Grading">
            <P>
              Stories receive a score out of 100 — 25 per force — on an exponential curve calibrated against reference works including <em>Harry Potter</em>, <em>The Great Gatsby</em>, <em>Crime and Punishment</em>, and <em>Coiling Dragon</em>.
            </P>
            <Eq tex="g(\tilde{x}) = 25\left(1 - e^{-2\tilde{x}}\right) \qquad \text{where} \quad \tilde{x} = \frac{\bar{x}}{\mu_{\text{ref}}}" />
            <P>
              At <Tex>{'\\tilde{x} = 1'}</Tex> (matching the reference mean), the grade is ~22/25. The curve is steep early — rewarding baseline competence — and flattens at high levels. Reference works land between 88 and 93.
            </P>

            <P>
              The reference means (<Tex>{'\\mu_{\\text{ref}}'}</Tex>) are calibrated from famous works including <em>Harry Potter</em>, <em>The Great Gatsby</em>, <em>Crime and Punishment</em>, and <em>Coiling Dragon</em>:
            </P>
            <div className="mt-3 mb-4 grid grid-cols-3 gap-2 text-[11px] max-w-sm">
              {[
                { force: 'Payoff', value: '1.5', color: '#EF4444' },
                { force: 'Change', value: '4', color: '#22C55E' },
                { force: 'Knowledge', value: '3.5', color: '#3B82F6' },
              ].map(({ force, value, color }) => (
                <div key={force} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-white/50">{force}</span>
                  <span className="ml-auto font-mono text-white/70">{value}</span>
                </div>
              ))}
            </div>
            <P>
              Swing is already mean-normalized by the force reference means during computation, so it is graded directly without a separate reference. The overall score is the sum of all four sub-grades: <Tex>{'\\text{Overall} = g(\\tilde{P}) + g(\\tilde{C}) + g(\\tilde{K}) + g(\\tilde{S})'}</Tex>.
            </P>
            <P>
              A consistent gap emerges between human and AI-generated texts. Published literature routinely scores 90+ — dense thread lifecycles, earned payoffs, and layered world-building compound over hundreds of pages. AI-generated narratives typically land in the 70&ndash;80 range. The mutations are structurally valid but thinner: threads resolve too neatly, character change lacks accumulation, and knowledge graphs expand without the connective depth that human authors build instinctively. This gap is not a flaw in the grading — it reflects a real structural difference that the force formulas are designed to detect.
            </P>
          </Section>

          {/* ── Classification ────────────────────────────────────────── */}
          {/* ── Markov Chains ─────────────────────────────────────────── */}
          <Section id="markov" label="Markov Chains">
            <P>
              The eight cube corners form a finite state space. Every scene in a story occupies one corner, and the transition from scene N to scene N+1 is a state transition. Across an entire novel, these transitions form an empirical Markov chain — a transition matrix <Tex>{'T \\in \\mathbb{R}^{8 \\times 8}'}</Tex> where <Tex>{'T_{ij}'}</Tex> is the probability of moving from mode <Tex>{'i'}</Tex> to mode <Tex>{'j'}</Tex>.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">A Story&apos;s Fingerprint</h3>
            <P>
              Different stories produce radically different matrices. We computed transition matrices from several published works by classifying each scene into its nearest cube corner and counting consecutive transitions:
            </P>

            {/* HP State Graph — inline SVG */}
            <div className="my-6 flex flex-col items-center gap-4">
              <svg width="360" height="360" viewBox="0 0 360 360" className="select-none">
                {/* Nodes in circle */}
                {(() => {
                  const corners = ['HHH','HHL','HLH','HLL','LHH','LHL','LLH','LLL'] as const;
                  const names = ['Epoch','Climax','Revelation','Closure','Discovery','Growth','Lore','Rest'];
                  const colors = ['#f59e0b','#ef4444','#a855f7','#6366f1','#22d3ee','#22c55e','#3b82f6','#6b7280'];
                  const visits = [13,11,9,7,3,10,19,19];
                  const cx = 180, cy = 180, r = 140;
                  const maxV = Math.max(...visits);
                  const positions = corners.map((_, i) => {
                    const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
                    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
                  });
                  // Top transitions (count >= 3)
                  const edges: [number,number,number][] = [
                    [0,6,4],[0,3,2],[0,5,2],[0,2,2], // Epoch→
                    [1,6,4],[1,2,2],[1,7,2],           // Climax→
                    [2,5,3],                            // Revelation→Growth
                    [3,0,2],[3,7,2],                    // Closure→
                    [5,7,4],                            // Growth→Rest
                    [6,1,4],[6,5,3],[6,7,4],            // Lore→
                    [7,6,5],[7,1,3],[7,2,3],[7,3,3],    // Rest→
                  ];
                  const maxE = 5;
                  return (
                    <>
                      {edges.map(([fi,ti,count], ei) => {
                        const p1 = positions[fi], p2 = positions[ti];
                        const dx = p2.x-p1.x, dy = p2.y-p1.y;
                        const len = Math.sqrt(dx*dx+dy*dy);
                        const nx = -dy/len, ny = dx/len;
                        const nr = 14 + (visits[ti]/maxV)*8;
                        const ratio = Math.max(0,(len-nr-8)/len);
                        return (
                          <line key={ei}
                            x1={p1.x+4*nx} y1={p1.y+4*ny}
                            x2={p1.x+dx*ratio+4*nx} y2={p1.y+dy*ratio+4*ny}
                            stroke="rgba(52,211,153,1)" strokeWidth={1+2*(count/maxE)}
                            opacity={0.15+0.6*(count/maxE)} strokeLinecap="round"
                          />
                        );
                      })}
                      {corners.map((_, i) => {
                        const p = positions[i];
                        const nr = 14 + (visits[i]/maxV)*8;
                        return (
                          <g key={i}>
                            <circle cx={p.x} cy={p.y} r={nr} fill={colors[i]} opacity={0.85} />
                            <text x={p.x} y={p.y+1} fill="#fff" fontSize="9" fontWeight="600" textAnchor="middle" dominantBaseline="middle">{names[i]}</text>
                            <text x={p.x} y={p.y+nr+12} fill="#9ca3af" fontSize="8" textAnchor="middle">{visits[i]}x</text>
                          </g>
                        );
                      })}
                    </>
                  );
                })()}
              </svg>
              <p className="text-[10px] text-white/30 text-center">
                Harry Potter and the Sorcerer&apos;s Stone  —  91 scenes, 90 transitions.
                <br />Node size = visit frequency. Edge thickness = transition probability.
              </p>
            </div>

            <P>
              Harry Potter&apos;s matrix reveals a balanced explorer — high entropy (2.88/3.00), low self-loops (12%), and a 43/57 payoff-to-buildup ratio. Lore and Rest are the dominant modes (19 visits each), serving as the connective tissue between peaks. The story visits all eight modes regularly, with strong Lore&harr;Rest oscillation providing breathing room between dramatic moments.
            </P>
            <P>
              By contrast, Nineteen Eighty-Four produces a pressure cooker — buildup-dominant (66%), with long dwelling in Rest and Growth before sudden Epoch eruptions. The Great Gatsby oscillates like a pendulum between Rest and Epoch. Each matrix is a structural fingerprint that captures the rhythm no single metric can express.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">Stationary Distribution</h3>
            <P>
              The stationary distribution <Tex>{'\\pi'}</Tex> of a transition matrix answers: if this story continued forever with its current patterns, what fraction of time would it spend in each mode? We compute it via power iteration:
            </P>
            <Eq tex={String.raw`\pi^{(t+1)}_j = \sum_i \pi^{(t)}_i \cdot T_{ij}`} />
            <P>
              This distribution is the story&apos;s gravitational center. A story with 40% Rest in its stationary distribution naturally orbits quiet moments. One with 30% Epoch is permanently intense. The distribution doesn&apos;t classify — it describes. Two stories can have the same overall score but completely different stationary distributions, revealing different structural personalities.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">Rhythm Profiles for Generation</h3>
            <P>
              The most powerful application of Markov chains is not analysis but generation. Before generating an arc, the engine samples a pacing sequence from the transition matrix: starting from the current mode (the last scene&apos;s cube corner), it walks the chain for N steps, producing a sequence like <span className="font-mono text-white/50">Growth &rarr; Lore &rarr; Climax &rarr; Rest &rarr; Growth</span>.
            </P>
            <P>
              Each step in the sequence becomes a per-scene constraint: Scene 1 must have a Growth force profile (high Change, low Payoff), Scene 3 must spike all forces (Climax). This prevents the AI from defaulting to uniform density — the Markov chain forces variation by assigning different modes to different scenes.
            </P>
            <P>
              Users select a <em>rhythm profile</em> — a transition matrix derived from a published work — to shape their story&apos;s pacing. A story using Harry Potter&apos;s matrix will breathe like Harry Potter: exploratory, varied, with regular returns to lore. A story using 1984&apos;s matrix will dwell in tension before erupting. The matrices are computed automatically from the analysed works in the system.
            </P>
          </Section>

          {/* ── MCTS ──────────────────────────────────────────────────── */}
          <Section id="mcts" label="MCTS">
            <P>
              Monte Carlo Tree Search adapts the game-playing algorithm to narrative space. Instead of board positions, nodes are narrative states — the full knowledge graph after a sequence of scenes. Instead of moves, edges are generated arcs. Instead of win/loss, the evaluation function is the force grading system.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">How It Works</h3>
            <P>
              <strong>Selection</strong>: Starting from the current narrative state, UCB1 selects which node to expand — balancing exploitation (high-scoring paths) against exploration (under-visited branches).
            </P>
            <Eq tex={String.raw`\text{UCB1}(n) = \frac{Q(n)}{N(n)} + C \sqrt{\frac{\ln N(\text{parent})}{N(n)}}`} />
            <P>
              <strong>Expansion</strong>: The selected node generates a new arc via the LLM. Each expansion is paced by a fresh Markov chain sample from the story&apos;s rhythm profile, ensuring every branch explores a different force trajectory. The narrative seed provides creative diversity — the Markov chain provides structural diversity.
            </P>
            <P>
              <strong>Evaluation</strong>: The generated arc is scored using the force grading system — the same formulas applied to published literature. An arc scoring 85 has comparable structural density to the reference works.
            </P>
            <P>
              <strong>Backpropagation</strong>: The score propagates up the tree. Paths that consistently produce high-scoring arcs accumulate visit counts, making them more likely to be selected for further expansion.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">Markov-Augmented Search</h3>
            <P>
              The integration of Markov chains with MCTS produces a search that is both structurally informed and creatively diverse. Each expansion samples a fresh pacing sequence from the transition matrix, meaning sibling nodes in the tree explore different force trajectories even when given similar creative direction. One sibling might sample <span className="font-mono text-white/50">Rest &rarr; Growth &rarr; Epoch</span> while another gets <span className="font-mono text-white/50">Lore &rarr; Lore &rarr; Climax &rarr; Closure</span>.
            </P>
            <P>
              The rhythm profile acts as a structural prior — biasing the search toward transitions that produce good narratives (as observed in published works) without constraining the creative content. The LLM fills the <em>what</em>; the Markov chain shapes the <em>how much</em>.
            </P>
            <P>
              After search completes, the best path is selected by either highest average score (hill-climbing) or most-visited path (robust MCTS). The user can inspect every branch, see the cube position sequence for each arc, and commit the chosen path to the story.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">Search Modes</h3>
            <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
              {[
                { name: 'Freedom', desc: 'Dynamic UCB1 allocation. Promising nodes earn more children; dead ends are abandoned early.' },
                { name: 'Constrained', desc: 'Complete tree. Every node at each depth gets a fixed number of children before going deeper.' },
                { name: 'Baseline', desc: 'Unlimited children per node. Keep generating until a target score is met, then descend.' },
                { name: 'Greedy', desc: 'Depth-first. Generate children at the frontier, pick the best, descend immediately.' },
              ].map(({ name, desc }) => (
                <div key={name} className="flex flex-col gap-1 px-3 py-2.5 rounded-lg border border-white/6 bg-white/2">
                  <span className="font-medium text-white/70">{name}</span>
                  <p className="text-white/35">{desc}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Classification ──────────────────────────────────────── */}
          <Section id="classification" label="Classification">

            <h3 className="text-[15px] font-semibold text-white/80 mb-3">Archetypes</h3>
            <P>
              Each story is classified by which forces dominate. A force is &ldquo;dominant&rdquo; if it scores &ge; 20 and is within 5 points of the maximum.
            </P>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              {ARCHETYPES.map(({ key, name, desc, color }) => (
                <div key={key} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-white/6 bg-white/2">
                  <ArchetypeIcon archetypeKey={key} size={16} color={color} />
                  <div>
                    <span className="font-medium" style={{ color }}>{name}</span>
                    <p className="text-white/35 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">Narrative Shapes</h3>
            <P>
              The Gaussian-smoothed delivery curve is classified into one of five shapes using six core metrics: overall slope, peak count, peak dominance, peak position, trough depth, and recovery strength.
            </P>
            <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
              {SHAPES.map(({ name, desc, curve }) => (
                <div key={name} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-white/6 bg-white/2">
                  <ShapeCurve curve={curve} color="#fb923c" />
                  <div>
                    <span className="font-medium text-white/70">{name}</span>
                    <p className="text-white/35 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Open Source ───────────────────────────────────────────── */}
          <Section id="open-source" label="Open Source">
            <P>
              Narrative Engine is fully open source. Every formula in this paper lives in the codebase. You can read it, run it, and change it.
            </P>
            <P>
              We made this choice deliberately. Narrative analysis should be transparent — if you disagree with how we weight payoff against knowledge, change the constant. If your genre needs a fourth force, add it. The formulas are tools, not doctrine.
            </P>
            <P>
              We&apos;d especially love to see the community experiment with their own texts. Paste any corpus into the <Link href="/analysis" className="text-white/60 underline underline-offset-2 hover:text-white/80 transition-colors">analysis pipeline</Link> — novels, screenplays, web serials, fanfiction. See where the peaks land, what archetype emerges, and whether the force landscape matches your intuition. When it doesn&apos;t, that&apos;s interesting too. Pull requests welcome.
            </P>

            <div className="mt-8">
              <Link
                href="/case-analysis"
                className="text-[11px] px-4 py-2 rounded-full border border-amber-500/30 bg-amber-500/5 text-amber-400/80 hover:text-amber-300 hover:border-amber-500/50 hover:bg-amber-500/10 transition-colors"
              >
                See it in action: Harry Potter case analysis &rarr;
              </Link>
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
}
