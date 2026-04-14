/**
 * Critical prompt invariants.
 *
 * This file intentionally does NOT freeze prompt wording. Prompt language is
 * under active refinement (taste, register, cultural breadth). Phrase-level
 * assertions produce churn without protecting anything load-bearing.
 *
 * What IS load-bearing — and therefore guarded here:
 *   1. Thread-lifecycle vocabulary contract. The LLM emits JSON with
 *      status values; if the prompt stops enumerating the full set, or
 *      stops explicitly distinguishing "pulse" (log type) from statuses,
 *      downstream validation will silently break.
 *   2. Beat taxonomy count invariant. Generated beat plans are validated
 *      against BEAT_FN_LIST and BEAT_MECHANISM_LIST. The prompt must
 *      advertise the SAME set and COUNT, or the LLM will produce plans
 *      that fail validation.
 *   3. Delta schema contract. The prompt names every delta type the
 *      reducer expects. Drift here = LLM output the code can't consume.
 *
 * Broader wording/taste guards live in core-language.test.ts (canonical
 * vocabulary, forbidden fiction-default drift).
 */

import {
  PROMPT_BEAT_TAXONOMY,
  PROMPT_DELTAS,
  promptThreadLifecycle,
  buildBranchReviewPrompt,
  buildProseReviewPrompt,
  buildPlanReviewPrompt,
  REPORT_ANALYSIS_PROMPT,
  REPORT_SECTIONS,
  buildReconcileEntitiesPrompt,
  buildReconcileSemanticPrompt,
  buildThreadingPrompt,
  buildSceneStructurePrompt,
  buildScenePlanSystemPrompt,
  buildBeatAnalystSystemPrompt,
} from "@/lib/ai/prompts";
import {
  BEAT_FN_LIST,
  BEAT_MECHANISM_LIST,
  THREAD_ACTIVE_STATUSES,
  THREAD_TERMINAL_STATUSES,
  THREAD_LOG_NODE_TYPES,
} from "@/types/narrative";
import { describe, expect, it } from "vitest";

// Verdict enums — kept in sync with SceneVerdict / ProseVerdict / PlanVerdict
// in src/types/narrative.ts. If the types there change, update here and the
// test will catch any prompt that hasn't been updated to match.
const SCENE_VERDICTS = ["ok", "edit", "merge", "cut", "insert", "move"] as const;
const PROSE_VERDICTS = ["ok", "edit"] as const;
const PLAN_VERDICTS = ["ok", "edit"] as const;

describe("Thread lifecycle vocabulary contract", () => {
  // Every status the code recognises must appear in the delta prompt,
  // otherwise the LLM can't be expected to emit it correctly.
  const ALL_STATUSES = [
    ...THREAD_ACTIVE_STATUSES,
    ...THREAD_TERMINAL_STATUSES,
    "abandoned",
  ];

  it("PROMPT_DELTAS advertises every status the reducer accepts", () => {
    for (const status of ALL_STATUSES) {
      expect(PROMPT_DELTAS).toContain(status);
    }
  });

  it("PROMPT_DELTAS explicitly forbids the pulse-as-status confusion", () => {
    // "pulse" is a log node type, not a status. The prompt must say so
    // because the two sit side-by-side in the schema and LLMs confuse them.
    expect(PROMPT_DELTAS).toMatch(/pulse.{0,10}NOT.{0,10}status/i);
  });

  it("promptThreadLifecycle exposes the full active lifecycle", () => {
    const doc = promptThreadLifecycle();
    for (const status of THREAD_ACTIVE_STATUSES) {
      expect(doc).toContain(status);
    }
  });
});

describe("Beat taxonomy count invariant", () => {
  // The LLM plan validator accepts exactly BEAT_FN_LIST and
  // BEAT_MECHANISM_LIST. If the prompt advertises a different set, plans
  // fail validation — silent churn. Cross-check against the type system.

  it("PROMPT_BEAT_TAXONOMY lists every beat function the validator accepts", () => {
    for (const fn of BEAT_FN_LIST) {
      expect(PROMPT_BEAT_TAXONOMY).toContain(fn);
    }
  });

  it("PROMPT_BEAT_TAXONOMY lists every mechanism the validator accepts", () => {
    for (const mech of BEAT_MECHANISM_LIST) {
      expect(PROMPT_BEAT_TAXONOMY).toContain(mech);
    }
  });

  it("advertised counts match the type system", () => {
    // If BEAT_FN_LIST grows from 10 to 11, either update the prompt header
    // or update this test — but not silently.
    expect(PROMPT_BEAT_TAXONOMY).toContain(`FUNCTIONS (${BEAT_FN_LIST.length})`);
    expect(PROMPT_BEAT_TAXONOMY).toContain(`MECHANISMS (${BEAT_MECHANISM_LIST.length})`);
  });
});

describe("Delta schema contract", () => {
  // The prompt must name every delta field the scene reducer consumes.
  const DELTA_FIELDS = [
    "threadDeltas",
    "worldDeltas",
    "systemDeltas",
    "relationshipDeltas",
    "events",
    "artifactUsages",
    "ownershipDeltas",
    "characterMovements",
  ];

  for (const field of DELTA_FIELDS) {
    it(`PROMPT_DELTAS advertises ${field}`, () => {
      expect(PROMPT_DELTAS).toContain(field);
    });
  }
});

