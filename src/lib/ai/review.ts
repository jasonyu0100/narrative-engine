import type { NarrativeState, PlanningPhase } from '@/types/narrative';
import { DEFAULT_STORY_SETTINGS, REASONING_BUDGETS } from '@/types/narrative';
import { callGenerate, SYSTEM_PROMPT } from './api';
import { branchContext } from './context';
import { buildThreadHealthPrompt, buildCompletedBeatsPrompt } from './prompts';
import { parseJson } from './json';
import { MAX_TOKENS_SMALL, MAX_TOKENS_DEFAULT } from '@/lib/constants';

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
${phase.sourceText ? `\nSOURCE MATERIAL (verbatim from plan document — this is the AUTHORITATIVE reference for what should happen in this phase. Your direction MUST serve the plot beats, character actions, and structural guidance described here. Quote specific details from it.):\n${phase.sourceText}` : ''}
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
${phase.sourceText ? `- SOURCE MATERIAL ANCHOR: The SOURCE MATERIAL above is your PRIMARY reference — more authoritative than the phase objective. Your process:
  1. Read the SOURCE MATERIAL carefully. List every distinct plot beat, character action, and structural moment it describes.
  2. Compare against the completed scene summaries in the branch context above. Mark each source beat as COVERED or UNCOVERED.
  3. Your direction MUST target the NEXT UNCOVERED beats — quote or closely paraphrase them. Do not abstract or summarise — use the source's own language, character names, locations, and specific actions.
  4. If the source includes prose samples, dialogue, internal monologue style, or pacing guidance, reference these explicitly in your direction (e.g. "Fang Yuan's internal monologue should catalogue each person in the room — their ambitions, expiry dates, usefulness — as black comedy").
  5. Do NOT invent constraints that contradict the source material. If the source says a character goes somewhere or meets someone, do not constrain them from doing so.
- PHASE OBJECTIVE ANCHOR: The phase objective is your secondary compass. Every direction you write must serve that objective, but the source material provides the specific beats that fulfil it.` : `- PHASE OBJECTIVE ANCHOR: The phase objective above is your north star. Every direction you write must serve that objective. If the objective says "establish the alliance," every arc's direction must either build toward establishing it, deal with obstacles to it, or pay it off. You may adjust tactics (different characters, different mechanisms) but you must NOT drift away from the objective. If the objective is partially achieved, the direction must address the remaining parts.`}
- Do NOT be analytical or explanatory. This is a directive, not a report. Use imperative voice: "Fang Yuan diverts the grain. Mo Bei Liu calls an emergency session."
- Use thread IDs and target statuses alongside character names — technical precision helps. e.g. "Fang Yuan diverts the grain, pushing T-41 to critical."

Write direction, constraints, and scene budget:

${phase.sourceText ? `- Direction: A BEAT-SPECIFIC prose blueprint for the next arc, drawn from the SOURCE MATERIAL. For each scene the arc should produce, write a paragraph that:
  • Quotes or closely paraphrases the specific source beat being realized
  • Names the POV character, location, and participants
  • References prose style or internal monologue guidance from the source if applicable
  • Specifies thread transitions (e.g. T-XX dormant → active)
  Be as detailed as the source material warrants — if 5 distinct beats remain, describe all 5 as separate paragraphs.` : `- Direction (3-5 sentences): Imperative orders for the next arc. Each sentence: [Character] [does specific thing] [at specific place] [causing specific consequence] [thread target]. At least one sentence must describe a COLLISION — two threads forced into the same scene.`}

- Constraints (3-5 sentences): What MUST NOT happen. Ban re-staging or re-confirming any beat already delivered. Ban confirmation scenes. Ban stale patterns. Protect threads meant for later phases. Each constraint must name a specific thread, character, or beat.${phase.sourceText ? ' Do NOT invent constraints that contradict the source material.' : ''}

- Scene budget (object): For each active thread, how many scenes it should appear in during the next arc. Threads that collide share a budget slot.

All three fields MUST be plain strings in the JSON — never arrays or objects. Write all detail as prose inside the string.

Return JSON:
{
  "direction": "prose string — ${phase.sourceText ? 'beat-specific scene blueprint, as long as needed' : '3-5 imperative sentences'}",
  "constraints": "prose string — 3-5 sentences with specific prohibitions",
  "sceneBudget": {"T-XX": 2, "T-YY+T-ZZ": 1}
}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const maxTokens = phase.sourceText ? MAX_TOKENS_DEFAULT : MAX_TOKENS_SMALL;
  const raw = await callGenerate(prompt, SYSTEM_PROMPT, maxTokens, 'refreshDirection', undefined, reasoningBudget);

  try {
    const parsed = parseJson(raw, 'refreshDirection') as { direction?: string; constraints?: string; sceneBudget?: Record<string, number> };
    // Embed scene budget into direction text so it flows through to generateScenes
    // without needing a new StorySettings field
    let direction = parsed.direction ? String(parsed.direction) : currentDirection;
    if (parsed.sceneBudget && Object.keys(parsed.sceneBudget).length > 0) {
      const budgetLines = Object.entries(parsed.sceneBudget)
        .map(([threads, count]) => `  ${threads}: ${count} scene${count !== 1 ? 's' : ''}`)
        .join('\n');
      direction += `\n\nSCENE BUDGET (each thread gets this many scenes — no more):\n${budgetLines}`;
    }
    return {
      direction,
      constraints: parsed.constraints ? String(parsed.constraints) : currentConstraints,
      sceneBudget: parsed.sceneBudget,
    };
  } catch {
    return { direction: currentDirection, constraints: currentConstraints };
  }
}
