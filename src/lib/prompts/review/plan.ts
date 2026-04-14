/**
 * Plan Quality Review Prompt
 *
 * Continuity review of beat plans — verifies beats are internally consistent,
 * cross-scene continuous, and deliver the declared deltas.
 */

export interface PlanReviewPromptParams {
  title: string;
  threadBlock: string;
  charBlock: string;
  sceneCount: number;
  sceneBlocks: string;
  /** Fully-formatted guidance block, possibly empty (includes leading newline). */
  guidanceBlock: string;
  guidance?: string;
}

export function buildPlanReviewPrompt(p: PlanReviewPromptParams): string {
  return `You are a continuity editor reviewing beat plans. Each scene has a beat-by-beat blueprint and declared deltas. Your job: verify the BEATS are internally consistent, cross-scene continuous, and actually deliver the declared deltas.
${p.guidanceBlock}

TITLE: "${p.title}"

THREADS:
${p.threadBlock}

CHARACTER KNOWLEDGE:
${p.charBlock || '(none tracked yet)'}

SCENES WITH BEAT PLANS (${p.sceneCount} scenes):
${p.sceneBlocks}

For each scene, check:
1. **BEAT-TO-DELTA ALIGNMENT** — Do the beats actually show what the declared deltas claim? If a thread delta says T-03 escalates, which specific beat delivers that escalation? If no beat does, flag it.
2. **CROSS-PLAN CONTINUITY** — Does this plan's opening beats follow logically from the previous plan's closing beats? Character positions, emotional states, knowledge, injuries.
3. **INTERNAL BEAT LOGIC** — Do beats within the plan follow causally? Does beat 5 depend on something beat 3 established?
4. **CHARACTER KNOWLEDGE** — Does any beat have a character act on information they haven't learned yet in prior scenes or earlier beats?
5. **SPATIAL/TEMPORAL** — Are characters where they should be? Can all beats plausibly occur in one scene?

Verdicts:
- "ok" — beats are consistent, deltas are earned by specific beats
- "edit" — issues found. Each issue must reference a specific beat number and what's wrong.

Be precise: "Beat 4 declares Fang Yuan recognises the seal pattern, but no prior beat or scene establishes he has seen this pattern before" — not "continuity error."

Return JSON:
{
  "overall": "2-3 paragraph analysis focused on beat quality and delta alignment.",
  "sceneEvals": [
    { "sceneId": "S-001", "verdict": "ok|edit", "issues": ["Beat N: specific issue"] }
  ],
  "patterns": ["recurring issue across multiple plans"]
}

Every scene with a plan must appear.${p.guidance?.trim() ? `\n\nREMINDER — The author asked you to address: "${p.guidance.trim()}".` : ''}`;
}
