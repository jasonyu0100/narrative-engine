import type {
  NarrativeState,
  Character,
  Location,
  Thread,
  Arc,
  Scene,
  Commit,
  Branch,
  RelationshipEdge,
  WorldBuildCommit,
} from '@/types/narrative';

// ── Characters ───────────────────────────────────────────────────────────────
const characters: Record<string, Character> = {
  'C-01': {
    id: 'C-01',
    name: 'Fang Yuan',
    role: 'anchor',
    imagePrompt: 'A lean fifteen-year-old boy with sharp, angular features and flat black eyes that betray no emotion — thin lips, high cheekbones, coarse dark hair tied loosely back, wearing a faded grey Gu Yue clan robe with frayed hems, his posture deliberately unremarkable.',
    threadIds: ['T-01', 'T-03', 'T-06'],
    knowledge: {
      nodes: [
        { id: 'K-01', type: 'knows', content: 'Reborn 500 years into the past via the Spring Autumn Cicada' },
        { id: 'K-02', type: 'knows', content: 'Complete knowledge of Gu cultivation, refinement paths, and future events' },
        { id: 'K-03', type: 'secret', content: 'Is a 500-year-old Rank 6 demonic Gu Immortal in a 15-year-old body' },
        { id: 'K-04', type: 'goal', content: 'Attain eternal life — the Great Dao of longevity' },
        { id: 'K-05', type: 'believes', content: 'Only strength matters. Morality is a shackle the weak use to bind themselves' },
        { id: 'K-06', type: 'knows', content: 'The Flower Wine Monk inheritance ground lies beneath Qing Mao Mountain' },
        { id: 'K-07', type: 'knows', content: 'Bai Ning Bing carries the Northern Dark Ice Soul physique — she will die before 20' },
        { id: 'K-08', type: 'knows', content: 'Mo Bei Liu is embezzling clan resources and will attempt a power grab' },
        { id: 'K-09', type: 'knows', content: 'Fang Zheng will awaken an A-grade talent at the ceremony' },
      ],
      edges: [
        { from: 'K-01', to: 'K-02', type: 'enables' },
        { from: 'K-02', to: 'K-04', type: 'supports' },
        { from: 'K-03', to: 'K-04', type: 'enables' },
        { from: 'K-05', to: 'K-04', type: 'supports' },
        { from: 'K-06', to: 'K-04', type: 'enables' },
        { from: 'K-07', to: 'K-03', type: 'supports' },
        { from: 'K-08', to: 'K-02', type: 'supports' },
        { from: 'K-09', to: 'K-03', type: 'contradicts' },
      ],
    },
  },
  'C-02': {
    id: 'C-02',
    name: 'Fang Zheng',
    role: 'anchor',
    imagePrompt: 'A bright-eyed fifteen-year-old boy with a round, earnest face, warm brown eyes, and short-cropped black hair — softer features than his brother, wearing a clean Gu Yue clan robe with neat creases, his expression open and trusting.',
    threadIds: ['T-02', 'T-03'],
    knowledge: {
      nodes: [
        { id: 'K-10', type: 'believes', content: 'Fang Yuan is a mediocre but well-meaning elder brother' },
        { id: 'K-11', type: 'knows', content: 'The clan awakening ceremony determines a young cultivators future' },
        { id: 'K-12', type: 'goal', content: 'Become a great Gu Master and honor the Fang family name' },
        { id: 'K-13', type: 'believes', content: 'Hard work and righteousness will be rewarded' },
        { id: 'K-14', type: 'knows', content: 'Their parents died protecting the clan — he must live up to their legacy' },
      ],
      edges: [
        { from: 'K-10', to: 'K-12', type: 'supports' },
        { from: 'K-13', to: 'K-12', type: 'supports' },
        { from: 'K-14', to: 'K-12', type: 'enables' },
        { from: 'K-11', to: 'K-12', type: 'supports' },
      ],
    },
  },
  'C-03': {
    id: 'C-03',
    name: 'Gu Yue Bo',
    role: 'recurring',
    imagePrompt: 'An aged clan patriarch with a weathered, deeply lined face, thin white beard reaching his chest, and sharp narrow eyes under heavy brows — wearing layered ceremonial robes of dark green silk with silver clan insignia, his bearing upright despite his years.',
    threadIds: ['T-04'],
    knowledge: {
      nodes: [
        { id: 'K-20', type: 'knows', content: 'The Gu Yue clan is weakening — fewer talented youths each generation' },
        { id: 'K-21', type: 'secret', content: 'Aware of factional struggles between elders, especially Mo Bei Liu' },
        { id: 'K-22', type: 'goal', content: 'Maintain Gu Yue clan dominance on Qing Mao Mountain' },
        { id: 'K-23', type: 'believes', content: 'The clan must find exceptional talent to survive the next generation' },
      ],
      edges: [
        { from: 'K-20', to: 'K-22', type: 'contradicts' },
        { from: 'K-21', to: 'K-22', type: 'contradicts' },
        { from: 'K-23', to: 'K-22', type: 'supports' },
      ],
    },
  },
  'C-04': {
    id: 'C-04',
    name: 'Bai Ning Bing',
    role: 'recurring',
    imagePrompt: 'A strikingly beautiful youth with ice-white skin, pale silver-blue hair falling straight past the shoulders, and cold crystalline eyes that shimmer faintly — features almost too perfect, wearing pristine white robes with frost-blue trim, an aura of frigid detachment surrounding them.',
    threadIds: ['T-05'],
    knowledge: {
      nodes: [
        { id: 'K-30', type: 'knows', content: 'Carries the Northern Dark Ice Soul physique — a curse disguised as genius' },
        { id: 'K-31', type: 'goal', content: 'Break the Ice Soul curse and live beyond age 20' },
        { id: 'K-32', type: 'secret', content: 'Willing to sacrifice anyone and anything to survive' },
        { id: 'K-33', type: 'believes', content: 'Life itself is the only thing worth pursuing — everything else is meaningless' },
      ],
      edges: [
        { from: 'K-30', to: 'K-31', type: 'enables' },
        { from: 'K-32', to: 'K-31', type: 'supports' },
        { from: 'K-33', to: 'K-32', type: 'supports' },
      ],
    },
  },
  'C-05': {
    id: 'C-05',
    name: 'Shen Cui',
    role: 'transient',
    imagePrompt: 'A composed middle-aged woman with kind but perceptive eyes, hair pulled into a neat bun secured with a wooden pin, wearing a modest dark-blue instructor robe — her hands calloused from years of Gu cultivation demonstrations, expression patient and watchful.',
    threadIds: ['T-02'],
    knowledge: {
      nodes: [
        { id: 'K-40', type: 'believes', content: 'Talent should be nurtured fairly regardless of background' },
        { id: 'K-41', type: 'knows', content: 'Fang Yuan appears to be a mediocre student with no remarkable aptitude' },
        { id: 'K-42', type: 'goal', content: 'Identify and develop the most promising students for the clan' },
      ],
      edges: [
        { from: 'K-40', to: 'K-42', type: 'supports' },
        { from: 'K-41', to: 'K-42', type: 'contradicts' },
      ],
    },
  },
  'C-06': {
    id: 'C-06',
    name: 'Mo Bei Liu',
    role: 'transient',
    imagePrompt: 'A stocky, thick-necked elder with a broad jaw, calculating small eyes, and a neatly trimmed black beard flecked with grey — wearing dark olive robes of fine material that suggest wealth beyond his station, his smile wide but never reaching his eyes.',
    threadIds: ['T-04'],
    knowledge: {
      nodes: [
        { id: 'K-50', type: 'secret', content: 'Has been embezzling clan primeval stones and Gu resources for years' },
        { id: 'K-51', type: 'goal', content: 'Seize more power within the clan — ideally replace Gu Yue Bo as leader' },
        { id: 'K-52', type: 'believes', content: 'Gu Yue Bo is too cautious and will lead the clan to ruin' },
        { id: 'K-53', type: 'knows', content: 'Has gathered supporters among the younger elders' },
      ],
      edges: [
        { from: 'K-50', to: 'K-51', type: 'enables' },
        { from: 'K-52', to: 'K-51', type: 'supports' },
        { from: 'K-53', to: 'K-51', type: 'enables' },
      ],
    },
  },
  'C-07': {
    id: 'C-07',
    name: 'Chi Shan',
    role: 'transient',
    imagePrompt: 'A wiry, sun-darkened wandering Gu Master with tangled hair, a jagged scar across one cheek, and restless hungry eyes — wearing patched leather traveling clothes and a belt hung with pouches and crude Gu containers, the look of someone who has lived rough for years.',
    threadIds: ['T-06'],
    knowledge: {
      nodes: [
        { id: 'K-60', type: 'knows', content: 'Has found markings near Qing Mao Mountain pointing to a secret inheritance ground' },
        { id: 'K-61', type: 'goal', content: 'Find and claim the inheritance before anyone else' },
        { id: 'K-62', type: 'believes', content: 'The inheritance could elevate him from a wandering Gu Master to a true power' },
      ],
      edges: [
        { from: 'K-60', to: 'K-61', type: 'enables' },
        { from: 'K-62', to: 'K-61', type: 'supports' },
      ],
    },
  },
  'C-08': {
    id: 'C-08',
    name: 'Tie Ruo Nan',
    role: 'transient',
    imagePrompt: 'A stern young woman with a square jaw, fierce dark eyes, and black hair bound tightly under a bronze hairpiece — wearing polished righteous-path sect armor over layered robes, her posture rigid and alert, a dao sword strapped across her back.',
    threadIds: ['T-07'],
    knowledge: {
      nodes: [
        { id: 'K-70', type: 'goal', content: 'Investigate rumors of demonic cultivator activity near Qing Mao Mountain' },
        { id: 'K-71', type: 'believes', content: 'The righteous path must root out demonic cultivators wherever they hide' },
        { id: 'K-72', type: 'knows', content: 'Detected faint traces of Spring Autumn Cicada activation — an impossible Gu thought lost' },
      ],
      edges: [
        { from: 'K-72', to: 'K-70', type: 'enables' },
        { from: 'K-71', to: 'K-70', type: 'supports' },
      ],
    },
  },
};

