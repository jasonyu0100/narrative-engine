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
    imagePrompt: 'A thin eleven-year-old boy with untidy jet-black hair, bright green eyes behind round wire-rimmed glasses, and a lightning-bolt scar on his forehead. He wears an oversized hand-me-down jumper, looking small but alert.',
    threadIds: ['T-HP-01', 'T-HP-02', 'T-HP-06'],
    continuity: {
      nodes: [
        { id: 'K-HP-01', type: 'knows', content: 'An orphan raised by the Dursleys, told his parents died in a car crash' },
        { id: 'K-HP-02', type: 'believes', content: 'Strange things happen around him — glass vanishing, hair regrowing — but he cannot explain why' },
        { id: 'K-HP-03', type: 'goal', content: 'Escape the cupboard under the stairs and find where he truly belongs' },
        { id: 'K-HP-04', type: 'knows', content: 'A lightning-bolt scar on his forehead, origin unknown' },
        { id: 'K-HP-05', type: 'secret', content: 'Does not yet know he is the Boy Who Lived, or that an entire world reveres his name' },
      ],
    },
  },
  'C-HP-02': {
    id: 'C-HP-02',
    name: 'Hermione Granger',
    role: 'anchor',
    imagePrompt: 'A girl with bushy brown hair, bright brown eyes, and slightly large front teeth, carrying an armful of heavy books. She wears crisp Hogwarts robes with a Gryffindor tie, her expression earnest and determined.',
    threadIds: ['T-HP-01', 'T-HP-04'],
    continuity: {
      nodes: [
        { id: 'K-HP-10', type: 'knows', content: 'Muggle-born witch who received her Hogwarts letter with no prior knowledge of magic' },
        { id: 'K-HP-11', type: 'believes', content: 'Knowledge and preparation are the surest shields against an uncertain world' },
        { id: 'K-HP-12', type: 'goal', content: 'Prove that she belongs in the wizarding world despite her parentage' },
        { id: 'K-HP-13', type: 'knows', content: 'Has memorized every textbook before term begins — including Hogwarts: A History' },
        { id: 'K-HP-14', type: 'believes', content: 'Rules exist for good reasons, and breaking them endangers everyone' },
      ],
    },
  },
  'C-HP-03': {
    id: 'C-HP-03',
    name: 'Ron Weasley',
    role: 'recurring',
    imagePrompt: 'A tall, gangly boy with flaming red hair, freckles, and a long nose. He wears slightly shabby second-hand robes and has a warm, lopsided grin despite looking a bit underfed.',
    threadIds: ['T-HP-04', 'T-HP-07'],
    continuity: {
      nodes: [
        { id: 'K-HP-20', type: 'knows', content: 'Sixth son in a family of accomplished wizards — always compared, never first' },
        { id: 'K-HP-21', type: 'believes', content: 'He will never be as good as his brothers, so why pretend otherwise' },
        { id: 'K-HP-22', type: 'goal', content: 'Step out from the shadow of his brothers and prove his own worth' },
        { id: 'K-HP-23', type: 'knows', content: 'Grew up in the wizarding world — understands customs, Quidditch, and wizard chess instinctively' },
      ],
    },
  },
  'C-HP-04': {
    id: 'C-HP-04',
    name: 'Albus Dumbledore',
    role: 'recurring',
    imagePrompt: 'A tall, thin, very old man with a long silver beard and half-moon spectacles perched on a crooked nose. He wears sweeping purple robes embroidered with silver stars, his blue eyes twinkling with quiet amusement.',
    threadIds: ['T-HP-01', 'T-HP-05'],
    continuity: {
      nodes: [
        { id: 'K-HP-30', type: 'knows', content: 'The Philosopher\'s Stone is hidden in Hogwarts at Nicholas Flamel\'s request' },
        { id: 'K-HP-31', type: 'secret', content: 'Suspects Voldemort has attached himself to someone inside the school' },
        { id: 'K-HP-32', type: 'goal', content: 'Protect the Stone while allowing Harry to grow into the courage he will need' },
        { id: 'K-HP-33', type: 'believes', content: 'Love is the deepest magic — Harry carries a protection Voldemort cannot comprehend' },
        { id: 'K-HP-34', type: 'knows', content: 'The Mirror of Erised will only yield the Stone to one who desires it but not its use' },
      ],
    },
  },
  'C-HP-05': {
    id: 'C-HP-05',
    name: 'Severus Snape',
    role: 'recurring',
    imagePrompt: 'A thin man with sallow skin, a large hooked nose, and greasy shoulder-length black hair that frames his gaunt face. He wears billowing black robes and regards the world with cold, glittering dark eyes.',
    threadIds: ['T-HP-03', 'T-HP-01'],
    continuity: {
      nodes: [
        { id: 'K-HP-40', type: 'secret', content: 'Loved Lily Potter until her death — protects Harry for her sake, despises him for his father\'s' },
        { id: 'K-HP-41', type: 'knows', content: 'Quirrell is behaving suspiciously and may be compromised' },
        { id: 'K-HP-42', type: 'goal', content: 'Guard the Stone and keep his oath to Dumbledore, regardless of personal cost' },
        { id: 'K-HP-43', type: 'believes', content: 'Potter is an arrogant mirror of James — talent unearned, fame undeserved' },
      ],
    },
  },
  'C-HP-06': {
    id: 'C-HP-06',
    name: 'Rubeus Hagrid',
    role: 'transient',
    imagePrompt: 'An enormous man nearly twice the height of a normal person, with a wild tangle of bushy black hair and a thick, matted beard that hides most of his face. He wears a massive moleskin overcoat with countless pockets, his beetle-black eyes crinkling warmly.',
    threadIds: ['T-HP-02', 'T-HP-06'],
    continuity: {
      nodes: [
        { id: 'K-HP-50', type: 'knows', content: 'Delivered baby Harry to Privet Drive the night his parents died' },
        { id: 'K-HP-51', type: 'secret', content: 'Told a stranger in a pub how to get past Fluffy — just play him a bit of music' },
        { id: 'K-HP-52', type: 'believes', content: 'Dumbledore is the greatest wizard alive and his trust is never misplaced' },
        { id: 'K-HP-53', type: 'goal', content: 'Protect Harry and help him feel at home in the world that has always been his' },
      ],
    },
  },
  'C-HP-07': {
    id: 'C-HP-07',
    name: 'Draco Malfoy',
    role: 'transient',
    imagePrompt: 'A pale, pointed-faced boy with sleek white-blond hair combed neatly back and cold grey eyes. He wears immaculate, expensive-looking Hogwarts robes and carries himself with a haughty sneer.',
    threadIds: ['T-HP-07'],
    continuity: {
      nodes: [
        { id: 'K-HP-60', type: 'believes', content: 'Pure-blood wizards are inherently superior — Muggle-borns dilute magical society' },
        { id: 'K-HP-61', type: 'goal', content: 'Establish himself as the dominant figure in his year, as befits a Malfoy' },
        { id: 'K-HP-62', type: 'knows', content: 'His father served the Dark Lord and still whispers of the old ways at home' },
      ],
    },
  },
  'C-HP-08': {
    id: 'C-HP-08',
    name: 'Quirinus Quirrell',
    role: 'transient',
    imagePrompt: 'A pale, nervous young professor with a large purple turban wound around his head and a twitchy, stammering manner. His face is pinched and anxious, and there is a faint smell of garlic about his robes.',
    threadIds: ['T-HP-05', 'T-HP-01'],
    continuity: {
      nodes: [
        { id: 'K-HP-70', type: 'secret', content: 'Voldemort lives as a parasitic face on the back of his skull, hidden beneath a turban' },
        { id: 'K-HP-71', type: 'goal', content: 'Retrieve the Philosopher\'s Stone for his master and restore Voldemort to power' },
        { id: 'K-HP-72', type: 'knows', content: 'The Stone is protected by enchantments from each Hogwarts professor' },
        { id: 'K-HP-73', type: 'believes', content: 'There is no returning from this servitude — only obedience or annihilation' },
      ],
    },
  },
};

