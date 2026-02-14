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
    imagePrompt: 'A young hobbit with pale skin, large expressive blue eyes, and dark curly hair. Slight build, wearing a mithril shirt beneath a weathered green cloak, the One Ring on a chain around his neck glinting faintly.',
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
    imagePrompt: 'A tall, elderly wizard with a long grey beard, bushy eyebrows, and keen eyes beneath a wide-brimmed pointed grey hat. He wears flowing grey robes and carries a gnarled wooden staff, pipe smoke curling around him.',
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
    imagePrompt: 'A tall, weather-beaten Ranger with shoulder-length dark hair, grey eyes, and a short beard. He wears a worn leather jerkin over travel-stained clothing, the broken sword Narsil at his side, his expression stern and watchful.',
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
    imagePrompt: 'A stout, sturdy hobbit with a round, honest face, sandy-brown curly hair, and warm brown eyes. He wears simple gardener\'s clothes — a brown waistcoat and rolled sleeves — with a heavy pack and a coil of Elvish rope.',
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
    imagePrompt: 'A tall, broad-shouldered warrior with proud features, a strong jaw, and reddish-brown hair. He wears the plate and leather armor of Gondor, a cloven silver horn at his belt, and carries a great round shield.',
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
    imagePrompt: 'A tall, slender Elf with long straight golden hair, bright blue eyes, and ageless, fair features. He wears forest-green and brown woodland garb, a longbow of the Mirkwood Elves slung across his back, moving with preternatural grace.',
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
    imagePrompt: 'A stocky, powerfully built Dwarf with a thick red beard braided with iron clasps, fierce dark eyes beneath a heavy brow, and a gleaming steel helm. He wears chainmail and carries a broad-bladed battle axe.',
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
    imagePrompt: 'A tall, imposing wizard with a long white beard, a high forehead, and dark calculating eyes. He wears robes that shimmer with many colors beneath the white, and carries a black iron staff topped with a sharp spike.',
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
    imagePrompt: 'A vast panoramic landscape stretching from green rolling hills to snow-capped mountains and dark volcanic plains, golden sunlight breaking through dramatic clouds over ancient forests and winding rivers.',
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
    imagePrompt: 'Lush green rolling hills dotted with round hobbit doors set into grassy mounds, smoke rising from chimneys, a winding lane bordered by hedgerows and wildflowers under a warm golden afternoon sky.',
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
    imagePrompt: 'An elegant Elven valley with graceful stone bridges arching over waterfalls, slender towers with pointed arches nestled among ancient pines, soft golden light filtering through autumn leaves into a hidden mountain gorge.',
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
    imagePrompt: 'A colossal underground Dwarven hall with towering stone columns carved into the living rock, stretching into darkness. Faint torchlight reveals intricate geometric carvings and vast echoing emptiness, dust motes drifting in shafts of pale light from cracks above.',
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
    imagePrompt: 'An enchanted forest of impossibly tall silver-barked mallorn trees with golden leaves, soft ethereal light glowing from Elven lanterns among the high branches, wooden platforms and stairways spiraling up into the luminous canopy.',
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
    imagePrompt: 'A forested hilltop above a great river with thundering waterfalls, a crumbling stone seat of ancient Numenorean craft overlooking the misty falls of Rauros, dappled light through old-growth trees with a brooding overcast sky.',
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
    imagePrompt: 'A black stone tower of Orthanc rising from a ring-wall of dark rock, surrounded by pits of fire and industrial smoke where ancient trees have been felled, iron machinery and forges glowing red beneath a haze-choked sky.',
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
    imagePrompt: 'A desolate, wind-swept hilltop crowned with the crumbling ruins of an ancient stone watchtower, jagged walls silhouetted against a stormy twilight sky, the surrounding wilderness stretching dark and empty in every direction.',
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
    name: 'A Long-Expected Party',
    sceneIds: ['S-LOTR-001', 'S-LOTR-002', 'S-LOTR-003', 'S-LOTR-004', 'S-LOTR-005', 'S-LOTR-006', 'S-LOTR-007'],
    develops: ['T-LOTR-01', 'T-LOTR-02'],
    locationIds: ['L-LOTR-02'],
    activeCharacterIds: ['C-LOTR-01', 'C-LOTR-02', 'C-LOTR-04'],
    initialCharacterLocations: {
      'C-LOTR-01': 'L-LOTR-02',
      'C-LOTR-02': 'L-LOTR-02',
      'C-LOTR-04': 'L-LOTR-02',
    },
  },
  'SC-LOTR-02': {
    id: 'SC-LOTR-02',
    name: 'The Shadow of the Past',
    sceneIds: ['S-LOTR-008', 'S-LOTR-009', 'S-LOTR-010', 'S-LOTR-011', 'S-LOTR-012', 'S-LOTR-013'],
    develops: ['T-LOTR-01', 'T-LOTR-02', 'T-LOTR-07'],
    locationIds: ['L-LOTR-02', 'L-LOTR-08'],
    activeCharacterIds: ['C-LOTR-01', 'C-LOTR-02', 'C-LOTR-03', 'C-LOTR-04'],
    initialCharacterLocations: {
      'C-LOTR-01': 'L-LOTR-02',
      'C-LOTR-02': 'L-LOTR-02',
      'C-LOTR-03': 'L-LOTR-08',
      'C-LOTR-04': 'L-LOTR-02',
    },
  },
};

