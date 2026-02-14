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
    imagePrompt: 'Stern-faced man in his late thirties with long dark brown hair and solemn grey eyes, short beard, wearing fur-lined leather armor and a heavy grey wool cloak, northern medieval lord with a greatsword at his back',
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
    imagePrompt: 'Strikingly beautiful woman with golden blonde hair worn in elaborate braids, sharp green eyes and high cheekbones, crimson and gold silk gown with lion embroidery, regal and calculating expression, medieval queen',
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
    imagePrompt: 'Dwarfed man with a large head, mismatched green and black eyes, and a mane of pale blonde hair, sharp sardonic features, dressed in rich Lannister crimson doublet with gold trim, intelligent and world-weary expression',
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
    imagePrompt: 'Young woman with silver-white hair and striking violet eyes, delicate features and pale skin, wearing flowing pale blue and cream silks in an eastern style, vulnerable yet regal bearing, Targaryen princess in exile',
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
    imagePrompt: 'Young man with a lean build, dark curly hair and brooding dark grey eyes, clean-shaven with a long solemn face, wearing black leather and fur of the Night\'s Watch, a white direwolf at his side',
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
    imagePrompt: 'Slight, sharp-featured man with a pointed chin and dark hair greying at the temples, a thin mocking smile, wearing a fine dark grey doublet with a silver mockingbird pin, cunning eyes that miss nothing',
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
    imagePrompt: 'Massive, barrel-chested man gone to fat with a thick black beard and blue eyes, flushed ruddy face, wearing a gold crown and black and gold doublet straining at the seams, a once-great warrior in decline',
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
    imagePrompt: 'Small, scrappy girl of nine with a long face, grey eyes, and tangled dark brown hair, wearing a dirt-smudged tunic and breeches instead of a dress, fierce and defiant expression, a thin sword at her hip',
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
    imagePrompt: 'Vast medieval continent seen from above, rolling green hills and dark forests giving way to snow-capped mountains in the north, a patchwork of kingdoms under an overcast sky, epic fantasy landscape',
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
    imagePrompt: 'Sprawling medieval city built on hills above a wide river, crowded timber and stone buildings climbing toward a massive red fortress on the highest hill, hazy golden light and smoke rising from a thousand chimneys',
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
    imagePrompt: 'Imposing castle fortress with walls of dark red stone and tall battlemented towers, iron-spiked gates and narrow windows, a great hall with a throne of fused swords visible through an arched entrance, ominous and powerful',
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
    imagePrompt: 'Ancient northern castle of dark grey granite with thick walls and round towers, steam rising from hot springs within the courtyard, snow dusting the battlements under a pale winter sky, vast and weathered and enduring',
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
    imagePrompt: 'Colossal wall of solid ice stretching from horizon to horizon, seven hundred feet tall and gleaming blue-white, a tiny wooden fortress at its base, frozen wilderness beyond, overwhelming scale under a dark arctic sky',
  },
  'L-GOT-06': {
    id: 'L-GOT-06', name: 'The Narrow Sea', parentId: null, threadIds: ['T-GOT-03'],
    knowledge: {
      nodes: [
        { id: 'LK-GOT-12', type: 'lore', content: 'The body of water separating Westeros from Essos — crossed by traders, exiles, and would-be conquerors alike' },
      ],
      edges: [],
    },
    imagePrompt: 'Wide expanse of deep blue-grey ocean between two continents, choppy waves under a vast sky, merchant galleys and warships dotting the water, moody atmospheric seascape with distant coastlines',
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
    imagePrompt: 'Opulent coastal city with white-washed villas and domed towers in an eastern Mediterranean style, palm trees and terraced gardens overlooking a sun-drenched harbor, warm golden light and exotic luxury',
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
    imagePrompt: 'Long muddy road cutting through rolling countryside and dark forests, stone mile markers and a distant watchtower, overcast sky with shafts of pale light, a sense of vast lonely distance stretching north to south',
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
    name: 'The Warmth of Winterfell',
    sceneIds: ['S-GOT-001', 'S-GOT-002', 'S-GOT-003', 'S-GOT-004', 'S-GOT-005', 'S-GOT-006', 'S-GOT-007'],
    develops: ['T-GOT-02', 'T-GOT-04'],
    locationIds: ['L-GOT-04'],
    activeCharacterIds: ['C-GOT-01', 'C-GOT-05', 'C-GOT-08'],
    initialCharacterLocations: {
      'C-GOT-01': 'L-GOT-04',
      'C-GOT-05': 'L-GOT-04',
      'C-GOT-08': 'L-GOT-04',
    },
  },
  'SC-GOT-02': {
    id: 'SC-GOT-02',
    name: 'The King Rides North',
    sceneIds: ['S-GOT-008', 'S-GOT-009', 'S-GOT-010', 'S-GOT-011', 'S-GOT-012', 'S-GOT-013', 'S-GOT-014'],
    develops: ['T-GOT-02', 'T-GOT-06'],
    locationIds: ['L-GOT-04'],
    activeCharacterIds: ['C-GOT-01', 'C-GOT-02', 'C-GOT-05', 'C-GOT-07', 'C-GOT-08'],
    initialCharacterLocations: {
      'C-GOT-01': 'L-GOT-04',
      'C-GOT-02': 'L-GOT-04',
      'C-GOT-05': 'L-GOT-04',
      'C-GOT-07': 'L-GOT-04',
      'C-GOT-08': 'L-GOT-04',
    },
  },
};

