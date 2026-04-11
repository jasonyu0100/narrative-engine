/**
 * Force Standards Prompt
 *
 * Reference means aligned to grading formulas. When updating, check
 * src/lib/narrative-utils.ts FORCE_REFERENCE_MEANS to keep in sync.
 * Default (Opus): { fate: 1.5, world: 12, system: 3 }
 */

import type { ArchetypeKey } from "@/types/narrative";
import { ARCHETYPE_FORCE_TARGETS, ARCHETYPES, type ArchetypeForceProfile } from "@/lib/narrative-utils";

/** Legacy constant for backwards compatibility — uses guidance-only mode */
export const PROMPT_FORCE_STANDARDS = `
THE THREE FORCES — computed from mutations, normalised by reference mean, graded on curve (21/25 at reference).

FATE — threads pulling toward resolution.
  F = Σ √arcs × stageWeight × (1 + log(1 + investment)). Sustained threads earn superlinearly.
  Guidance: ~1.5 per scene. Once escalating, fate is COMMITTED — must resolve.

WORLD — entity transformation (characters, locations, artifacts).
  W = ΔN_c + √ΔE_c. Continuity nodes mark permanent changes: traits, beliefs, capabilities, wounds.
  Guidance: ~12 per scene (10-14 typical, 16-20+ climactic, 6+ breather minimum).

SYSTEM — rules and structures.
  S = ΔN + √ΔE. Knowledge nodes expand or constrain what's possible. Edges link rules together.
  Guidance: ~3 per scene (2-4 typical, 5-10 lore-heavy, 0-1 interpersonal).

BALANCE: Classic = fate-dominant | Show = world-dominant | Paper = system-dominant | Opus = balanced.

SCALE: Beat ~100 words | Scene ~12 beats (~1200 words) | Arc ~4 scenes.
DENSITY: Earn mutations from prose — never invent. REUSE existing node IDs.
`;

/**
 * Build archetype-aware force standards prompt.
 *
 * - No archetype (empty): All forces are guidance-only, no enforcement
 * - With archetype: Dominant forces for that archetype are ENFORCED, others are guidance
 *
 * This allows Classic stories to enforce fate without forcing world/system density,
 * and allows default mode to be fully permissive.
 */
export function buildForceStandardsPrompt(archetype: ArchetypeKey | "" | undefined): string {
  const profile: ArchetypeForceProfile | null = archetype && archetype in ARCHETYPE_FORCE_TARGETS
    ? ARCHETYPE_FORCE_TARGETS[archetype]
    : null;

  // Get dominant forces for this archetype (empty array if no archetype)
  const dominant: Set<string> = new Set(
    archetype && archetype in ARCHETYPES
      ? ARCHETYPES[archetype as keyof typeof ARCHETYPES].dominant
      : []
  );

  const hasArchetype = !!archetype && !!profile;
  const archetypeLabel = hasArchetype
    ? archetype.charAt(0).toUpperCase() + archetype.slice(1)
    : null;

  // Use archetype targets if set, otherwise use default guidance values
  const fateTarget = profile?.fate ?? 1.5;
  const worldTarget = profile?.world ?? 12;
  const systemTarget = profile?.system ?? 3;

  // Build force-specific lines with enforced/guidance distinction
  const fateEnforced = dominant.has('fate');
  const worldEnforced = dominant.has('world');
  const systemEnforced = dominant.has('system');

  const fateMode = fateEnforced ? 'ENFORCED' : 'Guidance';
  const worldMode = worldEnforced ? 'ENFORCED' : 'Guidance';
  const systemMode = systemEnforced ? 'ENFORCED' : 'Guidance';

  const fateExtra = fateEnforced
    ? 'Hit this target — the story depends on thread payoffs.'
    : 'Aim for this range. Don\'t manufacture resolutions or deus ex machina to hit numbers.';

  const worldExtra = worldEnforced
    ? 'Hit this target — character transformation is central to this story.'
    : 'Aim for this range. Don\'t force epiphanies or rushed character growth.';

  const systemExtra = systemEnforced
    ? 'Hit this target — world-building depth is central to this story.'
    : 'Aim for this range. Don\'t inject lore dumps where they don\'t belong.';

  const archetypeLine = hasArchetype
    ? `\nARCHETYPE: ${archetypeLabel} — ${profile.description}
DOMINANT FORCES: ${dominant.size > 0 ? Array.from(dominant).map(f => f.toUpperCase()).join(', ') : 'none'} — these MUST hit their targets.
MODE: ENFORCEMENT — dominant forces are mandatory. Pacing positions add variance within this framework.`
    : `\nMODE: FREEFORM — no archetype set. All force targets are suggestions only.
  Prioritise natural storytelling. Don't force payoffs, transformations, or lore to hit density numbers.
  Pacing positions (if enabled) guide rhythm but don't enforce density.`;

  return `
THE THREE FORCES — computed from mutations, normalised by reference mean, graded on curve (21/25 at reference).
${archetypeLine}

FATE — threads pulling toward resolution. Low fate = high friction (reality resists, solutions have costs). High fate = narrative cooperates (threads resolve when pushed).
  F = Σ √arcs × stageWeight × (1 + log(1 + investment)). Sustained threads earn superlinearly.
  ${fateMode}: ~${fateTarget} per scene. ${fateExtra}

WORLD — entity transformation (characters, locations, artifacts).
  W = ΔN_c + √ΔE_c. Continuity nodes mark permanent changes: traits, beliefs, capabilities, wounds.
  ${worldMode}: ~${worldTarget} per scene. ${worldExtra}

SYSTEM — rules and structures.
  S = ΔN + √ΔE. Knowledge nodes expand or constrain what's possible. Edges link rules together.
  ${systemMode}: ~${systemTarget} per scene. ${systemExtra}

SCALE: Beat ~100 words | Scene ~12 beats (~1200 words) | Arc ~4 scenes.
DENSITY: Earn mutations from prose — never invent. REUSE existing node IDs.
`;
}
