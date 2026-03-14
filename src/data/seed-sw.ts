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
    imagePrompt: 'Young man with shaggy sandy-blond hair, bright blue eyes, and a sun-weathered face; wearing a loose white tunic and utility belt, standing in harsh desert light with twin suns low on the horizon.',
    threadIds: ['T-SW-01', 'T-SW-05', 'T-SW-02'],
    continuity: {
      nodes: [
        { id: 'K-SW-01', type: 'knows', content: 'Raised by Uncle Owen and Aunt Beru on a moisture farm on Tatooine' },
        { id: 'K-SW-02', type: 'believes', content: 'His father was a navigator on a spice freighter who died before Luke was born' },
        { id: 'K-SW-03', type: 'goal', content: 'Escape Tatooine and find purpose among the stars' },
        { id: 'K-SW-04', type: 'knows', content: 'Is a skilled pilot and can bullseye womp rats in his T-16 back home' },
        { id: 'K-SW-05', type: 'believes', content: 'The Empire is a distant evil — something that happens to other people, not moisture farmers' },
      ],
    },
  },
  'C-SW-02': {
    id: 'C-SW-02',
    name: 'Princess Leia Organa',
    role: 'anchor',
    imagePrompt: 'Young woman with dark brown hair styled in twin buns on either side of her head, large expressive brown eyes, and a regal bearing; wearing a flowing white senatorial gown with a silver belt and hood draped at her shoulders.',
    threadIds: ['T-SW-06', 'T-SW-02'],
    continuity: {
      nodes: [
        { id: 'K-SW-10', type: 'knows', content: 'Senator of Alderaan and secret leader within the Rebel Alliance' },
        { id: 'K-SW-11', type: 'secret', content: 'Carries the stolen Death Star technical readouts in R2-D2' },
        { id: 'K-SW-12', type: 'goal', content: 'Deliver the plans to the Rebellion and find a weakness in the Death Star' },
        { id: 'K-SW-13', type: 'believes', content: 'The galaxy will not survive under Imperial rule — the fight is worth any cost' },
        { id: 'K-SW-14', type: 'knows', content: 'Obi-Wan Kenobi served her father in the Clone Wars and may be the Rebellions last hope' },
      ],
    },
  },
  'C-SW-03': {
    id: 'C-SW-03',
    name: 'Han Solo',
    role: 'recurring',
    imagePrompt: 'Ruggedly handsome man in his early thirties with tousled brown hair, a crooked grin, and sharp hazel eyes; wearing a white shirt open at the collar, a black vest, low-slung holster on his hip, and weathered smuggler boots.',
    threadIds: ['T-SW-04'],
    continuity: {
      nodes: [
        { id: 'K-SW-20', type: 'knows', content: 'Smuggler and captain of the Millennium Falcon, fastest ship in the galaxy' },
        { id: 'K-SW-21', type: 'knows', content: 'Owes Jabba the Hutt a dangerous amount of credits — a debt measured in blaster bolts' },
        { id: 'K-SW-22', type: 'goal', content: 'Pay off Jabba and keep flying free — loyalty is a luxury he cannot afford' },
        { id: 'K-SW-23', type: 'believes', content: 'Hokey religions and ancient weapons are no match for a good blaster at your side' },
      ],
    },
  },
  'C-SW-04': {
    id: 'C-SW-04',
    name: 'Darth Vader',
    role: 'recurring',
    imagePrompt: 'Towering armored figure in all-black with a sweeping cape, a glossy black helmet with angular cheekplates and a skull-like respirator mask; chest panel of blinking lights and controls, mechanical breathing echoing in dim corridor light.',
    threadIds: ['T-SW-03', 'T-SW-07'],
    continuity: {
      nodes: [
        { id: 'K-SW-30', type: 'knows', content: 'Dark Lord of the Sith and enforcer of the Emperors will across the galaxy' },
        { id: 'K-SW-31', type: 'secret', content: 'Was once Anakin Skywalker — Jedi Knight, husband, father — before the fall' },
        { id: 'K-SW-32', type: 'goal', content: 'Recover the stolen Death Star plans and crush the Rebel Alliance' },
        { id: 'K-SW-33', type: 'knows', content: 'Senses a tremor in the Force — something familiar stirring at the edge of perception' },
        { id: 'K-SW-34', type: 'believes', content: 'The dark side is the only path to true power — the Jedi were weak and deserved their end' },
      ],
    },
  },
  'C-SW-05': {
    id: 'C-SW-05',
    name: 'Obi-Wan Kenobi',
    role: 'recurring',
    imagePrompt: 'Weathered older man with a neatly trimmed grey-white beard, kind blue-grey eyes lined with decades of exile, and deep sun creases; wearing sand-colored Jedi robes with a rough-woven hooded cloak, standing in golden desert light.',
    threadIds: ['T-SW-03', 'T-SW-05'],
    continuity: {
      nodes: [
        { id: 'K-SW-40', type: 'knows', content: 'Last of the old Jedi, living in exile on Tatooine as a hermit called Ben' },
        { id: 'K-SW-41', type: 'secret', content: 'Has watched over Luke Skywalker since birth — the son of Anakin, the boy who must not fall' },
        { id: 'K-SW-42', type: 'goal', content: 'When the time comes, guide Luke to the Force and finish what the Jedi could not' },
        { id: 'K-SW-43', type: 'knows', content: 'Darth Vader is Anakin Skywalker — his greatest failure, his deepest wound' },
        { id: 'K-SW-44', type: 'believes', content: 'The Force will balance itself — but it needs a vessel, and Luke is that vessel' },
      ],
    },
  },
  'C-SW-06': {
    id: 'C-SW-06',
    name: 'R2-D2',
    role: 'transient',
    imagePrompt: 'Squat cylindrical astromech droid with a domed silver-and-blue head, a single glowing red photoreceptor eye, white-and-blue paneled body, and stubby tripod legs; scuffed and sand-dusted from desert travel.',
    threadIds: ['T-SW-02'],
    continuity: {
      nodes: [
        { id: 'K-SW-50', type: 'knows', content: 'Carries the complete technical readouts of the Death Star in his memory banks' },
        { id: 'K-SW-51', type: 'goal', content: 'Deliver Princess Leias message and the plans to Obi-Wan Kenobi on Tatooine' },
        { id: 'K-SW-52', type: 'knows', content: 'Has served the Skywalker family across two generations — more loyal than any organic being' },
      ],
    },
  },
  'C-SW-07': {
    id: 'C-SW-07',
    name: 'Grand Moff Tarkin',
    role: 'transient',
    imagePrompt: 'Gaunt, sharp-featured man with hollow cheeks, piercing cold grey eyes, and slicked-back grey hair; wearing a crisp olive-green Imperial officer uniform with rank insignia cylinders on the chest, standing in the sterile light of a command bridge.',
    threadIds: ['T-SW-07'],
    continuity: {
      nodes: [
        { id: 'K-SW-60', type: 'knows', content: 'Commander of the Death Star — the most powerful weapon ever constructed' },
        { id: 'K-SW-61', type: 'goal', content: 'Use the Death Star to rule through fear — the Tarkin Doctrine made real' },
        { id: 'K-SW-62', type: 'believes', content: 'Fear will keep the local systems in line — fear of this battle station' },
        { id: 'K-SW-63', type: 'knows', content: 'The Rebel Alliance is an irritant, not a threat — insects beneath an iron heel' },
      ],
    },
  },
  'C-SW-08': {
    id: 'C-SW-08',
    name: 'Chewbacca',
    role: 'transient',
    imagePrompt: 'Massive seven-foot-tall Wookiee covered in shaggy brown fur with streaks of auburn; deep-set dark eyes beneath a heavy brow, a leather bandolier slung across his chest, and powerful long arms at his sides.',
    threadIds: ['T-SW-04'],
    continuity: {
      nodes: [
        { id: 'K-SW-70', type: 'knows', content: 'Wookiee co-pilot of the Millennium Falcon and Han Solos life-debt partner' },
        { id: 'K-SW-71', type: 'goal', content: 'Stand beside Han Solo in all things — the life-debt is absolute and freely given' },
        { id: 'K-SW-72', type: 'believes', content: 'Loyalty is not a transaction but a way of being — Han saved his life, and that is enough forever' },
      ],
    },
  },
};

