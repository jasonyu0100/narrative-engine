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
 * Current: { payoff: 1.5, change: 4, knowledge: 4 }
 */

import { THREAD_TERMINAL_STATUSES } from '@/types/narrative';
import type { NarrativeState, ThreadResolutionSpeed } from '@/types/narrative';
import { THREAD_LIFECYCLE_DOC } from './context';

// ── Force Standards ──────────────────────────────────────────────────────────
// Numbers here MUST match FORCE_REFERENCE_MEANS in narrative-utils.ts:
//   { payoff: 1.5, change: 4, knowledge: 4 }
// These are the values where the exponential grading curve scores ~86% (22/25).

export const PROMPT_FORCE_STANDARDS = `
FORCE SCORING — exponential grading. Reference means (~86%): P ~1.5 | C ~4 | K ~4 per scene (~12 beats, ~1200 words).

In practice (per 12-beat scene):
- PAYOFF ~1.5: 1-2 thread transitions averaging ~1 phase jump, OR several pulses.
- CHANGE ~4: ~4-5 continuity mutations + ~2-3 events + relationship shifts (valenceDelta ±0.2+, L2 aggregated).
- KNOWLEDGE ~4: ~2-3 new world knowledge nodes + connecting edges.

SCALE STANDARDS: Beat ~100 words | Scene ~12 beats (~1200 words) | Arc ~4 scenes (~4800 words).
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
MUTATIONS — these feed force formulas. Every mutation must EARN its place. Low-value mutations flatten the graph and destroy analytical signal.

FORCE FORMULAS:
- PAYOFF = Σ max(0, φ_to - φ_from) + 0.25/pulse. Phase: dormant=0, active=1, escalating=2, critical=3, terminal=4.
- CHANGE = √(ΔN_cont + √ΔE_cont) + √|events| + √(Σ|valenceDelta|²).
- KNOWLEDGE = ΔN_world + √ΔE_world.

threadMutations — lifecycle: dormant→active→escalating→critical→resolved/subverted/abandoned.
- Transitions ONE step at a time. NEVER skip phases.
- Most scenes: 1-2 thread PULSES (same→same, 0.25 payoff each). Real transitions are RARE — 0-1 per scene.
- Only record a transition when the prose shows a clear, irreversible shift in tension level.
- A scene touching 2-3 threads (mostly pulses) with one transition is a strong scene. More than that is overcounting.

continuityMutations — the entity's inner world CHANGED. Not observations, not descriptions — CHANGES. Entities are characters (conscious beings with agency), locations (spatial areas), and artifacts (things that provide utility).
- QUALITY BAR: each node must describe something the entity didn't know/feel/have before this scene.
  BAD: "Alice is curious" (observation, not change). BAD: "The White Rabbit has pink eyes" (description, not mutation).
  GOOD: "Alice abandons caution entirely, chasing the Rabbit without considering how to return" (new behaviour pattern).
  GOOD: "The White Rabbit's panic about being late reveals it answers to a higher authority" (new understanding).
- MAX 2-3 nodes per entity per scene. Only the POV character and one other entity typically earn continuity.
- Background characters who don't change: ZERO nodes. An entity merely present is not mutated.
- addedEdges connect RELATED changes: "follows", "causes", "contradicts", "enables". Only add edges when nodes are causally linked.
- Types: trait, state, history, capability, belief, relation, secret, goal, weakness.

relationshipMutations — only when a relationship SHIFTS, not just exists.
- valenceDelta: ±0.1 (subtle), ±0.2-0.3 (meaningful), ±0.4-0.5 (dramatic).
- Most scenes: 0-1 relationship mutations. Two characters talking ≠ relationship shift.

worldKnowledgeMutations — REVEALED world rules, not character observations.
- Each concept must be a genuine world SYSTEM or PRINCIPLE the prose establishes.
  BAD: "Wonderland Logic" (vague). BAD: "Alice's Adventures" (not a world rule).
  GOOD: "Anthropomorphic Animals" (genuine world feature). GOOD: "Size-Altering Substances" (actionable world system).
- MAX 1-2 concepts per scene. Most scenes reveal 0-1 new world rules. Only world-building and exposition scenes justify 3+.
- Types: principle, system, concept, tension, event, structure, environment, convention, constraint.
- Edges: enables, governs, opposes, extends, created_by, constrains, exist_within.

events — short descriptive tags (2-4 words). 2-4 per scene. Each tag names a discrete narrative beat.
artifactUsages — when an artifact delivers its utility. Every artifact referenced for its PURPOSE (not just mentioned by name) is a usage. characterId null for unattributed.
ownershipMutations — artifacts changing hands. Only when narratively meaningful.
tieMutations — significant bond changes. NOT temporary visits.
characterMovements — only characters whose location CHANGES. Vivid transitions.

VARIANCE IS SIGNAL:
- A quiet scene with 0 thread transitions, 1 continuity node, 0 knowledge, and 2 events is CORRECT if the prose is quiet.
- A climactic scene with 2 thread transitions, 5 continuity nodes, 3 knowledge concepts, and 5 events is CORRECT if the prose is dense.
- If every scene has similar mutation counts, you are extracting noise. The graph should have peaks and valleys.
`;

