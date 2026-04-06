![InkTide](public/readme-banner.png)

# InkTide

> Like a chess engine for text.

Structured writing has shape that readers feel but metrics miss. A reveal reframes everything before it. Threads tighten across chapters. A quiet scene holds more weight than the battle it follows. Arguments build through evidence the way narratives build through tension — peaks you remember, valleys that make the peaks matter.

InkTide makes that shape computable. It models text as a **knowledge graph that mutates section by section** — tracking how threads escalate, ideas transform, relationships shift, and worlds deepen. From those mutations, deterministic formulas derive three forces (**Payoff**, **Change**, **Knowledge**) that trace the structure of any long-form text through time. Applied to Harry Potter, the delivery curve peaks at the Sorting Hat, the troll fight, and the Quirrell confrontation — without any human labeling. The same framework applies to academic writing, non-fiction, and any text where structure matters.

Then it uses those forces to **generate** (Markov pacing + prose profiles + MCTS search + planning with course correction) and **revise** (evaluate → reconstruct → converge) until AI-generated text scores in the high 80s against a benchmark where published literature lands 85–95. Prose itself is shaped by **beat plans** — reverse-engineered from published works into 10 types of prose sections and 8 delivery mechanisms, with per-author Markov chains that capture how one beat type follows another.

**[Read the paper →](https://inktide-sourcenovel.vercel.app/paper)** · **[Case analysis →](https://inktide-sourcenovel.vercel.app/case-analysis)** · **[Try it →](https://inktide-sourcenovel.vercel.app/)**

## Setup

```bash
npm install
cp .env.example .env.local   # add your OpenRouter key
npm run dev                   # http://localhost:3001
```

You need an **OpenRouter API key** ([openrouter.ai/keys](https://openrouter.ai/keys)) for LLM access. Optionally add a **Replicate token** for image generation. See `.env.example` for all options.

## How It Works

Every scene produces mutations across three structural layers. Deterministic, z-score normalised formulas compute forces from those mutations — no LLM in the scoring loop:

- **Payoff** — thread phase transitions (dormant → active → escalating → critical → resolved). The moments a story can't take back.
- **Change** — how intensely characters were transformed. Continuity mutations, events, relationship valence shifts.
- **Knowledge** — how much richer the world became. New concepts, systems, laws, and the edges connecting them.
- **Swing** — Euclidean distance between consecutive force snapshots. The story breathing — dynamic vs flat pacing.

Each force is graded 0–25 on an exponential curve (`g(x̃) = 25(1 - e^{-2x̃})`), 100 total. The **narrative cube** maps force combinations into 8 modes (Epoch, Climax, Revelation, Closure, Discovery, Growth, Lore, Rest) used for Markov pacing and MCTS search.

## The Pipeline

### 1. Markov Chain Pacing

Scene-to-scene transitions in published works form empirical Markov chains over the 8 cube modes. We compute transition matrices from analysed corpora — Harry Potter's matrix captures its exploratory rhythm, 1984's captures sustained tension. Before generating an arc, the engine samples a pacing sequence from the active matrix:

```
current_mode = detect(last_scene)
sequence = markov_walk(matrix, current_mode, n_scenes)
# → Growth → Lore → Climax → Rest → Growth
```

Each step becomes a per-scene directive injected into the LLM prompt — specifying which force profile the scene must produce. The LLM decides *what happens*; the Markov chain controls *how intense it is*. `src/lib/pacing-profile.ts`

### 2. Prose Profiles & Beat Plans

Before any prose is written, each scene is decomposed into a **beat plan** — a sequence of typed beats that specify *what happens* and *how it's delivered*. The taxonomy comes from reverse-engineering published fiction: an LLM analyzes existing prose against a fixed vocabulary of **10 beat functions** and **8 mechanisms**, then statistical profiles are built from the extracted plans.

**Beat functions** (what the beat does): breathe, inform, advance, bond, turn, reveal, shift, expand, foreshadow, resolve. **Mechanisms** (how it's delivered): dialogue, thought, action, environment, narration, memory, document, comic.

From ~800 analysed scenes across published works, the system builds per-work **Markov chains** over beat functions — capturing how one type of beat tends to follow another. A thriller's chain differs from literary fiction's. These chains can then guide plan generation: instead of the LLM choosing beat types freely, it follows a sampled sequence from the authorial profile.

Each profile also captures voice (register, stance, rhetorical devices, rules) and density (beats per thousand words, mechanism distribution). Presets are derived from analysed works; the "self" preset computes a live profile from the current story's own plans. `src/lib/beat-profiles.ts`

### 3. MCTS Narrative Search

Monte Carlo Tree Search explores branching narrative paths. Nodes are full knowledge graph states. Edges are generated arcs. The evaluation function is the force grading system — no separate reward model.

```
Selection:    UCB1(n) = Q(n)/N(n) + C√(ln N(parent) / N(n))
Expansion:    generate arc with fresh Markov pacing sequence
Evaluation:   grade(payoff, change, knowledge, swing) → 0-100
Backprop:     propagate score up the tree
```

Each expansion samples a different pacing sequence, so sibling nodes explore structurally different trajectories even from the same state — one gets `Rest → Growth → Epoch`, another gets `Lore → Lore → Climax → Closure`. The search naturally diversifies. `src/lib/mcts-engine.ts`

### 4. Planning with Course Correction

Long-form stories are divided into **phases** (structural chapters with objectives and scene allocations). When a phase activates, the system generates two vectors from the current narrative state:

- **Direction vector** — which threads to push, what the reader should feel, what trajectory to follow
- **Constraint vector** — what must *not* happen yet, protecting later phases from premature resolution

After every arc, a **course correction** pass analyses the story through five lenses — thread tension, character cost, rhythm, freshness, momentum — and rewrites both vectors in place. The next arc generates under guidance that reflects what *actually happened*, not what was originally planned. At phase boundaries, world expansion introduces new entities seeded with knowledge asymmetries. `src/lib/ai/review.ts`

### 5. Iterative Revision

Generation produces a first draft. The revision pipeline improves it without starting over, using versioned branches:

```
evaluate(branch)  → per-scene verdicts: ok | edit | rewrite | cut
reconstruct(eval) → new branch (v2, v3, v4...) with changes applied
```

- **ok** — structurally sound, continuity intact. Kept as-is.
- **edit** — right idea, tighten execution. POV/location/cast locked, summary and mutations adjusted.
- **rewrite** — scene should exist but structure is wrong. Everything rebuilt from scratch.
- **cut** — redundant or near-duplicate. Removed entirely.

Edits and rewrites run in parallel (`PROSE_CONCURRENCY = 10`). World commits pass through at their original timeline positions. The original branch is never modified. Evaluations can be **guided** — paste external feedback from another AI or human editor, and the system incorporates it alongside its own structural analysis. The loop converges in 2–3 passes. `src/lib/ai/review.ts` `src/lib/ai/reconstruct.ts`

### 6. Version Control

InkTide implements two distinct versioning systems that serve different purposes:

**Branch Reconstruction Versioning** — The revision pipeline creates new branch versions (main-v2, main-v3, main-v4) through the review → reconstruct cycle. Each reconstruction pass evaluates the entire branch, applies structural edits across multiple scenes, and produces a new versioned branch. These branch versions represent complete narrative revisions where the system has reevaluated story structure, pacing, and continuity across the full timeline. Reconstruction is destructive iteration — you get a new branch with changes applied, not a document you can incrementally edit.

**Prose & Plan Content Versioning** — Separate from branch reconstruction, individual scenes track prose and plan versions with semantic numbering `v1.2.3`:
- **Generate** (major): `1`, `2`, `3` — fresh generation from plan or scratch
- **Rewrite** (minor): `1.1`, `1.2`, `2.1` — LLM-guided revision with critique
- **Edit** (patch): `1.1.1`, `1.1.2` — manual or incremental tweaks

This is document-style version history. You can edit the original text while keeping all previous versions safe. Resolution functions (`resolveProseForBranch`, `resolvePlanForBranch`) determine which version each branch sees based on lineage, fork timestamps, and optional branch-specific pointers.

**Structural Branching** — Beneath both versioning systems, scenes themselves are structurally immutable (POV, location, participants, mutations fixed). Branches reference shared scenes — only structurally different scenes create new objects. Descendants dynamically resolve their view through parent lineage, enabling git-like cloning with minimal storage. `src/lib/narrative-utils.ts` `src/lib/store.tsx`

### 7. Semantic Search & Embeddings

Every narrative element — propositions, beats, scenes — is embedded as a 1536-dimensional vector using OpenAI's `text-embedding-3-small` model. These embeddings capture **meaning**, not keywords. Searching for "betrayal" surfaces scenes of broken trust even when that word never appears.

```
Query: "character motivations"
  ↓ embed → cosine similarity → rank all content
Result: [Scene 6 Beat 7 · inform · 92% match]
        [Scene 3 Beat 2 · reveal · 87% match]
```

**Continuity validation** becomes tractable. When a scene references "the promise made at the river", semantic search retrieves all prior content close to that concept and verifies it exists. Knowledge asymmetries (what each character knows vs. the reader) can be tracked: if Character A acts on information they shouldn't have, the system surfaces when that information was revealed and who was present.

**Intelligent RAG (Retrieval-Augmented Generation)** grounds the LLM in actual narrative state. When generating a new scene, the system retrieves semantically relevant prior content — not just recent scenes, but thematically connected moments from anywhere in the timeline. This enables callbacks, foreshadowing validation, and thematic coherence.

**Search synthesis** produces Google-style AI overviews over retrieved results. Rather than listing matches, the system identifies patterns, arc relevance, and timeline clusters. Inline citations `[1] [2] [3]` link claims to specific beats. Results persist in app state per narrative — switch stories, search state clears automatically. `src/lib/search.ts` `src/lib/ai/search-synthesis.ts`

The embedding layer turns the knowledge graph into a **semantic space** where narrative distance is measurable. Thread convergence, character arc parallels, thematic echoes — all queryable through cosine similarity rather than explicit graph edges. Future capabilities: plot hole detection (missing causal links), tone drift analysis (semantic clustering), automated continuity checks.

## Tech

Next.js 16 · React 19 · TypeScript · Tailwind v4 · D3.js · OpenRouter (Gemini 2.5/3 Flash) · OpenAI (Embeddings) · Replicate (Seedream 4.5)

## License

MIT — see [LICENSE](LICENSE)
