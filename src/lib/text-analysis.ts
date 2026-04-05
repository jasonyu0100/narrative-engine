/**
 * Text Analysis Pipeline — converts a large corpus (book, screenplay, etc.)
 * into a full NarrativeState by splitting into chunks, analyzing each with LLM,
 * and assembling the results.
 *
 * Adapted from scripts/analyze-chapter.ts and scripts/assemble-narrative.ts
 * for in-browser use with the app's existing callGenerate infrastructure.
 */

import type {
  NarrativeState, AnalysisChunkResult, AnalysisJob,
  Character, Location, Thread, Arc, Scene, RelationshipEdge, Artifact,
  WorldBuild, Branch, ProseProfile,
} from '@/types/narrative';
import { THREAD_ACTIVE_STATUSES, THREAD_TERMINAL_STATUSES, THREAD_STATUS_LABELS, DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { ANALYSIS_TARGET_SECTIONS_PER_CHUNK, ANALYSIS_TARGET_CHUNK_WORDS, ANALYSIS_MODEL, MAX_TOKENS_DEFAULT, ANALYSIS_TEMPERATURE } from '@/lib/constants';
import { validateExtractionResult, validateWorldKnowledge } from '@/lib/ai/validation';
import { logWarning, logInfo } from '@/lib/error-logger';

// ── Text Splitting ───────────────────────────────────────────────────────────

function splitIntoSections(text: string): string[] {
  let chunks = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  if (chunks.length < 6) {
    const continuous = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const sentences = continuous.match(/[^.!?]+[.!?]+["']?\s*/g) ?? [continuous];
    const sentencesPerChunk = Math.max(1, Math.round(sentences.length / ANALYSIS_TARGET_SECTIONS_PER_CHUNK));
    chunks = [];
    for (let i = 0; i < sentences.length; i += sentencesPerChunk) {
      chunks.push(sentences.slice(i, i + sentencesPerChunk).join('').trim());
    }
  } else {
    const parasPerSection = Math.max(1, Math.round(chunks.length / ANALYSIS_TARGET_SECTIONS_PER_CHUNK));
    const grouped: string[] = [];
    for (let i = 0; i < chunks.length; i += parasPerSection) {
      grouped.push(chunks.slice(i, i + parasPerSection).join('\n\n'));
    }
    chunks = grouped;
  }

  return chunks;
}

/**
 * Split a large text into analysis chunks. Each chunk targets ~8000 words
 * and is further divided into numbered sections for the LLM.
 */
export function splitCorpusIntoChunks(text: string): AnalysisJob['chunks'] {
  // First try to split on chapter markers
  const chapterPattern = /(?:^|\n)(?:CHAPTER|Chapter|chapter)\s+[IVXLCDM\d]+[.:)]*\s*[^\n]*/g;
  const chapterMatches = [...text.matchAll(chapterPattern)];

  let rawChunks: string[];

  if (chapterMatches.length >= 2) {
    // Split by chapter markers
    rawChunks = [];
    for (let i = 0; i < chapterMatches.length; i++) {
      const start = chapterMatches[i].index!;
      const end = i + 1 < chapterMatches.length ? chapterMatches[i + 1].index! : text.length;
      rawChunks.push(text.slice(start, end).trim());
    }
  } else {
    // No chapter markers — split by word count
    const words = text.split(/\s+/);
    rawChunks = [];
    for (let i = 0; i < words.length; i += ANALYSIS_TARGET_CHUNK_WORDS) {
      rawChunks.push(words.slice(i, i + ANALYSIS_TARGET_CHUNK_WORDS).join(' '));
    }
  }

  // Merge very small chunks and split very large ones
  const merged: string[] = [];
  let buffer = '';
  for (const chunk of rawChunks) {
    const wordCount = chunk.split(/\s+/).length;
    if (buffer && (buffer.split(/\s+/).length + wordCount) > ANALYSIS_TARGET_CHUNK_WORDS * 1.5) {
      merged.push(buffer);
      buffer = chunk;
    } else if (wordCount > ANALYSIS_TARGET_CHUNK_WORDS * 2) {
      if (buffer) merged.push(buffer);
      buffer = '';
      // Split oversized chunk
      const words = chunk.split(/\s+/);
      for (let i = 0; i < words.length; i += ANALYSIS_TARGET_CHUNK_WORDS) {
        merged.push(words.slice(i, i + ANALYSIS_TARGET_CHUNK_WORDS).join(' '));
      }
    } else {
      buffer = buffer ? buffer + '\n\n' + chunk : chunk;
    }
  }
  if (buffer) merged.push(buffer);

  return merged.map((text, index) => {
    const sections = splitIntoSections(text);
    return { index, text, sectionCount: sections.length };
  });
}

// ── Cumulative Context Builder ───────────────────────────────────────────────

function buildCumulativeContext(priorResults: (AnalysisChunkResult | null)[]): string {
  const completed = priorResults.filter((r): r is AnalysisChunkResult => r !== null);
  if (completed.length === 0) return '';

  const characters: Record<string, { name: string; role: string; continuity: { type: string; content: string; chunk: number }[] }> = {};
  const locations: Record<string, { name: string; parentName: string | null; description: string; lore: string[] }> = {};
  const threads: Record<string, { description: string; participantNames: string[]; currentStatus: string; history: string[] }> = {};
  const relationships: Record<string, { from: string; to: string; type: string; valence: number }> = {};
  const sceneHistory: string[] = [];
  let sceneCounter = 0;

  completed.forEach((ch, chIdx) => {
    for (const c of ch.characters ?? []) {
      if (!characters[c.name]) {
        characters[c.name] = { name: c.name, role: c.role, continuity: [] };
      }
      const rank: Record<string, number> = { transient: 0, recurring: 1, anchor: 2 };
      if ((rank[c.role] ?? 0) > (rank[characters[c.name].role] ?? 0)) {
        characters[c.name].role = c.role;
      }
      for (const k of c.continuity ?? []) {
        characters[c.name].continuity.push({ type: k.type, content: k.content, chunk: chIdx + 1 });
      }
    }

    for (const loc of ch.locations ?? []) {
      if (!locations[loc.name]) {
        locations[loc.name] = { name: loc.name, parentName: loc.parentName, description: loc.description, lore: loc.lore ?? [] };
      }
    }

    for (const t of ch.threads ?? []) {
      const key = t.description;
      if (!threads[key]) {
        threads[key] = { description: t.description, participantNames: t.participantNames, currentStatus: t.statusAtEnd, history: [`Chunk${chIdx + 1}: ${t.statusAtStart} → ${t.statusAtEnd}`] };
      } else {
        threads[key].currentStatus = t.statusAtEnd;
        threads[key].history.push(`Chunk${chIdx + 1}: ${t.statusAtStart} → ${t.statusAtEnd}`);
      }
    }

    for (const r of ch.relationships ?? []) {
      relationships[`${r.from}→${r.to}`] = r;
    }

    for (const scene of ch.scenes ?? []) {
      sceneCounter++;
      const threadChanges = (scene.threadMutations ?? []).map((tm) => `${tm.threadDescription?.slice(0, 50)}: ${tm.from}→${tm.to}`).join('; ');
      const kChanges = (scene.continuityMutations ?? []).map((km) => `${km.characterName} learned [${km.type}]: ${km.content}`).join('; ');
      sceneHistory.push(
        `[Chunk${chIdx + 1} S${sceneCounter}] @ ${scene.locationName} | POV: ${scene.povName} | ${scene.participantNames?.join(', ')}` +
        (threadChanges ? ` | Threads: ${threadChanges}` : '') +
        (kChanges ? ` | Knowledge: ${kChanges}` : '') +
        `\n   ${scene.summary}`,
      );
    }
  });

  const charBlock = Object.values(characters).map((c) => {
    const kLines = c.continuity.map((k) => `    (${k.type}) ${k.content} [Chunk${k.chunk}]`);
    return `- ${c.name} (${c.role})${kLines.length > 0 ? '\n  Knowledge:\n' + kLines.join('\n') : ''}`;
  }).join('\n');

  const locBlock = Object.values(locations).map((l) =>
    `- ${l.name}${l.parentName ? ` (inside ${l.parentName})` : ''}: ${l.description}`,
  ).join('\n');

  const threadBlock = Object.values(threads).map((t) =>
    `- "${t.description}" [${t.currentStatus}] participants: ${t.participantNames.join(', ')} | history: ${t.history.join(', ')}`,
  ).join('\n');

  const relBlock = Object.values(relationships).map((r) =>
    `- ${r.from} → ${r.to}: ${r.type} (valence: ${r.valence})`,
  ).join('\n');

  return `
CUMULATIVE WORLD STATE (${completed.length} chunks analyzed):

CHARACTERS:
${charBlock}

LOCATIONS:
${locBlock}

THREADS:
${threadBlock}

RELATIONSHIPS:
${relBlock}

FULL SCENE HISTORY (${sceneCounter} scenes across ${completed.length} chunks):
${sceneHistory.join('\n')}`;
}

// ── LLM Call ─────────────────────────────────────────────────────────────────

async function callAnalysis(prompt: string, systemPrompt: string, onToken?: (token: string, accumulated: string) => void): Promise<string> {
  const { logApiCall, updateApiLog } = await import('@/lib/api-logger');
  const { apiHeaders } = await import('@/lib/api-headers');
  const logId = logApiCall('analyzeChunk', prompt.length + systemPrompt.length, prompt, ANALYSIS_MODEL);
  const start = performance.now();

  try {
    const useStream = !!onToken;
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ prompt, systemPrompt, maxTokens: MAX_TOKENS_DEFAULT, stream: useStream, model: ANALYSIS_MODEL, temperature: ANALYSIS_TEMPERATURE, reasoningBudget: 0 }),
    });
    if (!res.ok) {
      const err = await res.json();
      const message = err.error || 'Analysis failed';
      updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
      throw new Error(message);
    }

    let content: string;

    if (useStream && res.body) {
      // Stream SSE tokens
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              if (parsed.token) {
                accumulated += parsed.token;
                onToken(parsed.token, accumulated);
              }
            } catch {
              // skip malformed
            }
          }
        }
      }
      content = accumulated;
    } else {
      const data = await res.json();
      content = data.content;
    }

    updateApiLog(logId, { status: 'success', durationMs: Math.round(performance.now() - start), responseLength: content.length, responsePreview: content });
    return content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
    throw err;
  }
}

