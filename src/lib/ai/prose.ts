import type { NarrativeState, Scene, ProseScore } from '@/types/narrative';
import { callGenerate, SYSTEM_PROMPT } from './api';
import { WRITING_MODEL, ANALYSIS_MODEL } from '@/lib/constants';
import { parseJson } from './json';
import { sceneContext, deriveLogicRules, sceneScale } from './context';

export async function scoreSceneProse(
  narrative: NarrativeState,
  scene: Scene,
  currentProse: string,
): Promise<ProseScore> {
  const sceneBlock = sceneContext(narrative, scene);
  const logicRules = deriveLogicRules(narrative, scene);

  const planBlock = scene.plan
    ? `\nSCENE PLAN (grade against this beat structure):\n${scene.plan}\n`
    : '';

  const logicBlock = logicRules.length > 0
    ? `\nLOGICAL CONSTRAINTS (check all are satisfied):\n${logicRules.map((r) => `  - ${r}`).join('\n')}\n`
    : '';

  const systemPrompt = `You are a literary editor grading prose quality. You return ONLY valid JSON — no markdown, no commentary.`;

  const prompt = `SCENE CONTEXT:
${sceneBlock}
${planBlock}${logicBlock}

CURRENT PROSE:
${currentProse}

Score the prose on these 6 dimensions (1-10 each):
- voice: POV discipline, character distinctiveness, consistent narrative voice
- pacing: scene breathes, beats land with proper weight, no rushing or dragging
- dialogue: subtext-rich, character-specific speech patterns, no filler exchanges
- sensory: grounded in concrete physical detail, body-first interiority
- mutation_coverage: all thread shifts, knowledge changes, and relationship mutations are dramatised (not summarised)
- overall: holistic quality considering all dimensions

For each dimension, provide a brief critique (1-2 sentences) explaining the score — what works and what doesn't.

Return JSON:
{
  "score": {
    "overall": 7,
    "voice": 8,
    "pacing": 6,
    "dialogue": 7,
    "sensory": 5,
    "mutation_coverage": 8
  },
  "critique": "Voice (8): Strong POV lock on Kael, distinct internal rhythm. Pacing (6): The middle sags — the market confrontation needs tighter beats. Dialogue (7): Subtext works in the alley scene but the tavern exchange feels expository. Sensory (5): Too much telling of emotions, not enough physical grounding. Mutation coverage (8): Thread shifts land well. Overall (7): Solid foundation but the sensory and pacing weaknesses hold it back."
}`;

  const raw = await callGenerate(prompt, systemPrompt, 2000, 'scoreSceneProse', ANALYSIS_MODEL);
  const parsed = parseJson(raw, 'scoreSceneProse') as Record<string, unknown>;

  // Handle both {score: {...}, critique: "..."} and flat {overall: 7, voice: 8, ..., critique: "..."} shapes
  const scoreObj = (parsed.score && typeof parsed.score === 'object' ? parsed.score : parsed) as Record<string, unknown>;
  const critique = (typeof parsed.critique === 'string' ? parsed.critique : typeof (scoreObj as Record<string, unknown>).critique === 'string' ? (scoreObj as Record<string, unknown>).critique : undefined) as string | undefined;

  return {
    overall: Number(scoreObj.overall) || 0,
    voice: Number(scoreObj.voice) || 0,
    pacing: Number(scoreObj.pacing) || 0,
    dialogue: Number(scoreObj.dialogue) || 0,
    sensory: Number(scoreObj.sensory) || 0,
    mutation_coverage: Number(scoreObj.mutation_coverage) || 0,
    critique,
  };
}

