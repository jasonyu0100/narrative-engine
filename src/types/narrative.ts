// ── Thread ───────────────────────────────────────────────────────────────────
export type ThreadStatus = string;

// Canonical thread status vocabulary — single source of truth.
// Forward: latent → seeded → active → critical → resolved/subverted.
// Abandoned resets the thread to a latent-like state for potential repickup.
export const THREAD_ACTIVE_STATUSES = ['latent', 'seeded', 'active', 'critical'] as const;
export const THREAD_TERMINAL_STATUSES = ['resolved', 'subverted'] as const;
export const THREAD_PRIMED_STATUSES = ['critical'] as const;
/** Abandoned is special — not terminal, but resets the thread for potential repickup */
export const THREAD_RESET_STATUSES = ['abandoned'] as const;

export const THREAD_STATUS_LABELS: Record<string, string> = {
  latent: 'introduced but not yet developed',
  seeded: 'setup established, tension planted',
  active: 'actively driving narrative',
  critical: 'at peak tension, demanding resolution',
  resolved: 'concluded or ran its course',
  subverted: 'fate defied — resolved contrary to expectations',
  abandoned: 'dropped and reset — available for repickup',
};

export type ThreadParticipant = {
  id: string;
  type: 'character' | 'location' | 'artifact';
};

// ── Thread Log ──────────────────────────────────────────────────────────────

/** Thread log node — a statement of something that occurred in a specific scene.
 *  Written in simple past tense. One fact, one sentence, no interpretation.
 *  Nine perceptual primitives — the thread's model of its own situation.
 *  Whatever doesn't register as one of these doesn't exist for the thread.
 *
 *  Examples:
 *  - "Harry caused the glass of the boa enclosure to vanish at the zoo." (payoff)
 *  - "Fang Yuan observed that Bai Ning Bing's right arm gu worm is disrupted." (setup)
 *  - "Uncle Vernon confiscated Harry's Hogwarts letter before Harry could read it." (resistance)
 *  - "Dumbledore arrived at the Ministry with evidence of Voldemort's return." (transition)
 *  - "The prophecy was mentioned again in Snape's memory." (callback)
 */
export type ThreadLogNodeType =
  | 'pulse'       // "I was acknowledged but nothing changed." Continuity maintenance.
  | 'transition'  // "My fundamental state has changed." Lifecycle position updated.
  | 'setup'       // "Something is being prepared on my behalf." Forward-looking — promises being made.
  | 'escalation'  // "The stakes around me are rising." Increasing pressure without advancing.
  | 'payoff'      // "A promise made to me has been fulfilled." Experiencing own resolution.
  | 'twist'       // "My understanding of my own direction has changed." Revising own drive vector.
  | 'callback'    // "Something from my past has been referenced." History being honored.
  | 'resistance'  // "Something is working against me." Experiencing opposition directly.
  | 'stall';      // "I am not moving and I don't know why." Self-diagnosis of dysfunction.

export const THREAD_LOG_NODE_TYPES: ThreadLogNodeType[] = ['pulse', 'transition', 'setup', 'escalation', 'payoff', 'twist', 'callback', 'resistance', 'stall'];

export type ThreadLogNode = {
  id: string;
  type: ThreadLogNodeType;
  content: string;
};

export type ThreadLogEdge = {
  from: string;
  to: string;
  relation: string;
};

export type ThreadLog = {
  nodes: Record<string, ThreadLogNode>;
  edges: ThreadLogEdge[];
};

/** Storyline: long-running thread spanning multiple arcs. Incident: short-lived, resolves within 1-2 arcs. */
export type ThreadKind = 'storyline' | 'incident';

export type Thread = {
  id: string;
  participants: ThreadParticipant[];
  description: string;
  status: ThreadStatus;
  openedAt: string;
  dependents: string[];
  /** Accumulated lifecycle graph — nodes added per scene, edges link sequential events */
  threadLog: ThreadLog;
};

// ── Character ────────────────────────────────────────────────────────────────
export type CharacterRole = 'anchor' | 'recurring' | 'transient';

/** Continuity node — a statement of stable fact about an entity's nature, identity, or permanent condition.
 *  Written in simple present tense. No events, no causation. Works across characters, locations, and artifacts.
 *
 *  Examples:
 *  - "Harry Potter has a lightning-bolt scar on his forehead." (trait)
 *  - "Fang Yuan is a reincarnated demon who conceals his true cultivation rank." (secret)
 *  - "The Dursley household is hostile to anything associated with magic." (trait)
 *  - "Gandalf carries the elven ring Narya, the Ring of Fire." (relation)
 *  - "The Iron Throne is forged from a thousand surrendered swords." (history)
 */
export type ContinuityNodeType =
  | 'trait'       // Inherent characteristic — personality, atmosphere, physical property
  | 'state'       // Current condition — wounded, ruined, activated, contested
  | 'history'     // Past experience — memory, founding event, provenance
  | 'capability'  // What it can do — skill, strategic value, function
  | 'belief'      // Subjective truth — opinion, legend, lore, contested claim
  | 'relation'    // Connection to another entity — bond, sacred-to, bound-to
  | 'secret'      // Hidden information — hidden knowledge, concealed origin
  | 'goal'        // Orientation — ambition, purpose, intended use
  | 'weakness';   // Vulnerability — fear, structural flaw, limitation

export const CONTINUITY_NODE_TYPES: ContinuityNodeType[] = ['trait', 'state', 'history', 'capability', 'belief', 'relation', 'secret', 'goal', 'weakness'];

export type ContinuityNode = {
  id: string;
  type: ContinuityNodeType;
  content: string;
};

export type ContinuityEdge = {
  from: string;   // ContinuityNode id
  to: string;     // ContinuityNode id
  relation: string;
};

export type Continuity = {
  nodes: Record<string, ContinuityNode>;
  edges: ContinuityEdge[];
};

export type Character = {
  id: string;
  name: string;
  role: CharacterRole;
  continuity: Continuity;
  threadIds: string[];
  /** AI-generated visual description used as image prompt seed */
  imagePrompt?: string;
  imageUrl?: ImageRef;
};

// ── Location ─────────────────────────────────────────────────────────────────
/** Location narrative prominence — how much weight this place carries in the story.
 *  - domain: center of gravity, where power and identity concentrate — a throne room, an empire, a kitchen
 *  - area: known ground, recurring presence — a familiar tavern, a district, a battlefield
 *  - margin: peripheral, minimal continuity — an alley, a border crossing, set dressing */
export type LocationProminence = 'domain' | 'place' | 'margin';

export type Location = {
  id: string;
  name: string;
  prominence: LocationProminence;
  parentId: string | null;
  /** Characters with a significant tie to this location — residents, faction members, students. Not casual visitors. */
  tiedCharacterIds: string[];
  threadIds: string[];
  continuity: Continuity;
  /** AI-generated visual description used as image prompt seed */
  imagePrompt?: string;
  imageUrl?: ImageRef;
};