// ── JSON Extraction ──────────────────────────────────────────────────────────

function extractJSON(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '');

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  text = text.replace(/,\s*([}\]])/g, '$1');

  // Fix missing opening quote on string values: "key": value" → "key": "value"
  text = text.replace(/:\s*([a-zA-Z_][a-zA-Z0-9_]*)"(,|\s*[}\]])/g, ': "$1"$2');
  // Fix missing closing quote: "key": "value → "key": "value"
  text = text.replace(/:\s*"([^"]*?)(\n)/g, ': "$1"$2');
  // Escape raw newlines/tabs inside string values (not already escaped)
  text = text.replace(/"([^"]*?)"/g, (_match, inner: string) => {
    const escaped = inner
      .replace(/(?<!\\)\n/g, '\\n')
      .replace(/(?<!\\)\r/g, '\\r')
      .replace(/(?<!\\)\t/g, '\\t');
    return `"${escaped}"`;
  });

  let opens = 0, closes = 0, sqOpens = 0, sqCloses = 0;
  for (const ch of text) {
    if (ch === '{') opens++;
    else if (ch === '}') closes++;
    else if (ch === '[') sqOpens++;
    else if (ch === ']') sqCloses++;
  }
  while (sqCloses < sqOpens) { text += ']'; sqCloses++; }
  while (closes < opens) { text += '}'; closes++; }

  return text;
}

// ── Analyze a Single Chunk ───────────────────────────────────────────────────

export async function analyzeChunk(
  chunkText: string,
  chunkIndex: number,
  priorResults: (AnalysisChunkResult | null)[],
  onToken?: (token: string, accumulated: string) => void,
): Promise<AnalysisChunkResult> {
  const sections = splitIntoSections(chunkText);
  const numbered = sections.map((s, i) => `[SECTION ${i + 1}]\n${s}`).join('\n\n');
  const cumulativeCtx = buildCumulativeContext(priorResults.slice(0, chunkIndex));

  const systemPrompt = `You are a narrative simulation engine that extracts structured scene data from text for an interactive storytelling system.
You must ALWAYS respond with valid JSON only — no markdown, no explanation, no code fences.

The narrative engine tracks:
- Characters with roles (anchor = central, recurring = frequent, transient = minor) and continuity graphs
- Locations with parent-child hierarchy and lore/secrets
- Narrative threads — ongoing tensions that evolve: ${THREAD_ACTIVE_STATUSES.join(' → ')} → ${THREAD_TERMINAL_STATUSES.join('/')}
- Scenes with POV character, events, thread mutations, continuity mutations, and relationship mutations
- Relationships — directional with sentiment valence (-1 to 1) and descriptive type

CHARACTERS: Only extract PEOPLE who speak, act, or are spoken about as individuals. Do NOT include animals, objects, institutions, publications, textbook authors mentioned only in passing, or named items. Use a single canonical name per character — if someone is called both "Professor McGonagall" and "Minerva McGonagall", pick the most common form and use it consistently. Check prior chunk names and reuse the EXACT same name string for returning characters.

THREADS: Threads are DISTINCT narrative tensions that drive the story forward. Each must pass TWO tests:
1. "Does this create tension that makes the reader want to know what happens next?"
2. "Is this genuinely different from every other thread I've listed?" — if two threads describe the same underlying tension (e.g. "the family's fear of magic" and "the family's efforts to suppress magic"), MERGE them into one.
Categories:
- Plot: mysteries, quests, dangers, conspiracies
- Character: internal conflicts, secrets, desires vs. duty
- Relationship: rivalries, alliances under strain, trust being tested
Do NOT extract: world-building facts, character traits, setting details, or observations that create no narrative tension.
Fewer, sharper threads are better than many overlapping ones. Thread activity is dynamic — some chunks may advance many threads at once, others only a few. Only include a thread if its status actually changes in this chunk or if it's being actively developed. For continuing threads, REUSE the EXACT description string from prior chunks.

Continuity types must be SPECIFIC and CONTEXTUAL — not generic labels like "knows" or "secret". Use types that describe exactly what kind of continuity: "social_observation", "class_awareness", "romantic_longing", "moral_judgment", "hidden_wealth_source", "past_betrayal", "forbidden_desire", "strategic_deception", etc.

Be thorough with narrative developments, but selective with characters — quality over quantity.`;

  const prompt = `Analyze this text chunk and extract all narrative elements.
${cumulativeCtx}

=== CHUNK ${chunkIndex + 1} TEXT (${sections.length} sections) ===
${numbered}

Return a single JSON object with this exact structure:
{
  "chapterSummary": "2-3 sentence summary of key events and thematic significance",
  "characters": [
    {
      "name": "Full Name",
      "role": "anchor|recurring|transient",
      "firstAppearance": true/false,
      "imagePrompt": "1-2 sentence LITERAL physical description for portrait generation. Describe concrete physical traits (hair colour, build, clothing style) — never use figurative language, metaphors, or similes (e.g. say 'bright green eyes' not 'emerald eyes like twin moons'). Image generators interpret descriptions literally.",
      "continuity": [
        { "type": "specific_contextual_type", "content": "What they learn, reveal, or demonstrate in THIS chunk" }
      ]
    }
  ],
  "locations": [
    { "name": "Location Name", "parentName": "Parent Location or null", "description": "Brief atmospheric description", "imagePrompt": "1-2 sentence LITERAL visual description of architecture, landscape, lighting, weather for establishing shot generation. Use concrete physical details only — no metaphors, similes, or figurative language. Image generators interpret descriptions literally.", "lore": ["Notable detail or significance"] }
  ],
  "artifacts": [
    { "name": "Artifact Name", "significance": "key|notable|minor", "continuity": [{"type": "specific_type", "content": "What it is, what it does, its properties, history, limitations"}], "ownerName": "Character or Location name that holds it" }
  ],
  "threads": [
    {
      "description": "The narrative question or tension — use EXACT description from prior chunks for continuing threads",
      "participantNames": ["Character or location names this thread is anchored to"],
      "statusAtStart": "status at chunk start",
      "statusAtEnd": "status at chunk end",
      "development": "How this thread developed in this chunk",
      "relatedThreadDescriptions": ["EXACT descriptions of OTHER threads this thread converges with, accelerates, or depends on — threads whose resolution is causally linked to this one. Empty array if independent."]
    }
  ],
  "scenes": [
    {
      "locationName": "Where it happens",
      "povName": "Name of the POV character for this scene",
      "participantNames": ["Who is present"],
      "events": ["short_event_tag_1", "short_event_tag_2"],
      "summary": "3-5 sentence narrative summary using character and location NAMES. Include specifics: key actions, consequences, and any context that shapes the scene (time span, technique, tone shifts).",
      "sections": [1, 2, 3],
      "threadMutations": [
        { "threadDescription": "exact thread description", "from": "status", "to": "status" }
      ],
      "continuityMutations": [
        { "characterName": "Name", "action": "added", "content": "What they learned", "type": "specific_contextual_type" }
      ],
      "relationshipMutations": [
        { "from": "Name", "to": "Name", "type": "Description of relationship shift", "valenceDelta": -0.3 }
      ],
      "ownershipMutations": [
        { "artifactName": "Artifact Name", "fromName": "Previous owner name", "toName": "New owner name" }
      ],
      "characterMovements": [
        { "characterName": "Name", "locationName": "Destination location", "transition": "Vivid description of HOW they traveled, e.g. 'Rode horseback through the night'" }
      ],
      "worldKnowledgeMutations": {
        "addedNodes": [{"concept": "name of abstract world concept", "type": "law|system|concept|tension"}],
        "addedEdges": [{"fromConcept": "concept name", "toConcept": "concept name", "relation": "relationship type"}]
      }
    }
  ],
  "relationships": [
    { "from": "Name", "to": "Name", "type": "Descriptive relationship", "valence": -1 to 1 }
  ]
}

RULES:
- Break the chunk into 3-5 distinct scenes based on location shifts, time jumps, or major tonal changes
- Every scene MUST have a non-empty "summary", at least one event tag, and a "povName"
- "sections" is an array of section numbers (1-indexed) that this scene covers. Together, all scenes should cover all ${sections.length} sections.
- characterMovements: only include characters who physically RELOCATE to a different location during the scene. The destination must differ from the scene's locationName. Omit characters who stay put.
- artifacts: objects with narrative significance — weapons, relics, keys, letters, documents, tools. Only extract items that alter what characters can do or drive plot. A named sword that wins battles is an artifact; a generic chair is not. Track who owns each artifact. If ownership changes in a scene, record it as an ownershipMutation.
- ownershipMutations: only when an artifact physically changes hands in a scene. fromName = previous owner (character or location name), toName = new owner.
- worldKnowledgeMutations track the world's abstract structure — the rules, systems, ideas, and tensions that define the world the characters inhabit. NOT character knowledge (that's continuityMutations). World knowledge exists in EVERY genre, not just fantasy:
  * Fantasy/sci-fi: magic systems, alien species, supernatural laws, technological rules
  * Literary fiction: class structures, social norms, economic systems, cultural expectations
  * Historical: period customs, political systems, social hierarchies, era-specific tensions
  * Crime/thriller: legal systems, criminal hierarchies, institutional power structures
- Four types: "law" (governing truths — social rules, physical laws, cultural expectations), "system" (institutions, processes, hierarchies — both formal and informal), "concept" (named ideas, phenomena, symbolic motifs, places-as-concepts), "tension" (contradictions, paradoxes, unresolved social forces).
- Add nodes when a scene reveals, establishes, or names a world concept. Add edges (fromConcept/toConcept) when it connects concepts.
- REUSING existing world knowledge nodes is encouraged. If a scene reinforces, deepens, or tests an existing concept, reference the existing node ID in addedNodes — this signals delivery with established world knowledge rather than inventing something new. Similarly, re-adding an existing edge reinforces that connection. Only create new IDs for genuinely new concepts.
- How much to extract depends on the prose:
  * A scene that establishes social rules, describes how institutions work, reveals class dynamics, or names symbolic concepts → several nodes and edges.
  * A scene that shows how two world concepts relate (old money enables social access, prohibition creates underground economies) → edges.
  * A scene that reinforces or tests an already-established concept → reuse the existing node ID.
  * A quiet scene with no world context → none.
  * Let the prose guide you — extract what's there, don't invent what isn't.

FORCE SCORING — extract ONLY what the prose actually supports. Do NOT inflate:
- PAYOFF: Only record thread transitions when the text clearly shows a shift in tension level. A scene where a thread is merely present is a pulse (same status), NOT a transition. Do not manufacture transitions.
- CHANGE: Only include characters who meaningfully act, react, learn, or are changed in the scene. Background characters who are merely present get no mutations. A quiet scene with one character reflecting alone should have few mutations.
- KNOWLEDGE: Only add world-building nodes when the prose explicitly reveals, establishes, or names a concept. A scene that takes place in an already-established setting with no new world information gets ZERO knowledge nodes. Do not invent concepts the text doesn't surface.
- Scenes vary dramatically in intensity. A transitional scene may have near-zero mutations across all forces. A climactic scene may have many. Extract what's actually there — never pad sparse scenes to hit a target.
${cumulativeCtx ? `
CUMULATIVE CONTINUITY:
- Thread "statusAtStart" MUST match the thread's current status from the THREADS section above
- Reuse EXACT thread descriptions from prior chunks for continuing threads
- Relationship valence should evolve from prior values
- REUSE world knowledge concept names from prior chunks when the same concept reappears — use the exact same concept string so edges can connect across chunks
- Look for NEW threads that emerge in this chunk that weren't present before
` : `
FIRST CHUNK — THREAD SEEDING:
- This is the first chunk — establish the thread inventory for the story
- For statusAtStart, use "dormant" for threads that are just being introduced
- Focus on tensions that will carry across multiple chapters: mysteries, conflicts, character struggles, relationship dynamics
`}
THREAD LIFECYCLE:
- Active statuses: ${THREAD_ACTIVE_STATUSES.map((s: string) => `"${s}"`).join(', ')}
- Terminal statuses: ${THREAD_TERMINAL_STATUSES.map((s: string) => `"${s}" (${THREAD_STATUS_LABELS[s]})`).join(', ')}
- Threads can regress (e.g. "escalating" → "active" when tension temporarily eases). Not every chapter ratchets upward.
- statusAtStart and statusAtEnd CAN be the same — a valid "pulse" showing the thread is engaged without shifting phase.
- Be aggressive about detecting transitions. Turning points, revelations, confrontations, and emotional shifts are triggers. If a chapter opens with simmering tension and ends with a confrontation, that's at least one status jump.
- Each scene's threadMutations should touch threads meaningfully present in that scene, even if status doesn't change.

CONTINUITY MUTATIONS:
- Track INFORMATION ASYMMETRY — what one character knows that others don't
- Each entry should pass the test: "Would the story change if this character didn't know this?"`;

  const raw = await callAnalysis(prompt, systemPrompt, onToken);
  const json = extractJSON(raw);
  let parsed: AnalysisChunkResult;
  try {
    parsed = JSON.parse(json) as AnalysisChunkResult;
  } catch (e) {
    // Try aggressive repair: fix smart quotes, stray control chars
    const repaired = json
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\x00-\x1F\x7F]/g, (ch) => ch === '\n' || ch === '\t' ? ch : '');
    parsed = JSON.parse(repaired) as AnalysisChunkResult;
  }

  // Validate extraction result
  const validation = validateExtractionResult(parsed);
  if (!validation.valid) {
    logWarning(
      `Chunk ${chunkIndex + 1} extraction validation failed`,
      validation.errors.join('; '),
      {
        source: 'analysis',
        operation: 'chunk-extraction',
        details: { chunkIndex, errorCount: validation.errors.length }
      }
    );
    throw new Error(`Extraction validation failed for chunk ${chunkIndex + 1}:\n${validation.errors.join('\n')}`);
  }

  // Populate prose from section references
  for (const scene of parsed.scenes ?? []) {
    const sectionNums: number[] = scene.sections ?? [];
    scene.prose = sectionNums
      .filter((n) => n >= 1 && n <= sections.length)
      .sort((a, b) => a - b)
      .map((n) => sections[n - 1])
      .join('\n\n');
  }

  return parsed;
}

