/**
 * Modular prompt sections for scene and narrative generation.
 *
 * Each section is an independent block that can be composed into prompts.
 * Sections are grouped by concern for easy maintenance:
 *   - FORCE STANDARDS: reference means aligned to grading formulas
 *   - STRUCTURAL RULES: anti-repetition, thread collision, character arcs (consolidated)
 *   - MUTATIONS: how to write each mutation type
 *   - POV: point-of-view discipline
 *   - CONTINUITY: location and state tracking
 *   - THREADS: thread lifecycle rules
 *
 * When updating: check src/lib/narrative-utils.ts FORCE_REFERENCE_MEANS
 * to keep prompt numbers in sync with grading formulas.
 * Current: { payoff: 1.3, change: 3.5, knowledge: 3.5 }
 */

import { THREAD_TERMINAL_STATUSES } from '@/types/narrative';
import type { NarrativeState, ThreadResolutionSpeed } from '@/types/narrative';
import { THREAD_LIFECYCLE_DOC } from './context';

// ── Force Standards ──────────────────────────────────────────────────────────
// Numbers here MUST match FORCE_REFERENCE_MEANS in narrative-utils.ts:
//   { payoff: 1.3, change: 3.5, knowledge: 3.5 }
// These are the values where the exponential grading curve scores ~86% (22/25).

export const PROMPT_FORCE_STANDARDS = `
FORCE SCORING — exponential grading. Reference means (~86%): P ~1.3 | C ~3.5 | K ~3.5 per scene.

In practice:
- PAYOFF ~1.3: 1-2 thread transitions averaging ~1 phase jump, OR several pulses.
- CHANGE ~3.5: ~3-4 continuity mutations + ~2-3 events + relationship shifts (valenceDelta ±0.2+, L2 aggregated).
- KNOWLEDGE ~3.5: ~2-3 new world knowledge nodes + connecting edges.

Thin mutations = low scores. REUSE existing world knowledge node IDs when reinforcing established concepts.
`;

// ── Structural Rules (Consolidated) ──────────────────────────────────────────
// Combines: anti-repetition, thread collision, character arc discipline, pacing density.
// This is the ONE place these rules are stated — no duplication elsewhere.

export const PROMPT_STRUCTURAL_RULES = `
STRUCTURAL RULES — these govern scene construction. Violating any is a critical failure.

ANTI-REPETITION:
- NO EVENT TWICE. Discovery/deposition/raid that happened cannot happen again.
- NO STRUCTURE REPEAT. "A confronts B, B deflects" can happen ONCE. Next scene: different shape.
- EVERY SCENE CHANGES STATE. No before/after difference = filler. Delete it.
- NO CONFIRMATION SCENES. Reader already knows a fact? Don't show another character learning it unless they take IRREVERSIBLE action (betray, destroy, attack) in the same scene.

THREAD COLLISION:
- At least HALF your scenes must advance 2+ threads simultaneously.
- Characters from different threads share LOCATIONS, ALLIES, RESOURCES — collision inevitable.
- Information collides: what A learns in scene 3 is what B tries to hide in scene 7.
- COST OF ACTION: something must go WRONG that the protagonist did not choose.

CHARACTER DISCIPLINE:
- Characters in 3+ scenes MUST show visible change (belief, relationship, capability, power).
- Every appearance earns presence: DIFFERENT action from previous. Observers/note-takers are cameras, not characters.
- Protagonists who succeed without cost become uninteresting. At least one plan per arc must go wrong.

PACING DENSITY:
- DENSITY VARIES. Battle: 4-5 events, 3+ mutations. Quiet: 1 event, 0-1 mutations.
- Thread compression: ONE scene per status transition. Thread appears 3x without transition = filler.
- Scenes ending in retreat/recalculation have NOT earned existence. Write the ACTION.

SCAN BEFORE RETURNING:
- If two scenes share same action type in same thread (both "discover", both "confront"), merge them.
- Character has same confrontation twice? Delete duplicate or escalate structurally.
`;

// ── Mutation Guidelines ──────────────────────────────────────────────────────

