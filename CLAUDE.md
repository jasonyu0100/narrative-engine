# InkTide

Knowledge-graph-based narrative analysis, generation, and revision platform. Derives **payoff**, **change**, and **knowledge** forces from scene-level mutations. Next.js 16 + React 19 + TypeScript.

## Core Concept

Narratives are modelled as a **knowledge graph** that mutates scene by scene. An LLM records structural mutations (threads, knowledge, relationships) at each scene, and static analysis formulas compute **narrative forces** from those mutations. This enables:

- **Markov chain pacing** — transition matrices derived from published works shape scene-by-scene rhythm
- **MCTS search** — explores branching narrative paths, each expansion guided by a fresh Markov pacing sequence
- **Planning with course correction** — direction vectors rewritten after each arc based on thread tension, character cost, rhythm, freshness, momentum
- **Iterative revision** — evaluate branches by summary → per-scene verdicts (ok/edit/merge/insert/cut) → reconstruct versioned branches
- **Analysis engine** — compiles existing text into arcs and scenes via chunked window-function processing
- **Pacing presets** — curated cube position sequences that bypass Markov sampling for targeted arcs
- **Prose profiles** — reverse-engineer published prose into beat plans, build authorial Markov chains over a 10-function / 8-mechanism taxonomy

## Quick Reference

```bash
npm run dev      # Start dev server (localhost:3001)
npm run build    # Production build
npm run lint     # ESLint
```

## Architecture

- **Frontend:** Next.js App Router, React 19, Tailwind CSS v4, D3.js
- **AI:** OpenRouter API (streaming) — raw HTTP, no SDK. Models: Gemini 2.5 Flash (default/analysis/generation), Gemini 3 Flash Preview (writing)
- **Images:** Replicate API (Seedream 4.5) via `/api/generate-image`, `/api/generate-cover`
- **State:** React Context + useReducer in `src/lib/store.tsx`
- **Persistence:** localStorage via `src/lib/persistence.ts`
- **Types:** Domain model in `src/types/narrative.ts`, MCTS types in `src/types/mcts.ts`, config in `src/lib/constants.ts`

## Key Directories

```
src/
├── app/                    # Next.js routes & API endpoints
│   ├── series/[id]/        # Main story editor workspace
│   ├── paper/              # Whitepaper — theory, formulas, validation
│   ├── analysis/           # Text-to-narrative extraction pipeline
│   └── api/                # generate, chat, generate-image, generate-cover, random-idea, suggest-premise, analyze-chapter
├── components/             # React UI (organized by feature area)
│   ├── story/              # StoryReader — prose reading/grading/rewriting
│   ├── canvas/             # WorldGraph — interactive entity/knowledge graph
│   ├── inspector/          # SidePanel — entity detail views (vertical tab rail)
│   ├── timeline/           # TimelineStrip, ForceCharts, NarrativeCubeViewer, BranchEval
│   ├── topbar/             # TopBar, CubeExplorer, FormulaModal, ApiKeyModal
│   ├── generation/         # GeneratePanel, BranchModal, PacingStrip, MarkovGraph
│   ├── analytics/          # ForceTracker — stock-type force analysis
│   ├── auto/               # AutoControlBar, AutoSettingsPanel
│   ├── mcts/               # MCTSPanel, MCTSControlBar
│   ├── slides/             # SlidesPlayer + individual slide components
│   ├── sidebar/            # SeriesPicker, ThreadPortfolio, MediaDrive
│   ├── layout/             # AppShell, RulesPanel
│   ├── wizard/             # CreationWizard — new story flow
│   └── chat/               # ChatPanel
├── lib/                    # Core logic
│   ├── ai/                 # LLM calls (modularised)
│   │   ├── api.ts          # callGenerate, callGenerateStream
│   │   ├── context.ts      # branchContext, sceneContext — LLM context building
│   │   ├── scenes.ts       # generateScenes, generateScenePlan
│   │   ├── prose.ts        # rewriteSceneProse
│   │   ├── world.ts        # expandWorld, suggestDirection, generateNarrative
│   │   ├── review.ts       # refreshDirection — course correction after each arc
│   │   ├── evaluate.ts     # evaluateBranch — summary-based branch evaluation with guided feedback
│   │   ├── reconstruct.ts  # reconstructBranch — versioned branch reconstruction from verdicts
│   │   ├── prompts.ts      # Modular prompt sections (force standards, pacing, mutations, POV, continuity)
│   │   └── json.ts         # JSON parsing utilities
│   ├── beat-profiles.ts    # Beat Markov matrices, profile presets, sampleBeatSequence
│   ├── narrative-utils.ts  # Force calculation formulas, cube logic, graph algorithms
│   ├── pacing-profile.ts           # Markov chain pacing — transition matrices, sequence sampling, presets, prompt generation
│   ├── store.tsx           # State management + reducer actions
│   ├── text-analysis.ts    # Corpus → NarrativeState extraction (window-function chunking)
│   ├── auto-engine.ts      # Automated story generation loop
│   ├── mcts-engine.ts      # MCTS scene exploration
│   ├── mcts-state.ts       # MCTS state management
│   ├── slides-data.ts      # Slide generation logic
│   ├── constants.ts        # All tunable config values
│   ├── persistence.ts      # localStorage read/write
│   ├── epub-export.ts      # EPUB export
│   └── api-logger.ts       # API call logging & token tracking
├── types/
│   ├── narrative.ts        # Domain types: Scene, Character, Location, Thread, Arc, StructureEvaluation, etc.
│   └── mcts.ts             # MCTS-specific types
├── hooks/                  # useAutoPlay, useMCTS, useFeatureAccess
└── data/                   # Seed narratives (HP, LOTR, Star Wars, GoT, Reverend Insanity)
```