// ── Locations ────────────────────────────────────────────────────────────────
const locations: Record<string, Location> = {
  'L-HP-01': {
    id: 'L-HP-01', name: 'Wizarding Britain', parentId: null, threadIds: [],
    imagePrompt: 'A misty, rain-swept British landscape with hidden magical enclaves tucked behind ordinary facades — cobblestone lanes, enchanted shopfronts, and owls gliding through grey skies over rolling green countryside.',
    continuity: {
      nodes: [
        { id: 'LK-HP-01', type: 'lore', content: 'A hidden magical society layered beneath Muggle Britain, governed by the Ministry of Magic' },
        { id: 'LK-HP-02', type: 'lore', content: 'Ten years of peace since the fall of He-Who-Must-Not-Be-Named — but the peace is fragile' },
      ],
    },
  },
  'L-HP-02': {
    id: 'L-HP-02', name: 'Hogwarts School of Witchcraft and Wizardry', parentId: 'L-HP-01', threadIds: ['T-HP-01', 'T-HP-04'],
    imagePrompt: 'A vast medieval castle with soaring towers, turrets, and battlements perched on a cliff above a dark lake, its hundreds of windows glowing warmly against a starlit Scottish Highland sky.',
    continuity: {
      nodes: [
        { id: 'LK-HP-03', type: 'lore', content: 'A thousand-year-old castle in the Scottish Highlands, the foremost school of magic in Europe' },
        { id: 'LK-HP-04', type: 'secret', content: 'The third-floor corridor on the right-hand side conceals a trapdoor guarded by a three-headed dog' },
      ],
    },
  },
  'L-HP-03': {
    id: 'L-HP-03', name: 'Number Four, Privet Drive', parentId: 'L-HP-01', threadIds: ['T-HP-06'],
    imagePrompt: 'A painfully ordinary 1980s suburban semi-detached house on a manicured cul-de-sac — identical hedges, a polished car in the driveway, net curtains, and an oppressive air of enforced normality under flat grey skies.',
    continuity: {
      nodes: [
        { id: 'LK-HP-05', type: 'lore', content: 'A ruthlessly ordinary suburban home in Little Whinging, Surrey — normalcy enforced like a religion' },
        { id: 'LK-HP-06', type: 'secret', content: 'Protected by an ancient blood ward tied to Lily Potter\'s sacrifice — as long as Harry calls it home, Voldemort cannot touch him there' },
      ],
    },
  },
  'L-HP-04': {
    id: 'L-HP-04', name: 'Diagon Alley', parentId: 'L-HP-01', threadIds: ['T-HP-02'],
    imagePrompt: 'A narrow, winding cobblestone street bursting with colour — crooked shopfronts stacked with cauldrons, broomsticks, and spell books, owls perched on awnings, and witches and wizards bustling past in vivid robes under a strip of bright sky.',
    continuity: {
      nodes: [
        { id: 'LK-HP-07', type: 'lore', content: 'The hidden high street of wizarding London — wands, cauldrons, owls, and wonder behind a brick wall' },
        { id: 'LK-HP-08', type: 'lore', content: 'Accessible through the Leaky Cauldron, invisible to Muggle eyes' },
      ],
    },
  },
  'L-HP-05': {
    id: 'L-HP-05', name: 'The Great Hall', parentId: 'L-HP-02', threadIds: ['T-HP-07'],
    imagePrompt: 'A cavernous hall lit by thousands of floating candles, four long wooden tables stretching toward a raised staff dais, with an enchanted ceiling showing a swirl of stars and drifting clouds above.',
    continuity: {
      nodes: [
        { id: 'LK-HP-09', type: 'lore', content: 'An enchanted ceiling reflecting the sky above, four long house tables, and the Sorting Hat\'s ancient song' },
        { id: 'LK-HP-10', type: 'lore', content: 'Where the Sorting Ceremony determines the trajectory of every student\'s life at Hogwarts' },
      ],
    },
  },
  'L-HP-06': {
    id: 'L-HP-06', name: 'The Third-Floor Corridor', parentId: 'L-HP-02', threadIds: ['T-HP-01', 'T-HP-05'],
    imagePrompt: 'A dark, dusty stone corridor lit by guttering torches, with a heavy locked door at the far end. The air is thick with dread, and deep growling reverberates from behind the door.',
    continuity: {
      nodes: [
        { id: 'LK-HP-11', type: 'danger', content: 'Forbidden to all students on pain of a most painful death — Dumbledore\'s warning at the start-of-term feast' },
        { id: 'LK-HP-12', type: 'secret', content: 'Contains the trapdoor beneath Fluffy, leading to a gauntlet of enchantments protecting the Philosopher\'s Stone' },
      ],
    },
  },
  'L-HP-07': {
    id: 'L-HP-07', name: 'The Forbidden Forest', parentId: 'L-HP-02', threadIds: ['T-HP-05'],
    imagePrompt: 'An ancient, dense forest of towering gnarled trees with a thick canopy that blocks out moonlight. Silver mist curls between the roots, and the darkness between the trunks feels alive and watchful.',
    continuity: {
      nodes: [
        { id: 'LK-HP-13', type: 'danger', content: 'Ancient woodland on the Hogwarts grounds, home to centaurs, unicorns, and darker things' },
        { id: 'LK-HP-14', type: 'secret', content: 'Something has been killing unicorns and drinking their blood — a crime against nature that sustains a cursed half-life' },
      ],
    },
  },
  'L-HP-08': {
    id: 'L-HP-08', name: 'Gringotts Wizarding Bank', parentId: 'L-HP-04', threadIds: ['T-HP-01'],
    imagePrompt: 'A towering white marble building that leans slightly over Diagon Alley, with burnished bronze doors flanked by goblin guards in scarlet-and-gold uniforms. Inside, a vast hall of polished counters stretches into shadow.',
    continuity: {
      nodes: [
        { id: 'LK-HP-15', type: 'lore', content: 'Run by goblins deep beneath London — the safest place in the wizarding world, after Hogwarts' },
        { id: 'LK-HP-16', type: 'secret', content: 'Vault 713 held a small grubby package retrieved by Hagrid on Dumbledore\'s orders — the same day it was nearly robbed' },
      ],
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
    name: 'First Days',
    sceneIds: ['S-HP-006', 'S-HP-007', 'S-HP-008', 'S-HP-009', 'S-HP-010', 'S-HP-011', 'S-HP-012', 'S-HP-013', 'S-HP-014'],
    develops: ['T-HP-03', 'T-HP-04'],
    locationIds: ['L-HP-02', 'L-HP-05', 'L-HP-06'],
    activeCharacterIds: ['C-HP-01', 'C-HP-02', 'C-HP-03', 'C-HP-05', 'C-HP-07'],
    initialCharacterLocations: {
      'C-HP-01': 'L-HP-02',
      'C-HP-02': 'L-HP-02',
      'C-HP-03': 'L-HP-02',
      'C-HP-05': 'L-HP-02',
      'C-HP-07': 'L-HP-02',
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
    povId: 'C-HP-01',
    participantIds: ['C-HP-01', 'C-HP-06'],
    events: ['cupboard_morning', 'letters_from_no_one', 'hagrid_arrives'],
    threadMutations: [
      { threadId: 'T-HP-02', from: 'dormant', to: 'active' },
      { threadId: 'T-HP-06', from: 'dormant', to: 'active' },
    ],
    continuityMutations: [],
    relationshipMutations: [],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-01', concept: 'Wizarding World', type: 'concept' },
        { id: 'WK-HP-02', concept: 'Statute of Secrecy', type: 'law' },
      ],
      addedEdges: [
        { from: 'WK-HP-02', to: 'WK-HP-01', relation: 'conceals' },
        { from: 'WK-HP-01', to: 'WK-HP-02', relation: 'governed_by' },
      ],
    },
    summary: 'Number Four, Privet Drive. Harry wakes in the cupboard under the stairs, spider webs brushing his forehead. The Dursleys have spent ten years smothering every trace of strangeness from his life. But the letters have been arriving — dozens, then hundreds, flooding through the mail slot, squeezed under doors, stuffed inside eggs. Uncle Vernon boards the windows and flees to a rock in the sea. At midnight, the door comes off its hinges. Hagrid fills the doorway like a mountain wearing a moleskin coat. "Yer a wizard, Harry." The world cracks open.',
  },
  'S-HP-002': {
    id: 'S-HP-002',
    kind: 'scene',
    arcId: 'SC-HP-01',
    locationId: 'L-HP-04',
    povId: 'C-HP-01',
    participantIds: ['C-HP-01', 'C-HP-06'],
    characterMovements: { 'C-HP-01': { locationId: 'L-HP-04', transition: 'Led through the Leaky Cauldron and tapped through the enchanted brick wall' }, 'C-HP-06': { locationId: 'L-HP-04', transition: 'Escorted Harry through London and into the wizarding quarter' } },
    events: ['diagon_alley_revealed', 'gringotts_vault', 'wand_chooses_wizard'],
    threadMutations: [],
    continuityMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-06', action: 'added', content: 'His parents left him a fortune in gold Galleons — he was never the burden the Dursleys claimed' },
      { characterId: 'C-HP-01', nodeId: 'K-HP-07', action: 'added', content: 'Ollivander said his wand shares a core with Voldemort\'s — the phoenix feather that links them' },
    ],
    relationshipMutations: [],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-04', concept: 'The Wand Chooses the Wizard', type: 'law' },
        { id: 'WK-HP-05', concept: 'Goblin Banking System', type: 'system' },
      ],
      addedEdges: [
        { from: 'WK-HP-05', to: 'WK-HP-01', relation: 'part_of' },
        { from: 'WK-HP-04', to: 'WK-HP-01', relation: 'reveals' },
      ],
    },
    summary: 'Diagon Alley unfolds behind the Leaky Cauldron like a fever dream rendered in brick and gold. Witches and wizards recognize Harry in the street — they shake his hand, bow, weep. He has been famous his entire life and never knew. Hagrid leads him through Gringotts, where goblins guard a vault of gold his parents left behind, and retrieves a small grubby package from Vault 713. At Ollivanders, wand after wand refuses him — until the holly wand with the phoenix feather core leaps into his hand. Ollivander goes pale. "Curious. Very curious." The wand that chose Harry is brother to the wand that gave him his scar.',
  },
  'S-HP-003': {
    id: 'S-HP-003',
    kind: 'scene',
    arcId: 'SC-HP-01',
    locationId: 'L-HP-02',
    povId: 'C-HP-01',
    participantIds: ['C-HP-01', 'C-HP-03'],
    characterMovements: { 'C-HP-01': { locationId: 'L-HP-02', transition: 'Boarded the Hogwarts Express at Platform Nine and Three-Quarters' }, 'C-HP-03': { locationId: 'L-HP-02', transition: 'Boarded the train with his family and found a compartment' } },
    events: ['hogwarts_express', 'ron_meeting', 'chocolate_frogs', 'first_sight_of_castle'],
    threadMutations: [],
    continuityMutations: [
      { characterId: 'C-HP-03', nodeId: 'K-HP-24', action: 'added', content: 'Harry Potter sat in his compartment and shared his sweets — he is nothing like the legend' },
    ],
    relationshipMutations: [
      { from: 'C-HP-01', to: 'C-HP-03', type: 'Immediate warmth — Ron is the first boy his age to treat him normally', valenceDelta: 0.3 },
      { from: 'C-HP-03', to: 'C-HP-01', type: 'Starstruck but genuine — likes Harry before the legend, after the Chocolate Frogs', valenceDelta: 0.3 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-07', concept: 'Hogwarts Express & Platform Nine and Three-Quarters', type: 'system' },
      ],
      addedEdges: [
        { from: 'WK-HP-07', to: 'WK-HP-02', relation: 'enforces' },
        { from: 'WK-HP-07', to: 'WK-HP-01', relation: 'part_of' },
      ],
    },
    summary: 'Platform Nine and Three-Quarters. Harry runs at a brick wall and emerges into steam and scarlet. On the Hogwarts Express, he shares a compartment with Ron Weasley — a gangly boy with a hand-me-down rat and a sandwich he is embarrassed to eat. Harry buys the entire trolley. They talk about Quidditch, wizard chess, and Chocolate Frog cards. For the first time in his life, Harry has a friend his own age. As darkness falls, the castle appears across the black lake — a thousand windows glittering like scattered stars. Ron whispers, "Wicked." Harry cannot speak at all.',
  },
  'S-HP-004': {
    id: 'S-HP-004',
    kind: 'scene',
    arcId: 'SC-HP-01',
    locationId: 'L-HP-05',
    povId: 'C-HP-01',
    participantIds: ['C-HP-01', 'C-HP-02', 'C-HP-03', 'C-HP-04'],
    characterMovements: { 'C-HP-01': { locationId: 'L-HP-05', transition: 'Crossed the black lake in boats and entered the Great Hall' }, 'C-HP-02': { locationId: 'L-HP-05', transition: 'Filed into the Great Hall with the other first-years' }, 'C-HP-03': { locationId: 'L-HP-05', transition: 'Walked nervously into the Great Hall for the Sorting' } },
    events: ['sorting_ceremony', 'hat_considers_slytherin', 'gryffindor_chosen', 'dumbledore_warning'],
    threadMutations: [],
    continuityMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-08', action: 'added', content: 'The Sorting Hat wanted to place him in Slytherin — he begged it not to, and it listened' },
      { characterId: 'C-HP-01', nodeId: 'K-HP-09', action: 'added', content: 'Dumbledore warned the school away from the third-floor corridor on pain of death — not a joke' },
    ],
    relationshipMutations: [
      { from: 'C-HP-02', to: 'C-HP-01', type: 'Sorted into the same house — proximity breeds the first fragile threads of recognition', valenceDelta: 0.1 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-08', concept: 'The Sorting', type: 'system' },
        { id: 'WK-HP-09', concept: 'House Identity', type: 'concept' },
      ],
      addedEdges: [
        { from: 'WK-HP-08', to: 'WK-HP-09', relation: 'determines' },
        { from: 'WK-HP-09', to: 'WK-HP-01', relation: 'divides' },
      ],
    },
    summary: 'The Great Hall. A thousand candles float beneath a ceiling of stars. The Sorting Hat is placed on Harry\'s head and whispers: "Difficult. Very difficult. Plenty of courage, not a bad mind, talent — oh yes — and a thirst to prove yourself. Slytherin could help you on the way to greatness." Harry grips the stool and thinks, Not Slytherin, not Slytherin. The Hat relents: "GRYFFINDOR!" The table erupts. Ron beams. Hermione Granger, already sorted, nods approvingly. At the staff table, Dumbledore\'s eyes twinkle — but his start-of-term warning is steel: the third-floor corridor is forbidden to all who do not wish to die a most painful death. The hall laughs. Dumbledore does not.',
  },
  'S-HP-005': {
    id: 'S-HP-005',
    kind: 'scene',
    arcId: 'SC-HP-01',
    locationId: 'L-HP-05',
    povId: 'C-HP-01',
    participantIds: ['C-HP-01', 'C-HP-03', 'C-HP-07'],
    events: ['first_breakfast', 'owl_post', 'malfoy_confrontation', 'handshake_refused'],
    threadMutations: [
      { threadId: 'T-HP-07', from: 'dormant', to: 'active' },
    ],
    continuityMutations: [
      { characterId: 'C-HP-07', nodeId: 'K-HP-63', action: 'added', content: 'Potter refused his hand in front of everyone — chose a blood traitor Weasley over a Malfoy' },
    ],
    relationshipMutations: [
      { from: 'C-HP-01', to: 'C-HP-07', type: 'Draco reminds him of Dudley — the same sneering entitlement, different clothes', valenceDelta: -0.2 },
      { from: 'C-HP-07', to: 'C-HP-01', type: 'Public humiliation hardens into permanent enmity', valenceDelta: -0.3 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-11', concept: 'Blood Purity Ideology', type: 'concept' },
        { id: 'WK-HP-12', concept: 'Merit vs Lineage', type: 'tension' },
      ],
      addedEdges: [
        { from: 'WK-HP-11', to: 'WK-HP-09', relation: 'corrupts' },
        { from: 'WK-HP-12', to: 'WK-HP-11', relation: 'emerges_from' },
      ],
    },
    summary: 'First morning. The Great Hall hums with the clatter of cutlery and the rustle of a hundred owls descending through the enchanted ceiling, parcels and letters tumbling onto plates of eggs and toast. Harry watches it all with his mouth open — he has never received post in his life. Ron explains the customs between bites: the Daily Prophet, Howlers, the way the staircases move. Then Draco Malfoy approaches, hand extended, chin raised. "You\'ll soon find out some wizarding families are much better than others, Potter." Harry looks at the outstretched hand, then at Ron\'s flushed face. "I think I can tell the wrong sort for myself, thanks." Draco\'s hand drops. His eyes harden. The lines are drawn.',
  },

  // ── Arc 2: First Days ─────────────────────────────────────────────────────
  'S-HP-006': {
    id: 'S-HP-006',
    kind: 'scene',
    arcId: 'SC-HP-02',
    locationId: 'L-HP-02',
    povId: 'C-HP-01',
    participantIds: ['C-HP-01', 'C-HP-03'],
    events: ['moving_staircases', 'lost_in_corridors', 'castle_exploration', 'talking_portraits'],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-13', concept: 'Hogwarts as Living Architecture', type: 'concept' },
      ],
      addedEdges: [
        { from: 'WK-HP-13', to: 'WK-HP-01', relation: 'embodies' },
      ],
    },
    summary: 'The castle resists being learned. Harry and Ron spend their first days hopelessly lost — staircases that swing like pendulums, doors that pretend to be walls, walls that pretend to be doors. The portraits offer contradictory directions and seem to enjoy the confusion. A suit of armour on the fourth floor tries to walk Ron into a broom cupboard. They discover a shortcut behind a tapestry of Barnabas the Barmy, a corridor that smells inexplicably of peppermint, and a balcony overlooking the lake where the giant squid basks in the September sun. The castle is vast and strange and indifferent to their schedules. Harry has never lived anywhere so alive, so shifting, so unlike the rigid geometry of Privet Drive. He does not mind being lost.',
  },
  'S-HP-007': {
    id: 'S-HP-007',
    kind: 'scene',
    arcId: 'SC-HP-02',
    locationId: 'L-HP-02',
    povId: 'C-HP-02',
    participantIds: ['C-HP-01', 'C-HP-02', 'C-HP-03'],
    events: ['transfiguration_class', 'mcgonagall_cat', 'matchstick_to_needle', 'hermione_first'],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-14', concept: 'Transfiguration', type: 'system' },
        { id: 'WK-HP-15', concept: 'Magic Requires Discipline', type: 'law' },
      ],
      addedEdges: [
        { from: 'WK-HP-15', to: 'WK-HP-14', relation: 'governs' },
        { from: 'WK-HP-14', to: 'WK-HP-01', relation: 'part_of' },
      ],
    },
    summary: 'Transfiguration. Professor McGonagall is waiting for them as a tabby cat on her desk, and the gasp when she transforms sets the tone for the class: this is magic at its most precise, most demanding, most beautiful. They are given matches and told to turn them into needles. Most of the class produces nothing. Hermione Granger, lips pressed thin with concentration, turns hers silver by the end of the hour — the only student to manage it. McGonagall awards five points to Gryffindor with the ghost of a smile. Ron stares at his match, which has not changed at all. Harry\'s has gone slightly pointy. Magic, it turns out, is less about waving a wand and more about wanting something with the right kind of patience.',
  },
  'S-HP-008': {
    id: 'S-HP-008',
    kind: 'scene',
    arcId: 'SC-HP-02',
    locationId: 'L-HP-02',
    povId: 'C-HP-01',
    participantIds: ['C-HP-01', 'C-HP-03', 'C-HP-05'],
    events: ['first_potions_class', 'snape_hostility', 'scar_flicker'],
    threadMutations: [
      { threadId: 'T-HP-03', from: 'dormant', to: 'active' },
    ],
    continuityMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-80', action: 'added', content: 'Snape singled him out from the first moment — the hatred feels personal, not professional' },
    ],
    relationshipMutations: [
      { from: 'C-HP-01', to: 'C-HP-05', type: 'Instant antagonism — Snape seems to loathe him on sight', valenceDelta: -0.2 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-16', concept: 'Potions', type: 'system' },
        { id: 'WK-HP-17', concept: 'Teacher Authority as Absolute Power', type: 'system' },
      ],
      addedEdges: [
        { from: 'WK-HP-16', to: 'WK-HP-01', relation: 'part_of' },
        { from: 'WK-HP-17', to: 'WK-HP-09', relation: 'reinforces' },
      ],
    },
    summary: 'The dungeons. Snape sweeps into his first Potions class like a bat unfolding and fixes Harry with a stare that carries the weight of decades. "Potter. Our new celebrity." What follows is a public dissection — question after impossible question, designed not to teach but to humiliate. What would I get if I added powdered root of asphodel to an infusion of wormwood? Where would you look if I told you to find me a bezoar? Harry endures it. Ron seethes. Hermione\'s hand goes unacknowledged in the air. But beneath the cruelty lies something Harry cannot name: Snape looks at him with hatred, yes, but also with something that might be grief. Walking back through the corridors, Harry rubs his scar absently. It has been prickling since the start-of-term feast, though he cannot say why.',
  },
  'S-HP-009': {
    id: 'S-HP-009',
    kind: 'scene',
    arcId: 'SC-HP-02',
    locationId: 'L-HP-02',
    povId: 'C-HP-03',
    participantIds: ['C-HP-01', 'C-HP-03'],
    events: ['common_room_evening', 'wizard_chess_lesson', 'fireside_talk', 'ron_family_stories'],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    summary: 'Evening in the Gryffindor common room. The fire crackles in the grate and the older students sprawl across armchairs with textbooks they are not reading. Ron sets up a battered wizard chess set — the pieces are his grandfather\'s, chipped and argumentative, and they shout contradictory advice at anyone who is not Ron. He teaches Harry to play. Harry is terrible. The pieces refuse to trust him. Ron\'s knight takes Harry\'s queen and does a small, contemptuous dance. Ron grins — chess is the one thing where he is better than everyone, and for once the comparison does not sting. They play three games. Harry loses all three. Outside, rain streaks the tower windows. Neither boy has anywhere else he would rather be.',
  },
  'S-HP-010': {
    id: 'S-HP-010',
    kind: 'scene',
    arcId: 'SC-HP-02',
    locationId: 'L-HP-02',
    povId: 'C-HP-01',
    participantIds: ['C-HP-01', 'C-HP-03', 'C-HP-07'],
    events: ['flying_lesson', 'broomstick_responds', 'natural_instinct', 'malfoy_watches'],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-18', concept: 'Innate Magical Talent', type: 'concept' },
        { id: 'WK-HP-19', concept: 'Broomstick Flight', type: 'system' },
      ],
      addedEdges: [
        { from: 'WK-HP-18', to: 'WK-HP-15', relation: 'contradicts' },
        { from: 'WK-HP-19', to: 'WK-HP-01', relation: 'part_of' },
      ],
    },
    summary: 'The flying lesson. Madam Hooch lines the first-years up on the lawn beside a row of battered school brooms. "Stick out your right hand and say UP!" Most brooms roll over lazily. Ron\'s hits him in the face. Harry\'s leaps into his palm on the first word, as if it has been waiting for him. When they mount and kick off, Harry rises into the air and feels, for the first time since arriving, something he does not have to learn — flying is not a skill but a language he already speaks. The grounds spread beneath him, the lake flashing silver, the forest dark at the edges. Draco Malfoy, hovering nearby, watches Harry bank and turn with an ease that makes his own competence look laboured. He says nothing, but his jaw tightens. Madam Hooch calls them down. Harry descends slowly, reluctantly, as though the sky is the first place that has ever felt like his.',
  },
  'S-HP-011': {
    id: 'S-HP-011',
    kind: 'scene',
    arcId: 'SC-HP-02',
    locationId: 'L-HP-06',
    povId: 'C-HP-01',
    participantIds: ['C-HP-01', 'C-HP-02', 'C-HP-03'],
    characterMovements: { 'C-HP-01': { locationId: 'L-HP-06', transition: 'Stumbled onto the forbidden corridor after a moving staircase redirected them' }, 'C-HP-02': { locationId: 'L-HP-06', transition: 'Followed Harry and Ron through the wrong door' }, 'C-HP-03': { locationId: 'L-HP-06', transition: 'Ran with the others to escape Filch and ended up on the third floor' } },
    events: ['wrong_staircase', 'fluffy_discovered', 'three_headed_dog', 'trapdoor_noticed'],
    threadMutations: [
      { threadId: 'T-HP-01', from: 'dormant', to: 'active' },
    ],
    continuityMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-82', action: 'added', content: 'A three-headed dog guards a trapdoor on the forbidden third-floor corridor' },
      { characterId: 'C-HP-02', nodeId: 'K-HP-15', action: 'added', content: 'The dog was standing on a trapdoor — it is guarding something' },
    ],
    relationshipMutations: [
      { from: 'C-HP-02', to: 'C-HP-01', type: 'Terrified but exhilarated — Harry noticed the trapdoor when she only saw teeth', valenceDelta: 0.1 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-20', concept: 'Magical Guardianship', type: 'system' },
        { id: 'WK-HP-21', concept: 'Forbidden Knowledge', type: 'tension' },
      ],
      addedEdges: [
        { from: 'WK-HP-20', to: 'WK-HP-13', relation: 'enables' },
        { from: 'WK-HP-21', to: 'WK-HP-20', relation: 'emerges_from' },
      ],
    },
    summary: 'The third-floor corridor. A moving staircase deposits them where they should not be. They open a door to escape Filch and find themselves face-to-face-to-face with a monstrous three-headed dog, all six eyes fixed on them, drool pooling on the flagstones. They run. Hearts hammering in the Gryffindor common room, Hermione says what the others missed: "Didn\'t you see what it was standing on? A trapdoor. It\'s guarding something." The mystery takes root. Something is hidden beneath the third-floor corridor, and Dumbledore has stationed a beast to protect it. Harry thinks of the small grubby package from Vault 713. But for now the question just hangs there, unanswered, a seed planted in the dark.',
  },
  'S-HP-012': {
    id: 'S-HP-012',
    kind: 'scene',
    arcId: 'SC-HP-02',
    locationId: 'L-HP-05',
    povId: 'C-HP-01',
    participantIds: ['C-HP-01', 'C-HP-03'],
    characterMovements: { 'C-HP-01': { locationId: 'L-HP-05', transition: 'Hurried down from Gryffindor Tower to breakfast in the Great Hall' }, 'C-HP-03': { locationId: 'L-HP-05', transition: 'Followed Harry down the shifting staircases to the Great Hall' } },
    events: ['breakfast_routine', 'daily_prophet', 'gringotts_breakin_article', 'vault_713_connection'],
    threadMutations: [],
    continuityMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-81', action: 'added', content: 'The Daily Prophet reports a break-in at Gringotts on the same day Hagrid emptied Vault 713 — the vault that was broken into was the same one' },
    ],
    relationshipMutations: [],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-22', concept: 'The Philosopher\'s Stone', type: 'concept' },
      ],
      addedEdges: [
        { from: 'WK-HP-22', to: 'WK-HP-05', relation: 'protected_by' },
        { from: 'WK-HP-20', to: 'WK-HP-22', relation: 'protects' },
      ],
    },
    summary: 'Breakfast in the Great Hall. A grey morning, rain on the enchanted ceiling, owls arriving damp and ruffled. Harry unfolds the Daily Prophet out of idle curiosity and a small headline catches his eye: break-in at Gringotts. Vault 713 — the vault Hagrid emptied on the very same day — was targeted. Nothing was taken, because the vault had already been cleared. Harry reads the article twice. The grubby package. The three-headed dog. Dumbledore\'s warning. The connections assemble themselves quietly, like tumblers in a lock he does not yet have the key for. Ron leans over. "What\'s wrong?" Harry folds the paper. "Nothing. Maybe nothing." He eats his toast, but the question follows him to class like a shadow he cannot quite step away from.',
  },
  'S-HP-013': {
    id: 'S-HP-013',
    kind: 'scene',
    arcId: 'SC-HP-02',
    locationId: 'L-HP-02',
    povId: 'C-HP-02',
    participantIds: ['C-HP-01', 'C-HP-02'],
    characterMovements: { 'C-HP-01': { locationId: 'L-HP-02', transition: 'Wandered into the library looking for a book on Quidditch' }, 'C-HP-02': { locationId: 'L-HP-02', transition: 'Had been in the library since before breakfast, surrounded by her fortress of textbooks' } },
    events: ['library_visit', 'hermione_alone', 'brief_exchange', 'outsider_recognition'],
    threadMutations: [],
    continuityMutations: [],
    relationshipMutations: [],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-23', concept: 'The Hogwarts Library', type: 'system' },
      ],
      addedEdges: [
        { from: 'WK-HP-23', to: 'WK-HP-21', relation: 'enables' },
        { from: 'WK-HP-23', to: 'WK-HP-13', relation: 'part_of' },
      ],
    },
    summary: 'The library. Harry wanders in looking for a book on Quidditch and finds Hermione Granger at her usual table, surrounded by a fortress of textbooks stacked three high. She is alone — she is always alone. The other Gryffindor girls cluster at the far end, whispering. Harry hesitates, then sits across from her. She looks up, startled, as though physical proximity is a language she has not learned. They do not say much. She recommends a book. He asks about the Transfiguration homework. It is not friendship — not yet — but it is the absence of cruelty, and for Hermione Granger, who has spent every meal sitting with her books because no one has thought to sit with her, the absence of cruelty is enough to remember.',
  },
  'S-HP-014': {
    id: 'S-HP-014',
    kind: 'scene',
    arcId: 'SC-HP-02',
    locationId: 'L-HP-02',
    povId: 'C-HP-01',
    participantIds: ['C-HP-01', 'C-HP-02', 'C-HP-03'],
    events: ['troll_in_dungeon', 'hermione_rescue', 'friendship_forged'],
    threadMutations: [
      { threadId: 'T-HP-04', from: 'dormant', to: 'active' },
    ],
    continuityMutations: [
      { characterId: 'C-HP-02', nodeId: 'K-HP-16', action: 'added', content: 'Harry and Ron risked their lives to save her from the troll — she has never had friends like this' },
    ],
    relationshipMutations: [
      { from: 'C-HP-01', to: 'C-HP-02', type: 'She lied to protect them — Hermione is braver than her books suggest', valenceDelta: 0.3 },
      { from: 'C-HP-02', to: 'C-HP-01', type: 'He came back for her — no one has ever come back for her before', valenceDelta: 0.3 },
      { from: 'C-HP-02', to: 'C-HP-03', type: 'Ron\'s levitation charm saved her life — the boy she mocked is the boy who rescued her', valenceDelta: 0.4 },
      { from: 'C-HP-03', to: 'C-HP-02', type: 'She took the blame for them — maybe she is not so bad after all', valenceDelta: 0.3 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-24', concept: 'Loyalty Transcends Houses', type: 'tension' },
        { id: 'WK-HP-25', concept: 'Shared Danger Forges Bonds', type: 'law' },
      ],
      addedEdges: [
        { from: 'WK-HP-24', to: 'WK-HP-09', relation: 'challenges' },
        { from: 'WK-HP-25', to: 'WK-HP-24', relation: 'enables' },
      ],
    },
    summary: 'Halloween. A mountain troll is loose in the dungeons. Hermione does not know — she is crying in the girls\' bathroom because Ron called her a nightmare. Harry and Ron go after her. They find the troll first: twelve feet tall, granite-grey skin, a club the size of a tree trunk. Ron levitates the club with a charm he has been failing all day — Wingardium Leviosa — and drops it on the troll\'s head. When the professors arrive, Hermione lies. She says she went looking for the troll because she\'d read about them. She takes the blame to protect the boys who saved her. There are some things you cannot share without ending up liking each other, and knocking out a twelve-foot mountain troll is one of them. The trio is formed. The world established. And the mysteries planted in these first weeks — the dog, the vault, the corridor, the scar — wait patiently in the dark for whatever comes next.',
  },
};

