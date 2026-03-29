import type { NarrativeState, PlanningPhase } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS, REASONING_BUDGETS } from '@/types/narrative';
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
): Promise<{ direction: string; constraints: string; sceneBudget?: Record<string, number> }> {
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
${phase.structuralRules ? `STRUCTURAL RULES (mechanical requirements — audit compliance and enforce in next direction):\n${phase.structuralRules}` : ''}
CURRENT DIRECTION: ${currentDirection || '(none set)'}
CURRENT CONSTRAINTS: ${currentConstraints || '(none set)'}

${threadHealthBlock}

${buildCompletedBeatsPrompt(narrative, resolvedKeys, currentIndex)}

${PACING_DIRECTIVES[speed] ?? PACING_DIRECTIVES.moderate}

Review the scene history and thread velocity report through these lenses:

1. THREAD COMPRESSION AUDIT — For EACH active thread, answer:
   a) How many scenes has this thread appeared in so far?
   b) How many of those scenes changed its status (real transitions vs pulses)?
   c) What is the RATIO of scenes-to-transitions? A healthy ratio is 1:1 to 2:1. A ratio of 5:1 or worse means the thread is bloated — it's appearing in scenes without advancing.
   d) How many more beats (status transitions) does this thread need to reach resolution?
   e) Therefore, how many MORE scenes should this thread appear in? (Answer: same as beats remaining, plus at most 1 setup scene.)
   Name each thread, its ratio, and its scene budget for the next arc. If a thread's ratio is worse than 3:1, the direction MUST either compress it (force a transition) or cut it from the next arc entirely.

2. THREAD VELOCITY — Study the velocity report above. Which threads are over the benchmark? Which have high pulse ratios? Name specific threads, their current status, and what the next arc should do with them.

3. CHARACTER COST — Has the protagonist faced a genuine setback they didn't choose? Have secondary characters changed or are they stuck in loops? Name who needs to change and how.

4. RHYTHM — Were the recent scenes all the same density? The next arc needs contrast.

5. FRESHNESS — Are any patterns repeating? Same locations, same character reactions, same beats? Name the stale patterns and ban them. Pay special attention to: characters "watching in horror", characters "attempting to sabotage/intervene" repeatedly, characters having the same confrontation multiple times, investigation scenes that discover "more evidence" without changing the investigator's plan.

6. MOMENTUM — With ${scenesRemaining} scenes left, what MUST happen before this phase ends? Are we on track? If not, which threads can be accelerated and which can be abandoned?

7. ARTIFACTS — Are any existing artifacts being ignored or underused? Should one change hands?

8. STRUCTURAL COMPLIANCE — Audit the recent scenes against the STRUCTURAL RULES above (if any). Are convergence requirements being met? Is payoff density on target? Are scene functions varied or repeating? Is protagonist gravity maintained? Name specific violations and what the next arc must do to correct them.

9. THREAD COLLISION OPPORTUNITIES — Which threads share characters, locations, or resources? The next arc's direction should specify at least one scene where two threads collide — characters from different subplots in the same location, forced to deal with each other. This is how you compress: instead of Thread A getting 3 scenes and Thread B getting 3 scenes, you get 3-4 scenes where both advance simultaneously.

CRITICAL OUTPUT RULES:
- The direction you write REPLACES the current direction entirely. It is NOT appended. Write it as a fresh, standalone brief.
- Do NOT restate the previous direction. If the previous direction asked for something and it HAPPENED, move on. If it didn't happen, escalate the ask — don't repeat it.
- PHASE OBJECTIVE ANCHOR: The phase objective above is your north star. Every direction you write must serve that objective. If the objective says "establish the alliance," every arc's direction must either build toward establishing it, deal with obstacles to it, or pay it off. You may adjust tactics (different characters, different mechanisms) but you must NOT drift away from the objective. If the objective is partially achieved, the direction must address the remaining parts.
- Do NOT be analytical or explanatory. This is a directive, not a report. No "this will", "this should", "this move should" — use imperative voice: "Fang Yuan diverts the grain. Mo Bei Liu calls an emergency session."
- Keep it tight. 3-5 sentences maximum. Every sentence is a specific action with a named character, a verb, and a consequence.
- Use thread IDs and target statuses alongside character names — technical precision helps. e.g. "Fang Yuan diverts the grain, pushing T-41 to critical."