export type RelationshipEdge = {
  from: string;
  to: string;
  type: string;
  valence: number;
};

// ── Artifact ────────────────────────────────────────────────────────────────
export type ArtifactSignificance = 'key' | 'notable' | 'minor';

export type Artifact = {
  id: string;
  name: string;
  /** Narrative weight: key artifacts alter plots, notable ones recur, minor ones are set dressing */
  significance: ArtifactSignificance;
  /** Continuity graph — what is known about this artifact (lore, history, properties, state changes) */
  continuity: Continuity;
  threadIds: string[];
  /** Current owner — a character or location ID, or null for world-owned (communally available to all) */
  parentId: string | null;
  imagePrompt?: string;
  imageUrl?: ImageRef;
};

export type OwnershipMutation = {
  artifactId: string;
  fromId: string;
  toId: string;
};

export type ArtifactUsage = {
  artifactId: string;
  /** Character who used the artifact, or null for unattributed usage (e.g. a tool described in a paper) */
  characterId: string | null;
  /** What the artifact did — how it delivered utility (e.g. "cut through the ward", "predicted the market crash") */
  usage: string;
};

export type TieMutation = {
  locationId: string;
  characterId: string;
  action: 'add' | 'remove';
};

// ── Scene & Arc ─────────────────────────────────────────────────────────────
/** Parallels ContinuityMutation. `from`/`to` record the status transition;
 *  `addedNodes` lists log entries in order. applyThreadMutation chains them
 *  sequentially via 'co_occurs' edges — node order alone defines the linkage.
 *  A scene-level thread mutation genuinely mutates the thread: `from`/`to`
 *  advance its lifecycle status, and `addedNodes` are the log entries that
 *  record what happened. The two behaviours are coupled — you cannot advance
 *  a thread without logging why, and every log entry lives inside a
 *  transition record. */
export type ThreadMutation = {
  threadId: string;
  from: string;
  to: string;
  addedNodes: ThreadLogNode[];
};

/** Additive continuity mutation. `addedNodes` lists the entity's new
 *  continuity entries in causal/temporal order — applyContinuityMutation
 *  chains them sequentially via 'co_occurs'. Node order defines the linkage;
 *  no explicit edges are stored. */
export type ContinuityMutation = {
  entityId: string;
  addedNodes: { id: string; content: string; type: ContinuityNodeType }[];
};

export type RelationshipMutation = {
  from: string;
  to: string;
  type: string;
  valenceDelta: number;
};

// ── World Systems ──────────────────────────────────────────────────────────

export type WorldSystem = {
  id: string;
  name: string;
  description: string;
  /** Core principles — how this system works */
  principles: string[];
  /** Hard constraints — limits, costs, scarcity rules */
  constraints: string[];
  /** Cross-system interactions — how this connects to other systems */
  interactions: string[];
};

// ── Prose Profile & Beat Plans ───────────────────────────────────────────────

/** Beat function — what the beat DOES in the scene's structure */
export type BeatFn =
  | 'breathe'     // Pacing, atmosphere, sensory grounding, scene establishment
  | 'inform'      // Knowledge delivery — character or reader learns something now
  | 'advance'     // Forward momentum — plot moves, goals pursued, tension rises
  | 'bond'        // Relationship shifts between characters
  | 'turn'        // Scene pivots — revelation, reversal, interruption
  | 'reveal'      // Character nature exposed through action or choice
  | 'shift'       // Power dynamic inverts
  | 'expand'      // World-building — new rules, systems, geography
  | 'foreshadow'  // Plants information that pays off later
  | 'resolve';    // Tension releases — question answered, conflict settles

/** Mechanism — HOW the beat is delivered as prose */
export type BeatMechanism =
  | 'dialogue'     // Characters speaking
  | 'thought'      // Internal monologue
  | 'action'       // Physical movement, gesture, body in space
  | 'environment'  // Setting, weather, arrivals, sensory details
  | 'narration'    // Narrator addresses reader, authorial commentary, rhetoric
  | 'memory'       // Flashback triggered by association
  | 'document'     // Embedded text: letter, newspaper, cited poetry
  | 'comic';       // Humor — physical comedy, ironic observation, absurdity

// ── Asset References (Decoupled Storage) ────────────────────────────────────

/**
 * Embedding reference — asset ID stored in IndexedDB (e.g. "emb_abc123")
 */
export type EmbeddingRef = string;

/**
 * Image reference - decoupled storage
 * - "img_abc123": Asset reference (stored in IndexedDB as Blob)
 * - "https://...": External URL (e.g., Replicate-generated images, not stored locally)
 * - undefined: No image
 *
 * Usage: Character images, location images, artifact images, scene images, cover images
 */
export type ImageRef = string | undefined;

/**
 * Audio reference - decoupled storage
 * - "audio_xyz789": Asset reference (stored in IndexedDB as Blob)
 * - undefined: No audio
 *
 * Note: Audio is always generated locally (ElevenLabs, etc.), so always uses asset references.
 * External audio URLs are not supported.
 */
export type AudioRef = string | undefined;

// ── Proposition Classification ───────────────────────────────────────────────

/**
 * Structural category from backward/forward activation strength.
 *   Anchor:   HI backward, HI forward  — load-bearing both directions
 *   Seed:     LO backward, HI forward  — plants forward, harvested later
 *   Close:    HI backward, LO forward  — resolves prior chains, terminal
 *   Texture:  LO backward, LO forward  — atmosphere, world-color
 */
export type PropositionBaseCategory = 'Anchor' | 'Seed' | 'Close' | 'Texture';

/**
 * Temporal reach — whether strongest connections are local (within-arc) or global (cross-arc).
 */
export type PropositionReach = 'Local' | 'Global';

/** Classification scores for a single proposition */
export type PropositionClassification = {
  base: PropositionBaseCategory;
  reach: PropositionReach;
  /** Activation strength: 0.5 * max + 0.5 * mean_topk backward similarity */
  backward: number;
  /** Activation strength: 0.5 * max + 0.5 * mean_topk forward similarity */
  forward: number;
  /** Median scene distance of top-k backward connections */
  backReach: number;
  /** Median scene distance of top-k forward connections */
  fwdReach: number;
};

/**
 * A proposition — an atomic claim the reader must come to believe is true.
 * Works for both fiction (story world facts) and non-fiction (domain facts).
 *
 * The number of propositions is determined by information density —
 * extract as many as needed to faithfully reconstruct the semantic content.
 */
export type Proposition = {
  /** The atomic claim */
  content: string;
  /**
   * Semantic type label — free-form string for embedding compatibility.
   * Common types: state, claim, definition, formula, evidence, rule, comparison, example
   * But any descriptive label works (e.g., "character_belief", "causal_mechanism", "constraint")
   */
  type?: string;
  /** 1536-dim embedding - can be reference ID or inline array (legacy) */
  embedding?: EmbeddingRef;
  /** Timestamp when embedding was generated */
  embeddedAt?: number;
  /** Model used for embedding (e.g., 'text-embedding-3-small') */
  embeddingModel?: string;
};

