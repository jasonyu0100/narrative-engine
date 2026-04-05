"use client";

import { ARCHETYPE_COLORS, ArchetypeIcon } from "@/components/ArchetypeIcon";
import katex from "katex";
import "katex/dist/katex.min.css";
import Link from "next/link";
import { useEffect, useState } from "react";

/* ── LaTeX helpers ───────────────────────────────────────────────────────── */

function Tex({ children, display }: { children: string; display?: boolean }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    setHtml(
      katex.renderToString(children, {
        displayMode: display ?? false,
        throwOnError: false,
      }),
    );
  }, [children, display]);
  if (!html) return null;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function Eq({ tex, label }: { tex: string; label?: string }) {
  return (
    <div className="my-5 px-3 sm:px-5 py-4 rounded-lg bg-white/[0.03] border border-white/6 overflow-x-auto">
      {label && (
        <span className="text-[10px] uppercase tracking-wider text-white/20 block mb-2 font-mono">
          {label}
        </span>
      )}
      <div className="text-center">
        <Tex display>{tex}</Tex>
      </div>
    </div>
  );
}

/* ── Section divider ─────────────────────────────────────────────────────── */

function Section({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-mono shrink-0">
          {label}
        </h2>
        <div className="flex-1 h-px bg-white/6" />
      </div>
      {children}
    </section>
  );
}

/* ── Prose helpers ───────────────────────────────────────────────────────── */

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] text-white/50 leading-[1.85] mt-3 first:mt-0">
      {children}
    </p>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="text-white/70">{children}</strong>;
}

/* ── Shape mini-curve ────────────────────────────────────────────────────── */

