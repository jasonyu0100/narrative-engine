import type { NarrativeState, PlanningQueue, PlanningPhase } from '@/types/narrative';
import { callGenerate, SYSTEM_PROMPT } from './ai/api';
import { branchContext } from './ai/context';

/**
 * Generate a completion report for a phase that has finished its scene allocation.
 * Returns an AI summary of what was achieved vs. what was planned.
 */
export async function generatePhaseCompletionReport(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  phase: PlanningPhase,
): Promise<string> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

  const prompt = `${ctx}

TASK: A planning phase has completed its allocated scenes. Analyse the narrative state and produce a completion report.

PHASE: "${phase.name}"
OBJECTIVE: ${phase.objective}
SCENES ALLOCATED: ${phase.sceneAllocation}
SCENES COMPLETED: ${phase.scenesCompleted}
${phase.constraints ? `CONSTRAINTS: ${phase.constraints}` : ''}

Produce a concise completion report covering:
1. Was the objective met? (Yes/Partially/No)
2. What was accomplished — key events, thread changes, character developments
3. What remains open or unresolved from this phase's goals

Keep the report to 3-5 sentences. Be specific — use character NAMES, location NAMES, and thread DESCRIPTIONS, never raw IDs.
Return ONLY the report text, no JSON or markup.`;

  const report = await callGenerate(prompt, SYSTEM_PROMPT, 500, 'planningEngine');
  return report.trim();
}

/**
 * Generate direction and constraints for a new active phase.
 * Takes into account the branch context, the phase objectives,
 * and what the world expansion just created.
 */
export async function generatePhaseDirection(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  phase: PlanningPhase,
  queue: PlanningQueue,
): Promise<{ direction: string; constraints: string }> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

  // Build completed phases summary
  const completedSummary = queue.phases
    .filter((p) => p.status === 'completed' && p.completionReport)
    .map((p, i) => `Phase ${i + 1} "${p.name}": ${p.completionReport}`)
    .join('\n');

  // Build remaining phases preview
  const remaining = queue.phases
    .filter((p) => p.status === 'pending')
    .map((p) => `"${p.name}" (${p.sceneAllocation} scenes): ${p.objective}`)
    .join('\n');

  const prompt = `${ctx}

TASK: Generate direction and constraints for the next planning phase.

CURRENT PHASE: "${phase.name}"
OBJECTIVE: ${phase.objective}
SCENES ALLOCATED: ${phase.sceneAllocation}
${phase.constraints ? `PHASE CONSTRAINTS: ${phase.constraints}` : ''}
${phase.worldExpansionHints ? `WORLD EXPANSION CONTEXT: ${phase.worldExpansionHints}` : ''}

${completedSummary ? `COMPLETED PHASES:\n${completedSummary}\n` : ''}
${remaining ? `UPCOMING PHASES:\n${remaining}\n` : ''}

Generate:
1. A DIRECTION prompt (2-4 sentences) — advisory guidance, not a script. Describe the FEEL and TRAJECTORY of this phase: what kind of energy it should have, which threads are ripe for development, what the reader should experience. Name characters and threads that are ready to move, but leave room for emergent storytelling. If artifacts already exist in the world, note which ones are ripe — who should acquire, use, or lose them. The world will be expanded before generation — the direction should guide how the new and existing elements interact.
2. A CONSTRAINTS prompt (1-2 sentences) — what must NOT happen yet. Protect threads, reveals, and artifact transfers that belong to later phases. Keep it to absolute prohibitions, not creative restrictions.

Use character NAMES, location NAMES, and thread DESCRIPTIONS — never raw IDs.

Return JSON:
{
  "direction": "...",
  "constraints": "..."
}`;

  const response = await callGenerate(prompt, SYSTEM_PROMPT, 500, 'planningEngine');

  try {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        direction: parsed.direction ?? '',
        constraints: parsed.constraints ?? '',
      };
    }
  } catch {
    // Fallback: use the phase objective as direction
  }

  return {
    direction: phase.objective,
    constraints: phase.constraints,
  };
}

/**
 * Generate a custom superstructure from a plan document.
 * The AI analyses the document and the current narrative state to produce
 * a sequence of phases with objectives, scene allocations, constraints,
 * and world expansion hints tailored to the story.
 */
export async function generateCustomPlan(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  planDocument: string,
): Promise<{ name: string; phases: { name: string; objective: string; sceneAllocation: number; constraints: string; worldExpansionHints: string }[] }> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

  const prompt = `${ctx}

TASK: Generate a narrative superstructure (planning queue) from the user's plan document below. This superstructure will guide book-length story generation phase by phase.

USER'S PLAN DOCUMENT:
${planDocument}

Analyse the plan document alongside the current narrative state. The superstructure is a RHYTHM FOR WORLD EXPANSION AND STORYTELLING — each phase says "expand the world this way, then tell stories in it." Phases are advisory, not scripts.

Produce a sequence of phases that:
1. Break the plan into 4-8 narrative phases
2. Each phase describes the FEEL and TRAJECTORY — what kind of energy, what the reader should experience, which threads are ripe for movement. Advisory, not prescriptive.
3. Scene allocations are 6-9 scenes per phase
4. Constraints protect threads and reveals that belong to later phases — absolute prohibitions only
5. World expansion hints describe what NEW elements the world needs for this phase — characters, locations, systems, lore. The world grows phase by phase; each expansion fuels the storytelling that follows.
6. Respect what already exists — don't re-establish what's built
7. Leave room for emergent storytelling. The AI will make specific scene-level decisions. Phases guide the current, not the individual waves.

Use character NAMES, location NAMES, and thread DESCRIPTIONS — never raw IDs.

Return JSON:
{
  "name": "A short name for this superstructure (2-5 words)",
  "phases": [
    {
      "name": "Phase name (2-4 words, like a chapter title)",
      "objective": "Advisory objective (2-4 sentences). The feel of this phase, which threads are ready to develop, what the reader should experience. Not a plot outline — a compass heading.",
      "sceneAllocation": 7,
      "constraints": "What must NOT happen yet (1 sentence). Protect later phases.",
      "worldExpansionHints": "New characters, locations, or world systems needed for this phase. Empty string if existing world is sufficient."
    }
  ]
}`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, 4000, 'generateCustomPlan');

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        name: parsed.name ?? 'Custom Plan',
        phases: (parsed.phases ?? []).map((p: Record<string, unknown>) => ({
          name: String(p.name ?? 'Untitled Phase'),
          objective: String(p.objective ?? ''),
          sceneAllocation: Number(p.sceneAllocation) || 15,
          constraints: String(p.constraints ?? ''),
          worldExpansionHints: String(p.worldExpansionHints ?? ''),
        })),
      };
    }
  } catch (err) {
    console.error('[generateCustomPlan] JSON parse failed:', err);
  }

  throw new Error('Failed to generate custom plan from document');
}

/**
 * Check if the active planning phase has reached its scene allocation.
 * Returns the phase if complete, null otherwise.
 */
export function checkPhaseCompletion(
  queue: PlanningQueue | undefined,
  newScenesAdded: number,
): PlanningPhase | null {
  if (!queue) return null;
  const active = queue.phases[queue.activePhaseIndex];
  if (!active || active.status !== 'active') return null;

  const updatedCompleted = active.scenesCompleted + newScenesAdded;
  if (updatedCompleted >= active.sceneAllocation) {
    return active;
  }
  return null;
}