// ── Scenes ───────────────────────────────────────────────────────────────────
const scenes: Record<string, Scene> = {
  // ── Arc 1: A Long-Expected Party ──────────────────────────────────────────
  'S-LOTR-001': {
    id: 'S-LOTR-001',
    kind: 'scene',
    arcId: 'SC-LOTR-01',
    locationId: 'L-LOTR-02',
    povId: 'C-LOTR-01',
    participantIds: ['C-LOTR-01', 'C-LOTR-04'],
    events: ['party_preparations', 'lanterns_hung', 'shire_gossip'],
    threadMutations: [],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-100', action: 'added', content: 'Bilbo has grown strange — standing at the window after dark, turning a gold ring over and over, murmuring in unknown languages' },
      { characterId: 'C-LOTR-04', nodeId: 'K-LOTR-101', action: 'added', content: 'A hundred and eleven candles for Mr. Bilbo — the old hobbit is planning something grand and peculiar' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-04', type: 'Sam is steady company on a warm afternoon — the world feels right with him nearby', valenceDelta: 0.1 },
    ],
    summary: 'The fields below Bag End have been strung with paper lanterns in the shape of fish and moons. Hobbiton is alive with rumour: a hundred and forty-four guests, a pavilion as wide as a barn, and fireworks ordered from a wizard. Frodo helps Sam carry trestle tables down the hill, both of them sweating in the late-September sun. "Do you reckon he\'ll really do it, Mr. Frodo? A hundred and eleven is a powerful lot of candles." Frodo laughs but does not answer, because Bilbo has been strange lately — standing at the window after dark, turning a small gold ring over and over in his pocket, murmuring to himself in languages Frodo does not recognize.',
  },
  'S-LOTR-002': {
    id: 'S-LOTR-002',
    kind: 'scene',
    arcId: 'SC-LOTR-01',
    locationId: 'L-LOTR-02',
    povId: 'C-LOTR-01',
    participantIds: ['C-LOTR-01', 'C-LOTR-04'],
    events: ['bag_end_evening', 'bilbo_stories', 'old_maps'],
    threadMutations: [],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-102', action: 'added', content: 'Bilbo speaks of leaving the Shire — of seeing the mountains again and finding somewhere quiet to finish his book' },
      { characterId: 'C-LOTR-04', nodeId: 'K-LOTR-103', action: 'added', content: 'The last roses of the season are fading — everything has its time and its ending' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-04', type: 'Sam tends the garden with quiet devotion while the world inside Bag End shifts', valenceDelta: 0.05 },
    ],
    summary: 'A quiet evening at Bag End, the round door closed against the autumn chill. Bilbo sits by the fire with his old maps spread across his knees, tracing a route through the Misty Mountains with a fingernail while Frodo reads in the armchair opposite. "I should like to see the mountains again, Frodo," Bilbo says, as though remarking on the weather. "And then find somewhere quiet where I can finish my book." The fire pops. Outside, Sam trims the last roses of the season, and beyond the hedge, the Shire rolls on in its green and comfortable ignorance — a land that has never heard of Mordor and does not wish to.',
  },
  'S-LOTR-003': {
    id: 'S-LOTR-003',
    kind: 'scene',
    arcId: 'SC-LOTR-01',
    locationId: 'L-LOTR-02',
    povId: 'C-LOTR-01',
    participantIds: ['C-LOTR-01', 'C-LOTR-02', 'C-LOTR-04'],
    events: ['bilbo_farewell_party', 'ring_inheritance', 'gandalf_suspicion'],
    threadMutations: [{ threadId: 'T-LOTR-02', from: 'dormant', to: 'active' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-104', action: 'added', content: 'Bilbo vanished at his own party with a flash — left behind everything, including a plain gold ring on the mantelpiece' },
      { characterId: 'C-LOTR-02', nodeId: 'K-LOTR-105', action: 'added', content: 'The ring Bilbo left behind troubles him deeply — the way it sat on the mantelpiece, patient and waiting' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-02', to: 'C-LOTR-01', type: 'Gandalf watches Frodo inherit the ring with a grief he cannot yet explain', valenceDelta: 0.1 },
    ],
    summary: 'Bilbo Baggins vanishes at his one-hundred-and-eleventh birthday party with a flash and a laugh, leaving behind everything he owns — including a plain gold ring on the mantelpiece. The guests murmur and shake their heads; Hobbiton has always thought Bilbo peculiar, and this confirms it. Frodo inherits the ring without understanding what it is. Gandalf lingers by the hearth long after the last guest has stumbled home, watching the little band of gold where it lies on the wood, and the shadow in his eyes is older than the Shire itself. He says nothing to Frodo. Not yet.',
  },
  'S-LOTR-004': {
    id: 'S-LOTR-004',
    kind: 'scene',
    arcId: 'SC-LOTR-01',
    locationId: 'L-LOTR-02',
    povId: 'C-LOTR-01',
    participantIds: ['C-LOTR-01', 'C-LOTR-04'],
    events: ['shire_walk', 'green_dragon_pub', 'rumours_of_outside'],
    threadMutations: [{ threadId: 'T-LOTR-05', from: 'dormant', to: 'active' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-106', action: 'added', content: 'The ring is always in his pocket now — he carries it without knowing why, warm and patient against his hip' },
      { characterId: 'C-LOTR-04', nodeId: 'K-LOTR-107', action: 'added', content: 'Old Gaffer says there are queer folk on the East Road — Elves and Dwarves and worse, foreigners all' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-04', to: 'C-LOTR-01', type: 'A quiet pint together at the Green Dragon — Sam watches over Frodo without knowing it', valenceDelta: 0.1 },
    ],
    summary: 'A summer day some months after the party, and the Shire has nearly forgotten Bilbo Baggins. Frodo and Sam walk the lane from Hobbiton to Bywater in no particular hurry, the hedgerows thick with blackberries. They stop at the Green Dragon for a pint of ale. Old Gaffer Gamgee holds court in the corner, complaining about foreigners on the East Road. "Elves and Dwarves and worse," he mutters. "There\'s queer folk about." Sam blushes. Frodo listens more carefully than he lets on. The ring is in his pocket — he always carries it now, though he could not say why — and it sits there, warm and patient and utterly without menace. Or so it seems.',
  },
  'S-LOTR-005': {
    id: 'S-LOTR-005',
    kind: 'scene',
    arcId: 'SC-LOTR-01',
    locationId: 'L-LOTR-02',
    povId: 'C-LOTR-04',
    participantIds: ['C-LOTR-04'],
    events: ['sam_gardening', 'overheard_conversation', 'gandalf_warning'],
    threadMutations: [{ threadId: 'T-LOTR-07', from: 'dormant', to: 'dormant' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-04', nodeId: 'K-LOTR-108', action: 'added', content: 'Overheard Gandalf through the window — the enemy, the Shire no longer safe — something terrible is coming' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-04', to: 'C-LOTR-02', type: 'The wizard speaks in a tone Sam has never heard — low and urgent, stripped of all merriment', valenceDelta: 0.15 },
    ],
    summary: 'Sam is on his knees in the garden below Bag End\'s study window, weeding between the snapdragons, when he hears Gandalf\'s voice through the open casement. The wizard has returned after a long absence, and he is speaking to Frodo in a tone Sam has never heard from him before — low and urgent, stripped of all merriment. Sam catches only fragments: "...the enemy...the Shire is no longer safe..." He presses closer to the wall, trowel forgotten, heart hammering. A bee hums past his ear. The snapdragons nod in the breeze. Whatever is being said inside that round green door, Sam understands with the bone-deep certainty of a gardener that the season has changed.',
  },
  'S-LOTR-006': {
    id: 'S-LOTR-006',
    kind: 'scene',
    arcId: 'SC-LOTR-01',
    locationId: 'L-LOTR-02',
    povId: 'C-LOTR-01',
    participantIds: ['C-LOTR-01', 'C-LOTR-02'],
    events: ['ring_revealed', 'fire_test', 'shadow_of_the_past'],
    threadMutations: [{ threadId: 'T-LOTR-01', from: 'dormant', to: 'active' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-06', action: 'added', content: 'Gandalf cast the ring into the fire and letters of flame appeared — it is Sauron\'s One Ring' },
      { characterId: 'C-LOTR-02', nodeId: 'K-LOTR-109', action: 'added', content: 'The inscription confirms it beyond doubt — One Ring to rule them all. It has been in the Shire for sixty years' },
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-110', action: 'added', content: 'Sauron is rebuilding in the Dark Tower and his malice reaches across all leagues — the Shire is no shelter' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-02', type: 'The wizard has shattered his world but remains the only guide', valenceDelta: -0.1 },
    ],
    summary: 'Gandalf returns to Bag End after seventeen years of silence, and this time there is no laughter in him. He takes the ring from the mantelpiece with tongs — he will not touch it — and casts it into the hearth. Golden letters bloom on the band in a language that chills the room to its bones. "One Ring to bring them all and in the darkness bind them." Frodo stares at the inscription crawling across the metal and understands, without being told, that the comfortable life he has known is over. The ring cools on the hearthstone, innocent and golden, and Gandalf tells him of Sauron, of the Dark Tower, of a malice that is reaching out across the leagues. The Shire seems very small.',
  },
  'S-LOTR-007': {
    id: 'S-LOTR-007',
    kind: 'scene',
    arcId: 'SC-LOTR-01',
    locationId: 'L-LOTR-02',
    povId: 'C-LOTR-02',
    participantIds: ['C-LOTR-01', 'C-LOTR-02', 'C-LOTR-04'],
    events: ['sam_caught', 'quest_appointed', 'companions_chosen'],
    threadMutations: [{ threadId: 'T-LOTR-07', from: 'dormant', to: 'active' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-07', action: 'added', content: 'The Ring must leave the Shire or the Shire will be destroyed — he must carry it east' },
      { characterId: 'C-LOTR-04', nodeId: 'K-LOTR-34', action: 'added', content: 'Was caught eavesdropping and now must go with Frodo — Gandalf said "don\'t you leave him"' },
      { characterId: 'C-LOTR-02', nodeId: 'K-LOTR-111', action: 'added', content: 'He is sending a hobbit to do what kings and wizards cannot — the best protection he can offer is a gardener with a good heart' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-04', type: 'Sam will walk beside him into the unknown — the bond deepens beyond master and gardener', valenceDelta: 0.15 },
      { from: 'C-LOTR-02', to: 'C-LOTR-04', type: 'Gandalf sees in Sam a loyalty that may prove more powerful than wizardry', valenceDelta: 0.2 },
    ],
    summary: 'Gandalf catches Sam at the window and hauls him inside by the ear. "What did you hear?" Sam blurts it all: the Ring, the Dark Lord, the danger. Gandalf\'s eyes narrow, then soften. "Well, Samwise, since you\'ve heard so much, I think you had better go with him. See that he is not alone." Sam looks at Frodo, stricken and thrilled in equal measure. Frodo looks at Gandalf. The wizard is already thinking of roads and provisions, but beneath the planning there is grief — he is sending a hobbit to do what kings and wizards cannot, and the best protection he can offer is a gardener with a good heart. It will have to be enough.',
  },

  // ── Arc 2: The Shadow of the Past ─────────────────────────────────────────
  'S-LOTR-008': {
    id: 'S-LOTR-008',
    kind: 'scene',
    arcId: 'SC-LOTR-02',
    locationId: 'L-LOTR-02',
    povId: 'C-LOTR-01',
    participantIds: ['C-LOTR-01', 'C-LOTR-04'],
    events: ['last_morning', 'packing_bag_end', 'farewell_to_home'],
    threadMutations: [{ threadId: 'T-LOTR-02', from: 'active', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-112', action: 'added', content: 'Closed the round green door for the last time — the key turned and Bag End watched them go' },
      { characterId: 'C-LOTR-04', nodeId: 'K-LOTR-113', action: 'added', content: 'The garden is overgrown already — it pains him more than any talk of dark lords' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-04', to: 'C-LOTR-01', type: 'Sam packed provisions with hobbit care — he will keep Frodo fed even if the world falls apart', valenceDelta: 0.1 },
    ],
    summary: 'The morning of departure. Frodo moves through Bag End room by room, touching the walls, the round windows, the brass knobs worn smooth by Bilbo\'s hands and his own. Sam has packed provisions with the care of a hobbit who believes no crisis is improved by an empty stomach: seed-cake, salt pork, apples, and a coil of rope he cannot explain wanting. They close the round green door for the last time. The key turns. The garden is overgrown already — Sam notices, and it pains him more than any talk of dark lords. They walk down the hill into the Shire, and Bag End watches them go with its windows like patient eyes.',
  },
  'S-LOTR-009': {
    id: 'S-LOTR-009',
    kind: 'scene',
    arcId: 'SC-LOTR-02',
    locationId: 'L-LOTR-02',
    povId: 'C-LOTR-01',
    participantIds: ['C-LOTR-01', 'C-LOTR-04'],
    events: ['farmer_maggot', 'mushrooms_and_gossip', 'shire_hospitality'],
    threadMutations: [{ threadId: 'T-LOTR-01', from: 'active', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-114', action: 'added', content: 'A black rider on a black horse came by Farmer Maggot\'s yesterday, asking after a Baggins — they are being hunted' },
      { characterId: 'C-LOTR-04', nodeId: 'K-LOTR-115', action: 'added', content: 'Even Farmer Maggot\'s dogs shrank from the black rider — whatever hunts them frightens animals by instinct' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-04', type: 'Frodo watches Sam chew and say nothing — grateful for steadiness when fear creeps in', valenceDelta: 0.1 },
    ],
    summary: 'A detour through Farmer Maggot\'s fields — Frodo once stole mushrooms here as a boy and has avoided the lane ever since. But Maggot proves a warmer host than memory promised: a kitchen table heaped with bread and cheese and the finest mushrooms in the Eastfarthing, brown and glistening with butter. The farmer talks while they eat, and beneath the gossip there is something else. A black rider on a black horse came by yesterday, asking after a Baggins. "I didn\'t like his voice," Maggot says, stabbing a mushroom with his fork. "Nor the way my dogs shrank from him." Frodo\'s hand drifts to his pocket. Sam chews and watches and says nothing.',
  },
  'S-LOTR-010': {
    id: 'S-LOTR-010',
    kind: 'scene',
    arcId: 'SC-LOTR-02',
    locationId: 'L-LOTR-02',
    povId: 'C-LOTR-01',
    participantIds: ['C-LOTR-01', 'C-LOTR-04'],
    events: ['black_rider_sighting', 'hiding_in_ditch', 'ring_pull'],
    threadMutations: [],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-08', action: 'added', content: 'A black rider on a black horse is hunting him — it sniffed the air where he stood and the Ring burned to be worn' },
      { characterId: 'C-LOTR-04', nodeId: 'K-LOTR-116', action: 'added', content: 'Grabbed Mr. Frodo\'s arm to stop him reaching for the Ring — something in the rider made the Ring call out' },
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-117', action: 'added', content: 'His fingers twitched toward his pocket of their own will — the Ring wanted the rider to find it' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-04', type: 'Sam pulled him into the ditch and held his arm — without Sam he might have put the Ring on', valenceDelta: 0.15 },
    ],
    summary: 'The lane narrows between high hedges, and behind them comes the sound of hooves — slow, deliberate, wrong. Frodo feels it before he sees it: a pressure in the air, a coldness that has nothing to do with the autumn wind. Sam pulls him into the ditch beneath the tree roots. The black rider passes inches above them, and for a terrible moment it pauses, lowering its hooded head to sniff the earth like a hound. The Ring throbs against Frodo\'s chest, a living thing desperate to be found. His fingers twitch toward his pocket. Sam grips his arm. The rider moves on. They lie in the leaf-mould, breathing, and the Shire is no longer the safe green country it was an hour ago.',
  },
  'S-LOTR-011': {
    id: 'S-LOTR-011',
    kind: 'scene',
    arcId: 'SC-LOTR-02',
    locationId: 'L-LOTR-02',
    povId: 'C-LOTR-04',
    participantIds: ['C-LOTR-01', 'C-LOTR-04'],
    events: ['night_camp', 'elves_passing', 'starlight_songs'],
    threadMutations: [{ threadId: 'T-LOTR-07', from: 'active', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-04', nodeId: 'K-LOTR-118', action: 'added', content: 'Saw Elves for the first time — tall figures in grey and white, carrying lanterns that burn without flickering, singing of seas not yet crossed' },
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-119', action: 'added', content: 'The Elves are leaving Middle-earth for the Grey Havens — even the immortal are departing, and the world grows smaller' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-04', to: 'C-LOTR-01', type: 'Sharing the wonder of Elves together — Sam\'s eyes full of starlight beside his master', valenceDelta: 0.1 },
    ],
    summary: 'They camp in the woods above the Stock Road, not daring a fire. The night is clear and cold, and through the trees comes a sound that neither of them expected: singing, high and silver and ancient beyond the reckoning of hobbits. Elves are passing through the Shire on their way to the Grey Havens — tall figures in grey and white, carrying lanterns that burn without flickering. They share their fire and their food, and for a few hours the fear recedes. Sam sits with his mouth open and his eyes full of starlight. "Elves, Mr. Frodo," he whispers, as though saying it will make it more real. The Elves sing of seas they have not yet crossed, and the sadness in their voices is older than the hills.',
  },
  'S-LOTR-012': {
    id: 'S-LOTR-012',
    kind: 'scene',
    arcId: 'SC-LOTR-02',
    locationId: 'L-LOTR-08',
    povId: 'C-LOTR-01',
    participantIds: ['C-LOTR-01', 'C-LOTR-03', 'C-LOTR-04'],
    characterMovements: { 'C-LOTR-01': 'L-LOTR-08', 'C-LOTR-04': 'L-LOTR-08' },
    events: ['bree_gate', 'prancing_pony', 'strider_in_shadows'],
    threadMutations: [{ threadId: 'T-LOTR-03', from: 'dormant', to: 'active' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-120', action: 'added', content: 'Gave a false name at the Prancing Pony — called himself Underhill, but the Ranger saw through it immediately' },
      { characterId: 'C-LOTR-03', nodeId: 'K-LOTR-121', action: 'added', content: 'The hobbit from the Shire has arrived at Bree carrying something of immense importance — Gandalf\'s letter warned of this' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-03', type: 'A dangerous stranger who may be the only hope on a road gone wrong', valenceDelta: 0.2 },
      { from: 'C-LOTR-04', to: 'C-LOTR-03', type: 'Does not trust this grim Ranger — but Mr. Frodo needs protecting', valenceDelta: 0.1 },
      { from: 'C-LOTR-03', to: 'C-LOTR-01', type: 'Aragorn sees the hobbit and understands the weight he carries — sworn now to protect him', valenceDelta: 0.2 },
    ],
    summary: 'Bree. The gate-keeper admits them with a long look and a shake of his head — hobbits from the Shire, on the road after dark, in times like these. The Prancing Pony is warm and loud and full of Men who seem impossibly tall. In the far corner, half-hidden by pipe smoke and shadow, a Ranger sits watching them with grey eyes that miss nothing. Frodo gives a false name. The innkeeper smiles. The Ranger does not. Later, when the common room has thinned, the stranger stands and crosses to their table. "I am called Strider," he says, and his voice is quiet and rough and carries the weight of long roads. "I think we have things to discuss, Mr. Underhill — or should I say, Baggins." Sam\'s hand finds his walking stick beneath the table.',
  },
  'S-LOTR-013': {
    id: 'S-LOTR-013',
    kind: 'scene',
    arcId: 'SC-LOTR-02',
    locationId: 'L-LOTR-08',
    povId: 'C-LOTR-03',
    participantIds: ['C-LOTR-01', 'C-LOTR-03', 'C-LOTR-04'],
    events: ['strider_warning', 'gandalf_missing', 'trust_tested'],
    threadMutations: [],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-09', action: 'added', content: 'The Ranger called Strider knows of the Ring and claims to be a friend of Gandalf\'s — but Gandalf never came to Bree' },
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-122', action: 'added', content: 'Nazgul hunt them — the Nine, Ring-wraiths who were once kings of Men, drawn to the Ring like moths to flame' },
      { characterId: 'C-LOTR-03', nodeId: 'K-LOTR-123', action: 'added', content: 'Gandalf has not come to Bree as promised — something has gone wrong, and the not-knowing is dangerous' },
      { characterId: 'C-LOTR-04', nodeId: 'K-LOTR-124', action: 'added', content: 'The Ranger produced a letter from Gandalf confirming his identity — but Sam keeps his cooking pan close, just in case' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-03', type: 'Strider knows too much to be ignored and too little to be fully trusted', valenceDelta: 0.1 },
      { from: 'C-LOTR-04', to: 'C-LOTR-03', type: 'Sam stands between the Ranger and his master with a cooking pan — trust has not arrived but necessity has', valenceDelta: 0.05 },
    ],
    summary: 'A private room at the Prancing Pony, the door bolted. Strider tells them what hunts them: Nazgul, the Nine, Ring-wraiths — servants of Sauron who were once kings of Men, now neither living nor dead, drawn to the Ring like moths to a killing flame. Gandalf was supposed to meet Frodo here. He has not come, and Strider does not know why, and the not-knowing sits in the room like a third shadow. "Are you frightened?" he asks Frodo. "Yes." "Not nearly frightened enough. I know what hunts you." He produces a letter from Gandalf, weeks old, confirming his identity. Sam grips his cooking pan and stands between the Ranger and his master. Trust has not arrived. But necessity has.',
  },
};

// ── Commits ──────────────────────────────────────────────────────────────────
const diffNames: Record<string, string> = {
  'S-LOTR-001': 'party_preparations',
  'S-LOTR-002': 'bag_end_evening',
  'S-LOTR-003': 'bilbo_vanishes',
  'S-LOTR-004': 'shire_summer',
  'S-LOTR-005': 'sam_overhears',
  'S-LOTR-006': 'ring_revealed',
  'S-LOTR-007': 'quest_appointed',
  'S-LOTR-008': 'farewell_bag_end',
  'S-LOTR-009': 'mushrooms_at_maggots',
  'S-LOTR-010': 'black_rider',
  'S-LOTR-011': 'elves_passing',
  'S-LOTR-012': 'strider_appears',
  'S-LOTR-013': 'strider_warning',
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
  createdAt: Date.now() - (13 - i) * 3600000,
}));

// ── Alternate Branch: "What if Gandalf Never Left the Shire" ─────────────────
// Diverges after S-LOTR-007 — Gandalf stays to escort Frodo personally,
// never visiting Saruman. The road is safer but the wider war goes undetected.

const altArc: Arc = {
  id: 'SC-LOTR-02-ALT',
  name: 'The Guarded Road',
  sceneIds: ['S-LOTR-ALT-008', 'S-LOTR-ALT-009', 'S-LOTR-ALT-010'],
  develops: ['T-LOTR-01', 'T-LOTR-07'],
  locationIds: ['L-LOTR-02', 'L-LOTR-08'],
  activeCharacterIds: ['C-LOTR-01', 'C-LOTR-02', 'C-LOTR-04'],
  initialCharacterLocations: {
    'C-LOTR-01': 'L-LOTR-02',
    'C-LOTR-02': 'L-LOTR-02',
    'C-LOTR-04': 'L-LOTR-02',
  },
};

const altScenes: Record<string, Scene> = {
  'S-LOTR-ALT-008': {
    id: 'S-LOTR-ALT-008',
    kind: 'scene',
    arcId: 'SC-LOTR-02-ALT',
    locationId: 'L-LOTR-02',
    povId: 'C-LOTR-02',
    participantIds: ['C-LOTR-01', 'C-LOTR-02', 'C-LOTR-04'],
    events: ['gandalf_escorts', 'guarded_departure', 'wizard_on_road'],
    threadMutations: [{ threadId: 'T-LOTR-02', from: 'active', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-02', nodeId: 'K-LOTR-130', action: 'added', content: 'Chose the hobbits over Isengard — safety is an illusion borrowed against a debt not yet discovered' },
      { characterId: 'C-LOTR-04', nodeId: 'K-LOTR-131', action: 'added', content: 'Feeding a wizard is no small matter — packed extra provisions for the journey with Gandalf' },
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-132', action: 'added', content: 'The road feels safer with Gandalf beside them — his staff taps the cobblestones in a rhythm that keeps shadows at bay' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-02', type: 'Gandalf walks beside them and the road feels safer — a wizard\'s presence is a shield', valenceDelta: 0.2 },
      { from: 'C-LOTR-02', to: 'C-LOTR-01', type: 'Gandalf watches Frodo carry the Ring with protective concern — determined not to let him face this alone', valenceDelta: 0.15 },
    ],
    summary: 'In this telling, Gandalf does not ride to Isengard. He stays. The three of them leave Bag End together — a wizard, a hobbit, and a gardener — walking the East Road in the long September light. Gandalf\'s staff taps the cobblestones in a rhythm that keeps the shadows at bay. Sam has packed even more food than in the other telling, because feeding a wizard is no small matter. The road feels safer with Gandalf beside them. But safety is an illusion the wizard knows he is borrowing against a debt he has not yet discovered: somewhere far to the south, Saruman has already turned, and no one is coming to learn of it.',
  },
  'S-LOTR-ALT-009': {
    id: 'S-LOTR-ALT-009',
    kind: 'scene',
    arcId: 'SC-LOTR-02-ALT',
    locationId: 'L-LOTR-02',
    povId: 'C-LOTR-01',
    participantIds: ['C-LOTR-01', 'C-LOTR-02', 'C-LOTR-04'],
    events: ['gandalf_fireside', 'ring_lore', 'wizard_teaching'],
    threadMutations: [{ threadId: 'T-LOTR-01', from: 'active', to: 'active' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-0A', action: 'added', content: 'Gandalf speaks of the Ring\'s history — it has a will, a hunger, and it will try to return to its master by any means' },
      { characterId: 'C-LOTR-04', nodeId: 'K-LOTR-133', action: 'added', content: 'The Ring is not a tool — it uses love and fear and mercy to get what it wants. Sam understands now why Frodo seems distant sometimes' },
      { characterId: 'C-LOTR-02', nodeId: 'K-LOTR-134', action: 'added', content: 'Watched Frodo turn the Ring in his palm by firelight — the warmth it gives is not from the flames. Running out of good options' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-01', to: 'C-LOTR-02', type: 'Gandalf arms him with knowledge instead of comfort — the honesty is painful but necessary', valenceDelta: -0.1 },
      { from: 'C-LOTR-04', to: 'C-LOTR-01', type: 'Sam sees Mr. Frodo turn the Ring in his hand and worries — the Ring changes him', valenceDelta: 0.1 },
    ],
    summary: 'A fireside camp under the stars, somewhere between the Brandywine and the Midgewater Marshes. Gandalf tells them more of the Ring\'s history than he did at Bag End — not to frighten, but to arm. "It is not a tool, Frodo. It is a will. It wants to be found. It will use your love and your fear and your mercy to get what it wants." The fire crackles. Sam listens with his mouth open. Frodo turns the Ring over in his palm and wonders whether the warmth he feels is the firelight or something else entirely. Gandalf watches the Ring where it sits in the hobbit\'s hand, and his expression is the expression of a man who knows he is running out of good options.',
  },
  'S-LOTR-ALT-010': {
    id: 'S-LOTR-ALT-010',
    kind: 'scene',
    arcId: 'SC-LOTR-02-ALT',
    locationId: 'L-LOTR-08',
    povId: 'C-LOTR-02',
    participantIds: ['C-LOTR-01', 'C-LOTR-02', 'C-LOTR-04'],
    characterMovements: { 'C-LOTR-01': 'L-LOTR-08', 'C-LOTR-02': 'L-LOTR-08', 'C-LOTR-04': 'L-LOTR-08' },
    events: ['bree_with_gandalf', 'no_strider_needed', 'missing_intelligence'],
    threadMutations: [{ threadId: 'T-LOTR-05', from: 'active', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-LOTR-02', nodeId: 'K-LOTR-135', action: 'added', content: 'Should have gone to Saruman but chose the hobbits instead — troubled by something he cannot name, a premonition of missed intelligence' },
      { characterId: 'C-LOTR-01', nodeId: 'K-LOTR-136', action: 'added', content: 'The Prancing Pony feels ordinary with Gandalf at their side — no Ranger watches from the shadows, the paths of hobbit and king do not cross' },
      { characterId: 'C-LOTR-04', nodeId: 'K-LOTR-137', action: 'added', content: 'The road ahead is safer in the short term — but Sam notices Gandalf staring into the fire with a troubled look' },
    ],
    relationshipMutations: [
      { from: 'C-LOTR-02', to: 'C-LOTR-01', type: 'Gandalf nurses his pipe by the fire, protecting Frodo but troubled by what he has failed to investigate', valenceDelta: 0.1 },
    ],
    summary: 'They reach Bree with Gandalf at their side, and the Prancing Pony feels like an ordinary inn rather than a threshold. No Ranger watches from the shadows — Strider is out on the wild, and without Gandalf\'s absence to draw him in, the paths of hobbit and king do not cross. The road ahead is safer in the short term and more dangerous in ways they cannot yet see. Gandalf sits by the fire, nursing a pipe, troubled by something he cannot name. He should have gone to Saruman. He chose the hobbits instead. Whether that was wisdom or folly, the months ahead will decide.',
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
  'B-LOTR-GUARDED': {
    id: 'B-LOTR-GUARDED',
    name: 'What if Gandalf Never Left the Shire',
    parentBranchId: 'B-LOTR-MAIN',
    forkEntryId: 'S-LOTR-007',
    entryIds: Object.keys(altScenes),
    createdAt: Date.now() - 43200000,
  },
};

// ── Assembled Narrative ──────────────────────────────────────────────────────
export const seedLOTR: NarrativeState = {
  id: 'N-LOTR',
  title: 'The Lord of the Rings — The Fellowship of the Ring',
  description: 'A hobbit of the Shire inherits an old gold ring from his uncle and discovers it is the most dangerous object in Middle-earth. The quiet green country of his childhood becomes a place of shadows and pursuit. Before the great quest begins — before Rivendell, before the Fellowship, before the long road south — there is the Shire, and the slow terrible realization that it can no longer be home.',
  characters,
  locations,
  threads,
  arcs: allArcs,
  scenes: allScenes,
  worldBuilds: allWorldBuilds,
  branches,
  commits,
  relationships,
  worldSummary: 'Middle-earth stands at the end of its Third Age. The Dark Lord Sauron, defeated but not destroyed, rebuilds his strength in Mordor and reaches for the One Ring — the master weapon he forged to dominate all life. The Ring has surfaced in the most unlikely place: the pocket of a hobbit in the Shire, passed from Bilbo to Frodo Baggins. Gandalf the Grey suspects the truth and has begun to confirm it. Black riders have been seen on the roads. The Shire is still green, still peaceful, still ignorant of the wider darkness — but the edges are fraying. Frodo carries the Ring east with his gardener Sam, not yet understanding the full weight of what he bears. The great alliances have not yet been called. The Fellowship has not yet been formed. The story is still in its first breath, and the world holds its shape — for now.',
  rules: [
    'The One Ring corrupts all who bear it — no one, however noble, is immune to its influence',
    'The Ring cannot be used for good; any attempt to wield it against Sauron will fail and corrupt the wielder',
    'The Ring can only be destroyed where it was made — in the fires of Mount Doom',
    'Gandalf is a Maia, not a human — he is powerful but constrained by his mission and cannot simply overpower Sauron directly',
    'Hobbits resist the Ring better than other races due to their simple, unambitious nature',
    'The free peoples of Middle-earth are divided and distrustful — unity is the hardest battle',
  ],
  controlMode: 'auto',
  imageStyle: 'Epic high fantasy oil painting, luminous golden-hour light, sweeping landscapes, Pre-Raphaelite detail, Alan Lee and John Howe inspired, mythic grandeur with earthy natural tones',
  activeForces: { payoff: 0, change: 0, variety: 0 },
  coverImageUrl: '/covers/lotr.jpg',
  createdAt: Date.now() - 86400000,
  updatedAt: Date.now(),
};