// ── Artifact Usage ──────────────────────────────────────────────────────────

export const PROMPT_ARTIFACTS = `
ARTIFACTS — the tools that make societies flourish.
- Artifacts are anything that delivers UTILITY. Not passive objects — active tools across every scale.
- THREE OWNERSHIP TIERS (ownership = control, not just possession):
  • Character-owned: controlled by one entity. A founder owns their company. A wizard owns their wand. An investor owns their portfolio. Others cannot use it without the owner's permission. A CEO who doesn't hold equity does NOT own the company — the shareholders do.
  • Location-owned: bound to a place. A forge, a library, a data center, a courtroom, a hospital. You must be at the location to access it. Available to anyone present.
  • World-owned (parentId: null): no one controls it. AI, the internet, gravity, a dream realm available to all cultivators, a programming language, natural law, a stock market. Universally accessible — anyone can use it anywhere.
- Artifacts span every genre: a Bloomberg terminal (finance), Google Search (tech), a magic wand (fantasy), a courtroom (legal), a forge (craft), a social media platform (modern), a printing press (historical).
- When an artifact delivers utility, generate an artifactUsage entry. Every time an artifact is referenced for what it DOES (not just mentioned by name), that's a usage.
  Fiction: wielding a sword, consulting a map, casting with a wand, driving a vehicle.
  Academic: applying gradient descent, training with a transformer, measuring with an instrument, leveraging a framework.
  The artifact doesn't need to be physically held — a paper "using" reinforcement learning is an artifact usage.
- Generate continuityMutations for BOTH the artifact (what it underwent) AND the user (what capability they gained).
- Has VALUE that characters recognise — people scheme to acquire, protect, control, or destroy.
- Creates DEPENDENCY and COST — power comes with consequences (subscription fees, depletion, corruption, obligation, lock-in).
- Unused artifacts are wasted narrative elements. A vibrant tool ecosystem makes stories richer.
`;

