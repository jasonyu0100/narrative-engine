#!/usr/bin/env npx tsx
/**
 * analyze-chapter.ts — Analyze a single chapter .txt file and extract narrative elements.
 *
 * Uses the same methodology as src/lib/ai.ts (branchContext, generateScenes):
 * - Full cumulative world state passed as context (characters with knowledge graphs,
 *   locations with hierarchy, threads with status lifecycle, relationships with valence)
 * - Full scene history from prior chapters with all mutations
 * - Contextual knowledge types (not generic "knows"/"secret")
 * - Thread lifecycle: dormant → surfacing → escalating → threatened → critical → resolved/subverted/done
 * - Pacing-aware scene extraction
 *
 * Usage:
 *   npx tsx scripts/analyze-chapter.ts <book-dir> <chapter-num> [--model <model>]
 *
 * Expects:  <book-dir>/chapters/chapter-01.txt, chapter-02.txt, ...
 * Outputs:  <book-dir>/analysis/chapter-01.json, chapter-02.json, ...
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(__dirname, '..', '.env.local') });

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.5-flash';

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: npx tsx scripts/analyze-chapter.ts <book-dir> <chapter-num> [--model <model>]');
  process.exit(1);
}

const bookDir = args[0];
const chapterNum = parseInt(args[1], 10);
const modelIdx = args.indexOf('--model');
const model = modelIdx !== -1 ? args[modelIdx + 1] : DEFAULT_MODEL;

const chapterFile = join(bookDir, 'chapters', `chapter-${String(chapterNum).padStart(2, '0')}.txt`);
const analysisDir = join(bookDir, 'analysis');
const outputFile = join(analysisDir, `chapter-${String(chapterNum).padStart(2, '0')}.json`);

if (!existsSync(chapterFile)) {
  console.error(`Chapter file not found: ${chapterFile}`);
  process.exit(1);
}

mkdirSync(analysisDir, { recursive: true });

// ── Build cumulative world state (mirrors ai.ts branchContext) ──────────────
function buildCumulativeContext(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type ChapterData = any;

  const allChapters: ChapterData[] = [];
  for (let i = 1; i < chapterNum; i++) {
    const f = join(analysisDir, `chapter-${String(i).padStart(2, '0')}.json`);
    if (existsSync(f)) allChapters.push({ chapter: i, ...JSON.parse(readFileSync(f, 'utf-8')) });
  }
  if (allChapters.length === 0) return '';

  // ── Characters with full knowledge graph ──
  const characters: Record<string, {
    name: string; role: string;
    knowledge: { type: string; content: string; chapter: number }[];
  }> = {};

  // ── Locations with hierarchy ──
  const locations: Record<string, {
    name: string; parentName: string | null; description: string;
    lore: string[];
  }> = {};

  // ── Threads with full status history ──
  const threads: Record<string, {
    description: string; anchorNames: string[];
    currentStatus: string; history: string[];
  }> = {};

  // ── Relationships (latest state) ──
  const relationships: Record<string, {
    from: string; to: string; type: string; valence: number;
  }> = {};

  // ── Full scene history (mirrors branchContext scene history) ──
  const sceneHistory: string[] = [];
  let sceneCounter = 0;

  for (const ch of allChapters) {
    // Characters
    for (const c of ch.characters ?? []) {
      if (!characters[c.name]) {
        characters[c.name] = { name: c.name, role: c.role, knowledge: [] };
      }
      const rank: Record<string, number> = { transient: 0, recurring: 1, anchor: 2 };
      if ((rank[c.role] ?? 0) > (rank[characters[c.name].role] ?? 0)) {
        characters[c.name].role = c.role;
      }
      for (const k of c.knowledge ?? []) {
        characters[c.name].knowledge.push({ type: k.type, content: k.content, chapter: ch.chapter });
      }
    }

    // Locations
    for (const loc of ch.locations ?? []) {
      if (!locations[loc.name]) {
        locations[loc.name] = {
          name: loc.name, parentName: loc.parentName,
          description: loc.description, lore: loc.lore ?? [],
        };
      }
    }

    // Threads
    for (const t of ch.threads ?? []) {
      const key = t.description;
      if (!threads[key]) {
        threads[key] = {
          description: t.description, anchorNames: t.anchorNames,
          currentStatus: t.statusAtEnd,
          history: [`Ch${ch.chapter}: ${t.statusAtStart} → ${t.statusAtEnd}`],
        };
      } else {
        threads[key].currentStatus = t.statusAtEnd;
        threads[key].history.push(`Ch${ch.chapter}: ${t.statusAtStart} → ${t.statusAtEnd}`);
      }
    }

    // Relationships
    for (const r of ch.relationships ?? []) {
      relationships[`${r.from}→${r.to}`] = r;
    }

    // Scene history (full, like branchContext — location, participants, mutations, summary)
    for (const scene of ch.scenes ?? []) {
      sceneCounter++;
      const threadChanges = (scene.threadMutations ?? [])
        .map((tm: any) => `${tm.threadDescription?.slice(0, 50)}: ${tm.from}→${tm.to}`)
        .join('; ');
      const kChanges = (scene.knowledgeMutations ?? [])
        .map((km: any) => `${km.characterName} learned [${km.type}]: ${km.content}`)
        .join('; ');
      const rChanges = (scene.relationshipMutations ?? [])
        .map((rm: any) => `${rm.from}→${rm.to}: ${rm.type} (${rm.valenceDelta >= 0 ? '+' : ''}${rm.valenceDelta})`)
        .join('; ');

      sceneHistory.push(
        `[Ch${ch.chapter} S${sceneCounter}] @ ${scene.locationName} | ${scene.participantNames?.join(', ')} | stakes:${scene.stakes}` +
        (threadChanges ? ` | Threads: ${threadChanges}` : '') +
        (kChanges ? ` | Knowledge: ${kChanges}` : '') +
        (rChanges ? ` | Relationships: ${rChanges}` : '') +
        `\n   ${scene.summary}`
      );
    }
  }

  // ── Assemble context (same structure as branchContext in ai.ts) ──
  const charBlock = Object.values(characters).map(c => {
    const kLines = c.knowledge.map(k => `    (${k.type}) ${k.content} [Ch${k.chapter}]`);
    return `- ${c.name} (${c.role})${kLines.length > 0 ? '\n  Knowledge:\n' + kLines.join('\n') : ''}`;
  }).join('\n');

  const locBlock = Object.values(locations).map(l => {
    const loreLines = l.lore.map(lr => `    ${lr}`);
    return `- ${l.name}${l.parentName ? ` (inside ${l.parentName})` : ''}: ${l.description}` +
      (loreLines.length > 0 ? '\n  Lore:\n' + loreLines.join('\n') : '');
  }).join('\n');

  const threadBlock = Object.values(threads).map(t =>
    `- "${t.description}" [${t.currentStatus}] anchors: ${t.anchorNames.join(', ')} | history: ${t.history.join(', ')}`
  ).join('\n');

  const relBlock = Object.values(relationships).map(r =>
    `- ${r.from} → ${r.to}: ${r.type} (valence: ${r.valence})`
  ).join('\n');

  return `
CUMULATIVE WORLD STATE (${allChapters.length} chapters analyzed):

CHARACTERS:
${charBlock}

LOCATIONS:
${locBlock}

THREADS:
${threadBlock}

RELATIONSHIPS:
${relBlock}

FULL SCENE HISTORY (${sceneCounter} scenes across ${allChapters.length} chapters):
${sceneHistory.join('\n')}`;
}

// ── Call LLM ────────────────────────────────────────────────────────────────
async function callLLM(prompt: string, systemPrompt: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in .env.local');

  console.log(`  Calling ${model}...`);
  const start = Date.now();

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Narrative Engine - Chapter Analyzer',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 16000,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error (${res.status}): ${err}`);
  }

  const data = await res.json();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  Done in ${elapsed}s (${data.usage?.total_tokens ?? '?'} tokens)`);

  return data.choices?.[0]?.message?.content ?? '';
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const chapterText = readFileSync(chapterFile, 'utf-8');
  const cumulativeCtx = buildCumulativeContext();

  console.log(`\nAnalyzing Chapter ${chapterNum} (${chapterText.split(/\s+/).length} words)`);
  if (cumulativeCtx) console.log(`  With cumulative state from ${chapterNum - 1} prior chapter(s)`);

  const systemPrompt = `You are a narrative simulation engine that extracts structured scene data from book chapters for an interactive storytelling system.
You must ALWAYS respond with valid JSON only — no markdown, no explanation, no code fences.

The narrative engine tracks:
- Characters with roles (anchor = central, recurring = frequent, transient = minor) and knowledge graphs
- Locations with parent-child hierarchy and lore/secrets
- Narrative threads — ongoing tensions that evolve: dormant → surfacing → escalating → fractured → converging → critical → threatened → resolved/subverted/done/closed/abandoned
- Scenes with events, stakes (0-100), thread mutations, knowledge mutations, and relationship mutations
- Relationships — directional with sentiment valence (-1 to 1) and descriptive type

Knowledge types must be SPECIFIC and CONTEXTUAL — not generic labels like "knows" or "secret". Use types that describe exactly what kind of knowledge: "social_observation", "class_awareness", "romantic_longing", "moral_judgment", "hidden_wealth_source", "past_betrayal", "forbidden_desire", "strategic_deception", etc.

Be thorough. Extract every character, location, and narrative development from the chapter text.`;

  const prompt = `Analyze this chapter and extract all narrative elements.
${cumulativeCtx}

=== CHAPTER ${chapterNum} TEXT ===
${chapterText}

Return a single JSON object with this exact structure:
{
  "chapterSummary": "2-3 sentence summary of key events and thematic significance",
  "characters": [
    {
      "name": "Full Name",
      "role": "anchor|recurring|transient",
      "description": "One-line character description relevant to this chapter",
      "firstAppearance": true/false,
      "knowledge": [
        {
          "type": "specific_contextual_type (e.g. social_observation, romantic_longing, moral_judgment, hidden_identity, strategic_deception)",
          "content": "What they learn, reveal, or demonstrate in THIS chapter"
        }
      ]
    }
  ],
  "locations": [
    {
      "name": "Location Name",
      "parentName": "Parent Location or null",
      "description": "Brief atmospheric description",
      "lore": ["Notable detail, symbolic significance, or secret about this place"]
    }
  ],
  "threads": [
    {
      "description": "The narrative question or tension — use EXACT description from prior chapters for continuing threads",
      "anchorNames": ["Character or location names this thread is anchored to"],
      "statusAtStart": "status at chapter start (MUST match current status from THREADS section above)",
      "statusAtEnd": "status at chapter end",
      "development": "How this thread developed in this chapter"
    }
  ],
  "scenes": [
    {
      "locationName": "Where it happens",
      "participantNames": ["Who is present"],
      "events": ["short_event_tag_1", "short_event_tag_2"],
      "stakes": 0-100,
      "summary": "2-4 sentence vivid summary in present tense, literary style. Describe what happens, who is involved, and the emotional stakes.",
      "threadMutations": [
        { "threadDescription": "exact thread description", "from": "status", "to": "status" }
      ],
      "knowledgeMutations": [
        { "characterName": "Name", "action": "added", "content": "What they learned", "type": "specific_contextual_type" }
      ],
      "relationshipMutations": [
        { "from": "Name", "to": "Name", "type": "Description of how the relationship shifted", "valenceDelta": -0.3 to 0.3 }
      ]
    }
  ],
  "relationships": [
    {
      "from": "Name",
      "to": "Name",
      "type": "Descriptive relationship from 'from's perspective — written in character voice",
      "valence": -1 to 1
    }
  ]
}

RULES:
- Break the chapter into 2-5 distinct scenes based on location shifts, time jumps, or major tonal changes
- "stakes" is 0-100: 0 = nothing at risk, 50 = significant social/emotional stakes, 100 = life or death
- Every scene MUST have a non-empty "summary" (2-4 vivid sentences), at least one event tag, and a stakes rating

CUMULATIVE CONTINUITY (critical):
- Thread "statusAtStart" MUST match the thread's current status from the THREADS section in the world state above. Do NOT reset or skip statuses.
- If a character is listed in CHARACTERS above, set firstAppearance: false
- Reuse EXACT thread descriptions from prior chapters when the same thread continues. Only create new threads for genuinely new narrative tensions introduced in THIS chapter.
- Relationship valence should evolve from prior values — check RELATIONSHIPS above. Use valenceDelta in scene mutations to show incremental change (typically ±0.1 to ±0.2).
- When listing relationships at the chapter level, show the UPDATED valence (prior + accumulated deltas from this chapter's scenes)

KNOWLEDGE MUTATIONS:
- Track what characters LEARN or REVEAL in this specific chapter — not what they already know
- Types must be contextual: "social_observation", "class_awareness", "romantic_longing", "moral_judgment", "hidden_wealth_source", "past_relationship", "strategic_deception", "disillusionment", etc.

THREAD LIFECYCLE:
- Active statuses: "dormant", "surfacing", "escalating", "fractured", "converging", "critical", "threatened"
- Terminal statuses: "resolved" (concluded satisfactorily), "done" (ran its course), "subverted" (upended), "closed" (shut down), "abandoned" (faded)
- Threads should evolve gradually. A dormant thread surfaces slowly, not in one jump to critical.
- When a thread's storyline has concluded, transition to appropriate terminal status.

PACING:
- Not every scene is a major plot event. Include quieter scenes: character moments, atmosphere, social observation.
- Vary rhythm — a tense scene should be followed by a breather.
- Only 1 in 3 scenes should be a significant plot beat.`;

  const raw = await callLLM(prompt, systemPrompt);

  // Clean LLM quirks
  let json = raw.trim();
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  // Remove trailing commas before } or ]
  json = json.replace(/,\s*([}\]])/g, '$1');

  try {
    const parsed = JSON.parse(json);
    writeFileSync(outputFile, JSON.stringify(parsed, null, 2));
    console.log(`\n  Output: ${outputFile}`);
    console.log(`  Characters: ${parsed.characters?.length ?? 0}`);
    console.log(`  Locations: ${parsed.locations?.length ?? 0}`);
    console.log(`  Threads: ${parsed.threads?.length ?? 0}`);
    console.log(`  Scenes: ${parsed.scenes?.length ?? 0}`);
    console.log(`  Relationships: ${parsed.relationships?.length ?? 0}`);
  } catch (e) {
    const errFile = outputFile.replace('.json', '.raw.txt');
    writeFileSync(errFile, raw);
    console.error(`\n  Failed to parse JSON. Raw output saved to: ${errFile}`);
    console.error(`  Error: ${e}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
