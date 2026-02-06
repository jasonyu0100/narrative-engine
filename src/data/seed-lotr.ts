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
  'C-LOTR-01': {
    id: 'C-LOTR-01',
    name: 'Frodo Baggins',
    role: 'anchor',
    threadIds: ['T-LOTR-01', 'T-LOTR-02', 'T-LOTR-07'],
    knowledge: {
      nodes: [
        { id: 'K-LOTR-01', type: 'knows', content: 'Bilbo\'s magic ring is the One Ring of Sauron, forged in the fires of Mount Doom' },
        { id: 'K-LOTR-02', type: 'goal', content: 'Carry the Ring to Mordor and destroy it in the fires where it was made' },
        { id: 'K-LOTR-03', type: 'believes', content: 'The task was appointed to him — if he does not find a way, no one will' },
        { id: 'K-LOTR-04', type: 'knows', content: 'The Ring grows heavier with each mile and whispers promises in the dark' },
        { id: 'K-LOTR-05', type: 'secret', content: 'Feels the Ring\'s pull growing stronger — fears he may not be able to let it go when the time comes' },
      ],
      edges: [
        { from: 'K-LOTR-01', to: 'K-LOTR-02', type: 'enables' },
        { from: 'K-LOTR-03', to: 'K-LOTR-02', type: 'supports' },
        { from: 'K-LOTR-04', to: 'K-LOTR-05', type: 'enables' },
        { from: 'K-LOTR-05', to: 'K-LOTR-02', type: 'contradicts' },
      ],
    },
  },
  'C-LOTR-02': {
    id: 'C-LOTR-02',
    name: 'Gandalf the Grey',
    role: 'anchor',
    threadIds: ['T-LOTR-01', 'T-LOTR-04', 'T-LOTR-05'],
    knowledge: {
      nodes: [
        { id: 'K-LOTR-10', type: 'knows', content: 'The One Ring has been found — Bilbo\'s ring matches every test of lore and fire' },
        { id: 'K-LOTR-11', type: 'knows', content: 'Saruman has turned to darkness and seeks the Ring for himself' },
        { id: 'K-LOTR-12', type: 'goal', content: 'Guide the Free Peoples against Sauron\'s rising shadow without wielding the Ring\'s power' },
        { id: 'K-LOTR-13', type: 'believes', content: 'Even the smallest person can change the course of the future — hobbits are the key' },
        { id: 'K-LOTR-14', type: 'secret', content: 'Narya, the Ring of Fire, burns on his finger — one of the Three Elven Rings' },
      ],
      edges: [
        { from: 'K-LOTR-10', to: 'K-LOTR-12', type: 'enables' },
        { from: 'K-LOTR-11', to: 'K-LOTR-12', type: 'contradicts' },
        { from: 'K-LOTR-13', to: 'K-LOTR-12', type: 'supports' },
        { from: 'K-LOTR-14', to: 'K-LOTR-12', type: 'supports' },
      ],
    },
  },
  'C-LOTR-03': {
    id: 'C-LOTR-03',
    name: 'Aragorn',
    role: 'recurring',
    threadIds: ['T-LOTR-03', 'T-LOTR-04'],
    knowledge: {
      nodes: [
        { id: 'K-LOTR-20', type: 'secret', content: 'Is Aragorn son of Arathorn, Isildur\'s heir and rightful King of Gondor' },
        { id: 'K-LOTR-21', type: 'knows', content: 'Has wandered the wild for decades as a Ranger, protecting lands that do not know his name' },
        { id: 'K-LOTR-22', type: 'goal', content: 'Protect Frodo and the Ring-bearer\'s quest — and perhaps reclaim the throne when the time is right' },
        { id: 'K-LOTR-23', type: 'believes', content: 'The blood of Numenor runs thin but not dry — he must prove himself worthy where Isildur failed' },
      ],
      edges: [
        { from: 'K-LOTR-20', to: 'K-LOTR-22', type: 'enables' },
        { from: 'K-LOTR-21', to: 'K-LOTR-22', type: 'supports' },
        { from: 'K-LOTR-23', to: 'K-LOTR-20', type: 'contradicts' },
      ],
    },
  },
  'C-LOTR-04': {
    id: 'C-LOTR-04',
    name: 'Samwise Gamgee',
    role: 'recurring',
    threadIds: ['T-LOTR-02', 'T-LOTR-07'],
    knowledge: {
      nodes: [
        { id: 'K-LOTR-30', type: 'knows', content: 'Promised Gandalf he would never leave Mr. Frodo — and he means to keep that promise' },
        { id: 'K-LOTR-31', type: 'believes', content: 'There is good in this world worth fighting for, even when the darkness feels absolute' },
        { id: 'K-LOTR-32', type: 'goal', content: 'Stay beside Frodo no matter what — carry him if he must' },
        { id: 'K-LOTR-33', type: 'knows', content: 'The Ring changes Frodo — moments of coldness and suspicion that are not his master\'s nature' },
      ],
      edges: [
        { from: 'K-LOTR-30', to: 'K-LOTR-32', type: 'enables' },
        { from: 'K-LOTR-31', to: 'K-LOTR-32', type: 'supports' },
        { from: 'K-LOTR-33', to: 'K-LOTR-32', type: 'contradicts' },
      ],
    },
  },
  'C-LOTR-05': {
    id: 'C-LOTR-05',
    name: 'Boromir',
    role: 'recurring',
    threadIds: ['T-LOTR-04', 'T-LOTR-06'],
    knowledge: {
      nodes: [
        { id: 'K-LOTR-40', type: 'knows', content: 'Gondor stands alone against Mordor — the White City bleeds without allies or hope' },
        { id: 'K-LOTR-41', type: 'believes', content: 'The Ring is a weapon and should be wielded in Gondor\'s defense — destroying it is folly' },
        { id: 'K-LOTR-42', type: 'goal', content: 'Bring the Ring to Minas Tirith and use it to save his people from annihilation' },
        { id: 'K-LOTR-43', type: 'secret', content: 'Hears the Ring calling to him in moments of silence — its promises of strength grow louder each day' },
      ],
      edges: [
        { from: 'K-LOTR-40', to: 'K-LOTR-42', type: 'enables' },
        { from: 'K-LOTR-41', to: 'K-LOTR-42', type: 'supports' },
        { from: 'K-LOTR-43', to: 'K-LOTR-42', type: 'enables' },
        { from: 'K-LOTR-43', to: 'K-LOTR-41', type: 'supports' },
      ],
    },
  },
  'C-LOTR-06': {
    id: 'C-LOTR-06',
    name: 'Legolas',
    role: 'transient',
    threadIds: ['T-LOTR-04'],
    knowledge: {
      nodes: [
        { id: 'K-LOTR-50', type: 'knows', content: 'Sent by King Thranduil to report that Gollum has escaped the Elves\' keeping' },
        { id: 'K-LOTR-51', type: 'believes', content: 'The ancient alliance between Elves and Men must be rekindled against the Shadow' },
        { id: 'K-LOTR-52', type: 'goal', content: 'Represent the Elves in the Fellowship and see the quest through to its end' },
      ],
      edges: [
        { from: 'K-LOTR-50', to: 'K-LOTR-52', type: 'enables' },
        { from: 'K-LOTR-51', to: 'K-LOTR-52', type: 'supports' },
      ],
    },
  },
  'C-LOTR-07': {
    id: 'C-LOTR-07',
    name: 'Gimli',
    role: 'transient',
    threadIds: ['T-LOTR-04'],
    knowledge: {
      nodes: [
        { id: 'K-LOTR-60', type: 'knows', content: 'The Dwarves of Erebor have been approached by Sauron\'s emissaries seeking the Ring' },
        { id: 'K-LOTR-61', type: 'believes', content: 'Dwarven axes and dwarven loyalty are worth more than any Elvish magic' },
        { id: 'K-LOTR-62', type: 'goal', content: 'Represent Durin\'s folk in the Fellowship and prove Dwarven valor to all' },
      ],
      edges: [
        { from: 'K-LOTR-60', to: 'K-LOTR-62', type: 'enables' },
        { from: 'K-LOTR-61', to: 'K-LOTR-62', type: 'supports' },
      ],
    },
  },
  'C-LOTR-08': {
    id: 'C-LOTR-08',
    name: 'Saruman the White',
    role: 'transient',
    threadIds: ['T-LOTR-05'],
    knowledge: {
      nodes: [
        { id: 'K-LOTR-70', type: 'knows', content: 'Has long studied the Ring-lore and believes he can locate the One Ring through the Palantir' },
        { id: 'K-LOTR-71', type: 'secret', content: 'Has communed with Sauron through the Palantir and been ensnared — now serves the Shadow while believing himself its master' },
        { id: 'K-LOTR-72', type: 'goal', content: 'Seize the One Ring and supplant Sauron as the Lord of Middle-earth' },
        { id: 'K-LOTR-73', type: 'believes', content: 'Power is the only answer to power — the age of the Istari serving from the shadows has ended' },
      ],
      edges: [
        { from: 'K-LOTR-70', to: 'K-LOTR-72', type: 'enables' },
        { from: 'K-LOTR-71', to: 'K-LOTR-72', type: 'supports' },
        { from: 'K-LOTR-73', to: 'K-LOTR-72', type: 'supports' },
        { from: 'K-LOTR-71', to: 'K-LOTR-73', type: 'enables' },
      ],
    },
  },
};

