# Narrative Engine

A knowledge-graph-based narrative analysis and generation platform. Computes **payoff**, **change**, and **knowledge** forces from structural mutations scene by scene — then uses those forces to grade, search, and generate stories.

## Quick Start

```bash
npm install
```

Create `.env.local`:

```env
OPENROUTER_API_KEY=sk-or-...    # Required — get one at https://openrouter.ai/keys
REPLICATE_API_TOKEN=r8_...      # Optional — enables cover art and scene image generation
```

**OpenRouter** provides access to LLMs (Gemini, GPT, Claude, Llama, etc.) through a single API key. You pay only for tokens used at the provider's rates — no subscription.

**Replicate** powers image generation via Flux models. Without it, everything works — you just won't get generated artwork.

```bash
npm run dev          # http://localhost:3000
npm run build        # Production build
npm run lint         # ESLint
```

## How It Works

Every narrative is a **knowledge graph** that mutates scene by scene. An LLM extracts structural mutations from each scene, then deterministic formulas — no LLM in the scoring loop — compute forces from those mutations.

### Scene Mutations

| Mutation | What it tracks | Example |
|----------|---------------|---------|
| **Thread** | Narrative tensions moving through lifecycle phases | A rivalry escalates from `active` to `critical` |
| **Continuity** | What characters learn, lose, or become | Harry discovers he's a wizard |
| **Relationship** | How connections shift (valence ±0.1 to ±0.5) | A betrayal (Δv = -0.5) vs a polite exchange (Δv = +0.1) |
| **World knowledge** | Laws, systems, concepts as a graph of nodes + edges | "Wands choose the wizard" — a new world rule |
| **Events** | Concrete happenings tagged per scene | `troll_fight`, `sorting_ceremony` |

### Three Forces

| Force | Formula | What it measures |
|-------|---------|-----------------|
| **Payoff** | `P = Σ max(0, φ_to - φ_from)` | Thread phase transitions — moments the story can't take back |
| **Change** | `C = √M_c + √\|E\| + √Σ\|Δv\|` | How intensely characters were transformed |
| **Knowledge** | `K = ΔN + √ΔE` | How much richer the world became |

### Derived Metrics

| Metric | Formula | Meaning |
|--------|---------|---------|
| **Tension** | `T = C + K - P` | Buildup without release — the coiled spring |
| **Delivery** | `0.3·Σ tanh(f/1.5) + 0.2·contrast` | The dopamine hit — all forces symmetric |
| **Swing** | Euclidean distance in normalised PCK space | The story breathing — dynamic vs flat pacing |

### Grading

Score out of 100 (25 per force) on an exponential curve: `g(x̃) = 25(1 - e^{-2x̃})`. Calibrated so published literature (HP, 1984, Gatsby, Reverend Insanity) scores 81–93. AI-generated stories typically land 68–81.

### The Narrative Cube

Forces map into a 3D cube with 8 modes. Every scene occupies one corner based on which forces are above/below the mean:

| Mode | Forces | Role |
|------|--------|------|
| **Epoch** | P↑ C↑ K↑ | Everything converges |
| **Climax** | P↑ C↑ K↓ | Threads resolve, characters transform |
| **Revelation** | P↑ C↓ K↑ | World-building unlocks resolution |
| **Closure** | P↑ C↓ K↓ | Quiet resolution |
| **Discovery** | P↓ C↑ K↑ | Characters transform through new systems |
| **Growth** | P↓ C↑ K↓ | Internal development |
| **Lore** | P↓ C↓ K↑ | Pure world-building |
| **Rest** | P↓ C↓ K↓ | Recovery and breathing room |

## Key Systems

### Markov Chain Pacing

Scene-to-scene mode transitions form an empirical Markov chain. Transition matrices computed from published works capture each work's pacing fingerprint. Before generating, the engine samples a sequence from the matrix: `Growth → Lore → Climax → Rest → Growth`. Each scene gets mutation guidance targeting the assigned mode. Available as opt-in for manual generation and always-on for MCTS.

### MCTS Narrative Search

Monte Carlo Tree Search explores narrative branches to optimise force trajectories. The engine generates multiple candidate arcs, scores each by force profile, and expands the most promising — like a chess engine for story paths. Evaluation uses the grading formulas directly.

### Analysis Pipeline

Paste any text (up to 500K words) and the engine extracts the knowledge graph via chunked window-function processing. Each chunk is analysed for thread mutations, continuity changes, relationship shifts, and world knowledge. The result is a full force decomposition, delivery curve, and grade.

### Auto-Generation

Automated story generation loop that cycles through: suggest direction → expand world → generate scenes → plan → write prose → grade. Configurable end conditions (scene count, arc count). Uses the planning queue system for multi-phase narrative arcs.

