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
  'C-HP-01': {
    id: 'C-HP-01',
    name: 'Harry Potter',
    role: 'anchor',
    threadIds: ['T-HP-01', 'T-HP-02', 'T-HP-06'],
    knowledge: {
      nodes: [
        { id: 'K-HP-01', type: 'knows', content: 'An orphan raised by the Dursleys, told his parents died in a car crash' },
        { id: 'K-HP-02', type: 'believes', content: 'Strange things happen around him — glass vanishing, hair regrowing — but he cannot explain why' },
        { id: 'K-HP-03', type: 'goal', content: 'Escape the cupboard under the stairs and find where he truly belongs' },
        { id: 'K-HP-04', type: 'knows', content: 'A lightning-bolt scar on his forehead, origin unknown' },
        { id: 'K-HP-05', type: 'secret', content: 'Does not yet know he is the Boy Who Lived, or that an entire world reveres his name' },
      ],
      edges: [
        { from: 'K-HP-01', to: 'K-HP-05', type: 'contradicts' },
        { from: 'K-HP-02', to: 'K-HP-05', type: 'supports' },
        { from: 'K-HP-03', to: 'K-HP-04', type: 'supports' },
        { from: 'K-HP-04', to: 'K-HP-05', type: 'enables' },
      ],
    },
  },
  'C-HP-02': {
    id: 'C-HP-02',
    name: 'Hermione Granger',
    role: 'anchor',
    threadIds: ['T-HP-01', 'T-HP-04'],
    knowledge: {
      nodes: [
        { id: 'K-HP-10', type: 'knows', content: 'Muggle-born witch who received her Hogwarts letter with no prior knowledge of magic' },
        { id: 'K-HP-11', type: 'believes', content: 'Knowledge and preparation are the surest shields against an uncertain world' },
        { id: 'K-HP-12', type: 'goal', content: 'Prove that she belongs in the wizarding world despite her parentage' },
        { id: 'K-HP-13', type: 'knows', content: 'Has memorized every textbook before term begins — including Hogwarts: A History' },
        { id: 'K-HP-14', type: 'believes', content: 'Rules exist for good reasons, and breaking them endangers everyone' },
      ],
      edges: [
        { from: 'K-HP-10', to: 'K-HP-12', type: 'enables' },
        { from: 'K-HP-11', to: 'K-HP-13', type: 'supports' },
        { from: 'K-HP-13', to: 'K-HP-12', type: 'supports' },
        { from: 'K-HP-14', to: 'K-HP-11', type: 'supports' },
      ],
    },
  },
  'C-HP-03': {
    id: 'C-HP-03',
    name: 'Ron Weasley',
    role: 'recurring',
    threadIds: ['T-HP-04', 'T-HP-07'],
    knowledge: {
      nodes: [
        { id: 'K-HP-20', type: 'knows', content: 'Sixth son in a family of accomplished wizards — always compared, never first' },
        { id: 'K-HP-21', type: 'believes', content: 'He will never be as good as his brothers, so why pretend otherwise' },
        { id: 'K-HP-22', type: 'goal', content: 'Step out from the shadow of his brothers and prove his own worth' },
        { id: 'K-HP-23', type: 'knows', content: 'Grew up in the wizarding world — understands customs, Quidditch, and wizard chess instinctively' },
      ],
      edges: [
        { from: 'K-HP-20', to: 'K-HP-21', type: 'enables' },
        { from: 'K-HP-21', to: 'K-HP-22', type: 'contradicts' },
        { from: 'K-HP-23', to: 'K-HP-22', type: 'supports' },
      ],
    },
  },
  'C-HP-04': {
    id: 'C-HP-04',
    name: 'Albus Dumbledore',
    role: 'recurring',
    threadIds: ['T-HP-01', 'T-HP-05'],
    knowledge: {
      nodes: [
        { id: 'K-HP-30', type: 'knows', content: 'The Philosopher\'s Stone is hidden in Hogwarts at Nicholas Flamel\'s request' },
        { id: 'K-HP-31', type: 'secret', content: 'Suspects Voldemort has attached himself to someone inside the school' },
        { id: 'K-HP-32', type: 'goal', content: 'Protect the Stone while allowing Harry to grow into the courage he will need' },
        { id: 'K-HP-33', type: 'believes', content: 'Love is the deepest magic — Harry carries a protection Voldemort cannot comprehend' },
        { id: 'K-HP-34', type: 'knows', content: 'The Mirror of Erised will only yield the Stone to one who desires it but not its use' },
      ],
      edges: [
        { from: 'K-HP-30', to: 'K-HP-32', type: 'enables' },
        { from: 'K-HP-31', to: 'K-HP-32', type: 'supports' },
        { from: 'K-HP-33', to: 'K-HP-32', type: 'supports' },
        { from: 'K-HP-34', to: 'K-HP-30', type: 'supports' },
      ],
    },
  },
  'C-HP-05': {
    id: 'C-HP-05',
    name: 'Severus Snape',
    role: 'recurring',
    threadIds: ['T-HP-03', 'T-HP-01'],
    knowledge: {
      nodes: [
        { id: 'K-HP-40', type: 'secret', content: 'Loved Lily Potter until her death — protects Harry for her sake, despises him for his father\'s' },
        { id: 'K-HP-41', type: 'knows', content: 'Quirrell is behaving suspiciously and may be compromised' },
        { id: 'K-HP-42', type: 'goal', content: 'Guard the Stone and keep his oath to Dumbledore, regardless of personal cost' },
        { id: 'K-HP-43', type: 'believes', content: 'Potter is an arrogant mirror of James — talent unearned, fame undeserved' },
      ],
      edges: [
        { from: 'K-HP-40', to: 'K-HP-42', type: 'enables' },
        { from: 'K-HP-41', to: 'K-HP-42', type: 'supports' },
        { from: 'K-HP-43', to: 'K-HP-40', type: 'contradicts' },
      ],
    },
  },
  'C-HP-06': {
    id: 'C-HP-06',
    name: 'Rubeus Hagrid',
    role: 'transient',
    threadIds: ['T-HP-02', 'T-HP-06'],
    knowledge: {
      nodes: [
        { id: 'K-HP-50', type: 'knows', content: 'Delivered baby Harry to Privet Drive the night his parents died' },
        { id: 'K-HP-51', type: 'secret', content: 'Told a stranger in a pub how to get past Fluffy — just play him a bit of music' },
        { id: 'K-HP-52', type: 'believes', content: 'Dumbledore is the greatest wizard alive and his trust is never misplaced' },
        { id: 'K-HP-53', type: 'goal', content: 'Protect Harry and help him feel at home in the world that has always been his' },
      ],
      edges: [
        { from: 'K-HP-50', to: 'K-HP-53', type: 'enables' },
        { from: 'K-HP-51', to: 'K-HP-52', type: 'contradicts' },
        { from: 'K-HP-52', to: 'K-HP-53', type: 'supports' },
      ],
    },
  },
  'C-HP-07': {
    id: 'C-HP-07',
    name: 'Draco Malfoy',
    role: 'transient',
    threadIds: ['T-HP-07'],
    knowledge: {
      nodes: [
        { id: 'K-HP-60', type: 'believes', content: 'Pure-blood wizards are inherently superior — Muggle-borns dilute magical society' },
        { id: 'K-HP-61', type: 'goal', content: 'Establish himself as the dominant figure in his year, as befits a Malfoy' },
        { id: 'K-HP-62', type: 'knows', content: 'His father served the Dark Lord and still whispers of the old ways at home' },
      ],
      edges: [
        { from: 'K-HP-60', to: 'K-HP-61', type: 'supports' },
        { from: 'K-HP-62', to: 'K-HP-60', type: 'enables' },
      ],
    },
  },
  'C-HP-08': {
    id: 'C-HP-08',
    name: 'Quirinus Quirrell',
    role: 'transient',
    threadIds: ['T-HP-05', 'T-HP-01'],
    knowledge: {
      nodes: [
        { id: 'K-HP-70', type: 'secret', content: 'Voldemort lives as a parasitic face on the back of his skull, hidden beneath a turban' },
        { id: 'K-HP-71', type: 'goal', content: 'Retrieve the Philosopher\'s Stone for his master and restore Voldemort to power' },
        { id: 'K-HP-72', type: 'knows', content: 'The Stone is protected by enchantments from each Hogwarts professor' },
        { id: 'K-HP-73', type: 'believes', content: 'There is no returning from this servitude — only obedience or annihilation' },
      ],
      edges: [
        { from: 'K-HP-70', to: 'K-HP-71', type: 'enables' },
        { from: 'K-HP-72', to: 'K-HP-71', type: 'supports' },
        { from: 'K-HP-73', to: 'K-HP-71', type: 'supports' },
      ],
    },
  },
};

