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
    knowledge: {
      nodes: [
        { id: 'LK-05', type: 'lore', content: 'Where clan youths are tested and trained in basic Gu cultivation' },
      ],
      edges: [],
    },
  },
  'L-04': {
    id: 'L-04', name: 'Clan Hall', parentId: 'L-02', threadIds: ['T-04'],
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
    openedAt: 'S-004',
    dependents: [],
  },
  'T-04': {
    id: 'T-04',
    anchors: [{ id: 'L-04', type: 'location' }, { id: 'C-03', type: 'character' }, { id: 'C-06', type: 'character' }],
    description: "Clan politics — Mo Bei Liu's faction against Gu Yue Bo's loyalists, the Gu Yue clan fracturing from within",
    status: 'dormant',
    openedAt: 'S-002',
    dependents: [],
  },
  'T-05': {
    id: 'T-05',
    anchors: [{ id: 'C-04', type: 'character' }],
    description: "Bai Ning Bing's curse — the Northern Dark Ice Soul physique, a ticking clock toward death before age 20",
    status: 'dormant',
    openedAt: 'S-011',
    dependents: [],
  },
  'T-06': {
    id: 'T-06',
    anchors: [{ id: 'L-08', type: 'location' }, { id: 'L-07', type: 'location' }],
    description: "The Flower Wine Monk's inheritance ground — hidden power buried beneath Qing Mao Mountain",
    status: 'dormant',
    openedAt: 'S-010',
    dependents: ['T-01'],
  },
  'T-07': {
    id: 'T-07',
    anchors: [{ id: 'C-08', type: 'character' }],
    description: "Tie Ruo Nan's investigation — the righteous path hunting demonic cultivator traces near the mountain",
    status: 'dormant',
    openedAt: 'S-015',
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
    sceneIds: ['S-001', 'S-002', 'S-003', 'S-004', 'S-005'],
    develops: ['T-02', 'T-04'],
    locationIds: ['L-01', 'L-02', 'L-03', 'L-04'],
    activeCharacterIds: ['C-01', 'C-02', 'C-03', 'C-05', 'C-06'],
    initialCharacterLocations: {
      'C-01': 'L-03',
      'C-02': 'L-03',
      'C-03': 'L-04',
      'C-05': 'L-03',
      'C-06': 'L-04',
    },
  },
  'SC-02': {
    id: 'SC-02',
    name: 'Undercurrents',
    sceneIds: ['S-006', 'S-007', 'S-008', 'S-009', 'S-010'],
    develops: ['T-04', 'T-01'],
    locationIds: ['L-01', 'L-02', 'L-05', 'L-07'],
    activeCharacterIds: ['C-01', 'C-02', 'C-03', 'C-06', 'C-07'],
    initialCharacterLocations: {
      'C-01': 'L-05',
      'C-02': 'L-02',
      'C-03': 'L-02',
      'C-06': 'L-02',
      'C-07': 'L-07',
    },
  },
  'SC-03': {
    id: 'SC-03',
    name: 'The Cracking Ice',
    sceneIds: ['S-011', 'S-012', 'S-013', 'S-014', 'S-015'],
    develops: ['T-05', 'T-06'],
    locationIds: ['L-01', 'L-06', 'L-07', 'L-08'],
    activeCharacterIds: ['C-01', 'C-02', 'C-04', 'C-07', 'C-08'],
    initialCharacterLocations: {
      'C-01': 'L-07',
      'C-02': 'L-01',
      'C-04': 'L-06',
      'C-07': 'L-07',
      'C-08': 'L-01',
    },
  },
};