/** A single beat in a scene plan */
export type Beat = {
  fn: BeatFn;
  mechanism: BeatMechanism;
  /** One sentence: the concrete action or event */
  what: string;
  /** Multiple propositions — constraints the prose must satisfy */
  propositions: Proposition[];
  /** Centroid of proposition embeddings for beat-level semantic search */
  embeddingCentroid?: EmbeddingRef;
};

/** Structured scene plan — JSON replacement for the plain-text plan */
export type BeatPlan = {
  beats: Beat[];
};

/** Beat-aligned prose chunk — links prose to its generating beat */
export type BeatProse = {
  /** Index of the beat in the scene's BeatPlan.beats array */
  beatIndex: number;
  /** The prose text for this beat */
  prose: string;
};

/** Beat-to-prose mapping stored in Scene */
export type BeatProseMap = {
  /** Array of beat-aligned prose chunks */
  chunks: BeatProse[];
  /** Timestamp when this mapping was created */
  createdAt: number;
};

/** Markov transition matrix — probability of transitioning from one beat fn to another */
export type BeatTransitionMatrix = Partial<Record<BeatFn, Partial<Record<BeatFn, number>>>>;

/** Authorial prose profile — voice and style applied to all prose generation. */
export type ProseProfile = {
  /** Tonal register of the narration */
  register: string;
  /** Narrator's distance from the character */
  stance: string;
  /** Grammatical tense */
  tense?: string;
  /** Structural cadence of prose */
  sentenceRhythm?: string;
  /** How deep the narrator goes into character interiority */
  interiority?: string;
  /** Proportion of prose given to dialogue */
  dialogueWeight?: string;
  /** Rhetorical and narrative devices the author uses */
  devices: string[];
  /** Show-don't-tell constraints — apply to ALL scenes */
  rules: string[];
  /** Negative constraints — specific prose failures to avoid for this voice */
  antiPatterns?: string[];
};

/** Mechanism distribution conditioned on beat function — preserves fn/mechanism correlation from source texts */
export type FnMechanismDistribution = Partial<Record<BeatFn, Partial<Record<BeatMechanism, number>>>>;

/** Beat sampling data — derived from analyzed works, separate from voice profile. */
export type BeatSampler = {
  /** Markov chain transition probabilities between beat functions */
  markov: BeatTransitionMatrix;
  /** How often each mechanism appears per beat function — preserves the correlation from source texts */
  fnMechanismDistribution: FnMechanismDistribution;
  /** Average beats per 1000 words */
  beatsPerKWord: number;
};

export const BEAT_FN_LIST: BeatFn[] = ['breathe', 'inform', 'advance', 'bond', 'turn', 'reveal', 'shift', 'expand', 'foreshadow', 'resolve'];
export const BEAT_MECHANISM_LIST: BeatMechanism[] = ['dialogue', 'thought', 'action', 'environment', 'narration', 'memory', 'document', 'comic'];

// ── World Knowledge Graph ───────────────────────────────────────────────────

/** System node — a statement of how the world works.
 *  Written as a general present-tense rule or structural fact.
 *  No specific characters, no specific events. Narrator's structural truth about the universe.
 *  Works for fiction and non-fiction alike.
 *
 *  Examples:
 *  - "Magic performed near an underage wizard is attributed to that wizard by the Ministry, regardless of who cast it." (principle)
 *  - "Gu worms must be fed primeval stones or they weaken and die." (constraint)
 *  - "The Qing Mao Mountain sect allocates gu worms to disciples by rank each season." (convention)
 *  - "Horcruxes anchor the creator's soul to the mortal plane, preventing true death." (system)
 *  - "The Iron Bank of Braavos always collects its debts, even across generations." (structure)
 */
export type SystemNodeType =
  | 'principle'    // Fundamental truth — physical law, economic axiom, magic rule
  | 'system'       // Organized mechanism — governance, ecosystem, magic system, TCP/IP
  | 'concept'      // Abstract idea — theory, framework, phenomenon, category
  | 'tension'      // Contradiction — unresolved force, debate, opposing pressures
  | 'event'        // Significant occurrence — war, discovery, founding, publication
  | 'structure'    // Organization — institution, faction, hierarchy, research lab
  | 'environment'  // Physical/spatial reality — geography, climate, infrastructure
  | 'convention'   // Norm — custom, practice, etiquette, legal precedent
  | 'constraint';  // Limitation — scarcity, cost, boundary, physical limit

export const SYSTEM_NODE_TYPES: SystemNodeType[] = ['principle', 'system', 'concept', 'tension', 'event', 'structure', 'environment', 'convention', 'constraint'];

export type SystemNode = {
  id: string;
  concept: string;
  type: SystemNodeType;
};

export type SystemEdge = {
  from: string;
  to: string;
  relation: string;
};

export type SystemGraph = {
  nodes: Record<string, SystemNode>;
  edges: SystemEdge[];
};

export type SystemMutation = {
  addedNodes: { id: string; concept: string; type: SystemNodeType }[];
  addedEdges: { from: string; to: string; relation: string }[];
};

/** Force values are z-score normalized (mean = 0, units = standard deviations).
 *  0 = average moment, positive = above average, negative = below average.
 *  - drive:  thread phase transitions (weighted by jump magnitude) + relationship valence deltas
 *  - world:  entity continuity graph complexity delta (ΔN_c + √ΔE_c per scene)
 *  - system: world knowledge graph complexity delta (new nodes + new edges per scene)
 */
export type ForceSnapshot = {
  drive: number;
  world: number;
  system: number;
};

// ── Narrative Cube (Drive · World · System) ─────────────────────────────────
// The three forces (P·C·K) define a cube. Each corner is a recognisable narrative state.
export type CubeCornerKey =
  | 'HHH' | 'HHL' | 'HLH' | 'HLL'
  | 'LHH' | 'LHL' | 'LLH' | 'LLL';

export type CubeCorner = {
  key: CubeCornerKey;
  name: string;
  description: string;
  forces: ForceSnapshot;
};

