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
  'C-GOT-01': {
    id: 'C-GOT-01',
    name: 'Eddard Stark',
    role: 'anchor',
    threadIds: ['T-GOT-01', 'T-GOT-02', 'T-GOT-05'],
    knowledge: {
      nodes: [
        { id: 'K-GOT-01', type: 'knows', content: 'Jon Arryn, former Hand of the King, is dead under suspicious circumstances' },
        { id: 'K-GOT-02', type: 'believes', content: 'Honor is the foundation upon which a man builds his life — without it, nothing stands' },
        { id: 'K-GOT-03', type: 'knows', content: 'Robert Baratheon has summoned him south to serve as Hand of the King' },
        { id: 'K-GOT-04', type: 'secret', content: 'Lyanna Stark extracted a promise from him on her deathbed — he has never spoken of it' },
        { id: 'K-GOT-05', type: 'goal', content: 'Discover the truth behind Jon Arryns death and protect his family' },
        { id: 'K-GOT-06', type: 'believes', content: 'Robert is still the man he fought beside during the rebellion — a good king at heart' },
        { id: 'K-GOT-07', type: 'knows', content: 'The Lannisters have grown too powerful at court and cannot be trusted' },
      ],
      edges: [
        { from: 'K-GOT-01', to: 'K-GOT-05', type: 'enables' },
        { from: 'K-GOT-02', to: 'K-GOT-05', type: 'supports' },
        { from: 'K-GOT-03', to: 'K-GOT-05', type: 'enables' },
        { from: 'K-GOT-04', to: 'K-GOT-02', type: 'contradicts' },
        { from: 'K-GOT-06', to: 'K-GOT-03', type: 'supports' },
        { from: 'K-GOT-07', to: 'K-GOT-05', type: 'supports' },
      ],
    },
  },
  'C-GOT-02': {
    id: 'C-GOT-02',
    name: 'Cersei Lannister',
    role: 'anchor',
    threadIds: ['T-GOT-01', 'T-GOT-05', 'T-GOT-06'],
    knowledge: {
      nodes: [
        { id: 'K-GOT-10', type: 'secret', content: 'Her three children — Joffrey, Myrcella, Tommen — are fathered by her twin brother Jaime, not Robert' },
        { id: 'K-GOT-11', type: 'knows', content: 'Jon Arryn was investigating the parentage of her children before he died' },
        { id: 'K-GOT-12', type: 'goal', content: 'Protect her children and the Lannister hold on the Iron Throne at any cost' },
        { id: 'K-GOT-13', type: 'believes', content: 'Power is the only currency that matters — those who do not seize it are consumed by those who do' },
        { id: 'K-GOT-14', type: 'knows', content: 'Robert despises her and drinks himself toward an early grave' },
        { id: 'K-GOT-15', type: 'believes', content: 'Ned Stark is a dangerous fool — honorable men are the most predictable and therefore the easiest to destroy' },
      ],
      edges: [
        { from: 'K-GOT-10', to: 'K-GOT-12', type: 'enables' },
        { from: 'K-GOT-11', to: 'K-GOT-12', type: 'contradicts' },
        { from: 'K-GOT-13', to: 'K-GOT-12', type: 'supports' },
        { from: 'K-GOT-14', to: 'K-GOT-10', type: 'supports' },
        { from: 'K-GOT-15', to: 'K-GOT-13', type: 'supports' },
      ],
    },
  },
  'C-GOT-03': {
    id: 'C-GOT-03',
    name: 'Tyrion Lannister',
    role: 'recurring',
    threadIds: ['T-GOT-05', 'T-GOT-07'],
    knowledge: {
      nodes: [
        { id: 'K-GOT-20', type: 'knows', content: 'His family views him as a stain on the Lannister name — only Jaime treats him with genuine affection' },
        { id: 'K-GOT-21', type: 'believes', content: 'A mind needs books like a sword needs a whetstone — intelligence is his only weapon' },
        { id: 'K-GOT-22', type: 'goal', content: 'Survive his familys contempt and prove his worth through cunning' },
        { id: 'K-GOT-23', type: 'knows', content: 'The political landscape is shifting — the Starks and Lannisters are on a collision course' },
        { id: 'K-GOT-24', type: 'believes', content: 'Never forget what you are — the rest of the world will not. Wear it like armor.' },
      ],
      edges: [
        { from: 'K-GOT-20', to: 'K-GOT-22', type: 'enables' },
        { from: 'K-GOT-21', to: 'K-GOT-22', type: 'supports' },
        { from: 'K-GOT-23', to: 'K-GOT-22', type: 'contradicts' },
        { from: 'K-GOT-24', to: 'K-GOT-21', type: 'supports' },
      ],
    },
  },
  'C-GOT-04': {
    id: 'C-GOT-04',
    name: 'Daenerys Targaryen',
    role: 'recurring',
    threadIds: ['T-GOT-03'],
    knowledge: {
      nodes: [
        { id: 'K-GOT-30', type: 'knows', content: 'She and Viserys are the last surviving Targaryens — exiled since Roberts Rebellion' },
        { id: 'K-GOT-31', type: 'believes', content: 'Her brother Viserys will do anything to reclaim the Iron Throne, including sell her' },
        { id: 'K-GOT-32', type: 'goal', content: 'Find a home — she has never known one, only running and hiding' },
        { id: 'K-GOT-33', type: 'knows', content: 'She has been wed to Khal Drogo of the Dothraki in exchange for an army' },
        { id: 'K-GOT-34', type: 'believes', content: 'She is nothing — a girl with no power, no allies, no future of her own choosing' },
      ],
      edges: [
        { from: 'K-GOT-30', to: 'K-GOT-32', type: 'enables' },
        { from: 'K-GOT-31', to: 'K-GOT-34', type: 'supports' },
        { from: 'K-GOT-33', to: 'K-GOT-32', type: 'contradicts' },
        { from: 'K-GOT-34', to: 'K-GOT-32', type: 'contradicts' },
      ],
    },
  },
  'C-GOT-05': {
    id: 'C-GOT-05',
    name: 'Jon Snow',
    role: 'recurring',
    threadIds: ['T-GOT-04'],
    knowledge: {
      nodes: [
        { id: 'K-GOT-40', type: 'knows', content: 'He is Ned Starks bastard son — or so he has been told his entire life' },
        { id: 'K-GOT-41', type: 'believes', content: 'He will never truly belong — not in Winterfell, perhaps not anywhere' },
        { id: 'K-GOT-42', type: 'goal', content: 'Find purpose and honor at the Wall by joining the Nights Watch' },
        { id: 'K-GOT-43', type: 'knows', content: 'His father has never spoken of his mother — the silence is its own kind of wound' },
        { id: 'K-GOT-44', type: 'believes', content: 'The Nights Watch is a noble calling where birth does not matter, only duty' },
      ],
      edges: [
        { from: 'K-GOT-40', to: 'K-GOT-41', type: 'enables' },
        { from: 'K-GOT-41', to: 'K-GOT-42', type: 'supports' },
        { from: 'K-GOT-43', to: 'K-GOT-41', type: 'supports' },
        { from: 'K-GOT-44', to: 'K-GOT-42', type: 'supports' },
      ],
    },
  },
  'C-GOT-06': {
    id: 'C-GOT-06',
    name: 'Petyr Baelish',
    role: 'transient',
    threadIds: ['T-GOT-05', 'T-GOT-07'],
    knowledge: {
      nodes: [
        { id: 'K-GOT-50', type: 'secret', content: 'Orchestrated Jon Arryns poisoning through Lysa Arryn — the war between Stark and Lannister is his design' },
        { id: 'K-GOT-51', type: 'goal', content: 'Climb the ladder of chaos until he stands at the very top — the Iron Throne itself' },
        { id: 'K-GOT-52', type: 'believes', content: 'Chaos is not a pit — chaos is a ladder. Only the climb is real.' },
        { id: 'K-GOT-53', type: 'knows', content: 'Ned Stark trusts him because of his childhood friendship with Catelyn — a weakness to exploit' },
      ],
      edges: [
        { from: 'K-GOT-50', to: 'K-GOT-51', type: 'enables' },
        { from: 'K-GOT-52', to: 'K-GOT-51', type: 'supports' },
        { from: 'K-GOT-53', to: 'K-GOT-51', type: 'enables' },
      ],
    },
  },
  'C-GOT-07': {
    id: 'C-GOT-07',
    name: 'Robert Baratheon',
    role: 'transient',
    threadIds: ['T-GOT-06', 'T-GOT-02'],
    knowledge: {
      nodes: [
        { id: 'K-GOT-60', type: 'knows', content: 'He won the Iron Throne by conquest but has no stomach for ruling — the crown is heavier than any warhammer' },
        { id: 'K-GOT-61', type: 'believes', content: 'Ned Stark is the only man in Westeros he trusts completely' },
        { id: 'K-GOT-62', type: 'goal', content: 'Recapture the glory of his youth — or failing that, drink enough to forget its absence' },
        { id: 'K-GOT-63', type: 'knows', content: 'The realm is six million gold dragons in debt, largely to the Lannisters' },
      ],
      edges: [
        { from: 'K-GOT-60', to: 'K-GOT-62', type: 'enables' },
        { from: 'K-GOT-61', to: 'K-GOT-62', type: 'supports' },
        { from: 'K-GOT-63', to: 'K-GOT-60', type: 'contradicts' },
      ],
    },
  },
  'C-GOT-08': {
    id: 'C-GOT-08',
    name: 'Arya Stark',
    role: 'transient',
    threadIds: ['T-GOT-02'],
    knowledge: {
      nodes: [
        { id: 'K-GOT-70', type: 'believes', content: 'She was not made to be a lady — swords and stories call to her louder than needlework ever could' },
        { id: 'K-GOT-71', type: 'goal', content: 'Learn to fight, see the world, and refuse the cage that ladyhood offers' },
        { id: 'K-GOT-72', type: 'knows', content: 'Her father is the most honorable man alive — if he cannot keep them safe, no one can' },
      ],
      edges: [
        { from: 'K-GOT-70', to: 'K-GOT-71', type: 'enables' },
        { from: 'K-GOT-72', to: 'K-GOT-71', type: 'supports' },
      ],
    },
  },
};

