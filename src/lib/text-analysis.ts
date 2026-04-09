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
  WorldBuild, Branch, ProseProfile, SceneVersionPointers, WorldKnowledgeNodeType, ContinuityNodeType,
  BeatPlan,
} from '@/types/narrative';
import { THREAD_ACTIVE_STATUSES, THREAD_TERMINAL_STATUSES, THREAD_STATUS_LABELS, DEFAULT_STORY_SETTINGS } from '@/types/narrative';
import { ANALYSIS_TARGET_SECTIONS_PER_CHUNK, ANALYSIS_TARGET_CHUNK_WORDS, ANALYSIS_MODEL, MAX_TOKENS_DEFAULT, ANALYSIS_TEMPERATURE, WORDS_PER_SCENE, SCENES_PER_ARC } from '@/lib/constants';
import { validateExtractionResult, validateWorldKnowledge } from '@/lib/ai/validation';
import { logWarning, logInfo } from '@/lib/system-logger';

// ── Scene-level Splitting ────────────────────────────────────────────────────

/**
 * Split corpus into scene-sized prose chunks (~1200 words each).
 * Returns ordered array of { index, prose, wordCount }.
 */
export function splitCorpusIntoScenes(text: string): { index: number; prose: string; wordCount: number }[] {
  const TARGET = WORDS_PER_SCENE;
  const scenes: { index: number; prose: string; wordCount: number }[] = [];

  // Split on paragraph breaks first, then sentence breaks for long paragraphs
  let paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

  // Break any paragraph longer than TARGET into sentence-level chunks
  const expanded: string[] = [];
  for (const para of paragraphs) {
    const wc = para.split(/\s+/).length;
    if (wc > TARGET) {
      // Split on sentence boundaries
      const sentences = para.match(/[^.!?]+[.!?]+["']?\s*/g) ?? [para];
      let sentBuf = '';
      for (const sent of sentences) {
        if (sentBuf && (sentBuf.split(/\s+/).length + sent.split(/\s+/).length) > TARGET) {
          expanded.push(sentBuf.trim());
          sentBuf = sent;
        } else {
          sentBuf += sent;
        }
      }
      if (sentBuf.trim()) expanded.push(sentBuf.trim());
    } else {
      expanded.push(para);
    }
  }
  paragraphs = expanded;

  // Group paragraphs into ~1200-word scenes
  let buffer: string[] = [];
  let bufferWords = 0;

  for (const para of paragraphs) {
    const paraWords = para.split(/\s+/).length;
    if (bufferWords >= TARGET) {
      // Buffer already at target — flush immediately
      scenes.push({ index: scenes.length, prose: buffer.join('\n\n'), wordCount: bufferWords });
      buffer = [para];
      bufferWords = paraWords;
    } else if (bufferWords > 0 && bufferWords + paraWords > TARGET * 1.15) {
      // Adding this paragraph would overshoot — flush and start new
      scenes.push({ index: scenes.length, prose: buffer.join('\n\n'), wordCount: bufferWords });
      buffer = [para];
      bufferWords = paraWords;
    } else {
      buffer.push(para);
      bufferWords += paraWords;
    }
  }
  if (buffer.length > 0) {
    scenes.push({ index: scenes.length, prose: buffer.join('\n\n'), wordCount: bufferWords });
  }

  // Merge any tiny trailing scene into the previous one
  if (scenes.length > 1 && scenes[scenes.length - 1].wordCount < TARGET * 0.3) {
    const last = scenes.pop()!;
    const prev = scenes[scenes.length - 1];
    scenes[scenes.length - 1] = { ...prev, prose: prev.prose + '\n\n' + last.prose, wordCount: prev.wordCount + last.wordCount };
  }

  return scenes;
}

// ── Per-Scene Structure Extraction ──────────────────────────────────────────

/**
 * Scene structure result — entities and mutations extracted from one scene's prose.
 */
export type SceneStructureResult = {
  povName: string;
  locationName: string;
  participantNames: string[];
  events: string[];
  summary: string;
  characters: AnalysisChunkResult['characters'];
  locations: AnalysisChunkResult['locations'];
  artifacts: NonNullable<AnalysisChunkResult['artifacts']>;
  threads: AnalysisChunkResult['threads'];
  relationships: AnalysisChunkResult['relationships'];
  threadMutations: AnalysisChunkResult['scenes'][0]['threadMutations'];
  continuityMutations: AnalysisChunkResult['scenes'][0]['continuityMutations'];
  relationshipMutations: AnalysisChunkResult['scenes'][0]['relationshipMutations'];
  artifactUsages: NonNullable<AnalysisChunkResult['scenes'][0]['artifactUsages']>;
  ownershipMutations: NonNullable<AnalysisChunkResult['scenes'][0]['ownershipMutations']>;
  tieMutations: NonNullable<AnalysisChunkResult['scenes'][0]['tieMutations']>;
  characterMovements: NonNullable<AnalysisChunkResult['scenes'][0]['characterMovements']>;
  worldKnowledgeMutations?: AnalysisChunkResult['scenes'][0]['worldKnowledgeMutations'];
};

/**
 * Extract structure from a single scene's prose, informed by its beat plan.
 * The plan tells the LLM where beat boundaries are; the prose is the source of truth for mutations.
 */
export async function extractSceneStructure(
  prose: string,
  plan: BeatPlan | null,
  onToken?: (token: string, accumulated: string) => void,
): Promise<SceneStructureResult> {
  const beatSection = plan
    ? `\n\nBEAT PLAN (${plan.beats.length} beats — use as a guide for where events happen):\n${plan.beats.map((b, i) => `Beat ${i + 1} [${b.fn}/${b.mechanism}]: ${b.what}`).join('\n')}`
    : '';

  const prompt = `Extract narrative structure from this scene's prose.

SCENE PROSE:
${prose}${beatSection}

FORCE FORMULAS — your extractions are the direct inputs to these formulas:
- PAYOFF = Σ max(0, φ_to - φ_from) + 0.25/pulse. Phase: dormant=0, active=1, escalating=2, critical=3, terminal=4. Ref: ~1.3/scene.
- CHANGE = √(cont_nodes + √cont_edges) + √events + √(Σ|valenceDelta|²). Ref: ~4/scene.
- KNOWLEDGE = ΔN + √ΔE (world knowledge). Ref: ~4/scene.

Return JSON:
{
  "povName": "POV character name",
  "locationName": "Where this scene takes place",
  "participantNames": ["All characters present"],
  "events": ["short_event_tags"],
  "summary": "3-5 sentence narrative summary using character and location NAMES",
  "characters": [{"name": "Full Name", "role": "anchor|recurring|transient", "firstAppearance": false, "continuity": [{"type": "trait|state|history|capability|belief|relation|secret|goal|weakness", "content": "what changed"}]}],
  "locations": [{"name": "Location Name", "parentName": "Parent or null", "description": "Brief description", "lore": ["detail"], "tiedCharacterNames": ["characters tied here"]}],
  "artifacts": [{"name": "Artifact Name", "significance": "key|notable|minor", "continuity": [{"type": "...", "content": "..."}], "ownerName": "owner or null"}],
  "threads": [{"description": "narrative tension", "participantNames": ["names"], "statusAtStart": "status", "statusAtEnd": "status", "development": "how it developed"}],
  "relationships": [{"from": "Name", "to": "Name", "type": "description", "valence": 0.0}],
  "threadMutations": [{"threadDescription": "exact thread description", "from": "status", "to": "status"}],
  "continuityMutations": [{"entityName": "Name", "addedNodes": [{"content": "what", "type": "trait|state|history|capability|belief|relation|secret|goal|weakness"}]}],
  "relationshipMutations": [{"from": "Name", "to": "Name", "type": "description", "valenceDelta": 0.1}],
  "artifactUsages": [{"artifactName": "Name", "characterName": "who or null"}],
  "ownershipMutations": [{"artifactName": "Name", "fromName": "prev", "toName": "new"}],
  "tieMutations": [{"locationName": "Name", "characterName": "Name", "action": "add|remove"}],
  "characterMovements": [{"characterName": "Name", "locationName": "destination", "transition": "how"}],
  "worldKnowledgeMutations": {"addedNodes": [{"concept": "name", "type": "principle|system|concept|tension|event|structure|environment|convention|constraint"}], "addedEdges": [{"fromConcept": "name", "toConcept": "name", "relation": "type"}]}
}`;

  const fieldGuide = `
EXTRACTION STANDARDS — every mutation must EARN its place. Low-value mutations flatten the force graph.

threadMutations — lifecycle: dormant→active→escalating→critical→resolved/subverted/abandoned.
- ONE step at a time. NEVER skip phases.
- Most scenes: 1-2 PULSES (same→same). Real transitions are RARE: 0-1 per scene.
- Only record a transition when the prose shows a clear, irreversible shift in tension.
- Touching 2-3 threads per scene (mostly pulses) with at most one transition is typical.

continuityMutations — the entity's inner world CHANGED. Not observations — CHANGES.
- QUALITY BAR: each node must describe something the entity didn't know/feel/have BEFORE this scene.
  BAD: "Alice is curious" (observation). BAD: "The White Rabbit has pink eyes" (description).
  GOOD: "Alice abandons caution entirely, chasing the Rabbit without considering how to return" (new behaviour).
  GOOD: "The White Rabbit's panic reveals it answers to a higher authority" (new understanding).
- MAX 2-3 nodes per entity per scene. Only POV character and one other entity typically earn continuity.
- Background characters who don't change: ZERO nodes.
- addedEdges: connect causally linked changes with "follows", "causes", "contradicts", "enables".
- Types: trait, state, history, capability, belief, relation, secret, goal, weakness.

relationshipMutations — only when a relationship SHIFTS, not just exists.
- valenceDelta: ±0.1 subtle, ±0.2-0.3 meaningful, ±0.4-0.5 dramatic. Most scenes: 0-1.

worldKnowledgeMutations — REVEALED world rules, not character observations.
- Each concept: a genuine world SYSTEM or PRINCIPLE.
  BAD: "Wonderland Logic" (vague). GOOD: "Anthropomorphic Animals" (real world feature).
- MAX 1-2 concepts per scene. Most scenes: 0-1. Only exposition/world-building: 3+.
- Types: principle, system, concept, tension, event, structure, environment, convention, constraint.
- Edges: enables, governs, opposes, extends, created_by, constrains, exist_within.

ENTITY EXTRACTION:
- characters: named characters present. Role: anchor/recurring/transient.
- locations: nest via parentName. tiedCharacterNames: characters who BELONG (residents, faction members).
- artifacts: tools that extend capabilities. ownerName: character/location/null. significance: key/notable/minor.
- threads: narrative tensions. development: what specifically happened.

events — 2-4 word tags. 2-4 per scene. Each names a discrete beat.
artifactUsages — when an artifact delivers utility. Fiction: wielding, consulting, activating. Academic: applying a technique, leveraging a system, training with an algorithm. Every artifact referenced for its PURPOSE is a usage, not just by name. characterName null for unattributed.
ownershipMutations — only when artifacts change hands.
tieMutations — significant bond changes. NOT temporary visits.
characterMovements — only physical relocation. Vivid transitions.

VARIANCE IS SIGNAL:
- Quiet scene: 0 transitions, 1 continuity node, 0 knowledge, 2 events = CORRECT.
- Climactic scene: 2 transitions, 5 nodes, 3 concepts, 5 events = CORRECT.
- If every scene has similar counts, you are extracting noise. The graph needs peaks and valleys.`;

  const fullPrompt = prompt + '\n' + fieldGuide;
  const system = `You are a narrative structure extractor. Given a scene's exact prose and its beat plan, extract all entities, mutations, and structural data accurately. Dense prose deserves rich extraction; sparse prose deserves minimal extraction. Return only valid JSON.`;
  const raw = await callAnalysis(fullPrompt, system, onToken);
  const json = extractJSON(raw);
  const parsed = JSON.parse(json) as SceneStructureResult;

  return {
    povName: parsed.povName ?? '',
    locationName: parsed.locationName ?? '',
    participantNames: parsed.participantNames ?? [],
    events: parsed.events ?? [],
    summary: parsed.summary ?? '',
    characters: parsed.characters ?? [],
    locations: parsed.locations ?? [],
    artifacts: parsed.artifacts ?? [],
    threads: parsed.threads ?? [],
    relationships: parsed.relationships ?? [],
    threadMutations: parsed.threadMutations ?? [],
    continuityMutations: parsed.continuityMutations ?? [],
    relationshipMutations: parsed.relationshipMutations ?? [],
    artifactUsages: parsed.artifactUsages ?? [],
    ownershipMutations: parsed.ownershipMutations ?? [],
    tieMutations: parsed.tieMutations ?? [],
    characterMovements: parsed.characterMovements ?? [],
    worldKnowledgeMutations: parsed.worldKnowledgeMutations,
  };
}

// ── Arc Grouping ────────────────────────────────────────────────────────────

/**
 * Group scenes into arcs of ~4 scenes each and name them via LLM.
 */
export async function groupScenesIntoArcs(
  sceneSummaries: { index: number; summary: string }[],
  onToken?: (token: string, accumulated: string) => void,
): Promise<{ name: string; sceneIndices: number[] }[]> {
  // Pre-group into chunks of SCENES_PER_ARC
  const groups: { sceneIndices: number[]; summaries: string[] }[] = [];
  for (let i = 0; i < sceneSummaries.length; i += SCENES_PER_ARC) {
    const slice = sceneSummaries.slice(i, i + SCENES_PER_ARC);
    groups.push({ sceneIndices: slice.map(s => s.index), summaries: slice.map(s => s.summary) });
  }

  const prompt = `Name each arc based on its scene summaries. An arc is a narrative unit of ~4 scenes.

${groups.map((g, i) => `ARC ${i + 1} (scenes ${g.sceneIndices[0] + 1}-${g.sceneIndices[g.sceneIndices.length - 1] + 1}):\n${g.summaries.map((s, j) => `  Scene ${g.sceneIndices[j] + 1}: ${s}`).join('\n')}`).join('\n\n')}

Return JSON array of arc names (one per arc, in order):
["Arc 1 Name", "Arc 2 Name", ...]

Rules:
- Each name should capture the arc's thematic thrust in 2-5 words
- Names should be evocative and specific, not generic ("The Betrayal at Dawn" not "Events")`;

  const system = 'You are a narrative analyst. Name story arcs based on scene summaries. Return only a JSON array of strings.';
  const raw = await callAnalysis(prompt, system, onToken);
  const json = extractJSON(raw);
  const names = JSON.parse(json) as string[];

  return groups.map((g, i) => ({
    name: names[i] ?? `Arc ${i + 1}`,
    sceneIndices: g.sceneIndices,
  }));
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
  const allArtifactNames = new Set<string>();
  const allWKConcepts = new Set<string>();

  for (const r of results) {
    for (const c of r.characters ?? []) allCharNames.add(c.name);
    for (const t of r.threads ?? []) allThreadDescs.add(t.description);
    for (const l of r.locations ?? []) allLocNames.add(l.name);
    for (const a of r.artifacts ?? []) allArtifactNames.add(a.name);
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

ARTIFACTS found across all chunks:
${[...allArtifactNames].map((n, i) => `${i + 1}. "${n}"`).join('\n')}

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
  "artifactMerges": {
    "variant artifact name": "canonical artifact name"
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

ARTIFACT MERGING:
- Merge name variants for the same tool ("the Elder Wand" / "Elder Wand" / "Dumbledore's wand")
- Merge when the same tool is described at different abstraction levels ("Google" / "Google Search" → keep the more specific)
- Do NOT merge distinct tools that happen to be related (a sword and a shield are separate)

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
    artifactMerges?: Record<string, string>;
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
  const artMap = merges.artifactMerges ?? {};
  const wkMap = merges.worldKnowledgeMerges ?? {};

  const resolveChar = (name: string) => charMap[name] ?? name;
  const resolveThread = (desc: string) => threadMap[desc] ?? desc;
  const resolveLoc = (name: string) => locMap[name] ?? name;
  const resolveArt = (name: string) => artMap[name] ?? name;
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
    artifacts: deduplicateBy(
      (r.artifacts ?? []).map((a) => ({
        ...a,
        name: resolveArt(a.name),
        ownerName: a.ownerName ? (resolveChar(a.ownerName) !== a.ownerName ? resolveChar(a.ownerName) : resolveLoc(a.ownerName)) : null,
      })),
      (a) => a.name,
      (a, b) => ({
        ...a,
        significance: higherSignificance(a.significance, b.significance),
        continuity: [...(a.continuity ?? []), ...(b.continuity ?? [])],
      }),
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
      continuityMutations: (s.continuityMutations ?? []).map((km) => {
        // Entity can be character, location, or artifact — try each resolver
        const n = km.entityName;
        const resolved = charMap[n] ? resolveChar(n) : locMap[n] ? resolveLoc(n) : artMap[n] ? resolveArt(n) : n;
        return { ...km, entityName: resolved };
      }),
      relationshipMutations: (s.relationshipMutations ?? []).map((rm) => ({
        ...rm,
        from: resolveChar(rm.from),
        to: resolveChar(rm.to),
      })),
      artifactUsages: (s.artifactUsages ?? []).map((au) => ({
        ...au,
        artifactName: resolveArt(au.artifactName),
        characterName: au.characterName ? resolveChar(au.characterName) : null,
      })),
      ownershipMutations: (s.ownershipMutations ?? []).map((om) => ({
        ...om,
        artifactName: resolveArt(om.artifactName),
        fromName: resolveChar(om.fromName) !== om.fromName ? resolveChar(om.fromName) : resolveLoc(om.fromName),
        toName: resolveChar(om.toName) !== om.toName ? resolveChar(om.toName) : resolveLoc(om.toName),
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

function higherSignificance(a: string, b: string): string {
  const rank: Record<string, number> = { minor: 0, notable: 1, key: 2 };
  return (rank[b] ?? 0) > (rank[a] ?? 0) ? b : a;
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
  arcGroups?: { name: string; sceneIndices: number[] }[],
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
  /** Resolve an entity name to its ID — checks characters first, then locations, then artifacts. Falls back to character ID. */
  const getEntityId = (name: string) => charNameToId[name] ?? locNameToId[name] ?? artifactNameToId[name] ?? getCharId(name);

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
  // No deferred knowledge — continuity is built directly on entities during creation
  // Track which chunk each entity was first introduced in (for per-batch world commits)
  const charFirstChunk = new Map<string, number>();
  const locFirstChunk = new Map<string, number>();
  const threadFirstChunk = new Map<string, number>();
  const artifactFirstChunk = new Map<string, number>();
  const chunkFirstSceneId = new Map<number, string>(); // chunkIdx → first scene id
  const allOrderedSceneIds: string[] = []; // flat ordered list for arc group assignment

  for (let chunkIdx = 0; chunkIdx < results.length; chunkIdx++) {
    const ch = results[chunkIdx];
    // Characters — create entities with continuity built directly
    for (const c of ch.characters ?? []) {
      const id = getCharId(c.name);
      if (!characters[id]) {
        characters[id] = {
          id, name: c.name, role: c.role as Character['role'], threadIds: [],
          continuity: { nodes: {}, edges: [] },
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
      // Build initial continuity directly on the entity (not deferred through scene mutations)
      for (const k of c.continuity ?? []) {
        const existingContents = new Set(Object.values(characters[id].continuity.nodes).map(n => n.content));
        if (!existingContents.has(k.content)) {
          const nid = nextKId();
          characters[id].continuity.nodes[nid] = { id: nid, type: (k.type || 'trait') as ContinuityNodeType, content: k.content };
        }
      }
    }

    // Locations — create entities but defer lore to scene mutations
    for (const loc of ch.locations ?? []) {
      const id = getLocId(loc.name);
      if (!locations[id]) {
        const parentId = loc.parentName ? getLocId(loc.parentName) : null;
        const tiedCharacterIds = (loc.tiedCharacterNames ?? []).map((n: string) => getCharId(n)).filter(Boolean);
        locations[id] = {
          id, name: loc.name, prominence: 'place' as Location['prominence'], parentId, tiedCharacterIds, threadIds: [],
          continuity: { nodes: {}, edges: [] },
          ...(loc.imagePrompt ? { imagePrompt: loc.imagePrompt } : {}),
        };
        locFirstChunk.set(id, chunkIdx);
      } else {
        if (loc.imagePrompt) {
          locations[id].imagePrompt = loc.imagePrompt;
        }
        // Accumulate tied characters across scenes (not just first creation)
        const newTied = (loc.tiedCharacterNames ?? []).map((n: string) => getCharId(n)).filter(Boolean);
        for (const cid of newTied) {
          if (!locations[id].tiedCharacterIds.includes(cid)) {
            locations[id].tiedCharacterIds = [...locations[id].tiedCharacterIds, cid];
          }
        }
      }
      // Build location continuity directly on the entity
      for (const lore of loc.lore ?? []) {
        const existingContents = new Set(Object.values(locations[id].continuity.nodes).map(n => n.content));
        if (!existingContents.has(lore)) {
          const nid = nextKId();
          locations[id].continuity.nodes[nid] = { id: nid, type: 'history', content: lore };
        }
      }
    }

    // Artifacts
    for (const a of ch.artifacts ?? []) {
      const id = getArtifactId(a.name);
      const ownerName = a.ownerName;
      const parentId = ownerName
        ? (charNameToId[ownerName] ?? locNameToId[ownerName] ?? getLocId(ownerName))
        : null;
      if (!artifactEntities[id]) {
        artifactEntities[id] = {
          id, name: a.name,
          significance: (['key', 'notable', 'minor'].includes(a.significance) ? a.significance : 'notable') as Artifact['significance'],
          continuity: { nodes: Object.fromEntries((a.continuity ?? []).map((k) => { const id = nextKId(); return [id, { id, type: (k.type || 'trait') as ContinuityNodeType, content: k.content }]; })), edges: [] },
          threadIds: [],
          parentId,
        };
        artifactFirstChunk.set(id, chunkIdx);
      } else {
        // Accumulate continuity from later chunks
        for (const k of a.continuity ?? []) {
          const existingContents = new Set(Object.values(artifactEntities[id].continuity.nodes).map(n => n.content));
          if (!existingContents.has(k.content)) {
            const nid = nextKId();
            artifactEntities[id].continuity.nodes[nid] = { id: nid, type: (k.type || 'trait') as ContinuityNodeType, content: k.content };
          }
        }
        if (parentId) artifactEntities[id].parentId = parentId;
      }
    }

    // (continuity built directly on entities above — no deferred flush needed)

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

    // Scenes — collect into flat list; arcs created from arcGroups after loop
    const chScenes: Scene[] = [];
    const arcId = '__pending__'; // Will be assigned from arcGroups below

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
        continuityMutations: (s.continuityMutations ?? []).map((km) => {
          const entityId = getEntityId(km.entityName);
          // Assign IDs to nodes
          const nodes = (km.addedNodes ?? []).map((n) => ({
            id: nextKId(), content: n.content, type: (n.type || 'trait') as ContinuityNodeType,
          }));
          // Edges are created deterministically by applyContinuityMutation during store replay
          return { entityId, addedNodes: nodes, addedEdges: [] };
        }),
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
        artifactUsages: (() => {
          const aus = s.artifactUsages ?? [];
          if (aus.length === 0) return undefined;
          return aus.map((au) => ({
            artifactId: getArtifactId(au.artifactName),
            characterId: au.characterName ? getCharId(au.characterName) : null,
          })).filter((au) => artifactEntities[au.artifactId]);
        })() || undefined,
        ownershipMutations: (() => {
          const oms = s.ownershipMutations ?? [];
          if (oms.length === 0) return undefined;
          return oms.map((om) => ({
            artifactId: getArtifactId(om.artifactName),
            fromId: charNameToId[om.fromName] ?? locNameToId[om.fromName] ?? getLocId(om.fromName),
            toId: charNameToId[om.toName] ?? locNameToId[om.toName] ?? getLocId(om.toName),
          })).filter((om) => artifactEntities[om.artifactId]);
        })() || undefined,
        tieMutations: (() => {
          const mms = s.tieMutations ?? [];
          if (mms.length === 0) return undefined;
          return mms.map((mm: { locationName: string; characterName: string; action: string }) => ({
            locationId: getLocId(mm.locationName),
            characterId: getCharId(mm.characterName),
            action: mm.action as 'add' | 'remove',
          })).filter((mm) => mm.characterId && (mm.action === 'add' || mm.action === 'remove'));
        })() || undefined,
        worldKnowledgeMutations: (() => {
          const wkm = s.worldKnowledgeMutations;
          if (!wkm) return undefined;
          const addedNodes = (wkm.addedNodes ?? []).map((n) => ({
            id: getWkId(n.concept),
            concept: n.concept,
            type: (['principle', 'system', 'concept', 'tension', 'event', 'structure', 'environment', 'convention', 'constraint'].includes(n.type) ? n.type : 'concept') as WorldKnowledgeNodeType,
          }));
          const addedEdges = (wkm.addedEdges ?? []).map((e) => ({
            from: getWkId(e.fromConcept),
            to: getWkId(e.toConcept),
            relation: e.relation,
          }));
          if (addedNodes.length === 0 && addedEdges.length === 0) return undefined;
          return { addedNodes, addedEdges };
        })(),
        summary: s.summary ?? '',
        // Create version arrays for analyzed scenes
        proseVersions: (s.prose || s.beatProseMap) ? [{
          prose: s.prose ?? '',
          beatProseMap: s.beatProseMap,
          branchId: 'main',
          timestamp: Date.now(),
          version: '1',
          versionType: 'generate' as const,
          ...(s.plan ? { sourcePlanVersion: '1' } : {}),
        }] : undefined,
        planVersions: s.plan ? [{
          plan: s.plan,
          branchId: 'main',
          timestamp: Date.now(),
          version: '1',
          versionType: 'generate' as const,
        }] : undefined,
        // Preserve embeddings from analysis pipeline
        summaryEmbedding: (s as any).summaryEmbedding,
        proseEmbedding: (s as any).proseEmbedding,
        planEmbeddingCentroid: (s as any).planEmbeddingCentroid,
      };

      scenes[sceneId] = scene;
      chScenes.push(scene);
      if (!chunkFirstSceneId.has(chunkIdx)) chunkFirstSceneId.set(chunkIdx, sceneId);
    }

    // Distribute deferred knowledge across the chunk's scenes.
    // Each knowledge node goes to the first scene where that character participates,
    // spreading mutations naturally instead of spiking the first scene.
    if (chScenes.length > 0) {
      // Continuity is built directly on entities — no deferred flush needed
    }

    // Track scene order for arc group assignment below
    allOrderedSceneIds.push(...chScenes.map(s => s.id));

    for (const tm of chScenes.flatMap((s) => s.threadMutations)) {
      if (threads[tm.threadId] && !threads[tm.threadId].openedAt) {
        threads[tm.threadId].openedAt = chScenes[0]?.id;
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

  // ── Create arcs from arcGroups ──────────────────────────────────────────────
  if (arcGroups && arcGroups.length > 0) {
    for (const group of arcGroups) {
      const arcId = nextArcId();
      const sceneIds = group.sceneIndices
        .filter(i => i < allOrderedSceneIds.length)
        .map(i => allOrderedSceneIds[i]);
      if (sceneIds.length === 0) continue;

      const arcScenes = sceneIds.map(id => scenes[id]).filter(Boolean);
      const develops = [...new Set(arcScenes.flatMap(s => s.threadMutations.map(tm => tm.threadId)))];
      const locationIds = [...new Set(arcScenes.map(s => s.locationId))];
      const activeCharacterIds = [...new Set(arcScenes.flatMap(s => s.participantIds))];
      const initialCharacterLocations: Record<string, string> = {};
      for (const cid of activeCharacterIds) {
        const first = arcScenes.find(s => s.participantIds.includes(cid));
        if (first) initialCharacterLocations[cid] = first.locationId;
      }

      arcs[arcId] = { id: arcId, name: group.name, sceneIds, develops, locationIds, activeCharacterIds, initialCharacterLocations };
      // Assign arcId to scenes
      for (const scene of arcScenes) scene.arcId = arcId;
    }
  } else {
    // Fallback: group every 4 scenes into an arc
    for (let i = 0; i < allOrderedSceneIds.length; i += 4) {
      const arcId = nextArcId();
      const sceneIds = allOrderedSceneIds.slice(i, i + 4);
      const arcScenes = sceneIds.map(id => scenes[id]).filter(Boolean);
      const develops = [...new Set(arcScenes.flatMap(s => s.threadMutations.map(tm => tm.threadId)))];
      const locationIds = [...new Set(arcScenes.map(s => s.locationId))];
      const activeCharacterIds = [...new Set(arcScenes.flatMap(s => s.participantIds))];
      const initialCharacterLocations: Record<string, string> = {};
      for (const cid of activeCharacterIds) {
        const first = arcScenes.find(s => s.participantIds.includes(cid));
        if (first) initialCharacterLocations[cid] = first.locationId;
      }
      arcs[arcId] = { id: arcId, name: `Arc ${Math.floor(i / 4) + 1}`, sceneIds, develops, locationIds, activeCharacterIds, initialCharacterLocations };
      for (const scene of arcScenes) scene.arcId = arcId;
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

  // Build continuity graphs from scene mutations (forward replay, additive)
  // This ensures continuity.nodes is the final accumulated state and enables temporal filtering.
  const allSceneKeys = Object.keys(scenes);
  for (const sKey of allSceneKeys) {
    const scene = scenes[sKey];
    for (const km of scene.continuityMutations) {
      // Mutations can target characters, locations, or artifacts
      const entity = characters[km.entityId] ?? locations[km.entityId] ?? artifactEntities[km.entityId];
      if (!entity) continue;
      if (!entity.continuity) entity.continuity = { nodes: {}, edges: [] };
      for (const node of km.addedNodes ?? []) {
        if (!entity.continuity.nodes[node.id]) {
          entity.continuity.nodes[node.id] = { id: node.id, type: (node.type || 'trait') as ContinuityNodeType, content: node.content };
        }
      }
      for (const edge of km.addedEdges ?? []) {
        if (!entity.continuity.edges.some(e => e.from === edge.from && e.to === edge.to && e.relation === edge.relation)) {
          entity.continuity.edges.push(edge);
        }
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

  // Branch — build version pointers for analyzed scenes
  const branchId = `B-${PREFIX}-MAIN`;
  const versionPointers: Record<string, SceneVersionPointers> = {};

  // Set explicit version pointers for all scenes with version arrays
  for (const sceneId of Object.keys(scenes)) {
    const scene = scenes[sceneId];
    const pointers: SceneVersionPointers = {};

    if (scene.proseVersions && scene.proseVersions.length > 0) {
      pointers.proseVersion = scene.proseVersions[0].version;
    }

    if (scene.planVersions && scene.planVersions.length > 0) {
      pointers.planVersion = scene.planVersions[0].version;
    }

    if (pointers.proseVersion || pointers.planVersion) {
      versionPointers[sceneId] = pointers;
    }
  }

  const branches: Record<string, Branch> = {
    [branchId]: {
      id: branchId,
      name: 'Canon Timeline',
      parentBranchId: null,
      forkEntryId: null,
      entryIds,
      versionPointers,
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