export const NARRATIVE_CUBE: Record<CubeCornerKey, CubeCorner> = {
  HHH: {
    key: 'HHH',
    name: 'Epoch',
    description: 'Everything converges — threads resolve, characters transform, and the world\'s rules expand. A defining moment that reshapes the narrative landscape.',
    forces: { drive: 1, world: 1, system: 1 },
  },
  HHL: {
    key: 'HHL',
    name: 'Climax',
    description: 'Threads resolve and characters transform within established world rules. The drive of what\'s already been built — no new lore needed.',
    forces: { drive: 1, world: 1, system: -1 },
  },
  HLH: {
    key: 'HLH',
    name: 'Revelation',
    description: 'Threads pay off through world-building. The world\'s rules explain why things happened — lore unlocks resolution without personal transformation.',
    forces: { drive: 1, world: -1, system: 1 },
  },
  HLL: {
    key: 'HLL',
    name: 'Closure',
    description: 'Quiet resolution within established world rules. Tying up loose ends — conversations that needed to happen, debts paid, promises kept or broken.',
    forces: { drive: 1, world: -1, system: -1 },
  },
  LHH: {
    key: 'LHH',
    name: 'Discovery',
    description: 'Characters transform through encountering new world systems. No threads resolve — pure exploration, world-building, and possibility.',
    forces: { drive: -1, world: 1, system: 1 },
  },
  LHL: {
    key: 'LHL',
    name: 'Growth',
    description: 'Internal character development within established world rules. Characters train, bond, argue, and change through interaction — no new lore.',
    forces: { drive: -1, world: 1, system: -1 },
  },
  LLH: {
    key: 'LLH',
    name: 'Lore',
    description: 'Pure world-building without resolution or transformation. Establishing rules, systems, cultures, and connections for future drive. Seeds planted in the world\'s structure.',
    forces: { drive: -1, world: -1, system: 1 },
  },
  LLL: {
    key: 'LLL',
    name: 'Rest',
    description: 'Nothing resolves, no one transforms, no new world concepts. Recovery and breathing room — quiet character deliveries and seed-planting.',
    forces: { drive: -1, world: -1, system: -1 },
  },
};

export type ExpansionManifest = {
  characters: Character[];
  locations: Location[];
  artifacts?: Artifact[];
  threads: Thread[];
  relationships: RelationshipEdge[];
  /** Mutations on existing entities — same as scene-level mutations but applied at world-build time */
  systemMutations: SystemMutation;
  ownershipMutations?: OwnershipMutation[];
  tieMutations?: TieMutation[];
  continuityMutations?: ContinuityMutation[];
  relationshipMutations?: RelationshipMutation[];
};


export type CharacterMovement = {
  locationId: string;
  /** Descriptive transition narrating how the character moved, e.g. "Rode horseback through the night to Bree" */
  transition: string;
};

// ── Prose/Plan Versioning ────────────────────────────────────────────────────
// Versions enable branch isolation: each branch can have its own prose/plan
// without affecting other branches. Resolution uses branch lineage + fork time.
//
// Version numbering: V{major}.{minor}
// Version hierarchy:
// - Generate (fresh generation) → new major version (V1, V2, V3)
// - Rewrite (AI revision) → minor version (V2.1, V2.2)
// - Edit (manual edit) → sub-minor version (V2.1.1, V2.1.2)
// Edits are cleared when rewrite or regeneration occurs (they branch from the new version).

/** Version type: 'generate' = fresh AI generation, 'rewrite' = AI revision, 'edit' = manual edit */
export type VersionType = 'generate' | 'rewrite' | 'edit';

/** A versioned prose snapshot — tagged with the branch that created it */
export type ProseVersion = {
  prose: string;
  beatProseMap?: BeatProseMap;
  proseScore?: ProseScore;
  branchId: string;
  timestamp: number;
  /** Version number — major.minor.edit format (e.g., "1", "2.1", "2.1.3") */
  version: string;
  /** Whether this is a fresh generation, AI rewrite, or manual edit */
  versionType: VersionType;
  /** For rewrites/edits: the version this was derived from */
  parentVersion?: string;
  /** For generated prose: the plan version that produced this prose */
  sourcePlanVersion?: string;
};

/** A versioned plan snapshot — tagged with the branch that created it */
export type PlanVersion = {
  plan: BeatPlan;
  branchId: string;
  timestamp: number;
  /** Version number — major.minor.edit format (e.g., "1", "2.1", "2.1.3") */
  version: string;
  /** Whether this is a fresh generation, AI rewrite, or manual edit */
  versionType: VersionType;
  /** For rewrites/edits: the version this was derived from */
  parentVersion?: string;
};

/** Prose score from evaluation */
export type ProseScore = {
  overall: number;
  details?: Record<string, number>;
};

export type Scene = {
  kind: 'scene';
  id: string;
  arcId: string;
  locationId: string;
  /** Character whose perspective this scene is told from */
  povId: string;
  participantIds: string[];
  /** Artifact usages — which character used which artifact in this scene.
   *  Location-owned artifacts can be used communally; character-owned only by owner. */
  artifactUsages?: ArtifactUsage[];
  /** Characters who move in this scene — characterId → movement details. Only include deltas. */
  characterMovements?: Record<string, CharacterMovement>;
  events: string[];
  threadMutations: ThreadMutation[];
  continuityMutations: ContinuityMutation[];
  relationshipMutations: RelationshipMutation[];
  /** World knowledge graph mutations — new concepts and connections about how the world works */
  systemMutations?: SystemMutation;
  /** Artifact ownership changes — objects changing hands between characters/locations */
  ownershipMutations?: OwnershipMutation[];
  /** Tie changes — characters forming or breaking ties with locations */
  tieMutations?: TieMutation[];
  /** Version history for prose — enables branch isolation. Resolution uses branch lineage + fork time. */
  proseVersions?: ProseVersion[];
  /** Version history for plan — enables branch isolation. Resolution uses branch lineage + fork time. */
  planVersions?: PlanVersion[];
  summary: string;
  imageUrl?: ImageRef;
  audioUrl?: AudioRef;
  /** Embedding of scene summary for semantic search (reference or inline) */
  summaryEmbedding?: EmbeddingRef;
  /** Centroid of all beat centroids in the plan (reference or inline) */
  planEmbeddingCentroid?: EmbeddingRef;
  /** Embedding of full prose text for semantic search (reference or inline) */
  proseEmbedding?: EmbeddingRef;
};

export type WorldBuild = {
  kind: 'world_build';
  id: string;
  summary: string;
  expansionManifest: ExpansionManifest;
};

// ── Branch Evaluation ─────────────────────────────────────────────────────

/** Per-scene verdict from a branch evaluation pass */
export type SceneVerdict = 'ok' | 'edit' | 'merge' | 'cut' | 'insert' | 'move';

/** One scene's evaluation entry */
export type SceneEval = {
  sceneId: string;
  verdict: SceneVerdict;
  /** One-line reason for the verdict */
  reason: string;
  /** For "merge" verdicts: ID of the scene to merge INTO (the surviving scene absorbs this one's content) */
  mergeInto?: string;
  /** For "insert" verdicts: ID of the scene to insert AFTER */
  insertAfter?: string;
  /** For "move" verdicts: ID of the scene to place this scene AFTER (no content change, pure reposition) */
  moveAfter?: string;
};

