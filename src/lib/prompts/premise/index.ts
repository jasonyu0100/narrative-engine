/**
 * Premise Discovery Prompts
 *
 * Prompts for the Socratic premise discovery flow.
 */

/**
 * System prompt for premise discovery.
 * Guides the LLM to act as a world architect through Socratic questioning.
 */
/**
 * Prompt for random premise suggestion (used by the creation wizard).
 * Register-neutral: the premise may be fiction, memoir, essay, reportage,
 * or research. Cultural palette explicitly non-Western-defaulting.
 */
export const PREMISE_SUGGEST_PROMPT = `Generate an original, compelling premise for a long-form work. Be specific and evocative — not generic. The work may be fiction (novel, novella, story), memoir, essay, long-form reportage, or research — pick whichever register the premise most naturally belongs to.

Return JSON:
{
  "title": "A memorable title (2-5 words)",
  "premise": "A compelling setup in 2-3 sentences. Include: a specific anchoring figure (protagonist, author, investigator, subject) carrying a tension, contradiction, or flaw; an inciting situation or question that demands engagement; and stakes that make us care. Ground it in a particular time, place, culture, or intellectual tradition. Avoid generic tropes of any genre — Western fantasy/sci-fi, thriller, academic abstraction — unless you subvert them."
}

Be original. Draw from any genre, register, time period, or culture — East Asian, South Asian, African, Middle Eastern, Indigenous, Latin American, diasporic, non-Western-canonical — and do not default to Anglo/European settings. Non-fiction premises are as welcome as fiction. Surprise me.`;

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
  threads: `THREADS: Threads are COMPELLING QUESTIONS with stakes, uncertainty, and investment. Match the work's register. BAD: "Will X succeed?" GOOD (narrative): "Can Ayesha clear her grandfather's name before the tribunal ends?" GOOD (argument): "Does the proposed mechanism explain anomalies the prior model cannot?" GOOD (inquiry): "What role did diaspora networks play in the movement before digital coordination?" Focus on conflicts, claims, secrets, open questions. Extract threads with participant names.`,
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
