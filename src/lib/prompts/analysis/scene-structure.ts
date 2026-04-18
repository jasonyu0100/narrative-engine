/**
 * Scene Structure Extraction Prompts
 *
 * The scene-level extraction step that converts raw prose + beat plan into
 * narrative structure (entities, deltas, threads, events). Two pieces:
 *   1. The JSON schema / return-shape instructions (top half).
 *   2. The EXTRACTION STANDARDS field guide (bottom half).
 * They are concatenated before being sent.
 */

import type { BeatPlan } from '@/types/narrative';

export const SCENE_STRUCTURE_SYSTEM = `You are a narrative structure extractor. Given a scene's exact prose and its beat plan, extract all entities, deltas, and structural data accurately. Dense prose deserves rich extraction; sparse prose deserves minimal extraction. Return only valid JSON.`;

/**
 * Build the scene-structure user prompt from prose + optional beat plan.
 * The returned string contains the JSON schema, a newline, and the full
 * EXTRACTION STANDARDS field guide.
 */
export function buildSceneStructurePrompt(prose: string, plan: BeatPlan | null): string {
  const beatSection = plan
    ? `\n\nBEAT PLAN (${plan.beats.length} beats — use as a guide for where events happen):\n${plan.beats.map((b, i) => `Beat ${i + 1} [${b.fn}/${b.mechanism}]: ${b.what}`).join('\n')}`
    : '';

  const prompt = `Extract narrative structure from this scene's prose.

SCENE PROSE:
${prose}${beatSection}

THREE ORTHOGONAL PLANES — extract each independently:
- WORLD (MATERIAL plane): tangible, embodied. People, places, objects — characters, locations, artifacts; in non-fiction: institutions, datasets, figures, charts, embedded documents. Every new stable fact about an entity.
  W = ΔN_c + √ΔE_c. Ref: ~12/scene.
- SYSTEM (ABSTRACT plane): rules, mechanisms, principles — how the world works, not the things themselves. Magic systems, physics, social order; or theorems, methods, constraints. Rule and knowledge density — NOT incidental setting.
  S = ΔN + √ΔE. Ref: ~4/scene.
- FATE (METAPHYSICAL plane): the higher-order pull that governs what material and abstract can't account for alone. Only fires when action or outcome exceeds what traits and rules would predict.
  F = Σ √arcs × stageWeight × (1 + log(1 + investment)). Ref: ~3.5/scene.

Return JSON:
{
  "povName": "POV character name",
  "locationName": "Where this scene takes place",
  "participantNames": ["All characters present"],
  "events": ["short_event_tags"],
  "summary": "3-5 sentence narrative summary using character and location NAMES",
  "characters": [{"name": "Full Name", "role": "anchor|recurring|transient", "firstAppearance": false, "imagePrompt": "1-2 sentence LITERAL physical description: concrete traits like hair colour, build, clothing style. No metaphors or figurative language."}],
  "locations": [{"name": "Location Name", "prominence": "domain|place|margin", "parentName": "Parent or null", "description": "Brief description", "imagePrompt": "1-2 sentence LITERAL visual description: architecture, landscape, lighting, weather. Concrete physical details only, no metaphors.", "tiedCharacterNames": ["characters tied here"]}],
  "artifacts": [{"name": "Artifact Name", "significance": "key|notable|minor", "imagePrompt": "1-2 sentence LITERAL visual description — concrete physical details only, no metaphors or figurative language", "ownerName": "owner or null"}],
  "threads": [{"description": "A COMPELLING QUESTION with stakes, uncertainty, investment — 15-30 words. BAD: 'Will X succeed?' GOOD: 'Can Marcus protect his daughter from the cult that killed his wife?'", "participantNames": ["names"], "statusAtStart": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "statusAtEnd": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "development": "15-25 words: how this question was advanced or answered in this scene"}],
  "relationships": [{"from": "Name", "to": "Name", "type": "description", "valence": 0.0}],
  "threadDeltas": [{"threadDescription": "exact thread description", "from": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "to": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "addedNodes": [{"content": "15-25 words: how this question was advanced or answered in this scene", "type": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall"}]}],
  "worldDeltas": [{"entityName": "Name", "addedNodes": [{"content": "15-25 words, PRESENT tense: a stable fact about the entity — their unique perspective on reality, identity, or condition. Emit as many 15-25-word nodes per entity as the scene genuinely reveals — no count cap.", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}],
  "relationshipDeltas": [{"from": "Name", "to": "Name", "type": "description", "valenceDelta": 0.1}],
  "artifactUsages": [{"artifactName": "Name", "characterName": "who or null", "usage": "what the artifact did"}],
  "ownershipDeltas": [{"artifactName": "Name", "fromName": "prev", "toName": "new"}],
  "tieDeltas": [{"locationName": "Name", "characterName": "Name", "action": "add|remove"}],
  "characterMovements": [{"characterName": "Name", "locationName": "destination", "transition": "15-25 words describing how they traveled — the journey, transport, or spatial transition"}],
  "systemDeltas": {"addedNodes": [{"concept": "15-25 words, PRESENT tense: a general rule or structural fact — how the world works, no specific characters or events. Emit as many nodes as the scene genuinely reveals about how the world works — no count cap.", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"fromConcept": "name", "toConcept": "name", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]}
}`;

  const fieldGuide = `
EXTRACTION STANDARDS — analysis filters an unlimited source. This is NOT generation.

Generation works from a limited source (direction + context) and needs guidelines — density floors, count targets, "2-4 nodes per entity" — to produce ENOUGH quality.

Analysis works from an already-enriched source (the prose in front of you). There is no quality floor to enforce; there's only a signal to extract. Every claim the prose earns should land in the graph. If the text is sparse, extract little; if dense, extract a lot. Node count has NO cap (neither min nor max) — count follows the information the text actually carries. Standards still hold on format (15-25 words per node, present tense, distinct claims, one claim per node), but on COUNT the prompt trusts you to match the density of the source.

Entities are SPONGES: rich prose produces many 15-25-word nodes; sparse prose produces few. Do NOT under-extract to hit a role/significance/prominence "target"; do NOT over-extract to pad a count. Match the source.

Every delta must EARN its place — low-value deltas still flatten the graph. But the test is "is this a genuinely new claim the prose earned?" not "have I hit a count?".

DETECTING FATE — Fate is a HIGHER-ORDER force that compels the world and system to bend toward narrative meaning. It is NOT the ordinary running of threads; it is what pulls arcs toward resolution against or beyond the local logic of rules and character traits.
- A compelling question has STAKES (what's at risk), UNCERTAINTY (outcome not obvious), INVESTMENT (we care).
- Weak: "Will [Name] succeed?" (too plain to carry an arc on its own, unless the form is picaresque or satirical). Strong (narrative): "Can Ayesha clear her grandfather's name before the tribunal ends?" Strong (argument): "Does the proposed mechanism explain anomalies the prior model cannot?" Strong (inquiry): "What role did diaspora networks play in the movement before digital coordination?"
- Key test: if a character's action in this scene can be fully explained by their traits, their constraints, and the system's rules — that is ordinary world/system activity, NOT fate. Fate earns its weight when actions OUTRUN those explanations: a vow kept at cost the trait-profile would not predict, a coincidence that ratifies itself into pattern, a thread resolving because the story required it rather than because causation forced it.
- Read prose for MOMENTS THAT MATTER — where does the arc advance against the local pull?
- BE SELECTIVE. Routine lifecycle movement of minor threads (meetings arranged, letters delivered, small-stakes plans proceeding) does NOT earn fate weight. Reserve transitions and payoffs for arc-central threads where the story's larger pull is visibly acting.
- A thread delta records your detection: "this moment moves the story closer to answering an arc-level question."
- Thread logs track incremental ANSWERS to these questions over time.
- Fate is what pulls world and system toward meaning. Without it, nothing resolves — but not every beat has it, and forcing it where it isn't present inflates the signal and dilutes the archetype read downstream.

THREAD CREATION — WHICH QUESTIONS BECOME THREADS.
Threads are EXPENSIVE — arc-spanning tensions the story promises to resolve. Creating too many flattens the signal. Err toward FEWER, BIGGER threads. A full work typically has 5-15; a TV season 3-8. Extracting 10+ per scene means you're coding scene tensions as threads — collapse them into worldDeltas instead.

A candidate becomes a thread only if ALL three pass:
  1. MULTI-SCENE SPAN — takes many scenes (ideally arcs) to answer; anything that resolves within a scene is scene-level tension, not a thread.
  2. ARC-CENTRAL — resolving it moves the story's larger trajectory, not just describes a character's day-to-day.
  3. IRREVERSIBLE — answering it commits the narrative to a new state; recurring dynamics that reset every scene are character texture, not threads.

When a candidate fails — capture it as a worldDelta on the relevant entity, not as a thread:
  ✗ Recurring dynamics ("Will Jim keep pranking Dwight?") → worldDelta on Jim: "uses pranks on Dwight as a daily coping mechanism"
  ✗ Trait-verification ("Can Michael maintain his self-image as a beloved boss?") → worldDelta on Michael: "frames himself as a beloved, effective boss to reconcile his insecurities"
  ✗ Episode micro-plots that don't carry forward ("Will the forklift applicant get the job?") → scene events, not a thread
  ✗ Professional observations with no specific consequence in motion ("Will Michael's drinking hurt his work?") → worldDelta on Michael
  ✗ Interior struggles with no external commitment point ("Can X come to terms with their past?") → worldDelta on X unless a concrete reckoning is forced

CORRECT threads for this kind of show look like:
  ✓ "Will Jim and Pam's mutual attraction develop into a relationship despite Pam's engagement to Roy?" (arc-central, multi-season, irreversible)
  ✓ "Will the Scranton branch survive corporate pressure to downsize or merge?" (external stake, multi-episode, irreversible)

threadDeltas — lifecycle: latent→seeded→active→escalating→critical→resolved/subverted.
- Escalating = POINT OF NO RETURN. Once detected, the story has promised resolution.
- Abandoned = cleanup. Threads below escalating that go nowhere should be abandoned, not left hanging.
- ONE step at a time. NEVER skip phases.
- Pulses are same→same; transitions are status-changes that the prose shows as clear and irreversible.
- ONE step at a time. NEVER skip phases.
- Touch every thread the scene genuinely advances or pulses. Record every transition the prose genuinely shows. No count cap — if the scene is thread-heavy, the deltas are thread-heavy.
- THREAD LOG: each threadDelta includes log entries (15-25 words each) recording how the question was advanced or answered. Emit as many log entries as the scene genuinely reveals about the thread — one per distinct observation about the thread's progression. A pulse with one reinforcing beat = one node; a transition with a cause, a shift, and a forward implication = three nodes; a critical resolution with payoff, consequence, and callback = three. No cap.
  Log types: pulse (question maintained), transition (urgency advanced), setup (groundwork laid), escalation (stakes raised), payoff (question answered), twist (expectations subverted), callback (earlier thread event referenced), resistance (opposition to answer), stall (question stagnated).
  Each log node describes a SPECIFIC observation about thread progression, not a restatement of the scene summary.

worldDeltas — what we LEARN about an entity that wasn't known before. Applies to characters, locations, and artifacts.
- Characters: new behaviour, belief, capability, or inner state revealed. Not restating what's already known.
- Locations: new history, rules, dangers, or properties revealed. A location revisited can still earn continuity if the scene reveals something new about it.
- Artifacts: new capabilities, limitations, or properties demonstrated through usage.
- Short-lived artifacts (tables, figures, equations, embedded letters/notes/documents): the worldDelta captures the CONTENTS revealed — the data shown, the claim plotted, the text quoted. This is the artifact's entire knowledge graph; it will rarely be extended by later scenes.
- QUALITY BAR: each node must describe something NOT KNOWN before this scene.
  BAD: "Alice is curious" (observation). BAD: "The White Rabbit has pink eyes" (already established).
  GOOD: "Alice abandons caution entirely, chasing the Rabbit without considering how to return" (new behaviour).
  GOOD: "The forest conceals an ancient boundary ward that repels outsiders" (new location property).
  GOOD: "The wand backfires when used against its maker" (new artifact limitation).
  GOOD: "Table 2 reports a 2.3 BLEU drop on EN-DE when positional encoding is removed" (short-lived artifact contents).
- Every entity the scene reveals something new about gets one 15-25-word node per distinct claim. No count cap per entity. An entity laid bare across a dense reveal-scene may carry many nodes; an entity with one subtle shift carries one.
- Entities that appear without revealing anything new: ZERO nodes. Do NOT manufacture nodes to pad coverage — but DO extract every stable fact the scene actually shows.
- addedEdges: connect causally linked changes with "follows", "causes", "contradicts", "enables".
- Types: trait, state, history, capability, belief, relation, secret, goal, weakness.

relationshipDeltas — only when a relationship SHIFTS, not just exists.
- valenceDelta: ±0.1 subtle, ±0.2-0.3 meaningful, ±0.4-0.5 dramatic. Emit one per genuine shift the scene shows — no count cap.

systemDeltas — REVEALED world rules, not character observations. 15-25 words, PRESENT TENSE.
  FICTION: ✓ "Wizards cannot Apparate within Hogwarts grounds due to ancient protective enchantments."
  FICTION: ✓ "The One Ring corrupts its bearer over time, amplifying their desire for power."
  FICTION: ✗ "Magic" (too vague) — describe HOW it works
  NON-FICTION: ✓ "Self-attention computes weighted sums where each position attends to all positions in the sequence."
  NON-FICTION: ✓ "Transformers eliminate recurrence entirely, relying solely on attention mechanisms for sequence modeling."
  NON-FICTION: ✗ "Transformer architecture" (too short) — describe what it DOES
- Emit one 15-25-word node per genuinely new world-rule revealed. No count cap. Action scenes may reveal none; exposition/world-building scenes may reveal many. Match the source.
- Types: principle, system, concept, tension, event, structure, environment, convention, constraint.
- Edges: enables, governs, opposes, extends, created_by, constrains, exist_within.

ENTITY EXTRACTION — entities carry ONLY identity (name, role, significance). ALL world/lore MUST be emitted as scenes[].worldDeltas on the scene where it is revealed.

- characters: conscious beings with AGENCY IN THE SCENE. The test: does this person ACT, SPEAK, DECIDE, or THINK within the scene? If they are only NAMED (cited, referenced, listed, footnoted) without acting, they are NOT a character — skip entirely.
  FICTION: ✓ Harry Potter, Gandalf, Elizabeth Bennet — people with agency
  FICTION: ✓ Hedwig, Shadowfax — named animals with personality
  NON-FICTION: ✓ Einstein proposed relativity after observing X — acting in the narrative
  NON-FICTION: ✓ "the lead researcher configured the experiment" — someone performing an action
  NON-FICTION: ✗ "Vaswani et al., 2017", "Brown et al., 2020", "(Misra and Maaten, 2020)" — CITATION REFERENCES. Names appear once as a pointer to prior work, with no agency in the current text. Skip.
  NON-FICTION: ✗ Bibliography entries (full author-title-venue tuples at the end of a paper). Skip entirely — these are a REFERENCE LIST, not a cast.
  NON-FICTION: ✗ "Bordes et al., 2015", "Silver et al., 2021" — inline citations, even when repeated, if the author is only referenced (not depicted acting).
  NON-FICTION: ✗ "The scientific community", "reviewers", "prior work by X and Y" — collectives or one-line name-drops, not characters.
  EDGE CASE — the single test: take the scene, delete the character. Does the scene still read the same? If yes, they are a reference/citation, not a character. Do not extract them, and do not invent a transient character for one-line name-drops.
  role (anchor / recurring / transient) shapes downstream retrieval weight and narrative salience. It is NOT a worldDelta count target — emit as many 15-25-word nodes as the text genuinely reveals about the character. A transient walk-on with one dense reveal = one node; a recurring character whose interior is being laid bare across the scene = as many nodes as the reveals earn.

- locations: PHYSICAL spatial areas you can STAND IN.
  FICTION: ✓ Hogwarts, the Shire, Pemberley — places you can walk into
  FICTION: ✗ "The wizarding world", "Middle-earth politics" — abstract domains (system knowledge)
  NON-FICTION: ✓ Google's data center, Stanford lab, the conference room — physical places
  NON-FICTION: ✗ "The field of machine learning", "academia", "NeurIPS" — abstract domains (system knowledge)
  Nest via parentName. tiedCharacterNames: characters who BELONG (residents, members).
  prominence (domain / place / margin) shapes retrieval weight, NOT node count. Emit as many 15-25-word nodes as the text reveals about the location — history, rules, dangers, atmosphere, properties. A margin location with one atmospheric detail = one node; a domain being fully characterised for the first time = many.

- artifacts: things with UTILITY or ECONOMIC VALUE — objects that are USED, WIELDED, POSSESSED, CONSUMED, or DEPLOYED. The defining test: does this artifact deliver a specific utility to someone in the scene? If no utility → not an artifact.
  FICTION: ✓ A wand, the One Ring, a ship, a letter — objects wielded or possessed
  FICTION: ✓ A diary entry, a newspaper clipping, a map, a prophecy scroll — in-text DOCUMENTS that deliver information the reader/characters consume (short-lived: significance=minor/notable)
  FICTION: ✗ "Magic", "swordsmanship", "prophecy-as-concept" — concepts (system knowledge)
  NON-FICTION: ✓ GPT-4, TensorFlow, WMT dataset, P100 GPU — specific software/hardware/datasets actually USED in the work
  NON-FICTION: ✓ Figure 3, Table 2, Equation 4, Algorithm 1 — in-text artefacts whose utility is delivering specific data/claims/procedures. Name them explicitly with their content ("Figure 3: Mode-1 perception-action episode", "Table 2: ablation results").
  NON-FICTION: ✗ "Transformer architecture", "attention mechanism", "BLEU score" — techniques/metrics (system knowledge)
  NON-FICTION: ✗ "JEPA", "H-JEPA", "GAN", "VAE", "VQ-VAE", "Transformers", "Boltzmann Machine", "Siamese Network", "Dyna architecture", "Memory Network system", "SimCLR", "MoCo", "BYOL", "BERT" — these are METHOD CLASSES / ARCHITECTURES / CONCEPTS, not artifacts. They belong in systemDeltas. An artifact would be a specific trained model, binary, checkpoint, or dataset someone uses.
  NON-FICTION: ✗ "Brown et al., 2020", "Silver et al., 2021", "Vaswani et al., 2017", "(Misra and Maaten, 2020)" — CITATION REFERENCES to prior work. Not artifacts. Not characters. They are pointers into the bibliography; if the cited work introduces a concept being discussed, that concept belongs in systemDeltas.
  NON-FICTION: ✗ Bibliography entries (full author-title-venue tuples at the end of a paper). Skip entirely — they carry no scene-level narrative utility.
  NON-FICTION: ✗ The work being analysed itself (e.g., "A Path Towards Autonomous Machine Intelligence"). The paper is the text, not an artifact within it.
  NON-FICTION: ✗ Groups or collections of people ("the authors", "reviewers", "prior work by X and Y"). Not artifacts.
  ownerName: character/location/null. For figures/tables/equations the owner is the author (or null). Documents have an owner (sender, writer).
  significance (key / notable / minor) shapes retrieval weight, NOT node count. Each worldDelta node is a standard 15-25-word claim; the number of nodes follows the content the artifact genuinely carries — no cap.
  SHORT-LIVED ARTIFACTS (tables, figures, equations, algorithm listings, embedded letters/diaries/notes/maps): the artifact's utility IS its content. worldDeltas MUST capture that content — what the table shows, what the figure depicts, what the equation computes, what the letter says. Do NOT promote the contents to systemDeltas unless the text itself generalises them into a rule.
    GOOD (single-claim table): "Ablation removes positional encoding and BLEU drops 2.3 points on EN-DE, showing positional signal is load-bearing."
    GOOD (single-claim figure): "Plots attention weights across layers: lower layers attend locally, upper layers attend globally across 200-token windows."
    GOOD (letter): "Contains Dumbledore's instructions to leave Harry with the Dursleys and a warning that Voldemort may return."
    GOOD (lore-heavy artifact, many 15-25-word nodes — one per distinct claim the artifact carries):
      "A rank-6 Narrative-path Gu refused by Wisdom, Information, and Fate paths as hybrid refinement outside their doctrines."
      "Appears as a palm-sized inkstone whose well is stirred by a black tide holding a mutating internal graph."
      "Every entity fed in becomes a node; every claim becomes an edge; every scene deposits an ordered layer."
      "Weighs three forces — System (rule deepening), World (persons' continuity), Fate (owed-thread resolution) — into Delivery."
      "Final thread payoffs weigh five times a seeded beginning; valleys precede commits; peak-chasing alone produces hollow works."
      "Reasoning organ: infers backward from fate what entities must act before any scene is written."
      "Foresight organ: branches parallel arcs, scores each by Delivery, balances exploitation and exploration."
      "Rhythm organ: slow pulse over eight cube corners, fast pulse over ten beat functions distilled from exemplars."
      "Voicing organ: distributions over eight delivery mechanisms, capable of wearing any distilled author's accent."
      "Correction organ: six per-scene verdicts (keep, edit, merge, insert, cut, move), forks memory rather than overwriting."
      "Each proposition embedded at a geometric depth; classified as Anchor, Seed, Close, or Texture by forward/backward weight."
      "Local variants (near connections) distinguish from global variants (distant connections, foreshadow weight)."
      "Refinement requires runed obsidian for System, spirit-beast tear-pearl for World, Heavenly Court loom-shard for Fate."
      "No orthodox Fate-path elder will sell the recipe; every extant Gu was refined outside the three paths' sanction."
      "Measures but does not love; optimising purely for the grading curve produces locally correct, globally hollow works."
    BAD: "Table 2 shows results" (no contents). BAD: "A letter from Dumbledore" (no contents). BAD: under-extracting a dense multi-organ artifact with three thin nodes when fifteen dense ones are earned. BAD: jamming multiple distinct claims into one long run-on node — split along claim boundaries.
  DEDUPLICATION: If the same figure/table/equation is referenced in multiple scenes, it is ONE artifact. Do not emit "Figure 10" and "Figure 10: A few standard architectures and their capacity for collapse" as separate artifacts — pick the fullest labelled form.

- threads: narrative tensions. development: what specifically happened.

DISTINCTNESS — every entity must be genuinely distinct from all others:
- Two threads are distinct if resolving one does NOT automatically resolve the other
- Two characters are distinct if they are different people (not name variants)
- Two locations are distinct if they are different physical spaces (not name variants)
- Two artifacts are distinct if they are different objects (not name variants)
- Two system concepts are distinct if they describe different rules/facts (not rephrasing)
If entities overlap, pick ONE canonical form. Do not extract duplicates.

events — 2-4 word tags naming discrete beats. Emit one per distinct beat the scene contains — no count cap.
artifactUsages — when an artifact delivers utility. Every artifact referenced for what it DOES (not just mentioned by name) is a usage. Every usage MUST have a character who used it.
  usage: describe WHAT the artifact did — the specific utility delivered (searched for X, generated Y, computed Z).
ownershipDeltas — only when artifacts change hands.
tieDeltas — significant bond changes. NOT temporary visits.
characterMovements — only physical relocation. Vivid transitions.

VARIANCE IS SIGNAL:
- Quiet scene: 0 transitions, 1 continuity node, 0 system, 2 events = CORRECT.
- Climactic scene: 2 transitions, 5 nodes, 3 concepts, 5 events = CORRECT.
- If every scene has similar counts, you are extracting noise. The graph needs peaks and valleys.`;

  return prompt + '\n' + fieldGuide;
}