// ── Parallel Chunk Analysis (Phase 1) ────────────────────────────────────────

/**
 * Analyze a single chunk WITHOUT cumulative context — designed for parallel execution.
 * Each chunk independently extracts characters, locations, scenes, threads, and relationships.
 */
export async function analyzeChunkParallel(
  chunkText: string,
  chunkIndex: number,
  totalChunks: number,
  onToken?: (token: string, accumulated: string) => void,
): Promise<AnalysisChunkResult> {
  const sections = splitIntoSections(chunkText);
  const numbered = sections.map((s, i) => `[SECTION ${i + 1}]\n${s}`).join('\n\n');

  const systemPrompt = `You are a narrative simulation engine that extracts structured scene data from text for an interactive storytelling system.
You must ALWAYS respond with valid JSON only — no markdown, no explanation, no code fences.

The narrative engine tracks:
- Characters with roles (anchor = central, recurring = frequent, transient = minor) and continuity graphs
- Locations with parent-child hierarchy and lore/secrets
- Narrative threads — ongoing tensions that evolve: ${THREAD_ACTIVE_STATUSES.join(' → ')} → ${THREAD_TERMINAL_STATUSES.join('/')}
- Scenes with POV character, events, thread mutations, continuity mutations, and relationship mutations
- Relationships — directional with sentiment valence (-1 to 1) and descriptive type

CHARACTERS: Only extract PEOPLE who speak, act, or are spoken about as individuals. Do NOT include animals, objects, institutions, publications, textbook authors mentioned only in passing, or named items. Use a single canonical name per character — pick the most common form used in this chunk.

THREADS: Threads are DISTINCT narrative tensions that drive the story forward. Each must pass TWO tests:
1. "Does this create tension that makes the reader want to know what happens next?"
2. "Is this genuinely different from every other thread I've listed?" — if two threads describe the same underlying tension, MERGE them into one.
Categories:
- Plot: mysteries, quests, dangers, conspiracies
- Character: internal conflicts, secrets, desires vs. duty
- Relationship: rivalries, alliances under strain, trust being tested
Do NOT extract: world-building facts, character traits, setting details, or observations that create no narrative tension.
Fewer, sharper threads are better than many overlapping ones.

This is chunk ${chunkIndex + 1} of ${totalChunks}. Analyze it IN ISOLATION — do not assume knowledge of other chunks.
For thread statuses, use your best judgment based on what you see in THIS chunk alone:
- "dormant" if a thread is hinted at but not yet active
- "active" if it's in play
- "escalating" if tension is rising
- "critical" if it's at a breaking point
- "resolved"/"subverted"/"abandoned" if it concludes in this chunk
Threads can regress (e.g. "escalating" → "active" when tension eases). statusAtStart and statusAtEnd can be the same if the thread is engaged but doesn't shift phase — this is a valid "pulse" that shows the thread is alive.
Be aggressive about detecting phase transitions — if a chapter opens with simmering tension and ends with a confrontation, that's at least one status jump. Look for turning points, revelations, and emotional shifts as transition triggers.

Continuity types must be SPECIFIC and CONTEXTUAL — not generic labels like "knows" or "secret". Use types that describe exactly what kind of continuity: "social_observation", "class_awareness", "romantic_longing", "moral_judgment", "hidden_wealth_source", "past_betrayal", "forbidden_desire", "strategic_deception", etc.

Be thorough with narrative developments, but selective with characters — quality over quantity.`;

  const prompt = `Analyze this text chunk and extract all narrative elements.

=== CHUNK ${chunkIndex + 1} of ${totalChunks} TEXT (${sections.length} sections) ===
${numbered}

Return a single JSON object with this exact structure:
{
  "chapterSummary": "2-3 sentence summary of key events and thematic significance",
  "characters": [
    {
      "name": "Full Name",
      "role": "anchor|recurring|transient",
      "firstAppearance": true/false,
      "imagePrompt": "1-2 sentence LITERAL physical description for portrait generation. Describe concrete physical traits (hair colour, build, clothing style) — never use figurative language, metaphors, or similes (e.g. say 'bright green eyes' not 'emerald eyes like twin moons'). Image generators interpret descriptions literally.",
      "continuity": [
        { "type": "specific_contextual_type", "content": "What they learn, reveal, or demonstrate in THIS chunk" }
      ]
    }
  ],
  "locations": [
    { "name": "Location Name", "parentName": "Parent Location or null", "description": "Brief atmospheric description", "imagePrompt": "1-2 sentence LITERAL visual description of architecture, landscape, lighting, weather for establishing shot generation. Use concrete physical details only — no metaphors, similes, or figurative language. Image generators interpret descriptions literally.", "lore": ["Notable detail or significance"] }
  ],
  "artifacts": [
    { "name": "Artifact Name", "significance": "key|notable|minor", "continuity": [{"type": "specific_type", "content": "What it is, what it does, its properties, history, limitations"}], "ownerName": "Character or Location name that holds it" }
  ],
  "threads": [
    {
      "description": "The narrative question or tension",
      "participantNames": ["Character or location names this thread is anchored to"],
      "statusAtStart": "status at chunk start",
      "statusAtEnd": "status at chunk end",
      "development": "How this thread developed in this chunk",
      "relatedThreadDescriptions": ["EXACT descriptions of OTHER threads this thread converges with or depends on — empty if independent"]
    }
  ],
  "scenes": [
    {
      "locationName": "Where it happens",
      "povName": "Name of the POV character for this scene",
      "participantNames": ["Who is present"],
      "events": ["short_event_tag_1", "short_event_tag_2"],
      "summary": "3-5 sentence narrative summary using character and location NAMES. Include specifics: key actions, consequences, and any context that shapes the scene (time span, technique, tone shifts).",
      "sections": [1, 2, 3],
      "threadMutations": [
        { "threadDescription": "exact thread description", "from": "status", "to": "status" }
      ],
      "continuityMutations": [
        { "characterName": "Name", "action": "added", "content": "What they learned", "type": "specific_contextual_type" }
      ],
      "relationshipMutations": [
        { "from": "Name", "to": "Name", "type": "Description of relationship shift", "valenceDelta": -0.3 }
      ],
      "ownershipMutations": [
        { "artifactName": "Artifact Name", "fromName": "Previous owner name", "toName": "New owner name" }
      ],
      "characterMovements": [
        { "characterName": "Name", "locationName": "Destination location", "transition": "Vivid description of HOW they traveled, e.g. 'Rode horseback through the night'" }
      ],
      "worldKnowledgeMutations": {
        "addedNodes": [{"concept": "name of abstract world concept", "type": "law|system|concept|tension"}],
        "addedEdges": [{"fromConcept": "concept name", "toConcept": "concept name", "relation": "relationship type"}]
      }
    }
  ],
  "relationships": [
    { "from": "Name", "to": "Name", "type": "Descriptive relationship", "valence": -1 to 1 }
  ]
}

RULES:
- Break the chunk into 3-5 distinct scenes based on location shifts, time jumps, or major tonal changes
- Every scene MUST have a non-empty "summary", at least one event tag, and a "povName"
- "sections" is an array of section numbers (1-indexed) that this scene covers. Together, all scenes should cover all ${sections.length} sections.
- characterMovements: only include characters who physically RELOCATE to a different location during the scene. The destination must differ from the scene's locationName. Omit characters who stay put.
- artifacts: objects with narrative significance — weapons, relics, keys, letters, documents, tools. Only extract items that alter what characters can do or drive plot. A named sword that wins battles is an artifact; a generic chair is not. Track who owns each artifact. If ownership changes in a scene, record it as an ownershipMutation.
- ownershipMutations: only when an artifact physically changes hands in a scene. fromName = previous owner (character or location name), toName = new owner.
- worldKnowledgeMutations track the world's abstract structure — rules, systems, ideas, and tensions of the world characters inhabit. NOT character knowledge. Exists in EVERY genre:
  * Fantasy/sci-fi: magic systems, supernatural laws, alien species. Literary: class structures, social norms, economic systems. Historical: period customs, political systems. Crime: legal systems, criminal hierarchies.
- Four types: "law" (governing truths — social rules, physical laws), "system" (institutions, hierarchies), "concept" (named ideas, symbolic motifs, places-as-concepts), "tension" (contradictions, unresolved social forces).
- Add nodes when a scene reveals world concepts. Add edges when it connects them.
- REUSE existing node IDs when a scene reinforces or tests an already-established concept — don't create duplicates. Only create new IDs for genuinely new concepts. Re-adding existing edges reinforces those connections.
- How much depends on the prose: scenes establishing social rules, institutional dynamics, cultural expectations → several nodes. Scenes reinforcing existing concepts → reuse existing IDs. Quiet scenes with no world context → none. Let the prose guide you.

FORCE SCORING — extract ONLY what the prose actually supports. Do NOT inflate:
- PAYOFF: Only record thread transitions when the text clearly shows a shift in tension level. A scene where a thread is merely present is a pulse (same status), NOT a transition. Do not manufacture transitions.
- CHANGE: Only include characters who meaningfully act, react, learn, or are changed in the scene. Background characters who are merely present get no mutations. A quiet scene with one character reflecting alone should have few mutations.
- KNOWLEDGE: Only add world-building nodes when the prose explicitly reveals, establishes, or names a concept. A scene in an already-known setting with no new world information gets ZERO knowledge nodes. Do not invent concepts the text doesn't surface.
- Scenes vary dramatically in intensity. Transitional scenes may have near-zero mutations. Climactic scenes may have many. Extract what's there — never pad sparse scenes.

THREAD LIFECYCLE:
- Active statuses: ${THREAD_ACTIVE_STATUSES.map((s: string) => `"${s}"`).join(', ')}
- Terminal statuses: ${THREAD_TERMINAL_STATUSES.map((s: string) => `"${s}" (${THREAD_STATUS_LABELS[s]})`).join(', ')}
- Threads can regress (e.g. "escalating" → "active" when tension temporarily eases). Not every chapter ratchets upward.
- statusAtStart and statusAtEnd CAN be the same — a valid "pulse" showing the thread is engaged without shifting phase.
- Be aggressive about detecting transitions. Turning points, revelations, confrontations, and emotional shifts are triggers. If a chapter opens with simmering tension and ends with a confrontation, that's at least one status jump.
- Each scene's threadMutations should touch threads meaningfully present in that scene, even if status doesn't change.

CONTINUITY MUTATIONS:
- Track INFORMATION ASYMMETRY — what one character knows that others don't
- Each entry should pass the test: "Would the story change if this character didn't know this?"`;

  const raw = await callAnalysis(prompt, systemPrompt, onToken);
  const json = extractJSON(raw);
  let parsed: AnalysisChunkResult;
  try {
    parsed = JSON.parse(json) as AnalysisChunkResult;
  } catch {
    const repaired = json
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\x00-\x1F\x7F]/g, (ch) => ch === '\n' || ch === '\t' ? ch : '');
    parsed = JSON.parse(repaired) as AnalysisChunkResult;
  }

  // Validate extraction result
  const validation = validateExtractionResult(parsed);
  if (!validation.valid) {
    logWarning(
      `Chunk ${chunkIndex + 1} parallel extraction validation failed`,
      validation.errors.join('; '),
      {
        source: 'analysis',
        operation: 'chunk-extraction-parallel',
        details: { chunkIndex, totalChunks, errorCount: validation.errors.length }
      }
    );
    throw new Error(`Extraction validation failed for chunk ${chunkIndex + 1}/${totalChunks}:\n${validation.errors.join('\n')}`);
  }

  for (const scene of parsed.scenes ?? []) {
    const sectionNums: number[] = scene.sections ?? [];
    scene.prose = sectionNums
      .filter((n) => n >= 1 && n <= sections.length)
      .sort((a, b) => a - b)
      .map((n) => sections[n - 1])
      .join('\n\n');
  }

  return parsed;
}

