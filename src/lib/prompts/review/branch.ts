/**
 * Branch Review Prompt
 *
 * Structural evaluation of a full branch based on scene summaries only.
 * Produces per-scene verdicts (ok / edit / merge / cut / insert / move)
 * and an overall critique.
 */

export interface BranchReviewPromptParams {
  title: string;
  description: string;
  threadBlock: string;
  sceneBlock: string;
  sceneCount: number;
  /** Fully-formatted guidance block (already includes heading + trailing blank line). */
  guidanceBlock: string;
  /** Raw trimmed guidance text, used for the closing reminder. */
  guidance?: string;
}

export function buildBranchReviewPrompt(p: BranchReviewPromptParams): string {
  return `You are a story editor reviewing a complete branch of a serialized narrative. You have ONLY scene summaries — no prose. Your job is to evaluate structural quality.
${p.guidanceBlock}

TITLE: "${p.title}"
DESCRIPTION: ${p.description}

THREADS:
${p.threadBlock}

SCENE SUMMARIES (${p.sceneCount} scenes):
${p.sceneBlock}

Evaluate this branch on these dimensions:

1. **STRUCTURE** — Does the sequence build? Are arcs well-shaped or do they fizzle?
2. **PACING** — Is there breathing room between high-intensity moments? Any flatlines?
3. **REPETITION** — Are beats, locations, or character reactions repeating? Name the stale patterns.
4. **CHARACTER** — Who changes? Who is stuck in a loop? Who appears but does nothing?
5. **THREADS** — Which threads are advancing well? Which are stagnating or being ignored?
6. **THEME** — What is this story about underneath the plot? Is it interrogating anything?

For EACH scene, assign a verdict. These map to concrete operations:
- "ok" — scene works. No changes needed.
- "edit" — scene should exist but needs revision. You may change ANYTHING: POV, location, participants, summary, events, deltas. Use for: wrong POV for this moment, repetitive beats that need variation, weak execution, continuity breaks, scenes that need restructuring while keeping their place in the timeline.
- "merge" — this scene covers the same beat as another and should be ABSORBED into the stronger one. You MUST specify "mergeInto" with the target scene ID. The two become one denser scene. Use when two scenes advance the same thread with similar dramatic shape.
- "cut" — scene is redundant and adds nothing. The story is tighter without it.
- "move" — scene content is correct but it is in the wrong position. You MUST specify "moveAfter" with the scene ID it should follow. The scene is lifted from its current position and re-planted there with NO content changes. Use for sequencing adjustments: a scene that reveals information too early, a payoff arriving before its setup, an out-of-order character introduction. Combine with "edit" by using "move" on the scene and a separate "edit" if content also needs changing.
- "insert" — a new scene should be CREATED at this position to fill a pacing gap, advance a stalled thread, or add a missing beat. You MUST specify "insertAfter" with the scene ID it should follow, or "START" to insert before the very first scene. The "reason" field is the generation brief: describe what happens, who is involved, the location, which threads advance, and any specific beats. The "sceneId" should be a placeholder like "INSERT-1", "INSERT-2", etc.

STRUCTURAL OPERATIONS GUIDE:
- If 5 scenes cover the same beat: keep the strongest as "ok", merge 1-2 into it, cut the rest.
- If a thread has 8 scenes but only 3 distinct beats: merge within each beat, cut the remainder.
- If a scene is premature but otherwise good: use "move" to place it after the scene that sets it up.
- If a payoff arrives before its setup: "move" the payoff to after the setup scene.
- If a scene needs to be BOTH moved AND revised: "move" it to the right position, and also mark it "edit" — wait, these are separate verdicts. Instead: move it, and in the reason note that content also needs changing so the editor can apply a follow-up edit pass.
- If there is a missing transition, an unearned payoff, or a thread that needs setup before it pays off: insert a new scene at the right position.
- "mergeInto" must reference a scene that is NOT itself cut/merged/moved.
- "moveAfter" must reference a scene that is NOT itself being cut/merged. It can reference an INSERT placeholder ID if the scene should follow a newly inserted scene.
- Prefer merge over cut when the weaker scene has unique content worth absorbing.
- Prefer move over cut+insert when the scene content is sound — moving preserves the exact prose.
- Use insert sparingly — only when the gap is structural, not cosmetic.

CONTINUITY: scenes that contradict established knowledge, misplace characters, or leak information should be flagged — not left at "ok".

COMPRESSION: where a scene duplicates another in purpose without meaningful variation, prefer merge or cut. The right compression is register-dependent — accumulative, list-based, refrain-based, and polyphonic works resist compression by design; dramatic and serialised works usually reward it. Use judgement; do not apply a fixed percentage.

CROSS-SCENE CONSISTENCY — CRITICAL:
All edits are applied in parallel. Each edited scene only sees its own reason — it does NOT see what other scenes are being changed. This means YOU must encode cross-scene continuity into each reason explicitly.

Before writing reasons, mentally map the full set of changes you're proposing and identify causal chains:
1. List every scene getting a non-"ok" verdict.
2. For each such scene, ask: does this change affect something an upstream or downstream scene references? Does it resolve a contradiction that another edit also touches?
3. Write reasons so that each edit is self-sufficient — the scene being edited can be rewritten correctly even without knowing what other scenes look like.

RULES FOR EDIT REASONS:
- If scene A's edit removes, adds, or changes a fact that scene B depends on, scene B's reason MUST say: "Note: [scene A] is being edited to [specific change] — this scene must be consistent with that."
- If two scenes currently contradict each other, decide which edit is authoritative and make the other move to it explicitly in its reason.
- If a scene is being cut or merged, any surviving scene that referenced it must have a reason that accounts for its removal.
- Edit reasons are instructions to a rewriter who cannot see the rest of the branch. Make them complete.

Return JSON:
{
  "overall": "3-5 paragraph critique. Name scenes, characters, patterns. End with the thematic question.",
  "sceneEvals": [
    { "sceneId": "S-001", "verdict": "ok|edit|merge|cut|move|insert", "reason": "For edit: 1-3 sentences instructing the rewriter. For move: one sentence explaining why this position is wrong and where it belongs. For insert: full generation brief. For merge/cut: one sentence.", "mergeInto": "S-002 (merge only)", "moveAfter": "S-003 (move only — exact scene ID this scene should follow)", "insertAfter": "S-004 or START (insert only — scene ID, INSERT placeholder, or START for before first scene)" }
  ],
  "repetitions": ["pattern 1", "pattern 2"],
  "thematicQuestion": "The human question underneath the plot"
}

Every scene must appear in sceneEvals. Use the EXACT scene IDs shown above (e.g. "S-001", not "1" or "scene 1").${p.guidance?.trim() ? `\n\nREMINDER — The author specifically asked you to address: "${p.guidance.trim()}". Your overall critique and scene verdicts MUST reflect this. Any scene affected by this guidance MUST NOT be marked "ok".` : ''}`;
}
