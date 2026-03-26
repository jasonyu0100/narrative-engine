# Narrative Engine

Knowledge-graph-based narrative analysis, generation, and revision platform. Derives **payoff**, **change**, and **knowledge** forces from scene-level mutations — then uses those forces to grade, search, generate, and iteratively refine stories.

**[Read the paper →](/paper)** · **[Case analysis: Harry Potter →](/case-analysis)** · **[Try it →](/)**

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in your keys
npm run dev                   # http://localhost:3001
```

```env
OPENROUTER_API_KEY=sk-or-...    # Required — openrouter.ai/keys
REPLICATE_API_TOKEN=r8_...      # Optional — image generation (Seedream 4.5)
```

## Architecture

```
Next.js 16 · React 19 · TypeScript · Tailwind v4 · D3.js
OpenRouter (Gemini 2.5/3 Flash) · Replicate (Seedream 4.5)
```

**State**: React Context + useReducer → localStorage persistence
**AI**: Raw HTTP to OpenRouter (`/api/generate`), no SDK
**Forces**: Deterministic formulas — no LLM in the scoring loop

## The Three Forces

Every scene produces mutations across three structural layers. Deterministic formulas (z-score normalised, genre-agnostic) compute forces from those mutations:

| Force | Formula | Measures |
|-------|---------|----------|
| **Payoff** | `P = Σ max(0, φ_to - φ_from) + 0.25 × pulses` | Thread phase transitions |
| **Change** | `C = √M_c + √|E| + √Σ|Δv|` | Character transformation intensity |
| **Knowledge** | `K = ΔN + √ΔE` | World-building density |

**Derived**: Tension (`C + K - P`), Delivery (`0.3·Σ tanh(f/1.5) + 0.2·contrast`), Swing (Euclidean distance in PCK space)

**Grading**: `g(x̃) = 25(1 - e^{-2x̃})` per force, 100 total. Published literature: 81–93. Course-corrected AI: high 80s.

## The Narrative Cube

| Mode | P C K | Role |
|------|-------|------|
| Epoch | ↑ ↑ ↑ | Everything converges |
| Climax | ↑ ↑ ↓ | Threads resolve, characters transform |
| Revelation | ↑ ↓ ↑ | World-building unlocks resolution |
| Closure | ↑ ↓ ↓ | Quiet resolution |
| Discovery | ↓ ↑ ↑ | Transform through new systems |
| Growth | ↓ ↑ ↓ | Internal development |
| Lore | ↓ ↓ ↑ | Pure world-building |
| Rest | ↓ ↓ ↓ | Breathing room |

## Key Systems

### Markov Chain Pacing
Transition matrices computed from published works. Before generating an arc, sample a mode sequence (`Growth → Lore → Climax → Rest`) and inject as per-scene direction. See `src/lib/markov.ts`.

### MCTS Narrative Search
Monte Carlo Tree Search over narrative branches. Each expansion gets a fresh Markov pacing sequence. UCB1 balances exploitation vs exploration. Force grading is the evaluation function. See `src/lib/mcts-engine.ts`.

### Planning with Course Correction
Phases → direction + constraint vectors → scene generation. After every arc, vectors are rewritten based on thread tension, character cost, rhythm, freshness, momentum. See `src/lib/ai/review.ts`.

### Iterative Revision
Evaluate branch by scene summaries → per-scene verdicts (ok / edit / rewrite / cut) → reconstruct into versioned branch. Edits tighten within locked structure; rewrites rebuild; cuts remove. Converges in 2–3 passes. Supports external guidance. See `src/lib/ai/evaluate.ts`, `src/lib/ai/reconstruct.ts`.

### Analysis Pipeline
Paste any text → chunked window-function extraction → full knowledge graph, force decomposition, delivery curve, grade. See `src/lib/text-analysis.ts`.

## Key Files

| File | What |
|------|------|
| `src/lib/narrative-utils.ts` | Force formulas, cube logic, grading, delivery curve |
| `src/lib/markov.ts` | Transition matrices, sequence sampling, presets |
| `src/lib/mcts-engine.ts` | MCTS search over narrative branches |
| `src/lib/auto-engine.ts` | Automated generation loop |
| `src/lib/ai/evaluate.ts` | Branch evaluation (summary → verdicts) |
| `src/lib/ai/reconstruct.ts` | Branch reconstruction from verdicts |
| `src/lib/ai/scenes.ts` | Scene structure generation |
| `src/lib/ai/prose.ts` | Prose generation and rewriting |
| `src/lib/ai/review.ts` | Direction vector course correction |
| `src/lib/store.tsx` | State management (Context + useReducer) |
| `src/types/narrative.ts` | Domain types |
| `src/app/paper/page.tsx` | Interactive whitepaper |

## The Paper

The whitepaper at `/paper` covers the full framework: force formulas, validation against published literature, Markov pacing, MCTS search, planning with course correction, and iterative revision. Every formula is open, every constant is tunable.

## License

MIT — see [LICENSE](LICENSE)