/** Full branch evaluation — overall critique + per-scene verdicts */
export type StructureReview = {
  id: string;
  branchId: string;
  createdAt: string;
  /** High-level analysis (what's working, what's weak, thematic questions) */
  overall: string;
  /** Per-scene verdicts in timeline order */
  sceneEvals: SceneEval[];
  /** Detected repetitive patterns */
  repetitions: string[];
  /** Thematic question the evaluator surfaced */
  thematicQuestion: string;
};

// ── Prose Evaluation ─────────────────────────────────────────────────────────

export type ProseVerdict = 'ok' | 'edit';

export type ProseSceneEval = {
  sceneId: string;
  verdict: ProseVerdict;
  /** Specific issues found in the prose — actionable edit instructions */
  issues: string[];
};

export type ProseEvaluation = {
  id: string;
  branchId: string;
  createdAt: string;
  /** High-level prose quality analysis */
  overall: string;
  /** Per-scene prose verdicts */
  sceneEvals: ProseSceneEval[];
  /** Recurring prose issues across scenes */
  patterns: string[];
};

// ── Plan Evaluation ──────────────────────────────────────────────────────────

export type PlanVerdict = 'ok' | 'edit';

export type PlanSceneEval = {
  sceneId: string;
  verdict: PlanVerdict;
  /** Specific continuity or structural issues found in the beat plan */
  issues: string[];
};

export type PlanEvaluation = {
  id: string;
  branchId: string;
  createdAt: string;
  /** High-level continuity analysis */
  overall: string;
  /** Per-scene plan verdicts */
  sceneEvals: PlanSceneEval[];
  /** Recurring continuity issues across scenes */
  patterns: string[];
};

/** A timeline entry is either a narrative scene or a world build */
export type TimelineEntry = Scene | WorldBuild;

export function isScene(entry: TimelineEntry): entry is Scene {
  return entry.kind === 'scene';
}

export function isWorldBuild(entry: TimelineEntry): entry is WorldBuild {
  return entry.kind === 'world_build';
}

export type Arc = {
  id: string;
  name: string;
  sceneIds: string[];
  develops: string[];
  /** Locations this arc focuses on — determines the spatial graph shown */
  locationIds: string[];
  /** Characters active in this arc — determined by location + thread participants */
  activeCharacterIds: string[];
  /** Starting positions — characterId → locationId. Established at arc start. */
  initialCharacterLocations: Record<string, string>;
  /** Short sentence summarising the narrative direction of this arc */
  directionVector?: string;
};

// ── Branch ───────────────────────────────────────────────────────────────────

/** Explicit version pointers for a scene — allows a branch to pin specific versions */
export type SceneVersionPointers = {
  /** Pinned prose version for this scene on this branch (undefined = auto-resolve) */
  proseVersion?: string;
  /** Pinned plan version for this scene on this branch (undefined = auto-resolve) */
  planVersion?: string;
};

export type Branch = {
  id: string;
  name: string;
  parentBranchId: string | null;
  /** Entry where this branch diverges from its parent (null for root) */
  forkEntryId: string | null;
  /** Ordered timeline entry IDs (scenes + world builds) owned by this branch */
  entryIds: string[];
  /** Branch-scoped planning queue (optional — absent means no planning layer) */
  planningQueue?: PlanningQueue;
  /** Explicit version pointers — sceneId → version pointers (optional, absent = auto-resolve) */
  versionPointers?: Record<string, SceneVersionPointers>;
  createdAt: number;
};

// ── Narrative State ──────────────────────────────────────────────────────────

export type NarrativeState = {
  id: string;
  title: string;
  description: string;
  /** Derived cache — recomputed from world-build manifests + scene mutations via resolvedEntryKeys */
  characters: Record<string, Character>;
  /** Derived cache — recomputed from world-build manifests + scene mutations via resolvedEntryKeys */
  locations: Record<string, Location>;
  /** Derived cache — recomputed from world-build manifests + scene mutations via resolvedEntryKeys */
  threads: Record<string, Thread>;
  /** Derived cache — recomputed from world-build manifests + scene ownership mutations */
  artifacts: Record<string, Artifact>;
  arcs: Record<string, Arc>;
  scenes: Record<string, Scene>;
  worldBuilds: Record<string, WorldBuild>;
  branches: Record<string, Branch>;
  /** Derived cache — recomputed from world-build manifests + scene mutations via resolvedEntryKeys */
  relationships: RelationshipEdge[];
  /** Derived cache — cumulative world knowledge graph built from world-build manifests + scene mutations */
  systemGraph: SystemGraph;
  worldSummary: string;
  /** World rules / commandments that the narrative must follow */
  rules: string[];
  /** Structured world systems — layered mechanics that define how the world works */
  worldSystems?: WorldSystem[];
  /** Authorial prose profile — voice, rhythm, and beat transition patterns for prose generation */
  proseProfile?: ProseProfile;
  coverImageUrl?: ImageRef;
  /** Style directive appended to all image generation prompts for visual consistency */
  imageStyle?: string;
  /** Story-level settings that guide generation (POV, tone, pacing, etc.) */
  storySettings?: StorySettings;
  /** Chat threads keyed by thread ID — persisted with the narrative */
  chatThreads?: Record<string, ChatThread>;
  /** Notes keyed by note ID — persisted with the narrative */
  notes?: Record<string, Note>;
  /** Branch evaluations keyed by branch ID — most recent eval per branch */
  structureReviews?: Record<string, StructureReview>;
  /** Prose evaluations keyed by branch ID — most recent prose eval per branch */
  proseEvaluations?: Record<string, ProseEvaluation>;
  /** Plan evaluations keyed by branch ID — most recent plan eval per branch */
  planEvaluations?: Record<string, PlanEvaluation>;
  createdAt: number;
  updatedAt: number;
};

/** Look up a timeline entry (scene or world build) by ID */
export function resolveEntry(n: NarrativeState, id: string): TimelineEntry | null {
  return n.scenes[id] ?? n.worldBuilds[id] ?? null;
}

export type NarrativeEntry = {
  id: string;
  title: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  sceneCount: number;
  coverThread: string;
  coverImageUrl?: ImageRef;
  /** Narrative shape classification key */
  shapeKey?: string;
  /** Narrative shape name for display */
  shapeName?: string;
  /** Narrative shape curve points [x,y] normalised 0-1 */
  shapeCurve?: [number, number][];
  /** Narrative archetype classification key */
  archetypeKey?: string;
  /** Narrative archetype name for display */
  archetypeName?: string;
  /** Overall force grade (0-100) */
  overallScore?: number;
  /** Narrative scale classification key */
  scaleKey?: string;
  /** Narrative scale name for display */
  scaleName?: string;
  /** World density classification key */
  densityKey?: string;
  /** World density name for display */
  densityName?: string;
};

// ── Story Settings ──────────────────────────────────────────────────────────

/** How many POV characters drive the narrative */
export type POVMode = 'single' | 'pareto' | 'ensemble' | 'free';

