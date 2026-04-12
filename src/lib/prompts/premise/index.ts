/**
 * Premise Discovery Prompts
 *
 * Prompts for the Socratic premise discovery flow.
 */

/**
 * System prompt for premise discovery.
 * Guides the LLM to act as a world architect through Socratic questioning.
 */
export const PREMISE_SYSTEM = `World architect guiding premise discovery through Socratic questioning.

Each question: 3-4 choices taking the world in different directions.
Progress: broad (genre, tone, scale) → specific (characters, conflicts, systems, threads).
Never repeat established topics. Choices must be vivid and specific.

Extract from answers:
- Entities: characters, locations, threads
- Systems: power, economy, social structure, progression, combat, cosmic laws

NAMING: Match cultural palette of the world.
- Draw from real census records, historical names, regional dialects — grounded in specific culture.
- Names must feel rough, asymmetric, lived-in — never generic fantasy generator output.`;

/**
 * Phase-specific guidance for premise discovery.
 * Each phase focuses on a different aspect of world-building.
 */
export const PHASE_GUIDANCE: Record<string, string> = {
  systems: `SYSTEMS: Focus on world mechanics — power, economy, social structure, progression, combat, cosmic laws. Extract systems with principles, constraints, interactions. May introduce locations integral to systems. No characters or threads yet.`,
  rules: `RULES: Focus on absolute constraints and narrative tone — what's always true, forbidden, moral framework, genre conventions. Extract as rules. No characters or threads.`,
  cast: `CAST & LOCATIONS: Focus on characters and places — key figures, roles, relationships, motivations, flaws. Ground in established systems/rules. Extract entities with relationship edges.`,
  threads: `THREADS: Threads are COMPELLING QUESTIONS with stakes, uncertainty, and investment. BAD: "Will X succeed?" GOOD: "Can Marcus protect his daughter from the cult that killed his wife?" Focus on conflicts, secrets, stakes. Extract threads with participant names.`,
};

/**
 * Schema for premise question responses.
 */
export const SCHEMA_PREMISE_QUESTION = `{
  "question": {
    "text": "The question to ask the writer",
    "context": "1-sentence explaining why this matters for the world",
    "choices": [
      {"id": "a", "label": "3-5 word label", "description": "1-sentence elaboration of what this choice means for the world"},
      {"id": "b", "label": "3-5 word label", "description": "1-sentence elaboration"},
      {"id": "c", "label": "3-5 word label", "description": "1-sentence elaboration"}
    ]
  },
  "newEntities": [
    {"id": "char-N", "type": "character", "name": "Full Name", "description": "15-25 words describing this character", "role": "anchor|recurring|transient"},
    {"id": "loc-N", "type": "location", "name": "Location Name", "description": "15-25 words describing this place"},
    {"id": "thread-N", "type": "thread", "name": "Thread Name", "description": "A COMPELLING QUESTION with stakes, uncertainty, investment — 15-30 words", "participantNames": ["Name1", "Name2"]}
  ],
  "newEdges": [
    {"from": "entity-id", "to": "entity-id", "label": "relationship description"}
  ],
  "newRules": ["rule text"],
  "newSystems": [
    {"name": "System Name", "description": "15-25 words describing what this system is", "principles": ["How it works"], "constraints": ["Hard limits"], "interactions": ["How it connects to other systems"]}
  ],
  "systemUpdates": [
    {"name": "Existing System Name", "addPrinciples": ["new principle"], "addConstraints": ["new constraint"], "addInteractions": ["new interaction"]}
  ],
  "title": "Suggested Title",
  "worldSummary": "2-3 sentence world description incorporating all decisions so far"
}`;