// ── Commits ──────────────────────────────────────────────────────────────────
const diffNames: Record<string, string> = {
  'S-HP-001': 'yer_a_wizard',
  'S-HP-002': 'diagon_alley',
  'S-HP-003': 'hogwarts_express',
  'S-HP-004': 'sorting_ceremony',
  'S-HP-005': 'owl_post_and_handshake',
  'S-HP-006': 'castle_corridors',
  'S-HP-007': 'matchstick_to_needle',
  'S-HP-008': 'snape_hostility',
  'S-HP-009': 'wizard_chess',
  'S-HP-010': 'first_flight',
  'S-HP-011': 'fluffy_discovered',
  'S-HP-012': 'gringotts_breakin',
  'S-HP-013': 'library_encounter',
  'S-HP-014': 'troll_friendship',
};

const sceneList = Object.values(scenes);
const commits: Commit[] = sceneList.map((scene, i) => ({
  id: `CM-HP-${String(i + 1).padStart(3, '0')}`,
  parentId: i === 0 ? null : `CM-HP-${String(i).padStart(3, '0')}`,
  sceneId: scene.id,
  arcId: scene.arcId,
  diffName: diffNames[scene.id] ?? 'thread_surfaced',
  threadMutations: scene.threadMutations,
  continuityMutations: scene.continuityMutations,
  relationshipMutations: scene.relationshipMutations,
  authorOverride: null,
  createdAt: Date.now() - (14 - i) * 3600000,
}));

