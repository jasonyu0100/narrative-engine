/**
 * Beat Functions & Mechanisms Prompt
 *
 * Single source of truth for beat classification — used by plan generation,
 * reverse engineering, and prose generation.
 */

export const PROMPT_BEAT_TAXONOMY = `
Beat taxonomy is register-neutral. In fiction a beat is a story move; in essay/reportage/research
it is a move in the argument or inquiry. The same 10 functions + 8 mechanisms apply — only the
substance shifts.

FUNCTIONS (10) — what the beat does:
  breathe    — Atmosphere, sensory grounding, scene establishment (in essay: setting the stage, framing)
  inform     — Someone learns something NOW (a character, a reader, or — in argument — the reader learns a fact/result)
  advance    — Forward motion: plot moves, goals pursued, claim pressed, evidence accumulates
  bond       — Relationship shifts (between characters, or between author and reader, or between positions)
  turn       — Revelation, reversal, interruption, counterargument
  reveal     — Underlying nature exposed through action/choice (character, system, data, source)
  shift      — Power dynamic inverts (between characters, between theories, between stakeholders)
  expand     — New rule, system, geography, mechanism, or citation introduced
  foreshadow — Plants information for LATER payoff (a seed that pays off as callback or as prediction tested)
  resolve    — Tension releases; question answered; claim settled; finding stated

MECHANISMS (8) — how prose delivers. Read the register-appropriate sense:
  dialogue    — Quoted speech (fiction); quoted source / interview excerpt / reported speech (non-fiction)
  thought     — POV internal monologue (fiction); authorial reasoning / evidentiary inference (non-fiction)
  action      — Physical movement, gesture (fiction); demonstrated operation, procedure, worked step (non-fiction)
  environment — Setting, weather, sounds (fiction); scene-setting description of field, lab, archive, community
  narration   — Narrator voice, exposition, time compression, signposting, synthesis
  memory      — Flashback triggered by association (fiction); historical precedent, prior literature, case (non-fiction)
  document    — Embedded text (letter, sign, citation, table caption, figure, footnote, data excerpt)
  comic       — Humor, irony, absurdity, bathos, deliberate understatement

EDGE CASES: Overhearing = environment | Thinking / reasoning internally = thought | Describing speech or paraphrasing a source = narration | Direct quotation of a source = dialogue or document (pick the closer fit)
`;
