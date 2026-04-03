import type { NarrativeState, Scene, ProseFormat } from '@/types/narrative';
import { REASONING_BUDGETS } from '@/types/narrative';
import { callGenerate, callGenerateStream, SYSTEM_PROMPT } from './api';
import { WRITING_MODEL, ANALYSIS_MODEL, MAX_TOKENS_DEFAULT, MAX_TOKENS_SMALL } from '@/lib/constants';
import { parseJson } from './json';
import { sceneContext } from './context';

// ── Format-Specific Instructions ─────────────────────────────────────────────

export const FORMAT_INSTRUCTIONS: Record<ProseFormat, { systemRole: string; formatRules: string }> = {
  prose: {
    systemRole: 'You are a literary prose writer crafting a single scene for a novel.',
    formatRules: `Output format:
- Output ONLY prose. No scene titles, chapter headers, separators (---), or meta-commentary.
- Use straight quotes (" and '), never smart/curly quotes or typographic substitutions.
- Third-person limited POV, locked to the POV character's senses and interiority.
- Prose should feel novelistic — dramatise through action, dialogue, and sensory texture.`,
  },
  screenplay: {
    systemRole: 'You are a professional screenwriter writing in industry-standard screenplay format.',
    formatRules: `Screenplay format:
- Scene headings (sluglines): INT./EXT. LOCATION - DAY/NIGHT (all caps)
- Action lines: Present tense, third person, visual only. Describe what the camera SEES and HEARS.
- Character names: ALL CAPS centered before dialogue
- Dialogue: Centered under character name
- Parentheticals: Sparingly, in (lowercase), for delivery notes only
- No internal monologue unless marked (V.O.) for voiceover
- Action paragraphs: 3-4 lines max. White space matters.
- Sound cues in caps when dramatically important: A GUNSHOT. The SCREECH of tires.
- Interruptions shown with -- at the end of the cut-off line
- Use straight quotes (" and '), never smart/curly quotes.`,
  },
};



/**
 * Rewrite scene prose guided by analysis/critique.
 *
 * Lightweight: no logic context — focused on addressing the analysis feedback.
 * Neighboring prose provides continuity without full narrative context.
 */