export const PROMPT_MUTATIONS = `
MUTATIONS — these produce force scores. Thin mutations = low scores.

threadMutations — lifecycle: dormant→active→escalating→critical→terminal. Pulses (same→same) = 0.25 payoff.
- Prefer real transitions over pulses. Each arc: multiple real transitions.
- CONVERGENCE CASCADE: advancing a convergent thread should pressure linked threads (minimum pulse).

continuityMutations — first-person experiential changes for ANY entity (character, location, artifact). NOT omniscient narration — what the entity itself experienced, perceived, or became. Feeds Change via √(ΔN + √ΔE).
- entityId can be a character, location, or artifact ID.
- addedNodes: what the entity experienced from its own perspective. Types: "trait", "state", "history", "capability", "belief", "relation", "secret", "goal", "weakness".
- Write from the entity's perspective: "Learned the king is a fraud" not "The king was revealed as a fraud".
- Dense scenes: 2-3 nodes per entity. Normal: 0-1. Quiet: 0. Locations and artifacts accumulate as richly as characters.
- Characters: what they perceived, felt, decided, discovered, or became. Artifacts they possess extend their capabilities — a character with a magical weapon gains "capability" nodes, a character with AI access gains knowledge and power through their tools.
- Locations: a place AND its people. The Shire is both rolling hills and hobbits. Sydney is both a harbour and a culture. A location experiences events collectively — a city mourns its dead, a kingdom feels a power shift, a village celebrates a harvest. Major events reshape a location's identity, goals, and beliefs.
- Artifacts: tools that extend what's possible. An AI system grants its wielder analytical power. A cursed sword imposes its will. An enchanted map reveals hidden paths. Track what the artifact underwent AND how it modified the capabilities of whoever holds it.

relationshipMutations — valenceDelta: ±0.1 (subtle), ±0.2-0.3 (meaningful), ±0.4-0.5 (dramatic).
- Include whenever characters interact meaningfully. Feeds Change via √Σ|valenceDelta|² (L2).

worldKnowledgeMutations — types: "principle", "system", "concept", "tension", "event", "structure", "environment", "convention", "constraint". REUSE existing IDs.
- Lore/revelation: 3-5+ nodes. Character scenes: 0-1 nodes.
- World knowledge is #1 under-generated type. Most scenes: at least 1 node.
- Add edges: "enables", "governs", "opposes", "extends", "created_by", "constrains".

ownershipMutations — artifacts changing hands. Only when narratively meaningful.

SCENE INTELLIGENCE — locations and artifacts are active scene participants:
- LOCATION EFFECTS: The scene's location shapes what can happen. A sacred grove forbids violence. A lawless frontier permits anything. A city under siege constrains movement. Generate continuityMutations for the location when major events reshape it.
- TOOL USAGE: When characters use artifacts, it changes the scene. A character with a sword fights. A character with AI analyses. A character with a map navigates. Generate continuityMutations for BOTH the artifact (what it underwent) AND the wielder (capability gained/lost). Reference tool usage in events and summary.
- ENVIRONMENTAL EFFECTS: The location's state affects characters within it. A burning building forces evacuation. A cursed land drains strength. A thriving market enables trade. Locations impose constraints and grant opportunities.

events — specific tags ("ambush_at_dawn", "secret_pact_formed"). Conversation=1, battle=4-5.

characterMovements — only characters whose location CHANGES. Transition should be vivid.
`;

// ── Artifact Usage ──────────────────────────────────────────────────────────

export const PROMPT_ARTIFACTS = `
ARTIFACTS — the tools that make societies flourish.
- Artifacts are anything a character USES to extend their capabilities. Not passive objects — active tools.
- THREE OWNERSHIP TIERS:
  • Character-owned: personal tools. A sword, a laptop, a key. Only the owner can use them.
  • Location-owned: communal tools bound to a place. A gas station (fuel up), a grocery store (buy food), a library (access knowledge). Available to anyone at that location.
  • World-owned (parentId: null): universally accessible. The internet, a search engine, a stock exchange, a legal system. Available to any character anywhere.
- Artifacts span every genre: a Bloomberg terminal (finance), Google Search (tech), a magic wand (fantasy), a courtroom (legal), a forge (craft), a social media platform (modern), a printing press (historical).
- When an artifact is used, generate artifactUsages AND continuityMutations for BOTH the artifact (what it underwent) AND the user (what new capability they gained, what they accomplished).
- Artifact usage drives plot: an investor uses a trading platform to short a stock. A detective uses a forensic lab to analyze evidence. A wizard uses a staff to channel power. A startup founder uses cloud infrastructure to scale.
- Has VALUE that characters recognise — people scheme to acquire, protect, control, or destroy.
- Creates DEPENDENCY and COST — power comes with consequences (subscription fees, depletion, corruption, obligation, lock-in).
- Unused artifacts are wasted narrative elements. A vibrant tool ecosystem makes stories richer.
`;