## Domain Model (src/types/narrative.ts)

- **NarrativeState** — top-level: characters, locations, threads, arcs, scenes, worldBuilds, branches, structureEvaluations
- **Scene** — povId, locationId, participantIds, events, threadMutations, continuityMutations, relationshipMutations, characterMovements, plan, prose, proseScore
- **Thread** — trackable narrative threads with lifecycle status; mutations record payoff/change per scene
- **Branch** — git-like branching for story timelines; entryIds interleave scenes + world commits
- **StructureEvaluation** — per-scene verdicts (ok/edit/merge/insert/cut), overall critique, repetition patterns, thematic question
- **Arc** — world-building arcs that group scenes and expand the narrative world
- **CubeCorner** — one of 8 narrative modes defined by high/low combinations of the three forces

## Scene Mutations

Every scene records structural changes to the knowledge graph. These mutations are the raw inputs to the force formulas — the forces are computed *from* the mutations, not from the prose.

### Thread Mutations → Payoff
Threads are narrative tensions with a lifecycle: `dormant → active → escalating → critical → resolved/subverted/abandoned`. Each scene records thread mutations as `{threadId, from, to}` status transitions. A thread jumping from `active` to `critical` contributes `|3 - 1| = 2` to Payoff. Threads mentioned without transitioning earn a pulse of 0.25.

### Continuity Mutations → Change
Continuity mutations track what characters learn, lose, or become: `{characterId, nodeId, action, content, nodeType}`. Events are tagged per scene. These feed Change alongside relationship valence intensity: `C = √M_c + √|E| + √Σ|valenceDelta|`.

### World Knowledge Mutations → Knowledge
The world knowledge graph tracks laws, systems, concepts, and tensions as nodes with typed edges. Knowledge is computed as `K = ΔN + √ΔE` — nodes linear, edges sqrt.

### Relationship Mutations → Change
Relationship mutations (`{from, to, type, valenceDelta}`) track how connections between characters shift. They feed Change via `√Σ|valenceDelta|`.

## Narrative Forces & Formulas

Three force dimensions, all **z-score normalised** (mean=0, units=standard deviations):

- **Payoff (P)** — `Σ max(0, φ_to - φ_from)` over thread mutations, plus 0.25 pulse per same-status mention
- **Change (C)** — `√M_c + √|E| + √Σ|valenceDelta|`
- **Knowledge (K)** — `ΔN + √ΔE`

Derived metrics:
- **Tension** — `T = C + K - P`
- **Delivery** — `0.3·Σ tanh(f/1.5) + 0.2·contrast` where `contrast = max(0, T[i-1] - T[i])`
- **Swing** — Euclidean distance between consecutive force snapshots

Formulas in `src/lib/narrative-utils.ts`. The **cube** model maps forces into 3D space for trajectory analysis.

## Markov Chain Pacing (src/lib/pacing-profile.ts)

Scene generation is guided by **Markov chain sequences** sampled as per-scene directions. This separates *what happens* (LLM) from *how intense it is* (math).

**Flow:**
1. Detect current mode from the last scene's force snapshot
2. Sample a sequence of cube modes from a transition matrix (or use a preset)
3. Build a prompt with per-scene mode assignments and mutation guidance
4. LLM generates scenes with mutations matching each mode's targets

**Transition matrices** are computed from analysed works (Harry Potter is the default). Each matrix captures the pacing fingerprint of a published work.

**Pacing presets** are curated fixed sequences that bypass Markov sampling:
- 3-scene: Sucker Punch, Quick Resolve, Crucible
- 5-scene: Classic Arc, Unravelling, Pressure Cooker, Inversion, Deep Dive
- 8-scene: Introduction, Full Arc, Slow Burn, Roller Coaster, Revelation Arc, Gauntlet

## Prose Profiles & Beat Plans (src/lib/beat-profiles.ts, scripts/analyze-prose.js)

