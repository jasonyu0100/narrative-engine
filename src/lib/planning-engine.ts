import type { NarrativeState, PlanningQueue, PlanningPhase } from '@/types/narrative';
import { REASONING_BUDGETS } from '@/types/narrative';
import { callGenerate, callGenerateStream, SYSTEM_PROMPT } from './ai/api';
import { branchContext } from './ai/context';
import { MAX_TOKENS_SMALL, MAX_TOKENS_DEFAULT, MAX_TOKENS_LARGE } from '@/lib/constants';

/** Coerce a value to string — stringify objects/arrays instead of returning "[object Object]" */
function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (v == null) return fallback;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v, null, 2);
}

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
${phase.sourceText ? `\nSOURCE MATERIAL (the original plan for this phase):\n${phase.sourceText}` : ''}

Produce a concise completion report covering:
1. Was the objective met? (Yes/Partially/No)
2. What was accomplished — key events, thread changes, character developments
3. What remains open or unresolved from this phase's goals

Keep the report to 3-5 sentences. Be specific — use character NAMES, location NAMES, and thread DESCRIPTIONS, never raw IDs.
Return ONLY the report text, no JSON or markup.`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const report = await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_SMALL, 'planningEngine', undefined, reasoningBudget);
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
  onReasoning?: (token: string) => void,
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
${phase.structuralRules ? `\nSTRUCTURAL RULES (these are mechanical requirements — enforce them in every arc):\n${phase.structuralRules}` : ''}
${phase.worldExpansionHints ? `WORLD EXPANSION CONTEXT: ${phase.worldExpansionHints}` : ''}
${phase.sourceText ? `\nSOURCE MATERIAL (verbatim from plan document — this is the authoritative reference for this phase's content, plot beats, prose style, character details, and structural guidance):\n${phase.sourceText}` : ''}

${completedSummary ? `COMPLETED PHASES:\n${completedSummary}\n` : ''}
${remaining ? `UPCOMING PHASES:\n${remaining}\n` : ''}

${phase.sourceText ? `The SOURCE MATERIAL is your primary reference. Follow its SEQUENTIAL ORDER — start from the FIRST beat and work forward. The source's key beats (major plot points, character moments, reveals) are anchors that must happen in order. Between them, you have creative flexibility to add setup, character development, or pacing.

PACING: This phase has ${phase.sceneAllocation} scenes total. An arc is typically 3-4 scenes. Your initial direction covers the FIRST ARC ONLY — approximately ${Math.min(4, phase.sceneAllocation)} scenes. That means you should cover roughly ${Math.round(Math.min(4, phase.sceneAllocation) / phase.sceneAllocation * 100)}% of the source material's beats. Do NOT try to cover everything — leave the majority of beats for subsequent arcs. Course correction after each arc will advance the cursor forward through the source material. If the source has chapter breaks, one chapter = one arc is a good heuristic.

Write a direction covering the FIRST ARC's beats. The direction is the LAST THING scene generation will see — it won't have access to the source text. So QUOTE the source directly: copy prose samples, dialogue snippets, structural techniques (montage, vignettes, timeskip), tone guidance, and internal monologue style verbatim into the direction. Each beat gets one paragraph that:
  • Quotes or closely paraphrases the source beat with the source's own character names, locations, actions
  • Names the POV character and location
  • Includes any prose style, format, or technique guidance from the source in the source's own words
  • Notes which threads advance

This is a SINGLE STRING of prose paragraphs. Do not use arrays or numbered lists.

The constraints should protect later phases and LATER BEATS within this phase that are not yet being covered — draw prohibitions from the source material's own structure (e.g. if the source says "she does not yet know," that's a constraint). Do NOT invent constraints that contradict the source material.` : `Generate:
1. A DIRECTION prompt (2-4 sentences) — advisory guidance, not a script. Describe the FEEL and TRAJECTORY of this phase: what kind of energy it should have, which threads are ripe for development, what the reader should experience. Name characters and threads that are ready to move, but leave room for emergent storytelling. If artifacts already exist in the world, note which ones are ripe — who should acquire, use, or lose them. The world will be expanded before generation — the direction should guide how the new and existing elements interact. The direction must be compatible with the STRUCTURAL RULES above — if the rules demand convergence density or protagonist gravity, the direction must create conditions for those mechanics to fire.
2. A CONSTRAINTS prompt (1-2 sentences) — what must NOT happen yet. Protect threads, reveals, and artifact transfers that belong to later phases. Keep it to absolute prohibitions, not creative restrictions.`}

Use character NAMES, location NAMES, and thread DESCRIPTIONS — never raw IDs.

CRITICAL: Both "direction" and "constraints" MUST be plain strings, not arrays or objects. All detail goes inside the string as prose.

Return JSON:
{
  "direction": "single string with all direction detail as prose paragraphs",
  "constraints": "single string with all constraints as prose"
}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const maxTokens = phase.sourceText ? MAX_TOKENS_DEFAULT : MAX_TOKENS_SMALL;
  const response = onReasoning
    ? await callGenerateStream(prompt, SYSTEM_PROMPT, () => {}, maxTokens, 'planningEngine', undefined, reasoningBudget, onReasoning)
    : await callGenerate(prompt, SYSTEM_PROMPT, maxTokens, 'planningEngine', undefined, reasoningBudget);

  try {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        direction: asString(parsed.direction),
        constraints: asString(parsed.constraints),
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
  onReasoning?: (token: string) => void,
): Promise<{ name: string; phases: { name: string; objective: string; sceneAllocation: number; constraints: string; structuralRules?: string; worldExpansionHints: string; sourceText?: string }[] }> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

  const prompt = `${ctx}

TASK: Convert the following story plan document into a narrative generation queue (planning phases). This queue will guide automated scene-by-scene generation phase by phase.

USER'S PLAN DOCUMENT:
${planDocument}

CRITICAL RULES:

1. FOLLOW THE DOCUMENT'S OWN STRUCTURE. Each major section, part, or act in the document becomes exactly one phase. Do NOT collapse multiple sections into one phase, and do NOT invent phases not grounded in the document. If the document has 6 parts, you emit 6 phases. If it has 3 acts, 3 phases.

2. DERIVE SCENE ALLOCATIONS FROM CHAPTER COUNT. The document may reference chapters explicitly ("Chapters 1-3", "Chapter 12") or implicitly (a montage chapter, a prologue). Count the chapters per section and compute:
   - sceneAllocation = chapter_count × 2 (each chapter generates ~2 scenes)
   - Prologues and single chapters: 2 scenes minimum
   - Montage / timeskip sections: 3 scenes
   - Large chapter blocks (6+): cap at 12 scenes
   - Minimum per phase: 2 scenes

3. sourceText IS THE MOST IMPORTANT FIELD. For each phase, extract the COMPLETE verbatim text from the plan document that corresponds to this phase. Include ALL of it — plot beats, prose samples, character notes, structural guidance, dialogue excerpts, internal monologue examples, pacing notes, everything. Do not summarise, do not compress, do not paraphrase. Copy the full section text exactly as written. This is the source of truth that will guide scene generation. If the document has a 2,000-word section for a phase, the sourceText should be 2,000 words.

4. objective is a SHORT compass heading (2-4 sentences) for display purposes. The detail lives in sourceText.

5. STRUCTURAL RULES are mechanical requirements — convergence density, payoff density, scene function variety, protagonist gravity. Be specific and enforceable.

6. WORLD EXPANSION HINTS: identify what new characters, locations, or systems the world needs before this phase can be told.

7. CONSTRAINTS protect threads and reveals belonging to later phases — absolute prohibitions only. One sentence.

8. Use character NAMES, location NAMES, and thread DESCRIPTIONS — never raw IDs.

Return JSON:
{
  "name": "A short name for this superstructure (2-5 words)",
  "phases": [
    {
      "name": "Phase name matching the document section title (2-6 words)",
      "objective": "Short compass heading (2-4 sentences) for display. The feel and trajectory of this phase.",
      "sourceText": "VERBATIM extraction of the COMPLETE section from the plan document that maps to this phase. Include every word — plot beats, prose samples, character notes, dialogue, pacing guidance, structural notes. This is the generation source of truth. Do NOT summarise.",
      "sceneAllocation": 4,
      "constraints": "What must NOT happen yet (1 sentence). Protect later phases.",
      "structuralRules": "Mechanical requirements across 4 dimensions: CONVERGENCE, PAYOFF DENSITY, SCENE FUNCTION VARIETY, PROTAGONIST GRAVITY. Be specific and enforceable.",
      "worldExpansionHints": "New characters, locations, or world systems needed for this phase that don't yet exist in the world. Empty string if existing world is sufficient."
    }
  ]
}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = onReasoning
    ? await callGenerateStream(prompt, SYSTEM_PROMPT, () => {}, MAX_TOKENS_LARGE, 'generateCustomPlan', undefined, reasoningBudget, onReasoning)
    : await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_LARGE, 'generateCustomPlan', undefined, reasoningBudget);

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        name: parsed.name ?? 'Custom Plan',
        phases: (parsed.phases ?? []).map((p: Record<string, unknown>) => ({
          name: asString(p.name, 'Untitled Phase'),
          objective: asString(p.objective),
          sceneAllocation: Number(p.sceneAllocation) || 4,
          constraints: asString(p.constraints),
          structuralRules: p.structuralRules ? asString(p.structuralRules) : undefined,
          worldExpansionHints: asString(p.worldExpansionHints),
          sourceText: p.sourceText ? asString(p.sourceText) : undefined,
        })),
      };
    }
  } catch (err) {
    console.error('[generateCustomPlan] JSON parse failed:', err);
  }

  throw new Error('Failed to generate custom plan from document');
}

/**
 * Generate a rich narrative plan document from the current story state.
 * This produces a structured treatment (like a story bible) that can then be
 * fed into generateCustomPlan to create phases with sourceText.
 */
export async function generatePlanDocument(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  onReasoning?: (token: string) => void,
): Promise<string> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

  const prompt = `${ctx}

TASK: You are a narrative architect designing the next major movement of this story. Analyse the current narrative state — characters, threads, world knowledge, scene history, thread maturity, and unresolved tensions — and write a DETAILED narrative treatment for what comes next.

Write a plan document in the style of a story bible or arc treatment. This document will be used as the authoritative reference for automated scene generation, so it must be rich and specific.

YOUR DOCUMENT MUST INCLUDE:

1. **PHILOSOPHY** — 2-3 paragraphs on what this phase of the story is about thematically. What questions are being interrogated? What tensions are at their ripest?

2. **PARTS/SECTIONS** — Divide the plan into 4-8 distinct sections, each representing a narrative movement. For each section:
   - A title that captures the energy (e.g. "The Accumulation", "The Crossing")
   - Which chapters/scenes it covers and how many
   - A detailed treatment: what happens, who drives it, where it takes place
   - Specific character beats — what each major character does, learns, loses, or becomes
   - Thread progression — which threads advance and how (status transitions)
   - Key moments — specific scenes described in enough detail that a writer could execute them
   - Prose guidance — tone, register, internal monologue style, pacing notes

3. **CHARACTER NOTES** — For each major character involved, describe their arc through this plan. What do they want? What do they get? How do they change?

4. **STRUCTURAL NOTES** — Pacing guidance, where to accelerate, where to breathe. Thread intercutting strategy. Any technical ambitions (montage chapters, POV switches, parallel timelines).

RULES:
- Use character NAMES and location NAMES from the narrative context, never raw IDs.
- Be specific about plot beats — not "something bad happens" but "Kael discovers the seal was broken from the inside, implicating Mira."
- Include prose samples or dialogue snippets where they help convey tone.
- Each section should have enough detail that it could be used as a standalone writing brief.
- The plan should feel like it was written by someone who deeply understands this story and its characters.

Write the document as markdown prose. Do NOT return JSON — return the raw plan document text.`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'medium'] || undefined;
  if (onReasoning) {
    return await callGenerateStream(prompt, SYSTEM_PROMPT, () => {}, MAX_TOKENS_LARGE, 'generatePlanDocument', undefined, reasoningBudget, onReasoning);
  }
  return await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_LARGE, 'generatePlanDocument', undefined, reasoningBudget);
}

/**
 * Generate a lightweight outline from the current story state.
 * Produces phases with objectives, scene allocations, and constraints — no sourceText.
 * The generation system uses these as dynamic guidelines with creative freedom.
 */
export async function generateOutline(
  narrative: NarrativeState,
  resolvedKeys: string[],
  currentIndex: number,
  onReasoning?: (token: string) => void,
): Promise<{ name: string; phases: { name: string; objective: string; sceneAllocation: number; constraints: string; worldExpansionHints: string }[] }> {
  const ctx = branchContext(narrative, resolvedKeys, currentIndex);

  const prompt = `${ctx}

TASK: Analyse the current narrative state and design a story outline — a sequence of phases that guide automated scene generation. This is a DYNAMIC OUTLINE, not a rigid script. Each phase describes the feel, trajectory, and objectives, leaving room for emergent storytelling.

For each phase, consider:
- What narrative energy should this phase have? (building tension, release, discovery, intimacy, chaos)
- Which threads are ripe for development? Which characters need screen time?
- What must happen before the story can move to the next phase?
- What must NOT happen yet? (protect reveals, climaxes, and resolutions for later phases)

RULES:
- Design 3-6 phases that tell a complete arc or a satisfying volume
- Scene allocations should total 20-40 scenes for a complete arc, 15-25 for a volume
- Use character NAMES and location NAMES, never raw IDs
- Objectives should describe the FEEL and TRAJECTORY, not prescribe specific scenes
- Constraints should be absolute prohibitions only — protect later-phase content

Return JSON:
{
  "name": "Short name for this outline (2-5 words)",
  "phases": [
    {
      "name": "Phase name (2-6 words)",
      "objective": "2-4 sentences describing the energy, trajectory, and what this phase should achieve. Name characters and threads that are ripe.",
      "sceneAllocation": 6,
      "constraints": "What must NOT happen yet (1-2 sentences). Protect later phases.",
      "worldExpansionHints": "New characters, locations, or systems needed. Empty string if existing world suffices."
    }
  ]
}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  let raw: string;
  if (onReasoning) {
    raw = await callGenerateStream(prompt, SYSTEM_PROMPT, () => {}, MAX_TOKENS_DEFAULT, 'generateOutline', undefined, reasoningBudget, onReasoning);
  } else {
    raw = await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_DEFAULT, 'generateOutline', undefined, reasoningBudget);
  }

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        name: parsed.name ?? 'AI Outline',
        phases: (parsed.phases ?? []).map((p: Record<string, unknown>) => ({
          name: asString(p.name, 'Untitled Phase'),
          objective: asString(p.objective),
          sceneAllocation: Number(p.sceneAllocation) || 4,
          constraints: asString(p.constraints),
          worldExpansionHints: asString(p.worldExpansionHints),
        })),
      };
    }
  } catch (err) {
    console.error('[generateOutline] JSON parse failed:', err);
  }

  throw new Error('Failed to generate outline');
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