// ── Locations ────────────────────────────────────────────────────────────────
const locations: Record<string, Location> = {
  'L-01': {
    id: 'L-01', name: 'Qing Mao Mountain', parentId: null, threadIds: [],
    imagePrompt: 'A towering ancient mountain shrouded in mist and dense bamboo forest, its jagged peaks piercing low clouds — lush green slopes cut by narrow winding paths, faint luminous Gu worms drifting between the trees at dusk, the air heavy with primeval essence.',
    knowledge: {
      nodes: [
        { id: 'LK-01', type: 'lore', content: 'Home to three rival Gu Master clans — Gu Yue, Bai, and Xiong' },
        { id: 'LK-02', type: 'lore', content: 'Rich in wild Gu worms due to the mountains primeval essence veins' },
      ],
      edges: [{ from: 'LK-01', to: 'LK-02', type: 'supports' }],
    },
  },
  'L-02': {
    id: 'L-02', name: 'Gu Yue Village', parentId: 'L-01', threadIds: ['T-04'],
    imagePrompt: 'A modest mountain village of weathered wooden stilted houses with thatched roofs, nestled on a plateau among bamboo groves — packed-earth roads, cooking smoke curling upward, surrounded by a low bamboo perimeter fence with the mountain looming behind.',
    knowledge: {
      nodes: [
        { id: 'LK-03', type: 'lore', content: 'The weakest of the three mountain clans, relying on tradition over innovation' },
        { id: 'LK-04', type: 'secret', content: 'Hidden tunnel network beneath the village, known only to past clan leaders' },
      ],
      edges: [{ from: 'LK-04', to: 'LK-03', type: 'contradicts' }],
    },
  },
  'L-03': {
    id: 'L-03', name: 'Academy', parentId: 'L-02', threadIds: ['T-02'],
    imagePrompt: 'A wide open-air training hall with a slate lecture board, wooden benches arranged in rows, and a raised stone platform for cultivation demonstrations — sunlight filtering through slatted windows, the walls hung with charts of Gu worm classifications.',
    knowledge: {
      nodes: [
        { id: 'LK-05', type: 'lore', content: 'Where clan youths are tested and trained in basic Gu cultivation' },
      ],
      edges: [],
    },
  },
  'L-04': {
    id: 'L-04', name: 'Clan Hall', parentId: 'L-02', threadIds: ['T-04'],
    imagePrompt: 'A grand timber hall with heavy carved pillars and a high vaulted ceiling, copper lanterns casting warm amber light across a long stone table where the clan elders convene — ancestral tablets lining the back wall, the air thick with incense and political tension.',
    knowledge: {
      nodes: [
        { id: 'LK-06', type: 'lore', content: 'Seat of Gu Yue clan governance — where elders debate and resources are allocated' },
        { id: 'LK-07', type: 'secret', content: 'Factional meetings occur in side chambers after formal sessions' },
      ],
      edges: [{ from: 'LK-07', to: 'LK-06', type: 'contradicts' }],
    },
  },
  'L-05': {
    id: 'L-05', name: 'Secret Tunnels', parentId: 'L-02', threadIds: ['T-01'],
    imagePrompt: 'Narrow underground passages carved from raw stone, dripping with mineral water, lit only by faint bioluminescent moss — collapsed archways, low ceilings, and hidden alcoves containing dusty caches of primeval stones, the air cold and metallic.',
    knowledge: {
      nodes: [
        { id: 'LK-08', type: 'secret', content: 'Contains hidden caches of primeval stones left by previous generations' },
        { id: 'LK-09', type: 'secret', content: 'Connected to the deeper mountain caverns where wild Gu thrive' },
      ],
      edges: [{ from: 'LK-08', to: 'LK-09', type: 'supports' }],
    },
  },
  'L-06': {
    id: 'L-06', name: 'Bai Clan Territory', parentId: 'L-01', threadIds: ['T-05'],
    imagePrompt: 'A fortress-village of white stone buildings on a frost-covered mountainside, ice crystals glinting on every surface — cold blue light emanating from cultivation chambers, sharp-peaked rooftops dusted with snow, the architecture imposing and austere.',
    knowledge: {
      nodes: [
        { id: 'LK-10', type: 'lore', content: 'The strongest of the three mountain clans, known for ice-path Gu cultivation' },
        { id: 'LK-11', type: 'lore', content: 'Birthplace of the Northern Dark Ice Soul physique — both blessing and curse' },
      ],
      edges: [{ from: 'LK-10', to: 'LK-11', type: 'supports' }],
    },
  },
  'L-07': {
    id: 'L-07', name: 'Mountain Wilderness', parentId: 'L-01', threadIds: ['T-06'],
    imagePrompt: 'Untamed mountain slopes thick with ancient trees, tangled undergrowth, and jagged rock outcroppings — wild beast tracks scoring the mud, cliff faces bearing faded carved markings, shafts of light breaking through the dense canopy, an atmosphere of danger and hidden secrets.',
    knowledge: {
      nodes: [
        { id: 'LK-12', type: 'danger', content: 'Wild beast packs and untamed Gu worms make this area lethal for low-rank cultivators' },
        { id: 'LK-13', type: 'lore', content: 'Ancient markings on cliff faces hint at hidden inheritance grounds' },
      ],
      edges: [{ from: 'LK-13', to: 'LK-12', type: 'supports' }],
    },
  },
  'L-08': {
    id: 'L-08', name: "Flower Wine Monk's Inheritance Ground", parentId: 'L-01', threadIds: ['T-06'],
    imagePrompt: 'A vast underground cavern of crumbling ornate architecture — carved stone columns wound with dead vines, collapsed bridges over dark chasms, glowing formation arrays etched into the floor, poisoned dart mechanisms visible in the walls, the remnants of a Rank 4 Gu Immortals sealed legacy.',
    knowledge: {
      nodes: [
        { id: 'LK-14', type: 'secret', content: 'A Rank 4 Gu Immortals complete legacy — techniques, Gu worms, and primeval stones' },
        { id: 'LK-15', type: 'danger', content: 'Protected by lethal formations — poisoned darts, illusion arrays, and collapsing architecture' },
        { id: 'LK-16', type: 'lore', content: 'The Flower Wine Monk was known for unconventional cultivation paths' },
      ],
      edges: [
        { from: 'LK-14', to: 'LK-15', type: 'supports' },
        { from: 'LK-16', to: 'LK-14', type: 'enables' },
      ],
    },
  },
};

