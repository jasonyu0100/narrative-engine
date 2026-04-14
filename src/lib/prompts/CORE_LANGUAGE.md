# Core Language

This document defines the canonical vocabulary InkTide uses in **LLM prompts** and
in **internal reasoning** (directives, review critiques, report copy, auto-engine
guidance). The aim is to keep terminology coherent across the system so that a
prompt, a directive, and a UI label never drift against each other.

These terms are **non-negotiable**. Do not replace them with synonyms (even
register-neutral ones) unless the whole system is migrated at once. If a fiction
term feels wrong for a non-fiction register, **broaden the usage** (e.g. a
"scene" of a research paper, a "beat" of an essay) rather than introducing a
parallel word.

Rationale: InkTide is a multipurpose text engine — fiction is primary but the
same abstractions serve memoir, essay, reportage, and research. The abstractions
only hold up if the vocabulary stays stable across registers.

---

## 1. Canonical terms — MUST appear

These terms anchor the system. Every LLM prompt and every piece of
internal-reasoning copy that refers to these concepts should use the canonical
word, not a near-synonym.

| Term          | Meaning                                                                                              | Do NOT use instead            |
|---------------|------------------------------------------------------------------------------------------------------|-------------------------------|
| `narrative`   | The top-level work. Register-neutral — fiction, memoir, essay, research, etc.                        | "story" (too fiction-coded)   |
| `scene`       | The unit of composition. A scene has a POV, a location, participants, and deltas.                    | "section", "passage", "chunk" |
| `arc`         | A grouping of scenes — a movement within the narrative.                                              | "chapter", "part"             |
| `beat`        | The sub-scene unit. A beat has a function (what it does) and a mechanism (how it delivers).          | "sentence", "paragraph"       |
| `delta`       | A structural change recorded against a scene (thread delta, world delta, system delta).              | "change", "update", "mutation"|
| `thread`      | A compelling question that shapes fate. Has a lifecycle: latent → seeded → active → escalating → critical → resolved/subverted. | "plotline", "arc" |
| `fate`        | The force pulling the narrative toward resolution. Computed from thread deltas.                      | "plot", "drive"               |
| `world`       | The force of entity inner-world transformation. Computed from world deltas.                          | "character development"       |
| `system`      | The force of rule/mechanism/concept deepening. Computed from system deltas.                          | "worldbuilding", "lore"       |
| `proposition` | A discrete narrative claim extracted from prose, used for semantic retrieval and structural roles.   | "statement", "fact"           |
| `entity`      | A character, location, or artifact — anything with its own inner world graph.                        | "object"                      |
| `anchor`      | The prominence tier for an entity that carries the narrative's weight.                               | "main character", "lead"      |
| `POV`         | Point-of-view. In fiction: the viewpoint character. In essay/research: the authorial voice.          | "narrator", "perspective"     |

## 2. Register-aware vocabulary

These terms are **allowed** in any register, but the surrounding prompt should
make the register-aware reading explicit the first time in a given prompt.

| Canonical term          | Fiction reading                 | Non-fiction reading                                        |
|-------------------------|---------------------------------|------------------------------------------------------------|
| `entity inner worlds`   | Character interiority           | Institutional/source/archival depth                        |
| `entity arcs`           | Character arcs                  | Argument arcs; investigator arcs                           |
| `thread` (as question)  | Dramatic question               | Claim in contention; open inquiry                          |
| `payoff`                | Dramatic payoff                 | Evidentiary payoff; argument closure                       |
| `tension`               | Dramatic tension                | Intellectual tension; contested ground                     |
| `reveal`                | Character nature exposed        | Finding surfaced; source reinterpreted                     |
| `breathe` (beat fn)     | Sensory grounding               | Framing, signposting, stage-setting                        |

## 3. Terms to AVOID as defaults

These appear historically in the codebase but **should not be used as the
default framing** in new prompts or reasoning copy. They bias the system toward
fiction or Western-canonical storytelling. Use the register-neutral canonical
form instead, or qualify explicitly.

| Avoid as default              | Prefer                                                           |
|-------------------------------|------------------------------------------------------------------|
| "story" (unqualified)         | "narrative"                                                      |
| "novel", "novelistic"         | "long-form work" / scope to fiction when genuinely fiction-only  |
| "chapter"                     | "arc" or "part of the narrative"                                 |
| "character" as universal      | "entity" at the system level; "character" when fiction-specific  |
| "protagonist" as universal    | "narrative voice" / "anchor entity" / qualify per register       |
| "plot"                        | "fate" (the force) or "thread" (the unit)                        |
| "fantasy" / "sci-fi" as examples | Draw from the narrative's declared cultural palette           |

## 4. Cultural palette defaults

Prompts that invoke naming, setting, or cultural reference **must not default
to Anglo/Celtic/Greek**. The codebase lists the supported palettes in
[src/lib/ai/world.ts](../ai/world.ts) under NAMING. Any new prompt that touches
naming or culture should either (a) defer to the narrative's own palette, or
(b) enumerate a diverse list (East Asian, South Asian, Middle Eastern, African,
Indigenous, Latin American, diasporic, plus Slavic/Nordic/Celtic/Greek/Latin as
one option among many).

## 5. Where this is enforced

- Automated guard: [src/__tests__/core-language.test.ts](../../__tests__/core-language.test.ts)
  asserts that centralised prompts contain the canonical terms and do not drift
  toward the avoided defaults.
- Human review: code review should flag new prompts that use "story"/"novel"/
  "chapter" unqualified, or that default Western naming examples.

## 6. Scope

- **In scope**: any file under [src/lib/prompts/](./), any inline LLM prompt in
  [src/lib/ai/](../ai/), any LLM-facing directive string (e.g. in
  [src/lib/auto-engine.ts](../auto-engine.ts)).
- **Out of scope**: UI copy intended for writers working on fiction specifically
  (e.g. the creation wizard's genre pickers). Fiction-coded language is fine
  where fiction is the declared register.
