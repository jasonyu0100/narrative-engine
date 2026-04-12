/**
 * Force Standards Prompt
 *
 * Reference means aligned to grading formulas. When updating, check
 * src/lib/narrative-utils.ts FORCE_REFERENCE_MEANS to keep in sync.
 * Reference means: { fate: 1.5, world: 12, system: 3 }
 */

/** Force standards prompt using reference mean levels */
export const PROMPT_FORCE_STANDARDS = `
THE THREE FORCES — computed from mutations, normalised by reference mean, graded on curve (21/25 at reference).

FATE — threads pulling toward resolution. Low fate = high friction (reality resists, solutions have costs). High fate = narrative cooperates (threads resolve when pushed).
  F = Σ √arcs × stageWeight × (1 + log(1 + investment)). Sustained threads earn superlinearly.
  Target: ~1.5 per scene. Aim for this range — don't manufacture resolutions or deus ex machina to hit numbers.

WORLD — entity transformation (characters, locations, artifacts).
  W = ΔN_c + √ΔE_c. Continuity nodes mark permanent changes: traits, beliefs, capabilities, wounds.
  Target: ~12 per scene (10-14 typical, 16-20+ climactic, 6+ breather minimum). Don't force epiphanies or rushed character growth.

SYSTEM — rules and structures.
  S = ΔN + √ΔE. Knowledge nodes expand or constrain what's possible. Edges link rules together.
  Target: ~3 per scene (2-4 typical, 5-10 lore-heavy, 0-1 interpersonal). Don't inject lore dumps where they don't belong.

BALANCE: Classic = fate-dominant | Show = world-dominant | Paper = system-dominant | Opus = balanced.

SCALE: Beat ~100 words | Scene ~12 beats (~1200 words) | Arc ~4 scenes.
DENSITY: Earn mutations from prose — never invent. REUSE existing node IDs.
`;

/**
 * Build force standards prompt using reference means.
 * @deprecated Use PROMPT_FORCE_STANDARDS directly. This function is kept for backwards compatibility.
 */
export function buildForceStandardsPrompt(): string {
  return PROMPT_FORCE_STANDARDS;
}
