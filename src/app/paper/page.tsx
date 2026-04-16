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
// GENERATION (per arc, ~4 scenes, ~4800 words):
//   generateScenes      1× 2.5F  40K in + 4K out + 2K rsn  = $0.03
//   generateScenePlan   4× 2.5F  28K in + 0.5K out + 2K rsn = $0.06
//   generateSceneProse  4× 3F    35K in + 4K out + 2K rsn   = $0.15
//   refreshDirection    1× 2.5F  32K in + 0.3K out + 2K rsn = $0.02
//   expandWorld         1× 2.5F  25K in + 0.6K out + 1K rsn = $0.01
//   phaseCompletionRpt  1× 2.5F  25K in + 0.3K out + 1K rsn = $0.01
//   generatePhaseDir    1× 2.5F  28K in + 0.5K out + 1K rsn = $0.01
//                                                    Total  = $0.29/arc
//
// EVALUATION & REVISION (per arc, ~4 scenes, 25% edit rate):
//   evaluateBranch        1× 2.5F  12K in + 2K out + 2K rsn         = $0.01
//   editScene            ~1× 2.5F  30K in + 0.5K out + 1K rsn       = $0.01
//   evaluateProseQuality  1× 2.5F  10K in + 0.5K out + 1K rsn       = $0.01  (edit verdicts + critique)
//   rewriteSceneProse    ~1× 3F    35K in + 4K out + 2K rsn          = $0.03
//                                                    Total  ≈ $0.06/arc
// (rewriteSceneProse in StoryReader is spot-fix only — not in this estimate)
//
// ANALYSIS (per corpus, scene-first pipeline, no reasoning):
//   reverseEngineerScenePlan  N× 2.5F  ~5K in + 1K out × N scenes = ~$0.005/scene
//   extractSceneStructure    N× 2.5F  ~6K in + 2K out × N scenes = ~$0.008/scene
//   embeddings (OpenAI)      N× ada   summaries + propositions + prose = ~$0.003/scene
//   groupScenesIntoArcs      1× 2.5F  2K in + 0.5K out = ~$0.002 (once)
//   reconcileResults         1× 2.5F  8K in + 2K out = ~$0.008 (once)
//   analyzeThreading         1× 2.5F  3K in + 0.5K out = ~$0.003 (once)
//   assembleNarrative        1× 2.5F  35K in + 3K out = ~$0.025 (once)
//   Per scene: ~$0.016 (plan + structure + embeddings)
//   77K novel (~64 scenes, e.g. HP):  64×$0.016 + $0.038 = ~$1.06
//   100K novel (~83 scenes):  83×$0.016 + $0.038 = ~$1.37
//   500K series (~416 scenes): 416×$0.016 + $0.038 = ~$6.70

type BreakdownRow = {
  call: string;
  count: string;
  model: "2.5 Flash" | "3 Flash";
  note: string;
  cost: string;
};
type BreakdownCategory = {
  label: string;
  unit: string;
  rows: BreakdownRow[];
  subtotal: { calls: string; cost: string } | null;
};

const BREAKDOWN_CATEGORIES: BreakdownCategory[] = [
  {
    label: "Generation",
    unit: "per arc  ·  ~4 scenes  ·  ~4800 words",
    rows: [
      {
        call: "generateScenes",
        count: "×1",
        model: "2.5 Flash",
        note: "Scene structures & deltas",
        cost: "$0.03",
      },
      {
        call: "generateScenePlan",
        count: "×4",
        model: "2.5 Flash",
        note: "Beat plan per scene (~12 beats)",
        cost: "$0.06",
      },
      {
        call: "generateSceneProse",
        count: "×4",
        model: "3 Flash",
        note: "~1.2K words of prose per scene",
        cost: "$0.15",
      },
      {
        call: "refreshDirection",
        count: "×1",
        model: "2.5 Flash",
        note: "Arc direction & constraints",
        cost: "$0.02",
      },
      {
        call: "expandWorld",
        count: "×1",
        model: "2.5 Flash",
        note: "New characters, locations & threads",
        cost: "$0.01",
      },
      {
        call: "phaseCompletionReport",
        count: "×1",
        model: "2.5 Flash",
        note: "Phase retrospective",
        cost: "$0.01",
      },
      {
        call: "generatePhaseDirection",
        count: "×1",
        model: "2.5 Flash",
        note: "Next phase objectives & constraints",
        cost: "$0.01",
      },
    ],
    subtotal: { calls: "13 calls", cost: "$0.29" },
  },
  {
    label: "Evaluation & Revision",
    unit: "per arc  ·  ~4 scenes  ·  25% edit rate",
    rows: [
      {
        call: "evaluateBranch",
        count: "×1",
        model: "2.5 Flash",
        note: "Structure verdicts + thematic critique",
        cost: "$0.01",
      },
      {
        call: "editScene",
        count: "×~1",
        model: "2.5 Flash",
        note: "Scene structure edit (summary + deltas)",
        cost: "$0.01",
      },
      {
        call: "evaluateProseQuality",
        count: "×1",
        model: "2.5 Flash",
        note: "Prose quality edit verdicts + critique",
        cost: "$0.01",
      },
      {
        call: "rewriteSceneProse",
        count: "×~1",
        model: "3 Flash",
        note: "~1K words rewritten (25% rate)",
        cost: "$0.03",
      },
    ],
    subtotal: { calls: "~4 calls", cost: "~$0.06" },
  },
  {
    label: "Analysis",
    unit: "per corpus  ·  scene-first pipeline  ·  ~$0.016/scene",
    rows: [
      {
        call: "reverseEngineerScenePlan",
        count: "×N",
        model: "2.5 Flash",
        note: "Beat plan + propositions per scene",
        cost: "~$0.005/scene",
      },
      {
        call: "extractSceneStructure",
        count: "×N",
        model: "2.5 Flash",
        note: "Entities & deltas from prose + plan",
        cost: "~$0.008/scene",
      },
      {
        call: "embeddings",
        count: "×N",
        model: "2.5 Flash",
        note: "Summaries, propositions, prose (OpenAI)",
        cost: "~$0.003/scene",
      },
      {
        call: "groupScenesIntoArcs",
        count: "×1",
        model: "2.5 Flash",
        note: "Name arcs from scene summaries",
        cost: "~$0.002",
      },
      {
        call: "reconcileResults",
        count: "×1",
        model: "2.5 Flash",
        note: "Entity deduplication across scenes",
        cost: "~$0.008",
      },
      {
        call: "analyzeThreading",
        count: "×1",
        model: "2.5 Flash",
        note: "Thread dependency analysis",
        cost: "~$0.003",
      },
      {
        call: "assembleNarrative",
        count: "×1",
        model: "2.5 Flash",
        note: "Rules, world systems, prose profile",
        cost: "~$0.025",
      },
    ],
    subtotal: { calls: "3N + 3", cost: "~$1.06 for HP (64 scenes)" },
  },
];

function ModelPill({ model }: { model: "2.5 Flash" | "3 Flash" }) {
  return (
    <span
      className={`text-[9px] px-1.5 py-0.5 rounded font-mono whitespace-nowrap ${
        model === "3 Flash"
          ? "bg-amber-500/10 text-amber-400/60"
          : "bg-emerald-500/10 text-emerald-400/60"
      }`}
    >
      {model}
    </span>
  );
}