// ── Locations ────────────────────────────────────────────────────────────────
const locations: Record<string, Location> = {
  'L-GOT-01': {
    id: 'L-GOT-01', name: 'Westeros', parentId: null, threadIds: [],
    knowledge: {
      nodes: [
        { id: 'LK-GOT-01', type: 'lore', content: 'A vast continent divided into Seven Kingdoms, unified under the Iron Throne since Aegons Conquest three centuries past' },
        { id: 'LK-GOT-02', type: 'lore', content: 'Summer has lasted nine years — the longest in living memory — and the maesters warn that winter will be equally long' },
      ],
      edges: [{ from: 'LK-GOT-01', to: 'LK-GOT-02', type: 'supports' }],
    },
  },
  'L-GOT-02': {
    id: 'L-GOT-02', name: "King's Landing", parentId: 'L-GOT-01', threadIds: ['T-GOT-05', 'T-GOT-06'],
    knowledge: {
      nodes: [
        { id: 'LK-GOT-03', type: 'lore', content: 'Capital of the Seven Kingdoms, half a million souls crammed between the Blackwater Rush and Aegons Hill' },
        { id: 'LK-GOT-04', type: 'secret', content: 'The city stinks of shit and conspiracy in equal measure — every shadow hides a spy' },
      ],
      edges: [{ from: 'LK-GOT-04', to: 'LK-GOT-03', type: 'contradicts' }],
    },
  },
  'L-GOT-03': {
    id: 'L-GOT-03', name: 'The Red Keep', parentId: 'L-GOT-02', threadIds: ['T-GOT-01', 'T-GOT-05', 'T-GOT-07'],
    knowledge: {
      nodes: [
        { id: 'LK-GOT-05', type: 'lore', content: 'Seat of the Iron Throne — a fortress within a fortress, its walls the color of dried blood' },
        { id: 'LK-GOT-06', type: 'secret', content: 'Maegor the Cruel killed every builder who worked on the keep — its secret passages are known to very few' },
        { id: 'LK-GOT-07', type: 'secret', content: 'Varys uses the tunnel network beneath the keep to gather intelligence unseen' },
      ],
      edges: [
        { from: 'LK-GOT-06', to: 'LK-GOT-07', type: 'enables' },
        { from: 'LK-GOT-05', to: 'LK-GOT-06', type: 'supports' },
      ],
    },
  },
  'L-GOT-04': {
    id: 'L-GOT-04', name: 'Winterfell', parentId: 'L-GOT-01', threadIds: ['T-GOT-02'],
    knowledge: {
      nodes: [
        { id: 'LK-GOT-08', type: 'lore', content: 'Seat of House Stark for eight thousand years — built over natural hot springs that warm its walls even in the deepest winter' },
        { id: 'LK-GOT-09', type: 'lore', content: 'The crypts beneath Winterfell stretch deeper than anyone has explored — the dead Starks rest with iron swords across their laps' },
      ],
      edges: [{ from: 'LK-GOT-08', to: 'LK-GOT-09', type: 'supports' }],
    },
  },
  'L-GOT-05': {
    id: 'L-GOT-05', name: 'The Wall', parentId: 'L-GOT-01', threadIds: ['T-GOT-04'],
    knowledge: {
      nodes: [
        { id: 'LK-GOT-10', type: 'lore', content: 'Seven hundred feet of ice stretching from coast to coast — raised by Brandon the Builder eight millennia ago to hold back the darkness' },
        { id: 'LK-GOT-11', type: 'danger', content: 'The Nights Watch is a shadow of its former strength — fewer than a thousand men guard the entire Wall' },
      ],
      edges: [{ from: 'LK-GOT-10', to: 'LK-GOT-11', type: 'contradicts' }],
    },
  },
  'L-GOT-06': {
    id: 'L-GOT-06', name: 'The Narrow Sea', parentId: null, threadIds: ['T-GOT-03'],
    knowledge: {
      nodes: [
        { id: 'LK-GOT-12', type: 'lore', content: 'The body of water separating Westeros from Essos — crossed by traders, exiles, and would-be conquerors alike' },
      ],
      edges: [],
    },
  },
  'L-GOT-07': {
    id: 'L-GOT-07', name: 'Pentos', parentId: null, threadIds: ['T-GOT-03'],
    knowledge: {
      nodes: [
        { id: 'LK-GOT-13', type: 'lore', content: 'A Free City on the western coast of Essos — wealthy, decadent, and home to exiled Westerosi nobles and scheming magisters' },
        { id: 'LK-GOT-14', type: 'secret', content: 'Illyrio Mopatis shelters the last Targaryen heirs here, brokering alliances with the Dothraki' },
      ],
      edges: [{ from: 'LK-GOT-14', to: 'LK-GOT-13', type: 'supports' }],
    },
  },
  'L-GOT-08': {
    id: 'L-GOT-08', name: 'The Kingsroad', parentId: 'L-GOT-01', threadIds: ['T-GOT-02'],
    knowledge: {
      nodes: [
        { id: 'LK-GOT-15', type: 'lore', content: 'The great road stretching from the Wall to Kings Landing — a thousand leagues of mud, stone, and shifting allegiances' },
        { id: 'LK-GOT-16', type: 'danger', content: 'Bandits, broken men, and political enemies make the road as dangerous as any battlefield' },
      ],
      edges: [{ from: 'LK-GOT-15', to: 'LK-GOT-16', type: 'supports' }],
    },
  },
};