// ── Locations ────────────────────────────────────────────────────────────────
const locations: Record<string, Location> = {
  'L-SW-01': {
    id: 'L-SW-01', name: 'The Galaxy', parentId: null, threadIds: [],
    imagePrompt: 'Vast spiral galaxy seen from deep space, billions of stars swirling in luminous arms of blue and white against the infinite black void, scattered nebulae glowing in violet and gold.',
    continuity: {
      nodes: [
        { id: 'LK-SW-01', type: 'lore', content: 'A galaxy ruled by the Galactic Empire — a thousand star systems held by fear and force' },
        { id: 'LK-SW-02', type: 'lore', content: 'The Jedi Order has been destroyed, its knights hunted to extinction by the Sith' },
      ],
    },
  },
  'L-SW-02': {
    id: 'L-SW-02', name: 'Tatooine', parentId: 'L-SW-01', threadIds: ['T-SW-01', 'T-SW-05'],
    imagePrompt: 'Endless desert landscape under twin suns blazing white and amber in a pale sky; rolling dunes of fine sand stretch to the horizon, broken by eroded rock mesas and shimmering heat haze.',
    continuity: {
      nodes: [
        { id: 'LK-SW-03', type: 'lore', content: 'A desert world orbiting twin suns — remote, lawless, and forgotten by the Empire' },
        { id: 'LK-SW-04', type: 'lore', content: 'Ruled by Hutt crime lords, populated by moisture farmers, Jawas, and Tusken Raiders' },
      ],
    },
  },
  'L-SW-03': {
    id: 'L-SW-03', name: 'The Death Star', parentId: 'L-SW-01', threadIds: ['T-SW-07', 'T-SW-03'],
    imagePrompt: 'Moon-sized spherical battle station hanging in the blackness of space, its surface covered in grey metallic panels and trenches; a massive concave superlaser dish dominates the upper hemisphere, glowing faintly green.',
    continuity: {
      nodes: [
        { id: 'LK-SW-05', type: 'lore', content: 'A moon-sized battle station capable of destroying entire planets with a single blast' },
        { id: 'LK-SW-06', type: 'secret', content: 'Contains a thermal exhaust port leading directly to the main reactor — a fatal design flaw' },
        { id: 'LK-SW-07', type: 'danger', content: 'Defended by turbolaser batteries, TIE fighter squadrons, and an entire Imperial garrison' },
      ],
    },
  },
  'L-SW-04': {
    id: 'L-SW-04', name: 'Mos Eisley', parentId: 'L-SW-02', threadIds: ['T-SW-04'],
    imagePrompt: 'Sprawling desert spaceport of low domed adobe buildings and dusty streets crowded with alien species; landed freighters dot the outskirts, heat rises from sun-baked stone, and a cantina glows with dim neon light.',
    continuity: {
      nodes: [
        { id: 'LK-SW-08', type: 'lore', content: 'A wretched hive of scum and villainy — the spaceport where the desperate come to disappear' },
        { id: 'LK-SW-09', type: 'lore', content: 'Home to smugglers, bounty hunters, and beings of every species seeking passage off-world' },
      ],
    },
  },
  'L-SW-05': {
    id: 'L-SW-05', name: 'Alderaan System', parentId: 'L-SW-01', threadIds: ['T-SW-06'],
    imagePrompt: 'A lush blue-green planet with swirling white clouds and snow-capped mountain ranges visible from orbit; elegant spired cities nestled in verdant valleys, bathed in warm golden sunlight.',
    continuity: {
      nodes: [
        { id: 'LK-SW-10', type: 'lore', content: 'Home system of the peaceful planet Alderaan — a world of beauty, culture, and quiet defiance' },
        { id: 'LK-SW-11', type: 'danger', content: 'Alderaan will be destroyed by the Death Star as a demonstration of Imperial power' },
      ],
    },
  },
  'L-SW-06': {
    id: 'L-SW-06', name: 'Yavin IV', parentId: 'L-SW-01', threadIds: ['T-SW-02', 'T-SW-06'],
    imagePrompt: 'Dense tropical jungle moon with towering stone Massassi temples rising above the canopy; vines drape ancient pyramids, mist clings to the undergrowth, and X-wing fighters are parked on a vine-cracked landing pad.',
    continuity: {
      nodes: [
        { id: 'LK-SW-12', type: 'secret', content: 'Hidden Rebel Alliance base within an ancient Massassi temple on a jungle moon' },
        { id: 'LK-SW-13', type: 'danger', content: 'If discovered, the Death Star will reduce the moon and the Rebellion to dust' },
      ],
    },
  },
  'L-SW-07': {
    id: 'L-SW-07', name: 'The Tantive IV', parentId: 'L-SW-01', threadIds: ['T-SW-02'],
    imagePrompt: 'Interior of a sleek white Corellian corvette with curved corridors, smooth white walls, and recessed lighting; blaster scoring marks the bulkheads, smoke drifts through the passageways, and red emergency lights pulse.',
    continuity: {
      nodes: [
        { id: 'LK-SW-14', type: 'lore', content: 'Alderaanian consular ship — Princess Leias diplomatic vessel and secret Rebel courier' },
        { id: 'LK-SW-15', type: 'danger', content: 'Captured by an Imperial Star Destroyer above Tatooine while carrying stolen plans' },
      ],
    },
  },
  'L-SW-08': {
    id: 'L-SW-08', name: 'Lars Homestead', parentId: 'L-SW-02', threadIds: ['T-SW-01'],
    imagePrompt: 'Sunken adobe moisture farm with a domed igloo entrance half-buried in desert sand; a courtyard cut into the earth below ground level, vaporator towers dotting the surrounding dunes under a burnt-orange sky.',
    continuity: {
      nodes: [
        { id: 'LK-SW-16', type: 'lore', content: 'A moisture farm on the outskirts of Tatooines Jundland Wastes — Lukes entire world' },
        { id: 'LK-SW-17', type: 'lore', content: 'Run by Owen and Beru Lars, who have kept Luke safe and ignorant of his true heritage' },
      ],
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
    name: 'Sand and Silence',
    sceneIds: ['S-SW-001', 'S-SW-002', 'S-SW-003', 'S-SW-004', 'S-SW-005', 'S-SW-006', 'S-SW-007'],
    develops: ['T-SW-01', 'T-SW-02'],
    locationIds: ['L-SW-01', 'L-SW-02', 'L-SW-07', 'L-SW-08'],
    activeCharacterIds: ['C-SW-01', 'C-SW-02', 'C-SW-04', 'C-SW-06'],
    initialCharacterLocations: {
      'C-SW-01': 'L-SW-08',
      'C-SW-02': 'L-SW-07',
      'C-SW-04': 'L-SW-07',
      'C-SW-06': 'L-SW-07',
    },
  },
  'SC-SW-02': {
    id: 'SC-SW-02',
    name: 'The Old Wound',
    sceneIds: ['S-SW-008', 'S-SW-009', 'S-SW-010', 'S-SW-011', 'S-SW-012', 'S-SW-013', 'S-SW-014'],
    develops: ['T-SW-01', 'T-SW-05'],
    locationIds: ['L-SW-02', 'L-SW-08'],
    activeCharacterIds: ['C-SW-01', 'C-SW-05', 'C-SW-06'],
    initialCharacterLocations: {
      'C-SW-01': 'L-SW-08',
      'C-SW-05': 'L-SW-02',
      'C-SW-06': 'L-SW-08',
    },
  },
};

// ── Scenes ───────────────────────────────────────────────────────────────────
const scenes: Record<string, Scene> = {
  // ── Arc 1: Sand and Silence ─────────────────────────────────────────────
  'S-SW-001': {
    id: 'S-SW-001',
    kind: 'scene',
    arcId: 'SC-SW-01',
    locationId: 'L-SW-07',
    povId: 'C-SW-02',
    participantIds: ['C-SW-02', 'C-SW-04', 'C-SW-06'],
    events: ['tantive_iv_captured', 'leia_hides_plans', 'vader_boards'],
    threadMutations: [
      { threadId: 'T-SW-02', from: 'dormant', to: 'active' },
      { threadId: 'T-SW-06', from: 'dormant', to: 'active' },
      { threadId: 'T-SW-07', from: 'dormant', to: 'active' },
    ],
    continuityMutations: [
      { characterId: 'C-SW-04', nodeId: 'K-SW-35', action: 'added', content: 'The Rebel ship was intercepted above Tatooine — the plans were transmitted before capture' },
      { characterId: 'C-SW-02', nodeId: 'K-SW-100', action: 'added', content: 'The ship is lost — the plans must survive in R2-D2, sent to the surface with a prayer' },
      { characterId: 'C-SW-06', nodeId: 'K-SW-101', action: 'added', content: 'Princess Leia entrusted the Death Star plans and a message for Obi-Wan Kenobi — mission priority absolute' },
    ],
    relationshipMutations: [
      { from: 'C-SW-04', to: 'C-SW-02', type: 'A senator caught in a lie — her defiance is an insult to the Emperor and will be crushed', valenceDelta: -0.2 },
      { from: 'C-SW-02', to: 'C-SW-04', type: 'The armored monster who murdered her crew — hatred tempered by the discipline not to show fear', valenceDelta: -0.3 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-SW-02', concept: 'The Galactic Empire — a totalitarian regime ruling through military dominance and institutional terror', type: 'system' },
        { id: 'WK-SW-03', concept: 'The Rebel Alliance — a decentralized insurgency fighting to restore the Republic', type: 'system' },
      ],
      addedEdges: [
        { from: 'WK-SW-02', to: 'WK-SW-03', relation: 'seeks to annihilate' },
        { from: 'WK-SW-03', to: 'WK-SW-02', relation: 'fights to overthrow' },
      ],
    },
    summary: 'Above Tatooine, an Imperial Star Destroyer swallows the Tantive IV whole. Stormtroopers blast through the corridors. Princess Leia, moving with the calm of someone who has rehearsed this nightmare, feeds the stolen Death Star plans into R2-D2 and records a desperate holographic plea. Darth Vader strides through the smoke and the dead, black cape trailing like a funeral shroud. He seizes Leia. The droids jettison to the desert below — two small pods tumbling into the vast amber nothing of a world that does not know what is coming.',
  },
  'S-SW-002': {
    id: 'S-SW-002',
    kind: 'scene',
    arcId: 'SC-SW-01',
    locationId: 'L-SW-08',
    povId: 'C-SW-01',
    participantIds: ['C-SW-01'],
    events: ['moisture_farm_morning', 'vaporator_work', 'owen_argues'],
    threadMutations: [],
    continuityMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-102', action: 'added', content: 'Another season on the farm — Owen needs him, but the sky keeps pulling' },
    ],
    relationshipMutations: [],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-SW-09', concept: 'Moisture farming — extracting water from desert air through vaporator technology, the subsistence economy of Tatooine', type: 'system' },
        { id: 'WK-SW-10', concept: 'Tatooine exists at the edge of the galaxy, too remote and poor for the Empire to bother controlling directly', type: 'concept' },
      ],
      addedEdges: [
        { from: 'WK-SW-10', to: 'WK-SW-02', relation: 'is beneath the notice of' },
        { from: 'WK-SW-09', to: 'WK-SW-10', relation: 'is the economic backbone of' },
      ],
    },
    summary: 'Dawn on the moisture farm. Luke is elbow-deep in a vaporator coupling before the first sun clears the ridge. Uncle Owen calls instructions from the homestead door, voice flat as the horizon. The work is rhythmic, mindless — tighten, calibrate, move to the next unit. A line of condensators stretches to the vanishing point. Luke has done this a thousand mornings. His hands know the tools. His mind is somewhere among the stars, building a life out of nothing but want. Owen tells him the south ridge units need attention. Luke nods. The desert gives nothing freely and demands everything in return.',
  },
  'S-SW-003': {
    id: 'S-SW-003',
    kind: 'scene',
    arcId: 'SC-SW-01',
    locationId: 'L-SW-08',
    povId: 'C-SW-01',
    participantIds: ['C-SW-01'],
    events: ['binary_sunset', 'yearning', 'dreaming_of_the_academy'],
    threadMutations: [],
    continuityMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-103', action: 'added', content: 'There must be more than this — the twin suns set on the same horizon every night, and every night Luke feels smaller' },
    ],
    relationshipMutations: [],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-SW-11', concept: 'The binary sunset — beauty without meaning, the desert\'s indifferent beauty that mirrors longing for purpose', type: 'concept' },
        { id: 'WK-SW-12', concept: 'The harvest as anchor — agricultural obligation that keeps people rooted to land they want to leave', type: 'tension' },
      ],
      addedEdges: [
        { from: 'WK-SW-12', to: 'WK-SW-09', relation: 'is the human cost of' },
      ],
    },
    summary: 'The binary sunset. Luke stands at the edge of the homestead courtyard, silhouetted against two suns bleeding orange and crimson into the dune sea. The light is impossibly beautiful, and it means nothing — it happens every evening, indifferent to the boy watching it. Somewhere beyond that horizon, pilots are flying. Wars are being fought. People are living lives that matter. Luke lets the last light wash over his face and feels the weight of every identical day behind him, and every identical day ahead. He does not move until the suns are gone and the desert turns cold.',
  },
  'S-SW-004': {
    id: 'S-SW-004',
    kind: 'scene',
    arcId: 'SC-SW-01',
    locationId: 'L-SW-08',
    povId: 'C-SW-01',
    participantIds: ['C-SW-01'],
    events: ['dinner_with_owen_beru', 'academy_request_denied', 'tension'],
    threadMutations: [],
    continuityMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-104', action: 'added', content: 'Owen will never let him leave — "maybe next season" is a sentence with no end' },
      { characterId: 'C-SW-01', nodeId: 'K-SW-105', action: 'added', content: 'Aunt Beru understands his restlessness but will not defy Owen — Luke is alone in this' },
    ],
    relationshipMutations: [],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-SW-13', concept: 'Owen\'s protective deception — keeping Luke ignorant of his heritage to keep him safe from the Empire and the Force', type: 'concept' },
      ],
      addedEdges: [
        { from: 'WK-SW-13', to: 'WK-SW-12', relation: 'weaponizes' },
        { from: 'WK-SW-13', to: 'WK-SW-09', relation: 'uses the farm to keep Luke rooted on' },
      ],
    },
    summary: 'Dinner at the Lars homestead. Blue milk, root vegetables, the hum of the moisture recycler. Luke asks about the Imperial Academy again — casually, as if the answer might change. Aunt Beru watches Owen with soft eyes. Owen says maybe next season, same as last season, same as the season before. His voice is gentle but his jaw is set. Beru starts to speak, stops. Luke pushes food around his plate. The silence between uncle and nephew fills with everything neither will say: the dead father, the absent mother, the desert that keeps people safe by keeping them still. Luke excuses himself early. The door hisses shut behind him.',
  },
  'S-SW-005': {
    id: 'S-SW-005',
    kind: 'scene',
    arcId: 'SC-SW-01',
    locationId: 'L-SW-02',
    povId: 'C-SW-01',
    participantIds: ['C-SW-01'],
    characterMovements: { 'C-SW-01': { locationId: 'L-SW-02', transition: 'Drove his landspeeder across the flats to Tosche Station' } },
    events: ['friends_at_tosche', 'biggs_leaving', 'luke_left_behind'],
    threadMutations: [],
    continuityMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-106', action: 'added', content: 'Biggs is leaving to join the Rebellion — the war is real, and it is taking people Luke knows' },
      { characterId: 'C-SW-01', nodeId: 'K-SW-107', action: 'added', content: 'Everyone leaves Tatooine except him — the harvest is an anchor, not a reason' },
    ],
    relationshipMutations: [],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-SW-15', concept: 'The Rebellion recruits from the margins — frontier youth, disillusioned soldiers, and idealists with nothing left to lose', type: 'law' },
      ],
      addedEdges: [
        { from: 'WK-SW-15', to: 'WK-SW-03', relation: 'is the lifeblood of' },
        { from: 'WK-SW-15', to: 'WK-SW-10', relation: 'draws its fighters from worlds like' },
      ],
    },
    summary: 'Tosche Station. Luke leans against his landspeeder in the shade of the depot, swapping stories with Fixer and Camie while power converters charge. Biggs Darklighter pulls him aside — voice low, eyes bright with a dangerous secret. He is leaving. Not the Academy kind of leaving, but the real kind: joining the Rebellion. Luke listens with a mix of admiration and envy so sharp it aches. Biggs grips his shoulder. "Come with me." Luke wants to. The wanting is a physical thing, lodged under his ribs. But Owen needs him for the harvest. The excuses sound thin even to his own ears. Biggs drives off into the heat shimmer, and Luke watches until the dust settles.',
  },
  'S-SW-006': {
    id: 'S-SW-006',
    kind: 'scene',
    arcId: 'SC-SW-01',
    locationId: 'L-SW-08',
    povId: 'C-SW-01',
    participantIds: ['C-SW-01', 'C-SW-06'],
    characterMovements: { 'C-SW-01': { locationId: 'L-SW-08', transition: 'Drove back from Tosche Station as the suns began to set' }, 'C-SW-06': { locationId: 'L-SW-08', transition: 'Purchased from Jawa sandcrawler and brought to the Lars homestead' } },
    events: ['jawas_arrive', 'droids_purchased', 'r2_stubborn'],
    threadMutations: [
      { threadId: 'T-SW-02', from: 'active', to: 'escalating' },
    ],
    continuityMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-108', action: 'added', content: 'The new astromech droid is stubborn and strange — it acts like it has somewhere to be' },
      { characterId: 'C-SW-06', nodeId: 'K-SW-109', action: 'added', content: 'Purchased by moisture farmers on Tatooine — Obi-Wan Kenobi must be nearby' },
    ],
    relationshipMutations: [
      { from: 'C-SW-01', to: 'C-SW-06', type: 'Puzzled by the willful little droid — it is more personality than machine', valenceDelta: 0.1 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-SW-17', concept: 'Droids as unnoticed agents — sentient machines treated as property pass through the galaxy carrying secrets no one thinks to look for', type: 'tension' },
      ],
      addedEdges: [
        { from: 'WK-SW-17', to: 'WK-SW-03', relation: 'is an unwitting asset of' },
        { from: 'WK-SW-17', to: 'WK-SW-10', relation: 'passes unnoticed through worlds like' },
      ],
    },
    summary: 'A Jawa sandcrawler grinds to a halt outside the homestead, disgorging a line of battered droids into the afternoon glare. Owen haggles in the clipped tones of a man who knows he is being cheated and accepts it as the cost of living on Tatooine. Luke is tasked with cleaning the new purchases: a fussy golden protocol droid and a squat blue astromech that refuses to cooperate. R2-D2 rocks on his legs, chirps indignantly, and will not hold still for the oil bath. Luke wrestles with him like a farmer wrangling a stubborn animal. There is something almost funny about it — the boy and the droid, neither willing to yield.',
  },
  'S-SW-007': {
    id: 'S-SW-007',
    kind: 'scene',
    arcId: 'SC-SW-01',
    locationId: 'L-SW-08',
    povId: 'C-SW-01',
    participantIds: ['C-SW-01', 'C-SW-06'],
    events: ['holographic_message', 'obi_wan_name', 'restless_yearning'],
    threadMutations: [
      { threadId: 'T-SW-01', from: 'dormant', to: 'active' },
    ],
    continuityMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-06', action: 'added', content: 'A holographic woman inside the astromech droid pleads for someone called Obi-Wan Kenobi' },
      { characterId: 'C-SW-01', nodeId: 'K-SW-110', action: 'added', content: 'Obi-Wan Kenobi — the name connects to old Ben Kenobi, the hermit in the Jundland Wastes' },
    ],
    relationshipMutations: [
      { from: 'C-SW-01', to: 'C-SW-06', type: 'The droid carries a secret that has hooked itself into Luke — this machine is a messenger from another life', valenceDelta: 0.2 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-SW-19', concept: 'Holographic communication — compressed light messages that cross the galaxy, carrying pleas across impossible distances', type: 'system' },
      ],
      addedEdges: [
        { from: 'WK-SW-19', to: 'WK-SW-17', relation: 'is carried unknowingly by' },
        { from: 'WK-SW-19', to: 'WK-SW-07', relation: 'is the communication layer of' },
      ],
    },
    summary: 'The garage, late evening. Luke runs a cleaning tool across R2-D2s dome and triggers something he was not meant to see. A hologram flickers to life — a young woman in white, luminous and desperate, speaking a name Luke half-recognizes from old stories and half-remembered warnings. "Help me, Obi-Wan Kenobi. You are my only hope." The image stutters, repeats, cuts out. Luke stares at the space where she was. The message is not for him. But it pulls at something inside his chest — a hook set years ago, finally finding purchase. He asks the droid who she is. R2-D2 says nothing, and everything.',

  },

  // ── Arc 2: The Old Wound ────────────────────────────────────────────────
  'S-SW-008': {
    id: 'S-SW-008',
    kind: 'scene',
    arcId: 'SC-SW-02',
    locationId: 'L-SW-02',
    povId: 'C-SW-01',
    participantIds: ['C-SW-01', 'C-SW-06'],
    characterMovements: { 'C-SW-01': { locationId: 'L-SW-02', transition: 'Chased R2-D2 across the desert in his landspeeder' }, 'C-SW-06': { locationId: 'L-SW-02', transition: 'Escaped in the night and rolled into the Jundland Wastes' } },
    events: ['r2_escapes', 'luke_pursues', 'jundland_wastes'],
    threadMutations: [
      { threadId: 'T-SW-02', from: 'escalating', to: 'escalating' },
    ],
    continuityMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-111', action: 'added', content: 'R2-D2 escaped into the Jundland Wastes on its own — it is searching for someone' },
      { characterId: 'C-SW-06', nodeId: 'K-SW-112', action: 'added', content: 'Must reach Obi-Wan Kenobi — the mission overrides the wishes of the new owner' },
    ],
    relationshipMutations: [
      { from: 'C-SW-01', to: 'C-SW-06', type: 'Frustrated and fascinated — the droid ran away on purpose, and Luke followed without thinking', valenceDelta: 0.1 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-SW-20', concept: 'The Jundland Wastes — lawless desert canyon territory where civilization ends and ancient danger begins', type: 'concept' },
      ],
      addedEdges: [
        { from: 'WK-SW-20', to: 'WK-SW-10', relation: 'is the wild interior of' },
      ],
    },
    summary: 'Before dawn, R2-D2 is gone — slipped out of the garage and into the desert on his own inscrutable mission. Luke curses, fires up his landspeeder, and chases the droid into the Jundland Wastes. The canyons swallow the morning light. Sand People territory. Luke knows this, and goes anyway, half out of duty, half because following the droid feels like following the holographic woman, which feels like following the tug that has lived in his chest since the binary sunset. The speeder kicks up dust. The wastes stretch ahead, ancient and indifferent.',
  },
  'S-SW-009': {
    id: 'S-SW-009',
    kind: 'scene',
    arcId: 'SC-SW-02',
    locationId: 'L-SW-02',
    povId: 'C-SW-01',
    participantIds: ['C-SW-01'],
    events: ['tusken_ambush', 'knocked_unconscious'],
    threadMutations: [
      { threadId: 'T-SW-01', from: 'active', to: 'escalating' },
    ],
    continuityMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-113', action: 'added', content: 'The Jundland Wastes are deadly — Tusken Raiders attacked without warning and Luke was helpless' },
    ],
    relationshipMutations: [],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-SW-21', concept: 'Tusken Raiders — indigenous desert warriors who enforce territorial boundaries through violence', type: 'concept' },
      ],
      addedEdges: [
        { from: 'WK-SW-21', to: 'WK-SW-20', relation: 'controls and patrols' },
        { from: 'WK-SW-21', to: 'WK-SW-09', relation: 'exists outside the reach of' },
      ],
    },
    summary: 'The canyon narrows. Luke spots R2-D2 wedged between two rocks and climbs down to retrieve him. Then the sound — a guttural, rhythmic war cry bouncing off the walls. Tusken Raiders. A gaderffii stick catches Luke across the shoulder and the world goes white. He hits the sand face-first. Above him, the Tuskens rifle through his speeder with methodical curiosity. Luke lies crumpled in the shade of a boulder, blood on his lip, alone in hostile territory with a stolen droid and no one who knows where he is.',
  },
  'S-SW-010': {
    id: 'S-SW-010',
    kind: 'scene',
    arcId: 'SC-SW-02',
    locationId: 'L-SW-02',
    povId: 'C-SW-01',
    participantIds: ['C-SW-01', 'C-SW-05', 'C-SW-06'],
    events: ['ben_kenobi_appears', 'tuskens_scattered', 'hermit_cave'],
    threadMutations: [
      { threadId: 'T-SW-03', from: 'dormant', to: 'active' },
    ],
    continuityMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-114', action: 'added', content: 'Old Ben Kenobi scattered the Tuskens with a sound no ordinary man could make — there is something uncanny about him' },
      { characterId: 'C-SW-05', nodeId: 'K-SW-115', action: 'added', content: 'The boy has come to me at last — Anakins son, drawn into the Wastes by the very droid Leia sent' },
    ],
    relationshipMutations: [
      { from: 'C-SW-01', to: 'C-SW-05', type: 'Gratitude and curiosity — the old hermit saved his life and seems to know more than he says', valenceDelta: 0.1 },
      { from: 'C-SW-05', to: 'C-SW-01', type: 'The boy looks so much like Anakin it is almost unbearable — hope and grief in equal measure', valenceDelta: 0.2 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-SW-22', concept: 'Jedi in exile — survivors of the purge who hide in plain sight, waiting for a sign that the time has come', type: 'concept' },
      ],
      addedEdges: [
        { from: 'WK-SW-22', to: 'WK-SW-10', relation: 'hides within the obscurity of' },
        { from: 'WK-SW-22', to: 'WK-SW-02', relation: 'survives by staying invisible to' },
      ],
    },
    summary: 'A sound like a krayt dragon echoes through the canyon — low, ancient, wrong — and the Tusken Raiders scatter. A figure emerges from the rocks: an old man in sand-colored robes, moving with the unhurried patience of someone who has outlived his enemies. Ben Kenobi. He kneels beside Luke, checks the wound, helps him to his feet. "The Jundland Wastes are not to be traveled lightly." His eyes linger on R2-D2 with an expression Luke cannot read. He leads them to his dwelling — a cave carved into the canyon wall, spare and clean, the home of a man who has been waiting a very long time.',
  },
  'S-SW-011': {
    id: 'S-SW-011',
    kind: 'scene',
    arcId: 'SC-SW-02',
    locationId: 'L-SW-02',
    povId: 'C-SW-01',
    participantIds: ['C-SW-01', 'C-SW-05', 'C-SW-06'],
    events: ['obi_wan_revealed', 'fathers_lightsaber', 'the_force_introduced'],
    threadMutations: [
      { threadId: 'T-SW-05', from: 'dormant', to: 'active' },
      { threadId: 'T-SW-03', from: 'active', to: 'escalating' },
    ],
    continuityMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-07', action: 'added', content: 'Ben Kenobi is Obi-Wan Kenobi — a Jedi Knight who fought alongside his father in the Clone Wars' },
      { characterId: 'C-SW-01', nodeId: 'K-SW-08', action: 'added', content: 'His father did not die on a spice freighter — he was a Jedi, murdered by Darth Vader' },
      { characterId: 'C-SW-01', nodeId: 'K-SW-116', action: 'added', content: 'The lightsaber in his hand belonged to his father — it hums with a life of its own, blue and bright' },
    ],
    relationshipMutations: [
      { from: 'C-SW-01', to: 'C-SW-05', type: 'Awe and confusion — this old man knew his father and carries a galaxy of secrets', valenceDelta: 0.2 },
      { from: 'C-SW-05', to: 'C-SW-01', type: 'The boy holds Anakins saber and the Force stirs — the time has come at last', valenceDelta: 0.1 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-SW-24', concept: 'The Jedi Order — an ancient monastic order of Force-wielders who served as guardians of peace for a thousand generations', type: 'system' },
        { id: 'WK-SW-26', concept: 'The Dark Side — the Force corrupted by fear, anger, and the hunger for power', type: 'concept' },
      ],
      addedEdges: [
        { from: 'WK-SW-24', to: 'WK-SW-02', relation: 'was destroyed by the rise of' },
        { from: 'WK-SW-26', to: 'WK-SW-24', relation: 'consumed and betrayed' },
      ],
    },
    summary: 'The hermits cave. Obi-Wan unwraps the past with the care of a man handling something that might cut him. He gives Luke his fathers lightsaber — the blade hums blue, alive after decades of silence, and the sound fills the small room like a held breath released. He speaks of the Jedi, the Force, the Clone Wars, and a pupil named Darth Vader who betrayed everything. Luke holds the weapon of a dead man and feels the universe tilt beneath his feet. Every lie Uncle Owen told rearranges itself into a new and terrible shape. The boy who thought he knew his own story discovers he has been living inside someone elses.',
  },
  'S-SW-012': {
    id: 'S-SW-012',
    kind: 'scene',
    arcId: 'SC-SW-02',
    locationId: 'L-SW-02',
    povId: 'C-SW-01',
    participantIds: ['C-SW-01', 'C-SW-05', 'C-SW-06'],
    events: ['leia_full_message', 'plea_for_alderaan', 'obi_wan_asks_luke'],
    threadMutations: [
      { threadId: 'T-SW-02', from: 'escalating', to: 'escalating' },
      { threadId: 'T-SW-06', from: 'active', to: 'escalating' },
    ],
    continuityMutations: [
      { characterId: 'C-SW-05', nodeId: 'K-SW-45', action: 'added', content: 'The plans are in the droid — Leia sent them here, to me, which means the hour has finally come' },
      { characterId: 'C-SW-01', nodeId: 'K-SW-117', action: 'added', content: 'The holographic woman is Princess Leia Organa — the Rebellion needs Obi-Wan and the droids contents to survive' },
      { characterId: 'C-SW-05', nodeId: 'K-SW-118', action: 'added', content: 'Luke must learn the ways of the Force — he is the only hope left, whether he knows it or not' },
    ],
    relationshipMutations: [
      { from: 'C-SW-01', to: 'C-SW-02', type: 'The holographic princess is real and in danger — her plea is aimed at Obi-Wan but it strikes Luke just as hard', valenceDelta: 0.2 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-SW-30', concept: 'The Force awakens through bloodline — it calls to the children of those who wielded it, whether they know their heritage or not', type: 'law' },
      ],
      addedEdges: [
        { from: 'WK-SW-30', to: 'WK-SW-13', relation: 'is what Owen fears and tries to prevent through' },
        { from: 'WK-SW-30', to: 'WK-SW-22', relation: 'is the reason for the vigil of' },
      ],
    },
    summary: 'R2-D2 plays the full message. Princess Leia Organa, her composure thin as paper over something desperate underneath, begs Obi-Wan Kenobi to take the droids contents to her father on Alderaan. The fate of the Rebellion rests in this astromech. Obi-Wan sits very still for a long time after the hologram fades. Then he turns to Luke. "You must learn the ways of the Force, if you are to come with me to Alderaan." The words land like stones dropped into deep water. Luke feels the pull — tremendous, magnetic, aimed at the center of him. But he shakes his head. He cannot. Owen needs him. The harvest is coming. The refusal tastes like dust.',
  },
  'S-SW-013': {
    id: 'S-SW-013',
    kind: 'scene',
    arcId: 'SC-SW-02',
    locationId: 'L-SW-02',
    povId: 'C-SW-01',
    participantIds: ['C-SW-01', 'C-SW-05'],
    events: ['quiet_ride_home', 'smoke_on_horizon'],
    threadMutations: [
      { threadId: 'T-SW-05', from: 'active', to: 'escalating' },
    ],
    continuityMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-119', action: 'added', content: 'His father was a Jedi — the lightsaber is warm in his lap and the word rewrites everything' },
      { characterId: 'C-SW-01', nodeId: 'K-SW-120', action: 'added', content: 'Smoke rises from the direction of the homestead — something terrible has happened' },
    ],
    relationshipMutations: [
      { from: 'C-SW-05', to: 'C-SW-01', type: 'Sees Anakin in the boys restless hands, the hungry eyes — history threatening to repeat', valenceDelta: 0.1 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-SW-31', concept: 'Destiny operates through coincidence — the Force arranges meetings, escapes, and arrivals that feel accidental but are not', type: 'tension' },
      ],
      addedEdges: [
        { from: 'WK-SW-31', to: 'WK-SW-01', relation: 'is the invisible hand of' },
        { from: 'WK-SW-31', to: 'WK-SW-30', relation: 'works in concert with' },
      ],
    },
    summary: 'The ride back toward the homestead. Obi-Wan drives while Luke stares at the lightsaber in his lap, turning it over, feeling its weight. Neither speaks. The desert scrolls past — familiar landmarks that look different now, as if Luke is seeing them through new eyes. A Jedi. His father was a Jedi. The word sits in his mouth like a foreign language. Obi-Wan watches the boy from the corner of his eye, seeing Anakin in the jaw, in the restless hands, in the hunger. Then — on the horizon, where the homestead should be — a thread of black smoke, thin as a pen stroke against the fading sky.',
  },
  'S-SW-014': {
    id: 'S-SW-014',
    kind: 'scene',
    arcId: 'SC-SW-02',
    locationId: 'L-SW-08',
    povId: 'C-SW-01',
    participantIds: ['C-SW-01'],
    characterMovements: { 'C-SW-01': { locationId: 'L-SW-08', transition: 'Raced back to the homestead only to find it in flames' } },
    events: ['homestead_destroyed', 'owen_beru_killed', 'point_of_no_return'],
    threadMutations: [
      { threadId: 'T-SW-01', from: 'escalating', to: 'escalating' },
      { threadId: 'T-SW-07', from: 'active', to: 'escalating' },
    ],
    continuityMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-09', action: 'added', content: 'Uncle Owen and Aunt Beru are dead — burned by Imperial stormtroopers hunting the droids. There is nothing left here.' },
      { characterId: 'C-SW-01', nodeId: 'K-SW-121', action: 'added', content: 'The Empire killed his family — the distant evil is no longer distant, it is personal' },
    ],
    relationshipMutations: [
      { from: 'C-SW-01', to: 'C-SW-05', type: 'Obi-Wan is the only path forward now — Luke will go to Alderaan and learn what he must', valenceDelta: 0.3 },
    ],
    worldKnowledgeMutations: {
      addedNodes: [
        { id: 'WK-SW-32', concept: 'The Empire leaves no witnesses — Imperial operations eliminate civilians to protect operational security without hesitation', type: 'law' },
        { id: 'WK-SW-33', concept: 'The point of no return — the moment when the old life is literally destroyed and the only direction is forward', type: 'concept' },
      ],
      addedEdges: [
        { from: 'WK-SW-32', to: 'WK-SW-02', relation: 'is standard doctrine of' },
        { from: 'WK-SW-33', to: 'WK-SW-12', relation: 'permanently destroys' },
      ],
    },
    summary: 'The Lars Homestead, burning. Luke arrives to find smoke where his life used to be. The blackened skeletons of Owen and Beru lie in the doorway of the only home he has known — two people who loved him the only way they knew how, by keeping him small and safe and alive. Stormtroopers traced the droids here, and the Empire does not leave witnesses. Luke stands among the ashes. The boy who wanted to stay, the nephew who owed a harvest, the dreamer who watched binary sunsets and imagined a different life — all of it burns. He returns to Obi-Wan. His voice is quiet and final: "I want to come with you to Alderaan."',
  },
};

