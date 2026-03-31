import type { NarrativeState, BranchEvaluation, ProseEvaluation, ProseSceneEval, PlanEvaluation, PlanSceneEval, SceneEval, SceneVerdict, Scene, Arc } from '@/types/narrative';
import { resolveEntry, isScene, REASONING_BUDGETS } from '@/types/narrative';
import { callGenerate, SYSTEM_PROMPT } from './api';
import { parseJson } from './json';
import { ANALYSIS_MODEL, MAX_TOKENS_DEFAULT } from '@/lib/constants';

/**
 * Evaluate a branch by reading only scene summaries.
 *
 * Produces a per-scene verdict (ok / edit / merge / cut / insert / move) and an overall
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
    .map((s) => `${s.id} | Arc: "${s.arc}" | POV: ${s.pov} | Loc: ${s.location}\n    ${s.summary}`)
    .join('\n────────────────────────────────\n');

  // Thread overview for context
  const threads = Object.values(narrative.threads);
  const threadBlock = threads
    .map((t) => `${t.id}: ${t.description} [${t.status}]`)
    .join('\n');

  const guidanceBlock = guidance?.trim()
    ? `

PRIORITY GUIDANCE FROM THE AUTHOR — These are specific issues the author has identified. You MUST address every point below. For each issue raised, identify the specific scenes affected and flag them as "edit". Your overall critique MUST discuss these issues. Do not ignore any of them.

${guidance.trim()}`
    : '';

  const prompt = `You are a story editor reviewing a complete branch of a serialized narrative. You have ONLY scene summaries — no prose. Your job is to evaluate structural quality.
${guidanceBlock}

TITLE: "${narrative.title}"
DESCRIPTION: ${narrative.description}

THREADS:
${threadBlock}

SCENE SUMMARIES (${sceneSummaries.length} scenes):
${sceneBlock}

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
- "move" — scene content is correct but it is in the wrong position. You MUST specify "moveAfter" with the scene ID it should follow. The scene is lifted from its current position and re-planted there with NO content changes. Use for sequencing adjustments: a scene that reveals information too early, a payoff arriving before its setup, an out-of-order character introduction. Combine with "edit" by using "move" on the scene and a separate "edit" if content also needs changing.
- "insert" — a new scene should be CREATED at this position to fill a pacing gap, advance a stalled thread, or add a missing beat. You MUST specify "insertAfter" with the scene ID it follows. The "reason" field is the generation brief: describe what happens, who is involved, the location, which threads advance, and any specific beats. The "sceneId" should be a placeholder like "INSERT-1", "INSERT-2", etc.

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

CONTINUITY IS PARAMOUNT. Scenes that contradict established knowledge, misplace characters, or leak information must be flagged — never "ok".

COMPRESSION IS EXPECTED. Most branches benefit from losing 20-40% of their scenes through merges and cuts. Do not preserve scenes out of politeness.

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
    { "sceneId": "S-001", "verdict": "ok|edit|merge|cut|move|insert", "reason": "For edit: 1-3 sentences instructing the rewriter. For move: one sentence explaining why this position is wrong and where it belongs. For insert: full generation brief. For merge/cut: one sentence.", "mergeInto": "S-002 (merge only)", "moveAfter": "S-003 (move only — exact scene ID this scene should follow)", "insertAfter": "S-004 (insert only — exact scene ID or INSERT placeholder)" }
  ],
  "repetitions": ["pattern 1", "pattern 2"],
  "thematicQuestion": "The human question underneath the plot"
}

Every scene must appear in sceneEvals. Use the EXACT scene IDs shown above (e.g. "S-001", not "1" or "scene 1").${guidance?.trim() ? `\n\nREMINDER — The author specifically asked you to address: "${guidance.trim()}". Your overall critique and scene verdicts MUST reflect this. Any scene affected by this guidance MUST NOT be marked "ok".` : ''}`;

  const maxTokens = MAX_TOKENS_DEFAULT;
  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = await callGenerate(prompt, SYSTEM_PROMPT, maxTokens, 'evaluateBranch', ANALYSIS_MODEL, reasoningBudget);

  try {
    const parsed = parseJson(raw, 'evaluateBranch') as {
      overall?: string;
      sceneEvals?: { sceneId?: string; verdict?: string; reason?: string; mergeInto?: string; insertAfter?: string; moveAfter?: string }[];
      repetitions?: string[];
      thematicQuestion?: string;
    };

    const validVerdicts = new Set<SceneVerdict>(['ok', 'edit', 'merge', 'cut', 'insert', 'move']);
    const sceneEvals: SceneEval[] = (parsed.sceneEvals ?? [])
      .filter((e) => e.sceneId && (narrative.scenes[e.sceneId] || e.verdict === 'insert'))
      .map((e) => {
        const rawVerdict = e.verdict as string;
        const verdict = validVerdicts.has(rawVerdict as SceneVerdict) ? (rawVerdict as SceneVerdict) : 'ok';
        const eval_: SceneEval = { sceneId: e.sceneId!, verdict, reason: e.reason ?? '' };
        if (verdict === 'merge') {
          const targetEval = parsed.sceneEvals?.find((t) => t.sceneId === e.mergeInto);
          const targetVerdict = targetEval?.verdict;
          const targetInvalid = !e.mergeInto || !narrative.scenes[e.mergeInto]
            || targetVerdict === 'cut' || targetVerdict === 'merge' || targetVerdict === 'move';
          if (targetInvalid) {
            eval_.verdict = 'cut';
            eval_.reason = `${eval_.reason} (merge target invalid or also removed, converted to cut)`;
          } else {
            eval_.mergeInto = e.mergeInto;
          }
        }
        if (verdict === 'insert') {
          eval_.insertAfter = e.insertAfter;
        }
        if (verdict === 'move') {
          eval_.moveAfter = e.moveAfter;
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

// ── Prose Quality Evaluation ─────────────────────────────────────────────────

export async function evaluateProseQuality(
  narrative: NarrativeState,
  resolvedKeys: string[],
  branchId: string,
  guidance?: string,
): Promise<ProseEvaluation> {
  // Collect scenes that have prose
  const scenesWithProse: { id: string; pov: string; location: string; summary: string; prose: string; wordCount: number }[] = [];
  for (const key of resolvedKeys) {
    const entry = resolveEntry(narrative, key);
    if (!entry || !isScene(entry)) continue;
    const scene = entry as Scene;
    if (!scene.prose) continue;
    scenesWithProse.push({
      id: scene.id,
      pov: narrative.characters[scene.povId]?.name ?? scene.povId,
      location: narrative.locations[scene.locationId]?.name ?? scene.locationId,
      summary: scene.summary,
      prose: scene.prose,
      wordCount: scene.prose.split(/\s+/).length,
    });
  }

  if (scenesWithProse.length === 0) {
    return {
      id: `PEVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: 'No scenes with prose to evaluate.',
      sceneEvals: [],
      patterns: [],
    };
  }

  // Build prose profile context
  const profile = narrative.proseProfile;
  const profileBlock = profile
    ? `PROSE PROFILE (the prose should conform to this voice):
Register: ${profile.register} | Stance: ${profile.stance}${profile.tense ? ` | Tense: ${profile.tense}` : ''}${profile.sentenceRhythm ? ` | Rhythm: ${profile.sentenceRhythm}` : ''}${profile.interiority ? ` | Interiority: ${profile.interiority}` : ''}${profile.dialogueWeight ? ` | Dialogue: ${profile.dialogueWeight}` : ''}
${profile.devices?.length ? `Devices: ${profile.devices.join(', ')}` : ''}
${profile.rules?.length ? `Rules:\n${profile.rules.map((r) => `  - ${r}`).join('\n')}` : ''}${profile.antiPatterns?.length ? `\nAnti-patterns (flag violations):\n${profile.antiPatterns.map((a) => `  ✗ ${a}`).join('\n')}` : ''}`
    : '';

  const guidanceBlock = guidance?.trim()
    ? `\nPRIORITY GUIDANCE FROM THE AUTHOR — You MUST address every point below. For each issue raised, identify the specific scenes affected and flag them as "edit".\n\n${guidance.trim()}`
    : '';

  // Build scene blocks with prose
  const sceneBlocks = scenesWithProse.map((s) =>
    `[${s.id}] POV: ${s.pov} | Loc: ${s.location} | ${s.wordCount} words\nSummary: ${s.summary}\n${s.prose}`
  ).join('\n\n════════════════════════════════\n\n');

  const prompt = `You are a prose editor reviewing the actual written prose of a serialized narrative. You have both summaries and full prose text. Evaluate prose QUALITY — not plot structure.
${guidanceBlock}
${profileBlock ? `\n${profileBlock}\n` : ''}
TITLE: "${narrative.title}"

SCENES WITH PROSE (${scenesWithProse.length} scenes):
${sceneBlocks}

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

Every scene with prose must appear in sceneEvals. Use the exact scene IDs.${guidance?.trim() ? `\n\nREMINDER — The author specifically asked you to address: "${guidance.trim()}". Your overall critique and scene verdicts MUST reflect this.` : ''}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_DEFAULT, 'evaluateProseQuality', ANALYSIS_MODEL, reasoningBudget);

  try {
    const parsed = parseJson(raw, 'evaluateProseQuality') as {
      overall?: string;
      sceneEvals?: { sceneId?: string; verdict?: string; issues?: string[] }[];
      patterns?: string[];
    };

    const sceneEvals: ProseSceneEval[] = (parsed.sceneEvals ?? [])
      .filter((e) => e.sceneId && scenesWithProse.some((s) => s.id === e.sceneId))
      .map((e) => ({
        sceneId: e.sceneId!,
        verdict: (e.verdict === 'edit' ? 'edit' : 'ok') as ProseSceneEval['verdict'],
        issues: Array.isArray(e.issues) ? e.issues.filter((i): i is string => typeof i === 'string') : [],
      }));

    return {
      id: `PEVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: parsed.overall ?? 'Evaluation failed to produce analysis.',
      sceneEvals,
      patterns: parsed.patterns ?? [],
    };
  } catch {
    return {
      id: `PEVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: 'Prose evaluation parse failed. Raw response logged.',
      sceneEvals: scenesWithProse.map((s) => ({ sceneId: s.id, verdict: 'ok' as const, issues: ['Parse failed — defaulted'] })),
      patterns: [],
    };
  }
}

// ── Plan Quality Evaluation ─────────────────────────────────────────────────

export async function evaluatePlanQuality(
  narrative: NarrativeState,
  resolvedKeys: string[],
  branchId: string,
  guidance?: string,
): Promise<PlanEvaluation> {
  // Collect scenes that have beat plans
  const sceneList: Scene[] = [];
  for (const key of resolvedKeys) {
    const entry = resolveEntry(narrative, key);
    if (entry && isScene(entry)) sceneList.push(entry as Scene);
  }

  const scenesWithPlans: { id: string; pov: string; location: string; beats: string }[] = [];
  for (let i = 0; i < sceneList.length; i++) {
    const scene = sceneList[i];
    if (!scene.plan?.beats?.length) continue;
    scenesWithPlans.push({
      id: scene.id,
      pov: narrative.characters[scene.povId]?.name ?? scene.povId,
      location: narrative.locations[scene.locationId]?.name ?? scene.locationId,
      beats: scene.plan.beats.map((b, j) => `  ${j + 1}. [${b.fn}:${b.mechanism}] ${b.what} — anchor: "${b.anchor}"`).join('\n'),
    });
  }

  if (scenesWithPlans.length === 0) {
    return {
      id: `PLEVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: 'No scenes with beat plans to evaluate.',
      sceneEvals: [],
      patterns: [],
    };
  }

  const threadBlock = Object.values(narrative.threads)
    .map((t) => `${t.id}: ${t.description} [${t.status}]`).join('\n');

  const charBlock = Object.values(narrative.characters)
    .filter((c) => c.continuity?.nodes?.length)
    .map((c) => `${c.name}: ${c.continuity!.nodes.map((n) => `${n.type}: ${n.content}`).join('; ')}`)
    .join('\n');

  const guidanceBlock = guidance?.trim()
    ? `\nPRIORITY GUIDANCE FROM THE AUTHOR — You MUST address every point below.\n\n${guidance.trim()}`
    : '';

  const sceneBlocks = scenesWithPlans.map((s) =>
    `[${s.id}] POV: ${s.pov} | Loc: ${s.location}\n${s.beats}`
  ).join('\n\n────────────────────────────────\n\n');

  const prompt = `You are a continuity editor reviewing beat plans. Each scene has a beat-by-beat blueprint and declared mutations. Your job: verify the BEATS are internally consistent, cross-scene continuous, and actually deliver the declared mutations.
${guidanceBlock}

TITLE: "${narrative.title}"

THREADS:
${threadBlock}

CHARACTER KNOWLEDGE:
${charBlock || '(none tracked yet)'}

SCENES WITH BEAT PLANS (${scenesWithPlans.length} scenes):
${sceneBlocks}

For each scene, check:
1. **BEAT-TO-MUTATION ALIGNMENT** — Do the beats actually show what the declared mutations claim? If a thread mutation says T-03 escalates, which specific beat delivers that escalation? If no beat does, flag it.
2. **CROSS-PLAN CONTINUITY** — Does this plan's opening beats follow logically from the previous plan's closing beats? Character positions, emotional states, knowledge, injuries.
3. **INTERNAL BEAT LOGIC** — Do beats within the plan follow causally? Does beat 5 depend on something beat 3 established?
4. **CHARACTER KNOWLEDGE** — Does any beat have a character act on information they haven't learned yet in prior scenes or earlier beats?
5. **SPATIAL/TEMPORAL** — Are characters where they should be? Can all beats plausibly occur in one scene?

Verdicts:
- "ok" — beats are consistent, mutations are earned by specific beats
- "edit" — issues found. Each issue must reference a specific beat number and what's wrong.

Be precise: "Beat 4 declares Fang Yuan recognises the seal pattern, but no prior beat or scene establishes he has seen this pattern before" — not "continuity error."

Return JSON:
{
  "overall": "2-3 paragraph analysis focused on beat quality and mutation alignment.",
  "sceneEvals": [
    { "sceneId": "S-001", "verdict": "ok|edit", "issues": ["Beat N: specific issue"] }
  ],
  "patterns": ["recurring issue across multiple plans"]
}

Every scene with a plan must appear.${guidance?.trim() ? `\n\nREMINDER — The author asked you to address: "${guidance.trim()}".` : ''}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_DEFAULT, 'evaluatePlanQuality', ANALYSIS_MODEL, reasoningBudget);

  try {
    const parsed = parseJson(raw, 'evaluatePlanQuality') as {
      overall?: string;
      sceneEvals?: { sceneId?: string; verdict?: string; issues?: string[] }[];
      patterns?: string[];
    };

    const sceneEvals: PlanSceneEval[] = (parsed.sceneEvals ?? [])
      .filter((e) => e.sceneId && scenesWithPlans.some((s) => s.id === e.sceneId))
      .map((e) => ({
        sceneId: e.sceneId!,
        verdict: (e.verdict === 'edit' ? 'edit' : 'ok') as PlanSceneEval['verdict'],
        issues: Array.isArray(e.issues) ? e.issues.filter((i): i is string => typeof i === 'string') : [],
      }));

    return {
      id: `PLEVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: parsed.overall ?? 'Plan evaluation failed.',
      sceneEvals,
      patterns: parsed.patterns ?? [],
    };
  } catch {
    return {
      id: `PLEVAL-${Date.now().toString(36)}`,
      branchId,
      createdAt: new Date().toISOString(),
      overall: 'Plan evaluation parse failed.',
      sceneEvals: scenesWithPlans.map((s) => ({ sceneId: s.id, verdict: 'ok' as const, issues: ['Parse failed'] })),
      patterns: [],
    };
  }
}
