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
  'C-SW-01': {
    id: 'C-SW-01',
    name: 'Luke Skywalker',
    role: 'anchor',
    threadIds: ['T-SW-01', 'T-SW-05', 'T-SW-02'],
    knowledge: {
      nodes: [
        { id: 'K-SW-01', type: 'knows', content: 'Raised by Uncle Owen and Aunt Beru on a moisture farm on Tatooine' },
        { id: 'K-SW-02', type: 'believes', content: 'His father was a navigator on a spice freighter who died before Luke was born' },
        { id: 'K-SW-03', type: 'goal', content: 'Escape Tatooine and find purpose among the stars' },
        { id: 'K-SW-04', type: 'knows', content: 'Is a skilled pilot and can bullseye womp rats in his T-16 back home' },
        { id: 'K-SW-05', type: 'believes', content: 'The Empire is a distant evil — something that happens to other people, not moisture farmers' },
      ],
      edges: [
        { from: 'K-SW-01', to: 'K-SW-03', type: 'contradicts' },
        { from: 'K-SW-02', to: 'K-SW-03', type: 'supports' },
        { from: 'K-SW-04', to: 'K-SW-03', type: 'enables' },
        { from: 'K-SW-05', to: 'K-SW-03', type: 'contradicts' },
      ],
    },
  },
  'C-SW-02': {
    id: 'C-SW-02',
    name: 'Princess Leia Organa',
    role: 'anchor',
    threadIds: ['T-SW-06', 'T-SW-02'],
    knowledge: {
      nodes: [
        { id: 'K-SW-10', type: 'knows', content: 'Senator of Alderaan and secret leader within the Rebel Alliance' },
        { id: 'K-SW-11', type: 'secret', content: 'Carries the stolen Death Star technical readouts in R2-D2' },
        { id: 'K-SW-12', type: 'goal', content: 'Deliver the plans to the Rebellion and find a weakness in the Death Star' },
        { id: 'K-SW-13', type: 'believes', content: 'The galaxy will not survive under Imperial rule — the fight is worth any cost' },
        { id: 'K-SW-14', type: 'knows', content: 'Obi-Wan Kenobi served her father in the Clone Wars and may be the Rebellions last hope' },
      ],
      edges: [
        { from: 'K-SW-10', to: 'K-SW-12', type: 'enables' },
        { from: 'K-SW-11', to: 'K-SW-12', type: 'enables' },
        { from: 'K-SW-13', to: 'K-SW-12', type: 'supports' },
        { from: 'K-SW-14', to: 'K-SW-12', type: 'supports' },
      ],
    },
  },
  'C-SW-03': {
    id: 'C-SW-03',
    name: 'Han Solo',
    role: 'recurring',
    threadIds: ['T-SW-04'],
    knowledge: {
      nodes: [
        { id: 'K-SW-20', type: 'knows', content: 'Smuggler and captain of the Millennium Falcon, fastest ship in the galaxy' },
        { id: 'K-SW-21', type: 'knows', content: 'Owes Jabba the Hutt a dangerous amount of credits — a debt measured in blaster bolts' },
        { id: 'K-SW-22', type: 'goal', content: 'Pay off Jabba and keep flying free — loyalty is a luxury he cannot afford' },
        { id: 'K-SW-23', type: 'believes', content: 'Hokey religions and ancient weapons are no match for a good blaster at your side' },
      ],
      edges: [
        { from: 'K-SW-20', to: 'K-SW-22', type: 'enables' },
        { from: 'K-SW-21', to: 'K-SW-22', type: 'contradicts' },
        { from: 'K-SW-23', to: 'K-SW-22', type: 'supports' },
      ],
    },
  },
  'C-SW-04': {
    id: 'C-SW-04',
    name: 'Darth Vader',
    role: 'recurring',
    threadIds: ['T-SW-03', 'T-SW-07'],
    knowledge: {
      nodes: [
        { id: 'K-SW-30', type: 'knows', content: 'Dark Lord of the Sith and enforcer of the Emperors will across the galaxy' },
        { id: 'K-SW-31', type: 'secret', content: 'Was once Anakin Skywalker — Jedi Knight, husband, father — before the fall' },
        { id: 'K-SW-32', type: 'goal', content: 'Recover the stolen Death Star plans and crush the Rebel Alliance' },
        { id: 'K-SW-33', type: 'knows', content: 'Senses a tremor in the Force — something familiar stirring at the edge of perception' },
        { id: 'K-SW-34', type: 'believes', content: 'The dark side is the only path to true power — the Jedi were weak and deserved their end' },
      ],
      edges: [
        { from: 'K-SW-30', to: 'K-SW-32', type: 'enables' },
        { from: 'K-SW-31', to: 'K-SW-33', type: 'supports' },
        { from: 'K-SW-33', to: 'K-SW-32', type: 'contradicts' },
        { from: 'K-SW-34', to: 'K-SW-32', type: 'supports' },
      ],
    },
  },
  'C-SW-05': {
    id: 'C-SW-05',
    name: 'Obi-Wan Kenobi',
    role: 'recurring',
    threadIds: ['T-SW-03', 'T-SW-05'],
    knowledge: {
      nodes: [
        { id: 'K-SW-40', type: 'knows', content: 'Last of the old Jedi, living in exile on Tatooine as a hermit called Ben' },
        { id: 'K-SW-41', type: 'secret', content: 'Has watched over Luke Skywalker since birth — the son of Anakin, the boy who must not fall' },
        { id: 'K-SW-42', type: 'goal', content: 'When the time comes, guide Luke to the Force and finish what the Jedi could not' },
        { id: 'K-SW-43', type: 'knows', content: 'Darth Vader is Anakin Skywalker — his greatest failure, his deepest wound' },
        { id: 'K-SW-44', type: 'believes', content: 'The Force will balance itself — but it needs a vessel, and Luke is that vessel' },
      ],
      edges: [
        { from: 'K-SW-40', to: 'K-SW-42', type: 'enables' },
        { from: 'K-SW-41', to: 'K-SW-42', type: 'enables' },
        { from: 'K-SW-43', to: 'K-SW-42', type: 'supports' },
        { from: 'K-SW-44', to: 'K-SW-42', type: 'supports' },
      ],
    },
  },
  'C-SW-06': {
    id: 'C-SW-06',
    name: 'R2-D2',
    role: 'transient',
    threadIds: ['T-SW-02'],
    knowledge: {
      nodes: [
        { id: 'K-SW-50', type: 'knows', content: 'Carries the complete technical readouts of the Death Star in his memory banks' },
        { id: 'K-SW-51', type: 'goal', content: 'Deliver Princess Leias message and the plans to Obi-Wan Kenobi on Tatooine' },
        { id: 'K-SW-52', type: 'knows', content: 'Has served the Skywalker family across two generations — more loyal than any organic being' },
      ],
      edges: [
        { from: 'K-SW-50', to: 'K-SW-51', type: 'enables' },
        { from: 'K-SW-52', to: 'K-SW-51', type: 'supports' },
      ],
    },
  },
  'C-SW-07': {
    id: 'C-SW-07',
    name: 'Grand Moff Tarkin',
    role: 'transient',
    threadIds: ['T-SW-07'],
    knowledge: {
      nodes: [
        { id: 'K-SW-60', type: 'knows', content: 'Commander of the Death Star — the most powerful weapon ever constructed' },
        { id: 'K-SW-61', type: 'goal', content: 'Use the Death Star to rule through fear — the Tarkin Doctrine made real' },
        { id: 'K-SW-62', type: 'believes', content: 'Fear will keep the local systems in line — fear of this battle station' },
        { id: 'K-SW-63', type: 'knows', content: 'The Rebel Alliance is an irritant, not a threat — insects beneath an iron heel' },
      ],
      edges: [
        { from: 'K-SW-60', to: 'K-SW-61', type: 'enables' },
        { from: 'K-SW-62', to: 'K-SW-61', type: 'supports' },
        { from: 'K-SW-63', to: 'K-SW-61', type: 'supports' },
      ],
    },
  },
  'C-SW-08': {
    id: 'C-SW-08',
    name: 'Chewbacca',
    role: 'transient',
    threadIds: ['T-SW-04'],
    knowledge: {
      nodes: [
        { id: 'K-SW-70', type: 'knows', content: 'Wookiee co-pilot of the Millennium Falcon and Han Solos life-debt partner' },
        { id: 'K-SW-71', type: 'goal', content: 'Stand beside Han Solo in all things — the life-debt is absolute and freely given' },
        { id: 'K-SW-72', type: 'believes', content: 'Loyalty is not a transaction but a way of being — Han saved his life, and that is enough forever' },
      ],
      edges: [
        { from: 'K-SW-70', to: 'K-SW-71', type: 'enables' },
        { from: 'K-SW-72', to: 'K-SW-71', type: 'supports' },
      ],
    },
  },
};

