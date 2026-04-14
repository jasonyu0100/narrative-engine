/**
 * Arc Grouping Prompt
 *
 * Names a sequence of scene arcs based on their summaries. Each arc is a
 * narrative unit of ~4 scenes.
 */

export const ARC_GROUPING_SYSTEM =
  'You are a narrative analyst. Name story arcs based on scene summaries. Return only a JSON array of strings.';

export interface ArcGroup {
  sceneIndices: number[];
  summaries: string[];
}

export function buildArcGroupingPrompt(groups: ArcGroup[]): string {
  const block = groups
    .map((g, i) => {
      const first = g.sceneIndices[0] + 1;
      const last = g.sceneIndices[g.sceneIndices.length - 1] + 1;
      const scenes = g.summaries
        .map((s, j) => `  Scene ${g.sceneIndices[j] + 1}: ${s}`)
        .join('\n');
      return `ARC ${i + 1} (scenes ${first}-${last}):\n${scenes}`;
    })
    .join('\n\n');

  return `Name each arc based on its scene summaries. An arc is a narrative unit of ~4 scenes.

${block}

Return JSON array of arc names (one per arc, in order):
["Arc 1 Name", "Arc 2 Name", ...]

Rules:
- Each name should capture the arc's thematic thrust in 2-5 words
- Names should be evocative and specific, not generic ("The Betrayal at Dawn" not "Events")`;
}
