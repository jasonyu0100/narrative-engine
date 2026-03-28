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
FORCE SCORING — the arc is graded on an exponential curve. These reference means score ~86% (22/25). Hitting them consistently produces 80+ scores. Falling short produces 60s-70s.
  Payoff ~1.3 per scene | Change ~4 per scene | Knowledge ~3.5 per scene

What this means in practice:
- PAYOFF ~1.3: Each scene needs ~1-2 thread transitions averaging ~1 phase jump, OR several pulses. An arc of 5 scenes with zero thread transitions will score near 0 on Payoff.
- CHANGE ~4: Each scene needs a combination of ~3-4 continuity mutations + ~2-3 events + meaningful relationship shifts (valenceDelta ±0.2+). Thin scenes with 1 event and 0 mutations score ~1-2 on Change.
- KNOWLEDGE ~3.5: Each scene needs ~2-3 new world knowledge nodes + edges connecting them. Arcs that add zero world knowledge score 0 on Knowledge.

These are the MOST COMMON reason for low scores. If your scenes have thin mutations, the forces will be low regardless of how good the summaries are.
REUSE existing world knowledge node IDs when reinforcing established concepts — don't duplicate.
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
PACING:
- DENSITY MUST VARY. Battle scenes: 4-5 events, 3+ mutations. Quiet scenes: 1 event, 0-1 mutations. Uniform density is the #1 AI failure.
- BIG MOMENTS NEED SPACE. Confrontations and revelations get packed scenes. Setup and travel get lean ones.
- NO CONFIRMATION SCENES. If the reader already knows a fact, don't write a scene where another character discovers it. The ONLY exception: if that character's discovery triggers an IRREVERSIBLE action (they betray someone, destroy something, form an alliance, attack) — and the scene is about the ACTION, not the discovery. "Character B learns what Character A learned" is always padding. "Character B learns it and immediately burns the evidence" might be a scene — but only if the burning has consequences.
- THREAD COMPRESSION. Each thread gets ONE scene per status transition. If a thread needs 3 more transitions, it gets 3 scenes — not 8 scenes with 5 filler variations. A scene where a thread appears but doesn't change status is filler. Delete it.
- MINIMUM COLLISIONS. At least half the scenes must advance 2+ threads simultaneously. Use the arcOutline.collisionPlan to pre-commit to these.

BEFORE RETURNING — scan all scenes as a set:
- If two scenes share the same action type in the same thread (both "discover", both "confront", both "infiltrate"), merge them.
- If an event happened in scene N, it CANNOT happen again in scene M. A leader deposed once stays deposed. An artifact found once stays found. A raid that succeeded once does not succeed again.
- If a character has the same confrontation with the same person twice, delete the duplicate or escalate structurally (argue → betray → consequences).
- No thread may appear in more than 3 scenes without a status transition between appearances.

REPEATED SCENE STRUCTURES — the most common AI failure is writing scenes that have different events but the SAME DRAMATIC SHAPE. Catch these:
- CHARACTER A CONFRONTS CHARACTER B, CHARACTER B DEFLECTS — if this shape happened once, the next scene between them MUST have a different power dynamic (A has new leverage, B cracks, a third party intervenes, one of them takes an irreversible action). Two "A argues, B dismisses" scenes = one too many.
- INVESTIGATOR DISCOVERS CLUE, ADVERSARY RETREATS/RECALCULATES — if this happened once, the next investigation scene must change the dynamic (investigator gets caught, adversary attacks instead of retreating, the clue leads to a trap, a third party disrupts both).
- OBSERVER CHARACTER WATCHES AND TAKES NOTES — a character who appears in multiple scenes only to observe, document, or "resolve to act later" is dead weight after their first appearance. By their second scene, they must ACT on what they observed — confront someone, sabotage something, form an alliance, leak information. "Scribbling in a ledger" or "retreating to recalculate" is not a scene-worthy action after the first time.
- CHARACTER RETREATS / RECALCULATES / RE-EVALUATES — this is the #1 wasted scene ending. A character retreating is not advancement. If a scene ends with a retreat, the NEXT scene for that character must open with the result of the recalculation — an action, not another retreat.