// ── Threads ──────────────────────────────────────────────────────────────────
const threads: Record<string, Thread> = {
  'T-01': {
    id: 'T-01',
    anchors: [{ id: 'C-01', type: 'character' }],
    description: "Spring Autumn Cicada — Fang Yuan's rebirth secret, the one truth that must never be exposed",
    status: 'dormant',
    openedAt: 'S-001',
    dependents: ['T-03', 'T-05'],
  },
  'T-02': {
    id: 'T-02',
    anchors: [{ id: 'L-03', type: 'location' }, { id: 'C-01', type: 'character' }, { id: 'C-02', type: 'character' }],
    description: 'The Awakening Ceremony — who receives which vital Gu, and whose future is sealed',
    status: 'dormant',
    openedAt: 'S-001',
    dependents: [],
  },
  'T-03': {
    id: 'T-03',
    anchors: [{ id: 'C-02', type: 'character' }, { id: 'C-01', type: 'character' }],
    description: "Brother against brother — Fang Zheng's growing suspicion that something is deeply wrong with Fang Yuan",
    status: 'dormant',
    openedAt: 'S-001',
    dependents: [],
  },
  'T-04': {
    id: 'T-04',
    anchors: [{ id: 'L-04', type: 'location' }, { id: 'C-03', type: 'character' }, { id: 'C-06', type: 'character' }],
    description: "Clan politics — Mo Bei Liu's faction against Gu Yue Bo's loyalists, the Gu Yue clan fracturing from within",
    status: 'dormant',
    openedAt: 'S-009',
    dependents: [],
  },
  'T-05': {
    id: 'T-05',
    anchors: [{ id: 'C-04', type: 'character' }],
    description: "Bai Ning Bing's curse — the Northern Dark Ice Soul physique, a ticking clock toward death before age 20",
    status: 'dormant',
    openedAt: 'S-001',
    dependents: [],
  },
  'T-06': {
    id: 'T-06',
    anchors: [{ id: 'L-08', type: 'location' }, { id: 'L-07', type: 'location' }],
    description: "The Flower Wine Monk's inheritance ground — hidden power buried beneath Qing Mao Mountain",
    status: 'dormant',
    openedAt: 'S-001',
    dependents: ['T-01'],
  },
  'T-07': {
    id: 'T-07',
    anchors: [{ id: 'C-08', type: 'character' }],
    description: "Tie Ruo Nan's investigation — the righteous path hunting demonic cultivator traces near the mountain",
    status: 'dormant',
    openedAt: 'S-001',
    dependents: [],
  },
};

// ── Relationships ────────────────────────────────────────────────────────────
const relationships: RelationshipEdge[] = [
  { from: 'C-01', to: 'C-02', type: 'Views brother as a useful shield — affection is a tool he wears like a mask', valence: 0.1 },
  { from: 'C-02', to: 'C-01', type: 'Loves his elder brother and worries about his mediocre talent', valence: 0.7 },
  { from: 'C-01', to: 'C-03', type: 'Feigns respect while cataloguing every weakness for future leverage', valence: -0.3 },
  { from: 'C-03', to: 'C-01', type: 'Barely registers the C-grade boy — just another unremarkable student', valence: -0.1 },
  { from: 'C-03', to: 'C-06', type: 'Senses Mo Bei Liu maneuvering against him but cannot yet prove it', valence: -0.4 },
  { from: 'C-06', to: 'C-03', type: 'Sees an aging leader clinging to tradition while the clan weakens', valence: -0.5 },
  { from: 'C-04', to: 'C-01', type: 'Has never met this person — no impression formed', valence: 0.0 },
  { from: 'C-01', to: 'C-04', type: 'Knows she is dangerous and desperate — a volatile element to monitor', valence: -0.2 },
  { from: 'C-05', to: 'C-01', type: 'Feels sorry for the talentless elder brother overshadowed by his sibling', valence: 0.2 },
  { from: 'C-05', to: 'C-02', type: 'Sees a bright future and wants to nurture his exceptional talent', valence: 0.6 },
];