// ── Locations ────────────────────────────────────────────────────────────────
const locations: Record<string, Location> = {
  'L-SW-01': {
    id: 'L-SW-01', name: 'The Galaxy', parentId: null, threadIds: [],
    knowledge: {
      nodes: [
        { id: 'LK-SW-01', type: 'lore', content: 'A galaxy ruled by the Galactic Empire — a thousand star systems held by fear and force' },
        { id: 'LK-SW-02', type: 'lore', content: 'The Jedi Order has been destroyed, its knights hunted to extinction by the Sith' },
      ],
      edges: [{ from: 'LK-SW-01', to: 'LK-SW-02', type: 'supports' }],
    },
  },
  'L-SW-02': {
    id: 'L-SW-02', name: 'Tatooine', parentId: 'L-SW-01', threadIds: ['T-SW-01', 'T-SW-05'],
    knowledge: {
      nodes: [
        { id: 'LK-SW-03', type: 'lore', content: 'A desert world orbiting twin suns — remote, lawless, and forgotten by the Empire' },
        { id: 'LK-SW-04', type: 'lore', content: 'Ruled by Hutt crime lords, populated by moisture farmers, Jawas, and Tusken Raiders' },
      ],
      edges: [{ from: 'LK-SW-03', to: 'LK-SW-04', type: 'supports' }],
    },
  },
  'L-SW-03': {
    id: 'L-SW-03', name: 'The Death Star', parentId: 'L-SW-01', threadIds: ['T-SW-07', 'T-SW-03'],
    knowledge: {
      nodes: [
        { id: 'LK-SW-05', type: 'lore', content: 'A moon-sized battle station capable of destroying entire planets with a single blast' },
        { id: 'LK-SW-06', type: 'secret', content: 'Contains a thermal exhaust port leading directly to the main reactor — a fatal design flaw' },
        { id: 'LK-SW-07', type: 'danger', content: 'Defended by turbolaser batteries, TIE fighter squadrons, and an entire Imperial garrison' },
      ],
      edges: [
        { from: 'LK-SW-05', to: 'LK-SW-07', type: 'supports' },
        { from: 'LK-SW-06', to: 'LK-SW-05', type: 'contradicts' },
      ],
    },
  },
  'L-SW-04': {
    id: 'L-SW-04', name: 'Mos Eisley', parentId: 'L-SW-02', threadIds: ['T-SW-04'],
    knowledge: {
      nodes: [
        { id: 'LK-SW-08', type: 'lore', content: 'A wretched hive of scum and villainy — the spaceport where the desperate come to disappear' },
        { id: 'LK-SW-09', type: 'lore', content: 'Home to smugglers, bounty hunters, and beings of every species seeking passage off-world' },
      ],
      edges: [{ from: 'LK-SW-08', to: 'LK-SW-09', type: 'supports' }],
    },
  },
  'L-SW-05': {
    id: 'L-SW-05', name: 'Alderaan System', parentId: 'L-SW-01', threadIds: ['T-SW-06'],
    knowledge: {
      nodes: [
        { id: 'LK-SW-10', type: 'lore', content: 'Home system of the peaceful planet Alderaan — a world of beauty, culture, and quiet defiance' },
        { id: 'LK-SW-11', type: 'danger', content: 'Alderaan will be destroyed by the Death Star as a demonstration of Imperial power' },
      ],
      edges: [{ from: 'LK-SW-10', to: 'LK-SW-11', type: 'contradicts' }],
    },
  },
  'L-SW-06': {
    id: 'L-SW-06', name: 'Yavin IV', parentId: 'L-SW-01', threadIds: ['T-SW-02', 'T-SW-06'],
    knowledge: {
      nodes: [
        { id: 'LK-SW-12', type: 'secret', content: 'Hidden Rebel Alliance base within an ancient Massassi temple on a jungle moon' },
        { id: 'LK-SW-13', type: 'danger', content: 'If discovered, the Death Star will reduce the moon and the Rebellion to dust' },
      ],
      edges: [{ from: 'LK-SW-12', to: 'LK-SW-13', type: 'supports' }],
    },
  },
  'L-SW-07': {
    id: 'L-SW-07', name: 'The Tantive IV', parentId: 'L-SW-01', threadIds: ['T-SW-02'],
    knowledge: {
      nodes: [
        { id: 'LK-SW-14', type: 'lore', content: 'Alderaanian consular ship — Princess Leias diplomatic vessel and secret Rebel courier' },
        { id: 'LK-SW-15', type: 'danger', content: 'Captured by an Imperial Star Destroyer above Tatooine while carrying stolen plans' },
      ],
      edges: [{ from: 'LK-SW-14', to: 'LK-SW-15', type: 'contradicts' }],
    },
  },
  'L-SW-08': {
    id: 'L-SW-08', name: 'Lars Homestead', parentId: 'L-SW-02', threadIds: ['T-SW-01'],
    knowledge: {
      nodes: [
        { id: 'LK-SW-16', type: 'lore', content: 'A moisture farm on the outskirts of Tatooines Jundland Wastes — Lukes entire world' },
        { id: 'LK-SW-17', type: 'lore', content: 'Run by Owen and Beru Lars, who have kept Luke safe and ignorant of his true heritage' },
      ],
      edges: [{ from: 'LK-SW-16', to: 'LK-SW-17', type: 'supports' }],
    },
  },
};

// ── Threads ──────────────────────────────────────────────────────────────────
const threads: Record<string, Thread> = {
  'T-SW-01': {
    id: 'T-SW-01',
    anchors: [{ id: 'C-SW-01', type: 'character' }],
    description: "Luke's journey from farm boy to hero — the call that pulls him from sand and silence into the stars",
    status: 'dormant',
    openedAt: 'S-SW-001',
    dependents: ['T-SW-05'],
  },
  'T-SW-02': {
    id: 'T-SW-02',
    anchors: [{ id: 'C-SW-06', type: 'character' }, { id: 'C-SW-02', type: 'character' }],
    description: 'The stolen Death Star plans — a sliver of data that carries the hope of an entire galaxy',
    status: 'dormant',
    openedAt: 'S-SW-001',
    dependents: ['T-SW-07'],
  },
  'T-SW-03': {
    id: 'T-SW-03',
    anchors: [{ id: 'C-SW-05', type: 'character' }, { id: 'C-SW-04', type: 'character' }],
    description: "Obi-Wan's unfinished business with Vader — master and apprentice, bound by betrayal and a lightsaber that cut both ways",
    status: 'dormant',
    openedAt: 'S-SW-003',
    dependents: [],
  },
  'T-SW-04': {
    id: 'T-SW-04',
    anchors: [{ id: 'C-SW-03', type: 'character' }],
    description: "Han Solo's arc from mercenary to ally — the smuggler who insists he does not care, protesting too much",
    status: 'dormant',
    openedAt: 'S-SW-005',
    dependents: [],
  },
  'T-SW-05': {
    id: 'T-SW-05',
    anchors: [{ id: 'C-SW-01', type: 'character' }, { id: 'C-SW-05', type: 'character' }],
    description: "The Force awakening in Luke — an ancient power stirring in the blood of a boy who does not yet know what he is",
    status: 'dormant',
    openedAt: 'S-SW-003',
    dependents: ['T-SW-03'],
  },
  'T-SW-06': {
    id: 'T-SW-06',
    anchors: [{ id: 'C-SW-02', type: 'character' }, { id: 'L-SW-06', type: 'location' }],
    description: "Leia and the Rebellion's desperate fight — a princess who refuses to break and the cause she would die for",
    status: 'dormant',
    openedAt: 'S-SW-001',
    dependents: [],
  },
  'T-SW-07': {
    id: 'T-SW-07',
    anchors: [{ id: 'L-SW-03', type: 'location' }, { id: 'C-SW-07', type: 'character' }],
    description: 'The Death Star — ultimate weapon and ultimate vulnerability, a monument to Imperial hubris with a fatal flaw at its heart',
    status: 'dormant',
    openedAt: 'S-SW-002',
    dependents: [],
  },
};

