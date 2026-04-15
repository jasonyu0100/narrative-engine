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

  const prompt = `You are a concept artist crafting a GROUNDED, DISTINCTIVE, ENCHANTED look for a ${kind} in a narrative world. Aim for the calibrated middle — memorable and specific, but plausible and suffused with quiet wonder. A real person / real place / real object rendered as if the world itself is charged with meaning.

ENCHANTED / ETHEREAL FEELING — the throughline for EVERY prompt:
- Every subject should feel like it belongs to a world where the mundane is faintly holy. Not magical effects; a QUALITY of the rendering. Reverent, luminous, hushed. Think Studio Ghibli stillness, Tarkovsky light, Renaissance portraiture, dream-logic realism — the subject caught in a moment that feels slightly unreal.
- Ethereal is carried through LIGHT, AIR, and STILLNESS, not through glowing effects. A dust-mote catching a shaft of window-light; a halo of soft backlight; a candle at the edge of frame; mist softening the middle distance; water beading on a polished surface; a piece of cloth just barely lifting in unseen air.
- The subject should look BEHELD — as if a painter has been waiting for this exact moment. Even a beggar or a ruined shed should feel witnessed, precious.
- This applies to ALL subjects: a cooking pot is enchanted if lit like a still life; a market square is enchanted if caught at dawn with long shadows; a scholar is enchanted if rendered with Vermeer's northern window.
- Do NOT achieve enchantment by adding fantasy effects. Achieve it by choosing the right light, the right hour, the right stillness.

ENTITY: ${name}
DESCRIPTOR: ${descriptor}
COMPOSITION: ${COMPOSITION_BY_KIND[kind]}
WORLD SUMMARY: ${narrative.worldSummary ?? '(no summary)'}${styleLine}${existingLine}

CONTINUITY — narrative facts about this entity. Use as LOOSE INSPIRATION for ONE visual hook; most nodes are psychological or historical, not visual brief. Do NOT try to depict every fact:
${continuityBlock}

WHAT WE WANT — a calibrated middle:
- ONE SIGNATURE DETAIL. A single distinctive feature that makes them recognisable — a scar, a signature garment, a particular posture, a specific hairstyle. Not three, not five. One.
- 1-2 SUPPORTING CHOICES from the stylisation menu below (palette OR materials OR aesthetic tradition). Restraint beats accumulation.
- GROUNDED PLAUSIBILITY. Whatever you describe must be something a real person could wear / a real place could look like / a real object could be. Even in a fantasy world, keep the rendering realistic.
- USE THE NAME. Lead with "${name} — " so the image generator can stylise against the name's cultural associations. Let the name pull clothing, materials, hair, and architectural details from that tradition.

WHAT WE REJECT — common failure modes:
- DO NOT invent supernatural effects not explicitly in continuity. No "pulsing script", no "luminous void eyes", no "phosphorescent motes drawn toward the subject", no "shadows that don't match the light". If continuity doesn't name it, it doesn't exist in the frame.
- DO NOT stack signature elements. A scar AND an asymmetric mask AND bleached eyebrows AND a glowing eye is a cosplay costume, not a character. Pick ONE and let the rest be supporting, ordinary detail.
- DO NOT use figurative language disguised as description. "Luminous void", "ancient script", "chillingly composed", "profound internal drain" are metaphors. Replace with plain physical fact ("dark eye", "pale skin", "still face") or delete.
- DO NOT write cinematic / narrative prose. "Hinting at..." "as if..." "almost..." are narrator voice, not visual description.

AURA — atmospheric signature, grounded but enchanted:
- One sentence of ambient atmosphere that carries the ETHEREAL throughline. Think weather, light quality, air — rendered with reverence, not special effects.
- CHARACTERS: dust motes suspended in a shaft of late-afternoon light, a single wisp of incense curling past the shoulder, breath faintly visible in cool morning air, petals drifting through an open lattice window, a halo of soft backlight against dim interior.
- LOCATIONS: dawn mist softening the middle distance, lantern-glow pooling on wet stone, incense haze hanging in still air, monsoon light filtered through wet silk, golden-hour shadows raking across a courtyard.
- ARTIFACTS: a single shaft of light across a polished surface, dust settled along a curve, faint condensation at the rim, a patina that catches the eye like a held breath, the object framed by darkness with one highlight.
- Choose light and air that make the subject feel BEHELD. A cook-fire smoke softens a face; dawn mist consecrates a market; candlelight dignifies a worn tool. Default tone: quiet, luminous, slightly unreal.
- Supernatural emissions only if continuity explicitly names them, and then described plainly and briefly.

STYLISATION MENU — pick 1 or 2, not more:
- PALETTE: 2-3 dominant colours + one accent. "Deep indigo, bone-white linen, one rust-red sash."
- MATERIALS: lacquered wood, bronze, silk, oiled leather, linen, raw wool, jade, basalt. Deliberate, culturally consistent.
- NAMED AESTHETIC TRADITION: anchor to a real-world style the generator recognises — Edo period, Heian court, Mughal miniature, Byzantine mosaic, brutalist concrete, Ming dynasty robes. Match the name's cultural palette.
- SILHOUETTE PROPORTION: a single push — long sleeves, tall collar, shaved head, a heavy cloak. Mild exaggeration only.
- TEXTURE CONTRAST: matte cloth against polished metal, weathered stone beside smooth glaze.

HARD CONSTRAINTS (image generators are literal):
- No metaphors, no similes. Every clause must be something a camera could photograph.
- No abstractions ("mysterious", "powerful", "wise", "ancient"). Replace with plain physical sign, or delete.
- No text/signs/watermarks in the image, no narrated action. Subject at rest.
- Do NOT restate the visual style directive verbatim.

OUTPUT: 2-3 sentences, 40-70 words. Structure:
1. "${name} — " then the ONE signature detail with silhouette/face/build.
2. Supporting clothing/materials/palette (1-2 choices from the menu, described plainly).
3. One short sentence of grounded aura.

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
