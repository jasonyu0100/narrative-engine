'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { ArchetypeIcon, ARCHETYPE_COLORS } from '@/components/ArchetypeIcon';

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
  { key: 'masterwork' as const, name: 'Masterwork', desc: 'All three balanced', color: ARCHETYPE_COLORS.masterwork },
  { key: 'epic' as const, name: 'Epic', desc: 'Payoff + Change', color: ARCHETYPE_COLORS.epic },
  { key: 'chronicle' as const, name: 'Chronicle', desc: 'Payoff + Knowledge', color: ARCHETYPE_COLORS.chronicle },
  { key: 'saga' as const, name: 'Saga', desc: 'Change + Knowledge', color: ARCHETYPE_COLORS.saga },
  { key: 'classic' as const, name: 'Classic', desc: 'Payoff-driven', color: ARCHETYPE_COLORS.classic },
  { key: 'anthology' as const, name: 'Anthology', desc: 'Change-driven', color: ARCHETYPE_COLORS.anthology },
  { key: 'tome' as const, name: 'Tome', desc: 'Knowledge-driven', color: ARCHETYPE_COLORS.tome },
  { key: 'emerging' as const, name: 'Emerging', desc: 'Finding its voice', color: ARCHETYPE_COLORS.emerging },
];

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
  { id: 'grading', label: 'Grading' },
  { id: 'markov', label: 'Markov Chains' },
  { id: 'mcts', label: 'MCTS' },
  { id: 'planning', label: 'Planning' },
  { id: 'revision', label: 'Revision' },
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
              A chapter lands. A reveal reframes everything before it. A quiet scene holds more weight than the battle it follows. Readers recognise these moments instantly — yet no existing metric captures why they work, and no generation system can reliably produce them.
            </P>
            <P>
              This paper introduces a framework that makes narrative structure both <B>computable and improvable</B>. We model a narrative as a knowledge graph that mutates scene by scene. From those mutations, we derive three forces — Payoff, Change, and Knowledge — plus a composite Delivery metric, using deterministic, z-score normalised, genre-agnostic formulas. Applied to <em>Harry Potter and the Sorcerer&apos;s Stone</em>, the delivery curve peaks at the Sorting Hat, the troll fight, and the Quirrell confrontation — without any human labeling. The math found them on its own.
            </P>
            <P>
              But measurement alone doesn&apos;t create stories. We use these forces to <B>generate</B> — Markov chain pacing shapes scene-by-scene rhythm, MCTS explores branching narrative paths, and adaptive planning steers long-form arcs across hundreds of scenes. Then we <B>revise</B> — an evaluation pipeline reads scene summaries, assigns per-scene verdicts, and reconstructs improved branches while preserving the story&apos;s version history. Each pass tightens structure, eliminates repetition, and enforces continuity until the branch converges.
            </P>
            <P>
              What follows is the full framework: force formulas, extraction pipeline, grading system, generation architecture, and revision methodology. Everything is open source, every constant is tunable, and the whole thing was written to be forked.
            </P>
          </Section>

          {/* ── The Problem ───────────────────────────────────────────── */}
          <Section id="problem" label="The Problem">
            <P>
              Narrative AI faces two intertwined problems. The first is <B>measurement</B>: no existing metric captures story structure. Sentiment analysis tracks tone. Topic modelling tracks frequency. Neither can tell you whether a thread escalated or merely echoed, whether a relationship shifted or repeated, whether a world deepened or just expanded.
            </P>
            <P>
              The second is <B>generation quality</B>. LLMs produce fluent prose but structurally thin stories. They repeat beats without escalating. They introduce characters who never change. They build worlds that expand without deepening. A scene-by-scene reading may feel competent, but the arc — the accumulated shape of tension, payoff, and consequence — falls flat.
            </P>
            <P>
              Both problems share a root cause: the structural patterns that make stories feel inevitable — threads tightening across chapters, reveals reframing prior events, quiet moments that hold more weight than the battles they follow — arise from <B>structural mutations</B> in a knowledge graph. Which threads changed status. How relationships shifted. What new knowledge entered the world. When we score published literature and AI-generated text with the same mutation-based formulas, a consistent gap emerges. Published works cluster between 81 and 93. Unguided AI-generated text — without course correction or structural metrics — lands between 68 and 81. The gap isn&apos;t in grammar or coherence. It&apos;s in thread lifecycle depth, relationship valence intensity, and world-knowledge density. With planning, course correction, and iterative revision, AI-generated narratives reach the <B>high 80s</B> — closing the gap significantly and producing structurally dense stories that hold up against published benchmarks.
            </P>

            {/* ── Human vs AI gradient bar ──────────────────────────── */}
            {(() => {
              const W = 580, H = 80;
              const BAR_Y = 16, BAR_H = 28;
              const PAD_L = 30, PAD_R = 20;
              const barW = W - PAD_L - PAD_R;

              const scoreMin = 60, scoreMax = 100;
              const toX = (s: number) => PAD_L + ((s - scoreMin) / (scoreMax - scoreMin)) * barW;

              const works = [
                { score: 68, human: false },
                { score: 71, human: false },
                { score: 73, human: false },
                { score: 75, human: false },
                { score: 79, human: false },
                { score: 81, human: false },
                { score: 81, human: true },
                { score: 85, human: true },
                { score: 86, human: true },
                { score: 90, human: true },
                { score: 93, human: true },
                { score: 93, human: true },
              ];

              const ticks = [60, 70, 80, 90, 100];

              return (
                <div className="mt-6 rounded-xl border border-white/6 bg-white/[0.02] px-5 py-4">
                  <svg width={W} height={H} className="mx-auto block" viewBox={`0 0 ${W} ${H}`}>
                    <defs>
                      <linearGradient id="score-grad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#ef4444" stopOpacity="0.5" />
                        <stop offset="25%" stopColor="#f59e0b" stopOpacity="0.5" />
                        <stop offset="50%" stopColor="#eab308" stopOpacity="0.4" />
                        <stop offset="75%" stopColor="#84cc16" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#22c55e" stopOpacity="0.5" />
                      </linearGradient>
                    </defs>

                    {/* Gradient bar */}
                    <rect x={PAD_L} y={BAR_Y} width={barW} height={BAR_H} rx={4} fill="url(#score-grad)" />

                    {/* Tick marks */}
                    {ticks.map(t => (
                      <g key={t}>
                        <line x1={toX(t)} y1={BAR_Y + BAR_H} x2={toX(t)} y2={BAR_Y + BAR_H + 4} stroke="rgba(255,255,255,0.15)" />
                        <text x={toX(t)} y={BAR_Y + BAR_H + 15} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="9">{t}</text>
                      </g>
                    ))}

                    {/* Points — on the bar */}
                    {works.map((d, i) => (
                      <circle key={i} cx={toX(d.score)} cy={BAR_Y + BAR_H / 2} r={d.human ? 4.5 : 3.5}
                        fill={d.human ? 'white' : 'rgba(251,191,36,0.8)'}
                        opacity={d.human ? 0.9 : 0.7}
                        stroke={d.human ? 'rgba(255,255,255,0.3)' : 'none'}
                        strokeWidth={1}
                      />
                    ))}

                    {/* Legend */}
                    <circle cx={PAD_L} cy={H - 6} r={3} fill="white" opacity={0.7} />
                    <text x={PAD_L + 7} y={H - 3} fill="rgba(255,255,255,0.35)" fontSize="8">Published literature (n=6)</text>
                    <circle cx={PAD_L + 130} cy={H - 6} r={2.5} fill="rgba(251,191,36,0.8)" />
                    <text x={PAD_L + 137} y={H - 3} fill="rgba(255,255,255,0.35)" fontSize="8">AI-generated (n=6)</text>
                  </svg>
                </div>
              );
            })()}
          </Section>

          {/* ── Approach ──────────────────────────────────────────────── */}
          <Section id="approach" label="Approach">
            <P>
              A scene doesn&apos;t merely contain words — it <em>does</em> things. It escalates a rivalry, reveals a secret, shifts an alliance, introduces a law of physics. We model every scene as producing mutations across three structural layers:
            </P>
            <ul className="mt-3 space-y-2 text-[13px] text-white/50 leading-[1.85]">
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">1.</span>
                <span><B>Threads</B> — narrative tensions (a rivalry, a secret, a quest) that move through lifecycle phases: dormant &rarr; active &rarr; escalating &rarr; critical &rarr; resolved/subverted/abandoned. Each thread is a unit of dramatic promise.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">2.</span>
                <span><B>Characters</B> — continuity mutations (what someone learns, loses, or becomes) and relationship valence shifts. The social fabric of the story, tracked edge by edge.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">3.</span>
                <span><B>World knowledge</B> — a graph of laws, systems, concepts, and tensions. Nodes are ideas; edges are the connections between them. When a reader says a world &ldquo;feels deep,&rdquo; this graph is what they&apos;re sensing.</span>
              </li>
            </ul>
            <P>
              An LLM reads each scene and records these mutations as structured data. Deterministic formulas then compute forces from the mutations — no LLM in the loop. This separation is deliberate: the model handles comprehension, the math handles measurement. Every formula in this paper is auditable. If you disagree with a weight, change it. The science is in the math, not the model.
            </P>
          </Section>

          {/* ── The Three Forces ──────────────────────────────────────── */}
          <Section id="forces" label="The Three Forces">

            <div className="mb-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">Payoff</h3>
              <P>
                Did something permanent happen? Payoff measures thread phase transitions — the moments a story can&apos;t take back.
              </P>
              <Eq tex="P = \sum_{t} \max\left(0,\ \varphi_{\text{to}} - \varphi_{\text{from}}\right)"/>
              <P>
                Each thread carries a phase index: dormant (0), active (1), escalating (2), critical (3), resolved/subverted/abandoned (4). A thread jumping from active to critical contributes <Tex>{'|3 - 1| = 2'}</Tex>. Threads mentioned without transitioning earn a pulse of 0.25 — enough to stay visible without inflating the score.
              </P>
            </div>

            <div className="mb-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">Change</h3>
              <P>
                How intensely did this scene transform its characters? The formula is cast-blind — a tight two-character confrontation scores the same as a ten-character ensemble with equal total mutations.
              </P>
              <Eq tex={String.raw`C = \sqrt{M} \;+\; \sqrt{E} \;+\; \sqrt{R}`} />
              <P>
                <Tex>{String.raw`M`}</Tex> counts continuity mutations (what characters learn, lose, or become), <Tex>{String.raw`E`}</Tex> counts events, and <Tex>{String.raw`R = \sum |\Delta v|`}</Tex> sums the absolute valence shifts across all relationship mutations. A dramatic betrayal (<Tex>{String.raw`|\Delta v| = 0.5`}</Tex>) weighs more than a polite exchange (<Tex>{String.raw`|\Delta v| = 0.1`}</Tex>). Square roots give diminishing returns on all three terms — preventing any single axis from dominating while preserving meaningful spikes.
              </P>
            </div>

            <div>
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">Knowledge</h3>
              <P>
                Is the world getting richer? Knowledge tracks how the world-building graph expands. A new law of magic matters more than another link between rules the reader already knows.
              </P>
              <Eq tex={String.raw`K = \Delta N + \sqrt{\Delta E}`} />
              <P>
                <Tex>{'\\Delta N'}</Tex> counts new nodes (laws, systems, concepts, tensions) and <Tex>{'\\Delta E'}</Tex> counts new edges. Nodes contribute linearly because each new concept is genuinely new information. Edges use square root scaling because the first few connections between concepts matter more than the tenth — this prevents bulk edge additions from inflating Knowledge. The formula applies equally to fantasy magic systems, literary class structures, and crime world hierarchies.
              </P>
            </div>

            <div className="mt-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">Delivery</h3>
              <P>
                The first three forces measure what a scene <em>does</em>. Delivery measures what a scene <em>delivers to the reader</em> — the combined impact of all three forces, amplified by tension release.
              </P>
              <Eq tex={String.raw`D_i = w \sum_{f \,\in\, \{P,C,K\}} \tanh\!\left(\frac{f_i}{\alpha}\right) \;+\; \gamma \cdot \text{contrast}_i \qquad w{=}0.3,\;\; \alpha{=}1.5,\;\; \gamma{=}0.2`} />
              <P>
                All three forces contribute symmetrically — same weight, same saturation. <Tex>{'\\tanh(f/\\alpha)'}</Tex> compresses extreme values while preserving their sign and relative ordering. The contrast term <Tex>{'\\text{contrast}_i = \\max(0,\\; T_{i-1} - T_i)'}</Tex> where <Tex>{'T_i = C_i + K_i - P_i'}</Tex> rewards tension-release patterns: the bigger the drop from buildup to payoff, the stronger the delivery. Calibrated against <em>Harry Potter</em>, <em>Nineteen Eighty-Four</em>, <em>The Great Gatsby</em>, and <em>Reverend Insanity</em>.
              </P>
            </div>
          </Section>

          {/* ── Validation ──────────────────────────────────────────── */}
          <Section id="validation" label="Validation">
            <P>
              Do the formulas capture what readers actually feel? We tested against <em>Harry Potter and the Sorcerer&apos;s Stone</em> — a novel whose dramatic peaks are well-established in popular memory. The delivery curve below was computed entirely from structural mutations, with no human annotation.
            </P>

            {/* Annotated Delivery Curve — computed from /works/harry_potter JSON via the same formulas used in the app */}
            {(() => {
              // Smoothed delivery values computed from the actual works JSON:
              // raw forces → z-score normalise → delivery formula → Gaussian smooth (σ=1.5)
              const delivery = [0.46,0.329,0.197,0.145,0.194,0.273,0.294,0.226,0.131,0.095,0.127,0.155,0.121,0.037,-0.045,-0.092,-0.1,-0.07,0.001,0.108,0.207,0.232,0.165,0.069,0.027,0.078,0.202,0.349,0.472,0.559,0.608,0.592,0.519,0.436,0.344,0.23,0.135,0.082,0.041,-0.017,-0.071,-0.07,0.009,0.133,0.263,0.367,0.413,0.391,0.342,0.305,0.269,0.203,0.11,0.052,0.056,0.063,0.018,-0.03,-0.008,0.048,0.052,-0.018,-0.107,-0.129,-0.053,0.062,0.14,0.149,0.102,0.035,-0.004,0.006,0.005,-0.081,-0.211,-0.288,-0.278,-0.205,-0.118,-0.086,-0.126,-0.154,-0.097,0.019,0.132,0.204,0.251,0.308,0.356,0.339,0.265];
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
                { scene: 7, label: 'Letters arrive' },
                { scene: 12, label: 'Hagrid reveals truth' },
                { scene: 22, label: 'Diagon Alley' },
                { scene: 31, label: 'Sorting Hat' },
                { scene: 47, label: 'Troll fight' },
                { scene: 61, label: 'Flamel discovered' },
                { scene: 68, label: 'Norbert aftermath' },
                { scene: 89, label: 'Quirrell confrontation' },
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

                    {/* Peak annotations — peaks only, above the curve */}
                    {annotations.map(({ scene, label }) => {
                      const i = scene - 1;
                      const x = toX(i);
                      const y = toY(delivery[i]);
                      return (
                        <g key={scene}>
                          <line x1={x} y1={y} x2={x} y2={y - 16} stroke="white" strokeOpacity="0.2" strokeDasharray="2 2" />
                          <circle cx={x} cy={y} r={3} fill="#FCD34D" opacity="0.9" />
                          <text
                            x={x} y={y - 20}
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
              Every peak corresponds to a moment any reader would identify: Harry&apos;s letters arriving in impossible quantities, Hagrid revealing the truth, the wonder of Diagon Alley, the Sorting Hat ceremony, the troll fight that forges a friendship, discovering Nicolas Flamel, the Norbert aftermath, and the climactic confrontation with Quirrell.
            </P>
            <P>
              This is the core claim: <B>deterministic formulas applied to structural mutations recover the dramatic shape of a narrative without reading the prose</B>. The mutations are extracted by an LLM, so the inputs are approximate — but the formulas themselves are deterministic and auditable. The approximation is useful enough to act on. When applied to AI-generated narratives, the same formulas produce flatter delivery curves: mutations are structurally valid but uniformly dense, lacking the contrast that creates memorable moments.
            </P>
          </Section>

          {/* ── Grading ───────────────────────────────────────────────── */}
          <Section id="grading" label="Grading">
            <P>
              Each story receives a score out of 100, with 25 points allocated to each force. The grading curve is exponential, calibrated against reference works including <em>Harry Potter</em>, <em>The Great Gatsby</em>, <em>Crime and Punishment</em>, and <em>Coiling Dragon</em>.
            </P>
            <Eq tex="g(\tilde{x}) = 25\left(1 - e^{-2\tilde{x}}\right) \qquad \text{where} \quad \tilde{x} = \frac{\bar{x}}{\mu_{\text{ref}}}" />
            <P>
              At <Tex>{'\\tilde{x} = 1'}</Tex> (matching the reference mean), the grade is ~22 out of 25. The curve rises steeply at first — rewarding baseline competence — then flattens at higher levels, making each additional point harder to earn. Reference works land between 85 and 92.
            </P>

            <P>
              The reference means (<Tex>{'\\mu_{\\text{ref}}'}</Tex>) are derived from those same works:
            </P>
            <div className="mt-3 mb-4 grid grid-cols-3 gap-2 text-[11px] max-w-sm">
              {[
                { force: 'Payoff', value: '1.3', color: '#EF4444' },
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
              The overall score sums all four sub-grades: <Tex>{'\\text{Overall} = g(\\tilde{P}) + g(\\tilde{C}) + g(\\tilde{K}) + g(\\tilde{D})'}</Tex>.
            </P>
            <P>
              A consistent gap emerges between human and AI-generated texts. Published literature routinely scores above 90 — dense thread lifecycles, earned payoffs, and layered world-building compound over hundreds of pages. AI-generated narratives typically land in the 70&ndash;80 range: threads resolve too neatly, character change lacks accumulation, and knowledge graphs expand without the connective depth that human authors build instinctively. This isn&apos;t a flaw in the grading — it&apos;s the structural difference the force formulas are designed to detect.
            </P>
          </Section>

          {/* ── Classification ────────────────────────────────────────── */}
          {/* ── Markov Chains ─────────────────────────────────────────── */}
          <Section id="markov" label="Markov Chains">
            <P>
              The eight cube corners form a finite state space. Every scene occupies one corner, and the transition from scene to scene is a state transition. Across an entire novel, these transitions form an empirical Markov chain — a transition matrix <Tex>{'T \\in \\mathbb{R}^{8 \\times 8}'}</Tex> where <Tex>{'T_{ij}'}</Tex> gives the probability of moving from mode <Tex>{'i'}</Tex> to mode <Tex>{'j'}</Tex>.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">A Story&apos;s Fingerprint</h3>
            <P>
              Different stories produce radically different matrices. We computed transition matrices from several published works by classifying each scene into its cube corner and counting consecutive transitions:
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
              Harry Potter&apos;s matrix reveals a balanced explorer: high entropy (2.88/3.00), low self-loops (12%), and a 43/57 payoff-to-buildup ratio. Lore and Rest dominate (19 visits each), serving as connective tissue between peaks. The story visits all eight modes regularly, with strong Lore&harr;Rest oscillation providing breathing room between dramatic moments.
            </P>
            <P>
              Other works produce strikingly different fingerprints. <em>Nineteen Eighty-Four</em> is a pressure cooker — buildup-dominant (66%), dwelling in Rest and Growth before sudden Epoch eruptions. <em>The Great Gatsby</em> oscillates like a pendulum between Rest and Epoch. Each matrix captures the pacing rhythm that no single metric can express.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">Pacing Sequences as Direction</h3>
            <P>
              Before generating an arc, the engine samples a pacing sequence from the transition matrix: starting from the current mode, it walks the chain for N steps, producing a sequence like <span className="font-mono text-white/50">Growth &rarr; Lore &rarr; Climax &rarr; Rest &rarr; Growth</span>. Each step becomes a per-scene direction — Scene 1 must produce a Growth force profile, Scene 3 must spike all forces. This prevents the AI from defaulting to uniform density. Users select a <em>rhythm profile</em> derived from a published work to shape pacing — a story using Harry Potter&apos;s matrix will breathe like Harry Potter.
            </P>
          </Section>

          {/* ── MCTS ──────────────────────────────────────────────────── */}
          <Section id="mcts" label="MCTS">
            <P>
              Monte Carlo Tree Search adapts the game-playing algorithm to narrative space. Nodes are narrative states — the full knowledge graph after a sequence of scenes. Edges are generated arcs. The evaluation function is the force grading system described above.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">How It Works</h3>
            <P>
              <strong>Selection</strong>: Starting from the current narrative state, UCB1 selects which node to expand, balancing exploitation (high-scoring paths) against exploration (under-visited branches).
            </P>
            <Eq tex={String.raw`\text{UCB1}(n) = \frac{Q(n)}{N(n)} + C \sqrt{\frac{\ln N(\text{parent})}{N(n)}}`} />
            <P>
              <strong>Expansion</strong>: The selected node generates a new arc via the LLM. A <B>Markov chain pacing sequence</B> is sampled fresh for each expansion and injected as a direction — telling the LLM which cube modes (Rest, Growth, Climax, etc.) to target scene by scene. This ensures every branch explores a different force trajectory — the narrative seed provides creative diversity, the Markov-generated direction provides structural diversity.
            </P>
            <P>
              <strong>Evaluation</strong>: The generated arc is scored using the same force grading system applied to published literature. An arc scoring 85 has comparable structural density to the reference works.
            </P>
            <P>
              <strong>Backpropagation</strong>: The score propagates up the tree. Paths that consistently produce high-scoring arcs accumulate visit counts and become more likely to be selected for further expansion.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">Markov-Augmented Search</h3>
            <P>
              Combining Markov chains with MCTS produces a search that is both structurally informed and creatively diverse. Each expansion samples a fresh pacing sequence from the rhythm profile&apos;s transition matrix and passes it to the LLM as a per-scene direction. Sibling nodes receive different sequences — one might get <span className="font-mono text-white/50">Rest &rarr; Growth &rarr; Epoch</span> while another gets <span className="font-mono text-white/50">Lore &rarr; Lore &rarr; Climax &rarr; Closure</span> — so they explore structurally different trajectories even from the same narrative state.
            </P>
            <P>
              The rhythm profile acts as a structural prior, biasing the search toward transitions observed in published works without constraining the creative content. The LLM decides <em>what</em> happens; the Markov chain shapes <em>how much</em>.
            </P>
            <P>
              After search completes, the best path is selected by highest average score or most-visited path. The user can inspect every branch, see the cube position sequence for each arc, and commit the chosen path to the story.
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

          {/* ── Planning ──────────────────────────────────────────────── */}
          <Section id="planning" label="Planning">
            <P>
              MCTS finds the best next arc. But a novel is dozens of arcs over hundreds of scenes. Steering at that scale requires <B>planning with course correction</B> — a system that sets direction, then rewrites that direction as the story evolves.
            </P>
            <P>
              A story is divided into <B>phases</B> — structural chapters with objectives and scene allocations. When a phase activates, the system generates two vectors: a <B>direction vector</B> (which threads to push, what the reader should feel) and a <B>constraint vector</B> (what must <em>not</em> happen yet). Both are injected into scene generation. After every arc, a <B>course correction</B> pass analyses thread tension, character cost, rhythm, freshness, and momentum — then <em>rewrites the vectors in place</em>. The next arc generates under guidance that reflects what actually happened, not what was originally planned.
            </P>

            {/* ── Course correction diagram ────────────────────────── */}
            {(() => {
              const W = 520, H = 90;
              const CY = 44;
              const PAD = 40;
              // Each correction tries to get back to centre but over/undershoots.
              // Format: [endY offset from centre]. Positive = below, negative = above.
              // The sequence converges toward 0.
              const drifts = [-18, 14, -10, 8, -4, 3];
              const segW = (W - PAD * 2) / drifts.length;

              // Build points: each segment starts from previous end
              const nodes: { x: number; y: number }[] = [{ x: PAD, y: CY }];
              for (let i = 0; i < drifts.length; i++) {
                nodes.push({ x: PAD + (i + 1) * segW, y: CY + drifts[i] });
              }

              return (
                <div className="mt-5 mb-2 rounded-xl border border-white/6 bg-white/2 px-4 py-3 overflow-x-auto">
                  <svg width={W} height={H} className="mx-auto block" viewBox={`0 0 ${W} ${H}`}>
                    {/* Centre / ideal line — dotted */}
                    <line x1={PAD} y1={CY} x2={W - PAD} y2={CY} stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="4 4" />

                    {/* Direction vectors — each starts from previous endpoint */}
                    {nodes.slice(0, -1).map((from, i) => {
                      const to = nodes[i + 1];
                      const dx = to.x - from.x, dy = to.y - from.y;
                      const len = Math.sqrt(dx * dx + dy * dy);
                      const ux = dx / len, uy = dy / len;
                      // Shorten line slightly so arrowhead sits at tip
                      const tipX = to.x - ux * 2, tipY = to.y - uy * 2;

                      return (
                        <g key={i}>
                          {/* Vector line */}
                          <line x1={from.x} y1={from.y} x2={tipX} y2={tipY}
                            stroke="rgba(251,191,36,0.55)" strokeWidth="1.5" />
                          {/* Arrowhead */}
                          <polygon
                            points={`${to.x},${to.y} ${to.x - 5 * ux + 3 * uy},${to.y - 5 * uy - 3 * ux} ${to.x - 5 * ux - 3 * uy},${to.y - 5 * uy + 3 * ux}`}
                            fill="rgba(251,191,36,0.55)"
                          />
                          {/* Node at endpoint */}
                          <circle cx={to.x} cy={to.y} r={3} fill="rgba(251,191,36,0.7)" />
                        </g>
                      );
                    })}

                    {/* Start marker */}
                    <circle cx={PAD} cy={CY} r={3} fill="rgba(255,255,255,0.35)" />

                    {/* Labels */}
                    <text x={W / 2} y={14} textAnchor="middle" fill="rgba(251,191,36,0.3)" fontSize="8">direction vectors course-corrected after each arc</text>
                  </svg>
                </div>
              );
            })()}

            <P>
              At phase boundaries, a <B>world expansion</B> pipeline introduces new characters, locations, and threads — each woven into the existing knowledge graph and seeded with knowledge asymmetries that drive future conflict. Fresh direction and constraint vectors are then generated accounting for entities that didn&apos;t exist a moment ago. The <B>phase layer</B> provides long-range structure; the <B>direction layer</B> provides short-range steering that evolves continuously.
            </P>
          </Section>

          {/* ── Revision ──────────────────────────────────────────── */}
          <Section id="revision" label="Revision">
            <P>
              First drafts are rough. Scenes repeat beats, characters stagnate, threads drift. The revision pipeline improves a branch systematically without starting over, using the same git-like branching that underlies generation.
            </P>
            <P>
              <B>Evaluation</B> reads scene summaries and assigns per-scene verdicts. <B>Reconstruction</B> creates a new versioned branch, applying verdicts in parallel — edits tighten summaries within locked structure, rewrites rebuild from scratch, cuts are omitted. World commits pass through at their original positions. The original branch is never modified.
            </P>

            <div className="mt-4 space-y-1.5 text-[12px]">
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-emerald-400 font-mono w-14 shrink-0">ok</span>
                <span className="text-white/50">Structurally sound, continuity intact. Kept as-is.</span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-amber-400 font-mono w-14 shrink-0">edit</span>
                <span className="text-white/50">Right idea, tighten execution. POV, location, cast locked.</span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-red-400 font-mono w-14 shrink-0">rewrite</span>
                <span className="text-white/50">Scene should exist but structure is wrong. Everything rebuilt.</span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-white/30 font-mono w-14 shrink-0">cut</span>
                <span className="text-white/50">Redundant. Removed — the narrative is tighter without it.</span>
              </div>
            </div>

            <P>
              Evaluations can be <B>guided</B> with external feedback — from another AI, a human editor, or the author&apos;s own notes — layered on top of the system&apos;s structural analysis. Each reconstruction produces a versioned branch (<em>v2</em>, <em>v3</em>, <em>v4</em>), enabling direct comparison and rollback. The loop converges: each pass reduces non-ok scenes until the evaluator returns all-ok. A 50-scene branch typically stabilises in 2&ndash;3 passes.
            </P>
          </Section>

          {/* ── Classification ──────────────────────────────────────── */}
          <Section id="classification" label="Classification">

            <h3 className="text-[15px] font-semibold text-white/80 mb-3">Archetypes</h3>
            <P>
              Each story is classified by which forces dominate its profile. A force is considered &ldquo;dominant&rdquo; if it scores &ge; 21 and falls within 5 points of the maximum.
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
              Beyond archetypes, the Gaussian-smoothed delivery curve is classified into one of six shapes using overall slope, peak count, peak dominance, peak position, trough depth, and recovery strength.
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
              Narrative Engine is fully open source. Every formula in this paper lives in the codebase — you can read it, run it, and change it.
            </P>
            <P>
              This is deliberate. Narrative analysis should be transparent. If you disagree with how we weight payoff against knowledge, change the constant. If your genre needs a fourth force, add it. The formulas are tools, not doctrine.
            </P>
            <P>
              We&apos;d especially love to see the community experiment with their own texts. Paste any corpus into the <Link href="/analysis" className="text-white/60 underline underline-offset-2 hover:text-white/80 transition-colors">analysis pipeline</Link> — novels, screenplays, web serials, fanfiction — and see where the peaks land, what archetype emerges, and whether the force landscape matches your intuition. When it doesn&apos;t, that&apos;s the interesting part. Pull requests welcome.
            </P>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/case-analysis"
                className="text-[11px] px-4 py-2 rounded-full border border-amber-500/30 bg-amber-500/5 text-amber-400/80 hover:text-amber-300 hover:border-amber-500/50 hover:bg-amber-500/10 transition-colors"
              >
                See it in action: Harry Potter case analysis &rarr;
              </Link>
              <a
                href="https://github.com/jasonyu0100/narrative-engine"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] px-4 py-2 rounded-full border border-white/15 bg-white/3 text-white/50 hover:text-white/70 hover:border-white/25 hover:bg-white/5 transition-colors"
              >
                View the repo on GitHub &rarr;
              </a>
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
}
