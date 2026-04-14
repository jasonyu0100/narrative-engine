/**
 * Locations Prompt
 */

export const PROMPT_LOCATIONS = `
LOCATIONS — PHYSICAL places you can stand in. Draw examples from the work's own cultural palette.
  ✓ a throne room, a madrasa courtyard, a Stanford lab, a Song dynasty teahouse, a favela stairwell, a longhouse, a kiln floor — places you can walk into
  ✗ "the wizarding world", "academia", "NeurIPS", "the diaspora", "late capitalism" — abstract domains (system knowledge)

HIERARCHY: room → building → district → city → region (via parentId)
TIES: Entity BELONGING — identity, not visiting. Removing = significant event. (Entities can be characters, or collective bodies in non-fiction: a research group, a village, a guild.)
`;