// ── Threads ──────────────────────────────────────────────────────────────────
const threads: Record<string, Thread> = {
  'T-GOT-01': {
    id: 'T-GOT-01',
    anchors: [{ id: 'C-GOT-01', type: 'character' }, { id: 'C-GOT-02', type: 'character' }],
    description: "The Lannister secret — Cersei's children are Jaime's, and the truth is a blade that kills everyone who touches it",
    status: 'dormant',
    openedAt: 'S-GOT-001',
    dependents: ['T-GOT-02', 'T-GOT-05'],
  },
  'T-GOT-02': {
    id: 'T-GOT-02',
    anchors: [{ id: 'C-GOT-01', type: 'character' }],
    description: "Ned's honor versus survival — a good man in a place where goodness is a death sentence",
    status: 'dormant',
    openedAt: 'S-GOT-001',
    dependents: [],
  },
  'T-GOT-03': {
    id: 'T-GOT-03',
    anchors: [{ id: 'C-GOT-04', type: 'character' }],
    description: "Daenerys's transformation — from a frightened girl sold into marriage to a queen who walks through fire",
    status: 'dormant',
    openedAt: 'S-GOT-002',
    dependents: [],
  },
  'T-GOT-04': {
    id: 'T-GOT-04',
    anchors: [{ id: 'C-GOT-05', type: 'character' }, { id: 'L-GOT-05', type: 'location' }],
    description: "Jon Snow's search for identity and belonging — a bastard seeking purpose at the edge of the world",
    status: 'dormant',
    openedAt: 'S-GOT-003',
    dependents: [],
  },
  'T-GOT-05': {
    id: 'T-GOT-05',
    anchors: [{ id: 'L-GOT-03', type: 'location' }, { id: 'C-GOT-06', type: 'character' }],
    description: "The Game of Thrones — political maneuvering in King's Landing where every alliance is a dagger waiting to turn",
    status: 'dormant',
    openedAt: 'S-GOT-004',
    dependents: ['T-GOT-01'],
  },
  'T-GOT-06': {
    id: 'T-GOT-06',
    anchors: [{ id: 'C-GOT-07', type: 'character' }],
    description: "Robert's failing kingship — a warrior king drowning in wine, debt, and the weight of a crown he never wanted",
    status: 'dormant',
    openedAt: 'S-GOT-001',
    dependents: ['T-GOT-05'],
  },
  'T-GOT-07': {
    id: 'T-GOT-07',
    anchors: [{ id: 'C-GOT-06', type: 'character' }],
    description: "Littlefinger's machinations — the spider at the center of every web, spinning chaos into a ladder only he can climb",
    status: 'dormant',
    openedAt: 'S-GOT-006',
    dependents: ['T-GOT-01', 'T-GOT-05'],
  },
};

// ── Relationships ────────────────────────────────────────────────────────────
const relationships: RelationshipEdge[] = [
  { from: 'C-GOT-01', to: 'C-GOT-07', type: 'Loves Robert as a brother forged in war, though he sees the man crumbling beneath the crown', valence: 0.7 },
  { from: 'C-GOT-07', to: 'C-GOT-01', type: 'The only man he trusts — Ned is the last clean thing in his rotting world', valence: 0.8 },
  { from: 'C-GOT-01', to: 'C-GOT-02', type: 'Distrusts the queen and her family — sees Lannister gold behind every curtain', valence: -0.5 },
  { from: 'C-GOT-02', to: 'C-GOT-01', type: 'Views the northern fool as a threat wrapped in honor — dangerous precisely because he cannot be bought', valence: -0.6 },
  { from: 'C-GOT-02', to: 'C-GOT-07', type: 'Despises the man who called another womans name on their wedding night — endures him for power alone', valence: -0.7 },
  { from: 'C-GOT-07', to: 'C-GOT-02', type: 'Indifferent bordering on contempt — she is a Lannister obligation, nothing more', valence: -0.4 },
  { from: 'C-GOT-06', to: 'C-GOT-01', type: 'Sees Ned as a pawn to be guided — his trust in Catelyn makes him pliable', valence: -0.3 },
  { from: 'C-GOT-01', to: 'C-GOT-06', type: 'Cautious trust born of Catelyns childhood friendship — a mistake he cannot yet see', valence: 0.3 },
  { from: 'C-GOT-03', to: 'C-GOT-02', type: 'Sardonic awareness of his sisters ruthlessness — she would burn the world for her children', valence: -0.2 },
  { from: 'C-GOT-02', to: 'C-GOT-03', type: 'Views her dwarf brother as the familys shame given flesh — tolerates him at best', valence: -0.5 },
  { from: 'C-GOT-01', to: 'C-GOT-05', type: 'A fathers love complicated by a secret he can never share — Jon is the weight he carries in silence', valence: 0.8 },
  { from: 'C-GOT-05', to: 'C-GOT-01', type: 'Loves his father but aches from the unanswered question — who was my mother?', valence: 0.6 },
  { from: 'C-GOT-01', to: 'C-GOT-08', type: 'Sees Lyannas fire reborn in his youngest daughter — it terrifies and delights him equally', valence: 0.7 },
  { from: 'C-GOT-08', to: 'C-GOT-01', type: 'Her father is the center of her world — the man who gave her Needle and permission to be herself', valence: 0.9 },
];

// ── Arcs ─────────────────────────────────────────────────────────────────────
const arcs: Record<string, Arc> = {
  'SC-GOT-01': {
    id: 'SC-GOT-01',
    name: 'The Wolves Descend',
    sceneIds: ['S-GOT-001', 'S-GOT-002', 'S-GOT-003', 'S-GOT-004', 'S-GOT-005'],
    develops: ['T-GOT-02', 'T-GOT-03', 'T-GOT-04'],
    locationIds: ['L-GOT-01', 'L-GOT-04', 'L-GOT-07', 'L-GOT-08', 'L-GOT-05'],
    activeCharacterIds: ['C-GOT-01', 'C-GOT-04', 'C-GOT-05', 'C-GOT-07', 'C-GOT-08'],
    initialCharacterLocations: {
      'C-GOT-01': 'L-GOT-04',
      'C-GOT-04': 'L-GOT-07',
      'C-GOT-05': 'L-GOT-04',
      'C-GOT-07': 'L-GOT-04',
      'C-GOT-08': 'L-GOT-04',
    },
  },
  'SC-GOT-02': {
    id: 'SC-GOT-02',
    name: 'The Throne of Knives',
    sceneIds: ['S-GOT-006', 'S-GOT-007', 'S-GOT-008', 'S-GOT-009', 'S-GOT-010'],
    develops: ['T-GOT-01', 'T-GOT-05', 'T-GOT-07'],
    locationIds: ['L-GOT-02', 'L-GOT-03'],
    activeCharacterIds: ['C-GOT-01', 'C-GOT-02', 'C-GOT-03', 'C-GOT-06', 'C-GOT-07'],
    initialCharacterLocations: {
      'C-GOT-01': 'L-GOT-03',
      'C-GOT-02': 'L-GOT-03',
      'C-GOT-03': 'L-GOT-02',
      'C-GOT-06': 'L-GOT-03',
      'C-GOT-07': 'L-GOT-03',
    },
  },
  'SC-GOT-03': {
    id: 'SC-GOT-03',
    name: 'The Honorable Fool',
    sceneIds: ['S-GOT-011', 'S-GOT-012', 'S-GOT-013', 'S-GOT-014', 'S-GOT-015'],
    develops: ['T-GOT-01', 'T-GOT-02', 'T-GOT-06'],
    locationIds: ['L-GOT-02', 'L-GOT-03'],
    activeCharacterIds: ['C-GOT-01', 'C-GOT-02', 'C-GOT-06', 'C-GOT-07', 'C-GOT-08'],
    initialCharacterLocations: {
      'C-GOT-01': 'L-GOT-03',
      'C-GOT-02': 'L-GOT-03',
      'C-GOT-06': 'L-GOT-03',
      'C-GOT-07': 'L-GOT-03',
      'C-GOT-08': 'L-GOT-02',
    },
  },
};