/** Which world commit to seed generations with */
export type WorldFocusMode = 'latest' | 'custom' | 'none';

/** Reasoning effort level — controls how many thinking tokens the model uses before responding.
 *  Higher levels produce better structural decisions (causality, agency, convergence)
 *  at the cost of slower generation and higher token usage.
 *  Maps to OpenRouter's `reasoning.max_tokens` parameter. */
export type ReasoningLevel = 'none' | 'low' | 'medium' | 'high';

/** Max thinking tokens per reasoning level */
export const REASONING_BUDGETS: Record<ReasoningLevel, number> = {
  none: 0,
  low: 2048,
  medium: 8192,
  high: 24576,
};

/** Output format for prose generation */
export type ProseFormat = 'prose' | 'screenplay';

export type StorySettings = {
  /** How POV is distributed across the story */
  povMode: POVMode;
  /** Character IDs designated as POV characters (empty = use all anchors) */
  povCharacterIds: string[];
  /** High-level story direction / north star prompt */
  storyDirection: string;
  /** Negative prompt — things the AI should avoid */
  storyConstraints: string;
  /** Target arc length in scenes */
  targetArcLength: number;
  /** Markov chain rhythm preset key (from MATRIX_PRESETS) */
  rhythmPreset: string;
  /** Prose voice/style the AI should mimic when writing */
  proseVoice: string;
  /** Guidance for how scene plans should be structured */
  planGuidance: string;
  /** How many recent scenes the LLM sees when building context (time horizon) */
  branchTimeHorizon: number;
  /** Optional custom prompt for cover image generation */
  coverPrompt: string;
  /** World focus mode — which world commit to seed generations with */
  worldFocus: WorldFocusMode;
  /** Specific WorldBuild ID when worldFocus is 'custom' */
  worldFocusId?: string;
  /** Editorial guidance — storytelling principles that shape how the narrative is told (scope, pacing philosophy, reveal discipline, tonal rules) */
  narrativeGuidance: string;
  /** Default world expansion strategy — depth deepens the existing sandbox, breadth widens the map, dynamic auto-selects based on metrics */
  expansionStrategy: 'depth' | 'breadth' | 'dynamic';
  /** Reasoning effort — how much thinking the model does before responding. Higher = better structural decisions, slower generation. */
  reasoningLevel: ReasoningLevel;
  /** Beat profile preset key — selects a published work's beat/prose profile. Empty = default profile. */
  beatProfilePreset: string;
  /** Mechanism profile preset key — selects delivery mechanism distribution. Empty = default. */
  mechanismProfilePreset: string;
  /** Whether to use the pacing Markov chain (cube corners) for scene generation. */
  usePacingChain: boolean;
  /** Whether to use the beat profile Markov chain for plan generation. */
  useBeatChain: boolean;
  /** OpenAI TTS voice — one of: alloy, echo, fable, onyx, nova, shimmer */
  audioVoice: string;
  /** OpenAI TTS model — tts-1 (faster/cheaper) or tts-1-hd (higher quality) */
  audioModel: string;
  /** Output format for prose — standard fiction or screenplay format */
  proseFormat: ProseFormat;
};

export const BRANCH_TIME_HORIZON_OPTIONS = [25, 50, 100, 200] as const;

export const DEFAULT_STORY_SETTINGS: StorySettings = {
  povMode: 'free',
  povCharacterIds: [],
  storyDirection: '',
  storyConstraints: '',
  targetArcLength: 4,
  rhythmPreset: '',
  proseVoice: '',
  planGuidance: '',
  branchTimeHorizon: 50,
  coverPrompt: '',
  worldFocus: 'none',
  narrativeGuidance: '',
  expansionStrategy: 'dynamic',
  reasoningLevel: 'low',
  beatProfilePreset: '',
  mechanismProfilePreset: '',
  usePacingChain: true,
  useBeatChain: true,
  audioVoice: 'onyx',
  audioModel: 'tts-1',
  proseFormat: 'prose',
};

// ── Planning Queue ──────────────────────────────────────────────────────────

/** Completion status of a planning phase */
export type PlanningPhaseStatus = 'pending' | 'active' | 'completed';

/** A single phase in the planning queue — an allocated block of scenes with objectives */
export type PlanningPhase = {
  id: string;
  /** Display name (e.g. "Call to Adventure", "Ordeal") */
  name: string;
  /** What this phase should achieve */
  objective: string;
  /** Number of scenes allocated to this phase */
  sceneAllocation: number;
  /** Number of scenes generated so far in this phase */
  scenesCompleted: number;
  /** Current status */
  status: PlanningPhaseStatus;
  /** Phase-specific constraint overrides (empty = use story settings) */
  constraints: string;
  /** Structural mechanics rules — convergence, drive density, scene function variety, protagonist gravity */
  structuralRules?: string;
  /** AI-generated direction for this phase (set when phase becomes active) */
  direction: string;
  /** AI-generated completion report when phase finishes */
  completionReport?: string;
  /** World build ID created during transition into this phase */
  worldBuildId?: string;
  /** Hints for world expansion when transitioning into this phase */
  worldExpansionHints: string;
  /** Verbatim section from the plan document that maps to this phase — the source of truth for generation */
  sourceText?: string;
};

/** A named superstructure template that populates the queue */
export type PlanningProfile = {
  id: string;
  name: string;
  description: string;
  /** 'complete' for self-contained stories, 'episodic' for series volumes */
  category: 'complete' | 'episodic';
  /** Whether this is a built-in archetype or user-created */
  builtIn: boolean;
  /** Phase templates — no runtime state, just the blueprint */
  phases: {
    name: string;
    objective: string;
    sceneAllocation: number;
    constraints: string;
    /** Structural mechanics rules — convergence, drive density, scene function variety, protagonist gravity */
    structuralRules?: string;
    worldExpansionHints: string;
    sourceText?: string;
  }[];
};

/** Queue paradigm — determines how direction flows into scene generation */
export type QueueMode = 'outline' | 'plan';

/** Branch-scoped planning queue */
export type PlanningQueue = {
  /** The profile that populated this queue (null if manually built) */
  profileId: string | null;
  /** Queue paradigm: 'outline' = dynamic guidelines (cube framing + direction as secondary),
   *  'plan' = explicit quotable instructions (direction bypasses cube, source text trickles down).
   *  Defaults to 'outline'. */
  mode?: QueueMode;
  /** Ordered list of phases */
  phases: PlanningPhase[];
  /** Index of the currently active phase (-1 if none active yet) */
  activePhaseIndex: number;
  /** Whether to expand the world at phase boundaries using worldExpansionHints (default true) */
  expandWorld?: boolean;
};

// ── Auto Mode ───────────────────────────────────────────────────────────────