export async function rewriteSceneProse(
  narrative: NarrativeState,
  scene: Scene,
  resolvedKeys: string[],
  currentProse: string,
  analysis: string,
  /** How many past scenes' full prose to include (0 = last paragraph only) */
  contextPast = 0,
  /** How many future scenes' full prose to include (0 = first paragraph only) */
  contextFuture = 0,
  /** Specific scene IDs to include as reference context (for distant chapters) */
  referenceSceneIds?: string[],
  /** Stream prose tokens as they arrive */
  onToken?: (token: string) => void,
): Promise<{ prose: string; changelog: string }> {
  const sceneIdx = resolvedKeys.indexOf(scene.id);
  const contextIndex = sceneIdx >= 0 ? sceneIdx : resolvedKeys.length - 1;
  const sceneBlock = sceneContext(narrative, scene, resolvedKeys, contextIndex);

  // Get neighboring prose for continuity
  let prevEnding: string | null = null;
  let nextOpening: string | null = null;
  let neighborContext = '';

  const hasExpandedContext = contextPast > 0 || contextFuture > 0;

  // Past scenes
  if (contextPast > 0) {
    const prevScenes: string[] = [];
    for (let i = 1; i <= contextPast; i++) {
      const pIdx = sceneIdx - i;
      if (pIdx < 0) break;
      const pId = resolvedKeys[pIdx];
      const pScene = pId ? narrative.scenes[pId] : null;
      if (pScene?.prose) {
        const pov = narrative.characters[pScene.povId]?.name ?? pScene.povId;
        const loc = narrative.locations[pScene.locationId]?.name ?? pScene.locationId;
        prevScenes.unshift(`--- SCENE ${pIdx + 1} (POV: ${pov}, @${loc}) ---\n${pScene.summary}\n\n${pScene.prose}`);
      }
    }
    if (prevScenes.length > 0) {
      neighborContext += `\nPRECEDING SCENES (${prevScenes.length} scene${prevScenes.length > 1 ? 's' : ''} before — read these to understand what has already happened):\n${prevScenes.join('\n\n')}\n`;
    }
  }

  // Future scenes
  if (contextFuture > 0) {
    const nextScenes: string[] = [];
    for (let i = 1; i <= contextFuture; i++) {
      const nIdx = sceneIdx + i;
      if (nIdx >= resolvedKeys.length) break;
      const nId = resolvedKeys[nIdx];
      const nScene = nId ? narrative.scenes[nId] : null;
      if (nScene?.prose) {
        const pov = narrative.characters[nScene.povId]?.name ?? nScene.povId;
        const loc = narrative.locations[nScene.locationId]?.name ?? nScene.locationId;
        nextScenes.push(`--- SCENE ${nIdx + 1} (POV: ${pov}, @${loc}) ---\n${nScene.summary}\n\n${nScene.prose}`);
      }
    }
    if (nextScenes.length > 0) {
      neighborContext += `\nFOLLOWING SCENES (${nextScenes.length} scene${nextScenes.length > 1 ? 's' : ''} after — read these to understand what must be set up):\n${nextScenes.join('\n\n')}\n`;
    }
  }

  // Default: ±1 paragraph (300 chars) when no expanded context
  if (!hasExpandedContext) {
    const prevId = sceneIdx > 0 ? resolvedKeys[sceneIdx - 1] : null;
    const nextId = sceneIdx < resolvedKeys.length - 1 ? resolvedKeys[sceneIdx + 1] : null;
    const prevProse = prevId ? narrative.scenes[prevId]?.prose : null;
    const nextProse = nextId ? narrative.scenes[nextId]?.prose : null;
    prevEnding = prevProse ? prevProse.split(/\n\n+/).slice(-1)[0]?.slice(-300) : null;
    nextOpening = nextProse ? nextProse.split(/\n\n+/)[0]?.slice(0, 300) : null;
  }

  // Pinned reference scenes (distant chapters selected by the author)
  if (referenceSceneIds && referenceSceneIds.length > 0) {
    const refBlocks = referenceSceneIds
      .filter((id) => id !== scene.id)
      .map((id) => {
        const refScene = narrative.scenes[id];
        if (!refScene?.prose) return null;
        const idx = resolvedKeys.indexOf(id);
        const pov = narrative.characters[refScene.povId]?.name ?? refScene.povId;
        const loc = narrative.locations[refScene.locationId]?.name ?? refScene.locationId;
        return `--- SCENE ${idx + 1} [pinned reference] (POV: ${pov}, @${loc}) ---\n${refScene.summary}\n\n${refScene.prose}`;
      })
      .filter(Boolean);
    if (refBlocks.length > 0) {
      neighborContext += `\nPINNED REFERENCE SCENES (selected by the author — these are not adjacent but contain relevant context for this rewrite):\n${refBlocks.join('\n\n')}\n`;
    }
  }

  const hasVoiceOverride = !!narrative.storySettings?.proseVoice?.trim();
  const proseFormat = narrative.storySettings?.proseFormat ?? 'prose';
  const formatInstructions = FORMAT_INSTRUCTIONS[proseFormat];

  const systemPrompt = `${formatInstructions.systemRole} Your task is to REWRITE based on the provided analysis.${onToken ? '' : ' You return ONLY valid JSON — no markdown, no commentary.'}
${hasVoiceOverride
    ? `\nAUTHOR VOICE (this is the PRIMARY creative direction — all style defaults below are subordinate to this voice):
${narrative.storySettings!.proseVoice!.trim()}
`
    : ''}
${formatInstructions.formatRules}

Match the tone and genre of the world: ${narrative.worldSummary.slice(0, 200)}.`;

  const neighborBlock = neighborContext
    || `${prevEnding ? `\nPREVIOUS SCENE ENDING:\n"...${prevEnding}"\n` : ''}${nextOpening ? `\nNEXT SCENE OPENING:\n"${nextOpening}..."\n` : ''}`;

  const prompt = `SCENE CONTEXT:
${sceneBlock}
${neighborBlock}

CURRENT PROSE:
${currentProse}

ANALYSIS / CRITIQUE TO ADDRESS:
${analysis}

Rewrite the prose to FULLY ADDRESS every point in the analysis above. The analysis describes specific changes that MUST be implemented — do not merely acknowledge them cosmetically. If the analysis says a character should leave, they must leave in the prose. If it says an event should be removed, remove it entirely. If it says a detail should be added, add it concretely. The rewrite is not a polish pass — it is a structural edit guided by the analysis.

Preserve narrative deliveries, events, and plot points that the analysis does NOT ask you to change. Let the scene be as long or short as its content demands — say more in fewer words rather than padding to reach a length.${hasExpandedContext ? '\n\nYou have been given the FULL PROSE of neighboring scenes. Use this to ensure continuity — character state, spatial positions, injuries, emotional beats, and knowledge must flow consistently across scene boundaries. Do not repeat beats that already occurred in preceding scenes, and set up what following scenes expect.' : ''}

${onToken ? 'Write the full rewritten prose directly — no JSON, no markdown, no commentary. Start with the first word of the scene.' : 'Return JSON:\n{\n  "prose": "the full rewritten prose text"\n}'}`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  let prose: string;
  if (onToken) {
    const rawStream = await callGenerateStream(prompt, systemPrompt, onToken, MAX_TOKENS_DEFAULT, 'rewriteSceneProse', WRITING_MODEL, reasoningBudget);
    // LLM may ignore "no JSON" instruction — extract prose if it returned JSON
    prose = rawStream;
  } else {
    const raw = await callGenerate(prompt, systemPrompt, MAX_TOKENS_DEFAULT, 'rewriteSceneProse', WRITING_MODEL, reasoningBudget);
    const parsed = parseJson(raw, 'rewriteSceneProse') as { prose: string };
    prose = parsed.prose;
  }

  // Generate changelog in a separate cheap call — diffing old vs new
  let changelog = '';
  try {
    const changelogRaw = await callGenerate(
      `ANALYSIS ADDRESSED:\n${analysis.slice(0, 500)}\n\nSummarize the key changes in 3-5 bullet points. Each bullet: one sentence, plain description, no quotes. Focus on structural changes.\n\nReturn JSON with changelog as a SINGLE STRING with bullet points separated by newlines:\n{"changelog": "• Change one\\n• Change two\\n• Change three"}`,
      'You are a literary editor. Return ONLY valid JSON with changelog as a string.',
      800,
      'rewriteChangelog',
      ANALYSIS_MODEL,
      reasoningBudget,
    );
    const changelogParsed = parseJson(changelogRaw, 'rewriteChangelog') as { changelog: unknown };
    const raw = changelogParsed.changelog;
    // Normalize to string — handle array fallback for backwards compatibility
    if (typeof raw === 'string') {
      changelog = raw;
    } else if (Array.isArray(raw)) {
      changelog = raw.map((item: unknown) => typeof item === 'string' ? `• ${item}` : '').filter(Boolean).join('\n');
    } else {
      changelog = String(raw ?? '');
    }
  } catch {
    // Changelog generation is non-critical — don't fail the rewrite
  }

  return { prose: prose, changelog };
}