// ── Scenes ───────────────────────────────────────────────────────────────────
const scenes: Record<string, Scene> = {
  // ── Arc 1: The Wolves Descend ─────────────────────────────────────────────
  'S-GOT-001': {
    id: 'S-GOT-001',
    kind: 'scene',
    arcId: 'SC-GOT-01',
    locationId: 'L-GOT-04',
    participantIds: ['C-GOT-01', 'C-GOT-05', 'C-GOT-07', 'C-GOT-08'],
    events: ['king_arrives_winterfell', 'robert_asks_ned_hand', 'lyanna_tomb_visit'],
    threadMutations: [
      { threadId: 'T-GOT-02', from: 'dormant', to: 'surfacing' },
      { threadId: 'T-GOT-06', from: 'dormant', to: 'surfacing' },
    ],
    knowledgeMutations: [],
    relationshipMutations: [],
    stakes: 15,
    prose: '',
    summary: 'Winterfell. The king rides north with half the court trailing behind him like a gilded wound. Robert Baratheon, once a warrior who shattered armies, now overflows his saddle. He embraces Ned in the courtyard — two men pretending fifteen years have not passed. In the crypts beneath Winterfell, standing before Lyannas statue, Robert asks Ned to be his Hand. The words fall like a sentence. Arya watches from the battlements as her world begins to crack. Jon Snow stands apart from the welcome feast, as he always has, and wonders if this is the last time he will see his father smile.',
  },
  'S-GOT-002': {
    id: 'S-GOT-002',
    kind: 'scene',
    arcId: 'SC-GOT-01',
    locationId: 'L-GOT-07',
    participantIds: ['C-GOT-04'],
    events: ['daenerys_wedding', 'dothraki_introduction', 'dragon_eggs_gifted'],
    threadMutations: [{ threadId: 'T-GOT-03', from: 'dormant', to: 'surfacing' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-04', nodeId: 'K-GOT-35', action: 'added', content: 'Received three petrified dragon eggs as a wedding gift — they are warm to the touch, though no one else seems to feel it' },
    ],
    relationshipMutations: [],
    stakes: 20,
    prose: '',
    summary: 'Pentos. Across the Narrow Sea, a different kind of transaction. Daenerys Targaryen is wed to Khal Drogo beneath a sky she did not choose. Viserys watches with the hungry patience of a man trading his sister for forty thousand screamers. The Dothraki feast while Daenerys sits rigid, a porcelain doll placed upon a savage throne. Among the gifts: three dragon eggs, turned to stone by centuries. She holds them and feels heat where there should be none. No one notices. No one ever notices what stirs inside the quiet ones until it is far too late.',
  },
  'S-GOT-003': {
    id: 'S-GOT-003',
    kind: 'scene',
    arcId: 'SC-GOT-01',
    locationId: 'L-GOT-04',
    participantIds: ['C-GOT-01', 'C-GOT-05'],
    events: ['jon_declares_nights_watch', 'ned_farewell', 'unspoken_truth'],
    threadMutations: [{ threadId: 'T-GOT-04', from: 'dormant', to: 'surfacing' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-05', nodeId: 'K-GOT-45', action: 'added', content: 'Father promised that the next time they meet, he will tell Jon about his mother' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-05', to: 'C-GOT-01', type: 'The promise to reveal his mothers identity — hope and grief in equal measure', valenceDelta: 0.1 },
    ],
    stakes: 25,
    prose: '',
    summary: 'Winterfell courtyard, the morning of departure. Jon Snow tells his father he will take the black. Ned looks at the boy — sees Lyanna in the line of his jaw, in the stubbornness of his gaze — and says nothing of it. Instead he promises: next time we meet, I will tell you about your mother. It is a promise he will never keep. They embrace. Jon rides north toward the Wall. Ned rides south toward the capital. Between them, a thousand leagues of road and a secret that could shatter kingdoms.',
  },
  'S-GOT-004': {
    id: 'S-GOT-004',
    kind: 'scene',
    arcId: 'SC-GOT-01',
    locationId: 'L-GOT-08',
    participantIds: ['C-GOT-01', 'C-GOT-08'],
    characterMovements: { 'C-GOT-01': 'L-GOT-08', 'C-GOT-08': 'L-GOT-08' },
    events: ['kingsroad_journey', 'arya_needle_practice', 'trident_incident'],
    threadMutations: [{ threadId: 'T-GOT-05', from: 'dormant', to: 'surfacing' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-08', action: 'added', content: 'Cersei demanded Lady be killed for Nymeria biting Joffrey — the queen punishes wolves for the crimes of princes' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-01', to: 'C-GOT-02', type: 'The queens cruelty in demanding Ladys death — this woman is capable of anything', valenceDelta: -0.2 },
      { from: 'C-GOT-08', to: 'C-GOT-01', type: 'Watches her father execute Lady with grief that will harden into something sharper', valenceDelta: -0.1 },
    ],
    stakes: 30,
    prose: '',
    summary: 'The Kingsroad. The journey south teaches its first lesson in Lannister justice. On the banks of the Trident, Arya and the butchers boy play at swords. Joffrey draws real steel on a child. Nymeria defends her mistress with teeth. Cersei demands blood — not the princes, of course, but the direwolfs. Nymeria has fled, so Lady must die in her place. Ned does the killing himself, because that is what Starks do. Arya watches her father drive the blade home and learns that honor and mercy are not always the same thing. The Kingsroad stretches south like an open throat.',
  },
  'S-GOT-005': {
    id: 'S-GOT-005',
    kind: 'scene',
    arcId: 'SC-GOT-01',
    locationId: 'L-GOT-05',
    participantIds: ['C-GOT-05'],
    characterMovements: { 'C-GOT-05': 'L-GOT-05' },
    events: ['jon_arrives_wall', 'disillusionment', 'nights_watch_reality'],
    threadMutations: [{ threadId: 'T-GOT-04', from: 'surfacing', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-05', nodeId: 'K-GOT-46', action: 'added', content: 'The Nights Watch is not a noble brotherhood — it is a dumping ground for rapers, thieves, and the unwanted sons of the realm' },
    ],
    relationshipMutations: [],
    stakes: 35,
    prose: '',
    summary: 'The Wall. Jon Snow arrives at Castle Black expecting honor and finds squalor. The Nights Watch is not the noble brotherhood of the songs — it is a penal colony in black cloaks. Rapers train beside him. Thieves share his table. The Wall itself is magnificent and terrible, seven hundred feet of ice catching the northern light, but the men who guard it are broken things. Jon, who left Winterfell seeking belonging, finds himself more alone than ever. Tyrion, visiting the Wall out of curiosity, watches the boy and recognizes a fellow creature: someone the world has marked as less than. He offers advice Jon is not yet wise enough to take.',
  },

  // ── Arc 2: The Throne of Knives ───────────────────────────────────────────
  'S-GOT-006': {
    id: 'S-GOT-006',
    kind: 'scene',
    arcId: 'SC-GOT-02',
    locationId: 'L-GOT-03',
    participantIds: ['C-GOT-01', 'C-GOT-06'],
    characterMovements: { 'C-GOT-01': 'L-GOT-03' },
    events: ['ned_arrives_kings_landing', 'small_council_introduction', 'littlefinger_approach'],
    threadMutations: [
      { threadId: 'T-GOT-05', from: 'surfacing', to: 'escalating' },
      { threadId: 'T-GOT-07', from: 'dormant', to: 'surfacing' },
    ],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-09', action: 'added', content: 'The Small Council spends money the realm does not have — the crown is drowning in Lannister debt' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-06', to: 'C-GOT-01', type: 'Littlefinger presents himself as an old friend of the family — the trap is baited with nostalgia', valenceDelta: 0.2 },
    ],
    stakes: 40,
    prose: '',
    summary: "The Red Keep. Ned Stark enters King's Landing like a wolf walking into a butcher's shop. The Small Council convenes: Littlefinger with his ledgers and smiles, Varys with his perfume and whispers, Pycelle with his feigned dotage. They spend money the realm does not have on a tournament Ned did not request. Petyr Baelish sidles close, invoking Catelyn's name like a key to a lock. He offers friendship. Ned, who measures men by the standards of the North, sees an old friend of his wife's. He does not see the knife behind the smile. He never will, until it is already between his ribs.",
  },
  'S-GOT-007': {
    id: 'S-GOT-007',
    kind: 'scene',
    arcId: 'SC-GOT-02',
    locationId: 'L-GOT-03',
    participantIds: ['C-GOT-01', 'C-GOT-07'],
    events: ['robert_governance_failure', 'ned_discovers_debt', 'hand_burden'],
    threadMutations: [{ threadId: 'T-GOT-06', from: 'surfacing', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-80', action: 'added', content: 'Robert has no interest in ruling — he drinks, hunts, and whores while the realm rots from within' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-01', to: 'C-GOT-07', type: 'The man Ned fought beside is gone — this Robert is a stranger wearing his friends face', valenceDelta: -0.2 },
    ],
    stakes: 45,
    prose: '',
    summary: "The Red Keep, Hand's chambers. Ned discovers the truth behind the crown: six million gold dragons of debt, a king who signs nothing and reads less, a court that runs on bribery and fear. Robert waves away concerns with a wine cup and a boar-hunting story. The man who swung a warhammer at the Trident cannot be bothered to read a ledger. Ned realizes with creeping horror that he has not come south to advise a king — he has come to be one, in all but name, while Robert slowly drinks himself into the grave. The Hand's badge weighs heavier with each passing hour.",
  },
  'S-GOT-008': {
    id: 'S-GOT-008',
    kind: 'scene',
    arcId: 'SC-GOT-02',
    locationId: 'L-GOT-03',
    participantIds: ['C-GOT-01', 'C-GOT-06'],
    events: ['jon_arryn_investigation_begins', 'littlefinger_guides_ned', 'book_of_lineages'],
    threadMutations: [{ threadId: 'T-GOT-01', from: 'dormant', to: 'surfacing' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-81', action: 'added', content: 'Jon Arryn was investigating something before his death — he visited a blacksmith and requested a book of noble lineages' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-01', to: 'C-GOT-06', type: 'Grateful for Littlefingers guidance in retracing Jon Arryns steps — trust deepens', valenceDelta: 0.1 },
    ],
    stakes: 50,
    prose: '',
    summary: "The Red Keep. Ned begins retracing Jon Arryn's final steps, and Littlefinger helpfully lights the path — every torch placed precisely where the spider needs the wolf to walk. Jon Arryn visited a blacksmith's forge in Flea Bottom. He requested the great book of lineages from the Citadel. He spoke the words 'the seed is strong' before he died. Ned follows the trail like the honest hunter he is, never questioning why it is so conveniently illuminated. Littlefinger watches and smiles his careful smile. The investigation is not Ned's — it is Baelish's, and Ned is merely the hand holding the blade someone else aims.",
  },
  'S-GOT-009': {
    id: 'S-GOT-009',
    kind: 'scene',
    arcId: 'SC-GOT-02',
    locationId: 'L-GOT-02',
    participantIds: ['C-GOT-01', 'C-GOT-03'],
    characterMovements: { 'C-GOT-01': 'L-GOT-02', 'C-GOT-03': 'L-GOT-02' },
    events: ['gendrys_forge_visit', 'tyrion_encounter', 'baratheon_bastards'],
    threadMutations: [{ threadId: 'T-GOT-01', from: 'surfacing', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-82', action: 'added', content: 'Roberts bastard son Gendry has black hair and blue eyes — all of Roberts bastards do. The royal children have none of these features.' },
    ],
    relationshipMutations: [],
    stakes: 55,
    prose: '',
    summary: "Flea Bottom. Ned descends into the city's reeking underbelly to visit Tobho Mott's forge. There he finds Gendry — a blacksmith's apprentice with Robert Baratheon's jaw, Robert's eyes, Robert's black hair. The seed is strong. Jon Arryn's dying words crystallize into meaning as Ned studies the boy who does not know he is a king's son. Every Baratheon bastard is a mirror of their father. But the children on the throne — golden-haired, green-eyed, with not a trace of Robert in them — are mirrors of someone else entirely. Tyrion crosses Ned's path in the street, sharp eyes missing nothing. The dwarf makes a jest. Ned does not laugh. The truth is assembling itself, piece by terrible piece.",
  },
  'S-GOT-010': {
    id: 'S-GOT-010',
    kind: 'scene',
    arcId: 'SC-GOT-02',
    locationId: 'L-GOT-03',
    participantIds: ['C-GOT-01', 'C-GOT-02', 'C-GOT-07'],
    characterMovements: { 'C-GOT-01': 'L-GOT-03' },
    events: ['tournament_of_the_hand', 'cersei_robert_public_tension', 'ned_refuses_to_stop'],
    threadMutations: [
      { threadId: 'T-GOT-01', from: 'escalating', to: 'threatened' },
      { threadId: 'T-GOT-06', from: 'escalating', to: 'threatened' },
    ],
    knowledgeMutations: [
      { characterId: 'C-GOT-02', nodeId: 'K-GOT-16', action: 'added', content: 'Ned Stark is asking questions about Roberts bastards and reading the book of lineages — he is walking Jon Arryns path' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-02', to: 'C-GOT-01', type: 'The wolf is circling the truth — he must be stopped before he finds it', valenceDelta: -0.3 },
    ],
    stakes: 65,
    prose: '',
    summary: "The Tournament of the Hand. Knights clash in Robert's honor while the real war happens in glances across the royal box. Cersei sits rigid beside a husband she loathes, watching Ned Stark watch her children with new eyes. She has heard the whispers — the Hand has been visiting forges, reading lineage books, asking about bastards with black hair. Jon Arryn asked the same questions. Jon Arryn is dead. The tournament's violence is pageantry; the violence building between these families is something else entirely. Robert laughs and drinks. He does not see the knife his wife is sharpening behind her smile, or the noose his best friend is tying with honest hands.",
  },

  // ── Arc 3: The Honorable Fool ─────────────────────────────────────────────
  'S-GOT-011': {
    id: 'S-GOT-011',
    kind: 'scene',
    arcId: 'SC-GOT-03',
    locationId: 'L-GOT-03',
    participantIds: ['C-GOT-01', 'C-GOT-07'],
    events: ['robert_hunting_trip', 'ned_as_regent', 'cersei_moves_pieces'],
    threadMutations: [{ threadId: 'T-GOT-06', from: 'threatened', to: 'critical' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-83', action: 'added', content: 'Robert has gone hunting in the Kingswood — Ned rules as regent in his absence, alone among enemies' },
    ],
    relationshipMutations: [],
    stakes: 70,
    prose: '',
    summary: "The Red Keep. Robert announces a hunting trip to the Kingswood — his solution to every problem is to leave it behind and kill something. Ned is left as regent, the Iron Throne cutting into his hands as he dispenses the king's justice. He sends Beric Dondarrion to bring Gregor Clegane to justice for ravaging the Riverlands. It is the right decision, the honorable decision, and it is exactly what his enemies need — the Hand acting as king, making himself the target. Cersei watches from the gallery. In the game of thrones, she knows, the most dangerous piece is the one that does not know it is being played.",
  },
  'S-GOT-012': {
    id: 'S-GOT-012',
    kind: 'scene',
    arcId: 'SC-GOT-03',
    locationId: 'L-GOT-03',
    participantIds: ['C-GOT-01', 'C-GOT-02'],
    events: ['ned_confronts_cersei', 'mercy_warning', 'fatal_honor'],
    threadMutations: [
      { threadId: 'T-GOT-01', from: 'threatened', to: 'resolved' },
      { threadId: 'T-GOT-02', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-GOT-02', nodeId: 'K-GOT-17', action: 'added', content: 'Ned Stark knows the truth — he told her to flee with her children before Robert returns. He gave her a warning instead of a blade.' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-02', to: 'C-GOT-01', type: 'He warned her. The fool warned her. His honor is his death sentence and she will be the executioner.', valenceDelta: -0.1 },
    ],
    stakes: 75,
    prose: '',
    summary: "The Red Keep godswood. Ned confronts Cersei with the truth: her children are not Robert's. They are Jaime's. Every one of them. Cersei does not deny it — she is past denial, past shame, past anything but calculation. Ned tells her to take her children and flee before Robert returns from the hunt. He gives her this mercy because he is Ned Stark, and Ned Stark does not murder children, even children born of incest and treason. Cersei looks at him with something approaching pity. 'When you play the game of thrones, you win or you die,' she tells him. 'There is no middle ground.' She is already planning his destruction before she leaves the garden.",
  },
  'S-GOT-013': {
    id: 'S-GOT-013',
    kind: 'scene',
    arcId: 'SC-GOT-03',
    locationId: 'L-GOT-03',
    participantIds: ['C-GOT-01', 'C-GOT-06', 'C-GOT-07'],
    events: ['robert_returns_wounded', 'boar_goring', 'deathbed_decree'],
    threadMutations: [
      { threadId: 'T-GOT-06', from: 'critical', to: 'done' },
      { threadId: 'T-GOT-07', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-84', action: 'added', content: 'Robert is dying from a boar wound — his final decree names Ned as Lord Protector of the Realm. Ned changed the words from Joffrey to rightful heir.' },
      { characterId: 'C-GOT-06', nodeId: 'K-GOT-54', action: 'added', content: 'Robert is dying and Ned holds the regency — the board is set for the final move' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-01', to: 'C-GOT-07', type: 'Grief for a dying friend mingles with the weight of a secret he cannot share at the deathbed', valenceDelta: 0.1 },
    ],
    stakes: 80,
    prose: '',
    summary: "The Red Keep, the king's bedchamber. Robert Baratheon is carried back from the Kingswood, gutted by a boar — wine and carelessness finishing what no enemy could. On his deathbed he dictates his last decree: Ned shall serve as Lord Protector until Joffrey comes of age. Ned writes 'the rightful heir' instead, unable to name a bastard born of incest as king even now. Robert does not notice the substitution. He grips Ned's hand and says he should have listened more, drunk less, been the king Ned deserved. Then he dies. Ned holds the paper like a shield. Littlefinger materializes at his elbow, already offering alternatives. The game enters its final phase.",
  },
  'S-GOT-014': {
    id: 'S-GOT-014',
    kind: 'scene',
    arcId: 'SC-GOT-03',
    locationId: 'L-GOT-03',
    participantIds: ['C-GOT-01', 'C-GOT-02', 'C-GOT-06'],
    events: ['throne_room_confrontation', 'littlefinger_betrayal', 'ned_arrested'],
    threadMutations: [
      { threadId: 'T-GOT-02', from: 'escalating', to: 'threatened' },
      { threadId: 'T-GOT-05', from: 'escalating', to: 'threatened' },
      { threadId: 'T-GOT-07', from: 'escalating', to: 'threatened' },
    ],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-85', action: 'added', content: 'Littlefinger betrayed him — the Gold Cloaks serve the Lannisters now. Every piece of trust Ned placed was a nail in his own coffin.' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-01', to: 'C-GOT-06', type: 'The final revelation — Baelish was never an ally. The knife is in his back before he sees the hand.', valenceDelta: -0.8 },
      { from: 'C-GOT-06', to: 'C-GOT-01', type: 'I did warn you not to trust me. The wolf is caged and the ladder grows another rung.', valenceDelta: -0.2 },
    ],
    stakes: 90,
    prose: '',
    summary: "The Throne Room. The moment the game is won and lost. Ned enters with Robert's decree, the truth, and fifty Stark guardsmen. Cersei enters with Joffrey, the Kingsguard, and the certainty that power answers to those who seize it. She tears the king's decree in half. Ned signals the Gold Cloaks to uphold the law. Littlefinger steps close — 'I did warn you not to trust me' — and the Gold Cloaks turn their spears on the Stark men. It is over in moments. Ned's men die around him. A blade finds his leg. He falls in the shadow of the Iron Throne, brought down not by a greater warrior but by his own incapacity to imagine that a man who smiled and spoke of friendship could be the architect of his ruin.",
  },
  'S-GOT-015': {
    id: 'S-GOT-015',
    kind: 'scene',
    arcId: 'SC-GOT-03',
    locationId: 'L-GOT-02',
    participantIds: ['C-GOT-01', 'C-GOT-02', 'C-GOT-08'],
    characterMovements: { 'C-GOT-01': 'L-GOT-02', 'C-GOT-08': 'L-GOT-02' },
    events: ['ned_imprisoned', 'arya_flees', 'cersei_ascendant', 'honor_defeated'],
    threadMutations: [
      { threadId: 'T-GOT-02', from: 'threatened', to: 'subverted' },
      { threadId: 'T-GOT-05', from: 'threatened', to: 'critical' },
    ],
    knowledgeMutations: [
      { characterId: 'C-GOT-08', nodeId: 'K-GOT-73', action: 'added', content: 'Her father is imprisoned. The Lannister guards killed Syrio Forel. She is alone in a city that wants her dead.' },
      { characterId: 'C-GOT-02', nodeId: 'K-GOT-18', action: 'added', content: 'Ned Stark rots in the black cells. Joffrey sits the Iron Throne. The Lannister hold on power is complete — for now.' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-08', to: 'C-GOT-01', type: 'Her father is in a cage and she cannot save him — the world has taught her that love is not enough', valenceDelta: -0.1 },
      { from: 'C-GOT-02', to: 'C-GOT-01', type: 'The wolf is caged. The game is won. But caged wolves are not dead wolves.', valenceDelta: 0.1 },
    ],
    stakes: 95,
    prose: '',
    summary: "King's Landing. The aftermath. Ned Stark sits in a black cell beneath the Red Keep, the most honest man in Westeros imprisoned for treason by the most corrupt. Above him, Joffrey Baratheon — who is neither a Baratheon nor a king — takes the Iron Throne. Cersei stands behind the new king and sees the future she purchased with lies and blood. Arya escapes the Red Keep as Lannister guards slaughter the Stark household. She runs through the streets of the capital with Needle in her hand, a wolf pup in a city of lions. Syrio Forel buys her escape with his life. Somewhere in the black cells, Ned Stark stares at the darkness and understands, finally, the price of honor in a land that trades in none. The game of thrones does not pause for good men. It buries them.",
  },
};

// ── Commits ──────────────────────────────────────────────────────────────────
const diffNames: Record<string, string> = {
  'S-GOT-001': 'king_comes_north',
  'S-GOT-002': 'targaryen_wedding',
  'S-GOT-003': 'bastard_farewell',
  'S-GOT-004': 'wolf_blood_spilled',
  'S-GOT-005': 'wall_disillusion',
  'S-GOT-006': 'hand_arrives',
  'S-GOT-007': 'crown_of_debt',
  'S-GOT-008': 'lineage_trail',
  'S-GOT-009': 'seed_is_strong',
  'S-GOT-010': 'tournament_tension',
  'S-GOT-011': 'regent_alone',
  'S-GOT-012': 'mercy_given',
  'S-GOT-013': 'king_dies',
  'S-GOT-014': 'betrayal_throne_room',
  'S-GOT-015': 'wolf_caged',
};

const sceneList = Object.values(scenes);
const commits: Commit[] = sceneList.map((scene, i) => ({
  id: `CM-GOT-${String(i + 1).padStart(3, '0')}`,
  parentId: i === 0 ? null : `CM-GOT-${String(i).padStart(3, '0')}`,
  sceneId: scene.id,
  arcId: scene.arcId,
  diffName: diffNames[scene.id] ?? 'thread_surfaced',
  threadMutations: scene.threadMutations,
  knowledgeMutations: scene.knowledgeMutations,
  relationshipMutations: scene.relationshipMutations,
  authorOverride: null,
  createdAt: Date.now() - (15 - i) * 3600000,
}));

// ── Alternate Branch: "What If Ned Accepted Renly's Offer" ───────────────────
// Diverges after S-GOT-010 — Ned accepts Renly Baratheon's offer to seize
// Cersei and the children before Robert dies, changing everything.

const altArc: Arc = {
  id: 'SC-GOT-03-ALT',
  name: "The Stag's Gambit",
  sceneIds: ['S-GOT-ALT-011', 'S-GOT-ALT-012', 'S-GOT-ALT-013', 'S-GOT-ALT-014', 'S-GOT-ALT-015'],
  develops: ['T-GOT-02', 'T-GOT-05'],
  locationIds: ['L-GOT-02', 'L-GOT-03'],
  activeCharacterIds: ['C-GOT-01', 'C-GOT-02', 'C-GOT-06', 'C-GOT-07', 'C-GOT-08'],
  initialCharacterLocations: {
    'C-GOT-01': 'L-GOT-03',
    'C-GOT-02': 'L-GOT-03',
    'C-GOT-06': 'L-GOT-03',
    'C-GOT-07': 'L-GOT-03',
    'C-GOT-08': 'L-GOT-02',
  },
};

const altScenes: Record<string, Scene> = {
  'S-GOT-ALT-011': {
    id: 'S-GOT-ALT-011',
    kind: 'scene',
    arcId: 'SC-GOT-03-ALT',
    locationId: 'L-GOT-03',
    participantIds: ['C-GOT-01'],
    events: ['renly_offer_accepted', 'ned_compromises_honor', 'midnight_planning'],
    threadMutations: [{ threadId: 'T-GOT-02', from: 'surfacing', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-90', action: 'added', content: 'Accepted Renlys offer to seize Cersei and the children tonight — the first time in his life he has chosen expedience over honor' },
    ],
    relationshipMutations: [],
    stakes: 70,
    prose: '',
    summary: "The Red Keep, Ned's chambers, midnight. In the canon timeline, Ned refused Renly's offer to seize the queen and her children while Robert lay dying. In this one, he does not. Something has broken in the honorable man — perhaps the weight of the truth, perhaps the memory of what happened to every Stark who came south. He sends word to Renly: tonight. As he buckles his sword belt, his hands shake. This is not who he is. But who he is will get his family killed, and Ned Stark loves his children more than he loves his honor. It is the first compromise, and it costs him everything he thought he was.",
  },
  'S-GOT-ALT-012': {
    id: 'S-GOT-ALT-012',
    kind: 'scene',
    arcId: 'SC-GOT-03-ALT',
    locationId: 'L-GOT-03',
    participantIds: ['C-GOT-01', 'C-GOT-02'],
    events: ['cersei_seized', 'children_taken', 'queen_imprisoned'],
    threadMutations: [
      { threadId: 'T-GOT-01', from: 'threatened', to: 'critical' },
      { threadId: 'T-GOT-05', from: 'escalating', to: 'threatened' },
    ],
    knowledgeMutations: [
      { characterId: 'C-GOT-02', nodeId: 'K-GOT-19', action: 'added', content: 'The Stark wolf grew teeth in the night — she underestimated him because she could not imagine an honorable man acting before dawn' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-02', to: 'C-GOT-01', type: 'Shock and fury — the one thing she never expected was for Ned Stark to act like a real player', valenceDelta: -0.3 },
      { from: 'C-GOT-01', to: 'C-GOT-02', type: 'He arrested a mother in front of her children — the taste of it will never leave his mouth', valenceDelta: -0.1 },
    ],
    stakes: 75,
    prose: '',
    summary: "The Red Keep, the queen's chambers, before dawn. Stark men and Renly's household guard break through the doors. Cersei wakes to steel and torchlight. For one moment her mask falls completely — not rage but genuine shock. She calculated every move Ned Stark could make, and the one she never considered was that an honorable man might act before sunrise, without warning, without giving his enemy a chance to flee. The children scream. Tommen clings to his mother. Joffrey snarls and reaches for a sword he does not have. Ned watches it all and feels something inside him die — the part that believed you could do the right thing the right way. The children are taken to separate chambers. Cersei is led to the black cells. She goes in silence, saving her rage for later.",
  },
  'S-GOT-ALT-013': {
    id: 'S-GOT-ALT-013',
    kind: 'scene',
    arcId: 'SC-GOT-03-ALT',
    locationId: 'L-GOT-03',
    participantIds: ['C-GOT-01', 'C-GOT-06', 'C-GOT-07'],
    events: ['robert_told_truth', 'kings_last_hours', 'succession_crisis'],
    threadMutations: [
      { threadId: 'T-GOT-06', from: 'threatened', to: 'done' },
      { threadId: 'T-GOT-01', from: 'critical', to: 'resolved' },
    ],
    knowledgeMutations: [
      { characterId: 'C-GOT-07', nodeId: 'K-GOT-64', action: 'added', content: 'The children are not his. Cersei and Jaime. Fifteen years of lies. The crown sits on a bastards head.' },
      { characterId: 'C-GOT-06', nodeId: 'K-GOT-55', action: 'added', content: 'Ned controls the queen, the children, and the dying kings ear — the board has flipped entirely' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-07', to: 'C-GOT-01', type: 'Gratitude and rage in equal measure — Ned told the truth that no one else dared speak', valenceDelta: 0.1 },
      { from: 'C-GOT-06', to: 'C-GOT-01', type: 'Recalculating — the wolf is more dangerous than anticipated. New approach required.', valenceDelta: -0.2 },
    ],
    stakes: 80,
    prose: '',
    summary: "The king's deathbed. Robert is fading from the boar wound, but Ned owes him the truth before the end. He tells him everything: Cersei, Jaime, the children, the lineage book, the bastards with black hair. Robert's face passes through fury, grief, and something worse — recognition. He knew. Some part of him always knew. He was simply too drunk, too tired, too broken by Lyanna's ghost to look at the truth. He grips Ned's hand with the last of a warrior's strength. 'Put the right person on the throne,' he rasps. He does not specify who. Littlefinger, hovering in the corridor, hears everything through the door and begins recalculating at terrifying speed.",
  },
  'S-GOT-ALT-014': {
    id: 'S-GOT-ALT-014',
    kind: 'scene',
    arcId: 'SC-GOT-03-ALT',
    locationId: 'L-GOT-03',
    participantIds: ['C-GOT-01', 'C-GOT-06'],
    events: ['succession_debate', 'stannis_claim', 'ned_protector'],
    threadMutations: [
      { threadId: 'T-GOT-05', from: 'threatened', to: 'critical' },
      { threadId: 'T-GOT-02', from: 'escalating', to: 'threatened' },
    ],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-86', action: 'added', content: 'Named Lord Protector with a legitimate mandate — but ruling through force is no different from what the Lannisters would have done' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-06', to: 'C-GOT-01', type: 'Offers unswerving support while calculating how to ensure Ned remains dependent on his counsel', valenceDelta: 0.3 },
    ],
    stakes: 85,
    prose: '',
    summary: "The Small Council chamber, the morning after Robert's death. Ned holds power — real power, backed by steel and a dying king's last words. The question of succession splits the room. Stannis has the legal claim. Renly has the charm and the army. Littlefinger suggests a regency under Ned himself, whispering that a steady hand now prevents civil war later. Ned recognizes the trap — a protectorship that becomes a rule that becomes a tyranny — but what is the alternative? He sends ravens to Stannis at Dragonstone and braces for the Lannister response. Tywin Lannister will march. The Riverlands will burn. Ned has averted one catastrophe and birthed another. Honor saved him from the throne room floor, but honor will not hold the Seven Kingdoms together. For the first time, Ned Stark understands why Robert drank.",
  },
  'S-GOT-ALT-015': {
    id: 'S-GOT-ALT-015',
    kind: 'scene',
    arcId: 'SC-GOT-03-ALT',
    locationId: 'L-GOT-03',
    participantIds: ['C-GOT-01', 'C-GOT-02', 'C-GOT-08'],
    events: ['cersei_cell_visit', 'cost_of_power', 'arya_watches'],
    threadMutations: [
      { threadId: 'T-GOT-02', from: 'threatened', to: 'subverted' },
      { threadId: 'T-GOT-07', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-GOT-02', nodeId: 'K-GOT-20', action: 'added', content: 'Ned Stark visited her cell and could not meet her eyes — his victory is eating him alive. That weakness is her weapon.' },
      { characterId: 'C-GOT-08', nodeId: 'K-GOT-74', action: 'added', content: 'Her father won, but he looks like a man who lost everything — power has made him smaller, not larger' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-01', to: 'C-GOT-02', type: 'Visits his prisoner and sees a mother separated from her children — the victory tastes of ash', valenceDelta: 0.1 },
      { from: 'C-GOT-08', to: 'C-GOT-01', type: 'Watches her father carry the weight of the crown and understands for the first time why he never wanted it', valenceDelta: 0.1 },
    ],
    stakes: 85,
    prose: '',
    summary: "The black cells. Ned descends to visit Cersei, and what he finds strips the triumph from his bones. She sits in the dark with a queen's posture and a prisoner's rage. She does not beg. She does not weep. She asks him one question: 'When you took my children from my arms, did you feel like your father? Or like mine?' Ned has no answer. He came south to do justice and has become a man who imprisons mothers and terrifies children. Arya finds her father afterward, sitting alone in the Hand's chamber with the badge in his hands, turning it over and over. She does not speak. She simply sits beside him. In the alternate timeline, Ned Stark lives — but the man who survives Kings Landing is not the man who left Winterfell. The game of thrones does not just kill honorable men. Sometimes it lets them win, and that is worse.",
  },
};

// ── Initial World Building Commit ────────────────────────────────────────────
const wxInitCommit: WorldBuildCommit = {
  kind: 'world_build',
  id: 'WX-GOT-init',
  summary: 'World created: 8 characters (Eddard Stark, Cersei Lannister, Tyrion Lannister, Daenerys Targaryen, Jon Snow, Petyr Baelish, Robert Baratheon, Arya Stark), 8 locations (Westeros, King\'s Landing, The Red Keep, Winterfell, The Wall, The Narrow Sea, Pentos, The Kingsroad), 7 threads, 14 relationships',
  expansionManifest: {
    characterIds: Object.keys(characters),
    locationIds: Object.keys(locations),
    threadIds: Object.keys(threads),
    relationshipCount: relationships.length,
  },
};

const allScenes: Record<string, Scene> = { ...scenes, ...altScenes };
const allWorldBuilds: Record<string, WorldBuildCommit> = { 'WX-GOT-init': wxInitCommit };
const allArcs: Record<string, Arc> = { ...arcs, [altArc.id]: altArc };

// ── Branches ────────────────────────────────────────────────────────────────
const branches: Record<string, Branch> = {
  'B-GOT-MAIN': {
    id: 'B-GOT-MAIN',
    name: 'Canon Timeline',
    parentBranchId: null,
    forkEntryId: null,
    entryIds: ['WX-GOT-init', ...Object.keys(scenes)],
    createdAt: Date.now() - 86400000,
  },
  'B-GOT-RENLY': {
    id: 'B-GOT-RENLY',
    name: "What If Ned Accepted Renly's Offer",
    parentBranchId: 'B-GOT-MAIN',
    forkEntryId: 'S-GOT-010',
    entryIds: Object.keys(altScenes),
    createdAt: Date.now() - 43200000,
  },
};

// ── Assembled Narrative ──────────────────────────────────────────────────────
export const seedGOT: NarrativeState = {
  id: 'N-GOT',
  title: 'A Game of Thrones — Season One',
  description: 'When King Robert Baratheon rides north to name Eddard Stark his Hand, he sets in motion a chain of events that will shatter the peace of the Seven Kingdoms. In Kings Landing, Ned uncovers a secret that has already killed one Hand and will claim him too — unless he abandons every principle he holds sacred. Across the Narrow Sea, the last Targaryen learns that power is not given but taken. At the Wall, a bastard searches for belonging at the edge of the world. The game of thrones has begun, and in this game, you win or you die.',
  characters,
  locations,
  threads,
  arcs: allArcs,
  scenes: allScenes,
  worldBuilds: allWorldBuilds,
  branches,
  commits,
  relationships,
  worldSummary: 'The Seven Kingdoms of Westeros are held together by the Iron Throne — a seat forged from the swords of the conquered, uncomfortable by design, a reminder that a king should never sit easy. Robert Baratheon won the throne by rebellion and has spent fifteen years failing to deserve it. The great houses circle each other like wolves: Stark in the frozen North, Lannister in the golden West, Baratheon on the throne, Targaryen in exile across the sea. Summer has lasted nine years. Winter is coming — the Stark words are not a boast but a warning. Jon Arryn, the previous Hand of the King, is dead, and the truth he died for is a secret that could burn the realm to ash: the royal children are bastards born of incest, and the Iron Throne belongs to no one who sits upon it.',
  controlMode: 'auto',
  activeForces: { stakes: 0, pacing: 0, variety: 0 },
  coverImageUrl: '/covers/got.jpg',
  createdAt: Date.now() - 86400000,
  updatedAt: Date.now(),
};