### Scene Generation Pipeline

Full pipeline per scene: **structure** (mutations, participants, location) → **plan** (beat-by-beat blueprint with delivery mechanisms) → **prose** (literary writing from the plan) → **grade** (ProseScore with critique) → **rewrite** (targeted fixes from critique).

## Features

- **Markov Chain Pacing** — transition matrices from published works shape rhythm
- **MCTS Search** — Monte Carlo Tree Search optimises force trajectories
- **Text Analysis** — paste any text, extract the knowledge graph and delivery curve
- **Scene Generation** — structure → plan → prose → grade → rewrite pipeline
- **World Building** — arc-based expansion of characters, locations, threads
- **Branching Timelines** — git-like branches for alternate storylines
- **Auto-Generation** — automated story loops with configurable constraints
- **Force Charts** — stock-type time-series of all forces and delivery
- **Grading** — exponential curve calibrated against published literature
- **Classification** — archetype detection (Masterwork, Epic, Chronicle, etc.) and shape classification
- **Slides** — interactive walkthrough of peaks, valleys, and force decomposition
- **Discover** — guided Q&A world-building that feeds into the creation wizard
- **EPUB Export** — export as a publishable ebook

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js](https://nextjs.org) 16 (App Router) |
| UI | React 19, [Tailwind CSS](https://tailwindcss.com) v4 |
| Visualisation | [D3.js](https://d3js.org) — force graphs, charts, cube trajectories |
| AI | [OpenRouter](https://openrouter.ai/) — Gemini 2.5/3 Flash (default), any model via key |
| Images | [Replicate](https://replicate.com/) — Flux models for cover art and scene imagery |
| Language | TypeScript throughout |

## Project Structure

```
src/
├── app/                    # Next.js routes & API endpoints
│   ├── series/[id]/        # Main story editor workspace
│   ├── paper/              # Whitepaper — theory, formulas, validation
│   ├── discover/           # Guided world-building Q&A
│   ├── analysis/           # Text-to-narrative extraction pipeline
│   ├── case-analysis/      # Pre-analysed works (HP)
│   ├── dashboard/          # User stories and analysis jobs
│   └── api/                # generate, chat, generate-image, generate-cover, etc.
├── components/             # React UI (organized by feature area)
│   ├── canvas/             # WorldGraph — interactive knowledge graph
│   ├── timeline/           # TimelineStrip, ForceCharts, NarrativeCubeViewer
│   ├── slides/             # SlidesPlayer — series walkthrough presentation
│   ├── mcts/               # MCTSPanel — narrative force optimisation
│   ├── analytics/          # ForceTracker — stock-type force metrics
│   ├── generation/         # GeneratePanel, PacingStrip, MarkovGraph
│   ├── topbar/             # CubeExplorer, FormulaModal
│   ├── story/              # StoryReader — prose reading/grading/rewriting
│   ├── discover/           # DiscoverPage — Q&A world-building
│   ├── wizard/             # CreationWizard — new story flow
│   └── ...
├── lib/
│   ├── ai/                 # LLM calls (api, context, scenes, prose, world, prompts, premise)
│   ├── narrative-utils.ts  # Force formulas, cube logic, delivery curve, grading, peak detection
│   ├── markov.ts           # Transition matrices, sequence sampling, presets
│   ├── text-analysis.ts    # Corpus → knowledge graph (window-function chunking)
│   ├── mcts-engine.ts      # MCTS — optimises narrative force trajectories
│   ├── auto-engine.ts      # Automated generation loop
│   ├── planning-engine.ts  # Multi-phase narrative planning
│   ├── store.tsx            # State management (React Context + useReducer)
│   └── ...
├── types/
│   ├── narrative.ts        # Domain types: Scene, Character, Thread, Arc, CubeCorner, etc.
│   └── mcts.ts             # MCTS-specific types
├── public/works/           # Analysed reference works (HP, Gatsby, 1984, etc.)
└── data/                   # Seed narratives (HP, LOTR, Star Wars, GoT, Reverend Insanity)
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | LLM access via OpenRouter. Get a key at [openrouter.ai/keys](https://openrouter.ai/keys) |
| `REPLICATE_API_TOKEN` | No | Image generation (covers, scene art). Get a token at [replicate.com](https://replicate.com) |
| `NEXT_PUBLIC_USER_API_KEYS` | No | Set to `true` to allow users to provide their own API keys in the UI |

## Theory

The full theoretical framework — formulas, validation against Harry Potter, grading calibration, Markov chain analysis, and the narrative cube — is documented in the interactive whitepaper at `/paper`. The formulas are designed to be forked: every constant is tunable, every weight is auditable.

## License

Private
