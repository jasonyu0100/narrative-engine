/**
 * Semantic Reconciliation Prompt
 *
 * Phase 3b — nuanced merging of threads and system knowledge concepts.
 * Unlike named entities these are propositions; the default stance is to
 * preserve distinctions rather than collapse them.
 */

export const RECONCILE_SEMANTIC_SYSTEM = `You reconcile narrative threads and system knowledge concepts. These are propositions, not proper names — apparent duplicates frequently encode real nuance. Your default stance is to PRESERVE. Only merge two items when one is clearly a restatement of the other with the same participants, scope, stakes, and claim. When in doubt, keep separate. Return only valid JSON.`;

export function buildReconcileSemanticPrompt(
  allThreadDescs: Set<string>,
  allWKConcepts: Set<string>,
): string {
  return `Reconcile narrative THREADS and SYSTEM KNOWLEDGE concepts extracted independently from different scenes of the same story. Unlike named entities, these are propositions — full sentences that encode nuance. Your job: preserve distinct nuances. Only merge when two items are genuine restatements of the same proposition.

THREADS (${allThreadDescs.size}):
${[...allThreadDescs].map((d, i) => `${i + 1}. "${d}"`).join('\n')}

SYSTEM KNOWLEDGE (${allWKConcepts.size}):
${[...allWKConcepts].map((c, i) => `${i + 1}. "${c}"`).join('\n')}

For each category, map every variant to its canonical form. Only include entries where variant ≠ canonical.

Return JSON:
{
  "threadMerges": { "variant": "canonical" },
  "systemMerges": { "variant": "canonical" }
}

═══ GUIDING PRINCIPLE ═══
DEFAULT IS TO KEEP SEPARATE. Threads and knowledge concepts are deliberately fine-grained. A typical story has dozens of distinct threads and system concepts — squashing them loses narrative texture. Only merge when you would be embarrassed to present both items in a final analysis because they say the exact same thing.

Test for merging: if I resolved the canonical form, would every variant also be resolved as a natural consequence? If there's any distinguishing element (different participants, different stakes, different scope, different mechanism), the answer is NO — keep separate.

═══ THREAD MERGING ═══
MERGE only when two descriptions are the same narrative tension restated:
  ✓ "Who is trying to steal the Stone?" + "The mystery of who wants the Sorcerer's Stone" — identical question, different wording
  ✓ "Snape's antagonism toward Harry" + "Snape's hostility toward Harry" — same relational tension
  ✓ "Will Harry survive Voldemort?" + "Harry's survival against Voldemort" — same question

KEEP SEPARATE — any of these distinctions is enough:
  ✗ Different participants: "Harry's conflict with Snape" vs "Harry's conflict with Malfoy"
  ✗ Different scope: "Harry's fear of Voldemort" vs "The wizarding world's fear of Voldemort"
  ✗ Different stakes: "Harry learns he is a wizard" vs "Harry adjusts to Hogwarts life"
  ✗ Different antagonists: "Harry vs Voldemort" vs "Harry vs the Dursleys"
  ✗ Different phases of related arcs: "Discovering the Stone is hidden" vs "Reaching the Stone"
  ✗ Seemingly-related mysteries that are actually distinct: "Who opened the Chamber?" vs "Who is the Heir of Slytherin?"
  ✗ A thread from two characters' perspectives where each has their own arc: "Snape's loyalty to Dumbledore" vs "Dumbledore's trust in Snape" — linked but they are distinct internal arcs

═══ SYSTEM KNOWLEDGE MERGING ═══
MERGE only when two concepts state the same rule or fact in different words:
  ✓ "Magic requires a wand to channel" + "Wands are required to cast spells" — same rule
  ✓ "The house point system rewards behavior" + "Houses earn and lose points based on student conduct" — same mechanism

KEEP SEPARATE — any of these is a distinction:
  ✗ Different mechanisms in the same domain: "Unforgivable Curses are illegal" vs "Dark magic is dangerous" — one is a legal rule, the other is a physical principle
  ✗ Related but distinct facts: "Hogwarts has four houses" vs "The Sorting Hat assigns students" — both about the house system, but different claims
  ✗ Parent and child concepts: "Magic exists" vs "Spells require incantations" — the second is more specific
  ✗ Different types in the same family: "World models enable planning" vs "World models enable reasoning" — these share a subject but make distinct claims
  ✗ Claims about the same subject with different predicates: "AI systems require large datasets" vs "AI systems are unreliable without supervision" — same topic, different propositions

═══ WHEN IN DOUBT — DO NOT MERGE ═══
Losing a distinction is worse than keeping a duplicate. The downstream pipeline can still work with slight redundancy, but it cannot recover lost nuance. If you are even slightly unsure, leave both items intact.

Empty object {} if no merges needed for a category.`;
}
