# InkTide Narrative Definitions

Comprehensive reference for all narrative classification systems, scene modes, beat types, and structural archetypes used throughout InkTide.

---

## Scene Classes (Cube Corners)

The **narrative cube** maps scenes into 3D force space. Each corner represents a distinct mode of storytelling, defined by high/low combinations of the three fundamental forces.

**Force Axes:**
- **Payoff (P)** — Thread resolution intensity
- **Change (C)** — Character transformation magnitude
- **Knowledge (K)** — World-building depth

### The 8 Cube Corners

| Key | Name | Forces | Description |
|-----|------|--------|-------------|
| **HHH** | **Epoch** | P↑ C↑ K↑ | Everything converges — threads resolve, characters transform, and the world's rules expand. A defining moment that reshapes the narrative landscape. |
| **HHL** | **Climax** | P↑ C↑ K↓ | Threads resolve and characters transform within established world rules. The payoff of what's already been built — no new lore needed. |
| **HLH** | **Revelation** | P↑ C↓ K↑ | Threads pay off through world-building. The world's rules explain why things happened — lore unlocks resolution without personal transformation. |
| **HLL** | **Closure** | P↑ C↓ K↓ | Quiet resolution within established world rules. Tying up loose ends — conversations that needed to happen, debts paid, promises kept or broken. |
| **LHH** | **Discovery** | P↓ C↑ K↑ | Characters transform through encountering new world systems. No threads resolve — pure exploration, world-building, and possibility. |
| **LHL** | **Growth** | P↓ C↑ K↓ | Internal character development within established world rules. Characters train, bond, argue, and change through interaction — no new lore. |
| **LLH** | **Lore** | P↓ C↓ K↑ | Pure world-building without resolution or transformation. Establishing rules, systems, cultures, and connections for future payoff. Seeds planted in the world's structure. |
| **LLL** | **Rest** | P↓ C↓ K↓ | Nothing resolves, no one transforms, no new world concepts. Recovery and breathing room — quiet character deliveries and seed-planting. |

**Usage:**
Cube corners guide scene generation via Markov chains and provide structural vocabulary for discussing narrative rhythm.

---

## Beat Classes

Beats are the atomic units of scene structure — individual moments that advance story, reveal character, or build world.

### Beat Functions (What the beat does)

| Function | Description |
|----------|-------------|
| **breathe** | Pacing, atmosphere, sensory grounding, scene establishment |
| **inform** | Knowledge delivery — character or reader learns something now |
| **advance** | Forward momentum — plot moves, goals pursued, tension rises |
| **bond** | Relationship shifts between characters |
| **turn** | Scene pivots — revelation, reversal, interruption |
| **reveal** | Character interiority exposed — desires, fears, secrets surface |
| **shift** | POV character's perspective changes on situation or person |
| **expand** | World-building — systems, rules, culture, or lore introduced |
| **foreshadow** | Future events or themes seeded subtly |
| **resolve** | Local tension released — question answered, immediate conflict settled |

### Beat Mechanisms (How it's delivered)

| Mechanism | Description |
|-----------|-------------|
| **dialogue** | Characters speaking |
| **thought** | Internal monologue |
| **action** | Physical movement, gesture, body in space |
| **environment** | Setting, weather, arrivals, sensory details |
| **narration** | Narrator addresses reader, authorial commentary, rhetoric |
| **memory** | Flashback, recollection, past event recalled |
| **document** | Letter, inscription, found text, in-world artifact |
| **comic** | Visual gag, physical comedy, absurd juxtaposition |

**Usage:**
Each scene contains a sequence of beats. Beat profiles (distributions of functions and mechanisms) define authorial voice and pacing style.

---

## Narrative Archetypes

Archetypes classify stories by **force dominance** — which of the three forces (Payoff, Change, Knowledge) reach narrative-grade strength.

| Archetype | Dominant Forces | Description |
|-----------|----------------|-------------|
| **Opus** | P + C + K | All three forces in concert — payoffs land, characters transform, and the world deepens together |
| **Tempest** | P + C | Violent forces that leave nothing unchanged — consequences land and characters are reshaped by them |
| **Chronicle** | P + K | Resolutions deepen the world — each payoff reveals how things work |
| **Mosaic** | C + K | Many lives composing a larger picture — characters transform within a deepening world |
| **Classic** | P | Driven by resolution — threads pay off and relationships shift decisively |
| **Show** | C | People-driven — characters transform and their journeys are the heart of the story |
| **Paper** | K | Dense with ideas and systems — the depth of the world itself is the draw |
| **Emerging** | — | No single force has reached its potential yet — the story is still finding its voice |

**Thresholds:**
A force is "dominant" if it scores ≥21/25 AND is within 5 points of the highest-scoring force.

---

## Narrative Shapes

Shapes classify the **macro-structure** of delivery curves — how intensity rises and falls across the full story.

