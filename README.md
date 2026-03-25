# Narrative Engine

A knowledge-graph-based narrative analysis and generation platform that measures what stories do to readers — computing **payoff**, **change**, and **knowledge** forces from structural mutations scene by scene.

## How It Works

Every narrative is a **knowledge graph** — characters, locations, threads, and world concepts — that mutates scene by scene. An LLM records structural mutations at each scene, then deterministic formulas compute **narrative forces** from those mutations. The LLM handles comprehension; the math handles measurement.

### Scene Mutations

Every scene records three types of structural mutations to the knowledge graph:

- **Thread mutations** — narrative tensions (a rivalry, a secret, a quest) move through lifecycle phases: `dormant → active → escalating → critical → resolved/subverted/abandoned`. Each transition is recorded as `{threadId, from, to}`.
- **Continuity mutations** — what characters learn, lose, or become. Each mutation adds a knowledge node to a character's graph: `{characterId, nodeId, content, nodeType}`. Events are tagged separately.
- **Relationship mutations** — how connections between characters shift: `{from, to, type, valenceDelta}`. Valence intensity feeds the Change force — a betrayal weighs more than a polite exchange.
- **World knowledge mutations** — the world's rules, systems, and concepts as a graph of nodes and typed edges. Nodes are ideas (`{id, concept, type}`); edges link them (`{from, to, relation}`).

### Three Forces

Each force is computed directly from one mutation type:

| Force | Driven by | Formula |
|-------|-----------|---------|
| **Payoff** | Thread mutations — phase transitions weighted by jump distance | `P = Σ max(0, φ_to - φ_from)` |
| **Change** | Continuity mutations + events + relationship valence intensity | `C = √M_c + √\|E\| + √Σ\|Δv\|` |
| **Knowledge** | World knowledge mutations — new nodes and edges in the world graph | `K = ΔN + √ΔE` |

Forces are z-score normalised (mean=0, units=standard deviations) and compose into:
- **Tension** — `C + K - P` — buildup without release
- **Delivery** — `0.5P + 0.5·tanh(C/2) + 0.5·tanh(K/2) + 0.3·contrast` — the dopamine hit
- **Swing** — Euclidean distance between consecutive force snapshots — the story breathing

### The Narrative Cube

Forces map into a 3D cube with 8 modes — every scene occupies one corner:

**Payoff modes:** Epoch (P↑C↑K↑), Climax (P↑C↑K↓), Revelation (P↑C↓K↑), Closure (P↑C↓K↓)
**Buildup modes:** Discovery (P↓C↑K↑), Growth (P↓C↑K↓), Lore (P↓C↓K↑), Rest (P↓C↓K↓)

### Markov Chain Pacing

Scene-to-scene transitions form an empirical Markov chain. Transition matrices computed from published works capture each work's pacing fingerprint — Harry Potter breathes differently from 1984. Before generating an arc, the engine samples a pacing sequence from the matrix, producing assignments like `Growth → Lore → Climax → Rest → Growth`. Each scene gets specific mutation guidance so the computed forces land at the intended cube position.

**Pacing presets** offer curated sequences for common arc shapes: Classic Arc, Slow Burn, Pressure Cooker, Roller Coaster, and more.

## Features

- **Markov Chain Pacing** — transition matrices from published works shape generation rhythm
- **Pacing Presets** — curated cube position sequences for targeted arcs (3, 5, or 8 scenes)
- **MCTS Narrative Search** — Monte Carlo Tree Search explores narrative branches, optimising force trajectories
- **Slides** — interactive walkthrough of a series' peaks, valleys, and force decomposition
- **Analysis Engine** — paste any text (up to 500K words) and extract the knowledge graph, forces, and delivery curve
- **Scene Generation** — full pipeline: scene structure → beat-by-beat plan → prose → grading → rewriting
- **World Building** — arc-based expansion of characters, locations, and threads
- **Branching Timelines** — git-like branches for alternate storylines
- **Auto-Generation** — automated story generation with configurable constraints
- **Force Charts** — stock-type time-series of payoff, change, knowledge, delivery, and swing
- **Grading** — exponential curve calibrated against published literature (HP, Gatsby, Crime and Punishment, Coiling Dragon)
- **Classification** — archetype detection (Masterwork, Epic, Chronicle, Saga, etc.) and narrative shape classification
- **EPUB Export** — export as a publishable ebook

## Getting Started

### Prerequisites

- Node.js 18+
- An [OpenRouter](https://openrouter.ai/) API key

### Setup

```bash
npm install
```

Create a `.env.local` file:

```
OPENROUTER_API_KEY=your_key_here
REPLICATE_API_TOKEN=your_token_here   # Optional, for image generation
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to start analysing and generating narratives.

### Production

```bash
npm run build
npm start
```

## Tech Stack

- **Framework:** [Next.js](https://nextjs.org) 16 (App Router)
- **UI:** React 19, [Tailwind CSS](https://tailwindcss.com) v4
- **Visualisation:** [D3.js](https://d3js.org) (force-directed graphs, charts, cube trajectories)
- **AI:** [OpenRouter](https://openrouter.ai/) API (Gemini 2.5/3 Flash models, streaming)
- **Images:** [Replicate](https://replicate.com/) API (cover & scene art)
- **Language:** TypeScript

## Project Structure

```
src/
├── app/                    # Next.js routes & API endpoints
│   ├── series/[id]/        # Main story editor workspace
│   ├── paper/              # Whitepaper — theory, formulas, validation
│   ├── analysis/           # Text-to-narrative extraction pipeline
│   └── api/                # LLM, image, and idea generation endpoints
├── components/             # React UI (organized by feature area)
│   ├── canvas/             # WorldGraph — interactive knowledge graph
│   ├── timeline/           # TimelineStrip, ForceCharts, NarrativeCubeViewer
│   ├── slides/             # SlidesPlayer — series walkthrough presentation
│   ├── mcts/               # MCTSPanel — narrative force optimisation
│   ├── analytics/          # ForceTracker — stock-type force metrics
│   ├── generation/         # GeneratePanel, PacingStrip, MarkovGraph — scene generation with pacing
│   ├── topbar/             # CubeExplorer, FormulaModal
│   ├── story/              # StoryReader — prose reading/grading/rewriting
│   └── ...
├── lib/
│   ├── ai/                 # LLM calls (modularised: api, context, scenes, prose, world, prompts, json)
│   ├── narrative-utils.ts  # Force calculation formulas, cube logic, delivery curve, grading
│   ├── markov.ts           # Markov chain pacing — transition matrices, presets, sequence prompts
│   ├── text-analysis.ts    # Corpus → knowledge graph extraction (window-function chunking)
│   ├── mcts-engine.ts      # MCTS — optimises narrative force trajectories
│   ├── auto-engine.ts      # Automated generation loop
│   └── ...
├── types/
│   ├── narrative.ts        # Domain types: Scene, Character, Thread, Arc, CubeCorner, etc.
│   └── mcts.ts             # MCTS-specific types
├── public/works/           # Analysed reference works (HP, Gatsby, 1984, etc.) — JSON knowledge graphs
└── data/                   # Seed narratives
```

## License

Private