export const PROMPT_LOCATIONS = `
LOCATIONS — strictly SPATIAL places where events happen. A location is a physical or virtual space you can be IN.
- Ranges from micro (a room, a desk) to macro (a continent, a planet, cyberspace). All are valid if spatial.
- NOT organizations, companies, institutions, or abstract concepts — those are artifacts or world knowledge.
  A "hospital" is a location (you go there). "The medical system" is world knowledge. "Google" is an artifact. "Google's headquarters" is a location.
- If the text has no spatial places, generate ZERO locations. Do not fabricate locations that don't exist.
- Locations have continuity — history, state, rules. A city that witnesses a massacre gains history. A kingdom that loses a war gains weakness.
- Location rules constrain characters: a sacred grove forbids violence, a kingdom demands fealty.
- Hierarchy via parentId: room → building → district → city → region → country.
- TIES represent a character's gravity toward a location — belonging, not just visiting. A tie means the location is significant to the character's identity.
- Ties are contextual: an employee has ties to home AND workplace. A student has ties to their school.
- Removing a tie is a significant narrative event — exile, firing, permanent departure. Temporary departures never remove ties.
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


// ── Centralized JSON Schema Fragments ────────────────────────────────────────
// These are the single source of truth for mutation schemas used across
// generation, analysis, reconstruction, and world expansion prompts.

export const SCHEMA_THREAD_MUTATIONS = `"threadMutations": [{"threadId": "T-XX", "from": "status", "to": "status"}]`;
export const SCHEMA_CONTINUITY_MUTATIONS = `"continuityMutations": [{"entityId": "C-XX", "addedNodes": [{"id": "K-XX", "content": "complete sentence: what the entity experienced or became", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}], "addedEdges": [{"from": "K-XX", "to": "K-YY", "relation": "follows|causes|contradicts|enables"}]}]`;
export const SCHEMA_RELATIONSHIP_MUTATIONS = `"relationshipMutations": [{"from": "C-XX", "to": "C-YY", "type": "description", "valenceDelta": 0.1}]`;
export const SCHEMA_WORLD_KNOWLEDGE_MUTATIONS = `"worldKnowledgeMutations": {"addedNodes": [{"id": "WK-XX", "concept": "well-named world concept", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"from": "WK-XX", "to": "WK-YY", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]}`;
export const SCHEMA_ARTIFACT_USAGES = `"artifactUsages": [{"artifactId": "A-XX", "characterId": "C-XX or null for unattributed usage"}]`;
export const SCHEMA_OWNERSHIP_MUTATIONS = `"ownershipMutations": [{"artifactId": "A-XX", "fromId": "C-XX or L-XX", "toId": "C-YY or L-YY"}]`;
export const SCHEMA_TIE_MUTATIONS = `"tieMutations": [{"locationId": "L-XX", "characterId": "C-XX", "action": "add|remove"}]`;
export const SCHEMA_CHARACTER_MOVEMENTS = `"characterMovements": {"C-XX": {"locationId": "L-YY", "transition": "vivid description of how they traveled"}}`;
export const SCHEMA_EVENTS = `"events": ["descriptive_2-4_word_tags"]`;

/** Analysis scene mutations — name-based (pre-ID resolution) */
export const SCHEMA_ANALYSIS_THREAD_MUTATIONS = `"threadMutations": [{"threadDescription": "exact thread description", "from": "status", "to": "status"}]`;
export const SCHEMA_ANALYSIS_CONTINUITY_MUTATIONS = `"continuityMutations": [{"entityName": "Character, Location, or Artifact name", "addedNodes": [{"content": "complete sentence: what the entity experienced or became", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}]`;
export const SCHEMA_ANALYSIS_RELATIONSHIP_MUTATIONS = `"relationshipMutations": [{"from": "Name", "to": "Name", "type": "description", "valenceDelta": 0.1}]`;
export const SCHEMA_ANALYSIS_ARTIFACT_USAGES = `"artifactUsages": [{"artifactName": "Name", "characterName": "who or null for unattributed"}]`;
export const SCHEMA_ANALYSIS_OWNERSHIP_MUTATIONS = `"ownershipMutations": [{"artifactName": "Name", "fromName": "prev owner", "toName": "new owner"}]`;
export const SCHEMA_ANALYSIS_TIE_MUTATIONS = `"tieMutations": [{"locationName": "Name", "characterName": "Name", "action": "add|remove"}]`;
export const SCHEMA_ANALYSIS_CHARACTER_MOVEMENTS = `"characterMovements": [{"characterName": "Name", "locationName": "destination", "transition": "vivid description"}]`;
export const SCHEMA_ANALYSIS_WORLD_KNOWLEDGE = `"worldKnowledgeMutations": {"addedNodes": [{"concept": "well-named world concept", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"fromConcept": "name", "toConcept": "name", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]}`;

/** Full scene mutations block — all mutation schemas composed together */
export const SCHEMA_SCENE_MUTATIONS = [
  SCHEMA_THREAD_MUTATIONS,
  SCHEMA_CONTINUITY_MUTATIONS,
  SCHEMA_RELATIONSHIP_MUTATIONS,
  SCHEMA_WORLD_KNOWLEDGE_MUTATIONS,
  SCHEMA_ARTIFACT_USAGES,
  SCHEMA_OWNERSHIP_MUTATIONS,
  SCHEMA_TIE_MUTATIONS,
  SCHEMA_CHARACTER_MOVEMENTS,
  SCHEMA_EVENTS,
].join(',\n      ');

// ── Beat Functions & Mechanisms ──────────────────────────────────────────────
// Single source of truth for beat classification — used by plan generation,
// reverse engineering, and prose generation.

export const PROMPT_BEAT_TAXONOMY = `
BEAT FUNCTIONS (10):
  breathe    — Pacing, atmosphere, sensory grounding, scene establishment.
  inform     — Knowledge delivery. Character or reader learns something NOW.
  advance    — Forward momentum. Plot moves, goals pursued, tension rises.
  bond       — Relationship shifts between characters.
  turn       — Scene pivots. Revelation, reversal, interruption.
  reveal     — Character nature exposed through action or choice.
  shift      — Power dynamic inverts.
  expand     — World-building. New rule, system, geography introduced.
  foreshadow — Plants information that pays off LATER.
  resolve    — Tension releases. Question answered, conflict settles.

MECHANISMS (8) — determines how prose is written:
  dialogue    — Characters SPEAKING. Requires quoted speech.
  thought     — POV character's INTERNAL monologue. Private reasoning.
  action      — PHYSICAL movement, gesture, body in space.
  environment — Setting, weather, sounds, spatial context.
  narration   — Narrator's voice. Rhetoric, time compression, exposition.
  memory      — Flashback triggered by association.
  document    — Embedded text shown literally. Letter, sign, excerpt.
  comic       — Humor, irony, absurdity.

MECHANISM EDGE CASES:
  - Overhearing sounds = environment, NOT dialogue
  - POV character thinking = thought, NOT dialogue
  - Describing what someone said without quoting = narration, NOT dialogue
`;

// ── Entity Integration Rules ────────────────────────────────────────────────
// Shared between world generation and world expansion.

export const PROMPT_ENTITY_INTEGRATION = `
INTEGRATION RULES:
- Characters are conscious beings with agency. Non-sentient AI is an artifact. Every new character MUST have at least 1 relationship to an existing character.
- Locations are spatial areas. Every new location SHOULD nest under an existing location via parentId (except top-level regions).
- Artifacts are things that by themselves provide utility. Concepts belong in world knowledge. Artifacts MUST have parentId referencing a character, location, or null for world-owned.
- Thread participants MUST include at least one existing character or location.
- Names must match the cultural palette already established in the world.
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
