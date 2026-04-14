/**
 * Report Analysis Prompts
 *
 * System role + user prompt for generating the prose sections of a
 * narrative-analysis report. The writing sits between charts and tables;
 * keep each section short and register-appropriate.
 */

export const REPORT_SYSTEM = `You are writing the prose sections of a narrative analysis report. Your writing will be interspersed between charts, tables, and data visualisations — you are providing the interpretive commentary that makes the data meaningful.

Your audience may not have read the work. Introduce entities, settings, and key moments naturally as you reference them. A reader should be able to understand the work's structure and quality from your analysis alone.

STYLE:
- Match the analytic register to the work being analysed. For fiction: a critical-editorial voice. For research or essay: a reviewer's voice. For memoir or reportage: a reader's voice. In all cases: specific, grounded, short paragraphs (2-4 sentences).
- Ground every observation in specific scenes, entities, or moments by name.
- Focus on the three forces: Fate (thread resolutions / argument resolutions), World (entity transformation), and System (rule/mechanism deepening). Also discuss Delivery (the composite pacing curve).
- Do not treat Tension as a metric; it is derived and not a primary force.
- No markdown, no bullet points, no headers. Flowing prose.
- Use the present tense when describing what the work does.`;

/**
 * Section keys the LLM is expected to return. Kept alongside REPORT_ANALYSIS_PROMPT
 * so the prompt and the reducer consume the same source of truth. If a key is
 * added here, it must also be named in REPORT_ANALYSIS_PROMPT — the prompt test
 * guards that invariant.
 */
export const REPORT_SECTIONS = [
  'story_intro',
  'verdict',
  'delivery',
  'forces',
  'forces_over_time',
  'swing',
  'segments',
  'cast',
  'locations',
  'threads',
  'modes',
  'arcs',
  'propositions',
  'closing',
] as const;

export type ReportSectionKey = typeof REPORT_SECTIONS[number];

/**
 * User prompt for report generation. Takes a pre-built context block.
 */
export function REPORT_ANALYSIS_PROMPT(context: string): string {
  return `Write the prose commentary for a narrative analysis report. Each section will sit between data visualisations, so keep them concise — the charts do the heavy lifting, your words provide interpretation and story context.

${context}

Return a JSON object with these keys. Follow the length guidance exactly — these sit between visual elements and must not overwhelm them:

{
  "story_intro": "2-3 sentences introducing the story's premise, world, and central characters to someone who hasn't read it. Set the stage — what kind of story is this, what world does it inhabit, who are we following?",
  "verdict": "2-3 sentences. The headline: what score did this narrative earn, what shape and archetype define it, and what single force drives it most? This sits right after the score display.",
  "delivery": "1-2 short paragraphs. What does the delivery curve tell us about the reading experience? When does the story grip the reader vs let them breathe? Reference specific scenes where peaks and valleys occur and what happens in them.",
  "forces": "1-2 short paragraphs. How do Fate, World, and System interact in this story? Which dominates and why — name the specific threads, character arcs, or world-building that shapes each. What's the balance like?",
  "forces_over_time": "3-5 sentences. Commentary on the force decomposition chart — how do the three forces evolve over the story's timeline? Are there phases where one force takes over? Do they converge at key moments?",
  "swing": "3-5 sentences. What does the scene-to-scene volatility tell us? Is the pacing steady, varied, or erratic? Name a specific high-swing moment and what causes the dramatic shift between those consecutive scenes.",
  "segments": "A JSON array of strings, one per segment (the narrative is divided into segments at valleys). For each segment, write 2-4 sentences describing what happens in this stretch of the story, what force dominates it, and what the key moments are. Introduce characters and events naturally. Example: [\\"The opening segment establishes...\\", \\"The second segment shifts to...\\"]",
  "cast": "3-5 sentences. Who carries this narrative — protagonists in fiction, lead authors or investigators in non-fiction? How is POV distributed and does it serve the narrative? Name any anchor entities who are underused or overexposed relative to their importance.",
  "locations": "2-3 sentences. Do the narrative's settings do structural work — creating atmosphere, enabling plot, forcing entity interactions, grounding evidence — or are they interchangeable backdrops?",
  "threads": "1-2 short paragraphs. What are the backbone threads of this story, and how well are they serviced? Are any threads neglected or unresolved? Name specific threads and their current status.",
  "modes": "3-5 sentences. What does the mode distribution tell us about variety? If certain modes dominate, what does that mean in story terms — e.g. lots of 'Growth' means the story prioritises character development over revelation.",
  "arcs": "1-2 short paragraphs. How does quality evolve across arcs? Name specific arcs and what makes them strong or weak. Does the story improve, plateau, or decline?",
  "propositions": "1-2 short paragraphs. What does the proposition classification reveal about structural craft? Comment on anchor ratio (20-30% = strong), whether seeds convert to closes, and how the local/global balance shifts across arcs. A high foundation count means the thematic spine is strong. High ending count in later arcs means distant setups are paying off. Use the named labels (anchor/foundation, seed/foreshadow, close/ending, texture/atmosphere). Name specific structural patterns.",
  "closing": "2-3 sentences. What does this story do best, and what's the single most impactful change that would improve it? End on a forward-looking note."
}`;
}