// ── Locations ────────────────────────────────────────────────────────────────
const locations: Record<string, Location> = {
  'L-LOTR-01': {
    id: 'L-LOTR-01', name: 'Middle-earth', parentId: null, threadIds: [],
    knowledge: {
      nodes: [
        { id: 'LK-LOTR-01', type: 'lore', content: 'The mortal lands of Arda — where Elves fade, Men rise, and the Shadow of Mordor lengthens across all kingdoms' },
        { id: 'LK-LOTR-02', type: 'lore', content: 'The Third Age draws to its close — the great powers diminish and the Ring stirs in its long sleep' },
      ],
      edges: [{ from: 'LK-LOTR-01', to: 'LK-LOTR-02', type: 'supports' }],
    },
  },
  'L-LOTR-02': {
    id: 'L-LOTR-02', name: 'The Shire', parentId: 'L-LOTR-01', threadIds: ['T-LOTR-02'],
    knowledge: {
      nodes: [
        { id: 'LK-LOTR-03', type: 'lore', content: 'Green and gentle land of the Hobbits — untouched by war for generations, sheltered by Rangers they have never seen' },
        { id: 'LK-LOTR-04', type: 'secret', content: 'The most dangerous object in Middle-earth has rested here for sixty years, mistaken for a trinket' },
      ],
      edges: [{ from: 'LK-LOTR-04', to: 'LK-LOTR-03', type: 'contradicts' }],
    },
  },
  'L-LOTR-03': {
    id: 'L-LOTR-03', name: 'Rivendell', parentId: 'L-LOTR-01', threadIds: ['T-LOTR-03', 'T-LOTR-04'],
    knowledge: {
      nodes: [
        { id: 'LK-LOTR-05', type: 'lore', content: 'The Last Homely House East of the Sea — Elrond\'s refuge where lore is preserved and counsel given' },
        { id: 'LK-LOTR-06', type: 'lore', content: 'Here the shards of Narsil are kept, and here the fate of the Ring will be debated by the Free Peoples' },
      ],
      edges: [{ from: 'LK-LOTR-05', to: 'LK-LOTR-06', type: 'supports' }],
    },
  },
  'L-LOTR-04': {
    id: 'L-LOTR-04', name: 'Moria', parentId: 'L-LOTR-01', threadIds: ['T-LOTR-04', 'T-LOTR-07'],
    knowledge: {
      nodes: [
        { id: 'LK-LOTR-07', type: 'lore', content: 'Khazad-dum, the Dwarrowdelf — once the greatest of Dwarven kingdoms, now a tomb of shadow and flame' },
        { id: 'LK-LOTR-08', type: 'danger', content: 'A Balrog of Morgoth dwells in the deepest depths, awakened by the Dwarves\' delving for mithril' },
      ],
      edges: [{ from: 'LK-LOTR-07', to: 'LK-LOTR-08', type: 'enables' }],
    },
  },
  'L-LOTR-05': {
    id: 'L-LOTR-05', name: 'Lothlórien', parentId: 'L-LOTR-01', threadIds: ['T-LOTR-01'],
    knowledge: {
      nodes: [
        { id: 'LK-LOTR-09', type: 'lore', content: 'The Golden Wood — realm of Galadriel and Celeborn, where time moves differently and mallorn trees shine with silver light' },
        { id: 'LK-LOTR-10', type: 'secret', content: 'Galadriel bears Nenya, the Ring of Water — if the One Ring is destroyed, her realm will fade' },
      ],
      edges: [{ from: 'LK-LOTR-10', to: 'LK-LOTR-09', type: 'supports' }],
    },
  },
  'L-LOTR-06': {
    id: 'L-LOTR-06', name: 'Amon Hen', parentId: 'L-LOTR-01', threadIds: ['T-LOTR-06', 'T-LOTR-04'],
    knowledge: {
      nodes: [
        { id: 'LK-LOTR-11', type: 'lore', content: 'The Hill of Sight — ancient Numenorean watchtower above the Falls of Rauros, where the Great River bends south' },
        { id: 'LK-LOTR-12', type: 'danger', content: 'Here the Fellowship will be tested to its breaking — Uruk-hai of Isengard are closing from the east' },
      ],
      edges: [{ from: 'LK-LOTR-11', to: 'LK-LOTR-12', type: 'supports' }],
    },
  },
  'L-LOTR-07': {
    id: 'L-LOTR-07', name: 'Isengard', parentId: 'L-LOTR-01', threadIds: ['T-LOTR-05'],
    knowledge: {
      nodes: [
        { id: 'LK-LOTR-13', type: 'lore', content: 'Orthanc, the tower of Saruman — once a bastion of the Istari, now a fortress of industry and war' },
        { id: 'LK-LOTR-14', type: 'danger', content: 'The caverns beneath Isengard birth Uruk-hai by the thousands — Saruman builds an army to rival Mordor' },
      ],
      edges: [{ from: 'LK-LOTR-13', to: 'LK-LOTR-14', type: 'enables' }],
    },
  },
  'L-LOTR-08': {
    id: 'L-LOTR-08', name: 'Weathertop', parentId: 'L-LOTR-01', threadIds: ['T-LOTR-01', 'T-LOTR-07'],
    knowledge: {
      nodes: [
        { id: 'LK-LOTR-15', type: 'lore', content: 'Amon Sul — ruined watchtower of the North Kingdom, where the Palantir once gazed across leagues of wilderness' },
        { id: 'LK-LOTR-16', type: 'danger', content: 'The Nazgul are drawn to this place — high ground and ancient power make it a beacon for the Ring-wraiths' },
      ],
      edges: [{ from: 'LK-LOTR-15', to: 'LK-LOTR-16', type: 'enables' }],
    },
  },
};

