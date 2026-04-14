/**
 * Ingestion Prompts
 *
 * Prompts for parsing pasted text (from another AI, wiki, notes, etc.)
 * into structured world data: rules, systems, and prose profiles.
 */

/**
 * Prompt for extracting world rules from text.
 * Rules are high-level absolute constraints — things that are ALWAYS true.
 */
export function buildIngestRulesPrompt(text: string, existingRules: string[] = []): string {
  const existingBlock = existingRules.length > 0
    ? `EXISTING RULES (don't duplicate):\n${existingRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n`
    : '';

  return `Extract world rules — absolute constraints ALWAYS true in this universe.

Rules are: boundaries of what's possible (magic costs, resurrection forbidden, tech limits).
Rules are NOT: plot points, character details, mechanical systems, obvious facts.

${existingBlock}TEXT:
${text}

Return JSON: {"rules": ["rule 1", ...]}

Extract 3-10 rules. Only extract clearly stated or implied — don't invent.`;
}

/**
 * Prompt for extracting world systems from text.
 * Systems are mechanical descriptions of how the world operates.
 */
export function buildIngestSystemsPrompt(text: string, existingSystemNames: string[] = []): string {
  const existingBlock = existingSystemNames.length > 0
    ? `EXISTING SYSTEMS (don't duplicate):\n${existingSystemNames.map(s => `- ${s}`).join('\n')}\n`
    : '';

  return `Extract world systems — structured mechanics defining how this world operates.

Systems: power/magic, progression, economic, social/political, combat, cosmic laws.
For each: name, description (one-line), principles (how it works), constraints (limits/costs), interactions (cross-system).

Systems are MECHANICAL — describe HOW things work. Only extract clearly implied — don't invent.

${existingBlock}TEXT:
${text}

Return JSON:
{"systems": [{"name": "...", "description": "...", "principles": [...], "constraints": [...], "interactions": [...]}]}`;
}

/**
 * Prompt for extracting prose profile from text.
 * Extracts voice, stance, devices, and rules.
 *
 * Register/stance/devices lists are register-neutral: they cover fiction,
 * memoir, essay, reportage, and research writing. The LLM selects the
 * value that fits the source text, not a fiction-default.
 */
export function buildIngestProseProfilePrompt(text: string, existingProfile?: string): string {
  const existingBlock = existingProfile
    ? `EXISTING PROFILE (override where text suggests):\n${existingProfile}\n`
    : '';

  return `Extract prose profile — voice, style, craft choices. Applies to any long-form register: fiction, memoir, literary essay, criticism, journalism, historical narrative, research writing.

Fields (use snake_case):
- register: conversational|literary|raw|lyrical|formal|sardonic|mythic|journalistic|scholarly|pedagogical|theoretical|polemical
- stance: close_third|distant_third|first_person|omniscient|close_first|authorial|essayistic|reportorial|dialogic|choral
- tense: past|present|future
- sentenceRhythm: terse|flowing|staccato|varied|periodic|cumulative
- interiority: surface|moderate|deep|stream_of_consciousness|analytical|evidentiary
- dialogueWeight: heavy|moderate|sparse|minimal|none
- devices: 2-6. Pick from a wide range — do not default to the 20th-century Anglo-European novel's toolkit.
    Fiction — dramatic-realist: free_indirect_discourse, dramatic_irony, unreliable_narrator, extended_metaphor, epistolary_fragments, stream_of_consciousness.
    Fiction — lyric / fabulist / mythic / oral: refrain, litany, invocation, catalogue, direct_address, mythic_cadence, liturgical, oracular, call_and_response, frame_tale, magical_realist_baseline, lyric_digression, image_as_argument.
    Fiction — polyphonic / experimental: polyvocality, code_switching, document_collage, metafiction, framing_commentary, silence_as_beat, typographic_constraint (Oulipo), translation_as_form, hybrid_essay_fiction.
    Non-fiction: signposting, rhetorical_question, parallel_structure, case_study, counterargument_staging, citation_weaving, worked_example, braided_essay, auto_theory, archival_fragment, testimony, reportage_cadence.
    Drawing from the 20th-century Anglo-European novel is one tradition among many — prefer devices that genuinely match the source, including those native to West African epic, South Asian rasa-organised narrative, Caribbean polyvocality, Arabic/Persian frame-tale, Latin American magical realism, Japanese kishōtenketsu, Chinese wuxia/xianxia, Indigenous circular/ceremonial forms.
- rules: 3-6 SPECIFIC imperatives for sentence-level craft
- antiPatterns: 3-5 SPECIFIC failures to avoid

Rules/antiPatterns must be concrete and actionable.
BAD: "Write well" | GOOD (fiction): "Show emotion through physical reaction, never name it" | GOOD (non-fiction): "State the claim before the evidence, never bury the thesis in a narrative opener"

${existingBlock}TEXT:
${text}

Return JSON:
{"register": "...", "stance": "...", "tense": "...", "sentenceRhythm": "...", "interiority": "...", "dialogueWeight": "...", "devices": [...], "rules": [...], "antiPatterns": [...]}`;
}

