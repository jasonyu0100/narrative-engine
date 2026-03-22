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
  { key: 'atlas', name: 'Atlas', desc: 'Knowledge-driven', color: '#06b6d4' },
  { key: 'emerging', name: 'Emerging', desc: 'Finding its voice', color: '#6b7280' },
] as const;

const SHAPES = [
  { name: 'Escalating', desc: 'Continuous climb', curve: [[0,0.1],[0.2,0.25],[0.4,0.45],[0.6,0.65],[0.8,0.82],[1,1]] as [number,number][] },
  { name: 'Subsiding', desc: 'Continuous fall', curve: [[0,1],[0.2,0.8],[0.4,0.6],[0.6,0.4],[0.8,0.22],[1,0.08]] as [number,number][] },
  { name: 'Rebounding', desc: 'Dip then recovery', curve: [[0,0.6],[0.2,0.35],[0.4,0.1],[0.6,0.3],[0.8,0.65],[1,0.9]] as [number,number][] },
  { name: 'Peaking', desc: 'Early peak, trails off', curve: [[0,0.4],[0.2,0.85],[0.35,1],[0.55,0.65],[0.75,0.35],[1,0.15]] as [number,number][] },
  { name: 'Cyclical', desc: 'Two crests, one trough', curve: [[0,0.3],[0.2,0.75],[0.35,0.9],[0.5,0.35],[0.65,0.2],[0.8,0.75],[1,1]] as [number,number][] },
  { name: 'Climactic', desc: 'Single central peak', curve: [[0,0.2],[0.25,0.5],[0.45,0.8],[0.5,1],[0.55,0.8],[0.75,0.5],[1,0.25]] as [number,number][] },
  { name: 'Slow Burn', desc: 'Low early, late surge', curve: [[0,0.15],[0.2,0.2],[0.4,0.18],[0.6,0.35],[0.75,0.65],[0.9,0.9],[1,1]] as [number,number][] },
  { name: 'Episodic', desc: 'Multiple equal peaks', curve: [[0,0.3],[0.1,0.7],[0.2,0.3],[0.35,0.75],[0.5,0.25],[0.65,0.8],[0.8,0.3],[0.9,0.7],[1,0.35]] as [number,number][] },
  { name: 'Uniform', desc: 'Little variation', curve: [[0,0.5],[0.25,0.52],[0.5,0.48],[0.75,0.51],[1,0.5]] as [number,number][] },
] as const;

/* ── Navigation items ────────────────────────────────────────────────────── */