Prose generation is guided by **beat plans** — structured blueprints that decompose each scene into typed beats before any prose is written. Plans are reverse-engineered from published works by having an LLM analyze existing prose against a fixed taxonomy, then building statistical profiles from the extracted plans.

**10 Beat Functions** (what the beat does):
- **breathe** — pacing, atmosphere, sensory grounding, scene establishment
- **inform** — knowledge delivery, a character or reader learns something now
- **advance** — forward momentum, plot moves, goals pursued, tension rises
- **bond** — relationship shifts between characters (trust, suspicion, alliance)
- **turn** — scene pivots, a revelation reframes everything, an interruption changes direction
- **reveal** — character nature exposed through action or choice
- **shift** — power dynamic inverts, leverage changes hands
- **expand** — world-building, new rule/system/geography introduced
- **foreshadow** — plants information that pays off later
- **resolve** — tension releases, question answered, conflict settles

**8 Mechanisms** (how the beat is delivered as prose):
- **dialogue** — conversation with subtext
- **thought** — internal monologue, POV character's private reasoning
- **action** — physical movement, gesture, interaction with objects
- **environment** — setting, weather, lighting, sensory details
- **narration** — authorial commentary, rhetorical structures
- **memory** — flashback triggered by association
- **document** — embedded text (letter, newspaper, sign, excerpt)
- **comic** — humor, irony, absurdity, bathos

**Analysis pipeline** (`scripts/analyze-prose.js`):
1. LLM extracts beat plans from existing prose scenes (fn + mechanism + what + anchor per beat)
2. Count beat function and mechanism distributions across all scenes
3. Build **Markov transition matrices** over beat functions (fn→fn probabilities)
4. Compute beatsPerKWord density metric
5. Output a `ProseProfile` (voice: register, stance, devices, rules) + `BeatSampler` (markov, mechanismDistribution, beatsPerKWord)

**Presets** are derived from analysed works at runtime. The "self" preset computes a live profile from the current narrative's own scene plans. When `useBeatChain` is enabled, plan generation samples the beat function sequence from the profile's Markov chain rather than choosing freely.

## Planning with Course Correction (src/lib/ai/review.ts)

Stories are divided into **phases** with objectives and scene allocations. When a phase activates, direction and constraint vectors are generated. After every arc, a **course correction** pass rewrites the vectors based on thread tension, character cost, rhythm, freshness, and momentum. At phase boundaries, world expansion introduces new entities seeded with knowledge asymmetries.

## Iterative Revision (src/lib/ai/evaluate.ts, reconstruct.ts)

**Evaluation** reads scene summaries and assigns per-scene verdicts:
- **ok** — structurally sound, continuity intact
- **edit** — revise content — may change POV, location, participants, mutations, summary
- **merge** — absorbed into another scene, combining both into one denser beat
- **insert** — new scene generated to fill a pacing gap, missing transition, or stalled thread
- **cut** — redundant, remove entirely (to relocate a scene: cut + insert at new position)

**Reconstruction** creates a new versioned branch (v2, v3, v4...), applying verdicts in parallel. World commits pass through at original positions. Supports external guidance (paste feedback from another AI or human editor). Converges in 2–3 passes.

## AI Pipeline (src/lib/ai/)

All LLM calls go through `callGenerate` (non-streaming) or `callGenerateStream` (streaming) in `api.ts`, which hit `/api/generate`.

Key functions:
- `generateNarrative()` — full world + 8-scene introduction arc (wizard)
- `generateScenes()` — scene structures with mutations, paced by Markov sequence
- `generateScenePlan()` — beat-by-beat blueprint (streaming)
- `generateSceneProse()` — full prose from plan (streaming)
- `rewriteSceneProse()` — rewrite guided by critique or custom analysis
- `expandWorld()` — add characters, locations, threads
- `refreshDirection()` — course correction after each arc
- `evaluateBranch()` — summary-based branch evaluation with optional guidance
- `reconstructBranch()` — versioned branch reconstruction from verdicts

## Environment Variables

```
OPENROUTER_API_KEY=         # Required — LLM API access
REPLICATE_API_TOKEN=        # Optional — image generation (Seedream 4.5)
NEXT_PUBLIC_USER_API_KEYS=  # Optional — allow user-provided keys
```

## Constants (src/lib/constants.ts)

Key tuning values:
- `PROSE_CONCURRENCY = 10` — parallel prose generation
- `PLAN_CONCURRENCY = 10` — parallel plan generation
- `ANALYSIS_CONCURRENCY = 20` — parallel text analysis chunks
- `DEFAULT_CONTEXT_SCENES = 50` — default branch time horizon (overridden per-story in settings)
- `MCTS_MAX_NODE_CHILDREN = 8` — MCTS branching factor
- `AUTO_STOP_CYCLE_LENGTH = 25` — auto-engine arc limit
