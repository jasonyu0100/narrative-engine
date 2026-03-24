/**
 * Modular prompt sections for scene and narrative generation.
 *
 * Each section is an independent block that can be composed into prompts.
 * Sections are grouped by concern for easy maintenance:
 *   - FORCE STANDARDS: reference means aligned to grading formulas
 *   - PACING: buildup/payoff balance derived from state machine analysis
 *   - MUTATIONS: how to write each mutation type
 *   - POV: point-of-view discipline
 *   - SPATIAL: location continuity
 *   - THREADS: thread lifecycle rules
 *
 * When updating: check src/lib/narrative-utils.ts FORCE_REFERENCE_MEANS
 * to keep prompt numbers in sync with grading formulas.
 * Current: { payoff: 1.5, change: 4, knowledge: 3.5 }
 */

import { THREAD_TERMINAL_STATUSES } from '@/types/narrative';
import { THREAD_LIFECYCLE_DOC } from './context';

// ── Force Standards ──────────────────────────────────────────────────────────
// Numbers here MUST match FORCE_REFERENCE_MEANS in narrative-utils.ts:
//   { payoff: 1.5, change: 4, knowledge: 3.5 }
// These are the values where the exponential grading curve scores ~86% (22/25).

export const PROMPT_FORCE_STANDARDS = `
GRADING REFERENCE MEANS — the arc average should approximate these values. Individual scenes vary above and below; the variation is essential. Graded per-arc on an exponential curve where matching the reference mean scores ~86%.
  Payoff ~1.5 | Change ~4 | Knowledge ~3.5
REUSE existing world knowledge node IDs when a scene reinforces an established concept — don't duplicate.
`;

// ── Pacing ───────────────────────────────────────────────────────────────────
// Derived from Markov chain state machine analysis of published works vs
// AI-generated series. HP: 57% buildup / 43% payoff, high variety (entropy 2.88).
// AI default without guidance: 73% payoff / 27% buildup, low variety.
//
// The delivery formula rewards this balance directly:
//   Tension = C + K - P (buildup without release)
//   Delivery = 0.5P + 0.5·tanh(C/2) + 0.5·tanh(K/2) + 0.3·contrast
//   Contrast = max(0, tension[i-1] - tension[i])
// A scene that RELEASES tension built by previous scenes scores higher on
// delivery than one that simply has high raw forces. This means buildup scenes
// directly improve the delivery score of subsequent payoff scenes.

export const PROMPT_PACING = `
PACING — common failure modes to avoid:

CHANGE MUST VARY. The most common AI failure is flat Change — every scene gets 3-4 continuity mutations and 2-3 events regardless of mode. A quiet scene with ONE character noticing ONE thing (Change ~1.0) is valid. The contrast between sparse and dense scenes creates swing. Without valleys, peaks don't register.

REVEALS NEED ROOM. If a concept is important enough to create a world-knowledge node for, the scene should sit with it — show characters reacting, questioning, being changed. Stacking 3-4 major reveals in one scene dilutes all of them.

The pacing sequence above assigns each scene a specific mode with mutation targets. Follow those assignments — they handle buildup/payoff balance and intensity variation.
`;

// ── Mutation Guidelines ──────────────────────────────────────────────────────

export const PROMPT_MUTATIONS = `
MUTATION GUIDELINES:

threadMutations — track thread status changes or engagement:
- Real transitions advance the lifecycle: dormant→active→escalating→critical→terminal.
- Pulses (same→same) indicate a scene engages a thread without shifting its phase (0.25 payoff each).
- Prefer real transitions over pulses, but pulses are valid for buildup scenes.
- Each thread must be distinct — merge threads that describe the same underlying tension.

continuityMutations — track what characters learn:
- NOT every scene requires continuity mutations. Only add them when a character genuinely learns, discovers, or realises something. A scene where characters simply act on existing knowledge needs zero continuity mutations.
- Dense scenes (reveals, confrontations): 2-3 mutations per character. Normal scenes: 0-1 total. Quiet scenes: 0.
- nodeType should be specific and contextual: "tactical_insight", "betrayal_discovered", "forbidden_technique", "political_leverage", "hidden_lineage", "oath_sworn".

relationshipMutations — track how dynamics shift:
- valenceDelta ranges: ±0.1 (subtle), ±0.2-0.3 (meaningful), ±0.4-0.5 (dramatic).
- Include whenever characters interact meaningfully. Omit in scenes where characters don't interact.

worldKnowledgeMutations — track the world's abstract structure:
- Four node types: "law" (governing truths), "system" (institutions/processes), "concept" (ideas/motifs), "tension" (contradictions/unresolved forces).
- REUSE existing node IDs when a scene reinforces or tests an established concept.
- Add edges to show HOW concepts relate: "enables", "governs", "opposes", "extends", etc.
- World-building exists in every genre — social norms, class structures, institutional hierarchies, not just magic systems.
- Let density match the scene: lore scenes 3-5+ nodes, character scenes 0-1 nodes.

events — concrete narrative happenings:
- Use specific, descriptive tags: "ambush_at_dawn", "secret_pact_formed", "storm_breaks".
- Match event count to the scene's actual action density. A conversation scene has 1 event ("tense_negotiation"). A battle has 4-5. A scene of quiet observation may have 1 ("watching_the_sunset"). Do NOT pad quiet scenes with extra events to inflate the Change score.

characterMovements — physical relocation:
- Only include characters whose location CHANGES during the scene.
- "transition" should be vivid: "Fled through the sewers", "Sailed upriver on a merchant barge".
`;

