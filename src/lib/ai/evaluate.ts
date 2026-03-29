import type { NarrativeState, BranchEvaluation, SceneEval, SceneVerdict, Scene, Arc } from '@/types/narrative';
import { resolveEntry, isScene, REASONING_BUDGETS } from '@/types/narrative';
import { callGenerate, SYSTEM_PROMPT } from './api';
import { parseJson } from './json';
import { ANALYSIS_MODEL } from '@/lib/constants';

/**
 * Evaluate a branch by reading only scene summaries.
 *
 * Produces a per-scene verdict (ok / edit / rewrite / cut) and an overall
 * critique covering structure, pacing, repetition, character arcs, and theme.
 * Designed to be cheap — no prose, no mutations, just summaries + arc names.
 */
export async function evaluateBranch(
  narrative: NarrativeState,
  resolvedKeys: string[],
  branchId: string,
  /** Optional external guidance — e.g. paste from ChatGPT, editor notes, specific focus areas */
  guidance?: string,
): Promise<BranchEvaluation> {
  // Collect scenes with their arc context
  const sceneSummaries: { idx: number; id: string; arc: string; pov: string; location: string; summary: string }[] = [];
  for (let i = 0; i < resolvedKeys.length; i++) {
    const entry = resolveEntry(narrative, resolvedKeys[i]);
    if (!entry || !isScene(entry)) continue;
    const scene = entry as Scene;
    const arc = narrative.arcs[scene.arcId] as Arc | undefined;
    const pov = narrative.characters[scene.povId]?.name ?? scene.povId;
    const location = narrative.locations[scene.locationId]?.name ?? scene.locationId;
    sceneSummaries.push({
      idx: i + 1,
      id: scene.id,
      arc: arc?.name ?? 'standalone',
      pov,
      location,
      summary: scene.summary,
    });
  }

  if (sceneSummaries.length === 0) {
    return {
      id: `EVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: 'No scenes to evaluate.',
      sceneEvals: [],
      repetitions: [],
      thematicQuestion: '',
    };
  }

  // Build a compact scene list — summaries only
  const sceneBlock = sceneSummaries
    .map((s) => `[${s.idx}] ${s.id} | Arc: "${s.arc}" | POV: ${s.pov} | Loc: ${s.location}\n    ${s.summary}`)
    .join('\n');

  // Thread overview for context
  const threads = Object.values(narrative.threads);
  const threadBlock = threads
    .map((t) => `${t.id}: ${t.description} [${t.status}]`)
    .join('\n');

  const guidanceBlock = guidance?.trim()
    ? `

EXTERNAL GUIDANCE — The author or another reviewer has provided the following observations. You MUST incorporate these into your evaluation. Validate each point against the scene summaries. If the guidance identifies specific scenes as problematic, those scenes should be flagged as "edit" or "rewrite" unless you can specifically justify why they are fine. Add your own analysis on top — the guidance is additive, not a replacement for your own judgment.

---
${guidance.trim()}
---`
    : '';

  const prompt = `You are a story editor reviewing a complete branch of a serialized narrative. You have ONLY scene summaries — no prose. Your job is to evaluate structural quality.

TITLE: "${narrative.title}"
DESCRIPTION: ${narrative.description}

THREADS:
${threadBlock}

SCENE SUMMARIES (${sceneSummaries.length} scenes):
${sceneBlock}

${guidanceBlock}

Evaluate this branch on these dimensions:

1. **STRUCTURE** — Does the sequence build? Are arcs well-shaped or do they fizzle?
2. **PACING** — Is there breathing room between high-intensity moments? Any flatlines?
3. **REPETITION** — Are beats, locations, or character reactions repeating? Name the stale patterns.
4. **CHARACTER** — Who changes? Who is stuck in a loop? Who appears but does nothing?
5. **THREADS** — Which threads are advancing well? Which are stagnating or being ignored?
6. **THEME** — What is this story about underneath the plot? Is it interrogating anything?

For EACH scene, assign a verdict. These map to concrete operations:
- "ok" — scene works. No changes needed.
- "edit" — scene should exist but needs revision. You may change ANYTHING: POV, location, participants, summary, events, mutations. Use for: wrong POV for this moment, repetitive beats that need variation, weak execution, continuity breaks, scenes that need restructuring while keeping their place in the timeline.
- "merge" — this scene covers the same beat as another and should be ABSORBED into the stronger one. You MUST specify "mergeInto" with the target scene ID. The two become one denser scene. Use when two scenes advance the same thread with similar dramatic shape.
- "cut" — scene is redundant and adds nothing. The story is tighter without it.
- "defer" — good beat, wrong timing. This scene should be removed from the current arc and carried forward as a priority for the next arc. You MUST specify "deferredBeat" describing what should happen later. Use when a scene introduces something that would land better after other events have played out.

STRUCTURAL OPERATIONS GUIDE:
- If 5 scenes cover the same beat: keep the strongest as "ok", merge 1-2 into it, cut the rest.
- If a thread has 8 scenes but only 3 distinct beats: merge within each beat, cut the remainder.
- If a scene is fine but premature: defer it so the next arc can execute it with proper setup.
- "mergeInto" must reference a scene that is NOT itself cut/merged/deferred.
- Prefer merge over cut when the weaker scene has unique content worth absorbing.

CONTINUITY IS PARAMOUNT. Scenes that contradict established knowledge, misplace characters, or leak information must be flagged — never "ok".

COMPRESSION IS EXPECTED. Most branches benefit from losing 20-40% of their scenes through merges and cuts. Do not preserve scenes out of politeness.

Return JSON:
{
  "overall": "3-5 paragraph critique. Name scenes, characters, patterns. End with the thematic question.",
  "sceneEvals": [
    { "sceneId": "SC-001", "verdict": "ok|edit|merge|cut|defer", "reason": "one sentence", "mergeInto": "SC-XXX (merge only)", "deferredBeat": "description (defer only)" }
  ],
  "repetitions": ["pattern 1", "pattern 2"],
  "thematicQuestion": "The human question underneath the plot"
}

Every scene must appear in sceneEvals. Use the exact scene IDs from above.`;

  // Scale token budget: ~80 tokens per scene for verdicts + ~2000 for overall analysis
  const maxTokens = Math.min(16000, 2000 + sceneSummaries.length * 80);
  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = await callGenerate(prompt, SYSTEM_PROMPT, maxTokens, 'evaluateBranch', ANALYSIS_MODEL, reasoningBudget);

  try {
    const parsed = parseJson(raw, 'evaluateBranch') as {
      overall?: string;
      sceneEvals?: { sceneId?: string; verdict?: string; reason?: string; mergeInto?: string; deferredBeat?: string }[];
      repetitions?: string[];
      thematicQuestion?: string;
    };

    const validVerdicts = new Set<SceneVerdict>(['ok', 'edit', 'merge', 'cut', 'defer']);
    const sceneEvals: SceneEval[] = (parsed.sceneEvals ?? [])
      .filter((e) => e.sceneId && narrative.scenes[e.sceneId])
      .map((e) => {
        // Accept 'rewrite' from older models and map to 'edit'
        let rawVerdict = e.verdict as string;
        if (rawVerdict === 'rewrite') rawVerdict = 'edit';
        const verdict = validVerdicts.has(rawVerdict as SceneVerdict) ? (rawVerdict as SceneVerdict) : 'ok';
        const eval_: SceneEval = { sceneId: e.sceneId!, verdict, reason: e.reason ?? '' };
        if (verdict === 'merge') {
          // Validate merge target: must exist AND not itself be cut/merged/deferred
          const targetEval = parsed.sceneEvals?.find((t) => t.sceneId === e.mergeInto);
          const targetVerdict = targetEval?.verdict;
          const targetInvalid = !e.mergeInto || !narrative.scenes[e.mergeInto]
            || targetVerdict === 'cut' || targetVerdict === 'merge' || targetVerdict === 'defer';
          if (targetInvalid) {
            eval_.verdict = 'cut';
            eval_.reason = `${eval_.reason} (merge target invalid or also removed, converted to cut)`;
          } else {
            eval_.mergeInto = e.mergeInto;
          }
        }
        if (verdict === 'defer') {
          eval_.deferredBeat = e.deferredBeat ?? eval_.reason;
        }
        return eval_;
      });

    return {
      id: `EVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: parsed.overall ?? 'Evaluation failed to produce analysis.',
      sceneEvals,
      repetitions: parsed.repetitions ?? [],
      thematicQuestion: parsed.thematicQuestion ?? '',
    };
  } catch {
    return {
      id: `EVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: 'Evaluation parse failed. Raw response logged.',
      sceneEvals: sceneSummaries.map((s) => ({ sceneId: s.id, verdict: 'ok' as const, reason: 'Parse failed — defaulted' })),
      repetitions: [],
      thematicQuestion: '',
    };
  }
}
