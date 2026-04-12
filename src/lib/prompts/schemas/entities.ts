/**
 * Entity Creation Schema Fragments
 *
 * Reusable schema blocks for character, location, artifact, and thread creation.
 * Used by world generation, world expansion, and analysis prompts.
 */

// ── Character Schemas ───────────────────────────────────────────────────────

export const SCHEMA_CHARACTER_CONTINUITY_NODE = `{"id": "K-XX", "content": "15-25 words, PRESENT tense: a stable fact about this character — trait, belief, capability, state, secret, goal, or weakness", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}`;

export const SCHEMA_CHARACTER_CREATION = `{
  "id": "C-XX",
  "name": "Full name matching the cultural palette of the world — rough, asymmetric, lived-in names from real census records, historical obscurities, or regional dialects",
  "role": "anchor|recurring|transient",
  "threadIds": ["T-XX"],
  "imagePrompt": "1-2 sentence LITERAL physical description — concrete traits (hair colour, build, clothing). No metaphors or figurative language; image generators interpret literally.",
  "continuity": {
    "nodes": [${SCHEMA_CHARACTER_CONTINUITY_NODE}]
  }
}`;

// ── Location Schemas ────────────────────────────────────────────────────────

export const SCHEMA_LOCATION_CONTINUITY_NODE = `{"id": "LK-XX", "content": "15-25 words, PRESENT tense: a stable fact about this location — history, rules, dangers, atmosphere, or properties", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}`;

export const SCHEMA_LOCATION_CREATION = `{
  "id": "L-XX",
  "name": "Location name from geography, founders, or corrupted older words — concrete and specific",
  "prominence": "domain|place|margin",
  "parentId": "existing location ID to nest under, or null ONLY for top-level regions",
  "threadIds": [],
  "tiedCharacterIds": ["character IDs with significant ties — residents, employees, faction members, students"],
  "imagePrompt": "1-2 sentence LITERAL visual description — architecture, landscape, lighting, weather. Concrete physical details only.",
  "continuity": {
    "nodes": [${SCHEMA_LOCATION_CONTINUITY_NODE}]
  }
}`;

// ── Artifact Schemas ────────────────────────────────────────────────────────

export const SCHEMA_ARTIFACT_CONTINUITY_NODE = `{"id": "AK-XX", "content": "15-25 words, PRESENT tense: what this artifact is, what it does, its history, powers, or limitations", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}`;

export const SCHEMA_ARTIFACT_CREATION = `{
  "id": "A-XX",
  "name": "Artifact name — concrete and specific to its function or origin",
  "significance": "key|notable|minor",
  "parentId": "owner — a character or location ID, or null for world-owned (universally accessible)",
  "threadIds": [],
  "imagePrompt": "1-2 sentence LITERAL visual description — concrete physical details only, no metaphors or figurative language.",
  "continuity": {
    "nodes": [${SCHEMA_ARTIFACT_CONTINUITY_NODE}]
  }
}`;

// ── Thread Schemas ──────────────────────────────────────────────────────────
// Threads are COMPELLING QUESTIONS that shape fate. A compelling question has:
// - STAKES: what's at risk if the question is answered one way vs another
// - UNCERTAINTY: the outcome is not obvious, multiple answers are plausible
// - INVESTMENT: we care about the answer because of character attachment or thematic weight
// Thread logs track incremental answers to these questions over time.

export const SCHEMA_THREAD_CREATION = `{
  "id": "T-XX",
  "participants": [{"id": "C-XX or L-XX or A-XX", "type": "character|location|artifact"}],
  "description": "A COMPELLING QUESTION with stakes, uncertainty, and investment. BAD: 'Will Bob succeed?' GOOD: 'Can Marcus protect his daughter from the cult that killed his wife?' — 15-30 words",
  "status": "latent|seeded|active|escalating|critical",
  "openedAt": "S-001 or 'new'",
  "dependents": ["T-YY — existing thread IDs this thread connects to, accelerates, or converges with"]
}`;

// ── Relationship Schema ─────────────────────────────────────────────────────

export const SCHEMA_RELATIONSHIP_CREATION = `{"from": "C-XX", "to": "C-YY", "type": "15-25 words describing the relationship — specific dynamic, not generic labels", "valence": -1.0 to 1.0}`;

// ── Analysis Variants (name-based) ──────────────────────────────────────────

export const SCHEMA_ANALYSIS_CHARACTER = `{"name": "Full Name", "role": "anchor|recurring|transient", "firstAppearance": true|false, "imagePrompt": "1-2 sentence LITERAL physical description"}`;

export const SCHEMA_ANALYSIS_LOCATION = `{"name": "Location Name", "prominence": "domain|place|margin", "parentName": "Parent location or null", "description": "15-25 words describing this place — specific and concrete", "imagePrompt": "1-2 sentence LITERAL visual description", "tiedCharacterNames": ["characters tied here"]}`;

export const SCHEMA_ANALYSIS_ARTIFACT = `{"name": "Artifact Name", "significance": "key|notable|minor", "imagePrompt": "1-2 sentence LITERAL visual description", "ownerName": "owner or null"}`;

export const SCHEMA_ANALYSIS_THREAD = `{"description": "A COMPELLING QUESTION with stakes, uncertainty, investment — 15-30 words", "participantNames": ["names"], "statusAtStart": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "statusAtEnd": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "development": "15-25 words: how this question was advanced or answered in this scene"}`;

export const SCHEMA_ANALYSIS_RELATIONSHIP = `{"from": "Name", "to": "Name", "type": "15-25 words describing the relationship", "valence": -1.0 to 1.0}`;
