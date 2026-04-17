/**
 * Centralized JSON Schema Fragments for Deltas
 *
 * These are the single source of truth for delta schemas used across
 * generation, analysis, reconstruction, and world expansion prompts.
 */

// ── Generation Schemas (ID-based) ───────────────────────────────────────────

export const SCHEMA_THREAD_DELTAS = `"threadDeltas": [{"threadId": "T-XX", "from": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "to": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "addedNodes": [{"id": "TK-XX", "content": "15-25 words, PRESENT tense: what just changed for this thread", "type": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall", "actorId": "C-XX — who acted", "targetId": "C-YY or null — who was affected", "stance": "cooperative|competitive|neutral", "matrixCell": "cc|cd|dc|dd — first letter = actor's action, second = target's action (c=cooperate d=defect)"}]}]`;

export const SCHEMA_WORLD_DELTAS = `"worldDeltas": [{"entityId": "C-XX", "addedNodes": [{"id": "K-XX", "content": "15-25 words, PRESENT tense: a stable fact about the entity — their unique perspective on reality, identity, or condition", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}]`;

export const SCHEMA_RELATIONSHIP_DELTAS = `"relationshipDeltas": [{"from": "C-XX", "to": "C-YY", "type": "description", "valenceDelta": 0.1}]`;

export const SCHEMA_SYSTEM_DELTAS = `"systemDeltas": {"addedNodes": [{"id": "SYS-XX", "concept": "15-25 words, PRESENT tense: a general rule or structural fact — how the world works, no specific characters or events", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"from": "SYS-XX", "to": "SYS-YY", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]}`;

export const SCHEMA_ARTIFACT_USAGES = `"artifactUsages": [{"artifactId": "A-XX", "characterId": "C-XX", "usage": "what the artifact did — how it delivered utility"}]`;

export const SCHEMA_OWNERSHIP_DELTAS = `"ownershipDeltas": [{"artifactId": "A-XX", "fromId": "C-XX or L-XX or null", "toId": "C-YY or L-YY or null"}]`;

export const SCHEMA_TIE_DELTAS = `"tieDeltas": [{"locationId": "L-XX", "characterId": "C-XX", "action": "add|remove"}]`;

export const SCHEMA_CHARACTER_MOVEMENTS = `"characterMovements": {"C-XX": {"locationId": "L-YY", "transition": "vivid description of how they traveled"}}`;

export const SCHEMA_EVENTS = `"events": ["descriptive_2-4_word_tags"]`;

// ── Analysis Schemas (name-based, pre-ID resolution) ────────────────────────

export const SCHEMA_ANALYSIS_THREAD_DELTAS = `"threadDeltas": [{"threadDescription": "exact thread description", "from": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "to": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "addedNodes": [{"content": "15-25 words, PRESENT tense: what just changed for this thread", "type": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall", "actorName": "who acted", "targetName": "who was affected or null", "stance": "cooperative|competitive|neutral", "matrixCell": "cc|cd|dc|dd — which payoff matrix cell this move represents"}]}]`;

export const SCHEMA_ANALYSIS_WORLD_DELTAS = `"worldDeltas": [{"entityName": "Character, Location, or Artifact name", "addedNodes": [{"content": "15-25 words, PRESENT tense: a stable fact about the entity — their unique perspective on reality, identity, or condition", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}]`;

export const SCHEMA_ANALYSIS_RELATIONSHIP_DELTAS = `"relationshipDeltas": [{"from": "Name", "to": "Name", "type": "description", "valenceDelta": 0.1}]`;

export const SCHEMA_ANALYSIS_ARTIFACT_USAGES = `"artifactUsages": [{"artifactName": "Name", "characterName": "who used it", "usage": "what the artifact did — how it delivered utility"}]`;

export const SCHEMA_ANALYSIS_OWNERSHIP_DELTAS = `"ownershipDeltas": [{"artifactName": "Name", "fromName": "prev owner or null", "toName": "new owner or null"}]`;

export const SCHEMA_ANALYSIS_TIE_DELTAS = `"tieDeltas": [{"locationName": "Name", "characterName": "Name", "action": "add|remove"}]`;

export const SCHEMA_ANALYSIS_CHARACTER_MOVEMENTS = `"characterMovements": [{"characterName": "Name", "locationName": "destination", "transition": "15-25 words describing how they traveled — the journey, transport, or spatial transition"}]`;

export const SCHEMA_ANALYSIS_SYSTEM_DELTAS = `"systemDeltas": {"addedNodes": [{"concept": "15-25 words, PRESENT tense: a general rule or structural fact — how the world works, no specific characters or events", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"fromConcept": "name", "toConcept": "name", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]}`;

// ── Composed Schemas ────────────────────────────────────────────────────────

/** Full scene deltas block — all delta schemas composed together */
export const SCHEMA_SCENE_DELTAS = [
  SCHEMA_THREAD_DELTAS,
  SCHEMA_WORLD_DELTAS,
  SCHEMA_RELATIONSHIP_DELTAS,
  SCHEMA_SYSTEM_DELTAS,
  SCHEMA_ARTIFACT_USAGES,
  SCHEMA_OWNERSHIP_DELTAS,
  SCHEMA_TIE_DELTAS,
  SCHEMA_CHARACTER_MOVEMENTS,
  SCHEMA_EVENTS,
].join(',\n      ');