// ── Locations ────────────────────────────────────────────────────────────────
const locations: Record<string, Location> = {
  'L-HP-01': {
    id: 'L-HP-01', name: 'Wizarding Britain', parentId: null, threadIds: [],
    knowledge: {
      nodes: [
        { id: 'LK-HP-01', type: 'lore', content: 'A hidden magical society layered beneath Muggle Britain, governed by the Ministry of Magic' },
        { id: 'LK-HP-02', type: 'lore', content: 'Ten years of peace since the fall of He-Who-Must-Not-Be-Named — but the peace is fragile' },
      ],
      edges: [{ from: 'LK-HP-01', to: 'LK-HP-02', type: 'supports' }],
    },
  },
  'L-HP-02': {
    id: 'L-HP-02', name: 'Hogwarts School of Witchcraft and Wizardry', parentId: 'L-HP-01', threadIds: ['T-HP-01', 'T-HP-04'],
    knowledge: {
      nodes: [
        { id: 'LK-HP-03', type: 'lore', content: 'A thousand-year-old castle in the Scottish Highlands, the foremost school of magic in Europe' },
        { id: 'LK-HP-04', type: 'secret', content: 'The third-floor corridor on the right-hand side conceals a trapdoor guarded by a three-headed dog' },
      ],
      edges: [{ from: 'LK-HP-04', to: 'LK-HP-03', type: 'contradicts' }],
    },
  },
  'L-HP-03': {
    id: 'L-HP-03', name: 'Number Four, Privet Drive', parentId: 'L-HP-01', threadIds: ['T-HP-06'],
    knowledge: {
      nodes: [
        { id: 'LK-HP-05', type: 'lore', content: 'A ruthlessly ordinary suburban home in Little Whinging, Surrey — normalcy enforced like a religion' },
        { id: 'LK-HP-06', type: 'secret', content: 'Protected by an ancient blood ward tied to Lily Potter\'s sacrifice — as long as Harry calls it home, Voldemort cannot touch him there' },
      ],
      edges: [{ from: 'LK-HP-06', to: 'LK-HP-05', type: 'contradicts' }],
    },
  },
  'L-HP-04': {
    id: 'L-HP-04', name: 'Diagon Alley', parentId: 'L-HP-01', threadIds: ['T-HP-02'],
    knowledge: {
      nodes: [
        { id: 'LK-HP-07', type: 'lore', content: 'The hidden high street of wizarding London — wands, cauldrons, owls, and wonder behind a brick wall' },
        { id: 'LK-HP-08', type: 'lore', content: 'Accessible through the Leaky Cauldron, invisible to Muggle eyes' },
      ],
      edges: [{ from: 'LK-HP-07', to: 'LK-HP-08', type: 'supports' }],
    },
  },
  'L-HP-05': {
    id: 'L-HP-05', name: 'The Great Hall', parentId: 'L-HP-02', threadIds: ['T-HP-07'],
    knowledge: {
      nodes: [
        { id: 'LK-HP-09', type: 'lore', content: 'An enchanted ceiling reflecting the sky above, four long house tables, and the Sorting Hat\'s ancient song' },
        { id: 'LK-HP-10', type: 'lore', content: 'Where the Sorting Ceremony determines the trajectory of every student\'s life at Hogwarts' },
      ],
      edges: [{ from: 'LK-HP-09', to: 'LK-HP-10', type: 'supports' }],
    },
  },
  'L-HP-06': {
    id: 'L-HP-06', name: 'The Third-Floor Corridor', parentId: 'L-HP-02', threadIds: ['T-HP-01', 'T-HP-05'],
    knowledge: {
      nodes: [
        { id: 'LK-HP-11', type: 'danger', content: 'Forbidden to all students on pain of a most painful death — Dumbledore\'s warning at the start-of-term feast' },
        { id: 'LK-HP-12', type: 'secret', content: 'Contains the trapdoor beneath Fluffy, leading to a gauntlet of enchantments protecting the Philosopher\'s Stone' },
      ],
      edges: [{ from: 'LK-HP-12', to: 'LK-HP-11', type: 'enables' }],
    },
  },
  'L-HP-07': {
    id: 'L-HP-07', name: 'The Forbidden Forest', parentId: 'L-HP-02', threadIds: ['T-HP-05'],
    knowledge: {
      nodes: [
        { id: 'LK-HP-13', type: 'danger', content: 'Ancient woodland on the Hogwarts grounds, home to centaurs, unicorns, and darker things' },
        { id: 'LK-HP-14', type: 'secret', content: 'Something has been killing unicorns and drinking their blood — a crime against nature that sustains a cursed half-life' },
      ],
      edges: [{ from: 'LK-HP-14', to: 'LK-HP-13', type: 'supports' }],
    },
  },
  'L-HP-08': {
    id: 'L-HP-08', name: 'Gringotts Wizarding Bank', parentId: 'L-HP-04', threadIds: ['T-HP-01'],
    knowledge: {
      nodes: [
        { id: 'LK-HP-15', type: 'lore', content: 'Run by goblins deep beneath London — the safest place in the wizarding world, after Hogwarts' },
        { id: 'LK-HP-16', type: 'secret', content: 'Vault 713 held a small grubby package retrieved by Hagrid on Dumbledore\'s orders — the same day it was nearly robbed' },
      ],
      edges: [{ from: 'LK-HP-16', to: 'LK-HP-15', type: 'contradicts' }],
    },
  },
};

// ── Threads ──────────────────────────────────────────────────────────────────
const threads: Record<string, Thread> = {
  'T-HP-01': {
    id: 'T-HP-01',
    anchors: [{ id: 'L-HP-06', type: 'location' }, { id: 'C-HP-04', type: 'character' }],
    description: "The Philosopher's Stone — who is trying to steal it, what it creates, and why someone would kill for immortality",
    status: 'dormant',
    openedAt: 'S-HP-001',
    dependents: ['T-HP-05', 'T-HP-03'],
  },
  'T-HP-02': {
    id: 'T-HP-02',
    anchors: [{ id: 'C-HP-01', type: 'character' }, { id: 'C-HP-06', type: 'character' }],
    description: "Harry's identity — the Boy Who Lived discovering that he is famous, magical, and marked by a destiny he never chose",
    status: 'dormant',
    openedAt: 'S-HP-001',
    dependents: ['T-HP-06'],
  },
  'T-HP-03': {
    id: 'T-HP-03',
    anchors: [{ id: 'C-HP-05', type: 'character' }],
    description: "Snape's ambiguous loyalty — the man who seems to hate Harry, appears to threaten Quirrell, and whose true allegiance lies buried beneath layers of cruelty",
    status: 'dormant',
    openedAt: 'S-HP-006',
    dependents: [],
  },
  'T-HP-04': {
    id: 'T-HP-04',
    anchors: [{ id: 'C-HP-01', type: 'character' }, { id: 'C-HP-02', type: 'character' }, { id: 'C-HP-03', type: 'character' }],
    description: "The trio's friendship — three misfits forging a bond under pressure that will define the shape of the war to come",
    status: 'dormant',
    openedAt: 'S-HP-004',
    dependents: [],
  },
  'T-HP-05': {
    id: 'T-HP-05',
    anchors: [{ id: 'C-HP-08', type: 'character' }],
    description: "Voldemort's return — the shadow behind Quirrell's turban, drinking unicorn blood in the forest, clawing back toward life one desperate act at a time",
    status: 'dormant',
    openedAt: 'S-HP-011',
    dependents: [],
  },
  'T-HP-06': {
    id: 'T-HP-06',
    anchors: [{ id: 'L-HP-03', type: 'location' }, { id: 'C-HP-01', type: 'character' }],
    description: "Harry versus the Dursleys — the muggle world that tried to crush the magic out of him, and the reckoning when it failed",
    status: 'dormant',
    openedAt: 'S-HP-001',
    dependents: [],
  },
  'T-HP-07': {
    id: 'T-HP-07',
    anchors: [{ id: 'C-HP-07', type: 'character' }, { id: 'L-HP-05', type: 'location' }],
    description: "Draco and the house rivalry — blood purity against chosen loyalty, Slytherin ambition against Gryffindor courage, a schoolboy feud that mirrors the larger war",
    status: 'dormant',
    openedAt: 'S-HP-005',
    dependents: [],
  },
};