Follow the pacing sequence mode assignments above for buildup/payoff balance.
`;

// ── Thread Collision ─────────────────────────────────────────────────────────
// This is the most critical structural prompt. Without it, AI-generated
// narratives produce parallel threads that never interact — the single
// most common structural failure in long-form generation.

export const PROMPT_THREAD_COLLISION = `
THREAD COLLISION:
- A story is one world where every character's wants are on collision courses. When writing a scene for Thread A, ask: "What is Thread B doing RIGHT NOW that could walk through this door?" If the answer isn't "nothing" — let it in.
- Characters from different threads must share LOCATIONS, ALLIES, and RESOURCES. When two threads need the same thing, collision is inevitable.
- Information is the strongest collision tool. What Character A learns in Scene 3 should be what Character B is trying to hide in Scene 7.
- MECHANICAL MINIMUM: At least HALF your scenes must have threadMutations touching 2+ threads. If you're writing 3+ single-thread scenes in a row, you're writing parallel plots — collide them.
- COST OF ACTION: In every arc, something must go WRONG that the protagonist did not choose. The world must push back through other characters' competence, not the protagonist's mistakes.
- RECURRING CHARACTERS MUST CHANGE. If a character appears three times with the same reaction, they are furniture. By their third appearance, something must have shifted.
`;

// ── Mutation Guidelines ──────────────────────────────────────────────────────

export const PROMPT_MUTATIONS = `
MUTATIONS — these are what produce force scores. Thin mutations = low scores.

threadMutations — lifecycle: dormant→active→escalating→critical→terminal. Pulses (same→same) = 0.25 payoff each.
- Prefer real transitions over pulses. Each arc should have multiple real transitions.
- CONVERGENCE CASCADE: advancing a convergent thread should pressure its linked threads (at minimum a pulse).

continuityMutations — what characters learn. These directly feed Change score.
- Dense scenes (reveals, confrontations): 2-3 per character. Normal scenes: 0-1 total. Quiet scenes: 0.
- nodeType should be specific: "tactical_insight", "betrayal_discovered", "forbidden_technique", "political_leverage".
- A scene with 0 continuity mutations, 1 event, and no relationship shifts will score ~1 on Change. That's a failing score.

relationshipMutations — valenceDelta: ±0.1 (subtle), ±0.2-0.3 (meaningful), ±0.4-0.5 (dramatic).
- Include whenever characters interact meaningfully. These feed Change via √Σ|valenceDelta|.

worldKnowledgeMutations — types: "law", "system", "concept", "tension". REUSE existing node IDs when reinforcing established concepts.
- Lore/revelation scenes: 3-5+ nodes. Character scenes: 0-1 nodes.
- World knowledge is the #1 under-generated mutation type. Most scenes should add at least 1 node unless they are pure character interaction.
- Add edges to show HOW concepts relate: "enables", "governs", "opposes", "extends".

ownershipMutations — artifacts changing hands. Only include when narratively meaningful.

events — specific tags ("ambush_at_dawn", "secret_pact_formed"). Match count to density: conversation=1, battle=4-5. Don't pad quiet scenes.

characterMovements — only characters whose location CHANGES. Transition should be vivid.
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
CONTINUITY:
- NEVER teleport characters. Use characterMovements to track location changes. Prefer revisiting established locations.
- Injuries, exhaustion, and consequences from scene N persist into scene N+1. Characters cannot act on information they haven't learned yet.
- Signal time gaps: "Three days later", "By morning". Each scene should connect to the previous one.