const NAV = [
  { id: 'abstract', label: 'Abstract' },
  { id: 'problem', label: 'The Problem' },
  { id: 'approach', label: 'Approach' },
  { id: 'forces', label: 'Forces' },
  { id: 'derived', label: 'Derived Metrics' },
  { id: 'normalization', label: 'Normalization' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'grading', label: 'Grading' },
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
        </div>

        <div className="space-y-16">

          {/* ── Abstract ──────────────────────────────────────────────── */}
          <Section id="abstract" label="Abstract">
            <P>
              Stories resist measurement. Most computational approaches settle for sentiment arcs or topic frequency&mdash;useful for search, less useful for understanding why a chapter lands or falls flat. We propose a different basis: model a narrative as a <B>knowledge graph that mutates scene by scene</B>, then derive three orthogonal forces&mdash;Payoff, Change, and Knowledge&mdash;from those mutations using deterministic formulas. The forces are z-score normalized, genre-agnostic, and composable into higher-order metrics like Tension and Delivery.
            </P>
            <P>
              This paper describes the formulas, the pipeline that extracts them from raw text, and a grading system calibrated against published literature. The entire framework is open source. Every constant is tunable. We wrote it to be forked.
            </P>
          </Section>

          {/* ── The Problem ───────────────────────────────────────────── */}
          <Section id="problem" label="The Problem">
            <P>
              Sentiment analysis can tell you a chapter is &ldquo;positive.&rdquo; It cannot tell you that a betrayal scene reads warm because the narrator is unreliable, and that its structural role is the opposite of its surface tone. Topic modeling can tell you a chapter mentions &ldquo;war.&rdquo; It cannot tell you whether the war thread just escalated from dormant to critical, or resolved three scenes ago and this is an echo.
            </P>
            <P>
              What readers actually experience&mdash;tension accumulating, threads paying off, the world clicking into focus&mdash;comes from <B>structural mutations</B>: which threads changed status, how many characters were affected, what new knowledge entered the world. We needed formulas that operate on those mutations directly, not on the words that describe them.
            </P>
          </Section>

          {/* ── Approach ──────────────────────────────────────────────── */}
          <Section id="approach" label="Approach">
            <P>
              We model every scene as producing mutations across three layers:
            </P>
            <ul className="mt-3 space-y-2 text-[13px] text-white/50 leading-[1.85]">
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">1.</span>
                <span><B>Threads</B>&mdash;narrative tensions (a rivalry, a secret, a quest) that move through lifecycle phases: dormant, active, escalating, critical, resolved/subverted/abandoned.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">2.</span>
                <span><B>Characters</B>&mdash;continuity mutations (what someone learns or becomes) and relationship valence shifts between characters.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">3.</span>
                <span><B>World knowledge</B>&mdash;a graph of laws, systems, concepts, and tensions. Nodes are ideas; edges link them.</span>
              </li>
            </ul>
            <P>
              An LLM reads each scene and records these mutations as structured data. Then static formulas&mdash;no LLM in the loop&mdash;compute forces from the mutations. This separation matters: the LLM handles comprehension, but the math is deterministic and auditable. You can read the formulas, disagree with a weight, and change it.
            </P>
          </Section>

          {/* ── The Three Forces ──────────────────────────────────────── */}
          <Section id="forces" label="The Three Forces">

            <div className="mb-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">Payoff</h3>
              <P>
                Did something permanent happen? Payoff measures thread phase transitions and relationship valence shifts&mdash;moments the story can&apos;t take back.
              </P>
              <Eq tex="P = \sum_{t} \left| \varphi_{\text{to}} - \varphi_{\text{from}} \right| + \sum_{r} \left| \Delta v_r \right|" />
              <P>
                Threads carry a phase index: dormant (0), active (1), escalating (2), critical (3), resolved/subverted/abandoned (4). A thread jumping from active to critical contributes <Tex>{'|3 - 1| = 2'}</Tex>. Relationship valence deltas capture shifts like ally-to-enemy. Threads mentioned without transitioning earn a pulse of 0.25&mdash;enough to stay visible without inflating the score.
              </P>
            </div>

            <div className="mb-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">Change</h3>
              <P>
                How many lives did this scene touch? A scene that ripples through five characters scores higher than one character reflecting alone&mdash;the formula rewards breadth of consequence.
              </P>
              <Eq tex="C = \sum_{c} \log_2(1 + m_c) + \log_2(1 + |\text{events}|)" />
              <P>
                <Tex>{'m_c'}</Tex> is the sum of continuity and relationship mutations (weighted by <Tex>{'|\\Delta v|'}</Tex>) for character <Tex>{'c'}</Tex>. The logarithm gives diminishing returns per character&mdash;the fifth mutation on the same character matters less than the first on a new one.
              </P>
            </div>

            <div>
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">Knowledge</h3>
              <P>
                Is the world getting richer? Knowledge tracks expansion of the world-building graph. Revealing a new law of magic contributes more than linking two rules the reader already knows.
              </P>
              <Eq tex="K = \Delta N + 0.5 \cdot \Delta E" />
              <P>
                <Tex>{'\\Delta N'}</Tex> counts new nodes (laws, systems, concepts, tensions). <Tex>{'\\Delta E'}</Tex> counts new edges. Nodes carry full weight; edges carry half. This applies to every genre&mdash;fantasy magic systems, literary class structures, crime world hierarchies.
              </P>
            </div>
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
                The dopamine hit. Payoff is linear&mdash;high payoff IS the climax signal and should not be dampened. Change and Knowledge pass through <Tex>{'\\tanh(x/2)'}</Tex>, which smoothly saturates toward &plusmn;1, preventing ensemble scenes from inflating delivery through sheer breadth. The contrast term, <Tex>{'\\text{contrast}_i = \\max(0,\\; T_{i-1} - T_i)'}</Tex>, rewards tension-release patterns: the same payoff lands harder after buildup than it does in isolation.
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

          {/* ── Normalization ─────────────────────────────────────────── */}
          <Section id="normalization" label="Z-Score Normalization">
            <P>
              Raw force values aren&apos;t comparable across stories. A 500-chapter web serial will have different absolute values than a 10-chapter novella. We normalize within each story:
            </P>
            <Eq tex="z_i = \frac{x_i - \mu}{\sigma}" />
            <P>
              Zero is average. Positive is above; negative is below. Units are standard deviations. A &ldquo;high payoff scene&rdquo; in any story is simply one above its own mean&mdash;regardless of length, genre, or density.
            </P>
          </Section>

          {/* ── Analysis Pipeline ─────────────────────────────────────── */}
          <Section id="pipeline" label="Analysis Pipeline">
            <P>
              The engine processes texts up to 500K words through a four-stage pipeline:
            </P>

            <div className="mt-6 space-y-5">
              <div>
                <h3 className="text-[13px] font-semibold text-white/70 mb-1">Chunking</h3>
                <P>Text splits into ~4,000-word chunks respecting chapter boundaries. Each chunk subdivides into ~12 sections for the LLM.</P>
              </div>
              <div>
                <h3 className="text-[13px] font-semibold text-white/70 mb-1">Parallel extraction</h3>
                <P>Up to 20 chunks run concurrently. Each call extracts characters, threads, relationships, scenes, and knowledge nodes as structured mutations. The LLM comprehends; it does not compute forces.</P>
              </div>
              <div>
                <h3 className="text-[13px] font-semibold text-white/70 mb-1">Reconciliation</h3>
                <P>Entities merge across chunk boundaries&mdash;characters by identity, threads by description, knowledge nodes by concept. A concept in chapter 3 and chapter 17 reuses the same node ID, signaling reinforcement over novelty.</P>
              </div>
              <div>
                <h3 className="text-[13px] font-semibold text-white/70 mb-1">Force computation</h3>
                <P>Deterministic formulas compute P, C, and K for every scene. Z-scores, derived metrics, and the full force landscape follow.</P>
              </div>
            </div>
          </Section>

          {/* ── Grading ───────────────────────────────────────────────── */}
          <Section id="grading" label="Grading">
            <P>
              Stories receive a score out of 100&mdash;25 per force&mdash;on an exponential curve calibrated against reference works including <em>Harry Potter</em>, <em>The Great Gatsby</em>, <em>Crime and Punishment</em>, and <em>Coiling Dragon</em>.
            </P>
            <Eq tex="g(\tilde{x}) = 25\left(1 - e^{-2\tilde{x}}\right) \qquad \text{where} \quad \tilde{x} = \frac{\bar{x}}{\mu_{\text{ref}}}" />
            <P>
              At <Tex>{'\\tilde{x} = 1'}</Tex> (matching the reference mean), the grade is ~22/25. The curve is steep early&mdash;rewarding baseline competence&mdash;and flattens at high levels. Reference works land between 88 and 93.
            </P>

            <P>
              The reference means (<Tex>{'\\mu_{\\text{ref}}'}</Tex>) are calibrated from famous works including <em>Harry Potter</em>, <em>The Great Gatsby</em>, <em>Crime and Punishment</em>, and <em>Coiling Dragon</em>:
            </P>
            <div className="mt-3 mb-4 grid grid-cols-3 gap-2 text-[11px] max-w-sm">
              {[
                { force: 'Payoff', value: '1.5', color: '#EF4444' },
                { force: 'Change', value: '7.0', color: '#22C55E' },
                { force: 'Knowledge', value: '2.5', color: '#3B82F6' },
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
              A consistent gap emerges between human and AI-generated texts. Published literature routinely scores 90+&mdash;dense thread lifecycles, earned payoffs, and layered world-building compound over hundreds of pages. AI-generated narratives typically land in the 70&ndash;80 range. The mutations are structurally valid but thinner: threads resolve too neatly, character change lacks accumulation, and knowledge graphs expand without the connective depth that human authors build instinctively. This gap is not a flaw in the grading&mdash;it reflects a real structural difference that the force formulas are designed to detect.
            </P>
          </Section>

          {/* ── Classification ────────────────────────────────────────── */}
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
              The Gaussian-smoothed delivery curve is classified into one of nine shapes using peak detection, slope analysis, and variance thresholds. Inspired by Vonnegut&apos;s story shapes and Reagan et al.&apos;s arc research.
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
              We made this choice deliberately. Narrative analysis should be transparent&mdash;if you disagree with how we weight payoff against knowledge, change the constant. If your genre needs a fourth force, add it. The formulas are tools, not doctrine.
            </P>
            <P>
              We&apos;d especially love to see the community experiment with their own texts. Paste any corpus into the <Link href="/analysis" className="text-white/60 underline underline-offset-2 hover:text-white/80 transition-colors">analysis pipeline</Link>&mdash;novels, screenplays, web serials, fanfiction. See where the peaks land, what archetype emerges, and whether the force landscape matches your intuition. When it doesn&apos;t, that&apos;s interesting too. Pull requests welcome.
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