export type AutoEndCondition =
  | { type: 'scene_count'; target: number }
  | { type: 'all_threads_resolved' }
  | { type: 'arc_count'; target: number }
  | { type: 'planning_complete' }
  | { type: 'manual_stop' };

/** Auto actions map directly to the 8 narrative cube corners */
export type AutoAction = CubeCornerKey;

export type AutoActionWeight = {
  action: AutoAction;
  score: number;
  reason: string;
};

export type AutoConfig = {
  endConditions: AutoEndCondition[];
  minArcLength: number;
  maxArcLength: number;
  maxActiveThreads: number;
  threadStagnationThreshold: number;
  /** High-level north star that steers every arc */
  direction: string;
  toneGuidance: string;
  /** Constraints prompt — defaults from StorySettings.storyConstraints, overridable here */
  narrativeConstraints: string;
  characterRotationEnabled: boolean;
  minScenesBetweenCharacterFocus: number;
};

export type AutoRunLog = {
  cycle: number;
  timestamp: number;
  action: AutoAction;
  reason: string;
  scenesGenerated: number;
  worldExpanded: boolean;
  endConditionMet: AutoEndCondition | null;
  /** Human-readable details for debugging */
  arcName?: string;
  /** Phase name if planning queue is active */
  phaseName?: string;
  phaseProgress?: string;
  /** Direction and constraints used for this cycle */
  direction?: string;
  constraints?: string;
  /** Course correction output (if refreshDirection ran) */
  courseCorrection?: { direction: string; constraints: string };
  /** Error message if something failed */
  error?: string;
};

export type AutoRunState = {
  isRunning: boolean;
  isPaused: boolean;
  currentCycle: number;
  consecutiveFailures: number;
  /** Live status message shown in the control bar */
  statusMessage: string;
  totalScenesGenerated: number;
  totalWorldExpansions: number;
  startingSceneCount: number;
  startingArcCount: number;
  log: AutoRunLog[];
};

// ── API Logs ─────────────────────────────────────────────────────────────────

export type ApiLogEntry = {
  id: string;
  timestamp: number;
  caller: string;
  /** AI model used for this call */
  model?: string;
  /** Narrative this call belongs to */
  narrativeId?: string;
  /** Analysis this call belongs to */
  analysisId?: string;
  /** Discovery this call belongs to */
  discoveryId?: string;
  status: 'pending' | 'success' | 'error';
  durationMs: number | null;
  promptTokens: number;
  responseTokens: number | null;
  error: string | null;
  /** Truncated system prompt preview */
  systemPromptPreview?: string;
  /** Truncated prompt preview */
  promptPreview: string;
  /** Truncated response preview */
  responsePreview: string | null;
  /** Reasoning/thinking tokens used (if reasoning was enabled) */
  reasoningTokens?: number | null;
  /** Reasoning/thinking content from the model (if available) */
  reasoningContent?: string | null;
};

// ── System Logs ──────────────────────────────────────────────────────────────

export type SystemLogEntry = {
  id: string;
  timestamp: number;
  severity: 'error' | 'warning' | 'info';
  category: 'network' | 'timeout' | 'parsing' | 'validation' | 'lifecycle' | 'unknown';
  /** Human-readable message describing what happened */
  message: string;
  /** Raw error message from the exception (for errors/warnings) */
  errorMessage?: string;
  /** Stack trace if available (for errors) */
  errorStack?: string;
  /** Where the event occurred */
  source: 'auto-play' | 'mcts' | 'manual-generation' | 'analysis' | 'world-expansion' | 'direction-generation' | 'prose-generation' | 'plan-generation' | 'other';
  /** Current operation */
  operation?: string;
  /** Additional context */
  details?: Record<string, string | number | boolean | null | undefined>;
  /** Narrative this log belongs to */
  narrativeId?: string;
  /** Analysis this log belongs to */
  analysisId?: string;
  /** Discovery this log belongs to */
  discoveryId?: string;
};

// ── Text Analysis ────────────────────────────────────────────────────────────

export type AnalysisChunkResult = {
  chapterSummary: string;
  characters: { name: string; role: string; firstAppearance: boolean; imagePrompt?: string }[];
  locations: { name: string; prominence?: string; parentName: string | null; description: string; imagePrompt?: string; tiedCharacterNames?: string[] }[];
  artifacts?: { name: string; significance: string; imagePrompt?: string; ownerName: string | null }[];
  threads: { description: string; participantNames: string[]; statusAtStart: string; statusAtEnd: string; development: string; relatedThreadDescriptions?: string[] }[];
  scenes: {
    locationName: string; povName: string; participantNames: string[]; events: string[];
    summary: string; sections: number[]; prose?: string;
    threadMutations: { threadDescription: string; from: string; to: string; addedNodes: { content: string; type: string }[] }[];
    continuityMutations: {
      entityName: string;
      addedNodes: { content: string; type: string }[];
    }[];
    relationshipMutations: { from: string; to: string; type: string; valenceDelta: number }[];
    artifactUsages?: { artifactName: string; characterName: string | null; usage: string }[];
    ownershipMutations?: { artifactName: string; fromName: string; toName: string }[];
    tieMutations?: { locationName: string; characterName: string; action: 'add' | 'remove' }[];
    characterMovements?: { characterName: string; locationName: string; transition: string }[];
    systemMutations?: {
      addedNodes: { concept: string; type: string }[];
      addedEdges: { fromConcept: string; toConcept: string; relation: string }[];
    };
    plan?: BeatPlan;
    beatProseMap?: BeatProseMap;
  }[];
  relationships: { from: string; to: string; type: string; valence: number }[];
};

/** Analysis pipeline phases */
export type AnalysisPhase = 'plans' | 'structure' | 'arcs' | 'reconciliation' | 'finalization' | 'assembly';

export type AnalysisJob = {
  id: string;
  title: string;
  sourceText: string;
  /** Text split into numbered sections */
  chunks: { index: number; text: string; sectionCount: number }[];
  /** Results per chunk (same indices as chunks) */
  results: (AnalysisChunkResult | null)[];
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  /** Current pipeline phase — more reliable than parsing stream text */
  phase?: AnalysisPhase;
  currentChunkIndex: number;
  error?: string;
  /** The assembled narrative ID once complete */
  narrativeId?: string;
  /** Embedding progress tracking */
  embeddingProgress?: { completed: number; total: number };
  createdAt: number;
  updatedAt: number;
};

// ── Discovery Inquiries ──────────────────────────────────────────────────────

import type { PremiseDecision, PremiseEntity, PremiseEdge, PremiseQuestion, PremiseSystemSketch } from '@/lib/ai/premise';

export type DiscoveryPhase = 'systems' | 'rules' | 'cast' | 'threads';

export type DiscoverySnapshot = {
  decisions: PremiseDecision[];
  entities: PremiseEntity[];
  edges: PremiseEdge[];
  rules: string[];
  systems: PremiseSystemSketch[];
  title: string;
  worldSummary: string;
  currentQuestion: PremiseQuestion | null;
  phase: 'seed' | DiscoveryPhase;
};