export async function rewriteSceneProse(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  currentProse: string,
  analysis: string,
): Promise<string> {
  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const sceneBlock = sceneContext(narrative, scene);
  const logicRules = deriveLogicRules(narrative, scene);

  // Get neighboring prose for continuity
  const prevId = sceneIdx > 0 ? resolvedKeys[sceneIdx - 1] : null;
  const nextId = sceneIdx < resolvedKeys.length - 1 ? resolvedKeys[sceneIdx + 1] : null;
  const prevProse = prevId ? narrative.scenes[prevId]?.prose : null;
  const nextProse = nextId ? narrative.scenes[nextId]?.prose : null;
  const prevEnding = prevProse ? prevProse.split(/\n\n+/).slice(-1)[0]?.slice(-300) : null;
  const nextOpening = nextProse ? nextProse.split(/\n\n+/)[0]?.slice(0, 300) : null;

  const planBlock = scene.plan
    ? `\nSCENE PLAN (the rewrite must preserve this beat structure):\n${scene.plan}\n`
    : '';

  const logicBlock = logicRules.length > 0
    ? `\nLOGICAL CONSTRAINTS (all must be satisfied):\n${logicRules.map((r) => `  - ${r}`).join('\n')}\n`
    : '';

  const systemPrompt = `You are a literary editor and prose writer. Your task is to REWRITE prose based on the provided analysis. You return ONLY valid JSON — no markdown, no commentary.

Voice & style for the rewrite:
- Third-person limited, locked to the POV character's senses and interiority.
- Prose should feel novelistic, not summarised. Dramatise through action, dialogue, and sensory texture.
- Favour subtext over exposition. Let tension live in what characters don't say.
- Match the tone and genre of the world: ${narrative.worldSummary.slice(0, 200)}.
- Use straight quotes (" and '), never smart/curly quotes.
- CRITICAL: Do NOT open with weather, atmosphere, scent, or environmental description.
- Do NOT end with philosophical musings, rhetorical questions, or atmospheric fade-outs.`;

  const prompt = `SCENE CONTEXT:
${sceneBlock}
${planBlock}${logicBlock}${prevEnding ? `\nPREVIOUS SCENE ENDING:\n"...${prevEnding}"\n` : ''}${nextOpening ? `\nNEXT SCENE OPENING:\n"${nextOpening}..."\n` : ''}

CURRENT PROSE:
${currentProse}

ANALYSIS / CRITIQUE TO ADDRESS:
${analysis}

Rewrite the prose to address the weaknesses identified in the analysis above. Preserve all narrative beats, events, and plot points. The rewrite should feel like the same scene written better. Length should match the scene's needs — a quiet scene may be 800 words, a dense convergence scene 3000+. Err on the side of brevity for engagement; never pad. Do not artificially compress or expand the original — let the content dictate length.

Return JSON:
{
  "prose": "the full rewritten prose text"
}`;

  const scale = sceneScale(scene);
  const raw = await callGenerate(prompt, systemPrompt, scale.proseTokens + 500, 'rewriteSceneProse', WRITING_MODEL);
  const parsed = parseJson(raw, 'rewriteSceneProse') as { prose: string };

  return parsed.prose;
}

export async function scoreAndRewriteSceneProse(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  currentProse: string,
): Promise<{ prose: string; score: ProseScore }> {
  const score = await scoreSceneProse(narrative, scene, currentProse);
  const prose = await rewriteSceneProse(narrative, scene, resolvedKeys, currentProse, score.critique ?? 'General polish pass — improve all dimensions.');
  return { score, prose };
}

export type ChartAnnotation = {
  sceneIndex: number;
  force: 'payoff' | 'change' | 'variety';
  label: string;
};

export async function generateChartAnnotations(
  narrative: NarrativeState,
  forceData: { sceneIndex: number; sceneId: string; arcName: string; forces: { payoff: number; change: number; variety: number }; corner: string; summary: string; threadChanges: string[]; location: string; participants: string[] }[],
): Promise<ChartAnnotation[]> {
  const trajectoryLines = forceData.map((d) => {
    const tc = d.threadChanges.length > 0 ? ` | ${d.threadChanges.join('; ')}` : '';
    return `[${d.sceneIndex + 1}] ${d.arcName} | ${d.corner} | P:${d.forces.payoff.toFixed(2)} C:${d.forces.change.toFixed(2)} V:${d.forces.variety.toFixed(2)} | @${d.location} | ${d.participants.join(', ')} | "${d.summary.slice(0, 80)}"${tc}`;
  }).join('\n');

  const systemPrompt = `You are a narrative analyst annotating force trajectory charts. Return ONLY valid JSON — no markdown, no code fences, no commentary.`;

  const prompt = `Analyze this narrative's force trajectory and generate annotations for notable moments.

NARRATIVE: "${narrative.title}" (${forceData.length} scenes)

SCENE-BY-SCENE DATA:
${trajectoryLines}

Annotate ONLY the peaks (local maxima) and troughs (local minima) of each force line. Look at the P/C/V values — find where each force hits its highest and lowest points, then label those.

Rules:
- ONLY peaks and troughs — nothing in between. If the value is rising or falling but hasn't reached an extremum, skip it.
- Include annotations for ALL THREE forces — payoff, change, AND variety
- ~4-6 annotations per force (the clearest peaks and troughs only)
- Labels: 2-5 words, specific to the story. Use character names, places, events.
- Never use generic labels like "high tension" or "calm period"
- Payoff peaks: danger, threats, betrayals. Troughs: safety, calm
- Change peaks: action bursts, dense reveals. Troughs: breathing room, reflection
- Variety peaks: new locations or characters (check @location and participants for first appearances). Troughs: same familiar cast/setting recurring

Return a JSON array:
[{"sceneIndex": 0, "force": "payoff", "label": "short annotation"}, ...]

sceneIndex is 0-based. force is one of: "payoff", "change", "variety".`;

  const raw = await callGenerate(prompt, SYSTEM_PROMPT, 4000, 'generateChartAnnotations', ANALYSIS_MODEL);

  // Parse JSON from response, handling potential markdown fences
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (a: unknown): a is ChartAnnotation =>
      typeof a === 'object' && a !== null &&
      'sceneIndex' in a && 'force' in a && 'label' in a &&
      typeof (a as ChartAnnotation).sceneIndex === 'number' &&
      ['payoff', 'change', 'variety'].includes((a as ChartAnnotation).force) &&
      typeof (a as ChartAnnotation).label === 'string'
  );
}