describe("Review verdict contract", () => {
  // Review prompts must advertise every verdict the reducer handles. If the
  // prompt drops a verdict, the LLM stops emitting it and downstream scene
  // edits silently never fire — no error, just missing edits.

  const branchPrompt = buildBranchReviewPrompt({
    title: "Test",
    description: "Test",
    threadBlock: "",
    sceneBlock: "",
    sceneCount: 0,
    guidanceBlock: "",
  });
  const prosePrompt = buildProseReviewPrompt({
    title: "Test",
    sceneBlocks: "",
    sceneCount: 0,
    guidanceBlock: "",
    profileBlock: "",
  });
  const planPrompt = buildPlanReviewPrompt({
    title: "Test",
    threadBlock: "",
    charBlock: "",
    sceneBlocks: "",
    sceneCount: 0,
    guidanceBlock: "",
  });

  for (const verdict of SCENE_VERDICTS) {
    it(`branch review prompt advertises "${verdict}" verdict`, () => {
      expect(branchPrompt).toContain(`"${verdict}"`);
    });
  }

  for (const verdict of PROSE_VERDICTS) {
    it(`prose review prompt advertises "${verdict}" verdict`, () => {
      expect(prosePrompt).toContain(`"${verdict}"`);
    });
  }

  for (const verdict of PLAN_VERDICTS) {
    it(`plan review prompt advertises "${verdict}" verdict`, () => {
      expect(planPrompt).toContain(`"${verdict}"`);
    });
  }
});

describe("Reconciliation output-key contract", () => {
  // Reconcile prompts emit a fixed set of top-level JSON keys. The parser
  // in src/lib/text-analysis.ts reads them by literal name with `?? {}`
  // defaults, so a drifted key silently produces an empty merge map —
  // deduplication silently stops working with no runtime error.

  it("buildReconcileEntitiesPrompt advertises every merge-map key", () => {
    const prompt = buildReconcileEntitiesPrompt(
      new Set(["X"]),
      new Set(["Y"]),
      new Set(["Z"]),
    );
    for (const key of ["characterMerges", "locationMerges", "artifactMerges"]) {
      expect(prompt).toContain(`"${key}"`);
    }
  });

  it("buildReconcileSemanticPrompt advertises every merge-map key", () => {
    const prompt = buildReconcileSemanticPrompt(new Set(["X"]), new Set(["Y"]));
    for (const key of ["threadMerges", "systemMerges"]) {
      expect(prompt).toContain(`"${key}"`);
    }
  });

  it("buildThreadingPrompt advertises threadDependencies key", () => {
    const prompt = buildThreadingPrompt(["thread a"]);
    expect(prompt).toContain('"threadDependencies"');
  });
});

describe("Scene-structure extraction schema contract", () => {
  // Scene extraction is the widest blast radius: the parser in
  // src/lib/text-analysis.ts defaults every field to [] / "". A field
  // renamed in the prompt but not the parser = silent empty pipeline.
  const prompt = buildSceneStructurePrompt("Some prose.", null);

  const SCHEMA_FIELDS = [
    "povName",
    "locationName",
    "participantNames",
    "events",
    "summary",
    "characters",
    "locations",
    "artifacts",
    "threads",
    "relationships",
    "threadDeltas",
    "worldDeltas",
    "relationshipDeltas",
    "artifactUsages",
    "ownershipDeltas",
    "tieDeltas",
    "characterMovements",
    "systemDeltas",
  ];

  for (const field of SCHEMA_FIELDS) {
    it(`advertises ${field}`, () => {
      expect(prompt).toContain(`"${field}"`);
    });
  }

  it("advertises every thread-log node type", () => {
    // THREAD_LOG_NODE_TYPES is consumed by the reducer, the report
    // generator, and downstream analysis. A dropped member here silently
    // disables that log type for extraction.
    for (const type of THREAD_LOG_NODE_TYPES) {
      expect(prompt).toContain(type);
    }
  });
});

describe("Scene-plan + beat-analyst schema contract", () => {
  // Both prompts emit {beats: [{fn, mechanism, what, propositions: [{content}]}]}.
  // fn/mechanism are already guarded via the beat-taxonomy cross-check. The
  // field names themselves aren't — a rename silently zeros out the beat's
  // `what` (empty prose brief) or `propositions` (no factual anchors).
  const planPrompt = buildScenePlanSystemPrompt(3);
  const analystPrompt = buildBeatAnalystSystemPrompt(3);

  for (const field of ["beats", "fn", "mechanism", "what", "propositions", "content"]) {
    it(`buildScenePlanSystemPrompt advertises ${field}`, () => {
      expect(planPrompt).toContain(`"${field}"`);
    });
    it(`buildBeatAnalystSystemPrompt advertises ${field}`, () => {
      expect(analystPrompt).toContain(`"${field}"`);
    });
  }

  it("beat-analyst prompt enforces chunk↔beat length invariance", () => {
    // The parser pairs output beats to input chunks by index. If the prompt
    // stops saying the arrays must be equal length, outputs silently
    // mis-align.
    expect(analystPrompt).toMatch(/same length|one beat per chunk|EXACTLY 3 beats/i);
  });
});

describe("Report section contract", () => {
  // REPORT_ANALYSIS_PROMPT defines the JSON the LLM returns. REPORT_SECTIONS
  // is the reducer's expectation. They must stay in sync — a missing key in
  // the prompt returns an empty string for that section without any error.
  const prompt = REPORT_ANALYSIS_PROMPT("<<test context>>");

  for (const key of REPORT_SECTIONS) {
    it(`REPORT_ANALYSIS_PROMPT names the "${key}" section`, () => {
      expect(prompt).toContain(`"${key}"`);
    });
  }
});