export const PROMPT_LOCATIONS = `
LOCATIONS — places AND their people.
- A location is not passive scenery. It is a collective entity with its own continuity — history, beliefs, goals, and weaknesses.
- When a major event happens AT a location, generate continuityMutations for the location itself. A city that witnesses a massacre gains "history" and "state" nodes. A kingdom that loses a war gains "weakness" and shifts "belief".
- Location rules constrain characters: a sacred grove forbids violence, a kingdom demands fealty, a lawless frontier permits anything.
- Revisit locations — a place that appeared in act 1 and returns in act 3 with accumulated history feels lived-in.
- Generate location continuity whenever the scene's events meaningfully impact the place or its people.
- TIES represent a character's gravity toward a location — their karma, loyalty, and belonging. A tie means the location is significant to the character's identity, not just a place they visited. A character with a single tie has a home. A character with ties across domains, places, and margins lives a distributed life. A character with no ties is rootless, just passing through.
- Ties influence behaviour: characters gravitate toward tied locations, defend them, return to them. A tied character at a foreign location feels displaced; an untied character anywhere feels transient.
- Ties are contextual: an employee has ties to home AND workplace. A remote worker has ties to where they live, not where they work. A student has ties to their school. A soldier has ties to their barracks and hometown.
- Removing a tie is a significant narrative event — firing, exile, betrayal, occupation by an enemy. Damage, war, or hardship do NOT break ties unless the location is permanently lost to the character. Only generate tieMutations when the bond genuinely changes. Temporary departures never remove ties.
`;

// ── POV Discipline ───────────────────────────────────────────────────────────

export const PROMPT_POV = `
POV DISCIPLINE:
- STREAKS of 2-4 consecutive scenes before switching. Prefer AAABBA or AAABBCCC.
- Within an arc: anchor on 1-2 POV characters. Switch only when different perspective unlocks something.
- Single POV for entire arc is often strongest.
`;

// ── Continuity ─────────────────────────────────────────────────────────────

export const PROMPT_CONTINUITY = `
CONTINUITY:
- NEVER teleport characters. Use characterMovements. Prefer revisiting established locations.
- Injuries, exhaustion, consequences persist scene to scene.
- Characters cannot act on information they haven't learned.
- Signal time gaps: "Three days later", "By morning".
`;

// ── Thread Lifecycle ─────────────────────────────────────────────────────────

export function promptThreadLifecycle(): string {
  return `
THREAD LIFECYCLE:
- ${THREAD_LIFECYCLE_DOC}
- Terminal statuses: ${THREAD_TERMINAL_STATUSES.map((s) => `"${s}"`).join(', ')}.
- Threads can regress (escalating→active) when tension eases.
- Dormant threads: surface within a few scenes.
- Touch 2-4 threads per scene on average.
`;
}

// ── Summaries ────────────────────────────────────────────────────────────────

export const PROMPT_SUMMARY_REQUIREMENT = `
SUMMARY RULES — the prose writer's only brief. 3-6 sentences.

Include:
- CHARACTER NAMES and LOCATION NAMES — never raw IDs.
- SPECIFICS: objects, dialogue snippets, physical consequences.
- CONTEXT: time span ("Over three months..."), technique ("montage of vignettes"), tone shifts, POV approach.

Quality: BANNED verbs (realizes, confirms, understands, suspects, observes, decides). BANNED endings (emotions, internal states, future intentions). BANNED modifiers (face etched with, expression unreadable, eyes gleaming). Write ACTION, not thought.

Example: "Michael Corleone sits across from Sollozzo and McCluskey at the small Italian restaurant in the Bronx. He excuses himself to the bathroom where a pistol has been planted. He returns and shoots both men — Sollozzo between the eyes, McCluskey through the throat. The gun clatters to the floor as Michael walks out in a daze. The killing severs him from civilian life and hands the Tattaglia family a casus belli."
`;


// ── Thread Health Analysis ──────────────────────────────────────────────────

const PHASE_INDEX: Record<string, number> = { dormant: 0, active: 1, escalating: 2, critical: 3, resolved: 4, subverted: 4, abandoned: 4 };

