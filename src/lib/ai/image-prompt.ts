/**
 * Suggest a refined imagePrompt for an entity (character, location, artifact)
 * by reading the entity's full world-graph continuity and distilling it into
 * a concise, literal visual description suitable for an image generator.
 */

import type { NarrativeState } from '@/types/narrative';
import { callGenerate, SYSTEM_PROMPT } from './api';
import { parseJson } from './json';
import { MAX_TOKENS_SMALL } from '@/lib/constants';
import { logError, logInfo } from '@/lib/system-logger';

export type ImagePromptEntityKind = 'character' | 'location' | 'artifact';

const COMPOSITION_BY_KIND: Record<ImagePromptEntityKind, string> = {
  character: 'single character portrait, head and shoulders, one subject only',
  location: 'wide establishing shot, architectural or landscape composition',
  artifact: 'single object study, isolated subject with clear silhouette',
};

export async function suggestImagePrompt(
  kind: ImagePromptEntityKind,
  narrative: NarrativeState,
  entityId: string,
): Promise<string> {
  let name: string;
  let descriptor: string;
  let worldNodes: { type: string; content: string }[];
  let existingPrompt: string | undefined;

  if (kind === 'character') {
    const c = narrative.characters[entityId];
    if (!c) throw new Error(`Character not found: ${entityId}`);
    name = c.name;
    descriptor = `role: ${c.role}`;
    worldNodes = Object.values(c.world?.nodes ?? {});
    existingPrompt = c.imagePrompt;
  } else if (kind === 'location') {
    const l = narrative.locations[entityId];
    if (!l) throw new Error(`Location not found: ${entityId}`);
    name = l.name;
    const parent = l.parentId ? narrative.locations[l.parentId]?.name : null;
    descriptor = `prominence: ${l.prominence}${parent ? `, nested inside ${parent}` : ''}`;
    worldNodes = Object.values(l.world?.nodes ?? {});
    existingPrompt = l.imagePrompt;
  } else {
    const a = narrative.artifacts[entityId];
    if (!a) throw new Error(`Artifact not found: ${entityId}`);
    name = a.name;
    descriptor = `significance: ${a.significance}`;
    worldNodes = Object.values(a.world?.nodes ?? {});
    existingPrompt = a.imagePrompt;
  }

  const continuityBlock = worldNodes.length > 0
    ? worldNodes.map((n, i) => `${i + 1}. [${n.type}] ${n.content}`).join('\n')
    : '(no world nodes — work from the name and descriptor alone)';

  const styleLine = narrative.imageStyle
    ? `\nVISUAL STYLE: ${narrative.imageStyle}. Your description should be compatible with this style without restating it verbatim.`
    : '';

  const existingLine = existingPrompt
    ? `\nEXISTING PROMPT (for reference — produce something better, not a copy):\n${existingPrompt}`
    : '';

  const prompt = `You are refining the image-generation prompt for a ${kind} in a narrative world.

ENTITY: ${name}
DESCRIPTOR: ${descriptor}
COMPOSITION: ${COMPOSITION_BY_KIND[kind]}
WORLD SUMMARY: ${narrative.worldSummary ?? '(no summary)'}${styleLine}${existingLine}

ENTITY CONTINUITY — every stable fact accumulated across the narrative. Distil the visually-expressible ones into the prompt:
${continuityBlock}

Produce a single concise image-generation prompt, 1-2 sentences, 25-60 words. Requirements:
- LITERAL physical details only — hair colour, build, clothing, architecture, lighting, materials, weather, object shape, wear patterns. No metaphors, no similes, no figurative language. Image generators interpret metaphors literally.
- Surface the entity's most visually distinctive continuity (scars, posture, signature garment, characteristic weathering, dominant colour, architectural era). Skip nodes that are purely psychological or narrative.
- Use CONCRETE nouns and adjectives. Avoid abstractions like "mysterious", "powerful", "enigmatic" — show them through physical signs instead.
- Do not include the entity's name, do not include text/signs/watermarks, do not narrate action — describe the subject at rest.
- Do not repeat the style directive verbatim.

Return JSON: {"imagePrompt": "..."}
`;

  logInfo('Suggesting image prompt', {
    source: 'other',
    operation: 'suggest-image-prompt',
    details: { kind, entityId, name, nodeCount: worldNodes.length },
  });

  let raw: string;
  try {
    raw = await callGenerate(prompt, SYSTEM_PROMPT, MAX_TOKENS_SMALL, 'suggestImagePrompt');
  } catch (err) {
    logError('suggestImagePrompt call failed', err, {
      source: 'other',
      operation: 'suggest-image-prompt',
    });
    throw err;
  }

  const parsed = parseJson(raw, 'suggestImagePrompt') as { imagePrompt?: unknown };
  const out = typeof parsed.imagePrompt === 'string' ? parsed.imagePrompt.trim() : '';
  if (!out) throw new Error('Model returned an empty imagePrompt');
  return out;
}
