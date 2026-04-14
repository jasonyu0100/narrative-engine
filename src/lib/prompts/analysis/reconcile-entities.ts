/**
 * Entity Reconciliation Prompt
 *
 * Phase 3a — aggressive merging of name-variant entities (characters, locations,
 * artifacts) onto their fullest canonical form.
 */

export const RECONCILE_ENTITIES_SYSTEM = `You resolve surface-form variants of named entities (characters, locations, artifacts) to their canonical full forms. Entities are unique referents: when two variants clearly denote the same person/place/object, you MUST merge them. Prefer the fullest identifying name. Return only valid JSON.`;

export function buildReconcileEntitiesPrompt(
  allCharNames: Set<string>,
  allLocNames: Set<string>,
  allArtifactNames: Set<string>,
): string {
  return `Reconcile named entities extracted independently from different scenes of the same story. The same person, place, or object often appears under different surface forms (title, first name, nickname, full name). Your job: collapse every variant of the same entity onto its fullest canonical form.

CHARACTERS (${allCharNames.size}):
${[...allCharNames].map((n, i) => `${i + 1}. "${n}"`).join('\n')}

LOCATIONS (${allLocNames.size}):
${[...allLocNames].map((n, i) => `${i + 1}. "${n}"`).join('\n')}

ARTIFACTS (${allArtifactNames.size}):
${[...allArtifactNames].map((n, i) => `${i + 1}. "${n}"`).join('\n')}

For each category, map every variant to its canonical form. Only include entries where variant ≠ canonical.

Return JSON:
{
  "characterMerges": { "variant": "canonical" },
  "locationMerges": { "variant": "canonical" },
  "artifactMerges": { "variant": "canonical" }
}

═══ PRINCIPLE ═══
Entities are unique referents — a character, place, or object exists once in the story world. If two surface forms clearly denote the same referent, they MUST be merged. Prefer the fullest, most identifying canonical form.

═══ CHARACTER / AUTHOR / SUBJECT MERGING ═══
Merge aggressively when two surface forms denote the same person. Examples drawn from multiple traditions:
  ✓ (Anglophone fiction) "Harry" / "Harry Potter" → "Harry Potter"
  ✓ (Anglophone fiction with title) "Professor McGonagall" / "Minerva McGonagall" / "McGonagall" → "Professor Minerva McGonagall"
  ✓ (Latin American fiction) "José Arcadio" / "the colonel" / "Colonel Aureliano Buendía" — merge when context makes the referent unambiguous; preserve the Buendía distinction across generations (colonel vs elder, I vs II)
  ✓ (East Asian fiction) "宝玉" / "Jia Baoyu" / "Baoyu" → "Jia Baoyu"; be careful with romanisation variants (Pinyin vs Wade-Giles) that refer to the same name
  ✓ (research paper) "Yann LeCun" / "LeCun" / "the author" (when context clearly denotes LeCun) → "Yann LeCun". For ET AL. citations, be conservative: "Vaswani et al." usually denotes the group-authored work, not the individual.
  ✓ (memoir / reportage) "my mother" / "Ama" / "Mrs. Okonkwo" when it is clear the narrator's mother is Mrs. Okonkwo → the fullest identifying form.

Canonical choice: pick the form that is most uniquely identifying. Full name > title + last name > first name or nickname alone. If a title is part of how the referent is known (Professor, Lord, Sensei, Imam, Doctor, Aunty), include it.

DO NOT MERGE:
  ✗ Different people sharing a surname or title: "Mr. Dursley" vs "Dudley Dursley"; "Professor Snape" vs "Professor McGonagall".
  ✗ Different authors cited in the same work: "Brown et al., 2020" vs "Silver et al., 2021".
  ✗ Transliteration variants that refer to distinct people: "Chen Wei" vs "Chen Wen" (different people, close romanisation).
  ✗ Generational namesakes: "Aureliano Buendía (the colonel)" vs "Aureliano Segundo" — same family, different people.

═══ LOCATION MERGING ═══
Merge when two surface forms denote the same place:
  ✓ "The Great Hall" / "Great Hall" / "Hogwarts Great Hall" → "Great Hall"
  ✓ "Macondo" / "the village of Macondo" → "Macondo"
  ✓ "the madrasa courtyard" / "the Qarawiyyin courtyard" when unambiguous
  ✓ (research) "Google DeepMind London" / "DeepMind (London office)" → the fullest institutional form
  ✓ Romanisation variants of the same place: "Beijing" / "Peking" → "Beijing" (or whichever the work uses canonically)

DO NOT MERGE: distinct places even if nested or adjacent.
  ✗ "The Great Hall" vs "The Entrance Hall"
  ✗ "Macondo" vs "Riohacha" (distinct towns)
  ✗ "Stanford University" vs "Stanford Linear Accelerator Center" (related but distinct)

═══ ARTIFACT / WORK / INSTRUMENT MERGING ═══
Merge when two surface forms denote the same object, document, or tool:
  ✓ (fiction) "the Elder Wand" / "Elder Wand" / "Dumbledore's wand" → "the Elder Wand"
  ✓ (fiction, translated work) "the Sorcerer's Stone" / "the Philosopher's Stone" — same object, different edition-title
  ✓ (research) "the Adam optimiser" / "Adam (Kingma & Ba, 2014)" → the fullest identifying form
  ✓ (research) "Table 2" / "Table 2: ablation results" → the fullest labelled form (tests already rely on this)

DO NOT MERGE: different instances of the same type.
  ✗ "Harry's wand" vs "Voldemort's wand"
  ✗ Two different trained models with different checkpoints
  ✗ Two figures with the same number in different papers

Empty object {} if no merges needed for a category.`;
}