export type ChartAnnotation = {
  sceneIndex: number;
  force: 'payoff' | 'change' | 'knowledge';
  label: string;
};

export async function generateChartAnnotations(
  narrative: NarrativeState,
  forceData: { sceneIndex: number; sceneId: string; arcName: string; forces: { payoff: number; change: number; knowledge: number }; corner: string; summary: string; threadChanges: string[]; location: string; participants: string[] }[],
): Promise<ChartAnnotation[]> {
  const trajectoryLines = forceData.map((d) => {
    const tc = d.threadChanges.length > 0 ? ` | ${d.threadChanges.join('; ')}` : '';
    return `[${d.sceneIndex + 1}] ${d.arcName} | ${d.corner} | P:${d.forces.payoff.toFixed(2)} C:${d.forces.change.toFixed(2)} K:${d.forces.knowledge.toFixed(2)} | @${d.location} | ${d.participants.join(', ')} | "${d.summary.slice(0, 80)}"${tc}`;
  }).join('\n');

  const systemPrompt = `You are a narrative analyst annotating force trajectory charts. Return ONLY valid JSON — no markdown, no code fences, no commentary.`;

  const prompt = `Analyze this narrative's force trajectory and generate annotations for notable moments.

NARRATIVE: "${narrative.title}" (${forceData.length} scenes)

SCENE-BY-SCENE DATA:
${trajectoryLines}

Annotate ONLY the peaks (local maxima) and troughs (local minima) of each force line. Look at the P/C/K values — find where each force hits its highest and lowest points, then label those.

Rules:
- ONLY peaks and troughs — nothing in between. If the value is rising or falling but hasn't reached an extremum, skip it.
- Include annotations for ALL THREE forces — payoff, change, AND knowledge
- ~4-6 annotations per force (the clearest peaks and troughs only)
- Labels: 2-5 words, specific to the story. Use character names, places, events.
- Never use generic labels like "high tension" or "calm period"
- Payoff peaks: danger, threats, betrayals. Troughs: safety, calm
- Change peaks: action bursts, dense reveals. Troughs: breathing room, reflection
- Knowledge peaks: new locations or characters (check @location and participants for first appearances). Troughs: same familiar cast/setting recurring

Return a JSON array:
[{"sceneIndex": 0, "force": "payoff", "label": "short annotation"}, ...]

sceneIndex is 0-based. force is one of: "payoff", "change", "knowledge".`;

  const reasoningBudget = REASONING_BUDGETS[narrative.storySettings?.reasoningLevel ?? 'low'] || undefined;
  const raw = await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_SMALL, 'generateChartAnnotations', ANALYSIS_MODEL, reasoningBudget);

  // Parse JSON from response, handling potential markdown fences
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (a: unknown): a is ChartAnnotation =>
      typeof a === 'object' && a !== null &&
      'sceneIndex' in a && 'force' in a && 'label' in a &&
      typeof (a as ChartAnnotation).sceneIndex === 'number' &&
      ['payoff', 'change', 'knowledge'].includes((a as ChartAnnotation).force) &&
      typeof (a as ChartAnnotation).label === 'string'
  );
}
