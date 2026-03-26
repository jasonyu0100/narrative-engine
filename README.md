![Narrative Engine](public/readme-banner.png)

# Narrative Engine

Stories have structure that readers feel but metrics miss. A reveal reframes everything before it. Threads tighten across chapters. A quiet scene holds more weight than the battle it follows. Sentiment analysis sees tone but not architecture. Topic models see frequency but not momentum.

Narrative Engine makes story structure computable. It models narratives as a **knowledge graph that mutates scene by scene** — tracking how threads escalate, characters transform, relationships shift, and worlds deepen. From those mutations, deterministic formulas derive three forces (**Payoff**, **Change**, **Knowledge**) that trace the shape of a story through time. Applied to Harry Potter, the delivery curve peaks at the Sorting Hat, the troll fight, and the Quirrell confrontation — without any human labeling.

Then it uses those forces to **generate** (Markov pacing + MCTS search + planning with course correction) and **revise** (evaluate → reconstruct → converge) until AI-generated narratives score in the high 80s against a benchmark where published literature lands 81–93.

**[Read the paper →](https://narrative-engine-orcin.vercel.app/paper)** · **[Case analysis →](https://narrative-engine-orcin.vercel.app/case-analysis)** · **[Try it →](https://narrative-engine-orcin.vercel.app/)**

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

Each step becomes a per-scene directive injected into the LLM prompt — specifying which force profile the scene must produce. The LLM decides *what happens*; the Markov chain controls *how intense it is*. `src/lib/markov.ts`

### 2. MCTS Narrative Search

Monte Carlo Tree Search explores branching narrative paths. Nodes are full knowledge graph states. Edges are generated arcs. The evaluation function is the force grading system — no separate reward model.

```
Selection:    UCB1(n) = Q(n)/N(n) + C√(ln N(parent) / N(n))
Expansion:    generate arc with fresh Markov pacing sequence
Evaluation:   grade(payoff, change, knowledge, swing) → 0-100
Backprop:     propagate score up the tree
```

Each expansion samples a different pacing sequence, so sibling nodes explore structurally different trajectories even from the same state — one gets `Rest → Growth → Epoch`, another gets `Lore → Lore → Climax → Closure`. The search naturally diversifies. `src/lib/mcts-engine.ts`

### 3. Planning with Course Correction

Long-form stories are divided into **phases** (structural chapters with objectives and scene allocations). When a phase activates, the system generates two vectors from the current narrative state:

- **Direction vector** — which threads to push, what the reader should feel, what trajectory to follow
- **Constraint vector** — what must *not* happen yet, protecting later phases from premature resolution

After every arc, a **course correction** pass analyses the story through five lenses — thread tension, character cost, rhythm, freshness, momentum — and rewrites both vectors in place. The next arc generates under guidance that reflects what *actually happened*, not what was originally planned. At phase boundaries, world expansion introduces new entities seeded with knowledge asymmetries. `src/lib/ai/review.ts`

### 4. Iterative Revision

Generation produces a first draft. The revision pipeline improves it without starting over, using git-like versioned branches:

```
evaluate(branch)  → per-scene verdicts: ok | edit | rewrite | cut
reconstruct(eval) → new branch (v2, v3, v4...) with changes applied
```

- **ok** — structurally sound, continuity intact. Kept as-is.
- **edit** — right idea, tighten execution. POV/location/cast locked, summary and mutations adjusted.
- **rewrite** — scene should exist but structure is wrong. Everything rebuilt from scratch.
- **cut** — redundant or near-duplicate. Removed entirely.

Edits and rewrites run in parallel (`PROSE_CONCURRENCY = 10`). World commits pass through at their original timeline positions. The original branch is never modified. Evaluations can be **guided** — paste external feedback from another AI or human editor, and the system incorporates it alongside its own structural analysis. The loop converges in 2–3 passes. `src/lib/ai/evaluate.ts` `src/lib/ai/reconstruct.ts`

## Tech

Next.js 16 · React 19 · TypeScript · Tailwind v4 · D3.js · OpenRouter (Gemini 2.5/3 Flash) · Replicate (Seedream 4.5)

## License

MIT — see [LICENSE](LICENSE)