function ShapeCurve({
  curve,
  color,
}: {
  curve: [number, number][];
  color: string;
}) {
  const points = curve.map(([x, y]) => `${x * 32},${16 - y * 14}`).join(" ");
  return (
    <svg width="32" height="16" viewBox="0 0 32 16" className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Cost calculation reference ────────────────────────────────────────────────
// 2.5 Flash: $0.30/M input, $2.50/M output+reasoning — structure, planning, analysis
// 3 Flash:   $0.50/M input, $3.00/M output+reasoning — prose only
//
// GENERATION (per arc, ~5 scenes):
//   generateScenes      1× 2.5F  40K in + 4K out + 2K rsn  = $0.03
//   generateScenePlan   5× 2.5F  28K in + 0.5K out + 2K rsn = $0.07
//   generateSceneProse  5× 3F    35K in + 4K out + 2K rsn   = $0.18
//   refreshDirection    1× 2.5F  32K in + 0.3K out + 2K rsn = $0.02
//   expandWorld         1× 2.5F  25K in + 0.6K out + 1K rsn = $0.01
//   phaseCompletionRpt  1× 2.5F  25K in + 0.3K out + 1K rsn = $0.01
//   generatePhaseDir    1× 2.5F  28K in + 0.5K out + 1K rsn = $0.01
//                                                    Total  = $0.33/arc
//
// EVALUATION & REVISION (per arc, ~5 scenes, 25% edit rate):
//   evaluateBranch        1× 2.5F  12K in + 2K out + 2K rsn         = $0.01
//   editScene            ~1× 2.5F  30K in + 0.5K out + 1K rsn       = $0.01
//   evaluateProseQuality  1× 2.5F  10K in + 0.5K out + 1K rsn       = $0.01  (edit verdicts + critique)
//   rewriteSceneProse    ~1× 3F    35K in + 4K out + 2K rsn          = $0.03
//                                                    Total  ≈ $0.06/arc
// (rewriteSceneProse in StoryReader is spot-fix only — not in this estimate)
//
// ANALYSIS (per corpus, no reasoning):
//   analyzeChunkParallel  N× 2.5F  8K in + 2K out × N chunks = ~$0.01/chunk
//   revEngScenePlan       N× 2.5F  3K in + 0.5K out × N scenes = ~$0.002/scene (optional)
//   reconcileResults      1× 2.5F  5K in + 1K out = ~$0.004 (once)
//   assembleNarrative     1× 2.5F  35K in + 2K out = ~$0.016 (once)
//   100K novel (25 chunks, no plans):  25×$0.010 + $0.004 + $0.016 = ~$0.24
//   500K series (125 chunks, no plans): 125×$0.010 + $0.004 + $0.016 = ~$1.12

type BreakdownRow = { call: string; count: string; model: '2.5 Flash' | '3 Flash'; note: string; cost: string };
type BreakdownCategory = { label: string; unit: string; rows: BreakdownRow[]; subtotal: { calls: string; cost: string } | null };

const BREAKDOWN_CATEGORIES: BreakdownCategory[] = [
  {
    label: 'Generation',
    unit: 'per arc  ·  ~5 scenes',
    rows: [
      { call: 'generateScenes',          count: '×1',  model: '2.5 Flash', note: 'Scene structures & mutations',           cost: '$0.03' },
      { call: 'generateScenePlan',        count: '×5',  model: '2.5 Flash', note: 'Beat plan per scene',                    cost: '$0.07' },
      { call: 'generateSceneProse',       count: '×5',  model: '3 Flash',   note: '~1K words of prose per scene',           cost: '$0.18' },
      { call: 'refreshDirection',         count: '×1',  model: '2.5 Flash', note: 'Arc direction & constraints',             cost: '$0.02' },
      { call: 'expandWorld',              count: '×1',  model: '2.5 Flash', note: 'New characters, locations & threads',    cost: '$0.01' },
      { call: 'phaseCompletionReport',    count: '×1',  model: '2.5 Flash', note: 'Phase retrospective',                    cost: '$0.01' },
      { call: 'generatePhaseDirection',   count: '×1',  model: '2.5 Flash', note: 'Next phase objectives & constraints',    cost: '$0.01' },
    ],
    subtotal: { calls: '15 calls', cost: '$0.33' },
  },
  {
    label: 'Evaluation & Revision',
    unit: 'per arc  ·  ~5 scenes  ·  25% edit rate',
    rows: [
      { call: 'evaluateBranch',       count: '×1',  model: '2.5 Flash', note: 'Structure verdicts + thematic critique',  cost: '$0.01' },
      { call: 'editScene',            count: '×~1', model: '2.5 Flash', note: 'Scene structure edit (summary + mutations)', cost: '$0.01' },
      { call: 'evaluateProseQuality', count: '×1',  model: '2.5 Flash', note: 'Prose quality edit verdicts + critique',  cost: '$0.01' },
      { call: 'rewriteSceneProse',    count: '×~1', model: '3 Flash',   note: '~1K words rewritten (25% rate)',          cost: '$0.03' },
    ],
    subtotal: { calls: '~4 calls', cost: '~$0.06' },
  },
  {
    label: 'Analysis',
    unit: 'per arc  ·  ~5K words  ·  no reasoning',
    rows: [
      { call: 'analyzeChunkParallel',       count: '×~1', model: '2.5 Flash', note: 'Text extraction',                            cost: '~$0.01' },
      { call: 'reverseEngineerScenePlan',   count: '×~5', model: '2.5 Flash', note: 'Beat plan per scene (optional)',              cost: '~$0.01' },
      { call: 'reconcileResults',           count: '×1',  model: '2.5 Flash', note: 'Entity deduplication — once per corpus',     cost: '~$0.01' },
      { call: 'assembleNarrative',          count: '×1',  model: '2.5 Flash', note: 'Rules, world systems, profile — once',       cost: '~$0.02' },
    ],
    subtotal: { calls: '~8 calls', cost: '~$0.05' },
  },
];

function ModelPill({ model }: { model: '2.5 Flash' | '3 Flash' }) {
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono whitespace-nowrap ${
      model === '3 Flash'
        ? 'bg-amber-500/10 text-amber-400/60'
        : 'bg-emerald-500/10 text-emerald-400/60'
    }`}>{model}</span>
  );
}

function CostEstimates() {
  const [showBreakdown, setShowBreakdown] = useState(false);
  return (
    <div className="my-5 px-3 sm:px-5 py-4 rounded-lg bg-white/3 border border-white/6">
      <span className="text-[10px] uppercase tracking-wider text-white/20 block mb-3 font-mono">
        End-to-End Estimates  ·  ~5 scenes/arc  ·  ~1K words/scene
      </span>

      {/* Generation estimates */}
      <div className="space-y-2 text-[11px] text-white/45">
        {[
          { scale: "Short story (~10K words)",  cost: "~$0.66"  },
          { scale: "Novella (~35K words)",       cost: "~$2.30"  },
          { scale: "Novel (~85K words)",         cost: "~$5.60"  },
          { scale: "Epic (~200K words)",         cost: "~$13.20" },
          { scale: "Serial (~500K words)",       cost: "~$33.00" },
        ].map(({ scale, cost }, i) => (
          <div key={scale} className={`flex justify-between${i > 0 ? ' border-t border-white/5 pt-2' : ''}`}>
            <span>{scale}</span>
            <span className="font-mono text-white/60">{cost}</span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-white/25 mt-3">
        Structure, planning &amp; analysis: <span className="text-emerald-500/40">Gemini 2.5 Flash</span> ($0.30/M in · $2.50/M out+reasoning).
        Prose only: <span className="text-amber-500/40">Gemini 3 Flash</span> ($0.50/M in · $3.00/M out+reasoning).
        Generation cost per arc is constant once the story exceeds the 50-scene context window.
      </p>

      <button
        onClick={() => setShowBreakdown(!showBreakdown)}
        className="mt-3 flex items-center gap-1.5 text-[10px] text-white/25 hover:text-white/40 transition-colors cursor-pointer"
      >
        <svg width="10" height="10" viewBox="0 0 12 12" className={`transition-transform duration-200 ${showBreakdown ? 'rotate-180' : ''}`}>
          <path d="M3 4.5L6 7.5L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Per-arc breakdown</span>
      </button>

      {showBreakdown && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-5">
          {BREAKDOWN_CATEGORIES.map((cat) => (
            <div key={cat.label}>
              {/* Category header */}
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="text-[10px] font-mono text-white/50 uppercase tracking-wider">{cat.label}</span>
                <span className="text-[9px] text-white/20">{cat.unit}</span>
              </div>
              <table className="w-full text-[11px] table-fixed">
                <colgroup>
                  <col className="w-[28%]" />
                  <col className="w-[6%]" />
                  <col className="w-[14%]" />
                  <col className="w-[38%]" />
                  <col className="w-[14%]" />
                </colgroup>
                <tbody>
                  {cat.rows.map((row) => (
                    <tr key={row.call} className="border-t border-white/4">
                      <td className="py-1.5 font-mono text-white/50 pr-3 truncate">{row.call}</td>
                      <td className="py-1.5 font-mono text-white/25 text-right pr-3">{row.count}</td>
                      <td className="py-1.5 pr-3"><ModelPill model={row.model} /></td>
                      <td className="py-1.5 text-white/30 text-[10px] pr-3">{row.note}</td>
                      <td className="py-1.5 font-mono text-white/55 text-right">{row.cost}</td>
                    </tr>
                  ))}
                  {cat.subtotal && (
                    <tr className="border-t border-white/10">
                      <td className="pt-1.5 text-white/40 font-mono text-[10px]" colSpan={3}>{cat.subtotal.calls}</td>
                      <td />
                      <td className="pt-1.5 font-mono text-white/60 text-right font-semibold">{cat.subtotal.cost}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Data ────────────────────────────────────────────────────────────────── */

const ARCHETYPES = [
  {
    key: "opus" as const,
    name: "Opus",
    desc: "All three balanced",
    color: ARCHETYPE_COLORS.opus,
  },
  {
    key: "tempest" as const,
    name: "Tempest",
    desc: "Payoff + Change",
    color: ARCHETYPE_COLORS.tempest,
  },
  {
    key: "chronicle" as const,
    name: "Chronicle",
    desc: "Payoff + Knowledge",
    color: ARCHETYPE_COLORS.chronicle,
  },
  {
    key: "mosaic" as const,
    name: "Mosaic",
    desc: "Change + Knowledge",
    color: ARCHETYPE_COLORS.mosaic,
  },
  {
    key: "classic" as const,
    name: "Classic",
    desc: "Payoff-driven",
    color: ARCHETYPE_COLORS.classic,
  },
  {
    key: "saga" as const,
    name: "Saga",
    desc: "Change-driven",
    color: ARCHETYPE_COLORS.saga,
  },
  {
    key: "tome" as const,
    name: "Tome",
    desc: "Knowledge-driven",
    color: ARCHETYPE_COLORS.tome,
  },
  {
    key: "emerging" as const,
    name: "Emerging",
    desc: "Finding its voice",
    color: ARCHETYPE_COLORS.emerging,
  },
];

const SHAPES = [
  {
    name: "Climactic",
    desc: "Build, climax, release",
    curve: [
      [0, 0.2],
      [0.25, 0.5],
      [0.45, 0.8],
      [0.5, 1],
      [0.55, 0.8],
      [0.75, 0.5],
      [1, 0.25],
    ] as [number, number][],
  },
  {
    name: "Episodic",
    desc: "Multiple equal peaks",
    curve: [
      [0, 0.3],
      [0.1, 0.7],
      [0.2, 0.3],
      [0.35, 0.75],
      [0.5, 0.25],
      [0.65, 0.8],
      [0.8, 0.3],
      [0.9, 0.7],
      [1, 0.35],
    ] as [number, number][],
  },
  {
    name: "Rebounding",
    desc: "Dip then recovery",
    curve: [
      [0, 0.6],
      [0.2, 0.35],
      [0.4, 0.1],
      [0.6, 0.3],
      [0.8, 0.65],
      [1, 0.9],
    ] as [number, number][],
  },
  {
    name: "Peaking",
    desc: "Early peak, trails off",
    curve: [
      [0, 0.4],
      [0.2, 0.85],
      [0.35, 1],
      [0.55, 0.65],
      [0.75, 0.35],
      [1, 0.15],
    ] as [number, number][],
  },
  {
    name: "Escalating",
    desc: "Rising toward the end",
    curve: [
      [0, 0.1],
      [0.2, 0.2],
      [0.4, 0.35],
      [0.6, 0.55],
      [0.8, 0.8],
      [1, 1],
    ] as [number, number][],
  },
  {
    name: "Flat",
    desc: "Little variation",
    curve: [
      [0, 0.5],
      [0.25, 0.52],
      [0.5, 0.48],
      [0.75, 0.51],
      [1, 0.5],
    ] as [number, number][],
  },
] as const;

const SCALE_TIERS = [
  { key: 'short',  name: 'Short',  desc: '< 20 scenes', color: '#22D3EE' },
  { key: 'story',  name: 'Story',  desc: '20–50 scenes', color: '#22D3EE' },
  { key: 'novel',  name: 'Novel',  desc: '50–120 scenes', color: '#22D3EE' },
  { key: 'epic',   name: 'Epic',   desc: '120–300 scenes', color: '#22D3EE' },
  { key: 'serial', name: 'Serial', desc: '300+ scenes', color: '#22D3EE' },
] as const;

const DENSITY_TIERS = [
  { key: 'sparse',    name: 'Sparse',    desc: '< 0.5 entities/scene', color: '#34D399' },
  { key: 'focused',   name: 'Focused',   desc: '0.5–1.5 entities/scene', color: '#34D399' },
  { key: 'developed', name: 'Developed', desc: '1.5–2.5 entities/scene', color: '#34D399' },
  { key: 'rich',      name: 'Rich',      desc: '2.5–4.0 entities/scene', color: '#34D399' },
  { key: 'sprawling', name: 'Sprawling', desc: '4.0+ entities/scene', color: '#34D399' },
] as const;

/* ── Navigation items ────────────────────────────────────────────────────── */

const NAV = [
  { id: "abstract", label: "Abstract" },
  { id: "problem", label: "The Problem" },
  { id: "approach", label: "Approach" },
  { id: "hierarchy", label: "Hierarchy" },
  { id: "forces", label: "Forces" },
  { id: "validation", label: "Validation" },
  { id: "grading", label: "Grading" },
  { id: "markov", label: "Markov Chains" },
  { id: "mcts", label: "MCTS" },
  { id: "planning", label: "Planning" },
  { id: "revision", label: "Revision" },
  { id: "classification", label: "Classification" },
  { id: "economics", label: "Economics" },
  { id: "open-source", label: "Open Source" },
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
              <div
                className={`w-1.5 h-1.5 rounded-full transition-all duration-200 ${
                  active
                    ? "bg-white/70 scale-125"
                    : "bg-white/15 group-hover:bg-white/30"
                }`}
              />
              {i < NAV.length - 1 && (
                <div className="w-px h-6 bg-white/8 mt-0.5" />
              )}
            </div>
            {/* Label */}
            <span
              className={`text-[11px] font-mono transition-colors duration-200 whitespace-nowrap ${
                active
                  ? "text-white/60"
                  : "text-white/15 group-hover:text-white/35"
              }`}
            >
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
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [ids]);

  return activeId;
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function PaperPage() {
  const activeId = useActiveSection(NAV.map((n) => n.id));

  return (
    <div className="min-h-screen bg-bg-base">
      {/* Aurora background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="aurora-container absolute bottom-0 left-0 right-0 h-full">
          <div className="aurora-curtain aurora-curtain-1" />
          <div className="aurora-curtain aurora-curtain-2" />
          <div className="aurora-curtain aurora-curtain-3" />
          <div className="aurora-glow" />
        </div>
      </div>

      <TimelineNav activeId={activeId} />

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-8 pt-20 pb-32">
        {/* Title */}
        <div className="mb-16 animate-fade-up">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/25 mb-4">
            White Paper
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold leading-tight text-white/90 mb-4">
            Quantifying Narrative Force
          </h1>
          <p className="text-[15px] text-white/40 leading-relaxed max-w-xl">
            A computational framework for measuring narrative impact through
            structural graph mutations.
          </p>
          <p className="text-[11px] text-white/20 font-mono mt-3">
            ~11 min read
          </p>
        </div>

        <div className="space-y-16">
          {/* ── Abstract ──────────────────────────────────────────────── */}
          <Section id="abstract" label="Abstract">
            <P>
              Narrative structure exhibits measurable regularities, yet existing
              metrics fail to quantify the mechanisms that drive reader engagement.
              This paper introduces a computational framework that renders narrative
              structure <B>quantifiable and optimizable</B>. We model narratives
              as knowledge graphs mutating across three independent layers: thread
              lifecycle transitions, character continuity shifts, and world
              knowledge expansion. Three forces (Payoff, Change, Knowledge) derive
              from these mutations via deterministic, z-score normalized formulas.
              Applied to <em>Harry Potter and the Sorcerer&apos;s Stone</em>, the
              delivery curve autonomously identifies dramatic peaks at chapter
              boundaries corresponding to the Sorting Hat, troll confrontation,
              and Quirrell climax — without human annotation.
            </P>
            <P>
              These metrics enable both <B>measurement</B> and <B>synthesis</B>.
              For generation, we deploy Markov-chain pacing, MCTS search, and
              adaptive planning. For revision, iterative evaluation and reconstruction.
              Empirical validation shows published works scoring 85–95 on a composite
              delivery metric, while unguided AI narratives score 65–78. This
              quantifiable gap exposes structural deficiencies: weak thread lifecycle
              complexity, shallow continuity graphs, sparse world-building connectivity.
              The framework provides algorithmic tools to systematically address them.
              All components are open source and configurable.
            </P>
          </Section>

          {/* ── The Problem ───────────────────────────────────────────── */}
          <Section id="problem" label="The Problem">
            <P>
              Computational narrative generation faces a structural deficiency that
              existing metrics fail to quantify. Sentiment analysis measures affective
              valence; topic models measure lexical distribution. Neither distinguishes
              progressive thread escalation from cyclical repetition, persistent
              character knowledge accumulation from transient behavioral variation,
              or hierarchical world-building depth from lateral enumeration. LLMs
              generate syntactically fluent prose yet produce structurally shallow
              narratives: dramatic tensions recur without advancing through lifecycle
              states, characters experience events without accumulating constraining
              knowledge, world systems expand through listing rather than
              interconnection.
            </P>
            <P>
              These deficiencies share a root cause. Readers perceive structural
              regularities — thread lifecycle progression, continuity graph density,
              knowledge interconnection — that no established computational framework
              captures. Narrative coherence emerges from systematic mutations across
              three independent graph layers. Applying mutation-derived formulas to
              published works versus AI-generated narratives makes this gap empirically
              measurable. Published literature scores 85–95 on composite delivery;
              unguided AI output scores 65–78. This 15–20 point disparity reflects
              structural density differences: weaker thread lifecycle complexity,
              shallower continuity graphs, and sparser world-knowledge connectivity.
            </P>

            {/* ── Human vs AI gradient bar ──────────────────────────── */}
            {(() => {
              const W = 580,
                H = 80;
              const BAR_Y = 16,
                BAR_H = 28;
              const PAD_L = 30,
                PAD_R = 20;
              const barW = W - PAD_L - PAD_R;

              const scoreMin = 60,
                scoreMax = 100;
              const toX = (s: number) =>
                PAD_L + ((s - scoreMin) / (scoreMax - scoreMin)) * barW;

              const works = [
                { score: 65, human: false },
                { score: 68, human: false },
                { score: 70, human: false },
                { score: 72, human: false },
                { score: 75, human: false },
                { score: 78, human: false },
                { score: 85, human: true },
                { score: 88, human: true },
                { score: 90, human: true },
                { score: 92, human: true },
                { score: 94, human: true },
                { score: 95, human: true },
              ];

              const ticks = [60, 70, 80, 90, 100];

              return (
                <div className="mt-6 rounded-xl border border-white/6 bg-white/[0.02] px-5 py-4 overflow-x-auto">
                  <svg
                    width={W}
                    height={H}
                    className="mx-auto block min-w-[480px]"
                    viewBox={`0 0 ${W} ${H}`}
                  >
                    <defs>
                      <linearGradient
                        id="score-grad"
                        x1="0"
                        y1="0"
                        x2="1"
                        y2="0"
                      >
                        <stop
                          offset="0%"
                          stopColor="#ef4444"
                          stopOpacity="0.5"
                        />
                        <stop
                          offset="25%"
                          stopColor="#f59e0b"
                          stopOpacity="0.5"
                        />
                        <stop
                          offset="50%"
                          stopColor="#eab308"
                          stopOpacity="0.4"
                        />
                        <stop
                          offset="75%"
                          stopColor="#84cc16"
                          stopOpacity="0.4"
                        />
                        <stop
                          offset="100%"
                          stopColor="#22c55e"
                          stopOpacity="0.5"
                        />
                      </linearGradient>
                    </defs>

                    {/* Gradient bar */}
                    <rect
                      x={PAD_L}
                      y={BAR_Y}
                      width={barW}
                      height={BAR_H}
                      rx={4}
                      fill="url(#score-grad)"
                    />

                    {/* Tick marks */}
                    {ticks.map((t) => (
                      <g key={t}>
                        <line
                          x1={toX(t)}
                          y1={BAR_Y + BAR_H}
                          x2={toX(t)}
                          y2={BAR_Y + BAR_H + 4}
                          stroke="rgba(255,255,255,0.15)"
                        />
                        <text
                          x={toX(t)}
                          y={BAR_Y + BAR_H + 15}
                          textAnchor="middle"
                          fill="rgba(255,255,255,0.25)"
                          fontSize="9"
                        >
                          {t}
                        </text>
                      </g>
                    ))}

                    {/* Points — on the bar */}
                    {works.map((d, i) => (
                      <circle
                        key={i}
                        cx={toX(d.score)}
                        cy={BAR_Y + BAR_H / 2}
                        r={d.human ? 4.5 : 3.5}
                        fill={d.human ? "white" : "rgba(251,191,36,0.8)"}
                        opacity={d.human ? 0.9 : 0.7}
                        stroke={d.human ? "rgba(255,255,255,0.3)" : "none"}
                        strokeWidth={1}
                      />
                    ))}

                    {/* Legend */}
                    <circle
                      cx={PAD_L}
                      cy={H - 6}
                      r={3}
                      fill="white"
                      opacity={0.7}
                    />
                    <text
                      x={PAD_L + 7}
                      y={H - 3}
                      fill="rgba(255,255,255,0.35)"
                      fontSize="8"
                    >
                      Published literature (n=6)
                    </text>
                    <circle
                      cx={PAD_L + 130}
                      cy={H - 6}
                      r={2.5}
                      fill="rgba(251,191,36,0.8)"
                    />
                    <text
                      x={PAD_L + 137}
                      y={H - 3}
                      fill="rgba(255,255,255,0.35)"
                      fontSize="8"
                    >
                      AI-generated (n=6)
                    </text>
                  </svg>
                </div>
              );
            })()}
          </Section>

          {/* ── Approach ──────────────────────────────────────────────── */}
          <Section id="approach" label="Approach">
            <P>
              We model narratives as knowledge graphs that undergo systematic
              mutations scene by scene. Each scene functions as a transformative
              operation, modifying three independent structural layers. An LLM
              extracts mutations; deterministic formulas compute forces. This
              architecture separates <em>comprehension</em> (LLM) from{" "}
              <em>measurement</em> (formulas), making the entire pipeline
              auditable and tunable.
            </P>
            <P>
              The three mutation layers are:
            </P>
            <ul className="mt-3 space-y-2 text-[13px] text-white/50 leading-[1.85]">
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">1.</span>
                <span>
                  <B>Thread mutations</B> — lifecycle transitions of narrative
                  tensions (rivalries, secrets, quests). Each thread advances
                  through discrete states: dormant &rarr; active &rarr;
                  escalating &rarr; critical &rarr; resolved/subverted/abandoned.
                  Transitions are irreversible. A thread escalating from active
                  to critical represents a quantifiable dramatic commitment.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">2.</span>
                <span>
                  <B>Continuity mutations</B> — character knowledge transformations
                  recorded as typed nodes (learns, loses, becomes, realizes). These
                  accumulate as persistent state attached to characters. Unlike
                  ephemeral events, continuity mutations represent permanent changes
                  to what a character knows or is. Relationship mutations
                  (valence shifts between characters) are tracked separately but
                  contribute to the same force.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">3.</span>
                <span>
                  <B>Knowledge graph mutations</B> — additions to the world-building
                  graph, where nodes encode laws, systems, concepts, and tensions,
                  and typed edges encode relationships. Each new magic rule,
                  political faction, or philosophical principle adds a node. Each
                  causal link, hierarchical relation, or thematic connection adds
                  an edge. Depth emerges from connectivity, not lexical volume.
                </span>
              </li>
            </ul>
            <P>
              All three mutation types are recorded per scene as structured
              data. Formulas derive three forces directly from these mutations:
              Payoff from thread transitions, Change from continuity and
              relationship mutations, Knowledge from graph expansion. Forces are
              z-score normalized across all scenes, making them comparable across
              works of arbitrary length. Every coefficient is documented. If a
              weight seems wrong, you can change it. The science is in the
              math, not the model.
            </P>
          </Section>

          {/* ── Computational Hierarchy ───────────────────────────────── */}
          <Section id="hierarchy" label="Computational Hierarchy">
            <P>
              InkTide decomposes narratives into five nested computational
              layers, each with distinct responsibilities and output formats.
              This hierarchical structure enables parallel processing, modular
              prompting, and precise attribution of narrative effects to their
              generative sources.
            </P>

            {/* Visual hierarchy diagram - clean and compact */}
            <div className="my-8 px-4 py-6 rounded-lg bg-white/[0.02] border border-white/6">
              <svg
                width="100%"
                viewBox="0 0 820 420"
                className="max-w-full mx-auto"
              >
                {(() => {
                  // Clean, balanced tree with better spacing
                  const narrative = { cx: 425, y: 30 };
                  const arcs = [
                    { cx: 220, y: 105 },
                    { cx: 425, y: 105 },
                    { cx: 630, y: 105 },
                  ];
                  const scenes = [
                    // From arc 0
                    { cx: 145, y: 185 },
                    { cx: 230, y: 185 },
                    { cx: 315, y: 185 },
                    // From arc 1
                    { cx: 425, y: 185 },
                    { cx: 510, y: 185 },
                    // From arc 2
                    { cx: 600, y: 185 },
                    { cx: 685, y: 185 },
                  ];
                  const beats = [
                    // From scene 0
                    { cx: 115, y: 275 },
                    { cx: 175, y: 275 },
                    // From scene 2
                    { cx: 285, y: 275 },
                    { cx: 345, y: 275 },
                    // From scene 3
                    { cx: 425, y: 275 },
                    // From scene 5
                    { cx: 570, y: 275 },
                    { cx: 630, y: 275 },
                    // From scene 6
                    { cx: 685, y: 275 },
                  ];
                  const props = [
                    // From beat 0
                    { cx: 95, y: 355 },
                    { cx: 135, y: 355 },
                    // From beat 1
                    { cx: 165, y: 355 },
                    { cx: 195, y: 355 },
                    // From beat 2
                    { cx: 270, y: 355 },
                    { cx: 310, y: 355 },
                    // From beat 4
                    { cx: 405, y: 355 },
                    { cx: 445, y: 355 },
                    // From beat 5
                    { cx: 590, y: 355 },
                    { cx: 630, y: 355 },
                    // From beat 7
                    { cx: 670, y: 355 },
                    { cx: 710, y: 355 },
                  ];

                  return (
                    <g>
                      {/* Connecting lines - narrative to arcs */}
                      {arcs.map((arc, i) => (
                        <line
                          key={`na-${i}`}
                          x1={narrative.cx}
                          y1={narrative.y + 17}
                          x2={arc.cx}
                          y2={arc.y - 13}
                          stroke="#a855f7"
                          strokeWidth="1.5"
                          strokeOpacity="0.25"
                        />
                      ))}

                      {/* Connecting lines - arcs to scenes */}
                      {[
                        [0, 0], [0, 1], [0, 2], // arc 0 → scenes 0,1,2
                        [1, 3], [1, 4],         // arc 1 → scenes 3,4
                        [2, 5], [2, 6],         // arc 2 → scenes 5,6
                      ].map(([arcIdx, sceneIdx], i) => (
                        <line
                          key={`as-${i}`}
                          x1={arcs[arcIdx].cx}
                          y1={arcs[arcIdx].y + 13}
                          x2={scenes[sceneIdx].cx}
                          y2={scenes[sceneIdx].y - 12}
                          stroke="#3b82f6"
                          strokeWidth="1.5"
                          strokeOpacity="0.25"
                        />
                      ))}

                      {/* Connecting lines - scenes to beats */}
                      {[
                        [0, 0], [0, 1],         // scene 0 → beats 0-1
                        [2, 2], [2, 3],         // scene 2 → beats 2-3
                        [3, 4],                 // scene 3 → beat 4
                        [5, 5], [5, 6],         // scene 5 → beats 5-6
                        [6, 7],                 // scene 6 → beat 7
                      ].map(([sceneIdx, beatIdx], i) => (
                        <line
                          key={`sb-${i}`}
                          x1={scenes[sceneIdx].cx}
                          y1={scenes[sceneIdx].y + 12}
                          x2={beats[beatIdx].cx}
                          y2={beats[beatIdx].y - 10}
                          stroke="#22d3ee"
                          strokeWidth="1.5"
                          strokeOpacity="0.25"
                        />
                      ))}

                      {/* Connecting lines - beats to propositions */}
                      {[
                        [0, 0], [0, 1],         // beat 0 → props 0-1
                        [1, 2], [1, 3],         // beat 1 → props 2-3
                        [2, 4], [2, 5],         // beat 2 → props 4-5
                        [4, 6], [4, 7],         // beat 4 → props 6-7
                        [5, 8], [5, 9],         // beat 5 → props 8-9
                        [7, 10], [7, 11],       // beat 7 → props 10-11
                      ].map(([beatIdx, propIdx], i) => (
                        <line
                          key={`bp-${i}`}
                          x1={beats[beatIdx].cx}
                          y1={beats[beatIdx].y + 10}
                          x2={props[propIdx].cx}
                          y2={props[propIdx].y - 8}
                          stroke="#22c55e"
                          strokeWidth="1.5"
                          strokeOpacity="0.2"
                        />
                      ))}

                      {/* NARRATIVE */}
                      <g>
                        <rect
                          x={narrative.cx - 55}
                          y={narrative.y}
                          width="110"
                          height="34"
                          rx="5"
                          fill="#a855f7"
                          fillOpacity="0.2"
                          stroke="#a855f7"
                          strokeWidth="2.5"
                        />
                        <text
                          x={narrative.cx}
                          y={narrative.y + 22}
                          textAnchor="middle"
                          fill="white"
                          fillOpacity="0.95"
                          fontSize="12"
                          fontWeight="700"
                        >
                          NARRATIVE
                        </text>
                      </g>

                      {/* ARCS */}
                      {arcs.map((arc, i) => (
                        <g key={`arc-${i}`}>
                          <rect
                            x={arc.cx - 40}
                            y={arc.y}
                            width="80"
                            height="26"
                            rx="4"
                            fill="#3b82f6"
                            fillOpacity="0.15"
                            stroke="#3b82f6"
                            strokeWidth="2"
                          />
                          <text
                            x={arc.cx}
                            y={arc.y + 17}
                            textAnchor="middle"
                            fill="white"
                            fillOpacity="0.85"
                            fontSize="11"
                            fontWeight="600"
                          >
                            Arc {i + 1}
                          </text>
                        </g>
                      ))}

                      {/* SCENES */}
                      {scenes.map((scene, i) => (
                        <g key={`scene-${i}`}>
                          <rect
                            x={scene.cx - 35}
                            y={scene.y}
                            width="70"
                            height="24"
                            rx="3"
                            fill="#22d3ee"
                            fillOpacity="0.12"
                            stroke="#22d3ee"
                            strokeWidth="1.8"
                          />
                          <text
                            x={scene.cx}
                            y={scene.y + 16}
                            textAnchor="middle"
                            fill="white"
                            fillOpacity="0.75"
                            fontSize="10"
                            fontWeight="600"
                          >
                            Scene {i + 1}
                          </text>
                        </g>
                      ))}

                      {/* BEATS */}
                      {beats.map((beat, i) => (
                        <g key={`beat-${i}`}>
                          <rect
                            x={beat.cx - 28}
                            y={beat.y}
                            width="56"
                            height="20"
                            rx="3"
                            fill="#22c55e"
                            fillOpacity="0.1"
                            stroke="#22c55e"
                            strokeWidth="1.5"
                          />
                          <text
                            x={beat.cx}
                            y={beat.y + 13}
                            textAnchor="middle"
                            fill="white"
                            fillOpacity="0.75"
                            fontSize="9"
                            fontWeight="600"
                          >
                            {["breathe", "inform", "advance", "turn", "reveal", "bond", "shift", "expand"][i]}
                          </text>
                        </g>
                      ))}

                      {/* PROPOSITIONS - simple bars */}
                      {props.map((prop, i) => (
                        <g key={`prop-${i}`}>
                          <rect
                            x={prop.cx - 16}
                            y={prop.y}
                            width="32"
                            height="16"
                            rx="2"
                            fill="#f59e0b"
                            fillOpacity="0.12"
                            stroke="#f59e0b"
                            strokeWidth="1"
                            strokeOpacity="0.4"
                          />
                          <text
                            x={prop.cx}
                            y={prop.y + 11}
                            textAnchor="middle"
                            fill="white"
                            fillOpacity="0.6"
                            fontSize="7"
                            fontWeight="600"
                          >
                            P{i + 1}
                          </text>
                        </g>
                      ))}

                      {/* Row labels (left side) */}
                      <text
                        x="20"
                        y="47"
                        fill="white"
                        fillOpacity="0.35"
                        fontSize="9"
                        fontWeight="700"
                        letterSpacing="1.2"
                      >
                        NARRATIVE
                      </text>
                      <text
                        x="20"
                        y="118"
                        fill="white"
                        fillOpacity="0.35"
                        fontSize="9"
                        fontWeight="700"
                        letterSpacing="1.2"
                      >
                        ARCS
                      </text>
                      <text
                        x="20"
                        y="198"
                        fill="white"
                        fillOpacity="0.35"
                        fontSize="9"
                        fontWeight="700"
                        letterSpacing="1.2"
                      >
                        SCENES
                      </text>
                      <text
                        x="20"
                        y="285"
                        fill="white"
                        fillOpacity="0.35"
                        fontSize="9"
                        fontWeight="700"
                        letterSpacing="1.2"
                      >
                        BEATS
                      </text>
                      <text
                        x="20"
                        y="365"
                        fill="white"
                        fillOpacity="0.35"
                        fontSize="9"
                        fontWeight="700"
                        letterSpacing="1.2"
                      >
                        PROPS
                      </text>
                    </g>
                  );
                })()}
              </svg>
            </div>

            <P>
              <B>Narrative</B> — Global container for all entities, threads, and world knowledge. Persists across all scenes as a growing knowledge graph. <B>Arcs</B> — Thematic groupings of 5–8 scenes with directional objectives. Direction vectors recompute after each arc based on thread lifecycle tension and narrative momentum. <B>Scenes</B> — Atomic units of structural mutation. Each scene generates thread transitions, continuity mutations, and knowledge graph additions. Forces derive directly from these mutations, not from prose. <B>Beats</B> — Functional prose segments with typed roles (breathe, inform, advance, turn, reveal, etc.) and delivery mechanisms (dialogue, thought, action, etc.). Generated as architectural blueprints before any prose is written. <B>Propositions</B> — Atomic prose units (20–60 words) that execute beat intentions. Ephemeral rendering artifacts with no persistent type structure.
            </P>

            <P>
              This hierarchy enforces <B>separation of concerns</B>. Structure generation (scenes with mutations) runs independently of prose generation (beats and propositions). An LLM generates scene structures, then beat plans in parallel, then prose in parallel. Forces are computed from mutation graphs without examining prose. Revision edits beats without modifying scene structure. The architecture maximizes parallelism and makes every layer auditable.
            </P>
          </Section>

          {/* ── The Three Forces ──────────────────────────────────────── */}
          <Section id="forces" label="The Three Forces">
            <div className="mb-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">
                Payoff
              </h3>
              <P>
                Payoff quantifies irreversible narrative commitments by measuring
                thread lifecycle transitions. Each thread (a rivalry, secret,
                quest, or other narrative tension) progresses through discrete
                states. Transitions forward in the lifecycle represent dramatic
                escalation or resolution.
              </P>
              <Eq tex="P = \sum_{t} \max\left(0,\ \varphi_{\text{to}} - \varphi_{\text{from}}\right)" />
              <P>
                Thread phases are indexed: dormant (0), active (1), escalating (2),
                critical (3), resolved/subverted/abandoned (4). A thread jumping
                from active to critical contributes{" "}
                <Tex>{"|3 - 1| = 2"}</Tex> to Payoff. Threads mentioned in a scene
                without changing state receive a pulse of 0.25 to maintain
                visibility without inflating the metric. The formula aggregates
                across all thread mutations recorded for the scene.
              </P>
            </div>

            <div className="mb-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">
                Change
              </h3>
              <P>
                Change measures character transformation. It aggregates continuity
                mutations (permanent knowledge/identity shifts), events (transient
                occurrences), and relationship mutations (valence changes). The
                formula scales sub-linearly to prevent cast size from dominating —
                a two-character betrayal and a ten-character ensemble producing the
                same mutation count score identically.
              </P>
              <Eq
                tex={String.raw`C = \sqrt{\Delta M} \;+\; \sqrt{\Delta E} \;+\; \sqrt{\Delta R}`}
              />
              <P>
                <Tex>{String.raw`\Delta M`}</Tex> counts continuity mutations
                (learns, loses, becomes, realizes), <Tex>{String.raw`\Delta E`}</Tex>{" "}
                counts scene events, and <Tex>{String.raw`\Delta R = \sum |\Delta v|`}</Tex>{" "}
                sums absolute relationship valence shifts. A betrayal shifting
                trust by <Tex>{String.raw`|\Delta v| = 0.5`}</Tex> contributes
                more than casual banter at <Tex>{String.raw`|\Delta v| = 0.1`}</Tex>.
                Square root scaling prevents any single term from overwhelming the
                others while preserving sensitivity to dramatic spikes.
              </P>
            </div>

            <div>
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">
                Knowledge
              </h3>
              <P>
                Knowledge measures world-building graph expansion. It counts
                additions to the typed knowledge graph with asymmetric weighting:
                new concepts (nodes) contribute more than new connections (edges)
                between existing concepts.
              </P>
              <Eq tex={String.raw`K = \Delta N + \sqrt{\Delta E}`} />
              <P>
                <Tex>{"\\Delta N"}</Tex> counts new nodes added to the graph
                (laws, systems, concepts, tensions), and <Tex>{"\\Delta E"}</Tex>{" "}
                counts new typed edges. Nodes scale linearly because each represents
                genuinely new information. Edges scale sub-linearly (square root)
                because early connections matter more than later ones — this prevents
                bulk edge additions from dominating. The formula applies to any
                world-building context: fantasy magic systems, literary social
                hierarchies, or science fiction physics.
              </P>
            </div>

            <div className="mt-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">
                Delivery
              </h3>
              <P>
                While Payoff, Change, and Knowledge measure structural{" "}
                <em>operations</em>, Delivery quantifies reader-perceived{" "}
                <em>impact</em> — the aggregate effect of all three forces,
                weighted by tension-release dynamics.
              </P>
              <Eq
                tex={String.raw`D_i = w \sum_{f \,\in\, \{P,C,K\}} \tanh\!\left(\frac{f_i}{\alpha}\right) \;+\; \gamma \cdot \text{contrast}_i \qquad w{=}0.3,\;\; \alpha{=}1.5,\;\; \gamma{=}0.2`}
              />
              <P>
                All three forces contribute symmetrically — same weight, same
                saturation. <Tex>{"\\tanh(f/\\alpha)"}</Tex> compresses extreme
                values while preserving their sign and relative ordering. The
                contrast term{" "}
                <Tex>{"\\text{contrast}_i = \\max(0,\\; T_{i-1} - T_i)"}</Tex>{" "}
                where <Tex>{"T_i = C_i + K_i - P_i"}</Tex> rewards
                tension-release patterns: the bigger the drop from buildup to
                payoff, the stronger the delivery. Calibrated against{" "}
                <em>Harry Potter</em>, <em>Nineteen Eighty-Four</em>,{" "}
                <em>The Great Gatsby</em>, and <em>Reverend Insanity</em>.
              </P>
            </div>
          </Section>

          {/* ── Validation ──────────────────────────────────────────── */}
          <Section id="validation" label="Validation">
            <P>
              Do the formulas capture what readers actually feel? We tested
              against <em>Harry Potter and the Sorcerer&apos;s Stone</em> — a
              novel whose dramatic peaks are well-established in popular memory.
              The delivery curve below was computed entirely from structural
              mutations, with no human annotation.
            </P>

            {/* Annotated Delivery Curve — computed from /works/harry_potter JSON via the same formulas used in the app */}
            {(() => {
              // Smoothed delivery values computed from the actual works JSON:
              // raw forces → z-score normalise → delivery formula → Gaussian smooth (σ=1.5)
              const delivery = [
                0.46, 0.329, 0.197, 0.145, 0.194, 0.273, 0.294, 0.226, 0.131,
                0.095, 0.127, 0.155, 0.121, 0.037, -0.045, -0.092, -0.1, -0.07,
                0.001, 0.108, 0.207, 0.232, 0.165, 0.069, 0.027, 0.078, 0.202,
                0.349, 0.472, 0.559, 0.608, 0.592, 0.519, 0.436, 0.344, 0.23,
                0.135, 0.082, 0.041, -0.017, -0.071, -0.07, 0.009, 0.133, 0.263,
                0.367, 0.413, 0.391, 0.342, 0.305, 0.269, 0.203, 0.11, 0.052,
                0.056, 0.063, 0.018, -0.03, -0.008, 0.048, 0.052, -0.018,
                -0.107, -0.129, -0.053, 0.062, 0.14, 0.149, 0.102, 0.035,
                -0.004, 0.006, 0.005, -0.081, -0.211, -0.288, -0.278, -0.205,
                -0.118, -0.086, -0.126, -0.154, -0.097, 0.019, 0.132, 0.204,
                0.251, 0.308, 0.356, 0.339, 0.265,
              ];
              const n = delivery.length;
              const W = 620,
                H = 200;
              const PAD = { top: 30, right: 20, bottom: 40, left: 40 };
              const cw = W - PAD.left - PAD.right;
              const ch = H - PAD.top - PAD.bottom;
              const dMin = Math.min(...delivery);
              const dMax = Math.max(...delivery);
              const range = dMax - dMin;
              const toX = (i: number) => PAD.left + (i / (n - 1)) * cw;
              const toY = (v: number) =>
                PAD.top + ch - ((v - dMin) / range) * ch;
              const zeroY = toY(0);

              const points = delivery
                .map((v, i) => `${toX(i)},${toY(v)}`)
                .join(" ");

              const annotations = [
                { scene: 7, label: "Letters arrive" },
                { scene: 12, label: "Hagrid reveals truth" },
                { scene: 22, label: "Diagon Alley" },
                { scene: 31, label: "Sorting Hat" },
                { scene: 47, label: "Troll fight" },
                { scene: 61, label: "Flamel discovered" },
                { scene: 68, label: "Norbert aftermath" },
                { scene: 89, label: "Quirrell confrontation" },
              ];

              return (
                <div className="my-8">
                  <svg
                    width="100%"
                    viewBox={`0 0 ${W} ${H}`}
                    className="overflow-visible"
                  >
                    {/* Grid lines */}
                    {[-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1.0].map((v) => (
                      <g key={v}>
                        <line
                          x1={PAD.left}
                          y1={toY(v)}
                          x2={PAD.left + cw}
                          y2={toY(v)}
                          stroke="white"
                          strokeOpacity={v === 0 ? 0.15 : 0.05}
                        />
                        <text
                          x={PAD.left - 6}
                          y={toY(v) + 3}
                          textAnchor="end"
                          fill="white"
                          fillOpacity="0.2"
                          fontSize="8"
                          fontFamily="monospace"
                        >
                          {v.toFixed(1)}
                        </text>
                      </g>
                    ))}

                    {/* Positive fill */}
                    <path
                      d={`M${toX(0)},${zeroY} ${delivery.map((v, i) => `L${toX(i)},${Math.min(toY(v), zeroY)}`).join(" ")} L${toX(n - 1)},${zeroY} Z`}
                      fill="#F59E0B"
                      fillOpacity="0.08"
                    />
                    {/* Negative fill */}
                    <path
                      d={`M${toX(0)},${zeroY} ${delivery.map((v, i) => `L${toX(i)},${Math.max(toY(v), zeroY)}`).join(" ")} L${toX(n - 1)},${zeroY} Z`}
                      fill="#3B82F6"
                      fillOpacity="0.06"
                    />
                    {/* Delivery line */}
                    <polyline
                      points={points}
                      fill="none"
                      stroke="#F59E0B"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />

                    {/* Peak annotations — peaks only, above the curve */}
                    {annotations.map(({ scene, label }) => {
                      const i = scene - 1;
                      const x = toX(i);
                      const y = toY(delivery[i]);
                      return (
                        <g key={scene}>
                          <line
                            x1={x}
                            y1={y}
                            x2={x}
                            y2={y - 16}
                            stroke="white"
                            strokeOpacity="0.2"
                            strokeDasharray="2 2"
                          />
                          <circle
                            cx={x}
                            cy={y}
                            r={3}
                            fill="#FCD34D"
                            opacity="0.9"
                          />
                          <text
                            x={x}
                            y={y - 20}
                            textAnchor="middle"
                            fill="white"
                            fillOpacity="0.5"
                            fontSize="7"
                            fontFamily="system-ui"
                          >
                            {label}
                          </text>
                        </g>
                      );
                    })}

                    {/* X axis label */}
                    <text
                      x={PAD.left + cw / 2}
                      y={H - 5}
                      textAnchor="middle"
                      fill="white"
                      fillOpacity="0.2"
                      fontSize="9"
                      fontFamily="system-ui"
                    >
                      Scene (1&ndash;{n})
                    </text>
                    <text
                      x={8}
                      y={PAD.top + ch / 2}
                      textAnchor="middle"
                      fill="white"
                      fillOpacity="0.2"
                      fontSize="9"
                      fontFamily="system-ui"
                      transform={`rotate(-90, 8, ${PAD.top + ch / 2})`}
                    >
                      Delivery
                    </text>
                  </svg>
                  <p className="text-[10px] text-white/30 text-center mt-2">
                    Harry Potter and the Sorcerer&apos;s Stone — smoothed
                    delivery curve with annotated peaks.
                    <br />
                    Computed from structural mutations in{" "}
                    <code className="text-white/40">
                      works/harry_potter_and_the_sorcerer_s_stone.json
                    </code>
                    .
                  </p>
                </div>
              );
            })()}

            <P>
              Every peak corresponds to a moment any reader would identify:
              Harry&apos;s letters arriving in impossible quantities, Hagrid
              revealing the truth, the wonder of Diagon Alley, the Sorting Hat
              ceremony, the troll fight that forges a friendship, discovering
              Nicolas Flamel, the Norbert aftermath, and the climactic
              confrontation with Quirrell.
            </P>
            <P>
              This is the core claim:{" "}
              <B>
                deterministic formulas applied to structural mutations recover
                the dramatic shape of a narrative without reading the prose
              </B>
              . The mutations are extracted by an LLM, so the inputs are
              approximate — but the formulas themselves are deterministic and
              auditable. The approximation is useful enough to act on. When
              applied to AI-generated narratives, the same formulas produce
              flatter delivery curves: mutations are structurally valid but
              uniformly dense, lacking the contrast that creates memorable
              moments.
            </P>
          </Section>

          {/* ── Grading ───────────────────────────────────────────────── */}
          <Section id="grading" label="Grading">
            <P>
              Each story receives a score out of 100, with 25 points allocated
              to each of the three forces plus <B>swing</B> — the Euclidean
              distance between consecutive force snapshots, measuring pacing
              dynamism. The grading curve is exponential, calibrated against
              reference works including <em>Harry Potter</em>,{" "}
              <em>The Great Gatsby</em>, <em>Crime and Punishment</em>, and{" "}
              <em>Coiling Dragon</em>.
            </P>
            <Eq tex="g(\tilde{x}) = 25\left(1 - e^{-2\tilde{x}}\right) \qquad \text{where} \quad \tilde{x} = \frac{\bar{x}}{\mu_{\text{ref}}}" />
            <P>
              At <Tex>{"\\tilde{x} = 1"}</Tex> (matching the reference mean),
              the grade is ~22 out of 25. The curve rises steeply at first —
              rewarding baseline competence — then flattens at higher levels,
              making each additional point harder to earn. Reference works land
              between 85 and 92.
            </P>

            <P>
              The reference means (<Tex>{"\\mu_{\\text{ref}}"}</Tex>) are
              derived from those same works:
            </P>
            <div className="mt-3 mb-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] max-w-sm">
              {[
                { force: "Payoff", value: "1.3", color: "#EF4444" },
                { force: "Change", value: "4", color: "#22C55E" },
                { force: "Knowledge", value: "3.5", color: "#3B82F6" },
              ].map(({ force, value, color }) => (
                <div
                  key={force}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2"
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-white/50">{force}</span>
                  <span className="ml-auto font-mono text-white/70">
                    {value}
                  </span>
                </div>
              ))}
            </div>
            <P>
              The overall score sums all four sub-grades:{" "}
              <Tex>
                {
                  "\\text{Overall} = g(\\tilde{P}) + g(\\tilde{C}) + g(\\tilde{K}) + g(\\tilde{S})"
                }
              </Tex>
              , where <Tex>{"\\tilde{S}"}</Tex> is swing. Swing values are
              already mean-normalised by the reference means during distance
              computation, so no separate reference mean is needed —{" "}
              <Tex>{"g(\\tilde{S})"}</Tex> is applied directly to the average
              swing magnitude.
            </P>
            <P>
              A systematic gap emerges between human-authored and AI-generated
              texts. Published literature consistently scores 85–95 — dense
              thread lifecycles, earned resolutions, and hierarchical
              world-building compound through sustained narrative arc
              development. AI-generated narratives cluster in the 65–78 range:
              threads resolve prematurely without adequate buildup, character
              transformations lack progressive accumulation, and knowledge
              graphs expand laterally without achieving the connective depth
              that human authors construct iteratively. This disparity is not a
              calibration artifact — it represents precisely the structural
              distinctions the force formulas quantify.
            </P>
          </Section>

          {/* ── Classification ────────────────────────────────────────── */}
          {/* ── Markov Chains ─────────────────────────────────────────── */}
          <Section id="markov" label="Markov Chains">
            <P>
              InkTide uses two layers of Markov chains to guide generation.
              The first operates at the <strong>scene level</strong> — controlling
              pacing by sampling force profiles from an 8-state transition
              matrix. The second operates at the <strong>beat level</strong> —
              controlling prose texture by sampling sequences from a 10-state
              matrix over beat functions. Both are derived empirically from
              published works using the same methodology: classify each unit,
              count consecutive transitions, normalise rows.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">
              Layer 1: Pacing Chains (Scene &rarr; Scene)
            </h3>
            <P>
              The eight cube corners form a finite state space. Every scene
              occupies one corner, and the transition from scene to scene is a
              state transition. Across an entire novel, these transitions form
              an empirical Markov chain — a transition matrix{" "}
              <Tex>{"T \\in \\mathbb{R}^{8 \\times 8}"}</Tex> where{" "}
              <Tex>{"T_{ij}"}</Tex> gives the probability of moving from mode{" "}
              <Tex>{"i"}</Tex> to mode <Tex>{"j"}</Tex>.
            </P>

            <P>
              We compute force vectors for each scene from raw mutation data —
              thread phase transitions for Payoff, continuity and relationship
              mutations for Change, world knowledge additions for Knowledge —
              then z-score normalise across the novel and classify each scene
              into its cube corner. Consecutive corners form the chain.
            </P>

            {/* HP Pacing State Graph — all 49 transitions */}
            <div className="my-6 flex flex-col items-center gap-4 overflow-x-auto">
              <svg
                width="400"
                height="400"
                viewBox="0 0 400 400"
                className="select-none max-w-full min-w-[300px]"
              >
                {(() => {
                  const names = ["Epoch", "Climax", "Revelation", "Closure", "Discovery", "Growth", "Lore", "Rest"];
                  const colors = ["#f59e0b", "#ef4444", "#a855f7", "#6366f1", "#22d3ee", "#22c55e", "#3b82f6", "#6b7280"];
                  const visits = [16, 18, 13, 7, 8, 9, 10, 10];
                  const cx = 200, cy = 200, r = 150;
                  const maxV = Math.max(...visits);
                  const positions = names.map((_, i) => {
                    const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
                    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
                  });
                  // All 49 transitions from HP mutation analysis
                  const edges: [number, number, number][] = [
                    [1, 2, 4], [1, 0, 4], [6, 1, 4], [1, 1, 4],
                    [5, 2, 3], [2, 2, 3], [4, 5, 3], [7, 1, 3], [0, 6, 3], [0, 3, 3], [1, 6, 3], [0, 1, 3], [0, 0, 3],
                    [2, 4, 2], [4, 4, 2], [2, 7, 2], [2, 1, 2], [7, 7, 2], [1, 3, 2], [7, 0, 2], [2, 0, 2], [0, 5, 2], [3, 2, 2], [6, 0, 2],
                    [7, 5, 1], [5, 7, 1], [7, 4, 1], [3, 5, 1], [5, 6, 1], [6, 5, 1], [2, 5, 1], [5, 3, 1], [3, 6, 1], [6, 7, 1], [3, 7, 1], [3, 1, 1], [5, 1, 1], [6, 6, 1], [5, 0, 1], [1, 7, 1], [5, 4, 1], [4, 6, 1], [6, 4, 1], [4, 3, 1], [3, 0, 1], [0, 7, 1], [0, 4, 1], [4, 0, 1], [7, 2, 1],
                  ];
                  const maxE = 4;
                  return (
                    <>
                      {edges.map(([fi, ti, count], ei) => {
                        if (fi === ti) {
                          const angle = (fi / 8) * Math.PI * 2 - Math.PI / 2;
                          const loopR = 14;
                          const ox = cx + (r + loopR + 12) * Math.cos(angle);
                          const oy = cy + (r + loopR + 12) * Math.sin(angle);
                          return (
                            <circle
                              key={ei}
                              cx={ox} cy={oy} r={loopR}
                              fill="none"
                              stroke="rgba(52,211,153,1)"
                              strokeWidth={1 + 2 * (count / maxE)}
                              opacity={0.12 + 0.55 * (count / maxE)}
                            />
                          );
                        }
                        const p1 = positions[fi], p2 = positions[ti];
                        const dx = p2.x - p1.x, dy = p2.y - p1.y;
                        const len = Math.sqrt(dx * dx + dy * dy);
                        const nx = -dy / len, ny = dx / len;
                        const nr = 14 + (visits[ti] / maxV) * 10;
                        const ratio = Math.max(0, (len - nr - 8) / len);
                        return (
                          <line
                            key={ei}
                            x1={p1.x + 4 * nx} y1={p1.y + 4 * ny}
                            x2={p1.x + dx * ratio + 4 * nx} y2={p1.y + dy * ratio + 4 * ny}
                            stroke="rgba(52,211,153,1)"
                            strokeWidth={1 + 2 * (count / maxE)}
                            opacity={0.12 + 0.55 * (count / maxE)}
                            strokeLinecap="round"
                          />
                        );
                      })}
                      {names.map((name, i) => {
                        const p = positions[i];
                        const nr = 14 + (visits[i] / maxV) * 10;
                        return (
                          <g key={i}>
                            <circle cx={p.x} cy={p.y} r={nr} fill={colors[i]} opacity={0.85} />
                            <text x={p.x} y={p.y + 1} fill="#fff" fontSize="9" fontWeight="600" textAnchor="middle" dominantBaseline="middle">{name}</text>
                            <text x={p.x} y={p.y + nr + 12} fill="#9ca3af" fontSize="8" textAnchor="middle">{visits[i]}x</text>
                          </g>
                        );
                      })}
                    </>
                  );
                })()}
              </svg>
              <p className="text-[10px] text-white/30 text-center">
                Harry Potter and the Sorcerer&apos;s Stone — pacing chain.
                91 scenes, 90 transitions, 49 unique edges.
                <br />
                Node size = visit frequency. Edge thickness = transition count.
              </p>
            </div>

            <P>
              Harry Potter&apos;s pacing chain is remarkably well-distributed:
              entropy 2.93/3.00, self-loop rate 16.7%, payoff-to-buildup ratio
              54/37. Climax (18 visits) and Epoch (16) lead — the story runs hot,
              with high-force scenes appearing more often than quiet ones. But the
              chain never stays in one place long: the strongest transitions
              (Climax&rarr;Revelation, Climax&rarr;Epoch, Lore&rarr;Climax, each
              4x) show a story that constantly pivots between peaks and reframing.
            </P>
            <P>
              Other works produce strikingly different fingerprints.{" "}
              <em>Nineteen Eighty-Four</em> (75 scenes) is payoff-heavy —
              72% of scenes land in the top four corners, with Epoch alone at 28%.
              Self-loops hit 21.6%, reflecting Orwell&apos;s sustained pressure
              rather than Rowling&apos;s pivoting. <em>Reverend Insanity</em>{" "}
              (133 scenes) mirrors Harry Potter&apos;s balanced exploration
              (entropy 2.90, self-loops 11.4%) but at twice the scale.{" "}
              <em>The Great Gatsby</em> (44 scenes) clusters around Epoch (12)
              and Rest (10), oscillating between extremes with little
              middle ground — Fitzgerald&apos;s pendulum rhythm.
            </P>
            <P>
              Before generating an arc, the engine samples a pacing sequence
              from the active matrix: starting from the current mode, it walks
              the chain for N steps, producing a sequence like{" "}
              <span className="font-mono text-white/50">
                Growth &rarr; Lore &rarr; Climax &rarr; Rest &rarr; Growth
              </span>
              . Each step becomes a per-scene direction — Scene 1 must produce a
              Growth force profile, Scene 3 must spike all forces. Users select a{" "}
              <em>rhythm profile</em> derived from a published work: a story
              using Harry Potter&apos;s matrix will pivot constantly between
              peaks, while one using Orwell&apos;s will sustain pressure then
              erupt.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">
              Layer 2: Beat Chains (Beat &rarr; Beat)
            </h3>
            <P>
              Pacing chains control <em>which force profile</em> a scene must
              hit. But within a scene, the prose itself has structure — a
              sequence of discrete <strong>beats</strong>, each performing a
              specific narrative function through a specific delivery mechanism.
              We reverse-engineer this structure from published prose: an LLM
              decomposes each scene into its constituent beats, classifying
              each against a fixed taxonomy of 10 functions and 8 mechanisms.
            </P>

            <P>
              The <strong>10 beat functions</strong> describe what each section
              of prose does:{" "}
              <span className="text-white/60">
                <span style={{ color: '#6b7280' }}>breathe</span> (atmosphere, grounding),{" "}
                <span style={{ color: '#3b82f6' }}>inform</span> (knowledge delivery),{" "}
                <span style={{ color: '#22c55e' }}>advance</span> (forward momentum),{" "}
                <span style={{ color: '#ec4899' }}>bond</span> (relationship shifts),{" "}
                <span style={{ color: '#f59e0b' }}>turn</span> (pivots and reversals),{" "}
                <span style={{ color: '#a855f7' }}>reveal</span> (character nature exposed),{" "}
                <span style={{ color: '#ef4444' }}>shift</span> (power dynamics invert),{" "}
                <span style={{ color: '#06b6d4' }}>expand</span> (world-building),{" "}
                <span style={{ color: '#84cc16' }}>foreshadow</span> (plants for later payoff),{" "}
                <span style={{ color: '#14b8a6' }}>resolve</span> (tension releases).
              </span>
            </P>

            <P>
              The <strong>8 mechanisms</strong> describe how each beat is
              delivered as prose: dialogue, thought, action, environment,
              narration, memory, document, comic. A single beat function can be
              delivered through different mechanisms — a <em>reveal</em> can land
              through dialogue, action, or narration, each producing
              a different texture.
            </P>

            <P>
              The methodology mirrors the pacing chain exactly: extract beat
              plans from every scene of a published work, tally consecutive
              function&rarr;function transitions, normalise rows, and produce a
              Markov matrix{" "}
              <Tex>{"B \\in \\mathbb{R}^{10 \\times 10}"}</Tex>. Applied to{" "}
              <em>Harry Potter and the Sorcerer&apos;s Stone</em>, this yields
              1,254 beats across 91 scenes (~13.8 beats per scene):
            </P>

            {/* HP Beat Profile Graph — all 92 transitions */}
            <div className="my-6 flex flex-col items-center gap-4 overflow-x-auto">
              <svg
                width="420"
                height="420"
                viewBox="0 0 420 420"
                className="select-none max-w-full min-w-[300px]"
              >
                {(() => {
                  const fns = ['breathe', 'inform', 'advance', 'bond', 'turn', 'reveal', 'shift', 'expand', 'foreshadow', 'resolve'];
                  const fnColors: Record<string, string> = {
                    breathe: '#6b7280', inform: '#3b82f6', advance: '#22c55e', bond: '#ec4899',
                    turn: '#f59e0b', reveal: '#a855f7', shift: '#ef4444', expand: '#06b6d4',
                    foreshadow: '#84cc16', resolve: '#14b8a6',
                  };
                  const visits = [205, 255, 329, 96, 83, 81, 44, 48, 48, 65];
                  const cx = 210, cy = 210, r = 155;
                  const maxV = Math.max(...visits);
                  const positions = fns.map((_, i) => {
                    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
                    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
                  });
                  // All 92 transitions from HP beat analysis
                  const edges: [number, number, number][] = [
                    [1, 2, 98], [0, 1, 82], [2, 1, 66], [2, 2, 58], [0, 2, 56],
                    [2, 0, 42], [2, 4, 38], [2, 3, 31], [2, 9, 29], [1, 3, 27],
                    [4, 2, 26], [3, 2, 26], [1, 0, 25], [5, 2, 24], [2, 5, 23],
                    [1, 5, 23], [1, 1, 23], [4, 1, 21], [1, 7, 20], [3, 1, 18],
                    [0, 0, 16], [5, 1, 16], [7, 2, 16], [0, 4, 14], [5, 3, 13],
                    [1, 4, 13], [3, 5, 11], [3, 0, 11], [2, 6, 11], [5, 9, 10],
                    [8, 0, 10], [2, 8, 9], [1, 6, 9], [6, 2, 9], [2, 7, 9],
                    [7, 1, 9], [9, 2, 8], [6, 5, 8], [4, 6, 8], [3, 6, 7],
                    [8, 2, 7], [1, 8, 7], [0, 3, 7], [9, 8, 6], [0, 7, 6],
                    [0, 8, 6], [4, 8, 6], [9, 0, 6], [8, 9, 5], [3, 4, 5],
                    [7, 0, 5], [0, 9, 5], [4, 0, 5], [1, 9, 5], [9, 3, 5],
                    [3, 7, 5], [6, 9, 5], [8, 1, 4], [5, 8, 4], [7, 5, 4],
                    [5, 4, 4], [0, 5, 4], [6, 8, 4], [4, 3, 4], [6, 1, 4],
                    [9, 6, 4], [9, 4, 3], [6, 4, 3], [3, 3, 3], [4, 5, 3],
                    [6, 0, 3], [8, 4, 3], [6, 3, 3], [5, 6, 3], [4, 9, 3],
                    [9, 5, 3], [3, 8, 3], [3, 9, 3], [9, 1, 3], [7, 8, 3],
                    [4, 7, 3], [5, 0, 2], [7, 3, 2], [0, 6, 1], [5, 7, 1],
                    [7, 7, 1], [5, 5, 1], [7, 6, 1], [8, 7, 1], [9, 7, 1],
                    [6, 7, 1], [8, 5, 1],
                  ];
                  const maxE = 98;
                  return (
                    <>
                      {edges.map(([fi, ti, count], ei) => {
                        if (fi === ti) {
                          const angle = (fi / 10) * Math.PI * 2 - Math.PI / 2;
                          const loopR = 14;
                          const ox = cx + (r + loopR + 12) * Math.cos(angle);
                          const oy = cy + (r + loopR + 12) * Math.sin(angle);
                          return (
                            <circle
                              key={ei}
                              cx={ox} cy={oy} r={loopR}
                              fill="none"
                              stroke="rgba(52,211,153,1)"
                              strokeWidth={0.5 + 2.5 * (count / maxE)}
                              opacity={0.08 + 0.6 * (count / maxE)}
                            />
                          );
                        }
                        const p1 = positions[fi], p2 = positions[ti];
                        const dx = p2.x - p1.x, dy = p2.y - p1.y;
                        const len = Math.sqrt(dx * dx + dy * dy);
                        const nx = -dy / len, ny = dx / len;
                        const nr = 12 + (visits[ti] / maxV) * 12;
                        const ratio = Math.max(0, (len - nr - 6) / len);
                        return (
                          <line
                            key={ei}
                            x1={p1.x + 3 * nx} y1={p1.y + 3 * ny}
                            x2={p1.x + dx * ratio + 3 * nx} y2={p1.y + dy * ratio + 3 * ny}
                            stroke="rgba(52,211,153,1)"
                            strokeWidth={0.5 + 2.5 * (count / maxE)}
                            opacity={0.08 + 0.6 * (count / maxE)}
                            strokeLinecap="round"
                          />
                        );
                      })}
                      {fns.map((fn, i) => {
                        const p = positions[i];
                        const nr = 12 + (visits[i] / maxV) * 12;
                        return (
                          <g key={i}>
                            <circle cx={p.x} cy={p.y} r={nr} fill={fnColors[fn]} opacity={0.85} />
                            <text x={p.x} y={p.y + 1} fill="#fff" fontSize="8" fontWeight="600" textAnchor="middle" dominantBaseline="middle">{fn}</text>
                            <text x={p.x} y={p.y + nr + 12} fill="#9ca3af" fontSize="8" textAnchor="middle">{visits[i]}x</text>
                          </g>
                        );
                      })}
                    </>
                  );
                })()}
              </svg>
              <p className="text-[10px] text-white/30 text-center">
                Harry Potter and the Sorcerer&apos;s Stone — beat chain.
                1,254 beats, 1,163 transitions, 92 unique edges.
                <br />
                Node size = beat frequency. Edge thickness = transition count.
              </p>
            </div>

            <P>
              The beat chain reveals <em>advance</em> as the dominant hub
              (329 beats, 26%) — momentum is the connective tissue of
              Rowling&apos;s prose. The strongest single transition is{" "}
              <em>inform &rarr; advance</em> (98 occurrences): knowledge
              delivery triggers immediate action. <em>Breathe</em> feeds almost
              exclusively into <em>inform</em> (82x) and <em>advance</em> (56x) —
              atmospheric grounding exists only to launch the next movement. The
              advance&rarr;advance self-loop (58x) captures sustained momentum
              sequences where action chains without pause. Every one of the 100
              possible beat&rarr;beat pairs appears at least once — the matrix
              is dense, reflecting Rowling&apos;s structural variety.
            </P>

            <P>
              The pattern shifts markedly across works.{" "}
              <em>Nineteen Eighty-Four</em> (1,023 beats across 75 scenes) gives
              reveal unusual prominence — 112 beats (11%), nearly double its
              share in Harry Potter. Orwell&apos;s mechanism distribution is the
              most balanced of any work analysed: thought (21%), dialogue (24%),
              action (21%), reflecting a mind trapped between inner world and
              outer surveillance. <em>The Great Gatsby</em> (648 beats, 44 scenes)
              leans heavily on dialogue (39%) and reveals character through
              narration (17%) — Fitzgerald&apos;s observer-narrator reporting
              what he sees. <em>Alice&apos;s Adventures in Wonderland</em> is
              advance-dominant (33%) with minimal bonding (4%) — a protagonist
              propelled through episodes without deepening relationships.
            </P>

            <P>
              Alongside the transition matrix, the analysis extracts a{" "}
              <strong>mechanism distribution</strong> — how beats are delivered.
              Harry Potter is dialogue-heavy (42% dialogue, 29% action, 16%
              environment, 6% thought, 5% narration), reflecting its
              conversation-driven pedagogy where characters explain magic by
              arguing, teasing, and showing off.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">
              Prose Profiles
            </h3>
            <P>
              The beat chain and mechanism distribution, combined with voice
              parameters (register, stance, tense, rhetorical devices, show-don&apos;t-tell
              rules), form a complete <strong>prose profile</strong> — a
              statistical fingerprint of how an author writes at the paragraph
              level. During generation, the engine can sample beat sequences from
              any work&apos;s Markov chain: a story using Harry Potter&apos;s
              profile will open scenes with grounding beats that launch into
              dialogue-driven information, while one using Orwell&apos;s will
              sustain introspective thought before sudden reveals.
            </P>
            <P>
              This separates <em>what happens</em> (scene mutations) from{" "}
              <em>how intensely</em> (pacing chain) from{" "}
              <em>how it reads</em> (beat chain). Three independent Markov
              processes, each derived from empirical analysis, each controlling a
              different layer of the output.
            </P>
          </Section>

          {/* ── MCTS ──────────────────────────────────────────────────── */}
          <Section id="mcts" label="MCTS">
            <P>
              Monte Carlo Tree Search adapts the game-playing algorithm to
              narrative space. Nodes are narrative states — the full knowledge
              graph after a sequence of scenes. Edges are generated arcs. The
              evaluation function is the force grading system described above.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">
              How It Works
            </h3>
            <P>
              <strong>Selection</strong>: Starting from the current narrative
              state, UCB1 selects which node to expand, balancing exploitation
              (high-scoring paths) against exploration (under-visited branches).
            </P>
            <Eq
              tex={String.raw`\text{UCB1}(n) = \frac{Q(n)}{N(n)} + C \sqrt{\frac{\ln N(\text{parent})}{N(n)}}`}
            />
            <P>
              <strong>Expansion</strong>: The selected node generates a new arc
              via the LLM. A <B>Markov chain pacing sequence</B> is sampled
              fresh for each expansion and injected as a direction — telling the
              LLM which cube modes (Rest, Growth, Climax, etc.) to target scene
              by scene. This ensures every branch explores a different force
              trajectory — the narrative seed provides creative diversity, the
              Markov-generated direction provides structural diversity.
            </P>
            <P>
              <strong>Evaluation</strong>: The generated arc is scored using the
              same force grading system applied to published literature. An arc
              scoring 85 has comparable structural density to the reference
              works.
            </P>
            <P>
              <strong>Backpropagation</strong>: The score propagates up the
              tree. Paths that consistently produce high-scoring arcs accumulate
              visit counts and become more likely to be selected for further
              expansion.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">
              Markov-Augmented Search
            </h3>
            <P>
              Combining Markov chains with MCTS produces a search that is both
              structurally informed and creatively diverse. Each expansion
              samples a fresh pacing sequence from the rhythm profile&apos;s
              transition matrix and passes it to the LLM as a per-scene
              direction. Sibling nodes receive different sequences — one might
              get{" "}
              <span className="font-mono text-white/50">
                Rest &rarr; Growth &rarr; Epoch
              </span>{" "}
              while another gets{" "}
              <span className="font-mono text-white/50">
                Lore &rarr; Lore &rarr; Climax &rarr; Closure
              </span>{" "}
              — so they explore structurally different trajectories even from
              the same narrative state.
            </P>
            <P>
              The rhythm profile acts as a structural prior, biasing the search
              toward transitions observed in published works without
              constraining the creative content. The LLM decides <em>what</em>{" "}
              happens; the Markov chain shapes <em>how much</em>.
            </P>
            <P>
              After search completes, the best path is selected by highest
              average score or most-visited path. The user can inspect every
              branch, see the cube position sequence for each arc, and commit
              the chosen path to the story.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">
              Search Modes
            </h3>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              {[
                {
                  name: "Freedom",
                  desc: "Dynamic UCB1 allocation. Promising nodes earn more children; dead ends are abandoned early.",
                },
                {
                  name: "Constrained",
                  desc: "Complete tree. Every node at each depth gets a fixed number of children before going deeper.",
                },
                {
                  name: "Baseline",
                  desc: "Unlimited children per node. Keep generating until a target score is met, then descend.",
                },
                {
                  name: "Greedy",
                  desc: "Depth-first. Generate children at the frontier, pick the best, descend immediately.",
                },
              ].map(({ name, desc }) => (
                <div
                  key={name}
                  className="flex flex-col gap-1 px-3 py-2.5 rounded-lg border border-white/6 bg-white/2"
                >
                  <span className="font-medium text-white/70">{name}</span>
                  <p className="text-white/35">{desc}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Planning ──────────────────────────────────────────────── */}
          <Section id="planning" label="Planning">
            <P>
              MCTS finds the best next arc. But a novel is dozens of arcs over
              hundreds of scenes. Steering at that scale requires{" "}
              <B>planning with course correction</B> — a system that sets
              direction, then rewrites that direction as the story evolves.
            </P>
            <P>
              A story is divided into <B>phases</B> — structural chapters with
              objectives and scene allocations. When a phase activates, the
              system generates two vectors: a <B>direction vector</B> (which
              threads to push, what the reader should feel) and a{" "}
              <B>constraint vector</B> (what must <em>not</em> happen yet). Both
              are injected into scene generation. After every arc, a{" "}
              <B>course correction</B> pass analyses thread tension, character
              cost, rhythm, freshness, and momentum — then{" "}
              <em>rewrites the vectors in place</em>. The next arc generates
              under guidance that reflects what actually happened, not what was
              originally planned.
            </P>

            {/* ── Course correction diagram ────────────────────────── */}
            {(() => {
              const W = 600,
                H = 220;
              const PAD = { left: 50, right: 50, top: 50, bottom: 35 };
              const plotW = W - PAD.left - PAD.right;
              const plotH = H - PAD.top - PAD.bottom;

              // Overarching plan — smooth ascending trajectory
              const planPoints = [0, 0.15, 0.32, 0.5, 0.7, 0.88, 1.0];
              const actualDrift = [0, -0.12, 0.18, -0.08, 0.15, -0.05, 0.02];

              const arcs = planPoints.length;

              return (
                <div className="mt-6 mb-3 rounded-xl border border-white/8 bg-linear-to-b from-white/2 to-white/4 px-5 py-4 overflow-x-auto shadow-lg">
                  <svg
                    width={W}
                    height={H}
                    className="mx-auto block min-w-[500px]"
                    viewBox={`0 0 ${W} ${H}`}
                  >
                    <defs>
                      {/* Gradients for elegant colors */}
                      <linearGradient
                        id="planGrad"
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="0%"
                      >
                        <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#818cf8" stopOpacity="0.5" />
                      </linearGradient>
                      <linearGradient
                        id="actualGrad"
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="0%"
                      >
                        <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.7" />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.8" />
                      </linearGradient>

                      {/* Glows for nodes */}
                      <radialGradient id="planNodeGlow">
                        <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.6" />
                        <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
                      </radialGradient>
                      <radialGradient id="actualNodeGlow">
                        <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.8" />
                        <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
                      </radialGradient>

                      {/* Arrow markers with gradients */}
                      <marker
                        id="arrowhead-direction"
                        markerWidth="7"
                        markerHeight="7"
                        refX="6"
                        refY="3.5"
                        orient="auto"
                      >
                        <polygon
                          points="0,0 0,7 7,3.5"
                          fill="#10b981"
                        />
                      </marker>
                      <marker
                        id="arrowhead-constraint"
                        markerWidth="7"
                        markerHeight="7"
                        refX="6"
                        refY="3.5"
                        orient="auto"
                      >
                        <polygon
                          points="0,0 0,7 7,3.5"
                          fill="#f43f5e"
                        />
                      </marker>
                    </defs>

                    {/* Overarching plan — ideal trajectory */}
                    <path
                      d={`M ${PAD.left} ${PAD.top + plotH} ${planPoints.map((p, i) => `L ${PAD.left + (i / (arcs - 1)) * plotW} ${PAD.top + plotH - p * plotH}`).join(" ")}`}
                      stroke="url(#planGrad)"
                      strokeWidth="2.5"
                      strokeDasharray="6 4"
                      fill="none"
                      strokeLinecap="round"
                      opacity="0.6"
                    />

                    {/* Actual trajectory with drift - smooth curve */}
                    {(() => {
                      const points = planPoints.map((p, i) => ({
                        x: PAD.left + (i / (arcs - 1)) * plotW,
                        y: PAD.top + plotH - p * plotH + actualDrift[i] * plotH,
                      }));

                      // Create smooth curve using cubic bezier
                      let pathD = `M ${points[0].x} ${points[0].y}`;
                      for (let i = 0; i < points.length - 1; i++) {
                        const curr = points[i];
                        const next = points[i + 1];
                        const cp1x = curr.x + (next.x - curr.x) * 0.5;
                        const cp1y = curr.y;
                        const cp2x = curr.x + (next.x - curr.x) * 0.5;
                        const cp2y = next.y;
                        pathD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`;
                      }

                      return (
                        <path
                          d={pathD}
                          stroke="url(#actualGrad)"
                          strokeWidth="3.5"
                          fill="none"
                          strokeLinecap="round"
                        />
                      );
                    })()}

                    {/* Arc nodes and correction vectors */}
                    {planPoints.slice(0, -1).map((p, i) => {
                      const x = PAD.left + (i / (arcs - 1)) * plotW;
                      const yPlan = PAD.top + plotH - p * plotH;
                      const yActual =
                        PAD.top + plotH - p * plotH + actualDrift[i] * plotH;

                      // Current drift from plan determines correction vectors
                      const currentDrift = actualDrift[i];
                      const driftCorrection = -currentDrift; // Opposite of drift

                      // Direction vector (green) — points strongly toward plan correction
                      // Emphasizes vertical correction (getting back to plan height)
                      const dirVecLen = 35 + Math.abs(driftCorrection) * 50;
                      const dirAngleRad = Math.atan2(driftCorrection * plotH * 2.0, plotW * 0.25);
                      const dirX = x + dirVecLen * Math.cos(dirAngleRad);
                      const dirY = yActual + dirVecLen * Math.sin(dirAngleRad);

                      // Constraint vector (red) — points away from bad directions
                      // Emphasizes horizontal avoidance (perpendicular to direction)
                      const constVecLen = 30 + Math.abs(driftCorrection) * 35;
                      const constAngleRad = Math.atan2(-driftCorrection * plotH * 0.5, plotW * 0.6);
                      const constX = x + constVecLen * Math.cos(constAngleRad);
                      const constY = yActual + constVecLen * Math.sin(constAngleRad);

                      return (
                        <g key={i}>
                          {/* Plan node glow */}
                          <circle
                            cx={x}
                            cy={yPlan}
                            r={8}
                            fill="url(#planNodeGlow)"
                          />
                          {/* Plan node */}
                          <circle
                            cx={x}
                            cy={yPlan}
                            r={3}
                            fill="#60a5fa"
                            opacity="0.8"
                          />

                          {/* Actual position node glow */}
                          <circle
                            cx={x}
                            cy={yActual}
                            r={10}
                            fill="url(#actualNodeGlow)"
                          />
                          {/* Actual position node */}
                          <circle
                            cx={x}
                            cy={yActual}
                            r={4}
                            fill="#fbbf24"
                            stroke="rgba(255,255,255,0.3)"
                            strokeWidth="1.5"
                          />

                          {/* Direction vector (positive prompt) */}
                          <line
                            x1={x}
                            y1={yActual}
                            x2={dirX}
                            y2={dirY}
                            stroke="#10b981"
                            strokeWidth="2"
                            markerEnd="url(#arrowhead-direction)"
                            opacity="0.75"
                          />

                          {/* Constraint vector (negative prompt) */}
                          <line
                            x1={x}
                            y1={yActual}
                            x2={constX}
                            y2={constY}
                            stroke="#f43f5e"
                            strokeWidth="2"
                            markerEnd="url(#arrowhead-constraint)"
                            opacity="0.75"
                          />

                          {/* Arc label */}
                          <text
                            x={x}
                            y={H - PAD.bottom + 18}
                            textAnchor="middle"
                            fill="rgba(255,255,255,0.4)"
                            fontSize="9"
                            fontFamily="system-ui"
                            fontWeight="500"
                          >
                            Arc {i + 1}
                          </text>
                        </g>
                      );
                    })}

                    {/* Final node */}
                    {(() => {
                      const i = arcs - 1;
                      const x = PAD.left + plotW;
                      const yPlan = PAD.top + plotH - planPoints[i] * plotH;
                      const yActual =
                        PAD.top +
                        plotH -
                        planPoints[i] * plotH +
                        actualDrift[i] * plotH;
                      return (
                        <>
                          <circle cx={x} cy={yPlan} r={8} fill="url(#planNodeGlow)" />
                          <circle cx={x} cy={yPlan} r={3} fill="#60a5fa" opacity="0.8" />
                          <circle cx={x} cy={yActual} r={10} fill="url(#actualNodeGlow)" />
                          <circle
                            cx={x}
                            cy={yActual}
                            r={4}
                            fill="#fbbf24"
                            stroke="rgba(255,255,255,0.3)"
                            strokeWidth="1.5"
                          />
                          <text
                            x={x}
                            y={H - PAD.bottom + 18}
                            textAnchor="middle"
                            fill="rgba(255,255,255,0.4)"
                            fontSize="9"
                            fontFamily="system-ui"
                            fontWeight="500"
                          >
                            Arc {i + 1}
                          </text>
                        </>
                      );
                    })()}

                    {/* Legend with enhanced visibility */}
                    <g>
                      {/* Overarching plan sample - dashed line with icon */}
                      <path
                        d={`M ${PAD.left} 22 L ${PAD.left + 45} 22`}
                        stroke="#60a5fa"
                        strokeWidth="2.5"
                        strokeDasharray="5 3"
                        strokeLinecap="round"
                        opacity="0.7"
                      />
                      <text
                        x={PAD.left + 51}
                        y={25}
                        fill="rgba(255,255,255,0.6)"
                        fontSize="9"
                        fontFamily="system-ui"
                      >
                        Overarching plan
                      </text>

                      {/* Actual trajectory sample - solid curved line */}
                      <path
                        d={`M ${PAD.left + 158} 22 Q ${PAD.left + 166} 18, ${PAD.left + 174} 22 Q ${PAD.left + 182} 26, ${PAD.left + 190} 22`}
                        stroke="url(#actualGrad)"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        fill="none"
                      />
                      <text
                        x={PAD.left + 196}
                        y={25}
                        fill="rgba(255,255,255,0.6)"
                        fontSize="9"
                        fontFamily="system-ui"
                      >
                        Actual trajectory
                      </text>

                      {/* Direction vector sample */}
                      <line
                        x1={PAD.left + 290}
                        y1={22}
                        x2={PAD.left + 310}
                        y2={22}
                        stroke="#10b981"
                        strokeWidth="2"
                        markerEnd="url(#arrowhead-direction)"
                        opacity="0.85"
                      />
                      <text
                        x={PAD.left + 318}
                        y={25}
                        fill="rgba(255,255,255,0.6)"
                        fontSize="9"
                        fontFamily="system-ui"
                      >
                        Direction vector
                      </text>

                      {/* Constraint vector sample */}
                      <line
                        x1={PAD.left + 418}
                        y1={22}
                        x2={PAD.left + 438}
                        y2={22}
                        stroke="#f43f5e"
                        strokeWidth="2"
                        markerEnd="url(#arrowhead-constraint)"
                        opacity="0.85"
                      />
                      <text
                        x={PAD.left + 446}
                        y={25}
                        fill="rgba(255,255,255,0.6)"
                        fontSize="9"
                        fontFamily="system-ui"
                      >
                        Constraint vector
                      </text>
                    </g>
                  </svg>
                </div>
              );
            })()}

            <P>
              At phase boundaries, a <B>world expansion</B> pipeline introduces
              new characters, locations, and threads — each woven into the
              existing knowledge graph and seeded with knowledge asymmetries
              that drive future conflict. Fresh direction and constraint vectors
              are then generated accounting for entities that didn&apos;t exist
              a moment ago. The <B>phase layer</B> provides long-range
              structure; the <B>direction layer</B> provides short-range
              steering that evolves continuously.
            </P>
          </Section>

          {/* ── Revision ──────────────────────────────────────────── */}
          <Section id="revision" label="Revision">
            <P>
              First drafts are rough. Scenes repeat beats, characters stagnate,
              threads drift. The revision pipeline improves a branch
              systematically without starting over, using the same git-like
              branching that underlies generation.
            </P>
            <P>
              <B>Evaluation</B> reads scene summaries and assigns per-scene
              verdicts. <B>Reconstruction</B> creates a new versioned branch,
              applying verdicts in parallel — edits revise content, merges
              combine scenes, inserts generate new scenes to fill gaps,
              moves reposition scenes without any LLM call,
              cuts are omitted. World
              commits pass through at their original positions. The original
              branch is never modified.
            </P>

            <div className="mt-4 space-y-1.5 text-[12px]">
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-emerald-400 font-mono w-14 shrink-0">
                  ok
                </span>
                <span className="text-white/50">
                  Structurally sound, continuity intact. Kept as-is.
                </span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-amber-400 font-mono w-14 shrink-0">
                  edit
                </span>
                <span className="text-white/50">
                  Revise content — may change POV, location, participants, mutations, and summary.
                </span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-blue-400 font-mono w-14 shrink-0">
                  merge
                </span>
                <span className="text-white/50">
                  Absorbed into another scene. Both scenes&apos; best elements combined into one denser beat.
                </span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-cyan-400 font-mono w-14 shrink-0">
                  insert
                </span>
                <span className="text-white/50">
                  New scene generated to fill a pacing gap, missing transition, or stalled thread.
                </span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-white/30 font-mono w-14 shrink-0">
                  cut
                </span>
                <span className="text-white/50">
                  Redundant. Removed — the narrative is tighter without it.
                </span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-blue-400 font-mono w-14 shrink-0">
                  move
                </span>
                <span className="text-white/50">
                  Content correct but wrong position. Repositioned after a target scene using <code className="text-blue-300/70">moveAfter</code>. No LLM call — prose preserved exactly.
                </span>
              </div>
            </div>

            <P>
              Evaluations can be <B>guided</B> with external feedback — from
              another AI, a human editor, or the author&apos;s own notes —
              layered on top of the system&apos;s structural analysis. Each
              reconstruction produces a versioned branch (<em>v2</em>,{" "}
              <em>v3</em>, <em>v4</em>), enabling direct comparison and
              rollback. The loop converges: each pass reduces non-ok scenes
              until the evaluator returns all-ok. A 50-scene branch typically
              stabilises in 2&ndash;3 passes.
            </P>
          </Section>

          {/* ── Classification ──────────────────────────────────────── */}
          <Section id="classification" label="Classification">
            <h3 className="text-[15px] font-semibold text-white/80 mb-3">
              Archetypes
            </h3>
            <P>
              Each story is classified by which forces dominate its profile. A
              force is considered &ldquo;dominant&rdquo; if it scores &ge; 21
              and falls within 5 points of the maximum.
            </P>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              {ARCHETYPES.map(({ key, name, desc, color }) => (
                <div
                  key={key}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-white/6 bg-white/2"
                >
                  <ArchetypeIcon archetypeKey={key} size={16} color={color} />
                  <div>
                    <span className="font-medium" style={{ color }}>
                      {name}
                    </span>
                    <p className="text-white/35 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">
              Narrative Shapes
            </h3>
            <P>
              Beyond archetypes, the Gaussian-smoothed delivery curve is
              classified into one of six shapes using overall slope, peak count,
              peak dominance, peak position, trough depth, and recovery
              strength.
            </P>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px]">
              {SHAPES.map(({ name, desc, curve }) => (
                <div
                  key={name}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-white/6 bg-white/2"
                >
                  <ShapeCurve curve={curve} color="#fb923c" />
                  <div>
                    <span className="font-medium text-white/70">{name}</span>
                    <p className="text-white/35 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 className="text-sm font-semibold text-white/60 mt-6 mb-1">Scale</h3>
            <P>
              Scale classifies a narrative by its structural length — the number
              of scenes across all arcs. Thresholds are calibrated from analysed
              works: Romeo &amp; Juliet (24 scenes, Story), Harry Potter volumes
              (89–110, Novel), and Reverend Insanity (133+, Epic).
            </P>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-5 gap-2 text-[11px]">
              {SCALE_TIERS.map(({ key, name, desc, color }, i) => (
                <div
                  key={key}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-white/6 bg-white/2"
                >
                  <svg width="16" height="16" viewBox="0 0 18 18" className="shrink-0">
                    {[0, 1, 2, 3, 4].map((j) => (
                      <rect key={j} x={2 + j * 3} y={14 - (j + 1) * 2.4} width={2} height={(j + 1) * 2.4} rx={0.5} fill={j <= i ? color : '#ffffff10'} />
                    ))}
                  </svg>
                  <div>
                    <span className="font-medium" style={{ color }}>{name}</span>
                    <p className="text-white/35 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 className="text-sm font-semibold text-white/60 mt-6 mb-1">World Density</h3>
            <P>
              World density measures the richness of the narrative world relative
              to its length: (characters + locations + threads + world knowledge
              nodes) / scenes. A 24-scene story with 77 entities (3.2/scene) is
              denser than a 100-scene story with 173 entities (1.7/scene).
            </P>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-5 gap-2 text-[11px]">
              {DENSITY_TIERS.map(({ key, name, desc, color }, i) => (
                <div
                  key={key}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-white/6 bg-white/2"
                >
                  <svg width="16" height="16" viewBox="0 0 18 18" className="shrink-0">
                    {[0, 1, 2, 3, 4].map((j) => (
                      <circle key={j} cx={9} cy={9} r={2 + j * 1.8} fill="none" stroke={j <= i ? color : '#ffffff10'} strokeWidth={1} />
                    ))}
                  </svg>
                  <div>
                    <span className="font-medium" style={{ color }}>{name}</span>
                    <p className="text-white/35 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Economics ──────────────────────────────────────────────── */}
          <Section id="economics" label="Economics">
            <P>
              A short story costs under a dollar; a full novel under seven;
              an open-ended serial under forty. The pipeline splits across
              two model tiers: <B>Gemini 2.5 Flash</B> (<B>$0.30/M input</B>,{" "}
              <B>$2.50/M output</B>) handles structure generation, analysis,
              and evaluation, while <B>Gemini 3 Flash</B> (<B>$0.50/M input</B>,{" "}
              <B>$3.00/M output</B>) handles beat plans and prose — the
              tasks where prose quality matters most. Input tokens dominate
              because every call sends the full narrative context, but
              context is capped by the branch time horizon (~50 scenes),
              so cost per arc is constant — arc 10 costs the same as
              arc 100. Reasoning is configurable per story from none
              (analysis) through low (~2K tokens/call, default) to
              high (~24K).
            </P>

            <CostEstimates />

            <P>
              Analysing an existing 100K-word novel into a full narrative
              state costs under twenty-five cents — parallel chunk extraction
              with no reasoning. A 500K-word series runs about a dollar.
              Evaluating a branch (structure + prose quality) costs five
              cents. This makes the full generate-evaluate-revise loop
              economical at any scale.
            </P>

            <P>
              A human ghostwriter charges $10,000–$50,000 for a novel. A
              developmental editor charges $2,000–$5,000 for structural
              feedback. InkTide generates the structure, evaluates it against
              force targets, course-corrects after every arc, and produces
              full prose — for under seven dollars at novel scale with low reasoning. The
              economics make iterative experimentation practical: generate,
              evaluate, discard, try again.
            </P>
          </Section>

          {/* ── Open Source ───────────────────────────────────────────── */}
          <Section id="open-source" label="Open Source">
            <P>
              InkTide is fully open source. Every formula in this paper lives in
              the codebase — you can read it, run it, and change it.
            </P>
            <P>
              This is deliberate. Narrative analysis should be transparent. If
              you disagree with how we weight payoff against knowledge, change
              the constant. If your genre needs a fourth force, add it. The
              formulas are tools, not doctrine.
            </P>
            <P>
              We&apos;d especially love to see the community experiment with
              their own texts. Paste any corpus into the{" "}
              <Link
                href="/analysis"
                className="text-white/60 underline underline-offset-2 hover:text-white/80 transition-colors"
              >
                analysis pipeline
              </Link>{" "}
              — novels, screenplays, web serials, fanfiction — and see where the
              peaks land, what archetype emerges, and whether the force
              landscape matches your intuition. When it doesn&apos;t,
              that&apos;s the interesting part. Pull requests welcome.
            </P>

            <div className="mt-8 flex flex-col sm:flex-row flex-wrap gap-3">
              <Link
                href="/case-analysis"
                className="text-[11px] px-4 py-2 rounded-full border border-amber-500/30 bg-amber-500/5 text-amber-400/80 hover:text-amber-300 hover:border-amber-500/50 hover:bg-amber-500/10 transition-colors text-center"
              >
                See it in action: Harry Potter case analysis &rarr;
              </Link>
              <a
                href="https://github.com/jasonyu0100/inktide"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] px-4 py-2 rounded-full border border-white/15 bg-white/3 text-white/50 hover:text-white/70 hover:border-white/25 hover:bg-white/5 transition-colors text-center"
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