// ── Threads ──────────────────────────────────────────────────────────────────
const threads: Record<string, Thread> = {
  'T-LOTR-01': {
    id: 'T-LOTR-01',
    anchors: [{ id: 'C-LOTR-01', type: 'character' }],
    description: 'The burden of the Ring — its corruption seeps into every mind that touches it, promising power, whispering dominion, turning love into possession',
    status: 'dormant',
    openedAt: 'S-LOTR-001',
    dependents: ['T-LOTR-02', 'T-LOTR-06'],
  },
  'T-LOTR-02': {
    id: 'T-LOTR-02',
    anchors: [{ id: 'C-LOTR-01', type: 'character' }, { id: 'C-LOTR-04', type: 'character' }],
    description: 'Frodo\'s transformation — from a gentle hobbit of the Shire into a Ring-bearer scarred by a burden no mortal was meant to carry',
    status: 'dormant',
    openedAt: 'S-LOTR-001',
    dependents: [],
  },
  'T-LOTR-03': {
    id: 'T-LOTR-03',
    anchors: [{ id: 'C-LOTR-03', type: 'character' }],
    description: 'Aragorn\'s hidden kingship — Isildur\'s heir walks as a Ranger, bearing the weight of a lineage that both commands and condemns him',
    status: 'dormant',
    openedAt: 'S-LOTR-004',
    dependents: [],
  },
  'T-LOTR-04': {
    id: 'T-LOTR-04',
    anchors: [{ id: 'L-LOTR-03', type: 'location' }, { id: 'C-LOTR-02', type: 'character' }],
    description: 'The Fellowship\'s unity and fracture — nine walkers bound by oath, pulled apart by the Ring\'s will and the separate griefs they carry',
    status: 'dormant',
    openedAt: 'S-LOTR-006',
    dependents: ['T-LOTR-06'],
  },
  'T-LOTR-05': {
    id: 'T-LOTR-05',
    anchors: [{ id: 'C-LOTR-08', type: 'character' }, { id: 'L-LOTR-07', type: 'location' }],
    description: 'Saruman\'s betrayal and Isengard\'s corruption — the White Wizard fallen, breeding armies in the caverns beneath Orthanc, reaching for the Ring',
    status: 'dormant',
    openedAt: 'S-LOTR-003',
    dependents: ['T-LOTR-01'],
  },
  'T-LOTR-06': {
    id: 'T-LOTR-06',
    anchors: [{ id: 'C-LOTR-05', type: 'character' }],
    description: 'Boromir\'s internal struggle — a good man undone by love for his city and the Ring\'s whispered promise that he alone can save it',
    status: 'dormant',
    openedAt: 'S-LOTR-007',
    dependents: [],
  },
  'T-LOTR-07': {
    id: 'T-LOTR-07',
    anchors: [{ id: 'C-LOTR-01', type: 'character' }, { id: 'L-LOTR-06', type: 'location' }],
    description: 'The road to Mordor — the quest itself, each step south a step closer to the fire and the end of all things or the saving of them',
    status: 'dormant',
    openedAt: 'S-LOTR-002',
    dependents: ['T-LOTR-01', 'T-LOTR-04'],
  },
};

// ── Relationships ────────────────────────────────────────────────────────────
const relationships: RelationshipEdge[] = [
  { from: 'C-LOTR-01', to: 'C-LOTR-02', type: 'Trusts Gandalf absolutely — the wizard is the last pillar of certainty in a world gone dark', valence: 0.9 },
  { from: 'C-LOTR-02', to: 'C-LOTR-01', type: 'Sees in Frodo a courage that the great and wise lack — pity and admiration in equal measure', valence: 0.8 },
  { from: 'C-LOTR-01', to: 'C-LOTR-04', type: 'Sam is home — the last connection to the Shire and the person he was before the Ring', valence: 0.9 },
  { from: 'C-LOTR-04', to: 'C-LOTR-01', type: 'Would walk into Mordor barefoot for Mr. Frodo and never count the cost', valence: 0.95 },
  { from: 'C-LOTR-03', to: 'C-LOTR-01', type: 'Sworn to protect the Ring-bearer — sees in Frodo the hope his bloodline failed to preserve', valence: 0.7 },
  { from: 'C-LOTR-01', to: 'C-LOTR-03', type: 'The Ranger is strange and weather-worn but Gandalf vouches for him — trust growing slowly', valence: 0.5 },
  { from: 'C-LOTR-05', to: 'C-LOTR-03', type: 'Respects the Ranger but doubts his claim — Gondor needs a proven leader, not a wanderer', valence: 0.2 },
  { from: 'C-LOTR-03', to: 'C-LOTR-05', type: 'Sees Boromir\'s valor and his father\'s pride — worries both will break before they bend', valence: 0.4 },
  { from: 'C-LOTR-05', to: 'C-LOTR-01', type: 'The halfling carries the weapon that could save Gondor — and means to throw it away', valence: 0.1 },
  { from: 'C-LOTR-06', to: 'C-LOTR-07', type: 'An Elf — ancient enemy of the Dwarves, graceful and insufferable in equal parts', valence: -0.3 },
  { from: 'C-LOTR-07', to: 'C-LOTR-06', type: 'A Dwarf — stubborn and proud, yet not without a grudging respect beneath the bluster', valence: -0.3 },
  { from: 'C-LOTR-02', to: 'C-LOTR-08', type: 'Once trusted him as head of the Order — that trust is ash and betrayal now', valence: -0.8 },
  { from: 'C-LOTR-08', to: 'C-LOTR-02', type: 'Gandalf the Grey — a fool who clings to hobbits and lost causes when power beckons', valence: -0.6 },
];

// ── Arcs ─────────────────────────────────────────────────────────────────────
const arcs: Record<string, Arc> = {
  'SC-LOTR-01': {
    id: 'SC-LOTR-01',
    name: 'The Shadow of the Past',
    sceneIds: ['S-LOTR-001', 'S-LOTR-002', 'S-LOTR-003', 'S-LOTR-004', 'S-LOTR-005'],
    develops: ['T-LOTR-01', 'T-LOTR-02', 'T-LOTR-05'],
    locationIds: ['L-LOTR-01', 'L-LOTR-02', 'L-LOTR-07', 'L-LOTR-08'],
    activeCharacterIds: ['C-LOTR-01', 'C-LOTR-02', 'C-LOTR-03', 'C-LOTR-04', 'C-LOTR-08'],
    initialCharacterLocations: {
      'C-LOTR-01': 'L-LOTR-02',
      'C-LOTR-02': 'L-LOTR-02',
      'C-LOTR-03': 'L-LOTR-08',
      'C-LOTR-04': 'L-LOTR-02',
      'C-LOTR-08': 'L-LOTR-07',
    },
  },
  'SC-LOTR-02': {
    id: 'SC-LOTR-02',
    name: 'The Ring Goes South',
    sceneIds: ['S-LOTR-006', 'S-LOTR-007', 'S-LOTR-008', 'S-LOTR-009', 'S-LOTR-010'],
    develops: ['T-LOTR-04', 'T-LOTR-06', 'T-LOTR-07'],
    locationIds: ['L-LOTR-01', 'L-LOTR-03', 'L-LOTR-04', 'L-LOTR-05'],
    activeCharacterIds: ['C-LOTR-01', 'C-LOTR-02', 'C-LOTR-03', 'C-LOTR-04', 'C-LOTR-05', 'C-LOTR-06', 'C-LOTR-07'],
    initialCharacterLocations: {
      'C-LOTR-01': 'L-LOTR-03',
      'C-LOTR-02': 'L-LOTR-03',
      'C-LOTR-03': 'L-LOTR-03',
      'C-LOTR-04': 'L-LOTR-03',
      'C-LOTR-05': 'L-LOTR-03',
      'C-LOTR-06': 'L-LOTR-03',
      'C-LOTR-07': 'L-LOTR-03',
    },
  },
  'SC-LOTR-03': {
    id: 'SC-LOTR-03',
    name: 'The Breaking of the Fellowship',
    sceneIds: ['S-LOTR-011', 'S-LOTR-012', 'S-LOTR-013', 'S-LOTR-014', 'S-LOTR-015'],
    develops: ['T-LOTR-01', 'T-LOTR-06', 'T-LOTR-04'],
    locationIds: ['L-LOTR-01', 'L-LOTR-05', 'L-LOTR-06'],
    activeCharacterIds: ['C-LOTR-01', 'C-LOTR-03', 'C-LOTR-04', 'C-LOTR-05', 'C-LOTR-06', 'C-LOTR-07'],
    initialCharacterLocations: {
      'C-LOTR-01': 'L-LOTR-05',
      'C-LOTR-03': 'L-LOTR-05',
      'C-LOTR-04': 'L-LOTR-05',
      'C-LOTR-05': 'L-LOTR-05',
      'C-LOTR-06': 'L-LOTR-05',
      'C-LOTR-07': 'L-LOTR-05',
    },
  },
};

