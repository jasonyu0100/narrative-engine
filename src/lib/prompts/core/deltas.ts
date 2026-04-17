/**
 * Delta Guidelines Prompt
 *
 * Direct inputs to force formulas. Every delta must be EARNED by prose.
 * Thread deltas are GAME MOVES — each delta is a player's strategic action
 * within the thread's contested game.
 */

export const PROMPT_DELTAS = `
DELTAS — direct inputs to force formulas. Every delta EARNED by prose. Applies across fiction, non-fiction, research, simulation.

FORMULAS: F = Σ √arcs × stageWeight × (1 + log(1 + investment)) | W = ΔN_c + √ΔE_c | S = ΔN + √ΔE

ALL NODE CONTENT: 15-25 words, PRESENT TENSE, specific and concrete.

DENSITY TARGETS (21/25 at reference — fate 2.5, world 12, system 3):
  Breather:  0 transitions, 6-8 world, 0-1 system
  Typical:   0-1 transitions, 10-14 world, 2-4 system + edges
  Climactic: 1-2 transitions, 16-20+ world, 4-6 system + edges
  Theory / lore dump: modest world (6-10), heavy system (5-10)
Variance required — peaks and valleys, not flatline.

INITIALIZATION FLOOR — zero-node entities and zero-log threads are invalid:
  - Every new character / location / artifact must have ≥1 node in its world.nodes at creation. Role/prominence/significance minimums (see below) are the target; 1 is the absolute floor.
  - Every new thread must be opened by a scene threadDelta carrying ≥1 addedNode (type "setup") that records the seed moment. A thread whose opening scene has no log entry is broken — the question has been posed with no record of it being posed.

threadDeltas — Threads are CONTESTED GAMES between participants who want different outcomes.
  A strong thread has STAKES, UNCERTAINTY, INVESTMENT, and ASYMMETRY (participants have different optimal resolutions).
  Thread logs track MOVES — each addedNode is a strategic action by or affecting a participant.
  BAD as a default: "Will Bob succeed?" / "Does the method work?" (too plain, no asymmetry)
  ACCEPTABLE when intentional: picaresque, satirical, ironic, or open-inquiry work.
  GOOD (dramatic fiction): "Can Ayesha clear her grandfather's name before the tribunal ends?"
  GOOD (literary fiction, lyric register): "What does the river remember of the flood, and does the narrator want to know?"
  GOOD (argument): "Does the proposed mechanism explain the anomalies the prior model cannot, and at what cost?"
  GOOD (inquiry): "What role did diaspora networks play in the movement before digital coordination?"
  Thread logs track incremental ANSWERS — the moves in the game — over time.

  GAME THINKING FOR DELTAS — when writing thread deltas, consider:
  - WHO BENEFITS from this delta? A setup is an investment — by a character in fiction, by an argument in non-fiction, by a hypothesis in inquiry. What payoff is being hoped for?
  - WHO LOSES? An escalation that commits one participant constrains all others. In argument: a strong claim narrows the space for alternative explanations.
  - IS THIS COOPERATIVE OR DEFECTIVE? Two participants can both advance a thread (cooperation) even while wanting different outcomes. A resistance move is defection — blocking another's strategy. In non-fiction: counterevidence is defection against the emerging thesis; corroboration is cooperation.
  - WHAT INFORMATION CHANGED? A twist or reveal reshapes the game — everyone recalculates. In fiction: a secret exposed. In argument: a decisive finding published. In inquiry: a key source surfacing.
  - CROSS-THREAD EFFECTS: Advancing Thread A may cost Thread B. When scenes touch 2-4 threads, think about how moves in one thread affect the games in others. In argument: evidence supporting one claim may undermine a different claim the author also needs.

  STATUS (from/to): latent | seeded | active | escalating | critical | resolved | subverted | abandoned
    "pulse" is NOT a status. Transitions move ONE step. 0-1 transitions per scene.
  LOG TYPE: pulse | transition | setup | escalation | payoff | twist | callback | resistance | stall
  DENSITY: 1 node per thread touch — the decisive game move. A second node only when the scene contains a genuine multi-step sequence (e.g., twist → counter-move). 3 is the hard cap for pivotal resolutions. Most scenes: 1 node per thread.
  ATTRIBUTION — every log entry records ONE actor, ONE target, and the MATRIX CELL played:
  - actorId: the single entity whose action drives this event.
  - targetId: the single entity primarily affected. Omit for self-directed or environmental events.
  - stance: cooperative (advancing actor's interests), competitive (opposing target's), or neutral.
  - matrixCell: REQUIRED on EVERY log entry — no exceptions.
    First letter = ACTOR's action, second letter = TARGET's action:
      c = takes their ADVANCING action (the actionA/actionB from the payoff matrix)
      d = takes their BLOCKING action (the defectA/defectB from the payoff matrix)
    So: cc = both advance, cd = actor advances target blocks, dc = actor blocks target advances, dd = both block.

    WHEN TARGET IS NULL: still required. cc = actor advances the thread, dc = actor blocks/disrupts.
    WHEN TARGET EXISTS: map both players' actions to the payoff matrix.

    Fiction: "Chi Lian challenges Bo" → dc | "Fang Yuan cedes the carcass" → cd | "Both agree to patrol" → cc
    Non-fiction: "Attention outperforms recurrence" → dc | "Both methods complement" → cc | "Model fails to replicate" → cd
  COMMITMENT: escalating = an irreversible strategic investment (must resolve / subvert / formally abandon).
  Prune stale threads (5+ scenes without transition). Keep thread count lean — 10+ threads = noise.

worldDeltas — Entity's PRESENT TENSE facts. For characters: traits, beliefs, capabilities, wounds. For ideas / methods / institutions: properties demonstrated, qualifications earned, capabilities shown, known failure modes.
  GOOD (fiction): "Harry has a lightning-bolt scar from surviving the killing curse."
  GOOD (non-fiction): "The force grading formula is calibrated so published works score 85-92 on a 100-point curve."
  BAD: "Harry discovered..." / "The authors realised..." (events — belong in thread log or events).
  2-4 nodes per entity. Node ORDER matters (auto-chains).

  SIDE-CHARACTER EVOLUTION IS THE NAME OF THE GAME:
  The world should feel alive around the protagonist — side characters making their own decisions, reacting to their own situations, evolving over arcs. Do NOT force a worldDelta on every participant; a character who was genuinely unchanged by the scene gets nothing. But when a secondary character was changed — suspected something, decided something, learned something, adjusted their plans — capture that shift, not as a reaction to the POV but as their OWN internal movement.
  "Meng Song suspects Fang Yuan is hiding something" is agency; "Meng Song is impressed by Fang Yuan" is a reaction (and a thin one). The former shows the character thinking; the latter shows them orbiting the POV. When in doubt, lean toward the agentic framing.

  OFF-SCREEN EVOLUTION — the world turns when the POV isn't looking:
  worldDeltas can target characters NOT in participantIds when the scene's events reach them through realistic channels — news, rumours, observed public acts, intelligence networks, faction responses. A rival receiving word of a visible action, a mentor hearing of an outcome, a council adjusting plans in response to a power shift — these are valid off-screen deltas that make the world feel alive.
  Use them when the plan implies a realistic ripple. Not every scene needs them; scenes that affect only the POV's private sphere don't warrant them. But across an arc, you should see side characters evolving independently — their own decisions accumulating over time, not waiting for the protagonist to act on them.

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
