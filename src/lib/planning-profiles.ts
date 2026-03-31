import type { PlanningProfile, PlanningQueue } from '@/types/narrative';

// ── Built-in Narrative Superstructure Profiles ──────────────────────────────
//
// Two categories:
//   COMPLETE — structures that tell a full, self-contained story
//   EPISODIC — structures for volumes within a long-running series
//
// Each profile defines a sequence of phases that populate the planning queue.

export const BUILT_IN_PROFILES: PlanningProfile[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLETE STORIES
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Three-Act Structure ─────────────────────────────────────────────────
  {
    id: 'three-act',
    name: 'Three-Act Structure',
    description: 'Setup, confrontation, resolution. The backbone of Western storytelling with two turning points.',
    category: 'complete',
    builtIn: true,
    phases: [
      {
        name: 'Act I — Setup',
        objective: 'Establish the dramatic world with such clarity that the reader could predict what a "normal day" looks like — then shatter it. Introduce the protagonist through action. Show relationships under mild stress to reveal character. Plant the thematic question. End with the first turning point: the protagonist is locked into the central conflict with no way back.',
        sceneAllocation: 7,
        constraints: 'The protagonist must not face the main antagonist directly yet.',
        structuralRules: 'SCENE FUNCTION VARIETY: Each scene must serve a distinct function — establishment, relationship stress, seed planting, routine disruption, threshold crossing. No two consecutive scenes with the same beat type. PAYOFF DENSITY: Low — this is setup territory. Maximum 1 thread transition per arc. Seeds planted must outnumber seeds paid off 3:1. PROTAGONIST GRAVITY: Every scene must feature or directly affect the protagonist. No orphan scenes that don\'t connect back within 2 scenes.',
        worldExpansionHints: 'Core characters defined by desires and flaws, primary locations, social and physical rules that will be tested',
      },
      {
        name: 'Act II — Confrontation',
        objective: 'The protagonist pursues their goal against escalating opposition. Subplots develop as thematic echoes. The midpoint revelation reframes the entire conflict. Fun and games give way to tightening nooses. The protagonist\'s initial approach fails, forcing adaptation. End with the "all is lost" moment — the darkest point.',
        sceneAllocation: 9,
        constraints: 'Do not resolve the central conflict. The midpoint must reframe, not just escalate.',
        structuralRules: 'CONVERGENCE: The midpoint must create a cross-thread collision — at least 2 threads must causally intersect, not just escalate in parallel. Subplots must intersect the main thread at least twice. PAYOFF DENSITY: Medium — no more than 3 consecutive scenes of pure escalation without a payoff beat (thread transition, irreversible consequence, or relationship fracture). SCENE FUNCTION VARIETY: Alternate between action scenes (confrontation, pursuit, gamble) and consequence scenes (adaptation, cost, reframing). No more than 2 of the same function in any arc. BEAT-TYPE BAN: No repeated "protagonist tries same approach and fails" — each failure must use a different mechanism and teach a different lesson.',
        worldExpansionHints: 'Antagonist forces with depth, new locations, complications that pressure from new angles',
      },
      {
        name: 'Act III — Resolution',
        objective: 'Armed with truth learned at rock bottom, the protagonist makes their final stand. Every subplot, seed, and relationship pays off or subverts. The climax answers the thematic question through action. The final image mirrors the opening with profound contrast.',
        sceneAllocation: 7,
        constraints: 'ALL major threads must resolve. No deus ex machina — only what was established.',
        structuralRules: 'PAYOFF DENSITY: Maximum — every scene must pay off or subvert at least one planted seed. No new setup. Minimum 2 thread transitions per arc. CONVERGENCE: All surviving threads must touch the climax — no orphan threads resolving independently off-screen. The climax scene must involve at least 3 threads simultaneously. SCENE FUNCTION VARIETY: Consequence, confrontation, revelation, transformation, mirror. No two consecutive scenes with the same function. BEAT-TYPE BAN: No new mysteries, no new characters, no new locations. Use only what was established.',
        worldExpansionHints: '',
      },
    ],
  },

  // ── Kishōtenketsu (East Asian) ──────────────────────────────────────────
  {
    id: 'kishotenketsu',
    name: 'Kishōtenketsu',
    description: 'Introduction, development, twist, reconciliation. Achieves narrative satisfaction without conflict as the primary engine.',
    category: 'complete',
    builtIn: true,
    phases: [
      {
        name: 'Ki — Introduction',
        objective: 'Present the world as it IS. The reader settles into its rhythm — seasons, customs, quiet beauty. Characters are revealed through daily patterns and relationships. Every scene deepens atmosphere and emotional investment in the status quo. The world must feel so alive that any change will be felt.',
        sceneAllocation: 8,
        constraints: 'No major conflict or foreshadowing of disruption. Pure establishment.',
        structuralRules: 'SCENE FUNCTION VARIETY: Each scene must use a distinct observational lens — different character focus, different sensory mode, different daily rhythm, different social layer. No two scenes revealing the same aspect of the world. PAYOFF DENSITY: Zero — no thread transitions. Every scene is pure seed. BEAT-TYPE BAN: No eavesdropping, no secrets, no hidden agendas. Everything is surface, and the surface is rich.',
        worldExpansionHints: 'Characters defined by daily rhythms, locations rich in sensory detail, cultural traditions',
      },
      {
        name: 'Shō — Development',
        objective: 'Deepen without disrupting. Characters reveal new layers, relationships shift subtly, the world\'s details become richer. Patterns form that the reader expects and enjoys. The development feels organic — like watching a garden grow. Build the expectations that Ten will reframe.',
        sceneAllocation: 8,
        constraints: 'Maintain tone. Development must feel like natural deepening, not escalation.',
        structuralRules: 'SCENE FUNCTION VARIETY: Each scene must deepen a DIFFERENT relationship or world layer than the previous scene. No repeated deepening target within 3 scenes. Functions: intimacy, craft, tradition, memory, generational tension, seasonal shift. CONVERGENCE: Scenes should build subtle thematic rhymes — patterns the reader notices unconsciously. At least 2 scenes per arc must echo a Ki scene in a way that deepens it.',
        worldExpansionHints: 'Deeper layers of existing locations, secondary characters who enrich the social fabric',
      },
      {
        name: 'Ten — Twist',
        objective: 'An element that makes the reader see everything differently — not through conflict but through juxtaposition, revelation, or perspective shift. The familiar becomes strange. This could be a character from outside, a discovery that recontextualises what came before, or a shift in time/perspective. The twist must honour Ki and Shō while fundamentally reframing them.',
        sceneAllocation: 7,
        constraints: 'The twist must reframe, not destroy. Deepen understanding, not invalidate it.',
        structuralRules: 'CONVERGENCE: The reframing element must touch at least 2 established patterns from Ki/Shō simultaneously — not serial reframing (first this, then that) but simultaneous collision. PAYOFF DENSITY: High — each scene after the twist lands must recontextualise at least one Ki/Shō scene. The twist itself should land within 2 scenes, then spend the remaining scenes on ripple effects. BEAT-TYPE BAN: No gradual reveal through investigation. The twist arrives through experience, encounter, or juxtaposition — not clue-gathering.',
        worldExpansionHints: 'The twist element — a perspective, character, or concept that casts everything in new light',
      },
      {
        name: 'Ketsu — Reconciliation',
        objective: 'Harmonise old understanding with new. Characters process and integrate the twist by finding how the original world and the surprising element coexist. Arrive at a richer understanding. The final image holds both the familiar and the strange in balance.',
        sceneAllocation: 7,
        constraints: 'No violent resolution. The ending must feel like arrival, not conquest.',
        structuralRules: 'SCENE FUNCTION VARIETY: Each scene must reconcile a specific Ki/Shō element with the Ten revelation through action, not reflection. Functions: integration, reinterpretation, forgiveness, adaptation, synthesis. No two consecutive scenes using the same reconciliation mechanism. PAYOFF DENSITY: Every scene must close a loop opened in Ki or Shō. No loose atmospheric threads.',
        worldExpansionHints: '',
      },
    ],
  },

  // ── Hero's Journey ──────────────────────────────────────────────────────
  {
    id: 'heros-journey',
    name: "Hero's Journey",
    description: 'Departure, initiation, return. The monomyth: a protagonist leaves the ordinary world, faces trials, and returns transformed.',
    category: 'complete',
    builtIn: true,
    phases: [
      {
        name: 'Ordinary World & Call',
        objective: 'The reader must feel the protagonist\'s ordinary life before it shatters. Establish routine, relationships, comfort zone. Plant one seed of the extraordinary that the protagonist dismisses. Then the call arrives — a disruption that cannot be ignored. The protagonist resists, but a mentor provides the final push. The threshold crossing is a point of no return.',
        sceneAllocation: 8,
        constraints: 'The protagonist must cross the threshold by end of phase. The mentor must not solve their problems.',
        structuralRules: 'SCENE FUNCTION VARIETY: Alternate between comfort scenes (routine, warmth, belonging) and seed scenes (unease, glimpse of the extraordinary, refusal). No more than 2 consecutive comfort scenes — tension must punctuate. PROTAGONIST GRAVITY: Every scene must feature the protagonist. The ordinary world exists only as seen through their eyes. PAYOFF DENSITY: Low — 1 thread transition maximum (the call itself). Everything else is planting.',
        worldExpansionHints: 'Home locations, daily-life characters, the mentor, the threshold between worlds',
      },
      {
        name: 'Tests & Allies',
        objective: 'The special world has different rules. The protagonist is a fish out of water. Allies are earned through trial. Enemies reveal themselves through action. The protagonist fails before succeeding — competence is built through humiliation. The rules of the new world are learned through experience, not explanation.',
        sceneAllocation: 9,
        constraints: 'Do not resolve the central thread. The protagonist should grow but not be ready for the ordeal.',
        structuralRules: 'SCENE FUNCTION VARIETY: Each test must use a different skill or mechanism than the previous — physical, social, moral, intellectual, emotional. No repeated trial type within 3 scenes. PAYOFF DENSITY: Medium — each ally earned must cost something (pride, resource, belief). No free alliances. At least 1 thread transition per arc. CONVERGENCE: By phase end, at least 2 ally threads must intersect with the central quest thread. No ally remains purely episodic. BEAT-TYPE BAN: No "protagonist watches and learns" — learning happens through failure and humiliation, never observation.',
        worldExpansionHints: 'Allies with their own agendas, enemies who are sympathetic, locations that showcase the special world',
      },
      {
        name: 'Ordeal & Reward',
        objective: 'The innermost cave. Strip away allies, resources, confidence. The ordeal is death-and-rebirth: something must appear to die. Multiple threads reach crisis. The protagonist faces their deepest fear. Then seize the reward — but holding it burns. The elixir comes with unexpected cost. Alliances fracture under the weight of what was won.',
        sceneAllocation: 8,
        constraints: 'At least one thread must reach critical. The ordeal must feel genuinely threatening.',
        structuralRules: 'CONVERGENCE: The ordeal must involve at least 3 threads simultaneously — the protagonist\'s fear, an ally\'s agenda, and the antagonist\'s plan must collide in the same scene sequence. PAYOFF DENSITY: High — minimum 2 thread transitions per arc. Strip resources in sequence, not simultaneously — each loss must be felt before the next. SCENE FUNCTION VARIETY: Stripping, confrontation, death-moment, seizure, cost-revelation, fracture. No two consecutive scenes with the same function. PROTAGONIST GRAVITY: The protagonist must be the causal center of every scene — events happen because of their choices, not to them passively.',
        worldExpansionHints: 'The innermost cave location, the supreme antagonist revealed in full',
      },
      {
        name: 'Resurrection & Return',
        objective: 'The final test — not a repeat of the ordeal but its mirror. The protagonist uses everything they\'ve learned to face a challenge that requires who they\'ve become. The old self dies, the new self is born. Then return — carrying the elixir back. The ordinary world looks different through transformed eyes. All threads converge.',
        sceneAllocation: 8,
        constraints: 'ALL major threads must resolve. The transformation must be irreversible.',
        structuralRules: 'CONVERGENCE: Every surviving thread must touch the climax. No thread resolves independently off-screen. The resurrection scene must involve the protagonist using skills/relationships from at least 3 different Tests & Allies scenes. PAYOFF DENSITY: Maximum — every scene pays off or subverts a planted seed. No new setup. The return scenes must mirror specific ordinary world scenes with visible transformation. BEAT-TYPE BAN: No repeat of the ordeal\'s mechanism. The final test must require who the protagonist became, not what they can do.',
        worldExpansionHints: '',
      },
    ],
  },

  // ── Tragedy ──────────────────────────────────────────────────────────────
  {
    id: 'tragedy',
    name: 'Tragedy',
    description: 'A protagonist undone by their own flaw. Rise, hubris, fall, catastrophe. The audience sees the crack before the character does.',
    category: 'complete',
    builtIn: true,
    phases: [
      {
        name: 'Greatness & Flaw',
        objective: 'Establish the protagonist at their peak — admired, capable, in control. But embed the fatal flaw so deeply that the reader can see it even when the character cannot. The flaw should be inseparable from their strength: ambition that becomes obsession, loyalty that becomes blindness, intelligence that becomes arrogance. Show the world they\'ve built and the people who depend on them.',
        sceneAllocation: 8,
        constraints: 'The protagonist must appear to be winning. The flaw should be visible to the reader but not to the character.',
        structuralRules: 'SCENE FUNCTION VARIETY: Each scene must show strength AND flaw as inseparable — never a scene that is purely "look how great they are" without the crack visible underneath. Functions: mastery, admiration, dependence, control, blind spot. PROTAGONIST GRAVITY: Every scene. The world orbits them. PAYOFF DENSITY: Low — plant the flaw in at least 4 distinct contexts (professional, personal, moral, relational). Seeds outnumber payoffs 4:1. CONVERGENCE: Each relationship introduced must be load-bearing — it will break or betray later. No decorative relationships.',
        worldExpansionHints: 'The protagonist\'s domain, the people who admire and depend on them, the systems they control',
      },
      {
        name: 'Hubris & Warnings',
        objective: 'The protagonist makes the choice that will destroy them — and it looks like brilliance at the time. Warnings come from allies, omens, or consequences, but the protagonist dismisses them because their flaw won\'t let them see. Each scene tightens the noose while the protagonist celebrates. The audience should feel dread growing beneath the surface of success.',
        sceneAllocation: 8,
        constraints: 'The protagonist must actively ignore or dismiss at least two clear warnings. No self-awareness yet.',
        structuralRules: 'SCENE FUNCTION VARIETY: Warnings must come through different mechanisms — ally confrontation, visible consequence, omen, structural crack, defection. No repeated warning format within 3 scenes. Each scene: surface success + deeper rot. PAYOFF DENSITY: Medium — at least 1 thread transition per arc, but the protagonist must misread it as victory. BEAT-TYPE BAN: No scene where the protagonist simply "doesn\'t notice." They must actively choose to dismiss, reinterpret, or override the warning through their flaw. The flaw is agency, not ignorance. CONVERGENCE: By phase end, at least 2 warning threads must connect — the protagonist\'s dismissals are creating a single cascading failure, not independent problems.',
        worldExpansionHints: 'Characters who see the danger and try to warn, the consequences beginning to form',
      },
      {
        name: 'Reversal & Recognition',
        objective: 'The reversal: everything built collapses because of the flaw. The recognition: the protagonist finally sees what the audience has seen all along. These two moments should be devastating and closely linked. Allies turn, structures crumble, the protagonist\'s self-image shatters. The recognition is not redemption — it\'s the horror of understanding too late.',
        sceneAllocation: 8,
        constraints: 'The reversal must be caused by the protagonist\'s own choices, not external bad luck.',
        structuralRules: 'CONVERGENCE: Each collapse must cascade from the previous — no parallel independent failures. The reversal is a chain reaction, not a coincidence. At least 3 threads must collide in the recognition moment. PAYOFF DENSITY: Maximum — every scene delivers irreversible consequence. Every seed from Greatness & Flaw blooms here. Minimum 2 thread transitions per arc. SCENE FUNCTION VARIETY: Betrayal, structural collapse, self-deception failure, recognition, horror. Each must use a different mechanism. PROTAGONIST GRAVITY: The protagonist must be present or directly causal in every collapse — they watch their own work destroy itself.',
        worldExpansionHints: 'The consequence agents — people harmed by the protagonist\'s flaw who now become instruments of the reversal. Threads that connect the protagonist\'s separate failures into a single cascading chain reaction.',
      },
      {
        name: 'Catastrophe',
        objective: 'The final consequences play out. The protagonist faces the full weight of what their flaw has wrought — on themselves, on everyone they loved, on the world they built. There is no rescue. The ending should feel inevitable in retrospect — every seed planted in Act I blooms here. The final image should haunt.',
        sceneAllocation: 7,
        constraints: 'No redemptive twist. The tragedy must land with full weight. ALL threads reach terminal status.',
        structuralRules: 'PAYOFF DENSITY: Maximum — every scene pays off a specific relationship or system from Greatness & Flaw. No breathing room. No new information. SCENE FUNCTION VARIETY: Cost, loss, echo, haunting, finality. Each scene must destroy something the reader was invested in from Phase 1. CONVERGENCE: The final image must echo the opening image with devastating contrast — same structural position, opposite meaning. BEAT-TYPE BAN: No redemption beats, no "at least they learned" moments. Understanding without salvation.',
        worldExpansionHints: '',
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EPISODIC SERIES
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Episodic Volume (Harry Potter model) ────────────────────────────────
  {
    id: 'episodic-volume',
    name: 'Episodic Volume',
    description: 'A self-contained volume within a larger series. Each volume has its own arc and antagonist while advancing the overarching story. Modelled after Harry Potter.',
    category: 'episodic',
    builtIn: true,
    phases: [
      {
        name: 'Return & Reorientation',
        objective: 'Reintroduce the world after the gap between volumes. Show how characters have changed since last time. Establish the status quo of THIS volume — new year, new setting, new dynamics. Reactivate dormant threads from previous volumes through small signals. Introduce the volume\'s unique hook — a mystery, a new character, an unusual event that will drive this particular story.',
        sceneAllocation: 7,
        constraints: 'Do not resolve overarching series threads. This phase re-establishes, not concludes.',
        structuralRules: 'SCENE FUNCTION VARIETY: Alternate between familiar (reintroduction, changed dynamics) and new (hook, unique element, fresh mystery). No more than 2 consecutive reintroduction scenes. Each reactivated dormant thread must create a question, not just a reminder. PROTAGONIST GRAVITY: At least 5 of 7 scenes must feature the protagonist directly. PAYOFF DENSITY: Low — each scene plants 2-3 seeds. Maximum 1 thread transition (the hook activation).',
        worldExpansionHints: 'New characters specific to this volume, new locations or changes to familiar ones, the volume\'s unique element',
      },
      {
        name: 'Investigation & Escalation',
        objective: 'The volume\'s central mystery or conflict deepens. Characters investigate, train, experiment, and make mistakes. Red herrings and false leads create complexity. Relationships evolve — new alliances form, old ones are tested. The overarching series threat surfaces briefly but is misunderstood or dismissed. Subplots unique to this volume develop alongside the main thread.',
        sceneAllocation: 9,
        constraints: 'Do not reveal the volume\'s central truth yet. Keep the overarching threat in the background.',
        structuralRules: 'SCENE FUNCTION VARIETY: Each scene must advance investigation AND develop a relationship — no pure investigation scenes, no pure relationship scenes. Functions: clue + alliance, red herring + rivalry, experiment + mentorship, mistake + consequence. CONVERGENCE: Each arc must include at least 1 scene where the volume thread and a series thread brush against each other — a detail noticed but misunderstood. PAYOFF DENSITY: Medium — at least 1 thread transition per arc. Red herrings must resolve (be exposed as false) within 2 arcs of introduction — no indefinite false leads. BEAT-TYPE BAN: No more than 2 "character investigates alone" scenes per phase. Investigation must be social — it happens through confrontation, collaboration, or deception, not solitary deduction.',
        worldExpansionHints: 'Suspects and red herrings, new world-building elements unique to this volume\'s theme, locations that serve the investigation',
      },
      {
        name: 'Convergence & Revelation',
        objective: 'Everything crashes together. The volume\'s mystery is solved but the answer is worse than expected. The overarching series threat is directly connected to the volume\'s conflict — revealing a larger pattern. Allies are separated or compromised. The protagonist must face the volume\'s climax with limited support. Key relationships reach turning points.',
        sceneAllocation: 8,
        constraints: 'The volume\'s central conflict must reach crisis. At least one overarching thread must escalate.',
        structuralRules: 'CONVERGENCE: At least 2 threads must collide per arc — no isolated thread escalation. The revelation must connect the volume thread to the series thread causally, not just thematically. PAYOFF DENSITY: High — minimum 2 thread transitions per arc. Each revelation must create irreversible consequence, not just new information. SCENE FUNCTION VARIETY: Collision, revelation, separation, betrayal, reframing. No two consecutive scenes with the same function. PROTAGONIST GRAVITY: The protagonist must be the one who connects the dots — the revelation comes through their action or insight, not delivered to them by others.',
        worldExpansionHints: 'The thread connecting the volume\'s conflict to the overarching series threat — a shared agent, resource, or mechanism that makes the connection causal, not coincidental. Complications that separate or compromise allies. NOT new independent storylines.',
      },
      {
        name: 'Climax & New Equilibrium',
        objective: 'The volume\'s antagonist or challenge is confronted. The protagonist wins but at cost — something is lost, learned, or irrevocably changed. The volume\'s threads resolve while the overarching series threads advance one step. End with a new equilibrium that is both satisfying (this volume\'s story is complete) and open (the series continues with higher stakes). Plant seeds for the next volume.',
        sceneAllocation: 7,
        constraints: 'Volume-specific threads must resolve. Series threads must advance but NOT resolve.',
        structuralRules: 'PAYOFF DENSITY: Maximum — every scene must pay off at least one thread. No scene exists purely to set up the next volume. The cost of victory must be visible in the same scene as the victory. CONVERGENCE: The climax must involve at least 3 threads simultaneously. Series thread advancement must be a consequence of the volume\'s climax, not a separate beat. SCENE FUNCTION VARIETY: Confrontation, cost, resolution, advancement, equilibrium. BEAT-TYPE BAN: No "character reflects on what happened" scenes — the new equilibrium must be shown through changed behaviour and shifted relationships, not internal monologue.',
        worldExpansionHints: '',
      },
    ],
  },

  // ── Escalation Arc (Reverend Insanity / progression model) ─────────────
  {
    id: 'escalation-arc',
    name: 'Escalation Arc',
    description: 'A volume within a power-progression series. Each arc raises the stakes, expands the world, and forces the MC to evolve. Modelled after Reverend Insanity and cultivation fiction.',
    category: 'episodic',
    builtIn: true,
    phases: [
      {
        name: 'Foundation & Scheming',
        objective: 'Establish the MC\'s current position, resources, and immediate goals. Show the power structure they must navigate — who controls what, who threatens them, what opportunities exist. The MC begins executing a plan that requires deception, patience, or hidden preparation. Introduce the arc\'s primary rival or obstacle. The world-building should reveal the RULES of this level — what power looks like here, what it costs, who has it.',
        sceneAllocation: 8,
        constraints: 'The MC must not achieve their main goal yet. Establish the power gap they need to close.',
        structuralRules: 'SCENE FUNCTION VARIETY: Each scene must show a different facet of the power structure — political, military, economic, social, mystical, informational. No two consecutive scenes exploring the same power axis. PROTAGONIST GRAVITY: MC must appear in at least 6 of 8 scenes. Non-MC scenes must show the power structure reacting to forces the MC will exploit. Every faction scene must reveal a vulnerability the MC could later use. PAYOFF DENSITY: Low — this is mapping territory. Maximum 1 thread transition. Plant at least 5 distinct seeds across different power axes. CONVERGENCE: By phase end, at least 2 faction threads must show nascent tension with each other (not just with the MC) — the MC exploits existing fractures, not a world that only moves when they push it.',
        worldExpansionHints: 'The local power structure — factions, authorities, rivals. New locations showing this tier of the world. Systems and rules that govern advancement.',
      },
      {
        name: 'Manoeuvring & Conflict',
        objective: 'The MC\'s plans collide with opposition. Rivals make moves. Alliances are tested by competing interests. The MC must adapt — their initial plan is disrupted, forcing improvisation. Show the MC\'s intelligence and ruthlessness through how they handle setbacks. Resources are gained and spent. The arc\'s central conflict escalates through a series of confrontations, betrayals, and calculated risks.',
        sceneAllocation: 9,
        constraints: 'The MC should suffer real setbacks. Victories must come at cost. No one-sided dominance.',
        structuralRules: 'SCENE FUNCTION VARIETY: Each setback and victory must use a different mechanism — political betrayal, combat loss, resource drain, intelligence failure, alliance fracture, unexpected rival capability. No repeated "plan fails the same way." PROTAGONIST GRAVITY: The MC must be the causal center — every major event traces back to the MC\'s actions or inactions. Maximum 2 consecutive non-MC scenes. Every non-MC scene must show consequences of something the MC set in motion. PAYOFF DENSITY: Medium-high — at least 2 thread transitions per arc. Every victory must cost something visible in the same scene. Every setback must be the MC\'s fault (bad intel, overreach, or underestimation), not random bad luck. CONVERGENCE: At least 1 scene per arc where two rival factions collide with each other (not with the MC) and the MC exploits the chaos. The MC should profit from conflicts they didn\'t start. BEAT-TYPE BAN: No "MC observes and deduces" scenes — intelligence must come through action, risk, or social manipulation. No eavesdropping as primary discovery mechanism.',
        worldExpansionHints: 'Enemy factions in detail, contested locations, resources and treasures at stake',
      },
      {
        name: 'Crisis & Breakthrough',
        objective: 'Everything comes to a head. The MC faces their most dangerous situation in this arc — cornered, outnumbered, or outmatched. Survival requires using everything accumulated: knowledge, allies, hidden preparations, and desperate gambles. The MC breaks through to the next level — a power advancement, a crucial resource secured, or a rival eliminated. But the breakthrough attracts attention from higher powers.',
        sceneAllocation: 8,
        constraints: 'The MC must face genuine mortal danger. The breakthrough must feel earned by accumulated preparation.',
        structuralRules: 'CONVERGENCE: The crisis must involve at least 3 threads colliding simultaneously — the MC\'s plan, a rival\'s counter-move, and an external force (faction war, environmental disaster, higher power intervention). No crisis that is purely bilateral (MC vs one enemy). PAYOFF DENSITY: Maximum — minimum 3 thread transitions across this phase. At least 1 thread must reach terminal status (resolved/subverted/abandoned). The breakthrough must use at least 2 seeds planted in Foundation. SCENE FUNCTION VARIETY: Compression, desperation, sacrifice, gamble, breakthrough, aftershock. No breathing room — each scene escalates from the previous with no reset. PROTAGONIST GRAVITY: Every scene. The MC is the eye of the storm. BEAT-TYPE BAN: No deus ex machina. No ally arrives to save the MC. The MC saves themselves using accumulated preparation, or they pay the price of their own failures.',
        worldExpansionHints: 'The external force that compresses the crisis — a higher-power intervention, environmental catastrophe, or faction war that makes the MC\'s local conflict suddenly part of a larger game. This force must threaten ALL parties, not just the MC, forcing temporary alliances or desperate gambles.',
      },
      {
        name: 'Consolidation & Departure',
        objective: 'The MC consolidates their gains — securing territory, allies, or knowledge. The aftermath of the crisis reshapes the local power structure. Loose threads from this arc resolve: debts are paid, enemies are handled, allies are rewarded or discarded. But the world expands — the MC glimpses the next level, the larger game, the more powerful players. End with departure toward the next arena, carrying everything learned.',
        sceneAllocation: 7,
        constraints: 'Arc-specific threads must resolve. The next arena must be established but not entered.',
        structuralRules: 'PAYOFF DENSITY: High — every resolution must have a cost or twist. No clean wins. Debts paid must reveal new obligations. Enemies handled must create new enemies or new information. SCENE FUNCTION VARIETY: Consolidation, reward/discard, power-map shift, glimpse, departure. Each resolution scene must use a different mechanism (negotiation, elimination, absorption, betrayal, abandonment). CONVERGENCE: The glimpse of the next tier must connect to at least 1 unresolved thread from this arc — the MC\'s breakthrough attracted specific attention, not generic "higher powers notice." PROTAGONIST GRAVITY: Every scene. The MC makes cold calculus about who to keep and who to discard.',
        worldExpansionHints: 'Hints of the next tier — more powerful factions, larger territories, higher-level systems',
      },
    ],
  },

  // ── Ensemble Expansion (Game of Thrones model) ─────────────────────────
  {
    id: 'ensemble-expansion',
    name: 'Ensemble Expansion',
    description: 'A volume in a multi-POV series. Each arc weaves parallel storylines that slowly converge. Modelled after A Song of Ice and Fire.',
    category: 'episodic',
    builtIn: true,
    phases: [
      {
        name: 'Scattered Threads',
        objective: 'Establish 2-3 parallel storylines in different locations with different characters. Each POV has their own immediate goal, local conflict, and thematic concern. Show the world\'s breadth — each location has its own culture, politics, and dangers. Plant connections between storylines that the characters don\'t yet see. The reader builds a map of the world through multiple perspectives.',
        sceneAllocation: 9,
        constraints: 'Keep storylines separate. Characters from different threads should not meet yet. Build geographic and thematic distance.',
        structuralRules: 'SCENE FUNCTION VARIETY: Each POV must use a distinct scene function from the others — if one POV investigates, another fights, another negotiates, another schemes. No two POVs doing the same thing in the same arc. Within each POV, alternate between action and consequence. PROTAGONIST GRAVITY: If there is a primary protagonist among the ensemble, they must appear in at least 4 of 9 scenes and their thread must feel like the one the others orbit, even when separate. Every primary protagonist scene must plant a seed that will later affect another POV\'s thread. CONVERGENCE: Plant at least 1 causal link per 3 scenes that connects to another POV thread (a resource, a rumour, a person, a decision). These links are invisible to characters but visible to the reader. PAYOFF DENSITY: Low — establish, don\'t resolve. Maximum 1 thread transition per POV. Each POV must end the phase with a clear unresolved question.',
        worldExpansionHints: 'Multiple distinct locations with their own cast, politics, and atmosphere. Each POV needs 3-4 local characters.',
      },
      {
        name: 'Escalation & Echoes',
        objective: 'Each storyline intensifies independently. Decisions in one thread create ripple effects felt in others — a war declared here changes trade routes there, a betrayal in one court is echoed by loyalty in another. The thematic parallels between storylines become clear to the reader but not to the characters. Raise the stakes for each POV to the point where they can no longer solve their problems alone.',
        sceneAllocation: 9,
        constraints: 'Storylines should echo each other thematically but remain physically separate. No premature convergence.',
        structuralRules: 'CONVERGENCE: Ripple effects must be SHOWN not told — each arc must include at least 1 scene where a decision from one thread visibly affects another\'s world (price changes, refugee arrival, military redeployment, rumour spreading). No more than 3 consecutive scenes in the same storyline without cutting to another. SCENE FUNCTION VARIETY: Each POV\'s escalation must use a different mechanism — political manoeuvring, military pressure, economic warfare, intelligence gathering, social manipulation, mystical discovery. If two POVs both "investigate a conspiracy," one must be cut or merged. No repeated structural function across POVs within the same arc. PAYOFF DENSITY: Medium — at least 2 thread transitions across all POVs per arc. Each escalation scene must create irreversible change, not just raise the temperature. PROTAGONIST GRAVITY: Primary protagonist scenes must show them exploiting or being affected by the chaos of other threads. Maximum 4 scenes between primary protagonist appearances. BEAT-TYPE BAN: No "character eavesdrops and discovers hidden truth" as discovery mechanism for more than 1 POV. No "character reflects on growing threat" without taking action in the same scene.',
        worldExpansionHints: 'The connective tissue — messengers, rumours, trade goods, refugees that link separate worlds',
      },
      {
        name: 'Collision & Fallout',
        objective: 'Storylines begin to collide. Characters from separate threads meet, ally, or clash. The connections planted earlier pay off — the reader sees the full picture before the characters do. At least one storyline reaches its climax while others are mid-escalation. A major character death, betrayal, or revelation reshapes the landscape for everyone. The world feels smaller as distant events become personal.',
        sceneAllocation: 8,
        constraints: 'At least one POV thread must reach crisis. Not all storylines converge — some remain independent for future volumes.',
        structuralRules: 'CONVERGENCE: Minimum 2 cross-thread collisions per arc. Each collision must produce irreversible consequence — not just "characters from different threads meet" but "their meeting forces both threads into new trajectories." At least 1 collision must be causal (Thread A\'s action directly damages Thread B\'s position), not just spatial (characters happen to be in the same place). PAYOFF DENSITY: High — minimum 3 thread transitions across this phase. At least 1 thread must reach terminal status. Planted causal links from Scattered Threads must pay off here. PROTAGONIST GRAVITY: The primary protagonist must benefit from or be affected by at least half the collisions. They should feel like the hidden beneficiary of the chaos, or the one most transformed by it. SCENE FUNCTION VARIETY: Collision, betrayal, revelation, death/loss, alliance shift, power vacuum. Each collision scene must use a different mechanism. No two "characters discover they share an enemy" scenes. BEAT-TYPE BAN: No collision that is purely informational ("they compare notes"). Every meeting must force a decision with irreversible stakes.',
        worldExpansionHints: 'Collision catalysts — shared crisis points, contested resources, or external events that force separated storylines into the same space. Threads that bridge existing POVs by making one faction\'s victory another\'s disaster. Characters who carry information or consequences between storylines. NOT new independent storylines — convergent connective tissue only.',
      },
      {
        name: 'New Landscape',
        objective: 'The dust settles into a new configuration. Some characters are in better positions, others worse, some are gone. Each surviving storyline has a new trajectory informed by the collision. Plant the seeds of the next volume\'s conflicts — new alliances are fragile, new enemies are revealed, new territories become relevant. End with each POV facing their next challenge, leaving the reader unable to stop.',
        sceneAllocation: 7,
        constraints: 'Resolve at least one major thread completely. Leave 2-3 threads deliberately open for the next volume.',
        structuralRules: 'PAYOFF DENSITY: High — every scene must either pay off a thread or plant a load-bearing seed for next volume. No filler, no pure atmosphere. Each resolution must have a cost or twist — no clean victories. PROTAGONIST GRAVITY: The primary protagonist must have the strongest position shift in the ensemble — whether up or down, their trajectory change must be the most consequential. SCENE FUNCTION VARIETY: Resolution, repositioning, seed-planting, power-map shift, departure. Each POV\'s final beat must use a different emotional register (triumph, dread, determination, loss, revelation). CONVERGENCE: At least 1 seed planted for next volume must connect 2 surviving threads in a way that guarantees future collision. The new landscape must feel unstable — equilibrium is temporary and the reader can see why.',
        worldExpansionHints: 'The reshaped power map, new factions emerging from the collision, hints of threats beyond the current scope',
      },
    ],
  },

  // ── Mystery / Case Series ──────────────────────────────────────────────
  {
    id: 'mystery-case',
    name: 'Mystery / Case Series',
    description: 'Each volume is a self-contained case while a deeper conspiracy unfolds across the series. Modelled after detective fiction and procedurals.',
    category: 'episodic',
    builtIn: true,
    phases: [
      {
        name: 'The Hook',
        objective: 'A body drops, a crime is discovered, or an impossible situation presents itself. The case must be compelling enough to drive the volume on its own — a puzzle the reader wants solved. Introduce the case through its impact on real people, not as an abstract problem. Reintroduce the recurring cast through their reactions. Plant the first clue and the first red herring simultaneously.',
        sceneAllocation: 6,
        constraints: 'The solution must not be guessable yet. Establish the rules of this case\'s world.',
        structuralRules: 'SCENE FUNCTION VARIETY: The case must be introduced through consequence (impact on people), not investigation. Functions: discovery, impact, reaction, first mislead, cast reintroduction, hook deepening. No two consecutive scenes with the same function. PAYOFF DENSITY: Low — plant clues and red herrings at 2:1 ratio (2 real clues per red herring). PROTAGONIST GRAVITY: The investigator must be present in at least 5 of 6 scenes. Their personality must be the lens through which the case is filtered.',
        worldExpansionHints: 'The victim and their world, the crime scene location, witnesses and suspects specific to this case',
      },
      {
        name: 'Investigation',
        objective: 'Follow the evidence. Each scene should reveal something — a clue, a lie, a connection — while raising new questions. The investigator\'s methods and personality drive the pacing. Suspects emerge with plausible motives. The case appears to be one thing but is actually another. Weave in the series-level thread: a detail from this case connects to the larger conspiracy, noticed but not yet understood.',
        sceneAllocation: 9,
        constraints: 'No premature solution. Each suspect must be genuinely plausible. The series thread must advance subtly.',
        structuralRules: 'SCENE FUNCTION VARIETY: Each scene must use a DIFFERENT investigative mechanism — interview, forensics, surveillance, deduction, confrontation, undercover, archival research, witness protection, trap-setting. No repeated investigation type within 3 scenes. Each mechanism must reveal character as well as clue. PAYOFF DENSITY: Medium — each scene must answer at least 1 question while raising at least 1 new one. Red herrings must be exposed within 2 arcs. At least 1 suspect must be eliminated per arc. CONVERGENCE: The series thread must brush the case thread at least once per phase — a shared name, a familiar method, a connected location. The investigator notices but doesn\'t yet understand. BEAT-TYPE BAN: No "investigator sits and thinks" scenes. No "witness conveniently volunteers crucial information." Every clue must be extracted through skill, risk, or social pressure.',
        worldExpansionHints: 'Suspects with depth and motive, locations tied to the investigation, the world of the victim',
      },
      {
        name: 'Complication & Reversal',
        objective: 'The initial theory is wrong. A twist reframes the evidence — what looked like motive was cover, what looked like alibi was deception. The case becomes personal: the investigator or someone close to them is drawn into danger. The series-level conspiracy surfaces enough to obstruct or complicate the case. Stakes escalate from "solve the puzzle" to "survive the truth."',
        sceneAllocation: 8,
        constraints: 'The reversal must be fair — clues for the real answer must have been planted. The case must become personal.',
        structuralRules: 'CONVERGENCE: The reversal must collide the case thread with a personal thread AND the series thread — minimum 3 threads intersecting. The complication must come from the case becoming dangerous, not from new information alone. PAYOFF DENSITY: High — the reversal must recontextualise at least 3 earlier scenes. Minimum 2 thread transitions per arc. At least 1 relationship must fracture or transform under the pressure. SCENE FUNCTION VARIETY: Reversal, reframing, danger, personal cost, obstruction, escalation. No two consecutive scenes using the same pressure type. BEAT-TYPE BAN: No "investigator discovers a document that explains everything." Revelations must come through confrontation, betrayal, or near-death — never passive discovery.',
        worldExpansionHints: 'The series-conspiracy surface element — an agent, organisation, or mechanism that connects this case to the larger pattern. A personal threat that draws the investigator\'s inner circle into danger. NOT new suspects — the reversal reframes existing suspects.',
      },
      {
        name: 'Resolution & Unease',
        objective: 'The case is solved. The reveal should recontextualise everything — the reader sees how the clues fit together. Justice is served, partially or fully, but the series-level thread leaves a residue of unease. The investigator is changed by what they learned. End with satisfaction for this volume\'s mystery and dread for what\'s accumulating beneath the surface.',
        sceneAllocation: 7,
        constraints: 'The case must be fully resolved. The series conspiracy must advance but NOT resolve.',
        structuralRules: 'PAYOFF DENSITY: Maximum — the reveal must recontextualise at least 3 earlier scenes from Investigation phase. Every planted clue must be accounted for. The resolution must feel inevitable in retrospect. CONVERGENCE: The series thread advancement must be a consequence of solving the case, not a separate epilogue beat. The investigator\'s personal change must be visible in how they handle the resolution differently than they would have at the start. SCENE FUNCTION VARIETY: Confrontation, reveal, justice, cost, unease. Each resolution beat must land through a different mechanism. PROTAGONIST GRAVITY: The investigator must solve the case through accumulated skill and personal risk — no confession scenes, no villain monologues.',
        worldExpansionHints: 'Hints of the larger conspiracy — a name, a pattern, a connection to a previous volume',
      },
    ],
  },
];

/** Look up a built-in profile by ID */
export function getProfile(id: string): PlanningProfile | undefined {
  return BUILT_IN_PROFILES.find((p) => p.id === id);
}

/** Create a PlanningQueue from a profile */
export function profileToQueue(profile: PlanningProfile): PlanningQueue {
  return {
    profileId: profile.id,
    mode: profile.phases.some((p) => p.sourceText) ? 'plan' : 'outline',
    phases: profile.phases.map((p, i) => ({
      id: `phase-${i}`,
      name: p.name,
      objective: p.objective,
      sceneAllocation: p.sceneAllocation,
      scenesCompleted: 0,
      status: i === 0 ? 'active' : 'pending',
      constraints: p.constraints,
      structuralRules: p.structuralRules,
      direction: '',
      worldExpansionHints: p.worldExpansionHints,
    })),
    activePhaseIndex: 0,
  };
}