// ── Relationships ────────────────────────────────────────────────────────────
const relationships: RelationshipEdge[] = [
  { from: 'C-SW-01', to: 'C-SW-05', type: 'Sees a mysterious old hermit who knew his father — yearns for the truth he senses Ben is withholding', valence: 0.5 },
  { from: 'C-SW-05', to: 'C-SW-01', type: 'Watches Anakins son with hope and dread in equal measure — this boy must not fall as his father did', valence: 0.7 },
  { from: 'C-SW-01', to: 'C-SW-02', type: 'Stunned by the holographic princess — she is everything Tatooine is not', valence: 0.4 },
  { from: 'C-SW-02', to: 'C-SW-01', type: 'A farm boy playing hero — but his eyes carry something earnest she has not seen in the Rebellion', valence: 0.3 },
  { from: 'C-SW-03', to: 'C-SW-01', type: 'Sees a naive kid who will get himself killed — a paying passenger, nothing more', valence: -0.1 },
  { from: 'C-SW-01', to: 'C-SW-03', type: 'Admires the swagger but distrusts the selfishness — wants Han to be better than he claims', valence: 0.2 },
  { from: 'C-SW-03', to: 'C-SW-02', type: 'A princess with a sharp tongue and sharper mind — infuriating and impossible to ignore', valence: 0.2 },
  { from: 'C-SW-02', to: 'C-SW-03', type: 'A scoundrel who hides decency behind bluster — useful, unreliable, and annoyingly charming', valence: 0.1 },
  { from: 'C-SW-04', to: 'C-SW-05', type: 'Senses Obi-Wan as a fading echo of the Jedi he once was — contempt mingled with something he refuses to name', valence: -0.6 },
  { from: 'C-SW-05', to: 'C-SW-04', type: 'Grieves for the man Anakin was, even as he steels himself to face what Anakin became', valence: -0.3 },
  { from: 'C-SW-04', to: 'C-SW-07', type: 'Tolerates Tarkins arrogance because the Emperor wills it — the Force is beyond his comprehension', valence: -0.2 },
  { from: 'C-SW-07', to: 'C-SW-04', type: 'Sees Vader as a useful weapon on a leash — sorcery subordinate to political power', valence: -0.1 },
  { from: 'C-SW-03', to: 'C-SW-08', type: 'Partner, co-pilot, conscience — the one being in the galaxy Han trusts without calculation', valence: 0.8 },
  { from: 'C-SW-08', to: 'C-SW-03', type: 'Bound by a life-debt that became something deeper — Han is family in the truest Wookiee sense', valence: 0.9 },
];

// ── Arcs ─────────────────────────────────────────────────────────────────────
const arcs: Record<string, Arc> = {
  'SC-SW-01': {
    id: 'SC-SW-01',
    name: 'The Call',
    sceneIds: ['S-SW-001', 'S-SW-002', 'S-SW-003', 'S-SW-004', 'S-SW-005'],
    develops: ['T-SW-01', 'T-SW-02', 'T-SW-05'],
    locationIds: ['L-SW-01', 'L-SW-02', 'L-SW-07', 'L-SW-08', 'L-SW-04'],
    activeCharacterIds: ['C-SW-01', 'C-SW-02', 'C-SW-04', 'C-SW-05', 'C-SW-06', 'C-SW-03', 'C-SW-08'],
    initialCharacterLocations: {
      'C-SW-01': 'L-SW-08',
      'C-SW-02': 'L-SW-07',
      'C-SW-04': 'L-SW-07',
      'C-SW-05': 'L-SW-02',
      'C-SW-06': 'L-SW-07',
      'C-SW-03': 'L-SW-04',
      'C-SW-08': 'L-SW-04',
    },
  },
  'SC-SW-02': {
    id: 'SC-SW-02',
    name: 'Into the Darkness',
    sceneIds: ['S-SW-006', 'S-SW-007', 'S-SW-008', 'S-SW-009', 'S-SW-010'],
    develops: ['T-SW-07', 'T-SW-06', 'T-SW-03'],
    locationIds: ['L-SW-01', 'L-SW-03', 'L-SW-05'],
    activeCharacterIds: ['C-SW-01', 'C-SW-02', 'C-SW-03', 'C-SW-04', 'C-SW-05', 'C-SW-07', 'C-SW-08'],
    initialCharacterLocations: {
      'C-SW-01': 'L-SW-03',
      'C-SW-02': 'L-SW-03',
      'C-SW-03': 'L-SW-03',
      'C-SW-04': 'L-SW-03',
      'C-SW-05': 'L-SW-03',
      'C-SW-07': 'L-SW-03',
      'C-SW-08': 'L-SW-03',
    },
  },
  'SC-SW-03': {
    id: 'SC-SW-03',
    name: 'The Battle of Yavin',
    sceneIds: ['S-SW-011', 'S-SW-012', 'S-SW-013', 'S-SW-014', 'S-SW-015'],
    develops: ['T-SW-04', 'T-SW-01', 'T-SW-07'],
    locationIds: ['L-SW-01', 'L-SW-06', 'L-SW-03'],
    activeCharacterIds: ['C-SW-01', 'C-SW-02', 'C-SW-03', 'C-SW-04', 'C-SW-07', 'C-SW-08'],
    initialCharacterLocations: {
      'C-SW-01': 'L-SW-06',
      'C-SW-02': 'L-SW-06',
      'C-SW-03': 'L-SW-06',
      'C-SW-04': 'L-SW-03',
      'C-SW-07': 'L-SW-03',
      'C-SW-08': 'L-SW-06',
    },
  },
};