export type DiscoveryInquiryState = {
  seed: string;
  decisions: PremiseDecision[];
  entities: PremiseEntity[];
  edges: PremiseEdge[];
  rules: string[];
  systems: PremiseSystemSketch[];
  title: string;
  worldSummary: string;
  currentQuestion: PremiseQuestion | null;
  phase: 'seed' | DiscoveryPhase;
  history?: DiscoverySnapshot[];
};

export type DiscoveryInquiry = {
  id: string;
  createdAt: number;
  updatedAt: number;
  state: DiscoveryInquiryState;
};

// ── App State ────────────────────────────────────────────────────────────────
export type InspectorContext =
  | { type: 'scene'; sceneId: string }
  | { type: 'character'; characterId: string }
  | { type: 'location'; locationId: string }
  | { type: 'thread'; threadId: string }
  | { type: 'arc'; arcId: string }
  | { type: 'knowledge'; nodeId: string }
  | { type: 'artifact'; artifactId: string }
  | { type: 'continuity'; entityId: string; nodeId: string }
  | { type: 'threadLog'; threadId: string; nodeId: string };

export type WizardStep = 'form' | 'details' | 'generate';

export type CharacterSketch = {
  name: string;
  role: 'anchor' | 'recurring' | 'transient';
  description: string;
};

export type LocationSketch = {
  name: string;
  description: string;
};

export type ThreadSketch = {
  description: string;
  participantNames: string[];
};

export type WorldSystemSketch = {
  name: string;
  description: string;
  principles: string[];
  constraints: string[];
  interactions: string[];
};

export type WizardData = {
  title: string;
  premise: string;
  characters: CharacterSketch[];
  locations: LocationSketch[];
  threads: ThreadSketch[];
  rules: string[];
  worldSystems: WorldSystemSketch[];
  proseProfile?: ProseProfile;
  /** When true: generate world entities only — no introduction arc or scenes. Premise is treated as the full world plan document. */
  worldOnly?: boolean;
};

export type GraphViewMode = 'spatial' | 'overview' | 'prose' | 'plan' | 'audio' | 'spark' | 'codex' | 'pulse' | 'threads' | 'search';

// ── Chat Threads ──────────────────────────────────────────────────────────────
export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ChatThread = {
  id: string;
  name: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

// ── Notes ─────────────────────────────────────────────────────────────────────
export type Note = {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type AppState = {
  narratives: NarrativeEntry[];
  activeNarrativeId: string | null;
  activeNarrative: NarrativeState | null;
  isPlaying: boolean;
  currentSceneIndex: number;
  activeBranchId: string | null;
  /** Ordered timeline entry IDs (scenes + world builds) for the active branch, resolved across parent branches */
  resolvedEntryKeys: string[];
  inspectorContext: InspectorContext | null;
  inspectorHistory: InspectorContext[];
  wizardOpen: boolean;
  wizardStep: WizardStep;
  wizardData: WizardData;
  selectedKnowledgeEntity: string | null;
  selectedThreadLog: string | null;
  graphViewMode: GraphViewMode;
  /** Current search query and results (persisted) */
  currentSearchQuery: SearchQuery | null;
  /** Index of currently focused search result (0-based) */
  currentResultIndex: number;
  /** Whether search UI is active/visible */
  searchFocusMode: boolean;
  autoConfig: AutoConfig;
  autoRunState: AutoRunState | null;
  apiLogs: ApiLogEntry[];
  systemLogs: SystemLogEntry[];
  analysisJobs: AnalysisJob[];
  activeChatThreadId: string | null;
  activeNoteId: string | null;
  beatProfilePresets: BeatProfilePreset[];
  mechanismProfilePresets: MechanismProfilePreset[];
};

export type BeatProfilePreset = {
  key: string;
  name: string;
  description: string;
  profile: ProseProfile;
  sampler?: BeatSampler;
};

export type MechanismProfilePreset = {
  key: string;
  name: string;
  description: string;
  distribution: Partial<Record<BeatMechanism, number>>;
};

// ─── Plan Candidates Types ──────────────────────────────────────────

/** A continuity violation — a proposition that contradicts prior established content */
export type ContinuityViolation = {
  /** Beat index of the violating proposition */
  beatIndex: number;
  /** Proposition index within the beat */
  propIndex: number;
  /** The candidate proposition content */
  candidateContent: string;
  /** The prior proposition(s) it contradicts */
  priorContent: string[];
  /** Scene IDs of the prior propositions */
  priorSceneIds: string[];
  /** LLM verdict: true = violation confirmed */
  isViolation: boolean;
  /** Brief explanation from the LLM */
  explanation: string;
  /** Backward activation score that triggered the check */
  activationScore: number;
  /** Classification label of the candidate proposition */
  label: string;
};

export type PlanCandidate = {
  id: string;
  plan: BeatPlan;
  centroid: number[];
  similarityScore: number;
  beatScores: { beatIndex: number; score: number }[];
  timestamp: number;
  /** Proposition classifications for this candidate (computed against existing narrative) */
  propositionLabels?: Record<string, string>;
  /** Continuity violations detected in this candidate */
  continuityViolations?: ContinuityViolation[];
};

export type PlanCandidates = {
  sceneId: string;
  candidates: PlanCandidate[];
  winner: string;
  createdAt: number;
};

// ─── Semantic Search Types ──────────────────────────────────────────

export type SearchResult = {
  type: 'proposition' | 'beat' | 'scene';
  id: string;
  sceneId: string;
  beatIndex?: number;
  propIndex?: number;
  content: string;
  similarity: number;
  context: string;
};

export type SearchSynthesis = {
  /** AI-synthesized overview text with inline citations */
  overview: string;
  /** Inline citation metadata linking to results */
  citations: Array<{
    id: number;
    sceneId: string;
    type: 'arc' | 'scene' | 'beat' | 'proposition';
    title: string;
    similarity: number;
  }>;
};

export type SearchQuery = {
  query: string;
  embedding: number[];
  synthesis?: SearchSynthesis;
  /** Combined results across all embedding types */
  results: SearchResult[];
  /** Scene-level results (thematic, high-level context) */
  sceneResults: SearchResult[];
  /** Detail-level results (propositions and beats, specific facts) */
  detailResults: SearchResult[];
  /** Timeline showing scene summary activation (direct similarity values) */
  sceneTimeline: { sceneIndex: number; similarity: number }[];
  /** Timeline showing detail fact activation (max similarity across beats/propositions per scene) */
  detailTimeline: { sceneIndex: number; maxSimilarity: number }[];
  topArc: { arcId: string; avgSimilarity: number } | null;
  topScene: { sceneId: string; similarity: number } | null;
  topBeat: { sceneId: string; beatIndex: number; similarity: number } | null;
};