// ── Scenes ───────────────────────────────────────────────────────────────────
const scenes: Record<string, Scene> = {
  // ── Arc 1: The Awakening ────────────────────────────────────────────────
  'S-001': {
    id: 'S-001',
    kind: 'scene',
    arcId: 'SC-01',
    locationId: 'L-03',
    participantIds: ['C-01', 'C-02', 'C-05'],
    events: ['academy_morning', 'fang_yuan_suppresses_knowledge', 'shen_cui_notes_mediocrity'],
    threadMutations: [{ threadId: 'T-02', from: 'dormant', to: 'surfacing' }],
    knowledgeMutations: [],
    relationshipMutations: [],
    forceSnapshot: { pressure: 0.15, momentum: 0.20, flux: 0.10 },
    prose: '',
    summary: 'Academy morning. Fang Yuan sits among fifteen-year-olds, suppressing 500 years of knowledge behind dull eyes. Shen Cui lectures on basic Gu refinement — knowledge Fang Yuan mastered centuries ago. Fang Zheng answers eagerly. Shen Cui notes the contrast between the brothers with unconcealed pity.',
  },
  'S-002': {
    id: 'S-002',
    kind: 'scene',
    arcId: 'SC-01',
    locationId: 'L-04',
    participantIds: ['C-01', 'C-03', 'C-06'],
    characterMovements: { 'C-01': 'L-04' },
    events: ['clan_hall_politics', 'mo_bei_liu_challenges', 'fang_yuan_observes'],
    threadMutations: [{ threadId: 'T-04', from: 'dormant', to: 'surfacing' }],
    knowledgeMutations: [],
    relationshipMutations: [{ from: 'C-06', to: 'C-03', type: 'Resentment deepens as Bo blocks his resource proposal', valenceDelta: -0.1 }],
    forceSnapshot: { pressure: 0.20, momentum: 0.25, flux: 0.10 },
    prose: '',
    summary: 'Clan Hall. Mo Bei Liu challenges Gu Yue Bo over resource allocation for the upcoming awakening ceremony, calling the budget wasteful. The elders take sides. Fang Yuan watches from the margins — he already knows how this political struggle ends. He catalogues every ally and every weakness, unseen.',
  },
  'S-003': {
    id: 'S-003',
    kind: 'scene',
    arcId: 'SC-01',
    locationId: 'L-03',
    participantIds: ['C-01', 'C-02', 'C-03', 'C-05'],
    events: ['awakening_ceremony', 'fang_zheng_excels', 'fang_yuan_conceals'],
    threadMutations: [
      { threadId: 'T-02', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-05', nodeId: 'K-43', action: 'added', content: 'Fang Zheng awakened A-grade talent — the clans brightest hope in a decade' },
      { characterId: 'C-03', nodeId: 'K-24', action: 'added', content: 'Fang Zheng is a generational talent who must be cultivated carefully' },
    ],
    relationshipMutations: [
      { from: 'C-05', to: 'C-02', type: 'Awe at A-grade talent — this boy could carry the clan', valenceDelta: 0.2 },
      { from: 'C-03', to: 'C-01', type: 'C-grade result confirms the boy is beneath notice', valenceDelta: -0.1 },
    ],
    forceSnapshot: { pressure: 0.28, momentum: 0.35, flux: 0.12 },
    prose: '',
    summary: 'The Awakening Ceremony. Before the entire clan, each youth places their hand on the vital Gu. Fang Zheng glows with A-grade light — the hall erupts. Fang Yuan deliberately dampens his own response, receiving a C-grade result. The clan leader nods with polite disinterest. Shen Cui looks away. Only Fang Yuan knows the truth: he could have shattered the measurement stone.',
  },
  'S-004': {
    id: 'S-004',
    kind: 'scene',
    arcId: 'SC-01',
    locationId: 'L-02',
    participantIds: ['C-01', 'C-02'],
    characterMovements: { 'C-01': 'L-02', 'C-02': 'L-02' },
    events: ['fang_zheng_celebrated', 'fang_yuan_pitied', 'secret_cultivation_begins'],
    threadMutations: [{ threadId: 'T-03', from: 'dormant', to: 'dormant' }],
    knowledgeMutations: [],
    relationshipMutations: [{ from: 'C-02', to: 'C-01', type: 'Guilt strengthens protective instinct toward his struggling brother', valenceDelta: 0.1 }],
    forceSnapshot: { pressure: 0.30, momentum: 0.38, flux: 0.13 },
    prose: '',
    summary: 'Aftermath. The village celebrates Fang Zheng. Neighbors congratulate him, elders promise resources. Fang Yuan receives pitying glances and hollow condolences. Fang Zheng, guilty, tries to comfort his brother. Fang Yuan smiles and tells him to work hard. Once alone, his expression empties completely. He slips into the night.',
  },
  'S-005': {
    id: 'S-005',
    kind: 'scene',
    arcId: 'SC-01',
    locationId: 'L-05',
    participantIds: ['C-01'],
    characterMovements: { 'C-01': 'L-05' },
    events: ['secret_tunnel_entry', 'past_life_knowledge_exploited', 'hidden_cultivation'],
    threadMutations: [{ threadId: 'T-01', from: 'dormant', to: 'dormant' }],
    knowledgeMutations: [
      { characterId: 'C-01', nodeId: 'K-10A', action: 'added', content: 'Located the hidden primeval stone cache in the tunnels, exactly where he remembered' },
    ],
    relationshipMutations: [],
    forceSnapshot: { pressure: 0.35, momentum: 0.45, flux: 0.15 },
    prose: '',
    summary: 'Deep night. Fang Yuan enters the secret tunnels beneath Gu Yue Village — tunnels no one alive knows exist, except a man who lived 500 years. He navigates by memory, avoiding traps he set in another lifetime. He finds the hidden primeval stone cache. His real cultivation begins here, in the dark, where no one can see what he truly is.',
  },

  // ── Arc 2: Undercurrents ────────────────────────────────────────────────
  'S-006': {
    id: 'S-006',
    kind: 'scene',
    arcId: 'SC-02',
    locationId: 'L-05',
    participantIds: ['C-01'],
    events: ['rare_gu_discovery', 'accelerated_cultivation', 'future_knowledge_advantage'],
    threadMutations: [{ threadId: 'T-01', from: 'dormant', to: 'surfacing' }],
    knowledgeMutations: [
      { characterId: 'C-01', nodeId: 'K-10B', action: 'added', content: 'Captured and refined the Liquor Worm Gu — a rare cultivation accelerant hidden in the tunnels' },
    ],
    relationshipMutations: [],
    forceSnapshot: { pressure: 0.38, momentum: 0.42, flux: 0.16 },
    prose: '',
    summary: 'In the secret tunnels, Fang Yuan locates the Liquor Worm Gu exactly where his future knowledge placed it. A rare Gu that accelerates primeval essence recovery. He captures it with techniques no C-grade student should know. His cultivation leaps forward in the dark while above, his brother trains openly under the suns praise.',
  },
  'S-007': {
    id: 'S-007',
    kind: 'scene',
    arcId: 'SC-02',
    locationId: 'L-04',
    participantIds: ['C-03', 'C-06'],
    events: ['public_accusation', 'clan_fracture', 'political_crisis'],
    threadMutations: [{ threadId: 'T-04', from: 'surfacing', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-03', nodeId: 'K-25', action: 'added', content: 'Mo Bei Liu has enough elder support to force a formal vote of no confidence' },
    ],
    relationshipMutations: [
      { from: 'C-03', to: 'C-06', type: 'Now certain Mo Bei Liu is actively undermining his leadership', valenceDelta: -0.2 },
      { from: 'C-06', to: 'C-03', type: 'Open contempt — sees Bo as an obstacle to be removed', valenceDelta: -0.2 },
    ],
    forceSnapshot: { pressure: 0.45, momentum: 0.38, flux: 0.20 },
    prose: '',
    summary: 'Clan Hall erupts. Mo Bei Liu makes his move — publicly accusing Gu Yue Bo of mismanaging resources and weakening the clan through inaction. Half the elders stand with him. Gu Yue Bo keeps his composure, but the fracture is visible. The Gu Yue clan, already the weakest of the three mountain clans, is splitting from within.',
  },
  'S-008': {
    id: 'S-008',
    kind: 'scene',
    arcId: 'SC-02',
    locationId: 'L-07',
    participantIds: ['C-01', 'C-07'],
    characterMovements: { 'C-01': 'L-07' },
    events: ['wilderness_hunt', 'chi_shan_encounter', 'tense_standoff'],
    threadMutations: [],
    knowledgeMutations: [
      { characterId: 'C-07', nodeId: 'K-63', action: 'added', content: 'A young Gu Yue student is hunting alone in the wilderness — unusual and suspicious' },
    ],
    relationshipMutations: [],
    forceSnapshot: { pressure: 0.48, momentum: 0.36, flux: 0.28 },
    prose: '',
    summary: 'Mountain Wilderness. Fang Yuan ventures beyond clan territory to hunt wild Gu, appearing to be a reckless student. He encounters Chi Shan — a wandering Gu Master with hard eyes and careful movements. Neither reveals their true purpose. They share a fire in silence, each calculating whether the other needs to die. Not yet, both conclude. Not yet.',
  },
  'S-009': {
    id: 'S-009',
    kind: 'scene',
    arcId: 'SC-02',
    locationId: 'L-02',
    participantIds: ['C-02'],
    events: ['empty_bed', 'first_suspicion', 'brother_searching'],
    threadMutations: [{ threadId: 'T-03', from: 'dormant', to: 'surfacing' }],
    knowledgeMutations: [
      { characterId: 'C-02', nodeId: 'K-15', action: 'added', content: 'Fang Yuan was not in his bed at midnight — where does he go at night?' },
    ],
    relationshipMutations: [{ from: 'C-02', to: 'C-01', type: 'First crack — where does his brother go at night?', valenceDelta: -0.05 }],
    forceSnapshot: { pressure: 0.50, momentum: 0.34, flux: 0.30 },
    prose: '',
    summary: 'Late night. Fang Zheng comes to share his training breakthrough with his brother. The room is empty. The bed is cold. He waits, but Fang Yuan does not return until dawn. A small seed: where does his mediocre brother go in the dead of night? For the first time, Fang Zheng looks at Fang Yuan and does not understand what he sees.',
  },
  'S-010': {
    id: 'S-010',
    kind: 'scene',
    arcId: 'SC-02',
    locationId: 'L-07',
    participantIds: ['C-01', 'C-07'],
    characterMovements: { 'C-01': 'L-07' },
    events: ['inheritance_markings_found', 'fang_yuan_concealed_observation', 'chi_shan_excited'],
    threadMutations: [{ threadId: 'T-06', from: 'dormant', to: 'surfacing' }],
    knowledgeMutations: [
      { characterId: 'C-07', nodeId: 'K-64', action: 'added', content: 'Discovered carved symbols on cliff face matching records of the Flower Wine Monks inheritance' },
    ],
    relationshipMutations: [],
    forceSnapshot: { pressure: 0.55, momentum: 0.35, flux: 0.35 },
    prose: '',
    summary: 'Mountain Wilderness. Chi Shan discovers ancient carvings on a cliff face — the markers of the Flower Wine Monks inheritance ground. His hands shake with excitement. He does not see Fang Yuan watching from the treeline above, expression perfectly still. Fang Yuan already knows every trap, every room, every treasure inside. He needs only a tool to spring the locks. Chi Shan will serve.',
  },

  // ── Arc 3: The Cracking Ice ─────────────────────────────────────────────
  'S-011': {
    id: 'S-011',
    kind: 'scene',
    arcId: 'SC-03',
    locationId: 'L-06',
    participantIds: ['C-04'],
    events: ['curse_worsens', 'desperate_decision', 'bai_territory_revealed'],
    threadMutations: [{ threadId: 'T-05', from: 'dormant', to: 'surfacing' }],
    knowledgeMutations: [
      { characterId: 'C-04', nodeId: 'K-34', action: 'added', content: 'The curse has accelerated — estimated six months remaining, not two years' },
    ],
    relationshipMutations: [],
    forceSnapshot: { pressure: 0.60, momentum: 0.40, flux: 0.40 },
    prose: '',
    summary: 'Bai Clan Territory, shown for the first time. Ice crystallizes on the walls of Bai Ning Bings chamber unbidden — her body is losing the war against the Northern Dark Ice Soul. The clan healers give her six months. She dismisses them with a look that could freeze blood. In the silence after, she makes her decision: she will leave the clan and find power by any means necessary. The ice on the walls cracks.',
  },
  'S-012': {
    id: 'S-012',
    kind: 'scene',
    arcId: 'SC-03',
    locationId: 'L-07',
    participantIds: ['C-01', 'C-07'],
    events: ['convergence_on_entrance', 'uneasy_alliance', 'inheritance_approach'],
    threadMutations: [{ threadId: 'T-06', from: 'surfacing', to: 'escalating' }],
    knowledgeMutations: [],
    relationshipMutations: [],
    forceSnapshot: { pressure: 0.65, momentum: 0.55, flux: 0.45 },
    prose: '',
    summary: 'Mountain Wilderness. Fang Yuan manufactures a second encounter with Chi Shan at the inheritance entrance. He plays the wide-eyed student — stumbled upon this by accident, what are these strange markings? Chi Shan, needing someone to test traps, agrees to bring him along. The alliance is sealed with false smiles. Both plan to betray the other. Only one has 500 years of practice at it.',
  },
  'S-013': {
    id: 'S-013',
    kind: 'scene',
    arcId: 'SC-03',
    locationId: 'L-08',
    participantIds: ['C-01', 'C-07'],
    characterMovements: { 'C-01': 'L-08', 'C-07': 'L-08' },
    events: ['inheritance_entered', 'ancient_traps', 'past_life_advantage', 'chi_shan_suspicious'],
    threadMutations: [],
    knowledgeMutations: [
      { characterId: 'C-07', nodeId: 'K-65', action: 'added', content: 'The boy navigated three traps without hesitation — he knows this place, but how?' },
    ],
    relationshipMutations: [],
    forceSnapshot: { pressure: 0.72, momentum: 0.65, flux: 0.50 },
    prose: '',
    summary: 'Inside the Flower Wine Monks inheritance ground. Ancient formations glow. Poisoned darts, illusion arrays, collapsing floors — Fang Yuan navigates each one a half-step too quickly. Chi Shan watches with growing unease. A fifteen-year-old C-grade student should not move through a Rank 4 inheritance ground like he built it. The suspicion crystallizes, but by then they are too deep to turn back.',
  },
  'S-014': {
    id: 'S-014',
    kind: 'scene',
    arcId: 'SC-03',
    locationId: 'L-08',
    participantIds: ['C-01', 'C-04', 'C-07'],
    characterMovements: { 'C-04': 'L-08' },
    events: ['inheritance_claimed', 'chi_shan_killed', 'first_ruthlessness', 'bai_ning_bing_arrives'],
    threadMutations: [
      { threadId: 'T-06', from: 'escalating', to: 'threatened' },
      { threadId: 'T-05', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-04', nodeId: 'K-35', action: 'added', content: 'Witnessed a boy kill a Rank 3 Gu Master bare-handed — this is not an ordinary person' },
    ],
    relationshipMutations: [
      { from: 'C-04', to: 'C-01', type: 'Witnessed him kill without hesitation — dangerous and unknowable', valenceDelta: -0.4 },
    ],
    forceSnapshot: { pressure: 0.80, momentum: 0.75, flux: 0.55 },
    prose: '',
    summary: 'The inheritance chamber. Fang Yuan claims the Flower Wine Monks legacy — Gu worms, techniques, primeval stones. Chi Shan moves to take it from him. Fang Yuan kills him without hesitation, without expression, without waste. His first open act of ruthlessness in this new life. As Chi Shans body cools, Bai Ning Bing steps from the shadows at the chamber entrance, drawn by the commotion. Their eyes meet. Two predators recognizing each other.',
  },
  'S-015': {
    id: 'S-015',
    kind: 'scene',
    arcId: 'SC-03',
    locationId: 'L-07',
    participantIds: ['C-02', 'C-08'],
    characterMovements: { 'C-02': 'L-07', 'C-08': 'L-07' },
    events: ['investigator_arrives', 'fang_zheng_encounter', 'demonic_traces_detected'],
    threadMutations: [{ threadId: 'T-07', from: 'dormant', to: 'surfacing' }],
    knowledgeMutations: [
      { characterId: 'C-08', nodeId: 'K-73', action: 'added', content: 'Met Fang Zheng of the Gu Yue clan — a righteous youth, potentially useful as a local contact' },
      { characterId: 'C-02', nodeId: 'K-16', action: 'added', content: 'A righteous path investigator has come to Qing Mao Mountain looking for demonic cultivators' },
    ],
    relationshipMutations: [
      { from: 'C-08', to: 'C-02', type: 'An earnest local contact — useful for her investigation', valenceDelta: 0.3 },
      { from: 'C-02', to: 'C-08', type: 'A righteous investigator who might understand his unease', valenceDelta: 0.2 },
    ],
    forceSnapshot: { pressure: 0.85, momentum: 0.80, flux: 0.60 },
    prose: '',
    summary: 'Mountain edge. Tie Ruo Nan arrives at Qing Mao Mountain, her investigator senses prickling. She encounters Fang Zheng, who is out searching for his brother again. They exchange words — she is careful, he is earnest. She does not tell him what she hunts. He does not tell her his brother disappears at night. But both truths hang in the air between them, waiting to connect.',
  },
};

// ── Commits ──────────────────────────────────────────────────────────────────
const diffNames: Record<string, string> = {
  'S-001': 'concealment',
  'S-002': 'political_friction',
  'S-003': 'ceremony',
  'S-004': 'false_pity',
  'S-005': 'secret_cultivation',
  'S-006': 'rare_gu_captured',
  'S-007': 'political_fracture',
  'S-008': 'wilderness_encounter',
  'S-009': 'brothers_doubt',
  'S-010': 'inheritance_found',
  'S-011': 'curse_accelerates',
  'S-012': 'false_alliance',
  'S-013': 'inheritance_entered',
  'S-014': 'first_kill',
  'S-015': 'investigator_arrives',
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
  forceDeltas: {
    pressure: i === 0 ? 0 : +(scene.forceSnapshot.pressure - sceneList[i - 1].forceSnapshot.pressure).toFixed(2),
    momentum: i === 0 ? 0 : +(scene.forceSnapshot.momentum - sceneList[i - 1].forceSnapshot.momentum).toFixed(2),
    flux: i === 0 ? 0 : +(scene.forceSnapshot.flux - sceneList[i - 1].forceSnapshot.flux).toFixed(2),
  },
  authorOverride: null,
  createdAt: Date.now() - (15 - i) * 3600000,
}));

// ── Alternate Branch: "The Brother's Revelation" ────────────────────────────
// Diverges after S-010 — Fang Zheng follows Fang Yuan into the wilderness
// and witnesses his true nature, fundamentally changing the story.

const altArc: Arc = {
  id: 'SC-03-ALT',
  name: "The Brother's Revelation",
  sceneIds: ['S-ALT-011', 'S-ALT-012', 'S-ALT-013', 'S-ALT-014', 'S-ALT-015'],
  develops: ['T-03', 'T-06'],
  locationIds: ['L-01', 'L-02', 'L-07', 'L-08'],
  activeCharacterIds: ['C-01', 'C-02', 'C-07'],
  initialCharacterLocations: {
    'C-01': 'L-07',
    'C-02': 'L-02',
    'C-07': 'L-07',
  },
};

const altScenes: Record<string, Scene> = {
  'S-ALT-011': {
    id: 'S-ALT-011',
    kind: 'scene',
    arcId: 'SC-03-ALT',
    locationId: 'L-02',
    participantIds: ['C-02'],
    events: ['fang_zheng_decides_to_follow', 'midnight_departure'],
    threadMutations: [{ threadId: 'T-03', from: 'surfacing', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-02', nodeId: 'K-17', action: 'added', content: 'Resolved to follow Fang Yuan the next time he disappears at night' },
    ],
    relationshipMutations: [],
    forceSnapshot: { pressure: 0.60, momentum: 0.40, flux: 0.40 },
    prose: '',
    summary: 'Fang Zheng lies awake. Three nights now his brother has vanished. Tonight he does not wait — he follows. Through silent village streets, past sleeping guards, into the darkness beyond the walls. His brother moves like a different person in the dark: precise, predatory, nothing like the dull boy the clan pities.',
  },
  'S-ALT-012': {
    id: 'S-ALT-012',
    kind: 'scene',
    arcId: 'SC-03-ALT',
    locationId: 'L-07',
    participantIds: ['C-01', 'C-02', 'C-07'],
    characterMovements: { 'C-02': 'L-07' },
    events: ['fang_zheng_witnesses_meeting', 'chi_shan_manipulation', 'truth_begins'],
    threadMutations: [{ threadId: 'T-06', from: 'surfacing', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-02', nodeId: 'K-18', action: 'added', content: 'Witnessed Fang Yuan speaking to Chi Shan as an equal — using cultivation terminology far beyond C-grade' },
    ],
    relationshipMutations: [
      { from: 'C-02', to: 'C-01', type: 'Horror dawns — his brother has been lying about everything', valenceDelta: -0.3 },
    ],
    forceSnapshot: { pressure: 0.70, momentum: 0.55, flux: 0.50 },
    prose: '',
    summary: 'Mountain Wilderness. Hidden behind rocks, Fang Zheng watches his brother meet Chi Shan. Fang Yuan speaks with authority that makes the older Gu Master defer. He discusses formations, Gu refinement paths, strategic positioning — knowledge that would take decades to acquire. Fang Zheng\'s hands tremble. This is not his brother. This has never been his brother.',
  },
  'S-ALT-013': {
    id: 'S-ALT-013',
    kind: 'scene',
    arcId: 'SC-03-ALT',
    locationId: 'L-08',
    participantIds: ['C-01', 'C-07'],
    characterMovements: { 'C-01': 'L-08', 'C-07': 'L-08' },
    events: ['inheritance_entered_alt', 'chi_shan_betrayed', 'fang_zheng_hidden_witness'],
    threadMutations: [],
    knowledgeMutations: [
      { characterId: 'C-02', nodeId: 'K-19', action: 'added', content: 'Watched Fang Yuan kill Chi Shan without hesitation — his brother is a murderer' },
    ],
    relationshipMutations: [
      { from: 'C-02', to: 'C-01', type: 'Complete shattering of the brotherly bond — Fang Yuan is a monster', valenceDelta: -0.4 },
    ],
    forceSnapshot: { pressure: 0.80, momentum: 0.70, flux: 0.55 },
    prose: '',
    summary: 'Flower Wine Monk\'s Inheritance Ground. Fang Zheng follows them inside, staying in the shadows. He watches his brother navigate ancient traps like walking through his own home. When Chi Shan reaches for the inheritance, Fang Yuan kills him — one strike, no warning, no emotion. Fang Zheng bites through his lip to keep from screaming. Blood runs down his chin in the dark.',
  },
  'S-ALT-014': {
    id: 'S-ALT-014',
    kind: 'scene',
    arcId: 'SC-03-ALT',
    locationId: 'L-08',
    participantIds: ['C-01', 'C-02'],
    events: ['confrontation', 'fang_yuan_revealed', 'impossible_choice'],
    threadMutations: [
      { threadId: 'T-03', from: 'escalating', to: 'threatened' },
      { threadId: 'T-01', from: 'surfacing', to: 'threatened' },
    ],
    knowledgeMutations: [
      { characterId: 'C-01', nodeId: 'K-10C', action: 'added', content: 'Fang Zheng has seen me kill — the mask is broken with one person who matters least and most' },
      { characterId: 'C-02', nodeId: 'K-20A', action: 'added', content: 'Fang Yuan admitted he is not who he appears to be — something about 500 years and rebirth' },
    ],
    relationshipMutations: [
      { from: 'C-01', to: 'C-02', type: 'Calculates whether his brother must die — concludes not yet', valenceDelta: -0.3 },
      { from: 'C-02', to: 'C-01', type: 'Grief and terror in equal measure — wants to save a brother who may not exist', valenceDelta: -0.2 },
    ],
    forceSnapshot: { pressure: 0.90, momentum: 0.80, flux: 0.65 },
    prose: '',
    summary: 'Fang Zheng steps from the shadows. "Brother." The word echoes in the inheritance chamber. Fang Yuan turns — for the first time in this life, genuinely surprised. A long silence. Then Fang Yuan smiles, and it is the most terrifying thing Fang Zheng has ever seen, because it is real. "You should not have come." What follows is not a fight but a conversation that rewrites everything Fang Zheng believed about family, morality, and the brother he thought he knew.',
  },
  'S-ALT-015': {
    id: 'S-ALT-015',
    kind: 'scene',
    arcId: 'SC-03-ALT',
    locationId: 'L-07',
    participantIds: ['C-01', 'C-02'],
    characterMovements: { 'C-01': 'L-07', 'C-02': 'L-07' },
    events: ['uneasy_pact', 'fang_zheng_changed', 'new_dynamic'],
    threadMutations: [{ threadId: 'T-03', from: 'threatened', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-02', nodeId: 'K-20B', action: 'added', content: 'Agreed to keep Fang Yuan\'s secret — but swore to stop him if he harms innocents' },
    ],
    relationshipMutations: [
      { from: 'C-01', to: 'C-02', type: 'A new variable — brother becomes both liability and unexpected asset', valenceDelta: 0.1 },
      { from: 'C-02', to: 'C-01', type: 'Bound by blood and terrible knowledge — cannot abandon him, cannot trust him', valenceDelta: 0.05 },
    ],
    forceSnapshot: { pressure: 0.85, momentum: 0.85, flux: 0.60 },
    prose: '',
    summary: 'Dawn breaks over the mountain. The brothers walk back in silence — a silence that contains an entire collapsed worldview. Fang Zheng has agreed to keep the secret. Fang Yuan has agreed to... nothing, really. But something has shifted. For the first time in 500 years, someone knows what Fang Yuan is and has not tried to kill him or run. The story fractures here: in the original timeline, Fang Yuan operated alone. In this one, he has a witness. Whether that witness becomes an ally or an enemy will define everything that follows.',
  },
};

// Merge alt scenes and arc into the main records
// ── Initial World Building Commit ────────────────────────────────────────────
const wxInitCommit: WorldBuildCommit = {
  kind: 'world_build',
  id: 'WX-init',
  summary: 'World created: 8 characters (Fang Yuan, Fang Zheng, Gu Yue Bo, Bai Ning Bing, Shen Cui, Mo Bei Liu, Chi Shan, Tie Ruo Nan), 8 locations (Qing Mao Mountain, Gu Yue Village, Academy, Clan Hall, Secret Tunnels, Bai Clan Territory, Mountain Wilderness, Flower Wine Monk\'s Inheritance Ground), 7 threads, 8 relationships',
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
  'B-REVELATION': {
    id: 'B-REVELATION',
    name: "The Brother's Revelation",
    parentBranchId: 'B-MAIN',
    forkEntryId: 'S-010',
    entryIds: Object.keys(altScenes),
    createdAt: Date.now() - 43200000,
  },
};

// ── Assembled Narrative ──────────────────────────────────────────────────────
export const seedNarrative: NarrativeState = {
  id: 'N-001',
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
  controlMode: 'auto',
  activeForces: { pressure: 0.85, momentum: 0.80, flux: 0.60 },
  createdAt: Date.now() - 86400000,
  updatedAt: Date.now(),
};