// ── Relationships ────────────────────────────────────────────────────────────
const relationships: RelationshipEdge[] = [
  { from: 'C-HP-01', to: 'C-HP-02', type: 'Finds her bossy and insufferable at first, but senses something familiar — an outsider trying too hard to belong', valence: 0.1 },
  { from: 'C-HP-02', to: 'C-HP-01', type: 'Disapproves of his rule-breaking but is drawn to his quiet bravery — he acts where she only reads', valence: 0.2 },
  { from: 'C-HP-01', to: 'C-HP-03', type: 'First real friend — Ron treats him like a normal boy, and that is the rarest gift Harry has ever received', valence: 0.6 },
  { from: 'C-HP-03', to: 'C-HP-01', type: 'Awed by Harry\'s fame but genuinely likes the quiet kid who shares his sweets on the train', valence: 0.5 },
  { from: 'C-HP-01', to: 'C-HP-04', type: 'Trusts Dumbledore implicitly — the first adult who spoke to him with honesty and warmth', valence: 0.7 },
  { from: 'C-HP-04', to: 'C-HP-01', type: 'Watches the boy with a mixture of hope and sorrow, knowing the weight that must eventually fall on those young shoulders', valence: 0.8 },
  { from: 'C-HP-01', to: 'C-HP-05', type: 'Convinced Snape despises him — the man\'s eyes carry a hatred Harry cannot explain or escape', valence: -0.6 },
  { from: 'C-HP-05', to: 'C-HP-01', type: 'Sees James Potter\'s arrogance in the boy\'s face, and Lily\'s eyes staring back — an unbearable contradiction', valence: -0.3 },
  { from: 'C-HP-01', to: 'C-HP-07', type: 'Rejected Draco\'s handshake and chose Ron — a choice that defined his Hogwarts life from the first day', valence: -0.4 },
  { from: 'C-HP-07', to: 'C-HP-01', type: 'Humiliated by the public rejection — Potter chose a Weasley over a Malfoy, and that insult will not be forgotten', valence: -0.5 },
];

// ── Arcs ─────────────────────────────────────────────────────────────────────
const arcs: Record<string, Arc> = {
  'SC-HP-01': {
    id: 'SC-HP-01',
    name: 'The Letter and the Threshold',
    sceneIds: ['S-HP-001', 'S-HP-002', 'S-HP-003', 'S-HP-004', 'S-HP-005'],
    develops: ['T-HP-02', 'T-HP-06'],
    locationIds: ['L-HP-01', 'L-HP-03', 'L-HP-04', 'L-HP-05', 'L-HP-08'],
    activeCharacterIds: ['C-HP-01', 'C-HP-02', 'C-HP-03', 'C-HP-06', 'C-HP-07'],
    initialCharacterLocations: {
      'C-HP-01': 'L-HP-03',
      'C-HP-02': 'L-HP-04',
      'C-HP-03': 'L-HP-05',
      'C-HP-06': 'L-HP-03',
      'C-HP-07': 'L-HP-05',
    },
  },
  'SC-HP-02': {
    id: 'SC-HP-02',
    name: 'The Forbidden Wing',
    sceneIds: ['S-HP-006', 'S-HP-007', 'S-HP-008', 'S-HP-009', 'S-HP-010'],
    develops: ['T-HP-01', 'T-HP-03'],
    locationIds: ['L-HP-02', 'L-HP-05', 'L-HP-06', 'L-HP-08'],
    activeCharacterIds: ['C-HP-01', 'C-HP-02', 'C-HP-03', 'C-HP-04', 'C-HP-05', 'C-HP-08'],
    initialCharacterLocations: {
      'C-HP-01': 'L-HP-02',
      'C-HP-02': 'L-HP-02',
      'C-HP-03': 'L-HP-02',
      'C-HP-04': 'L-HP-02',
      'C-HP-05': 'L-HP-02',
      'C-HP-08': 'L-HP-02',
    },
  },
  'SC-HP-03': {
    id: 'SC-HP-03',
    name: 'Through the Trapdoor',
    sceneIds: ['S-HP-011', 'S-HP-012', 'S-HP-013', 'S-HP-014', 'S-HP-015'],
    develops: ['T-HP-05', 'T-HP-04'],
    locationIds: ['L-HP-02', 'L-HP-06', 'L-HP-07'],
    activeCharacterIds: ['C-HP-01', 'C-HP-02', 'C-HP-03', 'C-HP-04', 'C-HP-05', 'C-HP-08'],
    initialCharacterLocations: {
      'C-HP-01': 'L-HP-02',
      'C-HP-02': 'L-HP-02',
      'C-HP-03': 'L-HP-02',
      'C-HP-04': 'L-HP-02',
      'C-HP-05': 'L-HP-02',
      'C-HP-08': 'L-HP-06',
    },
  },
};

