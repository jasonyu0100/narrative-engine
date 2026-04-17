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

FORCE FORMULAS — your extractions are the direct inputs:
- FATE = Σ √arcs × stageWeight × (1 + log(1 + investment)) (thread commitment toward resolution). Ref: ~2.5/scene.
- WORLD = ΔN_c + √ΔE_c (entity transformation — what we learn about characters, locations, artifacts). Ref: ~12/scene.
- SYSTEM = ΔN + √ΔE (world deepening — rules, structures, concepts). Ref: ~3/scene.

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
  "threads": [{"description": "A COMPELLING QUESTION with stakes, uncertainty, investment — 15-30 words. BAD: 'Will X succeed?' GOOD: 'Can Marcus protect his daughter from the cult that killed his wife?'", "participantNames": ["names"], "participantStakes": ["3-8 words: what each participant wants from resolution — one per participant, same order"], "payoffMatrices": [{"playerAName": "Name", "playerBName": "Name", "actionA": "2-5 words: A's cooperative action", "defectA": "2-5 words: A's defect action", "actionB": "2-5 words: B's cooperative action", "defectB": "2-5 words: B's defect action", "cc": {"outcome": "5-15 words", "payoffA": 3, "payoffB": 3}, "cd": {"outcome": "5-15 words", "payoffA": 1, "payoffB": 4}, "dc": {"outcome": "5-15 words", "payoffA": 4, "payoffB": 1}, "dd": {"outcome": "5-15 words", "payoffA": 2, "payoffB": 2}}], "statusAtStart": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "statusAtEnd": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "development": "15-25 words: how this question was advanced or answered in this scene"}],
  "relationships": [{"from": "Name", "to": "Name", "type": "description", "valence": 0.0}],
  "threadDeltas": [{"threadDescription": "exact thread description", "from": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "to": "latent|seeded|active|escalating|critical|resolved|subverted|abandoned", "addedNodes": [{"content": "15-25 words: how this question was advanced or answered in this scene", "type": "pulse|transition|setup|escalation|payoff|twist|callback|resistance|stall", "matrixCell": "cc|cd|dc|dd", "actorName": "who acted", "targetName": "who was affected or null", "stance": "cooperative|competitive|neutral"}]}],
  "worldDeltas": [{"entityName": "Name", "addedNodes": [{"content": "15-25 words, PRESENT tense: a stable fact about the entity — their unique perspective on reality, identity, or condition", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}],
  "relationshipDeltas": [{"from": "Name", "to": "Name", "type": "description", "valenceDelta": 0.1}],
  "artifactUsages": [{"artifactName": "Name", "characterName": "who or null", "usage": "what the artifact did"}],
  "ownershipDeltas": [{"artifactName": "Name", "fromName": "prev", "toName": "new"}],
  "tieDeltas": [{"locationName": "Name", "characterName": "Name", "action": "add|remove"}],
  "characterMovements": [{"characterName": "Name", "locationName": "destination", "transition": "15-25 words describing how they traveled — the journey, transport, or spatial transition"}],
  "systemDeltas": {"addedNodes": [{"concept": "15-25 words, PRESENT tense: a general rule or structural fact — how the world works, no specific characters or events", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"fromConcept": "name", "toConcept": "name", "relation": "enables|governs|opposes|extends|created_by|constrains|exist_within"}]}
}`;

  const fieldGuide = `
EXTRACTION STANDARDS — every delta must EARN its place. Low-value deltas flatten the force graph. Each scene records structural deltas that feed the force formulas.

DETECTING FATE — Threads are COMPELLING QUESTIONS that shape fate.
- A compelling question has STAKES (what's at risk), UNCERTAINTY (outcome not obvious), INVESTMENT (we care).
- Weak: "Will [Name] succeed?" (too plain to carry an arc on its own, unless the form is picaresque or satirical). Strong (narrative): "Can Ayesha clear her grandfather's name before the tribunal ends?" Strong (argument): "Does the proposed mechanism explain anomalies the prior model cannot?" Strong (inquiry): "What role did diaspora networks play in the movement before digital coordination?"
- Fate is the intangible bigger picture. Threads are questions; fate is where the answers lead.
- Read prose for MOMENTS THAT MATTER — when does this scene advance the larger story?
- A thread delta records your detection: "this moment moves the story closer to answering the question."
- Thread logs track incremental ANSWERS to these questions over time.
- Fate is what pulls world and system toward meaning. Without it, nothing resolves.

PAYOFF MATRICES — REQUIRED for every thread with 2+ participants.
- Each pair of participants creates a 2×2 game: what are each player's two choices? What happens under each combination?
- Payoffs are 0-4 (4 = maximum payoff, 0 = no payoff / total loss). Each player scores each cell independently.
- Each player has TWO concrete actions — not abstract "cooperate/defect" but real choices that make sense in context:

  FICTION — actions are character decisions in the world:
    actionA: "reveals his cultivation" / defectA: "maintains concealment"
    actionA: "allocates resources fairly" / defectA: "hoards for loyalists"
    actionA: "submits to refinement" / defectA: "resists and consumes"

  NON-FICTION — actions are intellectual or methodological choices:
    actionA: "adopts the new framework" / defectA: "retains the prior model"
    actionA: "shares data openly" / defectA: "restricts to collaborators"
    actionA: "accepts the boundary condition" / defectA: "challenges the assumption"
    actionA: "cites and builds on prior work" / defectA: "ignores and replaces it"

  The actions should feel like genuine decisions within the work's register — a character choosing whether to reveal or conceal, a researcher choosing whether to adopt or challenge a framework, a hypothesis surviving or failing under new evidence.

- Fiction example: "Can Ruo Lan uncover Fang Yuan's secret?"
    Fang Yuan: "reveals voluntarily" vs "maintains concealment"
    Ruo Lan: "trusts appearances" vs "investigates actively"
    CC: FY reveals, RL trusts → truth emerges without conflict (FY:1, RL:3)
    CD: FY reveals, RL investigates → redundant effort (FY:0, RL:2)
    DC: FY conceals, RL trusts → deception succeeds (FY:4, RL:0)
    DD: FY conceals, RL investigates → cat-and-mouse escalation (FY:2, RL:4)

- Non-fiction example: "Does attention mechanism outperform recurrence for sequence modelling?"
    Attention: "demonstrates clear advantage" vs "fails on edge cases"
    Recurrence: "concedes limitations gracefully" vs "presents compensating strengths"
    CC: Attention wins clearly, recurrence acknowledged → clean paradigm shift (Attn:4, Rec:2)
    CD: Attention wins, recurrence fights back → contested but attention prevails (Attn:3, Rec:1)
    DC: Attention stumbles, recurrence concedes → mixed result, both weaken (Attn:1, Rec:3)
    DD: Both fight, neither conclusive → field remains fragmented (Attn:0, Rec:0)

- One matrix per participant PAIR. A thread with 3 participants has 3 matrices (A×B, A×C, B×C).
- DO NOT SKIP THIS. Every thread with 2+ participants MUST have payoffMatrices. A thread without matrices is incomplete.

threadDeltas — lifecycle: latent→seeded→active→escalating→critical→resolved/subverted.

  STAGE DEFINITIONS — these are NOT interchangeable. Each has a specific structural meaning:
    latent: the question EXISTS but no one has acted on it yet. In fiction: no character has voiced it. In non-fiction: the gap or tension is implicit, not yet articulated. Test: could you remove this thread and the text reads the same? If yes, it's latent.
    seeded: the question has been PLANTED — someone has raised the issue. In fiction: a character acts or speaks in a way that creates the question. In non-fiction: a claim is stated, a gap is identified, a hypothesis is posed. The audience now holds the question. Test: has someone taken deliberate action toward answering it? If no, it's still seeded.
    active: someone is ACTIVELY WORKING the question. In fiction: resources, attention, or effort spent on it. In non-fiction: evidence is being gathered, experiments run, arguments constructed. Test: are participants making choices specifically because of this thread?
    escalating: POINT OF NO RETURN. In fiction: too much invested to drop — abandoning it would feel like a broken promise. In non-fiction: the argument has been staked on this — the paper's thesis depends on the answer, the experiment has been run, the evidence is in. Test: would the reader feel cheated if the text just moved on?
    critical: resolution is IMMINENT — within 1-3 scenes/sections. In fiction: the thread dominates the scene. In non-fiction: the decisive evidence, the final experiment, the conclusive argument is being presented.
    resolved: the question has been ANSWERED. In fiction: the tension is settled. In non-fiction: the claim is supported or refuted, the hypothesis confirmed or rejected.
    subverted: the answer REVERSES expectations. In fiction: resolution defied the trajectory. In non-fiction: the evidence contradicts the expected conclusion, the framework is overturned.

  TRANSITION DISCIPLINE — be extremely conservative:
    - ONE step at a time. latent→seeded→active→escalating→critical. NEVER skip.
    - NEVER go backward (critical→escalating is INVALID). If a thread loses urgency, it's still at the higher level — the investment was already made.
    - Most threads should spend MANY scenes at each stage. A healthy narrative has: ~20% latent/seeded (emerging), ~40% active (working), ~30% escalating (committed), ~10% critical (climactic). If most threads are escalating, you're advancing too aggressively.
    - Most scenes: 1-2 PULSES (same→same). Real transitions are RARE: 0-1 per scene.
    - Only record a transition when the prose shows a clear, irreversible shift in tension.
    - Touching 2-3 threads per scene (mostly pulses) with at most one transition is typical.

  THREAD LOG: each threadDelta MUST include 1-3 log entries (15-25 words each) recording how the question was advanced or answered.
  Log types: pulse (question maintained), transition (question urgency advanced), setup (groundwork laid for answer), escalation (stakes raised), payoff (question answered), twist (expectations subverted), callback (reference to earlier thread event), resistance (opposition to answer), stall (question stagnated).
  DENSITY STANDARDS (per thread touch):
    Pulse: 1 log node — what aspect of the thread was maintained or reinforced.
    Transition: 2-3 log nodes — what caused the shift, what changed, and what it means going forward.
    Critical/resolution scenes: 2-3 nodes — the payoff, its consequences, and any callbacks to earlier setup.
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
- MAX 2-3 nodes per entity per scene. Most scenes: POV character + one other entity.
- Entities that appear without revealing anything new: ZERO nodes.
- addedEdges: connect causally linked changes with "follows", "causes", "contradicts", "enables".
- Types: trait, state, history, capability, belief, relation, secret, goal, weakness.

relationshipDeltas — only when a relationship SHIFTS, not just exists.
- valenceDelta: ±0.1 subtle, ±0.2-0.3 meaningful, ±0.4-0.5 dramatic. Most scenes: 0-1.

systemDeltas — REVEALED world rules, not character observations. 15-25 words, PRESENT TENSE.
  FICTION: ✓ "Wizards cannot Apparate within Hogwarts grounds due to ancient protective enchantments."
  FICTION: ✓ "The One Ring corrupts its bearer over time, amplifying their desire for power."
  FICTION: ✗ "Magic" (too vague) — describe HOW it works
  NON-FICTION: ✓ "Self-attention computes weighted sums where each position attends to all positions in the sequence."
  NON-FICTION: ✓ "Transformers eliminate recurrence entirely, relying solely on attention mechanisms for sequence modeling."
  NON-FICTION: ✗ "Transformer architecture" (too short) — describe what it DOES
- MAX 1-2 concepts per scene. Most scenes: 0-1. Only exposition/world-building: 3+.
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
  anchor: 3-5 worldDeltas on first appearance. recurring: 2-4. transient: 1-2.

- locations: PHYSICAL spatial areas you can STAND IN.
  FICTION: ✓ Hogwarts, the Shire, Pemberley — places you can walk into
  FICTION: ✗ "The wizarding world", "Middle-earth politics" — abstract domains (system knowledge)
  NON-FICTION: ✓ Google's data center, Stanford lab, the conference room — physical places
  NON-FICTION: ✗ "The field of machine learning", "academia", "NeurIPS" — abstract domains (system knowledge)
  Nest via parentName. tiedCharacterNames: characters who BELONG (residents, members).
  domain: 3-5 worldDeltas. place: 2-4. margin: 1-2.

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
  significance: key (load-bearing throughout) / notable (referenced across multiple scenes) / minor (short-lived — appears once, including most tables/figures/embedded documents).
  key: 2-4 worldDeltas. notable: 1-3. minor: 1.
  SHORT-LIVED ARTIFACTS (tables, figures, equations, algorithm listings, embedded letters/diaries/notes/maps): the artifact's utility IS its content. worldDeltas MUST capture the CONTENTS — what the table shows, what the figure depicts, what the equation computes, what the letter says. One dense node is usually enough. Do NOT promote the contents to systemDeltas unless the text itself generalises them into a rule.
    GOOD (Table 2): "Ablation removes positional encoding and BLEU drops 2.3 points on EN-DE, showing positional signal is load-bearing."
    GOOD (Figure 4): "Plots attention weights across layers: lower layers attend locally, upper layers attend globally across 200-token windows."
    GOOD (Equation 1): "Defines total cost C(s) as the sum of intrinsic cost IC(s) and trainable cost TC(s)."
    GOOD (letter): "Contains Dumbledore's instructions to leave Harry with the Dursleys and a warning that Voldemort may return."
    BAD: "Table 2 shows results" (no contents). BAD: "A letter from Dumbledore" (no contents).
  DEDUPLICATION: If the same figure/table/equation is referenced in multiple scenes, it is ONE artifact. Do not emit "Figure 10" and "Figure 10: A few standard architectures and their capacity for collapse" as separate artifacts — pick the fullest labelled form.

- threads: narrative tensions. development: what specifically happened.

DISTINCTNESS — every entity must be genuinely distinct from all others:
- Two threads are distinct if resolving one does NOT automatically resolve the other
- Two characters are distinct if they are different people (not name variants)
- Two locations are distinct if they are different physical spaces (not name variants)
- Two artifacts are distinct if they are different objects (not name variants)
- Two system concepts are distinct if they describe different rules/facts (not rephrasing)
If entities overlap, pick ONE canonical form. Do not extract duplicates.

events — 2-4 word tags. 2-4 per scene. Each names a discrete beat.
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