// ── Commits ──────────────────────────────────────────────────────────────────
const diffNames: Record<string, string> = {
  'S-SW-001': 'tantive_iv_captured',
  'S-SW-002': 'farm_morning',
  'S-SW-003': 'binary_sunset',
  'S-SW-004': 'dinner_tension',
  'S-SW-005': 'tosche_station',
  'S-SW-006': 'droids_purchased',
  'S-SW-007': 'holographic_message',
  'S-SW-008': 'r2_escapes',
  'S-SW-009': 'tusken_ambush',
  'S-SW-010': 'ben_kenobi_appears',
  'S-SW-011': 'fathers_lightsaber',
  'S-SW-012': 'full_message_played',
  'S-SW-013': 'smoke_on_horizon',
  'S-SW-014': 'homestead_destroyed',
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
  worldKnowledgeMutations: {
    addedNodes: [
      { id: 'WK-SW-WB-01', concept: 'The Galactic Republic — the thousand-generation democracy that preceded the Empire, destroyed from within by the Sith', type: 'system' },
      { id: 'WK-SW-WB-02', concept: 'Hyperspace travel — faster-than-light transit through an alternate dimension, the connective tissue that makes galactic civilization possible', type: 'system' },
      { id: 'WK-SW-WB-03', concept: 'The Force traditions — Light Side and Dark Side as competing philosophies of cosmic power, each with its own discipline, temptation, and cost', type: 'concept' },
      { id: 'WK-SW-WB-04', concept: 'The Rule of Two — the Sith doctrine that there shall be only a master and an apprentice, concentrating dark power through betrayal and succession', type: 'law' },
      { id: 'WK-SW-WB-05', concept: 'The Great Jedi Purge — the systematic extermination of the Jedi Order through Order 66, turning the Republic\'s own army against its guardians', type: 'concept' },
      { id: 'WK-SW-WB-06', concept: 'The Imperial Senate — the vestigial democratic body maintained to provide legitimacy, dissolved when the Death Star renders consent unnecessary', type: 'system' },
      { id: 'WK-SW-WB-07', concept: 'Galactic economics — a civilization spanning millions of worlds runs on trade routes, resource extraction, and the credits that flow between them', type: 'system' },
      { id: 'WK-SW-WB-08', concept: 'The prophecy of the Chosen One — a Force-born being destined to bring balance, a promise that haunts every Jedi who remembers it', type: 'tension' },
    ],
    addedEdges: [
      { from: 'WK-SW-WB-01', to: 'WK-SW-02', relation: 'was overthrown and replaced by' },
      { from: 'WK-SW-WB-01', to: 'WK-SW-24', relation: 'was defended for a thousand generations by' },
      { from: 'WK-SW-WB-02', to: 'WK-SW-02', relation: 'enables the galactic reach of' },
      { from: 'WK-SW-WB-02', to: 'WK-SW-10', relation: 'connects even the remote worlds like' },
      { from: 'WK-SW-WB-03', to: 'WK-SW-01', relation: 'is the philosophical framework for understanding' },
      { from: 'WK-SW-WB-03', to: 'WK-SW-26', relation: 'defines the Dark Side within' },
      { from: 'WK-SW-WB-04', to: 'WK-SW-06', relation: 'governs the internal structure of' },
      { from: 'WK-SW-WB-04', to: 'WK-SW-28', relation: 'is the mechanism that produces' },
      { from: 'WK-SW-WB-05', to: 'WK-SW-24', relation: 'destroyed' },
      { from: 'WK-SW-WB-05', to: 'WK-SW-22', relation: 'created the condition of' },
      { from: 'WK-SW-WB-05', to: 'WK-SW-27', relation: 'was the culmination of' },
      { from: 'WK-SW-WB-06', to: 'WK-SW-WB-01', relation: 'is the hollow shell of' },
      { from: 'WK-SW-WB-06', to: 'WK-SW-05', relation: 'was dissolved when it became unnecessary due to' },
      { from: 'WK-SW-WB-07', to: 'WK-SW-09', relation: 'includes subsistence economies like' },
      { from: 'WK-SW-WB-07', to: 'WK-SW-16', relation: 'includes criminal economies like' },
      { from: 'WK-SW-WB-08', to: 'WK-SW-30', relation: 'is the cosmic dimension of' },
      { from: 'WK-SW-WB-08', to: 'WK-SW-29', relation: 'deepens the central paradox of' },
    ],
  },
};

