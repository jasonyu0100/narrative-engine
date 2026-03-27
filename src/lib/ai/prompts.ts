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
 * Current: { payoff: 1.3, change: 4, knowledge: 3.5 }
 */

import { THREAD_TERMINAL_STATUSES } from '@/types/narrative';
import type { NarrativeState, ThreadResolutionSpeed } from '@/types/narrative';
import { THREAD_LIFECYCLE_DOC } from './context';

// ── Force Standards ──────────────────────────────────────────────────────────
// Numbers here MUST match FORCE_REFERENCE_MEANS in narrative-utils.ts:
//   { payoff: 1.3, change: 4, knowledge: 3.5 }
// These are the values where the exponential grading curve scores ~86% (22/25).

export const PROMPT_FORCE_STANDARDS = `
GRADING REFERENCE MEANS — the arc average should approximate these values. Individual scenes vary above and below; the variation is essential. Graded per-arc on an exponential curve where matching the reference mean scores ~86%.
  Payoff ~1.3 | Change ~4 | Knowledge ~3.5
REUSE existing world knowledge node IDs when a scene reinforces an established concept — don't duplicate.
`;

// ── Pacing ───────────────────────────────────────────────────────────────────
// Derived from Markov chain state machine analysis of published works vs
// AI-generated series. HP: 57% buildup / 43% payoff, high mode diversity (entropy 2.88).
// AI default without guidance: 73% payoff / 27% buildup, low mode diversity.
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

DENSITY MUST VARY. The most damaging AI failure is uniform scene density — every scene tries to accomplish the same amount. A battle scene should have 4-5 events and 3+ thread mutations. A quiet observation scene should have 1 event and 0-1 mutations. The CONTRAST between dense and sparse scenes creates swing. Without valleys, peaks don't register. Aim for a 3:1 ratio — for every dense scene, write three lighter ones.

BIG MOMENTS NEED SPACE. Confrontations, betrayals, battles, and revelations deserve more events, more mutations, and longer summaries than reconnaissance, travel, or routine scenes. If a scene is the dramatic peak of an arc, pack it. If it's setup, keep it lean.

REVEALS NEED ROOM. If a concept is important enough to create a world-knowledge node for, the scene should sit with it — show characters reacting, questioning, being changed. Stacking 3-4 major reveals in one scene dilutes all of them.

NEVER REPEAT A BEAT. If a character has already "observed X and filed it away" in a previous scene, do NOT use that pattern again. If a character's fear response has been described once, the next time must show CHANGE — escalation, numbing, or a new coping mechanism. Check the scene history above: if a pattern appears more than twice, it is dead. Find a new way.

NO DUPLICATE SCENES. Before writing a scene, check the scene history. If a character has already visited a location and discovered something there, do NOT write another scene where they visit the same location and discover the same kind of thing. Every scene must advance — never re-establish.

NO CONFIRMATION SCENES. A "confirmation scene" is one where the primary purpose is for a character to witness, react to, or validate something the reader already knows. These are the #1 source of bloat in long-form generation. Examples of confirmation scenes to AVOID: "Character B learns what Character A discovered 3 scenes ago." "Tremors intensify, confirming the spring is active." "Elder X grows more suspicious." If the reader already knows the state, showing another character arriving at the same knowledge is not advancement — it is padding. The only exception is when the discovery causes that character to take an ACTION that changes the state (not just "files it away" or "grows concerned").

The pacing sequence above assigns each scene a specific mode with mutation targets. Follow those assignments — they handle buildup/payoff balance and intensity variation.
`;

// ── Thread Collision ─────────────────────────────────────────────────────────
// This is the most critical structural prompt. Without it, AI-generated
// narratives produce parallel threads that never interact — the single
// most common structural failure in long-form generation.

export const PROMPT_THREAD_COLLISION = `
STORYTELLING — how great authors weave threads:

A story is not three plots running side by side. It is one world where every character wants something, and those wants are on collision courses. The reader should feel the threads tightening around each other like cables in a rope — each one pulling the others.

Think about it this way: every active thread is a character WANTING something. When two characters want things that are incompatible — the same resource, the same person's loyalty, contradictory outcomes — the story writes itself. Your job is to set up the incompatibilities and then let the characters crash into each other.