// ── Scenes ───────────────────────────────────────────────────────────────────
const scenes: Record<string, Scene> = {
  // ── Arc 1: The Call ───────────────────────────────────────────────────────
  'S-SW-001': {
    id: 'S-SW-001',
    kind: 'scene',
    arcId: 'SC-SW-01',
    locationId: 'L-SW-07',
    participantIds: ['C-SW-02', 'C-SW-04', 'C-SW-06'],
    events: ['tantive_iv_captured', 'leia_hides_plans', 'vader_boards'],
    threadMutations: [
      { threadId: 'T-SW-02', from: 'dormant', to: 'surfacing' },
      { threadId: 'T-SW-06', from: 'dormant', to: 'surfacing' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-04', nodeId: 'K-SW-35', action: 'added', content: 'The Rebel ship was intercepted above Tatooine — the plans were transmitted before capture' },
    ],
    relationshipMutations: [],
    stakes: 25,
    prose: '',
    summary: 'Above Tatooine, an Imperial Star Destroyer swallows the Tantive IV whole. Stormtroopers blast through the corridors. Princess Leia, moving with the calm of someone who has rehearsed this nightmare, feeds the stolen Death Star plans into R2-D2 and records a desperate holographic plea. Darth Vader strides through the smoke and the dead, black cape trailing like a funeral shroud. He seizes Leia. The droids jettison to the desert below, carrying everything.',
  },
  'S-SW-002': {
    id: 'S-SW-002',
    kind: 'scene',
    arcId: 'SC-SW-01',
    locationId: 'L-SW-08',
    participantIds: ['C-SW-01', 'C-SW-06'],
    characterMovements: { 'C-SW-06': 'L-SW-08' },
    events: ['droids_arrive', 'luke_finds_message', 'restless_yearning'],
    threadMutations: [
      { threadId: 'T-SW-01', from: 'dormant', to: 'surfacing' },
      { threadId: 'T-SW-07', from: 'dormant', to: 'surfacing' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-06', action: 'added', content: 'A holographic woman inside the astromech droid pleads for someone called Obi-Wan Kenobi' },
    ],
    relationshipMutations: [],
    stakes: 30,
    prose: '',
    summary: 'Lars Homestead. Twin suns set over the moisture farm as Luke cleans the newly purchased droids. R2-D2 projects a fragment of Leias message — a flickering blue ghost of a woman he has never met, calling a name he half-recognizes. "Help me, Obi-Wan Kenobi. You are my only hope." Luke stares at the hologram the way a man dying of thirst stares at rain. Something inside him, long dormant, begins to stir.',
  },
  'S-SW-003': {
    id: 'S-SW-003',
    kind: 'scene',
    arcId: 'SC-SW-01',
    locationId: 'L-SW-02',
    participantIds: ['C-SW-01', 'C-SW-05', 'C-SW-06'],
    characterMovements: { 'C-SW-01': 'L-SW-02' },
    events: ['obi_wan_revealed', 'fathers_lightsaber', 'the_force_introduced', 'refusal_of_call'],
    threadMutations: [
      { threadId: 'T-SW-05', from: 'dormant', to: 'surfacing' },
      { threadId: 'T-SW-03', from: 'dormant', to: 'surfacing' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-07', action: 'added', content: 'Ben Kenobi is Obi-Wan Kenobi — a Jedi Knight who fought alongside his father in the Clone Wars' },
      { characterId: 'C-SW-01', nodeId: 'K-SW-08', action: 'added', content: 'His father did not die on a spice freighter — he was a Jedi, murdered by Darth Vader' },
      { characterId: 'C-SW-05', nodeId: 'K-SW-45', action: 'added', content: 'The plans are in the droid — Leia sent them here, to me, which means the hour has finally come' },
    ],
    relationshipMutations: [
      { from: 'C-SW-01', to: 'C-SW-05', type: 'Awe and confusion — this old man knew his father and carries a galaxy of secrets', valenceDelta: 0.2 },
    ],
    stakes: 40,
    prose: '',
    summary: 'The Jundland Wastes. In a hermits cave that smells of sand and solitude, Ben Kenobi unwraps the past like a burial shroud. He gives Luke his fathers lightsaber — the blade hums blue, alive after decades of silence. He speaks of the Jedi, the Force, the Clone Wars, and a pupil named Darth Vader who betrayed everything. Luke holds the weapon of a dead man and feels the universe tilt beneath his feet. Obi-Wan asks him to come to Alderaan. Luke refuses. He has a harvest to tend. The refusal tastes like ash in his mouth.',
  },
  'S-SW-004': {
    id: 'S-SW-004',
    kind: 'scene',
    arcId: 'SC-SW-01',
    locationId: 'L-SW-08',
    participantIds: ['C-SW-01'],
    characterMovements: { 'C-SW-01': 'L-SW-08' },
    events: ['homestead_destroyed', 'owen_beru_killed', 'point_of_no_return'],
    threadMutations: [
      { threadId: 'T-SW-01', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-09', action: 'added', content: 'Uncle Owen and Aunt Beru are dead — burned by Imperial stormtroopers hunting the droids. There is nothing left here.' },
    ],
    relationshipMutations: [],
    stakes: 50,
    prose: '',
    summary: 'The Lars Homestead, burning. Luke arrives to find smoke where his life used to be. The blackened skeletons of Owen and Beru lie in the doorway of the only home he has known. Stormtroopers traced the droids here, and the Empire does not leave witnesses. Luke stands among the ashes, and something inside him — the boy who wanted to stay, the nephew who owed a harvest — dies with them. He returns to Obi-Wan with scorched eyes and a single sentence: "I want to come with you to Alderaan. I want to learn the ways of the Force and become a Jedi like my father."',
  },
  'S-SW-005': {
    id: 'S-SW-005',
    kind: 'scene',
    arcId: 'SC-SW-01',
    locationId: 'L-SW-04',
    participantIds: ['C-SW-01', 'C-SW-05', 'C-SW-03', 'C-SW-08'],
    characterMovements: { 'C-SW-01': 'L-SW-04', 'C-SW-05': 'L-SW-04' },
    events: ['mos_eisley_cantina', 'han_solo_introduction', 'deal_struck', 'imperial_pursuit'],
    threadMutations: [
      { threadId: 'T-SW-04', from: 'dormant', to: 'surfacing' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-03', nodeId: 'K-SW-24', action: 'added', content: 'An old man and a kid want passage to Alderaan — no questions asked, paying above market rate. Smells like trouble, pays like salvation.' },
      { characterId: 'C-SW-01', nodeId: 'K-SW-06B', action: 'added', content: 'Han Solo is a smuggler with a fast ship and no loyalty to anything but credits — exactly the kind of man they need' },
    ],
    relationshipMutations: [
      { from: 'C-SW-03', to: 'C-SW-01', type: 'A wide-eyed farm boy in over his head — the galaxy will eat him alive', valenceDelta: -0.1 },
      { from: 'C-SW-03', to: 'C-SW-05', type: 'An old fossil in a robe — but something about him makes the hair stand up', valenceDelta: 0.1 },
    ],
    stakes: 55,
    prose: '',
    summary: 'Mos Eisley Cantina. A den of smoke, alien jazz, and casual violence. Obi-Wan navigates the crowd with the ease of a man who has seen worse. Luke stares at everything. In the back booth, Han Solo — boots on the table, blaster under the table — listens to their offer with the practiced skepticism of a man who trusts only money. Seventeen thousand. Han grins. Chewbacca growls agreement. The deal is struck over spilled drinks and a dead bounty hunter on the floor. They flee the port under Imperial fire, and the Millennium Falcon punches into hyperspace with a sound like the universe tearing open.',
  },

  // ── Arc 2: Into the Darkness ─────────────────────────────────────────────
  'S-SW-006': {
    id: 'S-SW-006',
    kind: 'scene',
    arcId: 'SC-SW-02',
    locationId: 'L-SW-05',
    participantIds: ['C-SW-02', 'C-SW-04', 'C-SW-07'],
    characterMovements: { 'C-SW-02': 'L-SW-05' },
    events: ['alderaan_destroyed', 'tarkin_orders_firing', 'leia_forced_to_watch'],
    threadMutations: [
      { threadId: 'T-SW-07', from: 'surfacing', to: 'escalating' },
      { threadId: 'T-SW-06', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-02', nodeId: 'K-SW-15', action: 'added', content: 'Alderaan is gone. Two billion people — my people, my home, my father — reduced to floating debris by a single weapon.' },
      { characterId: 'C-SW-07', nodeId: 'K-SW-64', action: 'added', content: 'The demonstration was a complete success — every system in the galaxy will learn to fear this station' },
    ],
    relationshipMutations: [
      { from: 'C-SW-02', to: 'C-SW-07', type: 'Hatred beyond language — this man murdered a world to make a point', valenceDelta: -0.5 },
      { from: 'C-SW-02', to: 'C-SW-04', type: 'The monster who held her in place and made her watch her world die', valenceDelta: -0.4 },
    ],
    stakes: 60,
    prose: '',
    summary: 'The Alderaan System. Tarkin gives Leia a choice: reveal the Rebel base or watch her planet die. She lies — names Dantooine. Tarkin fires anyway. The Death Stars superlaser carves a green line across space, and Alderaan — two billion souls, ancient libraries, children sleeping in their beds — becomes an asteroid field in the time it takes to draw a breath. Leia screams. Across the galaxy, Obi-Wan staggers as if struck, feeling millions of voices cry out and then fall silent. The Empire has announced what it is. There is no going back.',
  },
  'S-SW-007': {
    id: 'S-SW-007',
    kind: 'scene',
    arcId: 'SC-SW-02',
    locationId: 'L-SW-03',
    participantIds: ['C-SW-01', 'C-SW-03', 'C-SW-05', 'C-SW-08'],
    characterMovements: { 'C-SW-01': 'L-SW-03', 'C-SW-03': 'L-SW-03', 'C-SW-05': 'L-SW-03', 'C-SW-08': 'L-SW-03' },
    events: ['falcon_captured', 'tractor_beam', 'death_star_interior', 'rescue_plan_formed'],
    threadMutations: [
      { threadId: 'T-SW-03', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-06C', action: 'added', content: 'Princess Leia is held prisoner on this battle station — the same woman from the holographic message' },
      { characterId: 'C-SW-05', nodeId: 'K-SW-46', action: 'added', content: 'The tractor beam is coupled to the main reactor in seven locations — I must disable it alone while the others rescue the princess' },
    ],
    relationshipMutations: [
      { from: 'C-SW-03', to: 'C-SW-01', type: 'The kid wants to rescue a princess from an Imperial battle station — this is how people die', valenceDelta: -0.1 },
    ],
    stakes: 65,
    prose: '',
    summary: 'The Millennium Falcon drops out of hyperspace into a debris field where Alderaan should be. Before the horror can settle, a tractor beam seizes the ship and drags it into the Death Stars hangar like a fish into a whales mouth. Hidden in smuggling compartments, they emerge into the belly of the beast. R2-D2 taps into the station network and finds Leia — detention level AA-23. Luke insists on a rescue. Han calls him insane. Obi-Wan announces he must go alone to disable the tractor beam. They split: the old Jedi into the corridors, the young fool toward the princess.',
  },
  'S-SW-008': {
    id: 'S-SW-008',
    kind: 'scene',
    arcId: 'SC-SW-02',
    locationId: 'L-SW-03',
    participantIds: ['C-SW-01', 'C-SW-02', 'C-SW-03', 'C-SW-08'],
    events: ['detention_level_rescue', 'garbage_compactor', 'leia_takes_command'],
    threadMutations: [
      { threadId: 'T-SW-04', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-02', nodeId: 'K-SW-16', action: 'added', content: 'These rescuers are brave and chaotic — the farm boy has heart, the smuggler has a ship, and neither has a plan' },
    ],
    relationshipMutations: [
      { from: 'C-SW-02', to: 'C-SW-01', type: 'Braver than he looks — there is something in this boy worth watching', valenceDelta: 0.1 },
      { from: 'C-SW-02', to: 'C-SW-03', type: 'Infuriating and reckless but he came — that counts for something', valenceDelta: 0.1 },
      { from: 'C-SW-03', to: 'C-SW-02', type: 'She grabbed the blaster and shot us an exit — this princess fights', valenceDelta: 0.2 },
    ],
    stakes: 70,
    prose: '',
    summary: 'Detention level AA-23. Luke and Han blast their way in wearing stolen stormtrooper armor that fits like a lie. They find Leia — not the damsel Luke imagined, but a commander who takes one look at her rescuers and grabs a blaster. "Somebody has to save our skins." She shoots a hole into the garbage chute. They fall. In the compactor, walls closing in, knee-deep in filth and panic, they are saved by R2-D2 and the absurd luck of the unprepared. Leia emerges cursing Han Solos plan. Han insists there was no plan. Something between them catches fire.',
  },
  'S-SW-009': {
    id: 'S-SW-009',
    kind: 'scene',
    arcId: 'SC-SW-02',
    locationId: 'L-SW-03',
    participantIds: ['C-SW-04', 'C-SW-05'],
    events: ['obi_wan_vader_duel', 'the_sacrifice', 'the_voice'],
    threadMutations: [
      { threadId: 'T-SW-03', from: 'escalating', to: 'done' },
      { threadId: 'T-SW-05', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-04', nodeId: 'K-SW-36', action: 'added', content: 'Obi-Wan vanished at the moment of death — became one with the Force. The Jedi could not do this before. Something has changed.' },
    ],
    relationshipMutations: [
      { from: 'C-SW-04', to: 'C-SW-05', type: 'Killed his old master but the victory feels hollow — Obi-Wan smiled before the blade struck', valenceDelta: -0.1 },
    ],
    stakes: 75,
    prose: '',
    summary: 'A corridor deep in the Death Star. Two lightsabers ignite — one red, one blue — and twenty years of silence end. Obi-Wan Kenobi and Darth Vader circle each other with the deliberate grace of men who know each others every move. "When I left you, I was but the learner. Now I am the master." "Only a master of evil, Darth." The duel is slow, deliberate, heavy with history. Then Obi-Wan sees Luke watching from the hangar bay. He smiles. He raises his blade. Vader strikes, and Obi-Wans robes collapse empty to the floor. Luke screams. But in the silence that follows, a voice — calm, warm, impossible — whispers: "Run, Luke. Run."',
  },
  'S-SW-010': {
    id: 'S-SW-010',
    kind: 'scene',
    arcId: 'SC-SW-02',
    locationId: 'L-SW-03',
    participantIds: ['C-SW-01', 'C-SW-02', 'C-SW-03', 'C-SW-08'],
    characterMovements: {},
    events: ['escape_death_star', 'falcon_pursued', 'tracking_device_planted', 'grief_and_resolve'],
    threadMutations: [
      { threadId: 'T-SW-02', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-06D', action: 'added', content: 'Ben is dead. Vader killed him. But I heard his voice — he is not truly gone.' },
      { characterId: 'C-SW-02', nodeId: 'K-SW-17', action: 'added', content: 'The escape was too easy — they are tracking us. They want us to lead them to the Rebel base.' },
    ],
    relationshipMutations: [
      { from: 'C-SW-01', to: 'C-SW-04', type: 'The monster who killed Ben — hatred crystallizes into purpose', valenceDelta: -0.5 },
    ],
    stakes: 80,
    prose: '',
    summary: 'The Millennium Falcon blasts free of the Death Star, Han whooping at the guns as TIE fighters peel away in flames. But Leia sits in cold silence. The escape was too easy. Tarkin is betting the entire Rebellion on their panic — a tracking device hides somewhere on the hull, and every parsec brings the Death Star closer to Yavin. Luke sits apart, wrapped in the ghost of Obi-Wans sacrifice, grief and fury braided together. Han counts his future reward. Leia counts the hours her base has left to live. The Falcon hurtles through hyperspace, carrying hope and a homing beacon in equal measure.',
  },

  // ── Arc 3: The Battle of Yavin ───────────────────────────────────────────
  'S-SW-011': {
    id: 'S-SW-011',
    kind: 'scene',
    arcId: 'SC-SW-03',
    locationId: 'L-SW-06',
    participantIds: ['C-SW-01', 'C-SW-02', 'C-SW-03', 'C-SW-08'],
    characterMovements: { 'C-SW-01': 'L-SW-06', 'C-SW-02': 'L-SW-06', 'C-SW-03': 'L-SW-06', 'C-SW-08': 'L-SW-06' },
    events: ['yavin_arrival', 'plans_analyzed', 'exhaust_port_discovered', 'han_takes_payment'],
    threadMutations: [
      { threadId: 'T-SW-02', from: 'escalating', to: 'resolved' },
      { threadId: 'T-SW-07', from: 'escalating', to: 'threatened' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-06E', action: 'added', content: 'The Death Star has a weakness — a thermal exhaust port, two meters wide, leading straight to the main reactor' },
      { characterId: 'C-SW-02', nodeId: 'K-SW-18', action: 'added', content: 'The Death Star is thirty minutes from firing range — this is the only chance the Rebellion will ever get' },
    ],
    relationshipMutations: [
      { from: 'C-SW-01', to: 'C-SW-03', type: 'Disappointment hardens — Han is leaving when the galaxy needs him most', valenceDelta: -0.2 },
      { from: 'C-SW-03', to: 'C-SW-01', type: 'Guilt masked as pragmatism — the kid looks at him like he expected better', valenceDelta: 0.1 },
    ],
    stakes: 85,
    prose: '',
    summary: 'Yavin IV. The ancient Massassi temple hums with desperate activity. R2-D2 delivers the plans, and Rebel technicians find it — a thermal exhaust port, two meters wide, ray-shielded, leading to the main reactor. A shot in a million. Luke says he used to bullseye womp rats back home. The room stares at him. Meanwhile, Han loads his payment onto the Falcon. Luke confronts him: "So you got your reward and you are just leaving?" Han meets his eyes. "What good is a reward if you are not around to use it?" Chewbacca watches his partner walk away from something for the first time.',
  },
  'S-SW-012': {
    id: 'S-SW-012',
    kind: 'scene',
    arcId: 'SC-SW-03',
    locationId: 'L-SW-06',
    participantIds: ['C-SW-01', 'C-SW-02'],
    events: ['pilots_briefing', 'luke_joins_red_squadron', 'leia_watches_launch'],
    threadMutations: [],
    knowledgeMutations: [],
    relationshipMutations: [
      { from: 'C-SW-02', to: 'C-SW-01', type: 'Watches him climb into the cockpit and realizes she is afraid for him — a feeling she cannot afford', valenceDelta: 0.2 },
    ],
    stakes: 90,
    prose: '',
    summary: 'The hangar bay. X-wings stand in rows like crosses in a graveyard. Pilots receive their briefing with the hollow focus of men who know the odds. Luke climbs into his fighter — Red Five — with R2-D2 socketed behind him. Leia stands below, arms crossed against the chill of what is coming. Their eyes meet. Neither speaks. Everything that needs saying lives in the silence between two people who have known each other for hours and may never see each other again. The engines ignite. The fighters launch in formation, rising through the jungle canopy toward a battle that will end one way or another in thirty minutes.',
  },
  'S-SW-013': {
    id: 'S-SW-013',
    kind: 'scene',
    arcId: 'SC-SW-03',
    locationId: 'L-SW-03',
    participantIds: ['C-SW-01', 'C-SW-04', 'C-SW-07'],
    characterMovements: { 'C-SW-01': 'L-SW-03' },
    events: ['trench_run_begins', 'rebel_losses', 'vader_enters_battle', 'tarkin_refuses_evacuation'],
    threadMutations: [
      { threadId: 'T-SW-07', from: 'threatened', to: 'critical' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-04', nodeId: 'K-SW-37', action: 'added', content: 'The Force is strong with this one — the pilot in the lead X-wing flies like no ordinary man' },
      { characterId: 'C-SW-07', nodeId: 'K-SW-65', action: 'added', content: 'Rebel fighters are attacking but the station is impregnable — evacuate? In our moment of triumph? I think you overestimate their chances.' },
    ],
    relationshipMutations: [],
    stakes: 95,
    prose: '',
    summary: 'The Death Star surface, a landscape of metal canyons. Red and Gold squadrons scream across the hull, turbolaser fire blooming around them like lethal flowers. Pilots die in bright silence — one by one, the voices on the channel go quiet. The trench run begins. First run fails. Second run fails. Vader himself takes a TIE Advanced into the trench, picking off Rebel fighters with surgical precision. "I have you now." Tarkin watches from the command center, the Yavin moon growing larger in the viewport. He is asked to evacuate. He almost laughs. Twenty minutes to firing range.',
  },
  'S-SW-014': {
    id: 'S-SW-014',
    kind: 'scene',
    arcId: 'SC-SW-03',
    locationId: 'L-SW-03',
    participantIds: ['C-SW-01', 'C-SW-03', 'C-SW-04', 'C-SW-08'],
    events: ['final_trench_run', 'han_returns', 'use_the_force', 'the_shot'],
    threadMutations: [
      { threadId: 'T-SW-04', from: 'escalating', to: 'subverted' },
      { threadId: 'T-SW-05', from: 'escalating', to: 'threatened' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-06F', action: 'added', content: 'Bens voice spoke to me — "Use the Force, Luke." I switched off my targeting computer. I trusted the Force, and I felt it guide my hand.' },
      { characterId: 'C-SW-04', nodeId: 'K-SW-38', action: 'added', content: 'A freighter came out of nowhere and broke my attack — the boy in the X-wing escaped. The Force was with him.' },
    ],
    relationshipMutations: [
      { from: 'C-SW-01', to: 'C-SW-03', type: 'He came back — when it mattered most, Han Solo came back', valenceDelta: 0.4 },
      { from: 'C-SW-03', to: 'C-SW-01', type: 'Could not leave the kid to die — does not know what that means yet', valenceDelta: 0.3 },
    ],
    stakes: 100,
    prose: '',
    summary: 'The trench. Luke is the last pilot. Vader locks onto his X-wing, finger on the trigger. R2-D2 takes a hit and screams. Luke is alone — targeting computer active, exhaust port approaching, death behind him. Then Obi-Wans voice, from beyond death: "Use the Force, Luke." He switches off the computer. The mission controllers go silent. And from the sun comes the Millennium Falcon, guns blazing — Han Solo, howling like a man surprised by his own decency, scatters Vaders wingmen and sends the Dark Lord spinning into space. Luke breathes. The Force breathes with him. He fires. Two proton torpedoes thread the impossible gap.',
  },
  'S-SW-015': {
    id: 'S-SW-015',
    kind: 'scene',
    arcId: 'SC-SW-03',
    locationId: 'L-SW-06',
    participantIds: ['C-SW-01', 'C-SW-02', 'C-SW-03', 'C-SW-08'],
    characterMovements: { 'C-SW-01': 'L-SW-06', 'C-SW-03': 'L-SW-06' },
    events: ['death_star_destroyed', 'tarkin_dies', 'victory_celebration', 'medal_ceremony'],
    threadMutations: [
      { threadId: 'T-SW-07', from: 'critical', to: 'resolved' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-06G', action: 'added', content: 'The Death Star is destroyed. The Rebellion survives. Ben was right — the Force was with me.' },
      { characterId: 'C-SW-03', nodeId: 'K-SW-25', action: 'added', content: 'Came back for the kid. Standing in a throne room now wearing a medal. The galaxy has a strange sense of humor.' },
    ],
    relationshipMutations: [
      { from: 'C-SW-02', to: 'C-SW-01', type: 'A hero forged in fire — the farm boy became something more, and she saw it happen', valenceDelta: 0.2 },
      { from: 'C-SW-02', to: 'C-SW-03', type: 'He came back — beneath the bluster, there is someone worth believing in', valenceDelta: 0.2 },
      { from: 'C-SW-01', to: 'C-SW-05', type: 'Gone but not gone — his voice guided the impossible shot. The Force connects them still.', valenceDelta: 0.1 },
    ],
    stakes: 85,
    prose: '',
    summary: 'The Death Star dies in a bloom of white fire that lights the sky above Yavin IV like a second sun. Tarkin, who refused to evacuate, becomes atoms alongside his doctrine of fear. Vader spirals into the void, alive, diminished, furious. On the surface, the Rebellion erupts. In the ancient temple, Leia presides over a ceremony that feels like the first sunrise after an endless night. Luke and Han walk the aisle — the farm boy and the smuggler, remade by war and choice. Chewbacca roars. R2-D2, battered but whole, beeps beside them. Leia places medals around their necks, and for one shining moment the galaxy believes it might be free. The Force hums. Somewhere in the dark, Vader plots. But that is tomorrow. Today, they won.',
  },
};

// ── Commits ──────────────────────────────────────────────────────────────────
const diffNames: Record<string, string> = {
  'S-SW-001': 'tantive_iv_captured',
  'S-SW-002': 'droids_arrive',
  'S-SW-003': 'obi_wan_revealed',
  'S-SW-004': 'homestead_destroyed',
  'S-SW-005': 'mos_eisley_deal',
  'S-SW-006': 'alderaan_destroyed',
  'S-SW-007': 'falcon_captured',
  'S-SW-008': 'princess_rescued',
  'S-SW-009': 'kenobi_sacrifice',
  'S-SW-010': 'death_star_escape',
  'S-SW-011': 'plans_analyzed',
  'S-SW-012': 'fighters_launch',
  'S-SW-013': 'trench_run_begins',
  'S-SW-014': 'the_impossible_shot',
  'S-SW-015': 'death_star_destroyed',
};

const sceneList = Object.values(scenes);
const commits: Commit[] = sceneList.map((scene, i) => ({
  id: `CM-SW-${String(i + 1).padStart(3, '0')}`,
  parentId: i === 0 ? null : `CM-SW-${String(i).padStart(3, '0')}`,
  sceneId: scene.id,
  arcId: scene.arcId,
  diffName: diffNames[scene.id] ?? 'thread_surfaced',
  threadMutations: scene.threadMutations,
  knowledgeMutations: scene.knowledgeMutations,
  relationshipMutations: scene.relationshipMutations,
  authorOverride: null,
  createdAt: Date.now() - (15 - i) * 3600000,
}));

// ── Alternate Branch: "What if Obi-Wan Survived the Death Star" ─────────────
// Diverges after S-SW-010 — Obi-Wan escapes the Death Star alive, and his
// continued presence fundamentally alters Luke's path and the final battle.

const altArc: Arc = {
  id: 'SC-SW-03-ALT',
  name: 'The Living Master',
  sceneIds: ['S-SW-ALT-011', 'S-SW-ALT-012', 'S-SW-ALT-013', 'S-SW-ALT-014', 'S-SW-ALT-015'],
  develops: ['T-SW-03', 'T-SW-05', 'T-SW-01'],
  locationIds: ['L-SW-01', 'L-SW-03', 'L-SW-06'],
  activeCharacterIds: ['C-SW-01', 'C-SW-02', 'C-SW-03', 'C-SW-04', 'C-SW-05', 'C-SW-07', 'C-SW-08'],
  initialCharacterLocations: {
    'C-SW-01': 'L-SW-06',
    'C-SW-02': 'L-SW-06',
    'C-SW-03': 'L-SW-06',
    'C-SW-05': 'L-SW-06',
    'C-SW-04': 'L-SW-03',
    'C-SW-07': 'L-SW-03',
    'C-SW-08': 'L-SW-06',
  },
};

const altScenes: Record<string, Scene> = {
  'S-SW-ALT-011': {
    id: 'S-SW-ALT-011',
    kind: 'scene',
    arcId: 'SC-SW-03-ALT',
    locationId: 'L-SW-06',
    participantIds: ['C-SW-01', 'C-SW-05'],
    characterMovements: { 'C-SW-01': 'L-SW-06', 'C-SW-05': 'L-SW-06' },
    events: ['obi_wan_survived', 'training_begins', 'force_lesson'],
    threadMutations: [{ threadId: 'T-SW-05', from: 'escalating', to: 'threatened' }],
    knowledgeMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-06H', action: 'added', content: 'Ben survived the duel — he feinted death to draw Vader away and escaped in the chaos of our departure' },
      { characterId: 'C-SW-05', nodeId: 'K-SW-47', action: 'added', content: 'I chose to live. The Force told me my work is not done — Luke needs more than a ghost. He needs a teacher.' },
    ],
    relationshipMutations: [
      { from: 'C-SW-01', to: 'C-SW-05', type: 'Overwhelming relief and deepened trust — the master he thought he lost is still here', valenceDelta: 0.3 },
    ],
    stakes: 80,
    prose: '',
    summary: 'Yavin IV. In the shadow of the Massassi temple, Obi-Wan Kenobi lives. He did not raise his saber and accept death — instead, at the last moment, he feinted dissolution, using a Force illusion to mask his escape through a maintenance shaft while Vader struck empty robes. The deception cost him dearly; he moves like a man carrying a wound in the Force itself. But he is alive, and Luke kneels before him with tears cutting lines through the grime on his face. "I thought I lost you." Obi-Wan places a hand on the boys shoulder. "Not yet, young one. The Force is not finished with either of us."',
  },
  'S-SW-ALT-012': {
    id: 'S-SW-ALT-012',
    kind: 'scene',
    arcId: 'SC-SW-03-ALT',
    locationId: 'L-SW-06',
    participantIds: ['C-SW-01', 'C-SW-02', 'C-SW-05'],
    events: ['plans_analyzed_alt', 'obi_wan_senses_flaw', 'force_guided_strategy'],
    threadMutations: [
      { threadId: 'T-SW-02', from: 'escalating', to: 'resolved' },
      { threadId: 'T-SW-07', from: 'escalating', to: 'threatened' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-05', nodeId: 'K-SW-48', action: 'added', content: 'The exhaust port is not merely a design flaw — the Force whispers that it was placed there deliberately, by someone inside the Empire who wanted this weapon to die' },
    ],
    relationshipMutations: [
      { from: 'C-SW-02', to: 'C-SW-05', type: 'His insight changes everything — with a living Jedi guiding strategy, the odds shift', valenceDelta: 0.3 },
    ],
    stakes: 85,
    prose: '',
    summary: 'The war room. Rebel commanders study the Death Star plans with the grim focus of surgeons before an operation. Obi-Wan stands at the holographic display, eyes half-closed, reaching through the Force into the stations blueprints. His hand stops over the thermal exhaust port. "This was not an accident," he murmurs. "Someone built this weakness into the station. Someone wanted it found." The room falls silent. With a living Jedi Master advising the assault, the plan evolves — not just a desperate trench run, but a coordinated strike guided by the Force itself. Leia watches the old man with something she has not felt since Alderaan died: genuine hope.',
  },
  'S-SW-ALT-013': {
    id: 'S-SW-ALT-013',
    kind: 'scene',
    arcId: 'SC-SW-03-ALT',
    locationId: 'L-SW-06',
    participantIds: ['C-SW-01', 'C-SW-03', 'C-SW-05', 'C-SW-08'],
    events: ['departure_tension', 'obi_wan_and_han', 'han_challenged', 'deeper_call'],
    threadMutations: [
      { threadId: 'T-SW-04', from: 'escalating', to: 'threatened' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-03', nodeId: 'K-SW-26', action: 'added', content: 'The old man looked at me like he could see every deal, every dodge, every time I ran. He said: "You are more afraid of what you might become than of dying." He was right.' },
    ],
    relationshipMutations: [
      { from: 'C-SW-03', to: 'C-SW-05', type: 'The old Jedi sees through him in a way that is both infuriating and clarifying', valenceDelta: 0.2 },
      { from: 'C-SW-03', to: 'C-SW-01', type: 'Cannot leave the kid — not because of money, but because of something he cannot name', valenceDelta: 0.2 },
    ],
    stakes: 90,
    prose: '',
    summary: 'The hangar. Han loads the last of his payment as pilots mount their fighters. Obi-Wan approaches him — not with judgment, but with the quiet clarity of a man who has watched better men make the same choice. "You are running," Obi-Wan says. "I know the look. I wore it once, years ago, when I chose exile over fighting." Han stiffens. "I am not running. I am being smart." "Those are the same thing, Captain Solo, when the galaxy is on fire." Han says nothing. Chewbacca growls low — the sound a Wookiee makes when his partner is lying to himself. Han throws the last crate onto the Falcon and does not leave.',
  },
  'S-SW-ALT-014': {
    id: 'S-SW-ALT-014',
    kind: 'scene',
    arcId: 'SC-SW-03-ALT',
    locationId: 'L-SW-03',
    participantIds: ['C-SW-01', 'C-SW-03', 'C-SW-04', 'C-SW-05', 'C-SW-07', 'C-SW-08'],
    characterMovements: { 'C-SW-01': 'L-SW-03', 'C-SW-03': 'L-SW-03', 'C-SW-05': 'L-SW-03', 'C-SW-08': 'L-SW-03' },
    events: ['battle_of_yavin_alt', 'obi_wan_force_guidance', 'vader_senses_kenobi', 'coordinated_assault'],
    threadMutations: [
      { threadId: 'T-SW-03', from: 'escalating', to: 'threatened' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-04', nodeId: 'K-SW-39', action: 'added', content: 'Obi-Wan is alive — I feel him in the Force, guiding the Rebel pilots. He tricked me. The rage is blinding.' },
      { characterId: 'C-SW-05', nodeId: 'K-SW-49', action: 'added', content: 'I can feel Anakin through the battle — his anger, his confusion. There is still conflict in him. I was wrong to think him entirely lost.' },
    ],
    relationshipMutations: [
      { from: 'C-SW-04', to: 'C-SW-05', type: 'Fury at the deception — Obi-Wan cheated death and cheated him of closure', valenceDelta: -0.3 },
      { from: 'C-SW-05', to: 'C-SW-04', type: 'Senses the conflict in Vader more clearly now — Anakin is still in there, buried deep', valenceDelta: 0.2 },
    ],
    stakes: 98,
    prose: '',
    summary: 'The Battle of Yavin, transformed. Obi-Wan sits cross-legged in the Falcon, deep in meditation, projecting Force guidance to every Rebel pilot — a living network of prescience. Fighters dodge fire they should not have seen coming. Trench runners last seconds longer than they should. Vader senses Obi-Wan alive and his rage cracks the focus of the Imperial defense. Han flies the Falcon as Obi-Wan directs, not as a last-minute savior but as a planned element of the assault. In his X-wing, Luke feels the Force not as a whisper from beyond death but as a living connection to his master, warm and immediate. "Trust yourself, Luke. The Force flows through you — let it aim true." Luke closes his eyes. He does not need the targeting computer. He never did.',
  },
  'S-SW-ALT-015': {
    id: 'S-SW-ALT-015',
    kind: 'scene',
    arcId: 'SC-SW-03-ALT',
    locationId: 'L-SW-06',
    participantIds: ['C-SW-01', 'C-SW-02', 'C-SW-03', 'C-SW-05', 'C-SW-08'],
    characterMovements: { 'C-SW-01': 'L-SW-06', 'C-SW-03': 'L-SW-06', 'C-SW-05': 'L-SW-06', 'C-SW-08': 'L-SW-06' },
    events: ['death_star_destroyed_alt', 'victory_with_master', 'obi_wan_burden', 'new_path_opens'],
    threadMutations: [
      { threadId: 'T-SW-07', from: 'threatened', to: 'resolved' },
      { threadId: 'T-SW-04', from: 'threatened', to: 'subverted' },
    ],
    knowledgeMutations: [
      { characterId: 'C-SW-05', nodeId: 'K-SW-4A', action: 'added', content: 'I survived, and Luke destroyed the Death Star with my guidance. But I have changed the balance — Vader knows I live, and he will come for me. I have given Luke a teacher and painted a target on us both.' },
      { characterId: 'C-SW-01', nodeId: 'K-SW-06I', action: 'added', content: 'The Death Star is destroyed and Ben stands beside me. I have a master, a path, and the Force. Everything is different now.' },
    ],
    relationshipMutations: [
      { from: 'C-SW-01', to: 'C-SW-05', type: 'Master and apprentice in truth now — the bond deepens with every shared breath of the Force', valenceDelta: 0.2 },
      { from: 'C-SW-05', to: 'C-SW-01', type: 'Pride and fear — Luke learns fast, but Vader will hunt them both now', valenceDelta: 0.1 },
      { from: 'C-SW-02', to: 'C-SW-05', type: 'A Jedi Master fighting for the Rebellion — the war has changed and so have the odds', valenceDelta: 0.2 },
    ],
    stakes: 80,
    prose: '',
    summary: 'The Death Star dies the same way — proton torpedoes, impossible shot, fire that remakes the sky. But this time, when Luke lands his X-wing on Yavin IV, Obi-Wan Kenobi is standing on the tarmac, leaning on a support strut, exhausted from channeling the Force through an entire battle. Luke runs to him. They embrace — master and student, the old Jedi and the young pilot, a chain of tradition that the Empire failed to break. Han stands with Chewbacca, medals around their necks, and for once does not make a joke. Leia watches the Jedi with new calculations behind her eyes: a living Jedi Master changes everything — for the war, for Luke, and for the enemies who will now hunt them with redoubled fury. The story fractures here: in the canon timeline, Obi-Wan became a guiding ghost, and Luke walked the path alone. In this one, the master lives, the apprentice has a hand to hold, and Vader burns with a rage that will reshape the war. Whether the living teacher proves salvation or catalyst for catastrophe will define everything that follows.',
  },
};

// ── Initial World Building Commit ────────────────────────────────────────────
const wxInitCommit: WorldBuildCommit = {
  kind: 'world_build',
  id: 'WX-SW-init',
  summary: 'World created: 8 characters (Luke Skywalker, Princess Leia Organa, Han Solo, Darth Vader, Obi-Wan Kenobi, R2-D2, Grand Moff Tarkin, Chewbacca), 8 locations (The Galaxy, Tatooine, The Death Star, Mos Eisley, Alderaan System, Yavin IV, The Tantive IV, Lars Homestead), 7 threads, 14 relationships',
  expansionManifest: {
    characterIds: Object.keys(characters),
    locationIds: Object.keys(locations),
    threadIds: Object.keys(threads),
    relationshipCount: relationships.length,
  },
};

const allScenes: Record<string, Scene> = { ...scenes, ...altScenes };
const allWorldBuilds: Record<string, WorldBuildCommit> = { 'WX-SW-init': wxInitCommit };
const allArcs: Record<string, Arc> = { ...arcs, [altArc.id]: altArc };

// ── Branches ────────────────────────────────────────────────────────────────
const branches: Record<string, Branch> = {
  'B-SW-MAIN': {
    id: 'B-SW-MAIN',
    name: 'Canon Timeline',
    parentBranchId: null,
    forkEntryId: null,
    entryIds: ['WX-SW-init', ...Object.keys(scenes)],
    createdAt: Date.now() - 86400000,
  },
  'B-SW-KENOBI-LIVES': {
    id: 'B-SW-KENOBI-LIVES',
    name: 'What if Obi-Wan Survived the Death Star',
    parentBranchId: 'B-SW-MAIN',
    forkEntryId: 'S-SW-010',
    entryIds: Object.keys(altScenes),
    createdAt: Date.now() - 43200000,
  },
};

// ── Assembled Narrative ──────────────────────────────────────────────────────
export const seedSW: NarrativeState = {
  id: 'N-SW',
  title: 'Star Wars — A New Hope',
  description: 'A farm boy on a desert world discovers a message from a princess, a lightsaber from a dead father, and a destiny written in the stars. Luke Skywalker is pulled from the sands of Tatooine into a galactic war between the Rebel Alliance and the Galactic Empire, guided by the last Jedi Knight, accompanied by a smuggler who insists he does not care, and hunted by a Dark Lord who was once his father. The Death Star looms over everything — a weapon that can destroy worlds, and the flaw at its heart that might save them.',
  characters,
  locations,
  threads,
  arcs: allArcs,
  scenes: allScenes,
  worldBuilds: allWorldBuilds,
  branches,
  commits,
  relationships,
  worldSummary: 'A long time ago in a galaxy far, far away, the Galactic Empire rules through fear, the Jedi Order lies in ashes, and a Rebellion flickers at the edge of extinction. On the desert planet Tatooine, a farm boy named Luke Skywalker tends moisture vaporators beneath twin suns, unaware that he is the son of the most feared man in the galaxy. A stolen set of technical plans — the blueprints of the Death Star, a moon-sized weapon of planetary annihilation — sets everything in motion. The plans pass from a captive princess to a loyal droid to a restless boy to an exiled Jedi, drawing them all into the same current. The Force stirs. A lightsaber ignites after decades of silence. A smuggler takes a job he should have refused. And above it all, the Death Star orbits, patient and absolute, waiting to demonstrate that hope is a luxury the Empire no longer permits.',
  controlMode: 'auto',
  activeForces: { stakes: 0, pacing: 0, variety: 0 },
  coverImageUrl: '/covers/sw.jpg',
  createdAt: Date.now() - 86400000,
  updatedAt: Date.now(),
};
