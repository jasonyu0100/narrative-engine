import type { NarrativeState, PlanningPhase } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { callGenerate, SYSTEM_PROMPT } from './api';
import { branchContext } from './context';
import { buildThreadHealthPrompt, buildCompletedBeatsPrompt } from './prompts';
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
  const speed = narrative.storySettings?.threadResolutionSpeed ?? DEFAULT_STORY_SETTINGS.threadResolutionSpeed;
  const threadHealthBlock = buildThreadHealthPrompt(narrative, resolvedKeys, currentIndex, speed);

  // Speed-specific pacing directives
  const PACING_DIRECTIVES: Record<string, string> = {
    fast: `PACING MODE: FAST — This is a thriller. The thread velocity report above is your dashboard.
- Threads over the benchmark MUST transition or resolve in the next arc. No exceptions.
- Every arc should push at least 2 threads forward by one phase. Zero-progress arcs are failures.
- If a thread has a high pulse ratio (being touched but not transitioning), force a transition NOW — either escalate it or kill it.
- Prioritise resolution: threads at "critical" should reach terminal status. Threads at "escalating" should hit "critical".
- Name specific threads that need to transition and what their target status should be.`,

    moderate: `PACING MODE: BALANCED — Steady progression matching published literature.
- Threads over the benchmark need attention — push them forward or consciously let them breathe for one more arc with justification.
- Each arc should advance at least 1 thread by one phase. Arcs that only pulse threads without transitions are losing momentum.
- Balance development with payoff: if the last 2 arcs were buildup, the next should deliver at least one transition to a higher phase.
- Name threads that are closest to their next transition and what should trigger it.`,

    slow: `PACING MODE: SLOW BURN — Threads develop gradually but must still progress.
- Threads well over the benchmark need a transition — even slow burns can't stagnate indefinitely.
- Each arc should deepen at least 1-2 threads through meaningful interaction, even if the status doesn't change. But if a thread has gone 15+ scenes without a transition, push it.
- Favour earned transitions over forced ones — the reader should feel the shift was inevitable, not arbitrary.
- Name threads that are ripe for their next phase and what would make the transition feel organic.`,
  };

  const prompt = `${ctx}

You are a showrunner reviewing dailies. An arc just wrapped. You have ${scenesRemaining} scenes left in this phase. Your job is to write the updated direction and constraints for the NEXT arc — building on what works, correcting what doesn't.

PHASE: "${phase.name}"
PHASE OBJECTIVE: ${phase.objective}
PROGRESS: ${phase.scenesCompleted} / ${phase.sceneAllocation} scenes
${phase.constraints ? `PHASE CONSTRAINTS: ${phase.constraints}` : ''}
CURRENT DIRECTION: ${currentDirection || '(none set)'}
CURRENT CONSTRAINTS: ${currentConstraints || '(none set)'}

${threadHealthBlock}

${buildCompletedBeatsPrompt(narrative, resolvedKeys, currentIndex)}

${PACING_DIRECTIVES[speed] ?? PACING_DIRECTIVES.moderate}

Review the scene history and thread velocity report through these lenses:

1. THREAD VELOCITY — Study the velocity report above. Which threads are over the benchmark? Which have high pulse ratios? Which are closest to their next phase? Name specific threads, their current status, and what the next arc should do with them. The velocity data is your primary input — use it.

2. CHARACTER COST — Has the protagonist faced a genuine setback they didn't choose? Have secondary characters changed or are they stuck in loops? Name who needs to change and how.

3. RHYTHM — Were the recent scenes all the same density? The next arc needs contrast.

4. FRESHNESS — Are any patterns repeating? Same locations, same character reactions, same beats? Name the stale patterns and ban them.

5. MOMENTUM — With ${scenesRemaining} scenes left, what MUST happen before this phase ends? Are we on track? If not, which threads can be accelerated and which can be abandoned?

6. ARTIFACTS — Are any existing artifacts being ignored or underused? Should one change hands?

CRITICAL OUTPUT RULES:
- The direction you write REPLACES the current direction entirely. It is NOT appended. Write it as a fresh, standalone brief.
- Do NOT restate the previous direction. If the previous direction asked for something and it HAPPENED, move on. If it didn't happen, escalate the ask — don't repeat it.
- Do NOT be analytical or explanatory. This is a directive, not a report. No "this will", "this should", "this move should" — use imperative voice: "Fang Yuan diverts the grain. Mo Bei Liu calls an emergency session."
- Keep it tight. 3-5 sentences maximum. Every sentence is a specific action with a named character, a verb, and a consequence.
- Use thread IDs and target statuses alongside character names — technical precision helps. e.g. "Fang Yuan diverts the grain, pushing T-41 to critical."

Write direction and constraints:
- Direction (3-5 sentences): Imperative orders for the next arc. Each sentence: [Character] [does specific thing] [at specific place] [causing specific consequence] [thread target].

BAD DIRECTION (vague, analytical, no mechanism):
"The resource scarcity should push clan politics to critical. Fang Zheng's suspicion continues to deepen. Bai Ning Bing's research accelerates. Threads need to progress toward resolution."

GOOD DIRECTION (specific actions, named characters, concrete mechanisms, thread targets):
"Mo Bei Liu calls an emergency elder session at the Clan Hall and demands Gu Yue Bo account for the missing grain — Gu Yue Bo must either confess weakness or blame Gu Yue Qing, and either choice fractures his coalition (T-04 → critical). Fang Zheng follows Fang Yuan to the Mountain Wilderness at night and witnesses him extracting wild Gu in ways that contradict his C-grade talent — this shifts Fang Zheng from passive unease to active investigation (T-03 → escalating). Bai Ning Bing deciphers the Flower Wine Monk's symbol in the ancient texts and connects it to the granary's inventory anomalies, giving her a lead that pulls her toward Qing Mao Mountain (T-06 → active). Fang Yuan's manipulation of the grain records must produce an unintended consequence he didn't foresee — a guard notices the discrepancy, or a transient character suffers visibly — so his arrogance costs something concrete."

- Constraints (2-4 sentences): What MUST NOT happen. Reference the SPENT BEATS section above — explicitly ban re-staging any beat that's already been delivered. Ban stale patterns and protect threads meant for later phases.

BAD CONSTRAINTS (generic, no specifics):
"Don't resolve major threads yet. Keep the pacing balanced."

GOOD CONSTRAINTS (precise prohibitions referencing spent beats):
"Do NOT restage the coup — Gu Yue Bo is already deposed, scenes must deal with the AFTERMATH. Fang Yuan's rebirth must remain secret — no character acquires concrete evidence of his past life. No repeat of the 'character overhears a conversation' beat — the last two arcs both used eavesdropping as a discovery mechanism. Bai Ning Bing's soul split has already been revealed — do not re-reveal it, show the consequences instead."

Return JSON:
{
  "direction": "3-5 imperative sentences with specific mechanisms and thread targets",
  "constraints": "2-3 sentences"
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