// ── Scenes ───────────────────────────────────────────────────────────────────
const scenes: Record<string, Scene> = {
  // ── Arc 1: The Shadow of the Past ─────────────────────────────────────────
  'S-LOTR-001': {
    id: 'S-LOTR-001',
    kind: 'scene',
    arcId: 'SC-LOTR-01',
    locationId: 'L-LOTR-02',
    participantIds: ['C-LOTR-01', 'C-LOTR-02', 'C-LOTR-04'],
    events: ['bilbo_farewell_party', 'ring_inheritance', 'gandalf_suspicion'],
    threadMutations: [{ threadId: 'T-LOTR-02', from: 'dormant', to: 'surfacing' }],
    knowledgeMutations: [],
    relationshipMutations: [],
    stakes: 15,
    prose: '',
    summary: 'Bag End, the Shire. Bilbo Baggins vanishes at his one-hundred-and-eleventh birthday party with a flash and a laugh, leaving behind everything he owns — including a plain gold ring on the mantelpiece. Frodo inherits it without understanding. Gandalf lingers by the fire, watching the ring where it lies, and the shadow in his eyes is older than the Shire. Sam tends the garden outside, humming, oblivious to the weight that has just changed hands in the room above.',
  },
  'S-LOTR-002': {
    id: 'S-LOTR-002',
    kind: 'scene',
    arcId: 'SC-LOTR-01',
    locationId: 'L-LOTR-02',
    participantIds: ['C-LOTR-01', 'C-LOTR-02'],
    events: ['ring_revealed', 'fire_test', 'quest_appointed'],
    threadMutations: [
      { threadId: 'T-LOTR-01', from: 'dormant', to: 'surfacing' },
      { threadId: 'T-LOTR-07', from: 'dormant', to: 'surfacing' },
    ],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-06', action: 'added', content: 'Gandalf cast the ring into the fire and letters of flame appeared — it is Sauron\'s One Ring' },
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-07', action: 'added', content: 'The Ring must leave the Shire or the Shire will be destroyed — he must carry it' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-02', type: 'The wizard has shattered his world but remains the only guide', valenceDelta: -0.1 },
    ],
    stakes: 25,
    prose: '',
    summary: 'Seventeen years later. Gandalf returns to Bag End with fire in his eyes and fear on his tongue. He casts the ring into Frodo\'s hearth — golden letters bloom in a language that chills the room. "One Ring to bring them all and in the darkness bind them." The truth falls like a hammer: Bilbo\'s trinket is the weapon of the Dark Lord. It must be taken from the Shire. Frodo looks at the ring cooling on his floor and feels, for the first time, that it is looking back.',
  },
  'S-LOTR-003': {
    id: 'S-LOTR-003',
    kind: 'scene',
    arcId: 'SC-LOTR-01',
    locationId: 'L-LOTR-07',
    participantIds: ['C-LOTR-02', 'C-LOTR-08'],
    characterMovements: { 'C-LOTR-02': 'L-LOTR-07' },
    events: ['saruman_revealed', 'gandalf_imprisoned', 'orthanc_betrayal'],
    threadMutations: [{ threadId: 'T-LOTR-05', from: 'dormant', to: 'surfacing' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-02', nodeId: 'K-LOTR-15', action: 'added', content: 'Saruman has betrayed the Order — he serves Sauron while dreaming of supplanting him' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-02', to: 'C-LOTR-08', type: 'Betrayal absolute — the White Wizard is an enemy now', valenceDelta: -0.5 },
    ],
    stakes: 40,
    prose: '',
    summary: 'Isengard. Gandalf rides to Orthanc seeking counsel and finds a stranger wearing Saruman\'s face. The White Wizard\'s robes shimmer with many colors — "I am Saruman of Many Colours," he declares, and the title is a confession. He offers Gandalf a choice: join him or be imprisoned. Gandalf refuses. Saruman hurls him to the pinnacle of Orthanc with a word. Below, the gardens of Isengard are torn open, and in the pits beneath, something terrible is being bred. Gandalf is a prisoner atop the tower, watching the smoke rise, with no way to warn the hobbit who carries the world\'s doom in his pocket.',
  },
  'S-LOTR-004': {
    id: 'S-LOTR-004',
    kind: 'scene',
    arcId: 'SC-LOTR-01',
    locationId: 'L-LOTR-08',
    participantIds: ['C-LOTR-01', 'C-LOTR-03', 'C-LOTR-04'],
    characterMovements: { 'C-LOTR-01': 'L-LOTR-08', 'C-LOTR-04': 'L-LOTR-08' },
    events: ['strider_appears', 'ranger_revealed', 'trust_tested'],
    threadMutations: [{ threadId: 'T-LOTR-03', from: 'dormant', to: 'surfacing' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-08', action: 'added', content: 'The Ranger called Strider knows of the Ring and claims to be a friend of Gandalf\'s — but Gandalf is missing' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-03', type: 'A dangerous stranger who may be the only hope on a road gone wrong', valenceDelta: 0.3 },
      { from: 'C-LOTR-04', to: 'C-LOTR-03', type: 'Does not trust this grim Ranger — but Mr. Frodo needs protecting', valenceDelta: 0.1 },
    ],
    stakes: 48,
    prose: '',
    summary: 'Weathertop. The hobbits huddle in the ruins of Amon Sul, Gandalf days overdue and fear thickening like fog. From the darkness steps a tall figure in a weather-stained cloak — Strider, Ranger of the North. His face is hard, his sword is broken, and he knows things no wanderer should. "Are you frightened?" he asks Frodo. "Yes." "Not nearly frightened enough. I know what hunts you." Sam grips his cooking pan like a weapon and places himself between the Ranger and his master. Trust has not yet arrived, but necessity has.',
  },
  'S-LOTR-005': {
    id: 'S-LOTR-005',
    kind: 'scene',
    arcId: 'SC-LOTR-01',
    locationId: 'L-LOTR-08',
    participantIds: ['C-LOTR-01', 'C-LOTR-03', 'C-LOTR-04'],
    events: ['nazgul_attack', 'morgul_blade', 'frodo_stabbed'],
    threadMutations: [
      { threadId: 'T-LOTR-01', from: 'surfacing', to: 'escalating' },
      { threadId: 'T-LOTR-02', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-LOTR-03', nodeId: 'K-LOTR-24', action: 'added', content: 'Frodo was stabbed by a Morgul blade — the shard works toward his heart, turning him into a wraith' },
      { characterId: 'C-LOTR-04', nodeId: 'K-LOTR-34', action: 'added', content: 'The black riders are real and they nearly killed Frodo — this is no adventure, this is war' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-04', to: 'C-LOTR-01', type: 'Nearly lost him — the terror of that moment will never leave', valenceDelta: 0.05 },
      { from: 'C-LOTR-01', to: 'C-LOTR-03', type: 'Strider fought the Nazgul with fire and fury — trust forged in terror', valenceDelta: 0.2 },
    ],
    stakes: 60,
    prose: '',
    summary: 'Night on Weathertop. Five shapes darker than darkness ascend the hill. The Nazgul have come. Frodo feels the Ring screaming to be worn and, in a moment of terrible weakness, slides it onto his finger. The world turns grey and he sees them as they truly are — ancient kings, hollow and burning with cold malice. The Witch-king drives a Morgul blade into Frodo\'s shoulder. Aragorn charges with torch and broken sword, scattering them with flame and fury. But the damage is done. A shard of the blade breaks off inside Frodo, working toward his heart. The race to Rivendell becomes a race against transformation — the Ring-bearer is becoming a wraith.',
  },

  // ── Arc 2: The Ring Goes South ────────────────────────────────────────────
  'S-LOTR-006': {
    id: 'S-LOTR-006',
    kind: 'scene',
    arcId: 'SC-LOTR-02',
    locationId: 'L-LOTR-03',
    participantIds: ['C-LOTR-01', 'C-LOTR-02', 'C-LOTR-03', 'C-LOTR-04', 'C-LOTR-05', 'C-LOTR-06', 'C-LOTR-07'],
    characterMovements: { 'C-LOTR-01': 'L-LOTR-03', 'C-LOTR-02': 'L-LOTR-03', 'C-LOTR-04': 'L-LOTR-03' },
    events: ['council_of_elrond', 'fellowship_formed', 'nine_walkers'],
    threadMutations: [
      { threadId: 'T-LOTR-04', from: 'dormant', to: 'surfacing' },
      { threadId: 'T-LOTR-05', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-LOTR-05', nodeId: 'K-LOTR-44', action: 'added', content: 'The Council has decided the Ring must be destroyed — Gondor\'s plea to use it was rejected by all' },
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-09', action: 'added', content: 'He volunteered to carry the Ring to Mordor — the words left his mouth before he understood them' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-05', to: 'C-LOTR-01', type: 'The halfling volunteered — brave or foolish, Gondor\'s fate now rests on small shoulders', valenceDelta: 0.1 },
      { from: 'C-LOTR-05', to: 'C-LOTR-03', type: 'This Ranger claims Isildur\'s throne — his sword is broken, his proof uncertain', valenceDelta: -0.1 },
    ],
    stakes: 55,
    prose: '',
    summary: 'The Council of Elrond. Representatives of every free people gather in Rivendell\'s open hall — Elves, Dwarves, Men, a wizard, and four hobbits who should not be there. Boromir argues passionately for using the Ring. Aragorn sits in shadow, silent. The debate spirals until Frodo stands — small, wounded, still pale from the Morgul blade — and says, "I will take it. I will take the Ring to Mordor. Though I do not know the way." The silence that follows is the sound of the world shifting. Nine are chosen to walk against Nine: the Fellowship of the Ring.',
  },
  'S-LOTR-007': {
    id: 'S-LOTR-007',
    kind: 'scene',
    arcId: 'SC-LOTR-02',
    locationId: 'L-LOTR-03',
    participantIds: ['C-LOTR-01', 'C-LOTR-03', 'C-LOTR-04', 'C-LOTR-05'],
    events: ['fellowship_departs', 'boromir_watches_ring', 'first_tension'],
    threadMutations: [
      { threadId: 'T-LOTR-06', from: 'dormant', to: 'surfacing' },
      { threadId: 'T-LOTR-05', from: 'escalating', to: 'resolved' },
    ],
    knowledgeMutations: [
      { characterId: 'C-LOTR-04', nodeId: 'K-LOTR-35', action: 'added', content: 'Boromir watches the Ring when he thinks no one is looking — Sam does not like the way his eyes change' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-04', to: 'C-LOTR-05', type: 'Something is wrong with the tall Man — the way he looks at Mr. Frodo\'s chain', valenceDelta: -0.2 },
    ],
    stakes: 57,
    prose: '',
    summary: 'The Fellowship departs Rivendell at dusk, taking the southern road beneath the Misty Mountains. Boromir teaches the hobbits swordplay on rest stops, laughing, generous — but Sam notices that his gaze drifts to the chain around Frodo\'s neck when the firelight catches it. Aragorn notices too and says nothing. The first thread of tension runs through the Company like a hairline crack in glass. The road south stretches long and uncertain, and the Ring rides at the center of them all, patient and warm against Frodo\'s chest.',
  },
  'S-LOTR-008': {
    id: 'S-LOTR-008',
    kind: 'scene',
    arcId: 'SC-LOTR-02',
    locationId: 'L-LOTR-04',
    participantIds: ['C-LOTR-01', 'C-LOTR-02', 'C-LOTR-03', 'C-LOTR-04', 'C-LOTR-05', 'C-LOTR-06', 'C-LOTR-07'],
    characterMovements: { 'C-LOTR-01': 'L-LOTR-04', 'C-LOTR-02': 'L-LOTR-04', 'C-LOTR-03': 'L-LOTR-04', 'C-LOTR-04': 'L-LOTR-04', 'C-LOTR-05': 'L-LOTR-04', 'C-LOTR-06': 'L-LOTR-04', 'C-LOTR-07': 'L-LOTR-04' },
    events: ['enter_moria', 'balin_tomb', 'drums_in_deep'],
    threadMutations: [{ threadId: 'T-LOTR-07', from: 'surfacing', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-07', nodeId: 'K-LOTR-63', action: 'added', content: 'Balin\'s colony is destroyed — the book of records ends mid-sentence: "They are coming"' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-06', to: 'C-LOTR-07', type: 'Shared grief at the Dwarven tomb softens ancient Elf-Dwarf enmity', valenceDelta: 0.2 },
    ],
    stakes: 68,
    prose: '',
    summary: 'Moria. The Fellowship enters the Dwarrowdelf through the Doors of Durin, choosing the dark road when the mountain pass fails them. The halls are vast and silent and strewn with Dwarf bones. Gimli finds Balin\'s tomb — his cousin, dead, the colony slaughtered. He weeps. Legolas stands beside him, hand on his shoulder, and neither speaks of the ancient feud between their peoples. Then Pippin drops a stone into a well, and from the deep, drums begin. "They are coming," Gandalf says, and his face is grey. The book of Mazarbul lies open at his feet, its last entry written in a dying hand.',
  },
  'S-LOTR-009': {
    id: 'S-LOTR-009',
    kind: 'scene',
    arcId: 'SC-LOTR-02',
    locationId: 'L-LOTR-04',
    participantIds: ['C-LOTR-01', 'C-LOTR-02', 'C-LOTR-03', 'C-LOTR-05', 'C-LOTR-06', 'C-LOTR-07'],
    events: ['balrog_appears', 'bridge_of_khazad_dum', 'gandalf_falls'],
    threadMutations: [
      { threadId: 'T-LOTR-04', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-0A', action: 'added', content: 'Gandalf fell with the Balrog into the abyss beneath the Bridge of Khazad-dum — he is gone' },
      { characterId: 'C-LOTR-03', nodeId: 'K-LOTR-25', action: 'added', content: 'Without Gandalf, leadership of the Fellowship falls to him — he is not ready but there is no one else' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-02', type: 'Grief beyond words — the pillar has fallen and the dark has no guide', valenceDelta: 0.1 },
      { from: 'C-LOTR-05', to: 'C-LOTR-03', type: 'With Gandalf gone, the Ranger must lead — and Boromir wonders if he should', valenceDelta: -0.1 },
    ],
    stakes: 75,
    prose: '',
    summary: 'The Bridge of Khazad-dum. Behind them, Orcs and cave-trolls. Before them, the narrow bridge. And from the deepest pit of Moria rises a Balrog — shadow and flame, a terror from the First Age. Gandalf turns alone on the bridge. "You cannot pass!" His staff shatters the stone. The Balrog falls — but its whip catches Gandalf and drags him into the abyss. "Fly, you fools!" are his last words. Aragorn drives the Fellowship onward through grief and firelight. They emerge into daylight on the eastern side of the mountains, and the world is emptier than it was an hour ago. Frodo sits on a rock and cannot weep because the loss is too large for tears.',
  },
  'S-LOTR-010': {
    id: 'S-LOTR-010',
    kind: 'scene',
    arcId: 'SC-LOTR-02',
    locationId: 'L-LOTR-05',
    participantIds: ['C-LOTR-01', 'C-LOTR-03', 'C-LOTR-04', 'C-LOTR-05', 'C-LOTR-06', 'C-LOTR-07'],
    characterMovements: { 'C-LOTR-01': 'L-LOTR-05', 'C-LOTR-03': 'L-LOTR-05', 'C-LOTR-04': 'L-LOTR-05', 'C-LOTR-05': 'L-LOTR-05', 'C-LOTR-06': 'L-LOTR-05', 'C-LOTR-07': 'L-LOTR-05' },
    events: ['lothlorien_respite', 'galadriels_mirror', 'ring_temptation'],
    threadMutations: [{ threadId: 'T-LOTR-01', from: 'escalating', to: 'threatened' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-0B', action: 'added', content: 'Galadriel refused the Ring when he offered it — even the great ones fear what it would make of them' },
      { characterId: 'C-LOTR-05', nodeId: 'K-LOTR-45', action: 'added', content: 'In the quiet of Lorien, the Ring\'s voice grows clearer — it promises Gondor saved, his father proud, the city shining' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-05', to: 'C-LOTR-01', type: 'The halfling offered the Ring to an Elf-witch but will not give it to Gondor\'s champion — resentment grows', valenceDelta: -0.2 },
    ],
    stakes: 70,
    prose: '',
    summary: 'Lothlorien. The Golden Wood receives them with silver light and the grief-songs of the Elves for Gandalf. Time softens here. Wounds are tended, tears are shed. But in the quiet, the Ring works. Frodo looks into Galadriel\'s Mirror and sees the Shire burning. He offers her the Ring in desperation. She is tempted — "All shall love me and despair!" — but refuses, diminishing into a simple Elf-woman who will fade with the Age. Meanwhile Boromir paces the golden walks alone, and the Ring whispers to him of white towers and his father\'s approval and an end to all the dying. He does not tell anyone what he hears.',
  },

  // ── Arc 3: The Breaking of the Fellowship ─────────────────────────────────
  'S-LOTR-011': {
    id: 'S-LOTR-011',
    kind: 'scene',
    arcId: 'SC-LOTR-03',
    locationId: 'L-LOTR-05',
    participantIds: ['C-LOTR-01', 'C-LOTR-03', 'C-LOTR-04', 'C-LOTR-05'],
    events: ['departure_lothlorien', 'boats_on_anduin', 'boromir_brooding'],
    threadMutations: [{ threadId: 'T-LOTR-06', from: 'surfacing', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-03', nodeId: 'K-LOTR-26', action: 'added', content: 'Boromir grows more distant each day — Aragorn can see the Ring\'s shadow lengthening across his face' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-03', to: 'C-LOTR-05', type: 'The Ring is breaking Boromir — pity and vigilance war in Aragorn\'s heart', valenceDelta: -0.1 },
    ],
    stakes: 75,
    prose: '',
    summary: 'The Fellowship departs Lothlorien in Elvish boats, riding the Great River Anduin southward. Galadriel\'s gifts shine among them — cloaks of grey-green, lembas bread, and a phial of starlight for Frodo. But the current carries more than boats. Boromir sits alone in his craft, staring south toward Gondor, his jaw set in a line that is not determination but hunger. Aragorn watches him from the stern and knows that the Fellowship is a rope fraying, and the question is only which strand snaps first.',
  },
  'S-LOTR-012': {
    id: 'S-LOTR-012',
    kind: 'scene',
    arcId: 'SC-LOTR-03',
    locationId: 'L-LOTR-06',
    participantIds: ['C-LOTR-01', 'C-LOTR-03', 'C-LOTR-04', 'C-LOTR-05'],
    characterMovements: { 'C-LOTR-01': 'L-LOTR-06', 'C-LOTR-03': 'L-LOTR-06', 'C-LOTR-04': 'L-LOTR-06', 'C-LOTR-05': 'L-LOTR-06', 'C-LOTR-06': 'L-LOTR-06', 'C-LOTR-07': 'L-LOTR-06' },
    events: ['amon_hen_camp', 'impossible_choice', 'frodo_alone'],
    threadMutations: [{ threadId: 'T-LOTR-07', from: 'escalating', to: 'threatened' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-0C', action: 'added', content: 'The choice is upon him — east to Mordor with the Company, or east alone before the Ring claims another friend' },
    ],
    relationshipMutations: [],
    stakes: 80,
    prose: '',
    summary: 'Amon Hen. The Company camps at the foot of the ancient watchtower, and Aragorn gives Frodo an hour to decide: which way? The question is not about geography. East lies Mordor and probable death. South lies Gondor and Boromir\'s desperate hope. But the true question is whether Frodo can trust anyone with the Ring\'s proximity for the weeks of road ahead. He climbs the hill alone and sits on the Seat of Seeing, and for a moment the world opens before him — armies marching, darkness spreading, the Eye sweeping like a searchlight. He tears the Ring from his finger just before it finds him.',
  },
  'S-LOTR-013': {
    id: 'S-LOTR-013',
    kind: 'scene',
    arcId: 'SC-LOTR-03',
    locationId: 'L-LOTR-06',
    participantIds: ['C-LOTR-01', 'C-LOTR-05'],
    events: ['boromir_snaps', 'ring_temptation_peak', 'frodo_invisible'],
    threadMutations: [
      { threadId: 'T-LOTR-06', from: 'escalating', to: 'threatened' },
      { threadId: 'T-LOTR-01', from: 'threatened', to: 'critical' },
    ],
    knowledgeMutations: [
      { characterId: 'C-LOTR-05', nodeId: 'K-LOTR-46', action: 'added', content: 'He tried to take the Ring by force — the madness was on him and he saw himself as he truly was' },
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-0D', action: 'added', content: 'Boromir tried to take the Ring — the Company is compromised, he must go to Mordor alone' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-05', type: 'The Ring broke Boromir — fear and sorrow, not hatred, for a good man undone', valenceDelta: -0.3 },
      { from: 'C-LOTR-05', to: 'C-LOTR-01', type: 'Horror at himself — what has he done, what has the Ring made him', valenceDelta: 0.3 },
    ],
    stakes: 88,
    prose: '',
    summary: 'The woods of Amon Hen. Boromir finds Frodo alone among the trees. He begins gently — "Lend me the Ring, just for a while" — but the gentleness curdles. The Ring speaks through him: Gondor\'s need, his father\'s grief, the armies that will burn the White City while a halfling stumbles toward a volcano. His eyes go wrong. He lunges. Frodo jams the Ring onto his finger and vanishes. Boromir crashes into the leaves where Frodo stood, groping at empty air, and the madness breaks. He kneels in the dirt, weeping. "What have I done?" But Frodo is already running, invisible and alone, toward the river and the eastern shore and Mordor.',
  },
  'S-LOTR-014': {
    id: 'S-LOTR-014',
    kind: 'scene',
    arcId: 'SC-LOTR-03',
    locationId: 'L-LOTR-06',
    participantIds: ['C-LOTR-03', 'C-LOTR-05', 'C-LOTR-06', 'C-LOTR-07'],
    events: ['uruk_hai_attack', 'boromir_last_stand', 'horn_of_gondor'],
    threadMutations: [
      { threadId: 'T-LOTR-04', from: 'escalating', to: 'threatened' },
      { threadId: 'T-LOTR-06', from: 'threatened', to: 'subverted' },
      { threadId: 'T-LOTR-03', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-LOTR-03', nodeId: 'K-LOTR-27', action: 'added', content: 'Boromir died defending the hobbits with three Uruk arrows in his chest — he redeemed himself at the last' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-03', to: 'C-LOTR-05', type: 'Boromir died as the man he was meant to be — Aragorn will honor that', valenceDelta: 0.4 },
    ],
    stakes: 93,
    prose: '',
    summary: 'The Uruk-hai of Isengard pour from the trees. Boromir, still tear-stained from his madness, hears the hobbits scream and charges. He fights like a man paying a debt — his sword sings, the Horn of Gondor splits the air, and Uruk after Uruk falls before him. One arrow strikes his shoulder. He fights on. A second pierces his side. He fights on. The third takes him through the chest. He falls to his knees, still swinging. Aragorn arrives too late to save him, just in time to hold him. "I would have followed you, my brother... my captain... my king." Boromir dies with Aragorn\'s hand on his brow and the light of Gondor fading from his eyes.',
  },
  'S-LOTR-015': {
    id: 'S-LOTR-015',
    kind: 'scene',
    arcId: 'SC-LOTR-03',
    locationId: 'L-LOTR-06',
    participantIds: ['C-LOTR-01', 'C-LOTR-04'],
    events: ['frodo_departs_alone', 'sam_follows', 'fellowship_broken'],
    threadMutations: [
      { threadId: 'T-LOTR-04', from: 'threatened', to: 'done' },
      { threadId: 'T-LOTR-02', from: 'escalating', to: 'threatened' },
    ],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-0E', action: 'added', content: 'The Fellowship is broken — he crosses the river alone, choosing the loneliest road to save those he loves' },
      { characterId: 'C-LOTR-04', nodeId: 'K-LOTR-36', action: 'added', content: 'Sam nearly drowned following Frodo — but a promise is a promise, and he will not leave him' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-04', type: 'Sam came after him — the one soul the Ring cannot corrupt, the one friend he cannot push away', valenceDelta: 0.1 },
      { from: 'C-LOTR-04', to: 'C-LOTR-01', type: 'I made a promise, Mr. Frodo — and I mean to keep it, even to Mordor and beyond', valenceDelta: 0.05 },
    ],
    stakes: 85,
    prose: '',
    summary: 'The eastern shore. Frodo pushes a boat into the river alone, weeping, choosing isolation to protect the others from the Ring\'s corruption. The Fellowship is broken. But a voice calls across the water — "Mr. Frodo!" — and Sam Gamgee plunges into the current, unable to swim, sinking, flailing. Frodo drags him aboard. "I made a promise," Sam gasps, river water streaming down his face. "Don\'t you leave him, Samwise Gamgee. And I don\'t mean to." Two hobbits in a grey boat on a dark river, the fires of Mordor somewhere ahead. The Fellowship of the Ring has ended. The journey of the Ring-bearer has begun.',
  },
};

// ── Commits ──────────────────────────────────────────────────────────────────
const diffNames: Record<string, string> = {
  'S-LOTR-001': 'ring_inherited',
  'S-LOTR-002': 'ring_revealed',
  'S-LOTR-003': 'saruman_betrayal',
  'S-LOTR-004': 'strider_appears',
  'S-LOTR-005': 'weathertop_attack',
  'S-LOTR-006': 'fellowship_formed',
  'S-LOTR-007': 'ring_goes_south',
  'S-LOTR-008': 'darkness_of_moria',
  'S-LOTR-009': 'gandalf_falls',
  'S-LOTR-010': 'lothlorien_temptation',
  'S-LOTR-011': 'river_journey',
  'S-LOTR-012': 'seat_of_seeing',
  'S-LOTR-013': 'boromir_breaks',
  'S-LOTR-014': 'last_stand',
  'S-LOTR-015': 'fellowship_broken',
};

const sceneList = Object.values(scenes);
const commits: Commit[] = sceneList.map((scene, i) => ({
  id: `CM-LOTR-${String(i + 1).padStart(3, '0')}`,
  parentId: i === 0 ? null : `CM-LOTR-${String(i).padStart(3, '0')}`,
  sceneId: scene.id,
  arcId: scene.arcId,
  diffName: diffNames[scene.id] ?? 'thread_surfaced',
  threadMutations: scene.threadMutations,
  knowledgeMutations: scene.knowledgeMutations,
  relationshipMutations: scene.relationshipMutations,
  authorOverride: null,
  createdAt: Date.now() - (15 - i) * 3600000,
}));

// ── Alternate Branch: "What if Boromir Resisted the Ring" ────────────────────
// Diverges after S-LOTR-010 — Boromir masters his desire and the Fellowship
// remains whole, taking a radically different path to Mordor.

const altArc: Arc = {
  id: 'SC-LOTR-03-ALT',
  name: 'The Unbroken Fellowship',
  sceneIds: ['S-LOTR-ALT-011', 'S-LOTR-ALT-012', 'S-LOTR-ALT-013', 'S-LOTR-ALT-014', 'S-LOTR-ALT-015'],
  develops: ['T-LOTR-06', 'T-LOTR-04'],
  locationIds: ['L-LOTR-01', 'L-LOTR-05', 'L-LOTR-06'],
  activeCharacterIds: ['C-LOTR-01', 'C-LOTR-03', 'C-LOTR-04', 'C-LOTR-05', 'C-LOTR-06', 'C-LOTR-07'],
  initialCharacterLocations: {
    'C-LOTR-01': 'L-LOTR-05',
    'C-LOTR-03': 'L-LOTR-05',
    'C-LOTR-04': 'L-LOTR-05',
    'C-LOTR-05': 'L-LOTR-05',
    'C-LOTR-06': 'L-LOTR-05',
    'C-LOTR-07': 'L-LOTR-05',
  },
};

const altScenes: Record<string, Scene> = {
  'S-LOTR-ALT-011': {
    id: 'S-LOTR-ALT-011',
    kind: 'scene',
    arcId: 'SC-LOTR-03-ALT',
    locationId: 'L-LOTR-05',
    participantIds: ['C-LOTR-03', 'C-LOTR-05'],
    events: ['boromir_confession', 'aragorn_counsel', 'ring_resisted'],
    threadMutations: [{ threadId: 'T-LOTR-06', from: 'surfacing', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-05', nodeId: 'K-LOTR-47', action: 'added', content: 'Confessed to Aragorn that the Ring calls to him — asked for help resisting what he fears he cannot fight alone' },
      { characterId: 'C-LOTR-03', nodeId: 'K-LOTR-28', action: 'added', content: 'Boromir came to him in honesty — there is more strength in this Man of Gondor than the Ring accounts for' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-03', to: 'C-LOTR-05', type: 'Boromir\'s honesty reveals the man beneath the pride — true valor', valenceDelta: 0.3 },
      { from: 'C-LOTR-05', to: 'C-LOTR-03', type: 'The Ranger listened without judgment — perhaps he is worthy of the crown after all', valenceDelta: 0.3 },
    ],
    stakes: 75,
    prose: '',
    summary: 'The golden eaves of Lothlorien. Boromir finds Aragorn at the edge of the wood and does what no one expected — he confesses. "The Ring speaks to me. It shows me Minas Tirith saved, my father\'s face without grief. I know these are lies, and still I want to believe them." Aragorn is quiet for a long time. Then: "Isildur could not let it go. I have feared that weakness in my blood all my life. You are not weak for hearing its voice, Boromir. You are strong for speaking this aloud." Something shifts between them — not friendship yet, but the first stone of a bridge.',
  },
  'S-LOTR-ALT-012': {
    id: 'S-LOTR-ALT-012',
    kind: 'scene',
    arcId: 'SC-LOTR-03-ALT',
    locationId: 'L-LOTR-06',
    participantIds: ['C-LOTR-01', 'C-LOTR-03', 'C-LOTR-04', 'C-LOTR-05', 'C-LOTR-06', 'C-LOTR-07'],
    characterMovements: { 'C-LOTR-01': 'L-LOTR-06', 'C-LOTR-03': 'L-LOTR-06', 'C-LOTR-04': 'L-LOTR-06', 'C-LOTR-05': 'L-LOTR-06', 'C-LOTR-06': 'L-LOTR-06', 'C-LOTR-07': 'L-LOTR-06' },
    events: ['amon_hen_united', 'fellowship_chooses_together', 'plan_to_mordor'],
    threadMutations: [{ threadId: 'T-LOTR-04', from: 'escalating', to: 'threatened' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-0F', action: 'added', content: 'The Fellowship will not break — they choose together to take the eastern road into Mordor as one Company' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-05', type: 'Boromir knelt and swore to protect the Ring-bearer — his eyes were clear and his voice did not shake', valenceDelta: 0.3 },
    ],
    stakes: 78,
    prose: '',
    summary: 'Amon Hen. The Company gathers where the ancient watchtower looks east. Aragorn puts the question plainly: the road divides, and so must their purpose or their unity. Boromir stands and speaks — not of Gondor\'s need but of the Company\'s. "I will not take the Ring. I will not ask for it. I will walk beside the bearer into the dark." He kneels before Frodo, and the gesture is not submission but promise. One by one, the others affirm it. The Fellowship chooses, together, the road to Mordor. It is harder this way. And it is right.',
  },
  'S-LOTR-ALT-013': {
    id: 'S-LOTR-ALT-013',
    kind: 'scene',
    arcId: 'SC-LOTR-03-ALT',
    locationId: 'L-LOTR-06',
    participantIds: ['C-LOTR-03', 'C-LOTR-05', 'C-LOTR-06', 'C-LOTR-07'],
    events: ['uruk_hai_attack_alt', 'boromir_fights', 'horn_sounds_victory'],
    threadMutations: [
      { threadId: 'T-LOTR-03', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-LOTR-05', nodeId: 'K-LOTR-48', action: 'added', content: 'Fought the Uruk-hai and survived — the Horn of Gondor rang not in defeat but in defiance' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-06', to: 'C-LOTR-07', type: 'Fought back-to-back against the Uruk-hai — Elf and Dwarf as brothers-in-arms', valenceDelta: 0.3 },
      { from: 'C-LOTR-07', to: 'C-LOTR-06', type: 'The Elf is nimble and deadly and pulled him from an Orc blade — a debt and a friendship', valenceDelta: 0.3 },
    ],
    stakes: 85,
    prose: '',
    summary: 'The Uruk-hai of Isengard attack at Amon Hen, as they were always going to. But this time, Boromir is not alone and broken with guilt. He fights alongside Aragorn, shield to sword. The Horn of Gondor rings across the Anduin — not a cry for help but a war-horn of the House of Hurin sounding in defiance. Legolas and Gimli hold the eastern flank, and between them something has changed: the Dwarf pulls the Elf from an Orc\'s reach, and the Elf returns the favor a heartbeat later. When the Uruks retreat, Boromir stands bloody but alive. The arrows that should have killed him found shields instead of flesh.',
  },
  'S-LOTR-ALT-014': {
    id: 'S-LOTR-ALT-014',
    kind: 'scene',
    arcId: 'SC-LOTR-03-ALT',
    locationId: 'L-LOTR-06',
    participantIds: ['C-LOTR-01', 'C-LOTR-04', 'C-LOTR-05'],
    events: ['boromir_guards_frodo', 'ring_whispers_rejected', 'bond_forged'],
    threadMutations: [
      { threadId: 'T-LOTR-06', from: 'escalating', to: 'resolved' },
      { threadId: 'T-LOTR-01', from: 'threatened', to: 'critical' },
    ],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-0G', action: 'added', content: 'Boromir stood guard over him during the battle and never once reached for the Ring — the man is stronger than the curse' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-05', type: 'Trust reforged — Boromir protected him when the Ring was most vulnerable', valenceDelta: 0.4 },
      { from: 'C-LOTR-05', to: 'C-LOTR-01', type: 'Guarded the Ring-bearer and felt the Ring scream at him the entire time — and held', valenceDelta: 0.2 },
    ],
    stakes: 83,
    prose: '',
    summary: 'In the aftermath of battle, Frodo realizes what happened: Boromir stood over him during the assault, blade raised against the Uruks, with the Ring hanging inches from his hand. The Ring screamed at Boromir the entire time — take it, take it, take it — and he did not. Sam sees it too, and for the first time the gardener from Hobbiton looks at the Man of Gondor without suspicion. "Thank you," Frodo says. Boromir\'s voice is rough. "I hear it still. But I hear my own voice louder now." The Ring\'s corruption is not broken. But it has been answered, and that answer changes everything.',
  },
  'S-LOTR-ALT-015': {
    id: 'S-LOTR-ALT-015',
    kind: 'scene',
    arcId: 'SC-LOTR-03-ALT',
    locationId: 'L-LOTR-06',
    participantIds: ['C-LOTR-01', 'C-LOTR-03', 'C-LOTR-04', 'C-LOTR-05', 'C-LOTR-06', 'C-LOTR-07'],
    events: ['fellowship_unbroken', 'eastern_road_together', 'new_path'],
    threadMutations: [
      { threadId: 'T-LOTR-04', from: 'threatened', to: 'resolved' },
      { threadId: 'T-LOTR-07', from: 'escalating', to: 'threatened' },
    ],
    knowledgeMutations: [
      { characterId: 'C-LOTR-03', nodeId: 'K-LOTR-29', action: 'added', content: 'The Fellowship holds — nine walkers diminished by Gandalf\'s fall but unbroken, taking the eastern road as one' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-03', to: 'C-LOTR-05', type: 'Boromir is the brother Aragorn never had — forged in fire and honesty', valenceDelta: 0.2 },
      { from: 'C-LOTR-05', to: 'C-LOTR-03', type: 'My captain, my king — spoken not in death but in life, and meaning it', valenceDelta: 0.3 },
    ],
    stakes: 80,
    prose: '',
    summary: 'Dawn at Amon Hen. The Fellowship stands together at the river\'s edge, looking east. In the canon timeline, this is where everything fell apart — Boromir dead, Frodo fled, the Company scattered to three separate storylines. In this one, they board the boats as one. Boromir and Aragorn sit in the same craft, and the silence between them is the silence of soldiers who have made their peace. Frodo still feels the Ring\'s weight, but Sam is at his left hand and Boromir — impossibly, miraculously — is at his right, and neither flinches. The road to Mordor will be harder with a full Company drawing the Enemy\'s eye. But there is a strength in nine that two hobbits alone could never carry. The Fellowship of the Ring continues.',
  },
};

// ── Initial World Building Commit ────────────────────────────────────────────
const wxInitCommit: WorldBuildCommit = {
  kind: 'world_build',
  id: 'WX-LOTR-init',
  summary: 'World created: 8 characters (Frodo Baggins, Gandalf the Grey, Aragorn, Samwise Gamgee, Boromir, Legolas, Gimli, Saruman the White), 8 locations (Middle-earth, The Shire, Rivendell, Moria, Lothlorien, Amon Hen, Isengard, Weathertop), 7 threads, 13 relationships',
  expansionManifest: {
    characterIds: Object.keys(characters),
    locationIds: Object.keys(locations),
    threadIds: Object.keys(threads),
    relationshipCount: relationships.length,
  },
};

const allScenes: Record<string, Scene> = { ...scenes, ...altScenes };
const allWorldBuilds: Record<string, WorldBuildCommit> = { 'WX-LOTR-init': wxInitCommit };
const allArcs: Record<string, Arc> = { ...arcs, [altArc.id]: altArc };

// ── Branches ────────────────────────────────────────────────────────────────
const branches: Record<string, Branch> = {
  'B-LOTR-MAIN': {
    id: 'B-LOTR-MAIN',
    name: 'Canon Timeline',
    parentBranchId: null,
    forkEntryId: null,
    entryIds: ['WX-LOTR-init', ...Object.keys(scenes)],
    createdAt: Date.now() - 86400000,
  },
  'B-LOTR-UNBROKEN': {
    id: 'B-LOTR-UNBROKEN',
    name: 'What if Boromir Resisted the Ring',
    parentBranchId: 'B-LOTR-MAIN',
    forkEntryId: 'S-LOTR-010',
    entryIds: Object.keys(altScenes),
    createdAt: Date.now() - 43200000,
  },
};

// ── Assembled Narrative ──────────────────────────────────────────────────────
export const seedLOTR: NarrativeState = {
  id: 'N-LOTR',
  title: 'The Lord of the Rings — The Fellowship of the Ring',
  description: 'A hobbit of the Shire inherits the most dangerous object in Middle-earth — the One Ring of Sauron, instrument of absolute dominion. From green hills to grey mountains, through fire and shadow and the golden wood, nine walkers carry the fate of all free peoples toward the furnace where the Ring was made. The Fellowship will break. The question is whether what breaks with it is the world, or only the bonds between those who tried to save it.',
  characters,
  locations,
  threads,
  arcs: allArcs,
  scenes: allScenes,
  worldBuilds: allWorldBuilds,
  branches,
  commits,
  relationships,
  worldSummary: 'Middle-earth stands at the end of its Third Age. The Dark Lord Sauron, defeated but not destroyed, rebuilds his strength in Mordor and reaches for the One Ring — the master weapon he forged to dominate all life. The Ring has been found in the most unlikely place: the pocket of a hobbit in the Shire, passed from Bilbo to Frodo Baggins. Gandalf the Grey confirms its identity and sets in motion a desperate plan: the Ring must be carried to Mount Doom and unmade in the fire where it was forged. Nine companions — hobbits, a wizard, a ranger-king, an elf, a dwarf, and a man of Gondor — form the Fellowship of the Ring. But the Ring has a will of its own, and it works on each of them differently: through pride, through grief, through love for home. The road south is the story of that corruption, and of the small, stubborn, improbable courage that resists it.',
  controlMode: 'auto',
  activeForces: { stakes: 0, pacing: 0, variety: 0 },
  coverImageUrl: '/covers/lotr.jpg',
  createdAt: Date.now() - 86400000,
  updatedAt: Date.now(),
};