// ── Reconciliation (Phase 3) ─────────────────────────────────────────────────
// Phase 2 (beat plan extraction) is handled by analysis-runner.ts directly

type CharacterNameMap = Record<string, string>; // variant → canonical

/**
 * Reconcile independently-extracted chunk results:
 * - Merge character name variants into canonical names
 * - Stitch thread continuity across chunks (connect same threads, fix status chains)
 * - Deduplicate locations
 */
export async function reconcileResults(
  results: AnalysisChunkResult[],
  onToken?: (token: string, accumulated: string) => void,
): Promise<AnalysisChunkResult[]> {
  // Collect all unique names and thread descriptions across chunks
  const allCharNames = new Set<string>();
  const allThreadDescs = new Set<string>();
  const allLocNames = new Set<string>();
  const allWKConcepts = new Set<string>();

  for (const r of results) {
    for (const c of r.characters ?? []) allCharNames.add(c.name);
    for (const t of r.threads ?? []) allThreadDescs.add(t.description);
    for (const l of r.locations ?? []) allLocNames.add(l.name);
    for (const s of r.scenes ?? []) {
      for (const n of s.worldKnowledgeMutations?.addedNodes ?? []) allWKConcepts.add(n.concept);
    }
  }

  // Ask LLM to identify duplicates and merge them
  const reconciliationPrompt = `You are reconciling narrative data extracted independently from ${results.length} chunks of the same story.
Different chunks may refer to the same character, thread, or location using different names or descriptions.

CHARACTERS found across all chunks:
${[...allCharNames].map((n, i) => `${i + 1}. "${n}"`).join('\n')}

THREADS found across all chunks:
${[...allThreadDescs].map((d, i) => `${i + 1}. "${d}"`).join('\n')}

LOCATIONS found across all chunks:
${[...allLocNames].map((n, i) => `${i + 1}. "${n}"`).join('\n')}

WORLD KNOWLEDGE CONCEPTS found across all chunks:
${[...allWKConcepts].map((c, i) => `${i + 1}. "${c}"`).join('\n')}

Identify duplicates and SIMILAR entries, then produce merge maps. For each group, pick the BEST canonical name/description.

Return JSON:
{
  "characterMerges": {
    "variant name": "canonical name"
  },
  "threadMerges": {
    "variant thread description": "canonical thread description"
  },
  "locationMerges": {
    "variant location name": "canonical location name"
  },
  "worldKnowledgeMerges": {
    "variant concept": "canonical concept"
  }
}

RULES:
- Only include entries where the variant differs from the canonical
- If a name appears identically across chunks, do NOT include it

CHARACTER MERGING:
- Merge name variants like "Professor McGonagall" / "Minerva McGonagall" / "McGonagall"

LOCATION MERGING:
- Merge different names for the same place

THREAD MERGING — BE AGGRESSIVE:
- Merge threads describing the SAME narrative tension, even if worded differently
- Merge facets of the same conflict (e.g. "Harry's distrust of Snape" + "Snape's suspicious behavior" → single thread)
- Merge threads where one is a subset of another
- Merge threads about the same relationship dynamic
- Goal: 8-15 major threads, not 30+ overlapping ones. When in doubt, merge.
- Pick the most encompassing description as canonical

WORLD KNOWLEDGE MERGING:
- Only merge concepts that are clearly the same idea in different words
- Related but distinct concepts should remain separate

If no duplicates for a category, return empty object {}`;

  const reconciliationSystem = `You are a data reconciliation engine. Identify and merge duplicate entities from independently-extracted narrative data. Return only valid JSON.`;

  const raw = await callAnalysis(reconciliationPrompt, reconciliationSystem, onToken);
  const json = extractJSON(raw);
  let merges: {
    characterMerges: CharacterNameMap;
    threadMerges: Record<string, string>;
    locationMerges: Record<string, string>;
    worldKnowledgeMerges?: Record<string, string>;
  };
  try {
    merges = JSON.parse(json);
  } catch {
    const repaired = json
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\x00-\x1F\x7F]/g, (ch) => ch === '\n' || ch === '\t' ? ch : '');
    merges = JSON.parse(repaired);
  }

  const charMap = merges.characterMerges ?? {};
  const threadMap = merges.threadMerges ?? {};
  const locMap = merges.locationMerges ?? {};
  const wkMap = merges.worldKnowledgeMerges ?? {};

  const resolveChar = (name: string) => charMap[name] ?? name;
  const resolveThread = (desc: string) => threadMap[desc] ?? desc;
  const resolveLoc = (name: string) => locMap[name] ?? name;
  const resolveWK = (concept: string) => wkMap[concept] ?? concept;

  // Apply merges to all results
  const reconciled: AnalysisChunkResult[] = results.map((r) => ({
    ...r,
    characters: deduplicateBy(
      (r.characters ?? []).map((c) => ({
        ...c,
        name: resolveChar(c.name),
        continuity: c.continuity ?? [],
      })),
      (c) => c.name,
      (a, b) => ({
        ...a,
        continuity: [...a.continuity, ...b.continuity],
        role: higherRole(a.role, b.role),
      }),
    ),
    locations: deduplicateBy(
      (r.locations ?? []).map((l) => ({
        ...l,
        name: resolveLoc(l.name),
        parentName: l.parentName ? resolveLoc(l.parentName) : null,
      })),
      (l) => l.name,
      (a, b) => ({ ...a, lore: [...(a.lore ?? []), ...(b.lore ?? [])] }),
    ),
    threads: deduplicateBy(
      (r.threads ?? []).map((t) => ({
        ...t,
        description: resolveThread(t.description),
        participantNames: t.participantNames.map(resolveChar),
        statusAtStart: normalizeStatus(t.statusAtStart),
        statusAtEnd: normalizeStatus(t.statusAtEnd),
      })),
      (t) => t.description,
      (a, b) => ({ ...a, statusAtEnd: b.statusAtEnd, development: `${a.development}; ${b.development}` }),
    ),
    scenes: (r.scenes ?? []).map((s) => ({
      ...s,
      povName: resolveChar(s.povName),
      locationName: resolveLoc(s.locationName),
      participantNames: [...new Set(s.participantNames.map(resolveChar))],
      threadMutations: deduplicateBy(
        (s.threadMutations ?? []).map((tm) => ({
          ...tm,
          threadDescription: resolveThread(tm.threadDescription),
          from: normalizeStatus(tm.from),
          to: normalizeStatus(tm.to),
        })),
        (tm) => tm.threadDescription,
        // When two mutations target the same thread in one scene, keep the widest transition
        (a, b) => ({ ...a, from: a.from, to: b.to }),
      ),
      continuityMutations: (s.continuityMutations ?? []).map((km) => ({
        ...km,
        characterName: resolveChar(km.characterName),
      })),
      relationshipMutations: (s.relationshipMutations ?? []).map((rm) => ({
        ...rm,
        from: resolveChar(rm.from),
        to: resolveChar(rm.to),
      })),
      worldKnowledgeMutations: s.worldKnowledgeMutations ? {
        addedNodes: (s.worldKnowledgeMutations.addedNodes ?? []).map((n) => ({
          ...n,
          concept: resolveWK(n.concept),
        })),
        addedEdges: (s.worldKnowledgeMutations.addedEdges ?? []).map((e) => ({
          ...e,
          fromConcept: resolveWK(e.fromConcept),
          toConcept: resolveWK(e.toConcept),
        })),
      } : undefined,
    })),
    relationships: deduplicateBy(
      (r.relationships ?? []).map((rel) => ({
        ...rel,
        from: resolveChar(rel.from),
        to: resolveChar(rel.to),
      })),
      (rel) => `${rel.from}→${rel.to}`,
      (a, b) => ({ ...a, valence: b.valence }), // keep later valence
    ),
  }));

  // Stitch thread continuity across chunks:
  // 1. Thread-level: statusAtStart of chunk N+1 matches statusAtEnd of chunk N
  // 2. Scene-level: threadMutation.from values are consistent with the running status
  const threadStatusTracker: Record<string, string> = {};
  for (const r of reconciled) {
    // Fix thread-level statuses
    for (const t of r.threads) {
      if (threadStatusTracker[t.description]) {
        t.statusAtStart = threadStatusTracker[t.description];
      }
      threadStatusTracker[t.description] = t.statusAtEnd;
    }

    // Build a per-scene running status from the chunk's thread tracker
    const sceneThreadStatus: Record<string, string> = {};
    // Seed with thread-level statusAtStart for this chunk
    for (const t of r.threads) {
      sceneThreadStatus[t.description] = t.statusAtStart;
    }
    // Also seed from cross-chunk tracker for threads not in this chunk's thread list
    for (const [desc, status] of Object.entries(threadStatusTracker)) {
      if (!sceneThreadStatus[desc]) sceneThreadStatus[desc] = status;
    }

    // Fix scene-level threadMutation from/to values to chain correctly
    for (const scene of r.scenes) {
      for (const tm of scene.threadMutations) {
        const currentStatus = sceneThreadStatus[tm.threadDescription];
        if (currentStatus && tm.from !== currentStatus) {
          tm.from = currentStatus;
        }
        // Update running status for next scene/mutation
        sceneThreadStatus[tm.threadDescription] = tm.to;
      }
    }
  }

  return reconciled;
}