/**
 * Prompt for deriving a prose profile from a narrative's own context
 * (characters, threads, prose excerpts) rather than a pasted style guide.
 * `context` is pre-built — pass the formatted narrative context block.
 */
export function buildDeriveProseProfilePrompt(context: string): string {
  return `You are a literary analyst. Given the following narrative context — its entities, threads, and prose samples — derive the prose profile that best fits this narrative's register, voice, and genre.

The narrative may be fiction, memoir, literary essay, journalism, or research writing. Do not default to novelistic conventions if the register is analytical or evidentiary.

${context}

Consider:
- What register suits this narrative's subject and intended readership?
- What stance and tense fit the register? (close_third suits most genre fiction; authorial or essayistic suits argument; reportorial suits journalism.)
- What sentence rhythm matches the pacing?
- How deep should interiority go? In analytical registers, interiority maps to reasoning and evidentiary framing, not private thought.
- What rhetorical devices would serve this work? Pick from the register-appropriate set — novelistic devices for fiction, signposting/parallel-structure/worked-examples for non-fiction.
- What craft rules should guide prose generation? (SPECIFIC imperatives, not generic advice.)
- What specific prose failures would break this voice? (Concrete anti-patterns.)

QUALITY BAR for rules and anti-patterns — derive from the declared voice, not from one school's doctrine:
- BAD rule: "Write well" / "Be descriptive" / "Show don't tell" / any universal platitude
- GOOD rule (dramatic fiction): "Show emotion through physical reaction when stakes are high; name it when reflecting at distance"
- GOOD rule (lyric / mythic / magical-realist): "Let the image carry the argument — weather, object-mood, and animal-gesture are world-claims, not decoration"
- GOOD rule (essay / memoir): "Frontload the claim; let evidence earn it sentence by sentence"
- GOOD rule (polyphonic / choral): "Rotate voice per section; never let one register dominate for more than two sections running"
- GOOD rule (refrain-based / oral-epic): "Each recurrence must carry a named variation — a new detail, a shifted POV, an inverted outcome"
- BAD anti-pattern: "Don't be boring" / "Avoid bad prose"
- GOOD anti-pattern (fiction): "NEVER use 'This was a [Name]' to introduce a mechanic — show what it does"
- GOOD anti-pattern (essay): "Do not hedge a strong claim with 'perhaps' or 'arguably' when you have the evidence to back it"
- GOOD anti-pattern (lyric): "Do not follow an image with a sentence that explains the image"

Return JSON:
{"register": "...", "stance": "...", "tense": "...", "sentenceRhythm": "...", "interiority": "...", "dialogueWeight": "...", "devices": [...], "rules": [...], "antiPatterns": [...]}

Extract 2-6 devices, 3-6 rules, and 3-5 anti-patterns. Use snake_case for multi-word values.`;
}