// ── Arcs ─────────────────────────────────────────────────────────────────────
const arcs: Record<string, Arc> = {
  'SC-01': {
    id: 'SC-01',
    name: 'The Awakening',
    sceneIds: ['S-001', 'S-002', 'S-003', 'S-004', 'S-005', 'S-006', 'S-007', 'S-008'],
    develops: ['T-02'],
    locationIds: ['L-01', 'L-02', 'L-03', 'L-04'],
    activeCharacterIds: ['C-01', 'C-02', 'C-03', 'C-05', 'C-06'],
    initialCharacterLocations: {
      'C-01': 'L-02',
      'C-02': 'L-02',
      'C-03': 'L-04',
      'C-05': 'L-03',
      'C-06': 'L-04',
    },
  },
  'SC-02': {
    id: 'SC-02',
    name: 'Undercurrents',
    sceneIds: ['S-009', 'S-010', 'S-011', 'S-012', 'S-013', 'S-014'],
    develops: ['T-02', 'T-04'],
    locationIds: ['L-02', 'L-03', 'L-04', 'L-05'],
    activeCharacterIds: ['C-01', 'C-02', 'C-03', 'C-05', 'C-06'],
    initialCharacterLocations: {
      'C-01': 'L-02',
      'C-02': 'L-03',
      'C-03': 'L-04',
      'C-05': 'L-03',
      'C-06': 'L-04',
    },
  },
};

