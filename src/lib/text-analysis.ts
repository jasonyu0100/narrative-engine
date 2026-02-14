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
  Character, Location, Thread, Arc, Scene, RelationshipEdge,
  WorldBuildCommit, Branch, Commit,
} from '@/types/narrative';
import { THREAD_ACTIVE_STATUSES, THREAD_TERMINAL_STATUSES, THREAD_STATUS_LABELS } from '@/types/narrative';

// ── Text Splitting ───────────────────────────────────────────────────────────

const TARGET_SECTIONS_PER_CHUNK = 12;
const TARGET_CHUNK_WORDS = 4000;

function splitIntoSections(text: string): string[] {
  let chunks = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  if (chunks.length < 6) {
    const continuous = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const sentences = continuous.match(/[^.!?]+[.!?]+["']?\s*/g) ?? [continuous];
    const sentencesPerChunk = Math.max(1, Math.round(sentences.length / TARGET_SECTIONS_PER_CHUNK));
    chunks = [];
    for (let i = 0; i < sentences.length; i += sentencesPerChunk) {
      chunks.push(sentences.slice(i, i + sentencesPerChunk).join('').trim());
    }
  } else {
    const parasPerSection = Math.max(1, Math.round(chunks.length / TARGET_SECTIONS_PER_CHUNK));
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
    for (let i = 0; i < words.length; i += TARGET_CHUNK_WORDS) {
      rawChunks.push(words.slice(i, i + TARGET_CHUNK_WORDS).join(' '));
    }
  }

  // Merge very small chunks and split very large ones
  const merged: string[] = [];
  let buffer = '';
  for (const chunk of rawChunks) {
    const wordCount = chunk.split(/\s+/).length;
    if (buffer && (buffer.split(/\s+/).length + wordCount) > TARGET_CHUNK_WORDS * 1.5) {
      merged.push(buffer);
      buffer = chunk;
    } else if (wordCount > TARGET_CHUNK_WORDS * 2) {
      if (buffer) merged.push(buffer);
      buffer = '';
      // Split oversized chunk
      const words = chunk.split(/\s+/);
      for (let i = 0; i < words.length; i += TARGET_CHUNK_WORDS) {
        merged.push(words.slice(i, i + TARGET_CHUNK_WORDS).join(' '));
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

  const characters: Record<string, { name: string; role: string; knowledge: { type: string; content: string; chunk: number }[] }> = {};
  const locations: Record<string, { name: string; parentName: string | null; description: string; lore: string[] }> = {};
  const threads: Record<string, { description: string; anchorNames: string[]; currentStatus: string; history: string[] }> = {};
  const relationships: Record<string, { from: string; to: string; type: string; valence: number }> = {};
  const sceneHistory: string[] = [];
  let sceneCounter = 0;

  completed.forEach((ch, chIdx) => {
    for (const c of ch.characters ?? []) {
      if (!characters[c.name]) {
        characters[c.name] = { name: c.name, role: c.role, knowledge: [] };
      }
      const rank: Record<string, number> = { transient: 0, recurring: 1, anchor: 2 };
      if ((rank[c.role] ?? 0) > (rank[characters[c.name].role] ?? 0)) {
        characters[c.name].role = c.role;
      }
      for (const k of c.knowledge ?? []) {
        characters[c.name].knowledge.push({ type: k.type, content: k.content, chunk: chIdx + 1 });
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
        threads[key] = { description: t.description, anchorNames: t.anchorNames, currentStatus: t.statusAtEnd, history: [`Chunk${chIdx + 1}: ${t.statusAtStart} → ${t.statusAtEnd}`] };
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
      const kChanges = (scene.knowledgeMutations ?? []).map((km) => `${km.characterName} learned [${km.type}]: ${km.content}`).join('; ');
      sceneHistory.push(
        `[Chunk${chIdx + 1} S${sceneCounter}] @ ${scene.locationName} | POV: ${scene.povName} | ${scene.participantNames?.join(', ')}` +
        (threadChanges ? ` | Threads: ${threadChanges}` : '') +
        (kChanges ? ` | Knowledge: ${kChanges}` : '') +
        `\n   ${scene.summary}`,
      );
    }
  });

  const charBlock = Object.values(characters).map((c) => {
    const kLines = c.knowledge.map((k) => `    (${k.type}) ${k.content} [Chunk${k.chunk}]`);
    return `- ${c.name} (${c.role})${kLines.length > 0 ? '\n  Knowledge:\n' + kLines.join('\n') : ''}`;
  }).join('\n');

  const locBlock = Object.values(locations).map((l) =>
    `- ${l.name}${l.parentName ? ` (inside ${l.parentName})` : ''}: ${l.description}`,
  ).join('\n');

  const threadBlock = Object.values(threads).map((t) =>
    `- "${t.description}" [${t.currentStatus}] anchors: ${t.anchorNames.join(', ')} | history: ${t.history.join(', ')}`,
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
  const logId = logApiCall('analyzeChunk', prompt.length + systemPrompt.length, prompt);
  const start = performance.now();

  try {
    const useStream = !!onToken;
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ prompt, systemPrompt, maxTokens: 32000, stream: useStream }),
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
- Characters with roles (anchor = central, recurring = frequent, transient = minor) and knowledge graphs
- Locations with parent-child hierarchy and lore/secrets
- Narrative threads — ongoing tensions that evolve: ${THREAD_ACTIVE_STATUSES.join(' → ')} → ${THREAD_TERMINAL_STATUSES.join('/')}
- Scenes with POV character, events, thread mutations, knowledge mutations, and relationship mutations
- Relationships — directional with sentiment valence (-1 to 1) and descriptive type

CHARACTERS: Only extract PEOPLE who speak, act, or are spoken about as individuals. Do NOT include animals, objects, institutions, publications, textbook authors mentioned only in passing, or named items. Use a single canonical name per character — if someone is called both "Professor McGonagall" and "Minerva McGonagall", pick the most common form and use it consistently. Check prior chunk names and reuse the EXACT same name string for returning characters.

THREADS: Threads are narrative tensions that DRIVE THE STORY FORWARD — unresolved questions, active conflicts, and evolving dynamics that create stakes and suspense. Every thread should pass this test: "Does this create tension that makes the reader want to know what happens next?"
- Plot threads: mysteries to solve, quests to complete, dangers to overcome, conspiracies unfolding
- Character threads: internal conflicts, secrets being kept, desires in tension with duty
- Relationship threads: rivalries escalating, alliances under strain, trust being tested
Do NOT extract: world-building facts, character descriptions, setting details, one-off observations, or things that are simply "interesting" but create no narrative tension. "The existence of the Ministry of Magic" is world-building. "The Ministry's coverup of the breakout" is a thread.
Aim for 8-15 threads per chunk. For continuing threads, you MUST reuse the EXACT description string from prior chunks. Only create a new thread when a genuinely new tension emerges.

Knowledge types must be SPECIFIC and CONTEXTUAL — not generic labels like "knows" or "secret". Use types that describe exactly what kind of knowledge: "social_observation", "class_awareness", "romantic_longing", "moral_judgment", "hidden_wealth_source", "past_betrayal", "forbidden_desire", "strategic_deception", etc.

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
      "knowledge": [
        { "type": "specific_contextual_type", "content": "What they learn, reveal, or demonstrate in THIS chunk" }
      ]
    }
  ],
  "locations": [
    { "name": "Location Name", "parentName": "Parent Location or null", "description": "Brief atmospheric description", "lore": ["Notable detail or significance"] }
  ],
  "threads": [
    {
      "description": "The narrative question or tension — use EXACT description from prior chunks for continuing threads",
      "anchorNames": ["Character or location names this thread is anchored to"],
      "statusAtStart": "status at chunk start",
      "statusAtEnd": "status at chunk end",
      "development": "How this thread developed in this chunk"
    }
  ],
  "scenes": [
    {
      "locationName": "Where it happens",
      "povName": "Name of the POV character for this scene",
      "participantNames": ["Who is present"],
      "events": ["short_event_tag_1", "short_event_tag_2"],
      "summary": "2-4 sentence vivid summary in present tense, literary style.",
      "sections": [1, 2, 3],
      "threadMutations": [
        { "threadDescription": "exact thread description", "from": "status", "to": "status" }
      ],
      "knowledgeMutations": [
        { "characterName": "Name", "action": "added", "content": "What they learned", "type": "specific_contextual_type" }
      ],
      "relationshipMutations": [
        { "from": "Name", "to": "Name", "type": "Description of relationship shift", "valenceDelta": -0.3 }
      ]
    }
  ],
  "relationships": [
    { "from": "Name", "to": "Name", "type": "Descriptive relationship", "valence": -1 to 1 }
  ]
}

RULES:
- Break the chunk into 2-5 distinct scenes based on location shifts, time jumps, or major tonal changes
- Every scene MUST have a non-empty "summary", at least one event tag, and a "povName"
- "sections" is an array of section numbers (1-indexed) that this scene covers. Together, all scenes should cover all ${sections.length} sections.
${cumulativeCtx ? `
CUMULATIVE CONTINUITY:
- Thread "statusAtStart" MUST match the thread's current status from the THREADS section above
- Reuse EXACT thread descriptions from prior chunks for continuing threads
- Relationship valence should evolve from prior values
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

KNOWLEDGE MUTATIONS:
- Track INFORMATION ASYMMETRY — what one character knows that others don't
- Each entry should pass the test: "Would the story change if this character didn't know this?"`;

  const raw = await callAnalysis(prompt, systemPrompt, onToken);
  const json = extractJSON(raw);
  const parsed = JSON.parse(json) as AnalysisChunkResult;

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

// ── Assemble Narrative ───────────────────────────────────────────────────────

export async function assembleNarrative(
  title: string,
  results: AnalysisChunkResult[],
): Promise<NarrativeState> {
  const PREFIX = title.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'TXT';
  let charCounter = 0, locCounter = 0, threadCounter = 0, sceneCounter = 0, arcCounter = 0, kCounter = 0;

  const nextId = (pre: string, counter: () => number, pad = 2) => `${pre}-${PREFIX}-${String(counter()).padStart(pad, '0')}`;
  const nextCharId = () => nextId('C', () => ++charCounter);
  const nextLocId = () => nextId('L', () => ++locCounter);
  const nextThreadId = () => nextId('T', () => ++threadCounter);
  const nextSceneId = () => nextId('S', () => ++sceneCounter, 3);
  const nextArcId = () => nextId('ARC', () => ++arcCounter);
  const nextKId = () => nextId('K', () => ++kCounter, 3);

  const charNameToId: Record<string, string> = {};
  const locNameToId: Record<string, string> = {};
  const threadDescToId: Record<string, string> = {};

  const getCharId = (name: string) => { if (!charNameToId[name]) charNameToId[name] = nextCharId(); return charNameToId[name]; };
  const getLocId = (name: string) => { if (!locNameToId[name]) locNameToId[name] = nextLocId(); return locNameToId[name]; };
  const getThreadId = (desc: string) => { if (!threadDescToId[desc]) threadDescToId[desc] = nextThreadId(); return threadDescToId[desc]; };

  const characters: Record<string, Character> = {};
  const locations: Record<string, Location> = {};
  const threads: Record<string, Thread> = {};
  const scenes: Record<string, Scene> = {};
  const arcs: Record<string, Arc> = {};
  const relationshipMap: Record<string, RelationshipEdge> = {};

  for (const ch of results) {
    // Characters
    for (const c of ch.characters ?? []) {
      const id = getCharId(c.name);
      if (!characters[id]) {
        characters[id] = {
          id, name: c.name, role: c.role as Character['role'], threadIds: [],
          knowledge: { nodes: [], edges: [] },
        };
      }
      const rank: Record<string, number> = { transient: 0, recurring: 1, anchor: 2 };
      if ((rank[c.role] ?? 0) > (rank[characters[id].role] ?? 0)) {
        characters[id].role = c.role as Character['role'];
      }
      for (const k of c.knowledge ?? []) {
        const kId = nextKId();
        characters[id].knowledge.nodes.push({ id: kId, type: k.type, content: k.content });
      }
    }

    // Locations
    for (const loc of ch.locations ?? []) {
      const id = getLocId(loc.name);
      if (!locations[id]) {
        const parentId = loc.parentName ? getLocId(loc.parentName) : null;
        locations[id] = {
          id, name: loc.name, parentId, threadIds: [],
          knowledge: { nodes: [], edges: [] },
        };
        for (const lore of loc.lore ?? []) {
          const kId = nextKId();
          locations[id].knowledge.nodes.push({ id: kId, type: 'lore', content: lore });
        }
      }
    }

    // Threads
    for (const t of ch.threads ?? []) {
      const id = getThreadId(t.description);
      if (!threads[id]) {
        const anchors = (t.anchorNames ?? []).map((name) => {
          if (charNameToId[name]) return { id: charNameToId[name], type: 'character' as const };
          if (locNameToId[name]) return { id: locNameToId[name], type: 'location' as const };
          return { id: getCharId(name), type: 'character' as const };
        });
        threads[id] = { id, anchors, description: t.description, status: t.statusAtEnd ?? 'dormant', openedAt: '', dependents: [] };
      } else {
        threads[id].status = t.statusAtEnd ?? threads[id].status;
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
        knowledgeMutations: (s.knowledgeMutations ?? []).map((km) => ({
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
        prose: s.prose || undefined,
        summary: s.summary ?? '',
      };

      scenes[sceneId] = scene;
      chScenes.push(scene);
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

    // Relationships
    for (const r of ch.relationships ?? []) {
      const fromId = getCharId(r.from);
      const toId = getCharId(r.to);
      relationshipMap[`${fromId}→${toId}`] = { from: fromId, to: toId, type: r.type, valence: r.valence };
    }
  }

  // Wire thread IDs on characters/locations
  for (const thread of Object.values(threads)) {
    for (const anchor of thread.anchors) {
      if (anchor.type === 'character' && characters[anchor.id]) {
        if (!characters[anchor.id].threadIds.includes(thread.id)) characters[anchor.id].threadIds.push(thread.id);
      }
      if (anchor.type === 'location' && locations[anchor.id]) {
        if (!locations[anchor.id].threadIds.includes(thread.id)) locations[anchor.id].threadIds.push(thread.id);
      }
    }
  }

  // Knowledge edges
  for (const char of Object.values(characters)) {
    const nodes = char.knowledge.nodes;
    for (let i = 1; i < nodes.length; i++) {
      char.knowledge.edges.push({ from: nodes[i - 1].id, to: nodes[i].id, type: 'develops' });
    }
  }

  const relationships = Object.values(relationshipMap);

  // Commits
  const sceneList = Object.values(scenes);
  const commits: Commit[] = sceneList.map((scene, i) => ({
    id: `CM-${PREFIX}-${String(i + 1).padStart(3, '0')}`,
    parentId: i === 0 ? null : `CM-${PREFIX}-${String(i).padStart(3, '0')}`,
    sceneId: scene.id,
    arcId: scene.arcId,
    diffName: scene.events[0] ?? 'scene',
    threadMutations: scene.threadMutations,
    knowledgeMutations: scene.knowledgeMutations,
    relationshipMutations: scene.relationshipMutations,
    authorOverride: null,
    createdAt: Date.now() - (sceneList.length - i) * 3600000,
  }));

  // World build
  const wxId = `WX-${PREFIX}-init`;
  const worldBuild: WorldBuildCommit = {
    kind: 'world_build',
    id: wxId,
    summary: `World analyzed: ${Object.keys(characters).length} characters, ${Object.keys(locations).length} locations, ${Object.keys(threads).length} threads, ${relationships.length} relationships`,
    expansionManifest: {
      characterIds: Object.keys(characters),
      locationIds: Object.keys(locations),
      threadIds: Object.keys(threads),
      relationshipCount: relationships.length,
    },
  };

  // Branch
  const branchId = `B-${PREFIX}-MAIN`;
  const branches: Record<string, Branch> = {
    [branchId]: {
      id: branchId,
      name: 'Canon Timeline',
      parentBranchId: null,
      forkEntryId: null,
      entryIds: [wxId, ...Object.keys(scenes)],
      createdAt: Date.now() - 86400000,
    },
  };

  const worldSummary = results.map((ch) => ch.chapterSummary).join(' ');

  // Generate rules and image style from the analyzed content
  let rules: string[] = [];
  let imageStyle: string | undefined;

  try {
    const metaResult = await callAnalysis(
      `Based on the following world summary and character/thread data, extract:
1. 3-6 world rules — absolute constraints that this narrative universe follows (laws of magic, social structures, technological limits, etc.)
2. An image style directive — a short (1-2 sentence) visual style description that would produce consistent imagery for this world (e.g. "Dark oil painting style with muted earth tones and dramatic chiaroscuro lighting" or "Clean cel animation with vibrant saturated colors and expressive linework")

WORLD SUMMARY: ${worldSummary.slice(0, 2000)}

CHARACTERS: ${Object.values(characters).map((c) => `${c.name} (${c.role})`).join(', ')}

THREADS: ${Object.values(threads).map((t) => `"${t.description}" [${t.status}]`).join(', ')}

LOCATIONS: ${Object.values(locations).map((l) => l.name).join(', ')}

Return JSON: { "rules": ["rule1", "rule2", ...], "imageStyle": "style directive" }`,
      'You are a world-building analyst. Extract the implicit rules and visual style of a narrative universe. Return only valid JSON.',
    );
    const metaParsed = JSON.parse(extractJSON(metaResult));
    rules = metaParsed.rules ?? [];
    imageStyle = metaParsed.imageStyle;
  } catch (err) {
    console.error('[text-analysis] Rules/style extraction failed:', err);
  }

  const narrative: NarrativeState = {
    id: `N-${PREFIX}-${Date.now().toString(36)}`,
    title,
    description: results[0]?.chapterSummary || title,
    characters,
    locations,
    threads,
    arcs,
    scenes,
    worldBuilds: { [wxId]: worldBuild },
    branches,
    commits,
    relationships,
    worldSummary,
    rules,
    controlMode: 'auto',
    activeForces: { payoff: 0, change: 0, variety: 0 },
    imageStyle,
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now(),
  };

  return narrative;
}
