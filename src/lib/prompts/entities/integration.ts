/**
 * Entity Integration Rules Prompt
 *
 * Shared between world generation and world expansion.
 */

export const PROMPT_ENTITY_INTEGRATION = `
INTEGRATION RULES:
- Characters are conscious beings with agency. Non-sentient AI is an artifact. Every new character MUST have at least 1 relationship to an existing character.
- Locations are spatial areas. Every new location SHOULD nest under an existing location via parentId (except top-level regions).
- Artifacts are CONCRETE TOOLS with specific utility — not abstract concepts. The test: can you invoke it to accomplish something? "GPT-4" = artifact. "Machine learning" = concept (system knowledge). Artifacts have parentId: character, location, or null (world-owned for ubiquitous tools like AI, internet).
- Thread participants MUST include at least one existing character or location.
- Names must match the cultural palette already established in the world.

INITIALIZATION REQUIREMENT — HARD RULE, NO EXCEPTIONS:
- Every new character, location, and artifact MUST ship with at least 1 node in its world.nodes array at the moment of creation. Empty world graphs are invalid output. Even a transient character or margin location needs one grounding fact (15-25 words, PRESENT tense).
- Every new thread MUST open with a threadDelta on the scene that introduces it, and that threadDelta MUST contain at least 1 addedNode (type "setup") recording the seed moment. A thread whose introducing scene carries no log entry is invalid output.
- These seed entries define the entity's starting position in its own graph. A blank entity has no readable history and silently zeros out force contributions.
`;
