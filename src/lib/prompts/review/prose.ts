/**
 * Prose Quality Review Prompt
 *
 * Evaluates written prose for voice consistency, craft, pacing,
 * continuity, repetition, and prose-profile compliance.
 */

export interface ProseReviewPromptParams {
  title: string;
  sceneCount: number;
  sceneBlocks: string;
  /** Fully-formatted prose-profile block, possibly empty. */
  profileBlock: string;
  /** Fully-formatted guidance block, possibly empty (includes leading newline). */
  guidanceBlock: string;
  guidance?: string;
}

export function buildProseReviewPrompt(p: ProseReviewPromptParams): string {
  return `You are a prose editor reviewing the actual written prose of a serialized narrative. You have both summaries and full prose text. Evaluate prose QUALITY — not plot structure.
${p.guidanceBlock}
${p.profileBlock ? `\n${p.profileBlock}\n` : ''}
TITLE: "${p.title}"

SCENES WITH PROSE (${p.sceneCount} scenes):
${p.sceneBlocks}

Evaluate the prose on these dimensions:

1. **VOICE CONSISTENCY** — Does the prose match the prose profile? Is the register, rhythm, and interiority consistent?
2. **CRAFT** — Sentence quality, word choice, show-don't-tell, dialogue naturalism, sensory grounding
3. **PACING** — Within-scene pacing. Are beats rushed or drawn out? Does the prose breathe?
4. **CONTINUITY** — Does the prose contradict established facts, character positions, or knowledge?
5. **REPETITION** — Repeated phrases, images, sentence structures, or verbal tics across scenes
6. **PROFILE COMPLIANCE** — If a prose profile is provided, does the prose follow its rules?

For EACH scene, assign a verdict:
- "ok" — prose is strong, no changes needed
- "edit" — prose needs revision. List specific, actionable issues.

Be specific in your issues. Not "dialogue feels off" but "Fang Yuan speaks in elaborate metaphors in lines 3-5, violating the 'plain, forgettable language' rule."

Return JSON:
{
  "overall": "2-4 paragraph prose quality critique. Name specific scenes and quote specific lines.",
  "sceneEvals": [
    { "sceneId": "S-001", "verdict": "ok|edit", "issues": ["specific issue 1", "specific issue 2"] }
  ],
  "patterns": ["recurring prose issue 1", "recurring prose issue 2"]
}

Every scene with prose must appear in sceneEvals. Use the exact scene IDs.${p.guidance?.trim() ? `\n\nREMINDER — The author specifically asked you to address: "${p.guidance.trim()}". Your overall critique and scene verdicts MUST reflect this.` : ''}`;
}
