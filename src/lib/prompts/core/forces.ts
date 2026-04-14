/**
 * Force Standards Prompt
 *
 * Reference means aligned to grading formulas. When updating, check
 * src/lib/narrative-utils.ts FORCE_REFERENCE_MEANS to keep in sync.
 * Reference means: { fate: 1.5, world: 12, system: 3 }
 */

/** Force standards prompt using reference mean levels */
export const PROMPT_FORCE_STANDARDS = `
THE THREE FORCES — computed from deltas, normalised by reference mean, graded on curve (21/25 at reference). Apply across fiction, non-fiction, research, and simulation.

FATE — threads pulling toward resolution. Low fate = high friction (problems resist, solutions have costs, claims need defending). High fate = text cooperates (threads resolve when pushed).
  F = Σ √arcs × stageWeight × (1 + log(1 + investment)). Sustained threads earn superlinearly.
  Target: ~1.5 per scene. Don't manufacture resolutions, deus ex machina, or premature conclusions to hit numbers.

WORLD — entity transformation. In fiction: characters, locations, artifacts change. In non-fiction: ideas, institutions, methods, datasets accrue history and take on new properties.
  W = ΔN_c + √ΔE_c. Continuity nodes mark lasting changes: traits, beliefs, capabilities, wounds (fiction); refinements, qualifications, demonstrated properties (non-fiction).
  Target: ~12 per scene. Don't force epiphanies, rushed development, or overclaimed refinements.

SYSTEM — rules and structures. In fiction: magic, physics, social order. In non-fiction: theorems, mechanisms, models, constraints, theoretical framework.
  S = ΔN + √ΔE. Knowledge nodes expand or constrain what's possible. Edges link rules together.
  Target: ~3 per scene. Don't inject lore / theory dumps where they don't belong.

BALANCE: Classic = fate-dominant | Show = world-dominant | Paper = system-dominant | Opus = balanced. The archetype of the source text determines the natural mixture.

SCALE: Beat ~100 words | Scene ~12 beats (~1200 words) | Arc ~4 scenes. The beat/scene/arc hierarchy is the system's internal unit of structure — use the term "scene" for a unit of long-form text regardless of register (a chapter, a section of a paper, a log entry).
DENSITY: Earn deltas from the prose — never invent. REUSE existing node IDs.
`;

/**
 * Build force standards prompt using reference means.
 * @deprecated Use PROMPT_FORCE_STANDARDS directly. This function is kept for backwards compatibility.
 */
export function buildForceStandardsPrompt(): string {
  return PROMPT_FORCE_STANDARDS;
}
