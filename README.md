![InkTide](public/readme-banner.png)

# InkTide

**Narrative is a composition of three forces in flux.**

Every story is drive, world, and system — threads accumulating commitment toward resolution, entities transforming under pressure, rules deepening beneath the surface. InkTide makes these forces measurable. Paste any long-form text and it builds a living knowledge graph that evolves section by section, deriving the structural forces that shape the work. A Classic is drive-dominant. A Show is world-dominant. A Paper is system-dominant. An Opus balances all three.

Everything becomes searchable by meaning. Every proposition is embedded as a vector. Search for "sacrifice" and surface every moment of selfless choice across the timeline, even when the word never appears. Each analyzed work contributes its pacing fingerprint to a growing network of structural intelligence.

The same forces power generation — new content shaped by the rhythms of published works, branching paths explored via MCTS, and drafts refined through structural evaluation.

**[Read the paper →](https://inktide-sourcenovel.vercel.app/paper)** · **[Case analysis →](https://inktide-sourcenovel.vercel.app/case-analysis)** · **[Try it →](https://inktide-sourcenovel.vercel.app/)**

---

## Quick Start

```bash
git clone https://github.com/jasonyu0100/inktide.git
cd inktide
npm install
cp .env.example .env.local   # add your OpenRouter key
npm run dev                   # → http://localhost:3001
```

You need an **[OpenRouter API key](https://openrouter.ai/keys)** for LLM access. Optionally add a **Replicate token** for image generation. See `.env.example` for all options.

---

## What It Does

### Analyze

Three forces, all z-score normalised, derived from knowledge graph mutations — pure math, no LLM:

| Force | What it measures |
|-------|-----------------|
| **Drive** | Thread resolution — how narrative tensions compete for bandwidth, accumulate structural commitment, and resolve. The unifying force that pulls world and system toward resolution. |
| **World** | Entity transformation — what we learn about characters, locations, and artifacts as drive pulls them through the story. |
| **System** | World deepening — the rules, structures, and concepts that form the substrate on which drive and world operate. |

Each force is graded 0–25, 100 total. The **narrative cube** maps force combinations into 8 modes — a vocabulary for how stories move through drive/world/system space.

Additional layers: **swing** (the rhythm of contrast between sections), **pacing profiles** (Markov transition matrices capturing an author's structural signature), and **scale & density** (how richly interconnected the world becomes).

### Query

Every proposition, beat, and scene is embedded as a 1536-dimensional vector. Cosine similarity retrieves content by meaning, not keywords. AI-synthesized overviews trace thematic patterns across the full timeline with inline citations.

Applications: continuity validation (verifying that referenced events actually occurred), tracking what each character knows at any point in the story, and semantic retrieval that gives generation rich context from anywhere in the timeline.

### Generate

| Capability | How it works |
|-----------|-------------|
| **Markov pacing** | Learn the rhythm of any published work and write in its structural signature |
| **Prose profiles** | Beat plans shaped by authorial Markov chains — 10 functions, 8 mechanisms |
| **MCTS search** | Explore branching narrative paths, each guided by a fresh pacing sequence |
| **Course correction** | Direction adapts after each arc based on what the story actually became |
| **Iterative revision** | Evaluate → verdict (ok / edit / merge / insert / cut) → reconstruct into refined drafts |
| **Pacing presets** | Curated arcs (Sucker Punch, Slow Burn, Roller Coaster) for targeted narrative shapes |

---

## Architecture

```
Next.js 16 · React 19 · TypeScript · Tailwind v4 · D3.js
OpenRouter (Gemini 2.5/3 Flash) · OpenAI Embeddings · Replicate (Seedream 4.5)
IndexedDB + localStorage — fully client-side persistence, no backend database
```

All LLM calls route through OpenRouter. Embeddings use OpenAI's `text-embedding-3-small` (1536 dimensions). Image generation uses Replicate's Seedream 4.5. State is managed via React Context + useReducer with IndexedDB persistence.

See the **[paper](https://inktide-sourcenovel.vercel.app/paper)** for the full theory — force formulas, Markov chain pacing, MCTS evaluation, beat taxonomy, and validation against published works.

---

## License

MIT — see [LICENSE](LICENSE)