// ── Scenes ───────────────────────────────────────────────────────────────────
const scenes: Record<string, Scene> = {
  // ── Arc 1: The Warmth of Winterfell ─────────────────────────────────────────
  'S-GOT-001': {
    id: 'S-GOT-001',
    kind: 'scene',
    arcId: 'SC-GOT-01',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-08',
    participantIds: ['C-GOT-01', 'C-GOT-05', 'C-GOT-08'],
    events: ['stark_children_practice', 'arya_watches_from_window'],
    threadMutations: [{ threadId: 'T-GOT-02', from: 'dormant', to: 'dormant' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-08', nodeId: 'K-GOT-80', action: 'added', content: 'Swordplay follows patterns — footwork, timing, distance — and she can learn them just by watching' },
      { characterId: 'C-GOT-05', nodeId: 'K-GOT-81', action: 'added', content: 'He fights well enough to match Robb, but the yard still feels like borrowed ground for a bastard' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-08', to: 'C-GOT-05', type: 'Arya watches Jon spar and feels kinship with the brother who also does not quite fit', valenceDelta: 0.1 },
    ],
    summary: 'Winterfell, the practice yard. Morning light falls cold and clean across the muddy ground where Robb and Jon spar with blunted tourney swords, their breath making small ghosts in the air. Bran watches from the fence rail with his lip between his teeth, counting the footwork the way Ser Rodrik taught him. Rickon chases a cat between the legs of the armorers dummy. On the covered bridge above, Arya leans against the stone with her chin on her fists, eyes sharp as a hawks — tracking every parry, every riposte, committing the movements to a memory her septa would rather she filled with needlework and courtesies. Sansa passes behind her and asks why she watches. Arya does not answer. She is too busy learning things no one has offered to teach her.',
  },
  'S-GOT-002': {
    id: 'S-GOT-002',
    kind: 'scene',
    arcId: 'SC-GOT-01',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-01',
    participantIds: ['C-GOT-01', 'C-GOT-08'],
    events: ['feast_in_great_hall', 'firelight_and_laughter'],
    threadMutations: [],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-82', action: 'added', content: 'These evenings of warmth and laughter are what he fights to preserve — the ordinary peace of his family gathered together' },
      { characterId: 'C-GOT-08', nodeId: 'K-GOT-83', action: 'added', content: 'The rules at the high table are suffocating — she would rather eat in the kitchens with the servants than sit still and be proper' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-01', to: 'C-GOT-08', type: 'Ned watches Arya flick peas at Bran and hides a smile — she is so like Lyanna it aches', valenceDelta: 0.1 },
    ],
    summary: 'Winterfell, the Great Hall. A feast without occasion — the kind that happens because the harvest was good, because the evening is long, because the Starks have gathered and that is reason enough. Trestle tables groan beneath salt beef and black bread and honeycakes baked in the kitchens since dawn. Ned sits at the high table with Catelyn at his side, watching his children the way a man watches a fire he has built against the dark. Robb laughs at something Theon says. Sansa sits straight-backed and proper. Arya flicks a pea at Brans ear and pretends innocence when Catelyn turns. The hall smells of woodsmoke and tallow and roasting meat. Outside, the hounds in the kennel set up a howl that rolls across the castle walls and fades into the wolfswood. It is an ordinary evening. It is the last ordinary evening, though no one in the hall knows it yet.',
  },
  'S-GOT-003': {
    id: 'S-GOT-003',
    kind: 'scene',
    arcId: 'SC-GOT-01',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-05',
    participantIds: ['C-GOT-05'],
    events: ['jon_in_godswood', 'solitude_among_old_gods', 'bastard_reflections'],
    threadMutations: [{ threadId: 'T-GOT-04', from: 'dormant', to: 'dormant' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-05', nodeId: 'K-GOT-84', action: 'added', content: 'The godswood is the only place in Winterfell where his name does not follow him — the old gods do not distinguish between trueborn and bastard' },
      { characterId: 'C-GOT-05', nodeId: 'K-GOT-85', action: 'added', content: 'He belongs to Winterfell in every way that matters except the one way that everyone counts' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-05', to: 'C-GOT-01', type: 'Jon loves his father but the silence about his mother feels like a wall between them', valenceDelta: -0.1 },
    ],
    summary: 'Winterfell, the godswood. Jon Snow sits beneath the heart tree with his back against the pale bark, alone in the way he prefers — chosen solitude rather than the other kind. The weirwood stares down at him with its carved face, red sap bleeding from eyes that have watched the Starks for eight thousand years. Jon comes here when the noise of the castle grows too loud — not the physical noise, but the other kind, the noise of belonging to a family that is not quite his. He is Ned Starks son and not Ned Starks son. He has Stark blood and a Stark face and a bastards name that follows him through every hall like a dragging chain. The godswood does not care about names. The old gods have no answers for bastard boys, but their silence is kinder than the questions he carries. A raven lands on the lowest branch and regards him with a black bead eye. Jon regards it back. Neither speaks. It is a kind of understanding.',
  },
  'S-GOT-004': {
    id: 'S-GOT-004',
    kind: 'scene',
    arcId: 'SC-GOT-01',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-08',
    participantIds: ['C-GOT-08'],
    events: ['bran_climbs_walls', 'winterfell_from_above'],
    threadMutations: [],
    knowledgeMutations: [
      { characterId: 'C-GOT-08', nodeId: 'K-GOT-86', action: 'added', content: 'Bran sees the whole world from the rooftops — there are places in Winterfell only he knows, and that is a kind of freedom' },
    ],
    relationshipMutations: [],
    summary: 'Winterfell, the outer walls. Bran climbs. His mother has forbidden it a hundred times; his father twice, which in the arithmetic of childhood means his father does not truly mind. He goes up the First Keep — the oldest tower, abandoned and crumbling, where the stones have worn finger-holds as deep as cups. From the top he can see the wolfswood stretching north like a dark green sea, the kingsroad winding south until it vanishes, the glass gardens glinting in the afternoon light, and the smoke rising from the winter town where smallfolk go about their lives unaware that a boy is watching them from the sky. Winterfell looks different from up here. Smaller and larger at the same time — small enough to hold in his eye, large enough to hold everything he loves. A raven passes close enough to touch. Bran reaches for it and laughs when it wheels away. He is seven years old and the world is a thing to be climbed, not feared.',
  },
  'S-GOT-005': {
    id: 'S-GOT-005',
    kind: 'scene',
    arcId: 'SC-GOT-01',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-01',
    participantIds: ['C-GOT-01'],
    events: ['ned_catelyn_chambers', 'quiet_conversation_family'],
    threadMutations: [],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-87', action: 'added', content: 'The silence about Jon is the one crack in his marriage — Catelyn endures it but has never forgiven it' },
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-88', action: 'added', content: 'The promise he made to Lyanna weighs heavier with every passing year, a secret that poisons even tenderness' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-01', to: 'C-GOT-05', type: 'The unspoken truth about Jons mother is a burden Ned carries alone — love and guilt intertwined', valenceDelta: -0.1 },
    ],
    summary: 'Winterfell, the lords bedchamber. The hot springs beneath the castle push warmth through the walls, and Ned sits on the edge of the bed unlacing his boots while Catelyn brushes out her hair — auburn still, with only a few threads of grey that she plucks when she thinks no one is looking. They speak of small things. Brans climbing, which worries her. Aryas wildness, which worries her differently. Rickons nightmares. Robbs growing resemblance to his Tully grandfather. They do not speak of Jon — they never speak of Jon if they can help it, the one wound in their marriage that will not scar over. Ned watches his wife in the candlelight and feels the weight of secrets he has carried since the war. He loves her. He has never lied to her except in the one way that matters most. The candle gutters. They go to sleep in the warmth of the springs, husband and wife in a castle eight thousand years old, and the silence between them is tender and terrible in equal measure.',
  },
  'S-GOT-006': {
    id: 'S-GOT-006',
    kind: 'scene',
    arcId: 'SC-GOT-01',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-01',
    participantIds: ['C-GOT-01', 'C-GOT-05'],
    events: ['deserter_execution', 'direwolf_pups_found'],
    threadMutations: [{ threadId: 'T-GOT-04', from: 'dormant', to: 'active' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-89', action: 'added', content: 'A dead direwolf with a stag antler in her throat — the sigils of Stark and Baratheon locked in mutual destruction. It cannot be coincidence.' },
      { characterId: 'C-GOT-05', nodeId: 'K-GOT-90', action: 'added', content: 'There were five grey pups for the five trueborn Starks, and one white runt — the bastards wolf, pale and silent like a ghost' },
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-91', action: 'added', content: 'The deserter spoke of dead things walking beyond the Wall — madness, surely, but the old blood remembers' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-01', to: 'C-GOT-05', type: 'Jon spoke up for the pups and found his own among them — Ned sees the boys quiet courage', valenceDelta: 0.1 },
    ],
    summary: 'The holdfast near the wolfswood. A deserter from the Nights Watch is brought before Ned Stark, half-mad and babbling of dead things in the snow, of blue eyes that burn like cold stars. Ned listens, and for a moment something old and deep flickers behind his grey eyes — the blood of the First Men remembering what the rest of the realm has forgotten. Then duty closes over it like ice over water. The man left his brothers. The sentence is death. Ned draws Ice with both hands and takes the mans head himself, because the one who passes the sentence must swing the sword. Bran watches, as Ned insists he must. On the ride home, they find the direwolf — a great she-wolf, dead with a stag antler driven through her throat, and six living pups mewling at her side. Five grey, one white. Jon speaks up: five for the trueborn Stark children, and the white runt for the bastard. Ned looks at the dead wolf and the dead stag and feels a chill that has nothing to do with the weather.',
  },
  'S-GOT-007': {
    id: 'S-GOT-007',
    kind: 'scene',
    arcId: 'SC-GOT-01',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-01',
    participantIds: ['C-GOT-01', 'C-GOT-05', 'C-GOT-08'],
    events: ['pups_in_winterfell', 'children_bond_with_wolves'],
    threadMutations: [],
    knowledgeMutations: [
      { characterId: 'C-GOT-08', nodeId: 'K-GOT-92', action: 'added', content: 'Nymeria is wild and fierce and does not care about being ladylike — the perfect wolf for a girl who feels the same' },
      { characterId: 'C-GOT-05', nodeId: 'K-GOT-93', action: 'added', content: 'Ghost moves without sound and appears from nowhere — a companion for a boy who has learned to go unnoticed' },
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-94', action: 'added', content: 'The direwolves have bonded to his children as if chosen — something ancient and purposeful stirs in Winterfell' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-08', to: 'C-GOT-01', type: 'Father let them keep the wolves — he understands what matters even when mother does not', valenceDelta: 0.1 },
      { from: 'C-GOT-05', to: 'C-GOT-08', type: 'They share the bond of outcasts who found companions that match their natures', valenceDelta: 0.1 },
    ],
    summary: 'Winterfell, the kennels and the yard. Three days since the pups came home, and already the bonds are forming in the wordless way that bonds between wolves and children do. Grey Wind follows Robb like a second shadow. Lady sits at Sansas feet during meals with a politeness that seems almost rehearsed. Nymeria chews through Aryas third pair of boots and Arya loves her more for it. Summer sleeps in Brans bed though he is not supposed to. Shaggydog bites everyone except Rickon and shows no sign of stopping. Ghost trails Jon without sound, appearing and disappearing like smoke, which is fitting for the companion of a boy who has spent his life learning to go unnoticed. Ned stands in the yard watching his children with their wolves and thinks of the old saying: there must always be a Stark in Winterfell. The words have never seemed so literal. The castle feels fuller now, wilder, as though something ancient has come back to a place that was waiting for it.',
  },

  // ── Arc 2: The King Rides North ─────────────────────────────────────────────
  'S-GOT-008': {
    id: 'S-GOT-008',
    kind: 'scene',
    arcId: 'SC-GOT-02',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-01',
    participantIds: ['C-GOT-01'],
    events: ['raven_from_south', 'jon_arryn_dead', 'king_rides_north'],
    threadMutations: [{ threadId: 'T-GOT-02', from: 'dormant', to: 'active' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-95', action: 'added', content: 'Robert will ask him to be Hand — there is no other reason for a king to ride a thousand leagues north' },
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-96', action: 'added', content: 'Jon Arryns death leaves Robert surrounded by Lannisters with no one he trusts to watch his back' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-01', to: 'C-GOT-07', type: 'The weight of obligation stirs — Robert needs him, and Ned cannot refuse a friend in danger', valenceDelta: 0.1 },
    ],
    summary: 'Winterfell, the rookery. A raven comes from the south bearing words that change everything: Jon Arryn, Hand of the King, is dead. The king rides north. Ned reads the message twice, standing alone among the birds, and the paper trembles in his hand — not from fear, but from the weight of knowing what Robert will ask before he asks it. There is only one reason a king rides a thousand leagues through mud and cold. Ned descends to tell Catelyn. She sees it in his face before he speaks: the south is reaching for them. They have spent fifteen years building a life in the quiet of the North, raising children, tending the land, pretending that the wars of their youth were done. The raven says otherwise. Ravens always do.',
  },
  'S-GOT-009': {
    id: 'S-GOT-009',
    kind: 'scene',
    arcId: 'SC-GOT-02',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-01',
    participantIds: ['C-GOT-01', 'C-GOT-07', 'C-GOT-02', 'C-GOT-08'],
    events: ['royal_arrival', 'robert_embraces_ned', 'winterfell_greets_court'],
    threadMutations: [{ threadId: 'T-GOT-06', from: 'dormant', to: 'active' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-97', action: 'added', content: 'Robert has changed — the warrior who won the Trident is buried under fat and wine and years of neglect' },
      { characterId: 'C-GOT-08', nodeId: 'K-GOT-98', action: 'added', content: 'The queen is beautiful and cold and looks at Winterfell like it is something stuck to her shoe' },
      { characterId: 'C-GOT-05', nodeId: 'K-GOT-99', action: 'added', content: 'Bastards stand at the back of the line when kings visit — even in his own home, he is an afterthought' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-01', to: 'C-GOT-07', type: 'The man who embraces him is warm and sincere but visibly diminished — old friend, new worry', valenceDelta: -0.1 },
      { from: 'C-GOT-01', to: 'C-GOT-02', type: 'The queen arrives with Lannister crimson and an expression that suggests she considers the North beneath her', valenceDelta: -0.1 },
    ],
    summary: 'Winterfell, the courtyard. The king comes to Winterfell with the weight of the south behind him — three hundred riders, a gilded wheelhouse, Lannister crimson and Baratheon gold snapping in a wind that does not welcome them. Robert Baratheon dismounts, and the man who climbs down from the saddle bears only a passing resemblance to the one who swung a warhammer at the Trident. He has thickened, reddened, gone to flesh in the way that men do when they stop fighting and start drinking. But when he sees Ned his face breaks open like a boy finding a lost friend, and he crosses the yard in three strides to crush him in an embrace that smells of wine and road dust and something like grief. Behind them, Cersei Lannister descends from the wheelhouse with the careful grace of a woman who knows she is being watched. Arya counts the knights. Sansa stares at the prince. Jon stands at the back of the household line where bastards belong, and says nothing.',
  },
  'S-GOT-010': {
    id: 'S-GOT-010',
    kind: 'scene',
    arcId: 'SC-GOT-02',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-01',
    participantIds: ['C-GOT-01', 'C-GOT-07'],
    events: ['feast_for_the_king', 'robert_drinks_deep', 'old_war_stories'],
    threadMutations: [{ threadId: 'T-GOT-06', from: 'active', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-100', action: 'added', content: 'Robert cannot stop reliving the rebellion — the Trident was the peak of his life and everything since has been decline' },
      { characterId: 'C-GOT-07', nodeId: 'K-GOT-101', action: 'added', content: 'The wine makes the memories bearable and the present tolerable — without it, the crown would crush him' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-07', to: 'C-GOT-02', type: 'Every toast is a small humiliation delivered to the queen — Robert does not notice and would not care if he did', valenceDelta: -0.1 },
      { from: 'C-GOT-01', to: 'C-GOT-07', type: 'Ned sees the ruin beneath the revelry and grieves for the friend Robert used to be', valenceDelta: -0.1 },
    ],
    summary: 'Winterfell, the Great Hall. A welcoming feast that groans under the effort of its own hospitality. Robert drinks with the abandon of a man who has confused oblivion with happiness, calling for more wine before the first cup is dry, laughing too loudly at his own stories of the rebellion — the Battle of the Bells, the Trident, the way Rhaegar Targaryens rubies scattered in the river. Ned smiles and drinks less. He watches his old friend and sees the ruin underneath the revelry: a king who cannot stop reliving his one great moment because everything after it has been a slow diminishment. Cersei sits beside Robert with a face like carved marble, enduring every bawdy joke, every bellowed toast, every casual humiliation with a patience that is not patience at all but something colder. The music plays. The candles burn. Two old friends pretend that time has been kind, and a queen pretends that she is not counting the hours until she can stop pretending.',
  },
  'S-GOT-011': {
    id: 'S-GOT-011',
    kind: 'scene',
    arcId: 'SC-GOT-02',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-01',
    participantIds: ['C-GOT-01', 'C-GOT-07'],
    events: ['crypts_visit', 'lyanna_statue', 'robert_asks_ned_hand'],
    threadMutations: [{ threadId: 'T-GOT-02', from: 'active', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-102', action: 'added', content: 'Robert asks him to be Hand of the King — a plea disguised as an appointment, born of desperation not ceremony' },
      { characterId: 'C-GOT-07', nodeId: 'K-GOT-103', action: 'added', content: 'He still loves Lyanna more than anything in the living world — the dead have a hold on him the living cannot break' },
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-104', action: 'added', content: 'Robert standing before Lyannas tomb is a man worshipping at a shrine — his grief has calcified into something permanent' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-07', to: 'C-GOT-01', type: 'Robert begs Ned to come south — naked need breaking through the bluster of kingship', valenceDelta: 0.2 },
    ],
    summary: 'Winterfell, the crypts. Robert insists on going down to see her — he always does, as though Lyanna Starks tomb is a shrine and he is the last faithful pilgrim. They descend with torches into the cold dark, past rows of granite kings with iron swords rusting across their laps, past centuries of Starks who stare eyeless from their alcoves. Robert stops before Lyannas statue and his whole body changes — the bluster drains out of him and what remains is a man still in love with a ghost. He lays a feather in her stone hand. Then he turns to Ned and says the words: I need you, Ned. Down in Kings Landing. They are killing me, the lot of them, and I need someone I can trust. Come south. Be my Hand. The torchlight throws their shadows huge against the wall — two men standing among the dead, one asking the other to join a court that devours good men like kindling.',
  },
  'S-GOT-012': {
    id: 'S-GOT-012',
    kind: 'scene',
    arcId: 'SC-GOT-02',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-05',
    participantIds: ['C-GOT-01', 'C-GOT-05'],
    events: ['jon_excluded_from_feast', 'benjen_speaks_of_wall', 'bastards_burden'],
    threadMutations: [{ threadId: 'T-GOT-04', from: 'active', to: 'escalating' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-05', nodeId: 'K-GOT-105', action: 'added', content: 'Catelyn will never accept him — she made certain he was seated outside when the king came, as though his very existence is an insult' },
      { characterId: 'C-GOT-05', nodeId: 'K-GOT-106', action: 'added', content: 'Uncle Benjen warns him he does not know what he would give up by taking the black — but what is there to give up when you belong nowhere?' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-05', to: 'C-GOT-01', type: 'His father lets Catelyn exile him from the feast — love has limits, and Jon has found them', valenceDelta: -0.2 },
    ],
    summary: 'Winterfell, outside the Great Hall. The second night of feasting, and Jon Snow sits on the steps in the cold because Catelyn deemed it an insult to seat a bastard beside the royal family. Inside, warmth and music and the life he was born adjacent to but never inside of. Ghost lies across his boots, red eyes half-closed. Benjen Stark finds his nephew in the dark, smelling of frost and the Wall. They talk — or rather, Jon talks and Benjen listens with the careful attention of a man who recognizes a wound he once carried himself. Jon says he wants to take the black. Benjen does not refuse him, but he does not encourage him either. You do not know what you would be giving up, he says. You are a boy still. Jon bristles, because boys always bristle when told they are boys. The music from the hall spills through the cracked door like light from a room he cannot enter. Ghost licks Jons hand. The night is cold, and getting colder.',
  },
  'S-GOT-013': {
    id: 'S-GOT-013',
    kind: 'scene',
    arcId: 'SC-GOT-02',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-01',
    participantIds: ['C-GOT-01', 'C-GOT-02'],
    events: ['catelyn_letter_from_lysa', 'lannisters_murdered_arryn', 'seeds_of_suspicion'],
    threadMutations: [
      { threadId: 'T-GOT-01', from: 'dormant', to: 'active' },
      { threadId: 'T-GOT-05', from: 'dormant', to: 'active' },
    ],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-08', action: 'added', content: 'Lysa Arryn claims the Lannisters murdered Jon Arryn — the queen and her family cannot be trusted' },
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-107', action: 'added', content: 'If the Lannisters killed one Hand, they will kill another — going south is walking into a trap with his eyes open' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-01', to: 'C-GOT-02', type: 'Lysa Arryns accusation casts the queen in a new and dangerous light — what are the Lannisters hiding?', valenceDelta: -0.1 },
      { from: 'C-GOT-01', to: 'C-GOT-07', type: 'Robert is surrounded by enemies he cannot see — duty demands Ned protect his friend', valenceDelta: 0.1 },
    ],
    summary: 'Winterfell, the lords bedchamber, deep in the night. Catelyn wakes Ned with a letter that has come by secret rider, not by raven — her sister Lysas hand, written in the cipher they shared as girls in Riverrun. The message is brief and it is a blade: the Lannisters murdered Jon Arryn. Lysa is certain. Ned reads the words by candlelight and the room seems to shrink around him. If this is true, then Robert sits the Iron Throne with killers at his side, and the invitation to serve as Hand is not an honor but a death sentence wearing a golden badge. Catelyn grips his arm and tells him he must go — not despite the danger but because of it. If the Lannisters killed one Hand, they will not stop at one. Someone must protect Robert. Someone must uncover the truth. Ned stares at the candle flame and sees the shape of a duty he cannot refuse and may not survive.',
  },
  'S-GOT-014': {
    id: 'S-GOT-014',
    kind: 'scene',
    arcId: 'SC-GOT-02',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-01',
    participantIds: ['C-GOT-01', 'C-GOT-05', 'C-GOT-08'],
    events: ['bran_falls', 'pushed_from_tower', 'winterfell_shattered'],
    threadMutations: [
      { threadId: 'T-GOT-02', from: 'active', to: 'escalating' },
      { threadId: 'T-GOT-01', from: 'active', to: 'escalating' },
    ],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-108', action: 'added', content: 'Bran was climbing as he always does — but something about the fall feels wrong, deliberate, silenced' },
      { characterId: 'C-GOT-08', nodeId: 'K-GOT-109', action: 'added', content: 'Bran never falls — he is the best climber in Winterfell. Something terrible happened in that tower.' },
      { characterId: 'C-GOT-05', nodeId: 'K-GOT-110', action: 'added', content: 'The court leaves the same day Bran falls — as if their presence and his ruin are connected' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-01', to: 'C-GOT-02', type: 'Bran falls from a tower the day the Lannisters are in Winterfell — suspicion crystallizes into something colder', valenceDelta: -0.2 },
      { from: 'C-GOT-08', to: 'C-GOT-01', type: 'Father rides south with grief on his face and Arya is terrified — the world is no longer safe', valenceDelta: 0.1 },
    ],
    summary: 'Winterfell, the broken tower. A scream, and then silence, and then the world cracks. Bran is found at the base of the old tower, crumpled on the frozen ground like a doll thrown from a window. His legs are wrong — bent at angles that make the stableboys retch. He is alive, barely, his breath a thin rattle in the cold air. Catelyn reaches him first and the sound she makes is not a scream but something lower and worse. Ned is not far behind. He kneels in the frost beside his son and touches the boys face with hands that have held swords and signed treaties and never once trembled as they tremble now. No one saw what happened. Bran was climbing, they say — he was always climbing. But Ned looks up at the tower window and something in his gut goes quiet and cold. The court leaves within the day. Robert clasps Neds shoulder and says he is sorry about the boy, and he means it, in the careless sincere way that Robert means everything. Ned rides south with his daughters and a new heaviness in his chest. Behind him, Bran lies in a bed he may never leave, dreaming of falling, and Winterfell is no longer the safe place it was a morning ago.',
  },
};

// ── Commits ──────────────────────────────────────────────────────────────────
const diffNames: Record<string, string> = {
  'S-GOT-001': 'yard_practice',
  'S-GOT-002': 'feast_without_occasion',
  'S-GOT-003': 'godswood_solitude',
  'S-GOT-004': 'bran_climbs',
  'S-GOT-005': 'ned_catelyn_night',
  'S-GOT-006': 'deserter_and_pups',
  'S-GOT-007': 'wolves_settle_in',
  'S-GOT-008': 'raven_from_south',
  'S-GOT-009': 'king_arrives_winterfell',
  'S-GOT-010': 'feast_for_the_king',
  'S-GOT-011': 'crypts_and_crown',
  'S-GOT-012': 'bastard_in_the_cold',
  'S-GOT-013': 'lysas_letter',
  'S-GOT-014': 'bran_falls',
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
  createdAt: Date.now() - (14 - i) * 3600000,
}));

// ── Alternate Branch: "What If the Direwolf Was Never Found" ─────────────────
// Diverges after S-GOT-005 — Ned and the boys take a different road home
// from the execution and never find the dead direwolf or her pups.

const altArc: Arc = {
  id: 'SC-GOT-01-ALT',
  name: 'A Yard Without Wolves',
  sceneIds: ['S-GOT-ALT-006', 'S-GOT-ALT-007', 'S-GOT-ALT-008'],
  develops: ['T-GOT-02', 'T-GOT-04'],
  locationIds: ['L-GOT-04'],
  activeCharacterIds: ['C-GOT-01', 'C-GOT-05', 'C-GOT-08'],
  initialCharacterLocations: {
    'C-GOT-01': 'L-GOT-04',
    'C-GOT-05': 'L-GOT-04',
    'C-GOT-08': 'L-GOT-04',
  },
};

const altScenes: Record<string, Scene> = {
  'S-GOT-ALT-006': {
    id: 'S-GOT-ALT-006',
    kind: 'scene',
    arcId: 'SC-GOT-01-ALT',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-01',
    participantIds: ['C-GOT-01', 'C-GOT-05'],
    events: ['deserter_executed', 'different_road_home', 'no_wolves_found'],
    threadMutations: [{ threadId: 'T-GOT-04', from: 'dormant', to: 'active' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-111', action: 'added', content: 'The man who passes the sentence must swing the sword — duty is not a principle but a practice, taught through repetition' },
      { characterId: 'C-GOT-05', nodeId: 'K-GOT-112', action: 'added', content: 'The deserter died babbling of monsters — madness or truth, the Wall takes men either way' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-05', to: 'C-GOT-01', type: 'Watching father execute a man with Ice is seeing duty at its most absolute — Jon respects and fears it', valenceDelta: 0.1 },
    ],
    summary: 'The holdfast near the wolfswood. The execution proceeds as it must — a deserter dies, a lesson is taught, and Bran watches because a Stark must witness the cost of the law his family upholds. But on the ride home, Ned takes the eastern track along the Tumbledowns rather than the bridge road. There is no dead direwolf, no stag antler, no litter of pups mewling in the cold. The party rides back to Winterfell in the grey afternoon light, speaking of small things. Jon rides beside his father and asks nothing of mothers or belonging. Bran is quiet, turning the memory of the sword over and over in his young mind. The moment passes. The wolves that might have been remain in the snow, unfound, and Winterfell stays as it has always been — a castle of stone and duty, without the wild old magic that six direwolf pups would have carried back through its gates.',
  },
  'S-GOT-ALT-007': {
    id: 'S-GOT-ALT-007',
    kind: 'scene',
    arcId: 'SC-GOT-01-ALT',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-05',
    participantIds: ['C-GOT-05', 'C-GOT-08'],
    events: ['children_without_wolves', 'ordinary_evening', 'something_missing'],
    threadMutations: [],
    knowledgeMutations: [
      { characterId: 'C-GOT-05', nodeId: 'K-GOT-113', action: 'added', content: 'There is an absence he cannot name — something that should have found him and did not, a hollow where a companion should be' },
      { characterId: 'C-GOT-08', nodeId: 'K-GOT-114', action: 'added', content: 'The evening is the same as every other — practice, stones, supper — and the sameness feels like a cage' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-05', to: 'C-GOT-08', type: 'Jon and Arya share the restless sense that something is missing from Winterfell — a wildness that never arrived', valenceDelta: 0.1 },
    ],
    summary: 'Winterfell, the yard and the kennels. Evening settles over the castle like a held breath. The Stark children go about their routines — Robb spars with Theon, Sansa practices her stitching, Arya skulks near the armory hoping to steal a glance at the swords. But there is no grey shadow at Robbs heel, no white ghost trailing Jon through the godswood, no wolf pup chewing Aryas boots to ruin. The kennelmaster tends the hounds and the hounds tend themselves. Jon sits on the well wall and watches the sky darken, feeling an absence he cannot name — something that should have come to him and did not, a companion shaped like silence. Arya throws stones at a fence post and hits it every time. Neither of them knows what they are missing. The castle is the same as it has always been. That is precisely the problem.',
  },
  'S-GOT-ALT-008': {
    id: 'S-GOT-ALT-008',
    kind: 'scene',
    arcId: 'SC-GOT-01-ALT',
    locationId: 'L-GOT-04',
    povId: 'C-GOT-01',
    participantIds: ['C-GOT-01'],
    events: ['ned_in_godswood', 'no_omen', 'unease_without_cause'],
    threadMutations: [{ threadId: 'T-GOT-02', from: 'dormant', to: 'active' }],
    knowledgeMutations: [
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-115', action: 'added', content: 'Jon Arryns death was no accident — the silence from the south is heavy with unspoken threat' },
      { characterId: 'C-GOT-01', nodeId: 'K-GOT-116', action: 'added', content: 'Without an omen to guide him, the unease is formless — instinct without evidence, dread without direction' },
    ],
    relationshipMutations: [
      { from: 'C-GOT-01', to: 'C-GOT-07', type: 'Robert will come north and ask for help — Ned feels the weight of that obligation pressing before it arrives', valenceDelta: 0.1 },
    ],
    summary: 'Winterfell, the godswood. Ned goes to the heart tree as he does when the weight of lordship presses too close. He cleans Ice with an oiled cloth and thinks of Jon Arryns death, of the raven that will surely come, of the king who will surely follow. The weirwood watches him with its red eyes and says nothing, as weirwoods do. In the other timeline, a dead direwolf with a stag antler in her throat would have told him everything he needed to know — Stark and Baratheon, entangled unto death. But that omen never came. There is only the wind in the leaves and the sound of the hot springs and a formless unease that Ned cannot name. He sheathes Ice and walks back to the castle. The old gods sent no warning. Whether that is mercy or cruelty, only the turning of the story will tell.',
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
  'B-GOT-NOWOLVES': {
    id: 'B-GOT-NOWOLVES',
    name: 'What If the Direwolf Was Never Found',
    parentBranchId: 'B-GOT-MAIN',
    forkEntryId: 'S-GOT-005',
    entryIds: Object.keys(altScenes),
    createdAt: Date.now() - 43200000,
  },
};

// ── Assembled Narrative ──────────────────────────────────────────────────────
export const seedGOT: NarrativeState = {
  id: 'N-GOT',
  title: 'A Game of Thrones — The Wolves of Winterfell',
  description: 'Winterfell has stood for eight thousand years, and the Starks have ruled from it for every one of them. Eddard Stark tends his lands and raises his children in the long summer, keeping the old ways alive in a world that has half forgotten them. But a death in the capital sends a raven north, and behind the raven rides a king. Robert Baratheon brings the south to Winterfell — its politics, its secrets, its Lannisters — and asks of Ned the one thing he cannot refuse. Meanwhile a dead direwolf and six living pups herald something older and stranger than any game of thrones. Winter is coming. It always is.',
  characters,
  locations,
  threads,
  arcs: allArcs,
  scenes: allScenes,
  worldBuilds: allWorldBuilds,
  branches,
  commits,
  relationships,
  worldSummary: 'The Seven Kingdoms of Westeros are held together by the Iron Throne — a seat forged from the swords of the conquered, uncomfortable by design, a reminder that a king should never sit easy. Robert Baratheon won the throne by rebellion and has spent fifteen years failing to deserve it. The great houses circle each other like wolves: Stark in the frozen North, Lannister in the golden West, Baratheon on the throne, Targaryen in exile across the sea. Summer has lasted nine years. Winter is coming — the Stark words are not a boast but a warning. In Winterfell, the Starks live as they have for millennia — by duty, by honor, by the old gods and the old ways. But the south is stirring, and when the south stirs, the north bleeds.',
  rules: [
    'No character has plot armor — anyone can die if the narrative demands it',
    'Magic is rare, feared, and poorly understood in Westeros — it is not a common tool',
    'Political power comes from alliances, marriages, gold, and armies — not from being righteous',
    'The Starks follow honor even when it costs them; the Lannisters follow pragmatism even when it corrupts them',
    'Winter is a literal season lasting years, not a metaphor — its arrival changes everything',
    'Dragons are extinct at the start of the story — Daenerys has only petrified eggs',
  ],
  controlMode: 'auto',
  imageStyle: 'Dark medieval fantasy, gritty photorealism, muted earth tones and firelight, rain-slicked stone and forged steel, HBO-inspired cinematic drama with desaturated palette',
  activeForces: { payoff: 0, change: 0, variety: 0 },
  coverImageUrl: '/covers/got.jpg',
  createdAt: Date.now() - 86400000,
  updatedAt: Date.now(),
};