/**
 * Phase 4a: Analyze thread dependencies on canonical (post-merge) thread list.
 * Runs after reconciliation to identify causal relationships between distinct threads.
 */
export async function analyzeThreading(
  canonicalThreads: string[],
  onToken?: (token: string, accumulated: string) => void,
): Promise<Record<string, string[]>> {
  if (canonicalThreads.length < 2) return {};

  const prompt = `You are analyzing narrative threads to identify causal dependencies.

CANONICAL THREADS (post-merge, deduplicated):
${canonicalThreads.map((d, i) => `${i + 1}. "${d}"`).join('\n')}

Identify which threads CAUSALLY DEPEND on other threads. A depends on B means:
- A's resolution is affected by B's trajectory
- B must progress or resolve for A to advance
- They converge at critical story moments

Return JSON:
{
  "threadDependencies": {
    "exact thread description": ["exact dependent thread 1", "exact dependent thread 2"]
  }
}

RULES:
- Use EXACT thread descriptions from the list above — copy-paste precisely
- A thread can depend on multiple others; dependencies can be mutual
- NOT dependencies: threads that are merely thematic, or share characters without causal interaction
- Focus on structural narrative connections, not surface-level similarities
- If no dependencies exist, return { "threadDependencies": {} }`;

  const system = `You are a narrative structure analyst. Identify causal dependencies between story threads. Return only valid JSON.`;

  const raw = await callAnalysis(prompt, system, onToken);
  const json = extractJSON(raw);

  try {
    const parsed = JSON.parse(json);
    return parsed.threadDependencies ?? {};
  } catch {
    const repaired = json
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\x00-\x1F\x7F]/g, (ch) => ch === '\n' || ch === '\t' ? ch : '');
    const parsed = JSON.parse(repaired);
    return parsed.threadDependencies ?? {};
  }
}

/** Normalize free-form LLM status strings to the canonical vocabulary */
function normalizeStatus(raw: string): string {
  const s = raw.trim().toLowerCase();
  // Direct matches
  const allStatuses = [...THREAD_ACTIVE_STATUSES, ...THREAD_TERMINAL_STATUSES] as readonly string[];
  if (allStatuses.includes(s)) return s;
  // Common LLM variants → canonical
  const aliases: Record<string, string> = {
    'inactive': 'dormant', 'latent': 'dormant', 'introduced': 'dormant', 'emerging': 'dormant',
    'developing': 'active', 'ongoing': 'active', 'progressing': 'active', 'in progress': 'active',
    'rising': 'escalating', 'intensifying': 'escalating', 'heightening': 'escalating', 'building': 'escalating',
    'peak': 'critical', 'climactic': 'critical', 'urgent': 'critical', 'crisis': 'critical',
    'concluded': 'resolved', 'completed': 'resolved', 'settled': 'resolved', 'closed': 'resolved',
    'twisted': 'subverted', 'inverted': 'subverted', 'upended': 'subverted', 'reversed': 'subverted',
    'dropped': 'abandoned', 'forgotten': 'abandoned', 'faded': 'abandoned', 'unresolved': 'abandoned',
  };
  if (aliases[s]) return aliases[s];
  // Fuzzy: check if any canonical status is a substring
  for (const canonical of allStatuses) {
    if (s.includes(canonical)) return canonical;
  }
  return s; // keep original if no match — assembleNarrative will still accept it
}

function higherRole(a: string, b: string): string {
  const rank: Record<string, number> = { transient: 0, recurring: 1, anchor: 2 };
  return (rank[b] ?? 0) > (rank[a] ?? 0) ? b : a;
}

function deduplicateBy<T>(items: T[], key: (item: T) => string, merge: (existing: T, incoming: T) => T): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const k = key(item);
    if (map.has(k)) {
      map.set(k, merge(map.get(k)!, item));
    } else {
      map.set(k, item);
    }
  }
  return [...map.values()];
}

// ── Meta-context sampling ────────────────────────────────────────────────────
// Builds a representative snapshot of the corpus for rules/systems/profile
// extraction. Samples evenly across chunks within a ~4000 char budget so it
// scales from 5 chunks to 500 without blowing up prompt size.