const sceneList = Object.values(scenes);
const commits: Commit[] = sceneList.map((scene, i) => ({
  id: `CM-SW-${String(i + 1).padStart(3, '0')}`,
  parentId: i === 0 ? null : `CM-SW-${String(i).padStart(3, '0')}`,
  sceneId: scene.id,
  arcId: scene.arcId,
  diffName: diffNames[scene.id] ?? 'thread_surfaced',
  threadMutations: scene.threadMutations,
  continuityMutations: scene.continuityMutations,
  relationshipMutations: scene.relationshipMutations,
  authorOverride: null,
  createdAt: Date.now() - (14 - i) * 3600000,
}));

// ── Alternate Branch: "What if Owen let Luke go to the Academy?" ────────────
// Diverges after S-SW-004 — Owen relents at dinner and Luke leaves for the
// Academy before the droids ever arrive, missing the call entirely.

const altArc: Arc = {
  id: 'SC-SW-02-ALT',
  name: 'The Academy Boy',
  sceneIds: ['S-SW-ALT-005', 'S-SW-ALT-006', 'S-SW-ALT-007'],
  develops: ['T-SW-01'],
  locationIds: ['L-SW-01', 'L-SW-02'],
  activeCharacterIds: ['C-SW-01'],
  initialCharacterLocations: {
    'C-SW-01': 'L-SW-02',
  },
};

