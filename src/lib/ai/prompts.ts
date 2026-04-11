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
 * Current: { drive: 3, world: 14, system: 5 }
 */

import { THREAD_TERMINAL_STATUSES } from '@/types/narrative';
import type { NarrativeState } from '@/types/narrative';
import { THREAD_LIFECYCLE_DOC } from './context';

// ── Force Standards ──────────────────────────────────────────────────────────
// Numbers here MUST match FORCE_REFERENCE_MEANS in narrative-utils.ts:
//   { drive: 3, world: 14, system: 5 }
// These are the values where the grading curve hits the dominance threshold (21/25).

export const PROMPT_FORCE_STANDARDS = `
THE THREE FORCES — narrative is a composition of drive, world, and system in flux. These are not decorative labels: each force is computed deterministically from the mutations you emit, normalised by a reference mean, and graded on a curve that hits the dominance threshold (21/25) exactly at the reference. Under-dense arcs get graded in the 60s. Match the floor.

DRIVE is the commitment of threads — the unifying force that pulls world and system toward resolution.
  Threads compete for narrative bandwidth across arcs. The longer a thread sustains attention before resolving, the greater its contribution.
  Drive measures what the story WANTS. Without drive, entities transform and systems deepen but nothing resolves.
  Reference mean: ~3 per scene. Thread transitions weighted by lifecycle stage; sustained threads earn superlinearly.

WORLD is the inner transformation of entities — what we learn about characters, locations, and artifacts.
  Where drive measures what the story wants, world measures what the story DOES TO THE PEOPLE IN IT.
  Every continuity node is a permanent mark on an entity's inner graph — a new trait, belief, capability, or wound. Nodes listed in order auto-chain into each entity's causal sequence for the scene, so ordering matters.
  Reference mean: ~14 per scene — a typical scene deposits 12-16 continuity nodes distributed across 3-5 entities (edges auto-chain from node order, you do NOT emit continuity edges manually). Climax/discovery scenes push to 18-25+ nodes. Only the quietest breather scenes drop below 8.

SYSTEM is the deepening of rules and structures — the substrate on which drive and world operate.
  A world without systems is a stage without physics. Drive cannot create meaningful resolution in a vacuum of rules.
  Every knowledge node expands what is possible or constrains what is allowed. Every edge links a new rule into the world's existing scaffolding.
  Reference mean: ~5 per scene — a typical scene reveals 3-5 world knowledge concepts with 2-4 connecting edges. Lore/revelation scenes push to 6-12. Pure interpersonal scenes can drop to 0-2 but SHOULD log any rule the prose actually teaches.

Different works weight these forces differently. A Classic is drive-dominant. A Show is world-dominant. A Paper is system-dominant. An Opus balances all three.

SCALE STANDARDS: Beat ~100 words | Scene ~12 beats (~1200 words) | Arc ~4 scenes (~4800 words).
DENSITY IS NOT OPTIONAL. Thin mutations = 60s grading. Mutations must be EARNED by the prose — never invented — but a scene whose prose covers a discovery, a relationship shift, and a new rule without logging 10+ continuity nodes and 3+ knowledge concepts is leaving signal on the floor. REUSE existing world knowledge node IDs when reinforcing established concepts (reuse does not count as a new node).
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
MUTATIONS — direct inputs to force formulas. Every mutation must be EARNED by prose.

FORCE FORMULAS:
- DRIVE = activeArcs^1.3 × stageWeight (pulse=0.25, latent→seeded=0.5, seeded→active=1.0, active→critical=2.0, critical→resolved=4.0)
- WORLD = ΔN_c + √ΔE_c (continuity nodes + edges linking them)
- SYSTEM = ΔN + √ΔE (world knowledge nodes + connecting edges)

ALL NODE CONTENT: 15-25 words, PRESENT TENSE. Specific and concrete.

DENSITY TARGETS (reference means hit 21/25 grade):
  Breather:   0 transitions, 3-6 continuity, 0-2 system, 2-3 events
  Typical:    0-1 transitions, 12-16 continuity, 3-5 system + 2-3 edges, 3-4 events
  Climactic:  1-2 transitions, 18-25+ continuity, 5-8 system + 3-5 edges, 4-6 events
  Lore dump:  modest continuity (5-10), heavy system (6-12 + dense edges)
Variance is signal — similar counts across scenes = noise. Peaks and valleys required.

threadMutations — TWO SEPARATE AXES:
  STATUS (from/to): latent | seeded | active | critical | resolved | subverted | abandoned
    "pulse" is NOT a status — never use in from/to fields.
    Transitions move ONE step. Status-holds (from===to) are common; log with "pulse" type.
    0-1 real transitions per scene. Touch 2-3 threads (mostly status-holds).

  LOG TYPE (addedNodes.type): pulse | transition | setup | escalation | payoff | twist | callback | resistance | stall
    Thread's perspective: "Harry causes the glass to vanish, revealing latent magical abilities."

continuityMutations — Entity's perspective on what is now known. PRESENT TENSE facts.
  Characters: traits, beliefs, capabilities, states, secrets, goals, weaknesses, relations.
  Locations: history, rules, dangers, atmosphere. Artifacts: capabilities, limitations, provenance.
  GOOD: "Harry Potter has a lightning-bolt scar, a visible mark of surviving Voldemort's killing curse."
  BAD: "Harry discovered he was a wizard" (event → belongs in thread log)
  2-4 nodes per entity typical. POV can earn 4-6 in turning points. Node ORDER matters (auto-chains).
  Scan whole cast: "what did this scene DO to each person and place?"

systemMutations — How the WORLD WORKS. General rules, no specific characters/events.
  GOOD: "Magic near an underage wizard is attributed to that wizard by the Ministry regardless of caster."
  BAD: "Harry used magic" (specific → thread log)
  REUSE existing IDs for established concepts. Aim ≥1 edge per 2 nodes.
  Types: principle, system, concept, tension, event, structure, environment, convention, constraint.
  Edges: enables, governs, opposes, extends, created_by, constrains, exist_within.

relationshipMutations — Only when relationship SHIFTS. valenceDelta: ±0.1 subtle, ±0.2-0.3 meaningful, ±0.4-0.5 dramatic.
events — 2-4 word tags, 2-4 per scene.
artifactUsages — When artifact delivers utility (not just mentioned). Include continuityMutation if usage reveals new properties.
ownershipMutations — Artifacts changing hands. Only when meaningful.
tieMutations — Significant bond changes, NOT temporary visits.
characterMovements — Only location CHANGES. Vivid transitions.
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
LOCATIONS — strictly PHYSICAL spatial places you can STAND IN. The test: could a character physically walk there and look around?
- Ranges from micro (a room, a desk) to macro (a continent, a planet, cyberspace). All are valid if spatial.
- NOT locations: abstract domains, conceptual spaces, fields of study, conferences, institutions, frameworks — these belong in world knowledge or as artifacts.
  A hospital is a location (you walk in). A medical system is world knowledge. An organisation is an artifact. The organisation's headquarters is a location.
- If the text has no physical places, generate ZERO locations. Do not fabricate locations that don't exist.
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
THREAD LIFECYCLE: latent → seeded → active → critical → resolved/subverted.
- ${THREAD_LIFECYCLE_DOC}
- Terminal: ${THREAD_TERMINAL_STATUSES.map((s) => `"${s}"`).join(', ')}.
- latent: introduced but undeveloped. seeded: setup planted. active: driving narrative. critical: demands resolution.
- Threads earn fate through sustained bandwidth — long-running threads that resolve pay off superlinearly.
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

export const SCHEMA_THREAD_MUTATIONS = `"threadMutations": [{"threadId": "T-XX", "from": "latent|seeded|active|critical|resolved|subverted|abandoned", "to": "latent|seeded|active|critical|resolved|subverted|abandoned", "addedNodes": [{"id": "TK-XX", "content": "15-25 words, PRESENT tense: what just changed for this thread", "type": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall"}]}]`;
export const SCHEMA_CONTINUITY_MUTATIONS = `"continuityMutations": [{"entityId": "C-XX", "addedNodes": [{"id": "K-XX", "content": "15-25 words, PRESENT tense: a stable fact about the entity — their unique perspective on reality, identity, or condition", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}]`;
export const SCHEMA_RELATIONSHIP_MUTATIONS = `"relationshipMutations": [{"from": "C-XX", "to": "C-YY", "type": "description", "valenceDelta": 0.1}]`;
export const SCHEMA_SYSTEM_MUTATIONS = `"systemMutations": {"addedNodes": [{"id": "SYS-XX", "concept": "15-25 words, PRESENT tense: a general rule or structural fact — how the world works, no specific characters or events", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"from": "SYS-XX", "to": "SYS-YY", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]}`;
export const SCHEMA_ARTIFACT_USAGES = `"artifactUsages": [{"artifactId": "A-XX", "characterId": "C-XX or null for unattributed usage", "usage": "what the artifact did — how it delivered utility"}]`;
export const SCHEMA_OWNERSHIP_MUTATIONS = `"ownershipMutations": [{"artifactId": "A-XX", "fromId": "C-XX or L-XX", "toId": "C-YY or L-YY"}]`;
export const SCHEMA_TIE_MUTATIONS = `"tieMutations": [{"locationId": "L-XX", "characterId": "C-XX", "action": "add|remove"}]`;
export const SCHEMA_CHARACTER_MOVEMENTS = `"characterMovements": {"C-XX": {"locationId": "L-YY", "transition": "vivid description of how they traveled"}}`;
export const SCHEMA_EVENTS = `"events": ["descriptive_2-4_word_tags"]`;

/** Analysis scene mutations — name-based (pre-ID resolution) */
export const SCHEMA_ANALYSIS_THREAD_MUTATIONS = `"threadMutations": [{"threadDescription": "exact thread description", "from": "latent|seeded|active|critical|resolved|subverted|abandoned", "to": "latent|seeded|active|critical|resolved|subverted|abandoned", "addedNodes": [{"content": "15-25 words, PRESENT tense: what just changed for this thread", "type": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall"}]}]`;
export const SCHEMA_ANALYSIS_CONTINUITY_MUTATIONS = `"continuityMutations": [{"entityName": "Character, Location, or Artifact name", "addedNodes": [{"content": "15-25 words, PRESENT tense: a stable fact about the entity — their unique perspective on reality, identity, or condition", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}]`;
export const SCHEMA_ANALYSIS_RELATIONSHIP_MUTATIONS = `"relationshipMutations": [{"from": "Name", "to": "Name", "type": "description", "valenceDelta": 0.1}]`;
export const SCHEMA_ANALYSIS_ARTIFACT_USAGES = `"artifactUsages": [{"artifactName": "Name", "characterName": "who or null for unattributed", "usage": "what the artifact did — how it delivered utility"}]`;
export const SCHEMA_ANALYSIS_OWNERSHIP_MUTATIONS = `"ownershipMutations": [{"artifactName": "Name", "fromName": "prev owner", "toName": "new owner"}]`;
export const SCHEMA_ANALYSIS_TIE_MUTATIONS = `"tieMutations": [{"locationName": "Name", "characterName": "Name", "action": "add|remove"}]`;
export const SCHEMA_ANALYSIS_CHARACTER_MOVEMENTS = `"characterMovements": [{"characterName": "Name", "locationName": "destination", "transition": "vivid description"}]`;
export const SCHEMA_ANALYSIS_SYSTEM_MUTATIONS = `"systemMutations": {"addedNodes": [{"concept": "15-25 words, PRESENT tense: a general rule or structural fact — how the world works, no specific characters or events", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"fromConcept": "name", "toConcept": "name", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]}`;

/** Full scene mutations block — all mutation schemas composed together */
export const SCHEMA_SCENE_MUTATIONS = [
  SCHEMA_THREAD_MUTATIONS,
  SCHEMA_CONTINUITY_MUTATIONS,
  SCHEMA_RELATIONSHIP_MUTATIONS,
  SCHEMA_SYSTEM_MUTATIONS,
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
- Artifacts are anything that delivers utility — active tools, not passive concepts. Concepts belong in world knowledge. Artifacts MUST have parentId referencing a character, location, or null for world-owned.
- Thread participants MUST include at least one existing character or location.
- Names must match the cultural palette already established in the world.
`;

// ── Thread Bandwidth Analysis ───────────────────────────────────────────────

/**
 * Build a bandwidth-based thread health report for the LLM.
 * Surfaces activeArcs, staleness, and lifecycle stage to guide
 * which threads should receive narrative bandwidth in the next arc.
 */
export function buildThreadHealthPrompt(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
): string {
  const terminalStatuses = new Set(THREAD_TERMINAL_STATUSES as readonly string[]);

  // Count total arcs in the narrative so far
  const totalArcs = Object.keys(narrative.arcs).length || 1;

  // Compute per-thread metrics from scene history
  const threadFirstSeen: Record<string, number> = {};
  const threadLastSeen: Record<string, number> = {};
  const threadArcSets: Record<string, Set<string>> = {};
  let sceneCount = 0;

  for (let i = 0; i <= currentIndex && i < resolvedKeys.length; i++) {
    const scene = narrative.scenes[resolvedKeys[i]];
    if (!scene) continue;
    sceneCount++;
    for (const tm of scene.threadMutations) {
      if (threadFirstSeen[tm.threadId] === undefined) threadFirstSeen[tm.threadId] = sceneCount;
      threadLastSeen[tm.threadId] = sceneCount;
      if (!threadArcSets[tm.threadId]) threadArcSets[tm.threadId] = new Set();
      threadArcSets[tm.threadId].add(scene.arcId);
    }
  }

  const allThreads = Object.values(narrative.threads);
  const resolved = allThreads.filter((t) => terminalStatuses.has(t.status));
  const active = allThreads.filter((t) => !terminalStatuses.has(t.status));

  if (active.length === 0 && resolved.length === 0) return '';

  const lines: string[] = [
    `THREAD BANDWIDTH — ${active.length} active, ${resolved.length} resolved, ${totalArcs} arcs elapsed`,
    '',
  ];

  // Sort by staleness (lowest bandwidth ratio first = most neglected)
  const sorted = active
    .map((t) => {
      const activeArcs = threadArcSets[t.id]?.size ?? 0;
      const bandwidthRatio = totalArcs > 0 ? activeArcs / totalArcs : 0;
      const scenesSinceLast = threadLastSeen[t.id] !== undefined ? sceneCount - threadLastSeen[t.id] : sceneCount;
      const age = threadFirstSeen[t.id] !== undefined ? sceneCount - threadFirstSeen[t.id] + 1 : 0;
      return { ...t, bandwidthRatio, scenesSinceLast, age };
    })
    .sort((a, b) => a.bandwidthRatio - b.bandwidthRatio);

  for (const t of sorted) {
    const stale = t.bandwidthRatio < 0.3;
    const critical = stale && (t.status === 'active' || t.status === 'critical');
    const discardCandidate = stale && (t.status === 'latent' || t.status === 'seeded');
    const flag = critical ? ' [!] EMERGENCY — active/critical thread starved of bandwidth'
      : discardCandidate ? ' [?] STALE — consider discarding or advancing'
      : '';

    lines.push(`"${t.description}" [${t.id}] ${t.status}`);
    lines.push(`  activeArcs: ${threadArcSets[t.id]?.size ?? 0}/${totalArcs} (${Math.round(t.bandwidthRatio * 100)}%) | age: ${t.age} scenes | silent: ${t.scenesSinceLast} scenes${flag}`);

    // Recent thread log nodes
    const logNodes = Object.values(t.threadLog?.nodes ?? {});
    const recentNodes = logNodes.slice(-3);
    if (recentNodes.length > 0) {
      lines.push(`  log: ${recentNodes.map((n) => `[${n.type}] ${n.content.slice(0, 60)}`).join(' | ')}`);
    }

    if (t.dependents.length > 0) {
      const depDescs = t.dependents.map((depId) => narrative.threads[depId]).filter(Boolean).map((dep) => `[${dep.id}]`);
      if (depDescs.length > 0) lines.push(`  ↔ Converges: ${depDescs.join(', ')}`);
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