function buildMetaContext(
  results: AnalysisChunkResult[],
  characters: Record<string, Character>,
  threads: Record<string, Thread>,
  locations: Record<string, Location>,
  scenes: Record<string, Scene>,
  worldSummary: string,
): string {
  const lines: string[] = [];

  // ── World summary (cap at 2000 chars) ──
  lines.push(`WORLD SUMMARY: ${worldSummary.slice(0, 2000)}`);

  // ── Characters ──
  lines.push(`\nCHARACTERS: ${Object.values(characters).map((c) => `${c.name} (${c.role})`).join(', ')}`);

  // ── Threads ──
  lines.push(`\nTHREADS: ${Object.values(threads).map((t) => `"${t.description}" [${t.status}]`).join(', ')}`);

  // ── Locations ──
  lines.push(`\nLOCATIONS: ${Object.values(locations).map((l) => l.name).join(', ')}`);

  // ── Scene summaries — evenly sampled across the full corpus ──
  const allScenes = Object.values(scenes);
  const SUMMARY_BUDGET = 8;  // target sample count
  const summaryStep = Math.max(1, Math.floor(allScenes.length / SUMMARY_BUDGET));
  const sampledSummaries: string[] = [];
  for (let i = 0; i < allScenes.length && sampledSummaries.length < SUMMARY_BUDGET; i += summaryStep) {
    const s = allScenes[i];
    const pov = Object.values(characters).find((c) => c.id === s.povId)?.name ?? s.povId;
    sampledSummaries.push(`- [${pov}] ${s.summary.slice(0, 150)}`);
  }
  if (sampledSummaries.length > 0) {
    lines.push(`\nSCENE SUMMARIES (${sampledSummaries.length} evenly sampled from ${allScenes.length}):\n${sampledSummaries.join('\n')}`);
  }

  // ── World knowledge concepts — deduplicated, capped ──
  const concepts = new Set<string>();
  for (const r of results) {
    for (const sc of r.scenes) {
      for (const n of sc.worldKnowledgeMutations?.addedNodes ?? []) {
        if (n.concept) concepts.add(`${n.concept} (${n.type})`);
      }
    }
  }
  if (concepts.size > 0) {
    const sampled = [...concepts].slice(0, 25);
    lines.push(`\nWORLD KNOWLEDGE CONCEPTS (${sampled.length} of ${concepts.size}):\n${sampled.join(', ')}`);
  }

  // ── Prose excerpts — sampled from early, middle, late for voice range ──
  const chunksWithProse: { chunkIdx: number; prose: string }[] = [];
  for (let ci = 0; ci < results.length; ci++) {
    for (const sc of results[ci].scenes) {
      if (sc.prose) {
        chunksWithProse.push({ chunkIdx: ci, prose: sc.prose });
        break; // one per chunk is enough
      }
    }
  }

  if (chunksWithProse.length > 0) {
    // Pick up to 4 excerpts: first, ~33%, ~66%, last
    const indices = chunksWithProse.length <= 4
      ? chunksWithProse.map((_, i) => i)
      : [
          0,
          Math.floor(chunksWithProse.length * 0.33),
          Math.floor(chunksWithProse.length * 0.66),
          chunksWithProse.length - 1,
        ];
    const unique = [...new Set(indices)];
    const excerpts = unique.map((i) => chunksWithProse[i].prose.slice(0, 2500));
    lines.push(`\nPROSE EXCERPTS (${excerpts.length} sampled from early/mid/late for voice range):\n${excerpts.map((e) => `---\n${e}\n---`).join('\n')}`);
  } else {
    lines.push('\n(no prose available — infer voice from summaries and world tone)');
  }

  return lines.join('\n');
}

// ── Assemble Narrative ───────────────────────────────────────────────────────