const altScenes: Record<string, Scene> = {
  'S-SW-ALT-005': {
    id: 'S-SW-ALT-005',
    kind: 'scene',
    arcId: 'SC-SW-02-ALT',
    locationId: 'L-SW-08',
    povId: 'C-SW-01',
    participantIds: ['C-SW-01'],
    events: ['owen_relents', 'beru_convinces', 'luke_packs'],
    threadMutations: [
      { threadId: 'T-SW-01', from: 'dormant', to: 'active' },
    ],
    continuityMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-130', action: 'added', content: 'Owen said yes — the Academy is real, the escape is happening, and it feels more like loss than victory' },
      { characterId: 'C-SW-01', nodeId: 'K-SW-131', action: 'added', content: 'Beru convinced Owen to let him go — she understood what Owen could not' },
    ],
    relationshipMutations: [],
    summary: 'After dinner, Beru finds Owen on the courtyard steps. She speaks quietly, the way she does when she means every word. "You cannot keep him here forever. He is not his father." Owen stares at the dark. In the morning, he tells Luke he can apply to the Academy next season. Luke cannot believe it. He packs a bag that night — not much, because he does not own much — and lies awake listening to the wind against the dome, feeling the strange grief of getting what you wished for.',
  },
  'S-SW-ALT-006': {
    id: 'S-SW-ALT-006',
    kind: 'scene',
    arcId: 'SC-SW-02-ALT',
    locationId: 'L-SW-02',
    povId: 'C-SW-01',
    participantIds: ['C-SW-01'],
    events: ['departure_morning', 'last_look_at_homestead', 'transport_to_anchorhead'],
    threadMutations: [
      { threadId: 'T-SW-01', from: 'active', to: 'escalating' },
    ],
    continuityMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-132', action: 'added', content: 'The homestead shrinks in the mirror — leaving feels like amputation, clean and necessary and deeply wrong' },
      { characterId: 'C-SW-01', nodeId: 'K-SW-133', action: 'added', content: 'Somewhere behind him the droids are arriving — but Luke will never know what he missed' },
    ],
    relationshipMutations: [],
    summary: 'Luke drives toward Anchorhead in the pre-dawn dark, the homestead shrinking in the mirror. He has imagined this departure a hundred times, but in his imagination it felt like escape. In reality it feels like amputation — clean, necessary, and deeply wrong. The moisture farm disappears behind a dune. Somewhere behind him, a Jawa sandcrawler is grinding toward the homestead with two droids in its hold. Luke does not know this. He will never know this. The transport to the Academy leaves in three hours, and the boy who might have been a Jedi is about to become an Imperial cadet.',
  },
  'S-SW-ALT-007': {
    id: 'S-SW-ALT-007',
    kind: 'scene',
    arcId: 'SC-SW-02-ALT',
    locationId: 'L-SW-02',
    povId: 'C-SW-01',
    participantIds: ['C-SW-01'],
    events: ['anchorhead_transport', 'looking_up_at_stars', 'wrong_path_taken'],
    threadMutations: [
      { threadId: 'T-SW-01', from: 'escalating', to: 'escalating' },
    ],
    continuityMutations: [
      { characterId: 'C-SW-01', nodeId: 'K-SW-134', action: 'added', content: 'The transport lifts off and Tatooine falls away — Luke is going to fly, but something nags like a door closing forever' },
      { characterId: 'C-SW-01', nodeId: 'K-SW-135', action: 'added', content: 'He is about to become an Imperial cadet — the story that was meant to be his moves on without him' },
    ],
    relationshipMutations: [],
    summary: 'Anchorhead transport depot. Luke sits on a bench with his bag between his feet, watching a freighter lift off in a column of dust and engine glow. He is going to fly. He is going to see the galaxy. The excitement is real, but underneath it, something nags — a feeling like a door closing behind him that he will not be able to reopen. He looks up at the brightening sky where, hours ago, a Star Destroyer swallowed a consular ship and changed the fate of the galaxy. The transport arrives. Luke boards. The story that was meant to be his moves on without him, and he does not feel it go.',
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
  'B-SW-ACADEMY': {
    id: 'B-SW-ACADEMY',
    name: 'What if Owen let Luke go to the Academy?',
    parentBranchId: 'B-SW-MAIN',
    forkEntryId: 'S-SW-004',
    entryIds: Object.keys(altScenes),
    createdAt: Date.now() - 43200000,
  },
};