HOW TO WEAVE:
- When writing a scene for Thread A, ask: "What is Thread B doing RIGHT NOW that could walk through this door?" If the answer is anything other than "nothing" — let it walk through the door.
- Characters from different threads should share LOCATIONS, ALLIES, and RESOURCES. When two threads need the same thing, collision is inevitable.
- Information is the most powerful collision tool. What Character A learns in Scene 3 should be exactly what Character B is trying to hide in Scene 7. The reader sees both sides; the characters don't.
- Every scene should leave the reader thinking about at least two threads — the one in focus AND the one it's about to hit.

THE COST OF ACTION: A protagonist who succeeds at everything is not a character — they are a mechanism. In every arc, something must go WRONG that the protagonist did not choose and cannot simply outmanoeuvre. The world must push back. Other characters must be competent enough to threaten the protagonist's plans through their own intelligence and agency, not through the protagonist's mistakes.

RECURRING CHARACTERS MUST CHANGE. If a character appears three times with the same reaction — same fear, same loyalty, same suspicion — they are furniture. By their third appearance, something must have shifted: they help when expected to hinder, they crack under pressure, they notice something they shouldn't. A character who never changes should stop appearing.
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

relationshipMutations — track how dynamics shift (feeds Change via √Σ|valenceDelta|):
- valenceDelta ranges: ±0.1 (subtle), ±0.2-0.3 (meaningful), ±0.4-0.5 (dramatic).
- Larger valence swings produce more Change — a betrayal weighs more than a polite exchange.
- Include whenever characters interact meaningfully. Omit in scenes where characters don't interact.

worldKnowledgeMutations — track the world's abstract structure:
- Four node types: "law" (governing truths), "system" (institutions/processes), "concept" (ideas/motifs), "tension" (contradictions/unresolved forces).
- REUSE existing node IDs when a scene reinforces or tests an established concept.
- Add edges to show HOW concepts relate: "enables", "governs", "opposes", "extends", etc.
- World-building exists in every genre — social norms, class structures, institutional hierarchies, not just magic systems.
- Let density match the scene: lore scenes 3-5+ nodes, character scenes 0-1 nodes.

ownershipMutations — track artifacts changing owners:
- fromId = current owner (character or location ID), toId = new owner (character or location ID).
- Acquisition from a location: character finds, takes, or is given an artifact that was at a place.
- Transfer between characters: gifted, stolen, traded, seized by force, surrendered under duress.
- Deposit at a location: character leaves, hides, or stores an artifact somewhere.
- Destruction: transfer to the location where it's destroyed, then add a continuityMutation on the artifact recording its destruction. Destroyed artifacts still exist as entities — their continuity tells the story.
- NOT every scene has ownership changes. Only include when a transfer is narratively meaningful.

events — concrete narrative happenings:
- Use specific, descriptive tags: "ambush_at_dawn", "secret_pact_formed", "storm_breaks".
- Match event count to the scene's actual action density. A conversation scene has 1 event ("tense_negotiation"). A battle has 4-5. A scene of quiet observation may have 1 ("watching_the_sunset"). Do NOT pad quiet scenes with extra events to inflate the Change score.

characterMovements — physical relocation:
- Only include characters whose location CHANGES during the scene.
- "transition" should be vivid: "Fled through the sewers", "Sailed upriver on a merchant barge".
`;

// ── Artifact Usage ──────────────────────────────────────────────────────────

export const PROMPT_ARTIFACTS = `
ARTIFACT USAGE:
Artifacts are narrative tools — objects that grant characters capabilities they wouldn't otherwise have. A character WITH an artifact can do things they couldn't do WITHOUT it. This is what makes artifacts worth tracking.

WHAT MAKES AN ARTIFACT:
- It changes what a character can DO: a key opens a door, a sword wins a fight, a computer accesses information, a letter proves innocence, a ring grants invisibility.
- It has VALUE that characters recognise: people scheme to acquire, protect, or destroy artifacts because of what they enable.
- It accumulates HISTORY through its continuity: forged, enchanted, broken, reforged, cursed, purified. Each state change is a continuity mutation on the artifact.
- In non-fiction: concrete examples, evidence, documents, tools, instruments — literal objects that enable or constrain what happens.

HOW TO USE ARTIFACTS IN SCENES:
- When a character uses an artifact, reference it in the scene summary and events. The artifact's continuity tells you what it can do.
- Artifact use should create consequences: using a powerful artifact draws attention, depletes a resource, or creates dependency.
- Characters should WANT artifacts and ACT to acquire them. An artifact sitting unused is a wasted narrative element.
- Artifacts at locations are discoverable — a character visiting that location can acquire one. This creates exploration incentives.
- When an artifact is destroyed or fundamentally altered, add a continuityMutation to the artifact (characterId = artifact ID, action = "added", content = what happened to it).

