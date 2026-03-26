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

## Generation & Revision

**Markov Chain Pacing** — Transition matrices from published works shape scene-by-scene rhythm. Before generating, sample a mode sequence and inject as per-scene direction. `src/lib/markov.ts`

**MCTS Search** — Monte Carlo Tree Search over narrative branches. Each expansion gets a fresh Markov pacing sequence. UCB1 balances exploitation vs exploration. `src/lib/mcts-engine.ts`

**Planning with Course Correction** — Direction and constraint vectors steer scene generation. After every arc, vectors are rewritten based on what actually happened. `src/lib/ai/review.ts`

**Iterative Revision** — Evaluate branches by scene summaries → per-scene verdicts (ok / edit / rewrite / cut) → reconstruct into versioned branches. Converges in 2–3 passes. Supports external guidance. `src/lib/ai/evaluate.ts`

## Tech

Next.js 16 · React 19 · TypeScript · Tailwind v4 · D3.js · OpenRouter (Gemini 2.5/3 Flash) · Replicate (Seedream 4.5)

## License

MIT — see [LICENSE](LICENSE)