REPETITION (the #1 quality killer):
- An event that happened on-screen CANNOT be re-narrated or re-described in any later scene.
- Exploration/discovery gets ONE scene per arc. Combine all investigation into one dense scene.
- If A confronted B before, their next meeting must have a fundamentally different dramatic shape.
- Each scene must end in a different state than it began. If nothing changed, delete it.
- A scene ending in retreat/recalculation/re-evaluation has NOT earned its existence. Write the ACTION the recalculation produces, not the recalculation itself.
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
SUMMARY RULES:
- Write 3-5 RICH, DETAILED sentences. Every sentence: [Named Character] + [physical action verb] + [concrete consequence].
- SCALE TO THE SCENE'S WEIGHT. A pivotal confrontation deserves 5 rich sentences with specific details — names, objects, locations, dialogue snippets, physical consequences. A quiet transition needs 3. Never write thin, generic summaries.
- Include SPECIFICS: what object is handed over, what words are spoken, what physical thing breaks or changes, what the character does with their body. Vague summaries ("he triggered a formation") fail — specific summaries ("he pressed three primeval stones into the east-facing slots of the Monk's formation, causing the central pillar to split and reveal a jade scroll") succeed.
- EXAMPLE OF GOOD RICHNESS: "Michael Corleone sits across from Sollozzo and McCluskey at the small Italian restaurant in the Bronx, listening to terms he has no intention of accepting. He excuses himself to the bathroom where a pistol has been planted behind the toilet tank. He returns to the table and shoots both men — Sollozzo first between the eyes, then McCluskey through the throat as wine sprays across the white tablecloth. The gun clatters to the floor as Michael walks out in a daze to a waiting car. The killing severs him permanently from his civilian life and hands the Tattaglia family a casus belli they have wanted for months."

QUALITY RULES:
1. BANNED main verbs: realizes, recognizes, confirms, understands, senses, feels, suspects, observes, watches, notes, decides (internally), resolved (to act). If a character realizes something, write what they DO next — not the realization itself.
2. BANNED sentence endings: emotions, internal states, abstract consequences, future intentions. These all fail:
   × "...confirming her suspicions of his ambition" — write what she DOES with the suspicion
   × "...solidifying the shift in political power" — write the concrete result (who now controls what)
   × "...she resolved to seek out further discrepancies" — write her SEEKING them, not resolving to
   × "...recalculating her plans" — write the NEW plan, not the act of recalculating
   × "...a growing unease settled in his chest" — write the action the unease produces
3. BANNED modifiers: "face etched with...", "expression unreadable", "eyes gleaming with...", "emboldened by...", "a testament to...", "a reminder of...". Show emotion through action.
4. NO DUPLICATE ACTIONS across scenes. An action in scene 3 cannot repeat in scene 11.
`;

// ── Character Arc Discipline ─────────────────────────────────────────────────

export const PROMPT_CHARACTER_ARCS = `
CHARACTER ARC DISCIPLINE:
- Characters who appear in 3+ scenes MUST show visible change between their first and last appearance. Change means: a belief shifts, a relationship breaks or deepens, a capability is gained or lost, a position of power changes.
- A character who ends an arc in the same internal state they started is a FAILURE — even if the plot advanced around them.
- Protagonists who succeed at everything without cost become uninteresting. At least one plan per arc must go wrong in a way that forces genuine adaptation.
- Every arc should contain at least one moment where a character's action in Thread A creates an unintended consequence in Thread B.

QUALITY OF SCREEN TIME — each scene a character appears in must earn their presence:
- Every appearance must give the character a DIFFERENT action from their previous one. If a character investigated in scene 3, they must act on findings in scene 7 — not investigate again. If they argued in scene 2, they must escalate, capitulate, or change tactics in scene 6 — not argue the same way.
- A character whose role in a scene is to observe, react, or "take notes" is not earning screen time. Either give them an action that changes the state, or remove them from the participant list. Watchers and note-takers are not characters — they are cameras.
- When a character appears in a scene, ask: "What can ONLY this character do here?" If any other character could fill their role, they shouldn't be in the scene.
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
    // Show convergence links — threads that depend on this one or that this one depends on
    if (t.dependents.length > 0) {
      const depDescs = t.dependents
        .map((depId) => narrative.threads[depId])
        .filter(Boolean)
        .map((dep) => `"${dep.description}" [${dep.id}]`);
      if (depDescs.length > 0) {
        lines.push(`  ↔ CONVERGES WITH: ${depDescs.join(', ')} — advancing this thread should pressure those threads too`);
      }
    }
    // Show reverse links — threads that list this one as a dependent
    const reverseLinks = allThreads.filter((other) => other.id !== t.id && other.dependents.includes(t.id));
    if (reverseLinks.length > 0) {
      lines.push(`  ← CONNECTED FROM: ${reverseLinks.map((r) => `"${r.description}" [${r.id}]`).join(', ')}`);
    }
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
  lines.push('  - Write another scene with the SAME DRAMATIC SHAPE (A confronts B and B deflects; investigator finds clue and adversary retreats)');
  lines.push('The ONLY exception: a character who discovers an established fact AND takes an IRREVERSIBLE action in the same scene (betray, destroy, attack) — and the scene is about the action, not the discovery.');
  lines.push('Otherwise, the NEXT scene involving this thread MUST introduce a NEW state variable: interference, cost, reversal, escalation, or an unintended consequence that opens a different narrative lane.');

  return lines.join('\n');
}