// ── Alternate Branch: "The Slytherin Sorting" ────────────────────────────────
// Diverges after S-HP-004 — the Sorting Hat placed Harry in Slytherin,
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
    povId: 'C-HP-01',
    participantIds: ['C-HP-01', 'C-HP-07'],
    events: ['slytherin_table', 'malfoy_extends_hand_again', 'uneasy_acceptance'],
    threadMutations: [
      { threadId: 'T-HP-07', from: 'active', to: 'escalating' },
    ],
    continuityMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-ALT-01', action: 'added', content: 'The Hat said Slytherin and he did not fight it — something in him wanted to know what greatness meant' },
      { characterId: 'C-HP-07', nodeId: 'K-HP-ALT-02', action: 'added', content: 'Potter is in Slytherin — Father will be pleased, and this changes everything' },
    ],
    relationshipMutations: [
      { from: 'C-HP-07', to: 'C-HP-01', type: 'Recalculates entirely — Potter as an ally is worth more than Potter as an enemy', valenceDelta: 0.6 },
      { from: 'C-HP-01', to: 'C-HP-07', type: 'Draco is his only guide in a house that watches him with silver eyes', valenceDelta: 0.3 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-26', concept: 'Ambition Hierarchy', type: 'system' },
        { id: 'WK-HP-27', concept: 'House as Destiny', type: 'tension' },
      ],
      addedEdges: [
        { from: 'WK-HP-26', to: 'WK-HP-09', relation: 'defines' },
        { from: 'WK-HP-27', to: 'WK-HP-08', relation: 'emerges_from' },
      ],
    },
    summary: 'The Great Hall falls silent when the Hat calls "SLYTHERIN!" Harry walks to the wrong table — the table draped in green and silver, where the applause is calculating rather than warm. Draco Malfoy slides over to make room, and this time his extended hand is not a demand but an offering. Harry takes it. Ron Weasley stares from the Gryffindor table as though watching a friend drown. Hermione looks away. At the staff table, Dumbledore\'s eyes do not twinkle. In the dungeons that night, Harry lies in a four-poster bed hung with emerald curtains and wonders whether the Hat saw something true in him — an ambition, a hunger, a darkness — that he has been refusing to see in himself.',
  },
  'S-HP-ALT-007': {
    id: 'S-HP-ALT-007',
    kind: 'scene',
    arcId: 'SC-HP-02-ALT',
    locationId: 'L-HP-02',
    povId: 'C-HP-01',
    participantIds: ['C-HP-01', 'C-HP-05'],
    events: ['snape_reappraisal', 'potions_favoritism', 'slytherin_privilege'],
    threadMutations: [
      { threadId: 'T-HP-03', from: 'dormant', to: 'active' },
    ],
    continuityMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-ALT-03', action: 'added', content: 'Snape did not humiliate him — he looked at Harry with an expression that was almost recognition, almost pain' },
    ],
    relationshipMutations: [
      { from: 'C-HP-05', to: 'C-HP-01', type: 'Lily\'s son in Slytherin robes — the cruelty catches in his throat, replaced by something worse: hope', valenceDelta: 0.3 },
      { from: 'C-HP-01', to: 'C-HP-05', type: 'Snape is not the monster he expected — in Slytherin, the hatred softened into something unreadable', valenceDelta: 0.3 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-28', concept: 'Favouritism as Pedagogy', type: 'system' },
      ],
      addedEdges: [
        { from: 'WK-HP-28', to: 'WK-HP-17', relation: 'corrupts' },
        { from: 'WK-HP-28', to: 'WK-HP-26', relation: 'reinforces' },
      ],
    },
    summary: 'Potions class. Snape enters and his gaze finds Harry in Slytherin robes. Something fractures in his expression — barely visible, instantly suppressed. There is no public humiliation. The questions come, but they are tests, not punishments. When Harry answers incorrectly, Snape corrects him with clipped precision rather than contempt. The Gryffindors are baffled. Harry is baffled. In Slytherin green, he looks less like James Potter, and the resemblance that remains — Lily\'s eyes in a Slytherin face — is a mirror Snape cannot look away from. For the first time, the hatred has nowhere to land.',
  },
  'S-HP-ALT-008': {
    id: 'S-HP-ALT-008',
    kind: 'scene',
    arcId: 'SC-HP-02-ALT',
    locationId: 'L-HP-02',
    povId: 'C-HP-01',
    participantIds: ['C-HP-01', 'C-HP-02', 'C-HP-03'],
    events: ['hermione_troll_alone', 'harry_hears', 'crosses_house_lines', 'fragile_bridge'],
    threadMutations: [
      { threadId: 'T-HP-04', from: 'dormant', to: 'active' },
    ],
    continuityMutations: [
      { characterId: 'C-HP-02', nodeId: 'K-HP-ALT-04', action: 'added', content: 'A Slytherin came to save her — Harry Potter crossed every line his house would punish him for' },
    ],
    relationshipMutations: [
      { from: 'C-HP-02', to: 'C-HP-01', type: 'He is in the wrong house but he came anyway — the bravest thing she has ever seen a Slytherin do', valenceDelta: 0.4 },
      { from: 'C-HP-01', to: 'C-HP-02', type: 'Hermione is the only person who looked at his green tie and saw him, not it', valenceDelta: 0.3 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-29', concept: 'Cross-House Alliance', type: 'tension' },
      ],
      addedEdges: [
        { from: 'WK-HP-29', to: 'WK-HP-09', relation: 'violates' },
        { from: 'WK-HP-29', to: 'WK-HP-26', relation: 'contradicts' },
      ],
    },
    summary: 'Halloween. The troll. In this timeline, Ron is not there — he and Harry have barely spoken since the Sorting. But Harry hears that Hermione is in the bathroom and goes anyway, alone, a Slytherin breaking ranks for a Muggle-born Gryffindor. He faces the troll with nothing but a wand he barely knows how to use and a recklessness that belongs to no house. Hermione sees a boy in green robes pulling her from the rubble. When the professors arrive, she lies for him — tells them she went looking for the troll. In the corridor after, she whispers, "You didn\'t have to come." He says, "I know." They are friends now, and it is the most dangerous friendship in Hogwarts — a Slytherin and a Muggle-born, allied across every line the school draws.',
  },
  'S-HP-ALT-009': {
    id: 'S-HP-ALT-009',
    kind: 'scene',
    arcId: 'SC-HP-02-ALT',
    locationId: 'L-HP-06',
    povId: 'C-HP-01',
    participantIds: ['C-HP-01', 'C-HP-07'],
    characterMovements: { 'C-HP-01': { locationId: 'L-HP-06', transition: 'Lured to the forbidden corridor by Draco\'s taunting dare' }, 'C-HP-07': { locationId: 'L-HP-06', transition: 'Led Harry to the third floor to show him what he\'d heard about' } },
    events: ['draco_shows_corridor', 'slytherin_information_network', 'fluffy_discovery_different'],
    threadMutations: [
      { threadId: 'T-HP-01', from: 'dormant', to: 'active' },
    ],
    continuityMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-ALT-05', action: 'added', content: 'Draco brought him to the third-floor corridor on purpose — in Slytherin, secrets are currency, and Draco is investing in Harry' },
      { characterId: 'C-HP-07', nodeId: 'K-HP-ALT-06', action: 'added', content: 'Showed Potter the forbidden corridor — binding him with shared transgression, the Slytherin way' },
    ],
    relationshipMutations: [
      { from: 'C-HP-01', to: 'C-HP-07', type: 'Draco is useful and clever but never safe — every gift comes with invisible strings', valenceDelta: 0.1 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-30', concept: 'Secrets as Currency', type: 'concept' },
      ],
      addedEdges: [
        { from: 'WK-HP-30', to: 'WK-HP-26', relation: 'enables' },
        { from: 'WK-HP-30', to: 'WK-HP-21', relation: 'reframes' },
      ],
    },
    summary: 'The third-floor corridor. In this timeline, it is Draco who leads Harry to Fluffy — not by accident but by design. The Slytherin information network runs deeper than Gryffindor curiosity ever could. "My father mentioned something about Dumbledore and a certain alchemist," Draco says, leading them through the forbidden door with a confidence that makes Harry uneasy. They see the three-headed dog. They see the trapdoor. But here the discovery is not innocent wonder — it is Slytherin calculation. Draco files the knowledge away like a weapon. Harry watches Draco watching Fluffy and understands something new: in this house, everything is leverage. Even friendship. Especially friendship.',
  },
  'S-HP-ALT-010': {
    id: 'S-HP-ALT-010',
    kind: 'scene',
    arcId: 'SC-HP-02-ALT',
    locationId: 'L-HP-02',
    povId: 'C-HP-03',
    participantIds: ['C-HP-01', 'C-HP-03'],
    events: ['ron_confrontation', 'loyalty_tested', 'bridge_between_houses'],
    threadMutations: [],
    continuityMutations: [
      { characterId: 'C-HP-01', nodeId: 'K-HP-ALT-07', action: 'added', content: 'Ron said he would have been his friend if the Hat had chosen differently — and Harry knows he still could be, if either of them is brave enough' },
      { characterId: 'C-HP-03', nodeId: 'K-HP-ALT-08', action: 'added', content: 'Harry is not like the other Slytherins — he saved the Granger girl, and his eyes are honest even when his tie is green' },
    ],
    relationshipMutations: [
      { from: 'C-HP-03', to: 'C-HP-01', type: 'Grudging respect — the Slytherin who keeps acting like a Gryffindor', valenceDelta: 0.3 },
      { from: 'C-HP-01', to: 'C-HP-03', type: 'The friend he should have had — the train compartment haunts him', valenceDelta: 0.3 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-HP-31', concept: 'Choice vs Sorting', type: 'tension' },
      ],
      addedEdges: [
        { from: 'WK-HP-31', to: 'WK-HP-08', relation: 'challenges' },
        { from: 'WK-HP-31', to: 'WK-HP-27', relation: 'contradicts' },
      ],
    },
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
  worldKnowledgeMutations: {
    addedNodes: [
      { id: 'WK-HP-WB-01', concept: 'Hogwarts School of Witchcraft and Wizardry — a thousand-year-old institution that shapes every witch and wizard in Britain, sorting them into houses that define identity, rivalry, and allegiance', type: 'system' },
      { id: 'WK-HP-WB-02', concept: 'Wand magic — the primary magical discipline, channeled through wands of wood and core, where the instrument chooses the wielder and shapes the craft', type: 'system' },
      { id: 'WK-HP-WB-03', concept: 'The Ministry of Magic — the governing body of wizarding Britain, enforcing the Statute of Secrecy and regulating all magical activity', type: 'system' },
      { id: 'WK-HP-WB-04', concept: 'Quidditch — the defining sport of wizarding culture, played on broomsticks, a social ritual that channels competition and house loyalty', type: 'system' },
      { id: 'WK-HP-WB-05', concept: 'The Muggle-Magical divide — two worlds coexisting in the same space, separated by enchantment, ignorance, and institutional secrecy', type: 'tension' },
      { id: 'WK-HP-WB-06', concept: 'Voldemort\'s ideology — blood purity as political program, the belief that magical power flows through lineage and that Muggle-born wizards are lesser', type: 'concept' },
      { id: 'WK-HP-WB-07', concept: 'The Hogwarts House system — Gryffindor, Slytherin, Ravenclaw, Hufflepuff — a sorting at age eleven that assigns identity, community, and expectation for life', type: 'system' },
      { id: 'WK-HP-WB-08', concept: 'Magical creatures — a parallel ecosystem of dragons, hippogriffs, phoenixes, and house-elves that exists alongside wizarding society, governed by its own laws', type: 'concept' },
    ],
    addedEdges: [
      { from: 'WK-HP-WB-01', to: 'WK-HP-01', relation: 'is the central institution of' },
      { from: 'WK-HP-WB-02', to: 'WK-HP-04', relation: 'is the discipline governed by' },
      { from: 'WK-HP-WB-02', to: 'WK-HP-06', relation: 'is the practical application of' },
      { from: 'WK-HP-WB-03', to: 'WK-HP-02', relation: 'enforces and administers' },
      { from: 'WK-HP-WB-03', to: 'WK-HP-01', relation: 'governs' },
      { from: 'WK-HP-WB-04', to: 'WK-HP-WB-01', relation: 'is the defining competitive ritual of' },
      { from: 'WK-HP-WB-04', to: 'WK-HP-09', relation: 'channels and intensifies' },
      { from: 'WK-HP-WB-05', to: 'WK-HP-02', relation: 'is maintained by' },
      { from: 'WK-HP-WB-05', to: 'WK-HP-03', relation: 'is bridged by' },
      { from: 'WK-HP-WB-06', to: 'WK-HP-11', relation: 'is the political weaponization of' },
      { from: 'WK-HP-WB-06', to: 'WK-HP-12', relation: 'is the ideology that drives' },
      { from: 'WK-HP-WB-07', to: 'WK-HP-08', relation: 'is enacted through' },
      { from: 'WK-HP-WB-07', to: 'WK-HP-10', relation: 'institutionalizes' },
      { from: 'WK-HP-WB-08', to: 'WK-HP-WB-01', relation: 'is studied and managed within' },
      { from: 'WK-HP-WB-08', to: 'WK-HP-13', relation: 'inhabits and shapes' },
    ],
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
    forkEntryId: 'S-HP-004',
    entryIds: Object.keys(altScenes),
    createdAt: Date.now() - 43200000,
  },
};

