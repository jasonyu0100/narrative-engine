/**
 * Scene Prose Writer System Prompt — the prose-craft role.
 *
 * Combines the format-specific systemRole, the narrative title, the world
 * summary (as tone cue), an optional author voice override, format rules,
 * and an optional scene direction. Returns the assembled system prompt.
 */

import type { FormatInstructionSet } from "../prose/format-instructions";

export type SceneProseSystemPromptArgs = {
  formatInstructions: FormatInstructionSet;
  narrativeTitle: string;
  worldSummary: string;
  proseVoiceOverride?: string;
  direction?: string;
};

export function buildSceneProseSystemPrompt(
  args: SceneProseSystemPromptArgs,
): string {
  const {
    formatInstructions,
    narrativeTitle,
    worldSummary,
    proseVoiceOverride,
    direction,
  } = args;

  const voiceBlock = proseVoiceOverride?.trim()
    ? `\nAUTHOR VOICE (this is the PRIMARY creative direction — all craft defaults below are subordinate to this voice):
${proseVoiceOverride.trim()}
`
    : "";

  const directionBlock = direction?.trim()
    ? `\n\nSCENE DIRECTION:\n${direction.trim()}`
    : "";

  return `${formatInstructions.systemRole} You are crafting a single scene for "${narrativeTitle}".

Tone: ${worldSummary.slice(0, 200)}.
${voiceBlock}${formatInstructions.formatRules}${directionBlock}`;
}