Write direction, constraints, and scene budget:
- Direction (3-5 sentences): Imperative orders for the next arc. Each sentence: [Character] [does specific thing] [at specific place] [causing specific consequence] [thread target]. At least one sentence must describe a COLLISION — two threads forced into the same scene.

MODEL DIRECTION (each sentence: character + action + location + consequence + thread target):
"Kael breaks the seal at the Sunken Vault, releasing the thing Mira spent three arcs trying to contain — forcing her to choose between hunting him or evacuating the Lowlands (T-12 → critical). Dara trades the cipher to the Voss Syndicate in exchange for passage across the Reach, not knowing the cipher is the key to the weapon Rhen is building (T-08 collides with T-15). Rhen's prototype detonates prematurely in the Foundry, killing two of his apprentices and destroying his credibility with the Council — his next move must be desperate, not calculated (T-15 → escalating, character cost). The grain shortage hits the Midwall district visibly: a riot, a child dead, a merchant hanged by a mob — making the resource thread impossible for any faction to ignore (T-03 → critical via civilian cost)."

- Constraints (3-5 sentences — equally important as direction): What MUST NOT happen. Reference the SPENT BEATS section above — explicitly ban re-staging, re-confirming, or re-witnessing any beat already delivered. Ban confirmation scenes (character reacts to known state without changing it). Ban stale patterns and protect threads meant for later phases. Each constraint must name a specific thread, character, or beat.

MODEL CONSTRAINTS (each sentence: specific prohibition + what to do instead):
"The seal is already broken — no more 'Kael investigates the vault' or 'tremors suggest the seal is weakening' scenes; the ONLY valid next beat is the consequence of what escaped (T-12). Mira's betrayal was revealed in scene 34 — do not write scenes where other characters discover or react to it unless their reaction triggers a new alliance or defection. No more 'Dara gathers information' scenes — she has the cipher, the next scene must show her USING it and paying a price. Rhen must not succeed at anything cleanly this arc — every action must have visible collateral that compounds his problems. No eavesdropping or overheard-conversation discoveries — the last three arcs used this mechanism; secrets must be revealed through action, confrontation, or evidence."

- Scene budget (object): For each active thread, specify how many scenes it should appear in during the next arc. This prevents thread bloat — a thread that needs 1 more beat gets 1 scene, not 4. Threads that should collide in the same scene share a budget slot.

MODEL SCENE BUDGET:
{"T-12": 2, "T-08+T-15": 2, "T-03": 1}
(This means: T-12 gets 2 scenes, T-08 and T-15 share 2 collision scenes, T-03 gets 1 scene = 5 total arc scenes, each advancing its thread.)

Return JSON:
{
  "direction": "3-5 imperative sentences with specific mechanisms and thread targets, including at least one thread collision",
  "constraints": "3-5 sentences with specific prohibitions referencing spent beats",
  "sceneBudget": {"T-XX": 2, "T-YY+T-ZZ": 1}
}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = await callGenerate(prompt, SYSTEM_PROMPT, 1200, 'refreshDirection', undefined, reasoningBudget);

  try {
    const parsed = parseJson(raw, 'refreshDirection') as { direction?: string; constraints?: string; sceneBudget?: Record<string, number> };
    // Embed scene budget into direction text so it flows through to generateScenes
    // without needing a new StorySettings field
    let direction = parsed.direction ?? currentDirection;
    if (parsed.sceneBudget && Object.keys(parsed.sceneBudget).length > 0) {
      const budgetLines = Object.entries(parsed.sceneBudget)
        .map(([threads, count]) => `  ${threads}: ${count} scene${count !== 1 ? 's' : ''}`)
        .join('\n');
      direction += `\n\nSCENE BUDGET (each thread gets this many scenes — no more):\n${budgetLines}`;
    }
    return {
      direction,
      constraints: parsed.constraints ?? currentConstraints,
      sceneBudget: parsed.sceneBudget,
    };
  } catch {
    return { direction: currentDirection, constraints: currentConstraints };
  }
}