// ── Assembled Narrative ──────────────────────────────────────────────────────
export const seedHP: NarrativeState = {
  id: 'N-HP',
  title: "Harry Potter and the Philosopher's Stone",
  description: 'An orphan boy raised in a cupboard under the stairs discovers he is the most famous wizard alive. At Hogwarts School of Witchcraft and Wizardry, Harry stumbles into a world of shifting staircases, impossible classes, and the first friendships of his life — while a forbidden corridor, a three-headed dog, and a scar that will not stop prickling hint at mysteries the castle is not ready to reveal.',
  characters,
  locations,
  threads,
  arcs: allArcs,
  scenes: allScenes,
  worldBuilds: allWorldBuilds,
  branches,
  commits,
  relationships,
  worldKnowledge: {
    nodes: {
      'WK-HP-01': { id: 'WK-HP-01', concept: 'Wizarding World', type: 'concept' },
      'WK-HP-02': { id: 'WK-HP-02', concept: 'Statute of Secrecy', type: 'law' },
      'WK-HP-03': { id: 'WK-HP-03', concept: 'Blood Protection', type: 'law' },
      'WK-HP-04': { id: 'WK-HP-04', concept: 'The Wand Chooses the Wizard', type: 'law' },
      'WK-HP-05': { id: 'WK-HP-05', concept: 'Goblin Banking System', type: 'system' },
      'WK-HP-06': { id: 'WK-HP-06', concept: 'Wand Lore', type: 'concept' },
      'WK-HP-07': { id: 'WK-HP-07', concept: 'Hogwarts Express & Platform Nine and Three-Quarters', type: 'system' },
      'WK-HP-08': { id: 'WK-HP-08', concept: 'The Sorting', type: 'system' },
      'WK-HP-09': { id: 'WK-HP-09', concept: 'House Identity', type: 'concept' },
      'WK-HP-10': { id: 'WK-HP-10', concept: 'Courage vs Ambition', type: 'tension' },
      'WK-HP-11': { id: 'WK-HP-11', concept: 'Blood Purity Ideology', type: 'concept' },
      'WK-HP-12': { id: 'WK-HP-12', concept: 'Merit vs Lineage', type: 'tension' },
      'WK-HP-13': { id: 'WK-HP-13', concept: 'Hogwarts as Living Architecture', type: 'concept' },
      'WK-HP-14': { id: 'WK-HP-14', concept: 'Transfiguration', type: 'system' },
      'WK-HP-15': { id: 'WK-HP-15', concept: 'Magic Requires Discipline', type: 'law' },
      'WK-HP-16': { id: 'WK-HP-16', concept: 'Potions', type: 'system' },
      'WK-HP-17': { id: 'WK-HP-17', concept: 'Teacher Authority as Absolute Power', type: 'system' },
      'WK-HP-18': { id: 'WK-HP-18', concept: 'Innate Magical Talent', type: 'concept' },
      'WK-HP-19': { id: 'WK-HP-19', concept: 'Broomstick Flight', type: 'system' },
      'WK-HP-20': { id: 'WK-HP-20', concept: 'Magical Guardianship', type: 'system' },
      'WK-HP-21': { id: 'WK-HP-21', concept: 'Forbidden Knowledge', type: 'tension' },
      'WK-HP-22': { id: 'WK-HP-22', concept: 'The Philosopher\'s Stone', type: 'concept' },
      'WK-HP-23': { id: 'WK-HP-23', concept: 'The Hogwarts Library', type: 'system' },
      'WK-HP-24': { id: 'WK-HP-24', concept: 'Loyalty Transcends Houses', type: 'tension' },
      'WK-HP-25': { id: 'WK-HP-25', concept: 'Shared Danger Forges Bonds', type: 'law' },
      'WK-HP-26': { id: 'WK-HP-26', concept: 'Ambition Hierarchy', type: 'system' },
      'WK-HP-27': { id: 'WK-HP-27', concept: 'House as Destiny', type: 'tension' },
      'WK-HP-28': { id: 'WK-HP-28', concept: 'Favouritism as Pedagogy', type: 'system' },
      'WK-HP-29': { id: 'WK-HP-29', concept: 'Cross-House Alliance', type: 'tension' },
      'WK-HP-30': { id: 'WK-HP-30', concept: 'Secrets as Currency', type: 'concept' },
      'WK-HP-31': { id: 'WK-HP-31', concept: 'Choice vs Sorting', type: 'tension' },
      // World Build nodes
      'WK-HP-WB-01': { id: 'WK-HP-WB-01', concept: 'Hogwarts School of Witchcraft and Wizardry — a thousand-year-old institution that shapes every witch and wizard in Britain, sorting them into houses that define identity, rivalry, and allegiance', type: 'system' },
      'WK-HP-WB-02': { id: 'WK-HP-WB-02', concept: 'Wand magic — the primary magical discipline, channeled through wands of wood and core, where the instrument chooses the wielder and shapes the craft', type: 'system' },
      'WK-HP-WB-03': { id: 'WK-HP-WB-03', concept: 'The Ministry of Magic — the governing body of wizarding Britain, enforcing the Statute of Secrecy and regulating all magical activity', type: 'system' },
      'WK-HP-WB-04': { id: 'WK-HP-WB-04', concept: 'Quidditch — the defining sport of wizarding culture, played on broomsticks, a social ritual that channels competition and house loyalty', type: 'system' },
      'WK-HP-WB-05': { id: 'WK-HP-WB-05', concept: 'The Muggle-Magical divide — two worlds coexisting in the same space, separated by enchantment, ignorance, and institutional secrecy', type: 'tension' },
      'WK-HP-WB-06': { id: 'WK-HP-WB-06', concept: 'Voldemort\'s ideology — blood purity as political program, the belief that magical power flows through lineage and that Muggle-born wizards are lesser', type: 'concept' },
      'WK-HP-WB-07': { id: 'WK-HP-WB-07', concept: 'The Hogwarts House system — Gryffindor, Slytherin, Ravenclaw, Hufflepuff — a sorting at age eleven that assigns identity, community, and expectation for life', type: 'system' },
      'WK-HP-WB-08': { id: 'WK-HP-WB-08', concept: 'Magical creatures — a parallel ecosystem of dragons, hippogriffs, phoenixes, and house-elves that exists alongside wizarding society, governed by its own laws', type: 'concept' },
    },
    edges: [
      // S-HP-001
      { from: 'WK-HP-02', to: 'WK-HP-01', relation: 'conceals' },
      { from: 'WK-HP-03', to: 'WK-HP-01', relation: 'bridges' },
      // S-HP-002
      { from: 'WK-HP-04', to: 'WK-HP-06', relation: 'governs' },
      { from: 'WK-HP-05', to: 'WK-HP-01', relation: 'part_of' },
      { from: 'WK-HP-06', to: 'WK-HP-01', relation: 'part_of' },
      { from: 'WK-HP-04', to: 'WK-HP-01', relation: 'reveals' },
      // S-HP-003
      { from: 'WK-HP-07', to: 'WK-HP-02', relation: 'enforces' },
      { from: 'WK-HP-07', to: 'WK-HP-01', relation: 'part_of' },
      // S-HP-004
      { from: 'WK-HP-08', to: 'WK-HP-09', relation: 'determines' },
      { from: 'WK-HP-10', to: 'WK-HP-08', relation: 'emerges_from' },
      { from: 'WK-HP-09', to: 'WK-HP-01', relation: 'divides' },
      // S-HP-005
      { from: 'WK-HP-11', to: 'WK-HP-09', relation: 'corrupts' },
      { from: 'WK-HP-12', to: 'WK-HP-11', relation: 'emerges_from' },
      { from: 'WK-HP-12', to: 'WK-HP-08', relation: 'challenges' },
      { from: 'WK-HP-11', to: 'WK-HP-01', relation: 'divides' },
      // S-HP-006
      { from: 'WK-HP-13', to: 'WK-HP-01', relation: 'embodies' },
      // S-HP-007
      { from: 'WK-HP-15', to: 'WK-HP-14', relation: 'governs' },
      { from: 'WK-HP-14', to: 'WK-HP-01', relation: 'part_of' },
      { from: 'WK-HP-15', to: 'WK-HP-04', relation: 'contrasts' },
      // S-HP-008
      { from: 'WK-HP-16', to: 'WK-HP-01', relation: 'part_of' },
      { from: 'WK-HP-15', to: 'WK-HP-16', relation: 'governs' },
      { from: 'WK-HP-17', to: 'WK-HP-09', relation: 'reinforces' },
      { from: 'WK-HP-17', to: 'WK-HP-12', relation: 'complicates' },
      // S-HP-010
      { from: 'WK-HP-18', to: 'WK-HP-15', relation: 'contradicts' },
      { from: 'WK-HP-18', to: 'WK-HP-04', relation: 'parallels' },
      { from: 'WK-HP-19', to: 'WK-HP-01', relation: 'part_of' },
      { from: 'WK-HP-18', to: 'WK-HP-12', relation: 'complicates' },
      // S-HP-011
      { from: 'WK-HP-20', to: 'WK-HP-13', relation: 'enables' },
      { from: 'WK-HP-21', to: 'WK-HP-20', relation: 'emerges_from' },
      { from: 'WK-HP-21', to: 'WK-HP-10', relation: 'fuels' },
      // S-HP-012
      { from: 'WK-HP-22', to: 'WK-HP-05', relation: 'protected_by' },
      { from: 'WK-HP-20', to: 'WK-HP-22', relation: 'protects' },
      { from: 'WK-HP-22', to: 'WK-HP-21', relation: 'fuels' },
      // S-HP-013
      { from: 'WK-HP-23', to: 'WK-HP-21', relation: 'enables' },
      { from: 'WK-HP-23', to: 'WK-HP-13', relation: 'part_of' },
      // S-HP-014
      { from: 'WK-HP-24', to: 'WK-HP-09', relation: 'challenges' },
      { from: 'WK-HP-24', to: 'WK-HP-11', relation: 'contradicts' },
      { from: 'WK-HP-25', to: 'WK-HP-24', relation: 'enables' },
      { from: 'WK-HP-25', to: 'WK-HP-10', relation: 'resolves' },
      // S-HP-ALT-006
      { from: 'WK-HP-26', to: 'WK-HP-09', relation: 'defines' },
      { from: 'WK-HP-27', to: 'WK-HP-08', relation: 'emerges_from' },
      { from: 'WK-HP-27', to: 'WK-HP-10', relation: 'deepens' },
      { from: 'WK-HP-26', to: 'WK-HP-11', relation: 'enables' },
      // S-HP-ALT-007
      { from: 'WK-HP-28', to: 'WK-HP-17', relation: 'corrupts' },
      { from: 'WK-HP-28', to: 'WK-HP-26', relation: 'reinforces' },
      { from: 'WK-HP-28', to: 'WK-HP-12', relation: 'complicates' },
      // S-HP-ALT-008
      { from: 'WK-HP-29', to: 'WK-HP-09', relation: 'violates' },
      { from: 'WK-HP-29', to: 'WK-HP-26', relation: 'contradicts' },
      { from: 'WK-HP-29', to: 'WK-HP-11', relation: 'defies' },
      { from: 'WK-HP-25', to: 'WK-HP-29', relation: 'enables' },
      // S-HP-ALT-009
      { from: 'WK-HP-30', to: 'WK-HP-26', relation: 'enables' },
      { from: 'WK-HP-30', to: 'WK-HP-21', relation: 'reframes' },
      { from: 'WK-HP-20', to: 'WK-HP-30', relation: 'resists' },
      // S-HP-ALT-010
      { from: 'WK-HP-31', to: 'WK-HP-08', relation: 'challenges' },
      { from: 'WK-HP-31', to: 'WK-HP-27', relation: 'contradicts' },
      { from: 'WK-HP-31', to: 'WK-HP-29', relation: 'enables' },
      // World Build edges
      { from: 'WK-HP-WB-01', to: 'WK-HP-01', relation: 'is the central institution of' },
      { from: 'WK-HP-WB-02', to: 'WK-HP-04', relation: 'is the discipline governed by' },
      { from: 'WK-HP-WB-02', to: 'WK-HP-06', relation: 'is the practical application of' },
      { from: 'WK-HP-WB-03', to: 'WK-HP-02', relation: 'enforces and administers' },
      { from: 'WK-HP-WB-03', to: 'WK-HP-01', relation: 'governs' },
      { from: 'WK-HP-WB-04', to: 'WK-HP-WB-01', relation: 'is the defining competitive ritual of' },
      { from: 'WK-HP-WB-04', to: 'WK-HP-09', relation: 'channels and intensifies' },
      { from: 'WK-HP-WB-05', to: 'WK-HP-02', relation: 'is maintained by' },
      { from: 'WK-HP-WB-05', to: 'WK-HP-03', relation: 'is bridged by' },
      { from: 'WK-HP-WB-06', to: 'WK-HP-11', relation: 'is the political weaponization of' },
      { from: 'WK-HP-WB-06', to: 'WK-HP-12', relation: 'is the ideology that drives' },
      { from: 'WK-HP-WB-07', to: 'WK-HP-08', relation: 'is enacted through' },
      { from: 'WK-HP-WB-07', to: 'WK-HP-10', relation: 'institutionalizes' },
      { from: 'WK-HP-WB-08', to: 'WK-HP-WB-01', relation: 'is studied and managed within' },
      { from: 'WK-HP-WB-08', to: 'WK-HP-13', relation: 'inhabits and shapes' },
    ],
  },
    worldSummary: 'Wizarding Britain hides in plain sight beneath Muggle England — a parallel world of wands and cauldrons, owls and enchantments, governed by the Ministry of Magic and haunted by the shadow of Lord Voldemort. Ten years ago, the darkest wizard in a century fell when his Killing Curse rebounded off a one-year-old boy named Harry Potter. The wizarding world celebrated. Harry was left on a doorstep. Now eleven, he arrives at Hogwarts carrying nothing but a wand, an owl, and a scar. The school is ancient, magnificent, and not entirely safe. Something is hidden on the third-floor corridor. A professor with a turban smells faintly of garlic and something worse. And Harry is only beginning to learn what it means to be the Boy Who Lived.',
  rules: [
    'Magic has rules and limits — spells require training, wands choose the wizard, and some magic is beyond skill level',
    'The wizarding world is hidden from Muggles by the Statute of Secrecy — breaches have serious consequences',
    'Hogwarts is the safest place in wizarding Britain, but "safe" is relative — the castle has real dangers',
    'Harry is famous in the wizarding world but was raised knowing nothing about it — he is learning alongside the reader',
    'Voldemort is feared so deeply that most wizards will not speak his name',
    'Love is the most powerful magical protection — Lily\'s sacrifice shields Harry in ways no spell can replicate',
  ],
  controlMode: 'auto',
  imageStyle: 'Whimsical storybook illustration, warm golden candlelight, rich jewel tones, soft painterly textures, magical realism with a cozy British boarding-school atmosphere',
  activeForces: { payoff: 0, change: 0, knowledge: 0 },
  coverImageUrl: '/covers/hp.jpg',
  createdAt: Date.now() - 86400000,
  updatedAt: Date.now(),
};