// ── POV Discipline ───────────────────────────────────────────────────────────

export const PROMPT_POV = `
POV DISCIPLINE:
- POV should come in STREAKS of 2-4 consecutive scenes before switching. Prefer AAABBA or AAABBCCC.
- Within an arc, anchor on one or two POV characters. Switch only when a different perspective unlocks something the current POV cannot access.
- A single POV for an entire arc is often the strongest choice.
`;

// ── Intra-Arc Continuity ─────────────────────────────────────────────────────
// Derived from the most common issues caught by the alignment auditor.
// These are the errors AI generation produces most frequently when scenes
// within an arc are generated without careful attention to what came before.

export const PROMPT_CONTINUITY = `
INTRA-ARC CONTINUITY — scenes within an arc must read as a continuous narrative, not independent chapters. The following are the most common generation errors:

SPATIAL:
- NEVER teleport characters. If a character is at Location A in scene N and Location B in scene N+1, scene N must end with departure OR scene N+1 must open with arrival. Use characterMovements to track this. A single line of travel grounds the reader.
- When multiple characters share a scene, establish WHERE they are relative to each other. Without spatial grounding, dialogue and action feel disembodied. "She stood across the table" not just "she said."
- Prefer revisiting established locations. Introducing a new location costs reader orientation — earn it.

STATE CARRYOVER:
- Injuries, exhaustion, emotional states, and consequences from scene N MUST persist into scene N+1. They don't need to dominate — but they must EXIST. A character who was stabbed in scene 3 cannot stretch easily in scene 4 without acknowledgment.
- If time passes between scenes, signal it: "Three days later", "By morning", "After the fever broke." Unanchored time jumps disorient readers.
- Characters cannot act on information they haven't learned yet. If a secret is revealed in scene 5, characters in scenes 1-4 cannot know it.

TRANSITIONS:
- Each scene should connect to the previous one. The opening beat of scene N+1 should acknowledge the state established at the end of scene N — emotionally, physically, or temporally.
- Abrupt mood shifts between consecutive scenes need narrative justification. Going from a funeral to a comedy scene requires a bridge — time passing, a character deliberately seeking levity, a contrast that serves the story.

AVOIDING REPETITION:
- Do NOT repeat the same beat, reveal, or emotional realization across multiple scenes. A character should not have the same epiphany twice. Information presented as new in scene 3 cannot be presented as new again in scene 5.
- Each scene must advance something — if it ends in the same state it began, it has no reason to exist.
`;

// ── Thread Lifecycle ─────────────────────────────────────────────────────────

export function promptThreadLifecycle(): string {
  return `
THREAD LIFECYCLE:
- ${THREAD_LIFECYCLE_DOC}
- When a thread's storyline concludes, transition it to a terminal status: ${THREAD_TERMINAL_STATUSES.map((s) => `"${s}"`).join(', ')}.
- Threads can regress (escalating→active) when tension eases. Not every scene ratchets upward.
- Dormant threads should be surfaced within a few scenes — don't let them sit dormant for the whole arc.
- Touch 2-4 threads per scene on average. Threads unmentioned for many scenes feel abandoned.
`;
}

// ── Summaries ────────────────────────────────────────────────────────────────

export const PROMPT_SUMMARY_REQUIREMENT = `
SUMMARIES — EVERY scene MUST have a non-empty "summary" field:
- Write 3-5 detailed sentences: name characters and locations, describe the key action and its consequence, and set up the tension for what follows.
- Vague summaries produce vague stories. Be specific and cinematic.
`;