// ── Scenes ───────────────────────────────────────────────────────────────────
const scenes: Record<string, Scene> = {
  // ── Arc 1: The Letter and the Threshold ───────────────────────────────────
  'S-HP-001': {
    id: 'S-HP-001',
    kind: 'scene',
    arcId: 'SC-HP-01',
    locationId: 'L-HP-03',
    participantIds: ['C-HP-01', 'C-HP-06'],
    events: ['cupboard_morning', 'letters_from_no_one', 'hagrid_arrives'],
    threadMutations: [
      { threadId: 'T-HP-02', from: 'dormant', to: 'surfacing' },
      { threadId: 'T-HP-06', from: 'dormant', to: 'surfacing' },
    ],
    knowledgeMutations: [],
    relationshipMutations: [],
    stakes: 15,
    prose: '',
    summary: 'Number Four, Privet Drive. Harry wakes in the cupboard under the stairs, spider webs brushing his forehead. The Dursleys have spent ten years smothering every trace of strangeness from his life. But the letters have been arriving — dozens, then hundreds, flooding through the mail slot, squeezed under doors, stuffed inside eggs. Uncle Vernon boards the windows and flees to a rock in the sea. At midnight, the door comes off its hinges. Hagrid fills the doorway like a mountain wearing a moleskin coat. "Yer a wizard, Harry." The world cracks open.',
  },
  'S-HP-002': {
    id: 'S-HP-002',
    kind: 'scene',
    arcId: 'SC-HP-01',
    locationId: 'L-HP-04',
    participantIds: ['C-HP-01', 'C-HP-06'],
    characterMovements: { 'C-HP-01': 'L-HP-04', 'C-HP-06': 'L-HP-04' },
    events: ['diagon_alley_revealed', 'gringotts_vault', 'wand_chooses_wizard'],
    threadMutations: [
      { threadId: 'T-HP-02', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-06', action: 'added', content: 'His parents left him a fortune in gold Galleons — he was never the burden the Dursleys claimed' },
      { characterId: 'C-HP-01', nodeId: 'K-HP-07', action: 'added', content: 'Ollivander said his wand shares a core with Voldemort\'s — the phoenix feather that links them' },
    ],
    relationshipMutations: [],
    stakes: 20,
    prose: '',
    summary: 'Diagon Alley unfolds behind the Leaky Cauldron like a fever dream rendered in brick and gold. Witches and wizards recognize Harry in the street — they shake his hand, bow, weep. He has been famous his entire life and never knew. Hagrid leads him through Gringotts, where goblins guard a vault of gold his parents left behind, and retrieves a small grubby package from Vault 713. At Ollivanders, wand after wand refuses him — until the holly wand with the phoenix feather core leaps into his hand. Ollivander goes pale. "Curious. Very curious." The wand that chose Harry is brother to the wand that gave him his scar.',
  },
  'S-HP-003': {
    id: 'S-HP-003',
    kind: 'scene',
    arcId: 'SC-HP-01',
    locationId: 'L-HP-02',
    participantIds: ['C-HP-01', 'C-HP-03'],
    characterMovements: { 'C-HP-01': 'L-HP-02', 'C-HP-03': 'L-HP-02' },
    events: ['hogwarts_express', 'ron_meeting', 'chocolate_frogs', 'first_sight_of_castle'],
    threadMutations: [
      { threadId: 'T-HP-06', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-03', nodeId: 'K-HP-24', action: 'added', content: 'Harry Potter sat in his compartment and shared his sweets — he is nothing like the legend' },
    ],
    relationshipMutations: [
      { from: 'C-HP-01', to: 'C-HP-03', type: 'Immediate warmth — Ron is the first boy his age to treat him normally', valenceDelta: 0.3 },
      { from: 'C-HP-03', to: 'C-HP-01', type: 'Starstruck but genuine — likes Harry before the legend, after the Chocolate Frogs', valenceDelta: 0.3 },
    ],
    stakes: 25,
    prose: '',
    summary: 'Platform Nine and Three-Quarters. Harry runs at a brick wall and emerges into steam and scarlet. On the Hogwarts Express, he shares a compartment with Ron Weasley — a gangly boy with a hand-me-down rat and a sandwich he is embarrassed to eat. Harry buys the entire trolley. They talk about Quidditch, wizard chess, and Chocolate Frog cards. For the first time in his life, Harry has a friend his own age. As darkness falls, the castle appears across the black lake — a thousand windows glittering like scattered stars. Ron whispers, "Wicked." Harry cannot speak at all.',
  },
  'S-HP-004': {
    id: 'S-HP-004',
    kind: 'scene',
    arcId: 'SC-HP-01',
    locationId: 'L-HP-05',
    participantIds: ['C-HP-01', 'C-HP-02', 'C-HP-03', 'C-HP-04'],
    characterMovements: { 'C-HP-01': 'L-HP-05', 'C-HP-02': 'L-HP-05', 'C-HP-03': 'L-HP-05' },
    events: ['sorting_ceremony', 'hat_considers_slytherin', 'gryffindor_chosen', 'dumbledore_warning'],
    threadMutations: [
      { threadId: 'T-HP-04', from: 'dormant', to: 'surfacing' },
      { threadId: 'T-HP-06', from: 'escalating', to: 'done' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-08', action: 'added', content: 'The Sorting Hat wanted to place him in Slytherin — he begged it not to, and it listened' },
      { characterId: 'C-HP-01', nodeId: 'K-HP-09', action: 'added', content: 'Dumbledore warned the school away from the third-floor corridor on pain of death — not a joke' },
    ],
    relationshipMutations: [
      { from: 'C-HP-02', to: 'C-HP-01', type: 'Sorted into the same house — proximity breeds the first fragile threads of recognition', valenceDelta: 0.1 },
    ],
    stakes: 30,
    prose: '',
    summary: 'The Great Hall. A thousand candles float beneath a ceiling of stars. The Sorting Hat is placed on Harry\'s head and whispers: "Difficult. Very difficult. Plenty of courage, not a bad mind, talent — oh yes — and a thirst to prove yourself. Slytherin could help you on the way to greatness." Harry grips the stool and thinks, Not Slytherin, not Slytherin. The Hat relents: "GRYFFINDOR!" The table erupts. Ron beams. Hermione Granger, already sorted, nods approvingly. At the staff table, Dumbledore\'s eyes twinkle — but his start-of-term warning is steel: the third-floor corridor is forbidden to all who do not wish to die a most painful death. The hall laughs. Dumbledore does not.',
  },
  'S-HP-005': {
    id: 'S-HP-005',
    kind: 'scene',
    arcId: 'SC-HP-01',
    locationId: 'L-HP-05',
    participantIds: ['C-HP-01', 'C-HP-03', 'C-HP-07'],
    events: ['malfoy_confrontation', 'handshake_refused', 'house_lines_drawn'],
    threadMutations: [
      { threadId: 'T-HP-07', from: 'dormant', to: 'surfacing' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-07', nodeId: 'K-HP-63', action: 'added', content: 'Potter refused his hand in front of everyone — chose a blood traitor Weasley over a Malfoy' },
    ],
    relationshipMutations: [
      { from: 'C-HP-01', to: 'C-HP-07', type: 'Draco reminds him of Dudley — the same sneering entitlement, different clothes', valenceDelta: -0.2 },
      { from: 'C-HP-07', to: 'C-HP-01', type: 'Public humiliation hardens into permanent enmity', valenceDelta: -0.3 },
    ],
    stakes: 35,
    prose: '',
    summary: 'The Great Hall, next morning. Draco Malfoy approaches Harry with his hand extended and his chin raised. "You\'ll soon find out some wizarding families are much better than others, Potter. You don\'t want to go making friends with the wrong sort." He glances at Ron. Harry looks at the outstretched hand, then at Ron\'s flushed face. "I think I can tell the wrong sort for myself, thanks." Draco\'s hand drops. His eyes harden into something that will not soften for seven years. The house lines are drawn in that single refusal — Gryffindor courage against Slytherin pride, chosen loyalty against inherited rank.',
  },

  // ── Arc 2: The Forbidden Wing ─────────────────────────────────────────────
  'S-HP-006': {
    id: 'S-HP-006',
    kind: 'scene',
    arcId: 'SC-HP-02',
    locationId: 'L-HP-02',
    participantIds: ['C-HP-01', 'C-HP-05'],
    events: ['first_potions_class', 'snape_hostility', 'scar_burns'],
    threadMutations: [
      { threadId: 'T-HP-03', from: 'dormant', to: 'surfacing' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-80', action: 'added', content: 'Snape singled him out from the first moment — the hatred feels personal, not professional' },
      { characterId: 'C-HP-01', nodeId: 'K-HP-81', action: 'added', content: 'His scar burned during the start-of-term feast when he looked at Professor Quirrell\'s turban' },
    ],
    relationshipMutations: [
      { from: 'C-HP-01', to: 'C-HP-05', type: 'Instant antagonism — Snape seems to loathe him on sight', valenceDelta: -0.2 },
    ],
    stakes: 40,
    prose: '',
    summary: 'The dungeons. Snape sweeps into his first Potions class like a bat unfolding and fixes Harry with a stare that carries the weight of decades. "Potter. Our new celebrity." What follows is a public dissection — question after impossible question, designed not to teach but to humiliate. Harry endures it. Ron seethes. Hermione\'s hand goes unacknowledged in the air. But beneath the cruelty lies something Harry cannot name: Snape looks at him with hatred, yes, but also with something that might be grief. After class, Harry remembers: his scar burned at the feast. Not when he looked at Snape. When he looked at Quirrell.',
  },
  'S-HP-007': {
    id: 'S-HP-007',
    kind: 'scene',
    arcId: 'SC-HP-02',
    locationId: 'L-HP-06',
    participantIds: ['C-HP-01', 'C-HP-02', 'C-HP-03'],
    characterMovements: { 'C-HP-01': 'L-HP-06', 'C-HP-02': 'L-HP-06', 'C-HP-03': 'L-HP-06' },
    events: ['wrong_staircase', 'fluffy_discovered', 'three_headed_dog', 'trapdoor_noticed'],
    threadMutations: [
      { threadId: 'T-HP-01', from: 'dormant', to: 'surfacing' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-82', action: 'added', content: 'A three-headed dog guards a trapdoor on the forbidden third-floor corridor' },
      { characterId: 'C-HP-02', nodeId: 'K-HP-15', action: 'added', content: 'The dog was standing on a trapdoor — it is guarding something' },
    ],
    relationshipMutations: [
      { from: 'C-HP-02', to: 'C-HP-01', type: 'Terrified but exhilarated — Harry noticed the trapdoor when she only saw teeth', valenceDelta: 0.1 },
    ],
    stakes: 45,
    prose: '',
    summary: 'The third-floor corridor. A moving staircase deposits them where they should not be. They open a door to escape Filch and find themselves face-to-face-to-face with a monstrous three-headed dog, all six eyes fixed on them, drool pooling on the flagstones. They run. Hearts hammering in the Gryffindor common room, Hermione says what the others missed: "Didn\'t you see what it was standing on? A trapdoor. It\'s guarding something." The mystery takes root. Something is hidden beneath the third-floor corridor, and Dumbledore has stationed a beast to protect it. Harry thinks of the small grubby package from Vault 713.',
  },
  'S-HP-008': {
    id: 'S-HP-008',
    kind: 'scene',
    arcId: 'SC-HP-02',
    locationId: 'L-HP-02',
    participantIds: ['C-HP-01', 'C-HP-02', 'C-HP-03'],
    events: ['troll_in_dungeon', 'hermione_rescue', 'friendship_forged'],
    threadMutations: [
      { threadId: 'T-HP-04', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-02', nodeId: 'K-HP-16', action: 'added', content: 'Harry and Ron risked their lives to save her from the troll — she has never had friends like this' },
    ],
    relationshipMutations: [
      { from: 'C-HP-01', to: 'C-HP-02', type: 'She lied to protect them — Hermione is braver than her books suggest', valenceDelta: 0.3 },
      { from: 'C-HP-02', to: 'C-HP-01', type: 'He came back for her — no one has ever come back for her before', valenceDelta: 0.3 },
      { from: 'C-HP-02', to: 'C-HP-03', type: 'Ron\'s levitation charm saved her life — the boy she mocked is the boy who rescued her', valenceDelta: 0.4 },
      { from: 'C-HP-03', to: 'C-HP-02', type: 'She took the blame for them — maybe she is not so bad after all', valenceDelta: 0.3 },
    ],
    stakes: 50,
    prose: '',
    summary: 'Halloween. A mountain troll is loose in the dungeons. Hermione does not know — she is crying in the girls\' bathroom because Ron called her a nightmare. Harry and Ron go after her. They find the troll first: twelve feet tall, granite-grey skin, a club the size of a tree trunk. Ron levitates the club with a charm he has been failing all day — Wingardium Leviosa — and drops it on the troll\'s head. When the professors arrive, Hermione lies. She says she went looking for the troll because she\'d read about them. She takes the blame to protect the boys who saved her. There are some things you cannot share without ending up liking each other, and knocking out a twelve-foot mountain troll is one of them. The trio is formed.',
  },
  'S-HP-009': {
    id: 'S-HP-009',
    kind: 'scene',
    arcId: 'SC-HP-02',
    locationId: 'L-HP-02',
    participantIds: ['C-HP-01', 'C-HP-02', 'C-HP-03', 'C-HP-05', 'C-HP-08'],
    events: ['quidditch_match', 'broom_jinx', 'snape_suspected', 'quirrell_overlooked'],
    threadMutations: [
      { threadId: 'T-HP-03', from: 'surfacing', to: 'escalating' },
      { threadId: 'T-HP-07', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-83', action: 'added', content: 'Snape was muttering a curse during the Quidditch match — Hermione set his robes on fire to stop it' },
      { characterId: 'C-HP-02', nodeId: 'K-HP-17', action: 'added', content: 'Snape was maintaining eye contact and mouthing an incantation — classic jinx behavior. He is after the Stone.' },
    ],
    relationshipMutations: [
      { from: 'C-HP-01', to: 'C-HP-05', type: 'Now certain Snape tried to kill him — the evidence seems undeniable', valenceDelta: -0.2 },
    ],
    stakes: 55,
    prose: '',
    summary: 'The Quidditch pitch. Harry\'s first match — Gryffindor versus Slytherin. He is a natural on a broom, the youngest Seeker in a century. But mid-flight his Nimbus Two Thousand bucks and rolls, trying to throw him. In the stands, Hermione spots Snape muttering with unbroken eye contact — the hallmark of a jinx. She creeps through the crowd and sets his robes on fire. The broom steadies. Harry catches the Snitch. The crowd roars. But the trio is certain now: Snape is trying to steal whatever Fluffy guards, and he just tried to kill Harry to clear his path. They do not notice that Quirrell, sitting beside Snape, has stopped muttering too.',
  },
  'S-HP-010': {
    id: 'S-HP-010',
    kind: 'scene',
    arcId: 'SC-HP-02',
    locationId: 'L-HP-02',
    participantIds: ['C-HP-01', 'C-HP-04'],
    events: ['mirror_of_erised', 'dumbledore_appears', 'desire_and_truth'],
    threadMutations: [
      { threadId: 'T-HP-01', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-84', action: 'added', content: 'The Mirror of Erised shows the deepest desire of one\'s heart — Harry saw his parents, alive and smiling' },
      { characterId: 'C-HP-01', nodeId: 'K-HP-85', action: 'added', content: 'Dumbledore warned him: the mirror gives neither knowledge nor truth, and men have wasted away before it' },
    ],
    relationshipMutations: [
      { from: 'C-HP-01', to: 'C-HP-04', type: 'Dumbledore spoke to him like an equal — honest, gentle, and unbearably sad', valenceDelta: 0.2 },
    ],
    stakes: 60,
    prose: '',
    summary: 'An empty classroom at midnight. Harry finds the Mirror of Erised and sees, for the first time, his parents — Lily and James Potter, smiling, waving, alive in the glass. He returns night after night, starving for the only family he has ever seen. Dumbledore finds him there. He does not punish. He explains. "The happiest man on earth would look in the mirror and see only himself, exactly as he is." He tells Harry the mirror will be moved and must not be sought again. Harry asks what Dumbledore sees. "I? I see myself holding a pair of thick, woollen socks." It is, Harry suspects, the only time Dumbledore has not told him the truth.',
  },

  // ── Arc 3: Through the Trapdoor ───────────────────────────────────────────
  'S-HP-011': {
    id: 'S-HP-011',
    kind: 'scene',
    arcId: 'SC-HP-03',
    locationId: 'L-HP-07',
    participantIds: ['C-HP-01', 'C-HP-06', 'C-HP-08'],
    characterMovements: { 'C-HP-01': 'L-HP-07', 'C-HP-06': 'L-HP-07' },
    events: ['detention_forest', 'unicorn_blood', 'voldemort_shadow', 'centaur_warning'],
    threadMutations: [
      { threadId: 'T-HP-05', from: 'dormant', to: 'surfacing' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-86', action: 'added', content: 'A cloaked figure was drinking unicorn blood in the forest — the centaur Firenze said only one who has nothing to lose would commit such a crime' },
      { characterId: 'C-HP-01', nodeId: 'K-HP-87', action: 'added', content: 'Firenze implied that Voldemort is not truly dead — he is in the forest, surviving on unicorn blood, waiting' },
    ],
    relationshipMutations: [],
    stakes: 65,
    prose: '',
    summary: 'The Forbidden Forest. Detention has brought Harry into the trees at night. With Hagrid and Fang, they follow a trail of silver blood — unicorn blood, luminous in the dark. Harry finds the unicorn: dead, its white body a wound against the forest floor. And beside it, a hooded figure drinking the silver blood from the wound. The figure rises. Harry\'s scar explodes with pain. The centaur Firenze carries him to safety and speaks in the careful language of prophecy: unicorn blood will keep you alive even if you are an inch from death, but at a terrible price. "Can you think of nobody who has waited many years to return to power, who has clung to life, awaiting their chance?" Harry can. The name forms in the dark like a scar.',
  },
  'S-HP-012': {
    id: 'S-HP-012',
    kind: 'scene',
    arcId: 'SC-HP-03',
    locationId: 'L-HP-02',
    participantIds: ['C-HP-01', 'C-HP-02', 'C-HP-03'],
    events: ['nicholas_flamel_identified', 'stone_purpose_known', 'snape_plan_assumed', 'decision_to_act'],
    threadMutations: [
      { threadId: 'T-HP-01', from: 'escalating', to: 'threatened' },
      { threadId: 'T-HP-05', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-02', nodeId: 'K-HP-18', action: 'added', content: 'Nicholas Flamel is the only known maker of the Philosopher\'s Stone — it produces the Elixir of Life' },
      { characterId: 'C-HP-01', nodeId: 'K-HP-88', action: 'added', content: 'Voldemort wants the Stone to return to full power — and Snape is helping him get it' },
    ],
    relationshipMutations: [
      { from: 'C-HP-03', to: 'C-HP-01', type: 'Ron squares his shoulders — if Harry is going through the trapdoor, so is he', valenceDelta: 0.2 },
      { from: 'C-HP-02', to: 'C-HP-01', type: 'Hermione closes her book — some things are more important than exams', valenceDelta: 0.2 },
    ],
    stakes: 75,
    prose: '',
    summary: 'The Gryffindor common room. The pieces fall together at last. Hermione has found Nicholas Flamel — six hundred and sixty-five years old, the only known maker of the Philosopher\'s Stone. The Stone creates the Elixir of Life: drink it, and you will never die. Now they understand what Fluffy guards, and what Voldemort hunts. They are wrong about who is helping him — they believe it is Snape — but they are right about the stakes. Dumbledore has been called away from the castle. Tonight, someone will go through the trapdoor. Harry looks at Ron and Hermione. "We\'re going tonight." Ron nods. Hermione takes a breath and nods too. They are eleven years old.',
  },
  'S-HP-013': {
    id: 'S-HP-013',
    kind: 'scene',
    arcId: 'SC-HP-03',
    locationId: 'L-HP-06',
    participantIds: ['C-HP-01', 'C-HP-02', 'C-HP-03'],
    characterMovements: { 'C-HP-01': 'L-HP-06', 'C-HP-02': 'L-HP-06', 'C-HP-03': 'L-HP-06' },
    events: ['fluffy_asleep', 'devils_snare', 'flying_keys', 'chess_sacrifice'],
    threadMutations: [
      { threadId: 'T-HP-04', from: 'escalating', to: 'threatened' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-89', action: 'added', content: 'Ron sacrificed himself on the chess board so Harry and Hermione could go on — the bravest thing Harry has ever seen' },
    ],
    relationshipMutations: [
      { from: 'C-HP-01', to: 'C-HP-03', type: 'Ron lay down on the board knowing what would happen — this is what friendship means', valenceDelta: 0.3 },
      { from: 'C-HP-02', to: 'C-HP-03', type: 'Hermione\'s voice breaks as she calls him brave — the word she once reserved for books', valenceDelta: 0.2 },
    ],
    stakes: 85,
    prose: '',
    summary: 'Through the trapdoor. The gauntlet begins. Devil\'s Snare coils around them in the dark — Hermione remembers it hates light and conjures bluebell flames. A chamber of flying keys — Harry catches the right one on a broomstick, his Seeker instincts singing. Then the chessboard. McGonagall\'s enchantment: a full-size wizard chess set, and they must play their way across. Ron takes command. He has played chess his entire life, always in his brothers\' shadows, and here at last his gift matters. He sees the board with terrible clarity. "I\'ve got to be taken," he says quietly. He sacrifices himself — the white queen strikes him across the head and he crumples. Hermione nearly screams. Harry walks on. He must.',
  },
  'S-HP-014': {
    id: 'S-HP-014',
    kind: 'scene',
    arcId: 'SC-HP-03',
    locationId: 'L-HP-06',
    participantIds: ['C-HP-01', 'C-HP-08'],
    events: ['quirrell_revealed', 'mirror_of_erised_again', 'voldemort_face', 'stone_in_pocket'],
    threadMutations: [
      { threadId: 'T-HP-05', from: 'escalating', to: 'threatened' },
      { threadId: 'T-HP-03', from: 'escalating', to: 'threatened' },
      { threadId: 'T-HP-01', from: 'threatened', to: 'critical' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-90', action: 'added', content: 'It was Quirrell all along — Snape was trying to protect the Stone, not steal it' },
      { characterId: 'C-HP-01', nodeId: 'K-HP-91', action: 'added', content: 'Voldemort lives on the back of Quirrell\'s head — a face without a body, a will without a form' },
      { characterId: 'C-HP-01', nodeId: 'K-HP-92', action: 'added', content: 'The Stone appeared in his pocket when he looked in the Mirror — because he wanted to find it, not use it' },
    ],
    relationshipMutations: [
      { from: 'C-HP-01', to: 'C-HP-05', type: 'Everything he believed about Snape was wrong — the hatred was real, but so was the protection', valenceDelta: 0.4 },
    ],
    stakes: 95,
    prose: '',
    summary: 'The final chamber. The Mirror of Erised stands alone. And before it stands not Snape but Quirrell — turban unwound, hands steady, eyes clear for the first time. "I wondered whether I\'d be meeting you here, Potter." Everything the trio believed collapses. Snape was protecting the Stone; Quirrell was stealing it. Quirrell snaps his fingers and ropes bind Harry. He turns to the Mirror but cannot solve it — he sees himself presenting the Stone to his master, and the Mirror will not yield to desire for use. Voldemort speaks from the back of Quirrell\'s skull: "Use the boy." Harry looks into the Mirror and sees himself dropping the Stone into his pocket. He feels the weight. The Philosopher\'s Stone is in his pocket. He lies. Voldemort knows.',
  },
  'S-HP-015': {
    id: 'S-HP-015',
    kind: 'scene',
    arcId: 'SC-HP-03',
    locationId: 'L-HP-06',
    participantIds: ['C-HP-01', 'C-HP-04', 'C-HP-08'],
    events: ['touch_burns_quirrell', 'lily_protection', 'voldemort_flees', 'hospital_wing', 'dumbledore_explains'],
    threadMutations: [
      { threadId: 'T-HP-01', from: 'critical', to: 'resolved' },
      { threadId: 'T-HP-05', from: 'threatened', to: 'subverted' },
      { threadId: 'T-HP-04', from: 'threatened', to: 'resolved' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-93', action: 'added', content: 'His mother\'s love left a protection in his skin — Quirrell burned at Harry\'s touch, and Voldemort could not possess him' },
      { characterId: 'C-HP-01', nodeId: 'K-HP-94', action: 'added', content: 'Dumbledore destroyed the Stone — Nicholas Flamel will die, but chose to because death is the next great adventure' },
      { characterId: 'C-HP-01', nodeId: 'K-HP-95', action: 'added', content: 'Voldemort is not dead. He is out there, weakened, waiting. He will try again.' },
    ],
    relationshipMutations: [
      { from: 'C-HP-04', to: 'C-HP-01', type: 'The boy survived again — love\'s protection held, but the next time will require more than a mother\'s sacrifice', valenceDelta: 0.1 },
    ],
    stakes: 90,
    prose: '',
    summary: 'Quirrell seizes Harry by the throat. His skin blisters and burns at the contact. Harry screams — but so does Quirrell. Where Harry\'s hands touch bare flesh, Quirrell crumbles. Voldemort\'s voice shrieks as his servant collapses to dust. A shadow — formless, furious — rips through Harry and vanishes into the night. Harry blacks out. He wakes in the hospital wing. Dumbledore sits beside his bed and explains everything: Lily Potter\'s love marked Harry with a protection so powerful that Quirrell, full of hatred and greed, could not touch him. The Stone has been destroyed. Flamel will die. "To the well-organized mind, death is but the next great adventure." But Voldemort is not dead. He is diminished, disembodied, but alive. He will return. And when he does, Harry will be waiting — a boy with a lightning scar, two best friends, and a mother\'s love burning in his blood.',
  },
};

// ── Commits ──────────────────────────────────────────────────────────────────
const diffNames: Record<string, string> = {
  'S-HP-001': 'yer_a_wizard',
  'S-HP-002': 'diagon_alley',
  'S-HP-003': 'hogwarts_express',
  'S-HP-004': 'sorting_ceremony',
  'S-HP-005': 'handshake_refused',
  'S-HP-006': 'snape_hostility',
  'S-HP-007': 'fluffy_discovered',
  'S-HP-008': 'troll_friendship',
  'S-HP-009': 'broom_jinx',
  'S-HP-010': 'mirror_of_erised',
  'S-HP-011': 'unicorn_blood',
  'S-HP-012': 'flamel_identified',
  'S-HP-013': 'chess_sacrifice',
  'S-HP-014': 'quirrell_revealed',
  'S-HP-015': 'loves_protection',
};

const sceneList = Object.values(scenes);
const commits: Commit[] = sceneList.map((scene, i) => ({
  id: `CM-HP-${String(i + 1).padStart(3, '0')}`,
  parentId: i === 0 ? null : `CM-HP-${String(i).padStart(3, '0')}`,
  sceneId: scene.id,
  arcId: scene.arcId,
  diffName: diffNames[scene.id] ?? 'thread_surfaced',
  threadMutations: scene.threadMutations,
  knowledgeMutations: scene.knowledgeMutations,
  relationshipMutations: scene.relationshipMutations,
  authorOverride: null,
  createdAt: Date.now() - (15 - i) * 3600000,
}));

// ── Alternate Branch: "The Slytherin Sorting" ────────────────────────────────
// Diverges after S-HP-005 — the Sorting Hat placed Harry in Slytherin,
// fundamentally altering his alliances, friendships, and path through the mystery.

const altArc: Arc = {
  id: 'SC-HP-02-ALT',
  name: 'The Serpent\'s Path',
  sceneIds: ['S-HP-ALT-006', 'S-HP-ALT-007', 'S-HP-ALT-008', 'S-HP-ALT-009', 'S-HP-ALT-010'],
  develops: ['T-HP-02', 'T-HP-07'],
  locationIds: ['L-HP-02', 'L-HP-05', 'L-HP-06'],
  activeCharacterIds: ['C-HP-01', 'C-HP-02', 'C-HP-03', 'C-HP-05', 'C-HP-07'],
  initialCharacterLocations: {
    'C-HP-01': 'L-HP-05',
    'C-HP-02': 'L-HP-02',
    'C-HP-03': 'L-HP-02',
    'C-HP-05': 'L-HP-02',
    'C-HP-07': 'L-HP-05',
  },
};

const altScenes: Record<string, Scene> = {
  'S-HP-ALT-006': {
    id: 'S-HP-ALT-006',
    kind: 'scene',
    arcId: 'SC-HP-02-ALT',
    locationId: 'L-HP-05',
    participantIds: ['C-HP-01', 'C-HP-07'],
    events: ['slytherin_table', 'malfoy_extends_hand_again', 'uneasy_acceptance'],
    threadMutations: [
      { threadId: 'T-HP-07', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-ALT-01', action: 'added', content: 'The Hat said Slytherin and he did not fight it — something in him wanted to know what greatness meant' },
      { characterId: 'C-HP-07', nodeId: 'K-HP-ALT-02', action: 'added', content: 'Potter is in Slytherin — Father will be pleased, and this changes everything' },
    ],
    relationshipMutations: [
      { from: 'C-HP-07', to: 'C-HP-01', type: 'Recalculates entirely — Potter as an ally is worth more than Potter as an enemy', valenceDelta: 0.6 },
      { from: 'C-HP-01', to: 'C-HP-07', type: 'Draco is his only guide in a house that watches him with silver eyes', valenceDelta: 0.3 },
    ],
    stakes: 40,
    prose: '',
    summary: 'The Great Hall falls silent when the Hat calls "SLYTHERIN!" Harry walks to the wrong table — the table draped in green and silver, where the applause is calculating rather than warm. Draco Malfoy slides over to make room, and this time his extended hand is not a demand but an offering. Harry takes it. Ron Weasley stares from the Gryffindor table as though watching a friend drown. Hermione looks away. At the staff table, Dumbledore\'s eyes do not twinkle. In the dungeons that night, Harry lies in a four-poster bed hung with emerald curtains and wonders whether the Hat saw something true in him — an ambition, a hunger, a darkness — that he has been refusing to see in himself.',
  },
  'S-HP-ALT-007': {
    id: 'S-HP-ALT-007',
    kind: 'scene',
    arcId: 'SC-HP-02-ALT',
    locationId: 'L-HP-02',
    participantIds: ['C-HP-01', 'C-HP-05'],
    events: ['snape_reappraisal', 'potions_favoritism', 'slytherin_privilege'],
    threadMutations: [
      { threadId: 'T-HP-03', from: 'dormant', to: 'surfacing' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-ALT-03', action: 'added', content: 'Snape did not humiliate him — he looked at Harry with an expression that was almost recognition, almost pain' },
    ],
    relationshipMutations: [
      { from: 'C-HP-05', to: 'C-HP-01', type: 'Lily\'s son in Slytherin robes — the cruelty catches in his throat, replaced by something worse: hope', valenceDelta: 0.3 },
      { from: 'C-HP-01', to: 'C-HP-05', type: 'Snape is not the monster he expected — in Slytherin, the hatred softened into something unreadable', valenceDelta: 0.3 },
    ],
    stakes: 45,
    prose: '',
    summary: 'Potions class. Snape enters and his gaze finds Harry in Slytherin robes. Something fractures in his expression — barely visible, instantly suppressed. There is no public humiliation. The questions come, but they are tests, not punishments. When Harry answers incorrectly, Snape corrects him with clipped precision rather than contempt. The Gryffindors are baffled. Harry is baffled. In Slytherin green, he looks less like James Potter, and the resemblance that remains — Lily\'s eyes in a Slytherin face — is a mirror Snape cannot look away from. For the first time, the hatred has nowhere to land.',
  },
  'S-HP-ALT-008': {
    id: 'S-HP-ALT-008',
    kind: 'scene',
    arcId: 'SC-HP-02-ALT',
    locationId: 'L-HP-02',
    participantIds: ['C-HP-01', 'C-HP-02', 'C-HP-03'],
    events: ['hermione_troll_alone', 'harry_hears', 'crosses_house_lines', 'fragile_bridge'],
    threadMutations: [
      { threadId: 'T-HP-04', from: 'surfacing', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-02', nodeId: 'K-HP-ALT-04', action: 'added', content: 'A Slytherin came to save her — Harry Potter crossed every line his house would punish him for' },
    ],
    relationshipMutations: [
      { from: 'C-HP-02', to: 'C-HP-01', type: 'He is in the wrong house but he came anyway — the bravest thing she has ever seen a Slytherin do', valenceDelta: 0.4 },
      { from: 'C-HP-01', to: 'C-HP-02', type: 'Hermione is the only person who looked at his green tie and saw him, not it', valenceDelta: 0.3 },
    ],
    stakes: 50,
    prose: '',
    summary: 'Halloween. The troll. In this timeline, Ron is not there — he and Harry have barely spoken since the Sorting. But Harry hears that Hermione is in the bathroom and goes anyway, alone, a Slytherin breaking ranks for a Muggle-born Gryffindor. He faces the troll with nothing but a wand he barely knows how to use and a recklessness that belongs to no house. Hermione sees a boy in green robes pulling her from the rubble. When the professors arrive, she lies for him — tells them she went looking for the troll. In the corridor after, she whispers, "You didn\'t have to come." He says, "I know." They are friends now, and it is the most dangerous friendship in Hogwarts — a Slytherin and a Muggle-born, allied across every line the school draws.',
  },
  'S-HP-ALT-009': {
    id: 'S-HP-ALT-009',
    kind: 'scene',
    arcId: 'SC-HP-02-ALT',
    locationId: 'L-HP-06',
    participantIds: ['C-HP-01', 'C-HP-07'],
    characterMovements: { 'C-HP-01': 'L-HP-06', 'C-HP-07': 'L-HP-06' },
    events: ['draco_shows_corridor', 'slytherin_information_network', 'fluffy_discovery_different'],
    threadMutations: [
      { threadId: 'T-HP-07', from: 'escalating', to: 'threatened' },
      { threadId: 'T-HP-01', from: 'dormant', to: 'surfacing' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-ALT-05', action: 'added', content: 'Draco brought him to the third-floor corridor on purpose — in Slytherin, secrets are currency, and Draco is investing in Harry' },
      { characterId: 'C-HP-07', nodeId: 'K-HP-ALT-06', action: 'added', content: 'Showed Potter the forbidden corridor — binding him with shared transgression, the Slytherin way' },
    ],
    relationshipMutations: [
      { from: 'C-HP-01', to: 'C-HP-07', type: 'Draco is useful and clever but never safe — every gift comes with invisible strings', valenceDelta: 0.1 },
    ],
    stakes: 55,
    prose: '',
    summary: 'The third-floor corridor. In this timeline, it is Draco who leads Harry to Fluffy — not by accident but by design. The Slytherin information network runs deeper than Gryffindor curiosity ever could. "My father mentioned something about Dumbledore and a certain alchemist," Draco says, leading them through the forbidden door with a confidence that makes Harry uneasy. They see the three-headed dog. They see the trapdoor. But here the discovery is not innocent wonder — it is Slytherin calculation. Draco files the knowledge away like a weapon. Harry watches Draco watching Fluffy and understands something new: in this house, everything is leverage. Even friendship. Especially friendship.',
  },
  'S-HP-ALT-010': {
    id: 'S-HP-ALT-010',
    kind: 'scene',
    arcId: 'SC-HP-02-ALT',
    locationId: 'L-HP-02',
    participantIds: ['C-HP-01', 'C-HP-03'],
    events: ['ron_confrontation', 'loyalty_tested', 'bridge_between_houses'],
    threadMutations: [
      { threadId: 'T-HP-02', from: 'escalating', to: 'threatened' },
    ],
    knowledgeMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-ALT-07', action: 'added', content: 'Ron said he would have been his friend if the Hat had chosen differently — and Harry knows he still could be, if either of them is brave enough' },
      { characterId: 'C-HP-03', nodeId: 'K-HP-ALT-08', action: 'added', content: 'Harry is not like the other Slytherins — he saved the Granger girl, and his eyes are honest even when his tie is green' },
    ],
    relationshipMutations: [
      { from: 'C-HP-03', to: 'C-HP-01', type: 'Grudging respect — the Slytherin who keeps acting like a Gryffindor', valenceDelta: 0.3 },
      { from: 'C-HP-01', to: 'C-HP-03', type: 'The friend he should have had — the train compartment haunts him', valenceDelta: 0.3 },
    ],
    stakes: 60,
    prose: '',
    summary: 'A corridor between classes. Ron blocks Harry\'s path. Months of avoidance collapse into a single confrontation. "You chose them." "The Hat chose." "You could have fought it." The silence stretches. Then Ron says, quieter: "I would\'ve been your friend, you know. On the train. Before any of it." Harry says, "You still could be." It is the most dangerous sentence either of them has spoken — a Weasley allying with a Slytherin would shake both houses to their foundations. Ron looks at Harry\'s green tie, then at his eyes. Something shifts. The story fractures here: in the canon timeline, the trio formed around a troll. In this one, it might form around something harder and rarer — the choice to reach across a divide that everyone says cannot be crossed.',
  },
};

// Merge alt scenes and arc into the main records
// ── Initial World Building Commit ────────────────────────────────────────────
const wxInitCommit: WorldBuildCommit = {
  kind: 'world_build',
  id: 'WX-HP-init',
  summary: 'World created: 8 characters (Harry Potter, Hermione Granger, Ron Weasley, Albus Dumbledore, Severus Snape, Rubeus Hagrid, Draco Malfoy, Quirinus Quirrell), 8 locations (Wizarding Britain, Hogwarts, Privet Drive, Diagon Alley, The Great Hall, The Third-Floor Corridor, The Forbidden Forest, Gringotts), 7 threads, 10 relationships',
  expansionManifest: {
    characterIds: Object.keys(characters),
    locationIds: Object.keys(locations),
    threadIds: Object.keys(threads),
    relationshipCount: relationships.length,
  },
};

const allScenes: Record<string, Scene> = { ...scenes, ...altScenes };
const allWorldBuilds: Record<string, WorldBuildCommit> = { 'WX-HP-init': wxInitCommit };
const allArcs: Record<string, Arc> = { ...arcs, [altArc.id]: altArc };

// ── Branches ────────────────────────────────────────────────────────────────
const branches: Record<string, Branch> = {
  'B-HP-MAIN': {
    id: 'B-HP-MAIN',
    name: 'Canon Timeline',
    parentBranchId: null,
    forkEntryId: null,
    entryIds: ['WX-HP-init', ...Object.keys(scenes)],
    createdAt: Date.now() - 86400000,
  },
  'B-HP-SLYTHERIN': {
    id: 'B-HP-SLYTHERIN',
    name: 'The Slytherin Sorting',
    parentBranchId: 'B-HP-MAIN',
    forkEntryId: 'S-HP-005',
    entryIds: Object.keys(altScenes),
    createdAt: Date.now() - 43200000,
  },
};

// ── Assembled Narrative ──────────────────────────────────────────────────────
export const seedHP: NarrativeState = {
  id: 'N-HP',
  title: "Harry Potter and the Philosopher's Stone",
  description: 'An orphan boy raised in a cupboard under the stairs discovers he is the most famous wizard alive. At Hogwarts School of Witchcraft and Wizardry, Harry finds friendship, wonder, and a mystery hidden beneath a three-headed dog — a mystery that leads him to the shattered remains of Lord Voldemort, clinging to half-life on the back of a professor\'s skull. The boy who lived must now learn what that survival costs.',
  characters,
  locations,
  threads,
  arcs: allArcs,
  scenes: allScenes,
  worldBuilds: allWorldBuilds,
  branches,
  commits,
  relationships,
  worldSummary: 'Wizarding Britain hides in plain sight beneath Muggle England — a parallel world of wands and cauldrons, owls and enchantments, governed by the Ministry of Magic and haunted by the shadow of Lord Voldemort. Ten years ago, the darkest wizard in a century fell when his Killing Curse rebounded off a one-year-old boy named Harry Potter. The wizarding world celebrated. Harry was left on a doorstep. Now eleven, he arrives at Hogwarts carrying nothing but a wand, an owl, and a scar. The school is ancient, magnificent, and not entirely safe. Something is hidden on the third-floor corridor. Something is drinking unicorn blood in the Forbidden Forest. And someone wearing a turban is not who they appear to be. The Boy Who Lived is about to learn that survival is only the beginning.',
  controlMode: 'auto',
  activeForces: { stakes: 0, pacing: 0, variety: 0 },
  coverImageUrl: '/covers/hp.jpg',
  createdAt: Date.now() - 86400000,
  updatedAt: Date.now(),
};
