import type { NarrativeState, PlanningPhase } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { callGenerate, SYSTEM_PROMPT } from './api';
import { branchContext } from './context';
import { buildThreadHealthPrompt } from './prompts';
import { parseJson } from './json';

/**
 * Course-correct direction and constraints after each arc.
 *
 * This is the storytelling equivalent of a showrunner watching dailies
 * and adjusting the plan for tomorrow's shoot. The principles:
 *
 * 1. THREAD TENSION — are threads tightening toward each other or drifting apart?
 * 2. CHARACTER COST — has the protagonist paid for anything? Has anyone changed?
 * 3. RHYTHM — is the narrative breathing (varied density) or flatlined (every scene the same)?
 * 4. FRESHNESS — are we repeating patterns the reader has already seen?
 * 5. MOMENTUM — are we progressing toward the phase objective or circling?
 *
 * The output replaces the current direction and constraints, so each arc
 * generates under increasingly refined guidance.
 */
export async function refreshDirection(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  phase: PlanningPhase,
  currentDirection: string,
  currentConstraints: string,
): Promise<{ direction: string; constraints: string }> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

  const scenesRemaining = phase.sceneAllocation - phase.scenesCompleted;

  const prompt = `${ctx}

You are a showrunner reviewing dailies. An arc just wrapped. You have ${scenesRemaining} scenes left in this phase. Your job is to write the updated direction and constraints for the NEXT arc — building on what works, correcting what doesn't.

PHASE: "${phase.name}"
PHASE OBJECTIVE: ${phase.objective}
PROGRESS: ${phase.scenesCompleted} / ${phase.sceneAllocation} scenes
${phase.constraints ? `PHASE CONSTRAINTS: ${phase.constraints}` : ''}
CURRENT DIRECTION: ${currentDirection || '(none set)'}
CURRENT CONSTRAINTS: ${currentConstraints || '(none set)'}

${buildThreadHealthPrompt(narrative, resolvedKeys, currentIndex, narrative.storySettings?.threadResolutionSpeed ?? DEFAULT_STORY_SETTINGS.threadResolutionSpeed)}

Review the scene history above through these lenses:

1. THREAD TENSION — Look at the active threads. Are any two on a collision course? If not, the next arc MUST force one. Name which threads should collide and how. If threads are already colliding, push the collision harder.

2. CHARACTER COST — Has the protagonist faced a genuine setback they didn't choose? Have secondary characters changed or are they stuck in loops? If anyone has appeared 3+ times with the same reaction, they need a turn or they need to disappear. Name who needs to change and how.

3. RHYTHM — Were the recent scenes all the same density? The next arc needs contrast. If the last arc was dense and action-heavy, the next should open quiet before escalating. If the last was slow and observational, the next needs a sharp inciting moment early.

4. FRESHNESS — Are any patterns repeating? Same locations revisited without new payoff? Same character doing the same thing? Same sentence structures in summaries? Name the stale patterns and explicitly ban them.

5. MOMENTUM — With ${scenesRemaining} scenes left, what MUST happen before this phase ends? What can be cut? Are we on track for the phase objective or do we need to accelerate?

6. ARTIFACTS — Are any existing artifacts being ignored? Should one change hands, get used, or become contested? If an artifact exists and nobody cares about it, flag it as stale.

Write the updated direction and constraints as if you're briefing a writers' room:
- Direction: What the next arc should DO. Which characters, which threads, which locations. If artifacts exist, who should pursue or use them. Specific enough to guide, open enough to surprise.
- Constraints: What MUST NOT happen. Include stale patterns. Protect future phases.

Use character NAMES and thread DESCRIPTIONS, never IDs.

Return JSON:
{
  "direction": "2-4 sentences",
  "constraints": "1-2 sentences"
}`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, 600, 'refreshDirection');

  try {
    const parsed = parseJson(raw, 'refreshDirection') as { direction?: string; constraints?: string };
    return {
      direction: parsed.direction ?? currentDirection,
      constraints: parsed.constraints ?? currentConstraints,
    };
  } catch {
    return { direction: currentDirection, constraints: currentConstraints };
  }
}