export async function assembleNarrative(
  title: string,
  results: AnalysisChunkResult[],
  threadDependencies: Record<string, string[]>,
  onToken?: (token: string, accumulated: string) => void,
): Promise<NarrativeState> {
  const PREFIX = title.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'TXT';
  let charCounter = 0, locCounter = 0, threadCounter = 0, sceneCounter = 0, arcCounter = 0, kCounter = 0, wkCounter = 0, artifactCounter = 0;

  const nextId = (pre: string, counter: () => number, pad = 2) => `${pre}-${PREFIX}-${String(counter()).padStart(pad, '0')}`;
  const nextCharId = () => nextId('C', () => ++charCounter);
  const nextLocId = () => nextId('L', () => ++locCounter);
  const nextThreadId = () => nextId('T', () => ++threadCounter);
  const nextSceneId = () => nextId('S', () => ++sceneCounter, 3);
  const nextArcId = () => nextId('ARC', () => ++arcCounter);
  const nextKId = () => nextId('K', () => ++kCounter, 3);
  const nextWkId = () => nextId('WK', () => ++wkCounter, 2);
  const nextArtifactIdFn = () => nextId('A', () => ++artifactCounter);

  const charNameToId: Record<string, string> = {};
  const locNameToId: Record<string, string> = {};
  const threadDescToId: Record<string, string> = {};
  const artifactNameToId: Record<string, string> = {};
  const wkConceptToId: Record<string, string> = {}; // lowercase concept → WK ID

  const getWkId = (concept: string) => {
    const key = concept.toLowerCase();
    if (!wkConceptToId[key]) wkConceptToId[key] = nextWkId();
    return wkConceptToId[key];
  };

  const getCharId = (name: string) => { if (!charNameToId[name]) charNameToId[name] = nextCharId(); return charNameToId[name]; };
  const getLocId = (name: string) => { if (!locNameToId[name]) locNameToId[name] = nextLocId(); return locNameToId[name]; };
  const getThreadId = (desc: string) => { if (!threadDescToId[desc]) threadDescToId[desc] = nextThreadId(); return threadDescToId[desc]; };
  const getArtifactId = (name: string) => { if (!artifactNameToId[name]) artifactNameToId[name] = nextArtifactIdFn(); return artifactNameToId[name]; };

  const characters: Record<string, Character> = {};
  const locations: Record<string, Location> = {};
  const artifactEntities: Record<string, Artifact> = {};
  const threads: Record<string, Thread> = {};
  const scenes: Record<string, Scene> = {};
  const arcs: Record<string, Arc> = {};
  const relationshipMap: Record<string, RelationshipEdge> = {};

  // Deferred knowledge: character/location knowledge extracted per-chunk will be
  // attributed to the first scene of that chunk so all knowledge flows through
  // scene mutations (enabling temporal filtering).
  type DeferredKnowledge = { characterId: string; type: string; content: string };
  type DeferredLore = { locationId: string; content: string };
  const chunkDeferredKnowledge: DeferredKnowledge[][] = [];
  const chunkDeferredLore: DeferredLore[][] = [];
  // Track globally to deduplicate knowledge across chunks (same content for same entity)
  const seenCharKnowledge = new Map<string, Set<string>>(); // characterId → set of content
  const seenLocLore = new Map<string, Set<string>>(); // locationId → set of content
  // Track which chunk each entity was first introduced in (for per-batch world commits)
  const charFirstChunk = new Map<string, number>();
  const locFirstChunk = new Map<string, number>();
  const threadFirstChunk = new Map<string, number>();
  const artifactFirstChunk = new Map<string, number>();
  const chunkFirstSceneId = new Map<number, string>(); // chunkIdx → first scene id

  for (let chunkIdx = 0; chunkIdx < results.length; chunkIdx++) {
    const ch = results[chunkIdx];
    const deferredK: DeferredKnowledge[] = [];
    const deferredL: DeferredLore[] = [];

    // Characters — create entities but defer knowledge to scene mutations
    for (const c of ch.characters ?? []) {
      const id = getCharId(c.name);
      if (!characters[id]) {
        characters[id] = {
          id, name: c.name, role: c.role as Character['role'], threadIds: [],
          continuity: { nodes: [] },
          ...(c.imagePrompt ? { imagePrompt: c.imagePrompt } : {}),
        };
        charFirstChunk.set(id, chunkIdx);
      } else if (c.imagePrompt) {
        characters[id].imagePrompt = c.imagePrompt;
      }
      const rank: Record<string, number> = { transient: 0, recurring: 1, anchor: 2 };
      if ((rank[c.role] ?? 0) > (rank[characters[id].role] ?? 0)) {
        characters[id].role = c.role as Character['role'];
      }
      // Defer knowledge to first scene of this chunk (deduplicate across chunks)
      if (!seenCharKnowledge.has(id)) seenCharKnowledge.set(id, new Set());
      const charSeen = seenCharKnowledge.get(id)!;
      for (const k of c.continuity ?? []) {
        if (!charSeen.has(k.content)) {
          deferredK.push({ characterId: id, type: k.type, content: k.content });
          charSeen.add(k.content);
        }
      }
    }

    // Locations — create entities but defer lore to scene mutations
    for (const loc of ch.locations ?? []) {
      const id = getLocId(loc.name);
      if (!locations[id]) {
        const parentId = loc.parentName ? getLocId(loc.parentName) : null;
        locations[id] = {
          id, name: loc.name, parentId, threadIds: [],
          continuity: { nodes: [] },
          ...(loc.imagePrompt ? { imagePrompt: loc.imagePrompt } : {}),
        };
        locFirstChunk.set(id, chunkIdx);
      } else if (loc.imagePrompt) {
        locations[id].imagePrompt = loc.imagePrompt;
      }
      if (!seenLocLore.has(id)) seenLocLore.set(id, new Set());
      const locSeen = seenLocLore.get(id)!;
      for (const lore of loc.lore ?? []) {
        if (!locSeen.has(lore)) {
          deferredL.push({ locationId: id, content: lore });
          locSeen.add(lore);
        }
      }
    }

    // Artifacts
    for (const a of ch.artifacts ?? []) {
      const id = getArtifactId(a.name);
      const ownerName = a.ownerName ?? '';
      const parentId = charNameToId[ownerName] ?? locNameToId[ownerName] ?? (ownerName ? getLocId(ownerName) : '');
      if (!artifactEntities[id]) {
        artifactEntities[id] = {
          id, name: a.name,
          significance: (['key', 'notable', 'minor'].includes(a.significance) ? a.significance : 'notable') as Artifact['significance'],
          continuity: { nodes: (a.continuity ?? []).map((k) => ({ id: nextKId(), type: k.type, content: k.content })) },
          parentId,
        };
        artifactFirstChunk.set(id, chunkIdx);
      } else {
        // Accumulate continuity from later chunks
        for (const k of a.continuity ?? []) {
          if (!artifactEntities[id].continuity.nodes.some((n) => n.content === k.content)) {
            artifactEntities[id].continuity.nodes.push({ id: nextKId(), type: k.type, content: k.content });
          }
        }
        if (parentId) artifactEntities[id].parentId = parentId;
      }
    }

    chunkDeferredKnowledge.push(deferredK);
    chunkDeferredLore.push(deferredL);

    // Threads
    for (const t of ch.threads ?? []) {
      const id = getThreadId(t.description);
      const newAnchors = (t.participantNames ?? []).map((name) => {
        if (charNameToId[name]) return { id: charNameToId[name], type: 'character' as const };
        if (locNameToId[name]) return { id: locNameToId[name], type: 'location' as const };
        return { id: getCharId(name), type: 'character' as const };
      });
      if (!threads[id]) {
        threads[id] = { id, participants: newAnchors, description: t.description, status: t.statusAtEnd ?? 'dormant', openedAt: '', dependents: [] };
        threadFirstChunk.set(id, chunkIdx);
      } else {
        threads[id].status = t.statusAtEnd ?? threads[id].status;
        // Accumulate anchors from later chunks
        const existingAnchorIds = new Set(threads[id].participants.map((a) => a.id));
        for (const anchor of newAnchors) {
          if (!existingAnchorIds.has(anchor.id)) {
            threads[id].participants.push(anchor);
            existingAnchorIds.add(anchor.id);
          }
        }
      }
    }

    // Scenes (one arc per chunk)
    const chScenes: Scene[] = [];
    const arcId = nextArcId();

    for (const s of ch.scenes ?? []) {
      const sceneId = nextSceneId();
      const locationId = getLocId(s.locationName ?? 'Unknown');
      const participantIds = (s.participantNames ?? []).map((n) => getCharId(n));
      const povId = s.povName ? getCharId(s.povName) : participantIds[0] ?? '';

      const scene: Scene = {
        kind: 'scene',
        id: sceneId,
        arcId,
        locationId,
        povId,
        participantIds,
        events: s.events ?? [],
        threadMutations: (s.threadMutations ?? []).map((tm) => ({
          threadId: getThreadId(tm.threadDescription),
          from: tm.from,
          to: tm.to,
        })),
        continuityMutations: (s.continuityMutations ?? []).map((km) => ({
          characterId: getCharId(km.characterName),
          nodeId: nextKId(),
          action: (km.action === 'removed' ? 'removed' : 'added') as 'added' | 'removed',
          content: km.content,
          nodeType: km.type,
        })),
        relationshipMutations: (s.relationshipMutations ?? []).map((rm) => ({
          from: getCharId(rm.from),
          to: getCharId(rm.to),
          type: rm.type,
          valenceDelta: rm.valenceDelta ?? 0,
        })),
        characterMovements: (() => {
          const mvs = s.characterMovements ?? [];
          if (mvs.length === 0) return undefined;
          const result: Record<string, { locationId: string; transition: string }> = {};
          for (const mv of mvs) {
            const charId = getCharId(mv.characterName);
            const locId = getLocId(mv.locationName);
            if (charId && locId && locId !== locationId) {
              result[charId] = { locationId: locId, transition: mv.transition ?? '' };
            }
          }
          return Object.keys(result).length > 0 ? result : undefined;
        })(),
        ownershipMutations: (() => {
          const oms = s.ownershipMutations ?? [];
          if (oms.length === 0) return undefined;
          return oms.map((om) => ({
            artifactId: getArtifactId(om.artifactName),
            fromId: charNameToId[om.fromName] ?? locNameToId[om.fromName] ?? getLocId(om.fromName),
            toId: charNameToId[om.toName] ?? locNameToId[om.toName] ?? getLocId(om.toName),
          })).filter((om) => artifactEntities[om.artifactId]);
        })() || undefined,
        worldKnowledgeMutations: (() => {
          const wkm = s.worldKnowledgeMutations;
          if (!wkm) return undefined;
          const addedNodes = (wkm.addedNodes ?? []).map((n) => ({
            id: getWkId(n.concept),
            concept: n.concept,
            type: (['law', 'system', 'concept', 'tension'].includes(n.type) ? n.type : 'concept') as 'law' | 'system' | 'concept' | 'tension',
          }));
          const addedEdges = (wkm.addedEdges ?? []).map((e) => ({
            from: getWkId(e.fromConcept),
            to: getWkId(e.toConcept),
            relation: e.relation,
          }));
          if (addedNodes.length === 0 && addedEdges.length === 0) return undefined;
          return { addedNodes, addedEdges };
        })(),
        prose: s.prose || undefined,
        plan: s.plan || undefined,
        beatProseMap: s.beatProseMap || undefined,
        summary: s.summary ?? '',
      };

      scenes[sceneId] = scene;
      chScenes.push(scene);
      if (!chunkFirstSceneId.has(chunkIdx)) chunkFirstSceneId.set(chunkIdx, sceneId);
    }

    // Distribute deferred knowledge across the chunk's scenes.
    // Each knowledge node goes to the first scene where that character participates,
    // spreading mutations naturally instead of spiking the first scene.
    if (chScenes.length > 0) {
      const allMutContents = new Set(chScenes.flatMap((s) => s.continuityMutations.map((km) => km.content)));

      for (const dk of chunkDeferredKnowledge[chunkIdx]) {
        if (allMutContents.has(dk.content)) continue;
        // Find the first scene where this character participates
        const target = chScenes.find((s) => s.participantIds.includes(dk.characterId)) ?? chScenes[0];
        target.continuityMutations.push({
          characterId: dk.characterId,
          nodeId: nextKId(),
          action: 'added',
          content: dk.content,
          nodeType: dk.type,
        });
        allMutContents.add(dk.content);
      }

      // Location lore → attributed to the POV of the first scene at that location
      for (const dl of chunkDeferredLore[chunkIdx]) {
        if (allMutContents.has(dl.content)) continue;
        const target = chScenes.find((s) => s.locationId === dl.locationId) ?? chScenes[0];
        const pov = target.povId || target.participantIds[0] || '';
        if (pov) {
          target.continuityMutations.push({
            characterId: pov,
            nodeId: nextKId(),
            action: 'added',
            content: dl.content,
            nodeType: 'lore',
          });
          allMutContents.add(dl.content);
        }
      }
    }

    if (chScenes.length > 0) {
      const sceneIds = chScenes.map((s) => s.id);
      const develops = [...new Set(chScenes.flatMap((s) => s.threadMutations.map((tm) => tm.threadId)))];
      const locationIds = [...new Set(chScenes.map((s) => s.locationId))];
      const activeCharacterIds = [...new Set(chScenes.flatMap((s) => s.participantIds))];
      const initialCharacterLocations: Record<string, string> = {};
      for (const cid of activeCharacterIds) {
        const first = chScenes.find((s) => s.participantIds.includes(cid));
        if (first) initialCharacterLocations[cid] = first.locationId;
      }

      arcs[arcId] = { id: arcId, name: ch.chapterSummary?.slice(0, 40) ?? `Part ${arcCounter}`, sceneIds, develops, locationIds, activeCharacterIds, initialCharacterLocations };

      for (const tm of chScenes.flatMap((s) => s.threadMutations)) {
        if (threads[tm.threadId] && !threads[tm.threadId].openedAt) {
          threads[tm.threadId].openedAt = chScenes[0].id;
        }
      }
    }

    // Relationships — later chunks update type and valence (chronological last-write-wins)
    for (const r of ch.relationships ?? []) {
      const fromId = getCharId(r.from);
      const toId = getCharId(r.to);
      const key = `${fromId}→${toId}`;
      const existing = relationshipMap[key];
      if (existing) {
        // Keep latest type, but blend valence toward the newer value to show progression
        existing.type = r.type;
        existing.valence = r.valence;
      } else {
        relationshipMap[key] = { from: fromId, to: toId, type: r.type, valence: r.valence };
      }
    }
  }

  // Apply thread dependencies from reconciliation (description → array of dependent descriptions)
  const threadDescToIdMap = new Map(Object.values(threads).map((t) => [t.description, t.id]));
  for (const [desc, depDescs] of Object.entries(threadDependencies)) {
    const threadId = threadDescToIdMap.get(desc);
    if (!threadId || !threads[threadId]) continue;
    for (const depDesc of depDescs) {
      const depId = threadDescToIdMap.get(depDesc);
      if (depId && depId !== threadId && !threads[threadId].dependents.includes(depId)) {
        threads[threadId].dependents.push(depId);
      }
    }
  }

  // Wire thread IDs on characters/locations
  for (const thread of Object.values(threads)) {
    for (const anchor of thread.participants) {
      if (anchor.type === 'character' && characters[anchor.id]) {
        if (!characters[anchor.id].threadIds.includes(thread.id)) characters[anchor.id].threadIds.push(thread.id);
      }
      if (anchor.type === 'location' && locations[anchor.id]) {
        if (!locations[anchor.id].threadIds.includes(thread.id)) locations[anchor.id].threadIds.push(thread.id);
      }
    }
  }

  // Build character & location continuity graphs from scene mutations (forward replay)
  // This ensures knowledge.nodes is the final accumulated state and enables temporal filtering.
  const allSceneKeys = Object.keys(scenes);
  for (const sKey of allSceneKeys) {
    const scene = scenes[sKey];
    for (const km of scene.continuityMutations) {
      const char = characters[km.characterId];
      if (!char) continue;
      if (!char.continuity) char.continuity = { nodes: [] };
      if (km.action === 'added') {
        const exists = char.continuity.nodes.some((n) => n.id === km.nodeId);
        if (!exists) {
          char.continuity.nodes.push({ id: km.nodeId, type: km.nodeType ?? 'knowledge', content: km.content });
        }
      } else if (km.action === 'removed') {
        char.continuity.nodes = char.continuity.nodes.filter((n) => n.id !== km.nodeId);
      }
    }
  }

  // Also replay deferred lore onto locations (attributed to POV but stored on location too)
  for (let ci = 0; ci < results.length; ci++) {
    const existingLore = new Set<string>();
    for (const loc of Object.values(locations)) {
      for (const n of (loc.continuity?.nodes ?? [])) existingLore.add(n.content);
    }
    for (const dl of chunkDeferredLore[ci]) {
      const loc = locations[dl.locationId];
      if (loc && !existingLore.has(dl.content)) {
        if (!loc.continuity) loc.continuity = { nodes: [] };
        loc.continuity.nodes.push({ id: nextKId(), type: 'lore', content: dl.content });
        existingLore.add(dl.content);
      }
    }
  }

  const relationships = Object.values(relationshipMap);

  // World builds — one per 3-chunk batch, only when new entities are introduced.
  // The first batch always gets a commit; later batches are skipped if nothing new appeared.
  const WORLD_COMMIT_INTERVAL = 3;
  const worldBuilds: Record<string, WorldBuild> = {};
  // Map from the first scene id of a batch → the world build commit to insert before it
  const worldBuildBeforeScene = new Map<string, string>(); // sceneId → worldBuildId

  for (let batchStart = 0; batchStart < results.length; batchStart += WORLD_COMMIT_INTERVAL) {
    const batchEnd = Math.min(batchStart + WORLD_COMMIT_INTERVAL, results.length);
    const batchChunkIndices = new Set(Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i));
    const isInitial = batchStart === 0;

    const newCharIds = Object.keys(characters).filter((id) => batchChunkIndices.has(charFirstChunk.get(id) ?? 0));
    const newLocIds = Object.keys(locations).filter((id) => batchChunkIndices.has(locFirstChunk.get(id) ?? 0));
    const newThreadIds = Object.keys(threads).filter((id) => batchChunkIndices.has(threadFirstChunk.get(id) ?? 0));
    const newArtifactIds = Object.keys(artifactEntities).filter((id) => batchChunkIndices.has(artifactFirstChunk.get(id) ?? 0));

    if (!isInitial && newCharIds.length === 0 && newLocIds.length === 0 && newThreadIds.length === 0 && newArtifactIds.length === 0) continue;

    const batchNum = Math.floor(batchStart / WORLD_COMMIT_INTERVAL) + 1;
    const worldBuildId = `WB-${PREFIX}-${String(batchNum).padStart(3, '0')}`;
    const artSuffix = newArtifactIds.length > 0 ? `, ${newArtifactIds.length} artifacts` : '';
    const summary = isInitial
      ? `Initial world: ${newCharIds.length} characters, ${newLocIds.length} locations, ${newThreadIds.length} threads${artSuffix}`
      : `Chunks ${batchStart + 1}–${batchEnd}: +${newCharIds.length} characters, +${newLocIds.length} locations, +${newThreadIds.length} threads${artSuffix}`;

    worldBuilds[worldBuildId] = {
      kind: 'world_build',
      id: worldBuildId,
      summary,
      expansionManifest: {
        characters: newCharIds.map((id) => characters[id]).filter(Boolean),
        locations: newLocIds.map((id) => locations[id]).filter(Boolean),
        threads: newThreadIds.map((id) => threads[id]).filter(Boolean),
        relationships: [],
        worldKnowledge: { addedNodes: [], addedEdges: [] },
        artifacts: newArtifactIds.map((id) => artifactEntities[id]).filter(Boolean),
      },
    };

    // Find the first scene of the first chunk in this batch
    for (let ci = batchStart; ci < batchEnd; ci++) {
      const firstScene = chunkFirstSceneId.get(ci);
      if (firstScene) { worldBuildBeforeScene.set(firstScene, worldBuildId); break; }
    }
  }

  // Build entryIds: world build commits interleaved before their batch's first scene
  const entryIds: string[] = [];
  for (const sceneId of Object.keys(scenes)) {
    const worldBuildId = worldBuildBeforeScene.get(sceneId);
    if (worldBuildId) entryIds.push(worldBuildId);
    entryIds.push(sceneId);
  }

  // Branch
  const branchId = `B-${PREFIX}-MAIN`;
  const branches: Record<string, Branch> = {
    [branchId]: {
      id: branchId,
      name: 'Canon Timeline',
      parentBranchId: null,
      forkEntryId: null,
      entryIds,
      createdAt: Date.now() - 86400000,
    },
  };

  const worldSummary = results.map((ch) => ch.chapterSummary).join(' ');

  // Generate rules, systems, and image style from the analyzed content
  let rules: string[] = [];
  let worldSystems: NarrativeState['worldSystems'] = [];
  let imageStyle: string | undefined;
  let proseProfile: ProseProfile | undefined;
  let planGuidance = '';

  try {
    const metaResult = await callAnalysis(
      `Based on the following world summary and character/thread data, extract:

1. WORLD RULES (3-6): High-level absolute constraints that define this series — things that are ALWAYS true in this universe. Rules are broad laws, not mechanical details. For simple/realistic worlds based on our own, extract fewer rules since real-world physics are assumed. For complex fantasy/sci-fi worlds, extract more.

2. WORLD SYSTEMS (0-6): Structured mechanics that define how this world uniquely operates. A system is any distinct mechanic, institution, force, or structure that shapes the world. For each system provide: name, description, principles (how it works), constraints (hard limits/costs), and interactions (cross-system connections). Simple/realistic worlds may have few or no systems — don't force them. Complex fantasy/sci-fi worlds with unique power systems, economies, or social structures should have several.

3. IMAGE STYLE: A short (1-2 sentence) visual style description for consistent imagery.

4. PROSE PROFILE: Infer the author's distinctive voice and style from the text. Use your own words — choose values that accurately describe this specific work, not generic labels.
   - register: tonal register (conversational/literary/raw/clinical/sardonic/lyrical/mythic/journalistic or other)
   - stance: narrative stance (close_third/intimate_first_person/omniscient_ironic/detached_observer/unreliable_first or other)
   - tense: grammatical tense (past/present)
   - sentenceRhythm: structural cadence (terse/varied/flowing/staccato/periodic or other)
   - interiority: depth of character thought access (surface/moderate/deep/embedded)
   - dialogueWeight: proportion of dialogue (sparse/moderate/heavy/almost_none)
   - devices: 2-5 literary devices this author characteristically employs (specific, not generic)
   - rules: 3-6 SPECIFIC prose rules as imperatives — concrete enough to apply sentence-by-sentence. Derive these from what the author DOES. BAD: "Write well". GOOD: "Show emotion through physical reaction, never name it" / "No figurative language — just plain statements of fact" / "Exposition delivered only through discovery and dialogue" / "Terse does not mean monotone — vary between clipped fragments and occasional longer compound sentences"
   - antiPatterns: 3-5 SPECIFIC prose failures to avoid — concrete patterns that would break this author's voice. Derive from what the author does NOT do. BAD: "Don't be boring". GOOD: "NEVER use 'This was a [Name]' to introduce a mechanic — show what it does" / "No strategic summaries in internal monologue ('He calculated that...') — show calculation through action" / "Do not follow a reveal with a sentence restating its significance" / "Do not write narrator summaries of what the character already achieved on-page"

5. PLAN GUIDANCE: 2-4 sentences of specific guidance for scene beat plans. What mechanisms should dominate? How should exposition be handled? What should plans avoid? Be specific to this work's voice.

${buildMetaContext(results, characters, threads, locations, scenes, worldSummary)}

Return JSON:
{
  "rules": ["rule1", "rule2"],
  "worldSystems": [
    {"name": "System Name", "description": "One-line summary", "principles": ["How it works"], "constraints": ["Hard limits"], "interactions": ["Cross-system connections"]}
  ],
  "imageStyle": "style directive",
  "proseProfile": {
    "register": "string",
    "stance": "string",
    "tense": "string",
    "sentenceRhythm": "string",
    "interiority": "string",
    "dialogueWeight": "string",
    "devices": ["device1", "device2"],
    "rules": ["prose rule 1", "prose rule 2"],
    "antiPatterns": ["anti-pattern 1", "anti-pattern 2"]
  },
  "planGuidance": "How beat plans should be structured for this work"
}`,
      'You are a world-building and literary analyst. Extract the implicit rules, mechanical systems, visual style, and prose voice of a narrative universe. Return only valid JSON.',
      onToken,
    );
    const metaParsed = JSON.parse(extractJSON(metaResult));
    rules = metaParsed.rules ?? [];
    imageStyle = metaParsed.imageStyle;
    if (metaParsed.proseProfile && typeof metaParsed.proseProfile === 'object') {
      const pp = metaParsed.proseProfile;
      const str = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : undefined;
      proseProfile = {
        register:       str(pp.register)       ?? '',
        stance:         str(pp.stance)         ?? '',
        tense:          str(pp.tense),
        sentenceRhythm: str(pp.sentenceRhythm),
        interiority:    str(pp.interiority),
        dialogueWeight: str(pp.dialogueWeight),
        devices:        Array.isArray(pp.devices) ? pp.devices.filter((d: unknown) => typeof d === 'string') : [],
        rules:          Array.isArray(pp.rules)   ? pp.rules.filter((r: unknown) => typeof r === 'string')   : [],
        antiPatterns:   Array.isArray(pp.antiPatterns) ? pp.antiPatterns.filter((a: unknown) => typeof a === 'string') : [],
      };
    }
    if (typeof metaParsed.planGuidance === 'string' && metaParsed.planGuidance.trim()) {
      planGuidance = metaParsed.planGuidance.trim();
    }
    if (Array.isArray(metaParsed.worldSystems)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      worldSystems = metaParsed.worldSystems.filter((s: any) => s && typeof s.name === 'string').map((s: any) => ({
        id: `WS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: s.name,
        description: typeof s.description === 'string' ? s.description : '',
        principles: Array.isArray(s.principles) ? s.principles.filter((p: unknown) => typeof p === 'string') : [],
        constraints: Array.isArray(s.constraints) ? s.constraints.filter((c: unknown) => typeof c === 'string') : [],
        interactions: Array.isArray(s.interactions) ? s.interactions.filter((x: unknown) => typeof x === 'string') : [],
      }));
    }
  } catch (err) {
    logWarning(
      'Rules/systems/style extraction failed - using defaults',
      err instanceof Error ? err : String(err),
      {
        source: 'analysis',
        operation: 'meta-extraction',
        details: { title, chunkCount: results.length }
      }
    );
  }

  const narrative: NarrativeState = {
    id: `N-${PREFIX}-${Date.now().toString(36)}`,
    title,
    description: results[0]?.chapterSummary || title,
    characters,
    locations,
    threads,
    artifacts: artifactEntities,
    arcs,
    scenes,
    worldBuilds,
    branches,
    relationships,
    worldKnowledge: { nodes: {}, edges: [] }, // derived — recomputed by withDerivedEntities on load
    worldSummary,
    rules,
    worldSystems,
    imageStyle,
    proseProfile,
    storySettings: planGuidance ? { ...DEFAULT_STORY_SETTINGS, planGuidance } : undefined,
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now(),
  };

  return narrative;
}