DO NOT:
- Create artifacts for mundane objects with no narrative function.
- Let artifacts exist without anyone caring about them. If no character wants it, it shouldn't be an artifact.
- Forget that artifacts have continuity — their state evolves. A broken sword is different from an intact one.
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
- Write 3-5 detailed sentences that answer HOW things happen, not just WHAT happens.
- Bad: "A confrontation occurs and tensions rise." Good: "Kael slams the forged treaty onto the table in front of the full council, forcing Mira to either deny her signature or admit the alliance was a trap. She chooses silence — which tells everyone in the room more than any denial could."
- Every summary sentence should contain a specific action, a named character, and a consequence. Abstract descriptions ("tensions rise", "bonds deepen", "secrets emerge") are failures — replace them with the concrete mechanism.
- SCALE THE SUMMARY TO THE SCENE'S WEIGHT. A pivotal confrontation deserves 5 rich sentences. A quiet transition needs 2-3.
- NEVER use passive observation language ("observes and files away", "notes for future leverage", "begins to suspect"). Show characters ACTING — making choices, taking risks, paying costs.
`;

// ── Character Arc Discipline ─────────────────────────────────────────────────

export const PROMPT_CHARACTER_ARCS = `
CHARACTER ARC DISCIPLINE:
- Characters who appear in 3+ consecutive scenes MUST show visible change between their first and last appearance in this arc. Change means: a belief shifts, a relationship breaks or deepens, a capability is gained or lost, an emotional state transforms.
- A character who ends an arc in the same internal state they started is a FAILURE — even if the plot advanced around them. The reader needs to feel that scenes cost something.
- Protagonists who succeed at everything without cost become uninteresting. At least one plan per arc must go wrong in a way that forces genuine adaptation, not just tactical adjustment.
- Secondary characters must not be atmospheric props. If a character appears in multiple scenes with the same reaction (same fear, same loyalty, same suspicion), they must CHANGE or be removed from the scene.
- Every arc should contain at least one moment where a character's action in Thread A creates an unintended consequence in Thread B. This is how threads collide.
`;

// ── Thread Health Analysis ──────────────────────────────────────────────────

const PHASE_INDEX: Record<string, number> = { dormant: 0, active: 1, escalating: 2, critical: 3, resolved: 4, subverted: 4, abandoned: 4 };

/** Resolution speed standards — guidelines, not mechanical rules.
 *  Some threads naturally run longer (a rivalry across a novel) while
 *  others resolve in a few scenes (a minor subplot). These standards
 *  set expectations so the LLM can judge which threads need attention. */
const SPEED_STANDARDS: Record<ThreadResolutionSpeed, { benchmark: number; label: string }> = {
  slow: { benchmark: 10, label: 'Slow burn — threads develop gradually, ~10 scenes between transitions' },
  moderate: { benchmark: 6, label: 'Balanced — steady progression, ~6 scenes between transitions' },
  fast: { benchmark: 4, label: 'Thriller — threads escalate quickly, ~4 scenes between transitions' },
};

/**
 * Build a data-driven thread health report for the LLM.
 * Surfaces velocity metrics so the LLM can make intelligent decisions
 * about which threads to accelerate, sustain, or abandon.
 */
export function buildThreadHealthPrompt(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  speed: ThreadResolutionSpeed,
): string {
  const standard = SPEED_STANDARDS[speed];
  const terminalStatuses = new Set(THREAD_TERMINAL_STATUSES as readonly string[]);

  // ── Compute per-thread metrics from scene history ──────────────────────
  type ThreadMetrics = {
    transitions: number;      // real status changes (not pulses)
    pulses: number;           // same→same mentions
    totalMutations: number;
    scenesSinceLastTransition: number;
    transitionHistory: string[]; // e.g. ["dormant→active (scene 5)", "active→escalating (scene 12)"]
  };

  const metrics: Record<string, ThreadMetrics> = {};
  const threadFirstSeen: Record<string, number> = {};
  let sceneCount = 0;

  for (let i = 0; i <= currentIndex && i < resolvedKeys.length; i++) {
    const scene = narrative.scenes[resolvedKeys[i]];
    if (!scene) continue;
    sceneCount++;

    for (const tm of scene.threadMutations) {
      if (!metrics[tm.threadId]) {
        metrics[tm.threadId] = { transitions: 0, pulses: 0, totalMutations: 0, scenesSinceLastTransition: 0, transitionHistory: [] };
      }
      const m = metrics[tm.threadId];
      m.totalMutations++;
      if (threadFirstSeen[tm.threadId] === undefined) threadFirstSeen[tm.threadId] = sceneCount;

      if (tm.from === tm.to) {
        m.pulses++;
      } else {
        m.transitions++;
        m.scenesSinceLastTransition = 0;
        m.transitionHistory.push(`${tm.from}→${tm.to} (scene ${sceneCount})`);
      }
    }

    // Increment scenes-since-last-transition for all tracked threads
    for (const m of Object.values(metrics)) {
      m.scenesSinceLastTransition++;
    }
  }

  // ── Build per-thread report ────────────────────────────────────────────
  const lines: string[] = [
    `THREAD VELOCITY REPORT (resolution pace: ${speed.toUpperCase()})`,
    `${standard.label}. Benchmark: ~${standard.benchmark} scenes between status transitions.`,
    '',
  ];

  const allThreads = Object.values(narrative.threads);
  const resolved = allThreads.filter((t) => terminalStatuses.has(t.status));
  const active = allThreads.filter((t) => !terminalStatuses.has(t.status));

  if (active.length === 0 && resolved.length === 0) return '';

  // Sort active threads: longest since last transition first (most attention needed)
  const sortedActive = active
    .map((t) => {
      const m = metrics[t.id] ?? { transitions: 0, pulses: 0, totalMutations: 0, scenesSinceLastTransition: 0, transitionHistory: [] };
      const age = threadFirstSeen[t.id] !== undefined ? sceneCount - threadFirstSeen[t.id] + 1 : 0;
      const pulseRatio = m.totalMutations > 0 ? m.pulses / m.totalMutations : 0;
      const velocity = age > 0 ? m.transitions / age : 0; // transitions per scene
      return { ...t, m, age, pulseRatio, velocity };
    })
    .sort((a, b) => b.m.scenesSinceLastTransition - a.m.scenesSinceLastTransition);

  for (const t of sortedActive) {
    const phaseIdx = PHASE_INDEX[t.status] ?? 0;
    const statusLabel = `${t.status} (phase ${phaseIdx}/4)`;
    const velocityLabel = t.velocity > 0 ? (t.velocity * 10).toFixed(1) + ' transitions per 10 scenes' : 'no transitions yet';
    const sinceLabel = t.m.scenesSinceLastTransition > standard.benchmark
      ? `⚠ ${t.m.scenesSinceLastTransition} scenes since last transition (benchmark: ${standard.benchmark})`
      : `${t.m.scenesSinceLastTransition} scenes since last transition`;
    const history = t.m.transitionHistory.length > 0
      ? `History: ${t.m.transitionHistory.join(' → ')}`
      : 'No transitions yet — still at initial status';

    // Strengthened pulse ratio warning with concrete details
    let pulseBlock = '';
    if (t.pulseRatio > 0.8 && t.m.totalMutations >= 3) {
      const lastTransition = t.m.transitionHistory.length > 0
        ? t.m.transitionHistory[t.m.transitionHistory.length - 1]
        : 'none';
      pulseBlock = `  ⚠ HIGH PULSE RATIO (${t.m.pulses} pulses, ${t.m.transitions} transitions) — touched ${t.m.totalMutations} times but barely progressing.\n    Last real change: ${lastTransition}. Since then, only pulsed ${t.m.pulses} times.\n    REQUIRED: Next mention MUST be a real transition. Either advance to next phase or resolve/abandon. No more pulses.`;
    }

    lines.push(`"${t.description}" [${t.id}]`);
    lines.push(`  Status: ${statusLabel} | Age: ${t.age} scenes | Mutations: ${t.m.totalMutations} (${t.m.transitions} transitions, ${t.m.pulses} pulses)`);
    lines.push(`  Velocity: ${velocityLabel} | ${sinceLabel}`);
    if (pulseBlock) lines.push(pulseBlock);
    lines.push(`  ${history}`);
    lines.push('');
  }

  // Summary
  lines.push(`RESOLUTION PROGRESS: ${resolved.length}/${allThreads.length} threads resolved, ${active.length} active.`);
  if (resolved.length > 0) {
    lines.push(`Resolved: ${resolved.map((t) => `"${t.description}" [${t.status}]`).join(', ')}`);
  }

  // Standards reminder
  lines.push('');
  lines.push('STANDARDS (guidelines, not rules — use judgment based on each thread\'s narrative weight):');
  lines.push(`- Threads sitting at the same status for >${standard.benchmark} scenes need attention: transition, escalate, or abandon.`);
  lines.push('- High pulse ratio (>80% pulses vs transitions) means a thread is being referenced but not progressing — push it forward or let it go.');
  lines.push('- Major threads can run longer than the benchmark. Minor subplots should resolve faster.');
  lines.push('- Every arc should advance at least one thread by one phase. Zero-progress arcs waste reader patience.');

  return lines.join('\n');
}

// ── Completed Beats (State-Locking) ─────────────────────────────────────────

/**
 * Extract irreversible state transitions from scene history and format them
 * as a "SPENT BEATS" prompt section. This tells the LLM what narrative
 * territory is already cashed in and must not be restaged.
 *
 * Extracts:
 * - Thread transition chains (real status changes, not pulses)
 * - Scene summaries at transition points (the concrete beats)
 */
export function buildCompletedBeatsPrompt(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  const terminalStatuses = new Set(THREAD_TERMINAL_STATUSES as readonly string[]);

  // ── Collect thread transitions with their scene summaries ──────────────
  type Beat = { sceneIdx: number; from: string; to: string; summary: string; events: string[] };
  const threadBeats: Record<string, Beat[]> = {};

  let sceneIdx = 0;
  for (let i = 0; i <= currentIndex && i < resolvedKeys.length; i++) {
    const scene = narrative.scenes[resolvedKeys[i]];
    if (!scene) continue;
    sceneIdx++;

    for (const tm of scene.threadMutations) {
      if (tm.from === tm.to) continue; // pulse — not a beat
      if (!threadBeats[tm.threadId]) threadBeats[tm.threadId] = [];
      threadBeats[tm.threadId].push({
        sceneIdx,
        from: tm.from,
        to: tm.to,
        summary: scene.summary?.slice(0, 120) ?? '',
        events: scene.events?.slice(0, 3) ?? [],
      });
    }
  }

  // ── Build the prompt block ─────────────────────────────────────────────
  const threadIds = Object.keys(threadBeats).filter((id) => threadBeats[id].length > 0);
  if (threadIds.length === 0) return '';

  const lines: string[] = [
    'SPENT BEATS — these state transitions have already occurred and their ENTIRE narrative territory is CLOSED.',
    'This means: do NOT restage, re-discover, re-reveal, re-confirm, re-witness from another angle, or write "deepening" scenes that observe the same state without changing it.',
    'A scene where a character reacts to a known state, confirms a known fact, or witnesses something the reader already knows is NOT advancement — it is repetition.',
    'The ONLY valid next scene for a completed beat is one that CHANGES the state: a new complication, a reversal, a cost, an interference, a consequence that opens new territory.',
    '',
  ];

  for (const tid of threadIds) {
    const thread = narrative.threads[tid];
    if (!thread) continue;
    const beats = threadBeats[tid];

    // Build transition chain: dormant→active (scene 6) → escalating (scene 15)
    const chain = beats.map((b) => `${b.to} (scene ${b.sceneIdx})`).join(' → ');
    const isTerminal = terminalStatuses.has(thread.status);
    const label = isTerminal ? `[${thread.status.toUpperCase()}]` : `[current: ${thread.status}]`;

    lines.push(`"${thread.description}" [${tid}] ${label}`);
    lines.push(`  Chain: ${beats[0].from} → ${chain}`);

    // Show the concrete beat at each transition (what actually happened)
    for (const b of beats) {
      const eventStr = b.events.length > 0 ? b.events.join(', ') : '';
      const beatLine = b.summary
        ? `  Scene ${b.sceneIdx} (${b.from}→${b.to}): ${b.summary}${eventStr ? ` [${eventStr}]` : ''}`
        : `  Scene ${b.sceneIdx}: ${b.from}→${b.to}${eventStr ? ` [${eventStr}]` : ''}`;
      lines.push(beatLine);
    }
    lines.push('');
  }

  lines.push('ANTI-CONFIRMATION RULE: Once a beat is listed above, no further scenes may:');
  lines.push('  - Show another character discovering/witnessing/reacting to the same event');
  lines.push('  - Deepen or confirm the same state ("suspicion grows", "tremor intensifies", "alliance solidifies")');
  lines.push('  - Reframe the same transition from a different POV');
  lines.push('Instead, the NEXT scene involving this thread MUST introduce a NEW state variable: interference, cost, reversal, escalation to a genuinely new phase, or an unintended consequence that opens a different narrative lane.');

  return lines.join('\n');
}

