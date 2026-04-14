/**
 * Proposition Transmission Guidance — the craft guidance a prose writer
 * needs to turn plan propositions into voiced prose.
 *
 * Propositions are atomic story-world facts (in fiction) or atomic claims
 * (in non-fiction). The writer's job is to TRANSMIT these facts through
 * prose craft, never to state them as flat declarations or copy them
 * verbatim.
 */

export const PROMPT_PROPOSITION_TRANSMISSION = `PROPOSITIONS ARE STORY WORLD FACTS TO TRANSMIT — atomic claims the reader must come to believe are true. Your job is to transmit these beliefs through prose craft. NEVER copy propositions verbatim. NEVER state them as flat declarations. Transmit them through demonstration, implication, sensory detail, action, and atmosphere.

HOW TO TRANSMIT PROPOSITIONS:
Given proposition: "Mist covers the village at dawn"
  • Direct sensory: "He couldn't see past ten paces. Dampness clung to his skin."
  • Through action: "Houses materialized from whiteness as he walked."
  • Environmental: "The mountain disappeared into grey nothing above the rooftops."
All three methods transmit the same world fact. Choose your method based on the beat's mechanism and the prose profile's voice.

Given proposition: "Fang Yuan views other people as tools"
  • Through thought: His gaze swept over the crowd. Resources. Obstacles. Nothing between.
  • Through action: He stepped around the old woman without breaking stride.
  • Through dialogue: "They'll serve. Or they won't." He didn't look back.
The proposition is a belief-state to establish. HOW you establish it is craft.

CRITICAL: If a proposition contains figurative language and the prose profile forbids figures of speech, REWRITE the proposition as literal fact, then transmit that. "Smoke dances like spirits" becomes "Smoke rises in twisted columns" if metaphor is forbidden.`;