/** Resolution speed standards — guidelines, not mechanical rules. */
const SPEED_STANDARDS: Record<ThreadResolutionSpeed, { benchmark: number; label: string }> = {
  slow: { benchmark: 10, label: 'Slow burn — ~10 scenes between transitions' },
  moderate: { benchmark: 6, label: 'Balanced — ~6 scenes between transitions' },
  fast: { benchmark: 4, label: 'Thriller — ~4 scenes between transitions' },
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
    transitions: number;
    pulses: number;
    totalMutations: number;
    scenesSinceLastTransition: number;
    transitionHistory: string[];
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

    for (const m of Object.values(metrics)) {
      m.scenesSinceLastTransition++;
    }
  }

  // ── Build per-thread report ────────────────────────────────────────────
  const lines: string[] = [
    `THREAD VELOCITY (${speed.toUpperCase()}) — benchmark: ~${standard.benchmark} scenes/transition`,
    '',
  ];

  const allThreads = Object.values(narrative.threads);
  const resolved = allThreads.filter((t) => terminalStatuses.has(t.status));
  const active = allThreads.filter((t) => !terminalStatuses.has(t.status));

  if (active.length === 0 && resolved.length === 0) return '';

  const sortedActive = active
    .map((t) => {
      const m = metrics[t.id] ?? { transitions: 0, pulses: 0, totalMutations: 0, scenesSinceLastTransition: 0, transitionHistory: [] };
      const age = threadFirstSeen[t.id] !== undefined ? sceneCount - threadFirstSeen[t.id] + 1 : 0;
      const velocity = age > 0 ? m.transitions / age : 0;
      return { ...t, m, age, velocity };
    })
    .sort((a, b) => b.m.scenesSinceLastTransition - a.m.scenesSinceLastTransition);

  for (const t of sortedActive) {
    const phaseIdx = PHASE_INDEX[t.status] ?? 0;
    const velocityLabel = t.velocity > 0 ? (t.velocity * 10).toFixed(1) + '/10 scenes' : 'no transitions';
    const sinceLabel = t.m.scenesSinceLastTransition > standard.benchmark
      ? `[!] ${t.m.scenesSinceLastTransition} since last (>${standard.benchmark})`
      : `${t.m.scenesSinceLastTransition} since last`;
    const history = t.m.transitionHistory.length > 0
      ? t.m.transitionHistory.join(' → ')
      : 'no transitions yet';

    // Pulse ratio warning
    let pulseWarning = '';
    if (t.m.totalMutations >= 3 && t.m.pulses / t.m.totalMutations > 0.8) {
      pulseWarning = ' [!] HIGH PULSE RATIO — next mention MUST transition';
    }

    lines.push(`"${t.description}" [${t.id}] ${t.status} (phase ${phaseIdx}/4)`);
    lines.push(`  Age: ${t.age} | Velocity: ${velocityLabel} | ${sinceLabel}${pulseWarning}`);
    lines.push(`  History: ${history}`);

    // Convergence links
    if (t.dependents.length > 0) {
      const depDescs = t.dependents
        .map((depId) => narrative.threads[depId])
        .filter(Boolean)
        .map((dep) => `[${dep.id}]`);
      if (depDescs.length > 0) {
        lines.push(`  ↔ Converges: ${depDescs.join(', ')}`);
      }
    }
    lines.push('');
  }

  lines.push(`Progress: ${resolved.length}/${allThreads.length} resolved`);

  return lines.join('\n');
}

// ── Completed Beats (State-Locking) ─────────────────────────────────────────

/**
 * Extract irreversible state transitions from scene history and format them
 * as a "SPENT BEATS" prompt section. This tells the LLM what narrative
 * territory is already cashed in and must not be restaged.
 */
export function buildCompletedBeatsPrompt(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  const terminalStatuses = new Set(THREAD_TERMINAL_STATUSES as readonly string[]);

  type Beat = { sceneIdx: number; from: string; to: string; summary: string; events: string[] };
  const threadBeats: Record<string, Beat[]> = {};

  let sceneIdx = 0;
  for (let i = 0; i <= currentIndex && i < resolvedKeys.length; i++) {
    const scene = narrative.scenes[resolvedKeys[i]];
    if (!scene) continue;
    sceneIdx++;

    for (const tm of scene.threadMutations) {
      if (tm.from === tm.to) continue;
      if (!threadBeats[tm.threadId]) threadBeats[tm.threadId] = [];
      threadBeats[tm.threadId].push({
        sceneIdx,
        from: tm.from,
        to: tm.to,
        summary: scene.summary?.slice(0, 100) ?? '',
        events: scene.events?.slice(0, 3) ?? [],
      });
    }
  }

  const threadIds = Object.keys(threadBeats).filter((id) => threadBeats[id].length > 0);
  if (threadIds.length === 0) return '';

  const lines: string[] = [
    'SPENT BEATS — these transitions are CLOSED. Do NOT restage, re-discover, or write "deepening" scenes.',
    'Next scene for any thread MUST change state: new complication, reversal, cost, or consequence.',
    '',
  ];

  for (const tid of threadIds) {
    const thread = narrative.threads[tid];
    if (!thread) continue;
    const beats = threadBeats[tid];

    const chain = beats.map((b) => `${b.to} (${b.sceneIdx})`).join(' → ');
    const currentStatus = beats.length > 0 ? beats[beats.length - 1].to : thread.status;
    const isTerminal = terminalStatuses.has(currentStatus);
    const label = isTerminal ? `[${currentStatus.toUpperCase()}]` : `[${currentStatus}]`;

    lines.push(`"${thread.description.slice(0, 50)}" [${tid}] ${label}`);
    lines.push(`  ${beats[0].from} → ${chain}`);

    for (const b of beats) {
      if (b.summary) {
        lines.push(`  S${b.sceneIdx}: ${b.summary}${b.events.length ? ` [${b.events.join(', ')}]` : ''}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