| Shape | Description | Curve Pattern |
|-------|-------------|---------------|
| **Climactic** | Build, climax, release — one dominant peak defines the arc | Steady rise → sharp peak (mid/late) → decline |
| **Episodic** | Multiple peaks of similar weight — no single climax dominates | Repeating rises and falls, no clear maximum |
| **Rebounding** | A meaningful dip followed by strong recovery | Start high → collapse → strong recovery |
| **Peaking** | Dominant peak early or mid-arc, followed by decline | Early high → sustained fall |
| **Escalating** | Momentum rises overall — intensity concentrated toward the end | Gradual, sustained rise to finish |
| **Flat** | Too little structural variation — no meaningful peaks or valleys | Near-constant delivery values |

**Detection Metrics:**
- **Overall Slope** — Macro trend (rising, falling, stable)
- **Peak Count** — Number of detected local maxima
- **Peak Dominance** — Largest prominence / total prominence
- **Peak Position** — Where the dominant peak falls (0..1)
- **Trough Depth** — Magnitude of central valley (V-shape detector)
- **Flatness** — Standard deviation of smoothed curve

---

## Story Scales

Scales classify narratives by **scene count** — the fundamental measure of scope.

| Scale | Scene Range | Description | Examples |
|-------|-------------|-------------|----------|
| **Short** | < 20 | A contained vignette — one conflict, one resolution | Short story, one-act play |
| **Story** | 20–50 | A focused narrative with room for subplot and development | Romeo & Juliet (24), Great Gatsby (44) |
| **Novel** | 50–120 | Full-length narrative with multiple arcs and cast depth | 1984 (75), HP books (89–110), Tale of Two Cities (100) |
| **Epic** | 120–300 | Extended narrative with sprawling cast and world scope | Reverend Insanity Vol 1 (133) |
| **Serial** | 300+ | Long-running multi-volume narrative with evolving world | Full web serials, multi-volume sagas |

**Calibration:**
Derived from analysis of published literary works and web serials.

---

## World Density

Density measures the **richness of the world relative to story length** — how many entities exist per scene.

**Formula:**
```
Density = (characters + locations + threads + worldKnowledgeNodes) / scenes
```

| Density Class | Density Range | Description | Examples |
|---------------|---------------|-------------|----------|
| **Sparse** | < 0.5 | Minimal world scaffolding — story over setting | Minimalist narratives |
| **Focused** | 0.5–1.5 | Lean world built to serve specific narrative needs | Tightly plotted thrillers |
| **Developed** | 1.5–2.5 | Substantial world with layered characters and tensions | Tale of Two Cities (1.7) |
| **Rich** | 2.5–4.0 | Dense world where every scene touches multiple systems | HP Azkaban (2.1), HP Chamber (2.7), Romeo & Juliet (3.2) |
| **Sprawling** | 4.0+ | Deeply interconnected world — every corner holds detail | AI-generated high-density narratives |

**Calibration:**
Thresholds derived from analysis of classic literary works.

---

## Narrative Position

Position classifies the **local delivery state** at a given point in the story — where you are in the current rhythm.

| Position | Description |
|----------|-------------|
| **Peak** | Deliveries are at a local high — intensity is cresting |
| **Trough** | Deliveries are at a local low — energy has bottomed out |
| **Rising** | Deliveries are climbing — building toward a high point |
| **Falling** | Deliveries are declining — unwinding from a high |
| **Stable** | Deliveries are holding steady — no strong directional movement |

**Detection:**
Checks proximity to detected peaks/valleys first (within last 4 points), then falls back to recent slope direction.

---

## Force Grading System

Forces are graded on a **0–25 scale per dimension**, with an overall score of 0–100.

### Reference Means (Calibrated from Literary Works)

| Force | Reference Mean | Description |
|-------|----------------|-------------|
| **Payoff** | 1.3 | Expected mean raw value for well-paced thread resolution |
| **Change** | 4.0 | Expected mean raw value for character transformation |
| **Knowledge** | 3.5 | Expected mean raw value for world-building depth |

### Grading Curve

At reference mean (x̃ = 1.0), a force scores ~18/25 (73%).
Grade = `25 × tanh(1.4 × x̃)` where x̃ = (raw mean) / (reference mean)

**Overall Grade:**
Sum of individual rounded grades: `payoff + change + knowledge + swing`

**Grade Interpretation:**
- **90–100** — Masterwork-tier execution
- **75–89** — Strong, professional-grade narrative
- **60–74** — Solid foundation, room to refine
- **45–59** — Structural potential, needs development
- **< 45** — Early draft or experimental structure

---

## Usage in InkTide

These definitions are used throughout the platform:

1. **Scene Generation** — Markov chains sample cube corner sequences to guide LLM structure
2. **Branch Evaluation** — Archetypes and shapes provide high-level structural vocabulary
3. **Analytics** — Density, scale, and position classify narratives for comparison
4. **Planning** — Course correction uses force gradients and cube trajectories
5. **Visualization** — Cube viewer, delivery curves, and force charts all map to these concepts

**Formulas & Implementation:**
See `src/lib/narrative-utils.ts` for full mathematical definitions and detection algorithms.

---

**Version:** Aligned with InkTide narrative type refactor (January 2025)
**Calibration Source:** Harry Potter, Tale of Two Cities, 1984, Great Gatsby, Romeo & Juliet, Reverend Insanity, Crime & Punishment, Coiling Dragon