function CostEstimates() {
  const [showBreakdown, setShowBreakdown] = useState(false);
  return (
    <div className="my-5 px-3 sm:px-5 py-4 rounded-lg bg-white/3 border border-white/6">
      <span className="text-[10px] uppercase tracking-wider text-white/20 block mb-3 font-mono">
        End-to-End Estimates · ~5 scenes/arc · ~1K words/scene
      </span>

      {/* Generation estimates */}
      <div className="space-y-2 text-[11px] text-white/45">
        {[
          { scale: "Short story (~10K words)", cost: "~$0.66" },
          { scale: "Novella (~35K words)", cost: "~$2.30" },
          { scale: "Novel (~85K words)", cost: "~$5.60" },
          { scale: "Epic (~200K words)", cost: "~$13.20" },
          { scale: "Serial (~500K words)", cost: "~$33.00" },
        ].map(({ scale, cost }, i) => (
          <div
            key={scale}
            className={`flex justify-between${i > 0 ? " border-t border-white/5 pt-2" : ""}`}
          >
            <span>{scale}</span>
            <span className="font-mono text-white/60">{cost}</span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-white/25 mt-3">
        Structure, planning &amp; analysis:{" "}
        <span className="text-emerald-500/40">Gemini 2.5 Flash</span> ($0.30/M
        in · $2.50/M out+reasoning). Prose only:{" "}
        <span className="text-amber-500/40">Gemini 3 Flash</span> ($0.50/M in ·
        $3.00/M out+reasoning). Generation cost per arc is constant once the
        story exceeds the 50-scene context window.
      </p>

      <button
        onClick={() => setShowBreakdown(!showBreakdown)}
        className="mt-3 flex items-center gap-1.5 text-[10px] text-white/25 hover:text-white/40 transition-colors cursor-pointer"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          className={`transition-transform duration-200 ${showBreakdown ? "rotate-180" : ""}`}
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Per-arc breakdown</span>
      </button>

      {showBreakdown && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-5">
          {BREAKDOWN_CATEGORIES.map((cat) => (
            <div key={cat.label}>
              {/* Category header */}
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="text-[10px] font-mono text-white/50 uppercase tracking-wider">
                  {cat.label}
                </span>
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
                      <td className="py-1.5 font-mono text-white/50 pr-3 truncate">
                        {row.call}
                      </td>
                      <td className="py-1.5 font-mono text-white/25 text-right pr-3">
                        {row.count}
                      </td>
                      <td className="py-1.5 pr-3">
                        <ModelPill model={row.model} />
                      </td>
                      <td className="py-1.5 text-white/30 text-[10px] pr-3">
                        {row.note}
                      </td>
                      <td className="py-1.5 font-mono text-white/55 text-right">
                        {row.cost}
                      </td>
                    </tr>
                  ))}
                  {cat.subtotal && (
                    <tr className="border-t border-white/10">
                      <td
                        className="pt-1.5 text-white/40 font-mono text-[10px]"
                        colSpan={3}
                      >
                        {cat.subtotal.calls}
                      </td>
                      <td />
                      <td className="pt-1.5 font-mono text-white/60 text-right font-semibold">
                        {cat.subtotal.cost}
                      </td>
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
    key: "series" as const,
    name: "Series",
    desc: "Fate + World",
    color: ARCHETYPE_COLORS.series,
  },
  {
    key: "atlas" as const,
    name: "Atlas",
    desc: "Fate + System",
    color: ARCHETYPE_COLORS.atlas,
  },
  {
    key: "chronicle" as const,
    name: "Chronicle",
    desc: "World + System",
    color: ARCHETYPE_COLORS.chronicle,
  },
  {
    key: "classic" as const,
    name: "Classic",
    desc: "Fate-driven",
    color: ARCHETYPE_COLORS.classic,
  },
  {
    key: "stage" as const,
    name: "Stage",
    desc: "World-driven",
    color: ARCHETYPE_COLORS.stage,
  },
  {
    key: "paper" as const,
    name: "Paper",
    desc: "System-driven",
    color: ARCHETYPE_COLORS.paper,
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
  { key: "short", name: "Short", desc: "< 20 scenes", color: "#22D3EE" },
  { key: "story", name: "Story", desc: "20–50 scenes", color: "#22D3EE" },
  { key: "novel", name: "Novel", desc: "50–120 scenes", color: "#22D3EE" },
  { key: "epic", name: "Epic", desc: "120–300 scenes", color: "#22D3EE" },
  { key: "serial", name: "Serial", desc: "300+ scenes", color: "#22D3EE" },
] as const;

const DENSITY_TIERS = [
  {
    key: "sparse",
    name: "Sparse",
    desc: "< 0.5 entities/scene",
    color: "#34D399",
  },
  {
    key: "focused",
    name: "Focused",
    desc: "0.5–1.5 entities/scene",
    color: "#34D399",
  },
  {
    key: "developed",
    name: "Developed",
    desc: "1.5–2.5 entities/scene",
    color: "#34D399",
  },
  {
    key: "rich",
    name: "Rich",
    desc: "2.5–4.0 entities/scene",
    color: "#34D399",
  },
  {
    key: "sprawling",
    name: "Sprawling",
    desc: "4.0+ entities/scene",
    color: "#34D399",
  },
] as const;

/* ── Navigation items ────────────────────────────────────────────────────── */

const NAV = [
  { id: "abstract", label: "Abstract" },
  { id: "problem", label: "The Problem" },
  { id: "approach", label: "Approach" },
  { id: "hierarchy", label: "Hierarchy" },
  { id: "embeddings", label: "Embeddings" },
  { id: "forces", label: "Forces" },
  { id: "validation", label: "Validation" },
  { id: "grading", label: "Grading" },
  { id: "planning", label: "Causal Reasoning" },
  { id: "mcts", label: "MCTS" },
  { id: "prose-profiles", label: "Prose Profiles" },
  { id: "markov", label: "Markov Chains" },
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
            Measuring, querying, and generating structural intelligence from
            long-form text.
          </p>
          <div className="mt-3">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono bg-white/5 border border-white/10 text-white/40">
              ~15 min read
            </span>
          </div>
        </div>

        <div className="space-y-16">
          {/* ── Abstract ──────────────────────────────────────────────── */}
          <Section id="abstract" label="Abstract">
            <P>
              Reading is subjective. Taste is subjective. No formula will ever
              replace that, and this paper doesn&apos;t try to. It asks a
              narrower question: when readers agree that a moment feels earned,
              a chapter drags, or a resolution rings hollow,{" "}
              <em>what structural thing are they responding to?</em> We argue
              the answer is legible, and takes the same shape across fiction,
              non-fiction, and academic writing.
            </P>
            <P>
              We propose modelling any long-form text as a{" "}
              <B>knowledge graph</B> that mutates section by section. From the
              deltas of that graph we derive three forces readers intuitively
              weigh against each other: <B>System</B>, the deepening of rules
              and structures; <B>World</B>, the inner transformation of
              entities; and <B>Fate</B>, the accumulated commitment of threads
              pulling toward resolution. Every work weights them differently —
              thrillers are fate-dominant, character studies world-dominant,
              research papers system-dominant — but every work can be
              described by the mixture. The mixture is what readers react to
              when they call a work satisfying or hollow.
            </P>
            <P>
              The methodology splits along the seam the tools are good at.{" "}
              <B>LLMs extract qualitative meaning</B> at low temperature —
              reading a passage and recording which thread advanced, what an
              entity learned, which rule of the world was revealed.{" "}
              <B>Deterministic formulas extract quantitative impact</B> —
              given the same deltas, the same scores follow, every time. The
              LLM interprets; the math measures.
            </P>
            <P>
              The promise of the approach is a <B>structural spine</B> — a
              sequence of <B>peaks</B> where all three forces converge (the
              scenes the story commits on) and <B>valleys</B> where tension is
              seeded and the story pivots (the turning points that make the
              next peak feel earned). Applied to{" "}
              <em>Harry Potter and the Sorcerer&apos;s Stone</em>, the
              delivery curve recovers this spine automatically — Hagrid
              revealing Harry is a wizard, Diagon Alley, the welcoming feast,
              the troll, Norbert, Quirrell — with valleys at the boa
              constrictor, the arrival at Hogwarts, the Mirror of Erised, the
              descent through the trapdoor. Peaks and valleys are
              complementary, not hierarchical: peaks are where the story
              commits, valleys are where it launches. Together they are what
              the reader feels when a narrative &ldquo;breathes&rdquo; — and
              they fall out of the math, not out of taste.
            </P>
          </Section>

          {/* ── The Problem ───────────────────────────────────────────── */}
          <Section id="problem" label="The Problem">
            <P>
              What makes a resolution feel earned? The difference between a
              twist that lands and one that falls flat is <em>investment</em>
              — something was built up before it paid off. Existing NLP tools
              miss this level: sentiment captures tone, topic models capture
              word distribution, readability gauges surface complexity. None
              measure whether threads are advancing or cycling, whether
              knowledge is deepening, whether entities are developing.
            </P>
            <P>
              When we apply structural formulas to published works versus
              AI-generated text, the gap becomes empirically visible.
              Published literature scores 85–95 on composite delivery;
              unguided AI output scores 65–78. The gap decomposes into
              specific weaknesses — threads that cycle without advancing,
              shallow entity continuity, sparse concept connectivity. In
              short: <em>insufficient investment before resolution</em>.
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
              We model narratives as knowledge graphs that evolve scene by
              scene. An LLM extracts structural deltas; deterministic
              formulas compute forces from those deltas. This separates{" "}
              <em>comprehension</em> (LLM) from <em>measurement</em> (formulas),
              keeping the scoring fully transparent and reproducible.
            </P>
            <P>The three delta layers are:</P>
            <ul className="mt-3 space-y-2 text-[13px] text-white/50 leading-[1.85]">
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">1.</span>
                <span>
                  <B>Thread deltas</B> — lifecycle transitions of narrative
                  tensions (rivalries, secrets, quests) through discrete states:
                  latent &rarr; seeded &rarr; active &rarr; escalating &rarr;
                  critical &rarr; resolved/subverted. Abandoned resets a thread
                  for repickup. Fate is investment-weighted: threads resolving
                  around deeply-developed entities earn more than those with
                  shallow participants.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">2.</span>
                <span>
                  <B>World deltas</B> — permanent character
                  transformations (learns, loses, becomes, realizes) plus
                  relationship valence shifts. These accumulate as persistent
                  state attached to characters.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25 shrink-0">3.</span>
                <span>
                  <B>System graph deltas</B> — additions to the
                  world-building graph: nodes (principles, systems, concepts,
                  tensions, events, structures, environments, conventions,
                  constraints) and typed edges. Depth emerges from connectivity,
                  not lexical volume.
                </span>
              </li>
            </ul>
            <P>Three forces derive directly from these deltas:</P>
            <ul className="space-y-2 text-[13px] text-white/60 leading-relaxed pl-4">
              <li>
                <B>System</B> measures how the world&apos;s rules and structures
                deepen through knowledge graph expansion.
              </li>
              <li>
                <B>World</B> measures entity transformation through continuity
                shifts — what the story does to the people in it.
              </li>
              <li>
                <B>Fate</B> measures thread progression toward resolution — the
                directional force that pulls world and system toward big-picture
                events and extraordinary circumstances.
              </li>
            </ul>
            <P>
              The composition of these three forces defines a work&apos;s
              archetype. A <B>Paper</B> is system-dominant. A <B>Stage</B> is
              world-dominant. A <B>Classic</B> is fate-dominant. An <B>Opus</B>{" "}
              balances all three. All forces are z-score normalized, making them
              comparable across works of arbitrary length.
            </P>
          </Section>

          {/* ── Computational Hierarchy ───────────────────────────────── */}
          <Section id="hierarchy" label="Computational Hierarchy">
            <P>
              Narratives decompose into five nested layers. Structure generation
              (scenes with deltas) runs independently of prose generation
              (beats and propositions), enabling parallel processing and precise
              attribution.
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
                          y1={narrative.y + 34}
                          x2={arc.cx}
                          y2={arc.y}
                          stroke="#a855f7"
                          strokeWidth="1.5"
                          strokeOpacity="0.25"
                        />
                      ))}

                      {/* Connecting lines - arcs to scenes */}
                      {[
                        [0, 0],
                        [0, 1],
                        [0, 2], // arc 0 → scenes 0,1,2
                        [1, 3],
                        [1, 4], // arc 1 → scenes 3,4
                        [2, 5],
                        [2, 6], // arc 2 → scenes 5,6
                      ].map(([arcIdx, sceneIdx], i) => (
                        <line
                          key={`as-${i}`}
                          x1={arcs[arcIdx].cx}
                          y1={arcs[arcIdx].y + 26}
                          x2={scenes[sceneIdx].cx}
                          y2={scenes[sceneIdx].y}
                          stroke="#3b82f6"
                          strokeWidth="1.5"
                          strokeOpacity="0.25"
                        />
                      ))}

                      {/* Connecting lines - scenes to beats */}
                      {[
                        [0, 0],
                        [0, 1], // scene 0 → beats 0-1
                        [2, 2],
                        [2, 3], // scene 2 → beats 2-3
                        [3, 4], // scene 3 → beat 4
                        [5, 5],
                        [5, 6], // scene 5 → beats 5-6
                        [6, 7], // scene 6 → beat 7
                      ].map(([sceneIdx, beatIdx], i) => (
                        <line
                          key={`sb-${i}`}
                          x1={scenes[sceneIdx].cx}
                          y1={scenes[sceneIdx].y + 24}
                          x2={beats[beatIdx].cx}
                          y2={beats[beatIdx].y}
                          stroke="#22d3ee"
                          strokeWidth="1.5"
                          strokeOpacity="0.25"
                        />
                      ))}

                      {/* Connecting lines - beats to propositions */}
                      {[
                        [0, 0],
                        [0, 1], // beat 0 → props 0-1
                        [1, 2],
                        [1, 3], // beat 1 → props 2-3
                        [2, 4],
                        [2, 5], // beat 2 → props 4-5
                        [4, 6],
                        [4, 7], // beat 4 → props 6-7
                        [5, 8],
                        [5, 9], // beat 5 → props 8-9
                        [7, 10],
                        [7, 11], // beat 7 → props 10-11
                      ].map(([beatIdx, propIdx], i) => (
                        <line
                          key={`bp-${i}`}
                          x1={beats[beatIdx].cx}
                          y1={beats[beatIdx].y + 20}
                          x2={props[propIdx].cx}
                          y2={props[propIdx].y}
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
                            {
                              [
                                "breathe",
                                "inform",
                                "advance",
                                "turn",
                                "reveal",
                                "bond",
                                "shift",
                                "expand",
                              ][i]
                            }
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

            <div className="mt-4 space-y-4">
              <P>
                <B>Narrative</B> — The full knowledge graph: all characters,
                locations, threads, relationships, and system knowledge. Persists
                and grows across the entire timeline.
                <span className="block text-white/25 text-[11px] mt-1 italic">
                  HP: Harry, Hogwarts, the Philosopher&apos;s Stone quest,
                  Snape&apos;s ambiguous loyalty, the rules of wand magic — all
                  as graph nodes and edges.
                </span>
              </P>
              <P>
                <B>Arcs</B> — Thematic groupings of 5–8 scenes with directional
                objectives. Direction vectors recompute after each arc based on
                thread tension and momentum.
                <span className="block text-white/25 text-[11px] mt-1 italic">
                  HP: &ldquo;Arrival at Hogwarts&rdquo; (Sorting Hat through
                  first classes) — establishing threads, expanding the world,
                  seeding rivalries.
                </span>
              </P>
              <P>
                <B>Scenes</B> — Atomic units of structural delta. Each scene
                records thread transitions, world deltas, and knowledge
                graph additions. Forces derive from these deltas, not from
                prose.
                <span className="block text-white/25 text-[11px] mt-1 italic">
                  HP: The troll fight — &ldquo;friendship with Hermione&rdquo;
                  thread jumps latent → seeded, relationship delta between
                  Harry/Ron/Hermione, knowledge node for troll vulnerability.
                </span>
              </P>
              <P>
                <B>Beats</B> — Typed prose segments with a function (breathe,
                inform, advance, turn, reveal, etc.) and delivery mechanism
                (dialogue, thought, action, etc.). Generated as blueprints
                before prose is written.
                <span className="block text-white/25 text-[11px] mt-1 italic">
                  HP troll scene: breathe:environment (bathroom, troll stench) →
                  advance:action (Ron levitates the club) → bond:dialogue
                  (&ldquo;There are some things you can&apos;t share&rdquo;).
                </span>
              </P>
              <P>
                <B>Propositions</B> — Atomic prose units (20–60 words) that
                execute beat intentions. The smallest embeddable unit for
                semantic search.
                <span className="block text-white/25 text-[11px] mt-1 italic">
                  &ldquo;The troll&apos;s club clattered to the floor. In the
                  silence, Ron was still holding his wand in the air.&rdquo;
                </span>
              </P>
            </div>

            <P>
              Forces are computed from deltas without examining prose.
              Revision edits beats without modifying scene structure. Every
              layer is independently auditable.
            </P>
          </Section>

          {/* ── Embeddings & Proposition Classification ─────────────────── */}
          <Section id="embeddings" label="Embeddings">
            <P>
              Forces operate at the scene level. But readers experience{" "}
              <B>prose</B>, composed of <B>propositions</B> — atomic claims that
              must be accepted as true within the narrative world. &ldquo;Harry
              has a lightning-bolt scar.&rdquo; &ldquo;The wand chooses the
              wizard.&rdquo; Each is a temporally bounded statement whose
              structural significance is determined by its relationships to
              every other proposition.
            </P>
            <P>
              Forces measure <B>what changes</B> in the knowledge graph.
              Propositions measure <B>what is stated</B> in the prose. Every
              proposition is embedded as a 1536-dimensional vector (OpenAI
              text-embedding-3-small), transforming prose into a geometric space
              where similarity is distance and structural relationships become
              computable.
            </P>
            <P>
              Coherent writing is a <B>proof graph</B>. Each proposition
              introduces, derives from, or resolves prior content. A plot hole
              is a broken inference chain; a satisfying resolution is a deep
              proof tree resolving. Quality is structural — how propositions
              relate across time — and that structure is now computable.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">
              Activation
            </h3>
            <P>
              The full pairwise similarity structure is computed via matrix
              multiplication —{" "}
              <Tex>{"\\mathbf{S} = \\hat{E} \\hat{E}^\\top"}</Tex> where{" "}
              <Tex>{"\\hat{E}"}</Tex> is the L2-normalized embedding matrix —
              accelerated by TensorFlow.js. From this matrix, each proposition
              receives two scores: <B>backward activation</B> (how strongly it
              connects to prior content) and <B>forward activation</B> (how
              strongly future content builds upon it).
            </P>
            <Eq
              label="Hybrid activation score"
              tex="A(p_i, D) = 0.5 \cdot \max_{j \in D} S_{ij} + 0.5 \cdot \frac{1}{k} \sum_{j \in \text{top}_k(D)} S_{ij}"
            />
            <P>
              The hybrid of maximum (depth — strongest single dependency) and
              mean-top-<Tex>{"k"}</Tex> (breadth — cluster of strong
              connections) with <Tex>{"k=5"}</Tex> produces a robust activation
              score. A proposition is <B>HI</B> if its score exceeds an absolute
              threshold of 0.65, determined by systematic parameter sweep
              maximizing cross-work distributional variance (
              <Tex>{"\\Sigma \\text{var} = 225"}</Tex> across four reference
              works). The backward/forward binary produces four structural
              categories — <B>Anchor</B>, <B>Seed</B>, <B>Close</B>,{" "}
              <B>Texture</B> — detailed in the{" "}
              <a href="#classification" className="text-accent hover:underline">
                Classification
              </a>{" "}
              section.
            </P>
          </Section>

          {/* ── The Three Forces ──────────────────────────────────────── */}
          <Section id="forces" label="The Three Forces">
            <p className="text-[15px] leading-relaxed text-white/50 italic mb-8">
              We opened with a question: why do some resolutions feel earned
              while others ring hollow? The answer is investment — and here we
              make it precise. Three forces capture what readers perceive
              intuitively, derived deterministically from knowledge graph
              deltas.
            </p>
            <div className="mb-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">
                System
              </h3>
              <P>
                System measures the deepening of the world itself &mdash; the
                rules, structures, and concepts that form the substrate on which
                stories operate. Every narrative exists within a physics of
                possibility: what can happen, what cannot, what costs what.
                System tracks how that substrate grows and connects.
              </P>
              <Eq tex={String.raw`S = \Delta N + \sqrt{\Delta E}`} />
              <P>
                <Tex>{"\\Delta N"}</Tex> counts new nodes added to the graph
                (principles, systems, concepts, tensions, events, structures),
                and <Tex>{"\\Delta E"}</Tex> counts new typed edges. Nodes scale
                linearly because each represents genuinely new information.
                Edges scale sub-linearly (square root) because early connections
                matter more than later ones — this prevents bulk edge additions
                from dominating. The formula applies to any world-building
                context: fantasy magic systems, literary social hierarchies, or
                science fiction physics.
              </P>
            </div>

            <div className="mb-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">
                World
              </h3>
              <P>
                World measures the transformation of entities &mdash; what we
                learn about characters, locations, and artifacts as they move
                through the story. Where System tracks the rules of the stage,
                World tracks the inner lives of those who walk it.
              </P>
              <Eq tex={String.raw`W = \Delta N_c + \sqrt{\Delta E_c}`} />
              <P>
                <Tex>{String.raw`\Delta N_c`}</Tex> counts continuity nodes
                added to entity inner worlds (traits, beliefs, goals, secrets,
                capabilities, states), and <Tex>{String.raw`\Delta E_c`}</Tex>{" "}
                counts continuity edges (causal connections between inner-world
                facts). The symmetry with System is deliberate — both measure
                structural complexity growth, but in different domains: System
                tracks what we learn about the <em>world</em>, World tracks what
                we learn about <em>entities</em>.
              </P>
            </div>

            <div>
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">
                Fate
              </h3>
              <P>
                Fate is the directional force &mdash; the pull toward
                big-picture events and extraordinary circumstances. Where System
                and World measure what the story <em>is</em>, Fate measures
                where it&apos;s <em>going</em>. Not every story needs high fate;
                a character study or world-building treatise can thrive on World
                and System alone. But when threads accumulate and resolve, when
                circumstances become extraordinary, that&apos;s fate at work.
              </P>
              <Eq tex="F = \sum_{t} \sqrt{\text{arcs}(t)} \times w(t) \times (1 + \ln(1 + I(t)))" />
              <P>
                Three factors combine. <B>Arc span</B> uses{" "}
                <Tex>{String.raw`\sqrt{\text{arcs}}`}</Tex> &mdash; sublinear
                scaling that rewards persistence without penalizing short works.
                <B>Stage weight</B> <Tex>w(t)</Tex> reflects lifecycle position:
                pulse = 0.25, seeded = 0.5, active = 1.0, escalating = 1.5,
                critical = 2.0, resolved = 4.0. Abandoned threads earn zero
                &mdash; cleanup, not resolution.
              </P>
              <P>
                <B>Investment</B> <Tex>I(t)</Tex> is what distinguishes earned
                fate from red herrings. It measures what the story has built
                into the thread&apos;s participants &mdash; their continuity
                depth (accumulated knowledge, relationships, history). A thread
                resolving around a deeply-developed character earns more fate
                than one involving transient figures:
              </P>
              <Eq tex="I(t) = \max_p(\text{depth}_p) \times (1 + 0.15 \times \text{breadth})" />
              <P>
                Fate can be powerful on a single individual (high depth, low
                breadth) or across many people (moderate depth, high breadth). A
                prophecy about a chosen one and a fellowship converging at a
                climax both earn high fate &mdash; through different paths. In
                fiction those nodes are characters, locations, artifacts. In a
                paper they&apos;re theorems, concepts, arguments. The formula
                works universally.
              </P>
            </div>

            <div className="mt-12">
              <h3 className="text-[15px] font-semibold text-white/80 mb-2">
                Delivery
              </h3>
              <P>
                While System, World, and Fate measure structural{" "}
                <em>operations</em>, Delivery quantifies reader-perceived{" "}
                <em>impact</em> — the mean of all three forces, capturing
                holistic moments where direction, transformation, and knowledge
                converge.
              </P>
              <Eq
                tex={String.raw`D_i = \frac{F_i + W_i + S_i}{3}`}
              />
              <P>
                Equal-weighted mean of z-scored forces. Because each force is
                independently normalised to mean&thinsp;=&thinsp;0,
                std&thinsp;=&thinsp;1, all three contribute equally regardless
                of their raw scale differences. Peaks emerge not from
                one-dimensional spikes but from scenes where all three forces
                fire together — structurally complete moments.
              </P>
            </div>
          </Section>

          {/* ── Validation ──────────────────────────────────────────── */}
          <Section id="validation" label="Validation">
            <P>
              Do the formulas capture structural significance? We tested
              against <em>Harry Potter and the Sorcerer&apos;s Stone</em>. The
              delivery curve below was computed entirely from structural
              deltas extracted at analysis time.
            </P>

            {/* Annotated Delivery Curve — computed from the Sorcerer's Stone narrative JSON via the same formulas used in the app */}
            {(() => {
              // Smoothed delivery values computed from the canonical analysis:
              // raw forces → z-score normalise → delivery formula → Gaussian smooth (σ=1.5)
              const delivery = [
                0.191, 0.18, 0.08, -0.087, -0.222, -0.281, -0.285, -0.27,
                -0.251, -0.191, -0.025, 0.244, 0.458, 0.443, 0.259, 0.133,
                0.207, 0.479, 0.783, 0.875, 0.719, 0.549, 0.535, 0.572, 0.458,
                0.177, -0.051, -0.034, 0.183, 0.429, 0.572, 0.528, 0.303,
                0.038, -0.134, -0.208, -0.249, -0.266, -0.16, 0.107, 0.357,
                0.391, 0.25, 0.101, 0.005, -0.061, -0.101, -0.14, -0.218,
                -0.292, -0.266, -0.17, -0.122, -0.138, -0.122, -0.042, 0.033,
                0.023, -0.061, -0.123, -0.151, -0.225, -0.361, -0.491, -0.566,
                -0.577, -0.518, -0.396, -0.293, -0.323, -0.511, -0.779, -1.032,
              ];
              const n = delivery.length;
              const W = 620,
                H = 220;
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

              const peaks = [
                { scene: 13, label: "Hagrid reveals truth" },
                { scene: 20, label: "Diagon Alley" },
                { scene: 31, label: "Welcoming feast" },
                { scene: 42, label: "Troll in the dungeon" },
                { scene: 57, label: "Smuggling Norbert" },
                { scene: 69, label: "Quirrell revealed" },
              ];
              const valleys = [
                { scene: 7, label: "Boa constrictor" },
                { scene: 27, label: "Arrival at Hogwarts" },
                { scene: 38, label: "Three-headed dog" },
                { scene: 50, label: "Mirror of Erised" },
                { scene: 66, label: "Through the trapdoor" },
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

                    {/* Peak annotations — above the curve */}
                    {peaks.map(({ scene, label }) => {
                      const i = scene - 1;
                      const x = toX(i);
                      const y = toY(delivery[i]);
                      return (
                        <g key={`peak-${scene}`}>
                          <line
                            x1={x}
                            y1={y}
                            x2={x}
                            y2={y - 16}
                            stroke="#FCD34D"
                            strokeOpacity="0.35"
                            strokeDasharray="2 2"
                          />
                          <circle
                            cx={x}
                            cy={y}
                            r={3}
                            fill="#FCD34D"
                            opacity="0.95"
                          />
                          <text
                            x={x}
                            y={y - 20}
                            textAnchor="middle"
                            fill="#FCD34D"
                            fillOpacity="0.75"
                            fontSize="7"
                            fontFamily="system-ui"
                          >
                            {label}
                          </text>
                        </g>
                      );
                    })}

                    {/* Valley annotations — below the curve */}
                    {valleys.map(({ scene, label }) => {
                      const i = scene - 1;
                      const x = toX(i);
                      const y = toY(delivery[i]);
                      return (
                        <g key={`valley-${scene}`}>
                          <line
                            x1={x}
                            y1={y}
                            x2={x}
                            y2={y + 16}
                            stroke="#60A5FA"
                            strokeOpacity="0.35"
                            strokeDasharray="2 2"
                          />
                          <circle
                            cx={x}
                            cy={y}
                            r={3}
                            fill="#60A5FA"
                            opacity="0.95"
                          />
                          <text
                            x={x}
                            y={y + 26}
                            textAnchor="middle"
                            fill="#60A5FA"
                            fillOpacity="0.75"
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
                    Harry Potter and the Sorcerer&apos;s Stone — 73-scene
                    smoothed delivery curve. Peaks{" "}
                    <span style={{ color: "#FCD34D" }}>above</span>, valleys{" "}
                    <span style={{ color: "#60A5FA" }}>below</span>.
                  </p>
                </div>
              );
            })()}

            <P>
              The six <B>peaks</B> line up with the book&apos;s structural
              spine: Hagrid&apos;s reveal, Diagon Alley, the welcoming feast,
              the troll, smuggling Norbert, the Quirrell confrontation.
              Threads commit, entities transform, and the world&apos;s rules
              snap into focus at once. These aren&apos;t chosen by taste —
              they fall out of the math.
            </P>
            <P>
              The <B>valleys</B> are just as load-bearing. The boa constrictor,
              the boat ride to Hogwarts, the three-headed dog, the Mirror of
              Erised, the descent through the trapdoor — none of these
              <em>resolve</em>. They are <B>turning points</B>: moments where
              tension is seeded, a boundary is crossed, a character glimpses
              the unknown. Structurally they contribute less fate, so delivery
              dips; but the energy they store is what makes the next peak
              feel earned. Without the Mirror of Erised, the climax has
              nothing personal to say.
            </P>
            <P>
              Peaks are where the story <B>commits</B>; valleys are where it{" "}
              <B>launches</B>. The rhythm between them is the story&apos;s
              pulse. Both sides of the zero line carry weight.
            </P>
            <P>
              The core claim:{" "}
              <B>deterministic formulas applied to structural deltas recover
              the dramatic shape of a narrative</B>
              . The LLM extracts deltas at low temperature; the math is fully
              deterministic. Cross-run validation confirms stable rankings,
              and the same formulas drive generation — the measurement{" "}
              <em>is</em> the objective function.
            </P>
          </Section>

          {/* ── Grading ───────────────────────────────────────────────── */}
          <Section id="grading" label="Grading">
            <P>
              Each story receives a score out of 100, with 25 points allocated
              to each of the three forces plus <B>swing</B> — the Euclidean
              distance between consecutive force snapshots, measuring dynamic
              contrast. The grading curve is piecewise, calibrated so published
              works land in the 85–92 range.
            </P>
            <Eq tex="g(\tilde{x}) = 25 - 17\,e^{-k\tilde{x}} \qquad k = \ln\!\tfrac{17}{4} \approx 1.45 \qquad \tilde{x} = \frac{\bar{x}}{\mu_{\text{ref}}}" />
            <P>
              A single exponential with three constraints: floor of 8 at{" "}
              <Tex>{"\\tilde{x}=0"}</Tex>, dominance threshold of 21 at{" "}
              <Tex>{"\\tilde{x}=1"}</Tex>, and asymptote of 25. The rate
              constant <Tex>{"k = \\ln(17/4)"}</Tex> is fully determined by
              these constraints. The curve naturally decelerates — early gains
              come easily, the last few points before the reference mean are
              harder to earn, and exceeding reference yields diminishing
              returns. Quality bands: bad (8–15), mediocre (15–20), good
              (21–25). At <Tex>{"\\tilde{x} = 1"}</Tex> (matching the reference
              mean), the grade is 21 out of 25 — the dominance threshold used by
              the archetype classifier. Above reference, exponential saturation
              makes each additional point harder to earn, asymptoting toward 25.
              Reference works land between 85 and 92.
            </P>

            <P>
              The reference means (<Tex>{"\\mu_{\\text{ref}}"}</Tex>) are
              derived from those same works:
            </P>
            <div className="mt-3 mb-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] max-w-sm">
              {[
                { force: "Fate", value: "1.5", color: "#EF4444" },
                { force: "World", value: "12", color: "#22C55E" },
                { force: "System", value: "3", color: "#3B82F6" },
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
                  "\\text{Overall} = g(\\tilde{D}) + g(\\tilde{W}) + g(\\tilde{S}) + g(\\tilde{\\sigma})"
                }
              </Tex>
              , where <Tex>{"\\tilde{\\sigma}"}</Tex> is swing. Swing values are
              already mean-normalised by the reference means during distance
              computation, so no separate reference mean is needed —{" "}
              <Tex>{"g(\\tilde{\\sigma})"}</Tex> is applied directly to the
              average swing magnitude.
            </P>
          </Section>

          {/* ── Causal Reasoning ──────────────────────────────────────── */}
          <Section id="planning" label="Causal Reasoning">
            <P>
              Generation begins with a question scoring alone cannot answer:{" "}
              <em>what must happen next, and why?</em> An arc is four to eight
              scenes carrying a single chunk of narrative work — advancing a
              thread, exposing a character, planting a payoff. A thread
              escalates because an entity learned something, which required
              access to a location, which required an artifact to change hands,
              which was constrained by a system rule foreshadowed three scenes
              earlier. Narrative consequence isn&apos;t a line. It&apos;s a
              graph.
            </P>
            <P>
              Earlier versions of the system flattened this into a{" "}
              <em>direction vector</em> and a <em>constraint vector</em>
              — push these threads, don&apos;t do that yet — rewritten after
              each arc. It worked, but it lost the structure readers actually
              track. We replace it with a <B>causal reasoning graph</B>: an
              explicit, typed graph of what must happen and why, built for
              each arc before any scene is generated.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">
              The Taxonomy
            </h3>
            <P>
              Eight node types in three tiers: <B>pressure</B> (fate, warning)
              forces change; <B>substrate</B> (character, location, artifact,
              system) is what&apos;s changed; <B>bridge</B> (reasoning,
              pattern) connects them.
            </P>
            <div className="mt-3 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              {[
                {
                  name: "fate",
                  color: "#EF4444",
                  body: "a thread's gravitational pull — what must resolve, and in which direction",
                },
                {
                  name: "reasoning",
                  color: "#A855F7",
                  body: "a logical step connecting what fate needs to what entities can supply",
                },
                {
                  name: "character",
                  color: "#22C55E",
                  body: "an active agent whose position, knowledge, or relationships move the arc",
                },
                {
                  name: "location",
                  color: "#22D3EE",
                  body: "a setting that enables or constrains what can happen",
                },
                {
                  name: "artifact",
                  color: "#F59E0B",
                  body: "an object whose presence, transfer, or loss carries narrative weight",
                },
                {
                  name: "system",
                  color: "#3B82F6",
                  body: "a rule of the world — magic, economics, social norm — that shapes action",
                },
                {
                  name: "pattern",
                  color: "#84CC16",
                  body: "an expansion agent — unexpected collisions, emergent properties, creative surprise",
                },
                {
                  name: "warning",
                  color: "#F43F5E",
                  body: "a subversion agent — predictable trajectories or unpaid costs to disrupt",
                },
              ].map(({ name, color, body }) => (
                <div
                  key={name}
                  className="rounded-lg bg-white/[0.03] border border-white/6 px-3 py-2"
                >
                  <span
                    className="uppercase tracking-wider font-mono text-[10px] mr-2"
                    style={{ color }}
                  >
                    {name}
                  </span>
                  <span className="text-white/55">{body}</span>
                </div>
              ))}
            </div>
            <P>
              Edges are equally typed: <B>requires</B>, <B>enables</B>,{" "}
              <B>constrains</B>, <B>risks</B>, <B>causes</B>, <B>reveals</B>,{" "}
              <B>develops</B>, <B>resolves</B>. <em>Requires</em> is the
              workhorse — the &ldquo;what must be true for this to
              happen&rdquo; relation that backward reasoning chases.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">
              Backward Reasoning
            </h3>
            <P>
              Generation does not start from the current scene asking
              &ldquo;what happens next?&rdquo; It starts from <B>fate</B> —
              the threads the story owes the reader — and asks{" "}
              <em>what would have to be true for these threads to advance?</em>{" "}
              Each answer becomes a reasoning node, which pulls in the entities
              that can fulfil it. Pattern and warning nodes inject in parallel:
              patterns push for unexpected collisions, warnings flag the
              predictable path so the arc doesn&apos;t take it.
            </P>
            <P>
              The result is a small causal graph — typically 8–20 nodes per
              arc — that the LLM walks as it generates. Scenes <em>execute</em>{" "}
              the graph; threads advance because an entity was forced to
              decide, not because the prompt said so.
            </P>

            {/* ── Reasoning graph diagram ───────────────────────────── */}
            {(() => {
              // Styling matches the in-app ReasoningGraphView component.
              // Layout is intentionally organic — narrative causality is a
              // tangle, not a ladder.
              type NodeType =
                | "fate"
                | "reasoning"
                | "character"
                | "location"
                | "artifact"
                | "system"
                | "pattern"
                | "warning";
              type EdgeType =
                | "requires"
                | "enables"
                | "constrains"
                | "risks"
                | "causes"
                | "reveals"
                | "develops"
                | "resolves";

              const NODE_COLORS: Record<
                NodeType,
                { fill: string; stroke: string; text: string }
              > = {
                fate: { fill: "#991b1b", stroke: "#ef4444", text: "#fee2e2" },
                character: { fill: "#166534", stroke: "#22c55e", text: "#dcfce7" },
                location: { fill: "#14532d", stroke: "#16a34a", text: "#bbf7d0" },
                artifact: { fill: "#15803d", stroke: "#4ade80", text: "#f0fdf4" },
                system: { fill: "#1e3a8a", stroke: "#3b82f6", text: "#dbeafe" },
                reasoning: { fill: "#4c1d95", stroke: "#a855f7", text: "#ede9fe" },
                pattern: { fill: "#115e59", stroke: "#14b8a6", text: "#ccfbf1" },
                warning: { fill: "#92400e", stroke: "#f59e0b", text: "#fef3c7" },
              };
              const EDGE_COLORS: Record<EdgeType, string> = {
                enables: "#22c55e",
                constrains: "#ef4444",
                risks: "#f59e0b",
                requires: "#3b82f6",
                causes: "#64748b",
                reveals: "#a855f7",
                develops: "#06b6d4",
                resolves: "#10b981",
              };

              type GNode = {
                id: string;
                idx: number;
                x: number;
                y: number;
                type: NodeType;
                label: string;
              };
              type GEdge = { from: string; to: string; type: EdgeType };

              // TB cascade with long reach-back arcs — mirrors the
              // silhouette of real graphs produced in-app. Vertical flow
              // on the right, scattered hub bottom-left, long edges that
              // sweep across the canvas.
              const nodes: GNode[] = [
                // Right-side cascade — fate spine
                { id: "F1",  idx: 0,  x: 860, y:  80, type: "fate",      label: "Stone must be claimed" },
                { id: "F2",  idx: 1,  x: 860, y: 220, type: "fate",      label: "Betrayal must resolve" },
                { id: "R1",  idx: 2,  x: 860, y: 360, type: "reasoning", label: "Solve the chamber trials" },
                { id: "A1",  idx: 3,  x: 860, y: 500, type: "artifact",  label: "Mirror of Erised" },
                { id: "F3",  idx: 4,  x: 860, y: 640, type: "fate",      label: "Harry's agency tested" },
                { id: "R4",  idx: 5,  x: 860, y: 780, type: "reasoning", label: "Unmask Quirrell late" },
                // Far-right satellites
                { id: "L1",  idx: 6,  x: 1060, y:  80, type: "location",  label: "Third-floor chamber" },
                { id: "S1",  idx: 7,  x: 1060, y: 500, type: "system",    label: "Protections test virtue" },
                { id: "PT1", idx: 8,  x: 1060, y: 640, type: "pattern",   label: "Mirror reads desire" },
                // Lower-left hub — the guardians cluster
                { id: "R3",  idx: 9,  x: 380, y: 430, type: "reasoning", label: "Pass the guardian trio" },
                { id: "C2",  idx: 10, x: 160, y: 560, type: "character", label: "Hermione — logic" },
                { id: "C3",  idx: 11, x: 380, y: 600, type: "character", label: "Ron — sacrifice" },
                { id: "C1",  idx: 12, x: 600, y: 560, type: "character", label: "Harry — desire-pure" },
                // Bottom cluster — antagonist and warnings
                { id: "C4",  idx: 13, x: 560, y: 780, type: "character", label: "Quirrell — concealed host" },
                { id: "WN1", idx: 14, x: 220, y: 740, type: "warning",   label: "No adult shortcut" },
                { id: "WN2", idx: 15, x: 340, y: 260, type: "warning",   label: "Avoid obvious Snape" },
                // Upper-left meta — patterns injected by LLM
                { id: "PT2", idx: 16, x: 160, y:  80, type: "pattern",   label: "Sacrifice earns passage" },
                { id: "R5",  idx: 17, x: 160, y: 240, type: "reasoning", label: "Trials test a trait each" },
              ];

              // Dense, crossing edges — many sweep across the canvas.
              const edges: GEdge[] = [
                { from: "F1",  to: "F2",  type: "risks"      },
                { from: "F1",  to: "R1",  type: "requires"   },
                { from: "F1",  to: "L1",  type: "causes"     },
                { from: "F1",  to: "R3",  type: "requires"   },
                { from: "F2",  to: "R4",  type: "requires"   },
                { from: "F2",  to: "C4",  type: "reveals"    },
                { from: "R1",  to: "A1",  type: "requires"   },
                { from: "R1",  to: "R5",  type: "enables"    },
                { from: "A1",  to: "F1",  type: "resolves"   },
                { from: "A1",  to: "C1",  type: "develops"   },
                { from: "S1",  to: "A1",  type: "constrains" },
                { from: "S1",  to: "R1",  type: "constrains" },
                { from: "PT1", to: "A1",  type: "reveals"    },
                { from: "F3",  to: "C1",  type: "develops"   },
                { from: "F3",  to: "R3",  type: "requires"   },
                { from: "R4",  to: "C4",  type: "requires"   },
                { from: "R4",  to: "F2",  type: "resolves"   },
                { from: "C4",  to: "F3",  type: "risks"      },
                { from: "R3",  to: "C1",  type: "requires"   },
                { from: "R3",  to: "C2",  type: "requires"   },
                { from: "R3",  to: "C3",  type: "requires"   },
                { from: "R5",  to: "R3",  type: "causes"     },
                { from: "R5",  to: "C2",  type: "enables"    },
                { from: "WN1", to: "R1",  type: "constrains" },
                { from: "WN1", to: "C1",  type: "risks"      },
                { from: "WN2", to: "R4",  type: "constrains" },
                { from: "WN2", to: "F2",  type: "risks"      },
                { from: "PT2", to: "C3",  type: "reveals"    },
                { from: "PT2", to: "R3",  type: "develops"   },
                { from: "C1",  to: "F3",  type: "develops"   },
              ];

              const NODE_W = 190;
              const NODE_H = 52;
              const W = 1200;
              const H = 880;
              const byId = new Map(nodes.map((n) => [n.id, n]));

              // Intersect line from center (cx,cy) with rounded-rect border.
              // For a simple rect, clip to half-width/height along the line angle.
              const rectBoundary = (
                cx: number,
                cy: number,
                tx: number,
                ty: number,
              ) => {
                const dx = tx - cx;
                const dy = ty - cy;
                if (dx === 0 && dy === 0) return { x: cx, y: cy };
                const halfW = NODE_W / 2;
                const halfH = NODE_H / 2;
                const sx = halfW / Math.abs(dx || 1e-9);
                const sy = halfH / Math.abs(dy || 1e-9);
                const s = Math.min(sx, sy);
                return { x: cx + dx * s, y: cy + dy * s };
              };

              return (
                <div className="mt-6 mb-3 rounded-xl border border-white/8 bg-linear-to-b from-white/2 to-white/4 px-3 py-4 overflow-x-auto shadow-lg">
                  <svg
                    width="100%"
                    height={H}
                    viewBox={`0 0 ${W} ${H}`}
                    className="block mx-auto min-w-[820px]"
                  >
                    <defs>
                      {Object.entries(EDGE_COLORS).map(([type, color]) => (
                        <marker
                          key={type}
                          id={`rg-arrow-${type}`}
                          viewBox="0 -5 10 10"
                          refX="9"
                          refY="0"
                          markerWidth="6"
                          markerHeight="6"
                          orient="auto"
                        >
                          <path d="M0,-4L10,0L0,4" fill={color} />
                        </marker>
                      ))}
                    </defs>

                    {/* Edges — drawn first so nodes sit on top */}
                    {edges.map((e, ei) => {
                      const a = byId.get(e.from);
                      const b = byId.get(e.to);
                      if (!a || !b) return null;
                      const color = EDGE_COLORS[e.type];
                      const start = rectBoundary(a.x, a.y, b.x, b.y);
                      const end = rectBoundary(b.x, b.y, a.x, a.y);
                      // Perpendicular bend for visual separation when many
                      // edges run between nearby nodes
                      const dx = end.x - start.x;
                      const dy = end.y - start.y;
                      const len = Math.sqrt(dx * dx + dy * dy) || 1;
                      // Deterministic bend per edge index
                      const bend = (((ei * 37) % 5) - 2) * 22;
                      const nx = -dy / len;
                      const ny = dx / len;
                      const cx = (start.x + end.x) / 2 + nx * bend;
                      const cy = (start.y + end.y) / 2 + ny * bend;
                      const d = `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`;
                      return (
                        <g key={ei}>
                          <path
                            d={d}
                            fill="none"
                            stroke={color}
                            strokeWidth={1.6}
                            opacity={0.55}
                            markerEnd={`url(#rg-arrow-${e.type})`}
                          />
                        </g>
                      );
                    })}

                    {/* Edge labels — bare colored text, like the in-app UI */}
                    {edges.map((e, ei) => {
                      const a = byId.get(e.from);
                      const b = byId.get(e.to);
                      if (!a || !b) return null;
                      const color = EDGE_COLORS[e.type];
                      const start = rectBoundary(a.x, a.y, b.x, b.y);
                      const end = rectBoundary(b.x, b.y, a.x, a.y);
                      const dx = end.x - start.x;
                      const dy = end.y - start.y;
                      const len = Math.sqrt(dx * dx + dy * dy) || 1;
                      const bend = (((ei * 37) % 5) - 2) * 22;
                      const nx = -dy / len;
                      const ny = dx / len;
                      const mx =
                        0.25 * start.x +
                        0.5 * ((start.x + end.x) / 2 + nx * bend) +
                        0.25 * end.x;
                      const my =
                        0.25 * start.y +
                        0.5 * ((start.y + end.y) / 2 + ny * bend) +
                        0.25 * end.y;
                      return (
                        <text
                          key={`lbl-${ei}`}
                          x={mx}
                          y={my - 4}
                          fill={color}
                          fontSize="9"
                          fontFamily="ui-monospace, SFMono-Regular, monospace"
                          textAnchor="middle"
                          opacity={0.9}
                        >
                          {e.type}
                        </text>
                      );
                    })}

                    {/* Nodes */}
                    {nodes.map((n) => {
                      const c = NODE_COLORS[n.type];
                      const x = n.x - NODE_W / 2;
                      const y = n.y - NODE_H / 2;
                      return (
                        <g key={n.id}>
                          <rect
                            x={x}
                            y={y}
                            width={NODE_W}
                            height={NODE_H}
                            rx={8}
                            ry={8}
                            fill={c.fill}
                            stroke={c.stroke}
                            strokeWidth={1.5}
                          />
                          {/* Index badge (top-left) */}
                          <circle
                            cx={x}
                            cy={y}
                            r={10}
                            fill="#0f172a"
                            stroke={c.stroke}
                            strokeWidth={1}
                          />
                          <text
                            x={x}
                            y={y + 1}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize="9"
                            fontWeight="700"
                            fill={c.text}
                            fontFamily="ui-monospace, SFMono-Regular, monospace"
                          >
                            {n.idx}
                          </text>
                          {/* Type badge (top-right) */}
                          <rect
                            x={x + NODE_W - 66}
                            y={y + 5}
                            width={60}
                            height={13}
                            rx={3}
                            fill="rgba(0,0,0,0.35)"
                          />
                          <text
                            x={x + NODE_W - 36}
                            y={y + 12}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize="8"
                            fontFamily="ui-monospace, SFMono-Regular, monospace"
                            fill={c.text}
                            style={{
                              textTransform: "uppercase",
                              letterSpacing: "0.08em",
                            }}
                          >
                            {n.type}
                          </text>
                          {/* ID (bottom-right) */}
                          <text
                            x={x + NODE_W - 8}
                            y={y + NODE_H - 6}
                            textAnchor="end"
                            fontSize="8"
                            fill={c.text}
                            opacity={0.5}
                            fontFamily="ui-monospace, SFMono-Regular, monospace"
                          >
                            {n.id}
                          </text>
                          {/* Main label */}
                          <text
                            x={n.x}
                            y={n.y + 4}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize="11"
                            fontWeight="500"
                            fill={c.text}
                            fontFamily="system-ui"
                          >
                            {n.label.length > 27
                              ? n.label.slice(0, 26) + "…"
                              : n.label}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              );
            })()}

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">
              World Expansion
            </h3>
            <P>
              At phase boundaries, <B>world expansion</B> introduces new
              characters, locations, artifacts, and threads — each seeded with
              knowledge asymmetries that drive future conflict. Expansion
              produces its own reasoning graph justifying why each new entity
              exists, then hands them to the next arc&apos;s causal graph as
              substrate. Long-range phases provide structure; reasoning graphs
              provide short-range causality that evolves arc by arc.
            </P>
          </Section>

          {/* ── MCTS ──────────────────────────────────────────────────── */}
          <Section id="mcts" label="MCTS">
            <P>
              <em>
                This section describes implemented architecture, not validated
                results. No controlled comparison against simpler baselines
                (greedy, random) has been run.
              </em>
            </P>
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
              <strong>Expansion</strong>: The selected node generates a new
              arc via the LLM. Siblings receive different directional prompts,
              so they explore structurally different trajectories from the
              same narrative state.
            </P>
            <P>
              <strong>Evaluation</strong>: The generated arc is scored with
              the same force grading applied to published literature. An arc
              at 85 has comparable structural density to the reference works.
            </P>
            <P>
              <strong>Backpropagation</strong>: The score propagates up the
              tree; paths that consistently produce high-scoring arcs accrue
              visits and become more likely to be selected next.
            </P>

            <P>
              After search completes, the best path is selected by highest
              average score or most-visited path, and the user commits it to
              the story.
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

          {/* ── Prose Profiles ────────────────────────────────────────── */}
          <Section id="prose-profiles" label="Prose Profiles">
            <P>
              Prose generation separates <B>content</B> (what is written)
              from <B>accent</B> (how). Content comes from beat plans —
              blueprints specifying the narrative work each paragraph must
              perform. Accent comes from prose profiles — statistical
              fingerprints of authorial voice reverse-engineered from
              published works.
            </P>

            <P>
              A <B>prose profile</B> has two components:{" "}
              <Tex>{"(1)"}</Tex> a distribution over 8 delivery mechanisms —
              the author&apos;s balance of dialogue, action, thought,
              narration; <Tex>{"(2)"}</Tex> voice parameters — register,
              stance, tense, rhetorical devices. Each beat in a plan is
              classified by function (a 10-item taxonomy: breathe, inform,
              advance, bond, turn, reveal, shift, expand, foreshadow,
              resolve) and delivered through one of the 8 mechanisms.
            </P>

            <P>
              Profiles are extracted empirically: an LLM decomposes scenes
              into typed beats classified against the taxonomy; mechanism
              counts become a distribution. During generation, beat functions
              are chosen by the LLM per scene; mechanisms sample from the
              distribution; voice parameters constrain each beat.
            </P>

            <P>
              The payoff is{" "}
              <B>structural control without stylistic constraint</B>. Beat
              plans scaffold what happens; profiles supply how it sounds.
              Swap the profile and the same story renders in a different
              authorial accent — a thriller in Orwell&apos;s introspective
              voice produces psychological tension; the same story in
              Rowling&apos;s dialogue-driven style produces kinetic urgency.
            </P>
          </Section>

          {/* ── Markov Chains ─────────────────────────────────────────── */}
          <Section id="markov" label="Markov Chains">
            <P>
              InkTide uses two layers of Markov chains. Layer 1 operates at
              the <strong>scene level</strong> — sampling force profiles from
              an 8-state matrix to control pacing. Layer 2 operates at the{" "}
              <strong>beat level</strong> — sampling sequences from a
              10-state matrix over beat functions to control prose texture.
              Both are derived the same way: classify each unit, count
              consecutive transitions, normalise rows.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">
              Layer 1: Pacing Chains (Scene &rarr; Scene)
            </h3>
            <P>
              The eight cube corners form a finite state space. Each scene
              occupies one corner; consecutive scenes form an empirical Markov
              chain <Tex>{"T \\in \\mathbb{R}^{8 \\times 8}"}</Tex>, where{" "}
              <Tex>{"T_{ij}"}</Tex> is the probability of moving from mode{" "}
              <Tex>{"i"}</Tex> to mode <Tex>{"j"}</Tex>. Raw forces are
              computed per scene, z-score normalised across the novel, and
              classified into corners.
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
                  const names = [
                    "Epoch",
                    "Climax",
                    "Revelation",
                    "Closure",
                    "Discovery",
                    "Growth",
                    "Lore",
                    "Rest",
                  ];
                  const colors = [
                    "#f59e0b",
                    "#ef4444",
                    "#a855f7",
                    "#6366f1",
                    "#22d3ee",
                    "#22c55e",
                    "#3b82f6",
                    "#6b7280",
                  ];
                  const visits = [11, 7, 2, 15, 4, 12, 6, 16];
                  const cx = 200,
                    cy = 200,
                    r = 150;
                  const maxV = Math.max(...visits);
                  const positions = names.map((_, i) => {
                    const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
                    return {
                      x: cx + r * Math.cos(angle),
                      y: cy + r * Math.sin(angle),
                    };
                  });
                  // All 38 transitions from HP delta analysis
                  const edges: [number, number, number][] = [
                    [7, 7, 5],
                    [3, 5, 4],
                    [1, 7, 4],
                    [0, 3, 4],
                    [7, 5, 3],
                    [5, 5, 3],
                    [0, 0, 3],
                    [7, 3, 3],
                    [3, 0, 3],
                    [3, 3, 3],
                    [5, 7, 3],
                    [4, 6, 2],
                    [6, 0, 2],
                    [5, 3, 2],
                    [1, 3, 2],
                    [6, 4, 2],
                    [7, 1, 2],
                    [3, 7, 2],
                    [0, 7, 1],
                    [3, 1, 1],
                    [3, 6, 1],
                    [0, 6, 1],
                    [6, 1, 1],
                    [5, 2, 1],
                    [2, 0, 1],
                    [0, 1, 1],
                    [7, 6, 1],
                    [4, 0, 1],
                    [5, 6, 1],
                    [6, 7, 1],
                    [3, 2, 1],
                    [2, 3, 1],
                    [5, 1, 1],
                    [1, 1, 1],
                    [7, 4, 1],
                    [4, 5, 1],
                    [5, 0, 1],
                    [0, 5, 1],
                  ];
                  const maxE = 5;
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
                              cx={ox}
                              cy={oy}
                              r={loopR}
                              fill="none"
                              stroke="rgba(52,211,153,1)"
                              strokeWidth={1 + 2 * (count / maxE)}
                              opacity={0.12 + 0.55 * (count / maxE)}
                            />
                          );
                        }
                        const p1 = positions[fi],
                          p2 = positions[ti];
                        const dx = p2.x - p1.x,
                          dy = p2.y - p1.y;
                        const len = Math.sqrt(dx * dx + dy * dy);
                        const nx = -dy / len,
                          ny = dx / len;
                        const nr = 14 + (visits[ti] / maxV) * 10;
                        const ratio = Math.max(0, (len - nr - 8) / len);
                        return (
                          <line
                            key={ei}
                            x1={p1.x + 4 * nx}
                            y1={p1.y + 4 * ny}
                            x2={p1.x + dx * ratio + 4 * nx}
                            y2={p1.y + dy * ratio + 4 * ny}
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
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r={nr}
                              fill={colors[i]}
                              opacity={0.85}
                            />
                            <text
                              x={p.x}
                              y={p.y + 1}
                              fill="#fff"
                              fontSize="9"
                              fontWeight="600"
                              textAnchor="middle"
                              dominantBaseline="middle"
                            >
                              {name}
                            </text>
                            <text
                              x={p.x}
                              y={p.y + nr + 12}
                              fill="#9ca3af"
                              fontSize="8"
                              textAnchor="middle"
                            >
                              {visits[i]}x
                            </text>
                          </g>
                        );
                      })}
                    </>
                  );
                })()}
              </svg>
              <p className="text-[10px] text-white/30 text-center">
                Harry Potter and the Sorcerer&apos;s Stone — pacing chain. 73
                scenes, 72 transitions, 38 unique edges.
                <br />
                Node size = visit frequency. Edge thickness = transition count.
              </p>
            </div>

            <P>
              Harry Potter&apos;s pacing chain is broadly distributed:
              entropy 2.78/3.00, self-loop rate 20.8%, fate-to-buildup ratio
              35/38. Rest (16 visits) and Closure (15) lead, with Growth (12)
              and Epoch (11) close behind — the story spends most of its time
              either breathing or earning its peaks, with high-force scenes
              punctuating rather than dominating. The strongest transitions
              (Rest&rarr;Rest 5x, then Closure&rarr;Growth, Climax&rarr;Rest,
              and Epoch&rarr;Closure each 4x) show a rhythm of build,
              culminate, settle, build again.
            </P>
            <P>
              Other works produce strikingly different fingerprints.{" "}
              <em>Nineteen Eighty-Four</em> is fate-heavy — 72% of scenes land
              in the top four corners, reflecting Orwell&apos;s sustained
              pressure rather than Rowling&apos;s pivoting.{" "}
              <em>The Great Gatsby</em> oscillates between Epoch and Rest with
              little middle ground — Fitzgerald&apos;s pendulum rhythm. Each
              work&apos;s transition matrix is a measurable authorial signature.
            </P>
            <P>
              Before generating an arc, the engine walks the active matrix
              for N steps, producing a sequence like{" "}
              <span className="font-mono text-white/50">
                Growth &rarr; Lore &rarr; Climax &rarr; Rest &rarr; Growth
              </span>
              . Each step becomes a per-scene force target. Users pick a{" "}
              <em>rhythm profile</em> derived from a published work: a story
              on Rowling&apos;s matrix pivots constantly between peaks, one
              on Orwell&apos;s sustains pressure then erupts. Whether Markov
              guidance beats unguided generation on composite score is a
              testable claim we have not yet run in controlled experiment.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">
              Layer 2: Beat Chains (Beat &rarr; Beat)
            </h3>
            <P>
              Pacing chains control <em>which force profile</em> a scene
              hits. Within a scene, the prose itself has structure — a
              sequence of discrete <strong>beats</strong>, each a specific
              narrative function delivered through a specific mechanism. An
              LLM decomposes scenes into beats classified against a fixed
              taxonomy of 10 functions and 8 mechanisms.
            </P>

            <P>
              The <strong>10 beat functions</strong> describe what each section
              of prose does:{" "}
              <span className="text-white/60">
                <span style={{ color: "#6b7280" }}>breathe</span> (atmosphere,
                grounding), <span style={{ color: "#3b82f6" }}>inform</span>{" "}
                (knowledge delivery),{" "}
                <span style={{ color: "#22c55e" }}>advance</span> (forward
                momentum), <span style={{ color: "#ec4899" }}>bond</span>{" "}
                (relationship shifts),{" "}
                <span style={{ color: "#f59e0b" }}>turn</span> (pivots and
                reversals), <span style={{ color: "#a855f7" }}>reveal</span>{" "}
                (character nature exposed),{" "}
                <span style={{ color: "#ef4444" }}>shift</span> (power dynamics
                invert), <span style={{ color: "#06b6d4" }}>expand</span>{" "}
                (world-building),{" "}
                <span style={{ color: "#84cc16" }}>foreshadow</span> (plants for
                later fate), <span style={{ color: "#14b8a6" }}>resolve</span>{" "}
                (tension releases).
              </span>
            </P>

            <P>
              The <strong>8 mechanisms</strong> describe how each beat is
              delivered as prose: dialogue, thought, action, environment,
              narration, memory, document, comic. A single beat function can be
              delivered through different mechanisms — a <em>reveal</em> can
              land through dialogue, action, or narration, each producing a
              different texture.
            </P>

            <P>
              The methodology mirrors the pacing chain exactly: extract beat
              plans from every scene of a published work, tally consecutive
              function&rarr;function transitions, normalise rows, and produce a
              Markov matrix <Tex>{"B \\in \\mathbb{R}^{10 \\times 10}"}</Tex>.
              Applied to <em>Harry Potter and the Sorcerer&apos;s Stone</em>,
              an earlier beat-plan extraction yielded 1,254 beats across the
              novel (roughly 17 beats per scene at the current 73-scene
              structural pass):
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
                  const fns = [
                    "breathe",
                    "inform",
                    "advance",
                    "bond",
                    "turn",
                    "reveal",
                    "shift",
                    "expand",
                    "foreshadow",
                    "resolve",
                  ];
                  const fnColors: Record<string, string> = {
                    breathe: "#6b7280",
                    inform: "#3b82f6",
                    advance: "#22c55e",
                    bond: "#ec4899",
                    turn: "#f59e0b",
                    reveal: "#a855f7",
                    shift: "#ef4444",
                    expand: "#06b6d4",
                    foreshadow: "#84cc16",
                    resolve: "#14b8a6",
                  };
                  const visits = [205, 255, 329, 96, 83, 81, 44, 48, 48, 65];
                  const cx = 210,
                    cy = 210,
                    r = 155;
                  const maxV = Math.max(...visits);
                  const positions = fns.map((_, i) => {
                    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
                    return {
                      x: cx + r * Math.cos(angle),
                      y: cy + r * Math.sin(angle),
                    };
                  });
                  // All 92 transitions from HP beat analysis
                  const edges: [number, number, number][] = [
                    [1, 2, 98],
                    [0, 1, 82],
                    [2, 1, 66],
                    [2, 2, 58],
                    [0, 2, 56],
                    [2, 0, 42],
                    [2, 4, 38],
                    [2, 3, 31],
                    [2, 9, 29],
                    [1, 3, 27],
                    [4, 2, 26],
                    [3, 2, 26],
                    [1, 0, 25],
                    [5, 2, 24],
                    [2, 5, 23],
                    [1, 5, 23],
                    [1, 1, 23],
                    [4, 1, 21],
                    [1, 7, 20],
                    [3, 1, 18],
                    [0, 0, 16],
                    [5, 1, 16],
                    [7, 2, 16],
                    [0, 4, 14],
                    [5, 3, 13],
                    [1, 4, 13],
                    [3, 5, 11],
                    [3, 0, 11],
                    [2, 6, 11],
                    [5, 9, 10],
                    [8, 0, 10],
                    [2, 8, 9],
                    [1, 6, 9],
                    [6, 2, 9],
                    [2, 7, 9],
                    [7, 1, 9],
                    [9, 2, 8],
                    [6, 5, 8],
                    [4, 6, 8],
                    [3, 6, 7],
                    [8, 2, 7],
                    [1, 8, 7],
                    [0, 3, 7],
                    [9, 8, 6],
                    [0, 7, 6],
                    [0, 8, 6],
                    [4, 8, 6],
                    [9, 0, 6],
                    [8, 9, 5],
                    [3, 4, 5],
                    [7, 0, 5],
                    [0, 9, 5],
                    [4, 0, 5],
                    [1, 9, 5],
                    [9, 3, 5],
                    [3, 7, 5],
                    [6, 9, 5],
                    [8, 1, 4],
                    [5, 8, 4],
                    [7, 5, 4],
                    [5, 4, 4],
                    [0, 5, 4],
                    [6, 8, 4],
                    [4, 3, 4],
                    [6, 1, 4],
                    [9, 6, 4],
                    [9, 4, 3],
                    [6, 4, 3],
                    [3, 3, 3],
                    [4, 5, 3],
                    [6, 0, 3],
                    [8, 4, 3],
                    [6, 3, 3],
                    [5, 6, 3],
                    [4, 9, 3],
                    [9, 5, 3],
                    [3, 8, 3],
                    [3, 9, 3],
                    [9, 1, 3],
                    [7, 8, 3],
                    [4, 7, 3],
                    [5, 0, 2],
                    [7, 3, 2],
                    [0, 6, 1],
                    [5, 7, 1],
                    [7, 7, 1],
                    [5, 5, 1],
                    [7, 6, 1],
                    [8, 7, 1],
                    [9, 7, 1],
                    [6, 7, 1],
                    [8, 5, 1],
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
                              cx={ox}
                              cy={oy}
                              r={loopR}
                              fill="none"
                              stroke="rgba(52,211,153,1)"
                              strokeWidth={0.5 + 2.5 * (count / maxE)}
                              opacity={0.08 + 0.6 * (count / maxE)}
                            />
                          );
                        }
                        const p1 = positions[fi],
                          p2 = positions[ti];
                        const dx = p2.x - p1.x,
                          dy = p2.y - p1.y;
                        const len = Math.sqrt(dx * dx + dy * dy);
                        const nx = -dy / len,
                          ny = dx / len;
                        const nr = 12 + (visits[ti] / maxV) * 12;
                        const ratio = Math.max(0, (len - nr - 6) / len);
                        return (
                          <line
                            key={ei}
                            x1={p1.x + 3 * nx}
                            y1={p1.y + 3 * ny}
                            x2={p1.x + dx * ratio + 3 * nx}
                            y2={p1.y + dy * ratio + 3 * ny}
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
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r={nr}
                              fill={fnColors[fn]}
                              opacity={0.85}
                            />
                            <text
                              x={p.x}
                              y={p.y + 1}
                              fill="#fff"
                              fontSize="8"
                              fontWeight="600"
                              textAnchor="middle"
                              dominantBaseline="middle"
                            >
                              {fn}
                            </text>
                            <text
                              x={p.x}
                              y={p.y + nr + 12}
                              fill="#9ca3af"
                              fontSize="8"
                              textAnchor="middle"
                            >
                              {visits[i]}x
                            </text>
                          </g>
                        );
                      })}
                    </>
                  );
                })()}
              </svg>
              <p className="text-[10px] text-white/30 text-center">
                Harry Potter and the Sorcerer&apos;s Stone — beat chain. 1,254
                beats, 1,163 transitions, 92 unique edges.
                <br />
                Node size = beat frequency. Edge thickness = transition count.
              </p>
            </div>

            <P>
              The chain reveals <em>advance</em> as the dominant hub (329
              beats, 26%) — momentum is Rowling&apos;s connective tissue.
              The strongest single transition is{" "}
              <em>inform &rarr; advance</em> (98x): knowledge delivery
              triggers action. <em>Breathe</em> feeds almost exclusively into{" "}
              <em>inform</em> (82x) and <em>advance</em> (56x) — atmosphere
              exists to launch the next movement. All 100 pairs appear at
              least once; the matrix is dense.
            </P>

            <P>
              Other works shift the pattern. <em>Nineteen Eighty-Four</em>{" "}
              gives reveal unusual prominence — a mind trapped between inner
              world and outer surveillance. <em>Gatsby</em> leans on dialogue
              and narration — Fitzgerald&apos;s observer-narrator reporting.{" "}
              <em>Alice</em> is advance-dominant with minimal bonding — a
              protagonist propelled through episodes without deepening
              relationships.
            </P>

            <P>
              Alongside the transition matrix, the analysis extracts a{" "}
              <strong>mechanism distribution</strong>. Harry Potter is
              dialogue-heavy (42% dialogue, 29% action, 16% environment, 6%
              thought, 5% narration) — a conversation-driven pedagogy where
              characters explain magic by arguing, teasing, and showing off.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-8 mb-3">
              Combining the Chains
            </h3>
            <P>
              Two independent chains, orthogonal axes:{" "}
              <em>what happens</em> (LLM from narrative logic),{" "}
              <em>how intensely</em> (scene-level pacing chain), and{" "}
              <em>how it reads</em> (beat-level prose chain). Both derived
              empirically from published works.
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
              combine scenes, inserts generate new scenes to fill gaps, moves
              reposition scenes without any LLM call, cuts are omitted. World
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
                  Revise content — may change POV, location, participants,
                  deltas, and summary.
                </span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-blue-400 font-mono w-14 shrink-0">
                  merge
                </span>
                <span className="text-white/50">
                  Absorbed into another scene. Both scenes&apos; best elements
                  combined into one denser beat.
                </span>
              </div>
              <div className="flex gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/2">
                <span className="text-cyan-400 font-mono w-14 shrink-0">
                  insert
                </span>
                <span className="text-white/50">
                  New scene generated to fill a pacing gap, missing transition,
                  or stalled thread.
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
                  Content correct but wrong position. Repositioned after a
                  target scene using{" "}
                  <code className="text-blue-300/70">moveAfter</code>. No LLM
                  call — prose preserved exactly.
                </span>
              </div>
            </div>

            <P>
              Evaluations can be <B>guided</B> with external feedback — from
              another AI, a human editor, or the author&apos;s own notes. Each
              reconstruction produces a versioned branch (<em>v2</em>,{" "}
              <em>v3</em>, <em>v4</em>) — the original is never modified. The
              loop converges in 2–3 passes. Beneath branch versioning,
              individual scenes track prose and plan versions with semantic
              numbering (major/minor/patch), and structural branching uses
              git-like reference sharing so a 200-scene narrative with 10
              branches stores far fewer than 2000 scene objects.
            </P>
          </Section>

          {/* ── Classification ──────────────────────────────────────── */}
          <Section id="classification" label="Classification">
            <P>
              Classification operates at two levels: <B>propositions</B> (the
              atomic claims within prose) and <B>narratives</B> (the overall
              structural profile). Proposition classification identifies
              load-bearing content for generation. Narrative classification
              categorizes works by force dominance for comparative analysis.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">
              Propositions
            </h3>
            <P>
              Each proposition is classified by its backward and forward{" "}
              <a href="#embeddings" className="text-accent hover:underline">
                activation scores
              </a>
              . The hybrid score (
              <Tex>
                {"0.5 \\cdot \\max + 0.5 \\cdot \\bar{x}_{\\text{top-}k}"}
              </Tex>
              ) is thresholded at <B>0.65</B>, calibrated by parameter sweep
              across four structurally distinct works to maximise cross-work
              variance while preserving within-work category diversity. The
              backward/forward binary yields four categories:
            </P>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                {
                  name: "Anchor",
                  color: "#6366f1",
                  back: "HI",
                  fwd: "HI",
                  desc: "Load-bearing both directions. The structural spine — removing it collapses what comes before and after.",
                },
                {
                  name: "Seed",
                  color: "#10b981",
                  back: "LO",
                  fwd: "HI",
                  desc: "Plants forward. Weakly grounded when introduced but proves foundational later. Foreshadowing, Chekhov's gun.",
                },
                {
                  name: "Close",
                  color: "#f59e0b",
                  back: "HI",
                  fwd: "LO",
                  desc: "Resolves prior chains. Deeply earned but terminal — satisfying fate that doesn't seed further.",
                },
                {
                  name: "Texture",
                  color: "#6b7280",
                  back: "LO",
                  fwd: "LO",
                  desc: "Atmosphere, world-color, sensory grounding. Structurally inert but narratively essential.",
                },
              ].map(({ name, color, back, fwd, desc }) => (
                <div
                  key={name}
                  className="px-3 py-3 rounded-lg border border-white/6 bg-white/2"
                >
                  <div className="flex items-baseline gap-2 mb-1">
                    <span
                      className="text-[12px] font-semibold"
                      style={{ color }}
                    >
                      {name}
                    </span>
                    <span className="text-[9px] font-mono text-white/25">
                      {back} back / {fwd} fwd
                    </span>
                  </div>
                  <p className="text-[11px] text-white/40 leading-relaxed">
                    {desc}
                  </p>
                </div>
              ))}
            </div>

            <h4 className="text-sm font-semibold text-white/60 mt-6 mb-1">
              Temporal Reach
            </h4>
            <P>
              Categories tell you <B>what</B> a proposition does. Temporal reach
              tells you <B>how far</B> its connections span. The median scene
              distance of a proposition&apos;s top-k connections determines
              whether it operates <B>locally</B> (within-arc) or <B>globally</B>{" "}
              (cross-arc). The threshold scales with narrative length — 25% of
              total scenes, minimum 5 — so &ldquo;global&rdquo; means the same
              thing structurally whether the narrative has 20 scenes or 200. A
              24-scene story needs connections spanning 6+ scenes to qualify as
              global; a 73-scene novel needs 19+.
            </P>
            <P>
              Each category has a local and global variant, each with its own
              name. A <B>seed</B> is short-range foreshadowing — the Remembrall
              leading to Harry becoming Seeker one scene later. A{" "}
              <B>foreshadow</B> is Chekhov&apos;s gun — Harry&apos;s scar
              mentioned in chapter one, structurally active in the climax. A{" "}
              <B>close</B> resolves an immediate setup. An <B>ending</B>{" "}
              resolves something planted dozens of scenes ago — &ldquo;Snape
              hated Harry&apos;s father&rdquo; closing a thread from 46 scenes
              back.
            </P>
            <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
              {[
                {
                  label: "anchor",
                  color: "#6366f1",
                  desc: "Load-bearing within an arc. Immediate structural tension.",
                },
                {
                  label: "foundation",
                  color: "#4338ca",
                  desc: "Thematic spine. Connections span the full narrative.",
                },
                {
                  label: "seed",
                  color: "#10b981",
                  desc: "Pays off within an arc. Short-range foreshadowing.",
                },
                {
                  label: "foreshadow",
                  color: "#047857",
                  desc: "Pays off much later. Cross-arc Chekhov's gun.",
                },
                {
                  label: "close",
                  color: "#f59e0b",
                  desc: "Resolves recent setups. Terminal within the arc.",
                },
                {
                  label: "ending",
                  color: "#b45309",
                  desc: "Resolves distant seeds. Everything comes together.",
                },
                {
                  label: "texture",
                  color: "#6b7280",
                  desc: "Scene-level atmosphere and sensory grounding.",
                },
                {
                  label: "atmosphere",
                  color: "#4b5563",
                  desc: "Ambient world-color across time.",
                },
              ].map(({ label, color, desc }) => (
                <div key={label} className="flex items-start gap-2">
                  <div
                    className="w-0.5 min-h-6 rounded-full shrink-0 mt-0.5"
                    style={{ backgroundColor: color }}
                  />
                  <div>
                    <span className="font-medium" style={{ color }}>
                      {label}
                    </span>
                    <span className="text-white/25 ml-1.5">— {desc}</span>
                  </div>
                </div>
              ))}
            </div>

            <h4 className="text-sm font-semibold text-white/60 mt-6 mb-1">
              Causal Continuity
            </h4>
            <P>
              Classification transforms generation into{" "}
              <B>causal continuity management</B>. An LLM generating scene 45
              receives not just recent context but the specific propositions
              from scene 3 that embedding similarity identifies as structurally
              connected — the foundations and foreshadows that new prose must
              not contradict. A foreshadow in chapter one constrains what can be
              validly stated in chapter twenty.
            </P>
            <P>
              The resulting distributions align with structural expectations:{" "}
              <em>Harry Potter</em> yields 29% Anchor — consistent with a
              tightly plotted novel whose threads span the full narrative.{" "}
              <em>Alice&apos;s Adventures in Wonderland</em> shows 25% Anchor —
              lower, reflecting its episodic structure. LeCun&apos;s paper
              scores 14% Anchor and 53% Texture, characteristic of academic
              argumentation with section-local claims. A five-section methods
              paper (<em>Quantifying Narrative Force</em>) reaches 67% Texture.
              These distributions emerge from cosine similarity alone — the same
              threshold and the same formula applied uniformly across fiction,
              academic writing, and methods papers.
            </P>

            <h3 className="text-[15px] font-semibold text-white/80 mt-10 mb-3">
              Archetypes
            </h3>
            <P>
              At the narrative level, each text is classified by which forces
              dominate its profile — a force is dominant if it scores &ge; 21
              and falls within 5 points of the maximum. A &ldquo;Chronicle&rdquo;
              (World + System) and a &ldquo;Stage&rdquo; (World-driven) demand
              different pacing, thread management, and revision priorities.
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

            <h3 className="text-sm font-semibold text-white/60 mt-6 mb-1">
              Scale
            </h3>
            <P>
              Scale classifies a narrative by structural length — scenes across
              all arcs. Thresholds are derived from empirical analysis of a
              reference corpus spanning short fiction (
              <em>Alice&apos;s Adventures in Wonderland</em>, 22 scenes) through
              novels (<em>Harry Potter</em>, 73 scenes) to epic-length serials.
            </P>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-5 gap-2 text-[11px]">
              {SCALE_TIERS.map(({ key, name, desc, color }, i) => (
                <div
                  key={key}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-white/6 bg-white/2"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 18 18"
                    className="shrink-0"
                  >
                    {[0, 1, 2, 3, 4].map((j) => (
                      <rect
                        key={j}
                        x={2 + j * 3}
                        y={14 - (j + 1) * 2.4}
                        width={2}
                        height={(j + 1) * 2.4}
                        rx={0.5}
                        fill={j <= i ? color : "#ffffff10"}
                      />
                    ))}
                  </svg>
                  <div>
                    <span className="font-medium" style={{ color }}>
                      {name}
                    </span>
                    <p className="text-white/35 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 className="text-sm font-semibold text-white/60 mt-6 mb-1">
              World Density
            </h3>
            <P>
              World density measures narrative richness relative to length:
              (characters + locations + threads + system knowledge nodes) /
              scenes. Tier thresholds are derived from the same reference
              corpus, spanning genre fiction, literary fiction, and academic
              texts.
            </P>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-5 gap-2 text-[11px]">
              {DENSITY_TIERS.map(({ key, name, desc, color }, i) => (
                <div
                  key={key}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-white/6 bg-white/2"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 18 18"
                    className="shrink-0"
                  >
                    {[0, 1, 2, 3, 4].map((j) => (
                      <circle
                        key={j}
                        cx={9}
                        cy={9}
                        r={2 + j * 1.8}
                        fill="none"
                        stroke={j <= i ? color : "#ffffff10"}
                        strokeWidth={1}
                      />
                    ))}
                  </svg>
                  <div>
                    <span className="font-medium" style={{ color }}>
                      {name}
                    </span>
                    <p className="text-white/35 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Economics ──────────────────────────────────────────────── */}
          <Section id="economics" label="Economics">
            <P>
              A short story costs under a dollar; a full novel under seven; an
              open-ended serial under forty. The pipeline splits across two
              model tiers: <B>Gemini 2.5 Flash</B> (<B>$0.30/M input</B>,{" "}
              <B>$2.50/M output</B>) handles structure generation, analysis, and
              evaluation, while <B>Gemini 3 Flash</B> (<B>$0.50/M input</B>,{" "}
              <B>$3.00/M output</B>) handles beat plans and prose — the tasks
              where prose quality matters most. Input tokens dominate because
              every call sends the full narrative context, but context is capped
              by the branch time horizon (~50 scenes), so cost per arc is
              constant — arc 10 costs the same as arc 100. Reasoning is
              configurable per story from none (analysis) through low (~2K
              tokens/call, default) to high (~24K).
            </P>

            <CostEstimates />

            <P>
              Analysing a 100K-word novel into full narrative state costs
              under twenty-five cents — parallel chunk extraction, no
              reasoning. A 500K-word series runs about a dollar. Evaluating a
              branch costs five cents. At these prices, the
              generate-evaluate-revise loop becomes something to run
              repeatedly — testing prose profiles, branching strategies,
              structural constraints — and building comparative datasets
              across dozens of texts is trivial.
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
              you disagree with how we weight fate against knowledge, change the
              constant. If your genre needs a fourth force, add it. The formulas
              are tools, not doctrine.
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