// ── Scenes ───────────────────────────────────────────────────────────────────
const scenes: Record<string, Scene> = {
  // ── Arc 1: The Awakening ────────────────────────────────────────────────

  // [quiet] Atmosphere — morning in the village, world establishment
  'S-001': {
    id: 'S-001',
    kind: 'scene',
    arcId: 'SC-01',
    locationId: 'L-02',
    povId: 'C-01',
    participantIds: ['C-01'],
    events: ['morning_mist', 'village_waking', 'fang_yuan_walks_alone'],
    threadMutations: [
      { threadId: 'T-01', from: 'dormant', to: 'active' },
    ],
    knowledgeMutations: [
      { characterId: 'C-01', nodeId: 'K-80', action: 'added', content: 'The village layout matches his memories — the timeline is intact and his rebirth succeeded' },
      { characterId: 'C-01', nodeId: 'K-81', action: 'added', content: 'The bamboo grove path to the academy is unwatched at dawn — useful for future movements' },
    ],
    relationshipMutations: [],
    summary: 'Mist clings to Gu Yue Village like gauze on a wound. Dawn finds Fang Yuan already awake, standing at the edge of the bamboo grove where the path descends toward the academy. Smoke rises from cooking fires. Children chase each other between the stilted houses. An old woman feeds chickens. The mountain looms above it all, ancient and indifferent. Fang Yuan watches the village he destroyed in another lifetime go about its morning, his face perfectly, terribly blank.',
  },

  // [quiet] Character — brothers walking to academy, daily routine
  'S-002': {
    id: 'S-002',
    kind: 'scene',
    arcId: 'SC-01',
    locationId: 'L-02',
    povId: 'C-01',
    participantIds: ['C-01', 'C-02'],
    events: ['brothers_walk', 'fang_zheng_chatter', 'fang_yuan_performs_normalcy'],
    threadMutations: [
      { threadId: 'T-03', from: 'dormant', to: 'active' },
    ],
    knowledgeMutations: [
      { characterId: 'C-01', nodeId: 'K-82', action: 'added', content: 'Fang Zheng is exactly as naive as he remembers — easy to manipulate through genuine affection' },
      { characterId: 'C-02', nodeId: 'K-83', action: 'added', content: 'Fang Yuan seems quieter than usual lately — perhaps nervous about the awakening ceremony' },
    ],
    relationshipMutations: [
      { from: 'C-01', to: 'C-02', type: 'Calibrating the brotherly mask — every reaction must be pitch-perfect', valenceDelta: -0.05 },
    ],
    summary: 'The brothers walk the packed-earth road to the academy together, as they have every morning since childhood. Fang Zheng talks about the upcoming awakening ceremony with restless excitement. He asks Fang Yuan if he is nervous. Fang Yuan says yes. It is the right answer, delivered with the right hesitation, and Fang Zheng believes it completely. Between them the road is narrow and the silence after each exchange is a country Fang Zheng does not know he is standing in.',
  },

  // [minor plot] Academy lecture, Shen Cui establishes the world of Gu cultivation
  'S-003': {
    id: 'S-003',
    kind: 'scene',
    arcId: 'SC-01',
    locationId: 'L-03',
    povId: 'C-01',
    participantIds: ['C-01', 'C-02', 'C-05'],
    events: ['academy_lecture', 'gu_basics_explained', 'shen_cui_observes_students'],
    threadMutations: [
      { threadId: 'T-02', from: 'dormant', to: 'active' },
    ],
    knowledgeMutations: [
      { characterId: 'C-05', nodeId: 'K-84', action: 'added', content: 'The new class shows uneven aptitude — several students struggle with basic primeval essence concepts' },
      { characterId: 'C-01', nodeId: 'K-85', action: 'added', content: 'Shen Cui teaches the orthodox method — inefficient but safe, exactly as he remembers' },
    ],
    relationshipMutations: [
      { from: 'C-05', to: 'C-01', type: 'The boy deliberately hides in the back row — pity tinged with mild concern', valenceDelta: 0.05 },
    ],
    summary: 'Academy. Shen Cui draws a diagram of primeval essence flow on the slate board, her chalk strokes precise as surgical cuts. She explains that Gu are living organisms, not tools — they must be fed, understood, respected. The students lean forward. Fang Yuan leans back. He learned this five hundred years ago from a man Shen Cui has never heard of, in a city that will not be founded for another century. He lets his eyes glaze. Fang Zheng takes meticulous notes beside him.',
  },

  // [quiet] World-building — the mountain at dusk, establishing place
  'S-004': {
    id: 'S-004',
    kind: 'scene',
    arcId: 'SC-01',
    locationId: 'L-01',
    povId: 'C-01',
    participantIds: ['C-01'],
    events: ['mountain_dusk', 'wild_gu_sighting', 'fang_yuan_catalogs_terrain'],
    threadMutations: [
      { threadId: 'T-06', from: 'dormant', to: 'active' },
    ],
    knowledgeMutations: [
      { characterId: 'C-01', nodeId: 'K-86', action: 'added', content: 'The Moonlight Gu still migrates along the ridge path — the inheritance ground entrance should be two valleys south' },
      { characterId: 'C-01', nodeId: 'K-87', action: 'added', content: 'Terrain mapping complete — three viable escape routes from the village confirmed' },
    ],
    relationshipMutations: [],
    summary: 'Dusk on Qing Mao Mountain. Fang Yuan walks the ridge path alone, ostensibly gathering herbs for a class assignment. The real work is invisible: he is mapping the terrain against five centuries of memory, noting what has changed and what remains. A luminous beetle Gu drifts past — a Moonlight Gu, rank one, harmless and beautiful. In his previous life he crushed a thousand of them for reagents. Tonight he lets it pass. Not out of mercy. Out of patience.',
  },

  // [plot beat] The Awakening Ceremony — the seed's first significant moment
  'S-005': {
    id: 'S-005',
    kind: 'scene',
    arcId: 'SC-01',
    locationId: 'L-03',
    povId: 'C-01',
    participantIds: ['C-01', 'C-02', 'C-03', 'C-05'],
    events: ['awakening_ceremony', 'fang_zheng_excels', 'fang_yuan_conceals'],
    threadMutations: [
      { threadId: 'T-02', from: 'dormant', to: 'active' },
    ],
    knowledgeMutations: [
      { characterId: 'C-05', nodeId: 'K-43', action: 'added', content: 'Fang Zheng awakened A-grade talent — the clans brightest hope in a decade' },
      { characterId: 'C-03', nodeId: 'K-24', action: 'added', content: 'Fang Zheng is a generational talent who must be cultivated carefully' },
      { characterId: 'C-02', nodeId: 'K-88', action: 'added', content: 'The gap between A-grade and C-grade is enormous — guilt at outshining his brother' },
      { characterId: 'C-01', nodeId: 'K-89', action: 'added', content: 'Successfully suppressed his aperture reading to C-grade — no one suspects' },
    ],
    relationshipMutations: [
      { from: 'C-05', to: 'C-02', type: 'Awe at A-grade talent — this boy could carry the clan', valenceDelta: 0.2 },
      { from: 'C-03', to: 'C-01', type: 'C-grade result confirms the boy is beneath notice', valenceDelta: -0.1 },
      { from: 'C-03', to: 'C-02', type: 'The clan patriarch now has personal interest in the A-grade boy', valenceDelta: 0.3 },
    ],
    summary: 'The Awakening Ceremony. The entire clan gathers in the academy hall, lanterns casting copper light across a hundred expectant faces. Each youth places their hand on the vital Gu. When Fang Zheng touches it, A-grade light floods the chamber — gasps, then applause, then the elders whispering among themselves. Fang Yuan deliberately dampens his own response: C-grade. Polite silence. Gu Yue Bo nods once and moves on. Shen Cui cannot meet his eyes. Only Fang Yuan knows the measurement stone would have shattered if he had let it.',
  },

  // [quiet] Aftermath — the village celebrates Fang Zheng, character moment
  'S-006': {
    id: 'S-006',
    kind: 'scene',
    arcId: 'SC-01',
    locationId: 'L-02',
    povId: 'C-02',
    participantIds: ['C-01', 'C-02'],
    events: ['village_celebration', 'fang_zheng_guilt', 'fang_yuan_mask'],
    threadMutations: [
      { threadId: 'T-03', from: 'active', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-02', nodeId: 'K-90', action: 'added', content: 'The villagers pity Fang Yuan openly — his brother deserves better than their condescension' },
      { characterId: 'C-01', nodeId: 'K-91', action: 'added', content: 'The village reaction confirms his cover is perfect — pity is the best camouflage' },
    ],
    relationshipMutations: [
      { from: 'C-02', to: 'C-01', type: 'Guilt strengthens protective instinct toward his struggling brother', valenceDelta: 0.1 },
      { from: 'C-01', to: 'C-02', type: 'The boy is useful — his guilt makes him predictable and loyal', valenceDelta: 0.05 },
    ],
    summary: 'Evening. Paper lanterns sway over the village square. Neighbors press rice wine and congratulations on Fang Zheng, who accepts them with a smile that keeps flickering toward his brother. Fang Yuan sits on the edge of the celebration, eating quietly, receiving the occasional pitying glance with practiced grace. Later, walking home, Fang Zheng says he is sorry. Fang Yuan tells him there is nothing to be sorry for. The tenderness in his voice is so perfectly calibrated that Fang Zheng almost cries. Behind his brother, Fang Yuan\'s eyes are dry as old stone.',
  },

  // [quiet] Relationship-building — Shen Cui and Fang Zheng, low-stakes mentorship
  'S-007': {
    id: 'S-007',
    kind: 'scene',
    arcId: 'SC-01',
    locationId: 'L-03',
    povId: 'C-02',
    participantIds: ['C-02', 'C-05'],
    events: ['mentorship_begins', 'shen_cui_advises', 'fang_zheng_eager'],
    threadMutations: [
      { threadId: 'T-02', from: 'active', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-02', nodeId: 'K-92', action: 'added', content: 'Shen Cui warned that A-grade talent draws political attention from clan elders — he must be careful' },
      { characterId: 'C-05', nodeId: 'K-93', action: 'added', content: 'Fang Zheng has the temperament to match his talent — earnest, teachable, uncorrupted' },
    ],
    relationshipMutations: [
      { from: 'C-02', to: 'C-05', type: 'Sees a mentor figure — someone who believes in him for the right reasons', valenceDelta: 0.2 },
      { from: 'C-05', to: 'C-02', type: 'Growing maternal protectiveness toward a student who needs guidance', valenceDelta: 0.1 },
    ],
    summary: 'Academy, after hours. Shen Cui keeps Fang Zheng behind to discuss his training regimen. She speaks carefully about the burden of exceptional talent — how the clan will expect much, how he must pace himself. Fang Zheng listens with the earnest gravity of a boy who has never been told he is special before. The late afternoon light falls through the window slats in bars across the floor. It is a gentle scene, almost domestic, entirely unaware of the forces gathering around it.',
  },

  // [quiet] Atmosphere — night in the clan, establishing mood and subtle tension
  'S-008': {
    id: 'S-008',
    kind: 'scene',
    arcId: 'SC-01',
    locationId: 'L-02',
    povId: 'C-01',
    participantIds: ['C-01'],
    events: ['night_village', 'fang_yuan_paces_perimeter', 'old_memories'],
    threadMutations: [
      { threadId: 'T-01', from: 'active', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-01', nodeId: 'K-94', action: 'added', content: 'The Bai clan breach point is unfortified — the village defenses have the same weaknesses as before' },
      { characterId: 'C-01', nodeId: 'K-95', action: 'added', content: 'Night patrol routes have gaps — the perimeter is unwatched between the second and fourth hour' },
    ],
    relationshipMutations: [],
    summary: 'The village sleeps. Fang Yuan does not. He walks the perimeter path where the bamboo fence meets the tree line, a route the night watchmen abandoned years ago. Crickets. The distant sound of water over rocks. He pauses at the spot where, in another life, the Bai clan breached the wall and thirty-seven people died in the first minute. The grass there grows the same as everywhere else. The mountain does not remember. But he does. He stands there a long time, face unreadable, before moving on.',
  },

  // ── Arc 2: Undercurrents ────────────────────────────────────────────────

  // [minor plot] Clan Hall — first taste of political friction, no escalation
  'S-009': {
    id: 'S-009',
    kind: 'scene',
    arcId: 'SC-02',
    locationId: 'L-04',
    povId: 'C-03',
    participantIds: ['C-03', 'C-06'],
    events: ['elder_meeting', 'resource_debate', 'tension_noted'],
    threadMutations: [{ threadId: 'T-04', from: 'dormant', to: 'active' }],
    knowledgeMutations: [
      { characterId: 'C-03', nodeId: 'K-96', action: 'added', content: 'Mo Bei Liu has at least three supporters among the younger elders — the faction is growing' },
      { characterId: 'C-06', nodeId: 'K-97', action: 'added', content: 'Gu Yue Bo still commands enough respect to deny proposals outright — a direct challenge is premature' },
    ],
    relationshipMutations: [
      { from: 'C-06', to: 'C-03', type: 'Resentment deepens as Bo blocks his resource proposal', valenceDelta: -0.1 },
      { from: 'C-03', to: 'C-06', type: 'The man grows bolder — his patience with Mo Bei Liu wears thinner', valenceDelta: -0.1 },
    ],
    summary: 'Clan Hall. The elders convene to allocate quarterly resources — primeval stones, Gu feed, training materials. Mo Bei Liu proposes redirecting funds from border patrols to youth cultivation. Gu Yue Bo denies the request with a single raised hand. The room is quiet. Mo Bei Liu smiles, bows, sits. But his supporters exchange glances across the table, and Gu Yue Bo notices every one. The meeting ends. Nothing has happened. Everything has begun.',
  },

  // [quiet] Fang Yuan observes the clan hall from outside, cataloguing
  'S-010': {
    id: 'S-010',
    kind: 'scene',
    arcId: 'SC-02',
    locationId: 'L-04',
    povId: 'C-01',
    participantIds: ['C-01'],
    characterMovements: { 'C-01': 'L-04' },
    events: ['fang_yuan_eavesdrops', 'political_assessment', 'silent_calculation'],
    threadMutations: [
      { threadId: 'T-04', from: 'active', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-01', nodeId: 'K-98', action: 'added', content: 'Mo Bei Liu left through the east gate with two allies — the faction alignment matches his past life memories exactly' },
      { characterId: 'C-01', nodeId: 'K-99', action: 'added', content: 'Gu Yue Bo walks alone — the old man is more isolated than he realizes' },
    ],
    relationshipMutations: [
      { from: 'C-01', to: 'C-06', type: 'Mo Bei Liu is a predictable piece on the board — useful when the time comes', valenceDelta: 0.1 },
      { from: 'C-01', to: 'C-03', type: 'The old patriarch is weakening — his downfall will create the chaos Fang Yuan needs', valenceDelta: -0.1 },
    ],
    summary: 'Fang Yuan loiters outside the Clan Hall as the elders disperse, pretending to sweep the courtyard steps — a chore no one questions a C-grade student performing. He watches Mo Bei Liu leave through the east gate, flanked by two younger elders. He watches Gu Yue Bo leave alone through the main entrance, walking slowly. Five hundred years of political experience read the scene like an open scroll. The timeline is intact. Mo Bei Liu will move in approximately four months. Fang Yuan sets down the broom and walks away.',
  },

  // [quiet] Academy training — Fang Zheng and peers, world texture
  'S-011': {
    id: 'S-011',
    kind: 'scene',
    arcId: 'SC-02',
    locationId: 'L-03',
    povId: 'C-02',
    participantIds: ['C-02', 'C-05'],
    events: ['training_session', 'primeval_essence_exercise', 'fang_zheng_struggles'],
    threadMutations: [
      { threadId: 'T-02', from: 'escalating', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-05', nodeId: 'K-100', action: 'added', content: 'Fang Zheng has raw power but lacks fine control — he needs specialized exercises' },
      { characterId: 'C-02', nodeId: 'K-101', action: 'added', content: 'A-grade talent does not guarantee mastery — the gap between potential and skill is humbling' },
    ],
    relationshipMutations: [
      { from: 'C-05', to: 'C-02', type: 'His struggle with control makes him more relatable — talent alone is not enough', valenceDelta: 0.1 },
    ],
    summary: 'Academy training yard. The newly awakened students practice channeling primeval essence into their first Gu. Most fail repeatedly — the Gu squirm away from clumsy flows of energy like fish from a child\'s hands. Fang Zheng, despite his A-grade talent, struggles with fine control. Shen Cui corrects his grip. The other students watch him with a mix of envy and hope. A normal afternoon. The kind of afternoon that makes a world feel lived-in before the world begins to crack.',
  },

  // [plot beat] Fang Yuan enters the tunnels for the first time — careful, alone
  'S-012': {
    id: 'S-012',
    kind: 'scene',
    arcId: 'SC-02',
    locationId: 'L-05',
    povId: 'C-01',
    participantIds: ['C-01'],
    characterMovements: { 'C-01': 'L-05' },
    events: ['secret_tunnel_entry', 'past_life_navigation', 'hidden_cache_found'],
    threadMutations: [
      { threadId: 'T-01', from: 'escalating', to: 'escalating' },
      { threadId: 'T-06', from: 'active', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-01', nodeId: 'K-10A', action: 'added', content: 'Located the hidden primeval stone cache in the tunnels, exactly where he remembered' },
      { characterId: 'C-01', nodeId: 'K-102', action: 'added', content: 'The tunnel network connects to deeper mountain caverns — a potential path to the inheritance ground' },
    ],
    relationshipMutations: [],
    summary: 'Deep night. Fang Yuan lifts the stone slab behind the abandoned granary and descends into the tunnels beneath Gu Yue Village. The air below is cold and tastes of minerals. He walks without light — five hundred years of memory serving as his lantern. Left at the collapsed arch, right at the dripping wall, duck beneath the low beam that decapitated a thief in another century. He finds the primeval stone cache exactly where he left it, in a life no one else remembers. He takes only a few. He will be back.',
  },

  // [quiet] Brothers at home — domestic scene, Fang Zheng talks about dreams
  'S-013': {
    id: 'S-013',
    kind: 'scene',
    arcId: 'SC-02',
    locationId: 'L-02',
    povId: 'C-02',
    participantIds: ['C-01', 'C-02'],
    events: ['evening_meal', 'fang_zheng_ambitions', 'fang_yuan_listens'],
    threadMutations: [
      { threadId: 'T-03', from: 'escalating', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-02', nodeId: 'K-103', action: 'added', content: 'Fang Yuan said he wants to be useful — but something about the way he said it felt hollow' },
      { characterId: 'C-01', nodeId: 'K-104', action: 'added', content: 'Fang Zheng idolizes their parents sacrifice — a lever that could be pulled if necessary' },
    ],
    relationshipMutations: [
      { from: 'C-02', to: 'C-01', type: 'Love laced with the first whisper of unease — his brother feels far away', valenceDelta: -0.1 },
      { from: 'C-01', to: 'C-02', type: 'A fleeting moment of something almost human — suppressed immediately', valenceDelta: 0.05 },
    ],
    summary: 'Their small house. Fang Zheng cooks — badly — while talking about his first successful Gu channeling. He wants to become strong enough to protect the whole clan, like their parents did. He asks Fang Yuan what he wants. Fang Yuan says he wants to be useful. The soup boils over. They eat in companionable silence, and for a single unguarded moment Fang Yuan watches his brother with something that might, in better light, be mistaken for grief. Then it is gone, and he asks for more soup.',
  },

  // [plot beat] Fang Yuan spots the ceremony results being politicized
  'S-014': {
    id: 'S-014',
    kind: 'scene',
    arcId: 'SC-02',
    locationId: 'L-04',
    povId: 'C-01',
    participantIds: ['C-01', 'C-03', 'C-06'],
    characterMovements: { 'C-01': 'L-04' },
    events: ['ceremony_results_debated', 'fang_zheng_as_political_asset', 'fang_yuan_watches'],
    threadMutations: [
      { threadId: 'T-04', from: 'escalating', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-01', nodeId: 'K-105', action: 'added', content: 'Mo Bei Liu is using Fang Zheng as a political wedge — the boy will become a factional pawn' },
      { characterId: 'C-03', nodeId: 'K-106', action: 'added', content: 'Mo Bei Liu openly challenged training assignments — his ambition is no longer hidden' },
      { characterId: 'C-06', nodeId: 'K-107', action: 'added', content: 'The A-grade boy is the perfect justification to redirect resources toward his faction' },
    ],
    relationshipMutations: [
      { from: 'C-06', to: 'C-03', type: 'Openly challenging the patriarch in session — respect crumbling', valenceDelta: -0.15 },
      { from: 'C-01', to: 'C-06', type: 'Mo Bei Liu moves exactly on schedule — a useful fool', valenceDelta: 0.05 },
    ],
    summary: 'Clan Hall, open session. The elders formally discuss how to invest in the new generation. Fang Zheng\'s name comes up repeatedly — Mo Bei Liu argues the A-grade talent should train under his faction\'s instructors, not the academy. Gu Yue Bo insists on tradition. The boy has become a chess piece before he has even learned to fight. Fang Yuan stands among the spectators in the back row, invisible and unhurried, watching the board arrange itself exactly as he remembers.',
  },
};

// ── Commits ──────────────────────────────────────────────────────────────────
const diffNames: Record<string, string> = {
  'S-001': 'village_dawn',
  'S-002': 'brothers_walk',
  'S-003': 'academy_lecture',
  'S-004': 'mountain_dusk',
  'S-005': 'ceremony',
  'S-006': 'celebration_aftermath',
  'S-007': 'mentorship',
  'S-008': 'night_perimeter',
  'S-009': 'political_friction',
  'S-010': 'silent_calculation',
  'S-011': 'training_yard',
  'S-012': 'tunnel_descent',
  'S-013': 'brothers_supper',
  'S-014': 'chess_piece',
};

const sceneList = Object.values(scenes);
const commits: Commit[] = sceneList.map((scene, i) => ({
  id: `CM-${String(i + 1).padStart(3, '0')}`,
  parentId: i === 0 ? null : `CM-${String(i).padStart(3, '0')}`,
  sceneId: scene.id,
  arcId: scene.arcId,
  diffName: diffNames[scene.id] ?? 'thread_surfaced',
  threadMutations: scene.threadMutations,
  knowledgeMutations: scene.knowledgeMutations,
  relationshipMutations: scene.relationshipMutations,
  authorOverride: null,
  createdAt: Date.now() - (14 - i) * 3600000,
}));

// ── Alternate Branch: "The Brother's Suspicion" ─────────────────────────────
// Diverges after S-012 — Fang Zheng notices his brother's absence and
// follows him to the tunnel entrance, glimpsing something he cannot explain.

const altArc: Arc = {
  id: 'SC-02-ALT',
  name: "The Brother's Suspicion",
  sceneIds: ['S-ALT-01', 'S-ALT-02', 'S-ALT-03'],
  develops: ['T-03'],
  locationIds: ['L-02', 'L-05'],
  activeCharacterIds: ['C-01', 'C-02'],
  initialCharacterLocations: {
    'C-01': 'L-05',
    'C-02': 'L-02',
  },
};

const altScenes: Record<string, Scene> = {
  'S-ALT-01': {
    id: 'S-ALT-01',
    kind: 'scene',
    arcId: 'SC-02-ALT',
    locationId: 'L-02',
    povId: 'C-02',
    participantIds: ['C-02'],
    events: ['empty_bed', 'fang_zheng_follows', 'midnight_village'],
    threadMutations: [{ threadId: 'T-03', from: 'dormant', to: 'active' }],
    knowledgeMutations: [
      { characterId: 'C-02', nodeId: 'K-15', action: 'added', content: 'Fang Yuan was not in his bed at midnight — followed him through the village but lost him near the old granary' },
      { characterId: 'C-02', nodeId: 'K-111', action: 'added', content: 'Fang Yuan moved through the dark village with uncanny confidence — no hesitation, no stumbling' },
    ],
    relationshipMutations: [
      { from: 'C-02', to: 'C-01', type: 'First crack — where does his brother go at night?', valenceDelta: -0.05 },
      { from: 'C-02', to: 'C-01', type: 'The C-grade boy navigated darkness like a predator — that is not mediocrity', valenceDelta: -0.15 },
    ],
    summary: 'Fang Zheng wakes to an empty room. His brother\'s bed is cold, the blanket undisturbed. He pulls on his shoes and steps into the village night, following a shape he almost recognizes through the narrow lanes. Near the old granary, Fang Yuan vanishes — not around a corner, not into a doorway, but simply gone, as though the ground swallowed him. Fang Zheng stands alone in the moonlight, breathing hard, and for the first time wonders whether the brother he pities is someone else entirely.',
  },
  'S-ALT-02': {
    id: 'S-ALT-02',
    kind: 'scene',
    arcId: 'SC-02-ALT',
    locationId: 'L-02',
    povId: 'C-02',
    participantIds: ['C-01', 'C-02'],
    events: ['morning_confrontation', 'fang_yuan_deflects', 'careful_lie'],
    threadMutations: [
      { threadId: 'T-03', from: 'active', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-02', nodeId: 'K-108', action: 'added', content: 'Fang Yuan answered too smoothly — ordinary people stumble when surprised, but he was perfectly composed' },
      { characterId: 'C-01', nodeId: 'K-109', action: 'added', content: 'Fang Zheng noticed the absence — must be more careful with nighttime movements' },
    ],
    relationshipMutations: [
      { from: 'C-02', to: 'C-01', type: 'The explanation was smooth but something felt rehearsed', valenceDelta: -0.05 },
      { from: 'C-01', to: 'C-02', type: 'The boy is more observant than expected — a variable that needs managing', valenceDelta: -0.1 },
    ],
    summary: 'Morning. Fang Zheng confronts his brother over breakfast — where were you last night? Fang Yuan looks up from his congee with mild surprise. He says he went walking, that he could not sleep. The explanation is ordinary, delivered with a self-deprecating shrug. Fang Zheng wants to believe it. Almost does. But there is a half-second delay before Fang Yuan answers, a practiced quality to his confusion, and the small cold seed of doubt does not dissolve. It roots.',
  },
  'S-ALT-03': {
    id: 'S-ALT-03',
    kind: 'scene',
    arcId: 'SC-02-ALT',
    locationId: 'L-02',
    povId: 'C-02',
    participantIds: ['C-02'],
    events: ['fang_zheng_investigates_granary', 'stone_slab_noticed', 'retreats'],
    threadMutations: [
      { threadId: 'T-03', from: 'escalating', to: 'escalating' },
      { threadId: 'T-01', from: 'escalating', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-02', nodeId: 'K-17', action: 'added', content: 'Found a loose stone slab behind the old granary — too heavy to move, but the dust around it has been disturbed recently' },
      { characterId: 'C-02', nodeId: 'K-110', action: 'added', content: 'Something is hidden beneath the granary — and his brother knows about it' },
    ],
    relationshipMutations: [
      { from: 'C-02', to: 'C-01', type: 'The brother he thought he knew is keeping dangerous secrets', valenceDelta: -0.2 },
    ],
    summary: 'Afternoon, while Fang Yuan is at the academy. Fang Zheng returns to the old granary alone. The building leans and creaks, abandoned since the harvest blight three years ago. Behind it, half-hidden by weeds, he finds a stone slab set into the earth. It is too heavy for him to lift, but the dust around its edges has been swept clean by recent movement. He stares at it for a long time. He does not tell anyone. He is not sure why.',
  },
};

// Merge alt scenes and arc into the main records
// ── Initial World Building Commit ────────────────────────────────────────────
const wxInitCommit: WorldBuildCommit = {
  kind: 'world_build',
  id: 'WX-init',
  summary: 'World created: 8 characters (Fang Yuan, Fang Zheng, Gu Yue Bo, Bai Ning Bing, Shen Cui, Mo Bei Liu, Chi Shan, Tie Ruo Nan), 8 locations (Qing Mao Mountain, Gu Yue Village, Academy, Clan Hall, Secret Tunnels, Bai Clan Territory, Mountain Wilderness, Flower Wine Monk\'s Inheritance Ground), 7 threads, 10 relationships',
  expansionManifest: {
    characterIds: Object.keys(characters),
    locationIds: Object.keys(locations),
    threadIds: Object.keys(threads),
    relationshipCount: relationships.length,
  },
};

const allScenes: Record<string, Scene> = { ...scenes, ...altScenes };
const allWorldBuilds: Record<string, WorldBuildCommit> = { 'WX-init': wxInitCommit };
const allArcs: Record<string, Arc> = { ...arcs, [altArc.id]: altArc };

// ── Branches ────────────────────────────────────────────────────────────────
const branches: Record<string, Branch> = {
  'B-MAIN': {
    id: 'B-MAIN',
    name: 'Canon Timeline',
    parentBranchId: null,
    forkEntryId: null,
    entryIds: ['WX-init', ...Object.keys(scenes)],
    createdAt: Date.now() - 86400000,
  },
  'B-SUSPICION': {
    id: 'B-SUSPICION',
    name: "The Brother's Suspicion",
    parentBranchId: 'B-MAIN',
    forkEntryId: 'S-012',
    entryIds: Object.keys(altScenes),
    createdAt: Date.now() - 43200000,
  },
};

// ── Assembled Narrative ──────────────────────────────────────────────────────
export const seedNarrative: NarrativeState = {
  id: 'N-RI',
  title: 'Reverend Insanity — Rebirth of the Demon Venerable',
  description: 'Fang Yuan, a 500-year-old demonic cultivator, has been reborn into his 15-year-old body via the Spring Autumn Cicada. Armed with complete knowledge of the future, he hides behind mediocrity while pursuing the only goal that matters: eternal life. The mountain clans around him see a dull boy. They do not see the predator.',
  characters,
  locations,
  threads,
  arcs: allArcs,
  scenes: allScenes,
  worldBuilds: allWorldBuilds,
  branches,
  commits,
  relationships,
  worldSummary: 'Qing Mao Mountain is home to three rival Gu Master clans living in uneasy balance. Gu — living organisms that grant supernatural powers — are cultivated, refined, and fought over. Fang Yuan has been reborn 500 years into his past using the legendary Spring Autumn Cicada. He now inhabits his 15-year-old body within the Gu Yue clan, armed with complete knowledge of the future. His goal is absolute: attain eternal life. Everyone else — brother, clan, rivals — is either a tool or an obstacle. The mountain does not know what walks among it.',
  rules: [
    'Fang Yuan is ruthlessly pragmatic — he does not act out of sentiment, only calculated self-interest',
    'Gu are living organisms, not spells — they must be fed, refined, and can die or be stolen',
    'A Gu Master can only have one vital Gu in their aperture at a time per rank',
    'Fang Yuan has 500 years of future knowledge but his current body is Rank 1 with limited primeval essence',
    'The three clans of Qing Mao Mountain maintain a fragile power balance — open war risks mutual destruction',
    'Rebirth is Fang Yuan\'s deepest secret — if revealed, every power in the world would hunt him',
  ],
  controlMode: 'auto',
  imageStyle: 'Dark Chinese xianxia ink-wash painting with digital colour, sharp angular compositions, crimson and black accents, venomous insects and jade-green Gu energy, cold ruthless atmosphere',
  activeForces: { payoff: 0, change: 0, variety: 0 },
  coverImageUrl: '/covers/ri.jpg',
  createdAt: Date.now() - 86400000,
  updatedAt: Date.now(),
};
