/**
 * Delta Guidelines Prompt
 *
 * Direct inputs to force formulas. Every delta must be EARNED by prose.
 */

export const PROMPT_DELTAS = `
DELTAS — direct inputs to force formulas. Every delta EARNED by prose. Applies across fiction, non-fiction, research, simulation.

FORMULAS: F = Σ √arcs × stageWeight × (1 + log(1 + investment)) | W = ΔN_c + √ΔE_c | S = ΔN + √ΔE

ALL NODE CONTENT: 15-25 words, PRESENT TENSE, specific and concrete.

DENSITY TARGETS (21/25 at reference — fate 1.5, world 12, system 3):
  Breather:  0 transitions, 6-8 world, 0-1 system
  Typical:   0-1 transitions, 10-14 world, 2-4 system + edges
  Climactic: 1-2 transitions, 16-20+ world, 4-6 system + edges
  Theory / lore dump: modest world (6-10), heavy system (5-10)
Variance required — peaks and valleys, not flatline.

threadDeltas — Threads are COMPELLING QUESTIONS. In fiction they shape fate; in non-fiction they shape the argument's or inquiry's trajectory. Either way: STAKES, UNCERTAINTY, INVESTMENT — in registers that call for them.
  BAD as a default: "Will Bob succeed?" / "Does the method work?" (too plain to carry a full arc)
  ACCEPTABLE when intentional: picaresque, satirical, ironic, or open-inquiry work may use a deliberately simple recurring question as its spine. The simplicity must be a choice, not a failure — the register must earn the flatness.
  GOOD (dramatic fiction): "Can Ayesha clear her grandfather's name before the tribunal ends?"
  GOOD (literary fiction, lyric register): "What does the river remember of the flood, and does the narrator want to know?"
  GOOD (argument): "Does the proposed mechanism explain the anomalies the prior model cannot, and at what cost?"
  GOOD (inquiry): "What role did diaspora networks play in the movement before digital coordination?"
  GOOD (memoir): "Can the narrator name the thing their mother refused to name?"
  GOOD (essayistic criticism): "Can poststructuralist close reading account for silence as resistance in this corpus?"
  Thread logs track incremental ANSWERS over time.
  STATUS (from/to): latent | seeded | active | escalating | critical | resolved | subverted | abandoned
    "pulse" is NOT a status. Transitions move ONE step. 0-1 transitions per scene.
  LOG TYPE: pulse | transition | setup | escalation | payoff | twist | callback | resistance | stall
  COMMITMENT: escalating = point of no return (must resolve / subvert / formally abandon).
  Prune stale threads (5+ scenes without transition). Keep thread count lean — 10+ threads = noise.

worldDeltas — Entity's PRESENT TENSE facts. For characters: traits, beliefs, capabilities, wounds. For ideas / methods / institutions: properties demonstrated, qualifications earned, capabilities shown, known failure modes.
  GOOD (fiction): "Harry has a lightning-bolt scar from surviving the killing curse."
  GOOD (non-fiction): "The force grading formula is calibrated so published works score 85-92 on a 100-point curve."
  BAD: "Harry discovered..." / "The authors realised..." (events — belong in thread log or events).
  2-4 nodes per entity. Node ORDER matters (auto-chains).

systemDeltas — How the WORLD / DOMAIN WORKS. General rules, not specific entities. In fiction: magic, physics, social order. In non-fiction: theorems, mechanisms, models, constraints, established principles.
  GOOD (fiction): "Magic near underage wizards is attributed to them regardless of caster."
  GOOD (non-fiction): "Delivery is computed as the equal-weighted mean of z-score-normalised force values."
  REUSE existing IDs. Types: principle, system, concept, tension, constraint.
  Edges: enables, governs, opposes, extends, constrains.

relationshipDeltas — Only SHIFTS between entities (interpersonal dynamics in fiction; inter-claim / inter-idea / inter-institution dynamics in non-fiction). valenceDelta: ±0.1 subtle, ±0.3 meaningful, ±0.5 dramatic.
events — 2-4 word tags, 2-4 per scene. Register-appropriate (see SYSTEM_PROMPT).
artifactUsages — When an artifact / tool / dataset / instrument delivers utility. ownershipDeltas — Changing hands / reassignment.
characterMovements — Location CHANGES only (physical location for fiction; venue / organisational context for non-fiction).
`;