// ── Assembled Narrative ──────────────────────────────────────────────────────
export const seedSW: NarrativeState = {
  id: 'N-SW',
  title: 'Star Wars — A New Hope',
  description: 'A farm boy on a desert world tends moisture vaporators, watches binary sunsets, and dreams of a life that matters. When two droids carrying a stolen secret arrive at his doorstep, Luke Skywalker is pulled toward a hermit, a lightsaber, and a truth about his father that rewrites everything he knows. This is the first act — the sand, the silence, and the slow ignition of a destiny that has not yet declared itself.',
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
      'WK-SW-01': { id: 'WK-SW-01', concept: 'The Force — an energy field created by all living things that binds the galaxy together', type: 'concept' },
      'WK-SW-02': { id: 'WK-SW-02', concept: 'The Galactic Empire — a totalitarian regime ruling through military dominance and institutional terror', type: 'system' },
      'WK-SW-03': { id: 'WK-SW-03', concept: 'The Rebel Alliance — a decentralized insurgency fighting to restore the Republic', type: 'system' },
      'WK-SW-04': { id: 'WK-SW-04', concept: 'The Death Star — a moon-sized battle station capable of destroying entire planets', type: 'concept' },
      'WK-SW-05': { id: 'WK-SW-05', concept: 'Rule by Fear — the Tarkin Doctrine holds that overwhelming force prevents rebellion more efficiently than governance', type: 'law' },
      'WK-SW-06': { id: 'WK-SW-06', concept: 'The Sith — practitioners of the dark side who rule the Empire from the shadows', type: 'system' },
      'WK-SW-07': { id: 'WK-SW-07', concept: 'Diplomatic immunity as Rebel cover — the Alliance operates through senators and consular ships to mask military operations', type: 'system' },
      'WK-SW-08': { id: 'WK-SW-08', concept: 'Stolen intelligence can topple empires — a single data file carries the hope of the galaxy', type: 'law' },
      'WK-SW-09': { id: 'WK-SW-09', concept: 'Moisture farming — extracting water from desert air through vaporator technology, the subsistence economy of Tatooine', type: 'system' },
      'WK-SW-10': { id: 'WK-SW-10', concept: 'Tatooine exists at the edge of the galaxy, too remote and poor for the Empire to bother controlling directly', type: 'concept' },
      'WK-SW-11': { id: 'WK-SW-11', concept: 'The binary sunset — beauty without meaning, the desert\'s indifferent beauty that mirrors longing for purpose', type: 'concept' },
      'WK-SW-12': { id: 'WK-SW-12', concept: 'The harvest as anchor — agricultural obligation that keeps people rooted to land they want to leave', type: 'tension' },
      'WK-SW-13': { id: 'WK-SW-13', concept: 'Owen\'s protective deception — keeping Luke ignorant of his heritage to keep him safe from the Empire and the Force', type: 'concept' },
      'WK-SW-14': { id: 'WK-SW-14', concept: 'The Imperial Academy — the Empire\'s military training pipeline, ironically the only path off-world for frontier youth', type: 'system' },
      'WK-SW-15': { id: 'WK-SW-15', concept: 'The Rebellion recruits from the margins — frontier youth, disillusioned soldiers, and idealists with nothing left to lose', type: 'law' },
      'WK-SW-16': { id: 'WK-SW-16', concept: 'The Hutt criminal economy — gangsters fill the power vacuum the Empire leaves on worlds too poor to police', type: 'system' },
      'WK-SW-17': { id: 'WK-SW-17', concept: 'Droids as unnoticed agents — sentient machines treated as property pass through the galaxy carrying secrets no one thinks to look for', type: 'tension' },
      'WK-SW-18': { id: 'WK-SW-18', concept: 'The Jawa scavenger economy — nomadic traders who strip and resell technology the desert discards', type: 'system' },
      'WK-SW-19': { id: 'WK-SW-19', concept: 'Holographic communication — compressed light messages that cross the galaxy, carrying pleas across impossible distances', type: 'system' },
      'WK-SW-20': { id: 'WK-SW-20', concept: 'The Jundland Wastes — lawless desert canyon territory where civilization ends and ancient danger begins', type: 'concept' },
      'WK-SW-21': { id: 'WK-SW-21', concept: 'Tusken Raiders — indigenous desert warriors who enforce territorial boundaries through violence', type: 'concept' },
      'WK-SW-22': { id: 'WK-SW-22', concept: 'Jedi in exile — survivors of the purge who hide in plain sight, waiting for a sign that the time has come', type: 'concept' },
      'WK-SW-23': { id: 'WK-SW-23', concept: 'The Force manifests as instinct — a Jedi can scatter predators, sense danger, and move with preternatural calm', type: 'law' },
      'WK-SW-24': { id: 'WK-SW-24', concept: 'The Jedi Order — an ancient monastic order of Force-wielders who served as guardians of peace for a thousand generations', type: 'system' },
      'WK-SW-25': { id: 'WK-SW-25', concept: 'The lightsaber — the weapon of a Jedi Knight, an elegant blade of pure energy from a more civilized age', type: 'concept' },
      'WK-SW-26': { id: 'WK-SW-26', concept: 'The Dark Side — the Force corrupted by fear, anger, and the hunger for power', type: 'concept' },
      'WK-SW-27': { id: 'WK-SW-27', concept: 'The Clone Wars — the galactic conflict that the Sith engineered to destroy the Jedi and birth the Empire', type: 'concept' },
      'WK-SW-28': { id: 'WK-SW-28', concept: 'A Jedi who falls to the dark side becomes something worse than an enemy — a betrayal made flesh', type: 'law' },
      'WK-SW-29': { id: 'WK-SW-29', concept: 'The Jedi preach peace but are warriors — guardians who carry weapons and fight wars in the name of harmony', type: 'tension' },
      'WK-SW-30': { id: 'WK-SW-30', concept: 'The Force awakens through bloodline — it calls to the children of those who wielded it, whether they know their heritage or not', type: 'law' },
      'WK-SW-31': { id: 'WK-SW-31', concept: 'Destiny operates through coincidence — the Force arranges meetings, escapes, and arrivals that feel accidental but are not', type: 'tension' },
      'WK-SW-32': { id: 'WK-SW-32', concept: 'The Empire leaves no witnesses — Imperial operations eliminate civilians to protect operational security without hesitation', type: 'law' },
      'WK-SW-33': { id: 'WK-SW-33', concept: 'The point of no return — the moment when the old life is literally destroyed and the only direction is forward', type: 'concept' },
      // World Build nodes
      'WK-SW-WB-01': { id: 'WK-SW-WB-01', concept: 'The Galactic Republic — the thousand-generation democracy that preceded the Empire, destroyed from within by the Sith', type: 'system' },
      'WK-SW-WB-02': { id: 'WK-SW-WB-02', concept: 'Hyperspace travel — faster-than-light transit through an alternate dimension, the connective tissue that makes galactic civilization possible', type: 'system' },
      'WK-SW-WB-03': { id: 'WK-SW-WB-03', concept: 'The Force traditions — Light Side and Dark Side as competing philosophies of cosmic power, each with its own discipline, temptation, and cost', type: 'concept' },
      'WK-SW-WB-04': { id: 'WK-SW-WB-04', concept: 'The Rule of Two — the Sith doctrine that there shall be only a master and an apprentice, concentrating dark power through betrayal and succession', type: 'law' },
      'WK-SW-WB-05': { id: 'WK-SW-WB-05', concept: 'The Great Jedi Purge — the systematic extermination of the Jedi Order through Order 66, turning the Republic\'s own army against its guardians', type: 'concept' },
      'WK-SW-WB-06': { id: 'WK-SW-WB-06', concept: 'The Imperial Senate — the vestigial democratic body maintained to provide legitimacy, dissolved when the Death Star renders consent unnecessary', type: 'system' },
      'WK-SW-WB-07': { id: 'WK-SW-WB-07', concept: 'Galactic economics — a civilization spanning millions of worlds runs on trade routes, resource extraction, and the credits that flow between them', type: 'system' },
      'WK-SW-WB-08': { id: 'WK-SW-WB-08', concept: 'The prophecy of the Chosen One — a Force-born being destined to bring balance, a promise that haunts every Jedi who remembers it', type: 'tension' },
    },
    edges: [
      // S-SW-001
      { from: 'WK-SW-02', to: 'WK-SW-03', relation: 'seeks to annihilate' },
      { from: 'WK-SW-03', to: 'WK-SW-02', relation: 'fights to overthrow' },
      // S-SW-002
      { from: 'WK-SW-10', to: 'WK-SW-02', relation: 'is beneath the notice of' },
      { from: 'WK-SW-09', to: 'WK-SW-10', relation: 'is the economic backbone of' },
      // S-SW-003
      { from: 'WK-SW-12', to: 'WK-SW-09', relation: 'is the human cost of' },
      // S-SW-004
      { from: 'WK-SW-13', to: 'WK-SW-12', relation: 'weaponizes' },
      { from: 'WK-SW-13', to: 'WK-SW-09', relation: 'uses the farm to keep Luke rooted on' },
      // S-SW-005
      { from: 'WK-SW-15', to: 'WK-SW-03', relation: 'is the lifeblood of' },
      { from: 'WK-SW-15', to: 'WK-SW-10', relation: 'draws its fighters from worlds like' },
      // S-SW-006
      { from: 'WK-SW-17', to: 'WK-SW-03', relation: 'is an unwitting asset of' },
      { from: 'WK-SW-17', to: 'WK-SW-10', relation: 'passes unnoticed through worlds like' },
      // S-SW-007
      { from: 'WK-SW-19', to: 'WK-SW-17', relation: 'is carried unknowingly by' },
      { from: 'WK-SW-19', to: 'WK-SW-07', relation: 'is the communication layer of' },
      // S-SW-008
      { from: 'WK-SW-20', to: 'WK-SW-10', relation: 'is the wild interior of' },
      // S-SW-009
      { from: 'WK-SW-21', to: 'WK-SW-20', relation: 'controls and patrols' },
      { from: 'WK-SW-21', to: 'WK-SW-09', relation: 'exists outside the reach of' },
      // S-SW-010
      { from: 'WK-SW-22', to: 'WK-SW-10', relation: 'hides within the obscurity of' },
      { from: 'WK-SW-22', to: 'WK-SW-02', relation: 'survives by staying invisible to' },
      // S-SW-011
      { from: 'WK-SW-24', to: 'WK-SW-02', relation: 'was destroyed by the rise of' },
      { from: 'WK-SW-26', to: 'WK-SW-24', relation: 'consumed and betrayed' },
      // S-SW-012
      { from: 'WK-SW-30', to: 'WK-SW-13', relation: 'is what Owen fears and tries to prevent through' },
      { from: 'WK-SW-30', to: 'WK-SW-22', relation: 'is the reason for the vigil of' },
      // S-SW-013
      { from: 'WK-SW-31', to: 'WK-SW-01', relation: 'is the invisible hand of' },
      { from: 'WK-SW-31', to: 'WK-SW-30', relation: 'works in concert with' },
      // S-SW-014
      { from: 'WK-SW-32', to: 'WK-SW-02', relation: 'is standard doctrine of' },
      { from: 'WK-SW-33', to: 'WK-SW-12', relation: 'permanently destroys' },
      // World Build edges
      { from: 'WK-SW-WB-01', to: 'WK-SW-02', relation: 'was overthrown and replaced by' },
      { from: 'WK-SW-WB-01', to: 'WK-SW-24', relation: 'was defended for a thousand generations by' },
      { from: 'WK-SW-WB-02', to: 'WK-SW-02', relation: 'enables the galactic reach of' },
      { from: 'WK-SW-WB-02', to: 'WK-SW-10', relation: 'connects even the remote worlds like' },
      { from: 'WK-SW-WB-03', to: 'WK-SW-01', relation: 'is the philosophical framework for understanding' },
      { from: 'WK-SW-WB-03', to: 'WK-SW-26', relation: 'defines the Dark Side within' },
      { from: 'WK-SW-WB-04', to: 'WK-SW-06', relation: 'governs the internal structure of' },
      { from: 'WK-SW-WB-04', to: 'WK-SW-28', relation: 'is the mechanism that produces' },
      { from: 'WK-SW-WB-05', to: 'WK-SW-24', relation: 'destroyed' },
      { from: 'WK-SW-WB-05', to: 'WK-SW-22', relation: 'created the condition of' },
      { from: 'WK-SW-WB-05', to: 'WK-SW-27', relation: 'was the culmination of' },
      { from: 'WK-SW-WB-06', to: 'WK-SW-WB-01', relation: 'is the hollow shell of' },
      { from: 'WK-SW-WB-06', to: 'WK-SW-05', relation: 'was dissolved when it became unnecessary due to' },
      { from: 'WK-SW-WB-07', to: 'WK-SW-09', relation: 'includes subsistence economies like' },
      { from: 'WK-SW-WB-07', to: 'WK-SW-16', relation: 'includes criminal economies like' },
      { from: 'WK-SW-WB-08', to: 'WK-SW-30', relation: 'is the cosmic dimension of' },
      { from: 'WK-SW-WB-08', to: 'WK-SW-29', relation: 'deepens the central paradox of' },
    ],
  },
    worldSummary: 'A long time ago in a galaxy far, far away, the Galactic Empire rules through fear, the Jedi Order lies in ashes, and a Rebellion flickers at the edge of extinction. On the desert planet Tatooine, a farm boy named Luke Skywalker tends moisture vaporators beneath twin suns, unaware that he is the son of the most feared man in the galaxy. The days are long and identical. The harvest is always coming. And Luke is always watching the sky, waiting for a life that refuses to start. Then two droids arrive carrying a stolen message, and the still surface of his world begins to crack.',
  rules: [
    'The Force has a light side and a dark side — no character can use both simultaneously without consequence',
    'Hyperspace travel takes time; ships cannot appear instantly across the galaxy',
    'The Empire controls the galaxy through military force and fear, not popular support',
    'Lightsabers are extremely rare — only Jedi, Sith, and a handful of others wield them',
    'Droids are sentient but treated as property by most of galactic society',
  ],
  controlMode: 'auto',
  imageStyle: 'Cinematic sci-fi concept art, bold chiaroscuro lighting, industrial metallic surfaces, deep space blues and Imperial greys, 1970s retro-futurism meets Ralph McQuarrie production paintings',
  activeForces: { payoff: 0, change: 0, knowledge: 0 },
  coverImageUrl: '/covers/sw.jpg',
  createdAt: Date.now() - 86400000,
  updatedAt: Date.now(),
};
